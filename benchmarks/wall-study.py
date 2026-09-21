"""Paired Python-driven rendering study and actual WGSL ray equivalence checks.
Run with the same Chromium/software-Vulkan environment as profile.py.
"""
import asyncio, json, os, subprocess, sys, statistics
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def validate():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/chromium'),args=['--no-sandbox','--no-zygote','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface'])
  page=await browser.new_page()
  await page.goto('http://localhost:8005/gpu-sph.wgsl')
  result=await page.evaluate('async()=>{const m=await import("./benchmarks/wall-equivalence.mjs");return m.validateWalls();}')
  (ROOT/'benchmarks/results/wall-equivalence.json').write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps(result,indent=2),flush=True);await browser.close()
def study():
 results={}
 for mode,moving in [('render',False),('frame',False),('frame',True)]:
  label='moving' if moving else mode
  values={'before':[],'after':[]}
  for pair in range(3):
   for variant in (['before','after'] if pair%2==0 else ['after','before']):
    dest=f'benchmarks/results/wall-{label}-{variant}-{pair+1}.json'
    command=[sys.executable,'benchmarks/profile.py','--chromium',os.environ.get('CHROMIUM_PATH','/tmp/chromium'),'--software','--mode',mode,'--variant','optimized','--output',dest]
    if moving:command+=['--moving-camera']
    if variant=='before':command+=['--source-dir','benchmarks/pre-wall-batch']
    subprocess.run(command,cwd=ROOT,check=True)
    values[variant]+=json.loads((ROOT/dest).read_text())['results']
  summary={}
  for metric in values['before'][0]:
   a=statistics.median(row[metric] for row in values['before']);b=statistics.median(row[metric] for row in values['after'])
   summary[metric]={'before_ms':a,'after_ms':b,'reduction_percent':100*(1-b/a)}
  results[label]={'samples_per_variant':len(values['before']),'medians':summary}
 (ROOT/'benchmarks/results/wall-summary.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results,indent=2))
if __name__=='__main__':
 asyncio.run(validate())
 if '--validate-only' not in sys.argv:study()
