import { createAccessStore } from './access.js';
import { CwlError,requireCondition,clanTag } from './errors.js';
import { readBytes } from './archive.js';
import { requireSameOrigin } from './auth.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function adminUser(env,{id,email,password,remove=false},fetcher=fetch){
  const key=env.CWL_AUTH_ADMIN_KEY;
  requireCondition(typeof key==='string'&&key.length>30,503,'Cadastro temporariamente indisponível.','user_admin_unavailable');
  const base=new URL(env.SUPABASE_URL);
  requireCondition(base.protocol==='https:'&&base.hostname.endsWith('.supabase.co'),503,'Cadastro não configurado.');
  let r;try{r=await fetcher(base.origin+'/auth/v1/admin/users'+(remove?'/'+id:''),{method:remove?'DELETE':'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(remove?{}:{id,email,password,email_confirm:true})});}
  catch{throw new CwlError(503,'Não foi possível confirmar o cadastro. Tente novamente.','user_admin_unavailable');}
  if(remove&&r.status===404){await r.body?.cancel();return;}
  if(!r.ok){await r.body?.cancel();throw new CwlError(r.status>=500?503:409,'Não foi possível cadastrar esta conta. Confira o email ou procure o administrador.','user_create_failed');}
  if(remove){await r.body?.cancel();return;}
  const user=await r.json();requireCondition(user.id===id,503,'Resposta de cadastro inválida.');
  return id;
}

export function createUsersHandler(auth,{store=createAccessStore(),fetcher=fetch}={}){
  return async(request,env)=>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/cwl/users'))return null;
    requireCondition(path==='/api/cwl/users'||path==='/api/cwl/users/remove',404,'Rota não encontrada.');
    const remove=path.endsWith('/remove'),write=request.method==='POST';
    requireCondition(write||request.method==='GET'&&!remove,405,'Método não permitido.');
    requireCondition(env.CWL_ACCESS_DB==='true',503,'Gestão de usuários ainda não configurada.');
    let data={};
    if(write){
      requireSameOrigin(request,env);
      requireCondition(request.headers.get('Content-Type')?.startsWith('application/json'),415,'Envie application/json.');
      try{data=JSON.parse(new TextDecoder().decode(await readBytes(request.body,4096)));}catch(e){if(e instanceof CwlError)throw e;throw new CwlError(400,'Dados inválidos.');}
      requireCondition(data&&typeof data==='object'&&!Array.isArray(data),400,'Dados inválidos.');
      requireCondition(Object.keys(data).every(k=>(remove?['clanTag','userId']:['clanTag','email','password']).includes(k)),400,'Campos de cadastro inválidos.');
    }
    const tag=clanTag(write?data.clanTag:url.searchParams.get('clan'));
    const actor=await auth.authorize(request,env,tag);
    requireCondition(actor.role==='leader',403,'Somente a líder deste clã pode gerenciar usuários.','leader_required');
    const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    if(!write)return response({clanTag:tag,users:await store.list(env,actor.id,tag)});
    if(remove){requireCondition(typeof data.userId==='string'&&UUID.test(data.userId),400,'Conta inválida.');return response(await store.remove(env,actor.id,tag,data.userId));}
    requireCondition(typeof data.email==='string'&&data.email.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()),400,'Informe um email válido.');
    requireCondition(typeof data.password==='string'&&data.password.length>=12&&data.password.length<=1024,400,'Use uma senha inicial com pelo menos 12 caracteres.');
    const email=data.email.trim().toLowerCase();let createdId;
    try{
      const result=await store.grant(env,actor.id,tag,email,async()=>{
        createdId=crypto.randomUUID();
        await adminUser(env,{id:createdId,email,password:data.password},fetcher);return createdId;
      });
      return response(result,201);
    }catch(error){
      if(createdId){try{await adminUser(env,{id:createdId,remove:true},fetcher);}catch{throw new CwlError(503,'Cadastro não concluído. Procure o administrador antes de tentar novamente.','user_cleanup_required');}}
      throw error;
    }
  };
}
