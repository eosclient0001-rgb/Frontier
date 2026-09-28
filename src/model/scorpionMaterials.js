import * as THREE from 'three';

/**
 * Creates high-fidelity PBR procedural textures using HTML5 Canvas (in browser)
 * or procedural fallback in Node environment.
 */
export function createChitinTextures() {
  if (typeof document === 'undefined') {
    return { albedo: null, normal: null, roughness: null };
  }

  // 1. Albedo / Diffuse Texture (Granulated chitin with subtle tonal variations)
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base dark obsidian / forest slate
  ctx.fillStyle = '#101315';
  ctx.fillRect(0, 0, size, size);

  // Layer fine micro-granulations and chitin flecks
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  // Pseudo-random noise with spatial coherence
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // High-frequency granulation
      const n1 = Math.sin(x * 0.15) * Math.cos(y * 0.15);
      const n2 = Math.sin(x * 0.05 + 1.2) * Math.cos(y * 0.05 + 0.8);
      const rand = (Math.random() - 0.5) * 14;
      const val = 16 + (n1 + n2) * 8 + rand;

      // Deep chitin tone with subtle warm amber/olive undertone
      data[idx] = Math.min(255, Math.max(8, val * 0.95 + 4));     // R
      data[idx + 1] = Math.min(255, Math.max(10, val * 1.05 + 6)); // G (subtle olive)
      data[idx + 2] = Math.min(255, Math.max(8, val * 1.0 + 5));   // B
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const albedoTexture = new THREE.CanvasTexture(canvas);
  albedoTexture.wrapS = THREE.RepeatWrapping;
  albedoTexture.wrapT = THREE.RepeatWrapping;
  albedoTexture.repeat.set(4, 4);

  // 2. Normal Map for micro-tubercles and granulations
  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d');
  const nImgData = nCtx.createImageData(size, size);
  const nData = nImgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Bump height field
      const b1 = Math.sin(x * 0.2) * Math.cos(y * 0.2);
      const b2 = Math.sin(x * 0.08 + y * 0.08);
      const noise = (Math.random() - 0.5) * 0.4;
      const height = (b1 * 0.5 + b2 * 0.5 + noise);

      // Compute simple gradient for normals
      const dx = Math.cos(x * 0.2) * 0.5;
      const dy = -Math.sin(y * 0.2) * 0.5;

      const nx = Math.min(255, Math.max(0, 128 + dx * 60));
      const ny = Math.min(255, Math.max(0, 128 + dy * 60));
      const nz = 255;

      nData[idx] = nx;
      nData[idx + 1] = ny;
      nData[idx + 2] = nz;
      nData[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImgData, 0, 0);

  const normalTexture = new THREE.CanvasTexture(nCanvas);
  normalTexture.wrapS = THREE.RepeatWrapping;
  normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.repeat.set(4, 4);

  // 3. Roughness Map (differential gloss)
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d');
  const rImgData = rCtx.createImageData(size, size);
  const rData = rImgData.data;

  for (let i = 0; i < rData.length; i += 4) {
    const rough = Math.floor(45 + Math.random() * 35); // 0.18 - 0.32
    rData[i] = rough;
    rData[i + 1] = rough;
    rData[i + 2] = rough;
    rData[i + 3] = 255;
  }
  rCtx.putImageData(rImgData, 0, 0);

  const roughnessTexture = new THREE.CanvasTexture(rCanvas);
  roughnessTexture.wrapS = THREE.RepeatWrapping;
  roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.repeat.set(4, 4);

  return { albedo: albedoTexture, normal: normalTexture, roughness: roughnessTexture };
}

/**
 * Creates the full set of materials for the scorpion
 */
export function createScorpionMaterials() {
  const textures = createChitinTextures();

  // Primary Exoskeleton Chitin (Prosoma, Tergites, Metasoma)
  const chitinMaterial = new THREE.MeshStandardMaterial({
    name: 'ScorpionChitin',
    color: new THREE.Color(0x131719),
    roughness: 0.24,
    metalness: 0.16,
    map: textures.albedo || null,
    normalMap: textures.normal || null,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: textures.roughness || null
  });

  // Massive Pincer Chela Material (Slightly glossier, robust chitin with carinae)
  const chelaMaterial = new THREE.MeshStandardMaterial({
    name: 'ScorpionChela',
    color: new THREE.Color(0x0e1113),
    roughness: 0.19,
    metalness: 0.22,
    map: textures.albedo || null,
    normalMap: textures.normal || null,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: textures.roughness || null
  });

  // Chela Teeth / Denticle Row (Hardened amber-tipped serrations)
  const denticleMaterial = new THREE.MeshStandardMaterial({
    name: 'Denticles',
    color: new THREE.Color(0x3a2412),
    roughness: 0.28,
    metalness: 0.1
  });

  // Telson Vesicle (Venom gland ampulla - subtle amber warmth)
  const telsonMaterial = new THREE.MeshStandardMaterial({
    name: 'TelsonVesicle',
    color: new THREE.Color(0x281910),
    roughness: 0.18,
    metalness: 0.15
  });

  // Aculeus Stinger Barb (Sharp hypodermic needle - amber base to pitch-black hardened tip)
  const aculeusMaterial = new THREE.MeshStandardMaterial({
    name: 'AculeusStinger',
    color: new THREE.Color(0x1a0f08),
    roughness: 0.12,
    metalness: 0.35
  });

  // Articular / Pleural Membranes (Soft, flexible joint skin between segments)
  const membraneMaterial = new THREE.MeshStandardMaterial({
    name: 'IntersegmentalMembrane',
    color: new THREE.Color(0x422d1d),
    roughness: 0.72,
    metalness: 0.05
  });

  // Eyes / Ocelli (Median and lateral glossy black convex lenses)
  const eyeMaterial = new THREE.MeshStandardMaterial({
    name: 'OcelliEyes',
    color: new THREE.Color(0x030303),
    roughness: 0.04,
    metalness: 0.85
  });

  // Pectines (Comb-like sensory appendages on ventral mesosoma II)
  const pectineMaterial = new THREE.MeshStandardMaterial({
    name: 'Pectines',
    color: new THREE.Color(0x9a7b4f),
    roughness: 0.45,
    metalness: 0.08
  });

  // Leg Claws / Ungues (Dactylar tip claws)
  const clawMaterial = new THREE.MeshStandardMaterial({
    name: 'TarsalClaws',
    color: new THREE.Color(0x2d1a0e),
    roughness: 0.25,
    metalness: 0.2
  });

  // Chelicerae Mouthparts
  const cheliceraMaterial = new THREE.MeshStandardMaterial({
    name: 'Chelicerae',
    color: new THREE.Color(0x1c140e),
    roughness: 0.28,
    metalness: 0.15
  });

  return {
    chitin: chitinMaterial,
    chela: chelaMaterial,
    denticle: denticleMaterial,
    telson: telsonMaterial,
    aculeus: aculeusMaterial,
    membrane: membraneMaterial,
    eye: eyeMaterial,
    pectine: pectineMaterial,
    claw: clawMaterial,
    chelicera: cheliceraMaterial
  };
}
