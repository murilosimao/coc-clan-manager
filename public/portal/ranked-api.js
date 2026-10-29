/* Shared on-demand collection. Public facts only; no API keys or sessions. */
(function(root){
  'use strict';
  const clean = t => String(t || '').replace(/^#/, '').toUpperCase();
  const batches = (items,n) => Array.from({length:Math.ceil(items.length/n)},(_,i)=>items.slice(i*n,i*n+n));
  const memo = new Map();
  async function pool(items,task){
    let next=0;const results=Array(items.length);
    await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await task(items[i]);}}));
    return results;
  }
  async function load({apiOrigin='',players=[],onProgress=()=>{},fetcher=fetch}={}){
    let requests=0,completed=0;
    const get=async(kind,tags)=>{
      const url=apiOrigin+'/api/ranked/'+kind+(tags?'?tags='+tags.join(','):'');
      const cached=memo.get(url);if(cached&&Date.now()-cached.fetchedAt<240000)return cached;
      requests++;onProgress({stage:'ranked',requests,completed});
      try{
        const response=await fetcher(url,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error('Ranqueada indisponível nesta consulta. O ATQ usa o histórico de guerra e CWL.');
        const value=await response.json();memo.set(url,value);return value;
      }finally{completed++;onProgress({stage:'ranked',requests,completed});}
    };
    const family=await get('family'),tags=[...new Set([...family.items.map(p=>p.tag),...players.map(p=>clean(p.tag))])].sort();
    if(tags.length>200)throw new Error('Consulta de ranqueada excedeu o limite de jogadores.');
    const records=await pool(batches(tags,3),batch=>get('players',batch));
    const packets=[family,...records], known=new Set(records.flatMap(p=>p.items).map(p=>p.tag));
    const opponents=[...new Set(records.flatMap(p=>p.items).flatMap(p=>p.group?.attacks||[]).map(a=>a.defenderTag))].filter(t=>!known.has(t)).sort();
    // League evidence remains usable if target levels cannot be fetched.
    const levels=await pool(batches(opponents,20),batch=>get('levels',batch).catch(()=>null));
    packets.push(...levels.filter(Boolean));
    // Existing current profiles are also authenticated level observations.
    return {packets,fetchedAt:Math.min(...packets.map(p=>p.fetchedAt))};
  }
  root.RankedAPI={load};
})(typeof window!=='undefined'?window:globalThis);
