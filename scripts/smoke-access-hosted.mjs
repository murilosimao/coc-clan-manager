// Explicit hosted integration check. Creates two temporary identities, then removes them.
// No credentials, emails, UUIDs or provider response bodies are printed.
import assert from 'node:assert/strict';
import { connectDatabase } from '../src/cwl/database.js';
const app='https://coc-clan-manager.mbks.workers.dev',primary='2G8QCR92V',secondary='2CQ9CR2YP';
if(!process.argv.includes('--apply'))throw new Error('Use --apply only for the authorized hosted integration check.');
const ref=new URL(process.env.DB_URL).hostname.split('.')[1],base=`https://${ref}.supabase.co`;
const sql=connectDatabase({DB_URL:process.env.DB_URL});
const actor=crypto.randomUUID(),email=`cwl-smoke-${actor}@example.com`,childEmail=`cwl-smoke-child-${actor}@example.com`;
const password=crypto.randomUUID()+crypto.randomUUID();
let adminKey,anonKey,stage='credentials',ok=false;
async function admin(path,method='POST',body){
 const r=await fetch(base+'/auth/v1/admin/users'+path,{method,headers:{apikey:adminKey,Authorization:'Bearer '+adminKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert(r.ok||method==='DELETE'&&r.status===404,'Provider operation failed');
 await r.body?.cancel();
}
async function api(path,{cookie,body}={}){
 const r=await fetch(app+path,{method:body?'POST':'GET',headers:{Origin:app,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json();
 return {status:r.status,data,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
try{
 const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN}});
 assert(keysResponse.ok,'Management access required');const keys=await keysResponse.json();
 adminKey=keys.find(k=>k.name==='service_role')?.api_key;anonKey=keys.find(k=>k.name==='anon')?.api_key;assert(adminKey&&anonKey);
 stage='temporary-leader';await admin('','POST',{id:actor,email,password,email_confirm:true});
 await sql.begin(async tx=>{await tx`insert into cwl.accounts(user_id,email) values(${actor},${email})`;for(const tag of [primary,secondary])await tx`insert into cwl.memberships(user_id,clan_tag,role) values(${actor},${tag},'leader')`;});
 stage='leader-login';const leader=await api('/api/cwl/auth/login',{body:{email,password}});assert.equal(leader.status,200);assert(leader.data.editor.leaderClanTags.includes(secondary));
 stage='create-co-leader';assert.equal((await api('/api/cwl/users',{cookie:leader.cookie,body:{clanTag:primary,email:childEmail,password}})).status,201);
 stage='co-leader-login';const child=await api('/api/cwl/auth/login',{body:{email:childEmail,password}});assert.equal(child.status,200);assert.equal(child.data.editor.role,'coLeader');
 stage='co-leader-denial';assert.equal((await api('/api/cwl/users?clan='+primary,{cookie:child.cookie})).status,403);
 stage='second-clan-grant';assert.equal((await api('/api/cwl/users',{cookie:leader.cookie,body:{clanTag:secondary,email:childEmail,password}})).status,201);
 // Ensure the original password was preserved when granting the existing identity.
 const unchanged=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:childEmail,password})});assert(unchanged.ok);await unchanged.body?.cancel();
 stage='revoke-primary';const [account]=await sql`select user_id from cwl.accounts where email=${childEmail}`;
 assert.equal((await api('/api/cwl/users/remove',{cookie:leader.cookie,body:{clanTag:primary,userId:account.user_id}})).status,200);
 stage='existing-session-revocation';const session=await api('/api/cwl/auth/session',{cookie:child.cookie});assert.equal(session.status,200);assert(!session.data.editor.clanTags.includes(primary));assert(session.data.editor.clanTags.includes(secondary));
 const denied=await api('/api/cwl/clans/'+primary+'/seasons/2026-10/dataset',{cookie:child.cookie});assert.equal(denied.status,403);
 console.log(JSON.stringify({ok:true,leaderLogin:true,createUser:true,coLeaderDenied:true,secondClanGrant:true,passwordPreserved:true,revokedSessionBlocked:true}));ok=true;
}catch(error){console.error(JSON.stringify({ok:false,stage,code:error.code||'hosted_access_check_failed'}));process.exitCode=1;}
finally{
 try{
   const temporary=await sql`select id from auth.users where email in (${email},${childEmail})`;
   for(const user of temporary)if(adminKey)await admin('/'+user.id,'DELETE');
   await sql.begin(async tx=>{
     for(const user of temporary){await tx`delete from cwl.memberships where user_id=${user.id}`;await tx`delete from cwl.accounts where user_id=${user.id}`;}
   });
   console.log(JSON.stringify({temporaryAccountsCleaned:true,count:temporary.length}));
 }catch{console.error(JSON.stringify({temporaryAccountsCleaned:false}));process.exitCode=1;}
 await sql.end({timeout:5});
}
