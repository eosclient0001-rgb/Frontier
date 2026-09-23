import { MAX, MIN, BAND, CELL } from "./domain.js";
// SI-unit hydraulic closure. Exact exchange for frozen local coefficients;
// NOT a calibrated CFD/rock-fracture model. Preview scale is explicit.
export const hydraulicDefaults = {
  hydraulicDepth: 20, // mm of representative surface water
  hydraulicDrag: 0.01,
  hydraulicErodibility: 0.02, // mm / (Pa s), multiplied by erosion strength
  hydraulicPreview: 10, // representative-parcel multiplier, not trajectory time
  hydraulicMaxChange: 5, // mm/s, aggregate numerical surface-change ceiling
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const safe = (v, d, a, b) =>
  clamp(Number.isFinite(Number(v)) ? Number(v) : d, a, b);
export function hydraulicUniforms(p = {}) {
  return [
    safe(p.hydraulicErodibility ?? 0.02, 0.02, 0.001, 0.1) * 0.001,
    safe(p.hydraulicDepth ?? 20, 20, 1, 100) * 0.001,
    safe(p.hydraulicDrag ?? 0.01, 0.01, 0.002, 0.03),
    safe(p.hydraulicPreview ?? 10, 10, 1, 200),
  ];
}
export function sampleArea(p = {}, count = 1024) {
  const width = Math.min(
    (MAX[0] - MIN[0]) * 0.96,
    (p.preset === 3 ? p.plotWidth : p.terrainWidth) ?? 28,
  );
  const length = Math.min(
    (MAX[2] - MIN[2]) * 0.96,
    (p.preset === 3 ? p.plotLength : p.terrainLength) ?? 28,
  );
  return Math.max(1, width * length) / Math.max(1, count);
}
export function maxSolidChange(
  p = {},
  dt = 0.04,
  band = BAND,
  cell = Math.min(...CELL),
) {
  const speed = safe(p.hydraulicMaxChange ?? 5, 5, 1, 200) * 0.001;
  return Math.min(speed * Math.max(dt, 0), 0.2 * cell) / (2 * band);
}
export function settlingVelocity(diameter) {
  const d = Math.max(0, diameter),
    R = 1.65,
    g = 9.81,
    nu = 1e-6;
  return (R * g * d * d) / (18 * nu + Math.sqrt(0.75 * R * g * d * d * d));
}
// Rouse-inspired turbulent suspension factor. Still water retains the full
// grain fall speed; shear suppresses net settling of suspended fine grains.
export function suspendedSettlingVelocity(diameter, tau) {
  const ws = settlingVelocity(diameter),
    mixing = 0.4 * Math.sqrt(Math.max(0, tau) / 1000);
  return ws / (1 + (mixing / Math.max(ws, 1e-12)) ** 2);
}
export function hydraulicExchange({
  speed = 0,
  water = 1,
  load = 0,
  grain = 0.00015,
  hardness = 0.6,
  bedding = 0,
  loose = 0,
  strength = 0.45,
  capacity = 0.6,
  deposition = 0.35,
  area = 1,
  dt = 0.04,
  ...settings
} = {}) {
  const [k, h, drag, preview] = hydraulicUniforms(settings),
    A = area * preview,
    V = A * h * Math.max(water, 0);
  const tau = 0.5 * 1000 * drag * speed * speed;
  const cohesion =
    (0.25 + 12 * hardness * hardness) *
    (1 + 0.5 * bedding) *
    (1 - 0.95 * clamp(loose, 0, 1));
  const critical = cohesion + 0.045 * (2650 - 1000) * 9.81 * grain;
  const excess = Math.max(0, tau - critical),
    C = (0.15 * capacity * V * excess) / Math.max(tau + critical, 1e-12);
  const E = strength * k * excess * A * Math.max(water, 0),
    a = C > 1e-12 ? E / C : 0,
    b = (deposition * suspendedSettlingVelocity(grain, tau)) / h;
  const rate = a + b,
    equilibrium = rate > 0 ? (a * C) / rate : load;
  const delta = (equilibrium - load) * -Math.expm1(-rate * Math.max(dt, 0));
  return {
    detach: Math.max(0, delta),
    deposit: Math.max(0, -delta),
    capacity: C,
    tau,
    critical,
    equilibrium,
    rate,
  };
}
export function rainSplash({
  waterVolume,
  impactSpeed,
  hardness,
  strength,
  capacity,
}) {
  const work = 1e5 * (1 + 9 * hardness); // J/m³: assumed weathered material, not measured rock data
  return Math.min(
    0.15 * capacity * waterVolume,
    (strength * 0.01 * 0.5 * 1000 * waterVolume * impactSpeed ** 2) / work,
  );
}
export const hydraulicGLSL = `
float grainFallSpeed(float d){d=max(d,0.);return 1.65*9.81*d*d/(18e-6+sqrt(.75*1.65*9.81*d*d*d));}
float suspendedFallSpeed(float grain,float tau){float ws=grainFallSpeed(grain),mixing=.4*sqrt(max(0.,tau)/1000.);return ws/(1.+pow(mixing/max(ws,1e-12),2.));}
float exchangeFraction(float x){x=max(x,0.);return x<.001?x*(1.-x*.5+x*x/6.):1.-exp(-min(x,80.));}
// controls: strength, hardness, settling multiplier, capacity. model: k, h, Cd, preview.
vec4 waterExchange(float speed,float water,float load,float grain,float bedding,float loose,float area,float dt,vec4 controls,vec4 model){
 float A=area*model.w,V=A*model.y*max(water,0.);
 float tau=.5*1000.*model.z*speed*speed;
 float cohesion=(.25+12.*controls.y*controls.y)*(1.+.5*bedding)*(1.-.95*clamp(loose,0.,1.));
 float critical=cohesion+.045*1650.*9.81*grain;
 float excess=max(0.,tau-critical),C=.15*controls.w*V*excess/max(tau+critical,1e-12);
 float E=controls.x*model.x*excess*A*max(water,0.),a=C>1e-12?E/C:0.,b=controls.z*suspendedFallSpeed(grain,tau)/model.y;
 float rate=a+b,equilibrium=rate>0.?a*C/rate:load;
 float delta=(equilibrium-load)*exchangeFraction(rate*dt);
 return vec4(max(delta,0.),max(-delta,0.),C,tau);
}
float splashVolume(float V,float impact,float hardness,float strength,float capacity){
 return min(.15*capacity*V,strength*.01*.5*1000.*V*impact*impact/(1e5*(1.+9.*hardness)));
}
`;
