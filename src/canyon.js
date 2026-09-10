// Shared artist parameters. Width is the nominal gap before procedural erosion
// pockets/noise; the terrain remains a bounded XYZ SDF, not a heightfield.
export const canyonDefaults = {
  canyonWidth: 6.1,
  canyonMeander: 1,
  canyonFlare: 0.105,
};
export function canyonCenter(z, p = {}) {
  return (
    (p.canyonMeander ?? 1) * (2.5 * Math.sin(z * 0.15) + Math.sin(z * 0.36 + 1))
  );
}
export function canyonTangent(z, p = {}) {
  return (
    (p.canyonMeander ?? 1) *
    (0.375 * Math.cos(z * 0.15) + 0.36 * Math.cos(z * 0.36 + 1))
  );
}
export function canyonBaseHalfWidth(y, p = {}) {
  return (
    (p.canyonWidth ?? 6.1) * 0.5 + Math.max(y, 0) * (p.canyonFlare ?? 0.105)
  );
}
