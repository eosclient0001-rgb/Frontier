// Experimental distributed XYZ refinement. Physical spacing never follows world scale.
export const SPARSE_BRICK_SIDE = 8;
export const SPARSE_PROBES = 32;
export const SPARSE_DEFAULT_CELL = 0.25; // metres; NOT millimetre-resolved raindrops
export const SPARSE_DEFAULT_CAPACITY = 4096;
export const SPARSE_MAX_REQUESTS = 65536;
export function sparseLayout({ capacity = SPARSE_DEFAULT_CAPACITY, cell = SPARSE_DEFAULT_CELL } = {}) {
  if (!Number.isInteger(capacity) || capacity < 16 || capacity > 4096 || (capacity & (capacity - 1)))
    throw new Error('Sparse capacity must be a power of two between 16 and 4096.');
  if (!Number.isFinite(cell) || cell < 0.025 || cell > 1)
    throw new Error('Sparse cell spacing must be 0.025–1 metre.');
  const voxels = capacity * SPARSE_BRICK_SIDE ** 3;
  const width = Math.min(1024, 2 ** Math.ceil(Math.log2(Math.sqrt(voxels))));
  const keyWidth = Math.min(64, capacity);
  return Object.freeze({
    capacity, cell, brickSize: cell * SPARSE_BRICK_SIDE, band: cell * 0.95,
    voxels, width, height: voxels / width, keyWidth, keyHeight: capacity / keyWidth,
    // Two RGBA32F fields/keys, two R16F claims, fixed status/query storage.
    bytes: voxels * 16 * 2 + capacity * (16 * 2 + 2 * 2) + 256 * 256 * 16 + 32 * 32 * 16 * 2,
  });
}
export function sparseHash(key) {
  let x = (Math.imul(key[0], 73856093) ^ Math.imul(key[1], 19349663) ^ Math.imul(key[2], 83492791)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
export function sparseProbe(key, attempt, capacity) {
  const h = sparseHash(key), stride = (h >>> 16) | 1;
  return (h + Math.imul(attempt, stride)) & (capacity - 1);
}
export function sparseBrickKey(point, origin, cell = SPARSE_DEFAULT_CELL) {
  return point.map((v, i) => Math.floor((v - origin[i]) / (SPARSE_BRICK_SIDE * cell)));
}
export function sparseAddress(slot, local, layout) {
  const index = slot * 512 + (local[2] * 8 + local[1]) * 8 + local[0];
  return [index % layout.width, Math.floor(index / layout.width)];
}
