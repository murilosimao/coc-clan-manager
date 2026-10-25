import test from 'node:test';
import assert from 'node:assert/strict';
import { ClashCwlProvider } from '../src/cwl/provider.js';
import { WarScores as S, ClashKing as C } from '../src/cwl/scoring.js';
import { fixture, hit, CLAN } from './cwl-fixtures.mjs';

function previous(current) {
  const old = structuredClone(current); old.state = 'warEnded'; old.type = 'random'; old.attacksPerMember = 2;
  old.clan.tag = '#2JJJ'; old.preparationStartTime = '20261020T100000.000Z'; old.startTime = '20261021T100000.000Z'; old.endTime = '20261022T100000.000Z';
  hit(old, { player: 1, target: 0, stars: 0 }); hit(old, { player: 0, target: 0, stars: 3 });
  return old;
}
test('individual references recover complete previous-clan wars and preserve cleanup chronology', async () => {
  const raw = fixture(), old = previous(raw), seen = [];
  const p = raw.clan.members[0], d = old.opponent.members[0];
  const reference = { attackerTag: p.tag, defenderTag: d.tag, attackerTownhall: p.townhallLevel, defenderTownhall: d.townhallLevel,
    attackingClanTag: old.clan.tag, defendingClanTag: old.opponent.tag, warEndTime: old.endTime, warType: 'random', battleModifier: 'none' };
  const invalid = [{ ...reference, warEndTime: '20261025T100000.000Z' }, { ...reference, warEndTime: '20260901T100000.000Z' },
    { ...reference, battleModifier: 'legend I' }, { ...reference, attackerTownhall: 16 }];
  const provider = new ClashCwlProvider(async (url, options) => {
    seen.push({ url, options }); const u = new URL(url);
    if (u.pathname.startsWith('/v2/clan/')) return Response.json({ items: [] });
    if (u.pathname.includes('/war/attacks')) return Response.json({ items: decodeURIComponent(u.pathname).includes(p.tag) ? [reference, reference, ...invalid] : [] });
    assert.equal(decodeURIComponent(u.pathname), `/v2/war/${old.clan.tag}/previous/${old.endTime}`);
    return Response.json(old);
  });
  const result = await provider.training(raw);
  assert.equal(result.history.length, 1);
  assert.equal(seen.filter(s => s.url.includes('/previous/')).length, 1, 'references are deduplicated before fetching full wars');
  assert.ok(seen.every(s => !s.options.headers.Authorization));
  const references = seen.filter(s => s.url.includes('/war/attacks'));
  assert.equal(references.length, 10);
  assert.ok(references.every(s => new URL(s.url).searchParams.get('time[before]') === '2026-10-24T10:00:00.000Z'));
  const collected = S.collect(C.normalizeWar(raw, CLAN), result.history);
  assert.equal(collected.events.length, 2);
  assert.equal(collected.events.find(e => e.attacker.tag === p.tag.slice(1)).cleanup, true, 'a partial hit must not be invented as fresh');
});

test('optional player-history failure preserves the clan history and explicit warnings', async () => {
  const raw = fixture(), provider = new ClashCwlProvider(async url => new URL(url).pathname.startsWith('/v2/clan/')
    ? Response.json({ items: [] }) : Response.json({}, { status: 503 }), { playerLimit: 2 });
  const result = await provider.training(raw);
  assert.deepEqual(result.history, []);
  assert.ok(result.warnings.includes('player_history_lookup_limit'));
  assert.equal(result.warnings.filter(w => w.startsWith('player_history_unavailable:')).length, 2);
});

test('personal CWL windows include transfers but never a third edition or a different modifier', () => {
  const raw = fixture(), records = ['09','08','07'].map((month, i) => {
    const w = previous(raw); w.type = 'cwl'; w.attacksPerMember = 1; w.clan.tag = '#2JJ' + ['P','Y','L'][i];
    w.preparationStartTime = `2026${month}01T100000.000Z`; w.startTime = `2026${month}02T100000.000Z`; w.endTime = `2026${month}03T100000.000Z`;
    return w;
  });
  const war = C.normalizeWar(raw, CLAN), result = S.collect(war, records);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.context.playerCwlSeasons[raw.clan.members[0].tag.slice(1)], ['2026-09','2026-08']);
  records[0].battleModifier = 'legend I';
  const strict = S.collect(war, records);
  assert.equal(strict.events.length, 2, 'an incompatible modifier cannot backfill a third edition');
  assert.ok(strict.events.every(e => e.season === '2026-08'));
});

test('a complete individual war repairs a partial cached copy without inventing fresh attacks', () => {
  const raw = fixture(), full = previous(raw), partial = structuredClone(full); partial.clan.members.pop();
  assert.equal(S.historyQuality(partial), 0); assert.equal(S.historyQuality(full), 1);
  for (const records of [[partial,full],[full,partial]]) {
    const result = S.collect(C.normalizeWar(raw, CLAN), records);
    assert.equal(result.events.length, 2); assert.equal(result.events[1].cleanup, true);
  }
});

test('missing, stale-weight and strong player evidence remain distinct', () => {
  assert.equal(S.evidence(null,'attack').level,'reference');
  assert.equal(S.evidence({attackCount:20,attackWeight:1.5,attackWeight2:.1125},'attack').level,'limited');
  const e=S.evidence({attackCount:20,attackWeight:10,attackWeight2:5},'attack');
  assert.equal(e.level,'strong'); assert.equal(e.effectiveN,20);
});

test('a large CV gap never becomes favorable even with strong individual history', () => {
  const raw=fixture();raw.opponent.members[0].townhallLevel=10;
  const war=C.normalizeWar(raw,CLAN),model=S.fit({war,history:[]}),a=war.roster[0],d=war.opponentRoster[0];
  model.events=Array(50).fill({});
  Object.assign(S.rating(model,a),{attackCount:20,attackWeight:10,attackEffect:10});
  Object.assign(S.rating(model,d),{defenseCount:20,defenseWeight:10,defenseEffect:0});
  const result=S.assess(model,war,{attacker:a,defender:d,order:1,stars:1});
  assert.equal(result.outsideModelRange,true);assert.equal(result.category,'unknown');
});
