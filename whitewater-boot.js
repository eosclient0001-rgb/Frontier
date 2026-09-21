// Classic bootstrap: catches module import/evaluation failures as well as render errors.
(() => {
  const panel=document.getElementById('webglError');
  const title=document.getElementById('startupTitle');
  const detail=document.getElementById('startupDetail');
  const retry=document.getElementById('retryStartup');
  let failed=false;
  document.documentElement.dataset.pondState='loading';
  function fail(error){
    if(failed)return;failed=true;
    document.documentElement.dataset.pondState='error';
    panel.hidden=false;title.textContent='The pond could not start';
    detail.textContent=String(error?.message||error||'The renderer stopped unexpectedly.');
    retry.hidden=false;clearTimeout(slow);
    console.error('Pond startup/render failure:',error);
  }
  retry.onclick=()=>{const url=new URL(location.href);url.searchParams.set('reload',Date.now());location.replace(url.href);};
  const slow=setTimeout(()=>{
    if(!window.pondFirstFrame&&!failed){title.textContent='The pond is taking longer to load';detail.textContent='Waiting for the water renderer. You can reload if it does not appear.';retry.hidden=false;}
  },20000);
  window.addEventListener('pond-ready',()=>{
    if(failed)return;clearTimeout(slow);panel.hidden=true;document.documentElement.dataset.pondState='ready';
  },{once:true});
  window.addEventListener('error',event=>{if(event.error||event.message)fail(event.error||event.message);});
  window.addEventListener('unhandledrejection',event=>fail(event.reason));
  document.getElementById('fluid').addEventListener('webglcontextlost',event=>{
    event.preventDefault();fail(new Error('The graphics context was lost. Close other graphics-heavy tabs and reload the simulation.'));
  });
  import('./whitewater-app.js?v=20260918-startup4').catch(fail);
})();
