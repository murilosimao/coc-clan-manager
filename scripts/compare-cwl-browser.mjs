// Exact replay of frozen inputs in Chromium versus the previously committed backend.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { WarScores as S } from '../src/cwl/scoring.js';
import { planWar as currentPlan,ASSIGNMENT_PRECISION } from '../src/cwl/planner.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const origin=arg('--origin','http://127.0.0.1:8791');
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));
const dataRoot=path.resolve(arg('--data-root',path.join(repo,'../output/cwl-improvement-2026-10-25')));
const baseline=path.resolve(arg('--baseline',path.join(repo,'../output/cwl-baseline-2026-10-25')));
const out=path.resolve(arg('--out',path.join(repo,'.wrangler/cwl-browser-parity')));fs.mkdirSync(out,{recursive:true});
const onlyCase=Number(arg('--case','0'));
const cpuRate=Number(arg('--cpu-rate','1'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const frozen=execFileSync('git',['show','b3f1f14:public/portal/war-scores.js'],{cwd:repo});
assert.equal(hash(frozen),hash(fs.readFileSync(path.join(repo,'public/portal/war-scores.js'))),'Formula changed since b3f1f14.');
const old=execFileSync('git',['show','b3f1f14:src/cwl/planner.js'],{cwd:repo,encoding:'utf8'})
  .replace("'./scoring.js'",JSON.stringify(pathToFileURL(path.join(repo,'src/cwl/scoring.js')).href))
  .replace("'./errors.js'",JSON.stringify(pathToFileURL(path.join(repo,'src/cwl/errors.js')).href));
fs.writeFileSync(path.join(out,'baseline-planner.mjs'),old);
const {planWar:oldPlan}=await import(pathToFileURL(path.join(out,'baseline-planner.mjs')).href);
const rounds=JSON.parse(fs.readFileSync(path.join(dataRoot,'production-rounds.json')));
const cases=rounds.map(r=>{
  let raw;
  for(const root of [baseline+'/sources',dataRoot+'/holdout/sources']){
    const f=root+'/'+r.clan+'-cwl.json';if(fs.existsSync(f))raw=JSON.parse(fs.readFileSync(f)).data.items.find(w=>w.startTime===r.start)||raw;
  }
  assert(raw,'Missing frozen war '+r.clan+' '+r.start);
  const file=path.join(dataRoot,'production-history',r.clan+'-'+r.start+'.json');
  return {clan:r.clan,raw:{...raw,type:'cwl'},training:JSON.parse(fs.readFileSync(file)),sourceHash:hash(fs.readFileSync(file))};
});
// Include a real 30-player lineup, as well as a genuinely empty history.
for(const file of fs.readdirSync(baseline+'/sources').filter(f=>f.endsWith('-cwl.json'))){
  const entry=JSON.parse(fs.readFileSync(baseline+'/sources/'+file));
  const raw=entry.data?.items?.find(w=>w.teamSize===30&&w.state==='warEnded'&&w.preparationStartTime.startsWith('202610'));
  if(!raw)continue;
  const history=[raw.clan.tag,raw.opponent.tag].flatMap(t=>['random','cwl'].flatMap(type=>{
    const f=baseline+'/sources/'+t.slice(1)+'-'+type+'.json';
    return fs.existsSync(f)?(JSON.parse(fs.readFileSync(f)).data?.items||[]).map(w=>({...w,type:w.type||type})):[];
  }));
  cases.push({clan:raw.clan.tag.slice(1),raw:{...raw,type:'cwl'},training:{history},extra:true});break;
}
cases.push({...cases[0],training:{history:[]},extra:true,empty:true});
const sigmoid=x=>1/(1+Math.exp(-x));
function summarize(result){
  const m=result.model,current=new Set([...result.war.roster,...result.war.opponentRoster].map(p=>S.playerKey(p)));
  return {version:result.version,config:result.config,context:m.context,coefficients:m.coefficients,thresholds:m.thresholds,scales:m.scales,
    eventsHash:hash(JSON.stringify(m.events.map(e=>e.id))),players:m.players.filter(p=>current.has(p.key)),assignments:result.assignments,
    expectedStars:result.expectedStars,mirrorExpectedStars:result.mirrorExpectedStars,
    observed:result.war.attacks.filter(a=>a.side===result.war.result.ourSide).map(hit=>{
      const a=S.assess(m,result.war,hit),q=m.thresholds.map(t=>sigmoid(a.eta-t));
      return {order:hit.order,stars:hit.stars,category:a.category,overkill:a.alreadyTripled,probabilities:[1-q[0],q[0]-q[1],q[1]-q[2],q[2]]};
    })};
}
let maxDifference=0;
function equivalent(expected,actual,where='root'){
  if(typeof expected==='number'){
    assert.equal(typeof actual,'number',where);const delta=Math.abs(expected-actual);maxDifference=Math.max(maxDifference,delta);
    assert(delta<=1e-9,where+': numerical difference '+delta);return;
  }
  if(expected===null||typeof expected!=='object'){assert.equal(actual,expected,where);return;}
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),where+' keys');
  for(const key of Object.keys(expected))equivalent(expected[key],actual[key],where+'.'+key);
}
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
const checks=[],rows=[],legacyRows=[];
try{
  await page.goto(origin+'/?demo=1&view=cwl');
  if(cpuRate>1){await page.setViewportSize({width:390,height:900});const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});}
  for(const [i,item] of cases.entries()){
    if(onlyCase&&i+1!==onlyCase)continue;
    const input={raw:item.raw,clanTag:item.clan,history:item.training.history};
    const legacyPlan=oldPlan(input),current=currentPlan(input),legacy=summarize(legacyPlan),expected=summarize(current);
    const legacyChanges=legacy.assignments.filter((m,i)=>m.defenderTag!==expected.assignments[i].defenderTag).length;
    const legacyDelta=expected.expectedStars-legacy.expectedStars;
    assert(Math.abs(legacyDelta)<=item.raw.teamSize*ASSIGNMENT_PRECISION,'Non-tied historical objective changed');
    // Scores and every chosen matchup must still match the old formula.
    for(const key of ['config','context','coefficients','thresholds','scales','eventsHash','players','observed','mirrorExpectedStars'])equivalent(legacy[key],expected[key],'legacy.'+key);
    for(const mission of expected.assignments){
      const previous=legacyPlan.matchups.flat().find(m=>m.attackerTag===mission.attackerTag&&m.defenderTag===mission.defenderTag);
      equivalent({...previous,source:'system'},mission,'legacy.matchup');
    }
    const actual=await page.evaluate(async input=>{
      let ticks=0;const timer=setInterval(()=>ticks++,10);
      try{return await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('portal/cwl-compute-worker.js',location.href),{type:'module'});
        const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Browser calculation timed out'));},90000);
        worker.onmessage=({data})=>{
          if(data.type==='progress')return;
          clearTimeout(timeout);worker.terminate();
          if(data.type==='error')reject(new Error(data.message));
          else resolve({verification:data.verification,computeMs:data.computeMs,archiveBytes:data.archive.byteLength,ticks});
        };
        worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(new Error(e.message));};worker.postMessage(input);
      });}finally{clearInterval(timer);}
    },{clanTag:item.clan,start:item.raw.startTime,snapshot:{raw:item.raw,training:item.training}});
    try{equivalent(expected,actual.verification);}catch(error){
      fs.writeFileSync(path.join(out,'difference.json'),JSON.stringify({case:i+1,clan:item.clan,start:item.raw.startTime,maxDifference,expected,actual:actual.verification},null,2));throw error;
    }
    if(!item.extra){rows.push(...actual.verification.observed.filter(h=>!h.overkill));legacyRows.push(...legacy.observed.filter(h=>!h.overkill));}
    checks.push({clan:item.clan,start:item.raw.startTime,teamSize:item.raw.teamSize,emptyHistory:!!item.empty,sourceHash:item.sourceHash,
      identical:true,legacyTargetChanges:legacyChanges,legacyExpectedStarsDelta:legacyDelta,computeMs:actual.computeMs,archiveBytes:actual.archiveBytes,mainThreadTicks:actual.ticks});
    console.log(JSON.stringify({done:i+1,total:cases.length,...checks.at(-1)}));
  }
  const previous=JSON.parse(fs.readFileSync(path.join(dataRoot,'production-comparison.json')));
  const metric=items=>items.length?items.reduce((sum,r)=>{let cdf=0;for(let k=0;k<3;k++){cdf+=r.probabilities[k];sum+=(cdf-Number(r.stars<=k))**2/3;}return sum;},0)/items.length:null;
  const rps=metric(rows),referenceRps=metric(legacyRows);
  if(!onlyCase){assert.equal(rows.length,previous.all.candidate.n);assert(Math.abs(rps-previous.all.candidate.rps)<1e-12,'Historical RPS changed');}
  const report={baselineCommit:'b3f1f14',cpuRate,scoreHash:hash(frozen),tolerance:1e-9,maxAbsoluteDifference:maxDifference,
    scope:onlyCase?'selected_case':'full_frozen_provider_cohort',cases:checks.length,observedAttacks:rows.length,previousRps:referenceRps,
    historicalCohortRps:previous.all.candidate.rps,browserRps:rps,checks};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,cases:checks.length,observedAttacks:rows.length,rps,maxAbsoluteDifference:maxDifference}));
}finally{await browser.close();}
