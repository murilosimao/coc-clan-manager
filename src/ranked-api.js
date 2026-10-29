import { officialJson, OfficialError } from './official-api.js';
import { signRanked } from './ranked-proof.js';
const FAMILY = ['2G8QCR92V', '2CQ9CR2YP'];
const TAG = /^[0289PYLQGRJCUV]{3,15}$/;
const clean = t => String(t || '').replace(/^#/, '').toUpperCase();
const tier = id => Number.isInteger(id) && id > 105000000 && id <= 105000036 ? id - 105000000 : null;
const time = s => typeof s === 'number' ? s : Date.parse(String(s || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));
async function pool(items, limit, run) {
  let next = 0; const results = Array(items.length);
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => { while (next < items.length) { const i = next++; results[i] = await run(items[i]); } }));
  return results;
}
export async function rankedApi(request, env, { fetcher = fetch, cache = globalThis.caches?.default, now = Date.now() } = {}) {
  const url = new URL(request.url), match = /^\/api\/ranked\/(family|players|levels)$/.exec(url.pathname);
  if (!match) return null;
  const fail = (status, error) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return fail(405, 'Método não permitido.');
  const kind = match[1], tags = kind === 'family' ? FAMILY : (url.searchParams.get('tags') || '').split(',').map(clean);
  if ([...url.searchParams.keys()].some(k => k !== 'tags') || (kind === 'family' && url.search)
    || new Set(tags).size !== tags.length || !tags.length || tags.length > (kind === 'players' ? 3 : 20) || tags.some(t => !TAG.test(t))) return fail(400, 'Tags inválidas.');
  if (typeof env.CWL_BACKEND_KEY !== 'string' || env.CWL_BACKEND_KEY.length < 32) return fail(503, 'Dados de ranqueada indisponíveis.');
  const cacheKey = new Request(url.origin + '/__ranked-v1/' + kind + '/' + [...tags].sort().join(','));
  const hit = await cache?.match(cacheKey); if (hit) return hit;
  try {
    const get = path => officialJson(path, env, fetcher);
    let items;
    if (kind === 'family') {
      const clans = await pool(FAMILY, 2, t => get('/v1/clans/%23' + t));
      items = [...new Map(clans.flatMap(c => c.memberList || []).map(p => [clean(p.tag), { tag: clean(p.tag) }])).values()];
    } else {
      items = await pool(tags, 2, async tag => {
        const path = '/v1/players/%23' + tag, p = await get(path);
        if (kind === 'levels') return { tag, th: p.townHallLevel };
        const history = await get(path + '/leaguehistory');
        let group = null;
        if (p.previousLeagueGroupTag && p.previousLeagueSeasonId) {
          // A missing group never erases valid league history or war evidence.
          const raw = await get('/v1/leaguegroup/' + encodeURIComponent(p.previousLeagueGroupTag) + '/' + p.previousLeagueSeasonId + '?playerTag=%23' + tag).catch(() => null);
          if (raw) group = { weekStart: p.previousLeagueSeasonId * 1000, attacks: (raw.attackLogs || []).map(a => ({
            defenderTag: clean(a.opponentPlayerTag), stars: a.stars, time: time(a.creationTime),
          })).filter(a => TAG.test(a.defenderTag) && Number.isInteger(a.stars) && a.stars >= 0 && a.stars <= 3 && Number.isFinite(a.time)) };
        }
        return { tag, th: p.townHallLevel, league: tier(p.leagueTier?.id), observedAt: now,
          history: (history.items || []).slice(0, 12).map(h => ({ weekStart: h.leagueSeasonId * 1000, league: tier(h.leagueTierId),
            n: (h.attackWins || 0) + (h.attackLosses || 0), maxBattles: h.maxBattles })), group };
      });
    }
    const packet = await signRanked({ version: 1, kind, fetchedAt: now, items }, env.CWL_BACKEND_KEY);
    const response = Response.json(packet, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
    // Keep the network request bounded; no ordinal fitting is performed here.
    await cache?.put(cacheKey, response.clone()).catch(() => {});
    return response;
  } catch (error) { return fail(error instanceof OfficialError && error.status === 429 ? 429 : 503, 'Dados de ranqueada indisponíveis. O histórico de guerra continua válido.'); }
}
