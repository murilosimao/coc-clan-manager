import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {tags,player,fixture} from './family-war-fixture.mjs';
const publicDir=new URL('../public/',import.meta.url).pathname;
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;const file=path.join(publicDir,name==='/'?'index.html':name);if(!file.startsWith(publicDir)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
fs.mkdirSync('.wrangler/cwl-ui-review',{recursive:true});
const browser=await chromium.launch();
try{
 for(const width of [320,390,768,1440])for(const selected of tags){
  const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const other=tags.find(t=>t!==selected),own=fixture(selected,'20261022T000000.000Z',[]),prior=fixture(other,'20261021T000000.000Z');
  own.clan.members[0].tag='#PYU';own.clan.members[0].name='Outro jogador';
  const calls=[];let failed=false,stale=false;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),p=decodeURIComponent(url.pathname);calls.push(p);
   if(p==='/api/players')return route.fulfill({json:{items:url.searchParams.get('tags').split(',').map(tag=>({tag,clan:{tag:'#'+selected},townHallLevel:18,warPreference:'in',role:'member'}))}});
   if(p.endsWith('/war-stats'))return route.fulfill({json:{items:[{type:'random',state:'warEnded',attacksPerMember:2,endTime:'20261020T000000.000Z',attacks:[],defenses:[],clan:{name:'Arquivo atrasado'}}]}});
   if(p.endsWith('/score-history')){if(failed&&p.includes(other))return route.fulfill({status:503,json:{error:'Fonte temporariamente indisponível'}});return route.fulfill({json:{items:[p.includes(other)?prior:own]}});}
   if(p.endsWith('/warlog'))return route.fulfill({json:{items:[{endTime:stale&&!p.includes(other)?'20261028T000000.000Z':(p.includes(other)?prior:own).endTime,opponent:stale&&!p.includes(other)?{tag:'#2RGUJ2QLV',name:'Black Emirates'}:(p.includes(other)?prior:own).opponent}]}});
   if(p.endsWith('/wars'))return route.fulfill({json:{items:[own]}});
   if(p.endsWith('/currentwar'))return route.fulfill({json:{state:'notInWar'}});
   if(p==='/api/clans/#'+selected)return route.fulfill({json:{tag:'#'+selected,name:'Clã selecionado',memberList:prior.clan.members.map((m,i)=>({...m,clanRank:i+1,trophies:5000-i,role:'member',townHallLevel:18}))}});
   return route.fulfill({json:{authenticated:false,ok:true}});
  });
  await page.goto(origin+'/?clan='+selected);await page.waitForFunction(()=>window.ClanManager?.state.members.length&&!window.ClanManager.state.loading);
  assert(calls.some(p=>p.includes(other)&&p.endsWith('/score-history')));
  assert.equal(await page.evaluate(()=>window.ClanManager.state.settings.usePlayerHistoryFallback),false);
  await page.locator('#roster-search').fill('CARLOSSTS');const row=page.locator(`[data-player="${player}"]`);
  assert(await row.getByText('Histórico dos clãs aprovado',{exact:true}).isVisible());assert.equal(await row.locator('.gold-stat b').innerText(),'6');
  await row.locator('summary').click();assert((await row.locator('.detail-copy').innerText()).includes(prior.clan.name));
  const tsv=await page.evaluate(()=>window.ClanManager.selectionTSV());assert(tsv.includes('Histórico dos clãs: '+prior.clan.name));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.screenshot({path:'.wrangler/cwl-ui-review/family-history-'+selected+'-'+width+'.png'});
  await page.evaluate(tag=>{const k='clashspot-war-selector-v1:'+tag;const settings=JSON.parse(localStorage.getItem(k));settings.usePlayerHistoryFallback=true;localStorage.setItem(k,JSON.stringify(settings));},selected);
  stale=true;await page.reload();await page.waitForFunction(()=>window.ClanManager?.state.members.length&&!window.ClanManager.state.loading);
  const staleResult=await page.evaluate(tag=>{const s=window.ClanManager.state,r=s.selection.all.find(r=>r.member.tag===tag);return{known:Boolean(r.criteriaPerf),eligible:r.eligible,warnings:s.dataWarnings};},player);
  assert.equal(staleResult.known,false);assert(staleResult.eligible);assert(staleResult.warnings.some(w=>w.includes('Black Emirates')));
  await page.locator('#roster-search').fill('CARLOSSTS');assert(await page.getByText('Histórico recente indisponível',{exact:true}).isVisible());
  stale=false;
  prior.clan.members[0].attacks=[];prior.clan.attacks=0;
  await page.reload();await page.waitForFunction(()=>window.ClanManager?.state.members.length&&!window.ClanManager.state.loading);
  await page.locator('[data-filter=all]').click();await page.locator('#roster-search').fill('CARLOSSTS');
  assert.equal(await page.locator(`[data-player="${player}"] .attack-stat small`).count(),2);
  assert.equal(await page.locator(`[data-player="${player}"] .gold-stat b`).innerText(),'0');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  if(width===390)await page.screenshot({path:'.wrangler/cwl-ui-review/family-no-attacks-'+selected+'.png'});
  failed=true;await page.reload();await page.waitForFunction(()=>window.ClanManager?.state.members.length&&!window.ClanManager.state.loading);
  const result=await page.evaluate(tag=>{const s=window.ClanManager.state;const r=s.selection.all.find(r=>r.member.tag===tag);return{known:Boolean(r.criteriaPerf),eligible:r.eligible,warnings:s.dataWarnings};},player);
  assert.equal(result.known,false);assert(result.eligible);assert(result.warnings.some(w=>w.includes('parcial')));assert.deepEqual(errors,[]);
  await context.close();console.log('PASS managed-clan transfer, stars/TSV/source and partial history at '+width+'px for '+selected);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
