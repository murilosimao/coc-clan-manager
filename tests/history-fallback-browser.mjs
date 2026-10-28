import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CWL_UI_BASE_URL || 'http://127.0.0.1:8791';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const source = fs.readFileSync(new URL('../public/portal/clan-api.js', import.meta.url), 'utf8');

// Synthetic players: A and B played our last war, C only played the other
// family clan's war, D and E only have ClashKing history.
const mock = `
const at = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}Z$/, '.000Z');
const now = Date.now(), H = 3600000, scenario = localStorage.getItem('history-scenario') || 'fresh';
const member = (tag, name) => ({ tag, name, th: 17, clanRank: 1, position: 1, trophies: 5000, role: 'Member', pref: 'in' });
const attack = (from, to, stars, order) => ({ attackerTag: '#' + from, defenderTag: '#' + to, stars, destructionPercentage: 90, order });
function war(clanTag, roster, prep, end, extra = {}) {
  const members = roster.map(([tag, attacks], i) => ({ tag: '#' + tag, name: tag, townhallLevel: 17, mapPosition: i + 1, attacks }));
  const used = members.reduce((n, m) => n + m.attacks.length, 0);
  const rivals = roster.map((_, i) => ({ tag: '#R0' + 'PYLQ'[i], name: 'Rival', townhallLevel: 17, mapPosition: i + 1, attacks: [] }));
  return { state: 'warEnded', teamSize: roster.length, attacksPerMember: 2, preparationStartTime: at(prep), startTime: at(prep + 23 * H), endTime: at(end),
    clan: { tag: '#' + clanTag, name: 'Clã ' + clanTag, attacks: used, stars: 6, destructionPercentage: 90, members },
    opponent: { tag: '#2RGUJ2QLV', name: 'Rival', attacks: 0, stars: 0, destructionPercentage: 0, members: rivals }, ...extra };
}
const prep = now - 48 * H, end = now - H;
window.ClanAPI.loadClan = async (tag) => {
  const last = window.ClashKing.normalizeWar(war(tag, [['2QPLL', [attack('2QPLL', 'R0P', 3, 1), attack('2QPLL', 'R0Y', 3, 2)]], ['2QPGG', []]], prep, end), tag);
  last.captureComplete = scenario !== 'partial';
  return { clan: { name: 'PuroSangue' }, members: ['2QPLL', '2QPGG', '2QPCC', '2QPRR', '2QPJJ'].map((t) => member(t, 'J' + t.slice(-2))),
    lastWar: last, currentWar: null, warnings: [], fetchedAt: new Date().toISOString(), familyWars: [],
    historyFreshness: { archiveLatestEnd: at(end), officialLatestEnd: at(end), clashkingLatestEnd: at(scenario === 'stale' ? now - 8 * 24 * H : end) } };
};
window.ClanAPI.loadClanWars = async (tag) => ({ items: [{ ...war(tag, [['2QPCC', []], ['2QPUU', [attack('2QPUU', 'R0P', 2, 1)]]], prep + H, now - 30 * 60000),
  source: 'war-archive', capture: { complete: true } }] });
window.__statsCalls = [];
window.ClanAPI.loadPlayerStats = async (tag) => {
  window.__statsCalls.push(tag);
  const personal = (endMs, stars) => ({ type: 'random', state: 'warEnded', attacksPerMember: 2, endTime: at(endMs), clan: { name: 'Outro clã' }, opponent: { name: 'X' },
    attacks: stars.map((value, i) => ({ stars: value, destructionPercentage: 90, order: i + 1 })), defenses: [] });
  return { items: tag === '2QPRR' ? [personal(now - 3 * H, [3, 3])] : [personal(now - 72 * H, [0])] };
};`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('coc-clan-context-v1', JSON.stringify({ version: 1, tag: '2G8QCR92V' })));
  await page.route('**/portal/clan-api.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: source + mock }));
  await page.route('**/api/**', (route) => route.fulfill({ json: { authenticated: false, rounds: [], entries: [] } }));
  const ready = () => page.waitForFunction(() => window.ClanManager?.state.members.length && !window.ClanManager.state.loading && !window.ClanManager.state.historyLoading);
  const rows = () => page.evaluate(() => Object.fromEntries(window.ClanManager.state.selection.all.map((r) => [r.member.tag,
    { soft: r.softReasons.length, personal: r.usedPersonalHistory, source: r.historyWar?.sourceLabel || null, status: r.historyStatus, hold: r.partialCaptureHold, inWar: r.inWar }])));
  const scenario = async (name) => { await page.evaluate((value) => localStorage.setItem('history-scenario', value), name); await page.reload(); await ready(); };

  await page.goto(origin + '/'); await ready();
  assert.equal(await page.evaluate(() => window.ClanManager.state.settings.usePlayerHistoryFallback), true);
  let result = await rows();
  assert.deepEqual(result['2QPLL'], { soft: 0, personal: false, source: null, status: '', hold: false, inWar: true });
  assert.equal(result['2QPGG'].soft, 2, 'a recorded 0/2 in our last war keeps failing');
  assert.deepEqual([result['2QPCC'].personal, result['2QPCC'].source, result['2QPCC'].soft], [true, 'Arquivo da família', 2], 'family archive wins over ClashKing');
  assert.deepEqual([result['2QPRR'].personal, result['2QPRR'].source, result['2QPRR'].soft], [true, 'ClashKing', 0]);
  assert.deepEqual([result['2QPJJ'].personal, result['2QPJJ'].status, result['2QPJJ'].soft], [false, 'none', 0], 'a war older than our last war does not count again');
  assert.deepEqual(await page.evaluate(() => window.__statsCalls.sort()), ['2QPJJ', '2QPRR'], 'ClashKing is not consulted when the family archive answered');

  await scenario('stale');
  result = await rows();
  assert.deepEqual([result['2QPRR'].personal, result['2QPRR'].status, result['2QPRR'].soft], [false, 'stale', 0]);
  assert.equal(result['2QPCC'].source, 'Arquivo da família');
  assert.deepEqual(await page.evaluate(() => window.__statsCalls), []);
  assert.match(await page.locator('#status').innerText(), /ClashKing está desatualizado/);

  await scenario('partial');
  result = await rows();
  assert.deepEqual([result['2QPGG'].soft, result['2QPGG'].hold], [0, true], 'a partial capture never proves a missed attack');
  await page.locator('.team-rules').click();
  assert.match(await page.locator('#rules-view').innerText(), /Consultar histórico recente/);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS history fallback: family archive, fresh/stale ClashKing, one-war rule and partial captures');
} finally { await browser.close(); }
