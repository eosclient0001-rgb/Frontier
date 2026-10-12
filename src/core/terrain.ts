// Terrain: a flat city core, rolling countryside and one meandering river.
// The analytic function is sampled once onto a regular grid. Roads and the terrain mesh both read the
// bilinear grid, so road surfaces never sink into or float above the ground between mesh vertices.

import { fbm, P2, smoothstep } from "./math";

export const MAP_HALF_EXTENT = 2000; // [m] - Map spans -2000..2000 on X and Z (4 km square)
export const TERRAIN_CELL = 8; // [m] - Grid spacing of the height field
export const WATER_LEVEL = -2.4; // [m] - Y of the flat water plane
export const ROAD_SURFACE_OFFSET = 0.12; // [m] - Road surface sits this far above the terrain
export const CITY_CORE_RADIUS = 900; // [m] - Inside this radius the ground is levelled for the city
export const RIVER_HALF_WIDTH = 46; // [m] - Half width of the river channel at its banks
const TERRAIN_SEED = 4117;

// River centreline Z as a function of X. Runs south of the city core so every bridge is out in the open.
export function riverCenterZ(x: number): number {
  return -1080 + 150 * Math.sin(x / 880) + 55 * Math.sin(x / 290 + 1.3);
}

export function analyticHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rolling = fbm(x / 520, z / 520, TERRAIN_SEED, 4) * 13 + 3;
  const levelled = smoothstep(CITY_CORE_RADIUS - 60, CITY_CORE_RADIUS + 240, r);
  let h = rolling * levelled;

  const d = Math.abs(z - riverCenterZ(x));
  const channel = 1 - smoothstep(RIVER_HALF_WIDTH * 0.45, RIVER_HALF_WIDTH, d);
  h = h + (-5.2 - h) * channel;
  return h;
}

// Height field grid. Built lazily so tests and the editor share one instance.
class HeightField {
  readonly n: number; // cells per side
  readonly heights: Float32Array;
  readonly origin: number;

  constructor(halfExtent: number, cell: number) {
    this.n = Math.round((halfExtent * 2) / cell);
    this.origin = -halfExtent;
    this.heights = new Float32Array((this.n + 1) * (this.n + 1));
    for (let j = 0; j <= this.n; j++) {
      for (let i = 0; i <= this.n; i++) {
        const x = this.origin + i * cell;
        const z = this.origin + j * cell;
        this.heights[j * (this.n + 1) + i] = analyticHeight(x, z);
      }
    }
  }

  sample(x: number, z: number): number {
    const cell = (MAP_HALF_EXTENT * 2) / this.n;
    const fx = (x - this.origin) / cell;
    const fz = (z - this.origin) / cell;
    if (fx < 0 || fz < 0 || fx > this.n || fz > this.n) return analyticHeight(x, z);
    const i = Math.min(this.n - 1, Math.floor(fx));
    const j = Math.min(this.n - 1, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const w = this.n + 1;
    const h00 = this.heights[j * w + i];
    const h10 = this.heights[j * w + i + 1];
    const h01 = this.heights[(j + 1) * w + i];
    const h11 = this.heights[(j + 1) * w + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
}

let field: HeightField | null = null;

function getField(): HeightField {
  if (!field) field = new HeightField(MAP_HALF_EXTENT, TERRAIN_CELL);
  return field;
}

export function terrainHeight(x: number, z: number): number {
  return getField().sample(x, z);
}

export function terrainAt(p: P2): number {
  return terrainHeight(p.x, p.z);
}

// Road surface height for a given lift (metres above ground, negative = below ground).
export function surfaceHeight(p: P2, lift: number): number {
  return terrainHeight(p.x, p.z) + ROAD_SURFACE_OFFSET + lift;
}

export function isOverRiver(p: P2): boolean {
  return Math.abs(p.z - riverCenterZ(p.x)) < RIVER_HALF_WIDTH;
}

// Dense grid accessor for the terrain mesh builder.
export function terrainGrid(): { n: number; origin: number; cell: number; heights: Float32Array } {
  const f = getField();
  return { n: f.n, origin: f.origin, cell: (MAP_HALF_EXTENT * 2) / f.n, heights: f.heights };
}
