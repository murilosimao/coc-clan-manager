import { createCwlHandler } from './router.js';
import { createCwlAuth } from './auth.js';
import { CwlError,requireCondition } from './errors.js';
import { openSession } from './session-crypto.js';
import { createUsersHandler } from './users.js';
import { ClashCwlProvider } from './provider.js';
import { usesOfficialApi, fetchOfficial } from '../official-api.js';

async function sameSecret(provided,expected){
  if(typeof expected!=='string'||expected.length<32)return false;
  const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')));
  const [a,b]=await Promise.all([hash(provided),hash(expected)]);let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}
export function createEdgeHandler(environment,{fetcher=fetch,provider,database,clock=Date.now}={}){
  const auth=createCwlAuth(fetcher);
  const users=createUsersHandler(auth,{fetcher});
  const liveProvider=provider||new ClashCwlProvider((url,options)=>{
    const env=typeof environment==='function'?environment():environment;
    const parsed=new URL(url);
    return usesOfficialApi(env)&&parsed.hostname==='clashapi.colinschmale.dev'
      ?fetchOfficial(parsed.pathname,env,fetcher):fetcher(url,options);
  });
  const api=createCwlHandler({provider:liveProvider,database,clock,authorize:auth.authorize,browserPlans:true});
  return async request=>{
    try{
      const env=typeof environment==='function'?environment():environment;
      requireCondition(await sameSecret(request.headers.get('X-CWL-Proxy-Key'),env.CWL_BACKEND_KEY),401,'Acesso não autorizado.');
      const app=new URL(env.CWL_APP_ORIGIN),received=request.headers.get('X-CWL-Public-Origin');
      requireCondition(app.origin===received,403,'Origem não autorizada.');
      const headers=new Headers(request.headers);headers.delete('Cookie');
      if(headers.has('X-CWL-Session')){
        let session;try{session=JSON.parse(await openSession(headers.get('X-CWL-Session'),env.CWL_BACKEND_KEY,'transport:'+app.origin));}catch{}
        requireCondition(session&&typeof session.cookies==='string'&&session.cookies.length<=16384&&Number.isFinite(session.createdAt)
          &&session.createdAt<=clock()+30000&&clock()-session.createdAt<=60000,401,'Sessão de transporte inválida.','invalid_proxy_session');
        headers.set('Cookie',session.cookies);
      }
      headers.delete('X-CWL-Session');
      const url=new URL(request.url),index=url.pathname.indexOf('/api/cwl/');requireCondition(index>=0,404,'Rota não encontrada.');
      const local=new Request(app.origin+url.pathname.slice(index)+url.search,{method:request.method,headers,
        body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half'});
      const options={...env,CWL_REQUIRE_RESTRICTED_DB:'true',CWL_PUBLIC_ORIGIN:app.origin};
      return await auth.handle(local,options)||await users(local,options)||await api(local,options);
    }catch(error){
      const known=error instanceof CwlError;
      return Response.json({error:known?error.message:'Não foi possível acessar a CWL.',code:known?error.code:'cwl_unavailable'},
        {status:known?error.status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
  };
}
