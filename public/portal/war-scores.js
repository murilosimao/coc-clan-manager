/* Reproducible, regularized ordinal ratings. Current-war outcomes never train the model. */
(function (root) {
  'use strict';
  const VERSION = 'war-ordinal-v1';
  const CONFIG = Object.freeze({ normalHistoryDays: 14, cwlSeasonLimit: 2, halfLifeDays: 30, otherModeWeight: 0.75, cleanupWeight: 0.65,
    playerPenalty: 2, featurePenalty: 2, iterations: 220, learningRate: 0.035, scoreScale: 15, minimumScale: 0.35 });
  const tag = (v) => String(v || '').replace(/^#/, '').toUpperCase();
  const number = (v) => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sigmoid = (v) => v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v));
  const timestamp = (v) => typeof v === 'number' ? v : Date.parse(String(v || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));
  const modifier = (v) => typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
  const playerKey = (p) => `${tag(p.tag)}:${p.th}`;
  function context(war) {
    const time = timestamp(war.startTime) || timestamp(war.header?.startedOn);
    return { cutoff: Math.min(time, Date.now()), modifier: modifier(war.battleModifier), type: war.warType || (war.header?.attacksPerMember === 1 ? 'cwl' : 'random') };
  }
  function warKey(war) {
    return [...Object.values(war.result?.clans || {}).map((c) => tag(c.tag)).sort(), war.startTime || war.id].join('|');
  }
  function position(player, roster) {
    const group = roster.filter((p) => p.th === player.th).sort((a, b) => a.position - b.position);
    const rank = group.findIndex((p) => p.tag === player.tag);
    return group.length > 1 && rank >= 0 ? (group.length - 1 - 2 * rank) / (group.length - 1) : 0;
  }
  function rawWarKey(war) {
    return [tag(war.clan?.tag), tag(war.opponent?.tag)].sort().join('|') + '|' + war.startTime;
  }
  const identity = (p) => ({ tag: tag(p.tag), name: String(p.name || p.tag || ''),
    th: number(p.townhallLevel ?? p.townHallLevel), position: number(p.mapPosition) });
  const warType = (raw) => raw.type || (raw.attacksPerMember === 1 ? 'cwl' : 'random');
  function cwlSeason(raw) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.season || '')) return raw.season;
    // The source normally omits season. Use the preparation month, never the end month.
    const preparation = timestamp(raw.preparationStartTime);
    return Number.isFinite(preparation) ? new Date(preparation).toISOString().slice(0, 7) : null;
  }
  function collect(war, history) {
    const ctx = context(war);
    ctx.normalSince = ctx.cutoff - CONFIG.normalHistoryDays * 86400000;
    const clanTags = [...new Set(Object.values(war.result?.clans || {}).map((c) => tag(c.tag)).filter(Boolean))];
    ctx.cwlSeasons = Object.fromEntries(clanTags.map((clanTag) => {
      const seasons = history.filter((raw) => {
        const end = timestamp(raw.endTime), start = timestamp(raw.startTime);
        return warType(raw) === 'cwl' && raw.state === 'warEnded' && end <= ctx.cutoff && start < ctx.cutoff && end >= start
          && [tag(raw.clan?.tag), tag(raw.opponent?.tag)].includes(clanTag);
      }).map(cwlSeason).filter(Boolean);
      return [clanTag, [...new Set(seasons)].sort().reverse().slice(0, CONFIG.cwlSeasonLimit)];
    }));
    const excluded = { duplicateWars: 0, currentOrFuture: 0, incomplete: 0, modifier: 0, unknownModifier: 0,
      alreadyTripled: 0, invalidAttacks: 0, unsupportedType: 0, outsideNormalWindow: 0, outsideCwlSeasons: 0, unknownCwlSeason: 0 };
    const events = [], rejected = [], seen = new Set();
    const reject = (reason, raw, attack = null) => {
      excluded[reason]++;
      rejected.push({ reason, warKey: rawWarKey(raw), endTime: raw.endTime, type: warType(raw), season: warType(raw) === 'cwl' ? cwlSeason(raw) : null, modifier: raw.battleModifier,
        order: attack?.order ?? null, attackerTag: attack?.attackerTag ?? null, defenderTag: attack?.defenderTag ?? null, stars: attack?.stars ?? null });
    };
    let wars = 0;
    const attackCount = (w) => [w.clan, w.opponent].reduce((n, side) => n + (side?.members || []).reduce((s, p) => s + (p.attacks?.length || 0), 0), 0);
    const sorted = [...history].sort((a, b) => rawWarKey(a).localeCompare(rawWarKey(b)) || attackCount(b) - attackCount(a));
    for (const raw of sorted) {
      const key = rawWarKey(raw);
      if (seen.has(key)) { reject('duplicateWars', raw); continue; }
      seen.add(key);
      const end = timestamp(raw.endTime), start = timestamp(raw.startTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || raw.state !== 'warEnded' || end > ctx.cutoff || start >= ctx.cutoff || end < start) { reject('currentOrFuture', raw); continue; }
      const type = warType(raw), season = type === 'cwl' ? cwlSeason(raw) : null;
      if (!['random', 'cwl'].includes(type)) { reject('unsupportedType', raw); continue; }
      if (type === 'random' && end < ctx.normalSince) { reject('outsideNormalWindow', raw); continue; }
      if (type === 'cwl' && !season) { reject('unknownCwlSeason', raw); continue; }
      if (type === 'cwl' && ![tag(raw.clan?.tag), tag(raw.opponent?.tag)].some((t) => ctx.cwlSeasons[t]?.includes(season))) { reject('outsideCwlSeasons', raw); continue; }
      if (!modifier(raw.battleModifier)) { reject('unknownModifier', raw); continue; }
      if (modifier(raw.battleModifier) !== ctx.modifier) { reject('modifier', raw); continue; }
      const sides = [raw.clan, raw.opponent];
      const rosters = sides.map((side) => (side?.members || []).map(identity));
      const ids = new Map(rosters.flat().map((p) => [p.tag, p]));
      const all = sides.flatMap((side, s) => (side?.members || []).flatMap((p) => (p.attacks || []).map((a) => ({ ...a, attackerTag: a.attackerTag || p.tag, side: s }))));
      const orders = all.map((a) => number(a.order));
      // Without the complete chronology, a first-looking hit must not become fresh.
      if (!Number.isInteger(raw.teamSize) || rosters.some((r) => r.length !== raw.teamSize)
          || ids.size !== rosters.flat().length
          || rosters.flat().some((p) => !p.tag || !Number.isInteger(p.th) || p.th < 1 || p.th > 25 || p.position == null)
          || sides.some((s, index) => number(s?.attacks) !== all.filter((a) => a.side === index).length)
          || orders.some((o) => !Number.isInteger(o) || o < 1) || new Set(orders).size !== all.length
          || orders.length && (Math.min(...orders) !== 1 || Math.max(...orders) !== orders.length)) { reject('incomplete', raw); continue; }
      const invalid = all.filter((a) => {
        const atk = ids.get(tag(a.attackerTag)), def = ids.get(tag(a.defenderTag));
        const stars = number(a.stars), destruction = number(a.destructionPercentage);
        return !atk || !def || !Number.isInteger(stars) || stars < 0 || stars > 3 || destruction == null || destruction < 0 || destruction > 100
          || !rosters[a.side].some((p) => p.tag === atk.tag) || !rosters[1 - a.side].some((p) => p.tag === def.tag);
      });
      if (invalid.length) { invalid.forEach((a) => reject('invalidAttacks', raw, a)); reject('incomplete', raw); continue; }
      const best = new Map();
      wars++;
      for (const a of all.sort((a, b) => a.order - b.order)) {
        const atk = ids.get(tag(a.attackerTag)), def = ids.get(tag(a.defenderTag));
        const stars = number(a.stars), destruction = number(a.destructionPercentage);
        const prior = best.get(def.tag);
        best.set(def.tag, Math.max(prior ?? 0, stars));
        if (prior === 3) { reject('alreadyTripled', raw, a); continue; }
        const cleanup = prior != null;
        const ageDays = (ctx.cutoff - end) / 86400000;
        const recencyWeight = 2 ** (-ageDays / CONFIG.halfLifeDays);
        const sourceWeight = type === ctx.type ? 1 : CONFIG.otherModeWeight;
        const phaseWeight = cleanup ? CONFIG.cleanupWeight : 1;
        events.push({ id: key + ':' + a.order, warKey: key, endTime: raw.endTime, type, season,
          modifier: modifier(raw.battleModifier), attacker: atk, defender: def, order: a.order,
          stars, destruction, cleanup, priorStars: prior ?? null, ageDays,
          recencyWeight, sourceWeight, phaseWeight, weight: recencyWeight * sourceWeight * phaseWeight,
          delta: clamp(atk.th - def.th, -3, 3), position: position(def, rosters[1 - a.side]) });
      }
    }
    return { context: ctx, events, wars, excluded, rejected };
  }
  function features(e, names) {
    return names.map((name) => name === 'deltaCV' ? e.delta : name === 'posicaoDefesa' ? e.position
      : name === 'limpeza' ? Number(e.cleanup) : name === 'cwl' ? Number(e.type === 'cwl')
        : Number(e.defender.th === Number(name.slice(3))));
  }
  function fit({ war, history }) {
    const data = collect(war, history);
    if (!Number.isFinite(data.context.cutoff) || !data.context.modifier) throw new Error('Data de início ou modificador da guerra não confirmado.');
    const roster = [...(war.roster || war.players || []), ...(war.opponentRoster || [])];
    const players = new Map();
    const ensure = (p) => { const k = playerKey(p); if (!players.has(k)) players.set(k, { ...p, key: k, attackCount: 0, defenseCount: 0, attackWeight: 0, defenseWeight: 0, attackWeight2: 0, defenseWeight2: 0 }); return players.get(k); };
    roster.forEach(ensure);
    for (const e of data.events) {
      const a = ensure(e.attacker), d = ensure(e.defender);
      a.attackCount++; a.attackWeight += e.weight; a.attackWeight2 += e.weight ** 2;
      d.defenseCount++; d.defenseWeight += e.weight; d.defenseWeight2 += e.weight ** 2;
    }
    const keys = [...players.keys()], index = new Map(keys.map((k, i) => [k, i]));
    const ths = [...new Set(data.events.map((e) => e.defender.th))].sort((a, b) => a - b);
    const referenceTH = ths.at(-1) || Math.max(1, ...roster.map((p) => p.th || 1));
    const featureNames = ['deltaCV', 'posicaoDefesa', 'limpeza', 'cwl', ...ths.filter((th) => th !== referenceTH).map((th) => 'cv_' + th)];
    const F = featureNames.length, N = keys.length, size = F + 2 * N + 3;
    const p = new Float64Array(size), m = new Float64Array(size), v = new Float64Array(size);
    const thresholdStart = F + 2 * N;
    const counts = [0, 0, 0, 0];
    data.events.forEach((e) => { counts[e.stars] += e.weight; });
    const total = counts.reduce((a, b) => a + b, 0);
    let cumulative = 0;
    for (let k = 0; k < 3; k++) {
      cumulative += counts[k]; const q = (cumulative + k + 1) / (total + 4);
      p[thresholdStart + k] = Math.log(q / (1 - q));
      if (k) p[thresholdStart + k] = Math.max(p[thresholdStart + k], p[thresholdStart + k - 1] + 0.15);
    }
    const initialThresholds = [...p.slice(thresholdStart)];
    const rows = data.events.map((e) => ({ e, x: features(e, featureNames), a: F + index.get(playerKey(e.attacker)), d: F + N + index.get(playerKey(e.defender)) }));
    let finalLoss = 0;
    for (let iteration = 1; iteration <= CONFIG.iterations && rows.length; iteration++) {
      const gradient = new Float64Array(size);
      finalLoss = 0;
      for (const r of rows) {
        let eta = p[r.a] - p[r.d];
        for (let f = 0; f < F; f++) eta += p[f] * r.x[f];
        const y = r.e.stars;
        const lower = y ? sigmoid(p[thresholdStart + y - 1] - eta) : 0;
        const upper = y < 3 ? sigmoid(p[thresholdStart + y] - eta) : 1;
        const prob = Math.max(1e-12, upper - lower);
        const fl = lower * (1 - lower), fu = upper * (1 - upper);
        const dEta = r.e.weight * (fl - fu) / prob;
        finalLoss -= r.e.weight * Math.log(prob);
        gradient[r.a] += dEta; gradient[r.d] -= dEta;
        for (let f = 0; f < F; f++) gradient[f] += dEta * r.x[f];
        if (y) gradient[thresholdStart + y - 1] -= r.e.weight * fl / prob;
        if (y < 3) gradient[thresholdStart + y] += r.e.weight * fu / prob;
      }
      for (let j = 0; j < size; j++) {
        if (j < thresholdStart) { const penalty = j < F ? CONFIG.featurePenalty : CONFIG.playerPenalty; gradient[j] -= penalty * p[j]; finalLoss += penalty * p[j] ** 2 / 2; }
        m[j] = 0.9 * m[j] + 0.1 * gradient[j];
        v[j] = 0.999 * v[j] + 0.001 * gradient[j] ** 2;
        p[j] += CONFIG.learningRate * (m[j] / (1 - 0.9 ** iteration)) / (Math.sqrt(v[j] / (1 - 0.999 ** iteration)) + 1e-8);
      }
      // Ordered cut points and a monotone CV advantage keep the ordinal model identifiable.
      p[0] = Math.max(0, p[0]);
      for (let k = 1; k < 3; k++) p[thresholdStart + k] = Math.max(p[thresholdStart + k], p[thresholdStart + k - 1] + 0.15);
    }
    const eligible = (role) => keys.map((k, j) => ({ value: p[F + (role === 'attack' ? 0 : N) + j], count: players.get(k)[role + 'Count'] })).filter((r) => r.count >= 5);
    const scaleFor = (role) => { const cohort = eligible(role); return Math.max(CONFIG.minimumScale, Math.sqrt(cohort.reduce((s, r) => s + r.value ** 2, 0) / Math.max(1, cohort.length))); };
    const scales = { attack: scaleFor('attack'), defense: scaleFor('defense') };
    const ratings = keys.map((k, j) => { const r = players.get(k), attackEffect = p[F + j], defenseEffect = p[F + N + j];
      return { ...r, attackEffect, defenseEffect,
        attackScore: clamp(50 + CONFIG.scoreScale * attackEffect / scales.attack, 0, 100),
        defenseScore: clamp(50 + CONFIG.scoreScale * defenseEffect / scales.defense, 0, 100) };
    });
    const model = { version: VERSION, config: CONFIG, context: data.context, featureNames, coefficients: [...p.slice(0, F)],
      thresholds: [...p.slice(thresholdStart)], initialThresholds, scales, referenceTH, players: ratings,
      events: data.events, rejected: data.rejected, wars: data.wars, excluded: data.excluded, loss: finalLoss, totalWeight: total };
    model.events.forEach((e) => { e.eta = etaFor(model, e); e.likelihood = likelihood(model, e.eta, e.stars); });
    return model;
  }
  function rating(model, player) { return model?.players.find((p) => p.key === playerKey(player)); }
  function etaFor(model, event) {
    const a = rating(model, event.attacker), d = rating(model, event.defender);
    return (a?.attackEffect || 0) - (d?.defenseEffect || 0) + features(event, model.featureNames).reduce((sum, x, i) => sum + x * model.coefficients[i], 0);
  }
  function likelihood(model, eta, stars) {
    const lower = stars ? sigmoid(model.thresholds[stars - 1] - eta) : 0;
    const upper = stars < 3 ? sigmoid(model.thresholds[stars] - eta) : 1;
    return Math.max(1e-12, upper - lower);
  }
  function assess(model, war, attack) {
    if (!model || !attack) return null;
    const roster = [...(war.roster || []), ...(war.opponentRoster || [])];
    const a = roster.find((p) => tag(p.tag) === tag(attack.attacker.tag)) || attack.attacker;
    const d = roster.find((p) => tag(p.tag) === tag(attack.defender.tag)) || attack.defender;
    const previous = (war.attacks || []).filter((x) => Number.isFinite(x.order) && x.order < attack.order && tag(x.defender.tag) === tag(d.tag));
    const alreadyTripled = previous.some((x) => x.stars === 3);
    const defRoster = (war.roster || []).some((p) => tag(p.tag) === tag(d.tag)) ? war.roster : war.opponentRoster || [];
    const event = { attacker: a, defender: d, delta: clamp((a.th || 0) - (d.th || 0), -3, 3),
      position: position(d, defRoster), cleanup: previous.length > 0, type: model.context.type };
    const eta = etaFor(model, event), margin = eta - model.thresholds[2];
    const atk = rating(model, a), def = rating(model, d);
    const enough = model.events.length >= 50 && atk?.attackCount >= 5 && def?.defenseCount >= 5 && atk.attackWeight >= 2 && def.defenseWeight >= 2;
    const category = !enough ? 'unknown' : margin >= 1 ? 'favorable' : margin <= -1 ? 'hard' : 'balanced';
    const label = { unknown: 'Base insuficiente', favorable: 'Favorável', hard: 'Desafiador', balanced: 'Equilibrado' }[category];
    const result = alreadyTripled ? 'Base já triplicada' : !enough ? 'Resultado sem avaliação' : attack.stars === 3
      ? category === 'hard' ? 'PT em alvo desafiador' : 'PT realizado'
      : category === 'favorable' ? 'Abaixo da referência' : category === 'hard' ? 'Sem PT em alvo desafiador' : 'Sem PT em confronto equilibrado';
    return { attacker: atk, defender: def, eta, margin, category, label, result,
      phase: event.cleanup ? 'Limpeza' : 'Fresh', alreadyTripled, delta: event.delta, position: event.position, features: features(event, model.featureNames) };
  }
  function confidence(player, role) {
    const n = player?.[role + 'Count'] || 0, w = player?.[role + 'Weight'] || 0;
    return !n ? 'Referência' : n < 5 || w < 2 ? 'Baixa amostra' : n < 15 || w < 6 ? 'Amostra média' : 'Boa amostra';
  }
  root.WarScores = { VERSION, CONFIG, context, warKey, collect, fit, rating, assess, confidence, playerKey, etaFor, likelihood, features };
})(typeof window !== 'undefined' ? window : globalThis);
