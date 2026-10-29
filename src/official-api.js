// Official Clash API, called only by the Worker. Production keys are bound to
// the RoyaleAPI proxy IP because Worker egress addresses change.
const TAG = '#[0289PYLQGRJCUV]{3,15}';
const CLAN = new RegExp(`^/v1/clans/${TAG}(?:/(currentwar|warlog))?$`);
const PLAYER = new RegExp(`^/v1/players/${TAG}(?:/(leaguehistory|battlelog))?$`);
const GROUP = new RegExp(`^/v1/leaguegroup/${TAG}/[0-9]{10}$`);
const REASONS = new Set(['accessDenied', 'accessDenied.invalidIp', 'notFound', 'requestThrottled', 'inMaintenance']);

export class OfficialError extends Error {
  constructor(status, reason) { super('official_' + status); this.status = status; this.reason = reason; }
}

export function officialSource(env) {
  const mode = env.COC_API_MODE || 'direct';
  const key = mode === 'royaleapi' ? env.COC_WORKER_API_KEY : mode === 'direct' ? env.COC_API_KEY : null;
  if (typeof key !== 'string' || key.length < 32) return null;
  return { origin: mode === 'royaleapi' ? 'https://cocproxy.royaleapi.dev' : 'https://api.clashofclans.com', key };
}

export async function officialJson(path, env, fetcher = fetch) {
  const source = officialSource(env);
  if (!source) throw new OfficialError(503, 'not_configured');
  const url = new URL(path, source.origin);
  const pathname = decodeURIComponent(url.pathname), group = GROUP.test(pathname), clan = CLAN.test(pathname), player = PLAYER.test(pathname);
  const entries = [...url.searchParams];
  if (url.origin !== source.origin || url.username || url.password || url.hash || (!clan && !player && !group)
    || (group ? entries.length !== 1 || entries[0][0] !== 'playerTag' || !new RegExp(`^${TAG}$`).test(entries[0][1])
      : entries.length > 1 || entries.some(([name, value]) => !pathname.endsWith('/warlog') || name !== 'limit' || !/^(1|5|10)$/.test(value)))) throw new OfficialError(400, 'route_not_allowed');
  let response;
  try {
    response = await fetcher(url.href, { method: 'GET', redirect: 'manual',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + source.key },
      signal: AbortSignal.timeout(15000), cf: { cacheTtl: 0, cacheEverything: false } });
  } catch { throw new OfficialError(502, 'unreachable'); }
  if (!response.ok) {
    // Only a fixed reason code is kept; upstream messages are never echoed.
    let reason = 'error';
    try { const body = await response.json(); if (REASONS.has(body?.reason)) reason = body.reason; } catch { /* Not JSON. */ }
    throw new OfficialError(response.status, reason);
  }
  try { return await response.json(); } catch { throw new OfficialError(502, 'invalid_json'); }
}

export const clanPath = (tag, suffix, limit) => `/v1/clans/${encodeURIComponent('#' + tag)}/${suffix}${limit ? '?limit=' + limit : ''}`;
