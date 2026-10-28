(function(){
  'use strict';
  const esc=window.WarEngine.esc;
  const dialog=document.querySelector('#users-dialog'),body=document.querySelector('#users-body');
  const state={clans:[],clan:'',users:[],busy:false,error:'',notice:'',remove:null};
  function render(){
    body.innerHTML=`<p class="leader-intro">Cadastre colíderes para preparar e ajustar os planos. A remoção encerra o acesso ao clã selecionado, preservando outros clãs.</p>
      <label class="field"><span>Clã administrado</span><select id="users-clan" ${state.busy?'disabled':''}>${state.clans.map(tag=>`<option value="${esc(tag)}" ${state.clan===tag?'selected':''}>#${esc(tag)}</option>`).join('')}</select></label>
      ${state.error?`<p class="leader-error" role="alert">${esc(state.error)}</p>`:''}
      ${state.notice?`<p class="users-notice" role="status">${esc(state.notice)}</p>`:''}
      <div class="users-list" aria-busy="${state.busy}">${state.users.map(user=>`<article class="user-access-row"><div><strong>${esc(user.email)}</strong><small>${user.role==='leader'?'Líder · administrada pelo banco':'Colíder'}</small></div>${user.role==='coLeader'?state.remove===user.id?`<div class="user-remove-confirm" role="alert"><p>Remover o acesso de ${esc(user.email)} ao clã #${esc(state.clan)}?</p><div><button class="button danger" type="button" data-user-confirm="${esc(user.id)}" ${state.busy?'disabled':''}>Remover acesso</button><button class="button secondary" type="button" data-user-cancel ${state.busy?'disabled':''}>Cancelar</button></div></div>`:`<button class="button secondary" type="button" data-user-remove="${esc(user.id)}" ${state.busy?'disabled':''}>Remover</button>`:''}</article>`).join('')}${!state.users.length&&!state.busy?'<p>Nenhuma conta cadastrada neste clã.</p>':''}</div>
      ${state.busy?'<p role="status">Aguarde…</p>':''}
      <form id="user-create-form"><h3>Cadastrar colíder</h3><label class="field"><span>Email</span><input type="email" name="email" autocomplete="off" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required ${state.busy?'disabled':''}></label><label class="field"><span>Senha inicial</span><input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="1024" required ${state.busy?'disabled':''}><small>Pelo menos 12 caracteres. Compartilhe a senha com a pessoa por um canal privado; ela poderá alterá-la em Liderança. Para uma conta já cadastrada por você, a senha existente será preservada.</small></label><button class="button primary" ${state.busy?'disabled':''}>Cadastrar no clã</button></form>`;
  }
  async function load(){const result=await window.ClanAPI.listUsers(state.clan);state.users=result.users;}
  async function run(fn,notice){
    if(state.busy)return;
    state.busy=true;state.error='';state.notice='';render();
    try{await fn();state.remove=null;await load();state.notice=notice||'';}
    catch(error){state.error=error.message;}
    finally{state.busy=false;render();}
  }
  function close(){if(state.busy)return;dialog.close();state.users=[];state.remove=null;body.innerHTML='';document.querySelector('#leader-access').focus();}
  document.querySelector('#close-users').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  body.addEventListener('change',event=>{if(event.target.id==='users-clan'&&!state.busy){state.clan=event.target.value;state.users=[];state.remove=null;run(async()=>{});}});
  body.addEventListener('submit',event=>{
    if(event.target.id!=='user-create-form')return;
    event.preventDefault();const values=new FormData(event.target);
    const payload={clanTag:state.clan,email:String(values.get('email')||'').trim(),password:String(values.get('password')||'')};
    run(()=>window.ClanAPI.createUser(payload),'Acesso de colíder cadastrado.');
  });
  body.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled||state.busy)return;
    if(b.hasAttribute('data-user-remove')){state.remove=b.dataset.userRemove;state.notice='';render();body.querySelector('[data-user-confirm]')?.focus();}
    if(b.hasAttribute('data-user-cancel')){state.remove=null;render();}
    if(b.hasAttribute('data-user-confirm')){const payload={clanTag:state.clan,userId:b.dataset.userConfirm};run(()=>window.ClanAPI.removeUser(payload),'Acesso removido deste clã.');}
  });
  window.UserAccess={open(editor,tag){
    if(state.busy||dialog.open)return;
    state.clans=editor.leaderClanTags|| (editor.role==='leader'?(editor.clanTags||[editor.clanTag]):[]);
    if(!state.clans.length)return;
    state.clan=state.clans.includes(tag)?tag:state.clans[0];state.users=[];state.remove=null;
    dialog.showModal();run(async()=>{});
  }};
})();
