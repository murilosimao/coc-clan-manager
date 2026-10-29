import { withDatabase } from './database.js';
import { CwlService } from './service.js';
import { ClashCwlProvider } from './provider.js';
import { CwlError, clanTag, warTime, requireCondition } from './errors.js';
import { readArchive } from './archive.js';
import { verifyRanked } from '../ranked-proof.js';

const response = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function readBody(request) {
  requireCondition(request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'), 415, 'Envie application/json.');
  const reader = request.body?.getReader();
  requireCondition(reader, 400, 'Corpo JSON obrigatório.');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > 65536) { await reader.cancel(); throw new CwlError(413, 'Requisição muito grande.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new CwlError(400, 'JSON inválido.'); }
  requireCondition(data && typeof data === 'object' && !Array.isArray(data), 400, 'Objeto JSON obrigatório.');
  return data;
}
async function authorize(request, env, tag) {
  requireCondition(typeof env.LEADER_API_KEY === 'string' && env.LEADER_API_KEY.length >= 32 && env.LEADER_CLAN_TAG, 503, 'Acesso da líder não configurado.', 'leader_auth_not_configured');
  const provided = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1] || '';
  const digest = async v => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(provided), digest(env.LEADER_API_KEY)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  requireCondition(diff === 0, 401, 'Autenticação da líder necessária.', 'unauthorized');
  requireCondition(clanTag(env.LEADER_CLAN_TAG) === tag, 403, 'Credencial não autorizada para este clã.', 'clan_forbidden');
}

// Public readers get the latest approved orders, not the leadership's draft or
// revision history. Keep the roster and actual attack results for the UI.
export function publicPlan(plan) {
  const { revisions, adoption, currentRevision, ...result } = plan;
  const { assignments, expectedStars, expectedGain, mirrorExpectedStars, computeMs, warnings, ...roster } = plan.initial || {};
  result.initial = roster;
  result.current = plan.effective
    ? { assignments: plan.effective.assignments, approved: true }
    : { assignments: [], approved: false };
  result.effective = plan.effective ? { assignments: plan.effective.assignments } : null;
  const targets = result.current.assignments.map(m => m.defenderTag);
  result.duplicateTargets = [...new Set(targets)].filter(tag => targets.filter(t => t === tag).length > 1);
  result.state = plan.effective ? 'approved' : 'draft';
  result.outcomes = (plan.outcomes || []).map(({ missionRevision, initialTargetFollowed, initialGoalReached, initialMissionFulfilled, ...hit }) => hit);
  if (result.metrics) {
    const { initialTargetsFollowed, initialMissionsFulfilled, ...metrics } = result.metrics;
    result.metrics = metrics;
  }
  return result;
}

function publicRanking(ranking) {
  return { ...ranking, entries: (ranking.entries || []).map(entry => ({ ...entry,
    opportunities: (entry.opportunities || []).map(({ missionRevision, ...opportunity }) => opportunity) })) };
}

async function optionalEditor(request, env, tag, authorizeRequest) {
  try { return await authorizeRequest(request, env, tag); }
  catch (error) {
    // A missing or rejected session only receives the public view. Surface
    // authentication outages instead of pretending a signed-in editor is public.
    if (error instanceof CwlError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export function createCwlHandler({ provider = new ClashCwlProvider(), database = withDatabase, clock = Date.now, authorize:authorizeRequest=authorize, browserPlans=false } = {}) {
  let archiveInFlight=false;
  return async function handleCwl(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/cwl/')) return null;
    const seasonMatch = path.match(/^\/api\/cwl\/clans\/([^/]+)\/seasons\/(\d{4}-(?:0[1-9]|1[0-2]))(?:\/(analytics|dataset|ranking))?$/);
    const planMatch = path.match(/^\/api\/cwl\/clans\/([^/]+)\/wars\/([^/]+)\/plan(?:\/(revisions|sync|reviews|audit|metrics|initialize))?$/);
    let tag, start;
    try { if (seasonMatch || planMatch) tag = clanTag(decodeURIComponent((seasonMatch || planMatch)[1]));
      if (planMatch) start = warTime(decodeURIComponent(planMatch[2])); }
    catch (error) { if (error instanceof CwlError) throw error; throw new CwlError(400, 'Caminho inválido.'); }
    requireCondition(path === '/api/cwl/health' || seasonMatch || planMatch, 404, 'Rota CWL não encontrada.');
    const action = planMatch?.[3] || seasonMatch?.[3];
    const write = ['revisions', 'sync', 'reviews','initialize'].includes(action);
    requireCondition(request.method === (write ? 'POST' : 'GET'), 405, 'Método não permitido.');
    const identity=write||action==='audit'||action==='dataset'?await authorizeRequest(request,env,tag):null;
    const editor = browserPlans && tag && ((!action && planMatch) || action === 'metrics' || action === 'analytics' || action === 'ranking')
      ? await optionalEditor(request,env,tag,authorizeRequest) : null;
    const actor=identity?.id?identity.role+':'+identity.id:'leader';
    const body = write && !['sync','initialize'].includes(action) ? await readBody(request) : null;
    const archiveOperation=browserPlans&&['initialize','audit'].includes(action);
    requireCondition(!archiveOperation||!archiveInFlight,429,'Outro snapshot está sendo processado. Aguarde e atualize a página.','cwl_busy');
    if(archiveOperation)archiveInFlight=true;
    try {
      if (seasonMatch && !action) {
        const wars = await provider.season(tag, seasonMatch[2]);
        return response({ clanTag: tag, season: seasonMatch[2], coverage: 'recorded_rounds_only',
          rounds: wars.map(w => ({ warStart: w.startTime, endTime: w.endTime, state: w.state, roundIndex: null,
            clan: { tag: w.clan.tag, name: w.clan.name }, opponent: { tag: w.opponent.tag, name: w.opponent.name }, teamSize: w.teamSize })) });
      }
      return await database(env, async sql => {
        if (path === '/api/cwl/health') {
          const [r] = await sql`select to_regclass('cwl.plans') is not null and to_regclass('cwl.ranking_policies') is not null as migrated`;
          requireCondition(r.migrated, 503, 'Migrations da CWL não aplicadas.', 'database_not_migrated');
          if(browserPlans){const [archive]=await sql`select to_regclass('cwl.plan_archives') is not null as ready`;requireCondition(archive.ready,503,'Migration do cálculo no navegador não aplicada.','database_not_migrated');}
          return response({ ok: true, database: 'postgresql', schema: 'cwl' });
        }
        const service = new CwlService(sql, provider, clock);
        if (seasonMatch) {
          if (action === 'dataset') return response(await service.dataset(tag, seasonMatch[2]));
          const analytics = await service.seasonAnalytics(tag, seasonMatch[2]);
          if (browserPlans && !editor && (action === 'analytics' || action === 'ranking')) {
            analytics.ranking = publicRanking(analytics.ranking);
          }
          if (browserPlans && action === 'analytics' && !editor) {
            analytics.rounds = analytics.rounds.map(({ adoption, metrics, ...round }) => {
              const { initialTargetsFollowed, initialMissionsFulfilled, ...visibleMetrics } = metrics || {};
              return { ...round, metrics: visibleMetrics };
            });
            delete analytics.calibration;
          }
          return response(action === 'ranking' ? { clanTag: tag, season: seasonMatch[2], ...analytics.ranking } : analytics);
        }
        if(action==='initialize'){
          // The DB lock is acquired before decompressing. A competing visitor
          // reuses the first committed plan without duplicating the large model.
          const plan=await service.initializeComputed(tag,start,async()=>{
            const input=await readArchive(request);
            requireCondition(await verifyRanked(input.payload?.training?.ranked,env.CWL_BACKEND_KEY,clock()),422,'Os dados da ranqueada expiraram ou não foram confirmados. Prepare o plano novamente.','ranked_source_invalid');
            return input;
          },null,actor);
          if(!plan.created)await request.body?.cancel();
          return response(plan,plan.created?201:200);
        }
        if (action === 'revisions') return response(await service.revise(tag, start, body,actor));
        if (action === 'reviews') return response(await service.review(tag, start, body,actor));
        if (action === 'sync') return response(await service.sync(tag, start));
        if (action === 'audit') return response(await service.read(tag, start, true));
        if (action === 'metrics') { const raw = await service.read(tag, start), p = browserPlans && !editor ? publicPlan(raw) : raw; return response({ ...(p.adoption ? { adoption: p.adoption } : {}), metrics: p.metrics, outcomes: p.outcomes }); }
        let plan = browserPlans?{...await service.read(tag,start),created:false}:await service.ensure(tag,start);
        if (!plan.created && (!plan.observedAt || clock() - new Date(plan.observedAt).getTime() >= 60000)) {
          try { plan = { ...(await service.sync(tag, start)), created: false }; }
          catch (error) {
            if (!(error instanceof CwlError)) throw error;
            plan.trackingWarning = { code: error.code, message: error.message };
          }
        }
        return response(browserPlans && !editor ? publicPlan(plan) : plan, plan.created ? 201 : 200);
      });
    } catch (error) {
      if (error instanceof CwlError) throw error;
      // Never expose PostgreSQL errors, SQL text, connection strings or credentials.
      throw new CwlError(503, 'Não foi possível acessar os dados da CWL. Tente novamente.', 'database_unavailable');
    } finally {if(archiveOperation)archiveInFlight=false;}
  };
}
export const handleCwl = createCwlHandler();
