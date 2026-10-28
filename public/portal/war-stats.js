/* Historical player stats. CWL uses the recorded attacksPerMember, usually one. */
(function () {
  'use strict';
  function summarize(items, type) {
    const matching = items.filter((war) => war.type === type);
    const wars = matching.filter((war) => war.state === 'warEnded').sort((a, b) => window.ClashKing.timestamp(b.endTime) - window.ClashKing.timestamp(a.endTime));
    const attacks = wars.flatMap((war) => war.attacks);
    const defenses = wars.flatMap((war) => war.defenses);
    const opportunities = wars.reduce((n, war) => n + war.attacksPerMember, 0);
    const missed = wars.reduce((n, war) => n + Math.max(0, war.attacksPerMember - war.attacks.length), 0);
    const stars = attacks.reduce((n, a) => n + a.stars, 0);
    const triples = attacks.filter((a) => a.stars === 3).length;
    const knownDestruction = attacks.filter((a) => a.destructionPercentage != null && Number.isFinite(a.destructionPercentage));
    return {
      wars, ongoing: matching.length - wars.length, attacks: attacks.length, opportunities, missed, stars, triples,
      averageStars: attacks.length ? stars / attacks.length : null,
      tripleRate: attacks.length ? triples / attacks.length * 100 : null,
      averageDestruction: knownDestruction.length ? knownDestruction.reduce((n, a) => n + a.destructionPercentage, 0) / knownDestruction.length : null,
      defenses: defenses.length,
    };
  }
  function latestCompletedRegularWar(items) {
    return items.filter((war) => war.type === 'random'
      && war.state === 'warEnded'
      && Number(war.attacksPerMember) === 2
      && Number.isFinite(window.ClashKing.timestamp(war.endTime))
      && window.ClashKing.timestamp(war.endTime) <= Date.now())
      .sort((a, b) => window.ClashKing.timestamp(b.endTime) - window.ClashKing.timestamp(a.endTime))[0] || null;
  }
  // A transfer between managed clans must not erase the last participation.
  // Use complete regular wars and keep zero-attack participations as evidence.
  function managedClanHistory(items, clanTags, now = Date.now()) {
    const C = window.ClashKing;
    const allowed = new Set(clanTags.map(C.tagOf));
    const byTag = new Map();
    for (const raw of items) {
      const end = C.timestamp(raw.endTime), start = C.timestamp(raw.startTime);
      if (raw.state !== 'warEnded' || raw.type && raw.type !== 'random'
        || raw.attacksPerMember !== 2 || !Number.isFinite(end) || !Number.isFinite(start)
        || start >= end || end > now) continue;
      for (const side of [raw.clan, raw.opponent]) {
        if (!side || !allowed.has(C.tagOf(side.tag))) continue;
        let war;
        try { war = C.normalizeWar(raw, side.tag); } catch { continue; }
        const rawAttacks = [raw.clan, raw.opponent].flatMap(s => (s?.members || []).flatMap(p => p.attacks || []));
        if (rawAttacks.some(a => !Number.isInteger(a.stars) || a.stars < 0 || a.stars > 3)
          || new Set(war.attacks.map(a => a.order)).size !== war.attacks.length) continue;
        if (!war.sourceComplete || war.attacks.some(a => !Number.isInteger(a.stars) || a.stars < 0 || a.stars > 3)) continue;
        for (const player of war.roster) {
          if (byTag.has(player.tag) && C.timestamp(byTag.get(player.tag).endTime) >= end) continue;
          byTag.set(player.tag, { type: 'random', state: 'warEnded', attacksPerMember: 2,
            startTime: raw.startTime, endTime: raw.endTime, sourceScope: 'managed-clans',
            clan: { tag: C.tagOf(side.tag), name: side.name },
            attacks: war.attacks.filter(a => a.side === war.result.ourSide && a.attacker.tag === player.tag)
              .map(a => ({ stars: a.stars, order: a.order, destructionPercentage: a.destruction })),
          });
        }
      }
    }
    return byTag;
  }
  function matchesLatestWar(war, summary, clanTag) {
    if (!war || !summary) return false;
    const C = window.ClashKing, end = C.timestamp(war.endTime), expected = C.timestamp(summary.endTime);
    const opposite = war.result ? war.result.clans[war.result.opponentSide]?.tag
      : C.tagOf(war.clan?.tag) === C.tagOf(clanTag) ? war.opponent?.tag : war.clan?.tag;
    // End times can be adjusted slightly between the live response and archive.
    return Number.isFinite(end) && Number.isFinite(expected) && Math.abs(end - expected) <= 300000
      && C.tagOf(opposite) === C.tagOf(summary.opponent?.tag);
  }
  window.WarStats = { summarize, latestCompletedRegularWar, managedClanHistory, matchesLatestWar };
})();
