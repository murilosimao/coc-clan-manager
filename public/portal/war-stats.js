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
  // A family clan's war (our capture or ClashKing) seen from one member, in the
  // same shape as the personal ClashKing history.
  function memberWar(war, clanTag, playerTag) {
    const tagOf = window.ClashKing.tagOf;
    const side = [war?.clan, war?.opponent].find((value) => tagOf(value?.tag) === tagOf(clanTag));
    const member = side?.members?.find((value) => tagOf(value.tag) === tagOf(playerTag));
    if (!member) return null;
    const other = side === war.clan ? war.opponent : war.clan;
    return {
      type: war.type || 'random', state: war.state, attacksPerMember: Number(war.attacksPerMember) || 2,
      endTime: war.endTime, clan: { name: side.name }, opponent: { name: other?.name },
      attacks: (member.attacks || []).map((attack) => ({ stars: attack.stars, destructionPercentage: attack.destructionPercentage, order: attack.order })),
      sourceLabel: war.source === 'war-archive' ? 'Arquivo da família' : 'ClashKing',
    };
  }
  window.WarStats = { summarize, latestCompletedRegularWar, memberWar };
})();
