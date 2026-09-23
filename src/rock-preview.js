/**
 * 3D Viewport Engine for Standalone Rock Crack & SDF Erosion Studio
 * Interactive Three.js WebGL renderer featuring:
 * - Real-time PBR rock shading with mineral palettes, crack oxidation halos, and crevice dirt
 * - Internal 3D Slicer / Cross-Section cutting planes
 * - Crack & Stress Field glow visualization
 * - SDF Erosion Heatmap
 * - Low-Poly game wireframe inspection
 * - Smooth OrbitControls and cinematic studio lighting
 */

import * as THREE from "../vendor/three.module.js";
import { OrbitControls } from "../vendor/OrbitControls.js";

// Mineral Color Palettes
export const MINERAL_PALETTES = {
  granite: {
    name: "Granite (Feldspar / Quartz / Biotite)",
    baseColor: "#827e7a",
    crackColor: "#322b27",
    oxidationColor: "#9c603a",
    roughness: 0.85,
    metalness: 0.05,
  },
  sandstone: {
    name: "Desert Sandstone",
    baseColor: "#c28f5c",
    crackColor: "#593319",
    oxidationColor: "#a34520",
    roughness: 0.92,
    metalness: 0.02,
  },
  basalt: {
    name: "Icelandic Black Basalt",
    baseColor: "#2a2d32",
    crackColor: "#111317",
    oxidationColor: "#614635",
    roughness: 0.78,
    metalness: 0.08,
  },
  slate: {
    name: "Blue-Grey Metamorphic Slate",
    baseColor: "#47515c",
    crackColor: "#1d232a",
    oxidationColor: "#78614d",
    roughness: 0.65,
    metalness: 0.1,
  },
  red_sandstone: {
    name: "Sedona Red Rock",
    baseColor: "#ab4c32",
    crackColor: "#47170c",
    oxidationColor: "#731d0b",
    roughness: 0.94,
    metalness: 0.02,
  },
  marble: {
    name: "Carrara White Marble",
    baseColor: "#dedbd7",
    crackColor: "#545250",
    oxidationColor: "#91867c",
    roughness: 0.45,
    metalness: 0.05,
  },
  obsidian: {
    name: "Volcanic Obsidian Glass",
    baseColor: "#17181c",
    crackColor: "#09090b",
    oxidationColor: "#3d3028",
    roughness: 0.25,
    metalness: 0.15,
  },
  quartzite: {
    name: "Alpine Quartzite",
    baseColor: "#b8c0c4",
    crackColor: "#3a4147",
    oxidationColor: "#8f7052",
    roughness: 0.7,
    metalness: 0.05,
  },
};

// Custom Shader for Photorealistic Eroded Rock with Crack Details
const ROCK_VERTEX_SHADER = `
attribute float aCrack;
attribute float aErosion;
attribute float aSediment;
attribute float aOxidation;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vCrack;
varying float vErosion;
varying float vSediment;
varying float vOxidation;

void main() {
  vUv = uv;
  vCrack = aCrack;
  vErosion = aErosion;
  vSediment = aSediment;
  vOxidation = aOxidation;

  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const ROCK_FRAGMENT_SHADER = `
precision highp float;

uniform int uViewMode; // 0=PBR, 1=Crack/Stress, 2=Erosion Heatmap, 3=Sediment/Cavity
uniform vec3 uBaseColor;
uniform vec3 uCrackColor;
uniform vec3 uOxidationColor;
uniform float uRoughness;
uniform float uMetalness;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uCameraPos;

// Slicer clipping plane
uniform bool uClippingEnabled;
uniform vec4 uClipPlane; // normal.xyz, d

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vCrack;
varying float vErosion;
varying float vSediment;
varying float vOxidation;

vec3 getHeatmapColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.08, 0.15, 0.35); // Dark blue (intact)
  vec3 c1 = vec3(0.12, 0.65, 0.75); // Cyan (slight wear)
  vec3 c2 = vec3(0.95, 0.75, 0.15); // Yellow (moderate)
  vec3 c3 = vec3(0.92, 0.25, 0.10); // Red-orange (deep crack)
  vec3 c4 = vec3(0.98, 0.95, 0.90); // White (extreme cavity)

  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  // Slicer plane clipping
  if (uClippingEnabled) {
    float dist = dot(vWorldPos, uClipPlane.xyz) - uClipPlane.w;
    if (dist > 0.0) discard;
  }

  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L + V);

  // Directional Diffuse + Sky Fill
  float NdotL = max(0.0, dot(N, L));
  float skyFill = max(0.0, N.y * 0.5 + 0.5);
  vec3 directLight = uLightColor * NdotL;
  vec3 ambientLight = uAmbientColor * skyFill;

  // Specular Blinn-Phong / Microfacet
  float NdotH = max(0.0, dot(N, H));
  float roughVal = clamp(uRoughness + vCrack * 0.25 - vOxidation * 0.1, 0.1, 0.98);
  float specPower = mix(128.0, 4.0, roughVal);
  float specTerm = pow(NdotH, specPower) * (1.0 - roughVal * 0.7);

  // View Mode: 0 = PBR Realistic Rock
  if (uViewMode == 0) {
    // Multi-layered mineral color blending
    vec3 col = uBaseColor;

    // Apply oxidation halo around crack lips
    col = mix(col, uOxidationColor, clamp(vOxidation * 1.3, 0.0, 0.85));

    // Dark crack interior / crevice dirt
    col = mix(col, uCrackColor, clamp(vCrack * 1.1 + vSediment * 0.8, 0.0, 0.95));

    // Ambient occlusion in deep cracks
    float ao = clamp(1.0 - vCrack * 0.65 - vSediment * 0.45, 0.15, 1.0);

    vec3 finalColor = col * (directLight + ambientLight) * ao + vec3(specTerm * 0.35);
    gl_FragColor = vec4(finalColor, 1.0);
    return;
  }

  // View Mode: 1 = Glowing Crack & Stress Field
  if (uViewMode == 1) {
    vec3 baseDark = vec3(0.05, 0.07, 0.10) * (NdotL * 0.5 + 0.5);
    vec3 glowColor = mix(vec3(0.0, 0.85, 1.0), vec3(1.0, 0.15, 0.45), vCrack);
    float glow = smoothstep(0.05, 0.7, vCrack) * 2.2;
    vec3 finalColor = baseDark + glowColor * glow;
    gl_FragColor = vec4(finalColor, 1.0);
    return;
  }

  // View Mode: 2 = SDF Erosion Heatmap
  if (uViewMode == 2) {
    float normErosion = clamp(vErosion * 8.0, 0.0, 1.0);
    vec3 heatCol = getHeatmapColor(normErosion);
    vec3 litHeat = heatCol * (directLight * 0.7 + ambientLight * 0.6);
    gl_FragColor = vec4(litHeat, 1.0);
    return;
  }

  // View Mode: 3 = Crevice Sediment & Silt
  if (uViewMode == 3) {
    vec3 baseCol = vec3(0.3, 0.32, 0.35);
    vec3 sedCol = vec3(0.85, 0.72, 0.48); // Golden sand/silt
    vec3 col = mix(baseCol, sedCol, clamp(vSediment * 1.5, 0.0, 1.0));
    gl_FragColor = vec4(col * (directLight + ambientLight), 1.0);
    return;
  }

  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}
`;

export class RockPreviewViewport {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.viewMode = 0; // 0=PBR, 1=Crack/Stress, 2=Erosion, 3=Sediment
    this.activeMineral = "granite";
    this.showWireframe = false;
    this.clippingEnabled = false;
    this.clipPlaneDist = 0.0;
    this.clipAxis = "y"; // 'x', 'y', 'z'
    this.autoRotate = false;

    this.initScene();
    this.initLights();
    this.initMaterial();
    this.setupResizeHandler();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(3.2, 2.4, 4.0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 15;
    this.controls.minDistance = 0.8;
    this.controls.target.set(0, 0, 0);

    // Subtle floor shadow grid
    const gridHelper = new THREE.GridHelper(6, 24, 0x1f2937, 0x111827);
    gridHelper.position.y = -1.6;
    this.scene.add(gridHelper);

    // Rock mesh container
    this.rockGroup = new THREE.Group();
    this.scene.add(this.rockGroup);
  }

  initLights() {
    // Key directional sunlight
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    this.sunLight.position.set(4, 6, 3);
    this.scene.add(this.sunLight);

    // Soft sky dome hemisphere
    this.hemiLight = new THREE.HemisphereLight(0x7da8d6, 0x3d352e, 0.6);
    this.scene.add(this.hemiLight);

    // Subtle blue rim backlight
    this.rimLight = new THREE.DirectionalLight(0x6ba4ff, 0.45);
    this.rimLight.position.set(-4, 2, -4);
    this.scene.add(this.rimLight);
  }

  initMaterial() {
    const pal = MINERAL_PALETTES[this.activeMineral] || MINERAL_PALETTES.granite;

    this.clipPlane = new THREE.Vector4(0, 1, 0, 0);

    this.rockUniforms = {
      uViewMode: { value: this.viewMode },
      uBaseColor: { value: new THREE.Color(pal.baseColor) },
      uCrackColor: { value: new THREE.Color(pal.crackColor) },
      uOxidationColor: { value: new THREE.Color(pal.oxidationColor) },
      uRoughness: { value: pal.roughness },
      uMetalness: { value: pal.metalness },
      uLightDir: { value: new THREE.Vector3(4, 6, 3).normalize() },
      uLightColor: { value: new THREE.Color(0xfffaed) },
      uAmbientColor: { value: new THREE.Color(0x7da8d6) },
      uCameraPos: { value: this.camera.position },
      uClippingEnabled: { value: this.clippingEnabled },
      uClipPlane: { value: this.clipPlane },
    };

    this.rockMaterial = new THREE.ShaderMaterial({
      vertexShader: ROCK_VERTEX_SHADER,
      fragmentShader: ROCK_FRAGMENT_SHADER,
      uniforms: this.rockUniforms,
      side: THREE.DoubleSide,
      clipping: true,
    });

    this.wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
  }

  updateMesh(meshData) {
    // Clear old meshes
    while (this.rockGroup.children.length > 0) {
      const child = this.rockGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.rockGroup.remove(child);
    }

    if (!meshData || !meshData.positions || meshData.positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(meshData.uvs, 2));

    if (meshData.crackData) {
      geometry.setAttribute("aCrack", new THREE.BufferAttribute(meshData.crackData, 1));
    } else {
      geometry.setAttribute("aCrack", new THREE.BufferAttribute(new Float32Array(meshData.positions.length / 3), 1));
    }

    if (meshData.erosionData) {
      geometry.setAttribute("aErosion", new THREE.BufferAttribute(meshData.erosionData, 1));
    } else {
      geometry.setAttribute("aErosion", new THREE.BufferAttribute(new Float32Array(meshData.positions.length / 3), 1));
    }

    if (meshData.sedimentData) {
      geometry.setAttribute("aSediment", new THREE.BufferAttribute(meshData.sedimentData, 1));
    } else {
      geometry.setAttribute("aSediment", new THREE.BufferAttribute(new Float32Array(meshData.positions.length / 3), 1));
    }

    if (meshData.oxidationData) {
      geometry.setAttribute("aOxidation", new THREE.BufferAttribute(meshData.oxidationData, 1));
    } else {
      geometry.setAttribute("aOxidation", new THREE.BufferAttribute(new Float32Array(meshData.positions.length / 3), 1));
    }

    if (meshData.indices) {
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    }

    this.mainMesh = new THREE.Mesh(geometry, this.rockMaterial);
    this.rockGroup.add(this.mainMesh);

    // Wireframe overlay
    if (this.showWireframe) {
      this.wireMesh = new THREE.Mesh(geometry, this.wireframeMaterial);
      this.rockGroup.add(this.wireMesh);
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.rockUniforms.uViewMode.value = mode;
  }

  setMineral(mineralKey) {
    this.activeMineral = mineralKey;
    const pal = MINERAL_PALETTES[mineralKey] || MINERAL_PALETTES.granite;
    this.rockUniforms.uBaseColor.value.set(pal.baseColor);
    this.rockUniforms.uCrackColor.value.set(pal.crackColor);
    this.rockUniforms.uOxidationColor.value.set(pal.oxidationColor);
    this.rockUniforms.uRoughness.value = pal.roughness;
    this.rockUniforms.uMetalness.value = pal.metalness;
  }

  setCustomColors({ baseColor, crackColor, oxidationColor }) {
    if (baseColor) this.rockUniforms.uBaseColor.value.set(baseColor);
    if (crackColor) this.rockUniforms.uCrackColor.value.set(crackColor);
    if (oxidationColor) this.rockUniforms.uOxidationColor.value.set(oxidationColor);
  }

  setWireframe(enabled) {
    this.showWireframe = enabled;
    if (this.mainMesh) {
      if (enabled && !this.wireMesh) {
        this.wireMesh = new THREE.Mesh(this.mainMesh.geometry, this.wireframeMaterial);
        this.rockGroup.add(this.wireMesh);
      } else if (!enabled && this.wireMesh) {
        this.rockGroup.remove(this.wireMesh);
        this.wireMesh = null;
      }
    }
  }

  setSlicer(enabled, axis = "y", dist = 0.0) {
    this.clippingEnabled = enabled;
    this.clipAxis = axis;
    this.clipPlaneDist = dist;

    let nx = 0, ny = 0, nz = 0;
    if (axis === "x") nx = 1;
    else if (axis === "y") ny = 1;
    else if (axis === "z") nz = 1;

    this.clipPlane.set(nx, ny, nz, dist);
    this.rockUniforms.uClippingEnabled.value = enabled;
  }

  resetCamera() {
    this.camera.position.set(3.2, 2.4, 4.0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setupResizeHandler() {
    window.addEventListener("resize", () => {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width && height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (this.autoRotate) {
      this.rockGroup.rotation.y += 0.005;
    }

    this.controls.update();
    this.rockUniforms.uCameraPos.value.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
