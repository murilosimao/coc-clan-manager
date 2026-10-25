import { CwlError, requireCondition, timestamp } from './errors.js';
export class ClashCwlProvider {
  constructor(fetcher = (url, options) => fetch(url, options)) { this.fetcher = fetcher; }
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
    return { history: results.flatMap(r => r.status === 'fulfilled' ? r.value : []), warnings,
      sources: jobs.map((j, i) => ({ ...j, available: results[i].status === 'fulfilled', count: results[i].status === 'fulfilled' ? results[i].value.length : 0 })), fetchedAt: new Date().toISOString() };
  }
}
