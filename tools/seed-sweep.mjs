// seed robustness: different seeds must all pass the cut contract, no artifacts
import { buildBaseTerrain } from '../src/core/terrain.js';
import { erodeSDF } from '../src/core/erosion.js';

const P = { size:[100,64,100], res:128, style:'ridged', octaves:9, lacunarity:2.0,
  gain:0.46, baseFreq:0.016, warp:8, peakHeight:30, peakRadius:40, maskPower:2.4, tiltStrength:4,
  tiltAngleDeg:35, baseHeight:12, bedrock:6, droplets:60000, maxSteps:48, inertia:0.06, capacity:0.09,
  minSlope:0.02, erosionRate:0.5, depositionRate:0.25, evaporation:0.02, erosionDepth:1.0,
  stampRadiusVox:1.15, gravityScale:0.9, talusAngleDeg:42, talusRate:0.25, reinitBandVox:6, incisionRounds:4 };

let fails = 0;
for (const seed of [7, 42, 999, 2026, 55555]) {
  const p = { ...P, seed };
  const base = buildBaseTerrain(p, ()=>{});
  const er = erodeSDF(base.vol, p, { colH: base.colH, onProgress: ()=>{} });
  const vol = base.vol, {nx,ny,nz} = vol;
  let bores = 0, towers = 0;
  for (let k=0;k<nz;k++) for (let i=0;i<nx;i++) {
    let allPos = true, allNeg = true;
    for (let j=0;j<ny;j++) { const v = vol.data[(k*ny+j)*nx+i]; if (v<0) allPos=false; else allNeg=false; }
    if (allPos) bores++; if (allNeg) towers++;
  }
  const budget = (2.5 + 6*p.erosionDepth + 1.6) * er.audit.voxMax;
  const chanVox = er.audit.channelMeanCut / er.audit.voxMax;
  const ok = bores===0 && towers===0 && er.audit.maxCut <= budget*1.05 && chanVox >= 0.35;
  if (!ok) fails++;
  console.log(`seed ${String(seed).padStart(6)} | maxCut ${er.audit.maxCut.toFixed(2)}/${budget.toFixed(2)} m | chan ${chanVox.toFixed(2)} vox | bores ${bores} towers ${towers} | ${ok?'PASS':'FAIL'}`);
}
process.exit(fails ? 1 : 0);
