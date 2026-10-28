import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CWL_UI_BASE_URL||'http://127.0.0.1:8791';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const browser=await chromium.launch();
const clans=['2G8QCR92V','2CQ9CR2YP'];
const primary='00000000-0000-4000-8000-000000000001',created='00000000-0000-4000-8000-000000000002';
try{
 const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('coc-clan-context-v1',JSON.stringify({version:1,tag:'2G8QCR92V'})));let role='leader',removed=0,createdCount=0,fail=false;
 const records=new Map();
 await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   let data={};
   if(path.endsWith('/auth/session'))data={authenticated:true,editor:{id:primary,role,clanTag:clans[0],clanTags:clans,leaderClanTags:role==='leader'?clans:[]}};
   else if(path.startsWith('/api/cwl/users')){
     if(fail)return route.fulfill({status:503,json:{error:'Serviço temporariamente indisponível.'}});
     if(req.method()==='GET')data={clanTag:url.searchParams.get('clan'),users:records.get(url.searchParams.get('clan'))};
     else {const body=req.postDataJSON();assert(clans.includes(body.clanTag));
       if(path.endsWith('/remove')){assert.equal(body.userId,created);removed++;records.set(body.clanTag,records.get(body.clanTag).filter(r=>r.id!==created));}
       else{assert.equal(body.password,'temporary-test-password');assert.equal(body.role,undefined);createdCount++;records.get(body.clanTag).push({id:created,email:body.email,role:'coLeader'});}
       data={ok:true};
     }
   }else if(path.includes('/seasons/'))data={rounds:[],entries:[]};
   else if(path.includes('/clans/'))return route.fulfill({status:503,json:{error:'Fixture has no game data.'}});
   await route.fulfill({json:data});
 });
 for(const width of [320,390,768,1440]){
   records.clear();for(const tag of clans)records.set(tag,[{id:primary,email:'leader@test.invalid',role:'leader'}]);
   await page.setViewportSize({width,height:850});await page.goto(origin+'/?view=cwl');
   await page.locator('#leader-access').click();await page.getByRole('button',{name:'Gerenciar usuários',exact:true}).click();
   await page.getByText('leader@test.invalid',{exact:true}).waitFor();
   const longEmail='colider.com.email.longo.para.verificar.mobile@test.invalid';
   await page.locator('#user-create-form [name=email]').fill(longEmail);
   await page.locator('#user-create-form [name=password]').fill('short');const before=createdCount;
   await page.getByRole('button',{name:'Cadastrar no clã'}).click();assert.equal(createdCount,before);
   await page.locator('#user-create-form [name=password]').fill('temporary-test-password');
   await page.getByRole('button',{name:'Cadastrar no clã'}).click();await page.getByText('Acesso de colíder cadastrado.').waitFor();assert.equal(createdCount,before+1);
   assert.equal(await page.locator('#user-create-form [name=password]').inputValue(),'');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(width===390){fs.mkdirSync('.wrangler/cwl-ui-review',{recursive:true});await page.screenshot({path:'.wrangler/cwl-ui-review/users-390.png'});}
   await page.locator('#users-clan').selectOption(clans[1]);await page.waitForFunction(()=>!document.querySelector('#users-clan').disabled);
   assert.equal(await page.getByText(longEmail,{exact:true}).count(),0);
   await page.locator('#users-clan').selectOption(clans[0]);await page.getByText(longEmail,{exact:true}).waitFor();
   await page.getByRole('button',{name:'Remover',exact:true}).click();const beforeRemove=removed;
   await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(removed,beforeRemove);
   await page.getByRole('button',{name:'Remover',exact:true}).click();await page.getByRole('button',{name:'Remover acesso',exact:true}).click();
   await page.getByText('Acesso removido deste clã.').waitFor();assert.equal(removed,beforeRemove+1);assert.equal(records.get(clans[1]).length,1);
   fail=true;await page.locator('#users-clan').selectOption(clans[1]);await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes('temporariamente'));fail=false;
   await page.locator('#close-users').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'leader-access');
   console.log('PASS leader user management at '+width+'px');
 }
 role='coLeader';await page.reload();await page.locator('#leader-access').click();assert.equal(await page.getByRole('button',{name:'Gerenciar usuários'}).count(),0);
 console.log('PASS co-leader has no user administration controls');
}finally{await browser.close();}
