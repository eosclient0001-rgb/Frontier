// Frontier Road Editor — procedural canvas textures & materials (zero external assets)
import * as THREE from 'three';

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function noisePass(ctx, size, amp, rng) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function texFromCanvas(canvas, tileMeters, aniso) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileMeters, 1 / tileMeters);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function asphaltCanvas(base, rng, opts = {}) {
  const S = 512;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
  // aggregate speckle
  for (let i = 0; i < 9000; i++) {
    const g = 18 + rng() * 46;
    ctx.fillStyle = `rgba(${g},${g},${g + 2},${0.16 + rng() * 0.2})`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  // faint patch repairs
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(${10 + rng() * 20},${10 + rng() * 20},${12 + rng() * 20},${0.10 + rng() * 0.12})`;
    const w = 40 + rng() * 120, h = 30 + rng() * 90;
    ctx.fillRect(rng() * S, rng() * S, w, h);
  }
  // hairline cracks
  ctx.strokeStyle = 'rgba(8,8,10,0.35)';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 0.8 + rng();
    ctx.beginPath();
    let x = rng() * S, y = rng() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  if (opts.laneWear) { // darker wheel tracks
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(S * 0.22, 0, S * 0.10, S);
    ctx.fillRect(S * 0.68, 0, S * 0.10, S);
  }
  noisePass(ctx, S, 22, rng);
  return c;
}

function concreteCanvas(rng) {
  const S = 256;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = '#9aa0a4'; ctx.fillRect(0, 0, S, S);
  noisePass(ctx, S, 26, rng);
  // expansion joints (tile = 3m → joints every 1.5m)
  ctx.strokeStyle = 'rgba(52,56,60,0.85)'; ctx.lineWidth = 2;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
  // stains
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(70,74,78,${0.04 + rng() * 0.07})`;
    ctx.beginPath();
    ctx.arc(rng() * S, rng() * S, 8 + rng() * 30, 0, 7);
    ctx.fill();
  }
  return c;
}

function cobbleCanvas(rng) {
  const S = 512;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = '#4c4a47'; ctx.fillRect(0, 0, S, S); // mortar
  const rows = 12, cols = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (S / cols) / 2;
    for (let i = -1; i <= cols; i++) {
      const x = i * (S / cols) + off, y = r * rh;
      const g = 96 + rng() * 60;
      const warm = rng() * 14 - 4;
      ctx.fillStyle = `rgb(${g + warm},${g + warm * 0.5},${g - 4})`;
      const m = 2.2;
      ctx.beginPath();
      ctx.roundRect(x + m, y + m, S / cols - m * 2, rh - m * 2, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + m, y + m, S / cols - m * 2, 2);
    }
  }
  noisePass(ctx, S, 16, rng);
  return c;
}

function dirtCanvas(rng) {
  const S = 256;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = '#7a6248'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const g = rng();
    ctx.fillStyle = `rgba(${90 + g * 60},${70 + g * 44},${48 + g * 30},${0.25 + rng() * 0.4})`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 3);
  }
  // ruts
  ctx.fillStyle = 'rgba(52,40,28,0.25)';
  ctx.fillRect(S * 0.25, 0, S * 0.08, S);
  ctx.fillRect(S * 0.66, 0, S * 0.08, S);
  noisePass(ctx, S, 24, rng);
  return c;
}

function gravelCanvas(rng) {
  const S = 256;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = '#6f6c66'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {
    const g = 70 + rng() * 110;
    ctx.fillStyle = `rgba(${g},${g - 2},${g - 6},${0.5 + rng() * 0.4})`;
    const s = 1 + rng() * 3.2;
    ctx.beginPath(); ctx.arc(rng() * S, rng() * S, s * 0.6, 0, 7); ctx.fill();
  }
  return c;
}

function grassCanvas(rng) {
  const S = 256;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = '#48603a'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {
    const g = rng();
    ctx.fillStyle = `rgba(${52 + g * 44},${86 + g * 52},${40 + g * 30},${0.3 + rng() * 0.4})`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2.4, 1 + rng() * 2.4);
  }
  for (let i = 0; i < 26; i++) { // bare patches
    ctx.fillStyle = `rgba(112,104,70,${0.05 + rng() * 0.08})`;
    ctx.beginPath(); ctx.arc(rng() * S, rng() * S, 6 + rng() * 22, 0, 7); ctx.fill();
  }
  return c;
}

function paintCanvas(fill, rng) {
  const S = 128;
  const [c, ctx] = canvas2d(S);
  ctx.fillStyle = fill; ctx.fillRect(0, 0, S, S);
  // worn paint speckle
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (rng() < 0.06) { d[i] -= 34; d[i + 1] -= 34; d[i + 2] -= 30; }
    else { const n = (rng() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function buildMaterials(aniso = 8) {
  const rng = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  const T = {
    asphalt: texFromCanvas(asphaltCanvas('#2c2e31', rng, { laneWear: true }), 8, aniso),
    asphaltDark: texFromCanvas(asphaltCanvas('#232527', rng, {}), 8, aniso),
    asphaltRed: texFromCanvas(asphaltCanvas('#63302c', rng, {}), 8, aniso),
    asphaltGreen: texFromCanvas(asphaltCanvas('#2e5a3c', rng, {}), 8, aniso),
    concrete: texFromCanvas(concreteCanvas(rng), 3, aniso),
    concreteSmooth: texFromCanvas(concreteCanvas(rng), 6, aniso),
    cobble: texFromCanvas(cobbleCanvas(rng), 5, aniso),
    dirt: texFromCanvas(dirtCanvas(rng), 6, aniso),
    gravel: texFromCanvas(gravelCanvas(rng), 3, aniso),
    grass: texFromCanvas(grassCanvas(rng), 14, aniso),
    paintWhite: texFromCanvas(paintCanvas('#e9e9e4', rng), 4, aniso),
    paintYellow: texFromCanvas(paintCanvas('#d8a83c', rng), 4, aniso),
  };

  const std = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0.0, ...extra });

  const M = {
    asphalt: std(T.asphalt),
    asphaltDark: std(T.asphaltDark),
    asphaltRed: std(T.asphaltRed),
    asphaltGreen: std(T.asphaltGreen),
    concrete: std(T.concrete),
    concreteSmooth: std(T.concreteSmooth, { roughness: 0.85 }),
    cobble: std(T.cobble),
    dirt: std(T.dirt),
    gravel: std(T.gravel),
    grass: std(T.grass),
    markWhite: std(T.paintWhite, { roughness: 0.6 }),
    markYellow: std(T.paintYellow, { roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.4, metalness: 0.85 }),
    railSteel: new THREE.MeshStandardMaterial({ color: 0xb9bfc4, roughness: 0.25, metalness: 0.95 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x4e565c, roughness: 0.55, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 0.9 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.5 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd9561e, roughness: 0.6 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5c4a37, roughness: 1 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe9b8, emissiveIntensity: 1.6, roughness: 0.4 }),
    sigRed: new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2222, emissiveIntensity: 0.9 }),
    sigGreen: new THREE.MeshStandardMaterial({ color: 0x113316, emissive: 0x22ff55, emissiveIntensity: 1.1 }),
    reflectRed: new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x801512, emissiveIntensity: 0.7, roughness: 0.35 }),
  };
  return { mats: M, tex: T };
}
