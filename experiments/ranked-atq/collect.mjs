// Read-only public API collection. Keys are loaded locally and never saved in artifacts.
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase } from '../../src/cwl/database.js';
process.loadEnvFile('/private/tmp/clash/.env');
const out=path.resolve(process.argv[2]||'../output/atq-ranked-2026-10-28');
fs.mkdirSync(out+'/sources',{recursive:true});
const clans=['2G8QCR92V','2CQ9CR2YP'], clean=t=>String(t||'').replace(/^#/,'');
let source='direct', requests=0;
async function get(route,file) {
  const full=out+'/sources/'+file;
  if(fs.existsSync(full)) { const old=JSON.parse(fs.readFileSync(full));if(old.data)return old.data; }
  let status=0;
  for(let attempt=0;attempt<3;attempt++) {
    const origin=source==='direct'?'https://api.clashofclans.com':'https://cocproxy.royaleapi.dev';
    const key=source==='direct'?process.env.COC_API_KEY:process.env.COC_WORKER_API_KEY;
    try {
      requests++;
      const r=await fetch(origin+route,{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
      status=r.status;
      if(r.status===403&&source==='direct'){source='proxy';continue;}
      if(r.status===429||r.status>=500)continue;
      const data=r.ok?await r.json():null;
      fs.writeFileSync(full,JSON.stringify({route,origin,status:r.status,fetchedAt:new Date().toISOString(),...(data?{data}:{})}));
      return data;
    }catch{ /* Only fixed status is persisted, never exception URLs or headers. */ }
  }
  fs.writeFileSync(full,JSON.stringify({route,status,fetchedAt:new Date().toISOString()}));return null;
}
async function pool(items,fn,n=5){let cursor=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(cursor<items.length)await fn(items[cursor++]);}));}
const memberTags=new Set();
for(const clan of clans){const data=await get('/v1/clans/%23'+clan,'clan-'+clan+'.json');for(const p of data?.memberList||[])memberTags.add(clean(p.tag));}
console.log(JSON.stringify({stage:'members',players:memberTags.size}));
let done=0;
await pool([...memberTags],async tag=>{
  const p=await get('/v1/players/%23'+tag,'profile-'+tag+'.json');
  await get('/v1/players/%23'+tag+'/leaguehistory','leaguehistory-'+tag+'.json');
  if(p?.previousLeagueGroupTag&&p?.previousLeagueSeasonId) await get('/v1/leaguegroup/'+encodeURIComponent(p.previousLeagueGroupTag)+'/'+p.previousLeagueSeasonId+'?playerTag=%23'+tag,'group-'+tag+'-'+p.previousLeagueSeasonId+'.json');
  if(++done%10===0)console.log(JSON.stringify({stage:'players',done,total:memberTags.size,requests}));
});
await get('/v1/leaguetiers','leaguetiers.json');
// Existing app archives are read, never modified.
const sql=connectDatabase({DATABASE_URL:process.env.DB_POOLER_URL||process.env.DB_URL,DATABASE_CA_CERT:process.env.DATABASE_CA_CERT});
try {
  const wars=await sql.begin('read only',tx=>tx`select payload,source,final,observed_at from cwl.war_archive where final order by end_time`);
  fs.writeFileSync(out+'/sources/own-archive.json',JSON.stringify({fetchedAt:new Date().toISOString(),data:wars}));
}finally{await sql.end({timeout:2});}
// ClashKing remains the source of older full CWL history used by the existing evaluator.
for(const clan of clans)for(const type of ['random','cwl']){
  const file=out+'/sources/'+clan+'-'+type+'.json';
  if(fs.existsSync(file))continue;
  try{const r=await fetch('https://api.clashk.ing/v2/clan/%23'+clan+'/wars?limit=60&type='+type,{signal:AbortSignal.timeout(20000)});fs.writeFileSync(file,JSON.stringify({type,ok:r.ok,fetchedAt:new Date().toISOString(),data:r.ok?await r.json():null}));}catch{fs.writeFileSync(file,JSON.stringify({type,ok:false}));}
}
const opponents=new Set();
for(const file of fs.readdirSync(out+'/sources').filter(f=>f.startsWith('group-'))){const g=JSON.parse(fs.readFileSync(out+'/sources/'+file)).data;for(const a of g?.attackLogs||[])opponents.add(clean(a.opponentPlayerTag));}
const missing=[...opponents].filter(t=>!fs.existsSync(out+'/sources/profile-'+t+'.json'));
console.log(JSON.stringify({stage:'opponents',unique:opponents.size,missing:missing.length}));
done=0;
await pool(missing,async tag=>{await get('/v1/players/%23'+tag,'profile-'+tag+'.json');if(++done%100===0)console.log(JSON.stringify({stage:'opponents',done,total:missing.length}));},5);
fs.writeFileSync(out+'/collection.json',JSON.stringify({createdAt:new Date().toISOString(),clans,players:memberTags.size,opponents:opponents.size,requests,source},null,2));
console.log(JSON.stringify({stage:'complete',players:memberTags.size,opponents:opponents.size,requests}));
