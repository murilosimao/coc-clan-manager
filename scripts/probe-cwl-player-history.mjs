import fs from 'node:fs';
import crypto from 'node:crypto';
import { ClashCwlProvider } from '../src/cwl/provider.js';
import { ClashKing as C, WarScores as S } from '../src/cwl/scoring.js';
const root='/private/tmp/clash/output/cwl-improvement-2026-10-25',base='/private/tmp/clash/output/cwl-baseline-2026-10-25';
fs.mkdirSync(root+'/player-requests',{recursive:true});fs.mkdirSync(root+'/production-history',{recursive:true});
const fetcher=async(url,options)=>{
  const u=new URL(url),m=decodeURIComponent(u.pathname).match(/^\/v2\/clan\/#([^/]+)\/wars$/);
  if(m){const file=base+'/sources/'+m[1]+'-'+u.searchParams.get('type')+'.json';if(fs.existsSync(file)){const e=JSON.parse(fs.readFileSync(file));return Response.json(e.data,{status:e.status||200});}}
  const file=root+'/player-requests/'+crypto.createHash('sha256').update(url).digest('hex')+'.json';
  let e;if(fs.existsSync(file))e=JSON.parse(fs.readFileSync(file));else{const r=await fetch(url,options);e={url,status:r.status,fetchedAt:new Date().toISOString(),data:await r.json()};fs.writeFileSync(file,JSON.stringify(e));}
  return Response.json(e.data,{status:e.status});
};
const wars=JSON.parse(fs.readFileSync(base+'/sources/2G8QCR92V-cwl.json')).data.items.filter(w=>w.preparationStartTime.startsWith('202610')).sort((a,b)=>C.timestamp(a.startTime)-C.timestamp(b.startTime));
const summary=[];
for(const raw of [wars[0],wars.at(-1)]){
  const p=new ClashCwlProvider(fetcher),war=C.normalizeWar({...raw,type:'cwl'},'2G8QCR92V');
  const baseHistory=[raw.clan.tag,raw.opponent.tag].flatMap(t=>['random','cwl'].flatMap(type=>JSON.parse(fs.readFileSync(`${base}/sources/${t.slice(1)}-${type}.json`)).data.items.map(w=>({...w,type:w.type||type}))));
  const result=await p.training(raw),before=S.fit({war,history:baseHistory}),after=S.fit({war,history:result.history});
  const count=model=>war.roster.reduce((n,p)=>{const r=S.rating(model,p);return n+Number(r.attackCount>=5&&r.attackWeight>=2)},0);
  summary.push({start:raw.startTime,baseWars:baseHistory.length,expandedWars:result.history.length,baseEvents:before.events.length,expandedEvents:after.events.length,
    ownAttackersWithEvidenceBefore:count(before),ownAttackersWithEvidenceAfter:count(after),requests:result.sources.filter(s=>s.type==='player_war_references').length,
    newWars:result.sources.filter(s=>s.type==='player_complete_war'&&s.available).length,warnings:result.warnings});
  fs.writeFileSync(`${root}/production-history/2G8QCR92V-${raw.startTime}.json`,JSON.stringify(result));console.log(JSON.stringify(summary.at(-1)));
}
fs.writeFileSync(root+'/production-history-summary.json',JSON.stringify(summary,null,2));
