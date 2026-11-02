// Candy City — procedural texture library.
// Every map in this file is painted at runtime on a 2D canvas; nothing is loaded from disk.
// Colour maps are sRGB, detail/normal maps are linear. All maps tile seamlessly.

import * as THREE from '../vendor/three.module.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// small maths helpers
// ---------------------------------------------------------------------------

function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 17.3);
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function rgbLerp(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// ---------------------------------------------------------------------------
// canvas plumbing
// ---------------------------------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function paint(size, shade) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      shade(x / size, y / size, x, y, out);
      data[i] = clamp01(out[0]) * 255;
      data[i + 1] = clamp01(out[1]) * 255;
      data[i + 2] = clamp01(out[2]) * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texture(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

// Sobel height -> tangent-space normal map. Cheap, and it keeps every candy
// surface readable up close (sugar grain, wafer ridges, waffle cells).
function normalFromCanvas(c, strength = 2.2) {
  const size = c.width;
  const src = c.getContext('2d').getImageData(0, 0, size, size).data;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
  const nc = canvas(size);
  const nctx = nc.getContext('2d');
  const img = nctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => lum[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        at(x + 1, y - 1) - 2 * at(x + 1, y) - at(x + 1, y + 1);
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  return texture(nc, { srgb: false });
}

// ---------------------------------------------------------------------------
// individual candy surfaces
// ---------------------------------------------------------------------------

// Red-and-white peppermint: an arc-twisted spiral with a soft sugar bloom.
function peppermint(size = 320, red = [0.82, 0.13, 0.22], arms = 5) {
  return paint(size, (u, v, px, py, out) => {
    const nx = u - 0.5;
    const ny = v - 0.5;
    const r = Math.hypot(nx, ny) * 2;
    const a = Math.atan2(ny, nx);
    const spiral = Math.sin(a * arms + r * 13.5);
    const band = smoothstep(-0.22, 0.22, spiral);
    // Sugar crystal grain, strongest in the white stripes.
    const grain = fbm(u * 90, v * 90, 3, 4.2) * 0.09 - 0.045;
    const bloom = 0.94 + 0.06 * Math.sin(r * 30 + a * 2);
    const tint = rgbLerp([0.99, 0.96, 0.94], red, band);
    out[0] = tint[0] * bloom + grain;
    out[1] = tint[1] * bloom + grain;
    out[2] = tint[2] * bloom + grain;
  });
}

// Lollipop / hard-candy swirl with two or three sugar colours.
function swirl(size = 384, a = [0.99, 0.45, 0.66], b = [0.99, 0.98, 0.95], arms = 4) {
  return paint(size, (u, v, px, py, out) => {
    const nx = u - 0.5;
    const ny = v - 0.5;
    const r = Math.hypot(nx, ny) * 2;
    const ang = Math.atan2(ny, nx);
    const s = Math.sin(ang * arms + r * 16);
    const band = smoothstep(-0.32, 0.32, s);
    const gloss = 0.93 + 0.07 * Math.sin(r * 22 - ang);
    const tint = rgbLerp(b, a, band);
    out[0] = tint[0] * gloss;
    out[1] = tint[1] * gloss;
    out[2] = tint[2] * gloss;
  });
}

// Candy-cane barber pole stripes; diagonals stay seamless when wrapped.
function caneStripes(size = 256, a = [0.86, 0.12, 0.2], b = [0.99, 0.97, 0.95], bands = 5) {
  return paint(size, (u, v, px, py, out) => {
    const s = Math.sin((u * bands + v * bands) * TAU);
    const t = smoothstep(-0.18, 0.18, s);
    const edge = 0.94 + 0.06 * Math.cos((u * bands + v * bands) * TAU);
    const tint = rgbLerp(b, a, t);
    const grain = fbm(u * 70, v * 70, 2, 9.1) * 0.05 - 0.025;
    out[0] = tint[0] * edge + grain;
    out[1] = tint[1] * edge + grain;
    out[2] = tint[2] * edge + grain;
  });
}

// Sugar wafer: pressed ridges with a crumbly, porous top surface.
function wafer(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const ridge = Math.sin(v * TAU * 18);
    const shade = 0.86 + 0.14 * (ridge * 0.5 + 0.5);
    const pores = fbm(u * 55, v * 55, 3, 2.3);
    const crumb = 0.94 + 0.1 * (pores - 0.5);
    const base = [0.98, 0.93, 0.82];
    const dark = 0.86;
    out[0] = base[0] * shade * crumb * dark;
    out[1] = base[1] * shade * crumb * dark;
    out[2] = base[2] * shade * crumb * dark;
  });
}

// Waffle-cone lattice.
function waffle(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const cell = 9;
    const gx = Math.abs(((u * cell) % 1) - 0.5) * 2;
    const gy = Math.abs(((v * cell) % 1) - 0.5) * 2;
    const line = Math.max(smoothstep(0.55, 0.98, gx), smoothstep(0.55, 0.98, gy));
    const grime = fbm(u * 26, v * 26, 3, 6.6);
    const sugar = 0.98 + 0.06 * grime;
    const tint = rgbLerp([0.93, 0.76, 0.47], [0.66, 0.44, 0.23], line * 0.85);
    out[0] = tint[0] * sugar;
    out[1] = tint[1] * sugar;
    out[2] = tint[2] * sugar;
  });
}

// Milk-chocolate bar: temper swirls, bloom and cocoa pores.
function chocolate(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const swirl = fbm(u * 7 + Math.sin(v * 6) * 0.4, v * 7, 4, 11.2);
    const pores = fbm(u * 80, v * 80, 2, 3.7);
    const bloom = 0.9 + 0.16 * swirl;
    const tint = rgbLerp([0.36, 0.2, 0.13], [0.5, 0.29, 0.18], swirl);
    const sheen = 0.95 + 0.08 * pores;
    out[0] = tint[0] * bloom * sheen;
    out[1] = tint[1] * bloom * sheen;
    out[2] = tint[2] * bloom * sheen;
  });
}

// Frosting / buttercream: cloudy pastel base under a fine sugar crust.
function frosting(size = 384) {
  return paint(size, (u, v, px, py, out) => {
    const cloud = fbm(u * 5.5, v * 5.5, 5, 21.7);
    const grain = fbm(u * 120, v * 120, 2, 8.4);
    const tint = rgbLerp([0.99, 0.93, 0.9], [0.98, 0.86, 0.9], cloud * 0.55);
    const sparkle = grain > 0.86 ? 0.14 : 0;
    const shade = 0.97 + 0.05 * cloud + sparkle;
    out[0] = tint[0] * shade;
    out[1] = tint[1] * shade;
    out[2] = tint[2] * shade;
  });
}

// Sprinkled sugar: the "sugar street" ground cover.
function sprinklesGround(size = 512) {
  const c = paint(size, (u, v, px, py, out) => {
    const cloud = fbm(u * 6, v * 6, 4, 31.2);
    const tint = rgbLerp([0.99, 0.95, 0.94], [0.97, 0.9, 0.95], cloud);
    const grain = fbm(u * 160, v * 160, 2, 12.5);
    const s = 0.98 + (grain > 0.8 ? 0.08 : 0) + grain * 0.03;
    out[0] = tint[0] * s;
    out[1] = tint[1] * s;
    out[2] = tint[2] * s;
  });
  // Scatter actual sprinkle rods over the sugar.
  const ctx = c.getContext('2d');
  const colors = ['#ff5d8f', '#ffd166', '#6cc8ff', '#8ce99a', '#b892ff', '#ff8a5c', '#fff1a8'];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * TAU;
    const len = 4 + rnd() * 7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    ctx.globalAlpha = 0.55 + rnd() * 0.4;
    ctx.beginPath();
    ctx.roundRect(-len / 2, -1.6, len, 3.2, 1.6);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return c;
}

// Liquorice road: dark grape asphalt with a dashed sherbet centre line.
function road(size = 256) {
  const c = paint(size, (u, v, px, py, out) => {
    const grit = fbm(u * 70, v * 70, 3, 44.1);
    const patch = fbm(u * 6, v * 6, 3, 5.5);
    const base = rgbLerp([0.42, 0.31, 0.48], [0.52, 0.4, 0.58], patch);
    const speck = grit > 0.8 ? 0.16 : 0;
    out[0] = base[0] + speck;
    out[1] = base[1] + speck;
    out[2] = base[2] + speck;
  });
  const ctx = c.getContext('2d');
  // edge lines
  ctx.fillStyle = '#ffd9e6';
  ctx.globalAlpha = 0.85;
  ctx.fillRect(size * 0.04, 0, size * 0.018, size);
  ctx.fillRect(size * 0.942, 0, size * 0.018, size);
  // dashed sugar centre line along V
  ctx.fillStyle = '#fffaf0';
  ctx.globalAlpha = 0.95;
  const dash = size * 0.26;
  const gap = size * 0.14;
  for (let y = 0; y < size; y += dash + gap) {
    ctx.beginPath();
    ctx.roundRect(size * 0.484, y, size * 0.032, dash, 2);
    ctx.fill();
  }
  // scattered sugar grit on top
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = i % 3 === 0 ? '#ffe9f2' : '#6b5378';
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + Math.random() * 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

// White-chocolate pavement with icing grout.
function pavement(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const cols = 4;
    const row = (v * cols) % 1;
    const col = (u * cols) % 1;
    const grout = Math.max(smoothstep(0.93, 0.99, row), smoothstep(0.93, 0.99, col));
    const grain = fbm(u * 90, v * 90, 3, 17.9);
    const cloud = fbm(u * 8, v * 8, 2, 3.3);
    const tint = rgbLerp([1.0, 0.99, 0.97], [1.0, 0.86, 0.92], grout * 0.85);
    const shade = 0.96 + grain * 0.06 + cloud * 0.02;
    out[0] = tint[0] * shade;
    out[1] = tint[1] * shade;
    out[2] = tint[2] * shade;
  });
}

// Cotton candy: wispy sugar strands.
function cottonCandy(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    // Near-white strands: the mesh vertex colour supplies the candy hue.
    const wisp = fbm(u * 9 + Math.sin(v * 7) * 0.6, v * 9, 5, 3.9);
    const fine = fbm(u * 60, v * 60, 2, 9.2);
    const shade = 0.62 + wisp * 0.4 + (fine > 0.84 ? 0.12 : 0);
    out[0] = shade;
    out[1] = shade;
    out[2] = shade;
  });
}

// Marshmallow: soft, closed crumb.
function marshmallow(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const puff = fbm(u * 14, v * 14, 4, 2.8);
    const hex = Math.abs(Math.sin(u * 30) * Math.sin(v * 30)) * 0.035;
    const shade = 0.97 + puff * 0.05 + hex;
    out[0] = 0.99 * shade;
    out[1] = 0.97 * shade;
    out[2] = 0.95 * shade;
  });
}

// Jelly bean shell: white base lit from the top, dot speckles.
function jellyBean(size = 128) {
  return paint(size, (u, v, px, py, out) => {
    const spec = fbm(u * 24, v * 24, 2, 6.1);
    const gloss = 0.78 + 0.3 * (1 - v) + spec * 0.1;
    const dot = fbm(u * 70, v * 70, 1, 4.4) > 0.8 ? 0.06 : 0;
    out[0] = clamp01(gloss + dot);
    out[1] = clamp01(gloss + dot);
    out[2] = clamp01(gloss + dot);
  });
}

// Gumdrop shell: sugar crystals over a saturated core.
function gumdrop(size = 128) {
  return paint(size, (u, v, px, py, out) => {
    const crystal = fbm(u * 40, v * 40, 3, 14.2);
    const shade = 0.86 + 0.2 * (1 - v) + (crystal - 0.5) * 0.12;
    out[0] = clamp01(shade);
    out[1] = clamp01(shade);
    out[2] = clamp01(shade);
  });
}

// Hard-candy sugar shell for jawbreakers: layered sugar rings.
function jawbreaker(size = 256) {
  return paint(size, (u, v, px, py, out) => {
    const rings = Math.sin((Math.hypot(u - 0.5, v - 0.5) * 24 + fbm(u * 8, v * 8, 2, 3)) * Math.PI);
    const s = 0.9 + rings * 0.06;
    const grain = fbm(u * 60, v * 60, 2, 7);
    out[0] = clamp01(0.97 * s + grain * 0.03);
    out[1] = clamp01(0.97 * s + grain * 0.03);
    out[2] = clamp01(0.97 * s + grain * 0.03);
  });
}

// Gummy candy: translucent, softly marbled.
function gummy(size = 128) {
  return paint(size, (u, v, px, py, out) => {
    const marble = fbm(u * 5 + v, v * 5, 3, 12.7);
    const shade = 0.8 + marble * 0.32;
    out[0] = clamp01(shade);
    out[1] = clamp01(shade);
    out[2] = clamp01(shade);
  });
}

// ---------------------------------------------------------------------------
// public factory
// ---------------------------------------------------------------------------

/**
 * Paints every texture once and returns a plain object keyed by surface name.
 * `map` entries hold sRGB colour; `normal` entries hold linear normal maps.
 */
export function createCandyTextures() {
  const cache = {};
  const color = (name, canvasEl) => (cache[name] = texture(canvasEl));
  const normal = (name, canvasEl, strength) =>
    (cache[`${name}Normal`] = normalFromCanvas(canvasEl, strength));

  const mint = peppermint();
  color('peppermint', mint);
  normal('peppermint', mint, 2.4);

  color('lollipopPink', swirl(384, [0.99, 0.34, 0.58], [0.99, 0.97, 0.95], 4));
  color('lollipopBlue', swirl(384, [0.36, 0.76, 0.99], [0.99, 0.97, 0.95], 5));
  color('lollipopMint', swirl(384, [0.42, 0.9, 0.68], [0.99, 0.97, 0.95], 3));
  color('lollipopOrange', swirl(384, [0.99, 0.63, 0.24], [0.99, 0.97, 0.95], 4));

  color('cane', caneStripes(256, [0.86, 0.12, 0.2], [0.99, 0.97, 0.95], 5));
  color('caneBlue', caneStripes(256, [0.28, 0.55, 0.95], [0.99, 0.97, 0.95], 5));
  color('caneMint', caneStripes(256, [0.23, 0.78, 0.58], [0.99, 0.97, 0.95], 4));

  const w = wafer();
  color('wafer', w);
  normal('wafer', w, 2.8);

  const cone = waffle();
  color('waffle', cone);
  normal('waffle', cone, 3.4);

  const choc = chocolate();
  color('chocolate', choc);
  normal('chocolate', choc, 1.4);

  const frost = frosting();
  color('frosting', frost);
  normal('frosting', frost, 1.6);

  const sugar = sprinklesGround();
  color('sprinklesGround', sugar);
  normal('sprinklesGround', sugar, 1.5);

  const rd = road();
  color('road', rd);
  normal('road', rd, 1.2);

  const pave = pavement();
  color('pavement', pave);
  normal('pavement', pave, 2.0);

  const cotton = cottonCandy();
  color('cottonCandy', cotton);
  normal('cottonCandy', cotton, 1.2);

  const marsh = marshmallow();
  color('marshmallow', marsh);
  normal('marshmallow', marsh, 0.9);

  color('jellyBean', jellyBean());
  const gum = gumdrop();
  color('gumdrop', gum);
  normal('gumdrop', gum, 1.8);
  color('jawbreaker', jawbreaker());
  color('gummy', gummy());

  // A tiny soft radial sprite used by the sky and floating sugar motes.
  cache.sparkle = (() => {
    const size = 64;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,240,250,0.5)');
    grad.addColorStop(1, 'rgba(255,220,240,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return texture(c, { repeat: 1 });
  })();

  return cache;
}
