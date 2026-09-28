import * as THREE from 'three';

/**
 * Realistic PBR Materials for Sphyrna mokarran (Great Hammerhead Shark)
 * - Dermal Denticles (placoid scales) bump & normal mapping
 * - Counter-shading: Slate-bronze/deep marine gray dorsum to pale pearl ventral belly
 * - Ampullae of Lorenzini pores on ventral rostrum
 * - Lateral line sensory organ
 * - Enamel teeth shine
 * - Cornea specular eye material
 * - Dynamic underwater caustics shader integration
 */

export function createSharkMaterials() {
  // Generate high-resolution procedural skin texture
  const { skinDiffuseMap, skinNormalMap, skinRoughnessMap } = generateSharkSkinTextures();
  const eyeMap = generateEyeTexture();

  // Body Skinned PBR Material
  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: skinDiffuseMap,
    normalMap: skinNormalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: skinRoughnessMap,
    roughness: 0.65,
    metalness: 0.08,
    side: THREE.DoubleSide
  });

  // Teeth PBR Material
  const teethMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf6f5f0),
    roughness: 0.25,
    metalness: 0.1,
    bumpScale: 0.02
  });

  // Eye Material (Glossy cornea with detailed iris/pupil)
  const eyeMaterial = new THREE.MeshStandardMaterial({
    map: eyeMap,
    roughness: 0.08,
    metalness: 0.15
  });

  // X-Ray / Skeleton overlay material
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.35
  });

  return {
    bodyMaterial,
    teethMaterial,
    eyeMaterial,
    wireMaterial,
    textures: {
      skinDiffuseMap,
      skinNormalMap,
      skinRoughnessMap,
      eyeMap
    }
  };
}

/**
 * Procedurally generates high-resolution skin textures (Diffuse, Normal, Roughness)
 * featuring:
 * - Counter-shading gradient with undulating flank boundary
 * - Cephalofoil rostrum melanin shading
 * - Dermal denticle micro-ridges (placoid scales)
 * - Ampullae of Lorenzini electroreceptor pore clusters
 * - Lateral line canal
 */
function generateSharkSkinTextures() {
  // If running in Node environment during tests, mock canvas
  if (typeof document === 'undefined') {
    return {
      skinDiffuseMap: new THREE.Texture(),
      skinNormalMap: new THREE.Texture(),
      skinRoughnessMap: new THREE.Texture()
    };
  }

  const width = 2048;
  const height = 2048;

  // 1. Diffuse Map Canvas
  const diffuseCanvas = document.createElement('canvas');
  diffuseCanvas.width = width;
  diffuseCanvas.height = height;
  const dCtx = diffuseCanvas.getContext('2d');

  // 2. Normal Map Canvas
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const nCtx = normalCanvas.getContext('2d');

  // 3. Roughness Map Canvas
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d');

  // Color Palette of Great Hammerhead (Sphyrna mokarran)
  // Dorsal: Dark slate bronze/olive gray
  // Ventral: Crisp off-white / pale pearl
  const dorsalColor = { r: 52, g: 63, b: 70 };      // Slate-bronze charcoal
  const dorsalHighlight = { r: 68, g: 79, b: 86 };  // Subtle warm sunlit flank
  const ventralColor = { r: 236, g: 240, b: 243 };  // Pristine white belly
  const finTipColor = { r: 35, g: 42, b: 46 };      // Dusky charcoal fin edges
  const lateralLineColor = { r: 65, g: 78, b: 85 };

  const dImgData = dCtx.createImageData(width, height);
  const dData = dImgData.data;

  const nImgData = nCtx.createImageData(width, height);
  const nData = nImgData.data;

  const rImgData = rCtx.createImageData(width, height);
  const rData = rImgData.data;

  // Fill textures pixel by pixel with high detail
  for (let y = 0; y < height; y++) {
    const v = y / height; // v along length (0=anterior/rostrum, 1=posterior/tail)

    for (let x = 0; x < width; x++) {
      const u = x / width; // u across circumference: 0=dorsal midline, 0.5=ventral midline, 1=dorsal midline
      const idx = (y * width + x) * 4;

      // Distance from dorsal (0 or 1) vs ventral (0.5)
      // distVentral = 0 at dorsal midline, 1 at ventral midline
      const distVentral = 1.0 - Math.abs(u - 0.5) * 2.0;

      // Organic wavy lateral line transition
      const wavePerturb = 0.04 * Math.sin(v * 45.0) + 0.02 * Math.cos(v * 110.0) + 0.015 * Math.sin(u * 30.0 + v * 60.0);
      const effectiveDistVentral = distVentral + wavePerturb;

      // Counter-shading threshold: flank transition happens around effectiveDistVentral = 0.55 - 0.72
      let counterBlend = 0;
      if (effectiveDistVentral < 0.50) {
        counterBlend = 0; // Pure dorsal
      } else if (effectiveDistVentral > 0.72) {
        counterBlend = 1; // Pure ventral
      } else {
        const t = (effectiveDistVentral - 0.50) / 0.22;
        // Smooth S-curve
        counterBlend = t * t * (3 - 2 * t);
      }

      // Base diffuse color interpolation
      let r = dorsalColor.r * (1 - counterBlend) + ventralColor.r * counterBlend;
      let g = dorsalColor.g * (1 - counterBlend) + ventralColor.g * counterBlend;
      let b = dorsalColor.b * (1 - counterBlend) + ventralColor.b * counterBlend;

      // Subtle bronze highlight on upper flank
      if (counterBlend > 0.1 && counterBlend < 0.6) {
        const highlightT = Math.sin((counterBlend - 0.1) / 0.5 * Math.PI);
        r += (dorsalHighlight.r - dorsalColor.r) * highlightT * 0.7;
        g += (dorsalHighlight.g - dorsalColor.g) * highlightT * 0.7;
        b += (dorsalHighlight.b - dorsalColor.b) * highlightT * 0.7;
      }

      // Lateral line organ: thin darker canal at the boundary
      if (Math.abs(effectiveDistVentral - 0.52) < 0.015) {
        const lineIntensity = 1.0 - Math.abs(effectiveDistVentral - 0.52) / 0.015;
        r = r * (1 - lineIntensity * 0.25) + lateralLineColor.r * lineIntensity * 0.25;
        g = g * (1 - lineIntensity * 0.25) + lateralLineColor.g * lineIntensity * 0.25;
        b = b * (1 - lineIntensity * 0.25) + lateralLineColor.b * lineIntensity * 0.25;
      }

      // Darker shading near fin tips (anterior v < 0.05 or posterior v > 0.85)
      if (v > 0.88) {
        const finDark = (v - 0.88) / 0.12;
        r = r * (1 - finDark * 0.3) + finTipColor.r * finDark * 0.3;
        g = g * (1 - finDark * 0.3) + finTipColor.g * finDark * 0.3;
        b = b * (1 - finDark * 0.3) + finTipColor.b * finDark * 0.3;
      }

      // Ampullae of Lorenzini pores: scattered tiny dark pits on ventral rostrum (v < 0.18, distVentral > 0.65)
      let poreBump = 0;
      if (v < 0.18 && distVentral > 0.62) {
        const px = (x % 32) - 16;
        const py = (y % 32) - 16;
        const poreDist = Math.sqrt(px * px + py * py);
        // Pseudo-random pore distribution
        const poreSeed = Math.sin(Math.floor(x / 32) * 12.9898 + Math.floor(y / 32) * 78.233);
        const hasPore = (poreSeed - Math.floor(poreSeed)) > 0.45;

        if (hasPore && poreDist < 2.5) {
          const poreDepth = 1.0 - poreDist / 2.5;
          r = r * (1 - poreDepth * 0.65) + 30 * poreDepth * 0.65;
          g = g * (1 - poreDepth * 0.65) + 35 * poreDepth * 0.65;
          b = b * (1 - poreDepth * 0.65) + 40 * poreDepth * 0.65;
          poreBump = -poreDepth * 0.7;
        }
      }

      // Placoid scale / Dermal denticles micro-texture
      // Longitudinal aligned micro-riblets oriented along swimming flow
      const scaleU = (u * 320) % 1.0;
      const scaleV = (v * 640) % 1.0;
      // Diamond / riblet scale shape
      const riblet = Math.cos(scaleU * Math.PI * 2) * 0.5 + 0.5;
      const scaleShine = riblet * Math.sin(scaleV * Math.PI);

      // Micro-shading variation
      const microVal = (scaleShine - 0.5) * 6;
      r = Math.min(255, Math.max(0, r + microVal));
      g = Math.min(255, Math.max(0, g + microVal));
      b = Math.min(255, Math.max(0, b + microVal));

      dData[idx] = r;
      dData[idx + 1] = g;
      dData[idx + 2] = b;
      dData[idx + 3] = 255;

      // Normal Map generation:
      // Placoid scales form subtle angled micro-ridges facing backward to channel laminar flow
      const nX = (scaleU - 0.5) * 45;
      const nY = (scaleV - 0.5) * 30 + poreBump * 80;
      const normLen = Math.sqrt(nX * nX + nY * nY + 128 * 128);

      nData[idx] = Math.floor(128 + (nX / normLen) * 127);
      nData[idx + 1] = Math.floor(128 + (nY / normLen) * 127);
      nData[idx + 2] = Math.floor(Math.max(160, 255 - Math.abs(nX) * 0.5));
      nData[idx + 3] = 255;

      // Roughness: Velvety shark skin
      // Dorsal is slightly matte (0.68), ventral is smoother (0.45), wet sheen
      const baseRoughness = 0.68 * (1 - counterBlend) + 0.48 * counterBlend;
      const fineRoughness = Math.min(255, Math.max(0, Math.floor((baseRoughness + scaleShine * 0.08) * 255)));
      rData[idx] = fineRoughness;
      rData[idx + 1] = fineRoughness;
      rData[idx + 2] = fineRoughness;
      rData[idx + 3] = 255;
    }
  }

  dCtx.putImageData(dImgData, 0, 0);
  nCtx.putImageData(nImgData, 0, 0);
  rCtx.putImageData(rImgData, 0, 0);

  const skinDiffuseMap = new THREE.CanvasTexture(diffuseCanvas);
  skinDiffuseMap.wrapS = THREE.RepeatWrapping;
  skinDiffuseMap.wrapT = THREE.ClampToEdgeWrapping;

  const skinNormalMap = new THREE.CanvasTexture(normalCanvas);
  skinNormalMap.wrapS = THREE.RepeatWrapping;
  skinNormalMap.wrapT = THREE.ClampToEdgeWrapping;

  const skinRoughnessMap = new THREE.CanvasTexture(roughCanvas);
  skinRoughnessMap.wrapS = THREE.RepeatWrapping;
  skinRoughnessMap.wrapT = THREE.ClampToEdgeWrapping;

  return { skinDiffuseMap, skinNormalMap, skinRoughnessMap };
}

/**
 * Generates the realistic eye texture:
 * Black oval/slit pupil, bronze/amber iris ring, limbal ring
 */
function generateEyeTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const cx = 256;
  const cy = 256;

  // Background sclera / dark rim
  ctx.fillStyle = '#111416';
  ctx.fillRect(0, 0, 512, 512);

  // Outer iris border (Limbal ring)
  const grad = ctx.createRadialGradient(cx, cy, 70, cx, cy, 210);
  grad.addColorStop(0, '#cca048');   // Golden amber center
  grad.addColorStop(0.4, '#a2762e'); // Deep bronze
  grad.addColorStop(0.8, '#4d3615'); // Dark bronze perimeter
  grad.addColorStop(1, '#0c0f12');   // Limbal ring edge
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 210, 0, Math.PI * 2);
  ctx.fill();

  // Iris radial fibrous striae
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 90; i++) {
    const angle = (i / 90) * Math.PI * 2;
    const r1 = 80 + Math.random() * 20;
    const r2 = 195 + Math.random() * 10;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(235, 195, 110, 0.45)' : 'rgba(40, 25, 8, 0.55)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    ctx.stroke();
  }

  // Black oval/slit pupil (Hammerheads have vertical/sub-circular pupils)
  ctx.fillStyle = '#030405';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 55, 95, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cornea wet highlight glint
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.arc(cx - 35, cy - 40, 16, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
