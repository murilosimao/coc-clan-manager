import { officialJson, clanPath, OfficialError } from './official-api.js';
import { reduceWar, warFingerprint, captureKey, CAPTURE_HEADER } from './cwl/war-archive.js';
import { clanTag, CwlError } from './cwl/errors.js';

// Last fingerprint and pending finals per clan. Isolates may be recycled at any
// time; a cold isolate simply sends one idempotent snapshot again.
const memory = new Map();
const PRIVATE_RETRY = 10 * 60000;

export function managedClans(env) {
  return String(env.WAR_ARCHIVE_CLANS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => clanTag(value));
}

export async function backendRequest(env, path, { method = 'GET', body, fetcher = fetch } = {}) {
  const headers = new Headers({ Accept: 'application/json', 'X-CWL-Proxy-Key': env.CWL_BACKEND_KEY,
    'X-CWL-Public-Origin': env.CWL_PUBLIC_ORIGIN, [CAPTURE_HEADER]: await captureKey(env.CWL_BACKEND_KEY) });
  if (env.CWL_BACKEND_REGION) headers.set('x-region', env.CWL_BACKEND_REGION);
  if (body) headers.set('Content-Type', 'application/json');
  const response = await fetcher(env.CWL_BACKEND_URL.replace(/\/$/, '') + path, { method, headers, redirect: 'manual',
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let data = null; try { data = await response.json(); } catch { /* Reported by status. */ }
  if (!response.ok) { const error = new Error('backend_' + response.status); error.status = response.status; error.code = data?.code; throw error; }
  return data;
}

const sameWar = (war, managed, pending) => war && war.preparationStartTime === pending.preparationStartTime
  && [war.clan?.tag, war.opponent?.tag].map(tag => String(tag || '').replace(/^#/, '')).sort().join() === [managed, pending.opponentTag].sort().join();

const store = (env, tag, war, source, now, fetcher) => backendRequest(env, '/api/cwl/war-archive/capture', { method: 'POST', fetcher,
  body: { clanTag: tag, source, observedAt: new Date(now).toISOString(), war } });

async function captureClan(env, tag, now, fetcher, log) {
  const state = memory.get(tag) || { fingerprint: '', pending: [], privateUntil: 0 };
  memory.set(tag, state);
  if (state.privateUntil > now) return { tag, status: 'skipped_private' };
  let raw;
  try { raw = await officialJson(clanPath(tag, 'currentwar'), env, fetcher); }
  catch (error) {
    if (!(error instanceof OfficialError)) throw error;
    if (error.status === 403) state.privateUntil = now + PRIVATE_RETRY;
    return { tag, status: 'official_' + error.status, reason: error.reason };
  }
  let status = raw?.state === 'notInWar' ? 'not_in_war' : 'unchanged', current = null;
  if (raw?.state !== 'notInWar') {
    current = reduceWar(raw, tag, 'clan');
    const fingerprint = warFingerprint(current);
    if (fingerprint !== state.fingerprint) {
      const result = await store(env, tag, current, 'clan', now, fetcher);
      state.fingerprint = fingerprint; state.pending = result.pending || [];
      status = result.stored;
    }
  }
  // A war that ended between polls is gone from our clan once the next one starts.
  // The opponent may still show it as ended; ClashKing uses the same fallback.
  for (const pending of state.pending.slice(0, 2)) {
    if (current && current.preparationStartTime === pending.preparationStartTime) continue;
    try {
      const other = await officialJson(clanPath(pending.opponentTag, 'currentwar'), env, fetcher);
      if (other?.state !== 'warEnded' || !sameWar(other, tag, pending)) continue;
      const result = await store(env, tag, reduceWar(other, tag, 'opponent'), 'opponent', now, fetcher);
      state.pending = result.pending || [];
      log({ type: 'war_capture', clan: tag, status: 'final_from_opponent', stored: result.stored });
    } catch (error) {
      if (!(error instanceof OfficialError)) throw error;
    }
  }
  return { tag, status, state: raw?.state || null };
}

export async function captureWars(env, { now = Date.now(), fetcher = fetch, log = console.log } = {}) {
  const tags = managedClans(env);
  if (!tags.length || !env.CWL_BACKEND_URL || !env.CWL_PUBLIC_ORIGIN) { log({ type: 'war_capture', status: 'not_configured' }); return []; }
  const results = await Promise.all(tags.map(tag => captureClan(env, tag, now, fetcher, log).catch(error => ({
    tag, status: String(error.message).startsWith('backend_') ? error.message : error instanceof CwlError ? 'invalid' : 'failed',
    ...(typeof error.code === 'string' ? { code: error.code } : {}) }))));
  // Never log payloads, keys or upstream bodies; only per-clan outcomes.
  for (const { tag, ...result } of results) {
    if (!['unchanged', 'skipped_private', 'not_in_war'].includes(result.status)) log({ type: 'war_capture', clan: tag, ...result });
  }
  return results;
}

export function resetCaptureMemory() { memory.clear(); }
