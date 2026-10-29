/* War scores, progressive history loading and a public calculation audit. */
(function () {
  'use strict';
  const S = window.WarScores, E = window.WarEngine;
  const esc = E.esc, $ = (s) => document.querySelector(s);
  const reports = new Map();
  let onUpdate = () => {}, generation = 0, opener;
  const dialogState = { key: '', player: '', role: 'attack' };
  const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
  const date = (value) => new Date(typeof value === 'number' ? value : window.ClashKing.timestamp(value)).toLocaleString('pt-BR');
  const keyOf = S.warKey;
  const playersOf = (war) => [...(war.roster || war.players || []), ...(war.opponentRoster || [])];
  const roleLabel = (role) => role === 'attack' ? 'Ataque' : 'Defesa';
  const scoreValue = (player, role) => fmt(player?.[role + 'Score'], 0);
  const reportFor = (war) => reports.get(keyOf(war));
  const historyScope = (model) => `Guerras normais: ${model.config.normalHistoryDays} dias · CWL: ${model.config.cwlSeasonLimit} últimas edições por clã · vale para ATQ e DEF.`;
  const seasonScope = (model) => Object.entries(model.context.cwlSeasons).map(([tag, seasons]) => `#${tag}: ${seasons.join(', ') || 'sem edição concluída disponível'}`).join(' · ');
  function fitAsync(input, entry) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('portal/score-worker.js');
        entry.worker = worker;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('O cálculo demorou mais que o esperado. Tente novamente.')); }, 30000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); entry.worker = null; data.error ? reject(new Error(data.error)) : resolve(data.model); };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); entry.worker = null; reject(new Error('Não foi possível executar o cálculo dos scores.')); };
        worker.postMessage(input);
      } catch { setTimeout(() => { try { resolve(window.RankedScores.apply(input.base||S.fit(input),input.ranked,input.history)); } catch (error) { reject(error); } }, 0); }
    });
  }
  function ensure(war, retry = false) {
    if (!war) return;
    const key = keyOf(war), existing = reports.get(key);
    if (existing && !retry) { existing.war = war; return; }
    const entry = { key, war, loading: true, done: 0, total: 4, error: '', warnings: [], model: null, sources: [] };
    reports.set(key, entry);
    const run = generation;
    const tags = [...new Set(Object.values(war.result.clans).map((c) => E.normalizeTag(c.tag)).filter(Boolean))];
    const jobs = tags.flatMap((tag) => ['random', 'cwl'].map((type) => ({ tag, type })));
    entry.total = jobs.length;
    const active = () => generation === run && reports.get(key) === entry;
    onUpdate();
    void (async () => {
      const rankedJob=window.RankedAPI?.load({apiOrigin:window.ClanAPI.cwlApiOrigin,players:playersOf(war),onProgress:p=>{
        if(active()){entry.rankedLoading=true;entry.rankedProgress=p;onUpdate();}
      }}).catch(()=>null);
      try {
        const results = await Promise.allSettled(jobs.map(async (job) => {
          try {
            const data = await window.ClanAPI.loadScoreHistory(job.tag, job.type);
            if (active()) entry.sources.push({ ...job, fetchedAt: data.fetchedAt, count: data.items?.length || 0 });
            return data.items || [];
          } finally { if (active()) { entry.done++; onUpdate(); } }
        }));
        if (!active()) return;
        results.forEach((result, i) => { if (result.status === 'rejected') entry.warnings.push(`${jobs[i].type === 'cwl' ? 'CWL' : 'Guerras'} de #${jobs[i].tag}: ${result.reason.message}`); });
        const successful = results.filter((r) => r.status === 'fulfilled');
        if (!successful.length) throw new Error('As fontes de histórico não responderam. Nenhum score foi estimado.');
        entry.calculating = true; onUpdate();
        const history=successful.flatMap((r)=>r.value);
        const model = await fitAsync({ war: entry.war, history }, entry);
        if (!active()) return;
        entry.model = model;
        entry.loading=false;entry.calculating=false;onUpdate();
        const ranked=await rankedJob;
        if(!active())return;
        if(ranked){
          entry.ranked=ranked;
          try{entry.model=await fitAsync({base:model,ranked,history},entry);}catch{entry.warnings.push('Ranqueada indisponível; ATQ de guerra e CWL preservado.');}
        }else entry.warnings.push('Ranqueada indisponível; ATQ de guerra e CWL preservado.');
      } catch (error) { if (active()) entry.error = error.message || 'Scores indisponíveis.'; }
      finally { if (active()) { entry.loading = false; entry.rankedLoading=false; entry.calculating = false; onUpdate(); if ($('#score-dialog').open && dialogState.key === key) renderDialog(); } }
    })();
  }
  function badges(war, player) {
    const entry = reportFor(war), r = S.rating(entry?.model, player);
    return `<div class="war-player-scores" aria-label="Scores de ${esc(player.name)}">${['attack', 'defense'].map((role) => {
      const n = r?.[role + 'Count'] || 0;
      const bonus=role==='attack'&&r?.rankedEvidence?.contribution>0;
      const hint = entry?.error ? 'Cálculo indisponível' : !entry?.model ? 'Consultando histórico' : bonus ? `Ranqueada: +${fmt(r.rankedEvidence.contribution,1)} pontos · ${S.confidence(r,role)} em guerras` : S.confidence(r, role);
      return `<button type="button" class="score-badge ${n||bonus ? 'has-history' : 'is-reference'}" data-score-war="${esc(keyOf(war))}" data-score-player="${esc(player.tag)}" data-score-role="${role}" aria-label="Ver cálculo de ${roleLabel(role).toLowerCase()} de ${esc(player.name)}: ${scoreValue(r, role)}. ${esc(hint)}" title="${esc(hint)} · Ver cálculo"><span>${role === 'attack' ? 'ATQ' : 'DEF'}</span><b>${scoreValue(r, role)}</b>${entry?.model && !n ? `<small>${bonus?'rank':'ref.'}</small>` : ''}</button>`;
    }).join('')}<small>${r ? esc(S.confidence(r, 'attack') === 'Referência' && S.confidence(r, 'defense') === 'Referência' ? 'Sem histórico no CV atual' : 'Ver cálculo') : entry?.error ? 'Indisponível' : 'Carregando…'}</small></div>`;
  }
  function assessment(war, attack) {
    const model = reportFor(war)?.model;
    const a = S.assess(model, war, attack);
    if (!a) return '';
    const contributions = model.featureNames.map((name, i) => `${name}: ${fmt(model.coefficients[i], 4)} × ${fmt(a.features[i], 4)}`).join(' + ');
    return `<details class="war-hit-assessment ${a.category}"><summary><span class="score-match-label">${esc(a.alreadyTripled ? 'Já triplicada' : a.label)}</span><span>${esc(a.phase)} · ${esc(a.result)}</span><span aria-hidden="true">⌄</span></summary><div class="score-match-detail"><p><b>ATQ ${scoreValue(a.attacker, 'attack')}</b> contra <b>DEF ${scoreValue(a.defender, 'defense')}</b> · CV ${esc(attack.attacker.th ?? '—')} → ${esc(attack.defender.th ?? '—')}. O alvo é o jogador atacado, independentemente da posição no mapa.</p><p>Margem = η − τ3 = ${fmt(a.eta, 4)} − (${fmt(model.thresholds[2], 4)}) = <b>${fmt(a.margin, 4)}</b>. Favorável: margem ≥ 1; desafiador: margem ≤ −1; entre ambos: equilibrado.</p><p class="score-equation">η = a − d + Σβx = ${fmt(a.attacker?.attackEffect || 0, 4)} − (${fmt(a.defender?.defenseEffect || 0, 4)}) + ${esc(contributions)} = ${fmt(a.eta, 4)}</p><p>Para classificar, exigimos pelo menos 5 ataques do atacante, 5 defesas do alvo, peso total ≥ 2 para cada um e 50 ataques no modelo. Uma nota favorável é uma referência histórica e não comprova erro de execução. Layout, tropas e equipamentos usados neste ataque não são conhecidos pelo modelo.</p></div></details>`;
  }
  function summary(war) {
    const entry = reportFor(war);
    if (!entry || entry.loading) return `<div class="war-score-status" role="status"><span class="score-loading-dot"></span><div><strong>${entry?.calculating ? 'Calculando as notas de todos…' : 'Consultando histórico para os scores…'}</strong><small>${entry ? `${entry.done}/${entry.total} históricos recebidos` : 'O cálculo começa ao abrir Guerras'} · o placar e os ataques já estão disponíveis.</small></div></div>`;
    if (entry.error) return `<div class="war-score-status score-status-error"><div><strong>Scores indisponíveis</strong><small>${esc(entry.error)}</small></div><button type="button" class="button secondary" data-score-retry="${esc(entry.key)}">Tentar novamente</button></div>`;
    const model = entry.model;
    return `<div class="war-score-status"><div><strong>ATQ e DEF de todos os participantes <span class="tag gold">Experimental</span></strong><small>${model.wars} guerras anteriores · ${model.events.length} ataques elegíveis · ${esc(model.context.modifier)} · ${entry.warnings.length ? 'Consulta parcial · ' : ''}corte em ${esc(date(model.context.cutoff))}</small><small>${esc(historyScope(model))}</small><small>${entry.rankedLoading ? `Consultando ranqueada: ${entry.rankedProgress?.completed||0}/${entry.rankedProgress?.requests||0} consultas · os scores de guerra já estão disponíveis.` : model.rankedContext ? `ATQ com evidência da ranqueada · semana encerrada em ${esc(date(model.rankedContext.weekEnd))}.` : 'ATQ com histórico de guerra e CWL.'}</small><small>50 = referência no mesmo CV. Notas são comparativas, não porcentagens. Clique em ATQ ou DEF para conferir o cálculo.</small></div><button type="button" class="button secondary score-audit-button" data-score-export="${esc(entry.key)}">Exportar cálculo TSV</button></div>`;
  }
  function open(key, tag, role) {
    const entry = reports.get(key);
    if (!entry) return;
    dialogState.key = key; dialogState.player = E.normalizeTag(tag); dialogState.role = role || 'attack';
    opener = document.activeElement;
    renderDialog();
    if (!$('#score-dialog').open) $('#score-dialog').showModal();
  }
  function rankedProof(model,player){
    if(!model.rankedContext)return '<section class="score-proof"><h3>Ranqueada</h3><p>Sem evidência utilizável nesta consulta. A nota mantém o histórico de guerra e CWL.</p></section>';
    const r=player?.rankedEvidence||{};
    return `<section class="score-proof"><h3>Contribuição da ranqueada</h3><p>ATQ de guerra/CWL: <b>${fmt(player?.baseAttackScore,2)}</b> · ranqueada: <b>+${fmt(r.contribution||0,2)}</b> · ATQ final: <b>${fmt(player?.attackScore,2)}</b>.</p><p>Semana encerrada em ${esc(date(model.rankedContext.weekEnd))}. Liga anterior: ${r.previousLeague??'—'}; atual: ${r.currentLeague??'—'}; posição sustentada: ${fmt(r.position,1)}. Percentil: ${fmt(100*(r.percentile??.5),1)}% entre ${r.cohort||0} jogadores do mesmo CV na família.</p><p>${r.n||0} ataques ranqueados; ${r.nQ||0} com referência comparável para Q. Constância: ${r.constancy==null?'—':fmt(r.constancy*100,1)+'%'} (indicador; não altera convocação).</p><p class="score-equation">S = n/(n+3) × Φ⁻¹(percentil) = ${fmt(r.league||0,6)}<br>Q = Σ(estrelas − média dos outros jogadores na mesma semana, liga e par de CVs)/(nQ+3) = ${fmt(r.quality||0,6)}<br>μ = max(0; 0,6 × S + Q) = ${fmt(r.mu||0,6)}<br>g = 5/(5+nEfetivoGuerra) = ${fmt(r.gate||0,6)}<br>a = a₀ + g × max(0; a*(μ) − a*(0))</p><p>a*(μ) minimiza a perda ordinal dos ataques de guerra do jogador + λ(a−μ)²/2, mantendo DEF, coeficientes, cortes e escala fixos. A subtração de a*(0) retira o efeito de refazer o ajuste numérico. O bônus é menor com mais histórico de guerra.</p><p>CVs da ranqueada são estimados pelos perfis atuais; uma evolução comprovada no histórico exclui a semana. Q exige 20 ataques de pelo menos 2 outros jogadores; faltas de dados ficam neutras. Nenhum ataque da semana aberta entra. Legend I fica fora nesta versão.</p></section>`;
  }
  function renderDialog() {
    const entry = reports.get(dialogState.key);
    if (!entry) return;
    const { model, war } = entry;
    const roster = playersOf(war), player = roster.find((p) => E.normalizeTag(p.tag) === dialogState.player) || roster[0];
    $('#score-title').textContent = player ? `${player.name} · CV ${player.th ?? '—'}` : 'Cálculo do score';
    $('#score-player').innerHTML = roster.map((p) => `<option value="${esc(p.tag)}" ${E.normalizeTag(p.tag) === dialogState.player ? 'selected' : ''}>${esc(p.name)} · CV ${esc(p.th)} · #${esc(p.tag)}</option>`).join('');
    const body = $('#score-body');
    if (entry.loading) { body.innerHTML = `<p role="status">Consultando os históricos: ${entry.done}/${entry.total}. ${entry.calculating ? 'Calculando as notas…' : 'As notas aparecem quando o cálculo terminar.'}</p>`; return; }
    if (!model) { body.innerHTML = `<p class="red">${esc(entry.error || 'Sem modelo disponível.')}</p>`; return; }
    const role = dialogState.role, r = S.rating(model, player), effect = r?.[role + 'Effect'] || 0;
    const rows = model.events.filter((e) => S.playerKey(role === 'attack' ? e.attacker : e.defender) === S.playerKey(player)).sort((a, b) => window.ClashKing.timestamp(b.endTime) - window.ClashKing.timestamp(a.endTime) || b.order - a.order);
    const weight = r?.[role + 'Weight'] || 0, weight2 = r?.[role + 'Weight2'] || 0;
    const exclusions = {
      duplicateWars: 'Guerras duplicadas', currentOrFuture: 'Em andamento, posteriores ao corte ou sem datas válidas', incomplete: 'Histórico incompleto ou ordem não confirmada',
      modifier: 'Modificador diferente', unknownModifier: 'Modificador ausente', alreadyTripled: 'Ataques após triple', invalidAttacks: 'Ataques inválidos', unsupportedType: 'Modalidade não suportada',
      outsideNormalWindow: 'Guerras normais fora dos 14 dias', outsideCwlSeasons: 'CWL fora das duas últimas edições', unknownCwlSeason: 'Edição da CWL não identificada',
    };
    body.innerHTML = `<div class="segments score-role-tabs" role="group" aria-label="Tipo de score">${['attack', 'defense'].map((v) => `<button type="button" data-score-tab="${v}" aria-pressed="${role === v}">${roleLabel(v)} <span>${scoreValue(r, v)}</span></button>`).join('')}</div><div class="score-player-metrics"><div><b>${scoreValue(r, role)}</b><span>Score de ${roleLabel(role).toLowerCase()}</span></div><div><b>${rows.length}</b><span>${role === 'attack' ? 'Ataques anteriores' : 'Defesas anteriores'}</span></div><div><b>${esc(S.confidence(r, role))}</b><span>Quantidade de evidência</span></div></div><p class="score-scope">Histórico estritamente anterior a ${esc(date(model.context.cutoff))}, com modificador <b>${esc(model.context.modifier)}</b>. ${esc(historyScope(model))} Normais concluídas desde ${esc(date(model.context.normalSince))}. Edições selecionadas: ${esc(seasonScope(model))}. O próprio resultado desta guerra não participa das notas. ${!rows.length ? role==='attack'&&r?.rankedEvidence?.contribution>0 ? '<b>Sem ataques de guerra neste CV: o ATQ usa evidência da ranqueada, ainda com baixa sustentação em guerra.</b>' : '<b>Sem histórico neste CV: 50 é uma referência, não uma avaliação comprovada.</b>' : ''}</p>
      ${role==='attack'?rankedProof(model,r):''}<section class="score-proof"><h3>Como esta nota foi calculada</h3><p class="score-equation">${role === 'attack' ? 'ATQ' : 'DEF'} = limitar(50 + 15 × ${role === 'attack' ? 'a' : 'd'} / σ, 0, 100)<br>= limitar(50 + 15 × ${fmt(effect, 6)} / ${fmt(model.scales[role], 6)}, 0, 100) = <b>${fmt(r?.[role + 'Score'], 2)}</b></p><p><b>${role === 'attack' ? 'a' : 'd'} = ${fmt(effect, 6)}</b> é o efeito do jogador aprendido com as estrelas dos ataques; σ = ${fmt(model.scales[role], 6)} é a escala do grupo de ${role === 'attack' ? 'atacantes' : 'defensores'} com pelo menos 5 registros (mínimo de escala: 0,35). A referência 50 é definida para cada CV. A comparação entre CVs é feita no confronto, pelo coeficiente de diferença de CV.</p><p>Peso total W = <b>${fmt(weight, 6)}</b> · equilíbrio dos pesos nK = W² / Σw² = <b>${weight2 ? fmt(weight ** 2 / weight2, 4) : 'indefinido (sem registros)'}</b>. “Boa amostra” exige 15 registros e W ≥ 6; “média”, 5 e W ≥ 2. Essas faixas não são intervalos estatísticos.</p></section>
      <details class="score-method"><summary>Fórmula completa, parâmetros e dados considerados</summary><div><h3>Modelo ordinal ${esc(model.version)}</h3><p class="score-equation">η = a(atacante) − d(defensor) + βΔ × ΔCV + βP × posição + βL × limpeza + βC × CWL + βCV(defensor)<br>P(Y=s) = σ(τ[s+1] − η) − σ(τ[s] − η)<br>σ(x) = 1 / (1 + exp(−x)); τ0 = −∞; τ4 = +∞<br>L = −Σ w × ln P(Y=estrelas) + λj/2 × Σ(a²+d²) + λβ/2 × Σβ²</p><p>O ajuste ordinal usa os resultados de 0 a 3 estrelas para aprender a e d conjuntamente; não apresenta a nota como probabilidade de triple. Menos histórico aproxima o efeito de zero e a nota de 50. O bônus ranqueado é aplicado depois, somente no ATQ, com DEF e escala-base fixos.</p><p><b>Pesos:</b> w = 2^(−dias/${model.config.halfLifeDays}) × modo × fase. Modo igual ao destino: 1; outro modo: ${fmt(model.config.otherModeWeight)}. Fresh: 1; limpeza: ${fmt(model.config.cleanupWeight)}. ΔCV é limitado de −3 a +3. A posição vai de −1 a +1 entre jogadores do mesmo CV na guerra. CV-base do modelo: ${model.referenceTH}.</p><p><b>Parâmetros iniciais da v1:</b> λj = ${model.config.playerPenalty}; λβ = ${model.config.featurePenalty}; ${model.config.iterations} passos Adam; taxa ${model.config.learningRate}; βΔ ≥ 0; cortes separados por pelo menos 0,15. São escolhas experimentais explícitas; as simulações não comprovam probabilidades individuais calibradas.</p><div class="score-coefficients">${model.featureNames.map((name, i) => `<span>${esc(name)} <b>${fmt(model.coefficients[i], 6)}</b></span>`).join('')}${model.thresholds.map((n, i) => `<span>τ${i + 1} <b>${fmt(n, 6)}</b></span>`).join('')}</div><p><b>Considerados:</b> guerras normais e CWL dos dois clãs, mesmo modificador, datas, estrelas, CV de cada jogador na época, posição relativa e sequência fresh/limpeza. A modalidade tem peso e coeficiente próprios. Cada jogador tem efeitos separados por CV.</p><p><b>Fora da nota nesta versão:</b> ataques ranqueados misturados aos de guerra; heróis, tropas e equipamentos sem snapshot da época; construções/layout indisponíveis; patches de balanceamento. Destruição e duração podem ser vistas no relatório, mas não alteram o ajuste ordinal de estrelas.</p><p>A edição da CWL usa o campo season quando informado; caso contrário, é inferida pelo mês UTC da preparação. São as duas edições mais recentes disponíveis por clã com rodadas concluídas antes do corte; não apenas dois dias de liga. A seleção das edições ocorre antes de conferir o modificador, sem buscar uma edição mais antiga para substituí-las. Rodadas anteriores da edição em andamento podem entrar. O mesmo recorte limita ataque e defesa, inclusive os adversários usados para ajustar as notas.</p><p>A fonte retorna até 30 guerras de cada modalidade por clã (até 120 registros antes de deduplicar). Não é um levantamento de toda a carreira de cada jogador; o histórico pessoal de outros clãs pode ficar de fora.</p><h3>Registros descartados</h3><div class="score-coefficients">${Object.entries(exclusions).map(([key, label]) => `<span>${esc(label)} <b>${model.excluded[key] || 0}</b></span>`).join('')}</div>${entry.warnings.length ? `<p class="gold">Consulta parcial: ${entry.warnings.map(esc).join(' · ')}</p>` : ''}<h3>Fontes e horário da consulta</h3>${entry.sources.map((s) => `<p><a href="https://api.clashk.ing/v2/clan/${encodeURIComponent('#' + s.tag)}/wars?limit=30&amp;type=${s.type}" target="_blank" rel="noopener noreferrer">#${esc(s.tag)} · ${s.type === 'cwl' ? 'CWL' : 'Guerras normais'}</a> · ${s.count} registros · ${esc(date(s.fetchedAt))}</p>`).join('')}</div></details>
      <div class="score-history-heading"><h3>${role === 'attack' ? 'Ataques usados nesta nota' : 'Defesas usadas nesta nota'}</h3><button type="button" class="button secondary" data-score-export="${esc(entry.key)}">Baixar base e fórmula TSV</button></div>${rows.length ? `<div class="score-table-wrap" tabindex="0" role="region" aria-label="Histórico usado no cálculo"><table class="score-history-table"><thead><tr><th>Guerra</th><th>${role === 'attack' ? 'Alvo' : 'Atacante'}</th><th>Resultado</th><th>Fase</th><th>Peso</th></tr></thead><tbody>${rows.map((e) => {
        const other = role === 'attack' ? e.defender : e.attacker;
        return `<tr><td>${esc(date(e.endTime))}<small>${e.type === 'cwl' ? 'CWL' : 'Guerra normal'} · ataque #${e.order}</small></td><td>${esc(other.name)}<small>CV ${other.th} · #${esc(other.tag)}</small></td><td>${e.stars} ★<small>${fmt(e.destruction, 0)}% destruição</small></td><td>${e.cleanup ? 'Limpeza' : 'Fresh'}<small>ΔCV ${e.delta > 0 ? '+' : ''}${e.delta}</small></td><td>${fmt(e.weight, 6)}<small>${fmt(e.recencyWeight, 4)} × ${fmt(e.sourceWeight, 2)} × ${fmt(e.phaseWeight, 2)}</small></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="score-no-history">Nenhum registro elegível no CV atual. O jogador permanece no relatório com nota de referência.</p>'}`;
  }
  function cleanCell(v) { if (typeof v === 'number' && Number.isFinite(v)) return String(v).replace('.', ','); const s = String(v ?? '').replace(/[\t\r\n]/g, ' '); return /^[\s]*[=+\-@]/.test(s) ? "'" + s : s; }
  function exportAudit(entry) {
    if (!entry?.model) return;
    const m = entry.model;
    const headers = ['tipo', 'campo', 'valor', 'guerra', 'fim', 'modalidade', 'modificador', 'atacante', 'tag_atacante', 'cv_atacante', 'defensor', 'tag_defensor', 'cv_defensor', 'estrelas', 'destruicao', 'fase', 'delta_cv', 'posicao_relativa', 'dias', 'peso_recencia', 'peso_modo', 'peso_fase', 'peso_final', 'eta', 'verossimilhanca', 'edicao_cwl'];
    const rows = [headers];
    const parameter = (field, value) => rows.push(['parametro', field, value]);
    parameter('versao', m.version); parameter('corte_iso', new Date(m.context.cutoff).toISOString()); parameter('modificador', m.context.modifier); parameter('modo_destino', m.context.type);
    parameter('normais_desde_iso', new Date(m.context.normalSince).toISOString());
    parameter('regra_janela', 'ATQ e DEF: fim das guerras normais >= corte-14 dias; CWL nas duas ultimas edicoes por cla anteriores ao corte');
    parameter('regra_edicao_cwl', 'season quando informado; senao mes UTC de preparationStartTime');
    Object.entries(m.context.cwlSeasons).forEach(([tag, seasons]) => parameter('edicoes_cwl_' + tag, seasons.join(',')));
    parameter('formula_score', 'limitar(50+15*efeito/escala,0,100)'); parameter('formula_eta', 'a-d+soma(coeficiente*feature)');
    parameter('formula_prob_ord', 'sigmoid(tau_s+1-eta)-sigmoid(tau_s-eta), tau0=-infinito,tau4=+infinito');
    parameter('formula_peso', '2^(-dias/meiaVida)*pesoModo*pesoFase'); parameter('formula_loss', '-soma(w*ln(P(Y=estrelas)))+lambdaJogador/2*soma(a^2+d^2)+lambdaFeature/2*soma(beta^2)');
    parameter('escala_ataque', m.scales.attack); parameter('escala_defesa', m.scales.defense); parameter('cv_base', m.referenceTH);
    Object.entries(m.config).forEach(([k, v]) => parameter(k, v));
    m.featureNames.forEach((k, i) => parameter('beta_' + k, m.coefficients[i]));
    m.thresholds.forEach((v, i) => parameter('tau_' + (i + 1), v));
    m.initialThresholds.forEach((v, i) => parameter('tau_inicial_' + (i + 1), v));
    Object.entries(m.excluded).forEach(([k, v]) => rows.push(['exclusao', k, v]));
    (m.rejected || []).forEach((e) => rows.push(['registro_descartado', e.reason, e.order, e.warKey, e.endTime, e.type, e.modifier, '', e.attackerTag, '', '', e.defenderTag, '', e.stars, '', '', '', '', '', '', '', '', '', '', '', e.season]));
    entry.sources.forEach((s) => parameter('fonte', `https://api.clashk.ing/v2/clan/${encodeURIComponent('#' + s.tag)}/wars?limit=30&type=${s.type} consultado ${s.fetchedAt}`));
    if(m.rankedContext){parameter('ranqueada_contexto',JSON.stringify(m.rankedContext));parameter('ranqueada_formula','mu=max(0,0.6*S+Q); gate=5/(5+nEfetivoGuerra); a=a0+gate*max(0,a*(mu)-a*(0)); DEF e escala fixos');Object.entries(m.rankedConfig).forEach(([k,v])=>parameter('ranqueada_'+k,v));(entry.ranked?.packets||[]).forEach(packet=>parameter('ranqueada_fonte_assinada',JSON.stringify(packet)));}
    m.players.forEach((p) => {
      if(p.rankedEvidence)rows.push(['ranqueada',p.key,JSON.stringify({baseEffect:p.baseAttackEffect,baseScore:p.baseAttackScore,...p.rankedEvidence})]);
      for (const role of ['attack', 'defense']) rows.push(['jogador', role, p[role + 'Effect'], p.key, '', '', '', p.name, p.tag, p.th, '', '', '', '', '', '', '', '', '', '', '', '', p[role + 'Weight'], '', 'score=' + p[role + 'Score']]);
    });
    m.events.forEach((e) => rows.push(['historico', e.id, '', e.warKey, e.endTime, e.type, e.modifier, e.attacker.name, e.attacker.tag, e.attacker.th, e.defender.name, e.defender.tag, e.defender.th, e.stars, e.destruction, e.cleanup ? 'limpeza' : 'fresh', e.delta, e.position, e.ageDays, e.recencyWeight, e.sourceWeight, e.phaseWeight, e.weight, e.eta, e.likelihood, e.season]));
    (entry.war.attacks || []).forEach((attack) => {
      const assessment = S.assess(m, entry.war, attack);
      rows.push(['guerra_analisada', assessment?.result, assessment?.category, keyOf(entry.war), '', m.context.type, m.context.modifier, attack.attacker.name, attack.attacker.tag, attack.attacker.th, attack.defender.name, attack.defender.tag, attack.defender.th, attack.stars, attack.destruction, assessment?.phase, assessment?.delta, assessment?.position, '', '', '', '', '', assessment?.eta, 'margem=' + assessment?.margin]);
    });
    const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(cleanCell).join('\t')).join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `scores-${m.version}-${new Date(m.context.cutoff).toISOString().slice(0, 10)}.tsv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function init(callback) {
    onUpdate = callback;
    $('#close-score').addEventListener('click', () => { $('#score-dialog').close(); opener?.focus({ preventScroll: true }); });
    $('#score-player').addEventListener('change', (event) => { dialogState.player = E.normalizeTag(event.target.value); renderDialog(); });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.scorePlayer) open(button.dataset.scoreWar, button.dataset.scorePlayer, button.dataset.scoreRole);
      if (button.dataset.scoreTab) { dialogState.role = button.dataset.scoreTab; renderDialog(); }
      if (button.dataset.scoreExport) exportAudit(reports.get(button.dataset.scoreExport));
      if (button.dataset.scoreRetry) { const entry = reports.get(button.dataset.scoreRetry); if (entry) ensure(entry.war, true); }
    });
  }
  function reset() { generation++; reports.forEach((e) => e.worker?.terminate()); reports.clear(); }
  window.ScoreUI = { init, ensure, reset, badges, assessment, summary, reports };
})();
