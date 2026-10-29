// Offline candidate. Nothing in public/ imports this file.
import { WarScores as S } from '../../src/cwl/scoring.js';
export const VERSION = 'atq-ranked-experiment-v1';
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const tag = x => String(x || '').replace(/^#/, '').toUpperCase();
const sum = xs => xs.reduce((a, b) => a + b, 0);

// Acklam inverse normal approximation; midranks are clipped before inversion.
export function normalQuantile(p) {
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

export function sustained(previous, current, promotion = .5) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return current > previous ? previous + promotion : Math.min(previous, current);
}

export function signals(row, cohort, attacks, config = {}) {
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

export function prior(signal, config) {
  return Math.max(0, (config.bS || 0)*signal.league + (config.bQ || 0)*signal.quality);
}

// Negative log-likelihood derivative, stable even when sigmoid differences underflow.
export function negativeGradient(a, rows, thresholds, lambda, mu) {
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
export function attackUpdate(base, mu, rows, thresholds, lambda = 1, method='paired') {
  if (!(mu > 0)) return base; // Exactly preserve every zero-signal player.
  const shifted=optimum(mu,rows,thresholds,lambda);
  if(method==='literal')return Math.max(base,shifted);
  // v2 uses a finite optimizer. Subtract a matched zero-prior fit so that a
  // second optimizer run cannot masquerade as evidence from ranked battles.
  return base+Math.max(0,shifted-optimum(0,rows,thresholds,lambda));
}

export function applyRanked(base, byPlayer, config) {
  const model = structuredClone(base), rows = new Map();
  for (const e of base.events) {
    const key = S.playerKey(e.attacker);
    if (!rows.has(key)) rows.set(key,[]);
    rows.get(key).push({ stars:e.stars, weight:e.weight,
      offset: -(S.rating(base,e.defender)?.defenseEffect || 0)
        + S.features(e,base.featureNames).reduce((n,x,i)=>n+x*base.coefficients[i],0) });
  }
  for (const p of model.players) {
    const signal = byPlayer.get(p.key), mu = signal ? prior(signal,config) : 0;
    const old=p.attackEffect, fitted=attackUpdate(old,mu,rows.get(p.key)||[],base.thresholds,base.config.playerPenalty,config.integration);
    const gate=config.gate>0?config.gate/(config.gate+(p.attackEffectiveN||0)):1;
    p.attackEffect = old+gate*(fitted-old);
    p.attackScore = clamp(50+base.config.scoreScale*p.attackEffect/base.scales.attack,0,100);
    p.rankedEvidence = { mu, league:signal?.league||0, quality:signal?.quality||0, nQ:signal?.nQ||0 };
  }
  model.version=VERSION; model.baselineVersion=base.version;
  model.rankedConfig={...config}; model.baselineFitLoss=base.loss; delete model.loss;
  model.events.forEach(e=>{e.eta=S.etaFor(model,e);e.likelihood=S.likelihood(model,e.eta,e.stars);});
  return model;
}

export function probabilities(model, eta) {
  const tails=model.thresholds.map(t=>sigmoid(eta-t));
  return [1-tails[0],tails[0]-tails[1],tails[1]-tails[2],tails[2]];
}
