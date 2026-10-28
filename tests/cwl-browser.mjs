import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CWL_UI_BASE_URL || 'http://127.0.0.1:8791';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Browser checks require a local preview');
const data = JSON.parse(fs.readFileSync(new URL('../public/portal/cwl-demo.json', import.meta.url)));
const dir = new URL('../.wrangler/cwl-ui-review/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR', permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1440, height: 1050 } });
await context.addInitScript(()=>{if(!localStorage.getItem('coc-clan-context-v1'))localStorage.setItem('coc-clan-context-v1',JSON.stringify({version:1,tag:'2G8QCR92V'}));});
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const done = () => page.waitForFunction(() => window.CwlApp?.state.ranking && !window.CwlApp.state.loading);
const record = label => { checks.push(label); console.log('PASS ' + label); };
await page.goto(origin + '/?demo=1&view=cwl'); await done();
assert.equal(await page.locator('.cwl-mission-item').count(), 15);
assert.equal(await page.locator('#cwl-season').isDisabled(), true);
assert.ok(await page.locator('#status').isHidden()); record('explicit demo and separate public plan workspace');
for (const width of [320, 390, 768, 800, 1024, 1440]) {
  await page.setViewportSize({ width, height: 1050 });
  for (const tab of ['plan', 'ranking']) {
    await page.locator(`[data-cwl-action=tab][data-tab=${tab}]`).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${width} ${tab} overflow`);
    if ([390, 1440].includes(width)) await page.screenshot({ path: `${dir}/${width}-${tab}.png` });
  }
} record('integrated desktop/mobile layout has no overflow at five widths');
await page.setViewportSize({ width: 1440, height: 1050 });
await page.locator('#cwl-tab-plan').focus(); await page.keyboard.press('ArrowRight');
assert.equal(await page.locator('#cwl-tab-ranking').getAttribute('aria-selected'), 'true');
assert.equal(await page.evaluate(() => document.activeElement.id), 'cwl-tab-ranking'); record('keyboard navigation between tabs');
const first = page.locator('.cwl-rank-row').first(); await first.locator(':scope > summary').click();
const name = await first.locator('.cwl-rank-main > strong').innerText();
await page.locator('#cwl-query').fill(name.slice(0, 3));
assert.equal(await page.evaluate(() => document.activeElement.id), 'cwl-query');
assert.equal(await page.locator('.cwl-rank-row').first().getAttribute('open'), '');
assert.equal(await page.locator('#cwl-query').inputValue(), name.slice(0, 3)); record('search preserves focus and opened calculation');
await page.locator('#cwl-query').fill('');
await page.locator('.cwl-export').click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
assert.ok(copied.startsWith('Posição\tJogador\tTag\tMérito'));
assert.equal(copied.split('\r\n').length, 17); record('desktop export copies the CWL ranking, not normal-war roster');
await page.setViewportSize({ width: 390, height: 900 });
const overlappingValues = await page.locator('.cwl-rank-row[open] .cwl-breakdown > div').evaluateAll(rows => rows.filter(row => {
  const value = row.querySelector('b').getBoundingClientRect(), label = row.querySelector('span').getBoundingClientRect();
  return value.right > label.left;
}).length);
assert.equal(overlappingValues, 0); record('expanded calculation values do not overlap their labels on mobile');
await page.locator('#mobile-copy').click(); assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('Mérito'));
await page.getByRole('tab', { name: 'Plano do dia' }).click();
await page.locator('#mobile-copy').click(); assert.ok((await page.evaluate(() => navigator.clipboard.readText())).startsWith('Atacante\tTag\tCV'));
record('mobile copy follows the selected CWL tab');
const escaped = await page.evaluate(() => {
  const state = structuredClone(window.CwlApp.state); state.activeTab = 'ranking';
  state.ranking.entries[0].name = '<img src=x onerror=alert(1)>';
  return window.CwlUI.render(state);
});
assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;')); record('player text is escaped');
const applied = await page.evaluate(() => {
  const state = structuredClone(window.CwlApp.state); state.activeTab = 'plan';
  const hit = state.plan.outcomes[0], original = structuredClone(hit.mission);
  const latest = state.plan.effective.assignments.find(m => m.attackerTag === hit.attackerTag);
  latest.defenderName = 'Alvo de uma aprovação posterior'; latest.goalStars = 1;
  const root = document.createElement('div'); root.innerHTML = window.CwlUI.render(state);
  const index = state.plan.initial.participants.findIndex(p => p.tag === hit.attackerTag);
  const row = root.querySelectorAll('.cwl-mission-item')[index];
  return { expected: original.defenderName, target: row.querySelector('.cwl-defender > strong').textContent,
    goal: row.querySelector('.cwl-goal').textContent, expectedGoal: original.goalStars };
});
assert.equal(applied.target, applied.expected); assert.ok(applied.goal.includes(String(applied.expectedGoal)));
record('completed attack displays the recorded mission, not a later approval');

for (const width of [390, 768, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.locator('.cwl-demo-dock').evaluate(e => getComputedStyle(e).position), width <= 700 ? 'fixed' : 'static');
}
await page.setViewportSize({ width: 390, height: 900 });
const originalDraft = await page.evaluate(() => structuredClone(window.CwlApp.state.plan.current.assignments));
await page.getByRole('button', { name: 'Editar alvos e metas' }).click();
assert.deepEqual(await page.locator('.cwl-demo-dock button').allTextContents(), ['Cancelar', 'Salvar']);
const pending = await page.evaluate(() => window.CwlApp.state.plan.current.assignments.filter(m => !window.CwlApp.state.plan.outcomes.some(h => h.attackerTag === m.attackerTag)));
assert.ok(pending.length >= 2);
const goal = page.locator(`[data-cwl-demo-field="goal"][data-attacker-tag="${pending[0].attackerTag}"]`);
await goal.selectOption(String(pending[0].goalStars === 1 ? 2 : 1));
await page.locator(`[data-cwl-action="demo-target-toggle"][data-attacker-tag="${pending[1].attackerTag}"]`).click();
await page.locator(`[data-cwl-demo-field="target"][data-attacker-tag="${pending[1].attackerTag}"]`).selectOption(pending[0].defenderTag);
assert.ok(await page.locator('.cwl-duplicate-warning').count() >= 2);
assert.equal(await page.evaluate(tag => window.CwlApp.state.plan.current.assignments.find(m => m.attackerTag === tag).defenderTag, pending[0].attackerTag), pending[0].defenderTag);
for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
}
await page.getByRole('button', { name: 'Cancelar edição' }).click();
assert.equal(await page.getByRole('dialog', { name: 'Cancelar edição?' }).isVisible(), true);
await page.getByRole('button', { name: 'Continuar editando' }).click();
assert.equal(await page.getByRole('dialog').count(), 0);
assert.notDeepEqual(await page.evaluate(() => window.CwlApp.state.plan.current.assignments), originalDraft);
await page.getByRole('button', { name: 'Cancelar edição' }).click();
await page.getByRole('button', { name: 'Descartar alterações' }).click();
assert.deepEqual(await page.evaluate(() => window.CwlApp.state.plan.current.assignments), originalDraft);
assert.equal(await page.evaluate(() => window.CwlApp.state.demoEditMode), false);
await page.getByRole('button', { name: 'Editar alvos e metas' }).click();
await page.locator(`[data-cwl-demo-field="goal"][data-attacker-tag="${pending[0].attackerTag}"]`).selectOption(String(pending[0].goalStars === 1 ? 2 : 1));
await page.getByRole('button', { name: 'Salvar alterações no exemplo local' }).click();
assert.equal(await page.evaluate(() => window.CwlApp.state.demoEditMode), false);
assert.deepEqual(await page.evaluate(() => window.CwlApp.state.plan.effective.assignments), await page.evaluate(() => window.CwlApp.state.plan.current.assignments));
await page.locator('#cwl-demo-reset').click();
record('responsive edit/save/cancel confirms discards, restores the draft and warns duplicate targets without swapping');

let mode = 'normal', calls = [], lastPlanEnded = false, signedIn=false, liveSaved=null, liveSaves=0,initializes=0;
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = decodeURIComponent(url.pathname), atStart = mode;
  const fulfill = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  if (!path.startsWith('/api/cwl/')) {
    if (path.endsWith('/audit')) return fulfill({ ok: true });
    if (path.endsWith('/wars')) return fulfill({ items: [] });
    if (path.endsWith('/currentwar')) return fulfill({ state: 'notInWar' });
    return fulfill({ tag: '#2G8QCR92V', name: 'Clã de teste', memberList: [], members: 0 });
  }
  calls.push(path);
  if(path.endsWith('/auth/session'))return fulfill({authenticated:signedIn,...(signedIn?{editor:{id:'10000000-0000-4000-8000-000000000002',role:'coLeader',clanTag:'2G8QCR92V'}}:{})});
  if(path.endsWith('/auth/login')&&atStart==='bad-login')return fulfill({error:'Não foi possível autenticar esta sessão.',code:'auth_failed'},401);
  if(path.endsWith('/auth/login')){signedIn=true;return fulfill({authenticated:true,editor:{id:'10000000-0000-4000-8000-000000000002',role:'coLeader',clanTag:'2G8QCR92V'}});}
  if(path.endsWith('/auth/logout')){signedIn=false;return fulfill({authenticated:false});}
  if(path.endsWith('/revisions')){
    assert.equal(signedIn,true);const body=route.request().postDataJSON();liveSaves++;
    const start=path.split('/wars/')[1].split('/')[0],source=liveSaved?.warStart===start?liveSaved:data.plans.find(p=>p.warStart===start);
    assert.equal(body.expectedRevision,source.currentRevision);
    const plan=structuredClone(source);
    plan.current.assignments=plan.current.assignments.map(m=>({...m,...body.assignments.find(a=>a.attackerTag===m.attackerTag)}));
    plan.currentRevision++;plan.effective={revision:plan.currentRevision,assignments:structuredClone(plan.current.assignments)};plan.current.approved=true;liveSaved=plan;
    return fulfill(plan);
  }
  if(path.endsWith('/initialize')){assert(signedIn);assert.equal(route.request().headers()['content-type'],'application/gzip');initializes++;const start=path.split('/wars/')[1].split('/')[0];liveSaved=structuredClone(data.plans.find(p=>p.warStart===start));return fulfill(liveSaved,201);}
  if (path.endsWith('/ranking') || path.endsWith('/analytics')) {
    if (atStart === 'ranking-error') return fulfill({ error: 'Falha controlada ao consultar ranking.' }, 503);
    assert.equal(lastPlanEnded || path.includes('2026-09') || path.includes('2026-08'), true, 'ranking started before plan completed');
    const ranking = structuredClone(data.ranking);
    if (atStart === 'slow-ranking') await new Promise(resolve => setTimeout(resolve, 250));
    if (path.includes('2026-08')) ranking.entries[0].name = 'Resposta mais recente';
    const rounds = ['old-day-sync', 'old-day-error'].includes(atStart) ? [{ warStart: data.rounds[1].warStart, metrics: { missed: null } }] : [];
    return fulfill(path.endsWith('/analytics') ? { rounds, ranking } : ranking);
  }
  if (path.endsWith('/plan')) {
    if(atStart==='unprepared'&&!liveSaved)return fulfill({code:'plan_not_found',error:'Plano não encontrado.'},404);
    await new Promise(resolve => setTimeout(resolve, atStart === 'slow-plan' ? 250 : 20));
    const start = path.split('/wars/')[1].split('/')[0], plan = structuredClone(data.plans.find(p => p.warStart === start));
    if (atStart === 'old-day-error' && start === data.rounds[1].warStart) return fulfill({ error: 'Fonte temporariamente indisponível' }, 502);
    if (atStart === 'tracking-warning') plan.trackingWarning = 'Resultados não puderam ser atualizados.';
    lastPlanEnded = true; return fulfill(liveSaved?.warStart===start?liveSaved:plan);
  }
  if (path.includes('/seasons/2026-09')) {
    await new Promise(resolve => setTimeout(resolve, 150)); return fulfill({ rounds: [] });
  }
  if (path.includes('/seasons/2026-08')) return fulfill({ rounds: [] });
  return fulfill({ rounds: data.rounds });
});
await page.goto(origin + '/?view=cwl'); await done();
assert.ok(calls.find(p => p.endsWith('/plan'))); record('live-mode frontend waits for plan before reading ranking');
mode = 'tracking-warning'; await page.locator('[data-cwl-action=refresh]').click(); await done();
assert.ok((await page.locator('#cwl-panel').innerText()).includes('Atualização indisponível'));
await page.locator('[data-cwl-detail=tracking-warning] summary').click();
assert.ok((await page.locator('#cwl-panel').innerText()).includes('Resultados não puderam ser atualizados.'));
record('failed source refresh is visible while preserving saved plan');
mode = 'ranking-error'; await page.locator('[data-cwl-action=refresh]').click();
await page.waitForFunction(() => !window.CwlApp.state.loading && window.CwlApp.state.error);
assert.equal(await page.locator('.cwl-mission-item').count(), 15);
assert.ok((await page.locator('#cwl-panel').innerText()).includes('Dados anteriores preservados'));
record('ranking refresh failure preserves visible plan and explains staleness');
mode = 'slow-plan'; await page.locator('[data-cwl-action=refresh]').click();
await page.waitForFunction(() => window.CwlApp.state.loading.includes('Carregando'));
await page.locator('[data-cwl-action=round]').first().click(); await done();
assert.equal(await page.evaluate(() => window.CwlApp.state.selectedStart), data.rounds[0].warStart);
assert.equal(await page.evaluate(() => window.CwlApp.state.plan.warStart), data.rounds[0].warStart);
record('switching days discards older in-flight plan responses');
mode = 'slow-ranking'; await page.locator('[data-cwl-action=refresh]').click();
await page.waitForFunction(() => window.CwlApp.state.loading.includes('Conferindo o mérito'));
assert.equal(await page.locator('.cwl-mission-item').count(), 15); await done();
record('plan appears while ranking request is still loading');
mode = 'old-day-sync'; calls = []; await page.locator('[data-cwl-action=refresh]').click(); await done();
assert.ok(calls.some(p => p.includes(data.rounds[1].warStart)));
assert.equal(calls.some(p => p.includes(data.rounds[2].warStart)), false);
record('only previously tracked ended days are refreshed in addition to the selected day');
mode = 'old-day-error'; await page.locator('[data-cwl-action=refresh]').click(); await done();
assert.ok((await page.locator('#cwl-panel').innerText()).includes('preserva os últimos registros'));
assert.equal(await page.evaluate(() => window.CwlApp.state.ranking.entries.length), 16);
record('failure to refresh one prior day preserves the ranking and exposes the limitation');
mode = 'normal';
await page.locator('#cwl-season').fill('2026-09'); await page.locator('#cwl-season').dispatchEvent('change');
await page.locator('#cwl-season').fill('2026-08'); await page.locator('#cwl-season').dispatchEvent('change');
await done(); await page.waitForTimeout(180);
assert.equal(await page.evaluate(() => window.CwlApp.state.season), '2026-08');
assert.equal(await page.evaluate(() => window.CwlApp.state.ranking.entries[0].name), 'Resposta mais recente');
assert.equal(await page.locator('.cwl-mission-item').count(), 0); record('changing editions discards stale responses and previous plan');
mode='normal';await page.goto(origin+'/?view=cwl&clan=2G8QCR92V');await done();
assert.equal(await page.locator('#cwl-demo-edit-toggle').count(),0);
for(const width of [320,768,1440]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);}
await page.setViewportSize({width:390,height:900});
assert.equal(await page.locator('#leader-access').isVisible(),true);assert.equal(await page.locator('[data-cwl-action=login]').count(),0);
await page.locator('#leader-access').click();
mode='bad-login';await page.locator('#leader-email').fill('co@test.invalid');await page.locator('#leader-password').fill('wrong-password');
await page.locator('#leader-form button[type=submit]').click();await page.locator('.leader-error').waitFor();
assert.ok((await page.locator('.leader-error').innerText()).includes('Email ou senha incorretos'));
assert.equal(await page.locator('#leader-email').inputValue(),'co@test.invalid');assert.equal(await page.locator('#leader-password').inputValue(),'');
assert.equal(await page.evaluate(()=>document.activeElement.id),'leader-password');mode='normal';
await page.locator('#leader-password').fill('test-only-password');
await page.screenshot({path:`${dir}/390-login.png`});
await page.locator('#leader-form button[type=submit]').click();await page.waitForFunction(()=>window.CwlApp.state.editor&&!window.CwlApp.state.loading);await done();
assert.equal(await page.locator('#leader-dialog').evaluate(d=>d.open),false);assert.equal(await page.locator('#leader-access').innerText(),'Colíder');
assert.equal(await page.evaluate(()=>window.CwlApp.state.editor.role),'coLeader');
await page.locator('#cwl-demo-edit-toggle').click();
const liveGoal=page.locator('[data-cwl-demo-field=goal]').first();const wanted=(await liveGoal.inputValue())==='3'?'2':'3';
await liveGoal.selectOption(wanted);await page.locator('#cwl-demo-activate').click();
await page.waitForFunction(()=>!window.CwlApp.state.saveBusy&&!window.CwlApp.state.demoEditMode);
assert.equal(liveSaves,1);assert.equal(await page.evaluate(()=>window.CwlApp.state.demo),false);
await page.locator('#leader-access').click();await page.locator('[data-command=leader-sign-out]').click();await page.waitForFunction(()=>!window.CwlApp.state.editor);
assert.equal(await page.locator('#leader-access').innerText(),'Liderança');
assert.equal(await page.locator('#cwl-demo-edit-toggle').count(),0);
record('authenticated co-leader edits and saves a real revision; logout restores read-only access on mobile');
await page.goto(origin+'/?clan=2G8QCR92V&login=1');await page.waitForFunction(()=>document.querySelector('#leader-dialog').open);
assert.equal(new URL(page.url()).searchParams.has('login'),false);assert.equal(await page.evaluate(()=>window.ClanManager.state.view),'cwl');
assert.equal(await page.evaluate(()=>document.activeElement.id),'leader-email');await page.keyboard.press('Escape');
record('leadership access is in the header on every view, explains wrong passwords and opens directly from the Pages link');
mode='unprepared';liveSaved=null;await page.goto(origin+'/?view=cwl&clan=2G8QCR92V');await done();
assert.equal(await page.locator('[data-cwl-action=prepare]').count(),0);assert.equal(initializes,0);
await page.locator('[data-cwl-action=login]').first().click();await page.locator('#leader-email').fill('co@test.invalid');await page.locator('#leader-password').fill('test-only-password');
await page.locator('#leader-form button[type=submit]').click();await page.waitForFunction(()=>window.CwlApp.state.editor&&!window.CwlApp.state.loading);await done();
await page.evaluate(()=>{window.CwlCompute.calculate=async(_,progress)=>{progress({stage:'compute'});return {archive:new Uint8Array([31,139,8]).buffer};};});
await page.locator('[data-cwl-action=prepare]').click();await done();
assert.equal(initializes,1);assert.equal(await page.locator('.cwl-mission-item').count(),15);
record('unprepared day stays read-only for visitors and only an authenticated editor can calculate and initialize it');
const partial=await page.evaluate(()=>{
  const state=structuredClone(window.CwlApp.state);state.plan.initial.warnings=['player_history_war_limit'];return window.CwlUI.render(state);
});
assert(partial.includes('Histórico parcial.'));assert(!partial.includes('player_history_war_limit'));
record('source truncation is visible in plain language without exposing implementation codes');
await page.unroute('**/api/**');
assert.deepEqual(errors, []);
fs.writeFileSync(`${dir}/verification.json`, JSON.stringify({ checks, errors }, null, 2));
await context.close(); await browser.close();
console.log(`${checks.length} browser checks passed.`);
