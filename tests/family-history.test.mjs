import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const box={};box.window=box;vm.createContext(box);
for(const file of ['clashking.js','war-engine.js','war-stats.js'])vm.runInContext(fs.readFileSync(new URL('../public/portal/'+file,import.meta.url),'utf8'),box);
import {tags,player,fixture} from './family-war-fixture.mjs';

const managed=(wars,now=Date.parse('2026-10-28T00:00Z'))=>box.WarStats.managedClanHistory(wars,tags,now);
const select=(history,lastWar=null)=>box.WarEngine.selectTeam([{tag:player,name:'CARLOSSTS',th:18,pref:'in',position:1,trophies:5000}],lastWar,box.WarEngine.DEFAULT_SETTINGS,null,new Map(),new Map(),history).all[0];
test('transfer retains two attacks and six stars with external-history flag off',()=>{
 const h=managed([fixture()]);const r=select(h);assert.equal(r.attacks,2);assert.equal(r.stars,6);assert(r.usedManagedHistory);assert(r.eligible);assert.equal(r.historyWar.clan.tag,tags[1]);
});
test('newest participation wins across clans, including zero attacks',()=>{
 const h=managed([fixture(tags[1],'20261020T000000.000Z'),fixture(tags[0],'20261021T000000.000Z',[])]);const r=select(h);assert.equal(r.attacks,0);assert.equal(r.stars,0);assert(!r.eligible);assert.equal(r.historyWar.clan.tag,tags[0]);
});
test('newer last-clan failure is never replaced with an older successful history',()=>{
 const h=managed([fixture()]);const last=box.WarEngine.buildWar(box.ClashKing.normalizeWar(fixture(tags[0],'20261022T000000.000Z',[]),tags[0]));const r=select(h,last);assert(!r.usedManagedHistory);assert.equal(r.attacks,0);assert(!r.eligible);
});
test('a newer other-clan failure replaces older last-clan success',()=>{
 const h=managed([fixture(tags[1],'20261022T000000.000Z',[])]);const last=box.WarEngine.buildWar(box.ClashKing.normalizeWar(fixture(tags[0]),tags[0]));const r=select(h,last);assert(r.usedManagedHistory);assert.equal(r.attacks,0);assert(!r.eligible);
});
test('unknown, incomplete, CWL, future and external-clan wars do not create evidence',()=>{
 const missing=fixture();missing.clan.attacks=3;const cwl=fixture();cwl.type='cwl';const unknown=fixture();delete unknown.clan.members[0].attacks[0].stars;
 assert.equal(managed([missing,cwl,unknown,fixture(tags[0],'20261029T000000.000Z'),fixture('2RYQYUQ8J')]).size,0);
 const r=select(new Map());assert.equal(r.criteriaPerf,null);assert(r.eligible);
});
test('opponent-side clan orientation preserves the player and origin',()=>{
 const raw=fixture();[raw.clan,raw.opponent]=[raw.opponent,raw.clan];const r=select(managed([raw]));assert.equal(r.attacks,2);assert.equal(r.historyWar.clan.tag,tags[1]);
});
