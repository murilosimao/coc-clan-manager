/* Mobile and desktop roster UI. Rules and data clients live in separate modules. */
(function () {
  'use strict';
  const E = window.WarEngine;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = E.esc;
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const audit = (action, details) => window.ClanAPI.audit(action, details);
  const storageKey = 'clashspot-war-selector-v1';
  const roleNames = { Leader: 'Líder', 'Co-leader': 'Colíder', Elder: 'Ancião', Member: 'Membro' };
  const prefNames = { in: 'Disponível', out: 'Fora da guerra', unknown: 'Sem confirmação' };
  const viewTitles = { team: 'Time de guerra', rules: 'Critérios', war: 'Guerras', cwl: 'Liga CWL' };
  const state = {
    clanTag: E.DEFAULT_CLAN, clanName: '', clanBadgeUrl: '', members: [], lastWar: null, currentWar: null,
    settings: structuredClone(E.DEFAULT_SETTINGS), selection: null, source: '', fetchedAt: '',
    dataWarnings: [], loading: false, status: '', error: '', loadStages: null, memberProgress: null, view: 'team', filter: 'selected',
    personalWarByTag: new Map(), personalHistoryStatusByTag: new Map(), historyLoading: false,
    historyLookupWarning: '', historyToken: 0,
    query: '', warQuery: '', currentWarFilter: 'all', expanded: new Set(), previousWarExpanded: false, advancedOpen: false,
  };
  const statsState = { tag: '', name: '', type: 'random', data: null, loading: false, error: '', token: 0, cache: new Map() };
  let statsOpener;
  let toastTimer;
  let dialogOpener;

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      for (const key of Object.keys(E.DEFAULT_SETTINGS)) {
        const value = saved[key];
        if (Array.isArray(E.DEFAULT_SETTINGS[key])) {
          if (Array.isArray(value)) state.settings[key] = value.filter((tag) => typeof tag === 'string').map(E.normalizeTag);
        } else if (value != null && typeof value === typeof E.DEFAULT_SETTINGS[key]) state.settings[key] = value;
      }
      if (/^[0289PYLQGRJCUV]{3,15}$/.test(E.normalizeTag(saved.clanTag))) state.clanTag = E.normalizeTag(saved.clanTag);
      if (Number(saved.selectionRulesVersion) < 2) {
        // The previous release required triples, excluded players without data,
        // and defaulted to the largest team. Keep personal lists, migrate rules.
        state.settings.usePlayerHistoryFallback = false;
        saveSettings();
      }
    } catch { /* Storage is optional. */ }
  }
  function saveSettings() {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...state.settings, clanTag: state.clanTag, selectionRulesVersion: 2 })); } catch { /* Storage is optional. */ }
  }
  function toast(message) {
    const node = $('#toast');
    node.textContent = message; node.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
  }
  function shield(pref) {
    return `<span class="availability ${esc(pref)}">${icon('shield')}<span>${esc(prefNames[pref] || prefNames.unknown)}</span></span>`;
  }
  function reason(row) {
    if (row.blacklisted) return { label: 'Bloqueado na lista', tone: 'red', detail: 'A lista de exclusão tem prioridade sobre qualquer critério.' };
    if (row.forcedOut) return { label: 'Removido por você', tone: 'muted', detail: 'Um ajuste manual retirou este jogador do time.' };
    if (row.sizeFillException) {
      const reasons = [...row.hardReasons, ...row.softReasons].join(' · ');
      const trophies = row.member.trophies != null ? `${Number(row.member.trophies).toLocaleString('pt-BR')} troféus` : 'troféus indisponíveis';
      const clanRank = row.member.clanRank ?? row.member.position;
      const rank = clanRank != null ? `posição #${clanRank} no clã` : 'posição no clã indisponível';
      return { label: 'Reforço por atividade', tone: 'gold', detail: `${reasons ? `${reasons}. ` : ''}${trophies}, ${rank}. Selecionado na sequência de atividade; o CV não define a ordem.` };
    }
    if (row.hardFail) return { label: 'Escudo vermelho', tone: 'red', detail: row.hardReasons.join(' · ') };
    if (row.forcedIn) return { label: 'Incluído por você', tone: 'blue', detail: 'Inclusão manual, respeitando os filtros de escudo e a lista de exclusão.' };
    if (row.whitelisted) return { label: 'Lista de prioridade', tone: 'blue', detail: 'A prioridade permite incluir sem cumprir os critérios de desempenho.' };
    if (row.trimmed) return { label: 'Sem vaga neste time', tone: 'muted', detail: 'O jogador atende às regras, mas ficou entre os últimos após o ajuste para um tamanho válido.' };
    if (row.exception) return { label: 'Exceção para completar', tone: 'gold', detail: `${row.softReasons.join(' · ') || 'Incluído para completar o tamanho do time.'}${row.usedPersonalHistory ? ` ${personalHistoryDetail(row.historyWar)}` : ''}` };
    if (row.softReasons.length) return { label: row.usedPersonalHistory ? 'Histórico abaixo das regras' : 'Desempenho abaixo das regras', tone: 'muted', detail: `${row.softReasons.join(' · ')}${row.usedPersonalHistory ? `. ${personalHistoryDetail(row.historyWar)}` : ''}` };
    if (row.usedPersonalHistory) return { label: 'Histórico pessoal aprovado', tone: 'blue', detail: personalHistoryDetail(row.historyWar) };
    if (!row.inWar) {
      if (row.historyStatus === 'unavailable') return { label: 'Histórico indisponível · mantido', tone: 'gold', detail: 'A consulta ao histórico falhou. Sem registro da guerra anterior, o jogador permanece elegível.' };
      if (row.historyStatus === 'none') return { label: 'Sem histórico · mantido', tone: 'blue', detail: 'Não há guerra normal anterior registrada. A ausência de dados não exclui o jogador.' };
      return { label: 'Sem registro · mantido', tone: 'blue', detail: 'Sem participação registrada na última guerra do clã. A ausência de dados não exclui o jogador.' };
    }
    if (row.eligible) return { label: 'Critérios atendidos', tone: 'green', detail: 'Fez os dois ataques e marcou ao menos uma estrela na última guerra concluída.' };
    return { label: 'Desempenho abaixo das regras', tone: 'muted', detail: row.softReasons.join(' · ') };
  }
  function personalHistoryDetail(war) {
    const time = window.ClashKing.timestamp(war?.endTime);
    const date = Number.isFinite(time) ? new Date(time).toLocaleDateString('pt-BR') : 'data não informada';
    const clan = war?.clan?.name ? ` pelo clã ${war.clan.name}` : '';
    const attacks = [...(war?.attacks || [])].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    const stars = attacks.reduce((sum, attack) => sum + attack.stars, 0);
    const attackResult = (value) => value == null ? 'não realizado' : `${value} ${value === 1 ? 'estrela' : 'estrelas'}`;
    const total = `${stars} ${stars === 1 ? 'estrela' : 'estrelas'}`;
    return `Histórico pessoal: 1º ataque ${attackResult(attacks[0]?.stars)}, 2º ataque ${attackResult(attacks[1]?.stars)}, ${total} no total; guerra encerrada em ${date}${clan}.`;
  }
  function badgeUrl(value) {
    const url = typeof value === 'string' ? value : value?.medium || value?.large || value?.small || '';
    return /^https:\/\/api-assets\.clashofclans\.com\/badges\/(70|200|512)\/[A-Za-z0-9_-]+\.png$/.test(url) ? url : '';
  }
  function clanEmblem(url, name, cls) {
    const safe = badgeUrl(url);
    return `<span class="clan-emblem ${cls}">${safe ? `<img src="${esc(safe)}" alt="Brasão do clã ${esc(name || '')}" width="96" height="96" decoding="async" referrerpolicy="no-referrer" data-visual="badge">` : ''}<svg class="badge-fallback icon" role="img" aria-label="Brasão indisponível" ${safe ? 'hidden' : ''}><use href="#i-shield"/></svg></span>`;
  }
  function townHall(level) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 1 || n > 18) return `<span class="th-badge" role="img" aria-label="Centro da Vila ${esc(level ?? 'não informado')}"><small>CV</small><b>${esc(level ?? '—')}</b></span>`;
    return `<span class="th-badge has-image" role="img" aria-label="Centro da Vila ${n}"><img src="portal/images/townhalls/th${n}.webp" alt="" width="44" height="44" loading="lazy" decoding="async" data-visual="townhall"><span class="th-fallback">CV</span><span class="th-level">${n}</span></span>`;
  }
  function attackMetric(stars, label, tag = 'div') {
    const known = stars !== null && stars !== undefined;
    return `<${tag} class="player-stat attack-stat"><b>${known ? esc(stars) + icon('star', Number(stars) > 0 ? 'filled' : '') : '—'}</b><span>${label}</span></${tag}>`;
  }
  function updateSelection() {
    state.selection = state.members.length ? E.selectTeam(state.members, state.lastWar, state.settings, state.currentWar, state.personalWarByTag, state.personalHistoryStatusByTag) : null;
  }
  function render() {
    updateSelection(); renderHeader(); renderStatus(); renderTeam(); renderRules(); renderWar();
    updateCopyControl();
    $('#refresh').disabled = state.loading || state.view === 'cwl' && Boolean(window.CwlApp.state.loading);
    if (!$('#clan-dialog').open) $('#clan-input').value = '#' + state.clanTag;
    $('#clan-form button[type=submit]').disabled = state.loading;
    $('#source-info').innerHTML = `<h3>Sobre os dados</h3><p>${state.source === 'demo' ? 'Demonstração de 20/10/2026. Esta captura não representa o clã em tempo real.' : 'Os escudos e membros vêm dos perfis públicos do jogo. O desempenho usa a última guerra concluída; sem registro, o jogador permanece elegível. As fontes podem apresentar atraso de atualização; o cache dura até 1 minuto.'}</p>${state.settings.usePlayerHistoryFallback ? '<p>Quando ativado, o histórico pessoal da última guerra normal concluída é usado somente para quem não tem registro na última guerra do clã.</p>' : ''}${state.fetchedAt ? `<p>Última consulta: ${esc(new Date(state.fetchedAt).toLocaleString('pt-BR'))}.</p>` : ''}`;
  }
  function updateCopyControl() {
    const canCopy = Boolean(state.selection?.selected.length) && !state.loading && !state.historyLoading;
    $('#mobile-copy').disabled = state.view === 'cwl' ? !window.CwlApp.canCopy() : !canCopy;
    const label = state.view === 'cwl' ? window.CwlApp.state.activeTab === 'ranking' ? 'Copiar ranking' : 'Copiar plano' : 'Copiar TSV';
    $('#mobile-copy span').textContent = label;
    $('#mobile-copy').setAttribute('aria-label', label + ' em TSV para colar em uma planilha');
    $('#refresh').disabled = state.loading || state.view === 'cwl' && Boolean(window.CwlApp.state.loading);
  }
  function renderHeader() {
    $('#clan-name').textContent = state.clanName || (state.loading ? 'Convocando os dados…' : 'Seu clã. Seu próximo time.');
    $('#clan-tag').textContent = '#' + state.clanTag;
    $('#clan-eyebrow').textContent = state.view === 'cwl' ? state.source === 'demo' ? 'CWL · DEMONSTRAÇÃO' : 'LIGA DE GUERRAS' : state.source === 'demo' ? 'DEMONSTRAÇÃO · 20 OUT 2026' : 'PREPARAÇÃO DE GUERRA';
    $('#data-freshness').textContent = state.loading ? 'Consultando o clã' : state.fetchedAt ? `Atualizado às ${new Date(state.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : state.source === 'demo' ? 'Dados de demonstração' : 'Dados ainda não carregados';
    if (state.view === 'cwl') {
      const cwl = window.CwlApp.state;
      $('#data-freshness').textContent = cwl.demo ? 'Cenário ilustrativo' : cwl.loading ? 'Consultando a Liga' : cwl.rankingFetchedAt
        ? `Liga consultada às ${new Date(cwl.rankingFetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Dados da Liga';
    }
    $('#refresh').innerHTML = `${icon('refresh', state.loading ? 'spinning' : '')}<span>${state.loading ? 'Atualizando' : 'Atualizar'}</span>`;
  }
  function renderStatus() {
    const node = $('#status');
    if (state.view === 'cwl') { node.hidden = true; return; }
    node.hidden = !state.loading && !state.historyLoading && !state.error && !state.dataWarnings.length && !state.historyLookupWarning && state.source !== 'demo';
    node.className = 'status-banner ' + (state.error ? 'error' : state.loading || state.historyLoading ? 'loading' : 'notice');
    if (state.error) node.innerHTML = `${icon('alert')}<div><strong>Não foi possível atualizar o clã</strong><p>${esc(state.error)}</p></div><button type="button" class="button secondary" data-command="refresh">Tentar de novo</button>`;
    else if (state.loading || state.historyLoading) {
      const progress = state.memberProgress;
      const stages = state.loadStages || {};
      const stageLabels = { clan: 'Clã', profiles: 'Escudos', currentWar: 'Guerra atual', history: 'Histórico' };
      const stageStateLabels = { loading: 'Consultando', waiting: 'Na fila', done: 'Pronto', error: 'Falhou' };
      const stageMarkup = state.loading ? `<div class="load-stages" aria-label="Progresso das consultas">${Object.entries(stageLabels).map(([key, label]) => {
        const status = stages[key] || 'waiting';
        const detail = key === 'profiles' && progress?.total ? `${progress.done}/${progress.total}` : (stageStateLabels[status] || status);
        return `<span class="load-stage ${esc(status)}"><i>${status === 'done' ? icon('check') : status === 'error' ? icon('alert') : icon('refresh', status === 'loading' ? 'spinning' : '')}</i><b>${label}</b><small>${esc(detail)}</small></span>`;
      }).join('')}</div>` : '';
      const profileProgress = state.loading && progress?.total ? `<div class="profile-progress" role="progressbar" aria-label="Perfis de jogadores consultados" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}"><span>Escudos dos jogadores</span><i><b style="width:${Math.min(100, progress.done / progress.total * 100)}%"></b></i><strong>${progress.done}/${progress.total}</strong></div>` : '';
      node.innerHTML = `<div class="load-status-main">${icon('refresh', 'spinning')}<span>${esc(state.status || 'Consultando membros e guerras…')}</span></div>${stageMarkup}${profileProgress}`;
    }
    else if (state.source === 'demo') node.innerHTML = `${icon('flag')}<span>Você está explorando uma demonstração de 20/10/2026.</span><button type="button" class="text-button" data-command="refresh">Usar dados atuais</button>`;
    else node.innerHTML = `${icon('alert')}<div>${[...state.dataWarnings, state.historyLookupWarning].filter(Boolean).map((warning) => `<p>${esc(warning)}</p>`).join('')}</div>`;
  }
  function summary() {
    const s = state.selection;
    const green = state.members.filter((m) => m.pref === 'in').length;
    const red = state.members.filter((m) => m.pref === 'out').length;
    const unknown = state.members.length - green - red;
    const count = s.selected.length;
    const complete = count === s.target;
    const exceptions = s.selected.filter((r) => r.exception).length;
    const priority = s.selected.filter((r) => r.whitelisted && !r.exception).length;
    const strict = count - exceptions - priority;
    return `<section class="selection-hero" aria-label="Resumo da convocação">
      <div class="hero-main"><div class="eyebrow">PRÓXIMA CONVOCAÇÃO</div><div class="selection-number"><strong>${count}</strong><span>/ ${s.target}<small>jogadores</small></span><span class="ready-label ${complete ? 'green' : 'gold'}">${icon(complete ? 'check' : 'alert')}${complete ? 'Time completo' : count < s.target ? `${s.target - count} vagas abertas` : `${count - s.target} acima do limite`}</span></div><p class="composition"><span class="dot green"></span>${strict} pelos critérios <span class="dot gold"></span>${exceptions} exceções ${priority ? `<span class="dot blue"></span>${priority} por prioridade` : ''}</p></div>
      <div class="hero-art" aria-hidden="true">${clanEmblem(state.clanBadgeUrl, state.clanName, 'hero-crest')}</div>
      <div class="availability-summary"><div class="availability-heading"><span>${icon('users')}<b>${state.members.length}</b> membros no clã</span><button type="button" class="text-button" data-command="all-players">Ver todos ${icon('arrow')}</button></div><div class="availability-track" role="img" aria-label="${green} disponíveis, ${red} fora e ${unknown} sem confirmação"><span class="green" style="width:${green / state.members.length * 100}%"></span><span class="red" style="width:${red / state.members.length * 100}%"></span><span class="unknown" style="width:${unknown / state.members.length * 100}%"></span></div><div class="availability-counts"><span><i class="dot green"></i><b>${green}</b> disponíveis</span><span><i class="dot red"></i><b>${red}</b> fora</span>${unknown ? `<span><i class="dot unknown"></i><b>${unknown}</b> sem escudo</span>` : ''}</div></div>
    </section>`;
  }
  function renderTeam() {
    const container = $('#team-view');
    if (!state.members.length) {
      container.innerHTML = state.loading ? `<div class="skeleton-hero skeleton"></div><div class="skeleton-title skeleton"></div>${[1, 2, 3, 4].map(() => '<div class="skeleton-row skeleton"></div>').join('')}` : `<div class="empty-state">${icon('shield')}<div class="eyebrow">O PRÓXIMO TIME COMEÇA AQUI</div><h2>Encontre seu clã</h2><p>Consulte os membros e os escudos para preparar a próxima convocação.</p><button type="button" class="button primary" data-command="open-clan">Consultar outro clã ${icon('arrow')}</button></div>`;
      return;
    }
    const s = state.selection;
    const counts = { selected: s.selected.length, bench: s.bench.length, all: state.members.length };
    const labels = { selected: 'Convocados', bench: 'Reserva', all: 'Todos' };
    container.innerHTML = `${summary()}<div class="workspace-grid"><section class="roster-panel" aria-labelledby="team-title"><div class="section-heading"><div><div class="eyebrow">TIME DE GUERRA</div><h2 id="team-title" tabindex="-1">Escalação sugerida</h2></div><button type="button" class="button primary desktop-copy" data-command="copy" ${state.loading || state.historyLoading ? 'disabled' : ''}>${icon('copy')}Copiar para Excel</button></div>
      <div class="roster-toolbar"><div class="segments" role="group" aria-label="Jogadores exibidos">${Object.keys(labels).map((filter) => `<button type="button" data-filter="${filter}" aria-pressed="${state.filter === filter}">${labels[filter]}<span>${counts[filter]}</span></button>`).join('')}</div><div class="search-export"><label class="search-field">${icon('search')}<input type="search" id="roster-search" aria-label="Buscar jogador por nome ou tag" placeholder="Buscar jogador" autocomplete="off" value="${esc(state.query)}"></label><button type="button" class="button secondary export-button" data-command="export" aria-label="Baixar escalação em TSV" title="Baixar TSV para Excel" ${state.loading || state.historyLoading ? 'disabled' : ''}>${icon('download')}<span>TSV</span></button></div></div>
      <div id="roster-content"></div><div class="roster-footnote">${icon('shield')}Escudos indicam a preferência no jogo. Os ajustes aqui alteram apenas a sugestão.</div></section>${renderRail()}</div>`;
    renderRoster();
  }
  function renderRail() {
    const s = state.selection;
    const current = state.currentWar;
    const rules = ['Tamanho padrão calculado pelos escudos verdes disponíveis', 'Jogadores com registro: 2 ataques e ao menos 1 estrela', 'Sem registro não significa exclusão', 'Reforços por troféus e ranking; escudo vermelho só como última opção'];
    return `<aside class="summary-rail" aria-label="Contexto da seleção"><section class="rail-block"><div class="rail-title">${icon('sliders')}Critérios ativos</div><ul class="active-rules">${rules.map((label) => `<li>${icon('check')}${label}</li>`).join('')}</ul><button type="button" class="button secondary full" data-view="rules">Ver critérios ${icon('arrow')}</button></section><section class="rail-block current-war"><div class="rail-title">${icon('swords')}Guerra atual</div><strong>${current ? `${current.header.sizeHome} × ${current.header.sizeAway}` : 'Sem dados atuais'}</strong><p>${current ? esc(current.result.label?.toLowerCase() || 'Em andamento') : 'A fonte não informou uma guerra atual.'}</p><button type="button" class="text-button" data-view="war">Ver relatório ${icon('arrow')}</button></section>${s.warnings.length ? `<section class="rail-block selection-notes"><div class="rail-title">${icon('alert')}Sobre este time</div>${s.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</section>` : ''}<div class="rail-note">Desempenho da última guerra concluída. As preferências são consultadas no perfil de cada jogador.</div></aside>`;
  }
  function filteredRows() {
    const s = state.selection;
    const rows = state.filter === 'selected' ? s.selected : state.filter === 'bench' ? s.bench : [...s.all].sort((a, b) => a.member.position - b.member.position);
    const q = state.query.trim().toLocaleLowerCase('pt-BR');
    return rows.filter((r) => `${r.member.name} ${r.member.tag}`.toLocaleLowerCase('pt-BR').includes(q));
  }
  function rowAction(row, selected) {
    const tag = esc(row.member.tag);
    if (selected) return `<button type="button" class="icon-button roster-action remove" data-action="force-out" data-tag="${tag}" aria-label="Tirar ${esc(row.member.name)} do time" title="Tirar do time">${icon('minus')}</button>`;
    if (row.hardFail) return `<span class="locked-action" title="Bloqueado no time atual; escudo vermelho só entra como última opção para completar uma guerra arredondada para cima">${icon('shield')}</span>`;
    return `<button type="button" class="icon-button roster-action" data-action="${row.forcedOut ? 'clear-force' : 'force-in'}" data-tag="${tag}" aria-label="${row.forcedOut ? 'Desfazer remoção de' : 'Incluir no time'} ${esc(row.member.name)}" title="${row.forcedOut ? 'Desfazer remoção' : 'Incluir no time'}">${icon('plus')}</button>`;
  }
  function renderRoster() {
    const container = $('#roster-content');
    if (!container || !state.selection) return;
    const rows = filteredRows();
    const selected = new Set(state.selection.selected.map((r) => r.member.tag));
    container.innerHTML = `<div class="roster-columns" aria-hidden="true"><span>Jogador</span><span>Escudo</span><span>1º ataque</span><span>2º ataque</span><span>Total</span><span>Convocação</span><span></span></div>${rows.length ? `<div class="player-list">${rows.map((row) => {
      const member = row.member; const why = reason(row); const isSelected = selected.has(member.tag);
      const historyShownInReason = row.usedPersonalHistory && ['Histórico abaixo das regras', 'Histórico pessoal aprovado', 'Exceção para completar'].includes(why.label);
      const previousWarDetail = row.inWar
        ? `${row.attacks} ataques usados · ${row.stars} estrelas na última guerra do clã.`
        : row.usedPersonalHistory
          ? `Sem participação registrada na última guerra do clã.${historyShownInReason ? '' : ` ${personalHistoryDetail(row.historyWar)}`}`
          : 'Sem participação registrada na última guerra do clã. A ausência de registro não exclui o jogador.';
      return `<article class="player-row ${isSelected ? 'is-selected' : ''}" data-player="${esc(member.tag)}"><div class="player-line"><div class="player-identity">${townHall(member.th)}<div class="player-name"><h3>${esc(member.name)}</h3><span>${esc(roleNames[member.role] || member.role || 'Membro')}<i> · </i>#${member.position ?? '—'} no clã</span></div></div><div class="player-availability">${shield(member.pref)}</div>${attackMetric(row.perf?.firstAttackStars, '1º ataque')}${attackMetric(row.perf?.secondAttackStars, '2º ataque')}<div class="player-stat gold-stat"><b>${row.inWar ? row.perf.stars : '—'}</b><span>total</span></div><div class="player-reason"><span class="reason ${why.tone}"><i class="dot ${why.tone}"></i>${why.label}</span></div><div class="player-action">${rowAction(row, isSelected)}</div></div><details class="player-details" data-expand="${esc(member.tag)}" ${state.expanded.has(member.tag) ? 'open' : ''}><summary><span>Ver detalhes</span>${icon('chevron')}</summary><div class="player-detail-content"><div class="detail-copy"><span class="tag-code">#${esc(member.tag)}</span><p>${esc(why.detail)}</p><p class="muted">${esc(previousWarDetail)}</p></div><div class="player-options"><button type="button" class="button small secondary" data-stats="${esc(member.tag)}">${icon('star')}Histórico e estatísticas</button><button type="button" class="button small ${row.whitelisted ? 'active-option' : 'secondary'}" data-action="priority" data-tag="${esc(member.tag)}" aria-pressed="${row.whitelisted}">${icon('flag')}${row.whitelisted ? 'Prioridade ativa' : 'Priorizar jogador'}</button><button type="button" class="button small ${row.blacklisted ? 'danger' : 'secondary'}" data-action="block" data-tag="${esc(member.tag)}" aria-pressed="${row.blacklisted}">${icon('x')}${row.blacklisted ? 'Remover bloqueio' : 'Bloquear no time'}</button></div></div></details></article>`;
    }).join('')}</div>` : `<div class="empty-search">${icon('search')}<h3>Nenhum jogador encontrado</h3><p>Tente outro nome, tag ou filtro.</p></div>`}<div class="list-count" aria-live="polite">${rows.length} ${rows.length === 1 ? 'jogador exibido' : 'jogadores exibidos'}${state.query ? ' nesta busca' : ''}</div>`;
    $$('#roster-content details').forEach((node) => node.addEventListener('toggle', () => { if (node.open) state.expanded.add(node.dataset.expand); else state.expanded.delete(node.dataset.expand); }));
  }
  function toggleSetting(key, title, description, name) {
    return `<label class="rule-toggle"><span class="rule-symbol">${icon(name)}</span><span class="rule-copy"><strong>${title}</strong><small>${description}</small></span><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''} ${state.loading ? 'disabled' : ''}><span class="switch" aria-hidden="true"></span></label>`;
  }
  function fixedRule(title, description, name) {
    return `<div class="rule-toggle fixed-rule"><span class="rule-symbol">${icon(name)}</span><span class="rule-copy"><strong>${title}</strong><small>${description}</small></span><span class="rule-state">Sempre</span></div>`;
  }
  function selectField(key, label, options, disabled = false, helper = '') {
    return `<label class="field"><span>${label}</span><select data-setting="${key}" ${disabled ? 'disabled' : ''}>${options.map(([value, text]) => `<option value="${value}" ${String(state.settings[key]) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select>${helper ? `<small>${helper}</small>` : ''}</label>`;
  }
  function renderRules() {
    $('#rules-view').innerHTML = `<div class="view-heading"><div class="eyebrow">SUA ESTRATÉGIA</div><h2 id="rules-title" tabindex="-1">Os critérios do seu time.</h2><p>As regras seguem o desempenho da guerra anterior, sem penalizar quem ainda não tem registro.</p></div><div class="rules-layout"><section class="settings-panel"><div class="panel-heading"><span class="section-index">01</span><div><h3>Regras da convocação</h3><p>Escudo vermelho bloqueia a seleção normal; a exceção só é usada para fechar o tamanho da guerra.</p></div></div><div class="rule-list">${fixedRule('Escudo vermelho', 'Só entra como última opção quando o arredondamento para cima deixa vagas para completar.', 'shield')}${fixedRule('Dois ataques e ao menos 1 estrela', 'Aplicado a quem participou da última guerra concluída do clã.', 'swords')}${fixedRule('Sem registro da guerra anterior', 'Permanece elegível; falta de dados não é motivo para excluir.', 'users')}${toggleSetting('usePlayerHistoryFallback', 'Consultar histórico pessoal', 'Desligado por padrão. Se faltar registro do clã, consulta a última guerra normal concluída do jogador, inclusive em outro clã.', 'clock')}</div></section>
      <section class="settings-panel"><div class="panel-heading"><span class="section-index">02</span><div><h3>Fechar o tamanho da guerra</h3><p>O tamanho padrão é calculado pelos jogadores com escudo verde.</p></div></div><div class="fields-grid">${selectField('rankBy', 'Ordenar a lista por', [['activity', 'Atividade: troféus e ranking'], ['position', 'Posição no clã'], ['th', 'Centro da Vila mais alto'], ['performance', 'Desempenho na última guerra'], ['name', 'Nome do jogador']], state.loading, 'A opção de atividade prioriza troféus e posição no clã. O CV não define essa ordem.')}</div><p class="settings-note">${icon('alert')}Times válidos têm 5, 10, 15… até 50 jogadores. Ex.: 36/37 disponíveis viram 35; 38/39 viram 40. Ao completar, entram os próximos reforços pela atividade do clã (troféus e ranking), sem priorizar CV. Escudos vermelhos só entram por último se ainda houver vagas. Bloqueios manuais sempre valem.</p></section>
      <section class="settings-panel priority-panel"><div class="panel-heading"><span class="section-index">03</span><div><h3>A palavra final é sua.</h3><p>Priorize ou bloqueie jogadores nos detalhes da lista.</p></div></div><div class="priority-counts"><span><b>${state.settings.whitelist.length}</b> na prioridade</span><span><b>${state.settings.blacklist.length}</b> bloqueados</span></div><p class="muted">A lista de prioridade pode superar critérios de desempenho, mas não remove bloqueios manuais. Escudos vermelhos só podem entrar pela regra de última opção para fechar uma guerra arredondada para cima. As listas de prioridade existentes são preservadas nas atualizações.</p><button type="button" class="button secondary" data-command="all-players">Gerenciar jogadores ${icon('arrow')}</button></section></div><button type="button" class="button primary rules-back" data-view="team">Ver time atualizado ${icon('arrow')}</button>`;
  }
  function warStarSet(value, label) {
    const stars = Math.max(0, Math.min(3, Number(value) || 0));
    return `<span class="war-star-set stars-${stars}" role="img" aria-label="${esc(label)}">${[1, 2, 3].map((n) => icon('star', n <= stars ? 'filled' : 'unfilled')).join('')}</span>`;
  }
  function warAttackList(attacks, identities, targetSide, war) {
    if (!attacks.length) return '<p class="war-no-hits">Ainda sem ataques</p>';
    return attacks.map((attack, index) => {
      const impact = attack.newStars === 0 && attack.stars > 0 ? 'Limpeza' : `+${attack.newStars} no placar`;
      const target = identities.get(E.normalizeTag(attack.defender.tag)) || attack.defender;
      return `<article class="war-hit"><span class="war-hit-order">${index + 1}º</span><span class="war-hit-target"><small class="war-hit-target-rank war-hit-target-rank--${targetSide}">#${esc(target.position ?? '—')}</small><strong>${esc(target.name || 'Alvo desconhecido')}</strong></span><span class="war-hit-result">${warStarSet(attack.stars, `${attack.stars} estrelas`)}<span>${E.fmtPct(attack.destruction)} <i>·</i> ${esc(attack.duration || '—')}</span></span><small class="war-hit-impact ${attack.newStars === 0 && attack.stars > 0 ? 'cleanup' : ''}">${impact}</small>${window.ScoreUI.assessment(war, attack)}</article>`;
    }).join('');
  }
  function warMapRows(war) {
    const ours = war.result.ourSide || 1;
    const theirs = war.result.opponentSide || (ours === 1 ? 2 : 1);
    const sides = {
      home: { number: ours, players: war.roster || war.players || [] },
      away: { number: theirs, players: war.opponentRoster || [] },
    };
    const attacks = new Map([[ours, new Map()], [theirs, new Map()]]);
    for (const attack of war.attacks || [...(war.ourAttacks || []), ...(war.opponentAttacks || [])]) {
      const sideMap = attacks.get(attack.side);
      if (!sideMap) continue;
      const tag = E.normalizeTag(attack.attacker.tag);
      if (!sideMap.has(tag)) sideMap.set(tag, []);
      sideMap.get(tag).push(attack);
    }
    for (const sideMap of attacks.values()) for (const list of sideMap.values()) list.sort((a, b) => a.order - b.order);

    const maxPosition = (players) => Math.max(0, ...players.map((player) => Number(player.position) || 0));
    const total = Math.max(Number(war.header.sizeHome) || 0, Number(war.header.sizeAway) || 0, maxPosition(sides.home.players), maxPosition(sides.away.players));
    const homeByPosition = new Map(sides.home.players.map((player) => [Number(player.position), player]));
    const awayByPosition = new Map(sides.away.players.map((player) => [Number(player.position), player]));
    const identities = new Map([...sides.home.players, ...sides.away.players].map((player) => [E.normalizeTag(player.tag), player]));
    const sideAttacks = (side, player) => player ? attacks.get(side.number)?.get(E.normalizeTag(player.tag)) || [] : [];
    const query = state.warQuery.toLocaleLowerCase('pt-BR').trim();
    const rows = [];
    for (let position = 1; position <= total; position += 1) {
      const home = homeByPosition.get(position);
      const away = awayByPosition.get(position);
      const homeAttacks = sideAttacks(sides.home, home);
      const awayAttacks = sideAttacks(sides.away, away);
      if (state.currentWarFilter === 'attacked' && !homeAttacks.length) continue;
      if (state.currentWarFilter === 'pending' && homeAttacks.length) continue;
      const searchable = [home?.name, home?.tag, away?.name, away?.tag, ...homeAttacks.map((attack) => attack.defender.name), ...awayAttacks.map((attack) => attack.defender.name)].join(' ').toLocaleLowerCase('pt-BR');
      if (query && !searchable.includes(query)) continue;
      const playerHeader = (player, playerAttacks, side) => {
        if (!player) return `<div class="war-side-head war-side-head--${side} war-side-head--empty"><span class="war-position">#${position}</span><span class="war-player-empty">Sem participante</span></div>`;
        const sets = Array.from({ length: Math.min(2, Number(war.header.attacksPerMember) || 2) }, (_, index) => {
          const attack = playerAttacks[index];
          return warStarSet(attack?.stars, attack ? `${index + 1}º ataque: ${attack.stars} estrelas` : `${index + 1}º ataque pendente`);
        }).join('');
        return `<div class="war-side-head war-side-head--${side}"><span class="war-position">${esc(player.position ?? position)}</span>${townHall(player.th)}<strong class="war-player-name">${esc(player.name)}</strong><span class="war-player-star-pair">${sets}</span></div>`;
      };
      const sideMarkup = (player, playerAttacks, side) => `<div class="war-base-side war-base-side--${side}">${playerHeader(player, playerAttacks, side)}${player ? `${window.ScoreUI.badges(war, player)}<div class="war-side-hits">${warAttackList(playerAttacks, identities, side === 'home' ? 'away' : 'home', war)}</div>` : ''}</div>`;
      rows.push(`<article class="war-base-pair" aria-label="Base ${position}">${sideMarkup(home, homeAttacks, 'home')}${sideMarkup(away, awayAttacks, 'away')}</article>`);
    }
    const html = rows.length ? rows.join('') : `<div class="war-map-empty">${icon(query ? 'search' : 'swords')}<span>${query ? 'Nenhum jogador encontrado nessa guerra.' : state.currentWarFilter === 'attacked' ? 'Ainda não há ataques registrados do nosso clã.' : 'Nenhuma base corresponde a este filtro.'}</span></div>`;
    return { html, count: rows.length, total };
  }
  function renderWarMap(war, kind) {
    const roster = war.roster || war.players || [];
    const opponentRoster = war.opponentRoster || [];
    const hasRoster = roster.length || opponentRoster.length;
    if (!hasRoster) return `<div class="war-empty-inline current-war-empty">${icon('clock')}<span><strong>Guerra em preparação</strong><small>Participantes e ataques aparecerão quando a escalação for definida.</small></span></div>`;
    const ours = war.result.ourSide || 1;
    const ownAttacks = (war.attacks || war.ourAttacks || []).filter((attack) => attack.side === ours);
    const attackedTags = new Set(ownAttacks.map((attack) => E.normalizeTag(attack.attacker.tag)));
    const attackedCount = roster.filter((player) => attackedTags.has(E.normalizeTag(player.tag))).length;
    const result = warMapRows(war);
    const inputLabel = kind === 'current' ? 'Buscar jogador na guerra atual' : 'Buscar jogador na última guerra';
    return `<section class="war-map" data-war-map-kind="${kind}" aria-label="Mapa de ataques">${window.ScoreUI.summary(war)}<div class="war-map-toolbar"><div class="war-map-title"><div class="eyebrow">MAPA DA GUERRA</div><h4>Bases e ataques</h4><small data-war-map-count>${result.count} de ${result.total} bases</small></div><label class="search-field war-map-search">${icon('search')}<input type="search" data-war-map-search aria-label="${inputLabel}" placeholder="Buscar jogador" value="${esc(state.warQuery)}"></label></div><div class="segments war-map-filters" role="group" aria-label="Filtrar mapa por ataques">${[['all', 'Todas', roster.length], ['attacked', 'Atacaram', attackedCount], ['pending', 'Pendentes', Math.max(0, roster.length - attackedCount)]].map(([filter, label, count]) => `<button type="button" data-current-war-filter="${filter}" aria-pressed="${state.currentWarFilter === filter}">${label}<span>${count}</span></button>`).join('')}</div><p class="war-score-map-caption">A posição organiza a lista. A avaliação usa o alvo escolhido em cada ataque.</p><div class="war-map-list">${result.html}</div></section>`;
  }
  function renderWarBattle(war, kind) {
    const ours = war.result.ourSide || 1;
    const theirs = war.result.opponentSide || (ours === 1 ? 2 : 1);
    const ourName = war.result.clans[ours]?.name || state.clanName || 'Nosso clã';
    const opponentName = war.result.clans[theirs]?.name || 'Adversário';
    const attacks = war.attacks || [...(war.ourAttacks || []), ...(war.opponentAttacks || [])];
    const ourAttackCount = war.result.attacksUsed == null ? attacks.filter((attack) => attack.side === ours).length : Number(war.result.attacksUsed);
    const opponentAttackCount = war.result.opponentAttacksUsed == null ? attacks.filter((attack) => attack.side === theirs).length : Number(war.result.opponentAttacksUsed);
    const ownLimit = Number(war.result.attacksMax) || war.header.sizeHome * war.header.attacksPerMember;
    const opponentLimit = Number(war.result.opponentAttacksMax) || war.header.sizeAway * war.header.attacksPerMember;
    const resultState = war.result.state;
    const tone = resultState === 'preparation' ? 'gold' : resultState === 'win' ? 'green' : resultState === 'lose' ? 'red' : 'blue';
    const label = war.result.label || (kind === 'current' ? 'EM ANDAMENTO' : 'GUERRA CONCLUÍDA');
    const scoreValue = (side) => war.result.stars[side] == null ? (resultState === 'preparation' ? '0' : '—') : war.result.stars[side];
    const pctValue = (side) => war.result.percents[side] == null ? '—' : E.fmtPct(war.result.percents[side]);
    const progressWidth = (count, limit) => limit ? Math.max(0, Math.min(100, count / limit * 100)) : 0;
    const maxAttacks = Math.max(ownLimit, opponentLimit);
    return `<section class="war-battle-card ${kind === 'history' ? 'war-battle-card--history' : ''}" aria-label="${kind === 'current' ? 'Guerra atual' : 'Última guerra concluída'}"><div class="war-battle-heading"><div><div class="eyebrow">${kind === 'current' ? 'GUERRA ATUAL' : 'ÚLTIMA GUERRA'} · ${war.header.sizeHome} × ${war.header.sizeAway}</div><h3>${esc(ourName)} <span>vs.</span> ${esc(opponentName)}</h3></div><span class="tag ${tone}">${esc(label)}</span></div><div class="war-match-score"><b>${esc(scoreValue(ours))}</b><span>${icon('star', 'filled')}</span><b>${esc(scoreValue(theirs))}</b></div><div class="war-match-teams"><div class="war-match-team war-match-team--home">${clanEmblem(war.result.clans[ours]?.badgeUrls || state.clanBadgeUrl, ourName, 'score-crest')}<div><strong>${esc(ourName)}</strong><small>${pctValue(ours)} destruição</small></div>${resultState === 'win' ? '<span class="war-outcome">Vitória</span>' : resultState === 'lose' ? '<span class="war-outcome war-outcome--loss">Derrota</span>' : ''}</div><span class="war-match-divider">${icon('swords')}</span><div class="war-match-team war-match-team--away">${resultState === 'win' ? '<span class="war-outcome war-outcome--loss">Derrota</span>' : resultState === 'lose' ? '<span class="war-outcome">Vitória</span>' : ''}<div><strong>${esc(opponentName)}</strong><small>${pctValue(theirs)} destruição</small></div>${clanEmblem(war.result.clans[theirs]?.badgeUrls, opponentName, 'opponent-crest')}</div></div><div class="war-attack-usage"><div class="war-usage-side war-usage-side--home"><span><b>${ourAttackCount}</b> / ${ownLimit} ataques</span><i><b style="width:${progressWidth(ourAttackCount, ownLimit)}%"></b></i></div><span class="war-usage-icon">${icon('swords')}</span><div class="war-usage-side war-usage-side--away"><span><b>${opponentAttackCount}</b> / ${opponentLimit} ataques</span><i><b style="width:${progressWidth(opponentAttackCount, opponentLimit)}%"></b></i></div></div>${maxAttacks ? `<p class="war-usage-caption">Cada clã pode usar até ${maxAttacks} ataques nesta guerra.</p>` : ''}${renderWarMap(war, kind)}</section>`;
  }
  function renderCurrentWar(war) {
    return renderWarBattle(war, 'current');
  }
  function renderWar() {
    const war = state.lastWar; const current = state.currentWar;
    const previousDisclosure = $('#previous-war-disclosure');
    if (previousDisclosure) state.previousWarExpanded = previousDisclosure.open;
    const stages = state.loadStages || {};
    const heading = `<div class="view-heading war-view-heading"><div class="eyebrow">RELATÓRIO DE BATALHA</div><h2 id="war-title" tabindex="-1">Guerras do clã</h2><p>Placar atual, ataques e resultado anterior em um só lugar.</p></div>`;
    let content = heading;
    if (current) content += renderCurrentWar(current);
    else if (state.loading && stages.currentWar === 'loading') content += `<section class="war-loading-card skeleton" aria-label="Consultando a guerra atual"><div class="war-loading-title"></div><div class="war-loading-score"></div><div class="war-loading-caption">Buscando placar e participantes da guerra atual…</div></section>`;
    else content += `<div class="war-empty-inline">${icon(stages.currentWar === 'error' ? 'alert' : 'swords')}<span><strong>${stages.currentWar === 'error' ? 'Guerra atual indisponível' : 'Nenhuma guerra em andamento'}</strong><small>${stages.currentWar === 'error' ? 'O histórico continua disponível abaixo, se a consulta tiver sucesso.' : 'O relatório atual aparecerá quando o clã entrar em preparação.'}</small></span></div>`;
    if (war) {
      const ours = war.result.ourSide || 1; const theirs = war.result.opponentSide || 2;
      const resultTone = war.result.state === 'win' ? 'green' : war.result.state === 'lose' ? 'red' : 'gold';
      const ourName = war.result.clans[ours]?.name || state.clanName || 'Nosso clã';
      const opponentName = war.result.clans[theirs]?.name || 'Adversário';
      const resultStars = `${war.result.stars[ours] ?? '—'} × ${war.result.stars[theirs] ?? '—'}`;
      content += `<details id="previous-war-disclosure" class="previous-war-disclosure" ${state.previousWarExpanded ? 'open' : ''}><summary><span class="previous-war-summary-copy"><span class="eyebrow">HISTÓRICO</span><strong>Última guerra concluída</strong><small>${war.header.sizeHome} × ${war.header.sizeAway} · ${esc(ourName)} x ${esc(opponentName)}</small></span><span class="previous-war-summary-result"><span class="tag ${resultTone}">${icon(war.result.state === 'win' ? 'check' : 'swords')}${esc(war.result.label)}</span><b>${resultStars}</b></span>${icon('chevron')}</summary><div class="previous-war-content"><div class="previous-war-actions"><button type="button" class="button secondary" data-command="stats">${icon('star')}Estatísticas e CWL</button></div>${renderWarBattle(war, 'history')}</div></details>`;
    } else if (state.loading && stages.history === 'loading') {
      content += `<section class="war-loading-history skeleton" aria-label="Consultando histórico de guerras"><span></span><i></i><small>Buscando a última guerra concluída…</small></section>`;
    } else {
      content += `<div class="war-empty-inline history-empty">${icon(stages.history === 'error' ? 'alert' : 'clock')}<span><strong>${stages.history === 'error' ? 'Histórico indisponível' : 'Nenhuma guerra anterior disponível'}</strong><small>O resultado anterior aparece aqui quando estiver disponível.</small></span></div>`;
    }
    $('#war-view').innerHTML = content;
    if (state.view === 'war') queueMicrotask(() => {
      if (state.currentWar) window.ScoreUI.ensure(state.currentWar);
      if (state.lastWar && (state.previousWarExpanded || !state.currentWar)) window.ScoreUI.ensure(state.lastWar);
    });
  }
  function updateWarMapLists() {
    for (const node of $$('[data-war-map-kind]')) {
      const war = node.dataset.warMapKind === 'current' ? state.currentWar : state.lastWar;
      if (!war) continue;
      const result = warMapRows(war);
      const list = node.querySelector('.war-map-list');
      if (list) list.innerHTML = result.html;
      const count = node.querySelector('[data-war-map-count]');
      if (count) count.textContent = `${result.count} de ${result.total} bases`;
    }
    $$('[data-war-map-search]').forEach((input) => { if (input.value !== state.warQuery) input.value = state.warQuery; });
  }
  function setView(view, focus = true) {
    if (!viewTitles[view]) return;
    state.view = view;
    document.body.dataset.view = view;
    window.CwlApp.setActive(view === 'cwl');
    renderHeader(); renderStatus(); updateCopyControl();
    for (const key of Object.keys(viewTitles)) $('#' + key + '-view').hidden = key !== view;
    $$('nav [data-view]').forEach((node) => { if (node.dataset.view === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
    if (view === 'war') {
      if (state.currentWar) window.ScoreUI.ensure(state.currentWar);
      if (state.lastWar && (state.previousWarExpanded || !state.currentWar)) window.ScoreUI.ensure(state.lastWar);
    }
    if (focus) { window.scrollTo({ top: 0, behavior: 'instant' }); $('#' + view + '-title')?.focus({ preventScroll: true }); }
  }
  async function loadPersonalHistoryFallback() {
    const token = ++state.historyToken;
    state.personalWarByTag = new Map();
    state.personalHistoryStatusByTag = new Map();
    state.historyLookupWarning = '';
    if (!state.settings.usePlayerHistoryFallback) {
      state.historyLoading = false;
      if (!state.loading) render();
      return;
    }
    if (state.source !== 'worker') {
      state.historyLoading = false;
      state.historyLookupWarning = state.source === 'demo' ? 'O histórico pessoal não é aplicado aos dados de demonstração.' : '';
      if (!state.loading) render();
      return;
    }
    const tagsWithClanWarData = new Set((state.lastWar?.players || []).map((player) => E.normalizeTag(player.tag)));
    const manuallyExcluded = new Set([...state.settings.blacklist, ...state.settings.forcedOut]);
    const candidates = state.members.filter((member) =>
      !tagsWithClanWarData.has(E.normalizeTag(member.tag))
      && member.pref !== 'out'
      && !manuallyExcluded.has(E.normalizeTag(member.tag))
    );
    if (!candidates.length) {
      state.historyLoading = false;
      if (!state.loading) render();
      return;
    }

    state.historyLoading = true;
    state.status = `Consultando histórico pessoal: 0/${candidates.length} jogadores…`;
    if (!state.loading) render(); else renderStatus();
    const warsByTag = new Map();
    const statusesByTag = new Map();
    let checked = 0;
    let failed = 0;
    for (let offset = 0; offset < candidates.length; offset += 3) {
      const batch = candidates.slice(offset, offset + 3);
      const results = await Promise.allSettled(batch.map((member) => window.ClanAPI.loadPlayerStats(member.tag)));
      if (token !== state.historyToken || !state.settings.usePlayerHistoryFallback) return;
      results.forEach((result, index) => {
        const tag = E.normalizeTag(batch[index].tag);
        if (result.status === 'rejected') {
          statusesByTag.set(tag, 'unavailable');
          failed += 1;
          return;
        }
        const war = window.WarStats.latestCompletedRegularWar(result.value.items || []);
        if (war) {
          warsByTag.set(tag, war);
          statusesByTag.set(tag, 'found');
        } else statusesByTag.set(tag, 'none');
      });
      checked += batch.length;
      state.status = `Consultando histórico pessoal: ${checked}/${candidates.length} jogadores…`;
      renderStatus();
    }
    if (token !== state.historyToken || !state.settings.usePlayerHistoryFallback) return;
    state.personalWarByTag = warsByTag;
    state.personalHistoryStatusByTag = statusesByTag;
    state.historyLoading = false;
    state.status = '';
    state.historyLookupWarning = failed
      ? `Não foi possível consultar o histórico de ${failed} jogador(es). Sem registro verificável, eles permanecem elegíveis.`
      : '';
    if (!state.loading) render(); else renderStatus();
  }
  async function loadClan(tag = state.clanTag) {
    if (state.loading) return;
    const normalized = E.normalizeTag(tag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(normalized)) { toast('Digite uma tag de clã válida, como #2G8QCR92V.'); return; }
    audit('clan_load_started');
    window.ScoreUI.reset();
    state.clanTag = normalized; state.clanName = ''; state.clanBadgeUrl = ''; state.members = []; state.lastWar = null; state.currentWar = null;
    window.CwlApp.setContext(normalized, false);
    state.historyToken += 1; state.personalWarByTag = new Map(); state.personalHistoryStatusByTag = new Map(); state.historyLoading = false; state.historyLookupWarning = '';
    state.source = ''; state.dataWarnings = []; state.fetchedAt = ''; state.error = ''; state.loading = true;
    state.loadStages = null; state.memberProgress = null; state.currentWarFilter = 'all'; state.warQuery = ''; state.previousWarExpanded = false;
    state.status = 'Consultando membros, escudos e guerras…'; state.expanded.clear();
    render();
    try {
      const data = await window.ClanAPI.loadClan(normalized, {
        onStatus: (message) => { state.status = message; renderStatus(); },
        onProgress: (progress) => {
          const previousStages = state.loadStages;
          const coreStageChanged = !previousStages || ['clan', 'currentWar', 'history'].some((key) => previousStages[key] !== progress.stages[key]);
          state.loadStages = progress.stages;
          state.memberProgress = progress.profiles;
          if (progress.profiles.total && progress.profiles.done < progress.profiles.total) {
            state.status = `Consultando escudos: ${progress.profiles.done}/${progress.profiles.total} jogadores…`;
          } else if (progress.stages.profiles === 'done' && (progress.stages.currentWar === 'loading' || progress.stages.history === 'loading')) {
            state.status = 'Escudos consultados · aguardando dados das guerras…';
          } else if (progress.stages.clan === 'loading') state.status = 'Consultando membros do clã…';
          else if (progress.stages.currentWar === 'loading' || progress.stages.history === 'loading') state.status = 'Aguardando a guerra atual e o histórico…';
          renderStatus();
          if (coreStageChanged) renderWar();
        },
        onData: (update) => {
          if (update.type === 'clan') {
            state.clanName = update.clan.name || '';
            state.clanBadgeUrl = badgeUrl(update.clan.badgeUrls);
            state.source = 'worker';
          } else if (update.type === 'currentWar') {
            state.currentWar = update.currentWar ? E.buildWar(update.currentWar) : null;
          } else if (update.type === 'lastWar') {
            state.lastWar = update.lastWar ? E.buildWar(update.lastWar) : null;
          } else if (update.type === 'warnings') {
            state.dataWarnings = update.warnings;
          }
          render();
        },
      });
      state.members = data.members; state.clanName = data.clan.name; state.clanBadgeUrl = badgeUrl(data.clan.badgeUrls);
      state.lastWar = data.lastWar ? E.buildWar(data.lastWar) : null;
      state.currentWar = data.currentWar ? E.buildWar(data.currentWar) : null;
      state.source = 'worker'; state.fetchedAt = data.fetchedAt; state.dataWarnings = data.warnings;
      if (state.settings.usePlayerHistoryFallback) await loadPersonalHistoryFallback();
      saveSettings(); audit('clan_load_succeeded');
    } catch (error) { state.error = error.message || 'Tente novamente em alguns instantes.'; audit('clan_load_failed'); }
    finally { state.loading = false; render(); }
  }
  async function loadDemo() {
    window.ScoreUI.reset();
    state.historyToken += 1; state.personalWarByTag = new Map(); state.personalHistoryStatusByTag = new Map(); state.historyLoading = false;
    state.loading = true; state.loadStages = null; state.memberProgress = null; state.previousWarExpanded = false; state.currentWarFilter = 'all'; state.warQuery = ''; render();
    try {
      const response = await fetch('portal/demo.json', { credentials: 'omit' });
      if (!response.ok) throw new Error('Demonstração indisponível.');
      const data = await response.json();
      state.clanTag = E.DEFAULT_CLAN; state.clanName = data.lastWar.result.clans[data.lastWar.result.ourSide].name;
      state.members = data.members; state.lastWar = E.buildWar(data.lastWar); state.currentWar = E.buildWar(data.currentWar);
      state.clanBadgeUrl = badgeUrl(data.lastWar.result.clans[data.lastWar.result.ourSide].badgeUrls);
      state.source = 'demo'; state.fetchedAt = ''; state.error = ''; state.dataWarnings = [];
      window.CwlApp.setContext(state.clanTag, true);
      state.historyLookupWarning = state.settings.usePlayerHistoryFallback ? 'O histórico pessoal não é aplicado aos dados de demonstração.' : '';
      audit('demo_loaded');
    } catch (error) { state.error = error.message; }
    finally { state.loading = false; render(); }
  }
  function handleSetting(target) {
    const key = target.dataset.setting;
    if (!Object.hasOwn(E.DEFAULT_SETTINGS, key)) return;
    state.settings[key] = target.type === 'checkbox' ? target.checked : target.value;
    saveSettings(); audit('setting_changed', { setting: key, value: state.settings[key] });
    if (key === 'usePlayerHistoryFallback') {
      if (state.settings.usePlayerHistoryFallback) void loadPersonalHistoryFallback();
      else {
        state.historyToken += 1; state.historyLoading = false; state.historyLookupWarning = '';
        state.personalWarByTag = new Map(); state.personalHistoryStatusByTag = new Map(); render();
      }
    } else render();
    $(`[data-setting="${key}"]`)?.focus({ preventScroll: true });
  }
  function adjustPlayer(action, tag) {
    const row = state.selection?.all.find((r) => r.member.tag === tag);
    if (!row) return;
    const sets = Object.fromEntries(['forcedIn', 'forcedOut', 'whitelist', 'blacklist'].map((key) => [key, new Set(state.settings[key])]));
    let auditAction; let message;
    if (action === 'force-in') {
      if (row.hardFail) return;
      sets.forcedOut.delete(tag); sets.forcedIn.add(tag); auditAction = 'manual_inclusion'; message = 'Jogador incluído na sugestão.';
    } else if (action === 'force-out') {
      sets.forcedIn.delete(tag); sets.whitelist.delete(tag); sets.forcedOut.add(tag); auditAction = 'manual_removal'; message = 'Jogador retirado da sugestão.';
    } else if (action === 'clear-force') {
      sets.forcedIn.delete(tag); sets.forcedOut.delete(tag); auditAction = 'manual_override_cleared'; message = 'Ajuste manual desfeito.';
    } else if (action === 'priority') {
      if (sets.whitelist.has(tag)) { sets.whitelist.delete(tag); auditAction = 'whitelist_removed'; message = 'Prioridade removida.'; }
      else { sets.whitelist.add(tag); sets.blacklist.delete(tag); sets.forcedIn.delete(tag); sets.forcedOut.delete(tag); auditAction = 'whitelist_added'; message = 'Prioridade aplicada. O filtro de escudo continua valendo.'; }
    } else if (action === 'block') {
      if (sets.blacklist.has(tag)) { sets.blacklist.delete(tag); auditAction = 'blacklist_removed'; message = 'Bloqueio removido.'; }
      else { sets.blacklist.add(tag); sets.whitelist.delete(tag); sets.forcedIn.delete(tag); sets.forcedOut.delete(tag); auditAction = 'blacklist_added'; message = 'Jogador bloqueado na sugestão.'; }
    } else return;
    for (const [key, set] of Object.entries(sets)) state.settings[key] = [...set];
    const scroll = window.scrollY;
    saveSettings(); audit(auditAction); render(); window.scrollTo(0, scroll); toast(message);
  }
  function openStats(tag = state.members[0]?.tag) {
    if (!tag) return;
    const member = state.members.find((m) => m.tag === tag) || state.lastWar?.players.find((p) => p.tag === tag);
    statsState.tag = tag; statsState.name = member?.name || '#' + tag;
    statsOpener = document.activeElement;
    const members = [...state.members];
    if (!members.some((m) => m.tag === tag)) members.unshift({ tag, name: statsState.name });
    $('#stats-player').innerHTML = members.map((m) => `<option value="${esc(m.tag)}" ${m.tag === tag ? 'selected' : ''}>${esc(m.name)} · #${esc(m.tag)}</option>`).join('');
    if (!$('#stats-dialog').open) $('#stats-dialog').showModal();
    audit('player_stats_opened');
    loadStats();
  }
  function closeStats() { $('#stats-dialog').close(); statsOpener?.focus({ preventScroll: true }); }
  async function loadStats() {
    const token = ++statsState.token;
    const tag = statsState.tag;
    statsState.loading = true; statsState.error = ''; statsState.data = null; renderStats();
    try {
      const cached = statsState.cache.get(tag);
      const data = cached && Date.now() - cached.at < 60000 ? cached.data : await window.ClanAPI.loadPlayerStats(tag);
      statsState.cache.set(tag, { data, at: Date.now() });
      if (token === statsState.token) statsState.data = data;
    } catch (error) { if (token === statsState.token) statsState.error = error.message; }
    finally { if (token === statsState.token) { statsState.loading = false; renderStats(); } }
  }
  function renderStats() {
    $('#stats-title').textContent = statsState.name;
    const body = $('#stats-body');
    if (statsState.loading) { body.innerHTML = `<div class="stats-loading" role="status">${icon('refresh', 'spinning')}Consultando o histórico do jogador…</div>`; return; }
    if (statsState.error) { body.innerHTML = `<div class="stats-error">${icon('alert')}<h3>Histórico indisponível</h3><p>${esc(statsState.error)}</p><button type="button" class="button secondary" data-command="retry-stats">Tentar novamente</button></div>`; return; }
    const items = statsState.data?.items || [];
    const summary = window.WarStats.summarize(items, statsState.type);
    const counts = Object.fromEntries(['random', 'cwl'].map((type) => [type, items.filter((w) => w.type === type && w.state === 'warEnded').length]));
    const decimal = (value) => value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const percent = (value) => value == null ? '—' : decimal(value) + '%';
    const metrics = [
      [summary.attacks + '<small>/' + summary.opportunities + '</small>', 'Ataques usados'],
      [decimal(summary.averageStars), 'Média de estrelas'],
      [percent(summary.tripleRate), 'Ataques com 3 estrelas'],
      [percent(summary.averageDestruction), 'Destruição média'],
    ];
    body.innerHTML = `<div class="segments stats-tabs" role="group" aria-label="Tipo de guerra nas estatísticas"><button type="button" data-stats-type="random" aria-pressed="${statsState.type === 'random'}">Guerras normais<span>${counts.random}</span></button><button type="button" data-stats-type="cwl" aria-pressed="${statsState.type === 'cwl'}">Liga (CWL)<span>${counts.cwl}</span></button></div><p class="stats-scope">Até 100 registros pessoais retornados pelo ClashKing. O histórico pode incluir outros clãs; apenas guerras concluídas entram nos cálculos.</p>${summary.wars.length ? `<div class="stats-metrics">${metrics.map(([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`).join('')}</div><p class="stats-usage ${summary.missed ? 'red' : 'green'}">${icon(summary.missed ? 'alert' : 'check')}${summary.missed ? `${summary.missed} ${summary.missed === 1 ? 'ataque não usado' : 'ataques não usados'} em ${summary.wars.length} guerras concluídas.` : `Todos os ataques usados nas ${summary.wars.length} guerras concluídas.`}</p><div class="stats-recent-heading"><h3>${statsState.type === 'cwl' ? 'Rodadas recentes da Liga' : 'Guerras recentes'}</h3><span>Últimas ${Math.min(summary.wars.length, 12)} do histórico</span></div><div class="stats-war-list">${summary.wars.slice(0, 12).map((war) => {
      const attacks = [...war.attacks].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
      const timestamp = window.ClashKing.timestamp(war.endTime);
      const date = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('pt-BR') : 'Data não informada';
      return `<div class="stats-war-row"><div class="stats-match"><strong>${date}<span>${war.teamSize || '—'} × ${war.teamSize || '—'}</span></strong><p title="${esc(war.clan.name || '')} × ${esc(war.opponent.name || '')}">${esc(war.clan.name || 'Clã')} × ${esc(war.opponent.name || 'Adversário')}</p></div>${attackMetric(attacks[0]?.stars, '1º ataque')}${war.attacksPerMember > 1 ? attackMetric(attacks[1]?.stars, '2º ataque') : '<span class="cwl-single">1 ataque<br>por rodada</span>'}</div>`;
    }).join('')}</div>` : `<div class="stats-empty">${icon('swords')}<h3>${statsState.type === 'cwl' ? 'Sem rodadas de Liga concluídas' : 'Sem guerras concluídas neste histórico'}</h3><p>${statsState.type === 'cwl' ? 'Os resultados de CWL aparecerão aqui quando estiverem registrados pela fonte. Cada rodada usa a quantidade de ataques informada pela guerra.' : 'A fonte ainda não retornou resultados completos para este tipo de guerra.'}</p></div>`}${summary.ongoing ? `<p class="stats-scope">${summary.ongoing} ${summary.ongoing === 1 ? 'registro em andamento ficou fora dos cálculos' : 'registros em andamento ficaram fora dos cálculos'}.</p>` : ''}<p class="stats-source">${icon('clock')}Consulta em ${esc(new Date(statsState.data.fetchedAt).toLocaleString('pt-BR'))} · cache de até 1 minuto.</p>`;
  }
  function tsvCell(value) {
    let text = String(value ?? '').replace(/[\t\r\n]+/g, ' ');
    // Public player names must remain text when pasted into a spreadsheet.
    if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return text;
  }
  function selectionTSV() {
    if (!state.selection?.selected.length) return '';
    const rows = [['Ordem', 'Jogador', 'Tag', 'Cargo', 'Centro da Vila', 'Escudo', 'Fonte do desempenho', 'Ataques', '1º ataque (estrelas)', '2º ataque (estrelas)', 'Estrelas', 'Novas estrelas', 'Ataques com 3 estrelas', 'Convocação']];
    state.selection.selected.forEach((row, index) => rows.push([index + 1, row.member.name, '#' + row.member.tag, roleNames[row.member.role] || row.member.role, row.member.th, prefNames[row.member.pref], row.usedPersonalHistory ? 'Histórico pessoal' : row.inWar ? 'Última guerra do clã' : '', row.criteriaPerf?.attacks ?? '', row.criteriaPerf?.firstAttackStars ?? '', row.criteriaPerf?.secondAttackStars ?? '', row.criteriaPerf?.stars ?? '', row.inWar ? row.perf.newStars : '', row.criteriaPerf?.triples ?? '', reason(row).label]));
    return rows.map((row) => row.map(tsvCell).join('\t')).join('\r\n');
  }
  function fallbackCopy(text) {
    const previous = document.activeElement;
    const input = document.createElement('textarea'); input.value = text; input.className = 'clipboard-helper'; document.body.appendChild(input); input.focus(); input.select();
    let copied = false; try { copied = document.execCommand('copy'); } catch { /* Offer TSV download instead. */ }
    input.remove(); previous?.focus({ preventScroll: true }); return copied;
  }
  async function copySelection() {
    const cwl = state.view === 'cwl';
    const text = cwl ? window.CwlApp.exportTSV() : selectionTSV(); if (!text) return;
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* Use the local fallback. */ }
    if (!copied) copied = fallbackCopy(text);
    if (copied) { audit('selection_copied'); toast(cwl ? `${window.CwlApp.state.activeTab === 'ranking' ? 'Ranking' : 'Plano'} copiado em colunas. Cole no Excel.` : `${state.selection.selected.length} jogadores copiados em colunas. Cole no Excel.`); }
    else if (cwl) downloadSelection();
    else toast('Não foi possível copiar. Use “Baixar TSV” e abra o arquivo no Excel.');
  }
  function downloadSelection() {
    const cwl = state.view === 'cwl';
    const text = cwl ? window.CwlApp.exportTSV() : selectionTSV(); if (!text) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/tab-separated-values;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${cwl ? 'cwl-' + window.CwlApp.state.activeTab : 'time'}-${state.clanTag}-${new Date().toISOString().slice(0, 10)}.tsv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    audit('selection_exported'); toast('TSV baixado. Abra no Excel ou em outra planilha.');
  }
  function openClan() {
    dialogOpener = document.activeElement; $('#clan-input').value = '#' + state.clanTag;
    $('#clan-dialog').showModal();
  }
  function closeClan() { $('#clan-dialog').close(); dialogOpener?.focus(); }
  function bindEvents() {
    document.addEventListener('error', (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.dataset.visual) return;
      image.hidden = true;
      image.parentElement.classList.add('asset-missing');
      const fallback = image.parentElement.querySelector('.badge-fallback');
      if (fallback) fallback.hidden = false;
    }, true);
    $('#close-stats').addEventListener('click', closeStats);
    $('#stats-player').addEventListener('change', (event) => { statsState.tag = event.target.value; statsState.name = state.members.find((m) => m.tag === statsState.tag)?.name || '#' + statsState.tag; loadStats(); });
    $('#stats-dialog').addEventListener('click', (event) => { if (event.target === $('#stats-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeStats(); } });
    $('#refresh').addEventListener('click', () => state.view === 'cwl' ? window.CwlApp.refresh() : loadClan());
    $('#open-clan').addEventListener('click', openClan);
    $('#close-clan').addEventListener('click', closeClan);
    $('#clan-dialog').addEventListener('click', (event) => { if (event.target === $('#clan-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeClan(); } });
    $('#clan-form').addEventListener('submit', (event) => { event.preventDefault(); const tag = E.normalizeTag($('#clan-input').value); if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag)) { $('#clan-input').setCustomValidity('Use uma tag válida de clã.'); $('#clan-input').reportValidity(); return; } closeClan(); setView('team', false); loadClan(tag); });
    $('#clan-input').addEventListener('input', () => $('#clan-input').setCustomValidity(''));
    $('#mobile-copy').addEventListener('click', copySelection);
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.dataset.view) setView(button.dataset.view);
      if (button.dataset.stats) openStats(button.dataset.stats);
      if (button.dataset.statsType) { statsState.type = button.dataset.statsType; audit('player_stats_filter_changed'); renderStats(); }
      if (button.dataset.command === 'stats') openStats();
      if (button.dataset.command === 'retry-stats') loadStats();
      if (button.dataset.filter) { state.filter = button.dataset.filter; renderTeam(); }
      if (button.dataset.currentWarFilter) { state.currentWarFilter = button.dataset.currentWarFilter; renderWar(); }
      if (button.dataset.action) adjustPlayer(button.dataset.action, button.dataset.tag);
      if (button.dataset.command === 'refresh') loadClan();
      if (button.dataset.command === 'copy') copySelection();
      if (button.dataset.command === 'export') downloadSelection();
      if (button.dataset.command === 'open-clan') openClan();
      if (button.dataset.command === 'all-players') { state.filter = 'all'; state.query = ''; renderTeam(); setView('team'); $('#roster-search')?.focus({ preventScroll: true }); $('#team-title')?.scrollIntoView({ block: 'start' }); }
    });
    $('#main').addEventListener('change', (event) => { if (event.target.dataset.setting) handleSetting(event.target); });
    $('#main').addEventListener('input', (event) => {
      if (event.target.id === 'roster-search') { state.query = event.target.value; renderRoster(); }
      if (event.target.matches('[data-war-map-search]')) { state.warQuery = event.target.value; updateWarMapLists(); }
    });
    $('#main').addEventListener('toggle', (event) => {
      if (event.target.id === 'previous-war-disclosure') {
        state.previousWarExpanded = event.target.open;
        if (event.target.open && state.lastWar) window.ScoreUI.ensure(state.lastWar);
      }
    }, true);
  }
  window.ScoreUI.init(() => { if (state.view === 'war') renderWar(); });
  loadSettings();
  const params = new URLSearchParams(location.search);
  window.CwlApp.init({ clanTag: params.get('demo') === '1' ? E.DEFAULT_CLAN : state.clanTag, demo: params.get('demo') === '1',
    activeTab: params.get('tab'), onChange: () => { updateCopyControl(); if (state.view === 'cwl') renderHeader(); }, exportData: copySelection });
  bindEvents(); render(); setView(params.get('view') === 'cwl' ? 'cwl' : 'team', false); audit('page_view');
  // Deterministic demo is available for design review; live failures never trigger it.
  if (new URLSearchParams(location.search).get('demo') === '1') loadDemo(); else loadClan();
  window.ClanManager = { state, selectionTSV, loadClan };
})();
