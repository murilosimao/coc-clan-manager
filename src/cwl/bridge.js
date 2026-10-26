import { CwlError, requireCondition } from './errors.js';
export async function bridgeCwl(request,env,fetcher=fetch) {
  const original=new URL(request.url), base=new URL(env.CWL_BACKEND_URL);
  const local=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
  requireCondition(base.protocol==='https:'&&base.hostname.endsWith('.supabase.co')||local&&base.protocol==='http:',503,'Backend CWL não configurado.');
  requireCondition(typeof env.CWL_BACKEND_KEY==='string'&&env.CWL_BACKEND_KEY.length>=32,503,'Backend CWL não configurado.');
  if(original.pathname==='/api/cwl/auth/login') {
    requireCondition(env.CWL_LOGIN_LIMITER||local,503,'Proteção de login não configurada.');
    if(env.CWL_LOGIN_LIMITER){const {success}=await env.CWL_LOGIN_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});requireCondition(success,429,'Muitas tentativas. Aguarde um minuto e tente novamente.');}
  }
  const headers=new Headers({Accept:'application/json','X-CWL-Proxy-Key':env.CWL_BACKEND_KEY,'X-CWL-Public-Origin':original.origin});
  for(const name of ['Content-Type','Cookie','Origin'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
  const url=env.CWL_BACKEND_URL.replace(/\/$/,'')+original.pathname+original.search;
  try {
    const response=await fetcher(url,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half',redirect:'manual'});
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('Unexpected redirect');}
    return new Response(response.body,{status:response.status,headers:response.headers});
  } catch {throw new CwlError(503,'O serviço da CWL está temporariamente indisponível.','cwl_backend_unavailable');}
}
