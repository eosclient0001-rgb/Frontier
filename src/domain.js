// One XYZ domain for generation, GPU simulation, picking, editing and export.
// Coordinates and velocities are metres and metres/second, never patch-local.
export const SIZE = [128, 80, 128];
export const MIN = [-16, -8, -16],
  MAX = [16, 16, 16];
export const CELL = SIZE.map((n, i) => (MAX[i] - MIN[i]) / n);
export const EDIT_MIN = [...MIN],
  EDIT_MAX = [...MAX];
export let BAND = 0.24,
  SCENE_SCALE = 1;
export const ATLAS_COLS = 16;
export const ATLAS_SIZE = [
  SIZE[0] * ATLAS_COLS,
  SIZE[1] * Math.ceil(SIZE[2] / ATLAS_COLS),
];
export function terrainDomain(p = {}) {
  const world = p.worldEnabled && p.preset !== 3;
  const width = Number(p.terrainWidth ?? 1000),
    length = Number(p.terrainLength ?? 1000),
    height = Number(p.terrainHeight ?? 240),
    amplitude = Number(p.terrainAmplitude ?? 45);
  if (world && ![width, length, height, amplitude].every(Number.isFinite))
    throw new Error("Terrain dimensions must be finite.");
  if (world && (width <= 0 || length <= 0 || height <= 0 || amplitude < 0))
    throw new Error("Terrain dimensions must be positive.");
  const margin = world ? Math.max(2, Math.max(width, length) * 0.016) : 0;
  const min = world
    ? [-width / 2 - margin, -Math.max(8, height * 0.1), -length / 2 - margin]
    : [-16, -8, -16];
  const max = world
    ? [width / 2 + margin, height + amplitude + margin, length / 2 + margin]
    : [16, 16, 16];
  const cell = SIZE.map((n, i) => (max[i] - min[i]) / n);
  const scale = Math.max(1, Math.min(...cell) / 0.25);
  return {
    min,
    max,
    cell,
    scale,
    band: world ? Math.max(...cell) * 0.95 : 0.24,
    voxelVolume: cell.reduce((a, b) => a * b, 1),
    world: !!world,
  };
}
export function configureDomain(p = {}) {
  const d = terrainDomain(p);
  MIN.splice(0, 3, ...d.min);
  MAX.splice(0, 3, ...d.max);
  CELL.splice(0, 3, ...d.cell);
  BAND = d.band;
  SCENE_SCALE = d.scale;
  // No inner blue-box editing restriction; only the actual volume boundary.
  EDIT_MIN.splice(0, 3, ...d.min.map((v, i) => v + d.cell[i] * 0.5));
  EDIT_MAX.splice(0, 3, ...d.max.map((v, i) => v - d.cell[i] * 0.5));
  return d;
}
export function currentDomain() {
  return {
    min: [...MIN],
    max: [...MAX],
    cell: [...CELL],
    scale: SCENE_SCALE,
    band: BAND,
    voxelVolume: CELL.reduce((a, b) => a * b, 1),
  };
}
export function domainUniforms(d = currentDomain()) {
  return {
    LO: d.min,
    HI: d.max,
    CELL: d.cell,
    BAND: d.band,
    VOXEL_VOLUME: d.voxelVolume,
    sceneScale: d.scale,
    // Runtime loop bounds discourage native drivers from duplicating the large
    // refined SDF body. These are implementation constants, not quality knobs.
    shaderLoopLimits: [256, 8, 3],
  };
}
export function uploadDomainUniforms(gl, program, d) {
  for (const [name, value] of Object.entries(domainUniforms(d))) {
    const loc = gl.getUniformLocation(program, name);
    if (Array.isArray(value)) gl.uniform3fv(loc, value);
    else gl.uniform1f(loc, value);
  }
}
export const domainGLSL = `
#ifndef TERRAIN_DOMAIN
#define TERRAIN_DOMAIN
uniform vec3 LO,HI,CELL;
uniform vec3 shaderLoopLimits;
uniform float BAND,VOXEL_VOLUME,sceneScale;
#endif
`;
export const glslVec = (a) =>
  `vec3(${a.map((v) => Number(v).toFixed(8)).join(",")})`;
export const insideDetail = (p, margin = 0) =>
  p.every((v, i) => v >= MIN[i] + margin && v <= MAX[i] - margin);
export const footprintLimits = (d = currentDomain()) => [
  Math.max(0.38, Math.min(...d.cell) * 0.95),
  Math.max(0.95, Math.min(...d.cell) * 3.8),
];

export const fractureScale = () => Math.max(1, Math.max(...CELL) / 0.5);
