// Run with the restricted runtime environment, never the migration credential.
import fs from 'node:fs';
import { withDatabase } from '../src/cwl/database.js';
const outIndex=process.argv.indexOf('--out'),output=outIndex<0?null:process.argv[outIndex+1];
try{
 const result=await withDatabase({...process.env,CWL_REQUIRE_RESTRICTED_DB:'true'},async sql=>{
  const [tls]=await sql`select ssl,version as protocol from pg_stat_ssl where pid=pg_backend_pid()`;
  const [tables]=await sql`select count(*)::int as total,count(*) filter(where c.relrowsecurity)::int as with_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cwl' and c.relkind='r'`;
  const access=await sql`select r.rolname as role,count(*) filter(where has_schema_privilege(r.oid,'cwl','USAGE') or has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE'))::int as reachable_tables
    from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
    where r.rolname in ('anon','authenticated','service_role') and n.nspname='cwl' and c.relkind='r' group by r.rolname order by r.rolname`;
  const [permissions]=await sql`select has_schema_privilege(current_user,'cwl','CREATE') as schema_create,
    has_column_privilege(current_user,'cwl.plans','score_snapshot','UPDATE') as change_score_snapshot,
    has_table_privilege(current_user,'cwl.plan_archives','DELETE') as delete_archive,
    has_table_privilege(current_user,'cwl.attacks','TRUNCATE') as truncate_attacks,
    (select count(*)::int from pg_auth_members where member=(select oid from pg_roles where rolname=current_user)) as memberships`;
  const [role]=await sql`select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user`;
  const denied=[];
  for(const query of ["UPDATE cwl.plans SET score_snapshot=score_snapshot WHERE false","DELETE FROM cwl.revisions WHERE false"]){
    try{await sql.unsafe(query);denied.push(false);}catch(error){if(error.code!=='42501')throw error;denied.push(true);}
  }
  return {tls,tables,publicRoles:access,runtimeRole:role,permissions,protectedWriteProbesDenied:denied.every(Boolean)};
 });
 const ok=result.tls.ssl&&result.tables.total===result.tables.with_rls&&result.publicRoles.every(r=>r.reachable_tables===0)
   &&Object.values(result.runtimeRole).every(v=>v===false)&&Object.values(result.permissions).every(v=>v===false||v===0)&&result.protectedWriteProbesDenied;
 const report={ok,checkedAt:new Date().toISOString(),certificateVerified:true,...result};
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!ok)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'security_check_failed'}));process.exitCode=1;}
