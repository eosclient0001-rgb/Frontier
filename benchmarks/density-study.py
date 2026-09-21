"""Interleaved WebGPU density-stencil A/B; invokes the Python browser profiler."""
import json, os, statistics, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
summary={}
for mode in ['stages','frame']:
 rows={'before':[],'after':[]}
 for pair in range(3):
  for variant in (['before','after'] if pair%2==0 else ['after','before']):
   output=f'benchmarks/results/density-{mode}-{variant}-{pair+1}.json'
   command=[sys.executable,'benchmarks/profile.py','--chromium',os.environ.get('CHROMIUM_PATH','/tmp/chromium'),'--software','--mode',mode,'--variant','optimized','--output',output]
   if variant=='before':command+=['--source-dir','benchmarks/pre-cell-bins']
   subprocess.run(command,cwd=ROOT,check=True)
   report=json.loads((ROOT/output).read_text());rows[variant]+=report['samples' if mode=='stages' else 'results']
 metrics={}
 for key in rows['before'][0]:
  before=statistics.median(r[key] for r in rows['before']);after=statistics.median(r[key] for r in rows['after'])
  metrics[key]={'before_ms':before,'after_ms':after,'reduction_percent':100*(1-after/before)}
 summary[mode]={'samples_per_variant':len(rows['before']),'medians':metrics}
(ROOT/'benchmarks/results/density-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
