import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.CWL_UI_BASE_URL || 'http://127.0.0.1:8791';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname));
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:390,height:844},locale:'pt-BR'});
await page.goto(origin+'/?demo=1&view=cwl');
await page.waitForFunction(()=>window.CwlApp?.state.plan && !window.CwlApp.state.loading);
await page.waitForTimeout(200);
const roundVisibility = await page.evaluate(() => {
  const rail=document.querySelector('.cwl-rounds').getBoundingClientRect();
  const selected=document.querySelector('.cwl-round[aria-pressed="true"]').getBoundingClientRect();
  const summary=document.querySelector('.cwl-metric:first-child');
  return {left:selected.left-rail.left,right:rail.right-selected.right, summaryVisible:getComputedStyle(summary).display!=='none'};
});
assert.ok(roundVisibility.left >= -1 && roundVisibility.right >= -1, JSON.stringify(roundVisibility));
assert.ok(roundVisibility.summaryVisible, JSON.stringify(roundVisibility));
await page.setViewportSize({width:1440,height:900});
await page.setViewportSize({width:390,height:844});
await page.waitForTimeout(200);
const resized = await page.evaluate(() => {
  const rail=document.querySelector('.cwl-rounds').getBoundingClientRect();
  const selected=document.querySelector('.cwl-round[aria-pressed="true"]').getBoundingClientRect();
  const summary=document.querySelector('.cwl-metric:first-child');
  const title=summary.querySelector('strong').getBoundingClientRect(), date=summary.querySelector('small').getBoundingClientRect();
  return {left:selected.left-rail.left,right:rail.right-selected.right,spacing:date.top-title.bottom};
});
assert.ok(resized.left >= -1 && resized.right >= -1 && resized.spacing >= 0, JSON.stringify(resized));
const result = await page.evaluate(()=>{
 const state=structuredClone(window.CwlApp.state);state.demo=false;state.editor=null;state.activeTab='plan';
 const root=document.createElement('div');
 root.innerHTML=window.CwlUI.render(state);
 const first=state.plan.initial.participants[0],hit=state.plan.outcomes.find(h=>h.attackerTag===first.tag);
 const mission=hit?.mission || state.plan.effective.assignments.find(m=>m.attackerTag===first.tag);
 const target=state.plan.initial.opponentParticipants.find(p=>p.tag===mission.defenderTag);
 const label=root.querySelector('.cwl-defender .cwl-person-label')?.textContent;
 const approved={label,position:target.position,adoption:root.textContent.includes('O que mudou no plano inicial'),edit:!!root.querySelector('[data-cwl-action="demo-edit-toggle"]'),revision:root.textContent.includes('Aprovação v')};
 state.plan.effective=null;root.innerHTML=window.CwlUI.render(state);
 return {approved,pending:root.textContent,hasRows:!!root.querySelector('.cwl-mission-item'),exportDisabled:root.querySelector('.cwl-export')?.disabled};
});
assert.ok(result.approved.label.includes('#'+result.approved.position), JSON.stringify(result.approved));
assert.equal(result.approved.adoption,false);assert.equal(result.approved.edit,false);assert.equal(result.approved.revision,false);
assert.ok(result.pending.includes('Aguardando o plano da liderança'));assert.equal(result.hasRows,false);assert.equal(result.exportDisabled,true);
await page.getByRole('button',{name:'Editar alvos e metas'}).click();
const trigger=page.locator('[data-cwl-action=demo-target-toggle]').first(); await trigger.click();
const options=await page.locator('.cwl-target-select option').allTextContents();
assert.ok(options.length && options.every(o=>/^#\d+ · /.test(o)), options.join(', '));
const credentials = await page.evaluate(async () => {
  const original = window.fetch, seen = [];
  window.fetch = async (url, options) => { seen.push({url, credentials: options.credentials}); return new Response('{}', {status:200,headers:{'Content-Type':'application/json'}}); };
  try {
    await window.ClanAPI.loadCwlPlan('2G8QCR92V','20261024T100000.000Z');
    await window.ClanAPI.loadCwlAnalytics('2G8QCR92V','2026-10');
  } finally { window.fetch = original; }
  return seen;
});
assert.equal(credentials.length,2); assert.ok(credentials.every(item=>item.credentials==='same-origin'), JSON.stringify(credentials));
console.log('PASS member approved/pending views, actual target positions, and editable target positions');
await browser.close();
