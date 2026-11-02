// Candy City — procedural generator.
// Deterministic: the same seed always builds the same town.
// Static geometry is baked into one merged mesh per material (a handful of
// draw calls for the whole city); jelly beans and sprinkles are instanced.

import * as THREE from '../vendor/three.module.js';
import { RoundedBoxGeometry } from '../vendor/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// deterministic random
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// candy palette
// ---------------------------------------------------------------------------

const CANDY = [
  '#ff8fb8', '#ffd166', '#8ce99a', '#7cc6ff', '#c9a0ff',
  '#ff9f68', '#fff1a8', '#ff5d8f', '#67e8c3', '#f7a8ff',
];

const PASTEL = [
  '#ffc3d9', '#ffe2a6', '#bff0cf', '#bcdcff', '#dcc4ff',
  '#ffcbb2', '#fff3c2', '#c2f7e8',
];

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

function createMaterials(tex) {
  const cache = new Map();
  const has = (name) => Boolean(tex && tex[name]);

  const defs = {
    ground: { map: 'sprinklesGround', normal: 'sprinklesGroundNormal', roughness: 0.95, side: THREE.DoubleSide },
    grass: { map: 'cottonCandy', normal: 'cottonCandyNormal', roughness: 0.9 },
    road: { map: 'road', normal: 'roadNormal', roughness: 0.62, side: THREE.DoubleSide },
    pavement: { map: 'pavement', normal: 'pavementNormal', roughness: 0.82, side: THREE.DoubleSide },
    wafer: { map: 'wafer', normal: 'waferNormal', roughness: 0.85 },
    peppermint: { map: 'peppermint', normal: 'peppermintNormal', roughness: 0.22 },
    lollipopPink: { map: 'lollipopPink', roughness: 0.16 },
    lollipopBlue: { map: 'lollipopBlue', roughness: 0.16 },
    lollipopMint: { map: 'lollipopMint', roughness: 0.16 },
    lollipopOrange: { map: 'lollipopOrange', roughness: 0.16 },
    cane: { map: 'cane', roughness: 0.3 },
    caneBlue: { map: 'caneBlue', roughness: 0.3 },
    caneMint: { map: 'caneMint', roughness: 0.3 },
    waffle: { map: 'waffle', normal: 'waffleNormal', roughness: 0.9 },
    chocolate: { map: 'chocolate', normal: 'chocolateNormal', roughness: 0.55 },
    frosting: { map: 'frosting', normal: 'frostingNormal', roughness: 0.55 },
    cottonCandy: { map: 'cottonCandy', normal: 'cottonCandyNormal', roughness: 0.95 },
    marshmallow: { map: 'marshmallow', normal: 'marshmallowNormal', roughness: 0.9 },
    gumdrop: { map: 'gumdrop', normal: 'gumdropNormal', roughness: 0.5 },
    gummy: { map: 'gummy', roughness: 0.18, transparent: true, opacity: 0.88, physical: true, clearcoat: 1 },
    jawbreaker: { map: 'jawbreaker', roughness: 0.14, physical: true, clearcoat: 1, clearcoatRoughness: 0.06 },
    jellyBean: { map: 'jellyBean', roughness: 0.16, physical: true, clearcoat: 1 },
    icing: { roughness: 0.35, physical: true, clearcoat: 0.8 },
    candy: { roughness: 0.2, physical: true, clearcoat: 1, clearcoatRoughness: 0.05 },
    glass: { roughness: 0.05, metalness: 0.2, color: '#bfe6ff', transparent: true, opacity: 0.55 },
    window: { map: null, color: '#2f5f96', emissive: '#ffcf87', emissiveIntensity: 0.06, roughness: 0.06, metalness: 0.35 },
    lamp: { color: '#fff2c9', emissive: '#ffcf87', emissiveIntensity: 0.1, roughness: 0.2 },
    flame: { color: '#ffd166', emissive: '#ff9a3c', emissiveIntensity: 2.2, roughness: 0.4 },
  };

  /**
   * Materials are shared by surface type only. Per-candy colours ride on the
   * merged geometry as a vertex-colour attribute, so a whole town of different
   * sweets still costs one draw call per surface family.
   */
  function get(key, { vertexColors = true } = {}) {
    const cacheKey = `${key}#${vertexColors ? 1 : 0}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const name = key.split('|')[0];
    const def = defs[name] || defs.candy;
    const params = {
      color: def.color ? new THREE.Color(def.color) : 0xffffff,
      roughness: def.roughness ?? 0.6,
      metalness: def.metalness ?? 0,
      vertexColors,
    };
    if (def.map && has(def.map)) params.map = tex[def.map];
    if (def.normal && has(def.normal)) {
      params.normalMap = tex[def.normal];
      params.normalScale = new THREE.Vector2(0.8, 0.8);
    }
    if (def.emissive) {
      params.emissive = new THREE.Color(def.emissive);
      params.emissiveIntensity = def.emissiveIntensity ?? 0.2;
    }
    if (def.transparent) {
      params.transparent = true;
      params.opacity = def.opacity ?? 1;
    }
    if (def.side) params.side = def.side;
    const Mat = def.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    if (def.physical) {
      params.clearcoat = def.clearcoat ?? 0.6;
      params.clearcoatRoughness = def.clearcoatRoughness ?? 0.1;
    }
    const material = new Mat(params);
    material.name = key;
    cache.set(cacheKey, material);
    return material;
  }

  function each(name) {
    return [cache.get(`${name}#1`), cache.get(`${name}#0`)].filter(Boolean);
  }

  function setNight(t) {
    for (const w of each('window')) w.emissiveIntensity = 0.06 + t * 3.1;
    for (const l of each('lamp')) l.emissiveIntensity = 0.1 + t * 3.4;
  }

  return { get, setNight, cache };
}

// ---------------------------------------------------------------------------
// merge bucket
// ---------------------------------------------------------------------------

class Batch {
  constructor() {
    this.buckets = new Map();
    this.pieces = 0;
  }

  add(key, geometry, matrix) {
    const bar = key.indexOf('|');
    const name = bar === -1 ? key : key.slice(0, bar);
    const hex = bar === -1 ? null : key.slice(bar + 1);

    let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const vertexCount = geo.attributes.position.count;
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 2), 2));
    }
    geo.applyMatrix4(matrix);

    // Candy colour is baked per vertex: one material per surface family.
    const tint = hex ? new THREE.Color(hex) : WHITE;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Keep only the attributes every merged piece shares.
    for (const attr of Object.keys(geo.attributes)) {
      if (attr !== 'position' && attr !== 'normal' && attr !== 'uv' && attr !== 'color') {
        geo.deleteAttribute(attr);
      }
    }
    geo.morphAttributes = {};
    geo.clearGroups();
    if (!this.buckets.has(name)) this.buckets.set(name, []);
    this.buckets.get(name).push(geo);
    this.pieces++;
  }

  build(materials, parent) {
    let meshes = 0;
    for (const [key, list] of this.buckets) {
      let merged = null;
      try {
        merged = mergeGeometries(list, false);
      } catch (err) {
        merged = null;
      }
      if (!merged) {
        // Fall back to individual meshes rather than dropping candy on the floor.
        for (const geo of list) {
          const mesh = new THREE.Mesh(geo, materials.get(key));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
          meshes++;
        }
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials.get(key));
      mesh.castShadow = key !== 'window';
      mesh.receiveShadow = true;
      mesh.name = key;
      parent.add(mesh);
      meshes++;
      for (const geo of list) geo.dispose();
    }
    this.buckets.clear();
    return meshes;
  }
}

// ---------------------------------------------------------------------------
// transform helpers
// ---------------------------------------------------------------------------

const IDENTITY = new THREE.Matrix4();
const WHITE = new THREE.Color(0xffffff);

function localMatrix(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const e = new THREE.Euler(rx, ry, rz, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    q,
    new THREE.Vector3(sx, sy, sz),
  );
}

function put(batch, key, geo, base, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = localMatrix(x, y, z, ry, rx, rz, sx, sy, sz);
  m.premultiply(base);
  batch.add(key, geo, m);
}

function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const range = (rng, a, b) => a + (b - a) * rng();

// ---------------------------------------------------------------------------
// primitive builders
// ---------------------------------------------------------------------------

function box(w, h, d, r = 0.12) {
  const radius = Math.min(r, Math.min(w, h, d) * 0.49);
  return new RoundedBoxGeometry(w, h, d, 2, radius);
}

function cylinder(rt, rb, h, seg = 14) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1);
}

function dome(radius, height, seg = 18) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(7, Math.round(seg * 0.6)), 0, TAU, 0, Math.PI / 2);
  g.scale(radius, height, radius);
  return g;
}

function disc(radius, thickness, seg = 22) {
  return new THREE.CylinderGeometry(radius, radius, thickness, seg, 1);
}

function ring(radius, tube, seg = 20) {
  return new THREE.TorusGeometry(radius, tube, 6, seg);
}

function beanGeo() {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(0.13, 0.09, 0.2);
  return g;
}

function sprinkleGeo() {
  return new THREE.CylinderGeometry(0.032, 0.032, 0.26, 5);
}

// ---------------------------------------------------------------------------
// buildings — all built at local origin, front facing +Z
// ---------------------------------------------------------------------------

function addWindow(batch, base, x, y, z, w, h, ry, options = {}) {
  const frame = options.frame || 'icing';
  put(batch, frame, box(w + 0.26, h + 0.26, 0.14, 0.07), base, x, y, z, ry);
  put(batch, 'window', box(w, h, 0.1, 0.05), base, x, y, z + 0.03, ry);
  // muntins
  put(batch, frame, box(w * 0.9, 0.055, 0.05, 0.02), base, x, y, z + 0.1, ry);
  put(batch, frame, box(0.055, h * 0.9, 0.05, 0.02), base, x, y, z + 0.1, ry);
  if (options.sill !== false) {
    put(batch, 'wafer', box(w + 0.5, 0.12, 0.34, 0.05), base, x, y - h / 2 - 0.16, z + 0.12, ry);
  }
  if (options.flowerBox) {
    const bx = x;
    const by = y - h / 2 - 0.34;
    put(batch, 'chocolate', box(w + 0.4, 0.24, 0.32, 0.08), base, bx, by, z + 0.26, ry);
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3 - 0.5;
      put(batch, `gumdrop|${pick(options.rng, CANDY)}`, gumdropGeo(0.11, 0.13), base,
        bx + t * (w + 0.1), by + 0.16, z + 0.26, 0, 0, 0);
    }
  }
}

function gumdropGeo(radius, height, seg = 10) {
  const g = dome(radius, height, seg);
  return g;
}

function door(batch, base, opts) {
  const { width = 1.7, height = 2.5, z = 3.02, color = 'chocolate', rng, knob = '#ff5d8f' } = opts;
  put(batch, color, box(width, height, 0.24, 0.3), base, 0, height / 2, z);
  // arch top
  put(batch, 'icing', ring(width * 0.5, 0.09, 16), base, 0, height, z + 0.02, 0, Math.PI / 2);
  // knob
  put(batch, `candy|${knob}`, new THREE.SphereGeometry(0.1, 10, 8), base, width * 0.32, height * 0.45, z + 0.18);
  // candy cane jambs
  put(batch, 'cane', cylinder(0.13, 0.13, height + 0.4, 10), base, -width / 2 - 0.22, (height + 0.4) / 2, z + 0.03);
  put(batch, 'cane', cylinder(0.13, 0.13, height + 0.4, 10), base, width / 2 + 0.22, (height + 0.4) / 2, z + 0.03);
  put(batch, 'icing', new THREE.SphereGeometry(0.18, 10, 8), base, -width / 2 - 0.22, height + 0.42, z + 0.03);
  put(batch, 'icing', new THREE.SphereGeometry(0.18, 10, 8), base, width / 2 + 0.22, height + 0.42, z + 0.03);
  // jawbreaker doorstep
  put(batch, 'jawbreaker', disc(0.62, 0.16, 16), base, 0, 0.08, z + 0.55);
  if (rng) {
    put(batch, 'icing', box(width + 1.2, 0.1, 1.5, 0.06), base, 0, 0.14, z + 0.85);
  }
}

function icingDrips(batch, base, radius, y, count, rng, color = 'icing') {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.08;
    const r = radius;
    const len = 0.2 + rng() * 0.45;
    put(batch, color, new THREE.SphereGeometry(0.16, 8, 6), base,
      Math.cos(a) * r, y - len * 0.5, Math.sin(a) * r, 0, 0, 0, 1, 1 + len * 1.6, 1);
  }
}

function roofSprinkles(batch, base, radius, height, yBase, rng, count = 14) {
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const t = 0.15 + rng() * 0.7;
    const r = radius * Math.cos(t * Math.PI * 0.5) * 0.86;
    const y = yBase + height * Math.sin(t * Math.PI * 0.5);
    const tilt = Math.PI / 2 - t * 0.9;
    put(batch, `candy|${pick(rng, CANDY)}`, cylinder(0.035, 0.035, 0.16, 4), base,
      Math.cos(a) * r, y, Math.sin(a) * r, rng() * TAU, tilt, 0);
  }
}

// Style 1: gumdrop cottage — wafer walls, a big soft gumdrop roof.
function houseGumdrop(batch, base, rng) {
  const w = range(rng, 6.4, 7.6);
  const d = range(rng, 5.6, 6.6);
  const h = range(rng, 3.6, 4.4);
  const wall = pick(rng, PASTEL);
  const roofColor = pick(rng, CANDY);

  put(batch, 'pavement', box(w + 1.1, 0.34, d + 1.1, 0.16), base, 0, 0.18, 0);
  put(batch, `wafer|${wall}`, uvScale(box(w, h, d, 0.55), 2, 1), base, 0, h / 2, 0);
  // corner candy-cane posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(batch, 'cane', cylinder(0.14, 0.14, h * 0.95, 8), base,
        sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1));
    }
  }
  // gumdrop roof
  const roofH = range(rng, 2.2, 3.2);
  put(batch, 'icing', ring(w / 2, 0.14, 20), base, 0, h, 0, 0, Math.PI / 2, 0, 1, 1, 1);
  put(batch, `gumdrop|${roofColor}`, dome(w * 0.62, roofH, 22), base, 0, h, 0, 0, 0, 0, 1, 1, (d / w) * 0.98);
  put(batch, 'icing', ring(w * 0.6, 0.16, 20), base, 0, h - 0.04, 0, 0, Math.PI / 2, 0, 1, 1, (d / w) * 0.98);
  icingDrips(batch, base, w * 0.6, h - 0.1, Math.round(range(rng, 10, 16)), rng);
  roofSprinkles(batch, base, w * 0.62, roofH, h, rng, Math.round(range(rng, 8, 16)));

  // chimney
  const cx = range(rng, -w * 0.28, w * 0.28);
  put(batch, 'chocolate', box(0.8, 2.0, 0.8, 0.14), base, cx, h + roofH * 0.75, -d * 0.18);
  put(batch, 'marshmallow', box(0.98, 0.28, 0.98, 0.1), base, cx, h + roofH * 0.75 + 1.05, -d * 0.18);

  door(batch, base, { z: d / 2 + 0.06, rng, knob: pick(rng, CANDY) });

  addWindow(batch, base, -w * 0.3, h * 0.66, d / 2 + 0.05, 1.15, 1.15, 0, { rng, flowerBox: true });
  addWindow(batch, base, w * 0.3, h * 0.66, d / 2 + 0.05, 1.15, 1.15, 0, { rng });
  addWindow(batch, base, -w / 2 - 0.04, h * 0.6, 0, 0.95, 0.95, Math.PI / 2, { rng });
  addWindow(batch, base, w / 2 + 0.04, h * 0.6, -d * 0.1, 0.95, 0.95, -Math.PI / 2, { rng });
  // round peppermint gable window
  put(batch, 'icing', disc(0.5, 0.12, 18), base, 0, h + roofH * 0.28, d / 2 - 0.4, 0, Math.PI / 2, 0);
  put(batch, 'peppermint', disc(0.4, 0.09, 18), base, 0, h + roofH * 0.28, d / 2 - 0.32, 0, Math.PI / 2, 0);
  // awning
  put(batch, 'caneBlue', new THREE.CylinderGeometry(1.0, 1.0, w * 0.5, 12, 1, true, 0, Math.PI),
    base, 0, h * 0.62, d / 2 + 0.5, Math.PI / 2, 0, Math.PI / 2);
  return { w, d, h, wall };
}

// Style 2: candy-cane cabin — a striped drum with a peppermint lid.
function houseCandyCane(batch, base, rng) {
  const r = range(rng, 3.0, 3.7);
  const h = range(rng, 4.2, 5.4);
  const stripe = pick(rng, ['cane', 'caneBlue', 'caneMint']);
  put(batch, 'pavement', disc(r + 0.9, 0.34, 24), base, 0, 0.17, 0);
  put(batch, 'wafer', cylinder(r + 0.18, r + 0.3, 0.45, 20), base, 0, 0.45, 0);
  put(batch, stripe, uvScale(cylinder(r, r, h, 20), 4, 2), base, 0, 0.6 + h / 2, 0);
  // icing banding
  for (const y of [0.8, 0.8 + h * 0.5, 0.6 + h]) {
    put(batch, 'icing', ring(r + 0.03, 0.1, 22), base, 0, y, 0, 0, Math.PI / 2, 0);
  }
  // peppermint roof
  put(batch, 'icing', disc(r + 0.35, 0.2, 24), base, 0, 0.7 + h, 0);
  put(batch, 'peppermint', new THREE.ConeGeometry(r + 0.4, 2.4, 24), base, 0, 0.8 + h + 1.2, 0);
  put(batch, 'icing', new THREE.SphereGeometry(0.34, 10, 8), base, 0, 0.8 + h + 2.5, 0);
  put(batch, `candy|${pick(rng, CANDY)}`, new THREE.SphereGeometry(0.2, 10, 8), base, 0, 0.8 + h + 2.85, 0);
  // door + windows on the drum
  const z = r;
  door(batch, base, { z: z + 0.02, width: 1.4, height: 2.2, rng, knob: '#ffd166' });
  for (const a of [-0.75, 0.75, Math.PI]) {
    const x = Math.sin(a) * (r + 0.02);
    const zz = Math.cos(a) * (r + 0.02);
    put(batch, 'icing', disc(0.62, 0.14, 16), base, x, h * 0.62, zz, a, Math.PI / 2, 0);
    put(batch, 'window', disc(0.5, 0.1, 16), base, x, h * 0.62, zz + 0.02, a, Math.PI / 2, 0);
  }
  // little candy chimney
  put(batch, 'chocolate', cylinder(0.34, 0.4, 1.7, 10), base, r * 0.55, 0.8 + h + 1.4, -r * 0.4);
  put(batch, 'marshmallow', new THREE.SphereGeometry(0.42, 10, 8), base, r * 0.55, 0.8 + h + 2.3, -r * 0.4);
  return { w: r * 2, d: r * 2, h };
}

// Style 3: cupcake house — fluted paper base, soft-serve frosting roof.
function houseCupcake(batch, base, rng) {
  const r = range(rng, 3.0, 3.7);
  const cup = range(rng, 2.4, 3.2);
  const cupColor = pick(rng, PASTEL);
  const frostColor = pick(rng, ['#ffd3e2', '#ffe8b8', '#cdf3d6', '#e6d6ff']);

  put(batch, 'pavement', disc(r + 1.0, 0.34, 24), base, 0, 0.17, 0);
  // fluted paper cup
  put(batch, `wafer|${cupColor}`, uvScale(cylinder(r, r * 0.82, cup, 26), 5, 1), base, 0, cup / 2 + 0.2, 0);
  put(batch, 'icing', ring(r * 0.83, 0.12, 24), base, 0, 0.24, 0, 0, Math.PI / 2, 0);
  // frosting: stacked soft-serve coils
  let y = cup + 0.2;
  let radius = r * 1.02;
  const coils = 3;
  for (let i = 0; i < coils; i++) {
    put(batch, `frosting|${frostColor}`, new THREE.TorusGeometry(radius, radius * 0.34, 10, 26),
      base, 0, y + radius * 0.18, 0, 0, Math.PI / 2, 0);
    y += radius * 0.42;
    radius *= 0.72;
  }
  put(batch, `frosting|${frostColor}`, dome(radius * 0.9, radius * 1.5, 18), base, 0, y, 0);
  // cherry
  put(batch, 'candy|#ff304d', new THREE.SphereGeometry(0.55, 14, 12), base, 0, y + radius * 1.5 + 0.4, 0);
  put(batch, 'chocolate', cylinder(0.05, 0.05, 0.6, 6), base, 0.1, y + radius * 1.5 + 1.0, 0, 0, 0.3, 0.2);
  // icing drips off the coils
  icingDrips(batch, base, r * 0.95, cup + 0.35, 14, rng, `frosting|${frostColor}`);

  door(batch, base, { z: r * 0.86, width: 1.4, height: 2.1, rng, knob: '#7cc6ff' });
  for (const a of [-0.7, 0.7]) {
    const x = Math.sin(a) * r * 0.9;
    const zz = Math.cos(a) * r * 0.9;
    put(batch, 'icing', disc(0.58, 0.12, 16), base, x, cup * 0.62 + 0.2, zz, a, Math.PI / 2, 0);
    put(batch, 'window', disc(0.45, 0.09, 16), base, x, cup * 0.62 + 0.2, zz, a, Math.PI / 2, 0);
  }
  return { w: r * 2, d: r * 2, h: cup + 3 };
}

// Style 4: chocolate chalet — chocolate block, wafer gable, peppermint accents.
function houseChalet(batch, base, rng) {
  const w = range(rng, 6.4, 7.8);
  const d = range(rng, 5.4, 6.4);
  const h = range(rng, 3.4, 4.2);

  put(batch, 'pavement', box(w + 1.2, 0.34, d + 1.2, 0.16), base, 0, 0.17, 0);
  put(batch, 'chocolate', uvScale(box(w, h, d, 0.35), 2, 1), base, 0, h / 2, 0);
  // chocolate bar grooves
  for (let i = 1; i < 4; i++) {
    put(batch, 'chocolate|#2a1208', box(0.09, h * 0.94, d + 0.04, 0.02), base,
      -w / 2 + (w / 4) * i, h / 2, 0);
  }
  // wafer gable roof
  const roofH = range(rng, 1.8, 2.6);
  put(batch, 'icing', box(w + 0.7, 0.28, d + 0.7, 0.1), base, 0, h + 0.1, 0);
  const pitch = Math.atan2(roofH, w / 2);
  for (const s of [-1, 1]) {
    const slab = uvScale(box(Math.hypot(w / 2, roofH) + 0.5, 0.28, d + 0.9, 0.1), 2, 1);
    put(batch, `wafer|${pick(rng, PASTEL)}`, slab, base,
      s * w * 0.25, h + 0.2 + roofH * 0.5, 0, 0, 0, -s * pitch);
  }
  // gable end triangles
  for (const s of [-1, 1]) {
    const tri = new THREE.CylinderGeometry(Math.hypot(w / 2, roofH) * 1.02, Math.hypot(w / 2, roofH) * 1.02, 0.25, 3, 1);
    put(batch, 'chocolate', tri, base, 0, h + roofH * 0.5, s * (d / 2 - 0.05), 0, 0, pitch);
  }
  put(batch, 'cane', cylinder(0.09, 0.09, Math.hypot(w / 2, roofH) + 0.8, 8), base,
    0, h + 0.2 + roofH * 0.5 + 0.2, d / 2 + 0.5, 0, 0, Math.PI / 2);
  // chimney
  put(batch, 'chocolate|#3d1d10', box(0.75, 1.8, 0.75, 0.1), base, w * 0.28, h + roofH * 0.8, -d * 0.15);
  put(batch, 'marshmallow', box(0.92, 0.24, 0.92, 0.08), base, w * 0.28, h + roofH * 0.8 + 0.9, -d * 0.15);
  // peppermint round window in the gable
  put(batch, 'icing', disc(0.56, 0.14, 18), base, 0, h + roofH * 0.5, d / 2 + 0.13, 0, Math.PI / 2, 0);
  put(batch, 'peppermint', disc(0.44, 0.1, 18), base, 0, h + roofH * 0.5, d / 2 + 0.16, 0, Math.PI / 2, 0);

  door(batch, base, { z: d / 2 + 0.02, width: 1.6, height: 2.3, color: 'chocolate|#3a1a0d', rng, knob: '#8ce99a' });
  addWindow(batch, base, -w * 0.3, h * 0.6, d / 2 + 0.05, 1.05, 1.2, 0, { rng, flowerBox: true });
  addWindow(batch, base, w * 0.3, h * 0.6, d / 2 + 0.05, 1.05, 1.2, 0, { rng });
  addWindow(batch, base, -w / 2 - 0.04, h * 0.6, 0, 0.9, 1.0, Math.PI / 2, { rng });
  addWindow(batch, base, w / 2 + 0.04, h * 0.6, 0, 0.9, 1.0, -Math.PI / 2, { rng });
  return { w, d, h: h + roofH };
}

// Style 5: wafer apartment — stacked floors, candy balconies, roof garden.
function houseApartment(batch, base, rng) {
  const w = range(rng, 6.2, 7.4);
  const d = range(rng, 5.4, 6.2);
  const floorH = 2.6;
  const floors = Math.round(range(rng, 2, 3.99));
  const tint = pick(rng, PASTEL);

  put(batch, 'pavement', box(w + 1.0, 0.34, d + 1.0, 0.16), base, 0, 0.17, 0);
  for (let f = 0; f < floors; f++) {
    const inset = f * 0.12;
    put(batch, `wafer|${tint}`, uvScale(box(w - inset, floorH, d - inset, 0.3), 2, 1), base,
      0, 0.3 + floorH / 2 + f * floorH, 0);
    put(batch, 'icing', box(w - inset + 0.25, 0.16, d - inset + 0.25, 0.06), base,
      0, 0.3 + floorH * (f + 1), 0);
    // balcony
    if (f > 0) {
      const bz = (d - inset) / 2 + 0.5;
      put(batch, 'icing', box(w * 0.6, 0.12, 1.1, 0.05), base, 0, 0.36 + floorH * f, bz);
      for (let i = 0; i < 5; i++) {
        put(batch, 'cane', cylinder(0.05, 0.05, 0.7, 6), base,
          -w * 0.27 + (i / 4) * w * 0.54, 0.72 + floorH * f, bz + 0.45);
      }
      put(batch, 'cane', cylinder(0.06, 0.06, w * 0.55, 6), base, 0, 1.06 + floorH * f, bz + 0.45, 0, 0, Math.PI / 2);
    }
    // window band
    const count = Math.floor(w / 1.8);
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + (i + 0.5) * (w / count);
      addWindow(batch, base, x, 0.3 + floorH * (f + 0.55), (d - inset) / 2 + 0.03, 0.85, 1.15, 0, { rng });
    }
  }
  const topY = 0.3 + floors * floorH;
  // flat gumdrop roof with a little garden
  put(batch, `gumdrop|${pick(rng, CANDY)}`, box(w * 0.95, 0.35, d * 0.95, 0.16), base, 0, topY + 0.15, 0);
  put(batch, 'chocolate', box(0.7, 1.1, 0.7, 0.1), base, w * 0.25, topY + 0.8, -d * 0.2);
  put(batch, 'marshmallow', box(0.86, 0.2, 0.86, 0.06), base, w * 0.25, topY + 1.4, -d * 0.2);
  // roof shrubs
  for (let i = 0; i < 3; i++) {
    put(batch, `gumdrop|${pick(rng, CANDY)}`, dome(0.42, 0.5, 10), base,
      -w * 0.3 + i * w * 0.22, topY + 0.3, d * 0.25);
  }
  door(batch, base, { z: d / 2 + 0.04, width: 1.3, height: 2.2, rng, knob: '#ff9f68' });
  return { w, d, h: topY };
}

// Style 6: ice-cream tower — a waffle cone drum with scoops on top.
function houseIceCream(batch, base, rng) {
  const r = range(rng, 2.9, 3.5);
  const h = range(rng, 7.0, 9.5);
  const scoopColors = ['#ffd3e2', '#cdf3d6', '#cfe9ff', '#ffe8b8'];

  put(batch, 'pavement', disc(r + 1.2, 0.34, 26), base, 0, 0.17, 0);
  put(batch, 'waffle', uvScale(cylinder(r, r * 0.72, h, 22), 5, 3), base, 0, h / 2 + 0.2, 0);
  put(batch, 'icing', ring(r * 0.74, 0.16, 22), base, 0, 0.2, 0, 0, Math.PI / 2, 0);
  // door + windows
  const zf = r * 0.86;
  door(batch, base, { z: zf, width: 1.3, height: 2.1, rng, knob: '#ff5d8f' });
  for (let f = 0; f < 3; f++) {
    for (const a of [-0.8, 0.8]) {
      const x = Math.sin(a) * r * 0.95;
      const zz = Math.cos(a) * r * 0.95;
      put(batch, 'icing', disc(0.5, 0.1, 14), base, x, 3.0 + f * 2.1, zz, a, Math.PI / 2, 0);
      put(batch, 'window', disc(0.38, 0.08, 14), base, x, 3.0 + f * 2.1, zz, a, Math.PI / 2, 0);
    }
  }
  // scoops
  let y = h + 0.25;
  let sr = r * 1.02;
  for (let i = 0; i < 3; i++) {
    put(batch, `frosting|${scoopColors[i % scoopColors.length]}`,
      new THREE.SphereGeometry(sr, 16, 12), base, 0, y + sr * 0.55, 0);
    y += sr * 0.95;
    sr *= 0.8;
  }
  put(batch, 'candy|#ff304d', new THREE.SphereGeometry(0.42, 12, 10), base, 0, y + 0.5, 0);
  put(batch, 'chocolate', cylinder(0.045, 0.045, 0.55, 6), base, 0.05, y + 1.0, 0, 0, 0.2, 0.15);
  // wafer stick
  put(batch, 'wafer', box(0.22, 2.2, 0.12, 0.04), base, r * 0.5, y - 0.4, r * 0.2, 0, 0, 0.32);
  // awning
  put(batch, 'caneMint', new THREE.CylinderGeometry(0.9, 0.9, r * 1.2, 12, 1, true, 0, Math.PI),
    base, 0, 2.7, zf + 0.4, Math.PI / 2, 0, Math.PI / 2);
  return { w: r * 2, d: r * 2, h: h + 2 };
}

// Style 7: lollipop pavilion — candy-cane columns under a swirl disc roof.
function houseLollipop(batch, base, rng) {
  const r = range(rng, 3.3, 4.0);
  const h = range(rng, 3.2, 4.0);
  const swirlKey = pick(rng, ['lollipopPink', 'lollipopBlue', 'lollipopMint', 'lollipopOrange']);
  put(batch, 'pavement', disc(r + 0.8, 0.34, 24), base, 0, 0.17, 0);
  // low wafer drum wall
  put(batch, `wafer|${pick(rng, PASTEL)}`, uvScale(cylinder(r, r, h, 22), 5, 1), base, 0, h / 2 + 0.3, 0);
  // columns
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    put(batch, 'cane', cylinder(0.16, 0.16, h + 0.6, 8), base,
      Math.cos(a) * (r + 0.22), (h + 0.6) / 2 + 0.2, Math.sin(a) * (r + 0.22));
  }
  // giant swirl roof
  put(batch, 'icing', disc(r + 0.65, 0.24, 26), base, 0, h + 0.7, 0);
  put(batch, swirlKey, uvScale(disc(r + 0.55, 0.22, 30), 1, 1), base, 0, h + 0.92, 0);
  put(batch, 'icing', ring(r + 0.55, 0.14, 30), base, 0, h + 1.03, 0, 0, Math.PI / 2, 0);
  put(batch, 'jawbreaker', new THREE.SphereGeometry(0.34, 10, 8), base, 0, h + 1.15, 0);
  // windows and door
  door(batch, base, { z: r + 0.03, width: 1.3, height: 2.1, rng, knob: '#7cc6ff' });
  for (const a of [-1.0, 1.0]) {
    const x = Math.sin(a) * (r + 0.04);
    const zz = Math.cos(a) * (r + 0.04);
    addWindow(batch, base, x, h * 0.6, zz, 0.95, 1.0, a, { rng });
  }
  return { w: r * 2, d: r * 2, h: h + 1.2 };
}

// Style 8: candy-corn cottage — banded cone, sugar-white tip.
function houseCandyCorn(batch, base, rng) {
  const r = range(rng, 3.4, 4.2);
  const h = range(rng, 5.0, 6.4);
  const bands = [
    { color: '#ffd166', from: 0, to: 0.42 },
    { color: '#ff9f68', from: 0.42, to: 0.72 },
    { color: '#fff6df', from: 0.72, to: 1 },
  ];
  put(batch, 'pavement', disc(r + 0.9, 0.34, 24), base, 0, 0.17, 0);
  for (const b of bands) {
    const y0 = b.from * h;
    const y1 = b.to * h;
    const r0 = r * (1 - b.from * 0.72);
    const r1 = r * (1 - b.to * 0.72);
    put(batch, `gumdrop|${b.color}`, cylinder(r1, r0, y1 - y0, 22), base, 0, 0.2 + (y0 + y1) / 2, 0);
    put(batch, 'icing', ring(r0 + 0.02, 0.08, 22), base, 0, 0.2 + y0, 0, 0, Math.PI / 2, 0);
  }
  put(batch, 'icing', new THREE.SphereGeometry(0.3, 10, 8), base, 0, 0.2 + h + 0.1, 0);
  door(batch, base, { z: r * 0.94, width: 1.3, height: 2.2, rng, knob: '#c9a0ff' });
  for (const a of [-0.75, 0.75]) {
    const x = Math.sin(a) * r * 0.9;
    const zz = Math.cos(a) * r * 0.9;
    put(batch, 'icing', disc(0.52, 0.1, 14), base, x, h * 0.22, zz, a, Math.PI / 2, 0);
    put(batch, 'window', disc(0.4, 0.08, 14), base, x, h * 0.22, zz, a, Math.PI / 2, 0);
  }
  addWindow(batch, base, 0, h * 0.5, r * 0.7, 0.9, 1.0, 0, { rng, flowerBox: true });
  return { w: r * 2, d: r * 2, h: h + 0.5 };
}

const HOUSE_STYLES = [
  houseGumdrop, houseGumdrop, houseGumdrop,
  houseCandyCane, houseCupcake, houseChalet,
  houseApartment, houseIceCream, houseLollipop, houseCandyCorn,
];

// ---------------------------------------------------------------------------
// trees & plants
// ---------------------------------------------------------------------------

function treeCottonCandy(batch, base, rng) {
  const h = range(rng, 1.6, 2.6);
  put(batch, 'cane', cylinder(0.16, 0.24, h + 0.7, 8), base, 0, (h + 0.7) / 2, 0);
  put(batch, `gumdrop|${pick(rng, CANDY)}`, dome(0.38, 0.28, 10), base, 0, 0.12, 0);
  const blobs = Math.round(range(rng, 3, 5.99));
  const color = pick(rng, ['#ffd3e2', '#cfe9ff', '#e6d6ff', '#ffe8b8', '#cdf3d6']);
  for (let i = 0; i < blobs; i++) {
    const a = rng() * TAU;
    const rr = i === 0 ? 0 : range(rng, 0.4, 1.2);
    const s = range(rng, 0.7, 1.15);
    put(batch, `cottonCandy|${color}`, new THREE.IcosahedronGeometry(s, 1), base,
      Math.cos(a) * rr, h + 0.8 + (i === 0 ? 0.55 : range(rng, -0.15, 0.85)), Math.sin(a) * rr,
      rng() * TAU, rng() * 0.6, rng() * 0.6);
  }
  // spun-sugar strands wrapped around the crown
  for (let i = 0; i < 3; i++) {
    const rr = range(rng, 0.7, 1.15);
    const strand = new THREE.TorusGeometry(rr, 0.045, 5, 22);
    put(batch, `candy|${pick(rng, ['#ffffff', '#fff1f6', color])}`, strand, base,
      0, h + 0.85 + i * 0.35, 0, rng() * TAU, 1.35 + rng() * 0.4, 0.3);
  }
  // sugar sparkle beads + jimmies
  for (let i = 0; i < 8; i++) {
    const a = rng() * TAU;
    const rr = range(rng, 0.55, 1.35);
    const y = h + 0.8 + range(rng, 0, 1.15);
    if (i % 2 === 0) {
      put(batch, `candy|${pick(rng, CANDY)}`, new THREE.SphereGeometry(0.08, 6, 5), base,
        Math.cos(a) * rr, y, Math.sin(a) * rr);
    } else {
      put(batch, `candy|${pick(rng, CANDY)}`, cylinder(0.045, 0.045, 0.28, 4), base,
        Math.cos(a) * rr, y, Math.sin(a) * rr, rng() * TAU, rng() * TAU, 0);
    }
  }
}

function treeLollipop(batch, base, rng) {
  const h = range(rng, 2.4, 3.4);
  const swirlKey = pick(rng, ['lollipopPink', 'lollipopBlue', 'lollipopMint', 'lollipopOrange']);
  put(batch, 'icing', cylinder(0.1, 0.12, h + 0.5, 8), base, 0, (h + 0.5) / 2, 0);
  put(batch, 'peppermint', disc(1.0, 0.26, 24), base, 0, h + 0.6, 0, rng() * TAU, 0.18, 0.1);
  put(batch, swirlKey, disc(0.82, 0.28, 24), base, 0, h + 0.6, 0, rng() * TAU, 0.18, 0.1);
  put(batch, 'icing', ring(0.92, 0.1, 24), base, 0, h + 0.6, 0, 0, Math.PI / 2, 0);
  put(batch, 'candy|#ff304d', new THREE.SphereGeometry(0.16, 8, 6), base, 0, h + 0.78, 0);
}

function treePeppermint(batch, base, rng) {
  const h = range(rng, 1.4, 2.2);
  put(batch, 'chocolate', cylinder(0.18, 0.26, h + 0.4, 8), base, 0, (h + 0.4) / 2, 0);
  const r = range(rng, 1.0, 1.4);
  put(batch, 'peppermint', new THREE.SphereGeometry(r, 18, 14), base, 0, h + r * 0.75, 0, 0, 0, 0, 1, 1.15, 1);
  put(batch, 'icing', ring(r * 0.28, 0.06, 14), base, 0, h + r * 0.75, r * 0.92, 0, Math.PI / 2, 0);
  put(batch, `candy|${pick(rng, CANDY)}`, new THREE.SphereGeometry(0.12, 8, 6), base, 0, h + r * 1.9, 0);
}

function treeCandyCorn(batch, base, rng) {
  const h = range(rng, 2.0, 3.2);
  const r = range(rng, 0.8, 1.2);
  put(batch, 'icing', cylinder(0.12, 0.16, h, 8), base, 0, h / 2, 0, 0, 0, 0);
  put(batch, 'gumdrop|#ffd166', cylinder(r, r * 0.9, h * 0.42, 14), base, 0, h + h * 0.21, 0);
  put(batch, 'gumdrop|#ff9f68', cylinder(r * 0.72, r, h * 0.32, 14), base, 0, h + h * 0.42 + h * 0.16, 0);
  put(batch, 'gumdrop|#fff6df', new THREE.ConeGeometry(r * 0.72, h * 0.36, 14), base, 0, h + h * 0.74 + h * 0.18, 0);
  put(batch, 'icing', new THREE.SphereGeometry(0.13, 8, 6), base, 0, h + h * 1.0, 0);
}

function treeMarshmallow(batch, base, rng) {
  const h = range(rng, 2.0, 2.8);
  put(batch, 'chocolate', cylinder(0.2, 0.3, h + 0.5, 8), base, 0, (h + 0.5) / 2, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng();
    put(batch, 'marshmallow', new THREE.SphereGeometry(range(rng, 0.55, 0.85), 12, 10), base,
      Math.cos(a) * 0.5, h + 0.7 + i * 0.32, Math.sin(a) * 0.5, 0, 0, 0, 1, 1.15, 1);
  }
}

function bushJellyBeans(batch, base, rng) {
  const count = Math.round(range(rng, 5, 9.99));
  const color = pick(rng, CANDY);
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const rr = range(rng, 0, 0.7);
    put(batch, i === 0 ? `jellyBean|${color}` : `gummy|${pick(rng, CANDY)}`,
      new THREE.SphereGeometry(1, 10, 8), base,
      Math.cos(a) * rr, range(rng, 0.16, 0.5), Math.sin(a) * rr,
      rng() * TAU, rng() * 0.4, rng() * 0.4,
      range(rng, 0.22, 0.4), range(rng, 0.16, 0.3), range(rng, 0.3, 0.5));
  }
}

function bushGumdrop(batch, base, rng) {
  const count = Math.round(range(rng, 4, 7.99));
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const rr = range(rng, 0, 0.8);
    const s = range(rng, 0.24, 0.44);
    put(batch, `gumdrop|${pick(rng, CANDY)}`, dome(s, s * 1.2, 10), base,
      Math.cos(a) * rr, 0.02, Math.sin(a) * rr);
  }
}

const TREE_BUILDERS = [
  treeCottonCandy, treeCottonCandy, treeLollipop, treePeppermint,
  treeCandyCorn, treeMarshmallow, bushJellyBeans, bushGumdrop,
];

// ---------------------------------------------------------------------------
// street furniture
// ---------------------------------------------------------------------------

const LAMP_SPOTS = [];

function streetLamp(batch, base, rng) {
  LAMP_SPOTS.push(new THREE.Vector3().setFromMatrixPosition(base));
  const h = range(rng, 3.4, 4.2);
  const stripe = pick(rng, ['cane', 'caneBlue', 'caneMint', 'cane']);
  // candy-cane post with a hooked cane arm
  put(batch, stripe, cylinder(0.11, 0.16, h, 10), base, 0, h / 2, 0);
  put(batch, 'icing', disc(0.34, 0.16, 12), base, 0, 0.08, 0);
  put(batch, 'jawbreaker', new THREE.SphereGeometry(0.28, 12, 10), base, 0, 0.36, 0);
  put(batch, stripe, new THREE.TorusGeometry(0.52, 0.1, 6, 14, Math.PI * 0.55), base,
    0.5, h - 0.05, 0, 0, 0, Math.PI * 0.45);
  put(batch, 'icing', new THREE.SphereGeometry(0.14, 8, 6), base, 1.0, h + 0.1, 0);
  // hanging sugar globe
  put(batch, 'icing', cylinder(0.03, 0.03, 0.22, 5), base, 1.0, h - 0.06, 0);
  put(batch, `lamp|${pick(rng, ['#fff2c9', '#ffd6e8', '#d6f3ff'])}`, dome(0.42, 0.6, 14), base, 1.0, h - 0.2, 0);
  put(batch, `lamp|#fff2c9`, new THREE.SphereGeometry(0.3, 12, 10), base, 1.0, h - 0.5, 0, 0, 0, 0, 1, 1.2, 1);
  put(batch, 'icing', new THREE.SphereGeometry(0.1, 6, 5), base, 1.0, h + 0.42, 0);
}

function bench(batch, base, rng) {
  const color = pick(rng, ['#5a3a2a', '#7a4a8f', '#2f4a6a']);
  put(batch, `chocolate|${color}`, box(2.4, 0.16, 0.7, 0.05), base, 0, 0.55, 0);
  put(batch, `chocolate|${color}`, box(2.4, 0.6, 0.14, 0.05), base, 0, 0.9, -0.3);
  for (const s of [-1, 1]) {
    put(batch, 'cane', cylinder(0.08, 0.08, 0.55, 6), base, s * 0.9, 0.28, 0.22);
    put(batch, 'cane', cylinder(0.08, 0.08, 0.55, 6), base, s * 0.9, 0.28, -0.22);
  }
  put(batch, 'icing', box(2.0, 0.04, 0.5, 0.02), base, 0, 0.64, 0.02);
}

function mailbox(batch, base, rng) {
  put(batch, 'cane', cylinder(0.08, 0.08, 1.4, 6), base, 0, 0.7, 0);
  put(batch, `gumdrop|${pick(rng, CANDY)}`, box(0.6, 0.4, 0.4, 0.14), base, 0, 1.5, 0);
  put(batch, 'icing', new THREE.SphereGeometry(0.1, 6, 5), base, 0.22, 1.6, 0);
}

function bollard(batch, base, rng) {
  put(batch, 'icing', cylinder(0.16, 0.16, 0.28, 10), base, 0, 0.14, 0);
  put(batch, 'jawbreaker', new THREE.SphereGeometry(0.22, 10, 8), base, 0, 0.4, 0);
}

function fenceRun(batch, base, from, to, rng) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const posts = Math.max(2, Math.round(len / 1.5));
  const angle = Math.atan2(dx, dz);
  const color = pick(rng, ['cane', 'caneBlue', 'caneMint']);
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    const x = from[0] + dx * t;
    const z = from[1] + dz * t;
    put(batch, color, cylinder(0.07, 0.07, 0.9, 6), base, x, 0.45, z);
    put(batch, 'icing', new THREE.SphereGeometry(0.09, 6, 5), base, x, 0.92, z);
  }
  for (const y of [0.35, 0.68]) {
    put(batch, `icing|#fff2e4`, box(0.09, 0.09, len, 0.03), base,
      (from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2, angle);
  }
  // little gumdrop finials at both ends
  put(batch, `gumdrop|#ffc3d9`, dome(0.13, 0.2, 8), base, from[0], 0.95, from[1]);
  put(batch, `gumdrop|#ffc3d9`, dome(0.13, 0.2, 8), base, to[0], 0.95, to[1]);
}

function candyCar(batch, base, rng) {
  const color = pick(rng, CANDY);
  put(batch, `gummy|${color}`, box(3.0, 0.85, 1.7, 0.35), base, 0, 0.75, 0);
  put(batch, `glass`, box(1.4, 0.7, 1.5, 0.3), base, -0.15, 1.35, 0);
  put(batch, 'marshmallow', box(1.5, 0.22, 1.6, 0.16), base, -0.15, 1.72, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(batch, 'peppermint', cylinder(0.42, 0.42, 0.24, 14), base, sx * 0.95, 0.42, sz * 0.85, 0, Math.PI / 2, 0);
      put(batch, 'icing', cylinder(0.18, 0.18, 0.27, 10), base, sx * 0.95, 0.42, sz * 0.85, 0, Math.PI / 2, 0);
    }
  }
  put(batch, 'candy|#fff3b0', new THREE.SphereGeometry(0.15, 8, 6), base, 1.45, 0.8, 0.55);
  put(batch, 'candy|#fff3b0', new THREE.SphereGeometry(0.15, 8, 6), base, 1.45, 0.8, -0.55);
  put(batch, 'candy|#ff5d8f', new THREE.SphereGeometry(0.12, 8, 6), base, -1.45, 0.8, 0.55);
  put(batch, 'candy|#ff5d8f', new THREE.SphereGeometry(0.12, 8, 6), base, -1.45, 0.8, -0.55);
}

// ---------------------------------------------------------------------------
// roads
// ---------------------------------------------------------------------------

function ribbonGeometry(points, inner, outer, y, vTile = 9) {
  const pos = [];
  const uv = [];
  const nrm = [];
  const idx = [];
  let dist = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    if (i > 0) dist += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    pos.push(p.x + nx * inner, y, p.z + nz * inner);
    pos.push(p.x + nx * outer, y, p.z + nz * outer);
    nrm.push(0, 1, 0, 0, 1, 0);
    uv.push(0, dist / vTile);
    uv.push(1, dist / vTile);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function roadCurve(a, b, rng, bend = 0.08) {
  const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const off = (rng() - 0.5) * 2 * bend * len;
  mid.x += nx * off;
  mid.z += nz * off;
  const curve = new THREE.CatmullRomCurve3([a.clone(), mid, b.clone()], false, 'catmullrom', 0.5);
  return curve.getPoints(22);
}

// ---------------------------------------------------------------------------
// main build
// ---------------------------------------------------------------------------

export function buildCandyCity({ seed = 20260101, textures = null } = {}) {
  const rng = mulberry32(seed);
  LAMP_SPOTS.length = 0;
  const batch = new Batch();
  const materials = createMaterials(textures);
  const group = new THREE.Group();
  group.name = 'CandyCity';

  const GRID = 7;
  const SPACING = 34;
  const HALF = ((GRID - 1) * SPACING) / 2;
  const ROAD_HALF = 4.6;
  const WALK = 3.4;

  const stats = {
    seed,
    blocks: 0,
    houses: 0,
    parks: 0,
    trees: 0,
    lamps: 0,
    beans: 0,
    sprinkles: 0,
    cars: 0,
    meshes: 0,
    pieces: 0,
    triangles: 0,
  };

  // --- nodes and roads -----------------------------------------------------
  const nodes = [];
  for (let j = 0; j < GRID; j++) {
    const row = [];
    for (let i = 0; i < GRID; i++) {
      const jitter = SPACING * 0.13;
      row.push(new THREE.Vector3(
        i * SPACING - HALF + (rng() - 0.5) * jitter,
        0,
        j * SPACING - HALF + (rng() - 0.5) * jitter,
      ));
    }
    nodes.push(row);
  }

  const beanPositions = [];
  const sprinklePositions = [];
  const sprinkleColors = [];

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const pts = roadCurve(nodes[j][i], nodes[j][i + 1], rng, 0.05);
      batch.add('road', ribbonGeometry(pts, -ROAD_HALF, ROAD_HALF, 0.055), IDENTITY);
      batch.add('pavement', ribbonGeometry(pts, ROAD_HALF, ROAD_HALF + WALK, 0.17), IDENTITY);
      batch.add('pavement', ribbonGeometry(pts, -ROAD_HALF - WALK, -ROAD_HALF, 0.17), IDENTITY);
      // candy-cane kerbs
      batch.add('cane', ribbonGeometry(pts, ROAD_HALF - 0.05, ROAD_HALF + 0.12, 0.19, 3), IDENTITY);
      batch.add('cane', ribbonGeometry(pts, -ROAD_HALF - 0.12, -ROAD_HALF + 0.05, 0.19, 3), IDENTITY);
      // lamp posts + beans along the verge
      for (const t of [0.3, 0.7]) {
        const p = pts[Math.round(t * (pts.length - 1))];
        const side = t > 0.5 ? 1 : -1;
        const idx = Math.round(t * (pts.length - 1));
        const p2 = pts[Math.min(pts.length - 1, idx + 1)];
        const ang = Math.atan2(p2.x - p.x, p2.z - p.z);
        const nx = Math.cos(ang) * (ROAD_HALF + WALK * 0.55) * side;
        const nz = -Math.sin(ang) * (ROAD_HALF + WALK * 0.55) * side;
        // street lamps only on one side, staggered
        if ((i + j) % 2 === 0) {
          streetLamp(batch, localMatrix(p.x + nx, 0.17, p.z + nz, ang), rng);
          stats.lamps++;
        }
        bollard(batch, localMatrix(p.x + nx * 0.86, 0.19, p.z + nz * 0.86, ang), rng);
      }
    }
    for (let i = 0; i < GRID - 1; i++) {
      // vertical streets (columns)
      const a = nodes[i][j];
      const b = nodes[i + 1][j];
      const pts = roadCurve(a, b, rng, 0.05);
      batch.add('road', ribbonGeometry(pts, -ROAD_HALF, ROAD_HALF, 0.058), IDENTITY);
      batch.add('pavement', ribbonGeometry(pts, ROAD_HALF, ROAD_HALF + WALK, 0.17), IDENTITY);
      batch.add('pavement', ribbonGeometry(pts, -ROAD_HALF - WALK, -ROAD_HALF, 0.17), IDENTITY);
      batch.add('cane', ribbonGeometry(pts, ROAD_HALF - 0.05, ROAD_HALF + 0.12, 0.19, 3), IDENTITY);
      batch.add('cane', ribbonGeometry(pts, -ROAD_HALF - 0.12, -ROAD_HALF + 0.05, 0.19, 3), IDENTITY);
      for (const t of [0.35, 0.75]) {
        const p = pts[Math.round(t * (pts.length - 1))];
        const side = t > 0.5 ? -1 : 1;
        const idx = Math.round(t * (pts.length - 1));
        const p2 = pts[Math.min(pts.length - 1, idx + 1)];
        const ang = Math.atan2(p2.x - p.x, p2.z - p.z);
        const nx = Math.cos(ang) * (ROAD_HALF + WALK * 0.55) * side;
        const nz = -Math.sin(ang) * (ROAD_HALF + WALK * 0.55) * side;
        bollard(batch, localMatrix(p.x + nx * 0.86, 0.19, p.z + nz * 0.86, ang), rng);
      }
    }
  }

  // intersection patches + jelly-bean crosswalks
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const p = nodes[j][i];
      const patch = new THREE.PlaneGeometry(ROAD_HALF * 2.4, ROAD_HALF * 2.4);
      put(batch, 'road', patch, IDENTITY, p.x, 0.052, p.z, 0, -Math.PI / 2, 0);
      for (let dir = 0; dir < 4; dir++) {
        const a = (dir * Math.PI) / 2;
        const nx = Math.sin(a);
        const nz = Math.cos(a);
        for (let k = -3; k <= 3; k++) {
          const lateral = k * 1.15;
          const along = ROAD_HALF + 1.6;
          beanPositions.push({
            x: p.x + nx * along + Math.cos(a) * lateral,
            z: p.z + nz * along - Math.sin(a) * lateral,
            y: 0.12,
            angle: a,
            color: pick(rng, CANDY),
          });
          stats.beans++;
        }
      }
    }
  }

  // --- ground and hills ----------------------------------------------------
  const groundGeo = new THREE.CircleGeometry(1600, 96, 0, TAU);
  uvScale(groundGeo, 46, 46);
  put(batch, 'ground', groundGeo, IDENTITY, 0, 0, 0, 0, -Math.PI / 2, 0);
  // a second, brighter sugar ring just outside the town for depth
  const ringGeo = new THREE.RingGeometry(116, 1600, 96, 1);
  uvScale(ringGeo, 34, 34);
  put(batch, 'grass|#a9efc9', ringGeo, IDENTITY, 0, 0.02, 0, 0, -Math.PI / 2, 0);
  // strawberry-syrup country lanes running out of town
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.22;
    const from = new THREE.Vector3(Math.cos(a) * 118, 0, Math.sin(a) * 118);
    const to = new THREE.Vector3(Math.cos(a) * 420, 0, Math.sin(a) * 420);
    const pts = roadCurve(from, to, rng, 0.12);
    batch.add('road', ribbonGeometry(pts, -3.4, 3.4, 0.05), IDENTITY);
  }

  // rolling gumdrop hills beyond the city edge (lumpy clusters, not pancakes)
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU + rng() * 0.18;
    const dist = range(rng, 150, 330);
    const cluster = Math.round(range(rng, 2, 4.99));
    for (let k = 0; k < cluster; k++) {
      const ja = a + range(rng, -0.09, 0.09);
      const jd = dist + range(rng, -22, 22);
      const r = range(rng, 12, 34);
      const squash = range(rng, 0.5, 0.85);
      const stretch = range(rng, 0.9, 1.35);
      const phase = range(rng, 0, 10);
      const hill = new THREE.IcosahedronGeometry(1, 3);
      const pos = hill.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        const z = pos.getZ(v);
        const wobble = 1 + 0.12 * Math.sin(x * 5.1 + z * 3.7 + phase) + 0.07 * Math.sin(z * 8.3 - x * 6.1 + phase);
        pos.setXYZ(v, x * r * wobble, Math.max(-0.9, y) * squash * r, z * r * stretch * wobble);
      }
      hill.computeVertexNormals();
      put(batch, `gumdrop|${pick(rng, ['#ffc3d9', '#bcdcff', '#ffe2a6', '#bff0cf', '#dcc4ff'])}`,
        hill, IDENTITY, Math.cos(ja) * jd, -r * 0.12, Math.sin(ja) * jd, rng() * TAU, 0, 0);
      // mint sugar trees dotted over the hills
      if (rng() < 0.6) {
        const tr = TREE_BUILDERS[Math.floor(rng() * 4)];
        tr(batch, localMatrix(
          Math.cos(ja) * jd + range(rng, -r * 0.4, r * 0.4),
          range(rng, 1, 5),
          Math.sin(ja) * jd + range(rng, -r * 0.4, r * 0.4),
          rng() * TAU, 0, 0, range(rng, 1.1, 1.9), range(rng, 1.1, 1.9), range(rng, 1.1, 1.9),
        ), rng);
      }
    }
  }

  // --- blocks --------------------------------------------------------------
  const centerBlock = Math.floor((GRID - 1) / 2);
  const blocks = [];
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const quad = [nodes[j][i], nodes[j][i + 1], nodes[j + 1][i + 1], nodes[j + 1][i]];
      const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
      const cz = quad.reduce((s, p) => s + p.z, 0) / 4;
      blocks.push({ i, j, cx, cz, quad });
    }
  }
  stats.blocks = blocks.length;

  // the plaza replaces one central block
  const plazaIndex = blocks.findIndex((b) => b.i === centerBlock && b.j === centerBlock);
  const plaza = blocks[plazaIndex];
  blocks.splice(plazaIndex, 1);
  buildPlaza(batch, plaza.cx, plaza.cz, rng, stats);

  blocks.forEach((block) => {
    const { cx, cz } = block;
    const usable = (SPACING - 2 * (ROAD_HALF + WALK) - 2) / 2; // half-extent of a lot
    const isPark = rng() < 0.18;
    const rot = Math.floor(rng() * 4) * (Math.PI / 2);

    const padSize = SPACING - 2 * (ROAD_HALF + WALK) + 0.4;
    const pad = new THREE.PlaneGeometry(padSize, padSize);
    uvScale(pad, 5, 5);
    const lawn = pick(rng, [
      'grass|#9fe8c0', 'grass|#a9efc9', 'grass|#ffe9a8', 'grass|#ffe9a8',
      'grass|#ffc9dd', 'grass|#d5c2ff', 'grass|#b9dcff',
      'sprinklesGround', 'sprinklesGround', 'pavement',
    ]);
    put(batch, lawn, pad, IDENTITY, cx, 0.19, cz, rot, -Math.PI / 2, 0);
    // icing kerb around the lot
    for (const s2 of [-1, 1]) {
      put(batch, 'icing', box(padSize, 0.18, 0.34, 0.08), IDENTITY, cx, 0.22, cz + s2 * padSize / 2, rot);
      put(batch, 'icing', box(0.34, 0.18, padSize, 0.08), IDENTITY, cx + s2 * padSize / 2, 0.22, cz, rot);
    }

    if (isPark) {
      stats.parks++;
      stats.lots = (stats.lots || 0) + 1;
      // gazebo or picnic spot
      if (rng() < 0.55) {
        gazebo(batch, localMatrix(cx, 0.2, cz, rot), rng);
      } else {
        for (let k = 0; k < 3; k++) {
          bench(batch, localMatrix(cx + range(rng, -usable * 0.5, usable * 0.5), 0.2,
            cz + range(rng, -usable * 0.5, usable * 0.5), rng() * TAU), rng);
        }
      }
      const treeCount = Math.round(range(rng, 5, 9.99));
      for (let k = 0; k < treeCount; k++) {
        const a = rng() * TAU;
        const rr = Math.sqrt(rng()) * usable * 0.82;
        const builder = TREE_BUILDERS[Math.floor(rng() * TREE_BUILDERS.length)];
        const sc = range(rng, 1.15, 1.9);
        builder(batch, localMatrix(cx + Math.cos(a) * rr, 0.2, cz + Math.sin(a) * rr, rng() * TAU, 0, 0,
          sc, range(rng, 1.05, 1.4) * sc, sc), rng);
        stats.trees++;
      }
      // gumdrop rocks & a jelly-bean flower border
      for (let k = 0; k < 4; k++) {
        const a = rng() * TAU;
        put(batch, `gumdrop|${pick(rng, PASTEL)}`, new THREE.IcosahedronGeometry(range(rng, 0.5, 1.1), 0),
          IDENTITY, cx + Math.cos(a) * usable * 0.7, 0.4, cz + Math.sin(a) * usable * 0.7,
          rng() * TAU, rng(), rng());
      }
      for (let k = 0; k < 10; k++) {
        const t = k / 9;
        beanPositions.push({
          x: cx + (t - 0.5) * usable * 1.7,
          z: cz + usable * 0.86,
          y: 0.26,
          angle: rng() * TAU,
          color: pick(rng, CANDY),
        });
        stats.beans++;
      }
      return;
    }

    // residential lot
    const styleIndex = Math.floor(rng() * HOUSE_STYLES.length);
    const style = HOUSE_STYLES[styleIndex];
    const houseBase = localMatrix(cx + range(rng, -0.6, 0.6), 0.2, cz + range(rng, -0.6, 0.6), rot);
    const footprint = style(batch, houseBase, rng);
    stats.houses++;
    stats.lots = (stats.lots || 0) + 1;

    // front path of jawbreaker stepping stones + fence with a gate gap
    const halfW = Math.max(footprint.w, footprint.d) / 2;
    const lotHalf = Math.max(usable, halfW + 1.6);
    for (let k = 0; k < 5; k++) {
      const z = halfW + 0.9 + k * 0.95;
      if (z > lotHalf + 2) break;
      put(batch, 'jawbreaker', disc(range(rng, 0.3, 0.45), 0.1, 12), IDENTITY,
        cx + Math.sin(rot) * 0 + (k % 2 === 0 ? 0.2 : -0.2), 0.23, cz + z + 0.2);
    }

    const inset = usable - 0.35;
    const corners = [
      [cx - inset, cz - inset], [cx + inset, cz - inset],
      [cx + inset, cz + inset], [cx - inset, cz + inset],
    ];
    for (let side = 0; side < 4; side++) {
      const a = corners[side];
      const b = corners[(side + 1) % 4];
      if (side === 0) continue; // leave one side open for the path
      if (rng() < 0.35) continue;
      fenceRun(batch, localMatrix(0, 0.2, 0, 0), a, b, rng);
    }
    // yard trees, shrubs and props
    const spots = [
      [cx - inset * 0.62, cz + inset * 0.62],
      [cx + inset * 0.62, cz + inset * 0.62],
      [cx - inset * 0.68, cz - inset * 0.55],
      [cx + inset * 0.68, cz - inset * 0.55],
    ];
    const yardCount = Math.round(range(rng, 2, 5.99));
    for (let k = 0; k < yardCount; k++) {
      const s = spots[k % spots.length];
      const jx = s[0] + range(rng, -1.2, 1.2);
      const jz = s[1] + range(rng, -1.2, 1.2);
      if (Math.abs(jx - cx) < halfW + 1 || Math.abs(jz - cz) < halfW + 1) continue;
      const builder = TREE_BUILDERS[Math.floor(rng() * TREE_BUILDERS.length)];
      const sc = range(rng, 1.1, 1.7);
      builder(batch, localMatrix(jx, 0.2, jz, rng() * TAU, 0, 0, sc, range(rng, 1.0, 1.35) * sc, sc), rng);
      stats.trees++;
    }
    for (let k = 0; k < 2; k++) {
      const s = spots[(k + 1) % spots.length];
      bushGumdrop(batch, localMatrix(s[0], 0.2, s[1], rng() * TAU), rng);
    }
    if (rng() < 0.7) mailbox(batch, localMatrix(cx + inset * 0.5, 0.2, cz + inset * 0.6, rng() * TAU), rng);
    if (rng() < 0.45) bench(batch, localMatrix(cx - inset * 0.45, 0.2, cz + inset * 0.5, rot + Math.PI), rng);
    if (rng() < 0.4) {
      candyCar(batch, localMatrix(cx + range(rng, -inset, inset), 0.2, cz + inset * 0.9, rot + (rng() < 0.5 ? 0 : Math.PI)), rng);
      stats.cars++;
    }
    // tidy little lamp by the gate
    if (rng() < 0.5) {
      streetLamp(batch, localMatrix(cx + inset * 0.8, 0.2, cz + inset * 0.8, rng() * TAU), rng);
      stats.lamps++;
    }
    // scattered sprinkles in gardens
    for (let k = 0; k < 26; k++) {
      sprinklePositions.push({
        x: cx + range(rng, -usable, usable),
        z: cz + range(rng, -usable, usable),
        y: 0.24,
        angle: rng() * TAU,
        tilt: rng() * 0.4,
        color: pick(rng, CANDY),
      });
    }
  });

  // street trees: one row per pavement, planted between lamp posts
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = nodes[j][i];
      const b = nodes[j][i + 1];
      const pts = roadCurve(a, b, rng, 0.05);
      for (const t of [0.16, 0.5, 0.84]) {
        const p = pts[Math.round(t * (pts.length - 1))];
        const idx = Math.round(t * (pts.length - 1));
        const p2 = pts[Math.min(pts.length - 1, idx + 1)];
        const ang = Math.atan2(p2.x - p.x, p2.z - p.z);
        for (const side of [-1, 1]) {
          if (rng() < 0.35) continue;
          const off = (ROAD_HALF + WALK * 0.72) * side;
          const x = p.x + Math.cos(ang) * off;
          const z = p.z - Math.sin(ang) * off;
          const builder = TREE_BUILDERS[Math.floor(rng() * TREE_BUILDERS.length)];
          const sc = range(rng, 0.95, 1.35);
          builder(batch, localMatrix(x, 0.19, z, rng() * TAU, 0, 0, sc, sc * range(rng, 1, 1.25), sc), rng);
          stats.trees++;
        }
      }
      // and the same rows on the north-south streets
      const a2 = nodes[i][j];
      const b2 = nodes[i + 1][j];
      const pts2 = roadCurve(a2, b2, rng, 0.05);
      for (const t of [0.33, 0.67]) {
        const p = pts2[Math.round(t * (pts2.length - 1))];
        const idx = Math.round(t * (pts2.length - 1));
        const p2 = pts2[Math.min(pts2.length - 1, idx + 1)];
        const ang = Math.atan2(p2.x - p.x, p2.z - p.z);
        for (const side of [-1, 1]) {
          if (rng() < 0.4) continue;
          const off = (ROAD_HALF + WALK * 0.72) * side;
          const builder = TREE_BUILDERS[Math.floor(rng() * TREE_BUILDERS.length)];
          const sc = range(rng, 0.95, 1.3);
          builder(batch, localMatrix(p.x + Math.cos(ang) * off, 0.19, p.z - Math.sin(ang) * off,
            rng() * TAU, 0, 0, sc, sc, sc), rng);
          stats.trees++;
        }
      }
    }
  }

  // parked cars along the wider streets
  for (let k = 0; k < 6; k++) {
    const row = 1 + Math.floor(rng() * (GRID - 2));
    const col = 1 + Math.floor(rng() * (GRID - 2));
    const p = nodes[row][col];
    const angle = rng() < 0.5 ? 0 : Math.PI / 2;
    const offset = (rng() < 0.5 ? -1 : 1) * (ROAD_HALF + 1.2);
    candyCar(batch, localMatrix(p.x + (angle === 0 ? 0 : offset), 0.06, p.z + (angle === 0 ? offset : 0), angle + Math.PI / 2), rng);
    stats.cars++;
  }

  // sugar motes across the town square
  for (let k = 0; k < 9000; k++) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * 125;
    sprinklePositions.push({
      x: Math.cos(a) * rr,
      z: Math.sin(a) * rr,
      y: 0.11,
      angle: rng() * TAU,
      tilt: 0,
      color: pick(rng, CANDY),
    });
  }

  // --- jelly beans & sprinkles (instanced) ---------------------------------
  const beanGroup = buildBeans(beanPositions, materials);
  group.add(beanGroup);
  const sprinkleMesh = buildSprinkles(sprinklePositions, materials);
  group.add(sprinkleMesh);
  // crosswalks are counted while laying out; count garden beans from the same list to stay exact
  stats.instancedBeanCount = beanPositions.length;
  stats.sprinkles = sprinklePositions.length;

  // --- clouds (animated, kept out of the merge) ----------------------------
  const clouds = buildClouds(materials, rng);
  group.add(clouds);

  // --- bake the static batches --------------------------------------------
  stats.meshes = batch.build(materials, group);
  stats.pieces = batch.pieces;

  group.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      const index = obj.geometry.index;
      const count = index ? index.count : obj.geometry.attributes.position.count;
      stats.triangles += Math.floor(count / 3);
    }
  });

  function update(time) {
    clouds.position.x = Math.sin(time * 0.02) * 6;
    clouds.position.z = Math.cos(time * 0.014) * 4;
    clouds.children.forEach((cloud, i) => {
      cloud.position.y = cloud.userData.baseY + Math.sin(time * 0.35 + i) * 0.8;
      cloud.rotation.y = time * 0.01 * (i % 2 ? 1 : -1);
    });
    materials.setNight(group.userData.night ?? 0);
  }

  group.userData = {
    stats,
    materials,
    update,
    lampSpots: LAMP_SPOTS.slice(),
    night: 0,
    setNight(t) {
      group.userData.night = t;
      materials.setNight(t);
    },
    dispose() {
      group.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    },
  };

  return group;
}

// ---------------------------------------------------------------------------
// instanced detail
// ---------------------------------------------------------------------------

function buildBeans(list, materials) {
  const geo = beanGeo();
  const mat = materials.get('jellyBean', { vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  list.forEach((b, i) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.angle, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(b.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'jellyBeans';
  return mesh;
}

function buildSprinkles(list, materials) {
  const geo = sprinkleGeo();
  const mat = materials.get('candy', { vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  list.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(Math.PI / 2 + (s.tilt || 0), s.angle, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(s.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'sprinkles';
  return mesh;
}

// ---------------------------------------------------------------------------
// clouds
// ---------------------------------------------------------------------------

function buildClouds(materials, rng) {
  const clouds = new THREE.Group();
  clouds.name = 'SugarClouds';
  const mat = materials.get('marshmallow', { vertexColors: false });
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 7 + Math.floor(rng() * 6);
    const parts = [];
    for (let p = 0; p < puffs; p++) {
      const t = p / puffs;
      const radius = range(rng, 3.0, 6.4) * (1 - t * 0.25);
      const geo = new THREE.IcosahedronGeometry(radius, 1);
      // puffs spread wide, stack in the middle and stay round underneath
      const spread = 1 - Math.abs(t - 0.5) * 1.2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(range(rng, -9, 9) * spread, range(rng, 0, 2.6), range(rng, -5, 5)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng(), rng())),
        new THREE.Vector3(1, range(rng, 0.72, 0.92), 1),
      );
      geo.applyMatrix4(m);
      parts.push(geo);
    }
    let merged = null;
    try {
      merged = mergeGeometries(parts, false);
    } catch (e) {
      merged = parts[0];
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.receiveShadow = false;
    cloud.add(mesh);
    const a = (i / 14) * TAU + rng() * 0.5;
    const dist = range(rng, 60, 260);
    cloud.position.set(Math.cos(a) * dist, range(rng, 58, 122), Math.sin(a) * dist);
    const tint = new THREE.Color(pick(rng, ['#fffafd', '#fff4f8', '#fdf7ff', '#fffaf2', '#f6f9ff']));
    cloud.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.copy(tint);
        o.material.vertexColors = false;
      }
    });
    cloud.userData.baseY = cloud.position.y;
    clouds.add(cloud);
    parts.forEach((g) => { if (g !== merged) g.dispose(); });
  }
  return clouds;
}

// ---------------------------------------------------------------------------
// park gazebo + central plaza
// ---------------------------------------------------------------------------

function gazebo(batch, base, rng) {
  const r = 2.6;
  put(batch, 'pavement', disc(r + 0.6, 0.3, 20), base, 0, 0.15, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    put(batch, 'cane', cylinder(0.12, 0.12, 2.8, 8), base, Math.cos(a) * r, 1.5, Math.sin(a) * r);
  }
  put(batch, 'icing', disc(r + 0.5, 0.2, 22), base, 0, 2.95, 0);
  put(batch, 'peppermint', dome(r + 0.4, 1.5, 20), base, 0, 3.05, 0);
  put(batch, 'icing', ring(r + 0.4, 0.12, 22), base, 0, 3.02, 0, 0, Math.PI / 2, 0);
  put(batch, `candy|${pick(rng, CANDY)}`, new THREE.SphereGeometry(0.24, 10, 8), base, 0, 4.6, 0);
  bench(batch, localMatrix(0, 0.3, -0.6, 0), rng);
}

function buildPlaza(batch, cx, cz, rng, stats) {
  const base = localMatrix(cx, 0.2, cz, 0);
  // bullseye pavement
  put(batch, 'pavement', disc(15.5, 0.3, 40), base, 0, 0.0, 0);
  put(batch, 'peppermint', disc(13.2, 0.06, 40), base, 0, 0.18, 0);
  put(batch, 'pavement', disc(8.4, 0.08, 40), base, 0, 0.22, 0);

  // giant layer cake
  const tiers = [
    { r: 4.6, h: 2.4, color: 'frosting|#ffd3e2' },
    { r: 3.5, h: 2.0, color: 'frosting|#cdf3d6' },
    { r: 2.5, h: 1.8, color: 'frosting|#ffe8b8' },
    { r: 1.6, h: 1.6, color: 'frosting|#e6d6ff' },
  ];
  let y = 0.28;
  tiers.forEach((t, i) => {
    put(batch, t.color, uvScale(cylinder(t.r, t.r, t.h, 34), 4, 1), base, 0, y + t.h / 2, 0);
    put(batch, 'icing', ring(t.r, 0.16, 34), base, 0, y + t.h, 0, 0, Math.PI / 2, 0);
    icingDrips(batch, base, t.r * 0.99, y + t.h + 0.05, 22, rng, 'icing');
    // candy beads around each tier
    const beads = 10 + i * 6;
    for (let k = 0; k < beads; k++) {
      const a = (k / beads) * TAU;
      put(batch, `candy|${pick(rng, CANDY)}`, new THREE.SphereGeometry(0.18, 8, 6), base,
        Math.cos(a) * (t.r + 0.05), y + 0.18, Math.sin(a) * (t.r + 0.05));
    }
    y += t.h;
  });
  // cherry + candles
  put(batch, 'candy|#ff304d', new THREE.SphereGeometry(1.05, 18, 14), base, 0, y + 1.0, 0);
  put(batch, 'chocolate', cylinder(0.09, 0.09, 0.9, 6), base, 0.14, y + 1.9, 0, 0, 0.15, 0.2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const r = 1.1;
    put(batch, 'caneBlue', cylinder(0.09, 0.09, 1.5, 6), base, Math.cos(a) * r, y + 0.75, Math.sin(a) * r);
    put(batch, 'flame', new THREE.SphereGeometry(0.11, 8, 6), base,
      Math.cos(a) * r, y + 1.6, Math.sin(a) * r, 0, 0, 0, 1, 1.7, 1);
  }
  // surrounding ring: lollipop trees, benches, gumdrops
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const r = 11.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (i % 3 === 0) {
      streetLamp(batch, localMatrix(x, 0.24, z, a), rng);
      stats.lamps++;
    } else if (i % 3 === 1) {
      treeLollipop(batch, localMatrix(x, 0.24, z, rng() * TAU), rng);
      stats.trees++;
    } else {
      bench(batch, localMatrix(x, 0.24, z, a + Math.PI), rng);
    }
  }
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    put(batch, `gumdrop|${pick(rng, CANDY)}`, dome(0.34, 0.42, 10), base,
      Math.cos(a) * 13.9, 0.28, Math.sin(a) * 13.9);
  }
  // jelly bean plaza border
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * TAU;
    put(batch, 'jawbreaker', disc(0.3, 0.12, 10), base, Math.cos(a) * 15.1, 0.32, Math.sin(a) * 15.1);
  }
}
