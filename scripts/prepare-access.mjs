// One-time ACL migration. Run with the administrative DB_URL, not runtime credentials.
import fs from 'node:fs';
import { connectDatabase } from '../src/cwl/database.js';
import { migrate } from './migrate-cwl.mjs';
const sql=connectDatabase({DB_URL:process.env.DB_URL});
try{
  await migrate(sql);
  const source=fs.readFileSync(new URL('../.env.supabase',import.meta.url),'utf8');
  const editors=JSON.parse(source.split('\n').find(l=>l.startsWith('CWL_EDITORS=')).slice(12));
  const result=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(937125412)`;
    const [seeded]=await tx`select version from cwl.migrations where version='access_seed_v1'`;
    let skipped=0;
    if(!seeded){
      for(const [id,entry]of Object.entries(editors)){
        const [user]=await tx`select id,email from auth.users where id=${id} and deleted_at is null`;
        if(!user?.email){skipped++;continue;}
        await tx`insert into cwl.accounts(user_id,email) values(${id},${user.email.toLowerCase()}) on conflict do nothing`;
        for(const tag of new Set([entry.clanTag,...(entry.clanTags||[])])){
          await tx`insert into cwl.memberships(user_id,clan_tag,role) values(${id},${tag},${entry.role}) on conflict do nothing`;
        }
      }
      const required=new Set(Object.values(editors).filter(e=>e.role==='leader').flatMap(e=>[e.clanTag,...(e.clanTags||[])]));
      for(const tag of required){
        const [leader]=await tx`select user_id from cwl.memberships where clan_tag=${tag} and role='leader' limit 1`;
        if(!leader)throw new Error('No active leader for a configured clan; migration was rolled back.');
      }
      await tx`insert into cwl.migrations(version) values('access_seed_v1')`;
    }
    await tx.unsafe(fs.readFileSync(new URL('../db/security/cwl-runtime.sql',import.meta.url),'utf8'));
    const [counts]=await tx`select count(*)::int as memberships,count(distinct clan_tag)::int as clans from cwl.memberships`;
    return {...counts,seeded:!seeded,skippedDeletedAccounts:skipped};
  });
  console.log(JSON.stringify({ok:true,...result}));
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'access_migration_failed'}));process.exitCode=1;}
finally{await sql.end({timeout:5});}
