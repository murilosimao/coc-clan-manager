import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicPlan } from '../src/cwl/router.js';
// Local UX preview only. Public clan data comes from `wrangler dev`; the CWL backend,
// login and plan storage are simulated in memory. Nothing here reaches Supabase.
const PORT = Number(process.env.PREVIEW_PORT || 8791), WORKER_PORT = Number(process.env.PREVIEW_WORKER_PORT || 8792);
const WORKER = `http://127.0.0.1:${WORKER_PORT}`, CLAN = '2G8QCR92V';
const PUBLIC = process.env.PREVIEW_PUBLIC_DIR || fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const ACCOUNTS = { 'lider@preview.local': ['lider123', 'leader'], 'colider@preview.local': ['colider123', 'coLeader'] };
const demo = JSON.parse(fs.readFileSync(new URL('../public/portal/cwl-demo.json', import.meta.url)));
// Shift the illustrative edition so its last day is in progress today.
const day = offset => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const shift = { '06': -3, '07': -2, '08': -1, '09': 0, '10': 1 };
const live = JSON.parse(JSON.stringify(demo).replace(/2026(-?)10\1(0[6-9]|10)/g, (_, sep, dd) => day(shift[dd]).replaceAll('-', sep)));
const season = day(0).slice(0, 7), today = live.rounds.at(-1).warStart;
const clone = value => structuredClone(value);
const plans = new Map(live.plans.filter(p => p.warStart !== today).map(p => [p.warStart, clone(p)]));
const sessions = new Map();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const fail = (res, status, error, code) => send(res, status, { error, ...(code ? { code } : {}) });
const editorOf = req => sessions.get(/(?:^|;\s*)preview-session=([\w-]+)/.exec(req.headers.cookie || '')?.[1]) || null;
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); }
function freshPlan(start) {
  const plan = clone(live.plans.find(p => p.warStart === start));
  return Object.assign(plan, { state: 'draft', currentRevision: 1, effective: null, outcomes: [], adoption: null, createdAt: new Date().toISOString(),
    observedAt: new Date().toISOString(), metrics: { attacksUsed: 0, addedStars: 0, fulfilled: 0, unresolvedAttacks: 0 },
    current: { approved: false, assignments: clone(plan.initial.assignments) } });
}

async function cwl(req, res, path) {
  const editor = editorOf(req);
  if (path === '/api/cwl/auth/session') return send(res, 200, editor ? { authenticated: true, editor } : { authenticated: false });
  if (path === '/api/cwl/auth/logout') return send(res, 200, { authenticated: false }, { 'Set-Cookie': 'preview-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  if (path === '/api/cwl/auth/login') {
    let data; try { data = JSON.parse(await body(req)); } catch { return fail(res, 400, 'Dados de login inválidos.'); }
    if (typeof data.email !== 'string' || !data.email.includes('@') || !data.password) return fail(res, 400, 'Informe email e senha.');
    const account = ACCOUNTS[data.email.trim().toLowerCase()];
    if (!account || account[0] !== data.password) return fail(res, 401, 'Não foi possível autenticar esta sessão.', 'auth_failed');
    const id = crypto.randomUUID(), who = { id, role: account[1], clanTag: CLAN };
    sessions.set(id, who);
    return send(res, 200, { authenticated: true, editor: who }, { 'Set-Cookie': `preview-session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` });
  }
  const match = /^\/api\/cwl\/clans\/([^/]+)(\/.*)$/.exec(path);
  if (!match) return fail(res, 404, 'Rota não encontrada.');
  const tag = decodeURIComponent(match[1]).replace(/^#/, '').toUpperCase(), rest = match[2];
  const own = tag === CLAN, edition = /^\/seasons\/(\d{4}-\d{2})/.exec(rest)?.[1];
  if (edition) {
    if (!own || edition !== season) return send(res, 200, rest.endsWith('/ranking') ? { entries: [] } : rest.endsWith('/analytics') ? { rounds: [], ranking: { entries: [] } } : { rounds: [] });
    if (rest.endsWith('/ranking')) return send(res, 200, live.ranking);
    if (rest.endsWith('/analytics')) return send(res, 200, { rounds: [], ranking: live.ranking });
    return send(res, 200, { season, rounds: live.rounds });
  }
  const start = /^\/wars\/([^/]+)\/plan/.exec(rest)?.[1];
  if (!own || !start || !live.rounds.some(r => r.warStart === start)) return fail(res, 404, 'Plano não encontrado.', 'plan_not_found');
  if (req.method === 'GET') return plans.has(start) ? send(res, 200, editor ? plans.get(start) : publicPlan(plans.get(start))) : fail(res, 404, 'Plano não encontrado.', 'plan_not_found');
  if (!editor) return fail(res, 401, 'Entre como líder ou colíder.', 'session_required');
  if (rest.endsWith('/initialize')) {
    await body(req); await new Promise(resolve => setTimeout(resolve, 600));
    if (!plans.has(start)) plans.set(start, freshPlan(start));
    return send(res, 201, plans.get(start));
  }
  if (rest.endsWith('/revisions')) {
    const plan = plans.get(start), data = JSON.parse(await body(req));
    if (!plan) return fail(res, 404, 'Plano não encontrado.', 'plan_not_found');
    if (data.expectedRevision !== plan.currentRevision) return fail(res, 409, 'O plano foi alterado por outra pessoa. Atualize e revise novamente.', 'revision_conflict');
    const opponents = new Map(plan.initial.opponentParticipants.map(p => [p.tag, p]));
    plan.current.assignments = plan.current.assignments.map(m => {
      const next = data.assignments.find(a => a.attackerTag === m.attackerTag), target = opponents.get(next?.defenderTag);
      return next && target ? { ...m, defenderTag: target.tag, defenderName: target.name, defenderCV: target.th ?? m.defenderCV, goalStars: next.goalStars } : m;
    });
    plan.currentRevision++; plan.state = 'approved'; plan.current.approved = true;
    plan.effective = { revision: plan.currentRevision, assignments: clone(plan.current.assignments) };
    return send(res, 200, plan);
  }
  return fail(res, 404, 'Rota não encontrada.');
}

// Same progress stages as the real Web Worker, without querying sources for the illustrative war.
const computeStub = `(function(){if(!window.CwlCompute)return;let timer=null,reject=null;
window.CwlCompute.cancel=()=>{clearInterval(timer);timer=null;reject?.(new DOMException('Cálculo cancelado.','AbortError'));reject=null;};
window.CwlCompute.calculate=(input,onProgress)=>{window.CwlCompute.cancel();return new Promise((resolve,fail)=>{reject=fail;let step=0;const requests=24;
timer=setInterval(()=>{step++;if(step<=requests)onProgress?.({stage:'history',completed:step,requests});else if(step<=requests+8)onProgress?.({stage:'compute'});
else if(step<=requests+10)onProgress?.({stage:'archive'});else{clearInterval(timer);timer=null;reject=null;resolve({archive:new Uint8Array([31,139,8,0]).buffer});}},120);});};})();`;

async function proxy(req, res) {
  const upstream = await fetch(WORKER + req.url, { method: req.method, headers: { Accept: req.headers.accept || '*/*' },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req) }).catch(() => null);
  if (!upstream) return fail(res, 502, 'O Worker local ainda está iniciando. Recarregue em alguns segundos.');
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
function serve(res, path) {
  const file = normalize(join(PUBLIC, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(normalize(PUBLIC)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'Arquivo não encontrado.');
  let payload = fs.readFileSync(file);
  if (file.endsWith('index.html'))
    payload = payload.toString().replace('<script src="portal/app.js" defer></script>', '<script src="__preview/compute.js" defer></script>\n  <script src="portal/app.js" defer></script>');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  try {
    if (path === '/__preview/compute.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(computeStub); }
    if (path === '/api/audit') return send(res, 200, { ok: true });
    if (path.startsWith('/api/cwl/') && path !== '/api/cwl/source') return await cwl(req, res, path);
    if (path.startsWith('/api/')) return await proxy(req, res);
    return serve(res, path);
  } catch (error) { console.error(error); if (!res.headersSent) fail(res, 500, 'Falha na prévia local.'); }
});

const worker = process.env.PREVIEW_EXTERNAL_WORKER ? null : spawn('npx', ['wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--log-level', 'warn'], { stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => { worker?.kill('SIGTERM'); server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.listen(PORT, '127.0.0.1', () => console.log(`Prévia local: http://127.0.0.1:${PORT}/  ·  Liga: http://127.0.0.1:${PORT}/?view=cwl
Login simulado: lider@preview.local / lider123  ·  colider@preview.local / colider123
Edição ${season}: ${live.rounds.length} dias, o último (${today}) começa sem plano preparado.`));
