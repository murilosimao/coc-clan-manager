/* Normalize stored ClashKing war data into the roster selector model. */
(function (root) {
  'use strict';

  const tagOf = (value) => String(value || '').trim().replace(/^#/, '').toUpperCase();
  const number = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

  function timestamp(value) {
    const iso = String(value || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    return Date.parse(iso);
  }

  function dateLabel(value) {
    const time = timestamp(value);
    return Number.isFinite(time) ? new Date(time).toLocaleString('pt-BR') : '';
  }

  function normalizeWar(war, clanTag) {
    const wanted = tagOf(clanTag);
    if (!war?.clan || !war?.opponent) throw new Error('O ClashKing retornou uma guerra sem os dois clãs.');
    const ourSide = tagOf(war.clan.tag) === wanted ? 1 : tagOf(war.opponent.tag) === wanted ? 2 : null;
    if (!ourSide) throw new Error('A guerra recebida não pertence ao clã consultado.');
    const opponentSide = ourSide === 1 ? 2 : 1;
    const sides = { 1: war.clan, 2: war.opponent };
    const rosterFor = (side) => (Array.isArray(sides[side].members) ? sides[side].members : []).map((player) => ({
      tag: tagOf(player.tag), name: String(player.name || tagOf(player.tag)),
      th: number(player.townhallLevel ?? player.townHallLevel), position: number(player.mapPosition),
    })).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    const rosters = { 1: rosterFor(1), 2: rosterFor(2) };
    const identities = new Map([...rosters[1], ...rosters[2]].map((player) => [player.tag, player]));
    const attacks = [];
    for (const side of [1, 2]) {
      for (const player of sides[side].members || []) {
        for (const attack of player.attacks || []) {
          const attackerTag = tagOf(attack.attackerTag || player.tag);
          const defenderTag = tagOf(attack.defenderTag);
          const duration = number(attack.duration);
          if (!attackerTag || !defenderTag || number(attack.order) == null) throw new Error('A guerra contém ataques incompletos.');
          attacks.push({
            order: number(attack.order), side,
            attacker: identities.get(attackerTag) || { tag: attackerTag, name: '#' + attackerTag, th: null },
            defender: identities.get(defenderTag) || { tag: defenderTag, name: '#' + defenderTag, th: null },
            stars: number(attack.stars) ?? 0, destruction: number(attack.destructionPercentage),
            duration: duration == null ? null : `${Math.floor(duration / 60)}m ${String(duration % 60).padStart(2, '0')}s`,
          });
        }
      }
    }
    attacks.sort((a, b) => a.order - b.order);
    const ours = sides[ourSide];
    const theirs = sides[opponentSide];
    let state = war.state;
    let label = state === 'preparation' ? 'DIA DE PREPARAÇÃO' : state === 'inWar' ? 'EM ANDAMENTO' : 'SEM GUERRA';
    if (state === 'warEnded') {
      const difference = (number(ours.stars) ?? 0) - (number(theirs.stars) ?? 0)
        || (number(ours.destructionPercentage) ?? 0) - (number(theirs.destructionPercentage) ?? 0);
      state = difference > 0 ? 'win' : difference < 0 ? 'lose' : 'draw';
      label = { win: 'VITÓRIA', lose: 'DERROTA', draw: 'EMPATE' }[state];
    }
    const attacksPerMember = number(war.attacksPerMember) ?? (war.type === 'cwl' ? 1 : 2);
    const teamSize = number(war.teamSize);
    return {
      id: `CK-${war.endTime || war.preparationStartTime || 'current'}`,
      source: 'clashking', endTime: war.endTime,
      sourceComplete: [1, 2].every((side) => rosters[side].length === teamSize
        && attacks.filter((attack) => attack.side === side).length === number(sides[side].attacks)),
      header: {
        type: war.type === 'cwl' ? 'Clan War League' : 'Clan War',
        sizeHome: teamSize, sizeAway: teamSize, attacksPerMember,
        battleMode: war.battleModifier || 'Standard',
        matchedOn: dateLabel(war.preparationStartTime), startedOn: dateLabel(war.startTime), endedOn: dateLabel(war.endTime),
        timer: war.state === 'preparation' ? 'Preparation Day' : '',
      },
      result: {
        clans: { 1: { tag: tagOf(war.clan.tag), name: war.clan.name, badgeUrls: war.clan.badgeUrls }, 2: { tag: tagOf(war.opponent.tag), name: war.opponent.name, badgeUrls: war.opponent.badgeUrls } },
        stars: { 1: number(war.clan.stars), 2: number(war.opponent.stars) },
        percents: { 1: number(war.clan.destructionPercentage), 2: number(war.opponent.destructionPercentage) },
        ourSide, opponentSide, state, label,
        attacksUsed: number(ours.attacks), attacksMax: teamSize * attacksPerMember,
        opponentAttacksUsed: number(theirs.attacks), opponentAttacksMax: teamSize * attacksPerMember,
      },
      roster: rosters[ourSide], opponentRoster: rosters[opponentSide], attacks,
    };
  }

  const api = { tagOf, timestamp, normalizeWar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClashKing = api;
})(typeof window !== 'undefined' ? window : globalThis);
