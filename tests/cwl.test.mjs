import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectDatabase, withDatabase,loadPlan } from '../src/cwl/database.js';
import { migrate } from '../scripts/migrate-cwl.mjs';
import { maximizeAssignment, planWar, validateWar,PLANNER_VERSION,DEFAULT_CONFIG } from '../src/cwl/planner.js';
import { WarScores as S } from '../src/cwl/scoring.js';
import { CwlService } from '../src/cwl/service.js';
import { createCwlHandler } from '../src/cwl/router.js';
import { createWorker } from '../src/worker.js';
import { ClashCwlProvider } from '../src/cwl/provider.js';
import { RANKING_POLICY } from '../src/cwl/ranking.js';
import { fixture, hit, historyFor, FixtureProvider, CLAN } from './cwl-fixtures.mjs';
import { rankedFixture } from './ranked-fixtures.mjs';
import { signRanked } from '../src/ranked-proof.js';

const url = new URL(process.env.CWL_TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!process.env.CWL_TEST_DATABASE_URL) url.pathname = '/coc_cwl_test';
assert.ok(url.pathname.endsWith('_test'), 'Refusing to reset a database whose name does not end in _test');
if (!process.env.CWL_TEST_DATABASE_URL) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Remote tests require an explicit disposable CWL_TEST_DATABASE_URL');
const env = { DATABASE_URL: url.href, LEADER_API_KEY: 'test-only-' + 'a'.repeat(40), LEADER_CLAN_TAG: CLAN };
let sql, provider, service, now;
before(async () => {
  if (!process.env.CWL_TEST_DATABASE_URL) {
    const control = connectDatabase(process.env);
    const name = url.pathname.slice(1);
    assert.match(name, /^[a-z_]+$/);
    const exists = await control`select 1 from pg_database where datname=${name}`;
    if (!exists.length) await control.unsafe(`CREATE DATABASE "${name}"`);
    await control.end();
  }
  sql = connectDatabase(env); await migrate(sql);
});
beforeEach(async () => {
  await sql.unsafe('TRUNCATE cwl.reviews,cwl.attacks,cwl.observations,cwl.revisions,cwl.plans,cwl.rounds,cwl.ranking_policies CASCADE');
  now = Date.parse('2026-10-24T09:30:00Z'); provider = new FixtureProvider(); service = new CwlService(sql, provider, () => now);
});
after(async () => { await sql?.end(); });
const start = '20261024T100000.000Z';
async function browserInput(){
  now=Date.parse('2026-10-24T10:30:00Z');provider.raw.state='inWar';
  const raw=structuredClone(provider.raw),training=await provider.training(),result=planWar({raw,clanTag:CLAN,history:training.history});
  const payload={raw,training,model:result.model,config:DEFAULT_CONFIG,plannerVersion:PLANNER_VERSION,computeMs:25,computedAt:new Date(now).toISOString()};
  const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return {payload,bytes,result};
}
const ensured = () => service.ensure(CLAN, start);
const approve = async revision => { now += 1000; return service.revise(CLAN, start, { expectedRevision: revision, approve: true, reason: 'Approved for this round' }); };
function assignHit(plan, player = 0, stars = 3, extras = {}) {
  const m = plan.effective.assignments[player];
  const i = provider.raw.clan.members.findIndex(p => p.tag.slice(1) === m.attackerTag), j = provider.raw.opponent.members.findIndex(p => p.tag.slice(1) === m.defenderTag);
  return hit(provider.raw, { player: i, target: j, stars, ...extras });
}

test('Hungarian assignment maximizes the team and uses every target once', () => {
  const a = maximizeAssignment([[2.1, 2, 2.8], [2.2, 2.9, 2.9], [.8, 1.1, 2.7]]);
  assert.deepEqual(a, [0, 1, 2]);
  assert.deepEqual(maximizeAssignment([[1, 1], [1, 1]]), [0, 1]);
});

test('browser-computed plan persists without server fitting, retains the full archive and cannot overwrite the first plan',async()=>{
  const {payload,bytes,result}=await browserInput(),fit=S.fit;S.fit=()=>{throw Error('Server fitting must not run');};
  try{
    const first=await service.initializeComputed(CLAN,start,payload,bytes,'leader:test-user');
    assert.equal(first.created,true);assert.equal(first.effective,null);
    assert.deepEqual(first.initial.assignments,result.assignments.map(({probabilities,goalSupport,eta,note,...m})=>m));
    const second=await service.initializeComputed(CLAN,start,payload,bytes,'coLeader:test-user');
    assert.equal(second.created,false);assert.equal(second.id,first.id);
    const audit=await service.read(CLAN,start,true);
    assert.deepEqual(audit.scoreSnapshot,payload.model);assert.deepEqual(audit.sourceSnapshot.history,payload.training.history);
    assert.equal(audit.sourceSnapshot.archive.submittedBy,'leader:test-user');
    const minimal=await loadPlan(sql,CLAN,start);assert.deepEqual(Object.keys(minimal.score_snapshot),['version']);assert.deepEqual(minimal.source_snapshot,{});
    await assert.rejects(sql`update cwl.plan_archives set submitted_by='other'`,/append-only/);
    const [count]=await sql`select count(*)::int as n from cwl.plan_archives`;assert.equal(count.n,1);
  }finally{S.fit=fit;}
});

test('tampered formula, changed war and stale browser calculations cannot create records',async()=>{
  const {payload,bytes}=await browserInput();
  const bad=structuredClone(payload);bad.model.players[0].attackScore=99;
  await assert.rejects(service.initializeComputed(CLAN,start,bad,bytes,'leader:test'),/inconsistente/);
  const altered=structuredClone(payload);altered.model.events[0].stars=(altered.model.events[0].stars+1)%4;
  await assert.rejects(service.initializeComputed(CLAN,start,altered,bytes,'leader:test'),/não correspondem/);
  const stale=structuredClone(payload);stale.computedAt=new Date(now-16*60000).toISOString();
  await assert.rejects(service.initializeComputed(CLAN,start,stale,bytes,'leader:test'),/Data ou modificador/);
  hit(provider.raw);await assert.rejects(service.initializeComputed(CLAN,start,payload,bytes,'leader:test'),e=>e.code==='war_changed_recalculate');
  const [count]=await sql`select count(*)::int as n from cwl.plans`;assert.equal(count.n,0);
});

test('authenticated ranked proposals verify source signatures before persistence and retain the complete audit',async()=>{
  const sample=rankedFixture(),key='disposable-ranked-private-bridge-key-123456789';
  provider.raw=sample.raw;provider.records=sample.history;now=sample.now;
  sample.ranked.packets=await Promise.all(sample.ranked.packets.map(p=>signRanked(p,key)));
  const result=planWar({raw:sample.raw,clanTag:CLAN,history:sample.history,ranked:sample.ranked});
  const payload={raw:sample.raw,training:{history:sample.history,ranked:sample.ranked,warnings:[]},model:result.model,config:result.config,plannerVersion:result.version,computeMs:100,computedAt:new Date(now).toISOString()};
  const handler=createCwlHandler({provider,database:async(_,fn)=>fn(sql),clock:()=>now,browserPlans:true,authorize:async()=>({id:'test',role:'leader'})});
  const send=async p=>{
    const archive=await new Response(new Blob([JSON.stringify(p)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return handler(new Request(`http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan/initialize`,{method:'POST',headers:{'Content-Type':'application/gzip'},body:archive}),{...env,CWL_BACKEND_KEY:key});
  };
  const bad=structuredClone(payload);bad.training.ranked.packets[1].items[0].league=36;
  await assert.rejects(send(bad),e=>e.code==='ranked_source_invalid');
  const [empty]=await sql`select count(*)::int as n from cwl.plans`;assert.equal(empty.n,0);
  const response=await send(payload);assert.equal(response.status,201);
  const audit=await service.read(CLAN,start,true);
  assert.deepEqual(audit.scoreSnapshot,payload.model);assert.deepEqual(audit.sourceSnapshot.ranked,sample.ranked);
  assert.equal(audit.scoreSnapshot.version,'war-atq-ranked-v1');
});

test('concurrent browser submissions decompress and persist only the first proposal',async()=>{
  const {payload,bytes}=await browserInput();let loads=0;
  const results=await Promise.all(Array.from({length:3},()=>withDatabase(env,db=>new CwlService(db,provider,()=>now).initializeComputed(CLAN,start,
    async()=>{loads++;return {payload,bytes};},null,'leader:test'))));
  assert.equal(loads,1);assert.equal(results.filter(r=>r.created).length,1);assert.equal(new Set(results.map(r=>r.id)).size,1);
});

test('anonymous initial uploads are refused before reading or decompressing their body',async()=>{
  const handler=createCwlHandler({provider,database:async(_,fn)=>fn(sql),clock:()=>now,browserPlans:true});
  const request=new Request(`http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan/initialize`,{method:'POST',headers:{'Content-Type':'application/gzip'},body:'invalid-gzip'});
  await assert.rejects(handler(request,env),e=>e.status===401);assert.equal(request.bodyUsed,false);
});

test('public browser-mode reads never generate a plan or pin a policy for an untracked edition',async()=>{
  const handler=createCwlHandler({provider,database:async(_,fn)=>fn(sql),clock:()=>now,browserPlans:true});
  await assert.rejects(handler(new Request(`http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan`),env),e=>e.code==='plan_not_found');
  await service.seasonAnalytics(CLAN,'2026-09');
  const [count]=await sql`select (select count(*) from cwl.plans)+(select count(*) from cwl.ranking_policies) as n`;
  assert.equal(Number(count.n),0);assert.equal(provider.trainingLoads,0);
});

test('public plan hides drafts and revision history while authenticated leadership can inspect them',async()=>{
  const initial = await ensured();
  const handler = createCwlHandler({provider,database:async(_,fn)=>fn(sql),clock:()=>now,browserPlans:true,
    authorize: async request => {
      if (request.headers.get('Authorization') !== 'Bearer editor-test') {
        const { CwlError } = await import('../src/cwl/errors.js'); throw new CwlError(401,'Sessão necessária');
      }
      return { id:'editor-test',role:'leader' };
    }});
  const base = `http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan`;
  const get = async headers => (await handler(new Request(base,{headers}),env)).json();
  let publicView = await get();
  assert.deepEqual(publicView.current.assignments,[]); assert.equal(publicView.effective,null);
  assert.equal(publicView.initial.assignments,undefined); assert.equal(publicView.revisions,undefined);
  let leader = await get({Authorization:'Bearer editor-test'});
  assert.equal(leader.initial.assignments.length,initial.initial.assignments.length); assert.equal(leader.revisions.length,1);
  await approve(1);
  const approved = await service.read(CLAN,start);
  const draftAssignments = approved.current.assignments.map(m => ({attackerTag:m.attackerTag,defenderTag:m.defenderTag,goalStars:m.goalStars}));
  draftAssignments[0].goalStars = draftAssignments[0].goalStars === 1 ? 2 : 1;
  await service.revise(CLAN,start,{expectedRevision:2,assignments:draftAssignments,approve:false,reason:'Teste'});
  publicView = await get(); leader = await get({Authorization:'Bearer editor-test'});
  assert.equal(publicView.current.assignments[0].goalStars,approved.current.assignments[0].goalStars);
  assert.equal(leader.current.assignments[0].goalStars,draftAssignments[0].goalStars);
  assert.equal(leader.revisions.length,3); assert.equal(publicView.revisions,undefined);
  const rankingUrl = `http://localhost/api/cwl/clans/${CLAN}/seasons/2026-10/ranking`;
  const publicRanking = await (await handler(new Request(rankingUrl),env)).json();
  const leaderRanking = await (await handler(new Request(rankingUrl,{headers:{Authorization:'Bearer editor-test'}}),env)).json();
  assert.equal(publicRanking.entries[0].opportunities[0].missionRevision,undefined);
  assert.equal(leaderRanking.entries[0].opportunities[0].missionRevision,2);
});

test('preparation-day browser cutoff stays frozen while the server validates it later',async()=>{
  const raw=structuredClone(provider.raw),training=await provider.training(),original=Date.now;
  let model;try{Date.now=()=>now;model=S.fit({war:validateWar(raw,CLAN),history:training.history});}finally{Date.now=original;}
  assert.equal(model.context.cutoff,now);
  const payload={raw,training,model,config:DEFAULT_CONFIG,plannerVersion:PLANNER_VERSION,computeMs:10,computedAt:new Date(now).toISOString()};
  const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  now+=60000;const plan=await service.initializeComputed(CLAN,start,payload,bytes,'leader:test');
  assert.equal(plan.created,true);assert.equal(plan.warState,'preparation');
  assert.equal((await service.read(CLAN,start,true)).scoreSnapshot.context.cutoff,now-60000);
});

test('restricted database role can operate CWL but cannot rewrite snapshots, delete history or create tables', async () => {
  await sql.unsafe(readFileSync(new URL('../db/security/cwl-runtime.sql', import.meta.url), 'utf8'));
  const restricted = connectDatabase(env);
  try {
    await restricted.unsafe('SET ROLE cwl_runtime');
    const [role] = await restricted`select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user`;
    assert.deepEqual(Object.values(role), [false,false,false,false]);
    const scoped = new CwlService(restricted, provider, () => now);
    const plan = await scoped.ensure(CLAN,start);
    await scoped.revise(CLAN,start,{expectedRevision:1,approve:true,reason:'Least privilege check'});
    assignHit(await scoped.read(CLAN,start)); now+=1000;
    const synced = await scoped.sync(CLAN,start);
    assert.equal(synced.metrics.attacksUsed,1);
    assert.equal((await scoped.seasonAnalytics(CLAN,'2026-10')).ranking.entries.length,5);
    for (const command of [
      'UPDATE cwl.plans SET score_snapshot=\'{}\'::jsonb',
      'DELETE FROM cwl.revisions', 'TRUNCATE cwl.attacks',
      'CREATE TABLE cwl.forbidden(id integer)', 'UPDATE cwl.migrations SET version=version',
    ]) await assert.rejects(restricted.unsafe(command), e => e.code==='42501');
    assert.equal((await scoped.read(CLAN,start)).id,plan.id);
    const [access] = await sql`select has_schema_privilege('anon','cwl','USAGE') as allowed where exists(select 1 from pg_roles where rolname='anon')`;
    if (access) assert.equal(access.allowed,false);
  } finally { await restricted.end(); }
});
test('optimizer agrees with brute force for deterministic small random matrices', () => {
  let seed = 7; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 20; run++) {
    const a = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => random() * 3));
    let best = -Infinity;
    const search = (row, used, sum) => { if (row === 5) { best = Math.max(best, sum); return; } for (let j = 0; j < 5; j++) if (!used.has(j)) search(row + 1, new Set([...used, j]), sum + a[row][j]); };
    search(0, new Set(), 0);
    const actual = maximizeAssignment(a).reduce((s, j, i) => s + a[i][j], 0);
    assert.ok(Math.abs(actual - best) < 1e-10);
  }
});
test('shared ordinal model produces valid probabilities, explicit goals and no-history references', () => {
  const p = planWar({ raw: fixture(), clanTag: CLAN, history: [] });
  assert.equal(p.assignments.length, 5);
  for (const m of p.matchups.flat()) { assert.ok(m.probabilities.every(p => p >= 0 && p <= 1)); assert.ok(Math.abs(m.probabilities.reduce((a, b) => a + b) - 1) < 1e-10); assert.equal(m.attackScore, 50); assert.equal(m.defenseScore, 50); assert.ok(m.goalStars >= 1 && m.goalStars <= 3); assert.equal(m.evidence, 'limited'); }
});
test('normal wars, duplicate players and incomplete observations are rejected', () => {
  const raw = fixture(); raw.attacksPerMember = 2;
  assert.throws(() => validateWar(raw, CLAN), /um ataque/);
  const duplicate = fixture(); duplicate.clan.members[1].tag = duplicate.clan.members[0].tag;
  assert.throws(() => validateWar(duplicate, CLAN), /Elencos/);
  const incomplete = fixture(); hit(incomplete); incomplete.clan.attacks = 0;
  assert.throws(() => validateWar(incomplete, CLAN), /Contagem/);
});
test('initial plan is persisted once even under concurrent page accesses', async () => {
  const many = await Promise.all(Array.from({ length: 6 }, () => withDatabase(env, db => new CwlService(db, provider, () => now).ensure(CLAN, start))));
  assert.equal(new Set(many.map(p => p.id)).size, 1); assert.equal(many.filter(p => p.created).length, 1); assert.equal(provider.trainingLoads, 1);
  const again = await ensured(); assert.equal(again.currentRevision, 1); assert.equal(provider.trainingLoads, 1);
  assert.equal(again.initial.opponentParticipants.length, 5);
  assert.equal(again.initial.opponentParticipants[0].name, provider.raw.opponent.members[0].name);
  assert.equal(again.initial.opponentParticipants[0].position, provider.raw.opponent.members[0].mapPosition);
});
test('history and the initial snapshot are immutable in PostgreSQL', async () => {
  const p = await ensured();
  await assert.rejects(sql`update cwl.revisions set reason='changed' where plan_id=${p.id}`, /append-only/);
  await assert.rejects(sql`update cwl.plans set initial_plan='{}'::jsonb where id=${p.id}`, /immutable/);
  await assert.rejects(sql`delete from cwl.observations`, /append-only/);
});
test('ranking policy is pinned once per edition, immutable and reused by concurrent readers', async () => {
  await ensured();
  const [before] = await sql`select * from cwl.ranking_policies where clan_tag=${CLAN} and season='2026-10'`;
  assert.deepEqual(before.policy, RANKING_POLICY);
  const many = await Promise.all(Array.from({ length: 4 }, () => withDatabase(env, db => new CwlService(db, provider, () => now).seasonAnalytics(CLAN, '2026-10'))));
  assert.ok(many.every(r => r.ranking.policy.version === RANKING_POLICY.version));
  const [after] = await sql`select * from cwl.ranking_policies where clan_tag=${CLAN} and season='2026-10'`;
  assert.deepEqual(after, before);
  await assert.rejects(sql`update cwl.ranking_policies set policy='{}'::jsonb`, /append-only/);
  await assert.rejects(sql`delete from cwl.ranking_policies`, /append-only/);
});
test('persisted results feed merit and only closed approved opportunities count as missed', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p);
  await service.sync(CLAN, start);
  const active = await service.seasonAnalytics(CLAN, '2026-10');
  assert.equal(active.ranking.entries.filter(p => p.meritScore != null).length, 1);
  const player = active.ranking.entries.find(e => e.tag === p.effective.assignments[0].attackerTag);
  assert.equal(player.assessedOpportunities, 1); assert.equal(player.fulfilled, 1);
  assert.equal(player.opportunities[0].missionRevision, 2);
  assert.ok(player.totalPoints >= 85 && player.totalPoints <= 100);
  now = Date.parse('2026-10-25T00:00:00Z'); provider.raw.state = 'warEnded'; await service.sync(CLAN, start);
  const ended = await service.seasonAnalytics(CLAN, '2026-10');
  assert.equal(ended.ranking.entries.filter(e => e.missed === 1).length, 4);
  assert.equal(ended.ranking.status, 'complete_recorded_rounds');
  assert.equal(ended.calibration.bonusRankingPolicy, RANKING_POLICY.version);
  assert.ok(ended.ranking.entries.every(e => e.opportunities.length === 1));
});
test('ranking stays provisional during ambiguous attribution and recomputes after append-only review', async () => {
  await ensured(); const p = await approve(1);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p);
  await service.sync(CLAN, start);
  const before = await service.seasonAnalytics(CLAN, '2026-10');
  const tag = p.effective.assignments[0].attackerTag;
  assert.equal(before.ranking.entries.find(e => e.tag === tag).meritScore, null);
  now += 1000; await service.review(CLAN, start, { order: 1, missionRevision: 2, reason: 'Leader confirmed communicated mission' });
  const after = await service.seasonAnalytics(CLAN, '2026-10');
  const player = after.ranking.entries.find(e => e.tag === tag);
  assert.ok(player.meritScore > 0); assert.equal(player.unresolvedOpportunities, 0);
  assert.equal(player.opportunities[0].missionRevision, 2);
});
test('approval, leader changes, adoption metrics and optimistic locking', async () => {
  const initial = await ensured(); const approved = await approve(1);
  assert.equal(approved.adoption.fullyRetained, 5);
  const missions = approved.current.assignments.map(m => ({ attackerTag: m.attackerTag, defenderTag: m.defenderTag, goalStars: m.goalStars }));
  [missions[0].defenderTag, missions[1].defenderTag] = [missions[1].defenderTag, missions[0].defenderTag];
  missions[0].goalStars = missions[0].goalStars === 3 ? 2 : 3; now += 1000;
  const edited = await service.revise(CLAN, start, { expectedRevision: 2, assignments: missions, approve: true, reason: 'Leader changed two targets' });
  assert.equal(edited.currentRevision, 3); assert.equal(edited.adoption.targetRetained, 3); assert.equal(edited.adoption.modified, 2);
  assert.deepEqual(edited.initial.assignments, initial.initial.assignments);
  await assert.rejects(service.revise(CLAN, start, { expectedRevision: 2, approve: true, reason: 'Old editor' }), e => e.status === 409);
});
test('draft edits do not replace the previously approved missions', async () => {
  await ensured(); const p = await approve(1); now += 1000;
  const missions = p.current.assignments.map(m => ({ attackerTag: m.attackerTag, defenderTag: m.defenderTag, goalStars: 1 }));
  const d = await service.revise(CLAN, start, { expectedRevision: 2, assignments: missions, reason: 'Draft changes' });
  assert.equal(d.current.approved, false); assert.equal(d.effective.revision, 2);
});
test('observations update execution without retraining or changing the initial plan', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p);
  const result = await service.sync(CLAN, start);
  assert.equal(result.currentRevision, 2); assert.equal(provider.trainingLoads, 1); assert.equal(result.outcomes[0].missionFulfilled, true);
  assert.equal(result.outcomes[0].attribution, 'known'); assert.equal(result.metrics.addedStars, 3);
  const second = await service.sync(CLAN, start); assert.equal(second.metrics.observations, result.metrics.observations);
});
test('goal 2 with 3 stars is surpassed and a wrong target never fulfills the mission', async () => {
  const p = await ensured(); const missions = p.current.assignments.map(m => ({ attackerTag: m.attackerTag, defenderTag: m.defenderTag, goalStars: 2 }));
  now += 1000; const approved = await service.revise(CLAN, start, { expectedRevision: 1, assignments: missions, approve: true, reason: 'Two-star missions' });
  now += 1000; await service.sync(CLAN, start); now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(approved);
  const own = approved.effective.assignments[1]; const i = provider.raw.clan.members.findIndex(p => p.tag.slice(1) === own.attackerTag);
  const wrong = provider.raw.opponent.members.findIndex(p => p.tag.slice(1) !== own.defenderTag);
  hit(provider.raw, { player: i, target: wrong });
  const result = await service.sync(CLAN, start);
  assert.equal(result.outcomes[0].result, 'surpassed'); assert.equal(result.outcomes[1].result, 'wrong_target');
});
test('approval between observations creates an explicit ambiguity; leader review resolves it', async () => {
  await ensured(); const approved = await approve(1);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(approved);
  const ambiguous = await service.sync(CLAN, start);
  assert.equal(ambiguous.outcomes[0].attribution, 'ambiguous'); assert.equal(ambiguous.outcomes[0].missionFulfilled, null);
  now += 1000;
  const reviewed = await service.review(CLAN, start, { order: 1, missionRevision: 2, reason: 'Confirmed which mission was communicated' });
  assert.equal(reviewed.outcomes[0].attribution, 'leader_review'); assert.equal(reviewed.outcomes[0].missionFulfilled, true);
});
test('source attack timestamps resolve revision attribution without guessing from detection time', async () => {
  await ensured(); const approved = await approve(1);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(approved, 0, 3, { time: '20261024T100500.000Z' });
  const p = await service.sync(CLAN, start); assert.equal(p.outcomes[0].attributionBasis, 'source_timestamp'); assert.equal(p.outcomes[0].attribution, 'known');
});
test('late initial access preserves existing hits and plans only remaining attacks', async () => {
  provider.raw.state = 'inWar'; hit(provider.raw); now = Date.parse('2026-10-24T10:10:00Z');
  const p = await ensured(); assert.equal(p.initial.assignments.length, 4); assert.equal(p.outcomes[0].attribution, 'before_plan');
  assert.ok(p.initial.assignments.every(m => m.defenderTag !== provider.raw.opponent.members[0].tag.slice(1)));
});
test('ended wars are retrospective and cannot receive invented approved missions', async () => {
  provider.raw.state = 'warEnded'; hit(provider.raw); now = Date.parse('2026-10-25T00:00:00Z');
  const p = await ensured(); assert.equal(p.retrospective, true); assert.equal(p.metrics.attributableAttacks, 0);
  await assert.rejects(approve(1), e => e.status === 409);
});
test('already observed player missions cannot be rewritten and missing duration stays null', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p, 0, 3, { duration: null });
  const observed = await service.sync(CLAN, start); assert.equal(observed.outcomes[0].durationSeconds, null);
  const missions = observed.current.assignments.map(m => ({ attackerTag: m.attackerTag, defenderTag: m.defenderTag, goalStars: m.goalStars })); missions[0].goalStars = 1;
  await assert.rejects(service.revise(CLAN, start, { expectedRevision: 2, assignments: missions, approve: true, reason: 'Rewrite completed mission' }), e => e.status === 409);
  const season = await service.seasonAnalytics(CLAN, '2026-10'); const player = season.players.find(p => p.attacks);
  assert.equal(player.averageDuration, null); assert.equal(player.durationComplete, false);
});
test('stale observations cannot erase attacks and malformed snapshots roll back atomically', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  const old = structuredClone(provider.raw); now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p);
  await service.sync(CLAN, start); provider.raw = old;
  await assert.rejects(service.sync(CLAN, start), e => e.status === 422);
  assert.equal((await service.read(CLAN, start)).metrics.attacksUsed, 1);
});
test('calibration dataset includes real outcomes only and preserves original and applied missions', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p);
  await service.sync(CLAN, start); const dataset = await service.dataset(CLAN, '2026-10');
  assert.equal(dataset.rows.length, 1); assert.equal(dataset.unobservedMatchupsIncluded, false); assert.ok(dataset.rows[0].actualMatchup); assert.ok(dataset.rows[0].initialMission);
});
test('HTTP worker routes enforce CORS, leader authentication, clan scope and JSON validation', async () => {
  const handler = createCwlHandler({ provider, clock: () => now }); const worker = createWorker(handler);
  const base = `http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan`;
  const call = (url, options = {}, e = env) => worker.fetch(new Request(url, options), e, { waitUntil() {} });
  const plan = await call(base); assert.equal(plan.status, 201); assert.equal((await call(base)).status, 200);
  assert.equal((await call(base + '/revisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await call(base, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const headers = { Authorization: `Bearer ${env.LEADER_API_KEY}`, 'Content-Type': 'application/json', Origin: 'http://localhost' };
  const preflight = await call(base + '/revisions', { method: 'OPTIONS', headers }); assert.equal(preflight.status, 204); assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal((await call(base + '/revisions', { method: 'POST', headers, body: '{bad' })).status, 400);
  assert.equal((await call(base + '/revisions', { method: 'POST', headers, body: '{}' }, { ...env, LEADER_CLAN_TAG: '2998YJPU2' })).status, 403);
  now += 1000;
  const approved = await call(base + '/revisions', { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 1, approve: true, reason: 'Approved through HTTP' }) }); assert.equal(approved.status, 200);
  assert.equal((await call(base + '/audit', { headers })).status, 200);
  const response = await call(base); assert.ok(!(await response.text()).includes(env.LEADER_API_KEY));
  assert.equal((await call('http://localhost/api/cwl/health')).status, 200);
  const rankingResponse = await call(`http://localhost/api/cwl/clans/${CLAN}/seasons/2026-10/ranking`);
  assert.equal(rankingResponse.status, 200); assert.equal(rankingResponse.headers.get('Cache-Control'), 'no-store');
  const ranking = await rankingResponse.json();
  assert.equal(ranking.policy.version, RANKING_POLICY.version); assert.equal(ranking.entries.length, 5);
  assert.equal(ranking.automaticBonusAllocation, false);
  assert.ok(!JSON.stringify(ranking).includes(env.LEADER_API_KEY));
});

test('late planning maximizes new stars and never reserves a used attacker or tripled base', () => {
  const raw = fixture({ state: 'inWar' }); hit(raw, { stars: 1 });
  const p = planWar({ raw, clanTag: CLAN, history: historyFor(raw) });
  assert.equal(p.assignments.length, 4);
  assert.ok(p.assignments.every(m => m.attackerTag !== raw.clan.members[0].tag.slice(1)));
  const candidate = p.matchups[1][0];
  const gain = candidate.probabilities.reduce((s, q, stars) => s + Math.max(0, stars - 1) * q, 0);
  assert.ok(Math.abs(candidate.expectedGain - gain) < 1e-12);
  assert.ok(candidate.goalStars > candidate.targetStarsBeforePlan);
});
test('completed attacks preserve known durations when a later source omits them', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p, 0, 3, { duration: 135 }); await service.sync(CLAN, start);
  provider.raw.clan.members.find(p => p.attacks.length).attacks[0].duration = null;
  const after = await service.sync(CLAN, start); assert.equal(after.outcomes[0].durationSeconds, 135);
});
test('contradictory source results roll back and do not silently rewrite recorded outcomes', async () => {
  await ensured(); const p = await approve(1); now += 1000; await service.sync(CLAN, start);
  now = Date.parse('2026-10-24T10:10:00Z'); provider.raw.state = 'inWar'; assignHit(p); await service.sync(CLAN, start);
  provider.raw.clan.members.find(p => p.attacks.length).attacks[0].stars = 2;
  await assert.rejects(service.sync(CLAN, start), e => e.status === 422);
  assert.equal((await service.read(CLAN, start)).outcomes[0].stars, 3);
});
test('two concurrent leader editors cannot overwrite each other', async () => {
  await ensured(); now += 1000;
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => withDatabase(env, db => new CwlService(db, provider, () => now).revise(CLAN, start, { expectedRevision: 1, approve: true, reason: 'Concurrent editor' }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('upstream provider handles optional private logs and validates history responses', async () => {
  const seen = [];
  const fake = new ClashCwlProvider(async (url, options) => { seen.push({ url, options }); if (url.includes('clashapi')) return Response.json({}, { status: 403 }); return Response.json({ items: [fixture()] }); });
  assert.equal((await fake.war(CLAN, start)).startTime, start);
  assert.ok(seen.every(s => !s.options.headers.Authorization && s.options.redirect === 'manual'));
  const broken = new ClashCwlProvider(async () => Response.json({ bad: true }));
  await assert.rejects(broken.history(CLAN, 'cwl'), e => e.status === 502);
});
test('failed initial data retrieval creates no partial plan', async () => {
  provider.fail = true;
  await assert.rejects(ensured());
  const [{ n }] = await sql`select count(*)::int as n from cwl.plans`; assert.equal(n, 0);
});
test('HTTP input size limits and unconfigured authentication fail closed', async () => {
  const worker = createWorker(createCwlHandler({ provider, clock: () => now }));
  const path = `http://localhost/api/cwl/clans/${CLAN}/wars/${start}/plan/revisions`;
  const req = body => new Request(path, { method: 'POST', headers: { Authorization: `Bearer ${env.LEADER_API_KEY}`, 'Content-Type': 'application/json' }, body });
  const ctx = { waitUntil() {} };
  assert.equal((await worker.fetch(req('{}'), { DATABASE_URL: env.DATABASE_URL }, ctx)).status, 503);
  assert.equal((await worker.fetch(req(JSON.stringify({ note: 'a'.repeat(66000) })), env, ctx)).status, 413);
  assert.equal((await worker.fetch(new Request('http://localhost/api/cwl/clans/INVALID/wars/bad/plan'), env, ctx)).status, 400);
});
