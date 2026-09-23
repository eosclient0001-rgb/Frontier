import { currentDomain } from "./domain.js";
import { PARTICLE_DT } from "./particle-lifecycle.js";
import { maxSolidChange } from "./hydraulic-transport.js";

// Preview acceleration is explicit, not more allocated particles or hidden dt
// inflation. Motion still integrates in <=10 ms increments (at most 32).
export const performanceDefaults = { timeLapse: 1, weatheringRate: 1 };
export const performancePresets = {
  reference: { timeLapse: 1, weatheringRate: 1, speed: 1 },
  fast: { timeLapse: 4, weatheringRate: 1, speed: 1 },
  rapid: { timeLapse: 8, weatheringRate: 1, speed: 1 },
};
const bounded = (x, f, lo, hi) =>
  Math.max(lo, Math.min(hi, Number.isFinite(Number(x)) ? Number(x) : f));
export function erosionTiming(p = {}, d = currentDomain()) {
  const requested = bounded(p.timeLapse, 1, 1, 8);
  // A macro exchange must not skip a full smallest-axis voxel at 12 m/s.
  // Fine modelling plots therefore run nearer the reference timestep.
  const dt = Math.min(
    PARTICLE_DT * requested,
    Math.max(PARTICLE_DT, Math.min(...d.cell) / 12),
  );
  return {
    dt,
    requested,
    effective: dt / PARTICLE_DT,
    substeps: Math.ceil(dt / 0.01 - 1e-6),
    exposure: bounded(p.weatheringRate, 1, 1, 64),
  };
}
export function acceleratedSolidChange(p = {}, d = currentDomain()) {
  const { dt, exposure } = erosionTiming(p, d);
  const base = maxSolidChange(p, dt, d.band, Math.min(...d.cell));
  const gridCap = (0.01 * Math.min(...d.cell)) / (2 * d.band);
  if ((p.sourceMode ?? 0) === 0) return Math.min(base, gridCap);
  return exposure === 1 ? base : Math.min(base * exposure, gridCap);
}

// Mirrors shader support bounds, useful for verifying the bounded amount of
// sampling work. Actual erosion/normalization remains entirely on the GPU.
export function kernelBounds(
  point,
  radius,
  d = currentDomain(),
  size = [128, 80, 128],
) {
  const support = d.cell.map((c) => Math.max(radius, c * 0.95));
  const lo = point.map((v, k) =>
    Math.max(0, Math.ceil((v - support[k] - d.min[k]) / d.cell[k] - 0.5)),
  );
  const hi = point.map((v, k) =>
    Math.min(
      size[k] - 1,
      Math.floor((v + support[k] - d.min[k]) / d.cell[k] - 0.5),
    ),
  );
  return {
    lo,
    hi,
    visits: lo.reduce((n, v, k) => n * Math.max(0, hi[k] - v + 1), 1),
  };
}
