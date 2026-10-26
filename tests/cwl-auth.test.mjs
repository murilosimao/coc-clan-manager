import test from 'node:test';
import assert from 'node:assert/strict';
import { createCwlAuth } from '../src/cwl/auth.js';
import { createEdgeHandler } from '../src/cwl/edge.js';
import { bridgeCwl } from '../src/cwl/bridge.js';
import { sourceUrl,sourceProxy } from '../src/cwl/source-proxy.js';
import { databaseOptions } from '../src/cwl/database.js';
import { createWorker } from '../src/worker.js';
import { createCwlHandler } from '../src/cwl/router.js';

const app='https://coc-clan-manager.example.workers.dev',clan='2G8QCR92V';
const leader='10000000-0000-4000-8000-000000000001',co='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test-public-key',CWL_PUBLIC_ORIGIN:app,CWL_APP_ORIGIN:app,
  CWL_EDITORS:JSON.stringify({[leader]:{role:'leader',clanTag:clan},[co]:{role:'coLeader',clanTag:clan}}),CWL_BACKEND_KEY:'test-only-bridge-key-'.padEnd(64,'x')};
function fakeAuth(url,options){
  if(url.includes('/user')){
    const token=options.headers.Authorization?.slice(7);
    const id={'leader-token':leader,'co-token':co,'other-token':other,'renewed-token':leader}[token];
    return Promise.resolve(Response.json(id?{id,user_metadata:{role:'leader'}}:{error:'expired'},{status:id?200:401}));
  }
  if(url.includes('grant_type=refresh_token'))return Promise.resolve(Response.json({access_token:'renewed-token',refresh_token:'renewed-refresh',expires_in:3600,user:{id:leader}}));
  if(url.includes('/logout'))return Promise.resolve(new Response(null,{status:204}));
  const data=JSON.parse(options.body),id=data.email==='leader@test.invalid'?leader:data.email==='co@test.invalid'?co:other;
  return Promise.resolve(Response.json({access_token:id===leader?'leader-token':id===co?'co-token':'other-token',refresh_token:'test-refresh',expires_in:3600,user:{id}}));
}
function request(action,{method='GET',body,cookie,origin=app}={}){
  return new Request(app+'/api/cwl/auth/'+action,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
}

test('login grants only allowlisted leader/co-leader and tokens remain in secure HttpOnly cookies',async()=>{
  const auth=createCwlAuth(fakeAuth);
  for(const [email,role]of [['leader@test.invalid','leader'],['co@test.invalid','coLeader']]){
    const response=await auth.handle(request('login',{method:'POST',body:{email,password:'test-only-password'}}),env);
    const text=await response.text();assert.equal(JSON.parse(text).editor.role,role);assert(!text.includes('token'));assert(!text.includes('password'));
    const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);
    for(const cookie of cookies){assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/^__Host-/);assert(!cookie.includes('Domain='));}
  }
  await assert.rejects(auth.handle(request('login',{method:'POST',body:{email:'outsider@test.invalid',password:'test'}}),env),e=>e.status===403);
});
test('verified session role cannot be forged through user metadata or used for another clan',async()=>{
  const auth=createCwlAuth(fakeAuth),r=token=>new Request(app+'/api/cwl/clans/'+clan+'/wars/day/plan/revisions',{method:'POST',headers:{Origin:app,Cookie:'__Host-cwl-access='+token}});
  assert.equal((await auth.authorize(r('co-token'),env,clan)).role,'coLeader');
  await assert.rejects(auth.authorize(r('other-token'),env,clan),e=>e.status===403);
  await assert.rejects(auth.authorize(r('leader-token'),env,'2998YJPU2'),e=>e.code==='clan_forbidden');
  await assert.rejects(auth.authorize(r('expired-token'),env,clan),e=>e.status===401);
});
test('login and mutation require the exact app origin; public Pages cannot send authenticated writes',async()=>{
  const auth=createCwlAuth(fakeAuth);
  for(const origin of ['https://evil.invalid','https://murilosimao.github.io','null']){
    await assert.rejects(auth.handle(request('login',{method:'POST',origin,body:{email:'leader@test.invalid',password:'test'}}),env),e=>e.code==='csrf_origin');
  }
  await assert.rejects(auth.handle(request('login',{method:'POST',body:{email:'leader@test.invalid',password:'x'.repeat(5000)}}),env),e=>e.status===413);
});
test('session refresh rotates cookies and logout clears both without returning bearer tokens',async()=>{
  const auth=createCwlAuth(fakeAuth);
  const refreshed=await auth.handle(request('session',{cookie:'__Host-cwl-access=expired; __Host-cwl-refresh=old-refresh'}),env);
  assert.equal((await refreshed.json()).editor.id,leader);assert.match(refreshed.headers.getSetCookie()[0],/renewed-token/);
  const logout=await auth.handle(request('logout',{method:'POST',cookie:'__Host-cwl-access=leader-token'}),env);
  assert(logout.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
});
test('private Supabase function refuses direct access and unexpected proxy origins',async()=>{
  const edge=createEdgeHandler(env,{fetcher:fakeAuth});
  const url='https://example.supabase.co/functions/v1/cwl/api/cwl/auth/session';
  assert.equal((await edge(new Request(url))).status,401);
  assert.equal((await edge(new Request(url,{headers:{'X-CWL-Proxy-Key':env.CWL_BACKEND_KEY,'X-CWL-Public-Origin':'https://evil.invalid'}}))).status,403);
  const ok=await edge(new Request(url,{headers:{'X-CWL-Proxy-Key':env.CWL_BACKEND_KEY,'X-CWL-Public-Origin':app}}));
  assert.deepEqual(await ok.json(),{authenticated:false});
});
test('Worker bridge streams requests, strips forged authorization and rate-limits before contacting the function',async()=>{
  let calls=0;
  const options={CWL_BACKEND_URL:'https://example.supabase.co/functions/v1/cwl',CWL_BACKEND_KEY:env.CWL_BACKEND_KEY,CWL_LOGIN_LIMITER:{limit:async()=>({success:true})}};
  const response=await bridgeCwl(new Request(app+'/api/cwl/auth/login',{method:'POST',headers:{Origin:app,Authorization:'Bearer forged','X-CWL-Proxy-Key':'forged','Content-Type':'application/json'},body:'{}'}),options,async(url,init)=>{
    calls++;assert.equal(url,'https://example.supabase.co/functions/v1/cwl/api/cwl/auth/login');
    assert.equal(init.headers.get('Authorization'),null);assert.equal(init.headers.get('X-CWL-Proxy-Key'),env.CWL_BACKEND_KEY);
    assert.equal(await new Response(init.body).text(),'{}');return Response.json({ok:true});
  });assert.equal(response.status,200);assert.equal(calls,1);
  options.CWL_LOGIN_LIMITER.limit=async()=>({success:false});
  await assert.rejects(bridgeCwl(request('login',{method:'POST'}),options,async()=>{throw Error('Must not fetch');}),e=>e.status===429);
});
test('public source proxy accepts only the fixed Clash routes and never arbitrary URLs or redirects',async()=>{
  const good='https://api.clashk.ing/v2/clan/%232G8QCR92V/wars?limit=35&type=cwl';assert.equal(sourceUrl(good),good);
  for(const url of ['http://127.0.0.1/','https://api.clashk.ing.evil.invalid/v2/clan/%232G8QCR92V/wars?limit=35&type=cwl',
    'https://api.clashk.ing/v2/clan/%232G8QCR92V/wars?limit=999&type=cwl','https://user:secret@api.clashk.ing/v2/clan/%232G8QCR92V/wars?limit=35&type=cwl'])assert.throws(()=>sourceUrl(url));
  const response=await sourceProxy(new Request(app+'/api/cwl/source?url='+encodeURIComponent(good)),async(_,opts)=>{assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,undefined);return Response.json({items:[]});});
  assert.deepEqual(await response.json(),{items:[]});
  await assert.rejects(sourceProxy(new Request(app+'/api/cwl/source?url='+encodeURIComponent(good)),async()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}})),e=>e.status===502);
});
test('remote Postgres verifies its certificate and URL flags cannot disable TLS',()=>{
  for(const flag of ['disable','require','prefer']){
    const {connection,options}=databaseOptions({DB_URL:'postgres://user:dummy@db.example.supabase.co/postgres?sslmode='+flag});
    assert(!connection.includes('sslmode'));assert.equal(options.ssl.rejectUnauthorized,true);assert.match(options.ssl.ca,/BEGIN CERTIFICATE/);
  }
  assert.equal(databaseOptions({DATABASE_URL:'postgres://user:dummy@127.0.0.1:55432/local'}).options.ssl,undefined);
  const pool=databaseOptions({DATABASE_URL:'postgres://user:dummy@aws-0-example.pooler.supabase.com:6543/postgres'}).options;
  assert.equal(pool.prepare,false);assert.equal(pool.max_pipeline,1);assert.equal(pool.ssl.rejectUnauthorized,true);
  assert.match(pool.ssl.ca,/BEGIN CERTIFICATE/);
});
test('production refuses an unconfigured bridge instead of falling back to public server-side generation',async()=>{
  let called=false;const worker=createWorker(async()=>{called=true;return Response.json({});});
  const result=await worker.fetch(new Request(app+'/api/cwl/health'),{CWL_REQUIRE_BRIDGE:'true'},{});
  assert.equal(result.status,503);assert.equal((await result.json()).code,'cwl_backend_not_configured');assert.equal(called,false);
});
test('large archive operations are serialized per function instance before decompression',async()=>{
  let release,entered;const ready=new Promise(r=>{entered=r;});
  const handler=createCwlHandler({browserPlans:true,authorize:async()=>({id:leader,role:'leader'}),database:async()=>{entered();await new Promise(r=>{release=r;});return Response.json({ok:true});}});
  const make=()=>new Request(app+`/api/cwl/clans/${clan}/wars/20261024T100000.000Z/plan/initialize`,{method:'POST',headers:{'Content-Type':'application/gzip'},body:'not-yet-read'});
  const first=handler(make(),{});await ready;
  try{await assert.rejects(handler(make(),{}),e=>e.status===429&&e.code==='cwl_busy');}finally{release();await first;}
});
