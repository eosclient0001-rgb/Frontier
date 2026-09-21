"""Actual GPU and editor checks for smaller physical particle presets."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await b.new_page(viewport={'width':1300,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:8005/gpu-sph.wgsl')
  cases=[]
  for count in [48000,96000]:
   for dfsph in [False,True]:
    result=await page.evaluate(r'''async ({count,dfsph})=>{
     const {GPUSPH}=await import('./gpu-sph.mjs');const a=await navigator.gpu.requestAdapter();const d=await a.requestDevice();const errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));const s=await GPUSPH.create(d,count,[7.5,5]);s.useDFSPH=dfsph;
     try {const e=d.createCommandEncoder();s.encode(e,12,s.body,[0,0,0,0]);d.queue.submit([e.finish()]);const state=await s.inspect();
      if(errors.length)throw new Error(errors.join('\n'));
      return {count,dfsph,diameter:s.radius*2,spacing:s.spacing,nominalVolume:s.mass*count/1000,state};
     }finally{s.destroy();d.destroy();}
    }''',{'count':count,'dfsph':dfsph})
    state=result['state'];assert state['finite'] and not any(state[k] for k in ['outside','insideSolids','invalidResets','speedCaps','neighborTruncations']),state
    cases.append(result);print('PASS',count,dfsph,flush=True)
  assert abs(cases[0]['nominalVolume']-cases[2]['nominalVolume'])<1e-8
  assert cases[2]['diameter']<cases[0]['diameter']
  await page.goto('http://localhost:8005/gpu-fluid.html');await page.wait_for_function("['ready','error'].includes(document.documentElement.dataset.state)",timeout=90000)
  assert await page.evaluate("document.documentElement.dataset.state==='ready'")
  await page.locator('#play').click();await page.wait_for_function('!gpuFluidDiagnostics().busy')
  await page.locator('[data-object="fluid"]').click();await page.locator('#useDFSPH').check();await page.wait_for_function('!document.querySelector("#useDFSPH").disabled')
  before=await page.evaluate('gpuFluidDiagnostics()')
  await page.select_option('#motionPreset','reference')
  await page.select_option('#resolution','96000');await page.wait_for_function('gpuFluidDiagnostics().count===96000 && !document.querySelector("#resolution").disabled',timeout=120000)
  after=await page.evaluate('gpuFluidDiagnostics()');assert after['useDFSPH'] and after['steps']==0 and not after['running'] and after['particleDiameter']<before['particleDiameter']/2
  assert await page.locator('#viscosity').input_value()=='0.025'
  assert '5.0 cm' in await page.locator('#particleDiameter').inner_text()
  await page.locator('[data-object="tub"]').click();await page.select_option('#tubPreset','30,20');await page.locator('#applyTub').click();await page.wait_for_function('gpuFluidDiagnostics().dimensions[0]===30 && !document.querySelector("#applyTub").disabled',timeout=120000)
  assert (await page.evaluate('gpuFluidDiagnostics()'))['count']==96000
  await page.locator('[data-object="fluid"]').click()
  assert '12.6 cm' in await page.locator('#particleDiameter').inner_text()
  await page.select_option('#resolution','6144');await page.wait_for_function('gpuFluidDiagnostics().count===6144 && !document.querySelector("#resolution").disabled',timeout=120000)
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(500);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  report={'gpuCases':cases,'ui':'smaller size, DFSPH/material/pause preservation, dynamic diameter labels, size persistence on resize, switch back and mobile passed','errors':errors}
  (ROOT/'benchmarks/results/particle-size-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(report['ui']);await b.close()
asyncio.run(main())
