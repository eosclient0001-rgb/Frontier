"""Python browser checks of actual GPU cache equivalence and interactive editor."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await b.new_page(viewport={'width':1300,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:8005/gpu-sph.wgsl');cases=[]
  for dense in [False,True]:
   cached=await page.evaluate('async dense=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver({dense});}',dense)
   shader=(ROOT/'gpu-sph.wgsl').read_text().replace('if(cached<=96u)','if(false)')
   async def force_fallback(route,request):await route.fulfill(body=shader,content_type='text/plain')
   await page.route('**/gpu-sph.wgsl*',force_fallback)
   reference=await page.evaluate('async dense=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver({dense});}',dense)
   await page.unroute('**/gpu-sph.wgsl*')
   positions=max(abs(x-y) for i,(x,y) in enumerate(zip(cached['state'],reference['state'])) if i%8<3)
   velocities=max(abs(x-y) for i,(x,y) in enumerate(zip(cached['state'],reference['state'])) if 4<=i%8<7)
   assert positions<1e-4 and velocities<.01,(positions,velocities)
   if dense:assert cached['fallbackParticles']>=128
   cases.append({'dense':dense,'maxPositionError':positions,'maxVelocityError':velocities,'fallbackParticles':cached['fallbackParticles']})
  await page.goto('http://localhost:8005/gpu-fluid.html');await page.wait_for_function("['ready','error'].includes(document.documentElement.dataset.state)",timeout=90000)
  assert await page.evaluate("document.documentElement.dataset.state==='ready'"),await page.locator('#statusDetail').inner_text()
  await page.locator('#play').click();await page.wait_for_function('!gpuFluidDiagnostics().busy')
  await page.locator('[data-object="fluid"]').click();assert await page.locator('#viscosity').input_value()=='0.003'
  await page.select_option('#motionPreset','reference');assert await page.locator('#viscosity').input_value()=='0.025'
  await page.select_option('#motionPreset','water');assert await page.locator('#viscosity').input_value()=='0.003'
  await page.screenshot(path='/home/user/gpu-optimized.png')
  await page.select_option('#view','particles');await page.wait_for_timeout(800)
  await page.locator('[data-object="tub"]').click();await page.select_option('#tubPreset','10,6.8');await page.locator('#applyTub').click();await page.wait_for_function('gpuFluidDiagnostics().dimensions[0]===10')
  await page.wait_for_function('!gpuFluidDiagnostics().busy');state=await page.evaluate('inspectGPUFluid()');assert state['finite'] and state['outside']==0 and state['insideSolids']==0
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(800);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  result={'cache_equivalence':cases,'ui':'materials, rendering, resize, mobile, GPU startup passed','errors':errors}
  (ROOT/'benchmarks/results/validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));await b.close()
asyncio.run(main())
