"""Python-driven WCSPH/experimental DFSPH A/B; equal dt, particles, and Water material.
Requires the software-Vulkan environment documented in GPU-DFSPH.md.
"""
import json,os,statistics,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
rows={'wcsph':[],'dfsph':[]};states={}
for pair in range(3):
 for variant in (['wcsph','dfsph'] if pair%2==0 else ['dfsph','wcsph']):
  output=f'benchmarks/results/dfsph-frame-{variant}-{pair+1}.json'
  cmd=[sys.executable,'benchmarks/profile.py','--chromium',os.environ.get('CHROMIUM_PATH','/tmp/chromium'),'--software','--mode','frame','--variant','optimized','--water','--output',output]
  if variant=='dfsph':cmd+=['--dfsph']
  subprocess.run(cmd,cwd=ROOT,check=True)
  result=json.loads((ROOT/output).read_text());rows[variant]+=result['results'];states[variant]=result['state']
metrics={}
for metric in rows['wcsph'][0]:
 a=statistics.median(r[metric] for r in rows['wcsph']);b=statistics.median(r[metric] for r in rows['dfsph'])
 metrics[metric]={'wcsph_ms':a,'dfsph_ms':b,'dfsph_over_wcsph':b/a}
result={'samples_per_variant':27,'material':'Water, pressure coefficient unused in DFSPH','dt':.002,'steps_per_frame':8,'adapter':'SwiftShader software WebGPU','medians':metrics,'last_run_states':states}
(ROOT/'benchmarks/results/dfsph-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
