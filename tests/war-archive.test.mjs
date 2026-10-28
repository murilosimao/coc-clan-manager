import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectDatabase } from '../src/cwl/database.js';
import { migrate } from '../scripts/migrate-cwl.mjs';
import { createEdgeHandler } from '../src/cwl/edge.js';
import { reduceWar, captureKey, CAPTURE_HEADER } from '../src/cwl/war-archive.js';
import { captureWars, resetCaptureMemory } from '../src/war-capture.js';
import { mergeWarHistory, historyFreshness } from '../src/war-history.js';
import { createWorker } from '../src/worker.js';

const url = new URL(process.env.CWL_TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!process.env.CWL_TEST_DATABASE_URL) url.pathname = '/coc_cwl_test';
assert(url.pathname.endsWith('_test'));
const app = 'https://app.example.workers.dev', ours = '2G8QCR92V', rival = '2RGUJ2QLV', next = '8GV8L92R';
const env = { DATABASE_URL: url.href, CWL_APP_ORIGIN: app, CWL_BACKEND_KEY: 'test-bridge-key-'.padEnd(64, 'x') };
const PREP = '20261026T162600.000Z', START = '20261027T152600.000Z', END = '20261028T152600.000Z';
const at = value => Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));

// Synthetic players only; real member tags stay out of the public repository.
const playerTag = (prefix, i) => '#' + prefix + 'PQ' + 'PYLQGRJCUV'[i];
function side(tag, prefix, otherPrefix, size, attacksBy) {
  const members = Array.from({ length: size }, (_, i) => ({
    tag: playerTag(prefix, i), name: 'Jogador ' + prefix + i, townhallLevel: 17, mapPosition: i + 1,
    ...(attacksBy?.[i] ? { attacks: attacksBy[i].map((stars, n) => ({ attackerTag: playerTag(prefix, i), defenderTag: playerTag(otherPrefix, (i + n) % size),
      stars, destructionPercentage: stars === 3 ? 100 : 60, order: i * 2 + n + 1, duration: 120 })) } : {}),
  }));
  const attacks = members.reduce((n, m) => n + (m.attacks?.length || 0), 0);
  const stars = members.reduce((n, m) => n + (m.attacks || []).reduce((s, a) => s + a.stars, 0), 0);
  return { tag: '#' + tag, name: 'Clã ' + tag, clanLevel: 17, attacks, stars, destructionPercentage: attacks ? 80 : 0, members,
    badgeUrls: { small: 'https://api-assets.clashofclans.com/badges/70/abc_DEF-1.png', evil: 'javascript:alert(1)' } };
}
function officialWar({ state = 'inWar', clan = ours, opponent = rival, prep = PREP, start = START, end = END, attacks = { 0: [3, 3] }, size = 5 } = {}) {
  return { state, teamSize: size, attacksPerMember: 2, battleModifier: 'none', preparationStartTime: prep, startTime: start, endTime: end,
    clan: side(clan, 'Q', 'R', size, state === 'preparation' ? null : attacks), opponent: side(opponent, 'R', 'Q', size, null) };
}

const flip = war => ({ ...war, clan: war.opponent, opponent: war.clan });

let sql, edge, clock;
before(async () => {
  if (!process.env.CWL_TEST_DATABASE_URL) {
    const control = connectDatabase(process.env);
    if (!(await control`select 1 from pg_database where datname='coc_cwl_test'`).length) await control.unsafe('CREATE DATABASE coc_cwl_test');
    await control.end();
  }
  sql = connectDatabase(env); await migrate(sql);
  await sql.unsafe(fs.readFileSync(new URL('../db/security/cwl-runtime.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  // The runtime cannot delete captures; the owner resets the test table.
  await sql.unsafe('ALTER TABLE cwl.war_archive DISABLE TRIGGER protect_war_capture; DELETE FROM cwl.war_archive; ALTER TABLE cwl.war_archive ENABLE TRIGGER protect_war_capture;');
  clock = at(START) + 3600000;
  edge = createEdgeHandler(env, { database: (e, fn) => fn(sql), clock: () => clock });
});
after(async () => sql?.end());

const capture = async (body, headers = {}) => edge(new Request('https://db.example.supabase.co/functions/v1/cwl/api/cwl/war-archive/capture', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-CWL-Proxy-Key': env.CWL_BACKEND_KEY,
    'X-CWL-Public-Origin': app, [CAPTURE_HEADER]: await captureKey(env.CWL_BACKEND_KEY), ...headers } }));
const readArchive = async tag => (await edge(new Request(`https://db.example.supabase.co/functions/v1/cwl/api/cwl/war-archive/clans/${tag}`, {
  headers: { 'X-CWL-Proxy-Key': env.CWL_BACKEND_KEY, 'X-CWL-Public-Origin': app, [CAPTURE_HEADER]: await captureKey(env.CWL_BACKEND_KEY) } }))).json();
const snapshot = (war, extra = {}) => ({ clanTag: ours, source: 'clan', observedAt: new Date(clock).toISOString(), war: reduceWar(war, ours), ...extra });

test('reduceWar validates the official war, keeps the managed clan as `clan` and drops unsafe fields', () => {
  const flipped = officialWar({ clan: rival, opponent: ours });
  const reduced = reduceWar(flipped, ours, 'opponent');
  assert.equal(reduced.clan.tag, '#' + ours); assert.equal(reduced.opponent.tag, '#' + rival);
  assert.equal(reduced.type, 'random'); assert.deepEqual(Object.keys(reduced.clan.badgeUrls), ['small']);
  assert.equal(reduceWar(officialWar({ start: '20261026T172600.000Z', end: '20261026T182600.000Z' }), ours).type, 'friendly');
  const broken = officialWar(); broken.clan.attacks = 5;
  assert.throws(() => reduceWar(broken, ours), /total de ataques/);
  assert.throws(() => reduceWar(officialWar({ clan: next }), ours), /outro clã/);
  const short = officialWar(); short.opponent.members.pop();
  assert.throws(() => reduceWar(short, ours), /elenco completo/);
});

test('captures move forward until the final result, which is then immutable', async () => {
  assert.equal((await capture(snapshot(officialWar({ state: 'preparation' })))).status, 201);
  let body = await (await capture(snapshot(officialWar({ state: 'preparation' })))).json();
  assert.equal(body.stored, 'unchanged');
  clock += 60000;
  body = await (await capture(snapshot(officialWar({ attacks: { 0: [3, 3], 1: [2] } })))).json();
  assert.equal(body.stored, 'updated'); assert.equal(body.final, false);
  // An older or regressed snapshot never replaces newer evidence.
  body = await (await capture(snapshot(officialWar({ attacks: { 0: [3] } })))).json();
  assert.equal(body.stored, 'unchanged');
  clock = at(END) + 120000;
  body = await (await capture(snapshot(officialWar({ state: 'warEnded', attacks: { 0: [3, 3], 1: [2, 1] } })))).json();
  assert.equal(body.stored, 'updated'); assert.equal(body.final, true);
  clock += 60000;
  body = await (await capture(snapshot(officialWar({ state: 'warEnded', attacks: { 0: [3, 3], 1: [2, 1], 2: [3] } })))).json();
  assert.equal(body.stored, 'unchanged');
  const [row] = await sql`select final,attacks_used,state from cwl.war_archive`;
  assert.deepEqual({ ...row }, { final: true, attacks_used: 4, state: 'warEnded' });
  await assert.rejects(sql`update cwl.war_archive set attacks_used=5`, /immutable/);
  await assert.rejects(sql`delete from cwl.war_archive`, /immutable/);
  const archive = await readArchive(ours);
  assert.equal(archive.items.length, 1); assert.equal(archive.items[0].final, true);
  assert.equal(archive.items[0].war.clan.members[1].attacks.length, 2);
});

test('the archive rejects visitors, other origins and missing capture keys', async () => {
  assert.equal((await capture(snapshot(officialWar()), { [CAPTURE_HEADER]: 'x'.repeat(64) })).status, 401);
  assert.equal((await capture(snapshot(officialWar()), { 'X-CWL-Public-Origin': 'https://evil.example' })).status, 403);
  assert.equal((await capture(snapshot(officialWar()), { 'X-CWL-Proxy-Key': 'wrong' })).status, 401);
  assert.equal((await capture({ ...snapshot(officialWar()), observedAt: new Date(clock - 3600000).toISOString() })).status, 400);
  const worker = createWorker(async () => { throw new Error('must not bridge'); });
  const response = await worker.fetch(new Request(app + '/api/cwl/war-archive/capture', { method: 'POST', headers: { Origin: app } }), { CWL_BACKEND_URL: 'https://db.example.supabase.co/functions/v1/cwl' }, {});
  assert.equal(response.status, 404);
  assert.equal((await sql`select count(*)::int as n from cwl.war_archive`)[0].n, 0);
});

test('a war that ended unseen is reported pending and completed from the opponent side', async () => {
  await capture(snapshot(officialWar({ attacks: { 0: [3, 3] } })));
  clock = at(END) + 20 * 60000;
  const body = await (await capture(snapshot(officialWar({ state: 'preparation', opponent: next, prep: '20261028T153400.000Z',
    start: '20261029T143400.000Z', end: '20261030T143400.000Z' })))).json();
  assert.deepEqual(body.pending, [{ opponentTag: rival, preparationStartTime: PREP, endTime: END }]);
  const fromOpponent = reduceWar(flip(officialWar({ state: 'warEnded', attacks: { 0: [3, 3], 1: [1] } })), ours, 'opponent');
  const ended = await (await capture({ clanTag: ours, source: 'opponent', observedAt: new Date(clock).toISOString(), war: fromOpponent })).json();
  assert.equal(ended.final, true); assert.deepEqual(ended.pending, []);
});

test('the poller sends only changed snapshots and falls back to the opponent for a missed end', async () => {
  resetCaptureMemory();
  const posts = [], calls = [];
  let ourWar = officialWar(), rivalWar = null;
  const fetcher = async (target, options) => {
    const href = String(target); calls.push(href);
    if (href.startsWith('https://cocproxy.royaleapi.dev/v1/clans/')) {
      assert.equal(options.headers.Authorization, 'Bearer ' + 'k'.repeat(40));
      if (href.includes(encodeURIComponent('#2CQ9CR2YP'))) return Response.json({ reason: 'accessDenied', message: 'private secret text' }, { status: 403 });
      return Response.json(href.includes(encodeURIComponent('#' + rival)) ? rivalWar : ourWar);
    }
    const request = new Request(href, options); const body = await request.json(); posts.push(body);
    return edge(new Request(href, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }));
  };
  const cron = { WAR_ARCHIVE_CLANS: `${ours},2CQ9CR2YP`, CWL_BACKEND_URL: 'https://db.example.supabase.co/functions/v1/cwl', CWL_BACKEND_KEY: env.CWL_BACKEND_KEY,
    CWL_PUBLIC_ORIGIN: app, COC_API_MODE: 'royaleapi', COC_WORKER_API_KEY: 'k'.repeat(40) };
  const logs = [];
  let results = await captureWars(cron, { now: clock, fetcher, log: entry => logs.push(entry) });
  assert.deepEqual(results.map(r => r.status), ['inserted', 'official_403']);
  results = await captureWars(cron, { now: clock + 60000, fetcher, log: entry => logs.push(entry) });
  assert.deepEqual(results.map(r => r.status), ['unchanged', 'skipped_private']);
  assert.equal(posts.length, 1);
  assert.ok(!JSON.stringify(logs).includes('secret'));
  clock = at(END) + 20 * 60000;
  ourWar = officialWar({ state: 'preparation', opponent: next, prep: '20261028T153400.000Z', start: '20261029T143400.000Z', end: '20261030T143400.000Z' });
  rivalWar = flip(officialWar({ state: 'warEnded', attacks: { 0: [3, 3], 1: [2, 2] } }));
  await captureWars(cron, { now: clock, fetcher, log: entry => logs.push(entry) });
  assert.deepEqual(posts.map(p => p.source), ['clan', 'clan', 'opponent']);
  const rows = await sql`select opponent_tag,final,source from cwl.war_archive order by preparation_start`;
  assert.deepEqual(rows.map(r => ({ ...r })), [{ opponent_tag: rival, final: true, source: 'opponent' }, { opponent_tag: next, final: false, source: 'clan' }]);
});

test('merge prefers our final capture, never lets a partial one replace a finished ClashKing war, and reports freshness', () => {
  const ck = [{ ...officialWar({ state: 'warEnded', prep: '20261018T181551.000Z', start: '20261019T171551.000Z', end: '20261020T175138.000Z' }) },
    { ...officialWar({ state: 'warEnded' }), source: 'x' }];
  const finalCapture = { war: reduceWar(officialWar({ state: 'warEnded', attacks: { 0: [3, 3], 1: [3, 3] } }), ours), final: true, source: 'clan', observedAt: 'now' };
  const now = at(END) + 3600000;
  let merged = mergeWarHistory(ours, [finalCapture], ck, now);
  assert.deepEqual(merged.map(w => [w.endTime, w.source]), [[END, 'war-archive'], ['20261020T175138.000Z', 'clashking']]);
  const partial = { ...finalCapture, final: false, war: { ...finalCapture.war, state: 'inWar' } };
  merged = mergeWarHistory(ours, [partial], ck, now);
  assert.equal(merged[0].source, 'clashking');
  merged = mergeWarHistory(ours, [partial], [ck[0]], now);
  assert.deepEqual([merged[0].source, merged[0].state, merged[0].capture.complete], ['war-archive', 'warEnded', false]);
  assert.equal(mergeWarHistory(ours, [partial], [], at(END) - 1).length, 0);
  assert.deepEqual(historyFreshness([finalCapture], [ck[0]], [{ endTime: END }]),
    { archiveLatestEnd: END, clashkingLatestEnd: '20261020T175138.000Z', officialLatestEnd: END });
});
