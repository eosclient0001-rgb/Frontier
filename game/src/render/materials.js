// Shared materials and procedurally drawn textures. Nothing is loaded from disk.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

// Simple deterministic noise so textures look the same every run.
function noiseFill(g, w, h, base, amount, seed = 3) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.06; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const a = (rnd() - 0.5) * amount;
    g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

export function createMaterials(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // glass facade: 4 m tile with window grid; vertex colours tint each building
  const glassTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#c5d3de', 0.25, 11);
    const cols = 4;
    const rows = 4;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = (r * 7 + c * 3) % 11 === 0;
        g.fillStyle = lit ? '#f1e2bd' : '#2c3d4d';
        g.fillRect(c * cw + 9, r * ch + 10, cw - 18, ch - 20);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(c * cw + 12, r * ch + 12, (cw - 24) * 0.35, ch - 26);
      }
    }
    g.fillStyle = '#9aa8b3';
    for (let r = 0; r <= rows; r++) g.fillRect(0, r * ch - 2, w, 4);
  });

  // office / block concrete: horizontal bands and fine grain
  const concTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#d9d6cf', 0.18, 5);
    g.fillStyle = 'rgba(80,80,80,0.22)';
    for (let r = 0; r < 4; r++) g.fillRect(0, r * 64 + 60, w, 3);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let c = 0; c < 4; c++) g.fillRect(c * 64 + 2, 0, 3, h);
  });

  // street paving / plaza for the ground plane
  const groundTex = canvasTex(512, 512, (g, w, h) => {
    noiseFill(g, w, h, '#8c8f8f', 0.22, 17);
    g.strokeStyle = 'rgba(40,42,44,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, h);
      g.moveTo(0, i);
      g.lineTo(w, i);
      g.stroke();
    }
  });
  groundTex.repeat.set(500, 500); // ~28 m per tile over the 14 km plane

  const mats = {
    envMap,
    road: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
      envMap,
      envMapIntensity: 0.2,
    }),
    concrete: new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: concTex,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      envMap,
      envMapIntensity: 0.25,
    }),
    glass: new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: glassTex,
      roughness: 0.22,
      metalness: 0.35,
      side: THREE.DoubleSide,
      envMap,
      envMapIntensity: 0.9,
    }),
    metal: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.55,
      side: THREE.DoubleSide,
      envMap,
      envMapIntensity: 0.7,
    }),
    // emissive: vertex colours above 1.0 push into the bloom threshold, so keep it subtle
    emissive: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    foliage: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
      envMap,
      envMapIntensity: 0.15,
    }),
    ground: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0, envMap, envMapIntensity: 0.1 }),
  };
  mats.envMap = envMap;
  return mats;
}
