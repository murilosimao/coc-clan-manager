import postgres from 'postgres';
import { CwlError } from './errors.js';

export function connectDatabase(env) {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) throw new CwlError(503, 'Banco de dados da CWL não configurado.', 'database_not_configured');
  // Prepared statements remain enabled: Hyperdrive supports them and advises against prepare:false.
  return postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, max_lifetime: 60,
    onnotice: () => {}, connection: { application_name: 'coc-cwl', statement_timeout: 30000, lock_timeout: 30000 } });
}

export async function withDatabase(env, fn) {
  const sql = connectDatabase(env);
  try { return await fn(sql); }
  finally { await sql.end({ timeout: 5 }); }
}

export async function lockRound(sql, tag, start) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${tag + '|' + start}, 0))`;
}

export async function loadPlan(sql, tag, start) {
  const [row] = await sql`select p.*, r.clan_tag, r.start_time, r.season, r.opponent_tag,
    r.war_state, r.end_at, r.last_observed_at
    from cwl.plans p join cwl.rounds r on r.id=p.round_id
    where r.clan_tag=${tag} and r.start_time=${start}`;
  return row || null;
}
