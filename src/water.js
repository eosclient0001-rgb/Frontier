export const waterDefaults = {
  waveHeight: 0.12,
  waveLength: 2.8,
  waveSpeed: 1.15,
  waterReflection: 0.65,
  foamAmount: 0.65,
  foamReach: 0.85,
  foamScale: 0.55,
  waterDirection: 25,
};
export function waterUniformValues(p = {}) {
  return {
    waterWaves: [
      p.waveHeight ?? 0.12,
      p.waveLength ?? 2.8,
      p.waveSpeed ?? 1.15,
      p.waterReflection ?? 0.65,
    ],
    waterFoam: [
      p.foamAmount ?? 0.65,
      p.foamReach ?? 0.85,
      p.foamScale ?? 0.55,
      p.riverEnabled === false ? 0 : (p.riverSpeed ?? 3.2),
    ],
    waterShape: [
      p.canyonWidth ?? 6.1,
      p.canyonMeander ?? 1,
      p.canyonFlare ?? 0.105,
      p.riverOffset ?? 0,
    ],
    waterMotion: [
      ((p.waterDirection ?? 25) * Math.PI) / 180,
      p.seed ?? 4821,
      0,
      0,
    ],
  };
}
// The sum of the four displacement weights is one. Bound very short, steep
// waves to keep the iterative surface intersection stable at this scene scale.
export function effectiveWaveHeight(height, length) {
  return Math.min(Math.max(0, height), Math.max(0.1, length) * 0.15);
}
