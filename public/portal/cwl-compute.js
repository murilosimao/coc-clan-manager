(function () {
  let active = null;
  function cancel() {
    if (!active) return;
    active.worker.terminate(); active.reject(new DOMException('Cálculo cancelado.','AbortError')); active=null;
  }
  function calculate(input,onProgress) {
    cancel();
    if(!window.Worker||!window.CompressionStream)return Promise.reject(new Error('Atualize o navegador para preparar planos. Você ainda pode consultar os planos salvos.'));
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('cwl-compute-worker.js',document.currentScript?.src||new URL('portal/cwl-compute.js',location.href)),{type:'module'});
      active={worker,reject};
      worker.onmessage=({data})=>{
        if(data.type==='progress') { onProgress?.(data); return; }
        worker.terminate(); if(active?.worker===worker)active=null;
        if(data.type==='result')resolve(data);
        else { const error=new Error(data.message);error.code=data.code;reject(error); }
      };
      worker.onerror=()=>{worker.terminate();if(active?.worker===worker)active=null;reject(new Error('Não foi possível iniciar o cálculo neste navegador.'));};
      worker.postMessage(input);
    });
  }
  window.CwlCompute={calculate,cancel};
})();
