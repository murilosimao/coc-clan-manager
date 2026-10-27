import { lockRound, loadPlan } from './database.js';
import { planWar, validateWar, validateAssignments } from './planner.js';
import { CwlError, requireCondition, timestamp } from './errors.js';
import { ensureRankingPolicy, readRankingPolicy, rankSeason } from './ranking.js';
import { validateBrowserPlan,warFingerprint } from './browser-plan.js';
import { decodeArchive } from './archive.js';
import { WarScores } from './scoring.js';

const cleanMission = ({ probabilities, goalSupport, eta, note, ...rest }) => rest;
const iso = value => new Date(value).toISOString();
async function contentHash(data) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))))).map(n => n.toString(16).padStart(2, '0')).join('');
}
const changed = (a, b) => a.defenderTag !== b.defenderTag || a.goalStars !== b.goalStars;

export class CwlService {
  constructor(sql, provider, clock = Date.now) { this.sql = sql; this.provider = provider; this.clock = clock; }

  async ensure(tag, start) {
    let created = false;
    const id = await this.sql.begin(async tx => {
      await lockRound(tx, tag, start);
      const existing = await loadPlan(tx, tag, start);
      if (existing) return existing.id;
      const raw = await this.provider.war(tag, start);
      requireCondition(raw.startTime === start, 502, 'A fonte retornou outra guerra.');
      const training = await this.provider.training(raw);
      const started = performance.now();
      const result = planWar({ raw, clanTag: tag, history: training.history });
      const computeMs = performance.now() - started;
      const now = iso(this.clock()), roundId = crypto.randomUUID(), planId = crypto.randomUUID();
      const preparation = timestamp(raw.preparationStartTime);
      requireCondition(Number.isFinite(preparation), 422, 'Temporada CWL não identificada.');
      const season = raw.season || iso(preparation).slice(0, 7);
      await ensureRankingPolicy(tx, tag, season, this.clock());
      const retrospective = raw.state === 'warEnded';
      await tx`insert into cwl.rounds(id,clan_tag,start_time,season,opponent_tag,war_state,end_at,created_at)
        values(${roundId},${tag},${start},${season},${result.war.result.clans[result.war.result.opponentSide].tag},${raw.state},${iso(timestamp(raw.endTime))},${now})`;
      const initial = { assignments: result.assignments, matchups: result.matchups, expectedStars: result.expectedStars,
        assignmentPrecision:result.assignmentPrecision,
        expectedGain: result.expectedGain, participants: result.participants,
        mirrorExpectedStars: result.mirrorExpectedStars, warnings: [...result.warnings, ...training.warnings], computeMs };
      await tx`insert into cwl.plans(id,round_id,current_revision,retrospective,initial_plan,score_snapshot,source_snapshot,config,planner_version,created_at)
        values(${planId},${roundId},1,${retrospective},${tx.json(initial)},${tx.json(result.model)},
        ${tx.json({ raw, ...training })},${tx.json(result.config)},${result.version},${now})`;
      await tx`insert into cwl.revisions(plan_id,revision,state,kind,assignments,actor,reason,created_at)
        values(${planId},1,'draft','initial',${tx.json(result.assignments)},'system','Initial optimized plan',${now})`;
      const row = await loadPlan(tx, tag, start);
      await this.observe(tx, row, raw, true);
      created = true;
      return planId;
    });
    return { ...(await this.read(tag, start)), created, id };
  }

  async read(tag, start, audit = false, snapshots = audit) {
    return this.sql.begin('isolation level repeatable read read only', tx => this.readSnapshot(tx, tag, start, audit, snapshots));
  }

  async initializeComputed(tag,start,payload,archive,actor) {
    let created=false;
    const id=await this.sql.begin(async tx=>{
      await lockRound(tx,tag,start);
      const existing=await loadPlan(tx,tag,start);if(existing)return existing.id;
      if(typeof payload==='function'){const input=await payload();payload=input.payload;archive=input.bytes;}
      const submitted=validateBrowserPlan(payload,tag,start,this.clock());
      const raw=await this.provider.war(tag,start),fresh=validateWar(raw,tag);
      requireCondition(warFingerprint(fresh)===warFingerprint(submitted.war),409,'A guerra mudou durante o cálculo. Prepare o plano novamente.','war_changed_recalculate');
      const result=validateBrowserPlan({...payload,raw},tag,start,this.clock());
      const now=iso(this.clock()),roundId=crypto.randomUUID(),planId=crypto.randomUUID();
      const prep=timestamp(raw.preparationStartTime);requireCondition(Number.isFinite(prep),422,'Temporada CWL não identificada.');
      const season=raw.season||iso(prep).slice(0,7);await ensureRankingPolicy(tx,tag,season,this.clock());
      await tx`insert into cwl.rounds(id,clan_tag,start_time,season,opponent_tag,war_state,end_at,created_at)
        values(${roundId},${tag},${start},${season},${fresh.result.clans[fresh.result.opponentSide].tag},${raw.state},${iso(timestamp(raw.endTime))},${now})`;
      const initial={assignments:result.assignments,matchups:result.matchups,expectedStars:result.expectedStars,expectedGain:result.expectedGain,
        assignmentPrecision:result.assignmentPrecision,
        participants:result.participants,mirrorExpectedStars:result.mirrorExpectedStars,warnings:[...result.warnings,...payload.training.warnings],
        computeMs:payload.computeMs,computedBy:'browser',validation:'editor_authenticated_sources_and_formula_checked_without_refitting'};
      const current=new Set([...fresh.roster,...fresh.opponentRoster].map(p=>WarScores.playerKey(p)));
      const compact={...result.model,events:[],rejected:[],players:result.model.players.filter(p=>current.has(p.key)),archiveId:planId};
      const source={raw,...payload.training,history:undefined,archiveId:planId,archiveFormat:'cwl-gzip-v1'};
      await tx`insert into cwl.plans(id,round_id,current_revision,retrospective,initial_plan,score_snapshot,source_snapshot,config,planner_version,created_at)
        values(${planId},${roundId},1,${raw.state==='warEnded'},${tx.json(initial)},${tx.json(compact)},${tx.json(source)},${tx.json(result.config)},${result.version},${now})`;
      const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',archive))].map(v=>v.toString(16).padStart(2,'0')).join('');
      await tx`insert into cwl.plan_archives(plan_id,format,payload,sha256,submitted_by,created_at)
        values(${planId},'cwl-gzip-v1',${archive},${sha},${actor},${now})`;
      await tx`insert into cwl.revisions(plan_id,revision,state,kind,assignments,actor,reason,created_at)
        values(${planId},1,'draft','initial',${tx.json(result.assignments)},${actor},'Browser proposal; awaiting leadership approval',${now})`;
      await this.observe(tx,await loadPlan(tx,tag,start),raw,true);created=true;return planId;
    });
    return {...await this.read(tag,start),id,created};
  }

  async readSnapshot(sql, tag, start, audit = false, snapshots = audit) {
    const row = await loadPlan(sql, tag, start, snapshots);
    if (!row) throw new CwlError(404, 'Plano não encontrado.', 'plan_not_found');
    const revisions = await sql`select * from cwl.revisions where plan_id=${row.id} order by revision`;
    const current = revisions.at(-1);
    const observations = await sql`select count(*)::int as n from cwl.observations where round_id=${row.round_id}`;
    const attacks = await sql`select * from cwl.attacks where round_id=${row.round_id} order by attack_order`;
    const reviews = await sql`select * from cwl.reviews where round_id=${row.round_id} order by created_at,id`;
    const reviewByOrder = new Map(reviews.map(r => [r.attack_order, r]));
    const latestApproved = [...revisions].reverse().find(r => r.state === 'approved');
    // Recover map positions from the original war snapshot by tag; never infer
    // a position from array order, including for previously saved plans.
    const positions = new Map([...(row.source_rosters?.clan || []), ...(row.source_rosters?.opponent || [])]
      .map(p => [String(p.tag || '').replace(/^#/, '').toUpperCase(), p.mapPosition]));
    const original = row.initial_plan.assignments;
    const adoption = latestApproved ? (() => {
      const flags = original.map(m => {
        const a = latestApproved.assignments.find(a => a.attackerTag === m.attackerTag);
        return { target: a.defenderTag === m.defenderTag, goal: a.goalStars === m.goalStars, raised: a.goalStars > m.goalStars, lowered: a.goalStars < m.goalStars };
      });
      return { missions: flags.length, targetRetained: flags.filter(f => f.target).length, goalRetained: flags.filter(f => f.goal).length,
        fullyRetained: flags.filter(f => f.target && f.goal).length, modified: flags.filter(f => !f.target || !f.goal).length,
        goalsRaised: flags.filter(f => f.raised).length, goalsLowered: flags.filter(f => f.lowered).length,
        retentionRate: flags.length ? flags.filter(f => f.target && f.goal).length / flags.length : null, approvedRevision: latestApproved.revision };
    })() : null;
    const best = new Map();
    const outcomes = attacks.map(a => {
      const review = reviewByOrder.get(a.attack_order);
      const revision = review ? revisions.find(r => r.revision === review.mission_revision) : null;
      const mission = revision ? revision.assignments.find(m => m.attackerTag === a.attacker_tag) : a.mission;
      const attributed = review ? true : a.attribution === 'known';
      const previous = best.get(a.defender_tag) || 0;
      const targetAttackedBeforeAttack = best.has(a.defender_tag);
      best.set(a.defender_tag, Math.max(previous, a.stars));
      const targetFollowed = attributed && mission ? a.defender_tag === mission.defenderTag : null;
      const goalReached = attributed && mission ? a.stars >= mission.goalStars : null;
      const initial = original.find(m => m.attackerTag === a.attacker_tag);
      return { order: a.attack_order, attackerTag: a.attacker_tag, defenderTag: a.defender_tag,
        stars: a.stars, destruction: a.destruction, durationSeconds: a.duration_seconds,
        addedStars: Math.max(0, a.stars - previous), alreadyTripled: previous === 3,
        targetStarsBeforeAttack: previous, targetAttackedBeforeAttack,
        attribution: review ? 'leader_review' : a.attribution, attributionBasis: a.occurred_at ? 'source_timestamp' : 'observation_window',
        firstSeenAt: a.first_seen_at, occurredAt: a.occurred_at, missionRevision: review?.mission_revision ?? a.mission_revision,
        mission: attributed && mission ? cleanMission(mission) : null, targetFollowed, goalReached,
        missionFulfilled: targetFollowed == null ? null : targetFollowed && goalReached,
        missionSurpassed: targetFollowed == null ? null : targetFollowed && a.stars > mission.goalStars,
        initialTargetFollowed: a.attribution === 'before_plan' || !initial ? null : initial.defenderTag === a.defender_tag,
        initialGoalReached: a.attribution === 'before_plan' || !initial ? null : a.stars >= initial.goalStars,
        initialMissionFulfilled: a.attribution === 'before_plan' || !initial ? null : initial.defenderTag === a.defender_tag && a.stars >= initial.goalStars,
        result: !attributed ? 'needs_attribution' : !targetFollowed ? 'wrong_target' : !goalReached ? 'below_goal' : a.stars > mission.goalStars ? 'surpassed' : 'fulfilled',
      };
    });
    const used = new Set(attacks.map(a => a.attacker_tag));
    const eligible = outcomes.filter(a => a.missionFulfilled != null);
    const response = { id: row.id, clanTag: tag, warStart: start, season: row.season, opponentTag: row.opponent_tag,
      state: current.state, warState: row.war_state, retrospective: row.retrospective,
      plannerVersion: row.planner_version, scoreVersion: row.score_snapshot.version, config: row.config,
      createdAt: row.created_at, observedAt: row.last_observed_at, currentRevision: current.revision,
      initial: { assignments: original.map(cleanMission), expectedStars: row.initial_plan.expectedStars,
        assignmentPrecision:row.initial_plan.assignmentPrecision??null,
        expectedGain: row.initial_plan.expectedGain, participants: row.initial_plan.participants,
        opponentParticipants: (row.initial_plan.matchups[0] || []).map(m => ({ tag: m.defenderTag, name: m.defenderName, th: m.defenderCV, position: m.defenderPosition ?? positions.get(m.defenderTag) ?? null,
          defenseScore:m.defenseScore,defenseEvidence:m.defenseEvidence,defenseCount:m.defenseCount,defenseWeight:m.defenseWeight })),
        mirrorExpectedStars: row.initial_plan.mirrorExpectedStars, computeMs: row.initial_plan.computeMs, warnings: row.initial_plan.warnings },
      current: { assignments: current.assignments.map(cleanMission), approved: current.state === 'approved' },
      duplicateTargets: [...new Set(current.assignments.map(m => m.defenderTag))].filter(t => current.assignments.filter(m => m.defenderTag === t).length > 1),
      effective: latestApproved ? { revision: latestApproved.revision, assignments: latestApproved.assignments.map(cleanMission) } : null,
      revisions: revisions.map(r => ({ revision: r.revision, state: r.state, kind: r.kind, createdAt: r.created_at,
        ...(audit ? { actor: r.actor, reason: r.reason, assignments: r.assignments } : {}) })),
      adoption, outcomes,
      metrics: { attacksUsed: attacks.length, addedStars: outcomes.reduce((s, a) => s + a.addedStars, 0),
        attributableAttacks: eligible.length, unresolvedAttacks: outcomes.filter(a => a.result === 'needs_attribution').length,
        fulfilled: eligible.filter(a => a.missionFulfilled).length, surpassed: eligible.filter(a => a.missionSurpassed).length,
        missionFulfillmentRate: eligible.length ? eligible.filter(a => a.missionFulfilled).length / eligible.length : null,
        initialTargetsFollowed: outcomes.filter(a => a.initialTargetFollowed === true).length,
        initialMissionsFulfilled: outcomes.filter(a => a.initialMissionFulfilled === true).length,
        missed: row.war_state === 'warEnded' ? row.initial_plan.participants.filter(p => !used.has(p.tag)).length : null,
        pending: row.war_state !== 'warEnded' ? row.initial_plan.participants.filter(p => !used.has(p.tag)).length : 0,
        observations: observations[0].n },
    };
    if (audit) Object.assign(response, { matchups: row.initial_plan.matchups, reviews });
    if (snapshots) {
      Object.assign(response,{scoreSnapshot:row.score_snapshot,sourceSnapshot:row.source_snapshot});
      if(row.source_snapshot.archiveId){
        const [archive]=await sql`select payload,sha256,submitted_by from cwl.plan_archives where plan_id=${row.id}`;
        requireCondition(archive,503,'Snapshot de auditoria indisponível.');
        const saved=await decodeArchive(archive.payload);
        response.scoreSnapshot=saved.model;response.sourceSnapshot={raw:saved.raw,...saved.training,archive:{sha256:archive.sha256,submittedBy:archive.submitted_by}};
      }
    }
    return response;
  }

  async revise(tag, start, { expectedRevision, assignments, approve = false, reason }, actor = 'leader') {
    requireCondition(Number.isInteger(expectedRevision) && expectedRevision >= 1 && typeof approve === 'boolean', 422, 'Versão ou aprovação inválida.');
    requireCondition(typeof reason === 'string' && reason.trim().length >= 3 && reason.length <= 500, 422, 'Informe uma justificativa de 3 a 500 caracteres.');
    await this.sql.begin(async tx => {
      await lockRound(tx, tag, start);
      const row = await loadPlan(tx, tag, start);
      requireCondition(row, 404, 'Plano não encontrado.');
      requireCondition(!row.retrospective && timestamp(row.end_at.getTime()) > this.clock(), 409, 'Guerra encerrada ou plano retrospectivo: não é possível atribuir missões retroativamente.');
      requireCondition(row.current_revision === expectedRevision, 409, 'O plano foi alterado. Recarregue antes de salvar.', 'revision_conflict');
      const [previous] = await tx`select * from cwl.revisions where plan_id=${row.id} and revision=${expectedRevision}`;
      const missions = assignments == null ? previous.assignments : validateAssignments(assignments, { assignments: row.initial_plan.assignments, matchups: row.initial_plan.matchups });
      const executed = await tx`select attacker_tag from cwl.attacks where round_id=${row.round_id}`;
      for (const a of executed) {
        const before = previous.assignments.find(m => m.attackerTag === a.attacker_tag), after = missions.find(m => m.attackerTag === a.attacker_tag);
        requireCondition(!before && !after || before && after && !changed(before, after), 409, 'A missão de um ataque já observado permanece preservada.');
      }
      const revision = expectedRevision + 1;
      await tx`insert into cwl.revisions(plan_id,revision,state,kind,assignments,actor,reason,created_at)
        values(${row.id},${revision},${approve ? 'approved' : 'draft'},${assignments == null ? 'approval' : 'leader_edit'},
        ${tx.json(missions)},${actor},${reason.trim()},${iso(this.clock())})`;
      await tx`update cwl.plans set current_revision=${revision} where id=${row.id}`;
    });
    return this.read(tag, start);
  }

  async observe(tx, row, raw, initial = false) {
    const war = validateWar(raw, row.clan_tag);
    requireCondition(raw.startTime === row.start_time, 422, 'Observação pertence a outra guerra.');
    requireCondition(war.opponentRoster.every(p => row.initial_plan.matchups[0].some(m => m.defenderTag === p.tag))
      && war.roster.every(p => row.initial_plan.participants.some(m => m.tag === p.tag)), 422, 'Elenco da guerra mudou; observação rejeitada.');
    const now = iso(this.clock());
    const hash = await contentHash(raw);
    await tx`insert into cwl.observations(id,round_id,content_hash,snapshot,observed_at)
      values(${crypto.randomUUID()},${row.round_id},${hash},${tx.json(raw)},${now}) on conflict(round_id,content_hash) do nothing`;
    const revisions = await tx`select * from cwl.revisions where plan_id=${row.id} order by revision`;
    const hits = new Map([raw.clan, raw.opponent].flatMap(side => side.members.flatMap(p => (p.attacks || []).map(a => [a.order, a]))));
    for (const hit of war.attacks.filter(a => a.side === war.result.ourSide)) {
      const source = hits.get(hit.order);
      const duration = source.duration ?? null;
      const eventTime = timestamp(source.attackTime || source.timestamp);
      const occurredAt = Number.isFinite(eventTime) && eventTime >= timestamp(raw.startTime) && eventTime <= timestamp(raw.endTime) && eventTime <= this.clock() ? iso(eventTime) : null;
      let attribution = 'unapproved', revision = null, mission = null;
      if (initial) attribution = 'before_plan';
      else {
        const upper = occurredAt || now;
        const applicable = revisions.filter(r => r.state === 'approved' && r.created_at.getTime() <= timestamp(upper)).at(-1);
        const duringGap = !occurredAt && revisions.some(r => r.state === 'approved' && r.created_at.getTime() > (row.last_observed_at?.getTime() || 0) && r.created_at.getTime() <= this.clock());
        if (duringGap) attribution = 'ambiguous';
        else if (applicable?.state === 'approved') {
          attribution = 'known'; revision = applicable.revision;
          mission = applicable.assignments.find(m => m.attackerTag === hit.attacker.tag);
        }
      }
      const [existing] = await tx`select attacker_tag,defender_tag,stars,destruction from cwl.attacks where round_id=${row.round_id} and attack_order=${hit.order}`;
      requireCondition(!existing || existing.attacker_tag === hit.attacker.tag && existing.defender_tag === hit.defender.tag, 422, 'Identidade de ataque inconsistente.');
      requireCondition(!existing || existing.stars === hit.stars && Math.abs(existing.destruction - hit.destruction) < 0.000001, 422, 'Resultado contraditório de ataque já observado: dados preservados.');
      await tx`insert into cwl.attacks(round_id,attack_order,attacker_tag,defender_tag,stars,destruction,duration_seconds,first_seen_at,occurred_at,attribution,mission_revision,mission)
        values(${row.round_id},${hit.order},${hit.attacker.tag},${hit.defender.tag},${hit.stars},${hit.destruction},${duration},${now},${occurredAt},${attribution},${revision},${mission ? tx.json(mission) : null})
        on conflict(round_id,attack_order) do update set duration_seconds=coalesce(excluded.duration_seconds,cwl.attacks.duration_seconds)`;
    }
    const count = await tx`select count(*)::int as n from cwl.attacks where round_id=${row.round_id}`;
    requireCondition(count[0].n <= war.attacks.filter(a => a.side === war.result.ourSide).length, 422, 'A fonte retornou uma observação anterior: resultados preservados.');
    const stateOrder = { preparation: 0, inWar: 1, warEnded: 2 };
    requireCondition(stateOrder[raw.state] >= stateOrder[row.war_state], 422, 'A fonte retornou um estado anterior da guerra.');
    await tx`update cwl.rounds set war_state=${raw.state},last_observed_at=${now} where id=${row.round_id}`;
  }

  async sync(tag, start) {
    // Fetch outside the transaction, then serialize with edits and other observations.
    const raw = await this.provider.war(tag, start);
    await this.sql.begin(async tx => {
      await lockRound(tx, tag, start);
      const row = await loadPlan(tx, tag, start);
      requireCondition(row, 404, 'Plano não encontrado.');
      await this.observe(tx, row, raw);
    });
    return this.read(tag, start);
  }

  async review(tag, start, { order, missionRevision, reason }, actor = 'leader') {
    requireCondition(Number.isInteger(order) && Number.isInteger(missionRevision) && typeof reason === 'string' && reason.trim().length >= 3 && reason.length <= 500, 422, 'Revisão inválida.');
    await this.sql.begin(async tx => {
      await lockRound(tx, tag, start);
      const row = await loadPlan(tx, tag, start);
      requireCondition(row, 404, 'Plano não encontrado.');
      const [hit] = await tx`select * from cwl.attacks where round_id=${row.round_id} and attack_order=${order}`;
      const [revision] = await tx`select * from cwl.revisions where plan_id=${row.id} and revision=${missionRevision}`;
      requireCondition(hit && hit.attribution !== 'before_plan' && revision?.state === 'approved'
        && revision.created_at.getTime() <= (hit.occurred_at || hit.first_seen_at).getTime(), 422, 'A revisão deve usar uma missão aprovada antes do ataque observado.');
      await tx`insert into cwl.reviews(id,round_id,attack_order,mission_revision,actor,reason,created_at)
        values(${crypto.randomUUID()},${row.round_id},${order},${missionRevision},${actor},${reason.trim()},${iso(this.clock())})`;
    });
    return this.read(tag, start);
  }

  async seasonAnalytics(tag, season) {
    const policy = await readRankingPolicy(this.sql,tag,season);
    return this.sql.begin('isolation level repeatable read read only', tx => this.seasonSnapshot(tx, tag, season, policy));
  }

  async seasonSnapshot(sql, tag, season, policy) {
    const rounds = await sql`select start_time from cwl.rounds where clan_tag=${tag} and season=${season} order by start_time`;
    const plans = [];
    for (const r of rounds) plans.push(await this.readSnapshot(sql, tag, r.start_time, true, false));
    const players = new Map();
    for (const plan of plans) for (const m of plan.initial.participants) {
      if (!players.has(m.tag)) players.set(m.tag, { tag: m.tag, name: m.name, appearances: 0, attacks: 0, stars: 0,
        assessed: 0, fulfilled: 0, unresolved: 0, missed: 0, destructionTotal: 0, durationTotal: 0, durationRecords: 0 });
      const p = players.get(m.tag); p.appearances++;
      const hit = plan.outcomes.find(a => a.attackerTag === m.tag);
      if (!hit) { if (plan.warState === 'warEnded') p.missed++; continue; }
      p.attacks++; p.stars += hit.stars; p.destructionTotal += hit.destruction;
      if (hit.durationSeconds != null) { p.durationTotal += hit.durationSeconds; p.durationRecords++; }
      if (hit.missionFulfilled == null) p.unresolved++; else { p.assessed++; p.fulfilled += Number(hit.missionFulfilled); }
    }
    return { clanTag: tag, season, rounds: plans.map(p => ({ warStart: p.warStart, retrospective: p.retrospective, adoption: p.adoption, metrics: p.metrics })),
      players: [...players.values()].map(p => ({ ...p, missionRate: p.assessed ? p.fulfilled / p.assessed : null,
        averageStars: p.attacks ? p.stars / p.attacks : null, averageDestruction: p.attacks ? p.destructionTotal / p.attacks : null,
        averageDuration: p.durationRecords === p.attacks && p.attacks ? p.durationTotal / p.attacks : null,
        durationComplete: p.attacks > 0 && p.durationRecords === p.attacks })),
      ranking: rankSeason(plans, policy),
      calibration: { initialPlanPreserved: true, unchosenMatchupsHaveNoObservedOutcome: true,
        scoreRetuning: 'explicit_versioned_configuration_only', bonusRankingPolicy: policy.version } };
  }

  async dataset(tag, season) {
    const rounds = await this.sql`select start_time from cwl.rounds where clan_tag=${tag} and season=${season} order by start_time`;
    const rows = [];
    for (const r of rounds) {
      const plan = await this.read(tag, r.start_time, true, false);
      for (const hit of plan.outcomes) {
        const initial = plan.initial.assignments.find(m => m.attackerTag === hit.attackerTag);
        const matchup = plan.matchups.flat().find(m => m.attackerTag === hit.attackerTag && m.defenderTag === hit.defenderTag);
        rows.push({ warStart: plan.warStart, planCreatedAt: plan.createdAt, retrospective: plan.retrospective,
          plannerVersion: plan.plannerVersion, scoreVersion: plan.scoreVersion, config: plan.config,
          initialMission: initial, actualMatchup: matchup, observed: hit });
      }
    }
    return { clanTag: tag, season, schemaVersion: 1, rows, unobservedMatchupsIncluded: false };
  }
}
