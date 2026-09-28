/**
 * Materials.
 *
 * Eagle plumage is a *directional* surface: the barbs of each feather lie
 * roughly along the feather, so light reflects anisotropically and the sheen
 * changes with the viewing angle.  We model that with MeshPhysicalMaterial's
 * built-in sheen layer plus procedurally generated "barb" normal/roughness
 * detail, and add a thin-film-free broadband sheen tinted toward the warm
 * bronze of real golden-eagle covert feathers.
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { PLUMAGE } from '../anatomy.js';

const linear = (hex) => new Color().setHex(hex, SRGBColorSpace);

/* -------------------------------------------------------------------------- */
/*  Procedural textures                                                        */
/* -------------------------------------------------------------------------- */

/** Feather-barb micro-relief used as roughness + bump detail. */
function barbTexture(size = 512, density = 130, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const rnd = (i) => {
    const s = Math.sin(i * 9781.233 + seed * 4123.11) * 43758.5453;
    return s - Math.floor(s);
  };

  // Barbs: fine parallel filaments off a central rachis.
  ctx.lineWidth = 1;
  for (let i = 0; i < density; i++) {
    const y = rnd(i) * size;
    const a = 0.10 + rnd(i + 77) * 0.22;
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    const skew = 26;
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + skew * (rnd(i + 3) - 0.5) * 2);
    for (let k = 0; k < 6; k++) {
      const x = (k / 6) * size;
      ctx.moveTo(x, y + (x / size) * skew * (rnd(i + 3) - 0.5) * 2);
      ctx.lineTo(x, y + (x / size) * skew * (rnd(i + 3) - 0.5) * 2 + 6 + rnd(i + k) * 5);
    }
    ctx.stroke();
  }

  // A few soft mottling blotches (golden eagles have marbled coverts).
  for (let i = 0; i < 90; i++) {
    const x = rnd(i * 3 + 11) * size;
    const y = rnd(i * 3 + 12) * size;
    const r = 8 + rnd(i * 3 + 13) * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd(i + 500) > 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},0.10)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(3, 3);
  return t;
}

/**
 * Golden-eagle plumage map: dark umber ground, a golden wash over the nape and
 * the middle of the upper wing, and a faint barred pattern on the flight
 * feathers.  Modulated by the per-vertex `aPlum` attribute the geometry
 * carries, so it lands in the right places.
 */
function plumageTexture(size = 1024, seed = 7) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rnd = (i) => {
    const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  ctx.fillStyle = '#3a2c21';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = rnd(i) * size;
    const y = rnd(i + 9) * size;
    const r = 3 + rnd(i + 3) * 16;
    const warm = rnd(i + 5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col =
      warm > 0.72
        ? `rgba(168,124,52,0.16)`
        : warm > 0.4
          ? `rgba(96,74,48,0.14)`
          : `rgba(24,18,13,0.16)`;
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let _barb = null;
let _plum = null;
const getBarb = () => (_barb ??= barbTexture());
const getPlumage = () => (_plum ??= plumageTexture());

/* -------------------------------------------------------------------------- */
/*  Materials                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Body plumage: soft, diffuse, warm sheen, with the plumage regions blended
 * per-vertex.
 *
 * Every lofted body part -- trunk, neck, skull -- carries an `aplum`
 * attribute that says which field of plumage that vertex belongs to: the
 * pale underparts, the dark upperparts, or the pale golden hackle of the nape
 * that gives the golden eagle its name.  Blending three flat colours by that
 * attribute is what makes the bird read as *Aquila* rather than as a generic
 * brown raptor, and it costs no extra draw calls.
 *
 * The attribute is stored offset by one, so that geometry which was never
 * tagged (the value zero, which is what a missing attribute reads as) falls
 * back to the dark upperparts rather than to the pale breast.
 */
export function makeBodyMaterial() {
  const m = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.68,
    metalness: 0.0,
    sheen: 0.62,
    sheenRoughness: 0.55,
    sheenColor: linear(0xa07a3c),
    map: getPlumage(),
    clearcoat: 0.06,
    clearcoatRoughness: 0.7,
    envMapIntensity: 1.15,
  });
  m.name = 'plumage';
  m.userData.maps = { color: getPlumage(), detail: getBarb() };

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPlumUnder = { value: linear(PLUMAGE.breast) };
    shader.uniforms.uPlumUpper = { value: linear(PLUMAGE.backDark) };
    shader.uniforms.uPlumNape = { value: linear(PLUMAGE.napeGolden) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aplum;\nvarying float vPlum;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlum = aplum;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vPlum;\nuniform vec3 uPlumUnder;\nuniform vec3 uPlumUpper;\nuniform vec3 uPlumNape;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // 0 = untagged -> upperparts; otherwise 1 underparts, 2 upperparts,
          // 3 golden nape.
          float p = vPlum < 0.5 ? 2.0 : vPlum;
          vec3 c = mix(uPlumUnder, uPlumUpper, clamp(p - 1.0, 0.0, 1.0));
          c = mix(c, uPlumNape, clamp(p - 2.0, 0.0, 1.0));
          diffuseColor.rgb *= c;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'plumageRegions';
  return m;
}

/** Gold hackle: the pale tawny nape, crown and hindneck. */
export function makeGoldenMaterial() {
  const m = new MeshPhysicalMaterial({
    color: linear(PLUMAGE.napeGolden),
    roughness: 0.52,
    metalness: 0.0,
    sheen: 0.85,
    sheenRoughness: 0.42,
    sheenColor: linear(0xc9a256),
    map: getPlumage(),
    bumpMap: getBarb(),
    bumpScale: 0.004,
    clearcoat: 0.1,
    clearcoatRoughness: 0.55,
    envMapIntensity: 1.25,
  });
  m.name = 'golden';
  return m;
}

/**
 * Upper wing coverts: the tawny panel that gives the golden eagle its name.
 *
 * It is a separate material from the flight feathers because the contrast is
 * the bird.  A golden eagle from above is a warm gold panel over the whole
 * leading half of the wing -- the lesser, median and greater coverts, all of
 * them pale-tipped -- against secondaries and primaries that stay nearly
 * black.  Rendering the coverts a shade or two off the remiges, which is what
 * a single darkened flight-feather material does, produces a uniformly brown
 * wing and a bird that could be any large raptor.
 */
export function makeCovertMaterial() {
  const m = new MeshPhysicalMaterial({
    color: linear(PLUMAGE.wingUpperGold),
    roughness: 0.5,
    metalness: 0.0,
    sheen: 0.8,
    sheenRoughness: 0.4,
    sheenColor: linear(0xba9450),
    map: getPlumage(),
    bumpMap: getBarb(),
    bumpScale: 0.005,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.25,
  });
  m.name = 'covertGold';
  return m;
}

/**
 * Flight-feather material.  Darker than the body, glossier, with a stronger
 * sheen — flight feathers are stiff and have a distinctly harder specular
 * response than the downy contour feathers.
 */
export function makeFeatherMaterial(darkness = 1.0) {
  const base = new Color().copy(linear(PLUMAGE.wingDark)).multiplyScalar(darkness);
  const m = new MeshPhysicalMaterial({
    color: base,
    roughness: 0.46,
    metalness: 0.0,
    sheen: 1.0,
    sheenRoughness: 0.34,
    sheenColor: linear(0x9c7a44),
    bumpMap: getBarb(),
    bumpScale: 0.006,
    side: DoubleSide, // feather undersides are visible in flight
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
    envMapIntensity: 1.2,
  });
  m.name = 'flightFeather';
  return m;
}

/** Tail: dark ground with the pale adult base band. */
export function makeTailMaterial() {
  const m = makeFeatherMaterial(1.0);
  m.color = linear(PLUMAGE.tailDark);
  m.name = 'rectrix';
  return m;
}

/** Undertail coverts and the pale base of the rectrices. */
export function makeTailPaleMaterial() {
  const m = makeFeatherMaterial(1.0);
  m.color = linear(PLUMAGE.tailPaleBase);
  m.name = 'rectrixPale';
  return m;
}

/** Underwing coverts: warmer and lighter than the dorsal surface. */
export function makeUnderwingMaterial() {
  const m = makeFeatherMaterial(1.0);
  m.color = linear(PLUMAGE.underwingCovert);
  m.name = 'underwingCovert';
  return m;
}

export function makePrimaryMaterial() {
  const m = makeFeatherMaterial(0.82);
  m.color = linear(PLUMAGE.primaryDark);
  m.name = 'primaryFeather';
  // The outer 3-4 primaries are plain dark with almost black tips.
  return m;
}

export function makeBeakMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(PLUMAGE.beakHorn),
    roughness: 0.24,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    sheen: 0.2,
    sheenColor: linear(0x5a4a3a),
    envMapIntensity: 1.4,
  });
}

export function makeCereMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(PLUMAGE.cereYellow),
    roughness: 0.42,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 1.0,
  });
}

export function makeEyeMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(0x6b4f1e),
    roughness: 0.06,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.0,
    emissive: linear(0x120c04),
    emissiveIntensity: 0.5,
  });
}

export function makePupilMaterial() {
  return new MeshStandardMaterial({
    color: linear(0x05040a),
    roughness: 0.12,
    metalness: 0.0,
  });
}

export function makeTalonMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(PLUMAGE.talon),
    roughness: 0.22,
    clearcoat: 0.9,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.5,
  });
}

export function makeFootMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(PLUMAGE.toeScaly),
    roughness: 0.52,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    bumpMap: getBarb(),
    bumpScale: 0.001,
    envMapIntensity: 1.0,
  });
}

export function makeMouthMaterial() {
  return new MeshStandardMaterial({
    color: linear(PLUMAGE.gapeMouth),
    roughness: 0.55,
    side: DoubleSide,
  });
}

export function makeTongueMaterial() {
  return new MeshPhysicalMaterial({
    color: linear(0x4b332a),
    roughness: 0.4,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
  });
}
