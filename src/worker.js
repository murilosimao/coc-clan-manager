const PROFILE_API = 'https://clashapi.colinschmale.dev';
const HISTORY_API = 'https://api.clashk.ing';
const TTL = 60;
const TAG = /^[0289PYLQGRJCUV]{3,15}$/;
const PAGES_ORIGIN = 'https://murilosimao.github.io';

class APIError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function tagOf(value) {
  const tag = String(value || '').trim().replace(/^#/, '').toUpperCase();
  if (!TAG.test(tag)) throw new APIError(400, 'Tag inválida do Clash of Clans.');
  return tag;
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

async function api(request, ctx) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405, { Allow: 'GET' });
  if (url.pathname === '/api/health') return json({ ok: true });

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
      tag: data.tag, name: data.name, members: data.members,
      memberList: data.memberList.map((member) => ({
        tag: member.tag, name: member.name, townHallLevel: member.townHallLevel,
        role: member.role, clanRank: member.clanRank,
      })),
    };
  });
  return json({ ...result.data, fetchedAt: result.fetchedAt, source: 'clashapi.colinschmale.dev' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowedOrigin = origin === url.origin || origin === PAGES_ORIGIN;
    if ((origin && !allowedOrigin) || (!origin && request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return json({ error: 'Consulte a API pelo site do Clan Manager.' }, 403);
    }
    const cors = (response) => {
      if (!allowedOrigin) return response;
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Accept');
      headers.set('Vary', 'Origin');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try { return cors(await api(request, ctx)); }
    catch (error) {
      if (error instanceof APIError) return cors(json({ error: error.message }, error.status));
      // Never return stack traces, environment values, or upstream response bodies.
      return cors(json({ error: 'Não foi possível concluir a consulta. Tente novamente.' }, 500));
    }
  },
};
