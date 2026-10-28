import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clientKey } from '../src/cwl/rate-limit.js';
import { createWorker } from '../src/worker.js';
import { createCwlAuth } from '../src/cwl/auth.js';
import { sealSession } from '../src/cwl/session-crypto.js';

const app='https://coc-clan-manager.example.workers.dev';
const ip=value=>new Request(app+'/api/health',{headers:value?{'CF-Connecting-IP':value}:{}});

test('rate-limit keys group an IPv6 /64 and keep IPv4 clients separate',()=>{
  assert.equal(clientKey(ip('203.0.113.7')),'203.0.113.7');
  assert.equal(clientKey(ip('2001:db8:abcd:12::1')),'2001:db8:abcd:12::/64');
  assert.equal(clientKey(ip('2001:0db8:abcd:0012:ffff:1:2:3')),'2001:db8:abcd:12::/64');
  assert.equal(clientKey(ip('2001:db8::1')),'2001:db8:0:0::/64');
  assert.notEqual(clientKey(ip('2001:db8:abcd:12::1')),clientKey(ip('2001:db8:abcd:13::1')));
  assert.equal(clientKey(ip('::ffff:198.51.100.4')),'198.51.100.4');
  assert.equal(clientKey(ip('')),'unknown');
});

test('CORS accepts the HTTPS Pages origin but not the plaintext one',async()=>{
  const worker=createWorker();
  const https=await worker.fetch(new Request(app+'/api/health',{headers:{Origin:'https://coc-purosangue.duckdns.org'}}),{},{});
  assert.equal(https.status,200);assert.equal(https.headers.get('Access-Control-Allow-Origin'),'https://coc-purosangue.duckdns.org');
  const plain=await worker.fetch(new Request(app+'/api/health',{headers:{Origin:'http://coc-purosangue.duckdns.org'}}),{},{});
  assert.equal(plain.status,403);assert.equal(plain.headers.get('Access-Control-Allow-Origin'),null);
});

test('Worker rate-limits CWL backend and public routes with separate per-client budgets',async()=>{
  const keys={cwl:[],public:[]};let allow=true,handled=0;
  const env={
    CWL_API_LIMITER:{limit:async({key})=>{keys.cwl.push(key);return {success:allow};}},
    PUBLIC_API_LIMITER:{limit:async({key})=>{keys.public.push(key);return {success:allow};}},
  };
  const worker=createWorker(async()=>{handled++;return Response.json({ok:true});});
  const headers={'CF-Connecting-IP':'2001:db8:abcd:12::99',Origin:'https://coc-purosangue.duckdns.org'};
  assert.equal((await worker.fetch(new Request(app+'/api/cwl/health',{headers}),env,{})).status,200);
  assert.equal((await worker.fetch(new Request(app+'/api/health',{headers}),env,{})).status,200);
  assert.deepEqual(keys,{cwl:['2001:db8:abcd:12::/64'],public:['2001:db8:abcd:12::/64']});
  allow=false;
  const limited=await worker.fetch(new Request(app+'/api/cwl/health',{headers}),env,{});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'),'https://coc-purosangue.duckdns.org');
  assert.equal((await limited.json()).code,'rate_limited');assert.equal(handled,1);
  const source=await worker.fetch(new Request(app+'/api/cwl/source?url=x',{headers}),env,{});
  assert.equal(source.status,429);assert.equal(keys.public.length,2);
  const outage={PUBLIC_API_LIMITER:{limit:async()=>{throw new Error('limiter unavailable');}}};
  assert.equal((await worker.fetch(new Request(app+'/api/health'),outage,{})).status,200);
});

test('published configuration keeps the limiters and a script policy without inline code',()=>{
  const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  const limits=Object.fromEntries(config.ratelimits.map(r=>[r.name,r]));
  for(const name of ['CWL_LOGIN_LIMITER','CWL_API_LIMITER','PUBLIC_API_LIMITER'])assert(limits[name],name);
  assert.equal(new Set(config.ratelimits.map(r=>r.namespace_id)).size,config.ratelimits.length);
  const header=fs.readFileSync('public/_headers','utf8').match(/Content-Security-Policy: (.+)/)[1];
  const meta=fs.readFileSync('public/index.html','utf8').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for(const policy of [header,meta]){
    const script=policy.split(';').map(s=>s.trim()).find(s=>s.startsWith('script-src'));
    assert.equal(script,"script-src 'self'");assert.match(policy,/object-src 'none'/);assert.match(policy,/base-uri 'self'/);
  }
  assert.match(meta,/connect-src 'self' https:\/\/coc-clan-manager\.mbks\.workers\.dev/);
  const html=fs.readFileSync('public/index.html','utf8');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html),'inline <script> would be blocked');
  assert(!/\son[a-z]+=["']/.test(html),'inline event handlers would be blocked');
});

test('a new password needs at least 12 characters before Auth is contacted',async()=>{
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test-public-key',CWL_PUBLIC_ORIGIN:app,CWL_EDITORS:'{}',CWL_BACKEND_KEY:'test-only-bridge-key-'.padEnd(64,'x')};
  let calls=0;const auth=createCwlAuth(async()=>{calls++;throw new Error('Must not contact Auth');});
  const cookie='__Host-cwl-access='+await sealSession('leader-token',env.CWL_BACKEND_KEY,'cookie:'+app+':0');
  const response=auth.handle(new Request(app+'/api/cwl/auth/password',{method:'POST',headers:{Origin:app,'Content-Type':'application/json',Cookie:cookie},
    body:JSON.stringify({currentPassword:'old-password',newPassword:'elevenchars'})}),env);
  await assert.rejects(response,e=>e.status===400&&/12 caracteres/.test(e.message));assert.equal(calls,0);
});
