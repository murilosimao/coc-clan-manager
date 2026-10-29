import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankedFixture } from './ranked-fixtures.mjs';
import { planWar } from '../src/cwl/planner.js';
import { CLAN } from './cwl-fixtures.mjs';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const sample=rankedFixture(),expected=planWar({raw:sample.raw,clanTag:CLAN,history:sample.history,ranked:sample.ranked}),players=sample.ranked.packets.filter(p=>p.kind==='players').flatMap(p=>p.items);
fs.mkdirSync('.wrangler/cwl-ui-review',{recursive:true});
const browser=await chromium.launch();
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});let fail=false;
  await page.route('**/api/ranked/**',route=>{
   if(fail)return route.fulfill({status:503,json:{error:'temporarily unavailable'}});
   const url=new URL(route.request().url()),kind=url.pathname.split('/').at(-1),tags=url.searchParams.get('tags')?.split(',');
   return route.fulfill({json:kind==='family'?sample.ranked.packets[0]:{version:1,kind,fetchedAt:sample.now,items:players.filter(p=>tags?.includes(p.tag))}});
  });
  await page.goto(origin+'/?demo=1&view=cwl');
  await page.evaluate(input=>{
   window.ClanAPI.loadScoreHistory=async()=>({items:input.history,fetchedAt:new Date().toISOString()});
   const root=document.createElement('section');root.id='ranked-test';document.body.append(root);
   window.ScoreUI.reset();window.ScoreUI.init(()=>{root.innerHTML=window.ScoreUI.summary(input.war)+input.war.roster.map(p=>window.ScoreUI.badges(input.war,p)).join('');});
   window.ScoreUI.ensure(input.war);
  },{war:expected.war,history:sample.history});
  await page.waitForFunction(()=>[...window.ScoreUI.reports.values()].some(e=>e.model?.version==='war-atq-ranked-v1'&&!e.rankedLoading));
  const actual=await page.evaluate(()=>[...window.ScoreUI.reports.values()][0].model);
  for(const p of expected.model.players){const a=actual.players.find(q=>q.key===p.key);assert(Math.abs(a.attackScore-p.attackScore)<1e-9);assert(Math.abs(a.defenseScore-p.defenseScore)<1e-9);}
  await page.locator('#ranked-test [data-score-role="attack"]').first().click();
  await page.waitForSelector('#score-dialog[open]');
  assert.match(await page.locator('#score-body').innerText(),/Contribuição da ranqueada/);
  assert.match(await page.locator('#score-body').innerText(),/CVs da ranqueada são estimados/);
  const overflow=await page.locator('#score-dialog').evaluate(e=>e.scrollWidth>e.clientWidth+1);assert.equal(overflow,false,`ranked dialog overflow ${width}`);
  await page.locator('#score-dialog').screenshot({path:`.wrangler/cwl-ui-review/ranked-${width}.png`});
  await page.evaluate(()=>document.querySelector('#score-dialog').close());
  fail=true;
  await page.evaluate(input=>{window.RankedAPI.load=async()=>{throw Error('unavailable');};window.ScoreUI.reset();window.ScoreUI.ensure(input.war);},{war:expected.war});
  await page.waitForFunction(()=>[...window.ScoreUI.reports.values()].some(e=>e.model&&!e.loading&&!e.rankedLoading));
  assert.equal(await page.evaluate(()=>[...window.ScoreUI.reports.values()][0].model.version),'war-ordinal-v2');
  console.log(`PASS ranked ATQ parity, auditable mobile dialog and outage fallback at ${width}px`);
  await page.close();
 }
}finally{await browser.close();}
