import { CwlError, requireCondition } from './cwl/errors.js';

export const usesOfficialApi = env => Boolean(env.COC_API_MODE || env.COC_API_KEY || env.COC_WORKER_API_KEY);
export function officialSource(env) {
  const mode = env.COC_API_MODE || 'direct';
  requireCondition(['direct', 'royaleapi'].includes(mode), 503, 'Transporte da API oficial não configurado.');
  const key = mode === 'direct' ? env.COC_API_KEY : env.COC_WORKER_API_KEY;
  requireCondition(typeof key === 'string' && key.length >= 32, 503, 'Chave da API oficial não configurada.');
  return { origin: mode === 'direct' ? 'https://api.clashofclans.com' : 'https://cocproxy.royaleapi.dev', key };
}

export async function fetchOfficial(path, env, fetcher = fetch) {
  const { origin, key } = officialSource(env);
  requireCondition(typeof path === 'string' && path.startsWith('/v1/'), 400, 'Consulta oficial não permitida.');
  const url = new URL(path, origin), decoded = decodeURIComponent(url.pathname), tag = '#[0289PYLQGRJCUV]{3,15}';
  const allowed = new RegExp(`^/v1/(players/${tag}(/(battlelog|leaguehistory))?|clans/${tag}(/(members|warlog|currentwar))?|leaguetiers(/[0-9]+)?|leaguegroup/#[A-Z0-9]{3,32}/[0-9]{10})$`);
  requireCondition(url.origin === origin && !url.hash && allowed.test(decoded), 400, 'Consulta oficial não permitida.');
  for (const [name, value] of url.searchParams) {
    requireCondition(name === 'limit' && /^(5|10)$/.test(value) && decoded.endsWith('/warlog')
      || name === 'playerTag' && new RegExp('^' + tag + '$').test(value) && decoded.startsWith('/v1/leaguegroup/'), 400, 'Parâmetro oficial não permitido.');
  }
  let response;
  try { response = await fetcher(url.href, { method: 'GET', redirect: 'manual',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(15000), cf: { cacheTtl: 0, cacheEverything: false } }); }
  catch { throw new CwlError(502, 'A API oficial não respondeu. Tente novamente.', 'official_unavailable'); }
  if (!response.ok) {
    let privateLog = false;
    if (response.status === 403 && decoded.endsWith('/warlog')) {
      try { const error = await response.json(); privateLog = /private|not public/i.test(String(error.message || '')); } catch { /* Never echo upstream error content. */ }
    }
    if (!response.bodyUsed) await response.body?.cancel();
    const status = [403,404,429].includes(response.status) ? response.status : 502;
    throw new CwlError(status, privateLog ? 'O histórico de guerras deste clã é privado.' : status === 403 ? 'A chave ou o IP de saída não foi autorizado pela API oficial.'
      : status === 404 ? 'Dados não encontrados na API oficial.'
      : status === 429 ? 'A API oficial limitou as consultas. Aguarde e tente novamente.'
      : 'A API oficial está temporariamente indisponível.', 'official_unavailable');
  }
  return response;
}

export async function officialJson(path, env, fetcher = fetch) {
  const response = await fetchOfficial(path, env, fetcher);
  try { return { data: await response.json(), fetchedAt: new Date().toISOString() }; }
  catch { throw new CwlError(502, 'Resposta inválida da API oficial.', 'official_unavailable'); }
}
