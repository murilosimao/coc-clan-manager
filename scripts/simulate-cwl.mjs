// Read-only retrospective replay. Imports the shipped planner; never writes application DB records.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { planWar, maximizeAssignment, PLANNER_VERSION } from '../src/cwl/planner.js';
import { WarScores as S } from '../src/cwl/scoring.js';
import { timestamp } from '../src/cwl/errors.js';
import { writeReport } from './report-cwl-simulation.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const out = path.resolve(arg('--out', path.join(repo, '../output/cwl-validation-' + new Date().toISOString().slice(0, 10))));
const tags = arg('--clans', '2G8QCR92V,2RYQYUQ8J,2998YJPU2,2CCLP98VJ,2VR8PQL8,2920Y0V90,2C0YL98L,2C9CQU8UP,2CL8UY8R0,2CRLCPRU2,2G0CGR0U2,2G9J9GUC2').split(',').map(t => t.replace(/^#/, '').toUpperCase());
const externalTags = new Set(arg('--external-clans', '2C9CQU8UP,2CL8UY8R0,2CRLCPRU2,2G0CGR0U2,2G9J9GUC2').split(','));
for (const dir of ['sources', 'plans']) fs.mkdirSync(path.join(out, dir), { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2));
const cleanTag = value => String(value).replace(/^#/, '');
const seasonOf = w => w.season || new Date(timestamp(w.preparationStartTime)).toISOString().slice(0, 7);
const keyOf = w => [cleanTag(w.clan.tag), cleanTag(w.opponent.tag)].sort().join('|') + '|' + w.startTime;
const priorKeysFile = path.join(out, 'prior-evaluation-keys.json');
if (!fs.existsSync(priorKeysFile)) {
  const keys = new Set();
  for (const name of ['war-backtest', 'war-backtest-expansion', 'war-backtest-ranked']) {
    const file = path.join(repo, '../tmp', name, 'targets.json');
    if (fs.existsSync(file)) for (const t of JSON.parse(fs.readFileSync(file))) keys.add(keyOf(t.raw));
  }
  fs.writeFileSync(priorKeysFile, JSON.stringify([...keys].sort(), null, 2));
}
const priorKeys = new Set(JSON.parse(fs.readFileSync(priorKeysFile)));
const digest = data => crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sum = a => a.reduce((s, x) => s + x, 0);
const sigmoid = x => 1 / (1 + Math.exp(-x));
const fromEta = (model, eta) => { const t = model.thresholds.map(c => sigmoid(eta - c)); return [1 - t[0], t[0] - t[1], t[1] - t[2], t[2]]; };
async function pool(jobs, task, concurrency = 3) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => { while (cursor < jobs.length) await task(jobs[cursor++]); }));
}
async function history(tag, type) {
  const file = path.join(out, 'sources', `${tag}-${type}.json`);
  if (fs.existsSync(file)) { const old = JSON.parse(fs.readFileSync(file)); if (old.ok && Array.isArray(old.data?.items)) return old; }
  const url = `https://api.clashk.ing/v2/clan/%23${tag}/wars?limit=${type === 'random' ? 60 : 35}&type=${type}`;
  let entry;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      entry = { tag, type, url, fetchedAt: new Date().toISOString(), status: response.status, ok: response.ok, data: await response.json() };
      if (entry.ok) break;
    } catch (error) { entry = { tag, type, url, fetchedAt: new Date().toISOString(), ok: false, error: error.message }; }
  }
  fs.writeFileSync(file, JSON.stringify(entry));
  return entry;
}
const seeds = [];
await pool(tags, async tag => { seeds.push(await history(tag, 'cwl')); });
const completed = seeds.flatMap(s => (s.data?.items || []).filter(w => w.state === 'warEnded' && timestamp(w.endTime) < Date.now()));
const season = arg('--season', completed.map(seasonOf).sort().at(-1));
assert(season, 'No completed CWL season found.');
const inventory = tags.map(tag => {
  const source = seeds.find(s => s.tag === tag), wars = (source.data?.items || []).filter(w => w.state === 'warEnded' && timestamp(w.endTime) < Date.now() && seasonOf(w) === season);
  const unique = [...new Map(wars.map(w => [keyOf(w), { ...w, type: 'cwl' }])).values()].sort((a, b) => timestamp(a.startTime) - timestamp(b.startTime));
  const side = unique[0] && [unique[0].clan, unique[0].opponent].find(s => cleanTag(s.tag) === tag);
  return { tag, name: side?.name || tag, recordedRounds: unique.length, completeSeven: unique.length === 7, wars: unique };
});
const targets = inventory.flatMap(c => c.wars.map(raw => ({ clanTag: c.tag, clanName: c.name, raw })));
const originalGroupTags = new Set(targets.filter(t => !externalTags.has(t.clanTag)).flatMap(t => [t.raw.clan.tag, t.raw.opponent.tag]));
assert(targets.filter(t => externalTags.has(t.clanTag)).every(t => !originalGroupTags.has(t.raw.clan.tag) && !originalGroupTags.has(t.raw.opponent.tag)), 'External league groups must be disjoint from original groups.');
const externalGroups = inventory.filter(c => externalTags.has(c.tag)).map(c => new Set(c.wars.flatMap(w => [w.clan.tag, w.opponent.tag])));
for (let i = 0; i < externalGroups.length; i++) for (let j = i + 1; j < externalGroups.length; j++) assert(![...externalGroups[i]].some(t => externalGroups[j].has(t)), 'External groups must also be disjoint from each other.');
const allTags = [...new Set(targets.flatMap(t => [cleanTag(t.raw.clan.tag), cleanTag(t.raw.opponent.tag)]))];
const jobs = allTags.flatMap(tag => ['random', 'cwl'].map(type => ({ tag, type })));
let downloaded = 0;
const sources = [];
await pool(jobs, async j => { sources.push(await history(j.tag, j.type)); downloaded++; if (downloaded % 20 === 0 || downloaded === jobs.length) console.log(JSON.stringify({ stage: 'sources', done: downloaded, total: jobs.length })); });
write('inventory.json', { season, clans: inventory.map(({ wars, ...c }) => c), sources: sources.map(({ data, ...s }) => ({ ...s, wars: data?.items?.length || 0 })) });
if (process.argv.includes('--collect-only')) process.exit(0);
for (const file of fs.readdirSync(path.join(out, 'plans')).filter(f => f.endsWith('.json'))) fs.unlinkSync(path.join(out, 'plans', file));
const sourceMap = new Map(sources.map(s => [s.tag + ':' + s.type, s]));
const attacks = [], rounds = [], skipped = [], invariantChecks = [];
const baseline = (events, hit) => {
  const counts = [1, 1, 1, 1];
  for (const e of events) counts[e.stars] += e.weight;
  const prior = counts.map(x => x / sum(counts));
  const bucket = events.filter(e => e.type === 'cwl' && e.defender.th === hit.defender.th && e.delta === Math.max(-3, Math.min(3, hit.attacker.th - hit.defender.th)) && e.cleanup === hit.cleanup);
  const shrunk = prior.map(p => 10 * p);
  for (const e of bucket) shrunk[e.stars] += e.weight;
  return { global: prior, context: shrunk.map(x => x / sum(shrunk)), bucketCount: bucket.length };
};
for (const target of targets) {
  const { raw, clanTag, clanName } = target;
  const key = clanTag + '|' + raw.startTime;
  try {
    const sourceKeys = [raw.clan.tag, raw.opponent.tag].flatMap(t => ['random', 'cwl'].map(type => cleanTag(t) + ':' + type));
    const training = sourceKeys.flatMap(k => { const entry = sourceMap.get(k); return entry?.ok ? (entry.data.items || []).map(w => ({ ...w, type: w.type || k.split(':')[1] })) : []; });
    const start = performance.now();
    const plan = planWar({ raw, clanTag, history: training });
    const elapsedMs = performance.now() - start;
    const { model, war, assignments, matchups } = plan;
    assert(model.events.every(e => timestamp(e.endTime) <= model.context.cutoff && e.warKey !== keyOf(raw)));
    assert(model.events.every(e => e.modifier === model.context.modifier));
    assert(model.events.every(e => e.type !== 'random' || timestamp(e.endTime) >= model.context.normalSince));
    assert(Object.values(model.context.cwlSeasons).every(s => s.length <= 2));
    assert.equal(assignments.length, raw.teamSize);
    assert.equal(new Set(assignments.map(a => a.attackerTag)).size, raw.teamSize);
    assert.equal(new Set(assignments.map(a => a.defenderTag)).size, raw.teamSize);
    assert(plan.expectedStars + 1e-8 >= plan.mirrorExpectedStars);
    assert(matchups.flat().every(m => m.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1) && Math.abs(sum(m.probabilities) - 1) < 1e-9));
    if (!invariantChecks.some(c => c.clanTag === clanTag)) {
      const blank = structuredClone(raw); blank.state = 'preparation';
      for (const side of [blank.clan, blank.opponent]) { side.attacks = 0; side.stars = 0; for (const m of side.members) { m.attacks = []; delete m.bestOpponentAttack; } }
      const replay = planWar({ raw: blank, clanTag, history: training });
      assert.deepEqual(replay.assignments.map(m => [m.attackerTag, m.defenderTag, m.goalStars, m.probabilities]), assignments.map(m => [m.attackerTag, m.defenderTag, m.goalStars, m.probabilities]));
      invariantChecks.push({ clanTag, noCurrentOutcomeInfluence: true, start: raw.startTime });
    }
    const ownHits = war.attacks.filter(a => a.side === war.result.ourSide);
    const byAttacker = new Map(assignments.map(a => [a.attackerTag, a]));
    let matched = 0;
    for (const hit of ownHits) {
      const assessment = S.assess(model, war, hit);
      const matchup = matchups.flat().find(m => m.attackerTag === hit.attacker.tag && m.defenderTag === hit.defender.tag);
      const supported = assessment.category !== 'unknown' && Math.abs(hit.attacker.th - hit.defender.th) <= 3;
      const probabilities = fromEta(model, assessment.eta);
      const cleanup = assessment.phase !== 'Fresh';
      const ref = baseline(model.events, { ...hit, cleanup });
      const recommended = byAttacker.get(hit.attacker.tag);
      const sameAsPlan = recommended?.defenderTag === hit.defender.tag;
      if (sameAsPlan) matched++;
      attacks.push({ key, warKey: keyOf(raw), previouslyEvaluatedWar: priorKeys.has(keyOf(raw)), externalClan: externalTags.has(clanTag), clanTag, clanName, warStart: raw.startTime, season, order: hit.order,
        attackerTag: hit.attacker.tag, attackerName: hit.attacker.name, attackerCV: hit.attacker.th, attackerPosition: hit.attacker.position,
        defenderTag: hit.defender.tag, defenderName: hit.defender.name, defenderCV: hit.defender.th, defenderPosition: hit.defender.position,
        stars: hit.stars, destruction: hit.destruction, phase: assessment.phase, overkill: assessment.alreadyTripled,
        supported, category: supported ? assessment.category : 'unknown', margin: assessment.margin,
        attackScore: assessment.attacker.attackScore, defenseScore: assessment.defender.defenseScore,
        attackCount: assessment.attacker.attackCount, defenseCount: assessment.defender.defenseCount,
        attackWeight: assessment.attacker.attackWeight, defenseWeight: assessment.defender.defenseWeight,
        probabilities, baselineGlobal: ref.global, baselineContext: ref.context, baselineContextN: ref.bucketCount,
        prewarProbabilities: matchup.probabilities, prewarGoal: matchup.goalStars, prewarGoalSupport: matchup.goalSupport,
        goalSupported: !matchup.warnings.includes('goal_below_support_threshold'), sameAsPlan, sameAsMirror: hit.attacker.position === hit.defender.position,
        recommendedDefenderTag: recommended?.defenderTag, recommendedGoal: recommended?.goalStars });
    }
    const ptPermutation = maximizeAssignment(matchups.map(row => row.map(m => m.probabilities[3])));
    const ptAssignments = matchups.map((row, i) => row[ptPermutation[i]]);
    const side = [raw.clan, raw.opponent].find(c => cleanTag(c.tag) === clanTag);
    const board = new Map();
    for (const hit of ownHits) board.set(hit.defender.tag, Math.max(board.get(hit.defender.tag) || 0, hit.stars));
    assert.equal(sum([...board.values()]), side.stars, 'Source scoreboard must match attack chronology.');
    const round = { key, plannerVersion: plan.version, scoreVersion: model.version, warKey: keyOf(raw), previouslyEvaluatedWar: priorKeys.has(keyOf(raw)), externalClan: externalTags.has(clanTag), clanTag, clanName, start: raw.startTime, opponent: war.result.clans[war.result.opponentSide], teamSize: raw.teamSize,
      sourceHash: digest(raw), trainingEvents: model.events.length, trainingWars: model.wars,
      trainingCutoff: model.context.cutoff, trainingLatestEnd: model.events.length ? Math.max(...model.events.map(e => timestamp(e.endTime))) : null,
      cwlSeasons: model.context.cwlSeasons, battleModifier: model.context.modifier, exclusions: model.excluded,
      unavailableSources: sourceKeys.filter(k => !sourceMap.get(k)?.ok), computeMs: elapsedMs,
      expectedStars: plan.expectedStars, mirrorExpectedStars: plan.mirrorExpectedStars,
      expectedTriples: sum(assignments.map(a => a.probabilities[3])), mirrorExpectedTriples: sum(war.roster.map((a, i) => matchups[i].find(m => m.defenderTag === war.opponentRoster.find(d => d.position === a.position).tag).probabilities[3])),
      ptOptimizedExpectedStars: sum(ptAssignments.map(m => m.expectedStars)), ptOptimizedExpectedTriples: sum(ptAssignments.map(m => m.probabilities[3])),
      actualStars: side.stars, usedAttacks: ownHits.length, missedAttacks: raw.teamSize - ownHits.length,
      exactRecommendationMatches: matched, recommendedGoalCounts: Object.fromEntries([1, 2, 3].map(g => [g, assignments.filter(m => m.goalStars === g).length])),
      supportedRecommendations: assignments.filter(m => m.evidence === 'supported').length,
      outsideModelRange: assignments.filter(m => m.warnings.includes('cv_gap_outside_model_range')).length,
      goalsBelowThreshold: assignments.filter(m => m.warnings.includes('goal_below_support_threshold')).length };
    rounds.push(round);
    write(`plans/${clanTag}-${raw.startTime}.json`, { ...round, assignments, matchups,
      rosterScores: model.players.filter(p => [...war.roster, ...war.opponentRoster].some(r => S.playerKey(r) === p.key)),
      model: { version: model.version, config: model.config, context: model.context, featureNames: model.featureNames, coefficients: model.coefficients,
        thresholds: model.thresholds, scales: model.scales, referenceTH: model.referenceTH, loss: model.loss, totalWeight: model.totalWeight },
      trainingEventIds: model.events.map(e => e.id) });
  } catch (error) { skipped.push({ key, clanTag, clanName, reason: error.message }); }
  console.log(JSON.stringify({ stage: 'replay', done: rounds.length + skipped.length, total: targets.length, good: rounds.length, skipped: skipped.length }));
}
const score = (row, field = 'probabilities') => {
  const p = row[field], y = row.stars;
  let cdf = 0, rps = 0;
  for (let k = 0; k < 3; k++) { cdf += p[k]; rps += (cdf - Number(y <= k)) ** 2 / 3; }
  return { rps, brier3: (p[3] - Number(y === 3)) ** 2, nll: -Math.log(Math.max(1e-12, p[y])), mae: Math.abs(sum(p.map((q, k) => q * k)) - y) };
};
function metrics(rows, field = 'probabilities') {
  return { n: rows.length, triples: rows.filter(r => r.stars === 3).length, observedPT: mean(rows.map(r => Number(r.stars === 3))), estimatedPT: mean(rows.map(r => r[field][3])),
    observedStars: mean(rows.map(r => r.stars)), estimatedStars: mean(rows.map(r => sum(r[field].map((q, k) => q * k)))),
    ...Object.fromEntries(['rps', 'brier3', 'nll', 'mae'].map(k => [k, mean(rows.map(r => score(r, field)[k]))])) };
}
const groupBy = (rows, fn) => [...Map.groupBy(rows, fn)].map(([group, values]) => ({ group, ...metrics(values) }));
function calibration(rows) {
  return [0, .2, .4, .6, .8].map(lo => { const rs = rows.filter(r => r.probabilities[3] >= lo && (lo === .8 ? r.probabilities[3] <= 1 : r.probabilities[3] < lo + .2)); return { lower: lo, upper: lo + .2, ...metrics(rs) }; });
}
function goalSummary(rows, threshold) {
  const evaluated = rows.map(r => {
    const tails = [1, 2, 3].map(g => sum(r.prewarProbabilities.slice(g)));
    const valid = tails.flatMap((p, i) => p >= threshold ? [i + 1] : []);
    const goal = valid.length ? Math.max(...valid) : 1;
    return { goal, fallback: !valid.length, probability: tails[goal - 1], success: r.stars >= goal };
  });
  return { threshold, n: rows.length, fallback: evaluated.filter(x => x.fallback).length,
    goals: [1, 2, 3].map(goal => { const values = evaluated.filter(x => x.goal === goal && !x.fallback); return { goal, n: values.length, support: mean(values.map(x => x.probability)), fulfilled: mean(values.map(x => Number(x.success))) }; }) };
}
function bootstrap(rows, baselineField = 'baselineContext', cluster = 'war') {
  const clusters = [...Map.groupBy(rows, r => cluster === 'clan' ? r.clanTag : r.warKey).values()];
  if (!clusters.length) return null;
  let state = 20261025;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const stats = clusters.map(xs => ({ n: xs.length, delta: sum(xs.map(r => score(r).rps - score(r, baselineField).rps)) }));
  const draws = Array.from({ length: 2000 }, () => { let n = 0, delta = 0; for (let j = 0; j < clusters.length; j++) { const c = stats[Math.floor(random() * stats.length)]; n += c.n; delta += c.delta; } return delta / n; }).sort((a, b) => a - b);
  return { unit: cluster === 'clan' ? 'clan-edition' : 'unique-war', clusters: clusters.length, repetitions: draws.length, deltaRps: metrics(rows).rps - metrics(rows, baselineField).rps, ci95: [draws[50], draws[1949]], negativeFavorsModel: true };
}
const useful = attacks.filter(a => !a.overkill), qualified = useful.filter(a => a.supported), fresh = useful.filter(a => a.phase === 'Fresh'), qualifiedFresh = fresh.filter(a => a.supported);
const external = useful.filter(a => a.externalClan && !a.previouslyEvaluatedWar);
const summary = { createdAt: new Date().toISOString(), season, plannerVersion: rounds.length ? PLANNER_VERSION : null, scoreVersion: S.VERSION,
  sourceHashes: Object.fromEntries(['src/cwl/planner.js','public/portal/war-scores.js','public/portal/clashking.js'].map(f => [f, digest(fs.readFileSync(path.join(repo, f), 'utf8'))])),
  protocol: { training: 'Exact shipped provider histories: two clans, random limit 60, CWL limit 35. Every replay uses the shipped 14-day normal window, latest two available eligible CWL editions, exact modifier and pre-war cutoff.',
    scope: 'Latest observed completed season shared by selected seeds. Missing rounds remain missing. No application DB writes.',
    observed: 'Only actual attacked pairs have realized outcomes. Optimized and mirror totals are model expectations, never claimed realized gains.',
    baseline: 'Weighted training-only global star distribution with +1 pseudocount; contextual baseline uses CWL, same defender CV, clamped CV delta and phase, shrunk with prior mass 10.',
    goals: 'Evaluate pre-war goals on actual fresh pairs; target choice is observed after the fact, not an official historic mission. No retroactive merit ranking.',
    bootstrap: '2000 deterministic unique-war block draws; both sides of the same war stay together. Dependence across wars within a clan/edition remains a limitation. No parameter selected from this test set.' },
  clans: inventory.map(({ wars, ...c }) => ({ ...c, simulatedRounds: rounds.filter(r => r.clanTag === c.tag).length, ...metrics(useful.filter(a => a.clanTag === c.tag)),
    qualified: metrics(qualified.filter(a => a.clanTag === c.tag)), missedAttacks: sum(rounds.filter(r => r.clanTag === c.tag).map(r => r.missedAttacks)) })),
  rounds: rounds.length, uniqueWars: new Set(targets.filter(t => rounds.some(r => r.key === t.clanTag + '|' + t.raw.startTime)).map(t => keyOf(t.raw))).size,
  skipped, noOutcomeLeakageChecks: invariantChecks, totalAttacks: attacks.length, overkills: attacks.length - useful.length,
  compatibility: { normalizedRounds: targets.filter(t => [t.raw.clan,t.raw.opponent].some(s => [...s.members].sort((a,b) => a.mapPosition-b.mapPosition).some((p,i) => p.mapPosition !== i+1))).length,
    originalValidationRejected: targets.filter(t => [t.raw.clan,t.raw.opponent].some(s => s.members.some(p => p.mapPosition > t.raw.teamSize))).length },
  priorOverlap: { historicalWars: priorKeys.size, rounds: rounds.filter(r => r.previouslyEvaluatedWar).length, uniqueWars: new Set(rounds.filter(r => r.previouslyEvaluatedWar).map(r => r.warKey)).size },
  external: { tags: [...externalTags], leagueGroups: externalGroups.length, disjointGroups: true, uniqueWars: new Set(external.map(r => r.warKey)).size, all: metrics(external), qualified: metrics(external.filter(r => r.supported)),
    baselineContext: metrics(external, 'baselineContext'), bootstrap: bootstrap(external), bootstrapClans: bootstrap(external, 'baselineContext', 'clan'), byCategory: groupBy(external, r => r.category), calibration: calibration(external.filter(r => r.supported)),
    goals: goalSummary(external.filter(r => r.supported && r.phase === 'Fresh'), .7) },
  missedAttacks: sum(rounds.map(r => r.missedAttacks)), all: metrics(useful), qualified: metrics(qualified), fresh: metrics(fresh), qualifiedFresh: metrics(qualifiedFresh),
  baselineGlobal: metrics(useful, 'baselineGlobal'), baselineContext: metrics(useful, 'baselineContext'), bootstrapAll: bootstrap(useful), bootstrapQualified: bootstrap(qualified),
  byCategory: groupBy(useful, r => r.category), byPhase: groupBy(useful, r => r.phase), byCvGap: groupBy(useful, r => `${r.attackerCV}->${r.defenderCV}`),
  calibration: calibration(useful), qualifiedCalibration: calibration(qualified), goals: goalSummary(fresh, .7), qualifiedGoals: goalSummary(qualifiedFresh, .7),
  goalSensitivity: [.6, .7, .8].map(t => goalSummary(qualifiedFresh, t)),
  recommendation: { missions: sum(rounds.map(r => r.teamSize)), expectedStars: sum(rounds.map(r => r.expectedStars)), mirrorExpectedStars: sum(rounds.map(r => r.mirrorExpectedStars)),
    expectedTriples: sum(rounds.map(r => r.expectedTriples)), mirrorExpectedTriples: sum(rounds.map(r => r.mirrorExpectedTriples)),
    ptOptimizedExpectedStars: sum(rounds.map(r => r.ptOptimizedExpectedStars)), ptOptimizedExpectedTriples: sum(rounds.map(r => r.ptOptimizedExpectedTriples)),
    supported: sum(rounds.map(r => r.supportedRecommendations)), outsideModelRange: sum(rounds.map(r => r.outsideModelRange)), goalsBelowThreshold: sum(rounds.map(r => r.goalsBelowThreshold)),
    observedSameTarget: metrics(useful.filter(r => r.sameAsPlan)), qualifiedSameTarget: metrics(qualified.filter(r => r.sameAsPlan)) },
  timings: { medianMs: rounds.map(r => r.computeMs).sort((a,b) => a-b)[Math.floor(rounds.length / 2)] ?? null },
};
write('attacks.json', attacks); write('rounds.json', rounds); write('summary.json', summary);
writeReport(out);
console.log(JSON.stringify({ stage: 'complete', out, season, rounds: rounds.length, attacks: attacks.length, qualified: qualified.length, skipped: skipped.length }));
