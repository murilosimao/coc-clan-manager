import { CwlError, requireCondition, clanTag, warTime, timestamp } from './errors.js';

// Shared by the Worker poller and the private Supabase function. The capture
// key is derived from the bridge secret, so no new secret is distributed, and
// the public bridge never sends this header.
export const CAPTURE_HEADER = 'X-War-Capture-Key';
export const MAX_CAPTURE_BYTES = 262144;
const STATES = new Set(['preparation', 'inWar', 'warEnded']);
const HOUR = 3600000;

export async function captureKey(secret) {
  requireCondition(typeof secret === 'string' && secret.length >= 32, 503, 'Arquivo de guerras não configurado.', 'war_archive_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('war-archive-capture-v1')));
  return [...mac].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sameKey(provided, expected) {
  const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value || '')));
  const [a, b] = await Promise.all([hash(provided), hash(expected)]);
  let delta = 0; for (let i = 0; i < a.length; i++) delta |= a[i] ^ b[i];
  return delta === 0 && typeof provided === 'string' && provided.length === expected.length;
}

const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const pct = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const text = (value, max = 50) => typeof value === 'string' ? value.slice(0, max) : '';
function invalid(condition, detail) { requireCondition(condition, 422, 'Guerra recebida em formato inesperado: ' + detail + '.', 'invalid_war_capture'); }

function badges(value) {
  const result = {};
  for (const size of ['small', 'medium', 'large']) {
    const url = value?.[size];
    if (typeof url === 'string' && /^https:\/\/api-assets\.clashofclans\.com\/badges\/(70|200|512)\/[A-Za-z0-9_-]+\.png$/.test(url)) result[size] = url;
  }
  return result;
}

function side(value, teamSize, attacksPerMember, label) {
  invalid(value && typeof value === 'object', label);
  const tag = clanTag(value.tag);
  const members = value.members;
  invalid(Array.isArray(members) && members.length === teamSize, label + ' sem o elenco completo');
  const seen = new Set();
  const reduced = members.map(member => {
    const memberTag = clanTag(member?.tag);
    invalid(!seen.has(memberTag), label + ' com jogador repetido'); seen.add(memberTag);
    invalid(int(member.townhallLevel, 1, 20) && int(member.mapPosition, 1, 50), label + ' com jogador incompleto');
    const attacks = member.attacks == null ? [] : member.attacks;
    invalid(Array.isArray(attacks) && attacks.length <= attacksPerMember, label + ' com ataques demais');
    return { tag: '#' + memberTag, name: text(member.name), townhallLevel: member.townhallLevel, mapPosition: member.mapPosition,
      attacks: attacks.map(attack => {
        invalid(clanTag(attack?.attackerTag) === memberTag && int(attack.stars, 0, 3) && pct(attack.destructionPercentage)
          && int(attack.order, 1, 200) && (attack.duration == null || int(attack.duration, 0, 600)), label + ' com ataque incompleto');
        return { attackerTag: '#' + memberTag, defenderTag: '#' + clanTag(attack.defenderTag), stars: attack.stars,
          destructionPercentage: attack.destructionPercentage, order: attack.order,
          ...(attack.duration == null ? {} : { duration: attack.duration }) };
      }) };
  });
  const used = reduced.reduce((n, member) => n + member.attacks.length, 0);
  invalid(int(value.attacks, 0, 200) && value.attacks === used, label + ' com total de ataques divergente');
  invalid(int(value.stars, 0, 150) && pct(value.destructionPercentage), label + ' sem placar');
  return { tag: '#' + tag, name: text(value.name), badgeUrls: badges(value.badgeUrls),
    clanLevel: int(value.clanLevel, 1, 100) ? value.clanLevel : null,
    attacks: value.attacks, stars: value.stars, destructionPercentage: value.destructionPercentage, members: reduced };
}

// Validates an official currentwar response and returns it oriented so that
// `clan` is the managed clan, even when it was read from the opponent's side.
export function reduceWar(raw, managedTag, source = 'clan') {
  const tag = clanTag(managedTag);
  invalid(raw && typeof raw === 'object' && STATES.has(raw.state), 'estado da guerra');
  invalid(['clan', 'opponent'].includes(source), 'origem');
  const preparationStartTime = warTime(raw.preparationStartTime), startTime = warTime(raw.startTime), endTime = warTime(raw.endTime);
  const prep = timestamp(preparationStartTime), start = timestamp(startTime), end = timestamp(endTime);
  invalid(prep < start && start < end, 'horários');
  invalid(int(raw.teamSize, 1, 50), 'tamanho');
  invalid(int(raw.attacksPerMember, 1, 2), 'ataques por jogador');
  const left = side(raw.clan, raw.teamSize, raw.attacksPerMember, 'clã');
  const right = side(raw.opponent, raw.teamSize, raw.attacksPerMember, 'adversário');
  invalid(left.tag !== right.tag, 'clãs repetidos');
  const ours = left.tag === '#' + tag ? left : right.tag === '#' + tag ? right : null;
  invalid(ours, 'guerra de outro clã');
  // Regular wars use 23h preparation and 24h battle; maintenance may shift the clock slightly.
  const regular = Math.abs(start - prep - 23 * HOUR) <= HOUR && Math.abs(end - start - 24 * HOUR) <= 2 * HOUR;
  return {
    state: raw.state, type: regular ? 'random' : 'friendly', teamSize: raw.teamSize, attacksPerMember: raw.attacksPerMember,
    battleModifier: typeof raw.battleModifier === 'string' ? text(raw.battleModifier, 20) : null,
    preparationStartTime, startTime, endTime,
    clan: ours, opponent: ours === left ? right : left,
  };
}

export function warFingerprint(war) {
  return [war.preparationStartTime, war.state, war.clan.attacks, war.opponent.attacks, war.clan.stars, war.opponent.stars, war.endTime].join('|');
}

const response = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function readCapture(request) {
  requireCondition(request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'), 415, 'Envie application/json.');
  const reader = request.body?.getReader();
  requireCondition(reader, 400, 'Corpo JSON obrigatório.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > MAX_CAPTURE_BYTES) { await reader.cancel(); throw new CwlError(413, 'Guerra muito grande.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new CwlError(400, 'JSON inválido.'); }
}

const iso = value => new Date(value).toISOString().replace(/[-:]/g, '');

export function createWarArchiveHandler({ database, clock = Date.now } = {}) {
  return async function handleWarArchive(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/cwl/war-archive/')) return null;
    const read = path.match(/^\/api\/cwl\/war-archive\/clans\/([^/]+)$/);
    requireCondition(read || path === '/api/cwl/war-archive/capture', 404, 'Rota não encontrada.');
    requireCondition(request.method === (read ? 'GET' : 'POST'), 405, 'Método não permitido.');
    requireCondition(await sameKey(request.headers.get(CAPTURE_HEADER), await captureKey(env.CWL_BACKEND_KEY)), 401, 'Acesso não autorizado.', 'unauthorized');
    const now = clock();
    try {
      if (read) {
        const tag = clanTag(decodeURIComponent(read[1]));
        const limit = Math.max(1, Math.min(20, Number(new URL(request.url).searchParams.get('limit')) || 10));
        return await database(env, async sql => {
          const rows = await sql`select payload,final,source,observed_at from cwl.war_archive
            where clan_tag=${tag} and end_time<=${new Date(now)} order by end_time desc limit ${limit}`;
          return response({ clanTag: tag, items: rows.map(row => ({ war: row.payload, final: row.final, source: row.source,
            observedAt: new Date(row.observed_at).toISOString() })) });
        });
      }
      const body = await readCapture(request);
      requireCondition(body && typeof body === 'object' && !Array.isArray(body), 400, 'Objeto JSON obrigatório.');
      const tag = clanTag(body.clanTag);
      const source = body.source === 'opponent' ? 'opponent' : 'clan';
      const war = reduceWar(body.war, tag, source);
      const observed = timestamp(body.observedAt);
      requireCondition(Number.isFinite(observed) && observed <= now + 60000 && observed >= now - 15 * 60000, 400, 'Horário de captura inválido.', 'invalid_war_capture');
      // A final capture needs the API to say the war ended; a snapshot after the end is only partial.
      const final = war.state === 'warEnded';
      return await database(env, async sql => {
        const [row] = await sql`insert into cwl.war_archive as w (clan_tag,preparation_start,opponent_tag,war_type,state,final,start_time,end_time,
            team_size,attacks_per_member,attacks_used,source,payload,observed_at)
          values (${tag},${new Date(timestamp(war.preparationStartTime))},${war.opponent.tag.slice(1)},${war.type},${war.state},${final},
            ${new Date(timestamp(war.startTime))},${new Date(timestamp(war.endTime))},${war.teamSize},${war.attacksPerMember},
            ${war.clan.attacks},${source},${sql.json(war)},${new Date(observed)})
          on conflict (clan_tag,preparation_start) do update set state=excluded.state,final=excluded.final,start_time=excluded.start_time,
            end_time=excluded.end_time,attacks_per_member=excluded.attacks_per_member,attacks_used=excluded.attacks_used,
            source=excluded.source,payload=excluded.payload,observed_at=excluded.observed_at
          where not w.final and w.opponent_tag=excluded.opponent_tag and w.war_type=excluded.war_type and w.team_size=excluded.team_size
            and excluded.attacks_used>=w.attacks_used and excluded.observed_at>=w.observed_at
            and (excluded.payload is distinct from w.payload or excluded.state is distinct from w.state)
          returning (xmax=0) as inserted`;
        // Wars whose end passed without a final capture: the poller tries the opponent's side.
        const pending = await sql`select opponent_tag,preparation_start,end_time from cwl.war_archive
          where clan_tag=${tag} and not final and end_time<${new Date(now)} and end_time>${new Date(now - 6 * HOUR)}
          order by end_time desc limit 3`;
        return response({ stored: row ? (row.inserted ? 'inserted' : 'updated') : 'unchanged', final,
          pending: pending.map(p => ({ opponentTag: p.opponent_tag, preparationStartTime: iso(p.preparation_start), endTime: iso(p.end_time) })) },
        row?.inserted ? 201 : 200);
      });
    } catch (error) {
      if (error instanceof CwlError) throw error;
      // Never expose PostgreSQL errors, SQL text, connection strings or credentials.
      throw new CwlError(503, 'Não foi possível acessar o arquivo de guerras.', 'database_unavailable');
    }
  };
}
