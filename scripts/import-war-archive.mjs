// One-off retroactive fill of cwl.war_archive. Wars that ClashKing still has
// come from ClashKing; the rest come from a Clash Spot export made in the
// browser (its pages are behind a Cloudflare challenge). Every war goes
// through the same reduceWar validation as the live capture, the official
// warlog must agree with the scores, and existing captures are never replaced.
// Usage: node --env-file=.env.supabase --env-file=../.env scripts/import-war-archive.mjs <export.json> [--apply]
import fs from 'node:fs';
import { reduceWar } from '../src/cwl/war-archive.js';
import { timestamp } from '../src/cwl/errors.js';
import { withDatabase } from '../src/cwl/database.js';

const MINUTE = 60000, HOUR = 3600000;
const iso = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '.000Z');

// Clash Spot shows minutes only. The official warlog gives the exact end; the
// battle starts 24h before it unless the clock was shifted, and preparation
// starts 23h before the battle.
export function clashspotToOfficial(war, exactEnd) {
  const end = exactEnd ?? Date.parse(war.endedOn);
  const shownStart = Date.parse(war.startedOn), shownMatch = Date.parse(war.matchOn);
  const start = Math.abs(end - 24 * HOUR - shownStart) < MINUTE ? end - 24 * HOUR : shownStart;
  const prep = Math.abs(start - 23 * HOUR - shownMatch) < MINUTE ? start - 23 * HOUR : shownMatch;
  const byTag = new Map();
  const side = value => ({ tag: '#' + value.tag, name: value.name, members: value.members.map(([tag, name, townhallLevel, mapPosition]) => {
    const member = { tag: '#' + tag, name, townhallLevel, mapPosition, attacks: [] };
    byTag.set(tag, { member, side: value.tag });
    return member;
  }) });
  const clan = side(war.clan), opponent = side(war.opponent);
  const best = new Map();
  for (const [order, attacker, defender, stars, destructionPercentage] of [...war.attacks].sort((a, b) => a[0] - b[0])) {
    const from = byTag.get(attacker), to = byTag.get(defender);
    if (!from || !to || from.side === to.side) throw new Error(`Ataque ${order} com jogadores fora dos elencos.`);
    from.member.attacks.push({ attackerTag: '#' + attacker, defenderTag: '#' + defender, stars, destructionPercentage, order });
    const previous = best.get(defender) || { stars: 0, pct: 0 };
    best.set(defender, { stars: Math.max(previous.stars, stars), pct: Math.max(previous.pct, destructionPercentage) });
  }
  for (const [target, defenders] of [[clan, opponent], [opponent, clan]]) {
    target.attacks = target.members.reduce((n, m) => n + m.attacks.length, 0);
    const hits = defenders.members.map(m => best.get(m.tag.slice(1)) || { stars: 0, pct: 0 });
    target.stars = hits.reduce((n, h) => n + h.stars, 0);
    target.destructionPercentage = Math.round(hits.reduce((n, h) => n + h.pct, 0) / war.teamSize * 1e5) / 1e5;
  }
  return { state: 'warEnded', teamSize: war.teamSize, attacksPerMember: war.attacksPerMember, battleModifier: 'none',
    preparationStartTime: iso(prep), startTime: iso(start), endTime: iso(end), clan, opponent };
}

async function officialWarlog(tag) {
  const key = process.env.COC_API_KEY;
  if (!key) throw new Error('COC_API_KEY é necessária para conferir o warlog oficial.');
  const response = await fetch(`https://api.clashofclans.com/v1/clans/${encodeURIComponent('#' + tag)}/warlog?limit=30`, { headers: { Authorization: 'Bearer ' + key } });
  if (!response.ok) throw new Error('Warlog oficial indisponível: ' + response.status);
  return (await response.json()).items;
}

async function clashkingWars(tag) {
  const response = await fetch(`https://api.clashk.ing/v2/clan/${encodeURIComponent('#' + tag)}/wars?limit=30&type=random`);
  if (!response.ok) throw new Error('ClashKing indisponível: ' + response.status);
  return (await response.json()).items;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [file] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const apply = process.argv.includes('--apply');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tag = data.clanTag;
  const [warlog, clashking] = await Promise.all([officialWarlog(tag), clashkingWars(tag)]);
  const near = (a, b) => Math.abs(timestamp(a) - b) < 2 * MINUTE;
  const plan = [];
  for (const war of data.wars) {
    const shownEnd = Date.parse(war.endedOn);
    const official = warlog.find(item => near(item.endTime, shownEnd) && item.opponent?.tag === '#' + war.opponent.tag);
    const ck = clashking.find(item => near(item.endTime, shownEnd) && item.opponent?.tag === '#' + war.opponent.tag);
    const source = ck ? 'clashking' : 'clashspot';
    const reduced = reduceWar(ck || clashspotToOfficial(war, official ? timestamp(official.endTime) : undefined), tag, 'clan');
    if (official) {
      // The official log is the authority for totals; any disagreement stops the import.
      const same = official.clan.stars === reduced.clan.stars && official.opponent.stars === reduced.opponent.stars
        && official.clan.attacks === reduced.clan.attacks && Math.abs(official.clan.destructionPercentage - reduced.clan.destructionPercentage) < 0.01;
      if (!same) throw new Error(`Placar divergente do warlog oficial em ${war.endedOn} (${war.opponent.name}).`);
    } else if (source === 'clashspot') throw new Error(`Guerra do Clash Spot sem confirmação no warlog oficial: ${war.endedOn}.`);
    plan.push({ war: reduced, source, warlog: Boolean(official) });
  }
  const summary = plan.map(p => `${p.war.endTime} ${p.source.padEnd(9)} ${p.war.opponent.name.slice(0, 16).padEnd(16)} ${p.war.clan.attacks}/${p.war.teamSize * p.war.attacksPerMember} ataques ${p.war.clan.stars}★ warlog=${p.warlog}`);
  console.log(summary.join('\n'));
  if (!apply) { console.log('Simulação: nada gravado. Use --apply para importar.'); process.exit(0); }
  const result = await withDatabase({ ...process.env, CWL_REQUIRE_RESTRICTED_DB: 'true' }, async sql => {
    let inserted = 0;
    for (const { war, source } of plan) {
      const rows = await sql`insert into cwl.war_archive (clan_tag,preparation_start,opponent_tag,war_type,state,final,start_time,end_time,
          team_size,attacks_per_member,attacks_used,source,payload,observed_at)
        values (${tag},${new Date(timestamp(war.preparationStartTime))},${war.opponent.tag.slice(1)},${war.type},'warEnded',true,
          ${new Date(timestamp(war.startTime))},${new Date(timestamp(war.endTime))},${war.teamSize},${war.attacksPerMember},
          ${war.clan.attacks},${source},${sql.json(war)},now())
        on conflict (clan_tag,preparation_start) do nothing returning 1`;
      inserted += rows.length;
    }
    return { inserted, skippedExisting: plan.length - inserted };
  });
  console.log(JSON.stringify(result));
}
