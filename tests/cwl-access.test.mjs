import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectDatabase } from '../src/cwl/database.js';
import { migrate } from '../scripts/migrate-cwl.mjs';
import { createAccessStore,memberships } from '../src/cwl/access.js';
import { createUsersHandler } from '../src/cwl/users.js';
import { createCwlAuth } from '../src/cwl/auth.js';
import { sealSession } from '../src/cwl/session-crypto.js';
const url=new URL(process.env.CWL_TEST_DATABASE_URL||process.env.DATABASE_URL);
if(!process.env.CWL_TEST_DATABASE_URL)url.pathname='/coc_cwl_test';
assert(url.pathname.endsWith('_test'));
assert(process.env.CWL_TEST_DATABASE_URL||['localhost','127.0.0.1','[::1]'].includes(url.hostname));
const ids={leader:'10000000-0000-4000-8000-000000000001',co:'10000000-0000-4000-8000-000000000002',other:'10000000-0000-4000-8000-000000000003'};
const tag='2G8QCR92V',second='2CQ9CR2YP',app='https://app.example.workers.dev';
const env={DATABASE_URL:url.href,CWL_ACCESS_DB:'true',CWL_PUBLIC_ORIGIN:app,SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test-key',CWL_AUTH_ADMIN_KEY:'server-only-test-key-'.padEnd(64,'x'),CWL_BACKEND_KEY:'test-bridge-key-'.padEnd(64,'x')};
let sql,store,handler,providerCalls,failCreate;
before(async()=>{
 if(!process.env.CWL_TEST_DATABASE_URL){const control=connectDatabase(process.env);if(!(await control`select 1 from pg_database where datname='coc_cwl_test'`).length)await control.unsafe('CREATE DATABASE coc_cwl_test');await control.end();}
 sql=connectDatabase(env);await migrate(sql);await sql.unsafe(fs.readFileSync(new URL('../db/security/cwl-runtime.sql',import.meta.url),'utf8'));
});
beforeEach(async()=>{
 await sql.unsafe('TRUNCATE cwl.access_events,cwl.memberships,cwl.accounts');
 for(const [name,id]of Object.entries(ids))await sql`insert into cwl.accounts(user_id,email) values(${id},${name+'@test.invalid'})`;
 await sql`insert into cwl.memberships(user_id,clan_tag,role) values(${ids.leader},${tag},'leader'),(${ids.leader},${second},'leader'),(${ids.co},${tag},'coLeader'),(${ids.other},'2998YJPU2','leader')`;
 store=createAccessStore((e,fn)=>fn(sql));providerCalls=[];failCreate=false;
 const fetcher=async(url,options)=>{providerCalls.push({url,options});if(failCreate&&options.method==='POST')return Response.json({error:'duplicate'},{status:422});return Response.json(options.method==='POST'?{id:JSON.parse(options.body).id}:{});};
 const auth={authorize:async request=>({id:request.headers.get('X-Test-Actor')||ids.leader,role:request.headers.get('X-Test-Role')||'leader'})};
 handler=createUsersHandler(auth,{store,fetcher});
});
after(async()=>sql?.end());
const request=(path='',body,headers={})=>new Request(app+'/api/cwl/users'+path,{method:body?'POST':'GET',headers:{Origin:app,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
test('leader creates a co-leader, grants the existing account another clan without changing its password, then removes only one membership',async()=>{
 const payload={clanTag:tag,email:'NEW@test.invalid',password:'temporary-test-password'};
 assert.equal((await handler(request('',payload),env)).status,201);
 assert.equal(providerCalls.length,1);const newId=(await sql`select user_id from cwl.accounts where email='new@test.invalid'`)[0].user_id;
 assert.equal((await handler(request('',{...payload,clanTag:second}),env)).status,201);assert.equal(providerCalls.length,1);
 await handler(request('/remove',{clanTag:tag,userId:newId}),env);
 const remaining=await memberships(env,newId,(e,fn)=>fn(sql));assert.deepEqual(remaining.map(r=>r.clan_tag),[second]);
 const events=await sql`select action from cwl.access_events where user_id=${newId} order by created_at`;assert.deepEqual(events.map(x=>x.action),['grant','grant','revoke']);
});
test('co-leaders, foreign leaders, forged roles and cross-origin writes cannot administer access',async()=>{
 const payload={clanTag:tag,email:'new@test.invalid',password:'temporary-test-password'};
 await assert.rejects(handler(request('',payload,{'X-Test-Role':'coLeader','X-Test-Actor':ids.co}),env),e=>e.status===403);
 await assert.rejects(handler(request('',payload,{'X-Test-Actor':ids.other}),env),e=>e.status===403);
 await assert.rejects(handler(request('',{...payload,role:'leader'}),env),e=>e.status===400);
 await assert.rejects(handler(request('',payload,{Origin:'https://evil.invalid'}),env),e=>e.status===403);
 assert.equal(providerCalls.length,0);
});
test('leader deletion and self-removal are protected, including by RLS in the runtime role',async()=>{
 await assert.rejects(handler(request('/remove',{clanTag:tag,userId:ids.leader}),env),e=>e.code==='protected_leader');
 await sql.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE cwl_runtime');assert.equal((await tx`delete from cwl.memberships where user_id=${ids.leader} returning user_id`).length,0);});
 await assert.rejects(sql.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE cwl_runtime');await tx`insert into cwl.memberships(user_id,clan_tag,role) values(${ids.co},${second},'leader')`;}),e=>e.code==='42501');
});
test('real restricted runtime grants and revokes co-leaders without schema or leadership privileges',async()=>{
 const runtime=createAccessStore(async(e,fn)=>fn({begin:fn2=>sql.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE cwl_runtime');return fn2(tx);})}));
 const id='10000000-0000-4000-8000-000000000004';
 await runtime.grant(env,ids.leader,tag,'runtime@test.invalid',async()=>id);
 assert((await runtime.list(env,ids.leader,tag)).some(r=>r.id===id));
 await runtime.remove(env,ids.leader,tag,id);
 assert(!(await runtime.list(env,ids.leader,tag)).some(r=>r.id===id));
});
test('revocation invalidates existing app authorization even if legacy allowlist still includes the user',async()=>{
 const auth=createCwlAuth(async()=>Response.json({id:ids.co}),{membershipReader:(e,id)=>memberships(e,id,(e,fn)=>fn(sql))});
 const cookie='__Host-cwl-access='+await sealSession('valid-token',env.CWL_BACKEND_KEY,'cookie:'+app+':0');
 const req=new Request(app+'/api/cwl/anything',{headers:{Cookie:cookie}});
 const configured={...env,CWL_EDITORS:JSON.stringify({[ids.co]:{role:'leader',clanTag:tag}})};
 assert.equal((await auth.authorize(req,configured,tag)).role,'coLeader');
 await store.remove(env,ids.leader,tag,ids.co);
 await assert.rejects(auth.authorize(req,configured,tag),e=>e.status===403);
  await store.grant(env,ids.leader,tag,'co@test.invalid',async()=>{throw new Error('Existing account must not be recreated');});
  assert.equal((await auth.authorize(req,configured,tag)).role,'coLeader');
});
test('provider failure creates no membership; rollback deletes only the newly provisioned identity',async()=>{
 failCreate=true;
 await assert.rejects(handler(request('',{clanTag:tag,email:'fail@test.invalid',password:'temporary-test-password'}),env));
 assert.equal((await sql`select * from cwl.accounts where email='fail@test.invalid'`).length,0);
 assert(providerCalls.every(c=>!c.options.headers.Authorization.includes('valid-token')));
 const broken=createUsersHandler({authorize:async()=>({id:ids.leader,role:'leader'})},{store:{grant:async(e,a,t,email,create)=>{await create();throw new Error('commit failed');}},fetcher:async(url,options)=>{providerCalls.push({url,options});return Response.json(options.method==='POST'?{id:JSON.parse(options.body).id}:{});}});
 await assert.rejects(broken(request('',{clanTag:tag,email:'rollback@test.invalid',password:'temporary-test-password'}),env));
 assert.equal(providerCalls.at(-1).options.method,'DELETE');
});
