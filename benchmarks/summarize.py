"""Aggregate the committed, interleaved Python/WebGPU samples without cherry-picking runs."""
import json,statistics
from pathlib import Path
root=Path(__file__).resolve().parent/'results'
result={'environment':'SwiftShader software WebGPU, NOT a hardware GTX/RTX benchmark','method':'3 interleaved fresh-browser runs per variant, 3 warmup frames + 9 measured frames each; 8 fixed 2 ms substeps; 6144 particles; Large tub; Balanced rendering; previous material held fixed','samples':{}}
for variant in ['baseline','optimized']:
 rows=[]
 for i in range(1,4):rows.extend(json.loads((root/f'{variant}-paired-{i}.json').read_text())['results'])
 result['samples'][variant]={k:{'median_ms':statistics.median(r[k] for r in rows),'p95_ms':sorted(r[k] for r in rows)[int(.95*len(rows))]} for k in ['computeMs','renderMs','totalMs']}
result['reduction_percent']={k:100*(1-result['samples']['optimized'][k]['median_ms']/result['samples']['baseline'][k]['median_ms']) for k in ['computeMs','renderMs','totalMs']}
(root/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
