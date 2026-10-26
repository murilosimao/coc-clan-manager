import { createCwlHandler } from './router.js';
import { createCwlAuth } from './auth.js';
import { CwlError,requireCondition } from './errors.js';

async function sameSecret(provided,expected){
  if(typeof expected!=='string'||expected.length<32)return false;
  const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')));
  const [a,b]=await Promise.all([hash(provided),hash(expected)]);let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}
export function createEdgeHandler(environment,{fetcher=fetch,provider,database,clock=Date.now}={}){
  const auth=createCwlAuth(fetcher);
  const api=createCwlHandler({provider,database,clock,authorize:auth.authorize,browserPlans:true});
  return async request=>{
    try{
      const env=typeof environment==='function'?environment():environment;
      requireCondition(await sameSecret(request.headers.get('X-CWL-Proxy-Key'),env.CWL_BACKEND_KEY),401,'Acesso não autorizado.');
      const app=new URL(env.CWL_APP_ORIGIN),received=request.headers.get('X-CWL-Public-Origin');
      requireCondition(app.origin===received,403,'Origem não autorizada.');
      const url=new URL(request.url),index=url.pathname.indexOf('/api/cwl/');requireCondition(index>=0,404,'Rota não encontrada.');
      const local=new Request(app.origin+url.pathname.slice(index)+url.search,{method:request.method,headers:request.headers,
        body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half'});
      const options={...env,CWL_REQUIRE_RESTRICTED_DB:'true',CWL_PUBLIC_ORIGIN:app.origin};
      return await auth.handle(local,options)||await api(local,options);
    }catch(error){
      const known=error instanceof CwlError;
      return Response.json({error:known?error.message:'Não foi possível acessar a CWL.',code:known?error.code:'cwl_unavailable'},
        {status:known?error.status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
  };
}
