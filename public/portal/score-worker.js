importScripts('war-scores.js','ranked-scores.js');
self.onmessage = (event) => {
  try { const input=event.data; self.postMessage({ model: self.RankedScores.apply(input.base||self.WarScores.fit(input),input.ranked,input.history) }); }
  catch (error) { self.postMessage({ error: error.message || 'Não foi possível calcular os scores.' }); }
};
