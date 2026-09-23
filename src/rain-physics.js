// Rain water is measured in m³. Constitutive constants below are explicit
// modelling assumptions, not calibrated properties of the procedural rock.
import { suspendedSettlingVelocity } from "./hydraulic-transport.js";
export const rainDefaults = {
  rainRate: 20,
  rainSubstrateShear: 100,
  rainSubstrateErodibility: 0.001,
};
const safe = (v, d, lo, hi) =>
  Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : d));
export function rainParameters(p = {}) {
  return [
    safe(p.rainRate, 20, 0, 300),
    safe(p.rainSubstrateShear, 100, 1, 1000),
    safe(p.rainSubstrateErodibility, 0.001, 0, 1),
    0.01,
  ];
}
export function rainStepVolume(p, dt, area) {
  return (
    ((rainParameters(p)[0] * 0.001) / 3600) *
    Math.max(0, area) *
    Math.max(0, dt) *
    safe(p.rainfall, 0, 0, 1)
  );
}
export function rainTerminalSpeed(diameterMm) {
  return Math.max(
    0.1,
    Math.min(9.2, 9.65 - 10.3 * Math.exp(-0.6 * Math.max(0.1, diameterMm))),
  );
}
export function rainExchange({
  volume = 0,
  speed = 0,
  slope = 0,
  load = 0,
  looseVolume = 0,
  grain = 0.00015,
  hardness = 0.6,
  strength = 0.45,
  capacity = 0.6,
  deposition = 0.35,
  depth = 0.02,
  drag = 0.01,
  erodibility = 0.00002,
  dt = 0.04,
  dose = 1,
  ...p
} = {}) {
  const [, substrateShear, substrateK, maxConcentration] = rainParameters(p);
  const V = Math.max(0, volume),
    h = Math.max(0.001, depth),
    A = V / h;
  const tau = Math.min(
    0.5 * 1000 * drag * speed * speed,
    1000 * 9.81 * h * Math.max(0, Math.min(1, slope)),
  );
  const grainCritical = 0.045 * 1650 * 9.81 * grain,
    excess = Math.max(0, tau - grainCritical);
  const C =
    (maxConcentration * capacity * V * excess) /
    Math.max(tau + grainCritical, 1e-12);
  const soilCritical = 0.25 + 12 * hardness * hardness + grainCritical;
  const rockCritical =
    substrateShear * (0.25 + 0.75 * hardness) + grainCritical;
  const k = strength * erodibility * Math.max(1, dose) * A;
  const soil = Math.min(
    Math.max(0, looseVolume) / Math.max(dt, 1e-8),
    k * Math.max(0, tau - soilCritical),
  );
  const rock = k * substrateK * Math.max(0, tau - rockCritical),
    E = soil + rock;
  const a = C > 1e-12 ? E / C : 0,
    b = (deposition * suspendedSettlingVelocity(grain, tau)) / h,
    rate = a + b;
  const equilibrium = rate > 0 ? (a * C) / rate : load;
  const delta = (equilibrium - load) * -Math.expm1(-rate * Math.max(0, dt));
  return {
    detach: Math.max(0, delta),
    deposit: Math.max(0, -delta),
    capacity: C,
    tau,
    rockFraction: E > 0 ? rock / E : 0,
  };
}
export const rainPhysicsGLSL = `
uniform vec4 rainPhysics; // rate mm/h, substrate threshold Pa, substrate K fraction, concentration limit
float rainTerminalSpeed(float d){return clamp(9.65-10.3*exp(-.6*max(.1,d)),.1,9.2);}
float rainRockFraction;
vec4 rainExchange(float speed,float slope,float V,float load,float looseVolume,float grain,float dt,vec4 controls,vec4 model,float dose){
 V=max(V,0.);float h=max(.001,model.y),A=V/h;
 float tau=min(.5*1000.*model.z*speed*speed,1000.*9.81*h*clamp(slope,0.,1.));
 float grainCritical=.045*1650.*9.81*grain,excess=max(0.,tau-grainCritical);
 float C=rainPhysics.w*controls.w*V*excess/max(tau+grainCritical,1e-12);
 float soilCritical=.25+12.*controls.y*controls.y+grainCritical;
 float rockCritical=rainPhysics.y*(.25+.75*controls.y)+grainCritical;
 float k=controls.x*model.x*max(1.,dose)*A;
 float soil=min(max(0.,looseVolume)/max(dt,1e-8),k*max(0.,tau-soilCritical));
 float rock=k*rainPhysics.z*max(0.,tau-rockCritical),E=soil+rock;
 rainRockFraction=E>0.?rock/E:0.;
 float a=C>1e-12?E/C:0.,b=controls.z*suspendedFallSpeed(grain,tau)/h,rate=a+b;
 float equilibrium=rate>0.?a*C/rate:load,delta=(equilibrium-load)*exchangeFraction(rate*dt);
 return vec4(max(delta,0.),max(-delta,0.),C,tau);
}
`;
