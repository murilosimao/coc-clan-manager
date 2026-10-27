import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPlan } from '../src/cwl/router.js';

test('public view exposes the approved orders, not the draft or revision analysis', () => {
  const approved = [{ attackerTag: 'A', defenderTag: 'X', goalStars: 2 }];
  const draft = [{ attackerTag: 'A', defenderTag: 'Y', goalStars: 3 }];
  const input = { state: 'draft', currentRevision: 3, initial: { assignments: draft, participants: [{ tag: 'A' }], opponentParticipants: [{ tag: 'X' }] },
    current: { assignments: draft }, effective: { revision: 2, assignments: approved }, revisions: [{ revision: 3 }], adoption: { modified: 1 },
    duplicateTargets: ['Y'], outcomes: [{ attackerTag: 'A', missionRevision: 2, initialTargetFollowed: true, stars: 2 }],
    metrics: { initialTargetsFollowed: 1, initialMissionsFulfilled: 1, attacksUsed: 1 } };
  const result = publicPlan(input);
  assert.deepEqual(result.current.assignments, approved);
  assert.deepEqual(result.effective.assignments, approved);
  assert.equal(result.state, 'approved');
  assert.equal(result.revisions, undefined); assert.equal(result.adoption, undefined); assert.equal(result.currentRevision, undefined);
  assert.equal(result.initial.assignments, undefined); assert.deepEqual(result.initial.participants, [{ tag: 'A' }]);
  assert.equal(result.outcomes[0].missionRevision, undefined); assert.equal(result.outcomes[0].initialTargetFollowed, undefined);
  assert.equal(result.metrics.initialTargetsFollowed, undefined); assert.equal(result.metrics.attacksUsed, 1);
  assert.deepEqual(result.duplicateTargets, []);
  assert.deepEqual(input.current.assignments, draft, 'redaction does not mutate the leader view');
  const pending = publicPlan({ ...input, effective: null });
  assert.deepEqual(pending.current.assignments, []); assert.equal(pending.effective, null);
});
