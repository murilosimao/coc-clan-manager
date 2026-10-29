import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WarScores as S,ClashKing as C } from '../../src/cwl/scoring.js';
import { loadData,weekFeatures,clean,hash,warKey } from './data.mjs';
import { signals,applyRanked,attackUpdate } from './model.mjs';
const out=path.resolve(process.argv[2]||'../output/atq-ranked-2026-10-28'),data=loadData(out),summary=JSON.parse(fs.readFileSync(out+'/summary.json')),manifest=JSON.parse(fs.readFileSync(out+'/models-manifest.json'));
const config=summary.bestCombined;
const predictions=new Map(JSON.parse(fs.readFileSync(out+'/predictions.json')).filter(r=>r.variant==='both').map(r=>[r.id,r]));
function signalMap(war,cutoff){const w=weekFeatures(data,cutoff,{promotion:config.promotion});if(!w.rows)return new Map();return new Map(w.rows.filter(r=>r.previousLeague!==36&&r.currentLeague!==36).map(r=>[r.tag+':'+r.th,signals(r,w.cohort,w.attacks,{kS:config.k,kQ:config.k,promotion:config.promotion})]));}
let checked=0,defenses=0;
for(const entry of manifest.targets){const {model,war}=JSON.parse(fs.readFileSync(entry.file)),before=hash(model),updated=applyRanked(model,signalMap(war,C.timestamp(war.startTime)),config);
  assert.equal(hash(model),before);assert.deepEqual(updated.scales,model.scales);assert.deepEqual(updated.thresholds,model.thresholds);assert.deepEqual(updated.coefficients,model.coefficients);assert.deepEqual(updated.context,model.context);
  for(let i=0;i<model.players.length;i++){const old=model.players[i],p=updated.players[i];for(const k of ['defenseEffect','defenseScore','defenseCount','defenseWeight','attackCount','attackWeight'])assert.equal(p[k],old[k]);assert(p.attackScore+1e-9>=old.attackScore);if(!p.rankedEvidence.mu)assert.equal(p.attackScore,old.attackScore);defenses++;}
  for(const hit of war.attacks.filter(h=>h.side===war.result.ourSide)){const prediction=predictions.get(entry.key+'|'+hit.order);if(prediction)assert(Math.abs(S.rating(updated,hit.attacker).attackScore-prediction.score)<1e-7,'Full candidate and accelerated simulator differ');}checked++;
}
const current=[];
for(const clan of ['2G8QCR92V','2CQ9CR2YP']){const f=out+'/sources/currentwar-'+clan+'.json';if(!fs.existsSync(f))continue;const snapshot=JSON.parse(fs.readFileSync(f)),raw=snapshot.data;if(!['preparation','inWar'].includes(raw.state))continue;
  const war=C.normalizeWar(raw,clan),cutoff=Math.min(Date.parse(snapshot.fetchedAt),C.timestamp(war.startTime)),selected=new Map();for(const side of [raw.clan,raw.opponent])for(const w of data.byClan.get(clean(side.tag))||[])selected.set(warKey(w),w);for(const p of [...war.roster,...war.opponentRoster])for(const w of data.byPlayer.get(clean(p.tag))||[])selected.set(warKey(w),w);
  const earliest=new Date(cutoff);earliest.setUTCDate(1);earliest.setUTCMonth(earliest.getUTCMonth()-2);const history=[...selected.values()].filter(w=>C.timestamp(w.endTime)<=cutoff&&C.timestamp(w.endTime)>((w.type||'random')==='cwl'?earliest.getTime():cutoff-14*86400000));
  const base=S.fit({war:{...war,startTime:new Date(cutoff).toISOString()},history}),map=signalMap(war,cutoff),updated=applyRanked(base,map,config),g5=applyRanked(base,map,{...config,gate:5}),g10=applyRanked(base,map,{...config,gate:10});
  for(const p of war.roster){const a=S.rating(base,p),b=S.rating(updated,p);current.push({clan,position:p.position,name:p.name,tag:p.tag,th:p.th,attackCount:a.attackCount,baseATQ:a.attackScore,newATQ:b.attackScore,delta:b.attackScore-a.attackScore,focused5:S.rating(g5,p).attackScore,focused10:S.rating(g10,p).attackScore,DEF:a.defenseScore,newDEF:b.defenseScore,mu:b.rankedEvidence.mu,league:b.rankedEvidence.league,quality:b.rankedEvidence.quality,qN:b.rankedEvidence.nQ});}
}
const nColumns=['clan','position','name','tag','th','attackCount','baseATQ','newATQ','focused5','focused10','delta','DEF','newDEF','mu','league','quality','qN'];
fs.writeFileSync(out+'/current-scores.tsv',[nColumns.join('\t'),...current.map(r=>nColumns.map(k=>String(r[k]??'').replace(/[\t\n\r]/g,' ')).join('\t'))].join('\n'));fs.writeFileSync(out+'/current-scores.json',JSON.stringify({config,rows:current},null,2));
const synthetic=[0,2,5,20,50].map(n=>{const rows=Array.from({length:n},()=>({stars:2,weight:1,offset:0})),effect=attackUpdate(0,.5,rows,[-2,-1,1]);return {historicalAttacks:n,prior:.5,effect,ATQ:Math.min(100,50+15*effect/.35)};});
const artifact={checkedWars:checked,checkedPlayerDEFs:defenses,allDEFsExactlyEqual:true,scalesThresholdsCoefficientsUnchanged:true,zeroSignalExactlyPreserved:true,runtimeSourceUnchanged:hash(fs.readFileSync('public/portal/war-scores.js','utf8'))===manifest.baselineSourceHash,synthetic,syntheticInterpretation:'Directed formula demonstration, not a prediction of any real player.'};
fs.writeFileSync(out+'/invariants.json',JSON.stringify(artifact,null,2));console.log(JSON.stringify({...artifact,currentPlayers:current.length,topChanges:current.sort((a,b)=>b.delta-a.delta).slice(0,8)},null,2));
