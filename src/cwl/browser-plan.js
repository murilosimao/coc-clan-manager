import { WarScores as S } from './scoring.js';
import { RankedScores as R } from '../../public/portal/cwl-scoring.js';
import { validateWar,planFromModel,PLANNER_VERSION,DEFAULT_CONFIG } from './planner.js';
import { requireCondition,timestamp } from './errors.js';
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8;
const sameData=(a,b)=>typeof a==='number'?close(a,b):a&&typeof a==='object'?b&&Object.keys(a).every(k=>sameData(a[k],b[k])):a===b;

export function validateBrowserPlan(payload,tag,start,now){
  const {raw,training,model,config}=payload||{},war=validateWar(raw,tag);
  const ranked=model?.version===R.VERSION;
  requireCondition(raw.startTime===start&&payload.plannerVersion===PLANNER_VERSION&&(ranked||model?.version===S.VERSION),409,'A versão do cálculo mudou. Prepare o plano novamente.','compute_version_changed');
  if(ranked){
    requireCondition(training?.ranked&&model.baselineVersion===S.VERSION&&sameData(R.CONFIG,model.rankedConfig),422,'Evidência de ranqueada ausente ou parâmetros inválidos.');
    const tags=new Set(training.ranked.packets?.filter(p=>p.kind==='players').flatMap(p=>p.items).map(p=>p.tag));
    requireCondition([...war.roster,...war.opponentRoster].every(p=>tags.has(p.tag.replace(/^#/,''))),422,'Perfis ranqueados incompletos para os participantes.');
  }
  const base=ranked?R.baseline(model):model;
  requireCondition(config?.goalSupport===DEFAULT_CONFIG.goalSupport&&Object.entries(S.CONFIG).every(([key,value])=>model.config?.[key]===value),422,'Parâmetros de cálculo não suportados.');
  const created=Date.parse(payload.computedAt),cutoff=model.context?.cutoff;
  requireCondition(Number.isFinite(payload.computeMs)&&payload.computeMs>=0&&payload.computeMs<=300000,422,'Tempo de cálculo inválido.');
  requireCondition(Number.isFinite(created)&&created<=now+30000&&now-created<=15*60000&&Number.isFinite(cutoff)
    &&cutoff<=Math.min(timestamp(raw.startTime),now+30000)&&model.context.modifier===war.battleModifier.trim().toLowerCase(),422,'Data ou modificador do cálculo inválido.');
  requireCondition(Array.isArray(training?.history)&&training.history.length<=350&&Array.isArray(training.warnings)&&training.warnings.every(w=>typeof w==='string'&&w.length<=200),422,'Fontes do cálculo inválidas.');
  requireCondition(model.context.type==='cwl'&&Array.isArray(model.players)&&model.players.length<=35000&&Array.isArray(model.events)&&model.events.length<=70000,422,'Modelo incompleto.');
  const collected=S.collect({...war,startTime:cutoff},training.history);
  requireCondition(model.events.length===collected.events.length&&model.events.every((e,i)=>sameData(collected.events[i],e)),422,'Os registros do modelo não correspondem ao histórico.');
  const levels=[...new Set(collected.events.map(e=>e.defender.th))].sort((a,b)=>a-b);
  const reference=levels.at(-1)||Math.max(1,...[...war.roster,...war.opponentRoster].map(p=>p.th));
  const features=['deltaCV','posicaoDefesa','limpeza','cwl',...levels.filter(th=>th!==reference).map(th=>'cv_'+th)];
  requireCondition(JSON.stringify(features)===JSON.stringify(model.featureNames)&&Array.isArray(model.coefficients)&&model.coefficients.length===features.length
    &&model.coefficients.every(v=>Number.isFinite(v)&&Math.abs(v)<100)&&model.thresholds?.length===3&&model.thresholds.every(Number.isFinite)
    &&model.thresholds.every((v,i)=>!i||v>model.thresholds[i-1]),422,'Coeficientes inválidos.');
  const counts=new Map();
  const entry=p=>{const key=S.playerKey(p);if(!counts.has(key))counts.set(key,{attackCount:0,defenseCount:0,attackWeight:0,defenseWeight:0,attackWeight2:0,defenseWeight2:0});return counts.get(key);};
  [...war.roster,...war.opponentRoster].forEach(entry);
  for(const e of collected.events)for(const [p,role]of [[e.attacker,'attack'],[e.defender,'defense']]){const c=entry(p);c[role+'Count']++;c[role+'Weight']+=e.weight;c[role+'Weight2']+=e.weight**2;}
  requireCondition(new Set(model.players.map(p=>p.key)).size===counts.size&&model.players.length===counts.size,422,'Identidades do modelo inválidas.');
  for(const role of ['attack','defense']){
    const eligible=base.players.filter(p=>counts.get(p.key)?.[role+'Count']>=5);
    const scale=Math.max(S.CONFIG.minimumScale,Math.sqrt(eligible.reduce((s,p)=>s+p[role+'Effect']**2,0)/Math.max(1,eligible.length)));
    requireCondition(close(scale,model.scales?.[role]),422,'Escala do score inválida.');
  }
  if(ranked){
    const expected=R.apply(base,training.ranked,training.history);
    requireCondition(expected.version===R.VERSION&&sameData(expected.rankedContext,model.rankedContext)
      &&expected.players.every((p,i)=>close(p.attackEffect,model.players[i].attackEffect)&&close(p.attackScore,model.players[i].attackScore)
        &&sameData(p.rankedEvidence,model.players[i].rankedEvidence)),422,'O bônus de ranqueada não corresponde aos dados oficiais e à fórmula.');
  }
  for(const p of model.players){
    const c=counts.get(p.key);requireCondition(c&&p.key===S.playerKey(p)&&Object.entries(c).every(([k,v])=>close(p[k],v)),422,'Evidência individual inconsistente.');
    for(const role of ['attack','defense']){
      const effect=p[role+'Effect'],score=Math.max(0,Math.min(100,50+S.CONFIG.scoreScale*effect/model.scales[role]));
      const effective=c[role+'Weight2']?c[role+'Weight']**2/c[role+'Weight2']:0;
      requireCondition(Number.isFinite(effect)&&Math.abs(effect)<100&&close(score,p[role+'Score'])&&close(effective,p[role+'EffectiveN']),422,'Score inconsistente com a fórmula.');
    }
  }
  // Reconstruct the matrix and optimizer, without repeating the expensive ordinal fit.
  return planFromModel({raw,clanTag:tag,model,config});
}

export function warFingerprint(war){
  return JSON.stringify({start:war.startTime,modifier:war.battleModifier,size:war.header.sizeHome,
    players:[...war.roster,...war.opponentRoster].map(p=>[p.tag,p.th,p.position]),
    hits:war.attacks.map(a=>[a.order,a.attacker.tag,a.defender.tag,a.stars,a.destruction])});
}
