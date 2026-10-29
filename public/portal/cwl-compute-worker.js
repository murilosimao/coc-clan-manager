import { ClashCwlProvider } from './cwl-provider.js';
import { planWar } from './cwl-planner.js';
import { WarScores } from './cwl-scoring.js';
import './ranked-api.js';

self.onmessage = async ({ data }) => {
  const { clanTag, start, apiOrigin } = data;
  let requests = 0, completed = 0;
  const progress = stage => self.postMessage({ type:'progress',stage,requests,completed });
  const provider = new ClashCwlProvider(async (url, options) => {
    requests++; progress('history');
    try { return await fetch(apiOrigin + '/api/cwl/source?url=' + encodeURIComponent(url), { ...options, credentials:'omit' }); }
    finally { completed++; progress('history'); }
  });
  try {
    progress('war'); const raw = data.snapshot?.raw || await provider.war(clanTag,start);
    progress('history'); const training = data.snapshot?.training || await provider.training(raw);
    if(!data.snapshot){
      progress('ranked');
      try{training.ranked=await globalThis.RankedAPI.load({apiOrigin,players:[...raw.clan.members,...raw.opponent.members],onProgress:p=>self.postMessage({type:'progress',...p})});}
      catch{training.warnings.push('ranked_unavailable:war_atq_preserved');}
    }
    progress('compute'); const before=performance.now(), result=planWar({raw,clanTag,history:training.history,ranked:training.ranked});
    const payload={raw,training,model:result.model,config:result.config,plannerVersion:result.version,computeMs:performance.now()-before,computedAt:new Date().toISOString()};
    progress('archive');
    const archive=await new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    let verification;
    if(data.snapshot){
      const ids=new TextEncoder().encode(JSON.stringify(result.model.events.map(e=>e.id)));
      const eventsHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',ids))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const current=new Set([...result.war.roster,...result.war.opponentRoster].map(p=>WarScores.playerKey(p)));
      verification={version:result.version,config:result.config,context:result.model.context,coefficients:result.model.coefficients,thresholds:result.model.thresholds,
        scales:result.model.scales,eventsHash,players:result.model.players.filter(p=>current.has(p.key)),assignments:result.assignments,
        expectedStars:result.expectedStars,mirrorExpectedStars:result.mirrorExpectedStars,
        observed:result.war.attacks.filter(a=>a.side===result.war.result.ourSide).map(hit=>{
          const a=WarScores.assess(result.model,result.war,hit),tails=result.model.thresholds.map(t=>1/(1+Math.exp(-(a.eta-t))));
          return {order:hit.order,stars:hit.stars,category:a.category,overkill:a.alreadyTripled,probabilities:[1-tails[0],tails[0]-tails[1],tails[1]-tails[2],tails[2]]};
        })};
    }
    self.postMessage({type:'result',archive,computeMs:payload.computeMs,assignments:result.assignments.length,verification},[archive]);
  } catch(error) { self.postMessage({type:'error',message:error.message||'Não foi possível preparar o plano.',code:error.code||'compute_failed'}); }
};
