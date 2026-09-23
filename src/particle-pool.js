// Keep 64 columns so existing particle IDs remain stable; extend rows only.
export const MAX_PARTICLES = 16384; // user-selected sediment carriers
export const RAIN_PARTICLES = 2048;
export const RAIN_START = MAX_PARTICLES;
export const TOTAL_PARTICLE_SLOTS = MAX_PARTICLES + RAIN_PARTICLES;
export const PARTICLE_SIZE = [64, TOTAL_PARTICLE_SLOTS / 64];
export const DEFAULT_WORLD_PARTICLES = 4096;
// Hydraulic authoring uses the existing real carrier pool, not extra sprites.
export const DEFAULT_HYDRAULIC_PARTICLES = 1024;
export const MAX_HYDRAULIC_PARTICLES = MAX_PARTICLES;
export function hydraulicParticleCount(value) {
  return Number.isFinite(Number(value))
    ? particleCount(value)
    : DEFAULT_HYDRAULIC_PARTICLES;
}
export const MAX_VISIBLE_CARRIERS = 4096;
export const MAX_VISIBLE_PARTICLES = MAX_VISIBLE_CARRIERS + RAIN_PARTICLES;
export function particleCount(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(MAX_PARTICLES, Math.floor(n)))
    : DEFAULT_WORLD_PARTICLES;
}
export function particleDrawPlan(count, budget = MAX_VISIBLE_CARRIERS) {
  count = particleCount(count);
  const stride = Math.ceil(
    count / Math.max(1, Math.min(MAX_VISIBLE_CARRIERS, budget)),
  );
  return { stride, count: Math.ceil(count / stride) };
}
