// Parameters are locked before fetching the new groups; this script never selects parameters.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ClashKing as C } from '../src/cwl/scoring.js';
const root=path.resolve('../output/cwl-improvement-2026-10-25'),out=root+'/holdout';fs.mkdirSync(out+'/sources',{recursive:true});
const selected=JSON.parse(fs.readFileSync(root+'/comparison.json'));
const tags=['2GCU80QQU','2J8Y2JQJ0','2JGRJJQ9G'];
const lock={tags,edition:'2026-10',selected:selected.selected,calibrator:{slope:selected.calibrator.slope,intercept:selected.calibrator.intercept},selection:'September first four rounds; validation September remaining rounds',createdAt:new Date().toISOString()};
const lockFile=out+'/protocol.json';if(fs.existsSync(lockFile)){const old=JSON.parse(fs.readFileSync(lockFile));assert.deepEqual({...old,createdAt:''},{...lock,createdAt:''},'Holdout protocol is immutable.');}else fs.writeFileSync(lockFile,JSON.stringify(lock,null,2));
async function get(tag,type){const f=`${out}/sources/${tag}-${type}.json`;if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));const url=`https://api.clashk.ing/v2/clan/%23${tag}/wars?limit=${type==='cwl'?35:60}&type=${type}`;let value;for(let i=0;i<2;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});value={tag,type,url,fetchedAt:new Date().toISOString(),status:r.status,ok:r.ok,data:await r.json()};if(r.ok)break;}catch(e){value={tag,type,url,ok:false,error:e.message};}}fs.writeFileSync(f,JSON.stringify(value));return value;}
const seeds=await Promise.all(tags.map(t=>get(t,'cwl'))),targets=seeds.flatMap(s=>(s.data?.items||[]).filter(w=>w.preparationStartTime?.startsWith('202610')).map(w=>({raw:{...w,type:'cwl'},tag:s.tag})));
const clanTags=[...new Set(targets.flatMap(t=>[t.raw.clan.tag,t.raw.opponent.tag].map(x=>x.slice(1))))];
const jobs=clanTags.flatMap(t=>['random','cwl'].map(type=>[t,type]));let index=0;await Promise.all(Array.from({length:3},async()=>{while(index<jobs.length){const [t,type]=jobs[index++];await get(t,type);}}));
const key=w=>[w.clan.tag,w.opponent.tag].sort().join('|').replaceAll('#','')+'|'+w.startTime;
const baseSummary=JSON.parse(fs.readFileSync('../output/cwl-baseline-2026-10-25/summary.json'));
const oldKeys=new Set(JSON.parse(fs.readFileSync('../output/cwl-baseline-2026-10-25/prior-evaluation-keys.json')));
const baseRounds=JSON.parse(fs.readFileSync('../output/cwl-baseline-2026-10-25/rounds.json'));for(const r of baseRounds)oldKeys.add(r.warKey);
assert(targets.every(t=>!oldKeys.has(key(t.raw))),'Holdout wars must be unseen in baseline or prior evaluation.');
const groupTags=tags.map(t=>new Set(targets.filter(x=>x.tag===t).flatMap(x=>[x.raw.clan.tag,x.raw.opponent.tag])));
for(let i=0;i<groupTags.length;i++)for(let j=i+1;j<groupTags.length;j++)assert(![...groupTags[i]].some(t=>groupTags[j].has(t)));
const source=fs.readFileSync('public/portal/war-scores.js','utf8'),candidateSource=source.replace(/playerPenalty: [0-9.]+/,'playerPenalty: '+Number(lock.selected.match(/p(\d+)$/)[1]));
const baselineSource=execFileSync('git',['show','snapshot/cwl-baseline-2026-10-25:public/portal/war-scores.js'],{encoding:'utf8'});
function engine(src){const scope={};vm.createContext(scope);vm.runInContext(src,scope);return scope.WarScores;}
const B=engine(baselineSource),S=engine(candidateSource),manifest=JSON.parse(fs.readFileSync(root+'/history-pool-manifest.json'));
const files=[...manifest.sources.map(s=>s.file),...fs.readdirSync(out+'/sources').map(f=>out+'/sources/'+f)],pool=new Map();
for(const f of files){const e=JSON.parse(fs.readFileSync(f));if(!e.ok)continue;for(const raw of e.data?.items||[]){if(!raw.clan?.members||!raw.opponent?.members||raw.state!=='warEnded')continue;const w={...raw,type:raw.type||e.type};const count=[w.clan,w.opponent].reduce((s,c)=>s+c.members.reduce((s,p)=>s+(p.attacks?.length||0),0),0);if(!pool.has(key(w))||pool.get(key(w)).count<count)pool.set(key(w),{w,count});}}
const playerIndex=new Map();for(const {w} of pool.values())for(const p of [...w.clan.members,...w.opponent.members]){const tag=p.tag.slice(1);if(!playerIndex.has(tag))playerIndex.set(tag,new Set());playerIndex.get(tag).add(w);}
const sum=xs=>xs.reduce((s,x)=>s+x,0),mean=xs=>xs.length?sum(xs)/xs.length:null,sigmoid=x=>1/(1+Math.exp(-x));
function calibrated(p){const tails=[1,2,3].map(g=>{const q=Math.min(1-1e-8,Math.max(1e-8,sum(p.slice(g))));return sigmoid(lock.calibrator.slope*Math.log(q/(1-q))+lock.calibrator.intercept);});return [1-tails[0],tails[0]-tails[1],tails[1]-tails[2],tails[2]];}
const rows=[];let done=0;
for(const t of targets){const war=C.normalizeWar(t.raw,t.tag),cutoff=C.timestamp(war.startTime),history=[t.raw.clan.tag,t.raw.opponent.tag].flatMap(tag=>['random','cwl'].flatMap(type=>{const e=JSON.parse(fs.readFileSync(`${out}/sources/${tag.slice(1)}-${type}.json`));return (e.data?.items||[]).map(w=>({...w,type:w.type||type}));}));
 const extra=new Set();for(const p of [...war.roster,...war.opponentRoster])for(const w of playerIndex.get(p.tag)||[])if(C.timestamp(w.endTime)<=cutoff&&(w.type==='cwl'||C.timestamp(w.endTime)>=cutoff-14*86400000))extra.add(w);
 const b=B.fit({war,history}),m=S.fit({war,history:[...history,...extra]});assert(m.events.every(e=>C.timestamp(e.endTime)<=cutoff&&e.warKey!==key(t.raw)));
 for(const h of war.attacks.filter(h=>h.side===war.result.ourSide)){const ba=B.assess(b,war,h),ca=S.assess(m,war,h);if(ba.alreadyTripled)continue;const probs=(model,a)=>{const q=model.thresholds.map(c=>sigmoid(a.eta-c));return [1-q[0],q[0]-q[1],q[1]-q[2],q[2]];};const bp=probs(b,ba),cp=probs(m,ca);rows.push({war:key(t.raw),clan:t.tag,attacker:h.attacker.tag,defender:h.defender.tag,stars:h.stars,baseline:bp,candidate:cp,calibrated:calibrated(cp),baseEvidence:ba.category!=='unknown',candidateEvidence:ca.category!=='unknown'});}
 console.log(JSON.stringify({done:++done,total:targets.length}));
}
function rps(r,field){let cdf=0,x=0;for(let k=0;k<3;k++){cdf+=r[field][k];x+=(cdf-Number(r.stars<=k))**2/3;}return x;}
function metrics(xs,field){return {n:xs.length,rps:mean(xs.map(r=>rps(r,field))),observedPT:mean(xs.map(r=>Number(r.stars===3))),estimatedPT:mean(xs.map(r=>r[field][3])),brier3:mean(xs.map(r=>(r[field][3]-Number(r.stars===3))**2))};}
function boot(field,group){const groups=[...Map.groupBy(rows,r=>r[group]).values()].map(xs=>({n:xs.length,delta:sum(xs.map(r=>rps(r,field)-rps(r,'baseline')))}));let state=20261025;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};const draws=Array.from({length:2000},()=>{let n=0,x=0;for(let j=0;j<groups.length;j++){const g=groups[Math.floor(random()*groups.length)];n+=g.n;x+=g.delta;}return x/n;}).sort((a,b)=>a-b);return {clusters:groups.length,ci95:[draws[50],draws[1949]]};}
const summary={...lock,sourceHash:crypto.createHash('sha256').update(candidateSource).digest('hex'),wars:targets.length,baseline:metrics(rows,'baseline'),candidate:metrics(rows,'candidate'),calibrated:metrics(rows,'calibrated'),
 evidence:{before:rows.filter(r=>r.baseEvidence).length,after:rows.filter(r=>r.candidateEvidence).length},
 candidateIntervals:{war:boot('candidate','war'),clan:boot('candidate','clan')},calibratedIntervals:{war:boot('calibrated','war'),clan:boot('calibrated','clan')},
 byClan:tags.map(clan=>({clan,baseline:metrics(rows.filter(r=>r.clan===clan),'baseline'),candidate:metrics(rows.filter(r=>r.clan===clan),'candidate'),calibrated:metrics(rows.filter(r=>r.clan===clan),'calibrated')}))};
fs.writeFileSync(out+'/predictions.json',JSON.stringify(rows));fs.writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
