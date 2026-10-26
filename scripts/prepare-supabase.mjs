// Administrative setup only. Never print connection strings or generated passwords.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { connectDatabase, withDatabase } from '../src/cwl/database.js';
import { migrate } from './migrate-cwl.mjs';

const apply = process.argv.includes('--apply');
const output = new URL('../.env.supabase', import.meta.url);
let sql;
try {
  if (!process.env.DB_URL) throw new Error('DB_URL is required in the administrative environment file.');
  const url = new URL(process.env.DB_URL);
  if (!/(?:\.supabase\.co|\.pooler\.supabase\.com)$/.test(url.hostname)) throw new Error('This command is restricted to a Supabase host.');
  sql = connectDatabase({ DB_URL: url.href });
  const [tls] = await sql`select ssl,version as protocol from pg_stat_ssl where pid=pg_backend_pid()`;
  if (!tls?.ssl) throw new Error('Verified TLS is required.');
  if (!apply) {
    const [state] = await sql`select to_regclass('cwl.plans') is not null as migrated`;
    console.log(JSON.stringify({connected:true,certificateVerified:true,tls:tls.protocol,...state,mode:'inspection'}));
  } else {
    const existingSecret = fs.existsSync(output) ? fs.readFileSync(output,'utf8') : '';
    const [existingRole] = await sql`select rolcanlogin from pg_roles where rolname='cwl_runtime'`;
    if (existingRole?.rolcanlogin && !existingSecret) throw new Error('A configured runtime role already exists; refusing to rotate its password automatically.');
    await migrate(sql);
    const password = crypto.randomBytes(32).toString('hex');
    await sql.begin(async tx => {
      await tx.unsafe(fs.readFileSync(new URL('../db/security/cwl-runtime.sql',import.meta.url),'utf8'));
      if (!existingSecret) await tx.unsafe(`ALTER ROLE cwl_runtime LOGIN PASSWORD '${password}'`);
    });
    if (!existingSecret) {
      const suffix = url.username.includes('.') ? url.username.slice(url.username.indexOf('.')) : '';
      url.username = 'cwl_runtime' + suffix; url.password = password;
      url.searchParams.delete('sslmode'); url.searchParams.delete('ssl');
      fs.writeFileSync(output,`DATABASE_URL=${url.href}\nCWL_REQUIRE_RESTRICTED_DB=true\n`,{flag:'wx',mode:0o600});
    }
    const runtime = Object.fromEntries(fs.readFileSync(output,'utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
    if(process.env.DB_POOLER_URL){
      const pool=new URL(process.env.DB_POOLER_URL),current=new URL(runtime.DATABASE_URL);
      if(!pool.hostname.endsWith('.pooler.supabase.com')||!['5432','6543'].includes(pool.port)||!pool.username.includes('.'))throw new Error('A valid Supabase pooler URL is required.');
      const project=url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]||url.username.split('.').at(-1);
      if(pool.username.slice(pool.username.indexOf('.')+1)!==project)throw new Error('The pooler must belong to the same Supabase project.');
      pool.username='cwl_runtime'+pool.username.slice(pool.username.indexOf('.'));pool.password=current.password;
      pool.searchParams.delete('sslmode');pool.searchParams.delete('ssl');runtime.DATABASE_URL=pool.href;
    }
    const result = await withDatabase(runtime,async db=>{
      const [row] = await db`select current_user='cwl_runtime' as dedicated_role,
        has_schema_privilege(current_user,'cwl','USAGE') as schema_access,
        has_table_privilege(current_user,'cwl.plans','DELETE') as can_delete,
        has_table_privilege(current_user,'cwl.plans','TRUNCATE') as can_truncate`;
      const versions = await db`select version from cwl.migrations order by version`;
      return {...row,migrations:versions.map(v=>v.version)};
    });
    if (!result.dedicated_role || result.can_delete || result.can_truncate) throw new Error('Runtime privilege verification failed.');
    if(process.env.DB_POOLER_URL){fs.writeFileSync(output,Object.entries(runtime).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});fs.chmodSync(output,0o600);}
    console.log(JSON.stringify({prepared:true,certificateVerified:true,tls:tls.protocol,...result,secretFile:'.env.supabase'}));
  }
} catch (error) {
  // Database errors can contain SQL and credentials; only expose their stable code.
  console.error(JSON.stringify({prepared:false,code:error.code||'setup_failed',...(error.constructor===Error?{message:error.message}:{})}));
  process.exitCode=1;
} finally { await sql?.end({timeout:3}); }
