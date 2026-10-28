/* The two supported clan contexts. Stored preference is public UI state, not authorization. */
(function(){
  'use strict';
  const key='coc-clan-context-v1';
  const clans=Object.freeze([
    Object.freeze({tag:'2G8QCR92V',name:'PuroSangue',label:'Clã principal',badge:'portal/images/clans/2G8QCR92V.png'}),
    Object.freeze({tag:'2CQ9CR2YP',name:'SanguePuro',label:'Clã secundário',badge:'portal/images/clans/2CQ9CR2YP.png'}),
  ]);
  const find=value=>clans.find(c=>c.tag===String(value||'').trim().replace(/^#/,'').toUpperCase())||null;
  function read(){try{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved?.version===1?find(saved.tag):null;}catch{return null;}}
  function save(value){const clan=find(value);if(!clan)return false;try{localStorage.setItem(key,JSON.stringify({version:1,tag:clan.tag}));return true;}catch{return false;}}
  window.ClanContexts=Object.freeze({clans,find,read,save});
})();
