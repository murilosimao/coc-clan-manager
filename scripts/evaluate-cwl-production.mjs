// Replay the actual public-data provider, not an offline-only enlarged corpus.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ClashCwlProvider, PLAYER_HISTORY_VERSION } from '../src/cwl/provider.js';
import { ClashKing as C, WarScores as S } from '../src/cwl/scoring.js';
const root='/private/tmp/clash/output/cwl-improvement-2026-10-25',base='/private/tmp/clash/output/cwl-baseline-2026-10-25';
for(const dir of ['player-requests','production-history'])fs.mkdirSync(root+'/'+dir,{recursive:true});
const tags=['2G8QCR92V','2GCU80QQU','2J8Y2JQJ0','2JGRJJQ9G'];
const h=x=>crypto.createHash('sha256').update(x).digest('hex');
const fetcher=async(url,options)=>{
  const u=new URL(url),m=decodeURIComponent(u.pathname).match(/^\/v2\/clan\/#([^/]+)\/wars$/);
  if(m){for(const dir of [base+'/sources',root+'/holdout/sources']){const f=dir+'/'+m[1]+'-'+u.searchParams.get('type')+'.json';if(fs.existsSync(f)){const e=JSON.parse(fs.readFileSync(f));return Response.json(e.data,{status:e.status||200});}}}
  const file=root+'/player-requests/'+h(url)+'.json';let e;
  if(fs.existsSync(file))e=JSON.parse(fs.readFileSync(file));else{const r=await fetch(url,options);e={url,status:r.status,fetchedAt:new Date().toISOString(),data:await r.json()};fs.writeFileSync(file,JSON.stringify(e));}
  return Response.json(e.data,{status:e.status});
};
function source(tag,type){for(const dir of [base+'/sources',root+'/holdout/sources']){const f=dir+'/'+tag+'-'+type+'.json';if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));}throw Error('Missing base history: '+tag+':'+type);}
const snapshot={};vm.createContext(snapshot);vm.runInContext(execFileSync('git',['show','snapshot/cwl-baseline-2026-10-25:public/portal/war-scores.js'],{encoding:'utf8'}),snapshot);const B=snapshot.WarScores;
const targets=tags.flatMap(tag=>source(tag,'cwl').data.items.filter(w=>w.preparationStartTime.startsWith('202610')).sort((a,b)=>C.timestamp(a.startTime)-C.timestamp(b.startTime)).map(w=>({tag,raw:{...w,type:'cwl'}})));
const rows=[],rounds=[];const sigmoid=x=>1/(1+Math.exp(-x)),sum=xs=>xs.reduce((s,x)=>s+x,0),mean=xs=>xs.length?sum(xs)/xs.length:null;
for(const target of targets){const {tag,raw}=target,war=C.normalizeWar(raw,tag),cutoff=C.timestamp(war.startTime);
  const history=[raw.clan.tag,raw.opponent.tag].flatMap(t=>['random','cwl'].flatMap(type=>(source(t.slice(1),type).data.items||[]).map(w=>({...w,type:w.type||type}))));
  const file=`${root}/production-history/${tag}-${raw.startTime}.json`;let training;
  if(fs.existsSync(file))training=JSON.parse(fs.readFileSync(file));
  if(training?.historyPolicy?.version!==PLAYER_HISTORY_VERSION){training=await new ClashCwlProvider(fetcher).training(raw);fs.writeFileSync(file,JSON.stringify(training));}
  const bm=B.fit({war,history}),cm=S.fit({war,history:training.history});assert(cm.events.every(e=>C.timestamp(e.endTime)<=cutoff));
  const probs=(m,a)=>{const q=m.thresholds.map(c=>sigmoid(a.eta-c));return [1-q[0],q[0]-q[1],q[1]-q[2],q[2]];};
  for(const hit of war.attacks.filter(a=>a.side===war.result.ourSide)){const b=B.assess(bm,war,hit),c=S.assess(cm,war,hit);if(b.alreadyTripled)continue;
    const inRange=Math.abs(hit.attacker.th-hit.defender.th)<=3;
    rows.push({clan:tag,war:raw.startTime+'|'+tag,attacker:hit.attacker.tag,defender:hit.defender.tag,stars:hit.stars,baseline:probs(bm,b),candidate:probs(cm,c),
      baselineEvidence:inRange&&b.category!=='unknown',candidateEvidence:inRange&&c.category!=='unknown',category:c.category,phase:c.phase,atkCount:c.attacker.attackCount,defCount:c.defender.defenseCount});
  }
  rounds.push({clan:tag,start:raw.startTime,baseEvents:bm.events.length,candidateEvents:cm.events.length,warnings:training.warnings,
    playerLookups:training.sources.filter(s=>s.type==='player_war_references').length,recoveredWars:training.sources.filter(s=>s.type==='player_complete_war'&&s.available).length});
  console.log(JSON.stringify({done:rounds.length,total:targets.length,...rounds.at(-1)}));
}
function rps(r,field){let cdf=0,x=0;for(let k=0;k<3;k++){cdf+=r[field][k];x+=(cdf-Number(r.stars<=k))**2/3;}return x;}
function metrics(xs,field){return {n:xs.length,rps:mean(xs.map(r=>rps(r,field))),observedPT:mean(xs.map(r=>Number(r.stars===3))),estimatedPT:mean(xs.map(r=>r[field][3])),brier3:mean(xs.map(r=>(r[field][3]-Number(r.stars===3))**2)),coverage:mean(xs.map(r=>Number(r[field+'Evidence'])))};}
function boot(xs,unit){const groups=[...Map.groupBy(xs,r=>r[unit]).values()].map(xs=>({n:xs.length,d:sum(xs.map(r=>rps(r,'candidate')-rps(r,'baseline')))}));let seed=20261025;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const draws=Array.from({length:2000},()=>{let n=0,d=0;for(let i=0;i<groups.length;i++){const g=groups[Math.floor(rng()*groups.length)];n+=g.n;d+=g.d;}return d/n;}).sort((a,b)=>a-b);return {clusters:groups.length,ci95:[draws[50],draws[1949]]};}
const cohort=xs=>({baseline:metrics(xs,'baseline'),candidate:metrics(xs,'candidate'),intervalWar:boot(xs,'war'),intervalClan:boot(xs,'clan')});
const summary={createdAt:new Date().toISOString(),baseline:'108430d',candidateVersion:S.VERSION,config:S.CONFIG,rounds:rounds.length,all:cohort(rows),newGroups:cohort(rows.filter(r=>r.clan!=='2G8QCR92V')),puroSangue:cohort(rows.filter(r=>r.clan==='2G8QCR92V')),
  byClan:tags.map(t=>({tag:t,...cohort(rows.filter(r=>r.clan===t))})),
  categories:[...Map.groupBy(rows,r=>r.category)].map(([category,xs])=>({category,n:xs.length,triples:xs.filter(r=>r.stars===3).length,rate:mean(xs.map(r=>Number(r.stars===3)))})),
  queryWarnings:rounds.flatMap(r=>r.warnings),sourceHash:h(fs.readFileSync('public/portal/war-scores.js'))};
fs.writeFileSync(root+'/production-predictions.json',JSON.stringify(rows));fs.writeFileSync(root+'/production-rounds.json',JSON.stringify(rounds,null,2));fs.writeFileSync(root+'/production-comparison.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
