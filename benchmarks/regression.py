"""Actual-browser GPU regression and measurement-download checks (software sandbox)."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await browser.new_page(viewport={'width':1300,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:8005/gpu-sph.wgsl')
  result=await page.evaluate(r'''async()=>{
   const adapter=await navigator.gpu.requestAdapter();const device=await adapter.requestDevice();
   const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   try{
    const {runGPUSPHTests,runGPUTubTests}=await import('./tests/gpu-sph.test.mjs');
    const {runDensityDiagnosticsTests}=await import('./tests/density-diagnostics.test.mjs');
    const diagnostics=await runDensityDiagnosticsTests(device);
    const gpu=await runGPUSPHTests(device),tubs=await runGPUTubTests(device);
    if(errors.length)throw new Error(errors.join('\n'));
    return {diagnostics,gpu,tubs};
   }finally{device.destroy();}
  }''')
  await page.goto('http://localhost:8005/gpu-fluid.html')
  await page.wait_for_function("['ready','error'].includes(document.documentElement.dataset.state)",timeout=90000)
  assert await page.evaluate("document.documentElement.dataset.state==='ready'")
  await page.locator('[data-object="fluid"]').click()
  async with page.expect_download(timeout=120000) as downloaded:await page.locator('#measureGpu').click()
  download=await downloaded.value;report=json.loads(Path(await download.path()).read_text())
  assert len(report['results'])==9 and report['state']['densityError']['measured']
  assert report['material']['stiffness']==100
  assert 'p95 +' in await page.locator('#measureHelp').inner_text()
  assert not await page.locator('#play').is_disabled()
  assert not await page.evaluate('gpuFluidDiagnostics().running')
  assert not errors,errors
  result['download']={'filename':download.suggested_filename,'implementation':report['implementation'],'material':report['material'],'densityError':report['state']['densityError']};result['errors']=errors
  (ROOT/'benchmarks/results/density-regression.json').write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({'diagnostics':result['diagnostics'],'gpuCheckpoints':len(result['gpu']['records']),'tubCases':len(result['tubs']),'download':result['download'],'errors':errors},indent=2))
  await browser.close()
asyncio.run(main())
