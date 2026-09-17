/* ============================================================
 * Frontier · SDF Terrain Lab — Procedural surface textures
 *
 * Bakes five 512×512 albedo textures (grass / dirt / rock / sand
 * / snow) from seeded fractal noise. Mirrored repeat wrapping
 * makes them seamless without the 4× tiling cost.
 * ============================================================ */

import * as THREE from 'three';
import { Perlin2D, fbm01, ridged, subseed } from './noise.js';

const SIZE = 512;

function bakeTexture(seed, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const px = img.data;

  const n1 = new Perlin2D(subseed(seed, 11));
  const n2 = new Perlin2D(subseed(seed, 23));
  const n3 = new Perlin2D(subseed(seed, 37));
  const f = (u, v, oct) => fbm01(n1, u, v, { octaves: oct, gain: 0.52, lacunarity: 2.1 });
  const f2 = (u, v, oct) => fbm01(n2, u, v, { octaves: oct, gain: 0.5, lacunarity: 2.0 });
  const rg = (u, v, oct) => ridged(n3, u, v, { octaves: oct, gain: 0.55, lacunarity: 2.4 });

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const o = paint(u, v, f, f2, rg);
      const i = (y * SIZE + x) * 4;
      px[i] = o[0]; px[i + 1] = o[1]; px[i + 2] = o[2]; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const mixc = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Bakes all five layer textures. Returns { grass, dirt, rock, sand, snow }. */
export function bakeAllTextures(seed, onProgress) {
  const S = 8; // uv tiling of the noise domain

  onProgress && onProgress('grass', 0);
  const grass = bakeTexture(seed ^ 0x101, (u, v, f, f2, rg) => {
    const base = f(u * S, v * S, 5);
    const patch = f2(u * S * 2.3 + 5.2, v * S * 2.3 - 2.1, 3);
    const fine = f2(u * S * 9.0, v * S * 9.0, 2);
    const clump = f2(u * S * 4.6 + 2.8, v * S * 4.6 - 6.3, 3);
    const dry = f(u * S * 0.7 + 11.4, v * S * 0.7 + 3.3, 3);
    // richer green with clumped variation, only a little dry gold
    let c = mixc([64, 98, 46], [118, 138, 70], base);
    c = mixc(c, [48, 80, 38], patch * 0.5);            // dark patches
    c = mixc(c, [134, 146, 78], clump * 0.32);         // light clumps
    c = mixc(c, [44, 72, 36], fine * 0.3);             // fine dark
    c = mixc(c, [142, 132, 74], dry * dry * 0.34);     // sparse dry gold
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });

  onProgress && onProgress('dirt', 0.25);
  const dirt = bakeTexture(seed ^ 0x202, (u, v, f, f2, rg) => {
    const base = f(u * S, v * S, 5);
    const clod = f2(u * S * 3.1 + 8.8, v * S * 3.1 - 4.2, 4);
    const fine = f2(u * S * 11.0 - 1.9, v * S * 11.0 + 6.6, 2);
    // rich loam brown (less yellow, more earthy)
    let c = mixc([108, 82, 58], [148, 118, 86], base);
    c = mixc(c, [82, 60, 42], clod * 0.5);             // dark clods
    c = mixc(c, [162, 134, 98], fine * 0.2);           // light grit
    c = mixc(c, [124, 96, 66], base * base * 0.3);     // rich soil
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });

  onProgress && onProgress('rock', 0.5);
  const rock = bakeTexture(seed ^ 0x303, (u, v, f, f2, rg) => {
    const base = f(u * S * 0.8, v * S * 0.8, 4);
    const strata = f2(u * S * 0.6 + 2.2, v * S * 3.6, 3);   // horizontal banding
    const crack = rg(u * S * 2.2 + 3.1, v * S * 2.2 - 7.7, 4);
    const patch = f2(u * S * 1.6 + 2.2, v * S * 1.6 + 9.9, 3);
    // warm gray-brown base (not cool concrete)
    let c = mixc([112, 105, 98], [148, 142, 134], base);
    c = mixc(c, [84, 78, 72], (1 - strata) * 0.4);    // dark strata bands
    c = mixc(c, [166, 160, 150], strata * 0.3);       // pale strata bands
    c = mixc(c, [64, 60, 56], Math.max(0, crack - 0.72) * 3.2);  // crevices
    c = mixc(c, [132, 116, 100], patch * 0.3);        // warm iron-stain patches
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });

  onProgress && onProgress('sand', 0.75);
  const sand = bakeTexture(seed ^ 0x404, (u, v, f, f2, rg) => {
    const base = f(u * S, v * S, 4);
    const ripple = rg(u * S * 6.5 + 4.4, v * S * 6.5 - 2.8, 3);
    const fine = f2(u * S * 13.0, v * S * 13.0, 2);
    let c = mixc([174, 152, 110], [202, 184, 144], base);
    c = mixc(c, [158, 136, 96], ripple * 0.3);        // ripple shadow
    c = mixc(c, [214, 198, 158], fine * 0.18);
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });

  onProgress && onProgress('snow', 0.9);
  const snow = bakeTexture(seed ^ 0x505, (u, v, f, f2, rg) => {
    const base = f(u * S * 0.7, v * S * 0.7, 4);
    const drift = f2(u * S * 1.9 - 6.1, v * S * 1.9 + 4.7, 3);
    let c = mixc([236, 240, 247], [249, 251, 253], base);
    c = mixc(c, [196, 210, 228], drift * 0.55); // blue shadow drifts
    const sparkle = f2(u * S * 18.0, v * S * 18.0, 1);
    c = mixc(c, [214, 224, 238], sparkle * 0.3);
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });

  onProgress && onProgress('done', 1);
  return { grass, dirt, rock, sand, snow };
}
