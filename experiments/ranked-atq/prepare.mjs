import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WarScores as S,ClashKing as C } from '../../src/cwl/scoring.js';
import { loadData,clean,warKey,hash } from './data.mjs';
const out=path.resolve(process.argv[2]||'../output/atq-ranked-2026-10-28');
const data=loadData(out), family=new Set(['2G8QCR92V','2CQ9CR2YP']);
const targets=data.wars.filter(w=>C.timestamp(w.startTime)>=Date.parse('2026-09-01')&&C.timestamp(w.endTime)<Date.now()&&S.historyQuality(w)&&[w.clan,w.opponent].some(c=>family.has(clean(c.tag)))).sort((a,b)=>C.timestamp(a.startTime)-C.timestamp(b.startTime));
fs.mkdirSync(out+'/models',{recursive:true});
const modelSource=fs.readFileSync('public/portal/war-scores.js','utf8');
const poolHash=hash([...data.wars].sort((a,b)=>warKey(a).localeCompare(warKey(b))).map(w=>hash(w)));
const manifest={baselineVersion:S.VERSION,baselineSourceHash:hash(modelSource),poolHash,poolWars:data.wars.length,targets:[],skipped:[]};
let done=0;
for(const raw of targets){const clan=[raw.clan,raw.opponent].find(c=>family.has(clean(c.tag))).tag;const war=C.normalizeWar(raw,clean(clan)),cutoff=C.timestamp(war.startTime),current=[...war.roster,...war.opponentRoster];
  const selected=new Map();for(const t of [raw.clan.tag,raw.opponent.tag])for(const w of data.byClan.get(clean(t))||[])selected.set(warKey(w),w);
  for(const p of current)for(const w of data.byPlayer.get(clean(p.tag))||[])selected.set(warKey(w),w);
  const earliest=new Date(cutoff);earliest.setUTCDate(1);earliest.setUTCMonth(earliest.getUTCMonth()-2);
  const history=[...selected.values()].filter(w=>C.timestamp(w.endTime)<=cutoff&&C.timestamp(w.startTime)<cutoff&&C.timestamp(w.endTime)>=((w.type||'random')==='cwl'?earliest.getTime():cutoff-14*86400000));
  const key=warKey(raw),id=hash(key).slice(0,16),file=out+'/models/'+id+'.json',stamp=hash([manifest.baselineSourceHash,poolHash,key]);
  try {let record;
    if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).stamp===stamp)record=JSON.parse(fs.readFileSync(file));
    else {const model=S.fit({war,history});assert(model.events.every(e=>C.timestamp(e.endTime)<=cutoff&&e.warKey!==key));record={stamp,key,clan:clean(clan),war,model,raw};fs.writeFileSync(file,JSON.stringify(record));}
    manifest.targets.push({file,id,key,clan:clean(clan),start:war.startTime,type:record.model.context.type,events:record.model.events.length});
  }catch(e){manifest.skipped.push({key,reason:e.message});}
  console.log(JSON.stringify({stage:'models',done:++done,total:targets.length,war:war.startTime,events:manifest.targets.at(-1)?.events}));
}
fs.writeFileSync(out+'/models-manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({stage:'prepared',pool:data.wars.length,targets:manifest.targets.length,skipped:manifest.skipped.length}));
