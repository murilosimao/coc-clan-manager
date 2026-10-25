import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scope = {};
vm.createContext(scope);
for (const name of ['clashking', 'war-scores']) {
  vm.runInContext(fs.readFileSync(new URL(`../public/portal/${name}.js`, import.meta.url), 'utf8'), scope);
}
const S = scope.WarScores;
const makeWar = (suffix = '') => {
  const members = (prefix) => Array.from({ length: 5 }, (_, i) => ({ tag: `#${prefix}${i}`, name: prefix + i, townhallLevel: 17, mapPosition: i + 1, attacks: [] }));
  return { state: 'warEnded', type: 'random', battleModifier: 'none', teamSize: 5, attacksPerMember: 2,
    preparationStartTime: '20240525T000000.000Z', startTime: '20240526T000000.000Z', endTime: '20240527T000000.000Z',
    clan: { tag: '#CLAN' + suffix, name: 'A', attacks: 0, members: members('A') },
    opponent: { tag: '#OTHER', name: 'B', attacks: 0, members: members('B') } };
};
const history = makeWar();
const add = (war, i, defender, stars, order) => {
  const member = war.clan.members[i];
  member.attacks.push({ attackerTag: member.tag, defenderTag: defender, stars, order, destructionPercentage: stars === 3 ? 100 : 30 });
  war.clan.attacks++;
};
add(history, 0, '#B0', 0, 1);
add(history, 1, '#B0', 3, 2);
add(history, 2, '#B0', 3, 3);
const rawCurrent = makeWar('CURRENT');
rawCurrent.state = 'inWar'; rawCurrent.startTime = '20240601T000000.000Z'; rawCurrent.endTime = '20240602T000000.000Z';
const current = scope.ClashKing.normalizeWar(rawCurrent, 'CLANCURRENT');

const collected = S.collect(current, [history, structuredClone(history)]);
assert.equal(collected.events.length, 2);
assert.equal(collected.events[0].cleanup, false);
assert.equal(collected.events[1].cleanup, true, 'a zero-star first hit still reveals the base');
assert.equal(collected.excluded.alreadyTripled, 1);
assert.equal(collected.excluded.duplicateWars, 1);
assert.equal(collected.events[1].phaseWeight, S.CONFIG.cleanupWeight);
const first = collected.events[0];
assert.ok(Math.abs(first.weight - 2 ** (-first.ageDays / S.CONFIG.halfLifeDays)) < 1e-12);

const oldNormal = structuredClone(history);
oldNormal.startTime = '20240516T000000.000Z'; oldNormal.endTime = '20240517T235959.999Z';
const boundaryNormal = structuredClone(history);
boundaryNormal.startTime = '20240517T000000.000Z'; boundaryNormal.endTime = '20240518T000000.000Z';
const limited = S.collect(current, [oldNormal, boundaryNormal]);
assert.equal(limited.excluded.outsideNormalWindow, 1);
assert.equal(limited.events.length, 2, 'the exact 14-day boundary is inclusive');
const oldOnly = S.fit({ war: current, history: [oldNormal] });
assert.ok(oldOnly.players.every((p) => p.attackCount === 0 && p.defenseCount === 0 && p.attackScore === 50 && p.defenseScore === 50), 'old outcomes train neither attack nor defense');

const cwl = (month, clan = '#CLANCURRENT') => {
  const raw = structuredClone(history);
  raw.type = 'cwl'; raw.attacksPerMember = 1;
  raw.clan.tag = clan; raw.opponent.tag = '#PASTOPPONENT';
  raw.preparationStartTime = `2024${month}01T000000.000Z`;
  raw.startTime = `2024${month}02T000000.000Z`; raw.endTime = `2024${month}03T000000.000Z`;
  return raw;
};
const seasons = S.collect(current, [cwl('05'), cwl('04'), cwl('03'), cwl('05', '#OTHER'), cwl('03', '#OTHER'), cwl('02', '#OTHER')]);
assert.equal(JSON.stringify(seasons.context.cwlSeasons), JSON.stringify({ CLANCURRENT: ['2024-05', '2024-04'], OTHER: ['2024-05', '2024-03'] }));
assert.equal(seasons.excluded.outsideCwlSeasons, 2);
assert.equal(seasons.events.length, 8, 'two monthly CWL editions per clan survive beyond 14 days for both roles');
const olderRound = cwl('05'); olderRound.startTime = '20240504T000000.000Z'; olderRound.endTime = '20240505T000000.000Z';
assert.equal(S.collect(current, [cwl('05'), olderRound, cwl('04')]).wars, 3, 'two editions must not mean two rounds');
const incompatibleSeason = cwl('05'); incompatibleSeason.battleModifier = 'other';
assert.equal(S.collect(current, [incompatibleSeason, cwl('04'), cwl('03')]).events.length, 2, 'modifier mismatch must not backfill with a third season');
const unknownSeason = cwl('05'); delete unknownSeason.preparationStartTime;
assert.equal(S.collect(current, [unknownSeason]).excluded.unknownCwlSeason, 1);
const explicitSeason = { ...unknownSeason, season: '2024-05' };
assert.equal(S.collect(current, [explicitSeason]).events.length, 2);
const crossesMonth = cwl('04'); crossesMonth.startTime = '20240430T000000.000Z'; crossesMonth.endTime = '20240501T000000.000Z';
assert.equal(S.collect(current, [crossesMonth]).events[0].season, '2024-04', 'end month must not change the inferred edition');

const different = structuredClone(history); different.battleModifier = 'legend I'; different.clan.tag = '#DIFFERENT';
const absent = structuredClone(history); delete absent.battleModifier; absent.clan.tag = '#ABSENT';
const future = structuredClone(history); future.endTime = '20240603T000000.000Z'; future.clan.tag = '#FUTURE';
const incomplete = structuredClone(history); incomplete.clan.members[0].attacks[0].order = 8; incomplete.clan.tag = '#INCOMPLETE';
const bad = structuredClone(history); bad.clan.members[0].attacks[0].stars = null; bad.clan.tag = '#BAD';
const rejected = S.collect(current, [different, absent, future, incomplete, bad, rawCurrent]);
assert.equal(rejected.events.length, 0);
assert.equal(rejected.excluded.modifier, 1);
assert.equal(rejected.excluded.unknownModifier, 1);
assert.equal(rejected.excluded.currentOrFuture, 2);
assert.equal(rejected.excluded.incomplete, 2);
assert.equal(rejected.excluded.invalidAttacks, 1);

const model = S.fit({ war: current, history: [history] });
assert.equal(model.players.filter((p) => current.roster.some((r) => r.tag === p.tag) || current.opponentRoster.some((r) => r.tag === p.tag)).length, 10);
for (const r of model.players) for (const role of ['attack', 'defense']) {
  assert.ok(Number.isFinite(r[role + 'Score']));
  assert.ok(Math.abs(r[role + 'Score'] - Math.min(100, Math.max(0, 50 + S.CONFIG.scoreScale * r[role + 'Effect'] / model.scales[role]))) < 1e-10);
}
assert.ok(model.thresholds[0] < model.thresholds[1] && model.thresholds[1] < model.thresholds[2]);
assert.ok(model.coefficients[0] >= 0);
const changedOutcome = structuredClone(current);
changedOutcome.attacks = [{ attacker: changedOutcome.roster[0], defender: changedOutcome.opponentRoster[3], stars: 0, destruction: 5, order: 1 }];
const unchanged = S.fit({ war: changedOutcome, history: [history, rawCurrent] });
assert.deepEqual([...unchanged.coefficients], [...model.coefficients], 'current-war outcomes must not enter the training set');
assert.deepEqual([...unchanged.thresholds], [...model.thresholds]);
assert.deepEqual(unchanged.players.map((p) => p.attackScore), model.players.map((p) => p.attackScore));
const matchup = S.assess(model, changedOutcome, changedOutcome.attacks[0]);
assert.equal(matchup.defender.tag, changedOutcome.opponentRoster[3].tag, 'use the chosen target, never the mirror base');
assert.equal(matchup.category, 'unknown', 'a tiny sample must not become a confident judgment');

const upgraded = structuredClone(current); upgraded.roster[0].th = 18;
const upgradeModel = S.fit({ war: upgraded, history: [history] });
const upgradedRating = S.rating(upgradeModel, upgraded.roster[0]);
assert.equal(upgradedRating.attackCount, 0, 'old-TH history is not treated as current-TH evidence');
assert.equal(upgradedRating.attackScore, 50);
const noHistory = S.fit({ war: current, history: [] });
assert.ok(noHistory.players.every((p) => p.attackScore === 50 && p.defenseScore === 50));
assert.equal(S.confidence(noHistory.players[0], 'attack'), 'Referência');
assert.throws(() => S.fit({ war: { ...current, battleModifier: null }, history: [history] }), /modificador/);
console.log('Scores: chronological cutoff, exact modifiers, complete histories, deduplication, fresh after zero stars, overkill exclusion, CV changes, formula reproduction and actual-target assessment passed.');
