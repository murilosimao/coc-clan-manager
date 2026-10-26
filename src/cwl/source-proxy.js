import { CwlError, requireCondition } from './errors.js';
const tag='#[0289PYLQGRJCUV]{3,15}';
export function sourceUrl(value) {
  let url;try{url=new URL(value);}catch{throw new CwlError(400,'Fonte inválida.');}
  requireCondition(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash,400,'Fonte inválida.');
  const path=decodeURIComponent(url.pathname), keys=[...url.searchParams.keys()].sort().join('|');
  const profile=url.hostname==='clashapi.colinschmale.dev'&&new RegExp(`^/v1/clans/${tag}/currentwar$`).test(path)&&!url.search;
  const clan=url.hostname==='api.clashk.ing'&&new RegExp(`^/v2/clan/${tag}/wars$`).test(path)&&keys==='limit|type'
    && ['random','cwl'].includes(url.searchParams.get('type'))&&url.searchParams.get('limit')===(url.searchParams.get('type')==='random'?'60':'35');
  const war=url.hostname==='api.clashk.ing'&&new RegExp(`^/v2/war/${tag}/previous/\\d{8}T\\d{6}\\.\\d{3}Z$`).test(path)&&!url.search;
  const after=Date.parse(url.searchParams.get('time[after]')),before=Date.parse(url.searchParams.get('time[before]'));
  const player=url.hostname==='api.clashk.ing'&&new RegExp(`^/v2/player/${tag}/war/attacks$`).test(path)&&keys==='limit|time[after]|time[before]'
    &&url.searchParams.get('limit')==='200'&&Number.isFinite(after)&&Number.isFinite(before)&&after<before&&before-after<3660*86400000;
  requireCondition(profile||clan||war||player,400,'Consulta de fonte não permitida.');
  return url.href;
}
export async function sourceProxy(request,fetcher=fetch) {
  requireCondition(request.method==='GET',405,'Método não permitido.');
  const url=sourceUrl(new URL(request.url).searchParams.get('url'));
  let result;try{result=await fetcher(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000),cf:{cacheTtl:60,cacheEverything:true}});}
  catch{throw new CwlError(502,'Não foi possível consultar a fonte.','upstream_unavailable');}
  if(!result.ok){await result.body?.cancel();throw new CwlError([403,404,429].includes(result.status)?result.status:502,'Fonte indisponível.','upstream_unavailable');}
  // Streaming avoids parsing large histories inside the Workers Free CPU budget.
  return new Response(result.body,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
}
