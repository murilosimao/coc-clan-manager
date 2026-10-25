import { CwlError } from './errors.js';

// Normative policy, not learned weights. Snapshot once per clan/edition.
export const RANKING_POLICY = Object.freeze({
  version: 'cwl-merit-v1',
  missionPoints: 80, difficultyPoints: 15, contributionPoints: 5,
  priorScore: 50, priorOpportunities: 2, comparisonDecimals: 6,
  tiebreakers: Object.freeze(['missionRate', 'averageCreditedStars', 'averageDestruction', 'averageDuration']),
  difficulty: 'frozen_goal_tail_supported_history_only',
  duration: 'complete_for_entire_tie_group',
});
const rounded = n => Number(n.toFixed(RANKING_POLICY.comparisonDecimals));
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);

export async function ensureRankingPolicy(sql, tag, season, now) {
  await sql`insert into cwl.ranking_policies(clan_tag,season,policy,created_at)
    values(${tag},${season},${sql.json(RANKING_POLICY)},${new Date(now).toISOString()}) on conflict do nothing`;
  const [row] = await sql`select policy,created_at from cwl.ranking_policies where clan_tag=${tag} and season=${season}`;
  if (canonical(row.policy) !== canonical(RANKING_POLICY)) throw new CwlError(503, 'Versão da política de mérito não suportada.', 'ranking_policy_unsupported');
  return { ...row.policy, persistedAt: row.created_at };
}

function opportunity(plan, participant, policy) {
  const hit = plan.outcomes.find(a => a.attackerTag === participant.tag);
  const mission = hit?.mission || plan.effective?.assignments.find(m => m.attackerTag === participant.tag);
  const base = { warStart: plan.warStart, attackOrder: hit?.order ?? null,
    plannerVersion: plan.plannerVersion ?? null, scoreVersion: plan.scoreVersion ?? null,
    missionRevision: hit?.missionRevision ?? plan.effective?.revision ?? null,
    attackerTag: participant.tag, defenderTag: mission?.defenderTag ?? null, goalStars: mission?.goalStars ?? null,
    actualDefenderTag: hit?.defenderTag ?? null, stars: hit?.stars ?? null, addedStars: hit?.addedStars ?? null,
    observedDestruction: hit?.destruction ?? null, observedDurationSeconds: hit?.durationSeconds ?? null,
    targetFollowed: hit?.targetFollowed ?? null };
  if (plan.retrospective) return { ...base, status: 'retrospective', points: null };
  if (hit && hit.missionFulfilled == null) return { ...base, status: hit.attribution === 'before_plan' ? 'before_plan' : 'needs_review', points: null };
  if (!mission) return { ...base, status: 'unapproved', points: null };
  if (!hit) return { ...base, status: plan.warState === 'warEnded' ? 'missed' : 'pending',
    points: plan.warState === 'warEnded' ? 0 : null, missionPoints: 0, difficultyPoints: 0, contributionPoints: 0,
    creditedStars: 0, fulfilled: false, destruction: null, durationSeconds: null };
  if (!hit.targetFollowed) return { ...base, status: 'wrong_target', points: 0,
    missionPoints: 0, difficultyPoints: 0, contributionPoints: 0, creditedStars: 0, fulfilled: false,
    destruction: null, durationSeconds: null };
  const before = hit.targetStarsBeforeAttack;
  // The objective was already achieved by another attack. Do not blame the assignee
  // or award a second copy of the stars: keep this opportunity outside the denominator.
  if (before >= mission.goalStars) return { ...base, status: 'obsolete_mission', points: null,
    targetStarsBeforeAttack: before, reason: 'goal_already_achieved' };
  const progress = Math.min(1, hit.addedStars / (mission.goalStars - before));
  const candidate = plan.matchups?.flat().find(m => m.attackerTag === participant.tag && m.defenderTag === mission.defenderTag);
  const probabilities = candidate?.probabilities;
  const distributionValid = probabilities?.length === 4 && probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1)
    && Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-8;
  const warnings = candidate?.warnings || [];
  const supported = candidate && candidate.attackCount >= 5 && candidate.defenseCount >= 5
    && candidate.attackWeight >= 2 && candidate.defenseWeight >= 2
    && !warnings.some(w => ['small_model_sample', 'cv_gap_outside_model_range'].includes(w));
  const unchanged = before === candidate?.targetStarsBeforePlan
    && typeof candidate?.targetAttackedBeforePlan === 'boolean'
    && hit.targetAttackedBeforeAttack === candidate.targetAttackedBeforePlan;
  const goalSupportEstimate = distributionValid ? probabilities.slice(mission.goalStars).reduce((a, b) => a + b, 0) : null;
  const difficultyAvailable = Boolean(supported && distributionValid && unchanged);
  const difficulty = difficultyAvailable ? 1 - goalSupportEstimate : 0;
  const missionPoints = policy.missionPoints * progress;
  const difficultyPoints = hit.missionFulfilled ? policy.difficultyPoints * difficulty : 0;
  const contributionPoints = policy.contributionPoints * hit.addedStars / 3;
  return { ...base, status: hit.missionFulfilled ? hit.missionSurpassed ? 'surpassed' : 'fulfilled' : 'below_goal',
    points: missionPoints + difficultyPoints + contributionPoints,
    missionPoints, difficultyPoints, contributionPoints, progress,
    targetStarsBeforeAttack: before, creditedStars: hit.addedStars, fulfilled: hit.missionFulfilled,
    destruction: hit.destruction, durationSeconds: hit.durationSeconds,
    difficultyAvailable, difficulty, goalSupportEstimate,
    difficultyReason: difficultyAvailable ? 'supported_frozen_matchup' : !unchanged ? 'target_changed' : 'insufficient_history',
    frozenProbabilities: distributionValid ? probabilities : null,
    evidence: candidate ? { attackCount: candidate.attackCount, defenseCount: candidate.defenseCount,
      attackWeight: candidate.attackWeight, defenseWeight: candidate.defenseWeight, warnings,
      targetStarsBeforePlan: candidate.targetStarsBeforePlan, targetAttackedBeforePlan: candidate.targetAttackedBeforePlan ?? null,
      targetAttackedBeforeAttack: hit.targetAttackedBeforeAttack } : null,
    attackerCV: candidate?.attackerCV ?? null, defenderCV: candidate?.defenderCV ?? null,
    attackScore: candidate?.attackScore ?? null, defenseScore: candidate?.defenseScore ?? null };
}

export function rankSeason(plans, policy) {
  const players = new Map();
  for (const plan of plans) for (const m of plan.initial.participants) {
    if (!players.has(m.tag)) players.set(m.tag, { tag: m.tag, name: m.name, opportunities: [] });
    players.get(m.tag).opportunities.push(opportunity(plan, m, policy));
  }
  const entries = [...players.values()].map(p => {
    const scored = p.opportunities.filter(o => o.points != null);
    const comparableHits = scored.filter(o => o.destruction != null);
    const totalPoints = scored.reduce((s, o) => s + o.points, 0), n = scored.length;
    const unresolved = p.opportunities.filter(o => ['needs_review', 'before_plan', 'unapproved', 'retrospective'].includes(o.status)).length;
    const excluded = p.opportunities.filter(o => o.status === 'obsolete_mission').length;
    const durationComplete = comparableHits.length > 0 && comparableHits.every(o => o.durationSeconds != null);
    return { ...p, rank: null, status: unresolved ? 'provisional' : n ? 'ranked' : excluded ? 'excluded' : 'pending',
      assessedOpportunities: n, unresolvedOpportunities: unresolved, excludedOpportunities: excluded,
      difficultyAssessedAttacks: scored.filter(o => o.difficultyAvailable).length,
      difficultyUnknownAttacks: scored.filter(o => o.difficultyAvailable === false).length,
      missed: scored.filter(o => o.status === 'missed').length,
      fulfilled: scored.filter(o => o.fulfilled).length,
      totalPoints, rawAverage: n ? totalPoints / n : null,
      meritScore: n ? (totalPoints + policy.priorScore * policy.priorOpportunities) / (n + policy.priorOpportunities) : null,
      evidenceWeight: n / (n + policy.priorOpportunities),
      missionRate: n ? scored.filter(o => o.fulfilled).length / n : null,
      averageCreditedStars: n ? scored.reduce((s, o) => s + o.creditedStars, 0) / n : null,
      averageDestruction: comparableHits.length ? comparableHits.reduce((s, o) => s + o.destruction, 0) / comparableHits.length : null,
      averageDuration: durationComplete ? comparableHits.reduce((s, o) => s + o.durationSeconds, 0) / comparableHits.length : null,
      durationComplete, durationTiebreakApplied: false,
    };
  });
  const keys = ['meritScore', ...policy.tiebreakers.filter(k => k !== 'averageDuration')];
  const groupKey = p => JSON.stringify(keys.map(k => p[k] == null ? null : rounded(p[k])));
  const compare = (a, b) => { for (const key of keys) { const delta = rounded(b[key] ?? -1) - rounded(a[key] ?? -1); if (delta) return delta; } return 0; };
  const eligible = entries.filter(p => p.meritScore != null).sort(compare);
  // Skipping time pairwise when one value is null is not a transitive ordering.
  // Decide once for the whole tie group instead.
  for (let i = 0; i < eligible.length;) {
    let j = i + 1; while (j < eligible.length && groupKey(eligible[i]) === groupKey(eligible[j])) j++;
    const group = eligible.slice(i, j), useTime = group.length > 1 && group.every(p => p.durationComplete);
    for (const p of group) p.durationTiebreakApplied = useTime;
    group.sort((a, b) => (useTime ? rounded(a.averageDuration) - rounded(b.averageDuration) : 0) || a.tag.localeCompare(b.tag));
    eligible.splice(i, group.length, ...group); i = j;
  }
  let previous = null, rank = 0;
  for (const [i, p] of eligible.entries()) {
    const tied = previous && compare(previous, p) === 0
      && (!p.durationTiebreakApplied || rounded(previous.averageDuration) === rounded(p.averageDuration));
    if (!tied) rank = i + 1;
    p.rank = rank; previous = p;
  }
  return { policy, status: !plans.length ? 'empty' : plans.some(p => p.warState !== 'warEnded') || entries.some(p => p.unresolvedOpportunities) ? 'provisional' : 'complete_recorded_rounds',
    coverage: 'recorded_rounds_only', automaticBonusAllocation: false,
    recordedRounds: plans.length, closedRounds: plans.filter(p => p.warState === 'warEnded').length,
    formulas: { attack: '80 * progress + 15 * fulfilled * difficulty + 5 * addedStars / 3',
      progress: 'min(1, addedStars / (goalStars - starsBeforeAttack))',
      difficulty: '1 - frozen P(stars >= approvedGoal), only with supported and unchanged context; otherwise 0',
      season: '(totalPoints + 2 * 50) / (assessedOpportunities + 2)' },
    entries: [...eligible, ...entries.filter(p => p.meritScore == null).sort((a, b) => a.tag.localeCompare(b.tag))] };
}
