import { CwlError, requireCondition, timestamp } from './errors.js';
import { WarScores, ClashKing } from './scoring.js';
const cleanTag = value => String(value || '').replace(/^#/, '').toUpperCase();
export const PLAYER_HISTORY_VERSION = 'player-war-history-v1';
const rawKey = w => [cleanTag(w.clan?.tag), cleanTag(w.opponent?.tag)].sort().join('|') + '|' + w.endTime;
async function limitedMap(items, limit, task) {
  const results = Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (index < items.length) { const i = index++; try { results[i] = { status: 'fulfilled', value: await task(items[i]) }; } catch (reason) { results[i] = { status: 'rejected', reason }; } } }));
  return results;
}
export class ClashCwlProvider {
  constructor(fetcher = (url, options) => fetch(url, options), options = {}) { this.fetcher = fetcher; this.options = { playerHistory: true, playerLimit: 100, warLimit: 160, concurrency: 4, ...options }; }
  async get(origin, path, optional = false) {
    let response;
    try { response = await this.fetcher(origin + path, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch { throw new CwlError(502, 'Não foi possível consultar a fonte de dados.', 'upstream_unavailable'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (optional && [403, 404].includes(response.status)) return null;
      throw new CwlError(response.status === 404 ? 404 : response.status === 429 ? 429 : 502, 'Fonte de dados indisponível para esta consulta.', 'upstream_unavailable');
    }
    try { return await response.json(); } catch { throw new CwlError(502, 'Resposta inválida da fonte.', 'invalid_upstream'); }
  }
  async history(tag, type) {
    const data = await this.get('https://api.clashk.ing', `/v2/clan/${encodeURIComponent('#' + tag)}/wars?limit=${type === 'random' ? 60 : 35}&type=${type}`);
    requireCondition(Array.isArray(data?.items), 502, 'Histórico inválido da fonte.');
    return data.items.map(w => ({ ...w, type: w.type || type }));
  }
  async season(tag, season) {
    const [history, current] = await Promise.all([
      this.history(tag, 'cwl'),
      this.get('https://clashapi.colinschmale.dev', `/v1/clans/${encodeURIComponent('#' + tag)}/currentwar`, true),
    ]);
    const all = [...history];
    if (current && (current.type === 'cwl' || current.attacksPerMember === 1)) all.unshift({ ...current, type: 'cwl' });
    const seen = new Set();
    return all.filter(w => {
      const month = Number.isFinite(timestamp(w.preparationStartTime)) ? new Date(timestamp(w.preparationStartTime)).toISOString().slice(0, 7) : null;
      if ((w.season || month) !== season || seen.has(w.startTime)) return false;
      seen.add(w.startTime); return true;
    }).sort((a, b) => timestamp(a.startTime) - timestamp(b.startTime));
  }
  async war(tag, start) {
    const current = await this.get('https://clashapi.colinschmale.dev', `/v1/clans/${encodeURIComponent('#' + tag)}/currentwar`, true);
    if (current?.startTime === start && (current.type === 'cwl' || current.attacksPerMember === 1)) return { ...current, type: 'cwl' };
    const history = await this.history(tag, 'cwl');
    const war = history.find(w => w.startTime === start);
    if (!war) throw new CwlError(404, 'Rodada CWL não encontrada. A fonte pode não ter registrado esta guerra.', 'round_not_found');
    return war;
  }
  async training(raw) {
    const tags = [raw.clan.tag, raw.opponent.tag].map(t => t.replace('#', ''));
    // Four independent public requests; dated eligibility is enforced by the shared score engine.
    const jobs = tags.flatMap(tag => ['random', 'cwl'].map(type => ({ tag, type })));
    const results = await Promise.allSettled(jobs.map(j => this.history(j.tag, j.type)));
    const warnings = results.flatMap((r, i) => r.status === 'rejected' ? [`history_unavailable:${jobs[i].tag}:${jobs[i].type}`] : []);
    requireCondition(results.some(r => r.status === 'fulfilled'), 502, 'Nenhuma fonte de histórico respondeu.');
    const history = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const sources = jobs.map((j, i) => ({ ...j, available: results[i].status === 'fulfilled', count: results[i].status === 'fulfilled' ? results[i].value.length : 0 }));
    if (this.options.playerHistory) {
      const extra = await this.expandPlayerHistory(raw, history);
      history.push(...extra.history); warnings.push(...extra.warnings); sources.push(...extra.sources);
    }
    return { history, warnings, sources, historyPolicy: { version: PLAYER_HISTORY_VERSION, enabled: this.options.playerHistory,
      playerLimit: this.options.playerLimit, warLimit: this.options.warLimit, perPlayerResultLimit: 200,
      normalHistoryDays: WarScores.CONFIG.normalHistoryDays, cwlSeasonLimit: WarScores.CONFIG.cwlSeasonLimit }, fetchedAt: new Date().toISOString() };
  }
  async expandPlayerHistory(raw, history) {
    const war = ClashKing.normalizeWar({ ...raw, type: 'cwl', attacksPerMember: 1 }, raw.clan.tag);
    const collected = WarScores.collect(war, history), { cutoff, normalSince, cwlSeasons } = collected.context;
    const counts = new Map();
    for (const e of collected.events) for (const [player, role] of [[e.attacker, 'attack'], [e.defender, 'defense']]) {
      const k = WarScores.playerKey(player) + ':' + role, v = counts.get(k) || { n: 0, weight: 0 }; v.n++; v.weight += e.weight; counts.set(k, v);
    }
    const missing = [...war.roster, ...war.opponentRoster].filter(p => ['attack', 'defense'].some(role => { const v = counts.get(WarScores.playerKey(p) + ':' + role); return !v || v.n < 5 || v.weight < 2; }));
    const warnings = [], sources = [], known = new Set(history.filter(w => WarScores.historyQuality(w)).map(rawKey)), references = new Map();
    const horizon = new Date(cutoff); horizon.setUTCMonth(horizon.getUTCMonth() - 3); horizon.setUTCDate(1);
    const since = Math.min(normalSince, horizon.getTime(), ...Object.values(cwlSeasons).flat().map(s => Date.parse(s + '-01T00:00:00Z')));
    const players = missing.slice(0, this.options.playerLimit);
    if (players.length < missing.length) warnings.push('player_history_lookup_limit');
    const queries = await limitedMap(players, this.options.concurrency, async player => {
      const query = new URLSearchParams({ 'time[after]': new Date(since).toISOString(), 'time[before]': new Date(cutoff).toISOString(), limit: '200' });
      const data = await this.get('https://api.clashk.ing', `/v2/player/${encodeURIComponent('#' + player.tag)}/war/attacks?${query}`);
      requireCondition(Array.isArray(data?.items), 502, 'Histórico individual inválido.');
      return { player, items: data.items };
    });
    for (let i = 0; i < queries.length; i++) {
      const result = queries[i], player = players[i];
      sources.push({ tag: player.tag, type: 'player_war_references', available: result.status === 'fulfilled', count: result.value?.items.length || 0, before: cutoff, after: since });
      if (result.status === 'rejected') { warnings.push(`player_history_unavailable:${player.tag}`); continue; }
      if (result.value.items.length >= 200) warnings.push(`player_history_may_be_truncated:${player.tag}`);
      for (const hit of result.value.items) {
        const attacking = cleanTag(hit.attackerTag) === player.tag, defending = cleanTag(hit.defenderTag) === player.tag;
        const ownTH = attacking ? hit.attackerTownhall : hit.defenderTownhall, end = timestamp(hit.warEndTime);
        if ((!attacking && !defending) || ownTH !== player.th || !['cwl','random'].includes(hit.warType)
            || !Number.isFinite(end) || end > cutoff || end < since || hit.warType === 'random' && end < normalSince
            || typeof hit.battleModifier !== 'string' || hit.battleModifier.toLowerCase() !== collected.context.modifier) continue;
        const clans = [cleanTag(hit.attackingClanTag), cleanTag(hit.defendingClanTag)];
        if (!clans.every(t => /^[0289PYLQGRJCUV]{3,15}$/.test(t)) || !/^\d{8}T\d{6}\.\d{3}Z$/.test(hit.warEndTime)) continue;
        const key = [...clans].sort().join('|') + '|' + hit.warEndTime;
        if (!known.has(key)) references.set(key, { key, clan: attacking ? clans[0] : clans[1], end: hit.warEndTime, type: hit.warType });
      }
    }
    const selected = [...references.values()].sort((a,b) => timestamp(b.end)-timestamp(a.end) || a.key.localeCompare(b.key)).slice(0, this.options.warLimit);
    if (selected.length < references.size) warnings.push('player_history_war_limit');
    const full = await limitedMap(selected, this.options.concurrency, async ref => {
      const value = await this.get('https://api.clashk.ing', `/v2/war/${encodeURIComponent('#' + ref.clan)}/previous/${encodeURIComponent(ref.end)}`);
      requireCondition(rawKey(value) === ref.key && value.state === 'warEnded', 502, 'Guerra individual não corresponde à referência.');
      return { ...value, type: value.type || ref.type };
    });
    for (let i = 0; i < full.length; i++) {
      const result = full[i], ref = selected[i];
      sources.push({ tag: ref.clan, type: 'player_complete_war', end: ref.end, available: result.status === 'fulfilled', count: result.status === 'fulfilled' ? 1 : 0 });
      if (result.status === 'rejected') warnings.push(`player_war_unavailable:${ref.clan}:${ref.end}`);
    }
    return { history: full.flatMap(r => r.status === 'fulfilled' ? [r.value] : []), warnings, sources };
  }
}
