/**
 * materials.js — Procedural fossil-bone, tooth, flesh and ground materials.
 * All textures are generated on a <canvas> at start-up: no image downloads.
 */

import {
  CanvasTexture, RepeatWrapping, SRGBColorSpace, MeshStandardMaterial,
  MeshPhysicalMaterial, Color,
} from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Tileable value-noise fBm painted into an ImageData buffer. */
function fbmCanvas(size, seed, palette, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const G = 256;
  const grid = Array.from({ length: G * G }, () => r());
  // periodic value noise: `cells` lattice cells across the texture, wraps exactly
  const val = (x, y, cells) => {
    const gx = (x / size) * cells, gy = (y / size) * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => grid[(((y0 + j) % cells) % G) * G + (((x0 + i) % cells) % G)];
    return (g(0, 0) * (1 - ux) + g(1, 0) * ux) * (1 - uy) + (g(0, 1) * (1 - ux) + g(1, 1) * ux) * uy;
  };
  const oct = opts.octaves ?? 5;
  const baseCells = Math.max(1, Math.round(opts.base ?? 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, amp = 0.5, f = baseCells;
      let n = 0;
      for (let o = 0; o < oct; o++) { n += val(x, y, f) * amp; a += amp; amp *= 0.5; f *= 2; }
      n /= a;
      // streaky fibrous grain along one axis (cortical bone texture)
      const streak = opts.streak ? 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 48 + val(x, y, baseCells * 2) * 12) : 0.5;
      const t = Math.min(1, Math.max(0, (n - 0.25) * 1.9 * (1 - (opts.streak ?? 0)) + streak * (opts.streak ?? 0)));
      // palette ramp
      const k = t * (palette.length - 1);
      const i0 = Math.floor(k), i1 = Math.min(palette.length - 1, i0 + 1), u = k - i0;
      const p0 = palette[i0], p1 = palette[i1];
      const idx = (y * size + x) * 4;
      img.data[idx] = p0[0] + (p1[0] - p0[0]) * u;
      img.data[idx + 1] = p0[1] + (p1[1] - p0[1]) * u;
      img.data[idx + 2] = p0[2] + (p1[2] - p0[2]) * u;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // speckles / pits (weathering)
  if (opts.pits) {
    for (let i = 0; i < opts.pits; i++) {
      const x = r() * size, y = r() * size, rad = 0.4 + r() * 1.6;
      ctx.fillStyle = `rgba(20,12,6,${0.25 + r() * 0.35})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  }
  return c;
}

function tex(canvas, repeat = 1, srgb = true) {
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/** Bone colour presets. Sue's real bones are a very dark chocolate brown. */
export const BONE_PRESETS = {
  sue: { name: 'Fossil (Sue, dark)', palette: [[38, 24, 16], [66, 44, 28], [96, 66, 42], [128, 94, 62], [150, 118, 82]], rough: 0.62 },
  sand: { name: 'Fossil (ochre)', palette: [[92, 66, 40], [140, 104, 66], [176, 140, 96], [204, 176, 132], [222, 202, 164]], rough: 0.72 },
  cast: { name: 'Museum cast', palette: [[150, 146, 138], [178, 172, 162], [200, 195, 184], [220, 216, 206], [236, 233, 225]], rough: 0.55 },
};

export function makeMaterials() {
  const boneCanvases = {};
  const bumpCanvas = fbmCanvas(256, 7, [[0, 0, 0], [255, 255, 255]], { octaves: 5, base: 6, pits: 900 });
  const bump = tex(bumpCanvas, 3, false);

  const bone = new MeshStandardMaterial({
    color: 0xffffff, roughness: 0.62, metalness: 0.0,
    bumpMap: bump, bumpScale: 1.4,
  });
  const setBonePreset = (key) => {
    const p = BONE_PRESETS[key];
    if (!boneCanvases[key]) boneCanvases[key] = tex(fbmCanvas(256, 11, p.palette, { octaves: 5, base: 5, pits: 1500, streak: 0.18 }), 3);
    if (bone.map) bone.map = null;
    bone.map = boneCanvases[key];
    bone.roughness = p.rough;
    bone.needsUpdate = true;
  };
  setBonePreset('sue');

  const tooth = new MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.35, metalness: 0.0 });
  const toothPresets = { sue: 0x2b1d12, sand: 0x6a4d2e, cast: 0xd8d2c4 };

  const fleshCanvas = fbmCanvas(256, 23, [[62, 58, 44], [84, 78, 58], [104, 96, 70], [70, 64, 50], [128, 116, 84]], { octaves: 6, base: 10, pits: 3000 });
  const flesh = new MeshPhysicalMaterial({
    color: 0xffffff, map: tex(fleshCanvas, 6), roughness: 0.8,
    bumpMap: bump, bumpScale: 3, transparent: true, opacity: 0.22,
    depthWrite: false, sheen: 0.4, sheenColor: new Color(0x9aa080),
  });

  const groundCanvas = fbmCanvas(512, 5, [[80, 70, 54], [104, 92, 70], [124, 110, 84], [96, 86, 64], [140, 126, 96]], { octaves: 6, base: 8, pits: 5000 });
  const ground = new MeshStandardMaterial({ map: tex(groundCanvas, 40), roughness: 0.95, bumpMap: tex(bumpCanvas, 60, false), bumpScale: 2 });

  return {
    bone, tooth, flesh, ground,
    setBonePreset(key) { setBonePreset(key); tooth.color.setHex(toothPresets[key]); },
  };
}
