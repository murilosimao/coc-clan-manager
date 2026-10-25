importScripts('war-scores.js');
self.onmessage = (event) => {
  try { self.postMessage({ model: self.WarScores.fit(event.data) }); }
  catch (error) { self.postMessage({ error: error.message || 'Não foi possível calcular os scores.' }); }
};
