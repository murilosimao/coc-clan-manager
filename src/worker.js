import { handleCwl } from './cwl/router.js';
import { CwlError } from './cwl/errors.js';
const PROFILE_API = 'https://clashapi.colinschmale.dev';
const HISTORY_API = 'https://api.clashk.ing';
const TTL = 60;
const TAG = /^[0289PYLQGRJCUV]{3,15}$/;
const PAGES_ORIGINS = new Set([
  'https://murilosimao.github.io',
  'https://coc-purosangue.duckdns.org',
  'http://coc-purosangue.duckdns.org',
]);
const AUDIT_ACTIONS = new Set([
  'page_view', 'clan_load_started', 'clan_load_succeeded', 'clan_load_failed',
  'demo_loaded', 'har_loaded', 'selection_copied', 'selection_exported',
  'whitelist_added', 'whitelist_removed', 'blacklist_added', 'blacklist_removed',
  'whitelist_cleared', 'blacklist_cleared', 'stale_lists_pruned',
  'manual_inclusion', 'manual_removal', 'manual_override_cleared', 'setting_changed',
  'player_stats_opened', 'player_stats_filter_changed',
]);
const AUDIT_SETTINGS = new Set([
  'excludeRed', 'requireTwoAttacks', 'requireOneStar', 'requireTriple',
  'allowNoWarData', 'rankBy', 'targetMode', 'fixedSize', 'maxFill', 'maxTrim', 'fillFrom',
  'usePlayerHistoryFallback',
]);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class APIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function tagOf(value) {
  const tag = String(value || '').trim().replace(/^#/, '').toUpperCase();
  if (!TAG.test(tag)) throw new APIError(400, 'Tag inválida do Clash of Clans.');
  return tag;
}

function clanBadges(value) {
  const badges = {};
  for (const size of ['small', 'medium', 'large']) {
    const url = value?.[size];
    if (typeof url === 'string' && /^https:\/\/api-assets\.clashofclans\.com\/badges\/(70|200|512)\/[A-Za-z0-9_-]+\.png$/.test(url)) badges[size] = url;
  }
  return badges;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  } });
}

async function pool(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

function safeRoute(pathname) {
  if (pathname === '/api/health') return 'health';
  if (pathname === '/api/audit') return 'site_action';
  if (pathname === '/api/players') return 'player_profiles';
  if (pathname.startsWith('/api/cwl/')) return 'cwl_' + (pathname.endsWith('/revisions') ? 'revision' : pathname.endsWith('/reviews') ? 'review' : pathname.endsWith('/sync') ? 'sync' : 'read');
  if (/^\/api\/clans\/[^/]+\/score-history$/.test(pathname)) return 'war_score_history';
  if (/^\/api\/players\/[^/]+\/war-stats$/.test(pathname)) return 'player_war_statistics';
  const match = pathname.match(/^\/api\/clans\/[^/]+(?:\/(wars|currentwar))?$/);
  if (!match) return 'other';
  if (match[1] === 'wars') return 'clan_war_history';
  if (match[1] === 'currentwar') return 'clan_current_war';
  return 'clan_details';
}

function logApiRequest(request, response, startedAt) {
  if (request.method === 'OPTIONS') return response;
  const sessionId = request.headers.get('X-App-Session');
  console.log({
    type: 'api_request',
    session_id: sessionId && SESSION_ID.test(sessionId) ? sessionId : null,
    request_id: request.headers.get('cf-ray')?.split('-')[0] || null,
    route: safeRoute(new URL(request.url).pathname),
    method: request.method,
    status: response.status,
    duration_ms: Date.now() - startedAt,
  });
  return response;
}

async function readSmallJson(request, maxBytes = 1024) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new APIError(413, 'Evento muito grande.');
  if (!request.body) throw new APIError(400, 'Evento inválido.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new APIError(413, 'Evento muito grande.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new APIError(400, 'Evento inválido.'); }
}

async function audit(request, startedAt) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, { Allow: 'POST, OPTIONS' });
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new APIError(415, 'Formato de evento inválido.');
  }
  const payload = await readSmallJson(request);
  const { sessionId, action } = payload || {};
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || !AUDIT_ACTIONS.has(action)) {
    throw new APIError(400, 'Evento inválido.');
  }
  const entry = {
    type: 'site_action', session_id: sessionId, action,
    request_id: request.headers.get('cf-ray')?.split('-')[0] || null,
    status: 202, duration_ms: Date.now() - startedAt,
  };
  if (action === 'setting_changed' && AUDIT_SETTINGS.has(payload.setting)) {
    entry.setting = payload.setting;
    const value = payload.value;
    if (typeof value === 'boolean') entry.value = value;
    else if (typeof value === 'number' && Number.isFinite(value)) entry.value = Math.max(0, Math.min(50, value));
    else if (typeof value === 'string' && value.length <= 20 && /^[a-zA-Z0-9_-]+$/.test(value)) entry.value = value;
  }
  console.log(entry);
  return json({ ok: true }, 202);
}

// Upstream hosts and paths are fixed by our routes. Never forward cookies,
// Authorization, API keys, browser headers, or user-supplied URLs.
async function upstream(origin, path, ctx, transform = (data) => data) {
  const url = origin + path;
  const key = new Request(url, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return cached.json();
  let response;
  try {
    response = await fetch(url, {
      method: 'GET', redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new APIError(502, 'A fonte de dados não respondeu. Tente novamente.');
  }
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 429 ? 429 : 502;
    await response.body?.cancel();
    throw new APIError(status, status === 404 ? 'Dados não encontrados para esta tag.'
      : status === 429 ? 'A fonte limitou as consultas. Aguarde e tente novamente.'
      : 'A fonte de dados está temporariamente indisponível.');
  }
  let data;
  try { data = transform(await response.json()); }
  catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(502, 'A fonte retornou dados em um formato inesperado.');
  }
  const stored = json({ data, fetchedAt: new Date().toISOString() }, 200, { 'Cache-Control': `public, max-age=${TTL}` });
  // Cache only successful, reduced responses; never cache failed lookups.
  ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  return { data, fetchedAt: new Date().toISOString() };
}

function profile(data, expectedTag) {
  if (tagOf(data?.tag) !== expectedTag) throw new APIError(502, 'O perfil retornado não corresponde ao jogador.');
  return {
    tag: data.tag, name: data.name, townHallLevel: data.townHallLevel,
    role: data.role || null,
    warPreference: ['in', 'out'].includes(data.warPreference) ? data.warPreference : null,
    clan: data.clan?.tag ? { tag: data.clan.tag } : null,
  };
}

function playerWarStats(data, expectedTag) {
  if (!Array.isArray(data?.items)) throw new APIError(502, 'A fonte não retornou um histórico de guerras válido.');
  const hit = (attack) => {
    if (!Number.isInteger(attack.stars) || attack.stars < 0 || attack.stars > 3) throw new APIError(502, 'O histórico de ataques está incompleto.');
    return {
      stars: attack.stars,
      destructionPercentage: Number.isFinite(attack.destructionPercentage) ? attack.destructionPercentage : null,
      order: Number.isFinite(attack.order) ? attack.order : Number.isFinite(attack.attack_order) ? attack.attack_order : null,
    };
  };
  return { items: data.items.slice(0, 100).filter((item) => String(item.member_data?.tag || '').replace(/^#/, '').toUpperCase() === expectedTag).map((item) => {
    const war = item.war_data || {};
    if (!Array.isArray(item.attacks) || !Array.isArray(item.defenses)) throw new APIError(502, 'O histórico de ataques está incompleto.');
    return {
      type: ['random', 'cwl', 'friendly'].includes(war.type) ? war.type : 'unknown',
      state: war.state, teamSize: war.teamSize,
      attacksPerMember: Number.isInteger(war.attacksPerMember) && war.attacksPerMember > 0 ? war.attacksPerMember : war.type === 'cwl' ? 1 : 2,
      startTime: war.startTime, endTime: war.endTime,
      clan: { name: war.clan?.name }, opponent: { name: war.opponent?.name },
      attacks: item.attacks.map(hit),
      defenses: item.defenses.map(hit),
    };
  }) };
}

async function api(request, ctx, env, cwlHandler = handleCwl) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/cwl/')) return cwlHandler(request, env);
  if (url.pathname === '/api/audit') return audit(request, Date.now());
  if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405, { Allow: 'GET' });
  if (url.pathname === '/api/health') return json({ ok: true });

  const scoreMatch = url.pathname.match(/^\/api\/clans\/([^/]+)\/score-history$/);
  if (scoreMatch) {
    const tag = tagOf(decodeURIComponent(scoreMatch[1]));
    const type = url.searchParams.get('type');
    if (!['random', 'cwl'].includes(type)) throw new APIError(400, 'Informe o tipo random ou cwl.');
    const result = await upstream(HISTORY_API, `/v2/clan/${encodeURIComponent('#' + tag)}/wars?limit=30&type=${type}`, ctx, (data) => {
      if (!Array.isArray(data?.items)) throw new APIError(502, 'Histórico de scores indisponível.');
      const side = (value) => ({
        tag: value?.tag, name: value?.name, attacks: value?.attacks,
        members: Array.isArray(value?.members) ? value.members.map((member) => ({
          tag: member.tag, name: member.name, townhallLevel: member.townhallLevel ?? member.townHallLevel,
          mapPosition: member.mapPosition,
          attacks: Array.isArray(member.attacks) ? member.attacks.map((attack) => ({
            attackerTag: attack.attackerTag || member.tag, defenderTag: attack.defenderTag,
            stars: attack.stars, destructionPercentage: attack.destructionPercentage, order: attack.order,
          })) : [],
        })) : [],
      });
      return { items: data.items.slice(0, 30).map((war) => ({
        type: war.type || type, state: war.state, battleModifier: typeof war.battleModifier === 'string' ? war.battleModifier : null,
        startTime: war.startTime, endTime: war.endTime, preparationStartTime: war.preparationStartTime,
        season: typeof war.season === 'string' ? war.season : null,
        teamSize: war.teamSize, attacksPerMember: war.attacksPerMember,
        clan: side(war.clan), opponent: side(war.opponent),
      })) };
    });
    return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashking', clanTag: '#' + tag, type, cacheSeconds: TTL });
  }

  if (url.pathname === '/api/players') {
    const values = url.searchParams.get('tags')?.split(',') || [];
    if (!values.length || values.length > 5) throw new APIError(400, 'Informe de 1 a 5 tags por consulta.');
    const tags = [...new Set(values.map(tagOf))];
    const items = await pool(tags, 3, async (tag) => {
      try {
        const result = await upstream(PROFILE_API, '/v1/players/' + encodeURIComponent('#' + tag), ctx, (data) => profile(data, tag));
        return { ...result.data, fetchedAt: result.fetchedAt };
      } catch (error) {
        if (!(error instanceof APIError)) throw error;
        return { tag: '#' + tag, error: error.message };
      }
    });
    return json({ items, source: 'clashapi.colinschmale.dev', cacheSeconds: TTL });
  }

  const statsMatch = url.pathname.match(/^\/api\/players\/([^/]+)\/war-stats$/);
  if (statsMatch) {
    const tag = tagOf(decodeURIComponent(statsMatch[1]));
    const result = await upstream(HISTORY_API, '/player/' + encodeURIComponent('#' + tag) + '/warhits?limit=100', ctx, (data) => playerWarStats(data, tag));
    return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashking', cacheSeconds: TTL });
  }

  const match = url.pathname.match(/^\/api\/clans\/([^/]+)(?:\/(wars|currentwar))?$/);
  if (!match) return json({ error: 'Rota não encontrada.' }, 404);
  const tag = tagOf(decodeURIComponent(match[1]));
  const encoded = encodeURIComponent('#' + tag);
  if (match[2] === 'wars') {
    const result = await upstream(HISTORY_API, `/v2/clan/${encoded}/wars?limit=5`, ctx);
    return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashking' });
  }
  if (match[2] === 'currentwar') {
    const result = await upstream(PROFILE_API, `/v1/clans/${encoded}/currentwar`, ctx);
    return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashapi.colinschmale.dev' });
  }
  const result = await upstream(PROFILE_API, `/v1/clans/${encoded}`, ctx, (data) => {
    if (tagOf(data?.tag) !== tag || !Array.isArray(data.memberList)) throw new APIError(502, 'A fonte não retornou a lista de membros do clã.');
    return {
      tag: data.tag, name: data.name, members: data.members, badgeUrls: clanBadges(data.badgeUrls),
      memberList: data.memberList.map((member) => ({
        tag: member.tag, name: member.name, townHallLevel: member.townHallLevel,
        role: member.role, clanRank: member.clanRank,
        trophies: member.trophies != null && Number.isFinite(Number(member.trophies))
          ? Number(member.trophies) : null,
      })),
    };
  });
  return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashapi.colinschmale.dev' });
}

export function createWorker(cwlHandler = handleCwl) { return {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowedOrigin = origin === url.origin || PAGES_ORIGINS.has(origin);
    if ((origin && !allowedOrigin) || (!origin && request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return logApiRequest(request, json({ error: 'Consulte a API pelo site do Clan Manager.' }, 403), startedAt);
    }
    const cors = (response) => {
      if (!allowedOrigin) return response;
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type, X-App-Session, Authorization');
      headers.set('Access-Control-Max-Age', '86400');
      headers.set('Vary', 'Origin');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (url.pathname === '/api/audit' && (!origin || !allowedOrigin)) {
      return logApiRequest(request, json({ error: 'Origem não permitida.' }, 403), startedAt);
    }
    try { return logApiRequest(request, cors(await api(request, ctx, env, cwlHandler)), startedAt); }
    catch (error) {
      if (error instanceof APIError || error instanceof CwlError) return logApiRequest(request, cors(json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status)), startedAt);
      // Never return stack traces, environment values, or upstream response bodies.
      return logApiRequest(request, cors(json({ error: 'Não foi possível concluir a consulta. Tente novamente.' }, 500)), startedAt);
    }
  },
}; }
export default createWorker();
