(function () {
  'use strict';
  const { tagOf, normalizeWar, timestamp } = window.ClashKing;
  const roles = { leader: 'Leader', coLeader: 'Co-leader', admin: 'Elder', member: 'Member' };
  const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  const pathFor = (tag) => '/api/clans/' + encodeURIComponent('#' + tag);

  async function request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(path, { credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `A consulta falhou (${response.status}). Tente novamente.`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A consulta demorou mais de 45 segundos. Tente novamente.');
      if (error instanceof TypeError) throw new Error('Não foi possível consultar os dados. Confira sua conexão e tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function loadClan(clanTag, { onStatus = () => {} } = {}) {
    const tag = tagOf(clanTag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag)) throw new Error('Digite uma tag válida do Clash of Clans, por exemplo #2G8QCR92V.');
    onStatus('Consultando membros, escudos e guerras...');
    const results = await Promise.allSettled([
      request(pathFor(tag)), request(pathFor(tag) + '/wars'), request(pathFor(tag) + '/currentwar'),
    ]);
    if (results[0].status !== 'fulfilled') throw results[0].reason;
    const clan = results[0].value;
    if (tagOf(clan.tag) !== tag || !Array.isArray(clan.memberList)) throw new Error('Não foi possível obter os membros deste clã.');
    const members = clan.memberList.map((member) => ({
      tag: tagOf(member.tag), name: member.name,
      th: Number.isFinite(Number(member.townHallLevel)) ? Number(member.townHallLevel) : null,
      position: Number.isFinite(Number(member.clanRank)) ? Number(member.clanRank) : null,
      role: roles[member.role] || '', pref: 'unknown', prefSource: 'unavailable', prefConfirmedAt: null,
    }));
    const warnings = [];
    let next = 0;
    let checked = 0;
    const batches = chunk(members, 5);
    // Two batches at a time, five players each; each Worker uses at most three
    // outgoing connections and five external requests, well below Free limits.
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const query = new URLSearchParams({ tags: batch.map((member) => '#' + member.tag).join(',') });
          const data = await request('/api/players?' + query);
          const byTag = new Map((data.items || []).map((player) => [tagOf(player.tag), player]));
          for (const member of batch) {
            const player = byTag.get(member.tag);
            // A departed player's current preference must not be attributed to
            // their old clan membership from a separately cached clan profile.
            if (player && !player.error && tagOf(player.clan?.tag) === tag) {
              member.pref = ['in', 'out'].includes(player.warPreference) ? player.warPreference : 'unknown';
              member.prefSource = member.pref === 'unknown' ? 'unavailable' : 'profile-api';
              member.prefConfirmedAt = player.fetchedAt || null;
              member.role = roles[player.role] || member.role;
              if (Number.isFinite(Number(player.townHallLevel))) member.th = Number(player.townHallLevel);
            }
          }
        } catch { /* A failed batch stays unknown, never in or out by inference. */ }
        checked += batch.length;
        onStatus(`Consultando escudos: ${checked}/${members.length} jogadores...`);
      }
    }));
    const unknown = members.filter((member) => member.pref === 'unknown').length;
    if (unknown) warnings.push(`${unknown} perfis sem escudo confirmado. Eles permanecem fora da seleção enquanto o filtro de escudo estiver ligado.`);

    let lastWar = null;
    let currentWar = null;
    if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.items)) {
      const wars = results[1].value.items;
      const latest = wars.filter((war) => war.state === 'warEnded' && timestamp(war.endTime) <= Date.now())
        .sort((a, b) => timestamp(b.endTime) - timestamp(a.endTime))[0];
      if (latest) {
        const war = normalizeWar(latest, tag);
        if (war.sourceComplete) lastWar = war;
        else warnings.push('A última guerra armazenada está incompleta. Seu desempenho não foi usado na seleção.');
      } else warnings.push('Nenhuma guerra concluída disponível no histórico.');
    } else warnings.push('O histórico de guerras não pôde ser consultado.');
    if (results[2].status === 'fulfilled') {
      const current = results[2].value;
      if (['inWar', 'preparation'].includes(current.state) && timestamp(current.endTime) > Date.now()) {
        currentWar = normalizeWar(current, tag);
        currentWar.source = 'profile-api';
        // A completed current war is more recent than an outdated history feed.
      } else if (current.state === 'warEnded' && (!lastWar || timestamp(current.endTime) > timestamp(lastWar.endTime))) {
        const ended = normalizeWar(current, tag);
        if (ended.sourceComplete) { lastWar = ended; lastWar.source = 'profile-api'; }
      }
    } else warnings.push('Não foi possível consultar a guerra atual.');
    return {
      clan, members, lastWar, currentWar, warnings,
      fetchedAt: new Date().toISOString(), profileFetchedAt: clan.fetchedAt,
      memberSource: 'clashapi.colinschmale.dev',
    };
  }
  window.ClanAPI = { loadClan };
})();
