import test from 'node:test';
import assert from 'node:assert/strict';
import { normalQuantile,sustained,signals,negativeGradient,attackUpdate,applyRanked } from './model.mjs';
import { WarScores as S } from '../../src/cwl/scoring.js';
import { leagueOrdinalMap,profileLeagueAfterWeek,WEEK } from './data.mjs';
test('unranked is not a competitive tier and an unsigned current week still has a league',()=>{
  const ranks=leagueOrdinalMap([{id:0,name:'Unranked'},{id:1,name:'A'},{id:2,name:'B'}]);assert.equal(ranks.get(0),undefined);assert.equal(ranks.get(1),1);assert.equal(ranks.get(2),2);
  assert.equal(profileLeagueAfterWeek({leagueTier:{id:2},currentLeagueSeasonId:0},100,99,ranks),2);
  assert.equal(profileLeagueAfterWeek({leagueTier:{id:2}},100,100+WEEK,ranks),null);
});
test('midranks and promotion use the approved ordinal definition',()=>{
  assert(Math.abs(normalQuantile(.5))<1e-8);assert(Math.abs(normalQuantile(.975)-1.959963984)<1e-7);
  assert.equal(sustained(34,35),34.5);assert.equal(sustained(34,36),34.5);assert.equal(sustained(35,34),34);assert.equal(sustained(34,34),34);
});
const row={tag:'P',th:18,n:8,maxBattles:24,previousLeague:34,currentLeague:34,weekStart:1,weekEnd:2,cutoff:3,thStatus:'bounded'};
const cohort=Array.from({length:5},(_,i)=>({th:18,position:30+i}));
test('no participation or a future week cannot produce ranked evidence',()=>{
  assert.equal(signals({...row,n:0},cohort,[]).league,0);assert.equal(signals({...row,cutoff:1},cohort,[]).league,0);
  assert.equal(signals({...row,thStatus:'changed'},cohort,[]).league,0);
});
test('Q excludes self, different CV pairs, modifiers, and weeks',()=>{
  const attack=(playerTag,stars,extra={})=>({playerTag,stars,weekStart:1,league:34,context:'same',attackerTH:18,defenderTH:18,thStatus:'bounded',...extra});
  const own=Array.from({length:8},()=>attack('P',3));
  assert.equal(signals(row,cohort,own).nQ,0);
  const others=[...Array.from({length:10},()=>attack('A',2)),...Array.from({length:10},()=>attack('B',2))];
  const s=signals(row,cohort,[...own,...others]);assert.equal(s.nQ,8);assert(Math.abs(s.quality-8/14)<1e-12);
  const qOnly=signals({...row,currentLeague:null},cohort,[...own,...others]);assert.equal(qOnly.league,0);assert.equal(qOnly.nQ,8);
  for(const extra of [{attackerTH:17,defenderTH:17},{context:'other'},{weekStart:0}])assert.equal(signals(row,cohort,[...own,...others.map(a=>({...a,...extra}))]).nQ,0);
});
test('more identical attacks raises confidence without reversing observed quality',()=>{
  const a=signals(row,cohort,[]),b=signals({...row,n:24},cohort,[]);assert(b.league>a.league);
});
test('eight triples retain better observed quality than eight triples plus sixteen two-stars',()=>{
  const a=(playerTag,stars)=>({playerTag,stars,weekStart:1,league:34,context:'same',attackerTH:18,defenderTH:18});
  const refs=['A','B'].flatMap(t=>[...Array.from({length:3},()=>a(t,3)),...Array.from({length:7},()=>a(t,2))]);
  const small=signals(row,cohort,[...refs,...Array.from({length:8},()=>a('P',3))]);
  const large=signals({...row,n:24},cohort,[...refs,...Array.from({length:8},()=>a('P',3)),...Array.from({length:16},()=>a('P',2))]);
  assert(Math.abs(small.quality-.4)<1e-12);assert(Math.abs(large.quality-0.0266666666666667)<1e-12);assert(small.quality>large.quality);
});
test('zero evidence preserves exactly; no war history reaches prior; war evidence restrains it',()=>{
  const thresholds=[-2,-1,1],rows=Array.from({length:40},()=>({stars:2,weight:1,offset:0}));
  assert.equal(attackUpdate(.4,0,rows,thresholds),.4);assert(Math.abs(attackUpdate(0,.8,[],thresholds)-.8)<1e-12);
  assert(attackUpdate(0,.8,rows,thresholds)<.8);
});
test('a tiny prior cannot take credit for convergence of the old finite optimizer',()=>{
  const rows=Array.from({length:10},()=>({stars:3,weight:1,offset:0})),thresholds=[-2,-1,1];
  assert(attackUpdate(-2,1e-6,rows,thresholds)-(-2)<1e-5);
  assert(attackUpdate(-2,1e-6,rows,thresholds,1,'literal')-(-2)>1);
});
test('conditional gradient matches finite differences of the actual ordinal likelihood',()=>{
  const thresholds=[-2,-.3,1];for(const stars of [0,1,2,3])for(const a of [-2,0,2]){
    const rows=[{stars,weight:.7,offset:.4}],loss=x=>-.7*Math.log(S.likelihood({thresholds},x+.4,stars))+(x-.6)**2/2;
    const numerical=(loss(a+1e-5)-loss(a-1e-5))/2e-5;
    assert(Math.abs(numerical-negativeGradient(a,rows,thresholds,1,.6))<1e-7);
  }
});
test('conditional update freezes every DEF, scale, threshold, feature and evidence count',()=>{
  const player=(tag,th)=>({tag,th,position:1,name:tag});const a=player('P',18),d=player('Q',18);
  const war={startTime:'2026-10-28T00:00:00Z',battleModifier:'none',warType:'random',roster:[a],opponentRoster:[d],result:{clans:{a:{tag:'AAA'},b:{tag:'BBB'}}}};
  const base=S.fit({war,history:[]}),copy=structuredClone(base),result=applyRanked(base,new Map([['P:18',{league:1,quality:0,nQ:0}]]),{bS:.5,bQ:0});
  assert.deepEqual(base,copy);assert.deepEqual(result.scales,base.scales);assert.deepEqual(result.thresholds,base.thresholds);assert.deepEqual(result.coefficients,base.coefficients);
  for(let i=0;i<base.players.length;i++){assert.equal(result.players[i].defenseEffect,base.players[i].defenseEffect);assert.equal(result.players[i].defenseScore,base.players[i].defenseScore);assert.equal(result.players[i].attackCount,base.players[i].attackCount);}
  assert(result.players.find(p=>p.tag==='P').attackScore>50);assert.equal(result.players.find(p=>p.tag==='Q').attackScore,50);
  const focused=applyRanked(base,new Map([['P:18',{league:1,quality:0,nQ:0}]]),{bS:.5,bQ:0,gate:5});assert.equal(focused.players[0].attackScore,result.players[0].attackScore,'No war history retains the full prior');
});
