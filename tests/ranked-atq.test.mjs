import test from 'node:test';
import assert from 'node:assert/strict';
import { WarScores as S, RankedScores as R } from '../src/cwl/scoring.js';
import { planWar } from '../src/cwl/planner.js';
import { validateBrowserPlan } from '../src/cwl/browser-plan.js';
import { signRanked, verifyRanked } from '../src/ranked-proof.js';
import { rankedApi } from '../src/ranked-api.js';
import { officialJson } from '../src/official-api.js';
import { applyRanked as candidate } from '../experiments/ranked-atq/model.mjs';
import { fixture, historyFor, CLAN } from './cwl-fixtures.mjs';
const SECRET='disposable-ranked-source-test-key-123456789';
import { rankedFixture } from './ranked-fixtures.mjs';

test('production overlay exactly matches the approved focused5 simulation, with frozen DEF and counts',()=>{
  const {raw,history,ranked}=rankedFixture(), base=planWar({raw,clanTag:CLAN,history}).model;
  const signals=R.inputs(ranked,base.context.cutoff,history).byPlayer;
  const actual=R.apply(base,ranked,history), expected=candidate(base,signals,R.CONFIG);
  assert.equal(actual.version,R.VERSION);
  assert(actual.players.some(p=>p.attackScore>p.baseAttackScore));
  for(const p of actual.players){
    const b=base.players.find(q=>q.key===p.key), e=expected.players.find(q=>q.key===p.key);
    assert.equal(p.attackEffect,e.attackEffect);assert.equal(p.attackScore,e.attackScore);
    for(const k of ['defenseEffect','defenseScore','attackCount','attackWeight','attackEffectiveN','defenseCount','defenseWeight'])assert.equal(p[k],b[k]);
  }
  for(const k of ['scales','coefficients','thresholds'])assert.deepEqual(actual[k],base[k]);
  const facts=events=>events.map(({eta,likelihood,...e})=>e);
  assert.deepEqual(facts(actual.events),facts(base.events));
  for(const e of actual.events){assert.equal(e.eta,S.etaFor(actual,e));assert.equal(e.likelihood,S.likelihood(actual,e.eta,e.stars));}
  assert.equal(R.apply(base,null),base);
});

test('calendar week, missing cohort, changed CV, current week and unsupported Legend I stay neutral',()=>{
  const {ranked,now}=rankedFixture(), end=R.weekOf(now), inputs=R.inputs(ranked,now,[]);
  assert.equal(inputs.weekEnd,end);assert.equal(inputs.weekStart,end-R.WEEK);
  const records=ranked.packets.filter(p=>p.kind==='players').flatMap(p=>p.items);
  records[0].history[0].n=0;
  assert.equal(R.inputs(ranked,now).byPlayer.get(records[0].tag+':18').mu,undefined);
  assert.equal(R.inputs(ranked,now).byPlayer.get(records[0].tag+':18').league,0);
  records[0].history[0].n=24;records[0].history[0].league=36;
  assert.equal(R.inputs(ranked,now).byPlayer.get(records[0].tag+':18').eligible,false);
  ranked.packets.pop();assert.equal(R.inputs(ranked,now).complete,true); // optional opponent, family remains complete
  ranked.packets.splice(1,1);assert.equal(R.inputs(ranked,now).complete,false);
});

test('known CV upgrades and open-week results cannot influence the closed-week evidence',()=>{
  const {ranked,now}=rankedFixture(), row=ranked.packets[1].items[0], before=R.inputs(ranked,now);
  row.group.attacks.push({defenderTag:row.group.attacks[0].defenderTag,stars:0,time:before.weekEnd+1000});
  assert.deepEqual(R.inputs(ranked,now).byPlayer,before.byPlayer);
  const war={endTime:before.weekStart+3600000,clan:{members:[{tag:'#'+row.tag,townhallLevel:17}]},opponent:{members:[]}};
  const signal=R.inputs(ranked,now,[war]).byPlayer.get(row.tag+':18');
  assert.equal(signal.eligible,false);assert.equal(signal.league,0);assert.equal(signal.quality,0);
});

test('missing target levels cannot selectively inflate Q; complete CV pairs exclude self and other tiers',()=>{
  const {ranked,now}=rankedFixture(), before=R.inputs(ranked,now);
  assert([...before.byPlayer.values()].some(p=>p.nQ>0));
  ranked.packets[1].items[0].group.attacks.push({defenderTag:'L888999',stars:3,time:before.weekStart+1000});
  const after=R.inputs(ranked,now);
  assert([...after.byPlayer.values()].every(p=>p.nQ===0&&p.quality===0));
  assert([...after.byPlayer.values()].some(p=>p.league>0));
});

test('CWL validates the frozen baseline and deterministic bonus; tampered arithmetic is rejected',()=>{
  const {raw,history,ranked,now}=rankedFixture(), result=planWar({raw,clanTag:CLAN,history,ranked});
  const payload={raw,training:{history,ranked,warnings:[]},model:result.model,config:result.config,plannerVersion:result.version,computeMs:100,computedAt:new Date(now).toISOString()};
  assert.deepEqual(validateBrowserPlan(payload,CLAN,raw.startTime,now).assignments,result.assignments);
  const p=payload.model.players[0];p.rankedEvidence.mu+=1;
  assert.throws(()=>validateBrowserPlan(payload,CLAN,raw.startTime,now),/bônus de ranqueada/);
});

test('signed official facts reject forged, expired, future and duplicate sources',async()=>{
  const {ranked,now}=rankedFixture();ranked.packets=await Promise.all(ranked.packets.map(p=>signRanked(p,SECRET)));
  assert(await verifyRanked(ranked,SECRET,now));
  assert.equal(await verifyRanked(ranked,SECRET,now+7*3600000),false);
  assert.equal(await verifyRanked(ranked,SECRET,now-60000),false);
  const changed=structuredClone(ranked);changed.packets[1].items[0].league=36;
  assert.equal(await verifyRanked(changed,SECRET,now),false);
  const duplicate=structuredClone(ranked);duplicate.packets.push(duplicate.packets[1]);
  assert.equal(await verifyRanked(duplicate,SECRET,now),false);
});

test('official allowlist blocks arbitrary destinations, extra queries and credentials',async()=>{
  const env={COC_API_MODE:'royaleapi',COC_WORKER_API_KEY:'disposable-official-key-for-tests-123456789'};
  for(const path of ['https://evil.test/v1/players/%239LLJR22U','/v1/players/%239LLJR22U?url=https://evil.test','/v1/leaguegroup/%238VRQ0J9/1792386000','/v1/clans/%232G8QCR92V/warlog?limit=100']){
    await assert.rejects(()=>officialJson(path,env,()=>{throw Error('must not fetch');}),/official_400/);
  }
});

test('ranked API exposes only compact public facts, signs them, and bounds batch calls',async()=>{
  let calls=0;const now=Date.parse('2026-10-29T10:00Z'), profile={townHallLevel:18,leagueTier:{id:105000034},heroes:['discard'],name:'discard'};
  const fetcher=async url=>{calls++;assert.equal(new URL(url).origin,'https://cocproxy.royaleapi.dev');return Response.json(url.endsWith('/leaguehistory')?{items:[{leagueSeasonId:1792386000,leagueTierId:105000034,attackWins:20,attackLosses:4,maxBattles:24,attackStars:0}]}:profile);};
  const env={COC_API_MODE:'royaleapi',COC_WORKER_API_KEY:'disposable-official-key-for-tests-123456789',CWL_BACKEND_KEY:SECRET};
  const r=await rankedApi(new Request('https://app.test/api/ranked/players?tags=9LLJR22U'),env,{fetcher,cache:null,now});
  assert.equal(r.status,200);const packet=await r.json();assert.equal(packet.items[0].history[0].n,24);assert.equal(packet.items[0].heroes,undefined);assert.equal(calls,2);
  const bad=await rankedApi(new Request('https://app.test/api/ranked/players?tags=9LLJR22U,9LLJR22U'),env,{fetcher,cache:null,now});assert.equal(bad.status,400);assert.equal(calls,2);
  assert.equal((await rankedApi(new Request('https://app.test/api/ranked/players?tags=9LLJR22U'),{}, {cache:null})).status,503);
});
