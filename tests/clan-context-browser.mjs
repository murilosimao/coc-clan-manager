import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const tags=['2G8QCR92V','2CQ9CR2YP'],key='coc-clan-context-v1';
const demo=JSON.parse(fs.readFileSync(new URL('../public/portal/demo.json',import.meta.url)));
const source=fs.readFileSync(new URL('../public/portal/clan-api.js',import.meta.url),'utf8');
fs.mkdirSync('.wrangler/cwl-ui-review',{recursive:true});
const browser=await chromium.launch();
async function setup(width=390,init){
 const context=await browser.newContext({viewport:{width,height:850}});if(init)await context.addInitScript(init);
 const page=await context.newPage();const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/portal/clan-api.js',r=>r.fulfill({contentType:'application/javascript',body:source+`\nwindow.__clanLoads=[];window.ClanAPI.loadClan=async tag=>{window.__clanLoads.push(tag);return{clan:{name:window.ClanContexts.find(tag).name},members:${JSON.stringify(demo.members)},lastWar:null,currentWar:null,warnings:[],fetchedAt:new Date().toISOString()};};`}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;calls.push(path);
  if(path.endsWith('/auth/session'))return route.fulfill({json:{authenticated:false}});
  if(path.includes('/seasons/'))return route.fulfill({json:{rounds:[],entries:[],ranking:{entries:[]}}});
  return route.fulfill({json:{ok:true}});
 });
 return {page,context,errors,calls};
}
const selected=async(page,tag)=>{await page.waitForFunction(t=>window.ClanManager.state.clanTag===t&&!window.ClanManager.state.loading,tag);assert.equal(await page.locator('#clan-dialog').isVisible(),false);};
try{
 for(const width of [320,390,768,800,1024,1440]){
  const {page,context,errors,calls}=await setup(width);
  await page.goto(origin+'/?view=cwl');await page.locator('#clan-dialog[open]').waitFor();
  assert.equal(await page.locator('[data-clan-choice]').count(),2);assert.equal(await page.locator('#clan-dialog input').count(),0);
  assert.equal(await page.evaluate(()=>window.__clanLoads.length),0);assert.equal(calls.filter(x=>x.includes('/clans/')).length,0);
  assert(await page.locator('.clan-choice img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
  await page.keyboard.press('Escape');assert(await page.locator('#clan-dialog').isVisible());
  await page.mouse.click(1,1);assert(await page.locator('#clan-dialog').isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  if([320,390,1440].includes(width))await page.screenshot({path:'.wrangler/cwl-ui-review/context-first-'+width+'.png'});
  await page.locator(`[data-clan-choice="${tags[1]}"]`).focus();await page.keyboard.press('Enter');await selected(page,tags[1]);
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).tag,key),tags[1]);
  assert.equal(await page.evaluate(()=>window.CwlApp.state.clanTag),tags[1]);
  assert.equal(await page.evaluate(()=>window.ClanManager.state.view),'cwl');
  assert.deepEqual(await page.locator('nav [aria-current=page]').evaluateAll(xs=>xs.map(x=>x.dataset.view)),['cwl','cwl']);
  assert((await page.locator('#open-clan').getAttribute('aria-label')).includes('SanguePuro'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  const button=await page.locator('#open-clan').boundingBox();assert(button.height>=44&&button.x>=0&&button.x+button.width<=width);
  await page.waitForTimeout(220);
  if([320,390,1440].includes(width))await page.screenshot({path:'.wrangler/cwl-ui-review/context-selected-'+width+'.png'});
  await page.goto(origin+'/');await selected(page,tags[1]);
  await page.locator('#open-clan').click();assert.equal(await page.locator(`[data-clan-choice="${tags[1]}"]`).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'open-clan');
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[0]}"]`).click();await selected(page,tags[0]);
  assert.equal(new URL(page.url()).searchParams.get('clan'),tags[0]);await page.reload();await selected(page,tags[0]);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS first choice, persistence, badges, keyboard and switching at '+width+'px');
 }
 {
  const {page,context}=await setup();
  await page.goto(origin+'/?clan=2G8QCR92V');await selected(page,tags[0]);
  await page.evaluate(()=>{localStorage.setItem('clashspot-war-selector-v1:2G8QCR92V',JSON.stringify({rankBy:'name',selectionRulesVersion:2}));localStorage.setItem('clashspot-war-selector-v1:2CQ9CR2YP',JSON.stringify({rankBy:'th',selectionRulesVersion:2}));});
  await page.goto(origin+'/?clan=2CQ9CR2YP&view=cwl');await selected(page,tags[1]);assert.equal(await page.evaluate(()=>window.ClanManager.state.settings.rankBy),'th');
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[0]}"]`).click();await selected(page,tags[0]);assert.equal(await page.evaluate(()=>window.ClanManager.state.settings.rankBy),'name');
  await page.evaluate(()=>{window.CwlApp.state.demoEditMode=true;});
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[1]}"]`).click();assert(await page.locator('#clan-switch-warning').isVisible());
  await page.locator('#cancel-clan-switch').click();assert.equal(await page.evaluate(()=>window.ClanManager.state.clanTag),tags[0]);
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[1]}"]`).click();await page.locator('#confirm-clan-switch').click();await selected(page,tags[1]);assert.equal(await page.evaluate(()=>window.CwlApp.state.demoEditMode),false);
  await page.goto(origin+'/?clan=2998YJPU2');await page.locator('#clan-dialog[open]').waitFor();assert.equal(await page.evaluate(()=>window.__clanLoads.length),0);
  await page.evaluate(()=>window.ClanManager.loadClan('2998YJPU2'));assert.equal(await page.evaluate(()=>window.__clanLoads.length),0);
  await context.close();console.log('PASS URL override, isolated settings, unsaved edits and unsupported clans');
 }
 {
  const {page,context,errors}=await setup();
  let started;const requestStarted=new Promise(r=>{started=r;});
  await page.route('**/api/cwl/clans/**/seasons/*',async route=>{
    if(decodeURIComponent(new URL(route.request().url()).pathname).includes(tags[0])){
      started();await new Promise(r=>setTimeout(r,500));
      return route.fulfill({json:{rounds:[{warStart:'20261009T080000.000Z',state:'inWar',opponent:{name:'Resposta do clã anterior'}}]}});
    }
    return route.fulfill({json:{rounds:[]}});
  });
  await page.goto(origin+'/?clan='+tags[0]+'&view=cwl');await requestStarted;await selected(page,tags[0]);
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[1]}"]`).click();await selected(page,tags[1]);
  await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.CwlApp.state.rounds.length),0);assert.equal(await page.evaluate(()=>window.CwlApp.state.error),'');assert.deepEqual(errors,[]);
  await context.close();console.log('PASS late CWL response from the previous clan cannot overwrite the new context');
 }
 {
  const {page,context}=await setup();await page.goto(origin+'/');await page.locator('#clan-dialog[open]').waitFor();
  await page.evaluate(()=>{window.ClanAPI.loadClan=async()=>{throw Error('Fonte indisponível.');};});
  await page.locator(`[data-clan-choice="${tags[1]}"]`).click();await selected(page,tags[1]);
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).tag,key),tags[1]);
  await page.reload();await selected(page,tags[1]);await context.close();console.log('PASS the chosen clan is remembered even when its data source fails');
 }
 {
  const {page,context}=await setup(390,()=>localStorage.setItem('coc-clan-context-v1','broken-json'));
  await page.goto(origin+'/');await page.locator('#clan-dialog[open]').waitFor();await context.close();console.log('PASS corrupt preference shows the chooser');
 }
 {
  const {page,context,errors}=await setup(320,()=>{Storage.prototype.getItem=()=>{throw Error('disabled');};Storage.prototype.setItem=()=>{throw Error('disabled');};});
  await page.goto(origin+'/');await page.locator(`[data-clan-choice="${tags[0]}"]`).click();await selected(page,tags[0]);
  assert((await page.locator('#toast').innerText()).includes('não permitiu salvá-la'));assert.deepEqual(errors,[]);await context.close();console.log('PASS selection still works when site storage is blocked');
 }
}finally{await browser.close();}
