import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { leagueOrdinalMap,WEEK } from './data.mjs';
const out=path.resolve(process.argv[2]||'../output/atq-ranked-2026-10-28'),read=f=>JSON.parse(fs.readFileSync(f));
const spot=read(out+'/clashspot.json'),ranks=leagueOrdinalMap(read(out+'/sources/leaguetiers.json').data.items);
const rank=name=>name==='Legend III'?34:name==='Legend II'?35:name==='Legend I'?36:Number(name?.match(/\d+/)?.[0]);
const checks={matchedWeeklyRows:0,comparedGroups:0,mismatches:[],invalidGroups:[],seasonLabelMeans:'end date; official season ID means start date'};
for(const s of spot.clans){const end=Date.parse(new URL(s.url).searchParams.get('season')+'T05:00Z'),start=end-WEEK;for(const r of s.rows){const tag=r.links.find(u=>/\/player\/[^/]+\/view/.test(u))?.split('/')[3],f=out+'/sources/leaguehistory-'+tag+'.json';if(!fs.existsSync(f))continue;const h=read(f).data?.items?.find(h=>h.leagueSeasonId*1000===start);if(!h)continue;const [n,N]=r.cells[5].split('/').map(Number),league=rank(r.titles.find(t=>!/^(TH|BH) /.test(t)&&(/Legend/.test(t)||/\d+$/.test(t))));if(n!==h.attackWins+h.attackLosses||N!==h.maxBattles||league!==ranks.get(h.leagueTierId))checks.mismatches.push({tag,date:new Date(end).toISOString(),site:{n,N,league},official:{n:h.attackWins+h.attackLosses,N:h.maxBattles,league:ranks.get(h.leagueTierId)}});else checks.matchedWeeklyRows++;}}
for(const g of spot.groups){const parts=new URL(g.url).pathname.split('/'),tag=parts[3],start=Date.parse(parts.at(-1)+'T05:00Z')-WEEK,actual=g.attacks.filter(a=>a.opponent),numbers=g.summary?.trim().split(/\s+/).slice(0,2).map(Number)||[];if(actual.length!==numbers[0]||actual.reduce((n,a)=>n+a.stars,0)!==numbers[1])checks.invalidGroups.push({tag,url:g.url,actual:actual.length,expected:numbers[0]});
  const f=out+'/sources/group-'+tag+'-'+start/1000+'.json';if(!fs.existsSync(f))continue;const official=read(f).data?.attackLogs;if(!official)continue;checks.comparedGroups++;const rows=x=>x.map(a=>[a.opponent??a.opponentPlayerTag?.slice(1),a.stars,a.destruction??a.destructionPercentage].join('|')).sort();if(JSON.stringify(rows(actual))!==JSON.stringify(rows(official)))checks.mismatches.push({tag,url:g.url,reason:'official_group_differs'});
}
fs.writeFileSync(out+'/source-checks.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));assert.equal(checks.mismatches.length,0,'Cross-source mismatch must be investigated');assert.equal(checks.invalidGroups.length,0,'Incomplete DOM group must not train Q');
