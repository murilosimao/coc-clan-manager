/* Leadership writes require a server-validated session; visitors only read saved plans. */
(function () {
  'use strict';
  const state = { clanTag: '', season: new Date().toISOString().slice(0, 7), rounds: [], selectedStart: '',
    plan: null, ranking: null, rankingFetchedAt: '', syncWarning: '', activeTab: 'plan', query: '', loading: '', error: '', demo: false, demoEditMode: false, demoTargetEditorTag: '', demoEditSnapshot: null, demoCancelConfirm: false, leader: false,
    editor:null,saveBusy:false,missingPlan:false,loginUrl:null };
  let active = false, generation = 0, loaded = false, demoData = null;
  const demoPlans = new Map();
  let onUpdate = () => {}, onExport = () => {}, onLogin = () => {};
  const openDetails = new Set();
  const container = () => document.getElementById('cwl-view');
  const canEdit=()=>state.demo||(state.editor?.clanTags||[state.editor?.clanTag]).includes(state.clanTag)&&['leader','coLeader'].includes(state.editor.role);
  function centerSelectedRound(root) {
    const rail = root?.querySelector('.cwl-rounds'), selected = rail?.querySelector('[aria-pressed="true"]');
    if (rail && selected && rail.clientWidth) {
      const railBox = rail.getBoundingClientRect(), selectedBox = selected.getBoundingClientRect();
      rail.scrollLeft += selectedBox.left - railBox.left - (railBox.width - selectedBox.width) / 2;
    }
  }
  window.addEventListener('resize', () => centerSelectedRound(container()));
  function render() {
    const root = container(); if (!root || !window.CwlUI) return;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const id = focused?.id, selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    root.querySelectorAll('details[data-cwl-detail]').forEach(d => { if (d.open) openDetails.add(d.dataset.cwlDetail); else openDetails.delete(d.dataset.cwlDetail); });
    root.innerHTML = window.CwlUI.render(state);
    root.querySelectorAll('details[data-cwl-detail]').forEach(d => { d.open = openDetails.has(d.dataset.cwlDetail); });
    root.querySelectorAll('[role="tab"]').forEach(t => { t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
    centerSelectedRound(root);
    if (id) {
      const next = document.getElementById(id); next?.focus({ preventScroll: true });
      if (selection && next?.setSelectionRange && next.type !== 'month') next.setSelectionRange(...selection);
    }
    onUpdate();
  }
  async function demonstration() {
    if (!demoData) {
      const response = await fetch('portal/cwl-demo.json', { credentials: 'omit' });
      if (!response.ok) throw new Error('A demonstração da Liga está indisponível.');
      demoData = await response.json();
    }
    return demoData;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  async function demonstrationPlan(start) {
    const demo = await demonstration();
    if (!demoPlans.has(start)) {
      const source = demo.plans.find(p => p.warStart === start);
      if (source) {
        const plan = clone(source);
        plan.demoBaseAssignments = clone(plan.effective?.assignments || plan.current?.assignments || []);
        demoPlans.set(start, plan);
      }
    }
    return demoPlans.get(start) || null;
  }
  function demoDraftCount(plan) {
    if (!plan?.current?.assignments?.length) return 0;
    const active = new Map((plan.effective?.assignments || []).map(m => [m.attackerTag, m]));
    return plan.current.assignments.filter(m => {
      const approved = active.get(m.attackerTag);
      return !approved || approved.defenderTag !== m.defenderTag || Number(approved.goalStars) !== Number(m.goalStars);
    }).length;
  }
  function updateDemoMission(field) {
    if (!canEdit() || !state.plan || state.plan.warState === 'warEnded' || state.saveBusy) return;
    const attackerTag = field.dataset.attackerTag;
    if (state.plan.outcomes?.some(hit => hit.attackerTag === attackerTag)) return;
    const mission = state.plan.current?.assignments?.find(m => m.attackerTag === attackerTag);
    if (!mission) return;
    if (field.dataset.cwlDemoField === 'target') {
      const target = state.plan.initial?.opponentParticipants?.find(p => p.tag === field.value);
      if (!target) return;
      mission.defenderTag = target.tag;
      mission.defenderName = target.name;
      mission.defenderCV = target.th ?? target.townhallLevel ?? mission.defenderCV;
    } else if (field.dataset.cwlDemoField === 'goal') {
      const goal = Number(field.value);
      if (![1, 2, 3].includes(goal)) return;
      mission.goalStars = goal;
    } else return;
    const changed = demoDraftCount(state.plan) > 0;
    state.plan.current.approved = !changed;
    state.demoTargetEditorTag = '';
    render();
  }
  function activateDemoDraft() {
    if(!state.demo){void saveLivePlan();return;}
    if (!state.demo || !state.plan || !state.plan.current || !demoDraftCount(state.plan)) return;
    const revision = Math.max(Number(state.plan.currentRevision) || 0, Number(state.plan.effective?.revision || 0) + 1);
    state.plan.effective = { revision, assignments: clone(state.plan.current.assignments) };
    state.plan.current.approved = true;
    state.plan.currentRevision = revision;
    state.plan.demoLocalAppliedOnce = true;
    state.demoEditMode = false;
    state.demoTargetEditorTag = '';
    state.demoEditSnapshot = null;
    state.demoCancelConfirm = false;
    render();
    container()?.querySelector('#cwl-demo-edit-toggle')?.focus({ preventScroll: true });
  }
  function discardDemoEdits() {
    if (!state.plan?.current || !state.demoEditSnapshot) return;
    state.plan.current.assignments = clone(state.demoEditSnapshot.assignments);
    state.plan.current.approved = state.demoEditSnapshot.approved;
    state.demoEditMode = false;
    state.demoTargetEditorTag = '';
    state.demoEditSnapshot = null;
    state.demoCancelConfirm = false;
    render();
    container()?.querySelector('#cwl-demo-edit-toggle')?.focus({ preventScroll: true });
  }
  function resetDemoPlan() {
    if (!state.demo || !state.selectedStart || !demoData) return;
    const source = demoData.plans.find(p => p.warStart === state.selectedStart);
    if (!source) return;
    state.plan = clone(source);
    state.demoEditMode = false;
    state.demoTargetEditorTag = '';
    state.demoEditSnapshot = null;
    state.demoCancelConfirm = false;
    state.plan.demoBaseAssignments = clone(state.plan.effective?.assignments || state.plan.current?.assignments || []);
    demoPlans.set(state.selectedStart, state.plan);
    render();
  }
  function message(error) { return error?.message || 'Não foi possível consultar a Liga. Tente novamente.'; }
  async function saveLivePlan(){
    if(!canEdit()||state.demo||!state.plan||state.saveBusy)return;
    const token=generation,clan=state.clanTag,start=state.selectedStart;
    state.saveBusy=true;state.error='';render();
    try{
      const plan=await window.ClanAPI.reviseCwlPlan(clan,start,{expectedRevision:state.plan.currentRevision,approve:true,
        assignments:state.plan.current.assignments.map(m=>({attackerTag:m.attackerTag,defenderTag:m.defenderTag,goalStars:m.goalStars})),reason:'Plano conferido pela liderança no aplicativo'});
      if(token!==generation)return;state.plan=plan;state.demoEditMode=false;state.demoEditSnapshot=null;state.demoTargetEditorTag='';
    }catch(error){if(token===generation)state.error=message(error);}finally{if(token===generation){state.saveBusy=false;render();}}
  }
  async function preparePlan(){
    if(!canEdit()||state.demo||!state.selectedStart||state.loading)return;
    const token=++generation,clan=state.clanTag,start=state.selectedStart;
    state.loading='Buscando o confronto…';state.error='';render();
    try{
      let last=0;
      const result=await window.CwlCompute.calculate({clanTag:clan,start,apiOrigin:window.ClanAPI.cwlApiOrigin},p=>{
        if(token!==generation)return;
        if(p.stage==='history'&&performance.now()-last<80)return;last=performance.now();
        state.loading=p.stage==='compute'?'Calculando scores e distribuindo alvos neste aparelho…':p.stage==='archive'?'Preparando o registro do cálculo…':`Consultando fontes: ${p.completed} de ${p.requests} respostas recebidas…`;render();
      });
      if(token!==generation)return;
      state.loading='Salvando a proposta para revisão da liderança…';render();
      const saved=await window.ClanAPI.initializeCwlPlan(clan,start,result.archive);
      if(token!==generation)return;state.plan=saved;state.missingPlan=false;await fetchRanking(token);
    }catch(error){if(token===generation&&error.name!=='AbortError')state.error=message(error);}
    finally{if(token===generation){state.loading='';render();}}
  }
  function authMessage(error){
    if(error?.code==='auth_failed'&&error.status===401)return 'Email ou senha incorretos. Confira e tente novamente.';
    if(error?.code==='editor_forbidden')return 'Esta conta não tem acesso de liderança. Peça a liberação para quem administra o aplicativo.';
    if(error?.status===503)return 'O acesso da liderança está indisponível agora. Tente novamente em alguns minutos.';
    return message(error);
  }
  async function signIn(email,password){
    try{const session=await window.ClanAPI.loginCwl(email,password);state.editor=session.editor||null;}
    catch(error){throw new Error(authMessage(error));}
    if(active)void loadSeason();else{loaded=false;render();}
    return state.editor;
  }
  async function signOut(){
    if(state.demoEditMode||state.saveBusy)throw new Error('Salve ou cancele a edição do plano antes de sair.');
    if(state.loading)throw new Error('Aguarde a consulta da Liga terminar antes de sair.');
    try{await window.ClanAPI.logoutCwl();}catch(error){throw new Error(message(error));}
    state.editor=null;render();
  }
  async function loadSession(){
    if(state.demo)return;
    try{const session=await window.ClanAPI.loadCwlSession();state.editor=session.editor||null;}catch{state.editor=null;}
    render();
  }
  async function fetchRanking(token) {
    state.loading = 'Conferindo o mérito e os resultados da edição…'; render();
    if (state.demo) {
      const demo = await demonstration(); if (token !== generation) return;
      state.ranking = demo.ranking; state.rankingFetchedAt = new Date().toISOString(); render(); return;
    }
    const analytics = await window.ClanAPI.loadCwlAnalytics(state.clanTag, state.season);
    if (token !== generation) return;
    state.ranking = analytics.ranking; state.rankingFetchedAt = new Date().toISOString(); render();
    const oldDays = (analytics.rounds || []).filter(r => {
      const source = state.rounds.find(s => s.warStart === r.warStart);
      const endedAt = source?.endTime ? window.ClashKing.timestamp(source.endTime) : NaN;
      return r.warStart !== state.selectedStart && r.metrics?.missed === null
        && (source?.state === 'warEnded' || Number.isFinite(endedAt) && endedAt < Date.now());
    });
    if (!oldDays.length) return;
    state.loading = `Conferindo os resultados de ${oldDays.length} ${oldDays.length === 1 ? 'dia já acompanhado' : 'dias já acompanhados'}…`; render();
    // Only existing plans are revisited. Never generate untracked historical days here.
    const updates = await Promise.allSettled(oldDays.map(r => window.ClanAPI.loadCwlPlan(state.clanTag, r.warStart)));
    if (token !== generation) return;
    const incomplete = updates.filter(r => r.status === 'rejected' || r.value.trackingWarning || r.value.warState !== 'warEnded').length;
    if (incomplete) state.syncWarning = `${incomplete} ${incomplete === 1 ? 'dia acompanhado ainda depende' : 'dias acompanhados ainda dependem'} de confirmação da fonte. O ranking preserva os últimos registros disponíveis.`;
    const ranking = await window.ClanAPI.loadCwlRanking(state.clanTag, state.season);
    if (token !== generation) return;
    state.ranking = ranking; state.rankingFetchedAt = new Date().toISOString(); render();
  }
  async function fetchRound(start, token) {
    state.loading = 'Carregando o plano salvo ou preparando a primeira proposta…'; render();
    let plan;
    try{plan=state.demo?await demonstrationPlan(start):await window.ClanAPI.loadCwlPlan(state.clanTag,start);state.missingPlan=false;}
    catch(error){if(error.status===404&&error.code==='plan_not_found'){plan=null;state.missingPlan=true;}else throw error;}
    if (token !== generation) return;
    state.plan = plan || null; render();
    // A first plan GET can create this day's records. Read ranking after it commits.
    await fetchRanking(token);
    if (token === generation) loaded = true;
  }
  async function loadSeason() {
    const token = ++generation;
    state.loading = 'Buscando as guerras disponíveis nesta edição…'; state.error = ''; state.syncWarning = ''; render();
    try {
      if(!state.demo){
        try{const session=await window.ClanAPI.loadCwlSession();if(token!==generation)return;state.editor=session.editor||null;}
        catch{if(token===generation)state.editor=null;}
      }
      const result = state.demo ? await demonstration() : await window.ClanAPI.loadCwlSeason(state.clanTag, state.season);
      if (token !== generation) return;
      if (state.demo) state.season = result.season;
      state.rounds = result.rounds || [];
      const existing = state.rounds.find(r => r.warStart === state.selectedStart);
      const selected = existing || state.rounds.find(r => ['inWar', 'preparation'].includes(r.state)) || state.rounds.at(-1);
      state.selectedStart = selected?.warStart || '';
      if (state.plan?.warStart !== state.selectedStart) state.plan = null;
      render();
      if (selected) await fetchRound(selected.warStart, token);
      else { state.plan = null; await fetchRanking(token); }
      if (token === generation) loaded = true;
    } catch (error) { if (token === generation) state.error = message(error); }
    finally { if (token === generation) { state.loading = ''; render(); } }
  }
  async function selectRound(start) {
    if(state.demoEditMode||state.saveBusy)return;
    if (!state.rounds.some(r => r.warStart === start)) return;
    const token = ++generation;
    window.CwlCompute?.cancel();
    state.selectedStart = start; state.plan = null; state.error = ''; state.syncWarning = ''; state.query = ''; state.demoTargetEditorTag = '';
    try { await fetchRound(start, token); }
    catch (error) { if (token === generation) state.error = message(error); }
    finally { if (token === generation) { state.loading = ''; render(); } }
  }
  function setContext(clanTag, demo = false) {
    if (state.clanTag === clanTag && state.demo === demo) return;
    generation++; loaded = false; clearDetails(); demoPlans.clear();
    window.CwlCompute?.cancel();
    Object.assign(state, { clanTag, demo, demoEditMode: false, demoTargetEditorTag: '', demoEditSnapshot: null, demoCancelConfirm: false, rounds: [], selectedStart: '', plan: null, ranking: null, rankingFetchedAt: '', syncWarning: '', loading: '', error: '', query: '',saveBusy:false,missingPlan:false });
    render(); if (active) void loadSeason();
  }
  function clearDetails() {
    openDetails.clear(); container()?.querySelectorAll('details[open]').forEach(d => { d.open = false; });
  }
  function switchTab(tab) {
    if (!['plan', 'ranking'].includes(tab)) return;
    state.activeTab = tab; state.query = ''; render();
    container().querySelector(`[data-cwl-action="tab"][data-tab="${state.activeTab}"]`)?.focus({ preventScroll: true });
  }
  function init({ clanTag, demo = false, activeTab = 'plan', onChange = () => {}, exportData = () => {}, requestLogin = () => {} }) {
    onUpdate = onChange; onExport = exportData; onLogin = requestLogin; state.activeTab = activeTab === 'ranking' ? 'ranking' : 'plan';
    state.loginUrl=window.ClanAPI.cwlLoginUrl;
    setContext(clanTag, demo);
    container().addEventListener('click', event => {
      const button = event.target.closest('[data-cwl-action]'); if (!button || button.disabled) return;
      const action = button.dataset.cwlAction;
      if (action === 'tab') {
        switchTab(button.dataset.tab);
      } else if (action === 'round') void selectRound(button.dataset.start);
      else if (action === 'demo-activate') activateDemoDraft();
      else if (action === 'demo-reset') resetDemoPlan();
      else if (action === 'prepare') void preparePlan();
      else if (action === 'login') onLogin();
      else if (action === 'demo-edit-toggle' && canEdit() && state.plan?.current) { state.demoEditSnapshot = { assignments: clone(state.plan.current.assignments), approved: state.plan.current.approved }; state.demoEditMode = true; state.demoTargetEditorTag = ''; render(); container().querySelector('#cwl-demo-cancel')?.focus({ preventScroll: true }); }
      else if (action === 'demo-cancel' && state.demoEditMode&&!state.saveBusy) { state.demoCancelConfirm = true; render(); container().querySelector('#cwl-demo-cancel-continue')?.focus({ preventScroll: true }); }
      else if (action === 'demo-cancel-continue' && state.demoCancelConfirm) { state.demoCancelConfirm = false; render(); container().querySelector('#cwl-demo-cancel')?.focus({ preventScroll: true }); }
      else if (action === 'demo-cancel-confirm' && state.demoCancelConfirm) discardDemoEdits();
      else if (action === 'demo-target-toggle' && canEdit() && state.demoEditMode) { state.demoTargetEditorTag = state.demoTargetEditorTag === button.dataset.attackerTag ? '' : button.dataset.attackerTag; render(); }
      else if (['refresh', 'retry'].includes(action)) void loadSeason();
      else if (action === 'export') onExport();
    });
    container().addEventListener('keydown', event => {
      if (state.demoCancelConfirm && event.key === 'Escape') { event.preventDefault(); state.demoCancelConfirm = false; render(); container().querySelector('#cwl-demo-cancel')?.focus({ preventScroll: true }); return; }
      if (state.demoCancelConfirm && event.key === 'Tab') {
        const actions = Array.from(container().querySelectorAll('.cwl-confirm-dialog [data-cwl-action]'));
        if (actions.length) {
          const first = actions[0], last = actions.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      switchTab(event.key === 'Home' ? 'plan' : event.key === 'End' ? 'ranking' : event.target.dataset.tab === 'plan' ? 'ranking' : 'plan');
    });
    container().addEventListener('change', event => {
      if (event.target.matches('[data-cwl-demo-field]')) { updateDemoMission(event.target); return; }
      if (event.target.id !== 'cwl-season') return;
      if(state.demoEditMode||state.saveBusy)return;
      const season = event.target.value;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(season)) { event.target.reportValidity(); return; }
      if (state.demo || season === state.season) return;
      generation++; loaded = false; clearDetails();
      Object.assign(state, { season, rounds: [], selectedStart: '', plan: null, ranking: null, rankingFetchedAt: '', syncWarning: '', error: '', query: '' });
      void loadSeason();
    });
    container().addEventListener('input', event => {
      if (event.target.id === 'cwl-query') { state.query = event.target.value; render(); }
    });
  }
  function exportRows() {
    const query = state.query.trim().toLocaleLowerCase('pt-BR');
    const matches = values => !query || values.some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(query));
    if (state.activeTab === 'ranking') {
      const rows = (state.ranking?.entries || []).filter(p => matches([p.name, p.tag])).map(p => [p.rank, p.name, '#' + p.tag,
        p.meritScore, p.assessedOpportunities, p.fulfilled, p.averageCreditedStars, p.averageDestruction, p.averageDuration, p.status]);
      return rows.length ? [['Posição', 'Jogador', 'Tag', 'Mérito', 'Oportunidades avaliadas', 'Missões cumpridas', 'Média estrelas novas', 'Destruição média (%)', 'Duração média (s)', 'Situação'], ...rows] : [];
    }
    const plan = state.plan; if (!plan || !canEdit() && !plan.effective && !plan.retrospective) return [];
    const assignments = plan.effective?.assignments || plan.current?.assignments || plan.initial?.assignments || [];
    const rows = (plan.initial?.participants || []).flatMap(p => {
      const hit = plan.outcomes?.find(h => h.attackerTag === p.tag);
      const mission = hit ? hit.mission : assignments.find(m => m.attackerTag === p.tag);
      const actualTarget = plan.initial?.opponentParticipants?.find(m => m.tag === hit?.defenderTag);
      if (!matches([p.name, p.tag, mission?.defenderName, mission?.defenderTag, hit?.defenderTag, actualTarget?.name])) return [];
      return [[p.name, '#' + p.tag, p.th, mission?.defenderName, mission?.defenderTag ? '#' + mission.defenderTag : '',
        plan.retrospective ? '' : mission?.goalStars, plan.retrospective ? 'Histórico sem missão' : hit && !hit.mission ? 'Ataque sem missão atribuída' : state.demo && plan.demoLocalAppliedOnce ? 'Simulação local' : plan.effective ? 'Missão aprovada' : 'Proposta sem aprovação',
        hit?.defenderTag ? '#' + hit.defenderTag : '', hit?.stars, hit?.addedStars, hit?.destruction, hit?.durationSeconds]];
    });
    return rows.length ? [['Atacante', 'Tag', 'CV', 'Alvo do plano', 'Tag do alvo', 'Meta (estrelas)', 'Tipo de plano', 'Alvo realmente atacado', 'Estrelas do ataque', 'Estrelas novas', 'Destruição (%)', 'Duração (s)'], ...rows] : [];
  }
  const tsvCell = value => {
    const text = value == null ? '' : typeof value === 'number' ? value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 6 }) : String(value).replace(/[\t\r\n]/g, ' ');
    return /^[=+@-]/.test(text) ? "'" + text : text;
  };
  window.CwlApp = { init, state, setContext, signIn, signOut, loadSession, canEdit,
    setActive(value) { active = value; if (active && !loaded && !state.loading) void loadSeason(); },
    canCopy: () => exportRows().length > 1,
    exportTSV: () => exportRows().map(row => row.map(tsvCell).join('\t')).join('\r\n'),
    refresh: () => {if(state.demoEditMode){state.error='Salve ou cancele a edição antes de atualizar o plano.';render();return;}return loadSeason();} };
})();
