import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const demo=JSON.parse(fs.readFileSync(new URL('../public/portal/demo.json',import.meta.url)));
const source=fs.readFileSync(new URL('../public/portal/clan-api.js',import.meta.url),'utf8');
const browser=await chromium.launch();
try {
 const page=await browser.newPage();let passwordCalls=0;
 await page.route('**/portal/clan-api.js',route=>route.fulfill({contentType:'application/javascript',body:source+`\nwindow.ClanAPI.loadClan=async tag=>({clan:{name:'Clã '+tag},members:${JSON.stringify(demo.members)},lastWar:null,currentWar:null,warnings:[],fetchedAt:new Date().toISOString()});`}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data={};
  if(path.endsWith('/auth/session'))data={authenticated:true,editor:{id:'test-leader',role:'leader',clanTag:'2G8QCR92V'}};
  else if(path.endsWith('/auth/password')){passwordCalls++;const body=route.request().postDataJSON();assert.equal(body.currentPassword,'test-current');assert.equal(body.newPassword,'test-new-password');data={ok:true};}
  else if(path.includes('/seasons/'))data={rounds:[],entries:[]};
  await route.fulfill({json:data});
 });
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:850});
  await page.goto(origin+'/?view=team');
  await page.locator('.team-rules').waitFor();
  assert.equal(await page.locator('nav [data-view=rules]').count(),0);
  await page.locator('.team-rules').click();
  assert.equal(await page.locator('#rules-view').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.locator('#leader-access').click();
  await page.getByText('Alterar senha',{exact:true}).click();
  if(width===390){fs.mkdirSync('.wrangler/cwl-ui-review',{recursive:true});await page.screenshot({path:'.wrangler/cwl-ui-review/account-390.png'});}
  for(const input of await page.locator('#password-form input').all()){
   const rect=await input.boundingBox();assert(rect.width>100&&rect.x>=0&&rect.x+rect.width<=width);
  }
  await page.locator('[name=currentPassword]').fill('test-current');
  await page.locator('[name=newPassword]').fill('test-new-password');
  await page.locator('[name=confirmation]').fill('different-password');
  const before=passwordCalls;
  await page.getByRole('button',{name:'Salvar nova senha'}).click();
  await page.getByText('As novas senhas não coincidem.').waitFor();assert.equal(passwordCalls,before);
  await page.getByText('Alterar senha',{exact:true}).click();
  await page.locator('[name=currentPassword]').fill('test-current');
  await page.locator('[name=newPassword]').fill('test-new-password');
  await page.locator('[name=confirmation]').fill('test-new-password');
  await page.getByRole('button',{name:'Salvar nova senha'}).click();
  await page.getByText('Senha alterada.',{exact:true}).waitFor();assert.equal(passwordCalls,before+1);
  assert.equal(await page.locator('#password-form input').evaluateAll(xs=>xs.every(x=>!x.value)),true);
  await page.locator('#close-leader').click();
  console.log('PASS account and rules at '+width+'px');
 }
 // Distinct local settings survive clan switches and reloads.
 await page.goto(origin+'/?view=team');await page.locator('.team-rules').waitFor();
 await page.locator('.team-rules').click();await page.locator('[data-setting=rankBy]').selectOption('name');
 const switchClan=async tag=>{await page.locator('#open-clan').click();await page.locator('#clan-input').fill(tag);await page.locator('#clan-form').evaluate(f=>f.requestSubmit());await page.waitForFunction(t=>document.querySelector('#clan-tag').textContent==='#'+t,tag);await page.locator('.team-rules').click();};
 await switchClan('2CQ9CR2YP');assert.equal(await page.locator('[data-setting=rankBy]').inputValue(),'activity');
 await page.locator('[data-setting=rankBy]').selectOption('th');
 await switchClan('2G8QCR92V');assert.equal(await page.locator('[data-setting=rankBy]').inputValue(),'name');
 await switchClan('2CQ9CR2YP');assert.equal(await page.locator('[data-setting=rankBy]').inputValue(),'th');
 await page.reload();await page.locator('.team-rules').waitFor();await page.locator('.team-rules').click();assert.equal(await page.locator('[data-setting=rankBy]').inputValue(),'th');
 console.log('PASS isolated clan settings survive switching and reload');
}finally{await browser.close();}
