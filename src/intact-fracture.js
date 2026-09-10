import { SIZE, MIN, CELL } from "./field.js";
import {
  regionDistance,
  MAX_CELL_SITES,
  MAX_PAINT_STAMPS,
} from "./cell-fracture.js";
import { selectConnectedChunk } from "./fractures.js";

function nearest(p, sites) {
  let best = Infinity,
    index = -1;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i],
      d = (p[0] - s[0]) ** 2 + (p[1] - s[1]) ** 2 + (p[2] - s[2]) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return index;
}
// Labels are a selection constraint, NOT a subtraction field. Even touching
// cells can be selected independently without carving a voxel-wide gap first.
// Read the current GPU volume only for an explicit click, in the worker.
export function selectIntactCell(
  volume,
  point,
  pattern,
  size = SIZE,
  min = MIN,
  cell = CELL,
) {
  if (
    !pattern?.intact ||
    !Array.isArray(pattern.sites) ||
    pattern.sites.length < 2 ||
    pattern.sites.length > MAX_CELL_SITES ||
    !Array.isArray(pattern.brushes) ||
    !pattern.brushes.length ||
    pattern.brushes.length > MAX_PAINT_STAMPS
  )
    throw new Error("Mark an intact crack map before selecting pieces.");
  if (
    !point ||
    point.length !== 3 ||
    !point.every(Number.isFinite) ||
    !(volume instanceof Float32Array) ||
    volume.length !== size[0] * size[1] * size[2] * 4 ||
    pattern.sites.some(
      (s) => !Array.isArray(s) || s.length !== 3 || !s.every(Number.isFinite),
    ) ||
    pattern.brushes.some(
      (b) =>
        !b ||
        !b.a ||
        !b.b ||
        b.a.length !== 3 ||
        b.b.length !== 3 ||
        ![...b.a, ...b.b, b.radius].every(Number.isFinite) ||
        b.radius <= 0,
    )
  )
    throw new Error("Invalid intact fracture selection.");
  if (regionDistance(point, pattern.brushes) > 0)
    throw new Error(
      "Click inside the marked crack region. Unpainted rock is not a piece.",
    );
  const cellId = nearest(point, pattern.sites),
    eligible = new Uint8Array(size[0] * size[1] * size[2]);
  const [nx, ny, nz] = size;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = (z * ny + y) * nx + x;
        if (volume[i * 4] >= 0 && volume[i * 4 + 3] <= 0) continue;
        const p = [
          min[0] + (x + 0.5) * cell[0],
          min[1] + (y + 0.5) * cell[1],
          min[2] + (z + 0.5) * cell[2],
        ];
        if (
          regionDistance(p, pattern.brushes) <= 0 &&
          nearest(p, pattern.sites) === cellId
        )
          eligible[i] = 1;
      }
  // Restrict flood fill to this label. Separate islands within the same
  // Voronoi cell are NOT silently selected together. The shared fringe rule
  // also protects neighbouring cells' partial surface occupancy.
  return {
    ...selectConnectedChunk(volume, point, size, min, cell, eligible),
    cellId,
    kind: "intact",
  };
}
