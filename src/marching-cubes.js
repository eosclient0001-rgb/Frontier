/**
 * Marching Cubes 3D Isosurface Extractor
 * Converts 3D Signed Distance Fields (SDF) into watertight polygonal 3D meshes.
 * Includes vertex gradient normal calculation, triplanar/spherical UVs, and attribute interpolation.
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

// Triangulation table: lists of triangle vertices for each of the 256 configurations (-1 terminated)
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
  [3, 11, 6, 3, 6, 1, 1, 6, 10, 4, 7, 8, 9, 4, 8, -1],
  [1, 0, 9, 1, 9, 11, 11, 9, 6, 6, 9, 4, 7, 11, 6, 7, 6, 4, -1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4, 7, 8, 11, -1],
  [6, 4, 7, 6, 7, 11, -1],
  [2, 6, 7, 2, 7, 3, -1],
  [0, 8, 6, 0, 6, 2, 6, 8, 7, -1],
  [2, 6, 7, 2, 7, 3, 0, 1, 9, -1],
  [6, 7, 8, 6, 8, 2, 2, 8, 9, 9, 8, 0, 9, 0, 1, -1],
  [1, 6, 7, 1, 7, 3, 1, 10, 6, -1],
  [0, 8, 6, 0, 6, 1, 1, 6, 10, 7, 8, 6, -1],
  [9, 0, 6, 9, 6, 7, 9, 7, 1, 1, 7, 3, 6, 10, 1, -1],
  [6, 7, 8, 6, 8, 9, 9, 8, 10, 10, 8, 3, 10, 3, 1, -1],
  [2, 6, 7, 2, 7, 11, -1],
  [0, 8, 11, 0, 11, 6, 0, 6, 2, 7, 11, 6, -1],
  [2, 6, 7, 2, 7, 11, 0, 1, 9, -1],
  [0, 1, 9, 8, 11, 6, 8, 6, 2, 7, 11, 6, -1],
  [3, 11, 6, 3, 6, 7, 1, 10, 6, 1, 6, 3, -1],
  [1, 0, 8, 1, 8, 10, 10, 8, 6, 6, 8, 11, 6, 11, 7, -1],
  [9, 0, 11, 9, 11, 6, 9, 6, 1, 1, 6, 10, 7, 11, 6, 3, 11, 0, -1],
  [10, 9, 8, 10, 8, 11, 6, 10, 11, 7, 6, 11, -1],
  [4, 2, 3, 4, 3, 8, 6, 2, 4, -1],
  [0, 4, 6, 0, 6, 2, -1],
  [1, 9, 0, 4, 2, 3, 4, 3, 8, 6, 2, 4, -1],
  [1, 9, 4, 1, 4, 6, 1, 6, 2, -1],
  [1, 8, 3, 1, 4, 8, 1, 10, 4, 6, 2, 4, 2, 10, 4, -1],
  [0, 4, 6, 0, 6, 1, 1, 6, 10, -1],
  [9, 0, 4, 9, 4, 6, 9, 6, 1, 1, 6, 10, 2, 6, 4, -1],
  [9, 4, 6, 9, 6, 10, 10, 6, 1, -1],
  [8, 4, 6, 8, 6, 2, 8, 2, 3, 11, 6, 2, -1],
  [0, 4, 6, 0, 6, 11, 0, 11, 2, 11, 6, 7, -1],
  [0, 1, 9, 8, 4, 6, 8, 6, 2, 8, 2, 3, 11, 6, 2, -1],
  [1, 9, 4, 1, 4, 6, 1, 6, 11, 1, 11, 2, 7, 11, 6, -1],
  [3, 11, 6, 3, 6, 2, 3, 2, 1, 1, 2, 10, 4, 8, 6, -1],
  [0, 4, 6, 0, 6, 11, 0, 11, 1, 1, 11, 10, 7, 11, 6, -1],
  [9, 0, 3, 9, 3, 11, 9, 11, 6, 9, 6, 4, 1, 10, 6, 1, 6, 4, -1],
  [9, 4, 6, 9, 6, 10, 11, 7, 6, -1],
  [5, 2, 3, 5, 3, 7, 6, 2, 5, -1],
  [0, 8, 6, 0, 6, 2, 7, 5, 6, 8, 7, 6, -1],
  [0, 1, 9, 5, 2, 3, 5, 3, 7, 6, 2, 5, -1],
  [1, 9, 8, 1, 8, 0, 6, 2, 5, 2, 3, 5, 3, 7, 5, -1],
  [1, 5, 7, 1, 7, 3, 6, 5, 1, -1],
  [0, 8, 6, 0, 6, 1, 7, 5, 6, 8, 7, 6, 5, 1, 6, -1],
  [9, 0, 1, 1, 5, 7, 1, 7, 3, 6, 5, 1, -1],
  [6, 5, 7, 8, 9, 0, 8, 0, 3, 9, 1, 0, -1],
  [2, 6, 5, 2, 5, 7, 2, 7, 11, -1],
  [0, 8, 11, 0, 11, 6, 0, 6, 2, 7, 5, 6, -1],
  [0, 1, 9, 2, 6, 5, 2, 5, 7, 2, 7, 11, -1],
  [0, 1, 9, 0, 8, 11, 0, 11, 6, 0, 6, 2, 7, 5, 6, -1],
  [1, 5, 7, 1, 7, 3, 3, 7, 11, 6, 5, 1, -1],
  [0, 8, 11, 0, 11, 1, 1, 11, 7, 1, 7, 5, 6, 5, 1, -1],
  [9, 0, 3, 9, 3, 11, 9, 11, 6, 9, 6, 1, 5, 7, 6, 1, 6, 7, -1],
  [9, 8, 11, 9, 11, 6, 9, 6, 5, 7, 11, 6, -1],
  [4, 2, 3, 4, 3, 7, 5, 2, 4, -1],
  [0, 8, 7, 0, 7, 4, 2, 0, 5, 0, 4, 5, -1],
  [0, 1, 9, 4, 2, 3, 4, 3, 7, 5, 2, 4, -1],
  [1, 9, 4, 1, 4, 5, 7, 3, 8, 3, 1, 8, 1, 5, 8, -1],
  [1, 4, 7, 1, 7, 3, 5, 4, 1, -1],
  [0, 8, 7, 0, 7, 4, 5, 1, 4, -1],
  [9, 0, 1, 1, 4, 7, 1, 7, 3, 5, 4, 1, -1],
  [9, 8, 3, 9, 3, 1, 5, 4, 7, -1],
  [4, 2, 11, 4, 11, 7, 5, 2, 4, -1],
  [0, 8, 11, 0, 11, 2, 5, 4, 7, -1],
  [0, 1, 9, 4, 2, 11, 4, 11, 7, 5, 2, 4, -1],
  [1, 9, 8, 1, 8, 11, 1, 11, 2, 5, 4, 7, -1],
  [1, 4, 7, 1, 7, 11, 1, 11, 3, 5, 4, 1, -1],
  [0, 8, 11, 0, 11, 1, 5, 4, 7, -1],
  [9, 0, 3, 9, 3, 11, 5, 4, 7, 1, 4, 9, 1, 9, 11, -1],
  [9, 8, 11, 5, 4, 7, -1],
  [4, 10, 6, 5, 10, 4, -1],
  [0, 8, 3, 4, 10, 6, 5, 10, 4, -1],
  [0, 1, 9, 4, 10, 6, 5, 10, 4, -1],
  [1, 8, 3, 1, 9, 8, 4, 10, 6, 5, 10, 4, -1],
  [1, 2, 6, 1, 6, 4, 1, 4, 5, -1],
  [0, 8, 3, 1, 2, 6, 1, 6, 4, 1, 4, 5, -1],
  [0, 2, 6, 0, 6, 4, 9, 5, 4, -1],
  [8, 3, 2, 8, 2, 6, 8, 6, 4, 9, 5, 4, -1],
  [2, 3, 11, 4, 10, 6, 5, 10, 4, -1],
  [0, 8, 11, 0, 11, 2, 4, 10, 6, 5, 10, 4, -1],
  [0, 1, 9, 2, 3, 11, 4, 10, 6, 5, 10, 4, -1],
  [1, 9, 8, 1, 8, 11, 1, 11, 2, 4, 10, 6, 5, 10, 4, -1],
  [3, 11, 6, 3, 6, 2, 3, 2, 1, 4, 5, 6, -1],
  [0, 8, 11, 0, 11, 1, 4, 5, 6, -1],
  [0, 3, 11, 0, 11, 9, 4, 5, 6, -1],
  [8, 11, 6, 8, 6, 4, 9, 5, 4, -1],
  [7, 8, 10, 7, 10, 6, 8, 5, 10, -1],
  [0, 7, 3, 0, 8, 7, 6, 10, 5, -1],
  [0, 1, 9, 7, 8, 10, 7, 10, 6, 8, 5, 10, -1],
  [1, 7, 3, 1, 9, 7, 6, 10, 5, 9, 8, 7, -1],
  [1, 2, 6, 1, 6, 8, 1, 8, 5, 7, 8, 6, -1],
  [0, 7, 3, 0, 1, 7, 6, 10, 5, 1, 2, 7, 2, 6, 7, -1],
  [0, 2, 6, 0, 6, 8, 7, 8, 6, 9, 5, 8, -1],
  [3, 2, 6, 3, 6, 7, 9, 5, 8, -1],
  [2, 3, 11, 7, 8, 10, 7, 10, 6, 8, 5, 10, -1],
  [0, 7, 11, 0, 8, 7, 0, 11, 2, 6, 10, 5, -1],
  [0, 1, 9, 2, 3, 11, 7, 8, 10, 7, 10, 6, 8, 5, 10, -1],
  [1, 9, 7, 1, 7, 2, 2, 7, 11, 6, 10, 5, 9, 8, 7, -1],
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

// Corner vertex offsets in local unit cube [0, 1]^3
const CORNER_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

// Edge connection table [v0, v1] for the 12 cube edges
const EDGE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

/**
 * Extracts a watertight isosurface mesh from a 3D SDF scalar field.
 * 
 * @param {Object} volume - SDF volume object or object containing scalar fields
 * @param {Float32Array} volume.sdf - 1D array of signed distance values (nx * ny * nz)
 * @param {number} volume.nx - X grid resolution
 * @param {number} volume.ny - Y grid resolution
 * @param {number} volume.nz - Z grid resolution
 * @param {Array<number>} volume.boundsMin - [minX, minY, minZ]
 * @param {Array<number>} volume.boundsMax - [maxX, maxY, maxZ]
 * @param {Object} [options] - Configuration options
 * @param {number} [options.isovalue=0.0] - Isosurface threshold
 * @param {number} [options.step=1] - Grid step (1 = high poly, 2 = mid poly, 3-4 = low poly game mesh)
 * @param {Float32Array} [options.crackMask] - Optional scalar attribute array
 * @param {Float32Array} [options.erosionDepth] - Optional scalar attribute array
 * @param {Float32Array} [options.sediment] - Optional scalar attribute array
 * @param {Float32Array} [options.oxidation] - Optional scalar attribute array
 * @returns {Object} { positions, normals, uvs, indices, crackData, erosionData, sedimentData, oxidationData }
 */
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

  // Temporary buffers for geometry extraction
  const posList = [];
  const normList = [];
  const uvList = [];
  const crackList = [];
  const erosionList = [];
  const sedList = [];
  const oxList = [];

  const vertPos = new Float32Array(12 * 3);
  const vertNorm = new Float32Array(12 * 3);
  const vertCrack = new Float32Array(12);
  const vertErosion = new Float32Array(12);
  const vertSed = new Float32Array(12);
  const vertOx = new Float32Array(12);

  // Gradient computation via central differences
  function calcGradient(ix, iy, iz) {
    const x0 = Math.max(0, ix - 1);
    const x1 = Math.min(nx - 1, ix + 1);
    const y0 = Math.max(0, iy - 1);
    const y1 = Math.min(ny - 1, iy + 1);
    const z0 = Math.max(0, iz - 1);
    const z1 = Math.min(nz - 1, iz + 1);

    const gX = (sdf[idx3D(x1, iy, iz)] - sdf[idx3D(x0, iy, iz)]) / ((x1 - x0) * dx || 1);
    const gY = (sdf[idx3D(ix, y1, iz)] - sdf[idx3D(ix, y0, iz)]) / ((y1 - y0) * dy || 1);
    const gZ = (sdf[idx3D(ix, iy, z1)] - sdf[idx3D(ix, iy, z0)]) / ((z1 - z0) * dz || 1);

    const len = Math.hypot(gX, gY, gZ) || 1.0;
    // Normal points outward (towards positive SDF)
    return [gX / len, gY / len, gZ / len];
  }

  // Iterate over 3D voxel grid
  for (let iz = 0; iz < nz - step; iz += step) {
    for (let iy = 0; iy < ny - step; iy += step) {
      for (let ix = 0; ix < nx - step; ix += step) {
        // Sample the 8 cube corners
        const cornerVals = new Float32Array(8);
        const cornerCoords = [];
        const cornerNorms = [];
        const cornerCracks = new Float32Array(8);
        const cornerErosions = new Float32Array(8);
        const cornerSeds = new Float32Array(8);
        const cornerOxs = new Float32Array(8);

        let cubeIndex = 0;
        for (let i = 0; i < 8; i++) {
          const off = CORNER_OFFSETS[i];
          const cx = ix + off[0] * step;
          const cy = iy + off[1] * step;
          const cz = iz + off[2] * step;
          const cIdx = idx3D(cx, cy, cz);

          const val = sdf[cIdx];
          cornerVals[i] = val;
          if (val < isovalue) cubeIndex |= 1 << i;

          const wx = boundsMin[0] + (cx / (nx - 1)) * sx;
          const wy = boundsMin[1] + (cy / (ny - 1)) * sy;
          const wz = boundsMin[2] + (cz / (nz - 1)) * sz;
          cornerCoords.push([wx, wy, wz]);
          cornerNorms.push(calcGradient(cx, cy, cz));

          if (crackMask) cornerCracks[i] = crackMask[cIdx] || 0.0;
          if (erosionDepth) cornerErosions[i] = erosionDepth[cIdx] || 0.0;
          if (sediment) cornerSeds[i] = sediment[cIdx] || 0.0;
          if (oxidation) cornerOxs[i] = oxidation[cIdx] || 0.0;
        }

        const edgeMask = EDGE_TABLE[cubeIndex];
        if (edgeMask === 0 || edgeMask === undefined) continue;

        // Calculate intersection vertices on active edges
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
            const n0 = cornerNorms[v0Idx];
            const n1 = cornerNorms[v1Idx];

            const px = p0[0] + t * (p1[0] - p0[0]);
            const py = p0[1] + t * (p1[1] - p0[1]);
            const pz = p0[2] + t * (p1[2] - p0[2]);

            let nxVal = n0[0] + t * (n1[0] - n0[0]);
            let nyVal = n0[1] + t * (n1[1] - n0[1]);
            let nzVal = n0[2] + t * (n1[2] - n0[2]);
            const nLen = Math.hypot(nxVal, nyVal, nzVal) || 1.0;

            vertPos[e * 3 + 0] = px;
            vertPos[e * 3 + 1] = py;
            vertPos[e * 3 + 2] = pz;

            vertNorm[e * 3 + 0] = nxVal / nLen;
            vertNorm[e * 3 + 1] = nyVal / nLen;
            vertNorm[e * 3 + 2] = nzVal / nLen;

            vertCrack[e] = cornerCracks[v0Idx] + t * (cornerCracks[v1Idx] - cornerCracks[v0Idx]);
            vertErosion[e] = cornerErosions[v0Idx] + t * (cornerErosions[v1Idx] - cornerErosions[v0Idx]);
            vertSed[e] = cornerSeds[v0Idx] + t * (cornerSeds[v1Idx] - cornerSeds[v0Idx]);
            vertOx[e] = cornerOxs[v0Idx] + t * (cornerOxs[v1Idx] - cornerOxs[v0Idx]);
          }
        }

        // Add triangles for this cube
        const tris = TRI_TABLE[cubeIndex];
        if (!tris) continue;

        for (let i = 0; i < tris.length && tris[i] !== -1; i += 3) {
          const e0 = tris[i];
          const e1 = tris[i + 1];
          const e2 = tris[i + 2];

          // Edge indices form the triangle
          const edges = [e0, e1, e2];
          for (let j = 0; j < 3; j++) {
            const edge = edges[j];
            const px = vertPos[edge * 3 + 0];
            const py = vertPos[edge * 3 + 1];
            const pz = vertPos[edge * 3 + 2];

            const nxVal = vertNorm[edge * 3 + 0];
            const nyVal = vertNorm[edge * 3 + 1];
            const nzVal = vertNorm[edge * 3 + 2];

            posList.push(px, py, pz);
            normList.push(nxVal, nyVal, nzVal);

            // Triplanar / Spherical UV mapping
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
