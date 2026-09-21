"""Actual GPU DFSPH stability, fallback, large-container and checkbox validation."""
import asyncio,json,os,sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await b.new_page(viewport={'width':1300,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:8005/gpu-sph.wgsl')
  stress=[]
  for mode,dims,count,steps in ([] if '--ui-only' in sys.argv else [(False,[7.5,5],6144,960),(True,[7.5,5],6144,960),(True,[30,20],6144,120),(True,[100,100],6144,48),(True,[300,200],6144,24),(True,[7.5,5],12000,24),(True,[7.5,5],24000,24)]):
   state=await page.evaluate(r'''async ({mode,dims,count,steps})=>{
    const {GPUSPH}=await import('./gpu-sph.mjs');const a=await navigator.gpu.requestAdapter();const d=await a.requestDevice();const errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    const s=await GPUSPH.create(d,count,dims);s.useDFSPH=mode;const checkpoints=[];let peakCompression=0;
    try{
     for(let n=0;n<steps;n+=12){const e=d.createCommandEncoder();s.encode(e,Math.min(12,steps-n),n>240?[-.2,.68,.6,.4]:s.body,n>=480&&n<720?[-.6,.38,.25,42]:[0,0,0,0]);d.queue.submit([e.finish()]);const r=await s.inspect();
      if(!r.finite||r.outside||r.insideSolids||r.invalidResets||r.neighborTruncations||r.speedCaps)throw new Error(JSON.stringify({n,r}));
      peakCompression=Math.max(peakCompression,r.densityError.maxPositiveCompressionPercent);
      if(n%120===0||n+12>=steps)checkpoints.push(r);
     }
     if(errors.length)throw new Error(errors.join('\n'));
     return {mode,dims,count,steps,checkedBatches:Math.ceil(steps/12),peakSampledCompressionPercent:peakCompression,checkpoints};
    }finally{s.destroy();d.destroy();}
   }''',dict(mode=mode,dims=dims,count=count,steps=steps))
   stress.append(state);print('PASS stress',mode,dims,count,steps,flush=True)
  if stress:(ROOT/'benchmarks/results/dfsph-stress-validation.json').write_text(json.dumps(stress,indent=2)+'\n')
  elif (ROOT/'benchmarks/results/dfsph-stress-validation.json').exists():stress=json.loads((ROOT/'benchmarks/results/dfsph-stress-validation.json').read_text())
  equivalence=[]
  for dense in [False,True]:
   args={'dfsph':True,'dense':dense,'batches':1,'substeps':1}
   cached=await page.evaluate('async c=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver(c);}',args)
   shader=(ROOT/'gpu-sph.wgsl').read_text().replace('if(cached<=96u)','if(false)')
   async def route_shader(route,request):await route.fulfill(body=shader,content_type='text/plain')
   await page.route('**/gpu-sph.wgsl*',route_shader)
   reference=await page.evaluate('async c=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver(c);}',args)
   await page.unroute('**/gpu-sph.wgsl*')
   pos=max(abs(a-b) for i,(a,b) in enumerate(zip(cached['state'],reference['state'])) if i%8<3)
   vel=max(abs(a-b) for i,(a,b) in enumerate(zip(cached['state'],reference['state'])) if 4<=i%8<7)
   print('CACHE',dense,pos,vel,flush=True)
   assert pos<1e-4 and vel<.01,(pos,vel)
   if dense:assert cached['fallbackParticles']>=128
   equivalence.append({'dense':dense,'maxPositionError':pos,'maxVelocityError':vel,'fallbackParticles':cached['fallbackParticles']})
  await page.goto('http://localhost:8005/gpu-fluid.html');await page.wait_for_function("['ready','error'].includes(document.documentElement.dataset.state)",timeout=90000)
  assert await page.evaluate("document.documentElement.dataset.state==='ready'")
  await page.locator('#play').click();await page.wait_for_function('!gpuFluidDiagnostics().busy')
  await page.locator('[data-object="fluid"]').click();await page.locator('#useDFSPH').check();await page.wait_for_function('gpuFluidDiagnostics().useDFSPH && !document.querySelector("#useDFSPH").disabled')
  assert (await page.evaluate('gpuFluidDiagnostics()'))['steps']==0
  await page.locator('[data-object="tub"]').click()
  assert await page.locator('#tubWidth').get_attribute('max') is None and await page.locator('#tubDepth').get_attribute('max') is None
  await page.locator('#tubWidth').fill('30');await page.locator('#tubDepth').fill('20');await page.locator('#applyTub').click();await page.wait_for_function('gpuFluidDiagnostics().dimensions[0]===30 && !document.querySelector("#applyTub").disabled')
  assert await page.evaluate('gpuFluidDiagnostics().useDFSPH')
  await page.locator('#tubWidth').fill('100000000');await page.locator('#tubDepth').fill('3.4');await page.locator('#applyTub').click();await page.wait_for_function('document.querySelector("#sizeHelp").textContent.includes("GPU") && !document.querySelector("#applyTub").disabled')
  assert (await page.evaluate('gpuFluidDiagnostics()'))['dimensions']==[30,20]
  assert await page.evaluate("document.documentElement.dataset.state==='ready'")
  await page.locator('#tubWidth').fill('30');await page.locator('#tubDepth').fill('20')
  await page.locator('[data-object="fluid"]').click()
  async with page.expect_download(timeout=120000) as pending:await page.locator('#measureGpu').click()
  download=await pending.value;report=json.loads(Path(await download.path()).read_text())
  assert report['useDFSPH'] and report['state']['constraintDiagnostics']['measured'] and len(report['results'])==9
  await page.locator('[data-object="fluid"]').click()
  await page.screenshot(path='/home/user/dfsph-large.png')
  await page.locator('#useDFSPH').uncheck();await page.wait_for_function('!gpuFluidDiagnostics().useDFSPH && !document.querySelector("#useDFSPH").disabled')
  state=await page.evaluate('inspectGPUFluid()');assert state['steps']==0 and not state['densityError']['measured'] and state['constraintDiagnostics'] is None
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(500)
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  result={'stress':stress,'cacheEquivalence':equivalence,'ui':'toggle/reset, larger footprint, safe resource-limit rejection, mode preserved on resize, DFSPH download, mobile passed','download':{'dimensions':report['dimensions'],'useDFSPH':report['useDFSPH']},'errors':errors}
  (ROOT/'benchmarks/results/dfsph-validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'equivalence':equivalence,'ui':result['ui'],'errors':errors},indent=2));await b.close()
asyncio.run(main())
