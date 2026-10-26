import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSeason, RANKING_POLICY as policy } from '../src/cwl/ranking.js';

function round({ player = 'A', goal = 3, stars = 3, destruction = 100, duration = 120,
  support = .7, before = 0, beforePlan = 0, attacked = before > 0, attackedPlan = beforePlan > 0,
  supported = true, fulfilled = stars >= goal, followed = true, hit = true,
  state = 'warEnded', retrospective = false, attribution = 'known', approved = true } = {}) {
  const candidate = { attackerTag: player, defenderTag: 'X', goalStars: goal,
    targetStarsBeforePlan: beforePlan, targetAttackedBeforePlan: attackedPlan,
    probabilities: Array.from({ length: 4 }, (_, s) => s === goal ? support : s === 0 ? 1 - support : 0),
    attackCount: supported ? 8 : 0, defenseCount: supported ? 8 : 0,
    attackWeight: supported ? 6 : 0, defenseWeight: supported ? 6 : 0, warnings: [] };
  return { warStart: '20261024T100000.000Z', warState: state, retrospective,
    initial: { participants: [{ tag: player, name: player }] }, matchups: [[candidate]],
    effective: approved ? { revision: 2, assignments: [candidate] } : null,
    outcomes: !hit ? [] : [{ order: 1, attackerTag: player, defenderTag: followed ? 'X' : 'Y', stars,
      addedStars: Math.max(0, stars - before), targetStarsBeforeAttack: before, targetAttackedBeforeAttack: attacked,
      destruction, durationSeconds: duration, mission: approved && fulfilled != null ? candidate : null,
      missionFulfilled: fulfilled == null ? null : followed && fulfilled,
      missionSurpassed: followed && stars > goal, targetFollowed: followed, attribution }],
  };
}
const ranking = plans => rankSeason(plans, policy);
const entry = plans => ranking(plans).entries[0];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('a difficult two-star mission can outweigh an easy triple, with every component exposed', () => {
  const hard = entry([round({ goal: 2, stars: 2, support: .7 })]);
  const easy = entry([round({ player: 'B', support: .98 })]);
  close(hard.totalPoints, 80 + 15 * .3 + 5 * 2 / 3);
  close(easy.totalPoints, 80 + 15 * .02 + 5);
  assert.ok(hard.meritScore > easy.meritScore);
  close(hard.opportunities[0].goalSupportEstimate, .7);
});
test('partial success earns progress but no difficulty bonus; surpassing is not counted as two missions', () => {
  const failed = entry([round({ stars: 2, destruction: 90 })]);
  close(failed.totalPoints, 80 * 2 / 3 + 5 * 2 / 3);
  assert.equal(failed.opportunities[0].difficultyPoints, 0);
  const surpassed = entry([round({ goal: 2, stars: 3 })]);
  assert.equal(surpassed.fulfilled, 1); assert.equal(surpassed.opportunities[0].status, 'surpassed');
});
test('a wrong-target triple receives no merit or tiebreak credit', () => {
  const p = entry([round({ followed: false })]);
  assert.equal(p.totalPoints, 0); assert.equal(p.fulfilled, 0); assert.equal(p.averageCreditedStars, 0);
  assert.equal(p.averageDestruction, null); assert.equal(p.averageDuration, null);
  assert.equal(p.opportunities[0].stars, 3); assert.equal(p.opportunities[0].actualDefenderTag, 'Y');
  assert.equal(p.opportunities[0].defenderTag, 'X');
});
test('limited history does not exclude a player or remove mission credit; it cannot invent a difficulty bonus', () => {
  const p = entry([round({ supported: false })]);
  assert.equal(p.status, 'ranked'); assert.equal(p.totalPoints, 85);
  assert.equal(p.opportunities[0].difficultyAvailable, false);
});
test('regularization prevents a single perfect result from automatically outranking repeated good results', () => {
  const single = round({ support: 0 }), many = Array.from({ length: 7 }, () => round({ player: 'B', support: .5 }));
  const r = ranking([single, ...many]);
  assert.equal(r.entries[0].tag, 'B'); close(r.entries[1].meritScore, (100 + 100) / 3);
  // Volume alone cannot overcome a markedly better average.
  const good = Array.from({ length: 3 }, () => round({ support: .2 }));
  const poor = Array.from({ length: 7 }, () => round({ player: 'B', stars: 1 }));
  assert.equal(ranking([...good, ...poor]).entries[0].tag, 'A');
});
test('reserve days never create opportunities; pending attacks do not lower merit', () => {
  const played = round(), reserve = round({ player: 'B', hit: false }), pending = round({ hit: false, state: 'inWar' });
  const p = ranking([played, reserve, pending]).entries.find(p => p.tag === 'A');
  assert.equal(p.assessedOpportunities, 1); close(p.meritScore, entry([played]).meritScore);
  assert.equal(ranking([pending]).status, 'provisional');
});
test('only a closed, approved unused attack counts as zero; missing approval is not player failure', () => {
  const missed = entry([round({ hit: false })]);
  assert.equal(missed.missed, 1); assert.equal(missed.totalPoints, 0); assert.equal(missed.assessedOpportunities, 1);
  const unapproved = entry([round({ hit: false, approved: false })]);
  assert.equal(unapproved.assessedOpportunities, 0); assert.equal(unapproved.meritScore, null);
  assert.equal(unapproved.unresolvedOpportunities, 1);
});
test('ambiguous, retrospective and pre-plan records are explicit and never auto-penalized', () => {
  for (const options of [{ fulfilled: null, attribution: 'ambiguous' }, { retrospective: true }, { fulfilled: null, attribution: 'before_plan' }]) {
    const p = entry([round(options)]); assert.equal(p.assessedOpportunities, 0); assert.equal(p.meritScore, null);
    assert.equal(p.rank, null); assert.equal(p.status, 'provisional');
  }
});
test('the approved goal tail is recomputed, not copied from the original three-star support', () => {
  const p = round({ goal: 2, stars: 2 });
  p.matchups[0][0].probabilities = [.05, .15, .5, .3]; p.matchups[0][0].goalSupport = .3;
  close(entry([p]).opportunities[0].goalSupportEstimate, .8);
  assert.deepEqual(entry([p]).opportunities[0].frozenProbabilities, [.05, .15, .5, .3]);
});
test('fresh and cleanup context are not mixed, even after a zero-star first attack', () => {
  const p = entry([round({ attacked: true, attackedPlan: false })]);
  assert.equal(p.opportunities[0].difficultyAvailable, false); assert.equal(p.totalPoints, 85);
  const cleanup = entry([round({ before: 1, beforePlan: 1 })]);
  close(cleanup.totalPoints, 80 + 4.5 + 5 * 2 / 3);
  assert.equal(cleanup.opportunities[0].creditedStars, 2);
});
test('goals already achieved by someone else are excluded rather than counted twice or blamed on the assignee', () => {
  const p = entry([round({ goal: 2, stars: 1, before: 2 })]);
  assert.equal(p.assessedOpportunities, 0); assert.equal(p.opportunities[0].status, 'obsolete_mission');
  assert.equal(p.status, 'excluded'); assert.equal(p.excludedOpportunities, 1);
});
test('destruction breaks a score, mission and stars tie before time', () => {
  const r = ranking([round({ stars: 2, destruction: 80, duration: 100 }), round({ player: 'B', stars: 2, destruction: 90, duration: 200 })]);
  assert.equal(r.entries[0].tag, 'B'); assert.equal(r.entries[0].rank, 1);
});
test('time breaks a complete equal-destruction group; a genuine tie keeps the same rank', () => {
  const r = ranking([round({ duration: 140 }), round({ player: 'B', duration: 120 }), round({ player: 'C', duration: 120 })]);
  assert.deepEqual(r.entries.map(p => [p.tag, p.rank]), [['B', 1], ['C', 1], ['A', 3]]);
  assert.ok(r.entries.every(p => p.durationTiebreakApplied));
});
test('one missing duration disables time for the entire tie group, independently of insertion order', () => {
  const plans = [round({ duration: 140 }), round({ player: 'B', duration: null }), round({ player: 'C', duration: 120 })];
  for (const p of [plans, plans.toReversed(), [plans[1], plans[2], plans[0]]]) {
    const r = ranking(p); assert.deepEqual(r.entries.map(p => [p.tag, p.rank]), [['A', 1], ['B', 1], ['C', 1]]);
    assert.ok(r.entries.every(p => !p.durationTiebreakApplied));
    assert.equal(r.entries[1].averageDuration, null);
  }
});
test('empty and partial coverage never claim a full-season bonus allocation', () => {
  const empty = ranking([]); assert.equal(empty.status, 'empty'); assert.equal(empty.automaticBonusAllocation, false);
  assert.equal(ranking([round()]).status, 'complete_recorded_rounds');
  assert.equal(ranking([round()]).coverage, 'recorded_rounds_only');
});
