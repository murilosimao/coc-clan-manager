(function () {
  'use strict';
  const { tagOf, normalizeWar, timestamp } = window.ClashKing;
  // Public service URL, not a credential. Worker-hosted pages use the same origin.
  const API_ORIGIN = ['murilosimao.github.io', 'coc-purosangue.duckdns.org'].includes(location.hostname)
    ? 'https://coc-clan-manager.mbks.workers.dev' : '';
  const roles = { leader: 'Leader', coLeader: 'Co-leader', admin: 'Elder', member: 'Member' };
  const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  const pathFor = (tag) => '/api/clans/' + encodeURIComponent('#' + tag);
  const sessionKey = 'coc-clan-manager-session';
  let fallbackSessionId = '';

  function createSessionId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(sessionKey);
      if (!id) { id = createSessionId(); sessionStorage.setItem(sessionKey, id); }
      return id;
    } catch {
      if (!fallbackSessionId) fallbackSessionId = createSessionId();
      return fallbackSessionId;
    }
  }

  function audit(action, details = {}) {
    const sessionId = getSessionId();
    fetch(API_ORIGIN + '/api/audit', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-App-Session': sessionId },
      body: JSON.stringify({ sessionId, action, ...details }),
    }).catch(() => {});
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 45000);
    try {
      const response = await fetch(API_ORIGIN + path, { method:options.method||'GET',body:options.body,credentials:options.auth?'same-origin':'omit', signal: controller.signal, headers: { Accept: 'application/json', 'X-App-Session': getSessionId(),...options.headers } });
      const data = await response.json();
      if (!response.ok) {const error=new Error(data.error || `A consulta falhou (${response.status}). Tente novamente.`);error.status=response.status;error.code=data.code;throw error;}
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A consulta demorou mais de 45 segundos. Tente novamente.');
      if (error instanceof TypeError) throw new Error('Não foi possível consultar os dados. Confira sua conexão e tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function loadClan(clanTag, { onStatus = () => {}, onProgress = () => {}, onData = () => {} } = {}) {
    const tag = tagOf(clanTag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag)) throw new Error('Digite uma tag válida do Clash of Clans, por exemplo #2G8QCR92V.');
    const stages = { clan: 'loading', currentWar: 'loading', history: 'loading', profiles: 'waiting' };
    const profiles = { done: 0, total: 0 };
    const warnings = [];
    const emitProgress = () => onProgress({ stages: { ...stages }, profiles: { ...profiles } });
    const setStage = (name, value) => { stages[name] = value; emitProgress(); };
    const addWarning = (message) => {
      if (!warnings.includes(message)) warnings.push(message);
      onData({ type: 'warnings', warnings: [...warnings] });
    };
    onStatus('Consultando clã e guerras...');
    emitProgress();

    let clan;
    let members = [];
    let lastWar = null;
    let currentWar = null;

    const publishLastWar = (candidate) => {
      if (!candidate || (lastWar && timestamp(lastWar.endTime) >= timestamp(candidate.endTime))) return false;
      lastWar = candidate;
      onData({ type: 'lastWar', lastWar });
      return true;
    };

    const clanTask = (async () => {
      try {
        clan = await request(pathFor(tag));
        if (tagOf(clan.tag) !== tag || !Array.isArray(clan.memberList)) throw new Error('Não foi possível obter os membros deste clã.');
        members = clan.memberList.map((member) => ({
          tag: tagOf(member.tag), name: member.name,
          th: Number.isFinite(Number(member.townHallLevel)) ? Number(member.townHallLevel) : null,
          clanRank: Number.isFinite(Number(member.clanRank)) ? Number(member.clanRank) : null,
          position: Number.isFinite(Number(member.clanRank)) ? Number(member.clanRank) : null,
          trophies: member.trophies != null && Number.isFinite(Number(member.trophies)) ? Number(member.trophies) : null,
          role: roles[member.role] || '', pref: 'unknown', prefSource: 'unavailable', prefConfirmedAt: null,
        }));
        onData({ type: 'clan', clan });
        setStage('clan', 'done');
        profiles.total = members.length;
        setStage('profiles', members.length ? 'loading' : 'done');

        let next = 0;
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
                // Do not attribute a departed player's current preference to an old clan membership.
                if (player && !player.error && tagOf(player.clan?.tag) === tag) {
                  member.pref = ['in', 'out'].includes(player.warPreference) ? player.warPreference : 'unknown';
                  member.prefSource = member.pref === 'unknown' ? 'unavailable' : 'profile-api';
                  member.prefConfirmedAt = player.fetchedAt || null;
                  member.role = roles[player.role] || member.role;
                  if (Number.isFinite(Number(player.townHallLevel))) member.th = Number(player.townHallLevel);
                }
              }
            } catch { /* Failed profiles remain unknown, never in or out by inference. */ }
            profiles.done += batch.length;
            onStatus(`Consultando escudos: ${profiles.done}/${profiles.total} jogadores...`);
            emitProgress();
          }
        }));
        setStage('profiles', 'done');
        const unknown = members.filter((member) => member.pref === 'unknown').length;
        if (unknown) addWarning(`${unknown} perfis sem escudo confirmado. Eles permanecem elegíveis; somente escudo vermelho bloqueia.`);
        return members;
      } catch (error) {
        setStage('clan', 'error');
        throw error;
      }
    })();

    const historyTask = (async () => {
      try {
        const data = await request(pathFor(tag) + '/wars');
        const wars = Array.isArray(data.items) ? data.items : [];
        const latest = wars.filter((war) => war.state === 'warEnded' && timestamp(war.endTime) <= Date.now())
          .sort((a, b) => timestamp(b.endTime) - timestamp(a.endTime))[0];
        let published = false;
        if (latest) {
          const normalized = normalizeWar(latest, tag);
          if (normalized.sourceComplete) published = publishLastWar(normalized);
          else addWarning('A última guerra armazenada está incompleta. Seu desempenho não foi usado na seleção.');
        } else addWarning('Nenhuma guerra concluída disponível no histórico.');
        if (!published) onData({ type: 'lastWar', lastWar });
        setStage('history', 'done');
      } catch {
        addWarning('O histórico de guerras não pôde ser consultado.');
        onData({ type: 'lastWar', lastWar });
        setStage('history', 'error');
      }
    })();

    const currentWarTask = (async () => {
      try {
        const current = await request(pathFor(tag) + '/currentwar');
        if (['inWar', 'preparation'].includes(current.state) && timestamp(current.endTime) > Date.now()) {
          currentWar = normalizeWar(current, tag);
          currentWar.source = 'profile-api';
        } else if (current.state === 'warEnded') {
          const ended = normalizeWar(current, tag);
          if (ended.sourceComplete) { ended.source = 'profile-api'; publishLastWar(ended); }
        }
        onData({ type: 'currentWar', currentWar });
        setStage('currentWar', 'done');
      } catch {
        addWarning('Não foi possível consultar a guerra atual.');
        onData({ type: 'currentWar', currentWar: null });
        setStage('currentWar', 'error');
      }
    })();

    const [clanResult] = await Promise.allSettled([clanTask, historyTask, currentWarTask]);
    if (clanResult.status !== 'fulfilled') throw clanResult.reason;
    return {
      clan, members, lastWar, currentWar, warnings,
      fetchedAt: new Date().toISOString(), profileFetchedAt: clan.fetchedAt,
      memberSource: 'clashapi.colinschmale.dev',
    };
  }
  async function loadPlayerStats(playerTag) {
    const tag = tagOf(playerTag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag)) throw new Error('Tag de jogador inválida.');
    return request('/api/players/' + encodeURIComponent('#' + tag) + '/war-stats');
  }
  const scoreHistoryCache = new Map();
  async function loadScoreHistory(clanTag, type) {
    const tag = tagOf(clanTag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag) || !['random', 'cwl'].includes(type)) throw new Error('Consulta de score inválida.');
    const key = tag + ':' + type;
    const cached = scoreHistoryCache.get(key);
    if (cached && Date.now() - cached.at < 60000) return cached.promise;
    const promise = request(pathFor(tag) + '/score-history?type=' + type);
    scoreHistoryCache.set(key, { at: Date.now(), promise });
    try { return await promise; } catch (error) { scoreHistoryCache.delete(key); throw error; }
  }
  const cwlClan = tag => {
    const value = tagOf(tag);
    if (!/^[0289PYLQGRJCUV]{3,15}$/.test(value)) throw new Error('Tag de clã inválida.');
    return '/api/cwl/clans/' + encodeURIComponent('#' + value);
  };
  const cwlSeason = season => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(season)) throw new Error('Escolha uma edição válida da Liga.');
    return '/seasons/' + season;
  };
  function loadCwlPlan(tag, start) {
    if (!/^\d{8}T\d{6}\.\d{3}Z$/.test(start)) throw new Error('Escolha uma guerra válida.');
    return request(cwlClan(tag) + '/wars/' + encodeURIComponent(start) + '/plan', {auth:true});
  }
  window.ClanAPI = { loadClan, loadPlayerStats, loadScoreHistory, audit,
    cwlApiOrigin:API_ORIGIN||location.origin,
    cwlLoginUrl:API_ORIGIN?API_ORIGIN+'/?view=cwl':null,
    loadCwlSession:()=>API_ORIGIN?Promise.resolve({authenticated:false}):request('/api/cwl/auth/session',{auth:true}),
    loginCwl:(email,password)=>request('/api/cwl/auth/login',{method:'POST',auth:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),
    logoutCwl:()=>request('/api/cwl/auth/logout',{method:'POST',auth:true}),
    changeCwlPassword:(currentPassword,newPassword)=>request('/api/cwl/auth/password',{method:'POST',auth:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword,newPassword})}),
    initializeCwlPlan:(tag,start,archive)=>request(cwlClan(tag)+'/wars/'+encodeURIComponent(start)+'/plan/initialize',{method:'POST',auth:true,headers:{'Content-Type':'application/gzip'},body:archive,timeout:120000}),
    reviseCwlPlan:(tag,start,body)=>request(cwlClan(tag)+'/wars/'+encodeURIComponent(start)+'/plan/revisions',{method:'POST',auth:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    loadCwlSeason: (tag, season) => request(cwlClan(tag) + cwlSeason(season)),
    loadCwlAnalytics: (tag, season) => request(cwlClan(tag) + cwlSeason(season) + '/analytics', {auth:true}),
    loadCwlRanking: (tag, season) => request(cwlClan(tag) + cwlSeason(season) + '/ranking', {auth:true}), loadCwlPlan };
})();
