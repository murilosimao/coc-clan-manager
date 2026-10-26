import { CwlError,requireCondition,clanTag } from './errors.js';
import { readBytes } from './archive.js';
import { sealSession,openSession } from './session-crypto.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cookieResponse=(data,cookies=[],status=200)=>{
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  cookies.forEach(c=>headers.append('Set-Cookie',c));return new Response(JSON.stringify(data),{status,headers});
};
function config(env){
  let url,editors;try{url=new URL(env.SUPABASE_URL);editors=JSON.parse(env.CWL_EDITORS||'{}');}catch{}
  requireCondition(url?.protocol==='https:'&&url.hostname.endsWith('.supabase.co')&&typeof env.SUPABASE_ANON_KEY==='string'
    &&Object.entries(editors||{}).every(([id,e])=>UUID.test(id)&&['leader','coLeader'].includes(e.role)&&e.clanTag),503,'Login da liderança não configurado.','auth_not_configured');
  return {url,editors};
}
function origin(request,env){return env.CWL_PUBLIC_ORIGIN||new URL(request.url).origin;}
function names(request,env){const url=new URL(origin(request,env)),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);return local?['cwl-access','cwl-refresh']:['__Host-cwl-access','__Host-cwl-refresh'];}
async function readCookies(request,env){
  const all=new Map((request.headers.get('Cookie')||'').split(';').map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1)];}));
  return Promise.all(names(request,env).map(async(n,i)=>{try{return await openSession(all.get(n),env.CWL_BACKEND_KEY,'cookie:'+origin(request,env)+':'+i);}catch{return '';}}));
}
async function cookies(request,env,session){
  if(session)requireCondition([session.access_token,session.refresh_token].every(v=>typeof v==='string'&&v.length>0&&v.length<=8192&&/^[A-Za-z0-9._~-]+$/.test(v)),503,'Sessão inválida.','auth_unavailable');
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(origin(request,env)).hostname);
  const values=[session?.access_token||'',session?.refresh_token||''];
  return Promise.all(names(request,env).map(async(name,i)=>`${name}=${session?await sealSession(values[i],env.CWL_BACKEND_KEY,'cookie:'+origin(request,env)+':'+i):''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${session?(i===0?Math.min(3600,Number(session.expires_in)||3600):28800):0}${local?'':'; Secure'}`));
}
export function requireSameOrigin(request,env){
  requireCondition(request.headers.get('Origin')===origin(request,env),403,'Faça esta operação pelo site autenticado.','csrf_origin');
}

export function createCwlAuth(fetcher=fetch){
  async function call(env,path,{token,body,method='POST'}={}){
    const {url}=config(env),headers={apikey:env.SUPABASE_ANON_KEY,Accept:'application/json'};
    if(body)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
    let response;try{response=await fetcher(url.origin+'/auth/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(10000)});}
    catch{throw new CwlError(503,'O login está temporariamente indisponível.','auth_unavailable');}
    if(!response.ok){await response.body?.cancel();throw new CwlError(response.status===429?429:response.status>=500?503:401,'Não foi possível autenticar esta sessão.','auth_failed');}
    if(response.status===204)return null;
    try{return await response.json();}catch{throw new CwlError(503,'Resposta de autenticação inválida.','auth_unavailable');}
  }
  function editor(env,user){
    const entry=config(env).editors[user?.id];
    requireCondition(entry&&['leader','coLeader'].includes(entry.role),403,'Conta sem permissão para alterar a CWL.','editor_forbidden');
    return {id:user.id,role:entry.role,clanTag:clanTag(entry.clanTag)};
  }
  async function current(request,env){
    const [token]=await readCookies(request,env);requireCondition(token,401,'Entre como líder ou colíder.','session_required');
    return editor(env,await call(env,'user',{token,method:'GET'}));
  }
  async function authorize(request,env,tag){
    if(request.method==='POST')requireSameOrigin(request,env);
    const actor=await current(request,env);requireCondition(actor.clanTag===tag,403,'Sua conta não pode alterar este clã.','clan_forbidden');return actor;
  }
  async function handle(request,env){
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/api/cwl/auth/'))return null;
    const action=path.split('/').at(-1);
    requireCondition(['login','session','logout'].includes(action),404,'Rota de login não encontrada.');
    requireCondition(request.method===(action==='session'?'GET':'POST'),405,'Método não permitido.');
    if(action!=='session')requireSameOrigin(request,env);
    if(action==='login'){
      requireCondition(request.headers.get('Content-Type')?.startsWith('application/json'),415,'Envie application/json.');
      const text=new TextDecoder().decode(await readBytes(request.body,4096));
      let data;try{data=JSON.parse(text);}catch{throw new CwlError(400,'Dados de login inválidos.');}
      requireCondition(typeof data.email==='string'&&data.email.length<=254&&data.email.includes('@')&&typeof data.password==='string'&&data.password.length>=1&&data.password.length<=1024,400,'Informe email e senha.');
      const session=await call(env,'token?grant_type=password',{body:{email:data.email,password:data.password}});
      const who=editor(env,session.user);
      requireCondition(typeof session.access_token==='string'&&typeof session.refresh_token==='string',503,'Sessão inválida.');
      return cookieResponse({authenticated:true,editor:who},await cookies(request,env,session));
    }
    const [token,refresh]=await readCookies(request,env);
    if(action==='logout'){
      if(token)try{await call(env,'logout?scope=local',{token});}catch{}
      return cookieResponse({authenticated:false},await cookies(request,env,null));
    }
    if(!token&&!refresh)return cookieResponse({authenticated:false});
    try{return cookieResponse({authenticated:true,editor:await current(request,env)});}catch(error){
      if(error.status===503||error.status===429)throw error;
      if(refresh&&error.status===401){
        try{
          const session=await call(env,'token?grant_type=refresh_token',{body:{refresh_token:refresh}});
          const who=editor(env,session.user);
          return cookieResponse({authenticated:true,editor:who},await cookies(request,env,session));
        }catch(failure){if(failure.status===503||failure.status===429)throw failure;}
      }
      return cookieResponse({authenticated:false},await cookies(request,env,null));
    }
  }
  return {handle,authorize};
}
