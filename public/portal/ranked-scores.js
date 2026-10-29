/* Ranked evidence augments ATQ only. The v2 DEF fit and scales stay frozen. */
(function(root){
'use strict';
const S=root.WarScores;
const VERSION='war-atq-ranked-v1';
const CONFIG=Object.freeze({bS:.6,bQ:1,kS:3,kQ:3,promotion:.5,gate:5,integration:'paired',minCohort:5,minReferenceAttacks:20,minReferencePlayers:2,strictTH:false});
const WEEK=7*86400000, EPOCH=Date.UTC(2026,0,5,5);
const weekOf=t=>EPOCH+Math.floor((t-EPOCH)/WEEK)*WEEK;
const tier=id=>Number.isInteger(id)&&id>105000000&&id<=105000036?id-105000000:null;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const tag = x => String(x || '').replace(/^#/, '').toUpperCase();
const sum = xs => xs.reduce((a, b) => a + b, 0);

// Acklam inverse normal approximation; midranks are clipped before inversion.
function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('normal_quantile_probability');
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-.00778489400243029, -.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [.00778469570904146, .32246712907004, 2.445134137143, 3.75440866190742];
  const tail = q => (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  if (p < .02425) return tail(Math.sqrt(-2*Math.log(p)));
  if (p > .97575) return -tail(Math.sqrt(-2*Math.log(1-p)));
  const q = p-.5, r = q*q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

function sustained(previous, current, promotion = .5) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return current > previous ? previous + promotion : Math.min(previous, current);
}

function signals(row, cohort, attacks, config = {}) {
  const cfg = { kS: 6, kQ: 6, promotion: .5, minCohort: 5, minReferenceAttacks: 20, minReferencePlayers: 2, strictTH: false, ...config };
  const peers = cohort.filter(p => p.th === row.th && Number.isFinite(p.position));
  const position = sustained(row.previousLeague, row.currentLeague, cfg.promotion);
  const below = peers.filter(p => p.position < position).length, tied = peers.filter(p => p.position === position).length;
  const percentile = position != null && peers.length >= cfg.minCohort ? (below+tied/2)/peers.length : .5;
  const eligible = row.n > 0 && Number.isFinite(row.previousLeague) && row.weekEnd <= row.cutoff && row.thStatus !== 'changed' && (!cfg.strictTH || row.thStatus === 'bounded');
  const leagueZ = eligible && position != null ? normalQuantile(clamp(percentile,.01,.99)) : 0;
  const league = eligible ? row.n/(row.n+cfg.kS)*leagueZ : 0;
  const own = attacks.filter(a => tag(a.playerTag) === tag(row.tag) && a.weekStart === row.weekStart);
  let residual = 0, nQ = 0; const references = [];
  // Missing or mixed-context baselines remain missing. No family-of-leagues fallback.
  for (const attack of eligible ? own : []) {
    if (attack.attackerChanged || attack.defenderChanged) continue;
    if (cfg.strictTH && attack.thStatus !== 'bounded') continue;
    if (!Number.isFinite(attack.league) || !Number.isInteger(attack.attackerTH) || !Number.isInteger(attack.defenderTH)) continue;
    const others = attacks.filter(a => !a.attackerChanged && !a.defenderChanged && a.referenceEligible !== false && tag(a.playerTag) !== tag(row.tag) && a.weekStart === attack.weekStart
      && a.league === attack.league && a.context === attack.context && a.context != null
      && a.attackerTH === attack.attackerTH && a.defenderTH === attack.defenderTH
      && (!cfg.strictTH || a.thStatus === 'bounded'));
    const players = new Set(others.map(a => tag(a.playerTag))).size;
    if (others.length < cfg.minReferenceAttacks || players < cfg.minReferencePlayers) continue;
    const expected = sum(others.map(a => a.stars))/others.length;
    residual += attack.stars-expected; nQ++;
    references.push({ expected, attacks: others.length, players, attackerTH: attack.attackerTH, defenderTH: attack.defenderTH });
  }
  return { league, quality: nQ ? residual/(nQ+cfg.kQ) : 0, leagueZ, position, percentile, cohort: peers.length,
    n: row.n, nQ, eligible, constancy: row.maxBattles > 0 ? row.n/row.maxBattles : null, references };
}

function prior(signal, config) {
  return Math.max(0, (config.bS || 0)*signal.league + (config.bQ || 0)*signal.quality);
}

// Negative log-likelihood derivative, stable even when sigmoid differences underflow.
function negativeGradient(a, rows, thresholds, lambda, mu) {
  let g = lambda*(a-mu);
  for (const r of rows) {
    const eta = a+r.offset;
    const logDerivative = r.stars === 0 ? sigmoid(thresholds[0]-eta)-1
      : r.stars === 3 ? sigmoid(thresholds[2]-eta)
        : sigmoid(thresholds[r.stars]-eta)+sigmoid(thresholds[r.stars-1]-eta)-1;
    g -= r.weight*logDerivative;
  }
  return g;
}

function optimum(mu, rows, thresholds, lambda) {
  let lo=mu-1, hi=mu+1;
  while(negativeGradient(lo,rows,thresholds,lambda,mu)>0)lo=mu-2*(mu-lo);
  while(negativeGradient(hi,rows,thresholds,lambda,mu)<0)hi=mu+2*(hi-mu);
  for(let n=0;n<48;n++){const mid=(lo+hi)/2;if(negativeGradient(mid,rows,thresholds,lambda,mu)<0)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function attackUpdate(base, mu, rows, thresholds, lambda = 1, method='paired') {
  if (!(mu > 0)) return base; // Exactly preserve every zero-signal player.
  const shifted=optimum(mu,rows,thresholds,lambda);
  if(method==='literal')return Math.max(base,shifted);
  // v2 uses a finite optimizer. Subtract a matched zero-prior fit so that a
  // second optimizer run cannot masquerade as evidence from ranked battles.
  return base+Math.max(0,shifted-optimum(0,rows,thresholds,lambda));
}

function applyRanked(base, byPlayer, config) {
  const model = structuredClone(base), rows = new Map(), ratings=new Map(base.players.map(p=>[p.key,p]));
  for (const e of base.events) {
    const key = S.playerKey(e.attacker);
    if (!rows.has(key)) rows.set(key,[]);
    rows.get(key).push({ stars:e.stars, weight:e.weight,
      offset: -(ratings.get(S.playerKey(e.defender))?.defenseEffect || 0)
        + S.features(e,base.featureNames).reduce((n,x,i)=>n+x*base.coefficients[i],0) });
  }
  for (const p of model.players) {
    const signal = byPlayer.get(p.key), mu = signal ? prior(signal,config) : 0;
    const old=p.attackEffect, fitted=attackUpdate(old,mu,rows.get(p.key)||[],base.thresholds,base.config.playerPenalty,config.integration);
    const gate=config.gate>0?config.gate/(config.gate+(p.attackEffectiveN||0)):1;
    p.attackEffect = old+gate*(fitted-old);
    p.attackScore = clamp(50+base.config.scoreScale*p.attackEffect/base.scales.attack,0,100);
    p.baseAttackEffect = old; p.baseAttackScore = ratings.get(p.key)?.attackScore;
    p.rankedEvidence = { ...signal, mu, gate, contribution: p.attackScore-p.baseAttackScore };
  }
  model.version=VERSION; model.baselineVersion=base.version;
  model.rankedConfig={...config}; model.baselineFitLoss=base.loss; delete model.loss;
  const updated=new Map(model.players.map(p=>[p.key,p]));
  for(const e of model.events){
    e.eta=(updated.get(S.playerKey(e.attacker))?.attackEffect||0)-(updated.get(S.playerKey(e.defender))?.defenseEffect||0)
      +S.features(e,model.featureNames).reduce((n,x,i)=>n+x*model.coefficients[i],0);
    e.likelihood=S.likelihood(model,e.eta,e.stars);
  }
  return model;
}

function inputs(snapshot,cutoff,history=[]){
  const packets=snapshot?.packets||[], family=packets.find(p=>p.kind==='family')?.items||[];
  const records=new Map(), levels=new Map();
  for(const packet of packets) for(const p of packet.items||[]){
    if(packet.kind==='players'&&p.tag){records.set(tag(p.tag),p);if(p.th)levels.set(tag(p.tag),p.th);}
    if(packet.kind==='levels'&&p.tag&&p.th)levels.set(tag(p.tag),p.th);
  }
  // Never manufacture a percentile by silently omitting unavailable family profiles.
  if(!family.length||family.some(p=>!records.has(tag(p.tag))))return {byPlayer:new Map(),weekStart:weekOf(cutoff)-WEEK,complete:false};
  const weekEnd=weekOf(cutoff), weekStart=weekEnd-WEEK;
  const rows=[], attacks=[];
  const qualityComplete=family.every(member=>(records.get(tag(member.tag))?.group?.attacks||[]).every(a=>a.defenderTH||levels.has(tag(a.defenderTag))));
  const historicalLevels=new Map();
  for(const w of history){
    const t=S.context({startTime:w.endTime}).cutoff;
    if(!(t>=weekStart&&t<=cutoff))continue;
    for(const p of [...(w.clan?.members||[]),...(w.opponent?.members||[])]){
      const id=tag(p.tag),th=p.townhallLevel??p.townHallLevel;
      if(Number.isInteger(th)){if(!historicalLevels.has(id))historicalLevels.set(id,new Set());historicalLevels.get(id).add(th);}
    }
  }
  const changed=(id,th)=>[...(historicalLevels.get(id)||[])].some(level=>level!==th);
  for(const [id,p] of records){
    const last=(p.history||[]).find(h=>h.weekStart===weekStart), next=(p.history||[]).find(h=>h.weekStart===weekEnd);
    // Profile tier is stable during its calendar week, even before signing up.
    const current=next?.league??(weekOf(p.observedAt)===weekEnd?p.league:null);
    const row={tag:id,th:p.th,n:last?.n||0,maxBattles:last?.maxBattles||0,previousLeague:last?.league??null,currentLeague:current,
      weekStart,weekEnd,cutoff,thStatus:changed(id,p.th)?'changed':'current_profile'};
    // Legend I uses a different competition period and is deliberately excluded.
    if(row.previousLeague===36){row.n=0;row.previousLeague=null;}
    row.position=sustained(row.previousLeague,row.currentLeague)??row.currentLeague;
    rows.push(row);
    if(!qualityComplete||p.group?.weekStart!==weekStart||row.thStatus==='changed'||!last||last.league===36
      ||p.group.attacks.some(a=>!a.defenderTH&&!levels.has(tag(a.defenderTag))))continue;
    for(const a of p.group.attacks||[]){
      const defenderTH=a.defenderTH??levels.get(tag(a.defenderTag));
      if(a.time<weekStart||a.time>=weekEnd||!Number.isInteger(defenderTH))continue;
      attacks.push({playerTag:id,weekStart,league:last.league,context:'tier:'+last.league,attackerTH:p.th,defenderTH,stars:a.stars,
        thStatus:a.defenderTH?'battlelog_defender':'current_profile',defenderChanged:changed(tag(a.defenderTag),defenderTH)});
    }
  }
  const familyTags=new Set(family.map(p=>tag(p.tag))), cohort=rows.filter(p=>familyTags.has(p.tag));
  // Only family attacks provide the shared baseline. Outsiders cannot shift it.
  const referenceAttacks=attacks.map(a=>({...a,referenceEligible:familyTags.has(a.playerTag)}));
  const byPlayer=new Map(rows.map(row=>[S.playerKey(row),{...signals(row,cohort,referenceAttacks,CONFIG),weekStart,weekEnd,
    previousLeague:row.previousLeague,currentLeague:row.currentLeague,thStatus:row.thStatus,th:row.th,qualityComplete,referenceScope:'family'}]));
  return {byPlayer,weekStart,weekEnd,complete:true};
}
function apply(base,snapshot,history=[]){
  if(!snapshot)return base;
  const data=inputs(snapshot,base.context.cutoff,history);
  if(!data.complete)return base;
  const model=applyRanked(base,data.byPlayer,CONFIG);
  model.rankedContext={weekStart:data.weekStart,weekEnd:data.weekEnd,source:'Supercell API',thPolicy:'current_profile_estimate',fetchedAt:Math.min(...snapshot.packets.map(p=>p.fetchedAt))};
  return model;
}
function baseline(model){
  const base=structuredClone(model);base.version=S.VERSION;
  for(const p of base.players){p.attackEffect=p.baseAttackEffect;p.attackScore=p.baseAttackScore;delete p.baseAttackEffect;delete p.baseAttackScore;delete p.rankedEvidence;}
  delete base.baselineVersion;delete base.rankedConfig;delete base.rankedContext;
  return base;
}
root.RankedScores={VERSION,CONFIG,WEEK,weekOf,tier,normalQuantile,sustained,signals,prior,attackUpdate,negativeGradient,applyRanked,inputs,apply,baseline};
})(typeof window!=='undefined'?window:globalThis);
