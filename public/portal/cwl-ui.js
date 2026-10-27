/* CWL presentation: live data comes from the API; demo edits stay in the local example. */
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const canEdit=state=>state.demo||state.editor?.clanTag===state.clanTag&&['leader','coLeader'].includes(state.editor.role);
  function loginAction(state){
    if(state.loginUrl)return `<a class="button primary" href="${esc(state.loginUrl+'&clan='+encodeURIComponent(state.clanTag)+'&login=1')}">${icon('crown')}<span>Entrar como liderança</span></a>`;
    return `<button type="button" class="button primary" data-cwl-action="login">${icon('crown')}<span>Entrar como liderança</span></button>`;
  }
  const known = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const number = (value, digits = 1) => known(value) ? Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const percent = value => known(value) ? `${number(Number(value) * 100, 0)}%` : '—';
  const tag = value => value ? '#' + String(value).replace(/^#/, '') : 'Tag não informada';
  const date = (value, includeTime = false) => {
    const normalized = String(value || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/, '$1-$2-$3T$4:$5:$6.$7Z');
    const d = new Date(normalized);
    if (!Number.isFinite(d.getTime())) return 'Data não informada';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
  };
  const duration = value => known(value) ? `${Math.floor(Math.round(Number(value)) / 60)}min ${Math.round(Number(value)) % 60}s` : 'Não informado';
  const stars = (value, label = 'estrelas') => known(value) ? `<span class="cwl-stars" aria-label="${esc(value)} ${label}">${number(value, 0)}${icon('star')}</span>` : '<span class="cwl-unknown">—</span>';
  function attackStars(value) {
    if (!known(value)) return '<span class="cwl-unknown">—</span>';
    const count = Math.max(0, Math.min(3, Math.round(Number(value))));
    return `<span class="cwl-attack-stars" role="img" aria-label="${count} de 3 estrelas">${[1, 2, 3].map(star => `<span class="cwl-attack-star${star <= count ? ' is-earned' : ''}">${icon('star')}</span>`).join('')}</span>`;
  }
  function attackFacts(hit) {
    const destruction = hit.destruction ?? hit.observedDestruction;
    const durationSeconds = hit.durationSeconds ?? hit.observedDurationSeconds;
    const time = known(durationSeconds) ? `${Math.floor(Math.round(Number(durationSeconds)) / 60)}m ${Math.round(Number(durationSeconds)) % 60}s` : '—';
    return `<div class="cwl-attack-facts"><span class="cwl-attack-fact" aria-label="Destruição ${known(destruction) ? `${number(destruction, 0)}%` : 'não informada'}"><b>${known(destruction) ? `${number(destruction, 0)}%` : '—'}</b><small>destruição</small></span><span class="cwl-attack-fact" aria-label="Duração ${esc(time)}">${icon('clock')}<b>${esc(time)}</b></span></div>`;
  }
  const statusTag = (text, tone = '') => `<span class="cwl-tag ${tone ? `is-${tone}` : ''}">${tone === 'surpassed' ? icon('star') : ''}${esc(text)}</span>`;
  const stateNames = { preparation: 'Preparação', inWar: 'Em guerra', warEnded: 'Encerrada' };
  const meritStatuses = {
    fulfilled: ['Missão cumprida', 'success'], surpassed: ['Meta superada', 'surpassed'], below_goal: ['Abaixo da meta', 'warning'],
    wrong_target: ['Alvo diferente', 'danger'], missed: ['Ataque não usado', 'danger'], pending: ['Aguardando ataque', ''],
    needs_review: ['Atribuição pendente', 'warning'], before_plan: ['Ataque anterior ao plano', ''],
    unapproved: ['Sem missão aprovada', ''], retrospective: ['Registro histórico', ''], obsolete_mission: ['Meta já resolvida', ''],
  };
  const th = value => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 18 ? `<span class="cwl-th"><img src="portal/images/townhalls/th${n}.webp" alt="" width="34" height="34" loading="lazy"><span>CV ${n}</span></span>` : `<span class="cwl-th">CV ${known(value) ? esc(value) : '—'}</span>`;
  };
  const empty = (title, body, action = '') => `<div class="cwl-empty">${icon('flag')}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
  const button = (action, text, attrs = '') => `<button type="button" class="button secondary" data-cwl-action="${action}" ${attrs}>${esc(text)}</button>`;

  function header(state) {
    const season = /^\d{4}-(0[1-9]|1[0-2])$/.test(state.season || '') ? state.season : '';
    const query = String(state.query || '').trim().toLocaleLowerCase('pt-BR');
    const ranking = state.ranking?.ranking || state.ranking;
    const assignments = state.plan?.effective?.assignments || state.plan?.current?.assignments || [];
    const rows = state.activeTab === 'ranking' ? ranking?.entries || [] : state.plan?.initial?.participants || [];
    const canExport = (state.activeTab === 'ranking' || canEdit(state) || state.plan?.effective || state.plan?.retrospective) && rows.some(p => { const hit = state.plan?.outcomes?.find(h => h.attackerTag === p.tag); const m = hit && !state.plan?.retrospective ? hit.mission : assignments.find(m => m.attackerTag === p.tag); return !query || (state.activeTab === 'ranking' ? [p.name, p.tag] : [p.name, p.tag, m?.defenderName, m?.defenderTag]).some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(query)); });
    return `<div class="cwl-header"><div><h2 id="cwl-title" tabindex="-1">Liga de Guerra de Clãs</h2><p>Alvos, missões e mérito.</p></div><div class="cwl-toolbar"><label class="cwl-season-field" for="cwl-season"><span>Edição</span><input type="month" id="cwl-season" value="${esc(season)}" aria-label="Edição da Liga de Guerra de Clãs" ${state.demo||state.demoEditMode ? 'disabled' : ''}></label><button type="button" class="button secondary" data-cwl-action="refresh" ${state.loading||state.demoEditMode ? 'disabled' : ''}>${icon('refresh')}<span>Atualizar CWL</span></button><button type="button" class="button secondary cwl-export" data-cwl-action="export" ${state.loading || !canExport ? 'disabled' : ''}>${icon('copy')}<span>Copiar TSV</span></button></div></div>`;
  }
  function tabs(activeTab) {
    return `<div class="cwl-tabs" role="tablist" aria-label="Informações da CWL"><button type="button" id="cwl-tab-plan" role="tab" aria-selected="${activeTab === 'plan'}" aria-controls="cwl-panel" data-cwl-action="tab" data-tab="plan">${icon('swords')}Plano do dia</button><button type="button" id="cwl-tab-ranking" role="tab" aria-selected="${activeTab === 'ranking'}" aria-controls="cwl-panel" data-cwl-action="tab" data-tab="ranking">${icon('flag')}Ranking dos jogadores</button></div>`;
  }
  function roundsList(state) {
    if (!state.rounds?.length) return '';
    return `<div class="cwl-round-picker"><p>Confrontos registrados nesta edição</p><div class="cwl-rounds" aria-label="Escolher confronto">${state.rounds.map(round => {
      const selected = round.warStart === state.selectedStart;
      return `<button type="button" class="cwl-round ${selected ? 'is-selected' : ''}" data-cwl-action="round" data-start="${esc(round.warStart)}" aria-pressed="${selected}" ${state.demoEditMode ? 'disabled title="Salve ou cancele a edição antes de trocar de confronto"' : ''}><span>${esc(date(round.warStart))}</span><strong>${esc(round.opponent?.name || tag(round.opponent?.tag))}</strong><small>${esc(stateNames[round.state] || 'Estado não informado')}</small></button>`;
    }).join('')}</div></div>`;
  }
  function guide(state = {}) {
    const ranking = state.ranking?.ranking || state.ranking;
    const coverage = ranking ? `${number(ranking.recordedRounds, 0)} confrontos acompanhados${state.rounds?.length ? `, de ${state.rounds.length} encontrados nesta consulta` : ''}.` : 'O histórico disponível pode não cobrir toda a edição.';
    return `<details class="cwl-guide" data-cwl-detail="guide"><summary>${icon('sliders')}Como ler as notas e as missões${icon('chevron')}</summary><div class="cwl-guide-content"><p><strong>ATQ e DEF</strong> são notas relativas de 0 a 100, calculadas com o histórico disponível: ATQ indica a capacidade de ataque; DEF, a resistência estimada do alvo. Quanto maior, mais forte a capacidade indicada. Não são porcentagens nem garantem um resultado. Com pouco histórico, a nota pode ser apenas uma referência.</p><p><strong>Meta</strong> é o número de estrelas desejado naquele alvo, não um limite para o ataque. Uma meta de 1 estrela significa que uma estrela é suficiente para cumprir a missão; mais estrelas podem superar a meta.</p><p><strong>Mérito</strong> avalia o que foi entregue na edição, respeitando a missão aprovada. Destruição e tempo servem para desempatar.</p><p><strong>Cobertura:</strong> ${coverage} A cobertura pode não incluir toda a Liga. A distribuição de bônus continua sob decisão da líder.</p><p><strong>Qual missão vale?</strong> Para ataques já registrados, vale a missão atribuída ao ataque. Para os próximos, a última aprovação; uma edição em rascunho não substitui as ordens aprovadas.</p><p>Guerras consultadas depois do fim permitem reconstruir propostas, mas não criam missões ou mérito retroativos.</p></div></details>`;
  }
  function inlineScore(label, value, context = {}) {
    const explanation = label === 'ATQ'
      ? 'ATQ é a nota relativa de ataque, de 0 a 100: quanto maior, maior a capacidade ofensiva estimada. Não é porcentagem nem garantia de estrelas.'
      : 'DEF é a nota relativa de defesa, de 0 a 100: quanto maior, mais resistente o alvo é estimado. Não é porcentagem nem garantia de resultado.';
    const score = known(value) ? number(value, 0) : 'sem dados';
    const evidence = label === 'ATQ' ? context?.attackEvidence : context?.defenseEvidence;
    const count = evidence?.count ?? context?.[label === 'ATQ' ? 'attackCount' : 'defenseCount'];
    const weight = evidence?.weight ?? context?.[label === 'ATQ' ? 'attackWeight' : 'defenseWeight'];
    const details = `${explanation}${evidence?.label ? ` ${evidence.label}.` : ''}${known(count) ? ` ${number(count, 0)} ${label === 'ATQ' ? 'ataques' : 'defesas'}; peso acumulado ${number(weight, 2)}.` : ' Evidência individual não informada.'}${known(evidence?.effectiveN) ? ` Amostra ponderada: ${number(evidence.effectiveN, 1)}.` : ''}${evidence?.level === 'reference' ? ' Nota de referência: ainda não mede desempenho individual.' : ''}`;
    return `<details class="cwl-score-help"><summary class="cwl-inline-score${known(value) ? '' : ' is-unknown'}${evidence?.level ? ` is-${esc(evidence.level)}` : ''}" data-evidence="${esc(evidence?.level || 'unspecified')}" aria-label="${esc(label)} ${esc(score)}. Toque para explicar"><span>${esc(label)}</span><b>${known(value) ? score : '—'}</b><span aria-hidden="true">ⓘ</span></summary><span class="cwl-score-tooltip" role="note">${esc(details)}</span></details>`;
  }
  function resultFor(hit, plan, assignment) {
    if (!hit) return plan.warState === 'warEnded' ? assignment && plan.effective ? ['Ataque não usado', 'danger'] : ['Sem avaliação de missão', ''] : ['Aguardando ataque', ''];
    if (plan.retrospective) return ['Registro histórico', ''];
    if (hit.missionFulfilled == null) return hit.attribution === 'unapproved' ? ['Sem missão aprovada', ''] : hit.attribution === 'before_plan' ? ['Ataque anterior ao plano', ''] : ['Atribuição pendente', 'warning'];
    return hit.targetFollowed === false ? ['Alvo diferente', 'danger'] : hit.missionFulfilled ? hit.missionSurpassed ? ['Meta superada', 'surpassed'] : ['Missão cumprida', 'success'] : ['Abaixo da meta', 'warning'];
  }
  function targetControl(participant, plan, state, draft, defender, targetMetrics) {
    const editable = canEdit(state) && state.demoEditMode && plan.warState !== 'warEnded' && draft
      && !plan.outcomes?.some(hit => hit.attackerTag === participant.tag);
    if (!editable) return `<strong>${esc(defender)}</strong>`;
    const id = `cwl-demo-target-${esc(participant.tag)}`;
    if (state.demoTargetEditorTag === participant.tag) {
      const options = (plan.initial?.opponentParticipants || []).map(opponent => {
        const score = targetMetrics.get(opponent.tag)?.defenseScore;
        return `<option value="${esc(opponent.tag)}" ${opponent.tag === draft.defenderTag ? 'selected' : ''}>${known(opponent.position) ? `#${esc(opponent.position)} · ` : ''}${esc(opponent.name || tag(opponent.tag))} · DEF ${known(score) ? number(score, 0) : '—'}</option>`;
      }).join('');
      return `<select id="${id}" class="cwl-target-select" data-cwl-demo-field="target" data-attacker-tag="${esc(participant.tag)}" aria-label="Escolher alvo para ${esc(participant.name || tag(participant.tag))}">${options}</select>`;
    }
    return `<button type="button" id="${id}" class="cwl-target-trigger" data-cwl-action="demo-target-toggle" data-attacker-tag="${esc(participant.tag)}" aria-label="Alterar alvo de ${esc(participant.name || tag(participant.tag))}">${esc(defender)}${icon('chevron')}</button>`;
  }
  function goalControl(participant, plan, state, mission, hit) {
    const editable = canEdit(state) && state.demoEditMode && plan.warState !== 'warEnded' && mission && !hit;
    if (!editable) return stars(mission?.goalStars);
    const goal = Number(mission.goalStars);
    return `<select id="cwl-demo-goal-${esc(participant.tag)}" class="cwl-goal-select" data-cwl-demo-field="goal" data-attacker-tag="${esc(participant.tag)}" aria-label="Meta de estrelas para ${esc(participant.name || tag(participant.tag))}">${[1, 2, 3].map(value => `<option value="${value}" ${value === goal ? 'selected' : ''}>${value} ${value === 1 ? 'estrela' : 'estrelas'}</option>`).join('')}</select>`;
  }
  function duplicateTargetWarning(defenderTag, attackerTag, assignments, names) {
    if (!defenderTag) return '';
    const duplicates = (assignments || []).filter(m => m.defenderTag === defenderTag && m.attackerTag !== attackerTag);
    if (!duplicates.length) return '';
    const otherNames = duplicates.map(m => m.attackerName || names.get(m.attackerTag) || tag(m.attackerTag));
    return `<span class="cwl-duplicate-warning" role="status" aria-label="Alvo duplicado com ${esc(otherNames.join(', '))}">${icon('alert')}<span>Alvo duplicado com ${esc(otherNames.join(', '))}</span></span>`;
  }
  function missionRow(participant, plan, assignments, names, state, targetMetrics) {
    const hit = plan.outcomes?.find(a => a.attackerTag === participant.tag);
    const approvedMission = hit && !plan.retrospective ? hit.mission : assignments.find(m => m.attackerTag === participant.tag);
    const draftMission = !hit && !plan.retrospective ? plan.current?.assignments?.find(m => m.attackerTag === participant.tag) : null;
    const mission = canEdit(state) && state.demoEditMode && draftMission ? draftMission : approvedMission;
    const attacker = mission?.attackerName || participant.name || tag(participant.tag);
    const actualFirst = Boolean(hit && (plan.retrospective || !mission));
    const proposedDefender = mission?.defenderName || (mission?.defenderTag ? names.get(mission.defenderTag) || tag(mission.defenderTag) : 'Sem alvo no plano');
    const defender = actualFirst ? names.get(hit.defenderTag) || tag(hit.defenderTag) : proposedDefender;
    const actualCandidate = actualFirst ? plan.initial?.opponentParticipants?.find(m => m.tag === hit.defenderTag) : null;
    const [result, tone] = resultFor(hit, plan, mission);
    const targetData = targetMetrics.get(mission?.defenderTag || hit?.defenderTag);
    const originalMission = plan.initial?.assignments?.find(m => m.attackerTag === participant.tag);
    const matchupChanged = Boolean(mission && originalMission && mission.defenderTag !== originalMission.defenderTag);
    const targetDefenseScore = targetData?.defenseScore ?? (matchupChanged ? null : mission?.defenseScore);
    const targetLabel = actualFirst ? 'Alvo atacado' : canEdit(state) && state.demoEditMode && draftMission ? 'Alvo · rascunho' : canEdit(state) && hit?.mission ? `Missão v${hit.missionRevision ?? '—'} · alvo` : state.demo && plan.demoLocalAppliedOnce ? 'Alvo simulado' : plan.effective ? 'Alvo aprovado' : 'Alvo proposto';
    const targetPosition = (actualFirst ? actualCandidate : plan.initial?.opponentParticipants?.find(m => m.tag === mission?.defenderTag))?.position ?? (actualFirst ? null : mission?.defenderPosition);
    const targetCV = actualFirst ? actualCandidate?.th : mission?.defenderCV;
    const targetEvidence = targetData || (matchupChanged ? {} : mission);
    const outsideRange = mission && known(mission.attackerCV) && known(targetCV) && Math.abs(mission.attackerCV - targetCV) > 3;
    const limitedEvidence = [mission?.attackEvidence, targetEvidence?.defenseEvidence].some(e => ['reference','limited'].includes(e?.level)) || mission?.warnings?.includes('small_model_sample');
    const evidenceNote = outsideRange ? 'CV fora da faixa validada · revisar meta' : limitedEvidence ? 'Histórico limitado · revisar missão' : '';
    const editable = Boolean(canEdit(state) && state.demoEditMode && draftMission && !hit && plan.warState !== 'warEnded');
    const targetAssignments = canEdit(state) && state.demoEditMode ? plan.current?.assignments || assignments : assignments;
    const duplicate = canEdit(state) ? duplicateTargetWarning(actualFirst ? hit.defenderTag : mission?.defenderTag, participant.tag, targetAssignments, names) : '';
    return `<div class="cwl-mission-item"><div class="cwl-mission-summary${editable ? ' is-editable' : ''}"><div class="cwl-person"><span class="cwl-person-label">Atacante${participant.position ? ` · #${esc(participant.position)}` : ''}</span><strong>${esc(attacker)}</strong><div class="cwl-person-data">${th(mission?.attackerCV ?? participant.th ?? participant.townhallLevel)}${mission ? inlineScore('ATQ', mission.attackScore, mission) : ''}</div></div><span class="cwl-versus" aria-hidden="true">→</span><div class="cwl-person cwl-defender"><span class="cwl-person-label">${targetLabel}${known(targetPosition) ? ` · #${esc(targetPosition)}` : ''}</span>${targetControl(participant, plan, state, draftMission, defender, targetMetrics)}<div class="cwl-person-data">${mission || actualFirst ? th(targetCV) : '<small>Ataque fora do planejamento inicial</small>'}${mission || actualFirst ? inlineScore('DEF', targetDefenseScore, targetEvidence) : ''}</div>${duplicate}${canEdit(state) && evidenceNote ? `<small class="cwl-evidence-note">${esc(evidenceNote)}</small>` : ''}</div><div class="cwl-plan-result"><div class="cwl-goal"><span>${plan.retrospective ? 'Missão oficial' : 'Meta'}</span>${goalControl(participant, plan, state, mission, hit)}</div><div class="cwl-outcome"><div class="cwl-outcome-result">${hit ? attackStars(hit.stars) : '—'}${statusTag(result, tone)}</div>${hit ? attackFacts(hit) : ''}</div></div></div></div>`;
  }
  function demoPlanControls(plan, state) {
    if (!plan || !plan.current || plan.warState==='warEnded') return '';
    const active = new Map((plan.effective?.assignments || []).map(m => [m.attackerTag, m]));
    const pending = (plan.current.assignments || []).filter(m => {
      const approved = active.get(m.attackerTag);
      return !approved || approved.defenderTag !== m.defenderTag || Number(approved.goalStars) !== Number(m.goalStars);
    }).length;
    const used = new Set((plan.outcomes || []).map(hit => hit.attackerTag));
    const editable = plan.warState === 'warEnded' ? 0 : (plan.current.assignments || []).filter(m => !used.has(m.attackerTag)).length;
    const locallyActive = Boolean(plan.demoLocalAppliedOnce && plan.current.approved);
    const status = state.demoEditMode
      ? `${editable} ${editable === 1 ? 'missão pendente está editável' : 'missões pendentes estão editáveis'} na lista. ${pending ? `${pending} com alterações em rascunho.` : 'Nenhuma alteração feita ainda.'} Ataques concluídos ficam bloqueados.`
      : locallyActive
        ? `Cenário local ativo na versão ${esc(plan.effective?.revision ?? plan.currentRevision)}. Notas e ranking permanecem sem recálculo.`
        : pending ? `${pending} ${pending === 1 ? 'missão em rascunho' : 'missões em rascunho'}. Use o botão “Editar” para alterar direto na lista.`
          : 'Sem alterações no rascunho. Você pode editar as missões pendentes direto na lista.';
    const editAction = button('demo-edit-toggle', 'Editar', 'id="cwl-demo-edit-toggle" aria-label="Editar alvos e metas"');
    const applyAction = `<button type="button" class="button primary" id="cwl-demo-activate" data-cwl-action="demo-activate" aria-label="${state.demo?'Salvar alterações no exemplo local':'Salvar e aprovar as missões'}" ${state.saveBusy||!pending&&plan.effective ? 'disabled' : ''}>${state.saveBusy?'Salvando…':'Salvar'}</button>`;
    const cancelAction = button('demo-cancel', 'Cancelar', 'id="cwl-demo-cancel" aria-label="Cancelar edição"'+(state.saveBusy?' disabled':''));
    const resetAction = state.demoEditMode||!state.demo ? '' : button('demo-reset', 'Restaurar exemplo', 'id="cwl-demo-reset"');
    const actions = state.demoEditMode ? `${cancelAction}${applyAction}` : editAction;
    return `<section class="cwl-demo-controls" aria-live="polite"><div class="cwl-demo-copy"><strong>${state.demo?'Simulação editável':'Revisão da liderança'}</strong><p>${status} ${state.demo?'Nada é enviado à API ou gravado no servidor.':'Salvar aprova as missões pendentes e registra uma nova versão.'}</p></div><div class="cwl-demo-actions">${resetAction}</div><div class="cwl-demo-dock ${state.demoEditMode ? 'is-editing' : 'is-idle'}" role="group" aria-label="Ações de edição do plano">${actions}</div></section>`;
  }
  function demoCancelDialog() {
    const discard = '<button type="button" class="button primary" id="cwl-demo-cancel-confirm" data-cwl-action="demo-cancel-confirm">Descartar alterações</button>';
    return `<div class="cwl-confirm-backdrop"><section class="cwl-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cwl-cancel-title" aria-describedby="cwl-cancel-copy"><span class="cwl-confirm-icon">${icon('alert')}</span><h3 id="cwl-cancel-title">Cancelar edição?</h3><p id="cwl-cancel-copy">As alterações feitas nesta edição ainda não foram salvas. Se cancelar, elas serão descartadas. Deseja continuar?</p><div class="cwl-confirm-actions">${button('demo-cancel-continue', 'Continuar editando', 'id="cwl-demo-cancel-continue"')}${discard}</div></section></div>`;
  }
  function adoptionDetail(plan) {
    const a = plan.adoption;
    if (!a) return '';
    const changedGoals = known(a.goalsRaised) && known(a.goalsLowered) ? Number(a.goalsRaised) + Number(a.goalsLowered) : null;
    return `<details class="cwl-guide" data-cwl-detail="adoption-${esc(plan.warStart)}"><summary>${icon('sliders')}O que mudou no plano inicial${icon('chevron')}</summary><div class="cwl-guide-content"><p><strong>${number(a.targetRetained, 0)} alvos mantidos</strong> e <strong>${number(changedGoals, 0)} metas alteradas</strong> na aprovação v${esc(a.approvedRevision)}.</p><p>${number(a.fullyRetained, 0)} de ${number(a.missions, 0)} missões foram integralmente preservadas: mesmo alvo e mesma meta. Taxa de preservação: <strong>${percent(a.retentionRate)}</strong>.</p><p>${number(a.modified, 0)} missões tiveram alvo ou meta ajustados. Das metas, ${number(a.goalsRaised, 0)} foram elevadas e ${number(a.goalsLowered, 0)} foram reduzidas; ${number(a.goalRetained, 0)} permaneceram iguais.</p><p>Esta comparação usa a última aprovação, v${esc(a.approvedRevision)}, e a proposta inicial do sistema. Um ataque já registrado pode ser avaliado por uma aprovação anterior, identificada nos seus detalhes.</p></div></details>`;
  }
  function sourceWarning(plan){
    const partial=(plan.initial?.warnings||[]).some(w=>typeof w==='string'&&/^(history_unavailable|player_history_|player_war_unavailable)/.test(w));
    return partial?`<div class="cwl-notice is-warning" role="status">${icon('alert')}<p><strong>Histórico parcial.</strong> Algumas consultas atingiram o limite ou não responderam. Os scores usam os registros disponíveis; confira a amostra de cada jogador.</p></div>`:'';
  }
  function planPanel(state) {
    const plan = state.plan;
    if (!plan && (state.loading || state.error)) return '';
    if (!plan) return state.rounds?.length ? empty('A liderança ainda não preparou este plano', 'Depois de preparado e aprovado, o plano ficará disponível para todos consultarem.',canEdit(state)&&state.selectedStart?`<button type="button" class="button primary" data-cwl-action="prepare">Preparar plano neste aparelho</button>`:state.demo?'':loginAction(state)) : empty('Nenhum confronto encontrado nesta edição', 'Escolha outra edição. A fonte pode ainda não ter registrado as guerras deste mês.');
    if (!canEdit(state) && !plan.effective && !plan.retrospective) return empty('Aguardando o plano da liderança', 'O plano de ataques aparecerá aqui após a aprovação da liderança.');
    const assignments = plan.effective?.assignments || plan.current?.assignments || plan.initial?.assignments || [];
    const participants = plan.initial?.participants || assignments.map(m => ({ tag: m.attackerTag, name: m.attackerName }));
    const names = new Map();
    const targetMetrics = new Map();
    for (const p of plan.initial?.opponentParticipants || []) {names.set(p.tag,p.name);if(known(p.defenseScore))targetMetrics.set(p.tag,p);}
    for (const m of [...(plan.initial?.assignments || []), ...(plan.current?.assignments || []), ...assignments, ...(plan.outcomes || []).flatMap(h => h.mission ? [h.mission] : [])]) {
      names.set(m.attackerTag, m.attackerName); names.set(m.defenderTag, m.defenderName);
      if (m.defenderTag && !targetMetrics.has(m.defenderTag)) targetMetrics.set(m.defenderTag, m);
    }
    const round = state.rounds?.find(r => r.warStart === state.selectedStart);
    const name = round?.opponent?.name || tag(plan.opponentTag);
    const query = String(state.query || '').trim().toLocaleLowerCase('pt-BR');
    const visible = participants.filter(p => {
      const hit = plan.outcomes?.find(h => h.attackerTag === p.tag);
      const mission = hit && !plan.retrospective ? hit.mission : assignments.find(m => m.attackerTag === p.tag);
      const draft = canEdit(state) ? plan.current?.assignments?.find(m => m.attackerTag === p.tag) : null;
      return !query || [p.name, p.tag, mission?.defenderName, mission?.defenderTag, draft?.defenderName, draft?.defenderTag, hit?.defenderTag, names.get(hit?.defenderTag)].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(query));
    });
    const simulated = state.demo && plan.demoLocalAppliedOnce;
    const label = plan.retrospective ? 'Reconstrução histórica' : simulated ? 'Missões simuladas' : plan.effective ? 'Missões aprovadas' : 'Proposta de alvos';
    const notice = !canEdit(state) && plan.effective ? 'Plano aprovado pela liderança. Consulte seu alvo e sua meta antes de atacar.' : plan.retrospective ? 'Análise histórica: resultados reais, sem missões retroativas.' : simulated ? plan.current?.approved === false ? `Simulação v${esc(plan.effective?.revision)} ativa; novas alterações continuam em rascunho local.` : `Simulação v${esc(plan.effective?.revision)} ativa somente neste exemplo. Resultados e mérito não foram recalculados.` : plan.effective ? plan.current?.approved === false ? `Valem as missões aprovadas v${esc(plan.effective.revision)}. Há alterações ainda em rascunho.` : `Missões aprovadas v${esc(plan.effective.revision)}. As ordens de cada ataque ficam registradas.` : 'Proposta de alvos. Aguardando aprovação da líder.';
    const metricsNeedRefresh = state.demo && plan.demoLocalAppliedOnce;
    const tracking = plan.trackingWarning ? `<div class="cwl-notice is-warning" role="status">${icon('alert')}<details data-cwl-detail="tracking-warning"><summary>Atualização indisponível. Exibindo os últimos dados salvos.</summary><p>${esc(plan.trackingWarning)}</p></details></div>` : '';
    return `<div class="cwl-notice ${!plan.retrospective && !plan.effective ? 'is-warning' : 'is-info'}">${icon(plan.retrospective || !plan.effective ? 'alert' : 'check')}<p>${notice}</p></div>${canEdit(state) ? demoPlanControls(plan, state) : ''}${tracking}${sourceWarning(plan)}<div class="cwl-overview"><div class="cwl-metric"><span>Confronto</span><strong>${esc(name)}</strong><small>${esc(date(plan.warStart, true))} · ${esc(stateNames[plan.warState] || '')}</small></div><div class="cwl-metric"><span>Ataques usados</span><strong>${number(plan.metrics?.attacksUsed, 0)} <small>/ ${participants.length}</small></strong></div><div class="cwl-metric"><span>Missões cumpridas</span><strong>${plan.retrospective || !plan.effective || metricsNeedRefresh ? '—' : `${number(plan.metrics?.fulfilled, 0)}`} <small>${metricsNeedRefresh ? 'simulação sem recálculo' : plan.retrospective || !plan.effective ? 'sem avaliação' : 'com missão atribuída'}</small></strong></div><div class="cwl-metric"><span>Estrelas acrescentadas</span><strong>${stars(plan.metrics?.addedStars)}</strong></div></div><section class="cwl-surface" aria-label="${esc(label)}"><div class="cwl-surface-heading"><div><h3>${esc(label)}</h3><p>${plan.retrospective ? 'Compare os resultados sem inventar missões passadas.' : 'Atacante, alvo e meta no mesmo lugar.'}</p></div><span class="cwl-muted">${canEdit(state) ? simulated ? `Simulação v${esc(plan.effective?.revision)}` : plan.effective ? `Aprovação v${esc(plan.effective.revision)}` : `Proposta v${esc(plan.currentRevision || 1)}` : ''}</span></div><label class="cwl-search" for="cwl-query">${icon('search')}<input id="cwl-query" type="search" placeholder="Buscar atacante ou alvo" value="${esc(state.query || '')}" autocomplete="off" aria-label="Buscar atacante ou alvo"></label><div class="cwl-mission-list">${visible.length ? visible.map(p => missionRow(p, plan, assignments, names, state, targetMetrics)).join('') : empty('Nenhum jogador encontrado', 'Tente outro nome ou tag.')}</div></section>${canEdit(state) && !(state.demo && plan.demoLocalAppliedOnce) ? adoptionDetail(plan) : ''}${guide(state)}<p class="cwl-footnote">${plan.retrospective ? 'Análise histórica' : 'Um plano salvo por confronto'} · Consulta de resultados em ${esc(date(plan.observedAt, true))}. Os dados da fonte podem apresentar atraso.</p>`;
  }
  function opportunityDetail(o, index) {
    const [label, tone] = meritStatuses[o.status] || ['Sem avaliação', ''];
    const excludedText = {
      retrospective: 'Guerra consultada após o encerramento. Não existe missão oficial anterior ao ataque para avaliar.',
      before_plan: 'O ataque já existia quando o plano foi criado. Nenhuma missão foi atribuída depois do resultado.',
      unapproved: 'Não há uma missão aprovada que permita avaliar esta oportunidade.',
      needs_review: 'É preciso identificar qual missão aprovada estava valendo no momento do ataque.',
      obsolete_mission: 'Outro ataque já alcançou a meta. A oportunidade ficou fora da média, sem penalidade ou crédito duplicado.',
      pending: 'A guerra ainda permite este ataque. A oportunidade não entra na média por enquanto.',
    };
    const scored = known(o.points);
    return `<details class="cwl-opportunity" data-cwl-detail="opportunity-${esc(o.warStart)}-${esc(o.attackerTag)}-${esc(o.attackOrder ?? index)}"><summary><span>${esc(date(o.warStart))}</span><span>${statusTag(label, tone)}</span><strong>${scored ? `${number(o.points, 2)} pts` : 'Sem nota'}</strong>${icon('chevron')}</summary><div class="cwl-opportunity-body">${o.goalStars != null ? `<p>Meta: <strong>${esc(o.goalStars)} estrelas</strong> em ${esc(tag(o.defenderTag))}${o.missionRevision ? ` · missão aprovada v${esc(o.missionRevision)}` : ''}.</p>` : ''}${known(o.stars) ? `<p>Resultado: <strong>${esc(o.stars)} estrelas</strong> e ${number(o.observedDestruction, 0)}% de destruição${o.actualDefenderTag && o.actualDefenderTag !== o.defenderTag ? ` em ${esc(tag(o.actualDefenderTag))}` : ''}. Tempo: ${known(o.observedDurationSeconds) ? `${number(o.observedDurationSeconds, 0)} s` : 'não informado'}.</p>` : ''}${scored ? `<div class="cwl-breakdown"><div><span>Missão</span><b>${number(o.missionPoints, 2)}</b><small>até 80 pts</small></div><div><span>Dificuldade</span><b>${number(o.difficultyPoints, 2)}</b><small>até 15 pts</small></div><div><span>Estrelas novas</span><b>${number(o.contributionPoints, 2)}</b><small>até 5 pts</small></div></div><p class="cwl-formula">${number(o.missionPoints, 6)} + ${number(o.difficultyPoints, 6)} + ${number(o.contributionPoints, 6)} ≈ <strong>${number(o.points, 6)} pontos</strong></p>${o.status === 'wrong_target' ? '<p>O alvo foi diferente do aprovado. O mérito é zero; os números do ataque permanecem no histórico.</p>' : o.status === 'missed' ? '<p>A missão estava aprovada e a guerra encerrou sem ataque. Esta oportunidade entra com zero na média.</p>' : `<p>Entrega da missão: <strong>${percent(o.progress)}</strong>. Estrelas novas no placar: <strong>${number(o.creditedStars, 0)}</strong>.</p>${o.difficultyAvailable ? `<p>Dificuldade da meta: <strong>${number(o.difficulty, 3)}</strong> = 1 − ${number(o.goalSupportEstimate, 3)}. O bônus só é aplicado quando a missão é cumprida.</p>` : '<p class="cwl-muted">Dificuldade sem bônus: histórico insuficiente ou contexto do alvo diferente do plano. Isso não significa que o alvo era fácil.</p>'}${o.evidence ? `<details class="cwl-evidence" data-cwl-detail="evidence-${esc(o.warStart)}-${esc(o.attackerTag)}-${esc(o.attackOrder ?? index)}"><summary>Conferir os dados utilizados${icon('chevron')}</summary><div><p>ATQ ${number(o.attackScore, 1)} · DEF ${number(o.defenseScore, 1)} · CV ${number(o.attackerCV, 0)} contra CV ${number(o.defenderCV, 0)}.</p><p>${number(o.evidence.attackCount, 0)} ataques, peso ${number(o.evidence.attackWeight, 2)}; ${number(o.evidence.defenseCount, 0)} defesas, peso ${number(o.evidence.defenseWeight, 2)}.</p><p>Antes deste ataque: ${number(o.targetStarsBeforeAttack, 0)} estrelas na base. No plano: ${number(o.evidence.targetStarsBeforePlan, 0)} estrelas.</p>${Array.isArray(o.frozenProbabilities) ? `<p>Distribuição registrada para 0, 1, 2 e 3 estrelas: ${o.frozenProbabilities.map(p => number(p, 4)).join(' / ')}. Soma-se a partir da meta de ${esc(o.goalStars)} estrelas para obter o suporte ${number(o.goalSupportEstimate, 4)}.</p>` : ''}<p class="cwl-muted">Esta distribuição é uma estimativa experimental, não uma probabilidade individual calibrada.</p></div></details>` : ''}`}` : `<p class="cwl-muted">${esc(excludedText[o.status] || 'Não há evidência suficiente para avaliar esta oportunidade. Nenhuma falha é presumida.')}</p>`}</div></details>`;
  }
  function rankRow(player, policy) {
    const assessed = Number(player.assessedOpportunities || 0);
    const scored = known(player.meritScore);
    const total = number(player.totalPoints, 2), prior = Number(policy?.priorOpportunities ?? 2), neutral = Number(policy?.priorScore ?? 50);
    return `<details class="cwl-rank-row" data-cwl-detail="rank-${esc(player.tag)}"><summary class="cwl-rank-summary"><span class="cwl-rank-position" aria-label="${player.rank == null ? 'Sem posição' : `Posição ${player.rank}`}">${player.rank == null ? '—' : esc(player.rank)}</span><div class="cwl-rank-main"><strong>${esc(player.name || tag(player.tag))}</strong><small>${player.status === 'provisional' ? 'Nota provisória' : scored ? `${assessed} ${assessed === 1 ? 'oportunidade avaliada' : 'oportunidades avaliadas'}` : 'Sem missão avaliada'}</small></div><div class="cwl-rank-score"><span>Mérito</span><strong>${scored ? number(player.meritScore, 1) : '—'}</strong><small>${scored ? '/ 100' : 'sem nota'}</small></div><div class="cwl-rank-missions"><span>Missões</span><b>${assessed ? `${number(player.fulfilled, 0)}/${assessed}` : '—'}</b><small>cumpridas</small></div><div class="cwl-rank-stars"><span>Estrelas novas</span><b>${number(player.averageCreditedStars, 2)}</b><small>por oportunidade</small></div><div class="cwl-rank-destruction"><span>Destruição</span><b>${known(player.averageDestruction) ? `${number(player.averageDestruction, 1)}%` : '—'}</b><small>média</small></div><div class="cwl-rank-duration"><span>Tempo</span><b>${known(player.averageDuration) ? esc(duration(player.averageDuration)) : '—'}</b><small>${player.durationComplete ? 'média' : 'incompleto'}</small></div><span class="cwl-expand">Entender nota${icon('chevron')}</span></summary><div class="cwl-rank-detail"><h4>Como ${esc(player.name || tag(player.tag))} chegou a esta nota</h4>${scored ? `<div class="cwl-breakdown"><div><span>Pontos das oportunidades</span><b>${total}</b></div><div><span>Média dos resultados</span><b>${number(player.rawAverage, 2)}</b></div><div><span>Nota da edição</span><b>${number(player.meritScore, 2)}</b></div></div><p class="cwl-formula">(${number(player.totalPoints, 6)} + ${prior} × ${neutral}) ÷ (${assessed} + ${prior}) ≈ <strong>${number(player.meritScore, 6)}</strong></p><p class="cwl-muted">A nota inclui ${prior} oportunidades neutras de ${neutral} pontos. Isso evita tratar um resultado isolado como se tivesse a mesma sustentação de várias atuações. Reservas não entram na média.</p>` : '<p class="cwl-muted">Sem nota não é nota zero. Ainda não há oportunidade avaliável com uma missão previamente aprovada para este jogador.</p>'}${Number(player.unresolvedOpportunities) ? `<p class="cwl-warning-copy">${number(player.unresolvedOpportunities, 0)} ${player.unresolvedOpportunities === 1 ? 'oportunidade ainda não pode ser avaliada' : 'oportunidades ainda não podem ser avaliadas'}. O resultado permanece provisório.</p>` : ''}${Number(player.excludedOpportunities) ? `<p class="cwl-muted">${number(player.excludedOpportunities, 0)} ${player.excludedOpportunities === 1 ? 'missão já resolvida por outro ataque ficou fora da média' : 'missões já resolvidas por outros ataques ficaram fora da média'}.</p>` : ''}<div class="cwl-opportunities">${(player.opportunities || []).map(opportunityDetail).join('')}</div><p class="cwl-muted">Valores de comparação: mérito ${number(player.meritScore, 6)}, missões ${number(player.missionRate, 6)}, estrelas novas ${number(player.averageCreditedStars, 6)}, destruição ${number(player.averageDestruction, 6)}%, tempo ${known(player.averageDuration) ? `${number(player.averageDuration, 6)} s` : 'não informado'}. A ordem compara seis casas decimais.</p><p class="cwl-muted">Desempates: cumprimento das missões, estrelas novas por oportunidade, destruição e menor tempo. ${player.durationTiebreakApplied ? 'O tempo foi usado para comparar este grupo empatado.' : 'O tempo só é usado se todo o grupo empatado tiver registros completos.'} Igualdade completa mantém o empate.</p></div></details>`;
  }
  function rankingPanel(state) {
    const ranking = state.ranking?.ranking || state.ranking;
    if (!ranking && (state.loading || state.error)) return '';
    if (!ranking) return empty('O mérito da edição aparece aqui', 'Consulte um confronto para registrar o plano. As notas passam a ser calculadas com as missões aprovadas e os resultados acompanhados.');
    const players = ranking.entries || [];
    const query = String(state.query || '').trim().toLocaleLowerCase('pt-BR');
    const visible = players.filter(p => !query || [p.name, p.tag].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(query)));
    const scored = players.filter(p => known(p.meritScore)).length;
    const unresolved = players.reduce((sum, p) => sum + Number(p.unresolvedOpportunities || 0), 0);
    const policy = ranking.policy || {};
    return `<div class="cwl-notice ${ranking.status === 'provisional' ? 'is-warning' : 'is-info'}">${icon(ranking.status === 'provisional' ? 'alert' : 'flag')}<p><strong>${ranking.status === 'provisional' ? 'Ranking provisório' : 'Mérito acompanhado'}</strong> · ${number(ranking.recordedRounds, 0)} ${ranking.recordedRounds === 1 ? 'dia acompanhado' : 'dias acompanhados'}, ${number(ranking.closedRounds, 0)} ${ranking.closedRounds === 1 ? 'encerrado' : 'encerrados'}.</p></div><section class="cwl-policy-summary" aria-label="Como funciona o mérito"><div><strong>Como a nota é calculada</strong><p>Cada missão pode valer até 100 pontos: o progresso em direção à meta vale até ${number(policy.missionPoints ?? 80, 0)}; a dificuldade pode acrescentar até ${number(policy.difficultyPoints ?? 15, 0)} quando a meta é cumprida; as estrelas novas no placar valem até ${number(policy.contributionPoints ?? 5, 0)}.</p><p>A nota da edição combina os resultados com duas referências neutras para reduzir o peso de poucos ataques. Missões, estrelas novas, destruição e tempo desempatarão nessa ordem. O tempo só conta quando todos os empatados têm registro completo.</p><p>Uma estrela nova aumenta o melhor resultado que o clã já tinha naquela base. A dificuldade depende dos dados disponíveis; sem dados suficientes, não há bônus de dificuldade.</p></div></section>${!scored && players.length ? '<div class="cwl-unscored-note"><h3>Sem notas de mérito ainda.</h3><p>As notas exigem missões aprovadas antes dos ataques.</p></div>' : ''}<section class="cwl-surface"><div class="cwl-surface-heading"><div><h3>Contribuição dos jogadores</h3><p>${scored} com nota${unresolved ? ` · ${unresolved} oportunidades sem avaliação` : ''}. Abra para conferir a conta.</p></div><span class="cwl-muted">Nota de 0 a 100</span></div><label class="cwl-search" for="cwl-query">${icon('search')}<input id="cwl-query" type="search" placeholder="Buscar jogador" value="${esc(state.query || '')}" autocomplete="off" aria-label="Buscar jogador no ranking"></label><div class="cwl-ranking-list">${visible.length ? visible.map(p => rankRow(p, policy)).join('') : empty(players.length ? 'Nenhum jogador encontrado' : 'Ainda não há jogadores avaliados', players.length ? 'Tente outro nome ou tag.' : 'Os participantes aparecerão quando um confronto for registrado.')}</div></section>${guide(state)}<p class="cwl-footnote">${state.rankingFetchedAt ? `Consulta do ranking em ${esc(date(state.rankingFetchedAt, true))}. ` : 'Ranking dos resultados registrados. '}As fontes podem apresentar atraso.</p>`;
  }
  function render(state = {}) {
    const activeTab = state.activeTab === 'ranking' ? 'ranking' : 'plan';
    const loading = Boolean(state.loading);
    return `<div class="cwl-shell${state.demo ? ' is-demo' : ''}">${header(state)}${state.demo ? '<div class="cwl-notice is-info">'+icon('flag')+'<p><strong>Exemplo ilustrativo.</strong> Alvos, notas e ranking não são reais. Alterações ficam nesta demonstração e não recalculam os resultados.</p></div>' : ''}${tabs(activeTab)}${activeTab === 'plan' ? roundsList(state) : ''}<div id="cwl-panel" role="tabpanel" aria-labelledby="cwl-tab-${activeTab}" ${loading ? 'aria-busy="true"' : ''}>${loading ? `<div class="cwl-loading" role="status" aria-live="polite">${icon('refresh')}<div><strong>${esc(typeof state.loading === 'string' ? state.loading : 'Consultando a CWL…')}</strong><p>Os dados aparecem conforme cada consulta termina.</p></div></div>` : ''}${state.error ? `<div class="cwl-notice is-warning" role="alert">${icon('alert')}<div><strong>Não foi possível concluir esta consulta</strong><p>${state.plan || state.ranking ? 'Dados anteriores preservados. ' : ''}${esc(state.error)}</p></div>${button('retry', 'Tentar novamente')}</div>` : ''}${state.syncWarning ? `<div class="cwl-notice is-warning" role="status">${icon('alert')}<p>${esc(state.syncWarning)}</p></div>` : ''}${activeTab === 'ranking' ? rankingPanel(state) : planPanel(state)}</div>${state.demoCancelConfirm ? demoCancelDialog() : ''}</div>`;
  }
  root.CwlUI = Object.freeze({ render });
})(window);
