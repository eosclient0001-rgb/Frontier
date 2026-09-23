// Simulation seconds, not wall-clock time. Pausing the solver pauses particles.
export const PARTICLE_DT = 0.04;
export const SETTLE_SECONDS = 1;
export const SETTLE_TICKS = Math.round(SETTLE_SECONDS / PARTICLE_DT);
export const MIN_TRANSPORT_SPEED = 0.12;
export const lifecycleDefaults = {
  rainLifetime: 8,
  rainEvaporation: 0.002,
  rainStallTime: 8,
  runoffLifetime: 600,
  runoffEvaporation: 0.001,
  runoffHead: 0.35,
};
const safe = (x, fallback, lo, hi) =>
  Math.max(lo, Math.min(hi, Number.isFinite(Number(x)) ? Number(x) : fallback));
export function lifecycleUniforms(p = {}) {
  return [
    safe(p.rainLifetime ?? 8, 8, 2, 15),
    safe(p.rainEvaporation ?? 0.002, 0.002, 0, 1),
    safe(p.rainStallTime ?? 8, 8, 0.2, 30),
    MIN_TRANSPORT_SPEED,
  ];
}
export function runoffUniforms(p = {}) {
  return [
    safe(p.runoffLifetime, 600, 10, 1800),
    safe(p.runoffEvaporation, 0.001, 0, 0.02),
    safe(p.runoffHead, 0.35, 0, 2),
    0,
  ];
}
export const lifecycleGLSL = `
const float SETTLE_TICKS=${SETTLE_TICKS}.;
const float MIN_TRANSPORT_SPEED=${MIN_TRANSPORT_SPEED};
bool liquidAgent(float kind){return kind<2.5||kind>4.5;}
float agentLife(float kind,float rainLife){return kind<.5?rainLife:kind==2.?20.:kind==4.?15.:12.;}
// Deposition composition MUST match in event, scatter and cargo feedback.
vec4 depositFractions(vec4 cargo,bool settling){vec4 supply=cargo*(settling?vec4(1,1,1,0):vec4(.4,.07,1,0));return supply/max(dot(supply,vec4(1)),1e-12);}
`;
