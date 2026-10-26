import postgres from 'postgres';
import { CwlError } from './errors.js';
import { SUPABASE_CA } from './supabase-ca.js';

export function databaseOptions(env) {
  const connection = env.HYPERDRIVE?.connectionString || env.DATABASE_URL || env.DB_URL;
  if (!connection) throw new CwlError(503, 'Banco de dados da CWL não configurado.', 'database_not_configured');
  let url;
  try { url = new URL(connection); } catch { throw new CwlError(503, 'Configuração do banco inválida.', 'database_not_configured'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const options = { max: 1, connect_timeout: 10, idle_timeout: 5, max_lifetime: 60,
    onnotice: () => {}, connection: { application_name: 'coc-cwl', statement_timeout: 30000, lock_timeout: 30000 } };
  if (!env.HYPERDRIVE && !local) {
    // Encryption alone (sslmode=require) does not verify the server certificate.
    url.searchParams.delete('sslmode'); url.searchParams.delete('ssl');
    const supabase = /(?:\.supabase\.co|\.pooler\.supabase\.com)$/.test(url.hostname);
    options.ssl = { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT || supabase ? { ca: env.DATABASE_CA_CERT || SUPABASE_CA } : {}) };
    if(url.port==='6543'&&/(?:\.supabase\.co|\.pooler\.supabase\.com)$/.test(url.hostname)){
      options.prepare=false;options.max_pipeline=1;
      // Supavisor transaction mode cannot preserve session-level settings.
      options.connection={application_name:'coc-cwl'};
    }
  }
  return { connection: url.href, options };
}

export function connectDatabase(env) {
  const { connection, options } = databaseOptions(env);
  // Direct/Hyperdrive use prepared statements; Supavisor transaction mode does not.
  return postgres(connection, options);
}

export async function withDatabase(env, fn) {
  const sql = connectDatabase(env);
  try {
    if (env.CWL_REQUIRE_RESTRICTED_DB === 'true') {
      const [role] = await sql`select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls as privileged from pg_roles where rolname=current_user`;
      if (!role || role.privileged) throw new CwlError(503, 'A aplicação exige uma conta restrita do banco.', 'database_role_not_restricted');
    }
    return await fn(sql);
  }
  finally { await sql.end({ timeout: 5 }); }
}

export async function lockRound(sql, tag, start) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${tag + '|' + start}, 0))`;
}

export async function loadPlan(sql, tag, start, snapshots = false) {
  const [row] = await sql`select p.id,p.round_id,p.current_revision,p.retrospective,p.initial_plan,p.config,p.planner_version,p.created_at,
    case when ${snapshots} then p.score_snapshot else jsonb_build_object('version',p.score_snapshot->'version') end as score_snapshot,
    case when ${snapshots} then p.source_snapshot else '{}'::jsonb end as source_snapshot,
    r.clan_tag, r.start_time, r.season, r.opponent_tag,
    r.war_state, r.end_at, r.last_observed_at
    from cwl.plans p join cwl.rounds r on r.id=p.round_id
    where r.clan_tag=${tag} and r.start_time=${start}`;
  return row || null;
}
