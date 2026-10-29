import { RankedScores as R } from '../src/cwl/scoring.js';
import { fixture,historyFor } from './cwl-fixtures.mjs';
export function rankedFixture(){
  const raw=fixture();for(const side of [raw.clan,raw.opponent])for(const p of side.members)p.townhallLevel=18;
  const history=historyFor(raw), now=Date.parse('2026-10-24T10:00:00Z'), end=R.weekOf(now), start=end-R.WEEK;
  const rows=[...raw.clan.members,...raw.opponent.members].map((p,i)=>({tag:p.tag.slice(1),th:18,league:i?34:35,observedAt:now,
    history:[{weekStart:start,league:i?34:35,n:24,maxBattles:24}],group:{weekStart:start,attacks:Array.from({length:24},(_,j)=>({defenderTag:raw.opponent.members[0].tag.slice(1),stars:i%2?2:3,time:start+3600000+j*1000}))}}));
  const packets=[{version:1,kind:'family',fetchedAt:now,items:rows.slice(0,5).map(p=>({tag:p.tag}))},
    ...Array.from({length:Math.ceil(rows.length/3)},(_,i)=>({version:1,kind:'players',fetchedAt:now,items:rows.slice(i*3,i*3+3)}))];
  return {raw,history,now,ranked:{packets,fetchedAt:now}};
}
