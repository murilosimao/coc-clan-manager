import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { planWar } from '../src/cwl/planner.js';
import { fixture,historyFor,CLAN } from './cwl-fixtures.mjs';
import { rankedFixture } from './ranked-fixtures.mjs';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const browser=await chromium.launch({headless:true});
function equivalent(expected,actual){
 if(typeof expected==='number'){assert.equal(typeof actual,'number');assert(Math.abs(expected-actual)<=1e-9);return;}
 if(expected===null||typeof expected!=='object'){assert.equal(actual,expected);return;}
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const key of Object.keys(expected))equivalent(expected[key],actual[key]);
}
try{
 const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(origin+'/?demo=1&view=cwl');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 for(const mode of ['history','empty','ranked']){
  const sample=rankedFixture(),raw=mode==='ranked'?sample.raw:fixture({state:'warEnded'}),history=mode==='empty'?[]:mode==='ranked'?sample.history:historyFor(raw),ranked=mode==='ranked'?sample.ranked:undefined,expected=planWar({raw,clanTag:CLAN,history,ranked});
  const result=await page.evaluate(input=>new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('portal/cwl-compute-worker.js',location.href),{type:'module'});
   worker.onmessage=({data})=>{if(data.type==='progress')return;worker.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data.verification);};
   worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(input);
  }),{clanTag:CLAN,start:raw.startTime,snapshot:{raw,training:{history,ranked,warnings:[],sources:[]}}});
  equivalent(JSON.parse(JSON.stringify(expected.assignments)),result.assignments);equivalent(expected.model.thresholds,result.thresholds);
 }
 console.log('PASS real module worker matches Node with/without history and ranked ATQ, with mobile CPU throttling.');
}finally{await browser.close();}
