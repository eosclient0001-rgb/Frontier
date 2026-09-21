"""Compare actual GPU density and particle state against the unpruned stencil."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:8005/gpu-sph.wgsl');results=[]
  cases=[{}, {'dense':True}, {'boundary':True}, {'count':12000}, {'count':24000}, {'dimensions':[5,3.4]}, {'dimensions':[14,10]}, {'dimensions':[14,3.4],'boundary':True}, {'batches':10}]
  reference=(ROOT/'gpu-sph.wgsl').read_text().replace('if(gapX[u32(x+1)]+gapY[u32(y+1)]+gapZ[u32(z+1)]>h2*1.0001)', 'if(false)')
  async def serve(route,request):await route.fulfill(body=reference,content_type='text/plain')
  for config in cases:
   optimized=await page.evaluate('async c=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver(c);}',config)
   await page.route('**/gpu-sph.wgsl*',serve)
   baseline=await page.evaluate('async c=>{const m=await import("./benchmarks/correctness.mjs");return m.snapshotSolver(c);}',config)
   await page.unroute('**/gpu-sph.wgsl*')
   pos=max(abs(a-b) for i,(a,b) in enumerate(zip(optimized['state'],baseline['state'])) if i%8<3)
   vel=max(abs(a-b) for i,(a,b) in enumerate(zip(optimized['state'],baseline['state'])) if 4<=i%8<7)
   density=max(abs(a-b) for i,(a,b) in enumerate(zip(optimized['densities'],baseline['densities'])) if i%2==0)
   assert pos<1e-4 and vel<.01 and density<.1,(config,pos,vel,density)
   assert optimized['metrics']['finite'] and baseline['metrics']['finite']
   assert optimized['metrics']['densityError']['measured']
   if config.get('dense'):assert optimized['fallbackParticles']>=128
   results.append({'config':config,'maxPositionErrorMetres':pos,'maxVelocityError':vel,'maxDensityErrorKgPerM3':density,'fallbackParticles':optimized['fallbackParticles']})
  assert not errors,errors
  report={'cases':results,'errors':errors};(ROOT/'benchmarks/results/density-equivalence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));await b.close()
asyncio.run(main())
