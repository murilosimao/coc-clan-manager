import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WarScores as S,ClashKing as C } from '../../src/cwl/scoring.js';
import { loadData,weekFeatures,hash,clean } from './data.mjs';
import { signals,prior,attackUpdate,probabilities,clamp } from './model.mjs';
const out=path.resolve(process.argv[2]||'../output/atq-ranked-2026-10-28'),data=loadData(out),manifest=JSON.parse(fs.readFileSync(out+'/models-manifest.json'));
const grid=[{id:'v2',kind:'baseline',bS:0,bQ:0,k:6,promotion:.5}];
for(const k of [3,6,12])for(const promotion of [0,.5])for(const bS of [0,.15,.3,.6])for(const bQ of [0,.5,1]){
  if(!bS&&!bQ||!bS&&promotion===0)continue;
  grid.push({id:`s${bS}-q${bQ}-k${k}-p${promotion}`,kind:bS&&bQ?'both':bS?'league':'quality',bS,bQ,k,promotion});
}
for(const bC of [.15,.3,.6])grid.push({id:'constant-'+bC,kind:'constant-control',bC,k:6,promotion:.5});
const protocol={version:1,baseline:S.VERSION,scope:'ATQ only; DEF, coefficients, thresholds and score scales frozen',
  integration:'paired conditional difference: old ATQ effect + optimum(mu) - optimum(0)',
  selection:'war start before 2026-10-12T05:00Z; select by mean per-war RPS, lower is better; ties prefer zero and smaller coefficients',
  validation:'2026-10-12T05:00Z <= war start < 2026-10-19T05:00Z; never selects parameters',
  test:'2026-10-19T05:00Z <= war start; never selects parameters',
  ranked:'latest ended week only; never current-week attacks; leave-one-player-out same tier/week/attackerCV/defenderCV; min20 other attacks from2 other players',
  cohort:'current family fixed, exploratory; historical observed clan participants and bounded TH are sensitivity analyses',
  qualityContext:'tier and week are a context proxy; numerical battle modifier is not claimed to be observed on each ranked hit',
  limitations:['Retrospective current-family reference and current/row-displayed CV can introduce bias.','Historical ClashSpot participants are not a complete historical member list.','Only observed attacks validate predictive scores, not counterfactual assignments.','Legend I is excluded pending weekly normalization.'],grid};
const protocolFile=out+'/protocol.json';if(fs.existsSync(protocolFile))assert.deepEqual(JSON.parse(fs.readFileSync(protocolFile)),protocol,'Protocol must be explicitly versioned to change.');else fs.writeFileSync(protocolFile,JSON.stringify(protocol,null,2));
const groups=new Map(grid.map(g=>[g.id,[]])), featureCache=new Map(), caseCache=[];
const split=t=>t<Date.parse('2026-10-12T05:00Z')?'selection':t<Date.parse('2026-10-19T05:00Z')?'validation':'test';
function features(cutoff,g,cohort='current',strictTH=false){
  const w=weekFeatures(data,cutoff,{promotion:g.promotion,cohort});if(!w.rows)return new Map();
  const key=[w.end,g.k,g.promotion,cohort,strictTH].join('|');if(featureCache.has(key))return featureCache.get(key);
  const map=new Map(w.rows.filter(r=>r.previousLeague!==36&&r.currentLeague!==36).map(r=>[r.tag,{...signals(r,w.cohort,w.attacks,{kS:g.k,kQ:g.k,promotion:g.promotion,strictTH}),th:r.th,thStatus:r.thStatus,weekEnd:r.weekEnd}]));featureCache.set(key,map);return map;
}
function pointMetrics(stars,p){let cdf=0,rps=0;for(let k=0;k<3;k++){cdf+=p[k];rps+=(cdf-Number(stars<=k))**2/3;}return {rps,brier:p.reduce((n,x,k)=>n+(x-Number(stars===k))**2,0),logloss:-Math.log(Math.max(1e-12,p[stars])),expected:p.reduce((n,x,k)=>n+k*x,0),p3:p[3],brier3:(p[3]-Number(stars===3))**2};}
function evaluate(cases,g,{cohort='current',strictTH=false,integration='paired',gate=null}={}){
  const bySignal=features(cases.cutoff,g,cohort,strictTH),updates=new Map();
  return cases.hits.map(h=>{
    const signal=bySignal.get(h.attacker),usable=signal?.th===h.th?signal:null;
    const mu=g.kind==='constant-control'?(usable?.eligible?g.bC*usable.n/(usable.n+g.k):0):usable?prior(usable,g):0;
    const key=h.attacker+'|'+h.th+'|'+mu+'|'+integration;
    if(!updates.has(key))updates.set(key,attackUpdate(h.baseEffect,mu,h.training,cases.thresholds,1,integration));
    const fitted=updates.get(key),effect=h.baseEffect+(gate>0?gate/(gate+h.effectiveN):1)*(fitted-h.baseEffect),eta=h.baseEta+effect-h.baseEffect,p=probabilities({thresholds:cases.thresholds},eta),score=clamp(50+15*effect/cases.scale,0,100);
    assert(score+1e-10>=h.baseScore);assert(p.every(x=>x>=0&&x<=1));
    return {id:h.id,war:cases.key,clan:cases.clan,week:usable?.weekEnd||null,split:cases.split,attacker:h.attacker,name:h.name,th:h.th,defTH:h.defTH,stars:h.stars,attackCount:h.attackCount,defenseScore:h.defenseScore,
      baseScore:h.baseScore,score,delta:score-h.baseScore,mu,signalAvailable:Boolean(usable?.eligible),qN:usable?.nQ||0,league:usable?.league||0,quality:usable?.quality||0,
      ...pointMetrics(h.stars,p)};
  });
}
let done=0;
for(const entry of manifest.targets){
  const {model,war,key,clan}=JSON.parse(fs.readFileSync(entry.file)),cutoff=C.timestamp(war.startTime),training=new Map();
  for(const e of model.events){const k=S.playerKey(e.attacker);if(!training.has(k))training.set(k,[]);training.get(k).push({stars:e.stars,weight:e.weight,offset:-(S.rating(model,e.defender)?.defenseEffect||0)+S.features(e,model.featureNames).reduce((n,x,i)=>n+x*model.coefficients[i],0)});}
  const cases={key,clan,cutoff,split:split(cutoff),thresholds:model.thresholds,scale:model.scales.attack,hits:[]};
  for(const hit of war.attacks.filter(h=>h.side===war.result.ourSide)){
    const a=S.assess(model,war,hit);if(a.alreadyTripled||Math.abs(hit.attacker.th-hit.defender.th)>3)continue;
    cases.hits.push({id:key+'|'+hit.order,attacker:clean(hit.attacker.tag),name:hit.attacker.name,th:hit.attacker.th,defTH:hit.defender.th,stars:hit.stars,baseEffect:a.attacker.attackEffect,baseScore:a.attacker.attackScore,
      baseEta:a.eta,defenseScore:a.defender.defenseScore,attackCount:a.attacker.attackCount,effectiveN:a.attacker.attackEffectiveN,training:training.get(S.playerKey(hit.attacker))||[]});
  }
  caseCache.push(cases);for(const g of grid)groups.get(g.id).push(...evaluate(cases,g));
  if(++done%10===0||done===manifest.targets.length)console.log(JSON.stringify({stage:'evaluate',done,total:manifest.targets.length,variants:grid.length}));
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function metrics(rows){return {attacks:rows.length,wars:new Set(rows.map(r=>r.war)).size,players:new Set(rows.map(r=>r.attacker)).size,
  rps:mean(rows.map(r=>r.rps)),warRps:mean([...Map.groupBy(rows,r=>r.war).values()].map(rs=>mean(rs.map(r=>r.rps)))),
  brier:mean(rows.map(r=>r.brier)),logloss:mean(rows.map(r=>r.logloss)),mae:mean(rows.map(r=>Math.abs(r.stars-r.expected))),brier3:mean(rows.map(r=>r.brier3)),observedTriple:mean(rows.map(r=>Number(r.stars===3))),estimatedTriple:mean(rows.map(r=>r.p3)),
  rankedAvailable:rows.filter(r=>r.signalAvailable).length,qualityAvailable:rows.filter(r=>r.qN>0).length,changed:rows.filter(r=>r.delta>1e-8).length,meanDelta:mean(rows.map(r=>r.delta)),maxDelta:rows.length?Math.max(...rows.map(r=>r.delta)):null};}
const results=grid.map(g=>({config:g,selectionLowHistory:metrics(groups.get(g.id).filter(r=>r.split==='selection'&&r.attackCount<5)),testLowHistory:metrics(groups.get(g.id).filter(r=>r.split==='test'&&r.attackCount<5)),...Object.fromEntries(['selection','validation','test'].map(s=>[s,metrics(groups.get(g.id).filter(r=>r.split===s))]))}));
const order=(a,b)=>(a.selection.warRps??Infinity)-(b.selection.warRps??Infinity)||(a.config.bS||0)+(a.config.bQ||0)+(a.config.bC||0)-((b.config.bS||0)+(b.config.bQ||0)+(b.config.bC||0));
// Every signal family can select zero. "Both" may select S-only or Q-only;
// an unobserved Q must not silently acquire an arbitrary nonzero coefficient.
const allowed={baseline:['baseline'],league:['baseline','league'],quality:['baseline','quality'],both:['baseline','league','quality','both'],'constant-control':['baseline','constant-control']};
const selected=Object.entries(allowed).map(([analysis,kinds])=>({analysis,...results.filter(r=>kinds.includes(r.config.kind)).sort(order)[0]}));
const best=selected.find(r=>r.analysis==='both')||selected[0];
const lowHistoryChoice=results.filter(r=>r.config.kind!=='constant-control').sort((a,b)=>(a.selectionLowHistory.warRps??Infinity)-(b.selectionLowHistory.warRps??Infinity)||order(a,b))[0];
const controls=[{id:'historical-reference',cohort:'historical'},{id:'bounded-TH-only',strictTH:true},{id:'literal-refit-diagnostic',integration:'literal'},{id:'few-history-5',gate:5},{id:'few-history-10',gate:10}].map(c=>{const rows=caseCache.flatMap(cs=>evaluate(cs,best.config,c));return {control:c,exploratory:true,coefficientsRetuned:false,...Object.fromEntries(['selection','validation','test'].map(s=>[s,metrics(rows.filter(r=>r.split===s))])),testLowHistory:metrics(rows.filter(r=>r.split==='test'&&r.attackCount<5))};});
function interval(candidate,cluster){
  const base=new Map(groups.get('v2').filter(r=>r.split==='test').map(r=>[r.id,r]));
  const diffs=candidate.filter(r=>r.split==='test').map(r=>({...r,deltaRps:r.rps-base.get(r.id).rps}));
  const blocks=[...Map.groupBy(diffs,r=>r[cluster]).values()];if(!blocks.length)return null;
  const blockMean=b=>mean(b.map(r=>r.deltaRps));let seed=0x12345678;
  const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};const samples=[];
  for(let n=0;n<2000;n++){let s=0,count=0;for(let j=0;j<blocks.length;j++){const b=blocks[Math.floor(rnd()*blocks.length)];if(cluster==='war'){s+=blockMean(b);count++;}else for(const r of b){s+=r.deltaRps;count++;}}samples.push(s/count);}
  samples.sort((a,b)=>a-b);return {cluster,estimand:cluster==='war'?'mean per-war RPS difference':'mean per-attack RPS difference',blocks:blocks.length,mean:cluster==='war'?mean(blocks.map(blockMean)):mean(diffs.map(r=>r.deltaRps)),lower:samples[50],upper:samples[1949],conditionalOn:'frozen coefficients and ranked reference; repeated players across wars remain a limitation'};
}
const summary={createdAt:new Date().toISOString(),baselineVersion:S.VERSION,baselineSourceHash:manifest.baselineSourceHash,dataset:{poolWars:manifest.poolWars,targetWars:manifest.targets.length,familyPlayers:data.family.length,rankedWeeks:new Set([...data.rows.values()].map(r=>r.weekStart)).size,rankedRows:data.rows.size,rankedAttacks:data.attacks.length,rankedAttacksBoundedTH:data.attacks.filter(a=>a.thStatus==='bounded').length,clashspotSeasons:data.spot.clans.length,clashspotGroups:data.spot.groups.length},
  protocol,selected,controls,lowHistorySelection:{exploratory:true,reason:"Align coefficient selection with players having fewer than five war attacks; primary selection unchanged",config:lowHistoryChoice.config,selection:lowHistoryChoice.selectionLowHistory,test:lowHistoryChoice.testLowHistory},bestCombined:best.config,intervals:selected.map(v=>({analysis:v.analysis,id:v.config.id,war:interval(groups.get(v.config.id),'war'),player:interval(groups.get(v.config.id),'attacker')})),
  byHistory:selected.map(v=>({analysis:v.analysis,id:v.config.id,bands:['0','1-4','5+'].map(band=>({band,...metrics(groups.get(v.config.id).filter(r=>r.split==='test'&&(band==='0'?r.attackCount===0:band==='1-4'?r.attackCount>0&&r.attackCount<5:r.attackCount>=5)))}))})),
  byClan:selected.map(v=>({analysis:v.analysis,id:v.config.id,clans:[...new Set(groups.get(v.config.id).map(r=>r.clan))].map(clan=>({clan,...metrics(groups.get(v.config.id).filter(r=>r.clan===clan&&r.split==='test'))}))})),
  runtimeUnchanged:hash(fs.readFileSync('public/portal/war-scores.js','utf8'))===manifest.baselineSourceHash,productionChanged:false};
fs.writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));fs.writeFileSync(out+'/grid.json',JSON.stringify(results,null,2));
const chosenRows=selected.flatMap(s=>groups.get(s.config.id).map(r=>({variant:s.analysis,...r})));fs.writeFileSync(out+'/predictions.json',JSON.stringify(chosenRows));
const columns=['variant','split','war','clan','name','attacker','th','defTH','stars','attackCount','baseScore','score','delta','defenseScore','league','quality','qN','mu'];fs.writeFileSync(out+'/scores.tsv',[columns.join('\t'),...chosenRows.map(r=>columns.map(k=>String(r[k]??'').replace(/[\t\n\r]/g,' ')).join('\t'))].join('\n'));
const fmt=(x,n=4)=>x==null?'—':x.toFixed(n),table=selected.map(s=>`| ${s.analysis} | ${s.config.bS||0} | ${s.config.bQ||0} | ${s.config.bC||0} | ${s.config.k} | ${s.config.promotion} | ${fmt(s.selection.warRps)} | ${fmt(s.validation.warRps)} | ${fmt(s.test.warRps)} | ${s.test.changed} |`).join('\n');
const baseline=selected.find(s=>s.analysis==='baseline');
fs.writeFileSync(out+'/README.md',`# Experimento de ATQ com ranqueada\n\nSomente análise local. Nenhum score, plano, regra de convocação ou dado de produção foi alterado.\n\n${manifest.targets.length} guerras completas; ${data.family.length} jogadores na família atual; ${data.attacks.length} ataques ranqueados em ${new Set(data.attacks.map(a=>a.weekStart)).size} semanas. ClashSpot: ${data.spot.clans.length} resumos e ${data.spot.groups.length} grupos detalhados.\n\nOs coeficientes e variantes abaixo foram escolhidos somente no período anterior a 12/10. 12–18/10 é validação e 19–28/10 é teste. A referência de família atual e os CVs sem confirmação histórica tornam esta análise exploratória.\n\n| Sinal | bS | bQ | constante | κ | promoção | RPS treino | RPS validação | RPS teste | Ataques alterados no teste |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${table}\n\nRPS é erro ordinal de estrelas: menor é melhor. O controle constante verifica se um ganho vem apenas de elevar as estimativas. Os dados reais não validam ataques alternativos que não foram executados.\n\nTeste do v2: ${baseline.test.attacks} ataques, ${baseline.test.wars} guerras e ${baseline.test.players} jogadores; a cobertura por clã e por quantidade de histórico está no summary.json.\n\nDEF, limiares, coeficientes e escala foram congelados. A integração usa a diferença entre dois ajustes condicionais, um com prior μ e outro com prior zero, somada ao efeito original; isso evita atribuir à ranqueada uma melhora causada somente por repetir o ajuste numérico do v2.\n\nArquivos: summary.json (resultados e intervalos), grid.json (todas as variações), predictions.json e scores.tsv (ataque por ataque), protocol.json (protocolo), sources/ e clashspot.json (dados locais).\n`);
console.log(JSON.stringify({stage:'complete',dataset:summary.dataset,selected:selected.map(s=>({config:s.config,test:s.test})),controls:summary.controls},null,2));
