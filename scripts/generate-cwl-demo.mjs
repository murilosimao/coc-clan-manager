// Explicit illustrative demo only. Uses the same merit engine as the real backend.
import fs from 'node:fs';
import { planWar } from '../src/cwl/planner.js';
import { rankSeason, RANKING_POLICY } from '../src/cwl/ranking.js';
const source = JSON.parse(fs.readFileSync(new URL('../public/portal/demo.json', import.meta.url)));
const clanTag = '2G8QCR92V', season = '2026-10';
const cocTime = date => new Date(date).toISOString().replace(/[-:]/g, '');
const ownMembers = source.members.slice(0, 15);
const enemyNames = ['Raven', 'Brutus', 'Hades', 'Atlas', 'Akira', 'Shadow', 'Nero', 'Odin', 'Ghost', 'Titan', 'Ragnar', 'Ares', 'Storm', 'Viper', 'Zeus'];
function warAt(date, type = 'cwl', rotate = false) {
  const start = Date.parse(date + 'T08:00:00Z');
  const own = [...ownMembers]; if (rotate) own[14] = source.members[18];
  const members = own.map((m, i) => ({ tag: '#' + m.tag, name: m.name, townhallLevel: m.th, mapPosition: i + 1, attacks: [] }));
  const enemies = ownMembers.map((m, i) => ({ tag: '#Q9' + 'PYLQGRJCUV'[i % 10] + (i < 10 ? 'P' : 'Y'), name: enemyNames[i], townhallLevel: m.th, mapPosition: i + 1, attacks: [] }));
  return { type, state: 'preparation', teamSize: 15, attacksPerMember: type === 'cwl' ? 1 : 2,
    preparationStartTime: cocTime(start - 86400000), startTime: cocTime(start), endTime: cocTime(start + 86400000), battleModifier: 'none',
    clan: { tag: '#' + clanTag, name: '⚡PuroSangue⚡', members, attacks: 0 },
    opponent: { tag: '#2998YJPU2', name: 'THUNDER · exemplo', members: enemies, attacks: 0 } };
}
const history = ['2026-09-25', '2026-09-27', '2026-09-29', '2026-10-01', '2026-10-03', '2026-10-05'].map((date, day) => {
  const war = warAt(date, 'random'); war.state = 'warEnded';
  for (const [side, other] of [['clan', 'opponent'], ['opponent', 'clan']]) {
    for (let i = 0; i < 15; i++) {
      const target = (i + day % 2) % 15, stars = (i + day + (side === 'clan' ? 1 : 0)) % 4;
      war[side].members[i].attacks.push({ attackerTag: war[side].members[i].tag, defenderTag: war[other].members[target].tag,
        stars, destructionPercentage: stars === 3 ? 100 : 27 + stars * 26, order: war.clan.attacks + war.opponent.attacks + 1 });
      war[side].attacks++;
    }
  }
  return war;
});
const plans = ['2026-10-07', '2026-10-08', '2026-10-09'].map((day, index) => {
  const raw = warAt(day, 'cwl', index > 0), result = planWar({ raw, clanTag, history });
  const approved = result.assignments.map((m, i) => ({ ...m, goalStars: i % 4 === 0 ? 2 : 3 }));
  const best = new Map(), outcomes = [];
  for (let i = 0; i < (index === 2 ? 9 : 15); i++) {
    if (index === 0 && i === 13) continue;
    const mission = approved[i], actualTarget = index === 1 && i === 3 ? approved[(i + 1) % 15].defenderTag : mission.defenderTag;
    const stars = i % 7 === 2 ? 1 : i % 5 === 1 ? 2 : 3;
    const before = best.get(actualTarget) || 0, attacked = best.has(actualTarget), followed = actualTarget === mission.defenderTag;
    best.set(actualTarget, Math.max(before, stars));
    const unresolved = index === 0 && i === 10;
    outcomes.push({ order: outcomes.length + 1, attackerTag: mission.attackerTag, defenderTag: actualTarget, stars,
      destruction: stars === 3 ? 100 : i % 7 === 2 ? 47 : 87 + i % 8, durationSeconds: index === 1 && i === 1 ? null : 116 + (i * 9 + index * 7) % 61,
      addedStars: Math.max(0, stars - before), targetStarsBeforeAttack: before, targetAttackedBeforeAttack: attacked,
      attribution: unresolved ? 'ambiguous' : 'known', missionRevision: unresolved ? null : 2, mission: unresolved ? null : mission,
      targetFollowed: unresolved ? null : followed, goalReached: unresolved ? null : stars >= mission.goalStars,
      missionFulfilled: unresolved ? null : followed && stars >= mission.goalStars,
      missionSurpassed: unresolved ? null : followed && stars > mission.goalStars,
      result: unresolved ? 'needs_attribution' : !followed ? 'wrong_target' : stars < mission.goalStars ? 'below_goal' : stars > mission.goalStars ? 'surpassed' : 'fulfilled' });
  }
  return { id: 'illustrative-' + index, clanTag, season, warStart: raw.startTime, opponentTag: '2998YJPU2',
    warState: index === 2 ? 'inWar' : 'warEnded', state: index === 2 ? 'draft' : 'approved', retrospective: false,
    plannerVersion: result.version, scoreVersion: result.model.version, currentRevision: index === 2 ? 3 : 2,
    createdAt: raw.preparationStartTime, observedAt: '2026-10-09T14:00:00Z',
    initial: { assignments: result.assignments, participants: result.participants,
      opponentParticipants: result.war.opponentRoster.map(({ tag, name, th }) => ({ tag, name, th })), warnings: result.warnings }, matchups: result.matchups,
    effective: { revision: 2, assignments: approved }, current: { approved: index !== 2,
      assignments: index === 2 ? approved.map((m, i) => i === 12 ? { ...m, goalStars: 3 } : m) : approved }, outcomes,
    adoption: { missions: approved.length, targetRetained: approved.length,
      goalRetained: approved.filter((m, i) => m.goalStars === result.assignments[i].goalStars).length,
      fullyRetained: approved.filter((m, i) => m.goalStars === result.assignments[i].goalStars).length,
      modified: approved.filter((m, i) => m.goalStars !== result.assignments[i].goalStars).length,
      goalsRaised: approved.filter((m, i) => m.goalStars > result.assignments[i].goalStars).length,
      goalsLowered: approved.filter((m, i) => m.goalStars < result.assignments[i].goalStars).length,
      retentionRate: approved.filter((m, i) => m.goalStars === result.assignments[i].goalStars).length / approved.length, approvedRevision: 2 },
    metrics: { attacksUsed: outcomes.length, addedStars: outcomes.reduce((s, a) => s + a.addedStars, 0), fulfilled: outcomes.filter(o => o.missionFulfilled).length,
      unresolvedAttacks: outcomes.filter(o => o.missionFulfilled == null).length }, };
});
const ranking = rankSeason(plans, { ...RANKING_POLICY, persistedAt: '2026-10-06T08:00:00Z' });
const clean = ({ probabilities, eta, goalSupport, ...m }) => m;
const data = { season, illustrative: true, rounds: plans.map(p => ({ warStart: p.warStart, state: p.warState, opponent: { tag: '#2998YJPU2', name: 'THUNDER · exemplo' }, teamSize: 15 })),
  plans: plans.map(({ matchups, ...p }) => ({ ...p, initial: { ...p.initial, assignments: p.initial.assignments.map(clean) },
    effective: { ...p.effective, assignments: p.effective.assignments.map(clean) }, current: { ...p.current, assignments: p.current.assignments.map(clean) },
    outcomes: p.outcomes.map(o => ({ ...o, mission: o.mission ? clean(o.mission) : null })) })), ranking };
fs.writeFileSync(new URL('../public/portal/cwl-demo.json', import.meta.url), JSON.stringify(data));
console.log(`Illustrative CWL demo generated: ${plans.length} rounds, ${ranking.entries.length} players.`);
