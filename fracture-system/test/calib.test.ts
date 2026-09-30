/** Verify the lattice reproduces the target Young's modulus. */
import { buildLattice } from '../src/peridynamics/Lattice.ts';
import { nodeStress } from '../src/peridynamics/Stress.ts';
import { MATERIAL_PARAMS, MaterialType } from '../src/materials.ts';
import { box } from '../src/sdf/SDF.ts';

for (const [type, id] of [[MaterialType.GLASS,0],[MaterialType.WOOD,1],[MaterialType.CONCRETE,2],[MaterialType.PLASTIC,3],[MaterialType.ROCK,4]] as [MaterialType,number][]) {
  const half: [number,number,number] = [0.15,0.15,0.15];
  const L = buildLattice(box(half[0],half[1],half[2]), {
    center:[0,0,0], halfSize:half, spacing:0.02, horizon:2,
    material: MATERIAL_PARAMS[type], grainAxis:[0,1,0],
    heterogeneity:0, softening:60, jitter:0, materialId:id,
  });
  // impose uniaxial strain by moving all nodes
  const eps = 1e-5;
  for (let n=0;n<L.count;n++) L.pos[n*3] = L.ref[n*3]*(1+eps);
  const st = {xx:0,yy:0,zz:0,xy:0,yz:0,zx:0};
  // average over interior nodes
  let sxx=0,syy=0,szz=0,c=0;
  for (let n=0;n<L.count;n++){
    if (L.nodeBondCount[n] < 26) continue;
    nodeStress(L, st, n);
    sxx+=st.xx; syy+=st.yy; szz+=st.zz; c++;
  }
  if (!c) { console.log(type, 'no interior nodes'); continue; }
  const Exx = sxx/c/eps, Eyy = syy/c/eps, Ezz = szz/c/eps;
  const target = L.response.E;
  const poissonEff = -Eyy/Exx;
  console.log(`${type.padEnd(9)} target E=${(target/1e9).toFixed(3)}GPa  measured Exx=${(Exx/1e9).toFixed(3)}GPa (${(Exx/target*100).toFixed(1)}%)  Eyy/Ezz=${(Eyy/1e9).toFixed(3)}/${(Ezz/1e9).toFixed(3)}  nu_eff=${poissonEff.toFixed(3)}`);
}
