import { withDatabase } from './database.js';
import { requireCondition } from './errors.js';

export async function memberships(env,id,database=withDatabase){
  return database(env,sql=>sql`select clan_tag,role from cwl.memberships where user_id=${id} order by case role when 'leader' then 0 else 1 end,clan_tag`);
}

export function createAccessStore(database=withDatabase){
  async function transaction(env,actor,tag,fn){
    return database(env,sql=>sql.begin(async tx=>{
      const [leader]=await tx`select role from cwl.memberships where user_id=${actor} and clan_tag=${tag}`;
      requireCondition(leader?.role==='leader',403,'Somente a líder deste clã pode gerenciar usuários.','leader_required');
      return fn(tx);
    }));
  }
  return {
    list:(env,actor,tag)=>transaction(env,actor,tag,tx=>tx`select a.user_id as id,a.email,m.role from cwl.accounts a join cwl.memberships m using(user_id) where m.clan_tag=${tag} order by m.role,a.email`),
    grant:(env,actor,tag,email,create)=>transaction(env,actor,tag,async tx=>{
      // Serialize duplicate-email grants; never change an existing account's password.
      await tx`select pg_advisory_xact_lock(hashtextextended(${email},8721))`;
      let [account]=await tx`select a.user_id from cwl.accounts a where a.email=${email} and (a.created_by=${actor}
        or exists(select 1 from cwl.memberships m join cwl.memberships l on l.clan_tag=m.clan_tag and l.role='leader' and l.user_id=${actor} where m.user_id=a.user_id)
        or exists(select 1 from cwl.access_events e join cwl.memberships l on l.clan_tag=e.clan_tag and l.role='leader' and l.user_id=${actor} where e.user_id=a.user_id))`;
      if(!account){
        const id=await create();
        await tx`insert into cwl.accounts(user_id,email,created_by) values(${id},${email},${actor})`;
        account={user_id:id};
      }
      const [existing]=await tx`select role from cwl.memberships where user_id=${account.user_id} and clan_tag=${tag}`;
      requireCondition(!existing,409,'Esta conta já tem acesso ao clã.','access_exists');
      const [stillLeader]=await tx`select role from cwl.memberships where user_id=${actor} and clan_tag=${tag}`;
      requireCondition(stillLeader?.role==='leader',403,'A permissão de liderança foi removida.','leader_required');
      await tx`insert into cwl.memberships(user_id,clan_tag,role,created_by) values(${account.user_id},${tag},'coLeader',${actor})`;
      await tx`insert into cwl.access_events(id,actor_id,user_id,clan_tag,action) values(${crypto.randomUUID()},${actor},${account.user_id},${tag},'grant')`;
      return {ok:true};
    }),
    remove:(env,actor,tag,id)=>transaction(env,actor,tag,async tx=>{
      const [target]=await tx`select role from cwl.memberships where user_id=${id} and clan_tag=${tag}`;
      requireCondition(target,404,'Conta não encontrada neste clã.');
      requireCondition(id!==actor&&target.role==='coLeader',403,'Contas de líder são administradas pelo banco.','protected_leader');
      const removed=await tx`delete from cwl.memberships where user_id=${id} and clan_tag=${tag} and role='coLeader' returning user_id`;
      requireCondition(removed.length===1,409,'O acesso foi alterado. Atualize a lista.');
      await tx`insert into cwl.access_events(id,actor_id,user_id,clan_tag,action) values(${crypto.randomUUID()},${actor},${id},${tag},'revoke')`;
      return {ok:true};
    })
  };
}
