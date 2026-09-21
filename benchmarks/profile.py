#!/usr/bin/env python3
"""Python-driven actual WebGPU profiling, not a CPU model of WGSL.
Requires pip install playwright and a Chromium with WebGPU.
See GPU-OPTIMIZATION.md for software-adapter setup and limitations.
"""
import argparse,asyncio,hashlib,json,os,statistics,time
from pathlib import Path
from playwright.async_api import async_playwright

def summarize(rows):
 result={}
 for key in rows[0]:
  values=sorted(row[key] for row in rows)
  result[key]={'median_ms':statistics.median(values),'p95_ms':values[min(len(values)-1,int(.95*len(values)))],'min_ms':values[0]}
 return result

async def run(args):
 async with async_playwright() as p:
  flags=['--no-sandbox','--no-zygote']
  if args.software: flags+=['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface']
  browser=await p.chromium.launch(executable_path=args.chromium or None,args=flags)
  page=await browser.new_page(viewport={'width':1300,'height':850});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  start=time.perf_counter();source_hashes={}
  # Route frozen source snapshots without changing the running preview.
  if args.variant=='baseline' or args.source_dir:
   for filename in ['gpu-sph.mjs','gpu-sph.wgsl','gpu-fluid-app.js','gpu-fluid-shaders.mjs']:
    source=(Path(args.source_dir) if args.source_dir else Path(__file__).parent/'baseline')/filename
    if not source.exists():continue
    content=source.read_text();source_hashes[filename]=hashlib.sha256(content.encode()).hexdigest()
    async def serve(route,request,body=content):await route.fulfill(body=body,content_type='text/javascript' if '.js' in route.request.url or '.mjs' in route.request.url else 'text/plain')
    await page.route('**/'+filename+'*',serve)
  if args.mode=='damping':
   await page.goto(args.url+'/gpu-sph.wgsl')
   raw=await page.evaluate("async()=>{const {benchmarkDamping}=await import('./benchmarks/damping.mjs');return benchmarkDamping();}")
   raw['summary']={r['name']:{'retained_energy':r['retainedEnergy']} for r in raw['results']}
  elif args.mode=='stages':
   await page.goto(args.url+'/gpu-sph.wgsl')
   raw=await page.evaluate('''async config=>{const {benchmarkStages}=await import('./benchmarks/stages.mjs');return benchmarkStages(config);}''',{'variant':args.variant,'samples':args.samples,'warmup':3,'stressSteps':args.stress_steps,'water':args.water,'stiffness':args.stiffness})
   raw['summary']=summarize(raw['samples'])
  else:
   await page.goto(args.url+'/gpu-fluid.html')
   await page.wait_for_function("['ready','error'].includes(document.documentElement.dataset.state)",timeout=120000)
   if await page.evaluate("document.documentElement.dataset.state==='error'"):raise RuntimeError(await page.locator('#statusDetail').inner_text())
   if args.dfsph:
    await page.locator('[data-object="fluid"]').click()
    await page.locator('#useDFSPH').check()
    await page.wait_for_function('gpuFluidDiagnostics().useDFSPH && !document.querySelector("#useDFSPH").disabled')
   raw=await page.evaluate('(options)=>benchmarkGPUFrames(options)',{'samples':args.samples,'warmup':3,'steps':8,'renderStages':args.mode=='render','movingCamera':args.moving_camera,'referenceMaterial':not args.water})
   raw['summary']=summarize(raw['results'])
  raw.update(source_overrides=source_hashes,python_wall_seconds=time.perf_counter()-start,browser=browser.version,mode=args.mode,variant=args.variant,moving_camera=args.moving_camera,page_errors=errors)
  if errors or raw.get('errors'):raise RuntimeError(errors or raw['errors'])
  destination=Path(args.output);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(raw,indent=2)+'\n')
  print(json.dumps({'output':str(destination),'adapter':raw.get('adapter'),'summary':raw['summary'],'wall_seconds':raw['python_wall_seconds']},indent=2))
  await browser.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--url',default='http://localhost:8005');parser.add_argument('--chromium',default=os.environ.get('CHROMIUM_PATH'))
 parser.add_argument('--software',action='store_true');parser.add_argument('--mode',choices=['frame','stages','render','damping'],default='stages')
 parser.add_argument('--variant',choices=['baseline','optimized'],default='baseline');parser.add_argument('--samples',type=int,default=9)
 parser.add_argument('--source-dir',help='Override runtime sources from a frozen directory (runtime modules)')
 parser.add_argument('--dfsph',action='store_true',help='Experimental DFSPH checkbox (frame/render modes only)')
 parser.add_argument('--moving-camera',action='store_true')
 parser.add_argument('--stiffness',type=float,help='Pressure-coefficient experiment (stages only; default unchanged)')
 parser.add_argument('--stress-steps',type=int,default=0);parser.add_argument('--water',action='store_true');parser.add_argument('--output',default='benchmarks/results/profile.json')
 args=parser.parse_args()
 if args.dfsph and (args.mode not in ['frame','render'] or args.variant!='optimized'):parser.error('--dfsph requires optimized frame/render mode')
 if args.stiffness is not None and (args.mode!='stages' or not 0<args.stiffness<=1000):parser.error('--stiffness requires stages mode and a value in (0, 1000]')
 if args.samples<1:parser.error('--samples must be positive')
 if args.source_dir and args.variant!='optimized':parser.error('--source-dir requires --variant optimized')
 if args.source_dir and not Path(args.source_dir).is_dir():parser.error('--source-dir does not exist')
 asyncio.run(run(args))
