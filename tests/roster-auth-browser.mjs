import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const tags=['2G8QCR92V','2CQ9CR2YP'];
const keys=['forcedIn','forcedOut','whitelist','blacklist'];
const demo=JSON.parse(fs.readFileSync(new URL('../public/portal/demo.json',import.meta.url)));
const source=fs.readFileSync(new URL('../public/portal/clan-api.js',import.meta.url),'utf8');
const browser=await chromium.launch();
try {
 for(const width of [320,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage();
  let editor=null,sessionCalls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({tags,keys})=>{
   if(localStorage.getItem('roster-test-seeded'))return;
   localStorage.setItem('roster-test-seeded','1');
   localStorage.setItem('coc-clan-context-v1',JSON.stringify({version:1,tag:tags[0]}));
   for(const tag of tags)localStorage.setItem('clashspot-war-selector-v1:'+tag,JSON.stringify({selectionRulesVersion:2,rankBy:'name',usePlayerHistoryFallback:false,...Object.fromEntries(keys.map(k=>[k,['OLDPLAYER']]))}));
  },{tags,keys});
  await page.route('**/portal/clan-api.js*',r=>r.fulfill({contentType:'application/javascript',body:source+`\nwindow.ClanAPI.loadClan=async tag=>({clan:{name:tag},members:${JSON.stringify(demo.members)},lastWar:null,currentWar:null,warnings:[],fetchedAt:new Date().toISOString()});`}));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/auth/session')){sessionCalls++;return route.fulfill({json:{authenticated:Boolean(editor),editor}});}
   if(path.endsWith('/auth/logout')){editor=null;return route.fulfill({json:{ok:true}});}
   return route.fulfill({json:{rounds:[],entries:[]}});
  });
  const ready=()=>page.waitForFunction(()=>window.ClanManager?.state.members.length&&!window.ClanManager.state.loading);
  const lists=()=>page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,window.ClanManager.state.settings[k]])),keys);
  const empty=Object.fromEntries(keys.map(k=>[k,[]]));
  await page.goto(origin+'/?view=team');await ready();
  assert.deepEqual(await lists(),empty);assert.equal(await page.evaluate(()=>window.ClanManager.state.settings.rankBy),'name');
  assert.equal(await page.locator('[data-action]').count(),0);
  await page.locator('.team-rules').click();assert(await page.locator('[data-setting=rankBy]').isDisabled());
  assert(await page.locator('[data-setting=usePlayerHistoryFallback]').isDisabled());
  // A synthetic stale control still cannot mutate anonymous state.
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.action='force-out';b.dataset.tag=window.ClanManager.state.selection.selected[0].member.tag;document.body.append(b);b.click();b.remove();});
  await page.getByText('Entre com uma conta autorizada deste clã para alterar a sugestão.',{exact:true}).waitFor();assert.deepEqual(await lists(),empty);
  await page.locator('.rules-back').click();
  await page.screenshot({path:'.wrangler/cwl-ui-review/roster-read-'+width+'.png'});
  for(const role of ['leader','coLeader']){
   editor={id:'fixture-'+role,role,clanTag:tags[0],clanTags:[tags[0]]};
   await page.evaluate(()=>window.CwlApp.loadSession());
   const remove=page.locator('[data-action=force-out]').first();await remove.waitFor();
   const player=await remove.getAttribute('data-tag'),before=sessionCalls;
   page.once('dialog',d=>d.dismiss());await remove.click();await page.waitForFunction(()=>!document.querySelector('#toast').hidden);
   await page.waitForTimeout(80);assert.deepEqual(await lists(),empty);assert(sessionCalls>before);
   page.once('dialog',d=>d.accept());await page.locator(`[data-action=force-out][data-tag="${player}"]`).click();
   await page.waitForFunction(tag=>window.ClanManager.state.settings.forcedOut.includes(tag),player);
   await page.reload();await ready();assert((await lists()).forcedOut.includes(player));
   // A session revoked after the controls render must not make a second edit.
   const beforeRevocation=await lists();editor=null;
   await page.locator('[data-action=force-out]').first().click();
   await page.getByText('Sua sessão não permite alterar este clã. Entre novamente.',{exact:true}).waitFor();
   assert.deepEqual(await lists(),beforeRevocation);assert.equal(await page.locator('[data-action]').count(),0);
   editor={id:'fixture-'+role,role,clanTag:tags[0],clanTags:[tags[0]]};await page.evaluate(()=>window.CwlApp.loadSession());
   page.once('dialog',d=>d.dismiss());await page.locator('[data-command=reset-roster]').click();await page.waitForTimeout(80);assert.deepEqual(await lists(),beforeRevocation);
   page.once('dialog',d=>d.accept());await page.locator('[data-command=reset-roster]').click();await page.getByText('Sugestão padrão restaurada.',{exact:true}).waitFor();assert.deepEqual(await lists(),empty);
  }
  // Clan membership scopes edits, and the second clan migrates independently.
  await page.locator('#open-clan').click();await page.locator(`[data-clan-choice="${tags[1]}"]`).click();await ready();
  assert.deepEqual(await lists(),empty);assert.equal(await page.locator('[data-action]').count(),0);
  await page.locator('.team-rules').click();assert(await page.locator('[data-setting=rankBy]').isDisabled());
  editor.clanTags=tags;await page.evaluate(()=>window.CwlApp.loadSession());
  await page.locator('[data-setting=rankBy]').selectOption('th');await page.waitForFunction(()=>window.ClanManager.state.settings.rankBy==='th');
  await page.reload();await ready();assert.equal(await page.evaluate(()=>window.ClanManager.state.settings.rankBy),'th');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.deepEqual(errors,[]);
  await context.close();console.log('PASS roster migration, anonymous guard, scoped leadership, expiry, confirmation and reset at '+width+'px');
 }
}finally{await browser.close();}
