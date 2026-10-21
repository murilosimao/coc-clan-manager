/* War calculation and selection rules preserved from origin/main @ 43610a2. */
(function () {
'use strict';
  const DEFAULT_CLAN = '2G8QCR92V';
  const STANDARD_SIZES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const ROLES = ['Leader', 'Co-leader', 'Elder', 'Member'];

  const DEFAULT_SETTINGS = {
    excludeRed: true,
    requireTwoAttacks: true,
    requireOneStar: true,
    requireTriple: true,
    allowNoWarData: false,
    rankBy: 'position',      // position | th | performance | name
    targetMode: 'max',       // current | auto | max | fixed
    fixedSize: 30,
    maxFill: 2,
    maxTrim: 2,
    fillFrom: 'bottom',      // bottom | top
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

  function makeRankFn(rankBy) {
    switch (rankBy) {
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

  function nextStandardAtLeast(n) {
    return STANDARD_SIZES.find((size) => size >= n) || STANDARD_SIZES[STANDARD_SIZES.length - 1];
  }

  function largestStandardAtMost(n) {
    const value = Math.max(0, Number(n) || 0);
    return [...STANDARD_SIZES].reverse().find((size) => size <= value) || STANDARD_SIZES[0];
  }

  function roundToStandard(n) {
    const value = Number(n) || 0;
    if (value <= STANDARD_SIZES[0]) return STANDARD_SIZES[0];
    if (value >= STANDARD_SIZES[STANDARD_SIZES.length - 1]) {
      return STANDARD_SIZES[STANDARD_SIZES.length - 1];
    }
    return nearestStandard(value);
  }

  function chooseTarget(settings, eligibleCount, currentWarSize, totalPool) {
    if (settings.targetMode === 'max') {
      // Maior tamanho padrão que o pool de verdes consegue preencher.
      return largestStandardAtMost(totalPool);
    }
    let raw;
    if (settings.targetMode === 'fixed') raw = Number(settings.fixedSize) || 30;
    else if (settings.targetMode === 'current' && currentWarSize) raw = currentWarSize;
    else raw = eligibleCount;
    // A guerra só existe em múltiplos de 5: 5, 10, ..., 50.
    return roundToStandard(raw);
  }

  function selectTeam(members, lastWar, settings, currentWar) {
    const perfByTag = new Map((lastWar?.players || []).map((player) => [player.tag, player]));
    const rank = makeRankFn(settings.rankBy);
    const forcedIn = new Set(settings.forcedIn || []);
    const forcedOut = new Set(settings.forcedOut || []);
    const whitelist = new Set(settings.whitelist || []);
    const blacklist = new Set(settings.blacklist || []);

    const all = members.map((member) => {
      const perf = perfByTag.get(member.tag) || null;
      const inWar = Boolean(perf);
      const attacks = perf ? perf.attacks : 0;
      const stars = perf ? perf.stars : 0;
      const newStars = perf ? perf.newStars : 0;
      const triples = perf ? perf.triples : 0;
      const hardReasons = [];
      const ruleReasons = [];
      const softReasons = [];

      const isBlacklisted = blacklist.has(member.tag);
      // BL vence WL. O filtro de escudo ativo também bloqueia a WL.
      const isWhitelisted = whitelist.has(member.tag) && !isBlacklisted;

      if (isBlacklisted) hardReasons.push('lista de exclusão (BL)');
      if (settings.excludeRed && member.pref !== 'in') {
        hardReasons.push(member.pref === 'out' ? 'escudo vermelho' : 'escudo desconhecido');
      }

      if (!inWar) {
        if (!settings.allowNoWarData) softReasons.push('sem dados da última guerra');
      } else {
        if (settings.requireTwoAttacks && attacks < 2) {
          softReasons.push(`menos de 2 ataques (${attacks}/2)`);
        }
        if (settings.requireOneStar && stars < 1) {
          softReasons.push('0 estrelas na última guerra');
        }
        if (settings.requireTriple && triples < 1) {
          ruleReasons.push('sem ataque com 3 estrelas');
        }
      }

      const isForcedIn = forcedIn.has(member.tag);
      const isForcedOut = forcedOut.has(member.tag);
      const hardFail = hardReasons.length > 0;
      const strictEligible = !hardFail && ruleReasons.length === 0 && softReasons.length === 0 && !isForcedOut;
      // WL passa por cima dos critérios de desempenho, mas respeita BL e os filtros de escudo ativos.
      const eligible = !hardFail && (isWhitelisted || strictEligible || (isForcedIn && !isForcedOut));

      return {
        member,
        perf,
        inWar,
        attacks,
        stars,
        newStars,
        triples,
        hardReasons,
        ruleReasons,
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
        row.ruleReasons.length === 0 &&
        !row.whitelisted &&
        !row.eligible &&
        !row.forcedOut &&
        !row.forcedIn
      )
      .sort(rank);

    const strictCount = all.filter((row) => row.strictEligible).length;
    const whitelistCount = eligibleList.filter((row) => row.whitelisted).length;
    const whitelistOnlyCount = eligibleList.filter(
      (row) => row.whitelisted && !row.strictEligible
    ).length;
    const blacklistCount = all.filter((row) => row.blacklisted).length;
    const whitelistBlocked = all.filter((row) => row.whitelistBlocked);

    const currentWarSize = currentWar?.header?.sizeHome || null;
    const greenPoolSize = eligibleList.length + fallback.length;
    let target = chooseTarget(settings, eligibleList.length, currentWarSize, greenPoolSize);
    const whitelistFloor = nextStandardAtLeast(whitelistCount);
    let targetAdjustedForWhitelist = false;
    if (whitelistFloor > target) {
      target = whitelistFloor;
      targetAdjustedForWhitelist = true;
    }
    target = roundToStandard(target);

    let selected = eligibleList.slice();
    let trimmed = [];

    if (selected.length > target) {
      const excess = selected.length - target;
      // No modo "máximo possível", corta o necessário para caber no alvo.
      const allowed = settings.targetMode === 'max'
        ? excess
        : Math.min(excess, Math.max(0, Number(settings.maxTrim) || 0));
      let remaining = allowed;
      for (let i = selected.length - 1; i >= 0 && remaining > 0; i -= 1) {
        if (!selected[i].whitelisted && !selected[i].forcedIn) {
          trimmed.unshift(selected.splice(i, 1)[0]);
          remaining -= 1;
        }
      }
    } else if (selected.length < target) {
      const need = target - selected.length;
      // No modo "máximo possível", preenche todas as vagas disponíveis.
      const allowed = settings.targetMode === 'max'
        ? need
        : Math.min(need, Math.max(0, Number(settings.maxFill) || 0));
      const pool = fallback;
      const picks = allowed <= 0
        ? []
        : settings.fillFrom === 'bottom'
          ? pool.slice(-allowed)
          : pool.slice(0, allowed);
      picks.forEach((row) => {
        row.exception = true;
        selected.push(row);
      });
    }

    trimmed.forEach((row) => { row.trimmed = true; });

    const selectedTags = new Set(selected.map((row) => row.member.tag));
    const bench = all.filter((row) => !selectedTags.has(row.member.tag)).sort(rank);

    const warnings = [];
    if (selected.length < target) {
      if (selected.length >= greenPoolSize) {
        warnings.push(
          `Só há ${greenPoolSize} jogadores disponíveis com os critérios atuais; faltam ${target - selected.length} vagas para chegar a ${target}. ` +
          'Altere os critérios ou o filtro de escudo, ou peça para alguém mudar a preferência de guerra no jogo.'
        );
      } else {
        warnings.push(`Faltam ${target - selected.length} vagas para chegar a ${target}. O limite permite até ${settings.maxFill} exceções; aumente-o se quiser incluir mais jogadores fora dos critérios.`);
      }
    }
    if (selected.length > target) {
      warnings.push(`Há ${selected.length - target} jogadores acima das ${target} vagas. O limite permite deixar ${settings.maxTrim} aptos de fora; aumente-o para completar o corte.`);
    }
    if (whitelistBlocked.length) {
      warnings.push(
        'A lista de inclusão (WL) não supera os filtros de escudo ativos: ' +
        whitelistBlocked.map((row) => `${row.member.name} (#${row.member.tag}: ${row.hardReasons.join(', ')})`).join(', ') +
        '. Ajuste o escudo no jogo ou retire esses jogadores da WL.'
      );
    }
    if (whitelistCount > STANDARD_SIZES[STANDARD_SIZES.length - 1]) {
      warnings.push(
        `Há ${whitelistCount} jogadores na lista de inclusão (WL), mas o tamanho máximo da guerra é 50. ` +
        'Os excedentes não cabem no time.'
      );
    }

    let targetLabel = '';
    if (settings.targetMode === 'fixed') {
      targetLabel = `tamanho definido: ${target}v${target}`;
    } else if (settings.targetMode === 'current' && currentWarSize) {
      targetLabel = currentWarSize === target
        ? `mesmo tamanho da guerra atual (${target}v${target})`
        : `guerra atual: ${currentWarSize} jogadores; usando ${target}v${target}`;
    } else if (settings.targetMode === 'max') {
      targetLabel = `maior tamanho possível entre ${greenPoolSize} jogadores disponíveis: ${target}v${target}`;
    } else {
      targetLabel = `tamanho padrão mais próximo dos ${eligibleList.length} aptos: ${target}v${target}`;
    }
    if (targetAdjustedForWhitelist) {
      targetLabel += ` · ampliado para incluir ${whitelistCount} jogadores da WL`;
    }

    return {
      target,
      targetLabel,
      currentWarSize,
      strictCount,
      whitelistCount,
      whitelistOnlyCount,
      blacklistCount,
      whitelistBlocked,
      targetAdjustedForWhitelist,
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
