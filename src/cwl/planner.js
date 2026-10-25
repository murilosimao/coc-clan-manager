import { WarScores as S, ClashKing } from './scoring.js';
import { requireCondition, timestamp } from './errors.js';

export const PLANNER_VERSION = 'cwl-assignment-v1.1';
export const DEFAULT_CONFIG = Object.freeze({ goalSupport: 0.70 });
const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));

// Hungarian algorithm, O(n^3), deterministic ties. Returns a maximum-weight permutation.
export function maximizeAssignment(weights) {
  const n = weights.length;
  requireCondition(n > 0 && n <= 50 && weights.every(r => r.length === n && r.every(Number.isFinite)), 422, 'Matriz de confrontos inválida.');
  const u = Array(n + 1).fill(0), v = Array(n + 1).fill(0), p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cost = -weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (cost < min[j]) { min[j] = cost; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
      j0 = j1;
    } while (p[j0]);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assignment = Array(n);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}

export function validateWar(raw, tag) {
  requireCondition(raw && raw.clan && raw.opponent, 422, 'Guerra sem os dois clãs.');
  requireCondition(raw.type === 'cwl' || raw.attacksPerMember === 1, 422, 'O planejamento aceita somente CWL com um ataque por jogador.');
  requireCondition(raw.attacksPerMember == null || raw.attacksPerMember === 1, 422, 'CWL deve permitir um ataque por jogador.');
  requireCondition(['preparation', 'inWar', 'warEnded'].includes(raw.state), 422, 'Estado de guerra inválido.');
  requireCondition(typeof raw.battleModifier === 'string' && raw.battleModifier.trim(), 422, 'Modificador da guerra não confirmado.');
  requireCondition(Number.isFinite(timestamp(raw.startTime)) && timestamp(raw.endTime) > timestamp(raw.startTime), 422, 'Datas de guerra incompletas.');
  const war = ClashKing.normalizeWar({ ...raw, type: 'cwl', attacksPerMember: 1 }, tag);
  const players = [...war.roster, ...war.opponentRoster];
  requireCondition(Number.isInteger(raw.teamSize) && raw.teamSize >= 1 && raw.teamSize <= 50
    && war.roster.length === raw.teamSize && war.opponentRoster.length === raw.teamSize
    && new Set(players.map(p => p.tag)).size === players.length
    && players.every(p => p.th >= 1 && p.th <= 25 && Number.isInteger(p.th) && Number.isInteger(p.position) && p.position > 0 && p.position <= raw.teamSize), 422, 'Elencos da guerra incompletos.');
  for (const roster of [war.roster, war.opponentRoster]) requireCondition(new Set(roster.map(p => p.position)).size === roster.length, 422, 'Posições duplicadas.');
  const rawHits = [raw.clan, raw.opponent].flatMap((side, index) => (side.members || []).flatMap(p => (p.attacks || []).map(a => ({ ...a, attackerTag: a.attackerTag || p.tag, side: index + 1 }))));
  requireCondition([raw.clan, raw.opponent].every((s, i) => s.attacks === rawHits.filter(a => a.side === i + 1).length), 422, 'Contagem de ataques incompleta.');
  requireCondition(new Set(rawHits.map(a => String(a.attackerTag).replace('#', ''))).size === rawHits.length, 422, 'Um jogador usou mais de um ataque na CWL.');
  requireCondition(new Set(rawHits.map(a => a.order)).size === rawHits.length && rawHits.every(a => Number.isInteger(a.order) && a.order >= 1 && a.order <= rawHits.length
    && Number.isInteger(a.stars) && a.stars >= 0 && a.stars <= 3 && Number.isFinite(a.destructionPercentage) && a.destructionPercentage >= 0 && a.destructionPercentage <= 100
    && (a.duration == null || Number.isInteger(a.duration) && a.duration >= 0 && a.duration <= 360)), 422, 'Resultados ou cronologia inválidos.');
  for (const hit of war.attacks) {
    const own = hit.side === war.result.ourSide;
    requireCondition((own ? war.roster : war.opponentRoster).some(p => p.tag === hit.attacker.tag)
      && (own ? war.opponentRoster : war.roster).some(p => p.tag === hit.defender.tag), 422, 'Atacante ou defensor fora do elenco.');
  }
  return war;
}

export function planWar({ raw, clanTag, history, config = DEFAULT_CONFIG }) {
  requireCondition(Number.isFinite(config.goalSupport) && config.goalSupport >= 0.5 && config.goalSupport <= 0.95, 422, 'Limiar de meta inválido.');
  const war = validateWar(raw, clanTag);
  const model = S.fit({ war, history });
  const retrospective = raw.state === 'warEnded';
  const ownHits = war.attacks.filter(a => a.side === war.result.ourSide);
  const used = new Set(retrospective ? [] : ownHits.map(a => a.attacker.tag));
  const best = new Map();
  if (!retrospective) for (const hit of ownHits) best.set(hit.defender.tag, Math.max(best.get(hit.defender.tag) || 0, hit.stars));
  const matchups = war.roster.map(attacker => war.opponentRoster.map(defender => {
    const a = S.rating(model, attacker), d = S.rating(model, defender);
    const group = war.opponentRoster.filter(p => p.th === defender.th).sort((x, y) => x.position - y.position);
    const rank = group.findIndex(p => p.tag === defender.tag);
    const position = group.length > 1 ? (group.length - 1 - 2 * rank) / (group.length - 1) : 0;
    // A late first visit plans only the remaining attacks. Ended wars are explicitly retrospective.
    const before = best.get(defender.tag) || 0;
    const event = { attacker, defender, delta: Math.max(-3, Math.min(3, attacker.th - defender.th)), position, cleanup: best.has(defender.tag), type: 'cwl' };
    const eta = S.etaFor(model, event);
    const tails = model.thresholds.map(t => sigmoid(eta - t));
    const probabilities = [1 - tails[0], tails[0] - tails[1], tails[1] - tails[2], tails[2]];
    const expectedStars = tails.reduce((s, n) => s + n, 0);
    const expectedGain = probabilities.reduce((s, p, stars) => s + Math.max(0, stars - before) * p, 0);
    const supported = tails.map((q, i) => q >= config.goalSupport && i + 1 > before ? i + 1 : 0).filter(Boolean);
    const goalStars = Math.min(3, Math.max(before + 1, ...supported));
    const warnings = [];
    if (a.attackCount < 5 || a.attackWeight < 2) warnings.push('insufficient_attack_history');
    if (d.defenseCount < 5 || d.defenseWeight < 2) warnings.push('insufficient_defense_history');
    if (model.events.length < 50) warnings.push('small_model_sample');
    if (Math.abs(attacker.th - defender.th) > 3) warnings.push('cv_gap_outside_model_range');
    if (!supported.length) warnings.push('goal_below_support_threshold');
    return { attackerTag: attacker.tag, defenderTag: defender.tag, attackerName: attacker.name, defenderName: defender.name,
      attackerCV: attacker.th, defenderCV: defender.th, attackScore: a.attackScore, defenseScore: d.defenseScore,
      attackCount: a.attackCount, defenseCount: d.defenseCount, attackWeight: a.attackWeight, defenseWeight: d.defenseWeight,
      expectedStars, expectedGain, targetStarsBeforePlan: before, targetAttackedBeforePlan: best.has(defender.tag), probabilities, goalStars, goalSupport: tails[goalStars - 1], warnings,
      evidence: warnings.length ? 'limited' : 'supported', eta };
  }));
  const rowIds = war.roster.flatMap((p, i) => used.has(p.tag) ? [] : [i]);
  const columnIds = war.opponentRoster.flatMap((p, i) => (best.get(p.tag) || 0) === 3 ? [] : [i]);
  requireCondition(columnIds.length >= rowIds.length, 422, 'Número de alvos úteis insuficiente.');
  const matrix = columnIds.map((_, row) => columnIds.map(column => row < rowIds.length ? matchups[rowIds[row]][column].expectedGain : 0));
  const permutation = matrix.length ? maximizeAssignment(matrix) : [];
  const assignments = rowIds.map((row, index) => ({ ...matchups[row][columnIds[permutation[index]]], source: 'system' }));
  const expectedStars = assignments.reduce((sum, a) => sum + a.expectedStars, 0);
  const mirror = war.roster.map((p, i) => matchups[i].find(m => m.defenderTag === war.opponentRoster.find(d => d.position === p.position)?.tag));
  return { version: PLANNER_VERSION, config: { ...config }, war, model, matchups, assignments, expectedStars,
    expectedGain: assignments.reduce((sum, m) => sum + m.expectedGain, 0), participants: war.roster,
    mirrorExpectedStars: !used.size && mirror.every(Boolean) ? mirror.reduce((sum, m) => sum + m.expectedStars, 0) : null,
    warnings: ['experimental_goal_threshold', 'outcome_estimates_not_individually_calibrated'] };
}

export function validateAssignments(assignments, plan) {
  requireCondition(Array.isArray(assignments) && assignments.length === plan.assignments.length, 422, 'Envie uma missão para cada jogador.');
  const attackers = new Set(plan.assignments.map(m => m.attackerTag)), defenders = new Set(plan.matchups.flat().map(m => m.defenderTag));
  requireCondition(new Set(assignments.map(m => m.attackerTag)).size === attackers.size && assignments.every(m => attackers.has(m.attackerTag)
    && defenders.has(m.defenderTag) && Number.isInteger(m.goalStars) && m.goalStars >= 1 && m.goalStars <= 3), 422, 'Missões inválidas ou jogador duplicado.');
  return assignments.map(m => {
    const candidate = plan.matchups.flat().find(p => p.attackerTag === m.attackerTag && p.defenderTag === m.defenderTag);
    return { ...candidate, goalStars: m.goalStars, source: 'leader', note: typeof m.note === 'string' ? m.note.slice(0, 500) : '' };
  }).sort((a, b) => plan.assignments.findIndex(m => m.attackerTag === a.attackerTag) - plan.assignments.findIndex(m => m.attackerTag === b.attackerTag));
}
