const tagFor = (prefix, n) => '#' + prefix + String(n).replace(/[1-7]/g, n => 'PYLQGRJ'[Number(n) - 1]);
export const CLAN = '2G8QCR92V';
export function fixture({ start = '20261024T100000.000Z', state = 'preparation' } = {}) {
  const members = prefix => Array.from({ length: 5 }, (_, i) => ({ tag: tagFor(prefix, i), name: prefix + i, townhallLevel: i < 2 ? 18 : 16, mapPosition: i + 1, attacks: [] }));
  return { type: 'cwl', state, teamSize: 5, attacksPerMember: 1, battleModifier: 'none',
    preparationStartTime: start.replace('T100000', 'T090000'), startTime: start, endTime: start.replace('T100000', 'T230000'),
    clan: { tag: '#' + CLAN, name: 'PuroSangue test', attacks: 0, stars: 0, destructionPercentage: 0, members: members('P0') },
    opponent: { tag: '#2998YJPU2', name: 'Opponent test', attacks: 0, stars: 0, destructionPercentage: 0, members: members('Q0') } };
}
export function hit(war, { player = 0, target = 0, stars = 3, destruction = stars === 3 ? 100 : 70, duration = 120, time = null, side = 'clan' } = {}) {
  const other = side === 'clan' ? 'opponent' : 'clan';
  const order = war.clan.attacks + war.opponent.attacks + 1;
  const a = { attackerTag: war[side].members[player].tag, defenderTag: war[other].members[target].tag, stars, destructionPercentage: destruction, duration, order,
    ...(time ? { attackTime: time } : {}) };
  war[side].members[player].attacks.push(a); war[side].attacks++;
  return a;
}
export function historyFor(raw) {
  const history = [];
  for (let day = 10; day <= 22; day += 2) {
    const w = fixture({ start: `202610${day}T100000.000Z`, state: 'warEnded' });
    w.type = 'random'; w.attacksPerMember = 2;
    for (let i = 0; i < 5; i++) { hit(w, { player: i, target: i, stars: i % 3 ? 3 : 2 }); hit(w, { player: i, target: i, side: 'opponent', stars: i % 2 ? 2 : 3 }); }
    history.push(w);
  }
  return history;
}
export class FixtureProvider {
  constructor(raw = fixture(), history = historyFor(raw)) { this.raw = raw; this.records = history; this.loads = 0; this.trainingLoads = 0; this.fail = false; }
  async war() { this.loads++; if (this.fail) throw new Error('fixture upstream failure'); return structuredClone(this.raw); }
  async training() { this.trainingLoads++; return { history: structuredClone(this.records), warnings: [], sources: [{ fixture: true }], fetchedAt: '2026-10-24T09:30:00.000Z' }; }
  async season() { return [structuredClone(this.raw)]; }
}
