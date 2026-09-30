import { FractureSim } from '../src/core/FractureSim.ts';
import { MaterialType } from '../src/materials.ts';
import type { Vec3 } from '../src/fracture/CrackNetwork.ts';

const sev = Number(process.argv[2] ?? 9);
const sim = new FractureSim({
  material: MaterialType.GLASS, shape: 'plate', size: [0.6, 0.5, 0.03],
  detail: 3, grainAxis: [0, 1, 0], anchored: true, seed: 42,
  toughnessScale: Number(process.env.TS_SCALE ?? 0.3),
});
const half = sim.half;
sim.triggerImpact([-half[0] * 0.7, half[1] * 0.2, half[2] * 0.9], [1, 0.15, -0.3], 1e9, sev);
console.log(`sev=${sev} K_eff=${sim.effectiveToughness.toExponential(2)} sigma_p(13.5mm)=${((sim.effectiveToughness / Math.sqrt(Math.PI * 0.00675 / 2)) / 1e3).toFixed(0)}kPa`);

let peakEver = 0;
const t0 = performance.now();
for (let k = 0; k < 80; k++) {
  const more = sim.advance(200);
  peakEver = Math.max(peakEver, sim.field.peakTension());
  if (k % 8 === 0) {
    const f = sim.network.fronts[0];
    const st = sim.network.stats();
    console.log(`  k${String(k).padStart(2)} t=${(sim.time * 1e3).toFixed(2)}ms peak=${(sim.field.peakTension() / 1e3).toFixed(0)}kPa | f0 drive=${(f.drive / 1e3).toFixed(0)}kPa len=${(f.length * 1000).toFixed(0)}mm v=${f.speed.toFixed(0)} | fronts=${st.total} act=${st.active} len=${st.totalLength.toFixed(2)}m`);
  }
  if (!more) break;
}
console.log(`wall=${(performance.now() - t0).toFixed(0)}ms peakEver=${(peakEver / 1e3).toFixed(0)}kPa state=${sim.state}`);
const st = sim.network.stats();
const reasons: Record<string, number> = {};
for (const f of sim.network.fronts) reasons[f.stoppedReason || 'running'] = (reasons[f.stoppedReason || 'running'] ?? 0) + 1;
console.log(`RESULT fronts=${st.total} act=${st.active} len=${st.totalLength.toFixed(3)}m peakV=${st.maxSpeed.toFixed(0)}m/s fates=${JSON.stringify(reasons)}`);
console.log('lengths(mm):', sim.network.fronts.map(f => (f.length * 1000).toFixed(0)).join(' '));
