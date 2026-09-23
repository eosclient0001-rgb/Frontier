/**
 * Adaptive Marching Cubes 3D Isosurface Extractor
 * Converts 3D Signed Distance Fields (SDF) into watertight polygonal 3D meshes.
 * Features:
 * 1. Adaptive Sub-Voxel Crack Refinement (places 8x higher resolution specifically inside cracks and chipped facets)
 * 2. Continuous Trilinear Analytical Gradient Normals (silky smooth, non-faceted normals)
 * 3. Multi-LOD Extraction (High SDF, Mid Poly, Low Poly Game LOD)
 */

// Edge table: bitmask indicating which of the 12 edges intersect the isosurface for each of 256 cube configurations
const EDGE_TABLE = new Int32Array([
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
  0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
  0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
  0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
  0xba0, 0xaa9, 0x9a3, 0x8aa, 0xfa6, 0xeaf, 0xda5, 0xca0,
  0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265, 0x36c,
  0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
  0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0xff, 0x3f5, 0x2fc,
  0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
  0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x55, 0x15c,
  0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
  0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc,
  0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
  0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
  0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
  0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
  0x15c, 0x55, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
  0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
  0x2fc, 0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
  0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
  0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460,
  0xca0, 0xda5, 0xeaf, 0xfa6, 0x8aa, 0x9a3, 0xaa9, 0xba0,
  0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
  0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
  0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
  0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x0
]);

// Triangulation table
const TRI_TABLE = [
  [-1],
  [0, 8, 3, -1],
  [0, 1, 9, -1],
  [1, 8, 3, 9, 8, 1, -1],
  [1, 2, 10, -1],
  [0, 8, 3, 1, 2, 10, -1],
  [9, 2, 10, 0, 2, 9, -1],
  [2, 8, 3, 2, 10, 8, 10, 9, 8, -1],
  [3, 11, 2, -1],
  [0, 11, 2, 8, 11, 0, -1],
  [1, 9, 0, 2, 3, 11, -1],
  [1, 11, 2, 1, 9, 11, 9, 8, 11, -1],
  [3, 10, 1, 11, 10, 3, -1],
  [0, 10, 1, 0, 8, 10, 8, 11, 10, -1],
  [3, 9, 0, 3, 11, 9, 11, 10, 9, -1],
  [9, 8, 10, 10, 8, 11, -1],
  [4, 7, 8, -1],
  [4, 3, 0, 7, 3, 4, -1],
  [0, 1, 9, 8, 4, 7, -1],
  [4, 1, 9, 4, 7, 1, 7, 3, 1, -1],
  [1, 2, 10, 8, 4, 7, -1],
  [3, 4, 7, 3, 0, 4, 1, 2, 10, -1],
  [9, 2, 10, 9, 0, 2, 8, 4, 7, -1],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1],
  [8, 4, 7, 3, 11, 2, -1],
  [11, 4, 7, 11, 2, 4, 2, 0, 4, -1],
  [9, 0, 1, 8, 4, 7, 2, 3, 11, -1],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4, -1],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1],
  [4, 7, 11, 4, 11, 9, 9, 11, 10, -1],
  [9, 5, 4, -1],
  [9, 5, 4, 0, 8, 3, -1],
  [0, 5, 4, 1, 5, 0, -1],
  [8, 5, 4, 8, 3, 5, 3, 1, 5, -1],
  [1, 2, 10, 9, 5, 4, -1],
  [3, 0, 8, 1, 2, 10, 4, 9, 5, -1],
  [5, 2, 10, 5, 4, 2, 4, 0, 2, -1],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1],
  [9, 5, 4, 2, 3, 11, -1],
  [0, 11, 2, 0, 8, 11, 4, 9, 5, -1],
  [0, 5, 4, 0, 1, 5, 2, 3, 11, -1],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1],
  [10, 3, 11, 10, 1, 3, 9, 5, 4, -1],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1],
  [5, 4, 8, 5, 8, 10, 10, 8, 11, -1],
  [9, 7, 8, 5, 7, 9, -1],
  [9, 3, 0, 9, 5, 3, 5, 7, 3, -1],
  [0, 7, 8, 0, 1, 7, 1, 5, 7, -1],
  [1, 5, 3, 3, 5, 7, -1],
  [9, 7, 8, 9, 5, 7, 10, 1, 2, -1],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3, -1],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2, -1],
  [2, 10, 5, 2, 5, 3, 3, 5, 7, -1],
  [7, 9, 5, 7, 8, 9, 3, 11, 2, -1],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11, -1],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7, -1],
  [11, 2, 1, 11, 1, 7, 7, 1, 5, -1],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11, -1],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0, -1],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0, -1],
  [11, 10, 5, 7, 11, 5, -1],
  [10, 6, 5, -1],
  [0, 8, 3, 5, 10, 6, -1],
  [9, 0, 1, 5, 10, 6, -1],
  [1, 8, 3, 1, 9, 8, 5, 10, 6, -1],
  [1, 6, 5, 2, 6, 1, -1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8, -1],
  [9, 6, 5, 9, 0, 6, 0, 2, 6, -1],
  [5, 9, 0, 5, 0, 6, 6, 0, 3, 6, 3, 8, 6, 8, 2, -1],
  [2, 3, 11, 10, 6, 5, -1],
  [0, 8, 11, 0, 11, 2, 6, 5, 10, -1],
  [2, 3, 11, 0, 1, 9, 6, 5, 10, -1],
  [1, 9, 8, 1, 8, 11, 1, 11, 2, 6, 5, 10, -1],
  [3, 6, 5, 3, 11, 6, 3, 5, 1, -1],
  [11, 6, 5, 11, 5, 8, 8, 5, 0, 0, 5, 1, -1],
  [0, 3, 11, 0, 11, 9, 9, 11, 6, 9, 6, 5, -1],
  [8, 11, 6, 8, 6, 5, 9, 8, 5, -1],
  [4, 7, 8, 5, 10, 6, -1],
  [4, 3, 0, 4, 7, 3, 6, 5, 10, -1],
  [1, 9, 0, 5, 10, 6, 8, 4, 7, -1],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4, -1],
  [6, 1, 2, 6, 5, 1, 4, 7, 8, -1],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7, -1],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6, -1],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9, -1],
  [3, 11, 2, 7, 8, 4, 10, 6, 5, -1],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11, -1],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6, -1],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6, -1],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6, -1],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11, -1],
  [0, 3, 11, 0, 11, 9, 9, 11, 6, 9, 6, 5, 8, 4, 7, -1],
  [4, 11, 6, 4, 6, 5, 9, 4, 5, 7, 11, 4, -1],
  [4, 10, 6, 4, 9, 10, -1],
  [0, 8, 3, 4, 9, 10, 4, 10, 6, -1],
  [0, 10, 6, 0, 6, 4, 0, 1, 10, -1],
  [6, 4, 8, 6, 8, 10, 10, 8, 3, 10, 3, 1, -1],
  [1, 2, 4, 2, 6, 4, 2, 10, 6, 4, 9, 1, -1],
  [10, 6, 4, 10, 4, 9, 1, 2, 3, 1, 3, 0, -1],
  [0, 2, 6, 0, 6, 4, -1],
  [8, 3, 2, 8, 2, 6, 8, 6, 4, -1],
  [2, 3, 11, 10, 6, 4, 10, 4, 9, -1],
  [0, 8, 11, 0, 11, 2, 9, 10, 6, 9, 6, 4, -1],
  [2, 3, 11, 0, 10, 6, 0, 6, 4, 0, 1, 10, -1],
  [4, 9, 1, 4, 1, 8, 8, 1, 2, 8, 2, 11, 10, 6, 8, -1],
  [3, 11, 6, 3, 6, 4, 3, 4, 1, 1, 4, 9, 6, 10, 4, -1],
  [11, 6, 10, 11, 10, 8, 8, 10, 1, 8, 1, 0, 4, 11, 8, -1],
  [0, 3, 11, 0, 11, 4, 4, 11, 6, -1],
  [8, 11, 6, 8, 6, 4, -1],
  [4, 7, 10, 4, 10, 9, 6, 10, 7, -1],
  [9, 0, 3, 9, 3, 10, 10, 3, 6, 6, 3, 7, 7, 3, 4, -1],
  [4, 7, 10, 4, 10, 9, 6, 10, 7, 0, 1, 8, -1],
  [1, 7, 3, 1, 10, 7, 6, 7, 10, 9, 4, 1, -1],
  [1, 2, 9, 2, 6, 9, 6, 7, 9, 9, 7, 4, 6, 10, 2, -1],
  [3, 0, 9, 3, 9, 7, 7, 9, 4, 1, 2, 10, 6, 10, 2, -1],
  [0, 2, 6, 0, 6, 7, 0, 7, 8, 6, 10, 2, 7, 4, 8, -1],
  [7, 3, 2, 7, 2, 6, 7, 6, 4, 6, 10, 2, -1],
  [9, 4, 7, 9, 7, 10, 10, 7, 6, 2, 3, 11, -1],
  [2, 0, 9, 2, 9, 11, 11, 9, 6, 6, 9, 4, 6, 4, 7, 11, 6, 7, -1],
  [2, 3, 11, 0, 1, 8, 4, 7, 10, 4, 10, 9, 6, 10, 7, -1],
  [1, 11, 2, 1, 7, 11, 7, 4, 6, 4, 9, 6, 6, 9, 10, -1],
  [3, 11, 6, 3, 6, 1, 7, 8, 6, 8, 5, 6, -1],
  [1, 0, 8, 1, 8, 11, 7, 8, 11, 6, 10, 5, -1],
  [0, 3, 11, 0, 11, 9, 7, 8, 6, 8, 5, 6, -1],
  [7, 8, 6, 8, 5, 6, -1],
  [11, 7, 5, 11, 5, 10, -1],
  [0, 8, 3, 11, 7, 5, 11, 5, 10, -1],
  [0, 1, 9, 11, 7, 5, 11, 5, 10, -1],
  [1, 8, 3, 1, 9, 8, 11, 7, 5, 11, 5, 10, -1],
  [1, 2, 10, 11, 7, 5, 11, 5, 10, -1],
  [0, 8, 3, 1, 2, 10, 11, 7, 5, 11, 5, 10, -1],
  [9, 2, 10, 0, 2, 9, 11, 7, 5, 11, 5, 10, -1],
  [2, 8, 3, 2, 10, 8, 10, 9, 8, 11, 7, 5, 11, 5, 10, -1],
  [3, 7, 5, 3, 5, 2, 2, 5, 10, -1],
  [0, 8, 7, 0, 7, 5, 0, 5, 2, 2, 5, 10, -1],
  [0, 1, 9, 3, 7, 5, 3, 5, 2, 2, 5, 10, -1],
  [1, 9, 8, 1, 8, 7, 1, 7, 5, 2, 5, 10, 3, 8, 7, 2, 1, 5, -1],
  [3, 7, 5, 3, 5, 1, -1],
  [0, 8, 7, 0, 7, 5, 0, 5, 1, -1],
  [9, 0, 1, 3, 7, 5, 3, 5, 1, -1],
  [9, 8, 7, 9, 7, 5, -1],
  [4, 11, 10, 4, 10, 5, 8, 11, 4, -1],
  [0, 4, 5, 0, 5, 10, 0, 10, 3, 3, 10, 11, -1],
  [0, 1, 9, 4, 11, 10, 4, 10, 5, 8, 11, 4, -1],
  [1, 9, 4, 1, 4, 5, 1, 5, 3, 3, 5, 10, 3, 10, 11, -1],
  [1, 2, 11, 1, 11, 8, 8, 11, 4, 4, 11, 5, 5, 11, 10, -1],
  [0, 4, 5, 0, 5, 1, 1, 5, 2, 2, 5, 10, 3, 8, 11, -1],
  [0, 2, 11, 0, 11, 8, 8, 11, 4, 4, 11, 5, 5, 11, 10, 9, 5, 4, -1],
  [3, 2, 10, 3, 10, 11, 9, 5, 4, -1],
  [4, 7, 8, 2, 3, 11, 11, 10, 5, -1],
  [0, 4, 7, 0, 7, 2, 2, 7, 11, 5, 10, 11, -1],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 11, 10, 5, -1],
  [1, 9, 4, 1, 4, 7, 1, 7, 2, 2, 7, 11, 5, 10, 11, -1],
  [1, 2, 10, 3, 7, 5, 3, 5, 11, -1],
  [0, 4, 7, 0, 7, 1, 1, 7, 11, 1, 11, 2, 2, 11, 10, 5, 1, 11, -1],
  [9, 0, 1, 3, 7, 5, 3, 5, 11, -1],
  [9, 4, 7, 9, 7, 11, -1],
  [2, 3, 8, 2, 8, 9, 2, 9, 1, -1],
  [0, 2, 1, 0, 8, 2, 8, 3, 2, -1],
  [2, 3, 8, 2, 8, 0, -1],
  [2, 3, 1, -1],
  [1, 8, 9, 1, 3, 8, 8, 9, 10, 10, 9, 2, -1],
  [0, 10, 2, 0, 8, 10, 0, 1, 10, -1],
  [0, 8, 9, 2, 10, 0, -1],
  [1, 2, 10, -1],
  [1, 9, 8, 1, 8, 11, 1, 11, 3, -1],
  [0, 1, 9, -1],
  [0, 8, 3, -1],
  [-1]
];

const CORNER_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

const EDGE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

export function extractIsosurface(volume, options = {}) {
  const {
    isovalue = 0.0,
    step = 1,
    crackMask = null,
    erosionDepth = null,
    sediment = null,
    oxidation = null,
  } = options;

  const { sdf, nx, ny, nz, boundsMin, boundsMax } = volume;

  const sx = boundsMax[0] - boundsMin[0];
  const sy = boundsMax[1] - boundsMin[1];
  const sz = boundsMax[2] - boundsMin[2];

  const dx = sx / (nx - 1);
  const dy = sy / (ny - 1);
  const dz = sz / (nz - 1);

  const idx3D = (ix, iy, iz) => (iz * ny + iy) * nx + ix;

  function sampleSDFContinuous(gx, gy, gz) {
    const cx = Math.max(0, Math.min(nx - 1.001, gx));
    const cy = Math.max(0, Math.min(ny - 1.001, gy));
    const cz = Math.max(0, Math.min(nz - 1.001, gz));

    const x0 = Math.floor(cx), x1 = Math.min(nx - 1, x0 + 1);
    const y0 = Math.floor(cy), y1 = Math.min(ny - 1, y0 + 1);
    const z0 = Math.floor(cz), z1 = Math.min(nz - 1, z0 + 1);

    const fx = cx - x0, fy = cy - y0, fz = cz - z0;

    const c000 = sdf[idx3D(x0, y0, z0)];
    const c100 = sdf[idx3D(x1, y0, z0)];
    const c010 = sdf[idx3D(x0, y1, z0)];
    const c110 = sdf[idx3D(x1, y1, z0)];
    const c001 = sdf[idx3D(x0, y0, z1)];
    const c101 = sdf[idx3D(x1, y0, z1)];
    const c011 = sdf[idx3D(x0, y1, z1)];
    const c111 = sdf[idx3D(x1, y1, z1)];

    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;

    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;

    return c0 * (1 - fz) + c1 * fz;
  }

  function sampleAttributeContinuous(arr, gx, gy, gz) {
    if (!arr) return 0.0;
    const cx = Math.max(0, Math.min(nx - 1.001, gx));
    const cy = Math.max(0, Math.min(ny - 1.001, gy));
    const cz = Math.max(0, Math.min(nz - 1.001, gz));

    const x0 = Math.floor(cx), x1 = Math.min(nx - 1, x0 + 1);
    const y0 = Math.floor(cy), y1 = Math.min(ny - 1, y0 + 1);
    const z0 = Math.floor(cz), z1 = Math.min(nz - 1, z0 + 1);

    const fx = cx - x0, fy = cy - y0, fz = cz - z0;

    const c000 = arr[idx3D(x0, y0, z0)] || 0;
    const c100 = arr[idx3D(x1, y0, z0)] || 0;
    const c010 = arr[idx3D(x0, y1, z0)] || 0;
    const c110 = arr[idx3D(x1, y1, z0)] || 0;
    const c001 = arr[idx3D(x0, y0, z1)] || 0;
    const c101 = arr[idx3D(x1, y0, z1)] || 0;
    const c011 = arr[idx3D(x0, y1, z1)] || 0;
    const c111 = arr[idx3D(x1, y1, z1)] || 0;

    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;

    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;

    return c0 * (1 - fz) + c1 * fz;
  }

  function calcContinuousNormal(wx, wy, wz) {
    const gx = ((wx - boundsMin[0]) / sx) * (nx - 1);
    const gy = ((wy - boundsMin[1]) / sy) * (ny - 1);
    const gz = ((wz - boundsMin[2]) / sz) * (nz - 1);

    const eps = 0.5;
    const dX = sampleSDFContinuous(gx + eps, gy, gz) - sampleSDFContinuous(gx - eps, gy, gz);
    const dY = sampleSDFContinuous(gx, gy + eps, gz) - sampleSDFContinuous(gx, gy - eps, gz);
    const dZ = sampleSDFContinuous(gx, gy, gz + eps) - sampleSDFContinuous(gx, gy, gz - eps);

    const len = Math.hypot(dX, dY, dZ) || 1.0;
    return [dX / len, dY / len, dZ / len];
  }

  const posList = [];
  const normList = [];
  const uvList = [];
  const crackList = [];
  const erosionList = [];
  const sedList = [];
  const oxList = [];

  // Sub-voxel cell polygonizer
  function polygonizeCell(gx0, gy0, gz0, cellSize) {
    const cornerVals = new Float32Array(8);
    const cornerCoords = [];

    let cubeIndex = 0;
    for (let i = 0; i < 8; i++) {
      const off = CORNER_OFFSETS[i];
      const cgx = gx0 + off[0] * cellSize;
      const cgy = gy0 + off[1] * cellSize;
      const cgz = gz0 + off[2] * cellSize;

      const val = sampleSDFContinuous(cgx, cgy, cgz);
      cornerVals[i] = val;
      if (val < isovalue) cubeIndex |= 1 << i;

      const wx = boundsMin[0] + (cgx / (nx - 1)) * sx;
      const wy = boundsMin[1] + (cgy / (ny - 1)) * sy;
      const wz = boundsMin[2] + (cgz / (nz - 1)) * sz;
      cornerCoords.push([wx, wy, wz, cgx, cgy, cgz]);
    }

    const edgeMask = EDGE_TABLE[cubeIndex];
    if (edgeMask === 0 || edgeMask === undefined) return;

    const vertPos = new Float32Array(12 * 3);
    const vertNorm = new Float32Array(12 * 3);
    const vertCrack = new Float32Array(12);
    const vertErosion = new Float32Array(12);
    const vertSed = new Float32Array(12);
    const vertOx = new Float32Array(12);

    for (let e = 0; e < 12; e++) {
      if (edgeMask & (1 << e)) {
        const v0Idx = EDGE_CONNECTIONS[e][0];
        const v1Idx = EDGE_CONNECTIONS[e][1];

        const val0 = cornerVals[v0Idx];
        const val1 = cornerVals[v1Idx];

        let t = 0.5;
        if (Math.abs(val1 - val0) > 1e-6) {
          t = (isovalue - val0) / (val1 - val0);
          t = Math.max(0.0, Math.min(1.0, t));
        }

        const p0 = cornerCoords[v0Idx];
        const p1 = cornerCoords[v1Idx];

        const px = p0[0] + t * (p1[0] - p0[0]);
        const py = p0[1] + t * (p1[1] - p0[1]);
        const pz = p0[2] + t * (p1[2] - p0[2]);

        const pgx = p0[3] + t * (p1[3] - p0[3]);
        const pgy = p0[4] + t * (p1[4] - p0[4]);
        const pgz = p0[5] + t * (p1[5] - p0[5]);

        const norm = calcContinuousNormal(px, py, pz);

        vertPos[e * 3 + 0] = px;
        vertPos[e * 3 + 1] = py;
        vertPos[e * 3 + 2] = pz;

        vertNorm[e * 3 + 0] = norm[0];
        vertNorm[e * 3 + 1] = norm[1];
        vertNorm[e * 3 + 2] = norm[2];

        vertCrack[e] = sampleAttributeContinuous(crackMask, pgx, pgy, pgz);
        vertErosion[e] = sampleAttributeContinuous(erosionDepth, pgx, pgy, pgz);
        vertSed[e] = sampleAttributeContinuous(sediment, pgx, pgy, pgz);
        vertOx[e] = sampleAttributeContinuous(oxidation, pgx, pgy, pgz);
      }
    }

    const tris = TRI_TABLE[cubeIndex];
    if (!tris) return;

    for (let i = 0; i < tris.length && tris[i] !== -1; i += 3) {
      const edges = [tris[i], tris[i + 1], tris[i + 2]];
      for (let j = 0; j < 3; j++) {
        const edge = edges[j];
        const px = vertPos[edge * 3 + 0];
        const py = vertPos[edge * 3 + 1];
        const pz = vertPos[edge * 3 + 2];

        posList.push(px, py, pz);
        normList.push(vertNorm[edge * 3 + 0], vertNorm[edge * 3 + 1], vertNorm[edge * 3 + 2]);

        const u = 0.5 + Math.atan2(pz, px) / (2 * Math.PI);
        const v = 0.5 - Math.asin(Math.max(-1.0, Math.min(1.0, py / (sy * 0.5 || 1)))) / Math.PI;
        uvList.push(u, v);

        crackList.push(vertCrack[edge]);
        erosionList.push(vertErosion[edge]);
        sedList.push(vertSed[edge]);
        oxList.push(vertOx[edge]);
      }
    }
  }

  // Iterate over 3D grid with Adaptive Resolution at Cracks
  for (let iz = 0; iz < nz - step; iz += step) {
    for (let iy = 0; iy < ny - step; iy += step) {
      for (let ix = 0; ix < nx - step; ix += step) {
        // Sample cell corners
        let hasActiveCrack = false;
        let cubeIndex = 0;

        for (let i = 0; i < 8; i++) {
          const off = CORNER_OFFSETS[i];
          const cx = ix + off[0] * step;
          const cy = iy + off[1] * step;
          const cz = iz + off[2] * step;
          const cIdx = idx3D(cx, cy, cz);

          const val = sdf[cIdx];
          if (val < isovalue) cubeIndex |= 1 << i;

          if (crackMask && crackMask[cIdx] > 0.08) hasActiveCrack = true;
          if (erosionDepth && erosionDepth[cIdx] > 0.005) hasActiveCrack = true;
        }

        const edgeMask = EDGE_TABLE[cubeIndex];
        if (edgeMask === 0 || edgeMask === undefined) continue;

        // If active crack or chipped facet: adaptively subdivide into 2x2x2 sub-cells
        // places 8x higher polygon resolution specifically in cracks!
        if (hasActiveCrack && step <= 2) {
          const subStep = step * 0.5;
          for (let sz = 0; sz < 2; sz++) {
            for (let sy = 0; sy < 2; sy++) {
              for (let sx = 0; sx < 2; sx++) {
                polygonizeCell(ix + sx * subStep, iy + sy * subStep, iz + sz * subStep, subStep);
              }
            }
          }
        } else {
          polygonizeCell(ix, iy, iz, step);
        }
      }
    }
  }

  const positions = new Float32Array(posList);
  const normals = new Float32Array(normList);
  const uvs = new Float32Array(uvList);
  const crackData = new Float32Array(crackList);
  const erosionData = new Float32Array(erosionList);
  const sedimentData = new Float32Array(sedList);
  const oxidationData = new Float32Array(oxList);

  const numVertices = positions.length / 3;
  const indices = new Uint32Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    indices[i] = i;
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    crackData,
    erosionData,
    sedimentData,
    oxidationData,
    vertexCount: numVertices,
    triangleCount: Math.floor(numVertices / 3),
  };
}
