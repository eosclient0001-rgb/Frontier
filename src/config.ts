/**
 * Grid + world configuration.
 *
 * VOLUME FORMAT — rgba16float, chosen deliberately:
 *   WebGPU's core storage-texture formats are a short list, and of the
 *   single-channel ones only r32float qualifies — but r32float is NOT
 *   filterable without the optional `float32-filterable` feature, so a linear
 *   sampler on it fails on a lot of hardware. rgba16float is the one format
 *   that is simultaneously core-storage-capable AND filterable everywhere,
 *   and it hands us three extra channels for free:
 *
 *     .r = signed distance to the rock surface, in metres
 *     .g = loose sediment / regolith thickness at this voxel
 *     .b = accumulated weathering damage (drives surface colour + roughness)
 *     .a = water saturation (wet rock renders darker, as it does in reality)
 *
 *   Half-float precision is ideal for an SDF: the error is proportional to the
 *   magnitude, so it is tiny exactly where it matters — near the zero crossing.
 */

export interface GridConfig {
  volX: number; volY: number; volZ: number;
  worldW: number; worldH: number; worldD: number;
}

export const RESOLUTIONS: Record<string, GridConfig> = {
  // World stays the same physical size; only the sampling changes.
  Low:    { volX: 144, volY: 88,  volZ: 144, worldW: 512, worldH: 288, worldD: 512 },
  Medium: { volX: 208, volY: 120, volZ: 208, worldW: 512, worldH: 288, worldD: 512 },
  High:   { volX: 272, volY: 152, volZ: 272, worldW: 512, worldH: 288, worldD: 512 },
  Ultra:  { volX: 336, volY: 184, volZ: 336, worldW: 512, worldH: 288, worldD: 512 },
};

export const DEFAULT_RESOLUTION = 'Medium';

/** The hydraulic grid is 1:1 with the volume's XZ footprint, so a sim cell
 *  maps to exactly one voxel column and the coupling needs no resampling. */
export function simDims(g: GridConfig) {
  return { simX: g.volX, simZ: g.volZ };
}

export function volumeBytes(g: GridConfig): number {
  return g.volX * g.volY * g.volZ * 8; // rgba16float
}

/** WGSL `const` preamble injected ahead of every shader. */
export function constantsWGSL(g: GridConfig): string {
  const { simX, simZ } = simDims(g);
  return [
    '// --- injected from src/config.ts ---',
    `const VOLX: i32 = ${g.volX};`,
    `const VOLY: i32 = ${g.volY};`,
    `const VOLZ: i32 = ${g.volZ};`,
    `const SIMX: i32 = ${simX};`,
    `const SIMZ: i32 = ${simZ};`,
    `const WORLD_W: f32 = ${g.worldW.toFixed(1)};`,
    `const WORLD_H: f32 = ${g.worldH.toFixed(1)};`,
    `const WORLD_D: f32 = ${g.worldD.toFixed(1)};`,
    '',
  ].join('\n');
}
