import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchOfficial,officialJson} from '../src/official-api.js';
import {createWorker} from '../src/worker.js';
import {sourceProxy} from '../src/cwl/source-proxy.js';
const key='synthetic-test-secret-not-a-real-token',env={COC_API_MODE:'royaleapi',COC_WORKER_API_KEY:key};
test('dedicated proxy key is sent only to the fixed RoyaleAPI destination, with no redirect or cache',async()=>{
 await officialJson('/v1/players/%239LLJR22U/leaguehistory',env,async(url,options)=>{
  assert.equal(new URL(url).origin,'https://cocproxy.royaleapi.dev');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.redirect,'manual');assert.equal(options.cf.cacheTtl,0);assert.equal(options.headers.Cookie,undefined);return Response.json({items:[]});
 });
 await assert.rejects(fetchOfficial('https://evil.invalid/v1/players/%239LLJR22U',env),e=>e.status===400);
 await assert.rejects(fetchOfficial('/v1/players/%239LLJR22U?url=https://evil.invalid',env),e=>e.status===400);
 await assert.rejects(fetchOfficial('/v1/players/%239LLJR22U/verifytoken',env),e=>e.status===400);
 await assert.rejects(fetchOfficial('/v1/players/%239LLJR22U',{COC_API_MODE:'royaleapi',COC_API_KEY:key}),e=>e.status===503);
});
test('provider credentials and upstream error text never enter client-facing errors',async()=>{
 for(const status of [302,403,429,500])await assert.rejects(fetchOfficial('/v1/players/%239LLJR22U',env,async()=>new Response(key,{status,headers:{Location:'https://evil.invalid'}})),e=>!e.message.includes(key)&&e.status===(status===403||status===429?status:502));
});
test('official public routes bypass the old cache, keep clan data fresh and reduce ranked payloads',async()=>{
 const original=globalThis.fetch,originalCache=globalThis.caches,log=console.log;
 let queries=0;const logs=[];console.log=x=>logs.push(x);globalThis.caches={get default(){throw Error('official requests must not use archive cache')}};
 globalThis.fetch=async(url,options)=>{
  queries++;assert.equal(new URL(url).origin,'https://cocproxy.royaleapi.dev');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.headers.Cookie,undefined);
  const path=decodeURIComponent(new URL(url).pathname);
  return Response.json(path.endsWith('/leaguehistory')?{items:[{leagueSeasonId:1792386000,leagueTierId:105000034,attackStars:0,internal:'omit'}]}
   :path.includes('/leaguegroup/')?{members:[{playerTag:'#9LLJR22U',leagueTrophies:1022},{playerTag:'#OTHER'}],attackLogs:[{stars:3}],defenseLogs:[]}
   :path.endsWith('/warlog')?{items:[{endTime:'20261028T152623.000Z',teamSize:35,opponent:{tag:'#2RGUJ2QLV',name:'Black Emirates'}}]}
   :path.includes('/clans/')?{tag:'#2G8QCR92V',name:'Principal',memberList:[]}
   :{tag:'#9LLJR22U',name:'Jogador',townHallLevel:18,warPreference:'in',clan:{tag:'#2G8QCR92V'},currentLeagueGroupTag:'#ABC123',currentLeagueSeasonId:1792990800});
 };
 try{
  const worker=createWorker(),ctx={waitUntil(){}};
  const get=async path=>{const r=await worker.fetch(new Request('https://app.test'+path,{headers:{Cookie:'do-not-forward',Authorization:'Bearer browser-token'}}),env,ctx);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');const text=await r.text();assert(!text.includes(key));return JSON.parse(text)};
  const first=await get('/api/clans/%232G8QCR92V/warlog');assert.equal(first.items[0].opponent.name,'Black Emirates');
  const before=queries;await get('/api/clans/%232G8QCR92V/warlog');assert.equal(queries,before+1);
  const history=await get('/api/players/%239LLJR22U/league-history');assert.equal(history.items[0].attackStars,0);assert.equal(history.items[0].internal,undefined);
  const group=await get('/api/players/%239LLJR22U/league-group');assert.equal(group.member.playerTag,'#9LLJR22U');assert.equal(group.attackLogs[0].stars,3);assert.equal(group.members,undefined);
  assert(logs.every(entry=>!JSON.stringify(entry).includes(key)));
 }finally{globalThis.fetch=original;globalThis.caches=originalCache;console.log=log;}
});
test('CWL source bridge uses official current war and never forwards the key to history APIs',async()=>{
 const path='https://clashapi.colinschmale.dev/v1/clans/%232G8QCR92V/currentwar';
 const result=await sourceProxy(new Request('https://app.test/api/cwl/source?url='+encodeURIComponent(path)),async(url,options)=>{assert.equal(new URL(url).hostname,'cocproxy.royaleapi.dev');assert.equal(options.headers.Authorization,'Bearer '+key);return Response.json({state:'preparation'});},env);
 assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal((await result.json()).state,'preparation');
 const history='https://api.clashk.ing/v2/clan/%232G8QCR92V/wars?limit=35&type=cwl';
 await sourceProxy(new Request('https://app.test/api/cwl/source?url='+encodeURIComponent(history)),async(url,options)=>{assert.equal(new URL(url).hostname,'api.clashk.ing');assert.equal(options.headers.Authorization,undefined);return Response.json({items:[]});},env);
});

test('private warlogs are distinguished from an invalid production key',async()=>{
 await assert.rejects(fetchOfficial('/v1/clans/%232CQ9CR2YP/warlog?limit=5',env,async()=>Response.json({reason:'accessDenied',message:'Clan war log is private'},{status:403})),e=>e.status===403&&e.message.includes('privado'));
 await assert.rejects(fetchOfficial('/v1/clans/%232CQ9CR2YP/warlog?limit=5',env,async()=>Response.json({reason:'accessDenied'},{status:403})),e=>e.status===403&&e.message.includes('privado')&&!e.message.includes('IP'));
});

test('CWL round details and group discovery use bounded authenticated official paths',async()=>{
 for(const path of ['/v1/clanwarleagues/wars/%238G2GCP2RU','/v1/clans/%232G8QCR92V/currentwar/leaguegroup']){
  const r=await officialJson(path,env,async(url,opts)=>{assert.equal(new URL(url).hostname,'cocproxy.royaleapi.dev');assert.equal(opts.headers.Authorization,'Bearer '+key);return Response.json({state:'warEnded',clan:{members:[{attacks:[{stars:3}]}]}});});
  assert.equal(r.data.clan.members[0].attacks[0].stars,3);
 }
});
