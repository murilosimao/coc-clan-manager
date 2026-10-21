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
  const viewTitles = { team: 'Time de guerra', rules: 'Critérios', war: 'Última guerra' };
  const state = {
    clanTag: E.DEFAULT_CLAN, clanName: '', clanBadgeUrl: '', members: [], lastWar: null, currentWar: null,
    settings: structuredClone(E.DEFAULT_SETTINGS), selection: null, source: '', fetchedAt: '',
    dataWarnings: [], loading: false, status: '', error: '', view: 'team', filter: 'selected',
    query: '', warQuery: '', warTab: 'players', expanded: new Set(), advancedOpen: false,
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
      state.settings.fixedSize = E.STANDARD_SIZES.includes(Number(state.settings.fixedSize)) ? Number(state.settings.fixedSize) : 30;
    } catch { /* Storage is optional. */ }
  }
  function saveSettings() {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...state.settings, clanTag: state.clanTag })); } catch { /* Storage is optional. */ }
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
    if (row.hardFail) return { label: row.member.pref === 'out' ? 'Escudo vermelho' : 'Escudo não confirmado', tone: 'muted', detail: row.hardReasons.join(' · ') };
    if (row.forcedOut) return { label: 'Removido por você', tone: 'muted', detail: 'Um ajuste manual retirou este jogador do time.' };
    if (row.forcedIn) return { label: 'Incluído por você', tone: 'blue', detail: 'Inclusão manual, respeitando os filtros de escudo e a lista de exclusão.' };
    if (row.whitelisted) return { label: 'Lista de prioridade', tone: 'blue', detail: 'A prioridade permite incluir sem cumprir os critérios de desempenho.' };
    if (row.ruleReasons.length) return { label: 'Sem ataque com 3 estrelas', tone: 'red', detail: row.ruleReasons.join(' · ') };
    if (row.trimmed) return { label: 'Sem vaga neste time', tone: 'muted', detail: 'O jogador está apto, mas o time atingiu o tamanho definido.' };
    if (row.exception) return { label: 'Exceção para completar', tone: 'gold', detail: row.softReasons.join(' · ') || 'Incluído para completar o tamanho do time.' };
    if (row.eligible) return { label: 'Critérios atendidos', tone: 'green', detail: 'Atende aos critérios ativos para esta convocação.' };
    return { label: !row.inWar ? 'Sem registro de guerra' : 'Desempenho abaixo do critério', tone: 'muted', detail: row.softReasons.join(' · ') };
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
    state.selection = state.members.length ? E.selectTeam(state.members, state.lastWar, state.settings, state.currentWar) : null;
  }
  function render() {
    updateSelection(); renderHeader(); renderStatus(); renderTeam(); renderRules(); renderWar();
    const canCopy = Boolean(state.selection?.selected.length) && !state.loading;
    $('#mobile-copy').disabled = !canCopy;
    $('#refresh').disabled = state.loading;
    if (!$('#clan-dialog').open) $('#clan-input').value = '#' + state.clanTag;
    $('#clan-form button[type=submit]').disabled = state.loading;
    $('#source-info').innerHTML = `<h3>Sobre os dados</h3><p>${state.source === 'demo' ? 'Demonstração de 20/10/2026. Esta captura não representa o clã em tempo real.' : 'Os escudos e membros vêm dos perfis públicos do jogo. O desempenho usa a última guerra concluída disponível. As fontes podem apresentar atraso de atualização; o cache dura até 1 minuto.'}</p>${state.fetchedAt ? `<p>Última consulta: ${esc(new Date(state.fetchedAt).toLocaleString('pt-BR'))}.</p>` : ''}`;
  }
  function renderHeader() {
    $('#clan-name').textContent = state.clanName || (state.loading ? 'Convocando os dados…' : 'Seu clã. Seu próximo time.');
    $('#clan-tag').textContent = '#' + state.clanTag;
    $('#clan-eyebrow').textContent = state.source === 'demo' ? 'DEMONSTRAÇÃO · 20 OUT 2026' : 'PREPARAÇÃO DE GUERRA';
    $('#data-freshness').textContent = state.loading ? 'Consultando o clã' : state.fetchedAt ? `Atualizado às ${new Date(state.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : state.source === 'demo' ? 'Dados de demonstração' : 'Dados ainda não carregados';
    $('#refresh').innerHTML = `${icon('refresh', state.loading ? 'spinning' : '')}<span>${state.loading ? 'Atualizando' : 'Atualizar'}</span>`;
  }
  function renderStatus() {
    const node = $('#status');
    node.hidden = !state.loading && !state.error && !state.dataWarnings.length && state.source !== 'demo';
    node.className = 'status-banner ' + (state.error ? 'error' : state.loading ? 'loading' : 'notice');
    if (state.error) node.innerHTML = `${icon('alert')}<div><strong>Não foi possível atualizar o clã</strong><p>${esc(state.error)}</p></div><button type="button" class="button secondary" data-command="refresh">Tentar de novo</button>`;
    else if (state.loading) node.innerHTML = `${icon('refresh', 'spinning')}<span>${esc(state.status || 'Consultando membros, escudos e guerras…')}</span>`;
    else if (state.source === 'demo') node.innerHTML = `${icon('flag')}<span>Você está explorando uma demonstração de 20/10/2026.</span><button type="button" class="text-button" data-command="refresh">Usar dados atuais</button>`;
    else node.innerHTML = `${icon('alert')}<div>${state.dataWarnings.map((warning) => `<p>${esc(warning)}</p>`).join('')}</div>`;
  }
  function summary() {
    const s = state.selection;
    const green = state.members.filter((m) => m.pref === 'in').length;
    const red = state.members.filter((m) => m.pref === 'out').length;
    const unknown = state.members.length - green - red;
    const count = s.selected.length;
    const complete = count === s.target;
    const exceptions = s.selected.filter((r) => r.exception && !r.whitelisted).length;
    const priority = s.selected.filter((r) => r.whitelisted).length;
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
    container.innerHTML = `${summary()}<div class="workspace-grid"><section class="roster-panel" aria-labelledby="team-title"><div class="section-heading"><div><div class="eyebrow">TIME DE GUERRA</div><h2 id="team-title" tabindex="-1">Escalação sugerida</h2></div><button type="button" class="button primary desktop-copy" data-command="copy">${icon('copy')}Copiar para Excel</button></div>
      <div class="roster-toolbar"><div class="segments" role="group" aria-label="Jogadores exibidos">${Object.keys(labels).map((filter) => `<button type="button" data-filter="${filter}" aria-pressed="${state.filter === filter}">${labels[filter]}<span>${counts[filter]}</span></button>`).join('')}</div><div class="search-export"><label class="search-field">${icon('search')}<input type="search" id="roster-search" aria-label="Buscar jogador por nome ou tag" placeholder="Buscar jogador" autocomplete="off" value="${esc(state.query)}"></label><button type="button" class="button secondary export-button" data-command="export" aria-label="Baixar escalação em TSV" title="Baixar TSV para Excel">${icon('download')}<span>TSV</span></button></div></div>
      <div id="roster-content"></div><div class="roster-footnote">${icon('shield')}Escudos indicam a preferência no jogo. Os ajustes aqui alteram apenas a sugestão.</div></section>${renderRail()}</div>`;
    renderRoster();
  }
  function renderRail() {
    const s = state.selection;
    const current = state.currentWar;
    const rules = [['excludeRed', 'Apenas escudos verdes'], ['requireTwoAttacks', 'Dois ataques realizados'], ['requireOneStar', 'Ao menos uma estrela'], ['requireTriple', 'Ao menos um ataque de 3 estrelas']].filter(([key]) => state.settings[key]);
    return `<aside class="summary-rail" aria-label="Contexto da seleção"><section class="rail-block"><div class="rail-title">${icon('sliders')}Critérios ativos</div><ul class="active-rules">${rules.map(([, label]) => `<li>${icon('check')}${label}</li>`).join('') || '<li>Sem exigências de desempenho</li>'}</ul><button type="button" class="button secondary full" data-view="rules">Ajustar critérios ${icon('arrow')}</button></section><section class="rail-block current-war"><div class="rail-title">${icon('swords')}Guerra atual</div><strong>${current ? `${current.header.sizeHome} × ${current.header.sizeAway}` : 'Sem dados atuais'}</strong><p>${current ? esc(current.result.label?.toLowerCase() || 'Em andamento') : 'A fonte não informou uma guerra atual.'}</p><button type="button" class="text-button" data-view="war">Ver última guerra ${icon('arrow')}</button></section>${s.warnings.length ? `<section class="rail-block selection-notes"><div class="rail-title">${icon('alert')}Sobre este time</div>${s.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</section>` : ''}<div class="rail-note">${icon('clock')}Desempenho da última guerra concluída. As preferências são consultadas no perfil de cada jogador.</div></aside>`;
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
    if (row.hardFail) return `<span class="locked-action" title="Bloqueado pelo escudo ou lista de exclusão">${icon('shield')}</span>`;
    return `<button type="button" class="icon-button roster-action" data-action="${row.forcedOut ? 'clear-force' : 'force-in'}" data-tag="${tag}" aria-label="${row.forcedOut ? 'Desfazer remoção de' : 'Incluir no time'} ${esc(row.member.name)}" title="${row.forcedOut ? 'Desfazer remoção' : 'Incluir no time'}">${icon('plus')}</button>`;
  }
  function renderRoster() {
    const container = $('#roster-content');
    if (!container || !state.selection) return;
    const rows = filteredRows();
    const selected = new Set(state.selection.selected.map((r) => r.member.tag));
    container.innerHTML = `<div class="roster-columns" aria-hidden="true"><span>Jogador</span><span>Escudo</span><span>1º ataque</span><span>2º ataque</span><span>Total</span><span>Convocação</span><span></span></div>${rows.length ? `<div class="player-list">${rows.map((row) => {
      const member = row.member; const why = reason(row); const isSelected = selected.has(member.tag);
      return `<article class="player-row ${isSelected ? 'is-selected' : ''}" data-player="${esc(member.tag)}"><div class="player-line"><div class="player-identity">${townHall(member.th)}<div class="player-name"><h3>${esc(member.name)}</h3><span>${esc(roleNames[member.role] || member.role || 'Membro')}<i> · </i>#${member.position ?? '—'} no clã</span></div></div><div class="player-availability">${shield(member.pref)}</div>${attackMetric(row.perf?.firstAttackStars, '1º ataque')}${attackMetric(row.perf?.secondAttackStars, '2º ataque')}<div class="player-stat gold-stat"><b>${row.inWar ? row.stars : '—'}</b><span>total</span></div><div class="player-reason"><span class="reason ${why.tone}"><i class="dot ${why.tone}"></i>${why.label}</span></div><div class="player-action">${rowAction(row, isSelected)}</div></div><details class="player-details" data-expand="${esc(member.tag)}" ${state.expanded.has(member.tag) ? 'open' : ''}><summary><span>Ver detalhes</span>${icon('chevron')}</summary><div class="player-detail-content"><div class="detail-copy"><span class="tag-code">#${esc(member.tag)}</span><p>${esc(why.detail)}</p><p class="muted">${row.inWar ? `${row.attacks} ataques usados · ${row.triples} com 3 estrelas · ${row.newStars} novas estrelas no placar.` : 'Sem participação registrada na última guerra concluída.'}</p></div><div class="player-options"><button type="button" class="button small secondary" data-stats="${esc(member.tag)}">${icon('star')}Histórico e estatísticas</button><button type="button" class="button small ${row.whitelisted ? 'active-option' : 'secondary'}" data-action="priority" data-tag="${esc(member.tag)}" aria-pressed="${row.whitelisted}">${icon('flag')}${row.whitelisted ? 'Prioridade ativa' : 'Priorizar jogador'}</button><button type="button" class="button small ${row.blacklisted ? 'danger' : 'secondary'}" data-action="block" data-tag="${esc(member.tag)}" aria-pressed="${row.blacklisted}">${icon('x')}${row.blacklisted ? 'Remover bloqueio' : 'Bloquear no time'}</button></div></div></details></article>`;
    }).join('')}</div>` : `<div class="empty-search">${icon('search')}<h3>Nenhum jogador encontrado</h3><p>Tente outro nome, tag ou filtro.</p></div>`}<div class="list-count" aria-live="polite">${rows.length} ${rows.length === 1 ? 'jogador exibido' : 'jogadores exibidos'}${state.query ? ' nesta busca' : ''}</div>`;
    $$('#roster-content details').forEach((node) => node.addEventListener('toggle', () => { if (node.open) state.expanded.add(node.dataset.expand); else state.expanded.delete(node.dataset.expand); }));
  }
  function toggleSetting(key, title, description, name) {
    return `<label class="rule-toggle"><span class="rule-symbol">${icon(name)}</span><span class="rule-copy"><strong>${title}</strong><small>${description}</small></span><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`;
  }
  function selectField(key, label, options, disabled = false, helper = '') {
    return `<label class="field"><span>${label}</span><select data-setting="${key}" ${disabled ? 'disabled' : ''}>${options.map(([value, text]) => `<option value="${value}" ${String(state.settings[key]) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select>${helper ? `<small>${helper}</small>` : ''}</label>`;
  }
  function renderRules() {
    $('#rules-view').innerHTML = `<div class="view-heading"><div class="eyebrow">SUA ESTRATÉGIA</div><h2 id="rules-title" tabindex="-1">Os critérios do seu time.</h2><p>Defina quem pode entrar. A escalação se ajusta a cada alteração.</p></div><div class="rules-layout"><section class="settings-panel"><div class="panel-heading"><span class="section-index">01</span><div><h3>Quem está pronto para a guerra?</h3><p>Os critérios de desempenho usam a última guerra concluída.</p></div></div><div class="rule-list">${toggleSetting('excludeRed', 'Apenas escudos verdes', 'Jogadores com escudo vermelho ou não confirmado ficam fora.', 'shield')}${toggleSetting('requireTwoAttacks', 'Dois ataques realizados', 'Exige que os dois ataques tenham sido usados.', 'swords')}${toggleSetting('requireOneStar', 'Ao menos uma estrela', 'Exige uma estrela somada nos ataques do jogador.', 'star')}${toggleSetting('requireTriple', 'Ao menos um ataque de 3 estrelas', 'Critério eliminatório; as exceções não o ignoram.', 'star')}${toggleSetting('allowNoWarData', 'Permitir jogadores sem registro', 'Pode convocar quem não participou da última guerra.', 'users')}</div></section>
      <section class="settings-panel"><div class="panel-heading"><span class="section-index">02</span><div><h3>Como montar a escalação?</h3><p>Tamanho, ordenação e margem para completar as vagas.</p></div></div><div class="fields-grid">${selectField('targetMode', 'Tamanho do time', [['max', 'Maior time possível'], ['current', state.currentWar ? `Igual à guerra atual (${state.currentWar.header.sizeHome})` : 'Igual à guerra atual'], ['auto', 'Mais próximo dos aptos'], ['fixed', 'Escolher tamanho']])}${selectField('fixedSize', 'Vagas na guerra', E.STANDARD_SIZES.map((s) => [s, `${s} × ${s}`]), state.settings.targetMode !== 'fixed')}${selectField('rankBy', 'Dar preferência por', [['position', 'Posição no clã'], ['th', 'Centro da Vila mais alto'], ['performance', 'Desempenho na última guerra'], ['name', 'Nome do jogador']])}</div><details class="advanced-settings" id="advanced-settings" ${state.advancedOpen ? 'open' : ''}><summary>Ajustar exceções e cortes ${icon('chevron')}</summary><div class="fields-grid"><label class="field"><span>Máximo de exceções</span><input type="number" data-setting="maxFill" min="0" max="15" step="1" value="${state.settings.maxFill}" ${state.settings.targetMode === 'max' ? 'disabled' : ''}><small>Jogadores que podem completar vagas sem cumprir critérios flexíveis.</small></label><label class="field"><span>Máximo de aptos fora do time</span><input type="number" data-setting="maxTrim" min="0" max="15" step="1" value="${state.settings.maxTrim}" ${state.settings.targetMode === 'max' ? 'disabled' : ''}><small>Permite cortar o excedente para caber no tamanho escolhido.</small></label>${selectField('fillFrom', 'Para completar as vagas, usar', [['bottom', 'Últimos da ordenação'], ['top', 'Primeiros da ordenação']])}</div></details><p class="settings-note">${icon('alert')}${state.settings.targetMode === 'max' ? 'O maior time possível usa tamanhos de 5 a 50. A prioridade pode ampliar o time; o excedente fica na reserva.' : 'As exceções respeitam os filtros de escudo, a lista de bloqueios e a exigência de ataque com 3 estrelas.'}</p></section>
      <section class="settings-panel priority-panel"><div class="panel-heading"><span class="section-index">03</span><div><h3>A palavra final é sua.</h3><p>Priorize ou bloqueie jogadores nos detalhes da lista.</p></div></div><div class="priority-counts"><span><b>${state.settings.whitelist.length}</b> na prioridade</span><span><b>${state.settings.blacklist.length}</b> bloqueados</span></div><p class="muted">A prioridade permite ignorar critérios de desempenho, mas respeita o filtro de escudo. O bloqueio sempre prevalece.</p><button type="button" class="button secondary" data-command="all-players">Gerenciar jogadores ${icon('arrow')}</button></section></div><button type="button" class="button primary rules-back" data-view="team">Ver time atualizado ${icon('arrow')}</button>`;
    $('#advanced-settings').addEventListener('toggle', (event) => { state.advancedOpen = event.target.open; });
  }
  function renderWar() {
    const war = state.lastWar;
    if (!war) {
      $('#war-view').innerHTML = `<div class="view-heading"><div class="eyebrow">RELATÓRIO DE BATALHA</div><h2 id="war-title" tabindex="-1">Última guerra</h2></div><div class="empty-state">${icon('swords')}<h3>Histórico indisponível</h3><p>${state.loading ? 'Consultando as guerras do clã…' : 'Nenhuma guerra concluída e completa foi retornada pela fonte. Atualize os dados para tentar novamente.'}</p></div>`;
      return;
    }
    const ours = war.result.ourSide || 1; const theirs = war.result.opponentSide || 2;
    const resultTone = war.result.state === 'win' ? 'green' : war.result.state === 'lose' ? 'red' : 'gold';
    const ourName = war.result.clans[ours]?.name || state.clanName || 'Nosso clã';
    const opponentName = war.result.clans[theirs]?.name || 'Adversário';
    const current = state.currentWar;
    $('#war-view').innerHTML = `<div class="view-heading"><div class="eyebrow">RELATÓRIO DE BATALHA</div><h2 id="war-title" tabindex="-1">Cada guerra ensina.</h2><p>O desempenho que orienta sua próxima convocação.</p></div>${current ? `<div class="current-war-strip">${icon('swords')}<span>Guerra atual <b>${current.header.sizeHome} × ${current.header.sizeAway}</b></span><span class="tag ${current.result.state === 'preparation' ? 'gold' : 'green'}">${esc(current.result.label)}</span></div>` : ''}<section class="war-scoreboard" aria-label="Placar da última guerra"><div class="scoreboard-top"><span class="eyebrow">ÚLTIMA GUERRA CONCLUÍDA · ${war.header.sizeHome} × ${war.header.sizeAway}</span><span class="tag ${resultTone}">${icon(war.result.state === 'win' ? 'check' : 'swords')}${esc(war.result.label)}</span></div><div class="scoreboard-teams"><div class="our-team">${clanEmblem(war.result.clans[ours]?.badgeUrls || state.clanBadgeUrl, ourName, 'score-crest')}<h3>${esc(ourName)}</h3><span>${E.fmtPct(war.result.percents[ours])} de destruição</span></div><div class="score"><b>${war.result.stars[ours] ?? '—'}</b><span>×</span><b>${war.result.stars[theirs] ?? '—'}</b><small>${icon('star')} ESTRELAS</small></div><div class="opponent-team">${clanEmblem(war.result.clans[theirs]?.badgeUrls, opponentName, 'opponent-crest')}<h3>${esc(opponentName)}</h3><span>${E.fmtPct(war.result.percents[theirs])} de destruição</span></div></div><div class="war-stats"><div><b>${war.ourAttacks.length}<small>/${war.result.attacksMax || war.header.sizeHome * war.header.attacksPerMember}</small></b><span>Ataques usados</span></div><div><b>${war.ourBasesTripled}<small>/${war.header.sizeAway}</small></b><span>Bases com 3 estrelas</span></div><div><b>${war.ourAttacks.filter((a) => a.cleanup).length}</b><span>Ataques de limpeza</span></div></div></section><section class="war-report"><div class="section-heading"><div><div class="eyebrow">DESEMPENHO DO CLÃ</div><h3>O resultado, jogador por jogador.</h3></div><button type="button" class="button secondary" data-command="stats">${icon('star')}Estatísticas e CWL</button></div><div class="roster-toolbar"><div class="segments" role="group" aria-label="Relatório exibido"><button type="button" data-war-tab="players" aria-pressed="${state.warTab === 'players'}">Jogadores<span>${war.players.length}</span></button><button type="button" data-war-tab="attacks" aria-pressed="${state.warTab === 'attacks'}">Ataques<span>${war.ourAttacks.length}</span></button></div><label class="search-field">${icon('search')}<input type="search" id="war-search" aria-label="Buscar no relatório" placeholder="Buscar jogador" value="${esc(state.warQuery)}"></label></div><div id="war-report-content"></div></section>`;
    renderWarRows();
  }
  function renderWarRows() {
    if (!$('#war-report-content') || !state.lastWar) return;
    const q = state.warQuery.toLocaleLowerCase('pt-BR').trim(); const war = state.lastWar;
    if (state.warTab === 'players') {
      const rows = [...war.players].sort((a, b) => a.position - b.position).filter((r) => `${r.name} ${r.tag}`.toLocaleLowerCase('pt-BR').includes(q));
      $('#war-report-content').innerHTML = `<div class="performance-columns" aria-hidden="true"><span>Jogador</span><span>1º ataque</span><span>2º ataque</span><span>Total</span><span>Novas estrelas</span></div>${rows.map((p) => `<details class="performance-row"><summary><span class="player-identity">${townHall(p.th)}<span class="player-name"><strong>${esc(p.name)}</strong><span>${p.missed ? `<em class="missed">${p.missed} ${p.missed === 1 ? 'ataque pendente' : 'ataques pendentes'}</em>` : 'Todos os ataques usados'}</span></span></span>${attackMetric(p.firstAttackStars, '1º ataque', 'span')}${attackMetric(p.secondAttackStars, '2º ataque', 'span')}<span class="player-stat gold-stat"><b>${p.stars}</b><span>total</span></span><span class="performance-new">${p.newStars}</span>${icon('chevron')}</summary><div class="performance-details"><span>#${esc(p.tag)} · posição ${p.position}</span><span>${p.attacks} ataques usados</span><span>${p.triples} ataques com 3 estrelas</span><span>${p.newStars} novas estrelas</span><span>${p.cleanups} limpezas</span><span>${E.fmtPct(p.avgDestruction)} de destruição média</span><button type="button" class="button small secondary" data-stats="${esc(p.tag)}">${icon('star')}Histórico e estatísticas</button></div></details>`).join('') || '<div class="empty-search">Nenhum jogador encontrado.</div>'}`;
    } else {
      const rows = war.ourAttacks.filter((a) => `${a.attacker.name} ${a.defender.name}`.toLocaleLowerCase('pt-BR').includes(q)).sort((a, b) => a.order - b.order);
      $('#war-report-content').innerHTML = `<div class="attack-list">${rows.map((a) => `<article class="attack-row"><span class="attack-order">${String(a.order).padStart(2, '0')}</span><div class="attack-names"><strong>${esc(a.attacker.name)}</strong><span>${icon('swords')}${esc(a.defender.name)}</span></div><div class="attack-result"><strong class="attack-stars" aria-label="${a.stars} estrelas">${[1, 2, 3].map((n) => icon('star', n <= a.stars ? 'filled' : 'unfilled')).join('')}</strong><span>${E.fmtPct(a.destruction)} · ${esc(a.duration || '—')}</span></div><span class="tag ${a.cleanup ? 'muted' : 'green'}">${a.cleanup ? 'Limpeza' : `+${a.newStars} estrelas`}</span></article>`).join('') || '<div class="empty-search">Nenhum ataque encontrado.</div>'}</div><p class="report-note">Novas estrelas são as que aumentaram o placar. Limpezas não acrescentaram estrelas à base.</p>`;
    }
  }
  function setView(view, focus = true) {
    if (!viewTitles[view]) return;
    state.view = view;
    for (const key of Object.keys(viewTitles)) $('#' + key + '-view').hidden = key !== view;
    $$('nav [data-view]').forEach((node) => { if (node.dataset.view === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
    if (focus) { window.scrollTo({ top: 0, behavior: 'instant' }); $('#' + view + '-title')?.focus({ preventScroll: true }); }
  }
  async function loadClan(tag = state.clanTag) {
    if (state.loading) return;
    const normalized = E.normalizeTag(tag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(normalized)) { toast('Digite uma tag de clã válida, como #2G8QCR92V.'); return; }
    audit('clan_load_started');
    state.clanTag = normalized; state.clanName = ''; state.clanBadgeUrl = ''; state.members = []; state.lastWar = null; state.currentWar = null;
    state.source = ''; state.dataWarnings = []; state.fetchedAt = ''; state.error = ''; state.loading = true;
    state.status = 'Consultando membros, escudos e guerras…'; state.expanded.clear();
    render();
    try {
      const data = await window.ClanAPI.loadClan(normalized, { onStatus: (message) => { state.status = message; renderStatus(); } });
      state.members = data.members; state.clanName = data.clan.name; state.clanBadgeUrl = badgeUrl(data.clan.badgeUrls);
      state.lastWar = data.lastWar ? E.buildWar(data.lastWar) : null;
      state.currentWar = data.currentWar ? E.buildWar(data.currentWar) : null;
      state.source = 'worker'; state.fetchedAt = data.fetchedAt; state.dataWarnings = data.warnings;
      saveSettings(); audit('clan_load_succeeded');
    } catch (error) { state.error = error.message || 'Tente novamente em alguns instantes.'; audit('clan_load_failed'); }
    finally { state.loading = false; render(); }
  }
  async function loadDemo() {
    state.loading = true; render();
    try {
      const response = await fetch('portal/demo.json', { credentials: 'omit' });
      if (!response.ok) throw new Error('Demonstração indisponível.');
      const data = await response.json();
      state.clanTag = E.DEFAULT_CLAN; state.clanName = data.lastWar.result.clans[data.lastWar.result.ourSide].name;
      state.members = data.members; state.lastWar = E.buildWar(data.lastWar); state.currentWar = E.buildWar(data.currentWar);
      state.clanBadgeUrl = badgeUrl(data.lastWar.result.clans[data.lastWar.result.ourSide].badgeUrls);
      state.source = 'demo'; state.fetchedAt = ''; state.error = ''; state.dataWarnings = [];
      audit('demo_loaded');
    } catch (error) { state.error = error.message; }
    finally { state.loading = false; render(); }
  }
  function handleSetting(target) {
    const key = target.dataset.setting;
    if (!Object.hasOwn(E.DEFAULT_SETTINGS, key)) return;
    state.settings[key] = target.type === 'checkbox' ? target.checked : ['fixedSize', 'maxFill', 'maxTrim'].includes(key) ? Math.max(0, Math.min(50, Number(target.value) || 0)) : target.value;
    saveSettings(); audit('setting_changed', { setting: key, value: state.settings[key] }); render();
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
    const rows = [['Ordem', 'Jogador', 'Tag', 'Cargo', 'Centro da Vila', 'Escudo', 'Ataques', '1º ataque (estrelas)', '2º ataque (estrelas)', 'Estrelas', 'Novas estrelas', 'Ataques com 3 estrelas', 'Convocação']];
    state.selection.selected.forEach((row, index) => rows.push([index + 1, row.member.name, '#' + row.member.tag, roleNames[row.member.role] || row.member.role, row.member.th, prefNames[row.member.pref], row.inWar ? row.attacks : '', row.perf?.firstAttackStars ?? '', row.perf?.secondAttackStars ?? '', row.inWar ? row.stars : '', row.inWar ? row.newStars : '', row.inWar ? row.triples : '', reason(row).label]));
    return rows.map((row) => row.map(tsvCell).join('\t')).join('\r\n');
  }
  function fallbackCopy(text) {
    const previous = document.activeElement;
    const input = document.createElement('textarea'); input.value = text; input.className = 'clipboard-helper'; document.body.appendChild(input); input.focus(); input.select();
    let copied = false; try { copied = document.execCommand('copy'); } catch { /* Offer TSV download instead. */ }
    input.remove(); previous?.focus({ preventScroll: true }); return copied;
  }
  async function copySelection() {
    const text = selectionTSV(); if (!text) return;
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* Use the local fallback. */ }
    if (!copied) copied = fallbackCopy(text);
    if (copied) { audit('selection_copied'); toast(`${state.selection.selected.length} jogadores copiados em colunas. Cole no Excel.`); }
    else toast('Não foi possível copiar. Use “Baixar TSV” e abra o arquivo no Excel.');
  }
  function downloadSelection() {
    const text = selectionTSV(); if (!text) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/tab-separated-values;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `time-${state.clanTag}-${new Date().toISOString().slice(0, 10)}.tsv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
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
    $('#refresh').addEventListener('click', () => loadClan());
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
      if (button.dataset.warTab) { state.warTab = button.dataset.warTab; renderWar(); }
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
      if (event.target.id === 'war-search') { state.warQuery = event.target.value; renderWarRows(); }
    });
  }
  loadSettings(); bindEvents(); render(); setView('team', false); audit('page_view');
  // Deterministic demo is available for design review; live failures never trigger it.
  if (new URLSearchParams(location.search).get('demo') === '1') loadDemo(); else loadClan();
  window.ClanManager = { state, selectionTSV, loadClan };
})();
