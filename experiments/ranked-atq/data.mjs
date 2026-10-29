import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WarScores as S, ClashKing as C } from '../../src/cwl/scoring.js';
import { sustained } from './model.mjs';
export const WEEK=7*86400000, clean=x=>String(x||'').replace(/^#/,'').toUpperCase();
const read=f=>JSON.parse(fs.readFileSync(f)), time=C.timestamp;
export const warKey=w=>[clean(w.clan.tag),clean(w.opponent.tag)].sort().join('|')+'|'+w.startTime;
export const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const leagueOrdinalMap=tiers=>new Map([...tiers].filter(t=>t.name!=='Unranked').sort((a,b)=>a.id-b.id).map((t,i)=>[t.id,i+1]));
export const profileLeagueAfterWeek=(p,observed,end,ranks)=>observed>=end&&observed<end+WEEK?ranks.get(p?.leagueTier?.id)??null:null;
export function loadData(root){
  const files=[], visit=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(/-(random|cwl)\.json$/.test(e.name))files.push(p);}};
  for(const dir of ['cwl-baseline-2026-10-25','cwl-improvement-2026-10-25','cwl-validation-2026-10-25'])visit(path.resolve(root,'..',dir));
  visit(root+'/sources');
  const wars=new Map(), sources=[];
  function add(raw,type){if(!raw.clan?.members||!raw.opponent?.members||raw.state!=='warEnded')return;const w={...raw,type:raw.type||type};const old=wars.get(warKey(w));if(!old||S.historyQuality(w)>S.historyQuality(old)||S.historyQuality(w)===S.historyQuality(old)&&JSON.stringify(w).length>JSON.stringify(old).length)wars.set(warKey(w),w);}
  for(const f of files){const e=read(f);if(!e.data?.items)continue;sources.push({file:f,sha256:hash(fs.readFileSync(f,'utf8'))});for(const w of e.data.items)add(w,e.type||(/-cwl/.test(f)?'cwl':'random'));}
  const archive=root+'/sources/own-archive.json';if(fs.existsSync(archive))for(const r of read(archive).data||[])if(r.final){const w=r.payload;const old=wars.get(warKey(w));if(!old||S.historyQuality(w)>=S.historyQuality(old))wars.set(warKey(w),w);}
  const profiles=new Map(),profileObserved=new Map(), histories=new Map(), groups=[];
  for(const file of fs.readdirSync(root+'/sources')){const p=root+'/sources/'+file,e=read(p);if(!e.data)continue;if(file.startsWith('profile-')){profiles.set(clean(e.data.tag),e.data);profileObserved.set(clean(e.data.tag),Date.parse(e.fetchedAt));}if(file.startsWith('leaguehistory-'))histories.set(file.slice(14,-5),e.data.items);if(file.startsWith('group-'))groups.push({tag:file.split('-')[1],weekStart:Number(file.split('-')[2].replace('.json',''))*1000,...e.data});}
  const tiers=read(root+'/sources/leaguetiers.json').data.items;
  const ranks=leagueOrdinalMap(tiers);
  const leagueRank=name=>{const direct=tiers.find(t=>t.name===name);if(direct)return ranks.get(direct.id);const n=Number(name?.match(/\d+/)?.[0]);return Number.isInteger(n)&&n>0?n:name==='Legend III'?34:name==='Legend II'?35:name==='Legend I'?36:null;};
  const family=[...new Set(['2G8QCR92V','2CQ9CR2YP'].flatMap(t=>(read(root+'/sources/clan-'+t+'.json').data.memberList||[]).map(p=>clean(p.tag))))];
  const ths=new Map();for(const w of wars.values())for(const p of [w.clan,w.opponent].flatMap(s=>s.members)){const tag=clean(p.tag);if(!ths.has(tag))ths.set(tag,[]);ths.get(tag).push({at:time(w.preparationStartTime)||time(w.startTime),th:p.townhallLevel??p.townHallLevel});}
  for(const rows of ths.values())rows.sort((a,b)=>a.at-b.at);
  function historicalTH(tag,start,end){tag=clean(tag);const observations=ths.get(tag)||[];const before=observations.filter(x=>x.at<=start).at(-1);const after=observations.find(x=>x.at>=end);const current=profiles.get(tag)?.townHallLevel;
    if(new Set(observations.filter(x=>x.at>=start&&x.at<end).map(x=>x.th)).size>1)return {th:current||after?.th||null,status:'changed'};
    if(before&&((after&&after.th===before.th)||current===before.th))return {th:before.th,status:'bounded'};
    return {th:current||after?.th||before?.th||null,status:before&&after&&before.th!==after.th?'changed_or_unknown':'unverified'};
  }
  const rows=new Map();
  for(const [tag,h] of histories){for(const item of h||[]){const start=item.leagueSeasonId*1000,end=start+WEEK;const next=h.find(x=>x.leagueSeasonId*1000===end),p=profiles.get(tag);const current=next?ranks.get(next.leagueTierId):profileLeagueAfterWeek(p,profileObserved.get(tag),end,ranks);const th=historicalTH(tag,start,end);rows.set(tag+'|'+start,{tag,weekStart:start,weekEnd:end,previousLeague:ranks.get(item.leagueTierId),currentLeague:current,n:item.attackWins+item.attackLosses,maxBattles:item.maxBattles,th:th.th,thStatus:th.status,source:'official'});}}
  const spot=fs.existsSync(root+'/clashspot.json')?read(root+'/clashspot.json'):{clans:[],groups:[]};
  const observedFamily=new Map();
  for(const season of spot.clans){const end=Date.parse(new URL(season.url).searchParams.get('season')+'T05:00:00Z'),start=end-WEEK;if(!observedFamily.has(start))observedFamily.set(start,new Set());for(const r of season.rows){const tag=r.links.find(l=>/\/player\/[^/]+\/view/.test(l))?.split('/')[3];if(!tag)continue;observedFamily.get(start).add(tag);const [n,maxBattles]=r.cells[5].split('/').map(Number),th=historicalTH(tag,start,end);const k=tag+'|'+start,league=leagueRank(r.titles.find(t=>!/^(TH|BH) /.test(t)&&(/Legend/.test(t)||/\d+$/.test(t))));if(!rows.has(k))rows.set(k,{tag,weekStart:start,weekEnd:end,previousLeague:league,currentLeague:null,n,maxBattles,th:th.th,thStatus:th.status,source:'clashspot',aggregateStars:Number(r.cells[6])});}}
  for(const r of rows.values())if(r.currentLeague==null)r.currentLeague=rows.get(r.tag+'|'+r.weekEnd)?.previousLeague??null;
  const attacks=[];
  for(const g of groups){const row=rows.get(g.tag+'|'+g.weekStart);if(!row||g.attackLogs.length!==row.n)continue;for(const a of g.attackLogs){const def=historicalTH(clean(a.opponentPlayerTag),row.weekStart,row.weekEnd);attacks.push({playerTag:g.tag,weekStart:row.weekStart,league:row.previousLeague,context:'tier-week:'+row.previousLeague+':'+row.weekStart,attackerTH:row.th,defenderTH:def.th,attackerChanged:row.thStatus==='changed',defenderChanged:def.status==='changed',thStatus:row.thStatus==='bounded'&&def.status==='bounded'?'bounded':'unverified',stars:a.stars,source:'official'});}}
  for(const g of spot.groups){const parts=new URL(g.url).pathname.split('/'),tag=parts[3],end=Date.parse(parts.at(-1)+'T05:00:00Z'),start=end-WEEK,row=rows.get(tag+'|'+start);if(!row||attacks.some(a=>a.playerTag===tag&&a.weekStart===start))continue;const actual=g.attacks.filter(a=>a.opponent),ns=g.summary?.split(/\s+/).filter(Boolean).slice(0,2).map(Number)||[];if(actual.length!==row.n||ns[0]!==row.n||actual.reduce((n,a)=>n+a.stars,0)!==ns[1])continue;for(const a of actual){const def=historicalTH(a.opponent,start,end);attacks.push({playerTag:tag,weekStart:start,league:row.previousLeague,context:'tier-week:'+row.previousLeague+':'+start,attackerTH:row.th,defenderTH:a.defenderTH,attackerChanged:row.thStatus==='changed',defenderChanged:def.status==='changed',thStatus:row.thStatus==='bounded'&&def.status==='bounded'&&def.th===a.defenderTH?'bounded':'displayed',stars:a.stars,source:'clashspot'});}}
  const byPlayer=new Map(),byClan=new Map();for(const w of wars.values()){for(const s of [w.clan,w.opponent]){const c=clean(s.tag);if(!byClan.has(c))byClan.set(c,[]);byClan.get(c).push(w);for(const p of s.members){const t=clean(p.tag);if(!byPlayer.has(t))byPlayer.set(t,[]);byPlayer.get(t).push(w);}}}
  return {wars:[...wars.values()],profiles,profileObserved,ranks,rows,attacks,family,observedFamily,historicalTH,byPlayer,byClan,sources,spot};
}

export function weekFeatures(data,cutoff,config={}){
  const available=[...new Set([...data.rows.values()].map(r=>r.weekEnd))].filter(t=>t<=cutoff).sort((a,b)=>b-a);
  const end=available[0];if(!end||cutoff-end>=WEEK)return new Map();const start=end-WEEK;
  const members=config.cohort==='historical'?data.observedFamily.get(start)||new Set():data.family;
  const cohort=[];for(const tag of members){const r=data.rows.get(tag+'|'+start),next=data.rows.get(tag+'|'+end);const th=data.historicalTH(tag,start,end);const p=r?sustained(r.previousLeague,r.currentLeague,config.promotion??.5):next?.previousLeague??profileLeagueAfterWeek(data.profiles.get(tag),data.profileObserved.get(tag),end,data.ranks);if(p!=null&&th.th&&th.status!=='changed')cohort.push({tag,th:th.th,position:p});}
  const memberSet=new Set(members);
  return {end,start,cohort,rows:[...data.rows.values()].filter(r=>r.weekStart===start).map(r=>({...r,cutoff})),attacks:data.attacks.filter(a=>a.weekStart===start).map(a=>({...a,referenceEligible:memberSet.has(a.playerTag)}))};
}
