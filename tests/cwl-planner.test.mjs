import test from 'node:test';
import assert from 'node:assert/strict';
import { planWar, validateWar } from '../src/cwl/planner.js';
import { fixture, CLAN } from './cwl-fixtures.mjs';

test('stored CWL roster positions preserve source and produce an active lineup and mirror', () => {
  const raw = fixture({ state: 'warEnded' });
  const source = [[2, 9, 16, 24, 50], [1, 7, 13, 25, 49]];
  [raw.clan, raw.opponent].forEach((side, s) => side.members.forEach((p, i) => { p.mapPosition = source[s][i]; }));
  raw.clan.members.reverse(); raw.opponent.members.reverse();
  const plan = planWar({ raw, clanTag: CLAN, history: [] });
  assert.deepEqual(plan.war.roster.map(p => p.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(plan.war.roster.map(p => p.sourcePosition), source[0]);
  assert.deepEqual(plan.war.opponentRoster.map(p => p.sourcePosition), source[1]);
  assert.ok(Number.isFinite(plan.mirrorExpectedStars));
  assert.equal(new Set(plan.assignments.map(p => p.defenderTag)).size, 5);
});

test('CWL rank normalization never hides duplicate or invalid source positions', () => {
  for (const invalid of [[1, 2, 2, 4, 5], [1, 2, 3, 4, 51], [1, 2, 3, 4, null], [0, 2, 3, 4, 5]]) {
    const raw = fixture();
    raw.clan.members.forEach((p, i) => { p.mapPosition = invalid[i]; });
    assert.throws(() => validateWar(raw, CLAN), /Posições duplicadas|Elencos da guerra incompletos/);
  }
});

test('incomplete CWL lineups remain invalid', () => {
  const raw = fixture();
  raw.clan.members.pop();
  assert.throws(() => validateWar(raw, CLAN), /Elencos da guerra incompletos/);
});
