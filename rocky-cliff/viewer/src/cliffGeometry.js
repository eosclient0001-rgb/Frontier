import * as THREE from 'three';

// The cliff is an extrusion of a 2D cross-section (the "profile") along X.
// Every vertex gets a little noise so the silhouette is not a perfect
// extrusion. Texture coordinates are in metres: U runs across the face and
// V runs up the face along the profile, so one texture tile is always the
// same physical size, whatever the shape.

export const CLIFF_WIDTH_M = 40;
const SEG_ACROSS = 400; // ~10 cm between columns
const SEG_ALONG = 1000; // ~9 cm between rows along the profile

// Cross-section in metres as [z, y]. Ordered from the toe of the talus, up the
// slope and the wall, then back across the top, so the profile's arc length
// increases upward on the face. The flat ground in front is a separate plane,
// so the rock mesh never sits coplanar with it.
export const PROFILE = [
  [8.2, 0],
  [5.6, 0.9],
  [3.4, 3.2],
  [1.9, 6.0],
  [1.1, 9.5],
  [0.7, 13.0],
  [0.45, 16.5],
  [0.2, 19.8],
  [-0.1, 22.6],
  [-0.9, 24.4],
  [-3.0, 25.1],
  [-16.0, 25.4],
];

// Hash-based value noise, roughly in [0, 1]. Deterministic, so the same
// cliff comes out on every load.
function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function softNoise(x, y) {
  return 0.65 * valueNoise(x, y) + 0.35 * valueNoise(x * 2.07 + 17.3, y * 2.07 - 5.1);
}

export function buildCliffGeometry() {
  const curve = new THREE.SplineCurve(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  const length = curve.getLength();
  const samples = curve.getSpacedPoints(SEG_ALONG); // evenly spaced by arc length

  const cols = SEG_ACROSS + 1;
  const rows = SEG_ALONG + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);

  for (let j = 0; j < rows; j++) {
    const p = samples[j];
    const s = (j / SEG_ALONG) * length; // metres up the profile
    for (let i = 0; i < cols; i++) {
      const x = -CLIFF_WIDTH_M / 2 + (i / SEG_ACROSS) * CLIFF_WIDTH_M;
      // The wobble fades in above the talus toe, so the base stays on the ground.
      const lift = THREE.MathUtils.smoothstep(p.y, 0, 2);
      // Large bays and buttresses, plus smaller roughness, so the face is not a flat sheet.
      const dz =
        ((softNoise(x * 0.06 + 7.1, s * 0.08 + 2.3) - 0.5) * 3.2 +
          (softNoise(x * 0.17 + 3.3, s * 0.2 + 9.7) - 0.5) * 0.6) *
        lift;
      const dy = (softNoise(x * 0.17 + 1.7, s * 0.2 + 8.9) - 0.5) * 1.1 * lift;

      const k = j * cols + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = p.y + dy;
      positions[k * 3 + 2] = p.x + dz;
      // A slow warp of the texture coordinates stops the tile's motifs from lining up
      // in a visible grid. It is continuous, so there are no seams.
      const warpU = (softNoise(x * 0.12 + 40.1, s * 0.1 + 11.7) - 0.5) * 1.6;
      const warpV = (softNoise(x * 0.1 + 5.5, s * 0.14 + 23.1) - 0.5) * 1.6;
      uvs[k * 2] = x + CLIFF_WIDTH_M / 2 + warpU;
      uvs[k * 2 + 1] = s + warpV;
    }
  }

  // Two counter-clockwise triangles per quad, so the wall faces +Z.
  const indices = new Uint32Array(SEG_ACROSS * SEG_ALONG * 6);
  let n = 0;
  for (let j = 0; j < SEG_ALONG; j++) {
    for (let i = 0; i < SEG_ACROSS; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[n++] = a;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = b;
      indices[n++] = d;
      indices[n++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
