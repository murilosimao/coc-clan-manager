/* War calculation and selection rules preserved from origin/main @ 43610a2. */
(function () {
'use strict';
  const DEFAULT_CLAN = '2G8QCR92V';
  const STANDARD_SIZES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const ROLES = ['Leader', 'Co-leader', 'Elder', 'Member'];

  const DEFAULT_SETTINGS = {
    rankBy: 'activity',      // activity | position | th | performance | name
    usePlayerHistoryFallback: true, // família primeiro, ClashKing só quando atualizado
    forcedIn: [],
    forcedOut: [],
    whitelist: [],           // sempre incluir (não fura escudo vermelho)
    blacklist: [],           // sempre excluir (vence a whitelist)
  };

  const normalizeTag = (tag) => String(tag || '').trim().replace(/^#/, '').toUpperCase();
  const fmtPct = (value) => value == null ? '—' : `${Number(value).toFixed(2).replace(/\.?0+$/, '')}%`;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function enrichAttacks(attacks) {
    const bestByDefender = new Map();
    attacks.forEach((attack) => {
      const previous = bestByDefender.get(attack.defender.tag) || 0;
      attack.newStars = Math.max(0, attack.stars - previous);
      attack.cleanup = attack.newStars === 0;
      bestByDefender.set(attack.defender.tag, Math.max(previous, attack.stars));
    });
    return bestByDefender;
  }

  function computePlayerStats(roster, attacks, ourSide, attacksPerMember) {
    const byAttacker = new Map();
    attacks
      .filter((attack) => attack.side === ourSide)
      .sort((a, b) => a.order - b.order)
      .forEach((attack) => {
        const stats = byAttacker.get(attack.attacker.tag) || {
          attacks: 0, stars: 0, newStars: 0, triples: 0, cleanups: 0,
          firstAttackStars: null, secondAttackStars: null,
          destructionSum: 0, destructionCount: 0,
        };
        if (stats.attacks === 0) stats.firstAttackStars = attack.stars;
        if (stats.attacks === 1) stats.secondAttackStars = attack.stars;
        stats.attacks += 1;
        stats.stars += attack.stars;
        stats.newStars += attack.newStars;
        stats.triples += attack.stars === 3 ? 1 : 0;
        stats.cleanups += attack.cleanup ? 1 : 0;
        if (attack.destruction != null) {
          stats.destructionSum += attack.destruction;
          stats.destructionCount += 1;
        }
        byAttacker.set(attack.attacker.tag, stats);
      });

    return roster.map((player) => {
      const stats = byAttacker.get(player.tag) || {
        attacks: 0, stars: 0, newStars: 0, triples: 0, cleanups: 0,
          firstAttackStars: null, secondAttackStars: null,
        destructionSum: 0, destructionCount: 0,
      };
      return {
        ...player,
        ...stats,
        avgDestruction: stats.destructionCount ? stats.destructionSum / stats.destructionCount : null,
        missed: Math.max(0, attacksPerMember - stats.attacks),
        inWar: true,
      };
    });
  }

  function buildWar(normalized) {
    const { id, header, result, roster, opponentRoster, attacks } = normalized;
    const ourSide = result.ourSide || 1;
    const opponentSide = result.opponentSide || (ourSide === 1 ? 2 : 1);
    const bestByDefender = enrichAttacks(attacks);
    const players = computePlayerStats(roster, attacks, ourSide, header.attacksPerMember);
    const ourAttacks = attacks.filter((attack) => attack.side === ourSide);
    const opponentAttacks = attacks.filter((attack) => attack.side === opponentSide);
    const ourDefenders = new Set(ourAttacks.map((attack) => attack.defender.tag));
    const opponentDefenders = new Set(opponentAttacks.map((attack) => attack.defender.tag));
    return {
      ...normalized, players, ourAttacks, opponentAttacks,
      computedOurStars: [...ourDefenders].reduce((sum, tag) => sum + (bestByDefender.get(tag) || 0), 0),
      computedOpponentStars: [...opponentDefenders].reduce((sum, tag) => sum + (bestByDefender.get(tag) || 0), 0),
      ourBasesTripled: [...ourDefenders].filter((tag) => bestByDefender.get(tag) === 3).length,
      opponentBasesTripled: [...opponentDefenders].filter((tag) => bestByDefender.get(tag) === 3).length,
    };
  }

  function makeActivityRankFn() {
    const numberOr = (value, fallback) => value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
    return (a, b) => {
      const trophiesA = numberOr(a.member.trophies, -1);
      const trophiesB = numberOr(b.member.trophies, -1);
      const rankA = numberOr(a.member.clanRank ?? a.member.position, Infinity);
      const rankB = numberOr(b.member.clanRank ?? b.member.position, Infinity);
      return trophiesB - trophiesA || rankA - rankB || String(a.member.name || '').localeCompare(String(b.member.name || ''), 'pt-BR');
    };
  }

  function makeRankFn(rankBy) {
    switch (rankBy) {
      case 'activity':
        return makeActivityRankFn();
      case 'th':
        return (a, b) => (b.member.th || 0) - (a.member.th || 0) || a.member.position - b.member.position;
      case 'performance':
        return (a, b) =>
          (b.newStars || 0) - (a.newStars || 0) ||
          (b.stars || 0) - (a.stars || 0) ||
          (b.attacks || 0) - (a.attacks || 0) ||
          a.member.position - b.member.position;
      case 'name':
        return (a, b) => a.member.name.localeCompare(b.member.name, 'pt-BR');
      case 'position':
      default:
        return (a, b) => a.member.position - b.member.position;
    }
  }

  function nearestStandard(n) {
    // Empate fica no piso (ex.: 32,5 -> 30), como na regra do clã.
    return STANDARD_SIZES.reduce((best, size) =>
      Math.abs(size - n) < Math.abs(best - n) ? size : best, STANDARD_SIZES[0]);
  }

  function roundToStandard(n) {
    const value = Number(n) || 0;
    if (value <= STANDARD_SIZES[0]) return STANDARD_SIZES[0];
    if (value >= STANDARD_SIZES[STANDARD_SIZES.length - 1]) {
      return STANDARD_SIZES[STANDARD_SIZES.length - 1];
    }
    return nearestStandard(value);
  }

  function personalWarPerformance(war) {
    if (!war || !Array.isArray(war.attacks)) return null;
    const attacks = [...war.attacks].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    return {
      attacks: attacks.length,
      stars: attacks.reduce((sum, attack) => sum + attack.stars, 0),
      triples: attacks.filter((attack) => attack.stars === 3).length,
      firstAttackStars: attacks[0]?.stars ?? null,
      secondAttackStars: attacks[1]?.stars ?? null,
    };
  }

  function selectTeam(members, lastWar, settings, currentWar, personalHistoryByTag = new Map(), historyStatusByTag = new Map()) {
    const perfByTag = new Map((lastWar?.players || []).map((player) => [normalizeTag(player.tag), player]));
    // A capture that stopped before the end is a lower bound: it can confirm
    // the criteria, but missing attacks may have happened after it.
    const partialCapture = lastWar?.captureComplete === false;
    const rank = makeRankFn(settings.rankBy);
    const activityRank = makeActivityRankFn();
    const forcedIn = new Set(settings.forcedIn || []);
    const forcedOut = new Set(settings.forcedOut || []);
    const whitelist = new Set(settings.whitelist || []);
    const blacklist = new Set(settings.blacklist || []);

    const all = members.map((member) => {
      const currentPerf = perfByTag.get(normalizeTag(member.tag)) || null;
      const historyWar = settings.usePlayerHistoryFallback ? personalHistoryByTag.get(normalizeTag(member.tag)) || null : null;
      const historyPerf = personalWarPerformance(historyWar);
      const criteriaPerf = currentPerf || historyPerf;
      const perf = criteriaPerf;
      const inWar = Boolean(currentPerf);
      const usedPersonalHistory = !currentPerf && Boolean(historyPerf);
      const attacks = criteriaPerf ? criteriaPerf.attacks : 0;
      const stars = criteriaPerf ? criteriaPerf.stars : 0;
      const newStars = currentPerf ? currentPerf.newStars : 0;
      const triples = criteriaPerf ? criteriaPerf.triples : 0;
      const hardReasons = [];
      const softReasons = [];

      const isBlacklisted = blacklist.has(member.tag);
      // BL vence WL. O filtro de escudo ativo também bloqueia a WL.
      const isWhitelisted = whitelist.has(member.tag) && !isBlacklisted;

      if (isBlacklisted) hardReasons.push('lista de exclusão (BL)');
      // Apenas escudo explicitamente vermelho bloqueia. Perfil sem confirmação
      // permanece elegível; a ausência de dado não prova indisponibilidade.
      if (member.pref === 'out') hardReasons.push('escudo vermelho');

      const failures = [];
      if (criteriaPerf) {
        if (attacks < 2) failures.push(`menos de 2 ataques (${attacks}/2)`);
        if (stars < 1) failures.push('0 estrelas na guerra anterior');
      }
      const partialCaptureHold = partialCapture && Boolean(currentPerf) && failures.length > 0;
      if (!partialCaptureHold) softReasons.push(...failures);

      const isForcedIn = forcedIn.has(member.tag);
      const isForcedOut = forcedOut.has(member.tag);
      const hardFail = hardReasons.length > 0;
      const strictEligible = !hardFail && softReasons.length === 0 && !isForcedOut;
      // WL passa por cima dos critérios de desempenho, mas respeita BL e os filtros de escudo ativos.
      const eligible = !hardFail && !isForcedOut && (isWhitelisted || strictEligible || isForcedIn);

      return {
        member,
        perf,
        criteriaPerf,
        historyWar: usedPersonalHistory ? historyWar : null,
        historyStatus: historyStatusByTag.get(normalizeTag(member.tag)) || '',
        usedPersonalHistory,
        partialCaptureHold,
        inWar,
        attacks,
        stars,
        newStars,
        triples,
        hardReasons,
        softReasons,
        hardFail,
        strictEligible,
        eligible,
        whitelisted: isWhitelisted,
        blacklisted: isBlacklisted,
        whitelistBlocked: isWhitelisted && hardFail,
        forcedIn: isForcedIn,
        forcedOut: isForcedOut,
        exception: false,
        trimmed: false,
      };
    });

    const eligibleList = all
      .filter((row) => row.eligible || (row.forcedIn && !row.hardFail && !row.forcedOut))
      .sort((a, b) => Number(b.whitelisted) - Number(a.whitelisted) || rank(a, b));
    eligibleList.forEach((row) => {
      if (row.forcedIn && !row.eligible) row.exception = true;
    });

    const fallback = all
      .filter((row) =>
        !row.hardFail &&
        !row.whitelisted &&
        !row.eligible &&
        !row.forcedOut &&
        !row.forcedIn
      )
      .sort(activityRank);

    const strictCount = all.filter((row) => row.strictEligible).length;
    const whitelistCount = eligibleList.filter((row) => row.whitelisted).length;
    const whitelistOnlyCount = eligibleList.filter(
      (row) => row.whitelisted && !row.strictEligible
    ).length;
    const blacklistCount = all.filter((row) => row.blacklisted).length;
    const whitelistBlocked = all.filter((row) => row.whitelistBlocked);

    // The game size follows green shields, regardless of the previous-war
    // performance filters. Unknown shields remain neutral but do not increase
    // the displayed available count used to choose a standard size.
    const availableCount = all.filter((row) =>
      row.member.pref === 'in' && !row.blacklisted && !row.forcedOut
    ).length;
    const redFallback = all
      .filter((row) =>
        row.member.pref === 'out' &&
        !row.blacklisted &&
        !row.forcedOut
      )
      .sort(activityRank);
    const currentWarSize = currentWar?.header?.sizeHome || null;
    const target = roundToStandard(availableCount);
    const canUseRedFallback = target > availableCount && target - availableCount <= 2;
    const availablePoolSize = eligibleList.length + fallback.length + (canUseRedFallback ? redFallback.length : 0);

    let selected = eligibleList.slice();
    let trimmed = [];

    if (selected.length > target) {
      let remaining = selected.length - target;
      for (let i = selected.length - 1; i >= 0 && remaining > 0; i -= 1) {
        if (!selected[i].whitelisted && !selected[i].forcedIn) {
          trimmed.unshift(selected.splice(i, 1)[0]);
          remaining -= 1;
        }
      }
    } else if (selected.length < target) {
      const selectedTags = new Set(selected.map((row) => row.member.tag));
      const remainingFallback = fallback.filter((row) => !selectedTags.has(row.member.tag));
      const greenFallback = remainingFallback.filter((row) => row.member.pref === 'in');
      const unknownFallback = remainingFallback.filter((row) => row.member.pref !== 'in');
      const pickNext = (pool, count) => count > 0 ? pool.slice(0, count) : [];
      const addExceptions = (pool) => {
        const need = target - selected.length;
        const picks = pickNext(pool, need);
        picks.forEach((row) => {
          row.exception = true;
          row.sizeFillException = true;
          selected.push(row);
        });
      };

      // Fill with the next green-shield players in trophy/rank order, then
      // neutral shields. Red shields are a last resort when rounding up.
      addExceptions(greenFallback);
      addExceptions(unknownFallback);
      if (selected.length < target && canUseRedFallback) {
        const addedTags = new Set(selected.map((row) => row.member.tag));
        addExceptions(redFallback.filter((row) => !addedTags.has(row.member.tag)));
      }
    }

    trimmed.forEach((row) => { row.trimmed = true; });

    const selectedTags = new Set(selected.map((row) => row.member.tag));
    const bench = all.filter((row) => !selectedTags.has(row.member.tag)).sort(rank);
    const selectedRedFallback = selected.filter((row) => row.sizeFillException && row.member.pref === 'out');
    const blockedWhitelist = whitelistBlocked.filter((row) => !selectedTags.has(row.member.tag));

    const warnings = [];
    if (selected.length < target) {
      if (selected.length >= availablePoolSize) {
        warnings.push(
          `Só há ${availablePoolSize} jogadores aproveitáveis na lista atual; faltam ${target - selected.length} vagas para chegar a ${target}. ` +
          'Confira os escudos vermelhos e os bloqueios manuais.'
        );
      } else {
        warnings.push(`Faltam ${target - selected.length} vagas para chegar a ${target}. Os bloqueios manuais ou a falta de jogadores elegíveis impedem completar o time.`);
      }
    }
    if (selected.length > target) {
      warnings.push(`Há ${selected.length - target} jogadores acima das ${target} vagas. Os últimos da lista foram retirados até fechar o tamanho padrão.`);
    }
    if (selectedRedFallback.length) {
      warnings.push(
        `${selectedRedFallback.length} jogador(es) com escudo vermelho entraram como última opção para completar ${target} vagas, arredondadas a partir de ${availableCount} disponíveis.`
      );
    }
    if (blockedWhitelist.length) {
      warnings.push(
        'O escudo vermelho bloqueia mesmo quem está na lista de prioridade: ' +
        blockedWhitelist.map((row) => `${row.member.name} (#${row.member.tag}: ${row.hardReasons.join(', ')})`).join(', ') +
        '. Ajuste o escudo no jogo ou retire esses jogadores da lista.'
      );
    }
    if (whitelistCount > STANDARD_SIZES[STANDARD_SIZES.length - 1]) {
      warnings.push(
        `Há ${whitelistCount} jogadores na lista de inclusão (WL), mas o tamanho máximo da guerra é 50. ` +
        'Os excedentes não cabem no time.'
      );
    }

    const targetLabel = `tamanho padrão mais próximo dos ${availableCount} disponíveis: ${target}v${target}`;

    return {
      target,
      targetLabel,
      availableCount,
      currentWarSize,
      strictCount,
      whitelistCount,
      whitelistOnlyCount,
      blacklistCount,
      whitelistBlocked,
      selected,
      bench,
      all,
      trimmed,
      fallback,
      warnings,
      perfByTag,
    };
  }


window.WarEngine = { DEFAULT_CLAN, DEFAULT_SETTINGS, STANDARD_SIZES, selectTeam, buildWar, normalizeTag, fmtPct, esc };
})();
