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
  window.WarStats = { summarize, latestCompletedRegularWar };
})();
