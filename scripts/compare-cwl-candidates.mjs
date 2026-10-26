// Offline, chronological candidate selection against the local functional snapshot.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ClashKing } from '../src/cwl/scoring.js';
const repo = process.cwd(), baseline = path.resolve('../output/cwl-baseline-2026-10-25');
const out = path.resolve('../output/cwl-improvement-2026-10-25');
fs.mkdirSync(out, { recursive: true });
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const tag = s => String(s || '').replace(/^#/, '').toUpperCase();
const time = ClashKing.timestamp;
const season = w => w.season || new Date(time(w.preparationStartTime)).toISOString().slice(0, 7);
const key = w => [tag(w.clan.tag),tag(w.opponent.tag)].sort().join('|')+'|'+w.startTime;
const sum = xs => xs.reduce((a,b)=>a+b,0), mean = xs => xs.length ? sum(xs)/xs.length : null;
const sigmoid = x => 1/(1+Math.exp(-x));
const seedClans = JSON.parse(fs.readFileSync(baseline+'/summary.json')).clans;
const external = new Set(JSON.parse(fs.readFileSync(baseline+'/summary.json')).external.tags);
const targets=[];
for(const c of seedClans){const entry=JSON.parse(fs.readFileSync(`${baseline}/sources/${c.tag}-cwl.json`));
  for(const edition of ['2026-09','2026-10']){const wars=entry.data.items.filter(w=>season(w)===edition&&w.state==='warEnded').sort((a,b)=>time(a.startTime)-time(b.startTime));
    wars.forEach((w,i)=>targets.push({raw:{...w,type:'cwl'},clan:c.tag,edition,day:i+1,split:edition==='2026-10'?'october':i<4?'selection':'validation'}));}}
fs.mkdirSync(out+'/sources',{recursive:true});
const sourceFile=(clan,type)=>fs.existsSync(`${baseline}/sources/${clan}-${type}.json`)?`${baseline}/sources/${clan}-${type}.json`:`${out}/sources/${clan}-${type}.json`;
const required=[...new Set(targets.flatMap(t=>[tag(t.raw.clan.tag),tag(t.raw.opponent.tag)]))].flatMap(clan=>['random','cwl'].map(type=>({clan,type})));
let fetchCursor=0;
await Promise.all(Array.from({length:3},async()=>{while(fetchCursor<required.length){const {clan,type}=required[fetchCursor++],file=sourceFile(clan,type);if(fs.existsSync(file))continue;
  const url=`https://api.clashk.ing/v2/clan/%23${clan}/wars?limit=${type==='random'?60:35}&type=${type}`;let entry;
  for(let attempt=0;attempt<2;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});entry={tag:clan,type,url,ok:r.ok,status:r.status,fetchedAt:new Date().toISOString(),data:await r.json()};if(r.ok)break;}catch(error){entry={tag:clan,type,url,ok:false,error:error.message};}}
  fs.writeFileSync(file,JSON.stringify(entry));
}}));
console.log(JSON.stringify({stage:'sources',required:required.length,newFiles:fs.readdirSync(out+'/sources').length}));
const oldSource = execFileSync('git',['show','snapshot/cwl-baseline-2026-10-25:public/portal/war-scores.js'],{encoding:'utf8'});
const source = fs.readFileSync('public/portal/war-scores.js','utf8');
const variants = [{id:'snapshot',source:oldSource,expand:false},
  {id:'personal-p2',source:source.replace(/playerPenalty: [0-9.]+/,'playerPenalty: 2'),expand:true},{id:'personal-p1',source:source.replace(/playerPenalty: [0-9.]+/,'playerPenalty: 1'),expand:true},
  {id:'personal-p4',source:source.replace(/playerPenalty: [0-9.]+/,'playerPenalty: 4'),expand:true}].map(v=>{const scope={};vm.createContext(scope);vm.runInContext(v.source,scope);return {...v,S:scope.WarScores};});
const rawPool = new Map(), sourceManifest = [];
const dirs = [baseline+'/sources',out+'/sources',...['war-backtest','war-backtest-expansion','war-backtest-ranked'].map(n=>path.resolve('../tmp/'+n+'/sources'))];
for(const dir of dirs) for(const f of fs.readdirSync(dir).filter(f=>/-(?:random|cwl)\.json$/.test(f)).sort()) {
  const bytes=fs.readFileSync(path.join(dir,f)), s=JSON.parse(bytes);if(!s.ok||!Array.isArray(s.data?.items))continue;
  sourceManifest.push({file:path.join(dir,f),sha256:hash(bytes)});
  for(const raw of s.data.items){if(!raw.clan?.members||!raw.opponent?.members||raw.state!=='warEnded')continue;const w={...raw,type:raw.type||s.type||(/-cwl/.test(f)?'cwl':'random')};
    if(time(w.endTime)<Date.parse('2026-06-01')||time(w.endTime)>Date.parse('2026-10-25'))continue;
    const completeness=[w.clan,w.opponent].reduce((s,c)=>s+(c.members.length===w.teamSize?10000:0)+c.members.reduce((s,p)=>s+(p.attacks?.length||0),0),0);
    if(!rawPool.has(key(w))||rawPool.get(key(w)).completeness<completeness)rawPool.set(key(w),{raw:w,completeness});
  }
}
const pool=[...rawPool.values()].map(x=>x.raw), playerIndex=new Map();
for(const w of pool)for(const p of [w.clan,w.opponent].flatMap(s=>s.members)){const k=tag(p.tag);if(!playerIndex.has(k))playerIndex.set(k,new Set());playerIndex.get(k).add(w);}
fs.writeFileSync(out+'/history-pool-manifest.json',JSON.stringify({sources:sourceManifest,uniqueWars:pool.length},null,2));
const globalFile=out+'/predictions.jsonl';fs.writeFileSync(globalFile,'');
const all=[];let done=0,selectedForTest=null;
targets.sort((a,b)=>({selection:0,validation:1,october:2}[a.split]-{selection:0,validation:1,october:2}[b.split])||time(a.raw.startTime)-time(b.raw.startTime)||a.clan.localeCompare(b.clan));
for(const t of targets){
  if(t.split==='october'&&!selectedForTest)selectedForTest=variants.filter(v=>v.id!=='snapshot').map(v=>({id:v.id,m:metrics(all.filter(r=>r.variant===v.id&&r.split==='selection')).macroRps})).sort((a,b)=>a.m-b.m)[0].id;
  const war=ClashKing.normalizeWar(t.raw,t.clan),cutoff=time(war.startTime);
  const base=[t.raw.clan.tag,t.raw.opponent.tag].flatMap(c=>['random','cwl'].flatMap(type=>{const f=sourceFile(tag(c),type);const s=JSON.parse(fs.readFileSync(f));return s.ok?(s.data?.items||[]).map(w=>({...w,type:w.type||type})):[];}));
  const current=new Set([...war.roster,...war.opponentRoster].map(p=>p.tag)), extra=new Set();
  for(const p of current)for(const w of playerIndex.get(p)||[])if(time(w.endTime)<=cutoff&&(w.type==='cwl'||time(w.endTime)>=cutoff-14*86400000))extra.add(w);
  const own=war.attacks.filter(h=>h.side===war.result.ourSide);
  for(const v of t.split==='october'?variants.filter(v=>['snapshot',selectedForTest].includes(v.id)):variants){
    const model=v.S.fit({war,history:v.expand?[...base,...extra]:base});
    assert(model.events.every(e=>time(e.endTime)<=cutoff&&e.warKey!==key(t.raw)));
    const events=own.flatMap(hit=>{const a=v.S.assess(model,war,hit);if(a.alreadyTripled)return [];
      const tails=model.thresholds.map(c=>sigmoid(a.eta-c));return [{war:key(t.raw),clan:t.clan,external:external.has(t.clan),edition:t.edition,day:t.day,split:t.split,variant:v.id,
        attacker:hit.attacker.tag,defender:hit.defender.tag,stars:hit.stars,atkCV:hit.attacker.th,defCV:hit.defender.th,
        probabilities:[1-tails[0],tails[0]-tails[1],tails[1]-tails[2],tails[2]],
        sufficient:a.category!=='unknown'&&Math.abs(hit.attacker.th-hit.defender.th)<=3,atkN:a.attacker.attackCount,defN:a.defender.defenseCount,
        atkW:a.attacker.attackWeight,defW:a.defender.defenseWeight,trainingEvents:model.events.length,extraWars:extra.size}];});
    all.push(...events);fs.appendFileSync(globalFile,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  }
  if(++done%10===0||done===targets.length)console.log(JSON.stringify({done,total:targets.length,pool:pool.length}));
}
function loss(r,p=r.probabilities){let cdf=0,rps=0;for(let k=0;k<3;k++){cdf+=p[k];rps+=(cdf-Number(r.stars<=k))**2/3;}return rps;}
function metrics(rows){return {n:rows.length,coverage:mean(rows.map(r=>Number(r.sufficient))),rps:mean(rows.map(r=>loss(r))),
  macroRps:mean([...Map.groupBy(rows,r=>r.clan).values()].map(xs=>mean(xs.map(r=>loss(r))))),observedPT:mean(rows.map(r=>Number(r.stars===3))),estimatedPT:mean(rows.map(r=>r.probabilities[3]))};}
const results=variants.map(v=>({variant:v.id,selection:metrics(all.filter(r=>r.variant===v.id&&r.split==='selection')),validation:metrics(all.filter(r=>r.variant===v.id&&r.split==='validation'))}));
const selected=results.filter(v=>v.variant!=='snapshot').sort((a,b)=>a.selection.macroRps-b.selection.macroRps)[0].variant;
const transform=(r,slope,intercept)=>{let cdf=0;const tails=[1,2,3].map(g=>{const tail=sum(r.probabilities.slice(g));const p=Math.max(1e-8,Math.min(1-1e-8,tail));return sigmoid(slope*Math.log(p/(1-p))+intercept);});return [1-tails[0],tails[0]-tails[1],tails[1]-tails[2],tails[2]];};
const calibration=all.filter(r=>r.variant===selected&&r.split==='selection'), grid=[];
for(const slope of [.7,.85,1,1.15,1.3])for(const intercept of [-.3,-.15,0,.15,.3]){const rs=calibration.map(r=>({...r,probabilities:transform(r,slope,intercept)}));grid.push({slope,intercept,...metrics(rs)});}
grid.sort((a,b)=>a.macroRps-b.macroRps);const calibrator=grid[0];
for(const split of ['validation','october']){for(const id of ['snapshot',selected])results.find(r=>r.variant===id)[split]=metrics(all.filter(r=>r.variant===id&&r.split===split));}
const calibrated=Object.fromEntries(['selection','validation','october'].map(split=>[split,metrics(all.filter(r=>r.variant===selected&&r.split===split).map(r=>({...r,probabilities:transform(r,calibrator.slope,calibrator.intercept)})))]));
const final={createdAt:new Date().toISOString(),baselineCommit:'108430d',candidateSourceHash:hash(source),poolWars:pool.length,
 protocol:'Parameters selected by mean clan RPS on first four September rounds. Last three September rounds are validation. October is comparison with the frozen snapshot, including the prior external cohort. No October metric selected a parameter.',results,selected,calibrator,calibrated,
 octoberExternal:Object.fromEntries(['snapshot',selected].map(id=>[id,metrics(all.filter(r=>r.variant===id&&r.split==='october'&&r.external))]))};
fs.writeFileSync(out+'/comparison.json',JSON.stringify(final,null,2));console.log(JSON.stringify(final,null,2));
