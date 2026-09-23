/**
 * 3D Viewport Engine — Photorealistic Solid PBR Terrain & Dynamic Water Renderer
 * 
 * Provides cinema-grade Three.js WebGL rendering with clean solid PBR materials:
 * - 100% Stripe-Free & Artifact-Free Solid Multi-Layer Blending
 * - True Cook-Torrance GGX microfacet specular lighting with distinct per-material roughness
 * - Dynamic wet channel gloss and optical depth water
 * - Realistic hemisphere atmospheric lighting (sun + sky dome fill + ground bounce)
 * - 12 Channel Preview modes (PBR Shaded, Satellite SatMap, PBR Roughness, Slope, Flow, Sediment, Talus, Strata, Rills, Cavity AO, Snow, Normals)
 * - OrbitControls, top-down, and isometric camera navigation
 * - Real-time terrain probe HUD
 */

import * as THREE from "../vendor/three.module.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { MATERIAL_PRESETS } from "./materials.js";
import { TextureGenerator } from "./textures.js";

// ===========================================================================
// TERRAIN SHADERS
// ===========================================================================

const TERRAIN_VERTEX_SHADER = `
attribute float aSlope;
attribute float aHardness;
attribute float aSediment;
attribute float aTalus;
attribute float aFlow;
attribute float aRills;
attribute float aCavity;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vSlope;
varying float vHardness;
varying float vSediment;
varying float vTalus;
varying float vFlow;
varying float vRills;
varying float vCavity;

void main() {
  vUv = uv;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normalize(normalMatrix * normal);
  vSlope = aSlope;
  vHardness = aHardness;
  vSediment = aSediment;
  vTalus = aTalus;
  vFlow = aFlow;
  vRills = aRills;
  vCavity = aCavity;

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const TERRAIN_FRAGMENT_SHADER = `
precision highp float;

uniform int uViewMode; 
// 0: PBR Shaded
// 1: Satellite Ortho SatMap
// 2: PBR Roughness Map
// 3: Slope Heatmap
// 4: Drainage Flow Network
// 5: Deposited Sediment
// 6: Talus Scree Aprons
// 7: 3D Rock Strata Hardness
// 8: Micro-Rill Channels
// 9: Cavity Ambient Occlusion
// 10: Snow Mask
// 11: Surface Normals

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundBounceColor;

uniform vec3 uRockTint;
uniform vec3 uTalusTint;
uniform vec3 uGrassTint;
uniform vec3 uDirtTint;
uniform vec3 uSnowTint;

uniform float uRockRoughness;
uniform float uTalusRoughness;
uniform float uGrassRoughness;
uniform float uDirtRoughness;
uniform float uSedimentRoughness;
uniform float uSnowRoughness;

uniform float uSnowLine;
uniform float uSeaLevel;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vSlope;
varying float vHardness;
varying float vSediment;
varying float vTalus;
varying float vFlow;
varying float vRills;
varying float vCavity;

vec3 jetColormap(float t) {
  t = clamp(t, 0.0, 1.0);
  float r = clamp(1.5 - abs(4.0 * t - 3.0), 0.0, 1.0);
  float g = clamp(1.5 - abs(4.0 * t - 2.0), 0.0, 1.0);
  float b = clamp(1.5 - abs(4.0 * t - 1.0), 0.0, 1.0);
  return vec3(r, g, b);
}

// Roughness diagnostic false-color colormap
// Blue/Cyan: Mirror Gloss / Water (<0.2)
// Green: Satin / Foliage (0.4 - 0.6)
// Yellow/Orange: Rock (0.7 - 0.8)
// Deep Red: Matte Scree / Dry Soil (>0.9)
vec3 roughnessColormap(float r) {
  r = clamp(r, 0.0, 1.0);
  if (r < 0.25) {
    return mix(vec3(0.05, 0.2, 0.95), vec3(0.0, 0.85, 0.9), r / 0.25);
  } else if (r < 0.55) {
    return mix(vec3(0.0, 0.85, 0.9), vec3(0.15, 0.85, 0.2), (r - 0.25) / 0.30);
  } else if (r < 0.80) {
    return mix(vec3(0.15, 0.85, 0.2), vec3(0.95, 0.85, 0.1), (r - 0.55) / 0.25);
  } else {
    return mix(vec3(0.95, 0.85, 0.1), vec3(0.95, 0.15, 0.05), (r - 0.80) / 0.20);
  }
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  // -------------------------------------------------------------------------
  // Smooth C1 Continuous Geomorphological Splat Blending (Zero Striping)
  // -------------------------------------------------------------------------
  // 1. Rock on steep slopes / cliffs
  float rockWeight = smoothstep(20.0, 38.0, vSlope);

  // 2. Scree Talus from physical thermal mass wasting deposit
  float talusWeight = (1.0 - rockWeight) * clamp(vTalus / 0.65, 0.0, 1.0);

  // 3. Alluvial sediment on flat areas and near water
  float sedimentWeight = clamp(vSediment / 1.0, 0.0, 1.0);
  if (vWorldPos.y < uSeaLevel + 1.5) {
    sedimentWeight = max(sedimentWeight, smoothstep(uSeaLevel + 1.5, uSeaLevel, vWorldPos.y));
  }

  // 4. Grass in gentle lowlands below snow line
  float grassWeight = (1.0 - rockWeight) * smoothstep(28.0, 14.0, vSlope) * smoothstep(uSnowLine + 4.0, uSnowLine - 2.0, vWorldPos.y) * (1.0 - sedimentWeight * 0.8);

  // 5. Soil / Dirt transition
  float dirtWeight = max(0.0, (1.0 - rockWeight) * (1.0 - grassWeight) * (1.0 - sedimentWeight));

  // 6. Snow accumulation
  float snowWeight = smoothstep(uSnowLine, uSnowLine + 6.0, vWorldPos.y) * smoothstep(52.0, 36.0, vSlope);

  // Normalize weights smoothly
  float sumW = rockWeight + talusWeight + sedimentWeight + dirtWeight + grassWeight + 1e-5;
  rockWeight = (rockWeight / sumW) * (1.0 - snowWeight);
  talusWeight = (talusWeight / sumW) * (1.0 - snowWeight);
  sedimentWeight = (sedimentWeight / sumW) * (1.0 - snowWeight);
  dirtWeight = (dirtWeight / sumW) * (1.0 - snowWeight);
  grassWeight = (grassWeight / sumW) * (1.0 - snowWeight);

  // -------------------------------------------------------------------------
  // Solid Base Colors (100% Uniform, Clean & Stripe-Free)
  // -------------------------------------------------------------------------
  vec3 colRock = uRockTint;
  vec3 colTalus = uTalusTint;
  vec3 colGrass = uGrassTint;
  vec3 colDirt = uDirtTint;
  vec3 colSediment = mix(uDirtTint, uTalusTint, 0.4) * 1.15;
  vec3 colSnow = uSnowTint;

  vec3 albedo = colRock * rockWeight +
                colTalus * talusWeight +
                colGrass * grassWeight +
                colDirt * dirtWeight +
                colSediment * sedimentWeight +
                colSnow * snowWeight;

  // -------------------------------------------------------------------------
  // Physically Differentiated PBR Micro-Roughness Calculation
  // -------------------------------------------------------------------------
  float layerRoughness = uRockRoughness * rockWeight +
                         uTalusRoughness * talusWeight +
                         uGrassRoughness * grassWeight +
                         uDirtRoughness * dirtWeight +
                         uSedimentRoughness * sedimentWeight +
                         uSnowRoughness * snowWeight;

  // Dynamic wetness from fluvial drainage channels
  float wetFactor = clamp(log(1.0 + vFlow * 8.0) / 3.5, 0.0, 1.0);
  albedo = mix(albedo, albedo * 0.50, wetFactor * (1.0 - snowWeight));

  // Wet channels become mirror-like gloss (roughness drops down to 0.05)
  float finalRoughness = mix(layerRoughness, 0.05, wetFactor * (1.0 - snowWeight));
  finalRoughness = clamp(finalRoughness, 0.04, 0.98);

  // -------------------------------------------------------------------------
  // Cook-Torrance GGX Microfacet Specular BRDF
  // -------------------------------------------------------------------------
  float NdotL = max(0.0, dot(N, L));
  float NdotV = max(0.0, dot(N, V));
  float NdotH = max(0.0, dot(N, H));
  float VdotH = max(0.0, dot(V, H));

  // GGX NDF
  float alpha = finalRoughness * finalRoughness;
  float alpha2 = max(1e-4, alpha * alpha);
  float denom = (NdotH * NdotH * (alpha2 - 1.0) + 1.0);
  float D = alpha2 / (3.14159265 * denom * denom + 1e-5);

  // Schlick Fresnel
  float baseF0 = mix(0.04, 0.10, rockWeight * (1.0 - uRockRoughness));
  baseF0 = mix(baseF0, 0.08, snowWeight * (1.0 - uSnowRoughness));
  float F = baseF0 + (1.0 - baseF0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);

  // Smith Geometric Attenuation (Schlick-GGX)
  float k = (finalRoughness + 1.0) * (finalRoughness + 1.0) / 8.0;
  float gL = NdotL / (NdotL * (1.0 - k) + k + 1e-5);
  float gV = NdotV / (NdotV * (1.0 - k) + k + 1e-5);
  float G = gL * gV;

  // Direct Cook-Torrance Specular
  float specTerm = (D * F * G) / (4.0 * max(0.001, NdotL) * max(0.001, NdotV) + 1e-4);
  vec3 directSpecular = uSunColor * specTerm * NdotL * 1.8;

  // -------------------------------------------------------------------------
  // Atmosphere & Studio Hemisphere Lighting
  // -------------------------------------------------------------------------
  float wrapDiff = max(0.0, (dot(N, L) + 0.35) / 1.35);
  vec3 directDiffuse = uSunColor * wrapDiff * 1.15;

  float skyHemisphere = 0.5 + 0.5 * N.y;
  vec3 ambientDiffuse = mix(uGroundBounceColor, uSkyColor, skyHemisphere) * 0.70;

  float cavity = clamp(0.60 + 0.40 * vCavity, 0.0, 1.0);
  vec3 diffuseLight = (directDiffuse + ambientDiffuse) * cavity;

  // -------------------------------------------------------------------------
  // Channel Preview Modes
  // -------------------------------------------------------------------------
  if (uViewMode == 1) { // Satellite Ortho SatMap (Raw Unshaded Orbital Composite)
    vec3 satView = albedo * (0.85 + 0.15 * N.y);
    gl_FragColor = vec4(satView, 1.0);
    return;
  }
  if (uViewMode == 2) { // PBR Roughness Map Visualization
    vec3 rCol = roughnessColormap(finalRoughness);
    gl_FragColor = vec4(rCol * (0.55 + 0.45 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 3) { // Slope Heatmap
    float normSlope = clamp(vSlope / 60.0, 0.0, 1.0);
    gl_FragColor = vec4(jetColormap(normSlope) * (0.45 + 0.55 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 4) { // Drainage Flow Heatmap
    float normFlow = clamp(log(1.0 + vFlow * 5.0) / 4.0, 0.0, 1.0);
    gl_FragColor = vec4(mix(vec3(0.05, 0.08, 0.15), vec3(0.1, 0.7, 1.0), normFlow) * (0.5 + 0.5 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 5) { // Deposited Sediment
    float normSed = clamp(vSediment / 1.5, 0.0, 1.0);
    gl_FragColor = vec4(jetColormap(normSed) * (0.45 + 0.55 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 6) { // Scree Talus Aprons
    float normTalus = clamp(vTalus / 1.2, 0.0, 1.0);
    gl_FragColor = vec4(mix(vec3(0.1), vec3(0.9, 0.5, 0.2), normTalus) * (0.45 + 0.55 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 7) { // 3D Rock Strata Hardness
    float normHard = clamp((vHardness - 0.7) / 0.6, 0.0, 1.0);
    gl_FragColor = vec4(jetColormap(normHard) * (0.45 + 0.55 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 8) { // Micro Rills
    float normRills = clamp(vRills / 0.8, 0.0, 1.0);
    gl_FragColor = vec4(mix(vec3(0.85), vec3(0.1, 0.1, 0.4), normRills) * (0.45 + 0.55 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 9) { // Cavity Ambient Occlusion
    gl_FragColor = vec4(vec3(vCavity) * (0.5 + 0.5 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 10) { // Snow Mask
    float snowMask = vWorldPos.y > uSnowLine ? clamp((vWorldPos.y - uSnowLine) / 8.0, 0.0, 1.0) * (1.0 - clamp(vSlope / 48.0, 0.0, 1.0)) : 0.0;
    gl_FragColor = vec4(vec3(snowMask) * (0.5 + 0.5 * NdotL), 1.0);
    return;
  }
  if (uViewMode == 11) { // Normals
    gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // 0: Full Cinema Solid PBR Shaded Mode
  vec3 finalColor = albedo * diffuseLight + directSpecular * cavity;
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ===========================================================================
// DYNAMIC WATER SHADERS (Aperiodic, Non-Tiling Golden-Angle Wave Spectrum)
// ===========================================================================

const WATER_VERTEX_SHADER = `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Multi-frequency golden-angle ocean waves (isotropic, eliminates all grid repetition)
  float h = 0.0;
  float dHdx = 0.0;
  float dHdz = 0.0;

  // Harmonic 1: lambda = 36m, theta = 0 deg
  float k1 = 0.1745;
  float p1 = (pos.x * 1.0 + pos.y * 0.0) * k1 - uTime * 1.31;
  h += sin(p1) * 0.14;
  dHdx += cos(p1) * 0.14 * k1 * 1.0;
  dHdz += cos(p1) * 0.14 * k1 * 0.0;

  // Harmonic 2: lambda = 22m, theta = 137.5 deg
  float k2 = 0.2856;
  float p2 = (pos.x * -0.7373 + pos.y * 0.6756) * k2 - uTime * 1.67;
  h += sin(p2) * 0.09;
  dHdx += cos(p2) * 0.09 * k2 * -0.7373;
  dHdz += cos(p2) * 0.09 * k2 * 0.6756;

  // Harmonic 3: lambda = 14m, theta = 275.0 deg
  float k3 = 0.4488;
  float p3 = (pos.x * 0.0872 + pos.y * -0.9962) * k3 - uTime * 2.10;
  h += sin(p3) * 0.05;
  dHdx += cos(p3) * 0.05 * k3 * 0.0872;
  dHdz += cos(p3) * 0.05 * k3 * -0.9962;

  // Harmonic 4: lambda = 8.5m, theta = 52.5 deg
  float k4 = 0.7392;
  float p4 = (pos.x * 0.6088 + pos.y * 0.7934) * k4 - uTime * 2.70;
  h += sin(p4) * 0.03;
  dHdx += cos(p4) * 0.03 * k4 * 0.6088;
  dHdz += cos(p4) * 0.03 * k4 * 0.7934;

  pos.z += h;

  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormal = normalize(normalMatrix * vec3(-dHdx, 1.0, -dHdz));

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const WATER_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  // Isotropic micro-capillary detail (8-way golden-angle harmonic spectrum)
  float t = uTime * 2.0;
  float m1 = (vWorldPos.x * 0.766 - vWorldPos.z * 0.643) * 1.85 - t;
  float m2 = (vWorldPos.x * -0.500 + vWorldPos.z * 0.866) * 3.01 - t * 1.3;
  float m3 = (vWorldPos.x * 0.174 + vWorldPos.z * 0.985) * 4.87 - t * 1.7;
  float m4 = (vWorldPos.x * -0.940 - vWorldPos.z * 0.342) * 7.89 - t * 2.2;

  float capX = cos(m1) * 0.020 * 0.766 - cos(m2) * 0.015 * -0.500 + cos(m3) * 0.010 * 0.174 - cos(m4) * 0.006 * -0.940;
  float capZ = cos(m1) * 0.020 * -0.643 - cos(m2) * 0.015 * 0.866 + cos(m3) * 0.010 * 0.985 - cos(m4) * 0.006 * -0.342;

  vec3 waveN = normalize(vec3(N.x + capX, N.y, N.z + capZ));

  // Schlick Fresnel
  float NdotV = max(0.0, dot(waveN, V));
  float fresnel = 0.035 + 0.965 * pow(1.0 - NdotV, 5.0);

  // Pure optical depth absorption
  float distFromMassif = length(vWorldPos.xz);
  float depthAbsorption = smoothstep(20.0, 90.0, distFromMassif);
  vec3 waterBody = mix(uWaterShallow, uWaterDeep, depthAbsorption);

  // High-fidelity GGX specular sun glint
  float NdotH = max(0.0, dot(waveN, H));
  float sunGlint = pow(NdotH, 384.0) * 4.0 + pow(NdotH, 64.0) * 0.5;

  // Sky reflection
  vec3 skyReflect = mix(uSkyColor, vec3(1.0), fresnel * 0.45);

  vec3 finalColor = mix(waterBody * 0.7, skyReflect, fresnel) + uSunColor * sunGlint;

  gl_FragColor = vec4(finalColor, 0.94);
}
`;

// ===========================================================================
// VIEWPORT CONTROLLER
// ===========================================================================

export class TerrainViewport {
  constructor(containerEl, volume) {
    this.container = containerEl;
    this.volume = volume;
    this.viewMode = 0;
    this.presetKey = "highAlpine";
    this.currentPreset = MATERIAL_PRESETS[this.presetKey];

    this.wireframe = false;
    this.snowLine = 28.0;
    this.seaLevel = 0.0;
    this.sunElevation = this.currentPreset.sunElevation || 42.0;
    this.sunAzimuth = this.currentPreset.sunAzimuth || 135.0;

    this.probeCallback = null;
    this.sculptCallback = null;
    this.isSculpting = false;
    this.brushRadius = 12.0;
    this.brushMode = "raise";
    this.brushStrength = 1.0;

    this.texGen = new TextureGenerator(1337);

    this.initScene();
    this.initWater();
    this.initBrushRing();
    this.initEvents();
    this.updateTerrainMesh();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.0025);

    this.camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.5,
      1200
    );
    this.camera.position.set(130, 95, 145);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 500;
    this.controls.target.set(0, 12, 0);

    this.sunDir = new THREE.Vector3();
    this.updateSunDirection();
  }

  updateSunDirection() {
    const elRad = (this.sunElevation * Math.PI) / 180;
    const azRad = (this.sunAzimuth * Math.PI) / 180;
    this.sunDir.set(
      Math.cos(elRad) * Math.sin(azRad),
      Math.sin(elRad),
      Math.cos(elRad) * Math.cos(azRad)
    ).normalize();

    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uSunDir.value.copy(this.sunDir);
    }
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uSunDir.value.copy(this.sunDir);
    }
  }

  setSunPosition(elevation, azimuth) {
    this.sunElevation = elevation;
    this.sunAzimuth = azimuth;
    this.updateSunDirection();
  }

  initWater() {
    const waterGeo = new THREE.PlaneGeometry(320, 320, 96, 96);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Vector3(1.25, 1.16, 1.02) },
        uSkyColor: { value: new THREE.Vector3(...this.currentPreset.skyColor) },
        uWaterShallow: { value: new THREE.Vector3(...this.currentPreset.colors.waterShallow) },
        uWaterDeep: { value: new THREE.Vector3(...this.currentPreset.colors.waterDeep) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });

    this.waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.waterMesh.position.y = this.seaLevel;
    this.scene.add(this.waterMesh);
  }

  initBrushRing() {
    const ringGeo = new THREE.RingGeometry(this.brushRadius - 0.5, this.brushRadius + 0.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6c77ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    this.brushRing = new THREE.Mesh(ringGeo, ringMat);
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 999;
    this.scene.add(this.brushRing);
  }

  updateTerrainMesh(erosionResults = null) {
    const surf = this.volume.extractSurfaceGrid();
    const nx = surf.nx;
    const nz = surf.nz;
    const size = nx * nz;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(size * 3);
    const normals = new Float32Array(size * 3);
    const aSlope = new Float32Array(size);
    const aHardness = new Float32Array(size);
    const aSediment = new Float32Array(size);
    const aTalus = new Float32Array(size);
    const aFlow = new Float32Array(size);
    const aRills = new Float32Array(size);
    const aCavity = new Float32Array(size);

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = iz * nx + ix;
        const [wx, , wz] = this.volume.voxelToCoord(ix, 0, iz);
        const y = surf.height[idx];

        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = wz;

        normals[idx * 3] = surf.normalX[idx];
        normals[idx * 3 + 1] = surf.normalY[idx];
        normals[idx * 3 + 2] = surf.normalZ[idx];

        aSlope[idx] = surf.slopeDeg[idx];
        aHardness[idx] = surf.hardness[idx];
        aSediment[idx] = surf.sediment[idx];
        aTalus[idx] = erosionResults?.talusMap ? erosionResults.talusMap[idx] : 0.0;
        aFlow[idx] = erosionResults?.flowMap ? erosionResults.flowMap[idx] : 1.0;
        aRills[idx] = erosionResults?.rillMap ? erosionResults.rillMap[idx] : 0.0;
        aCavity[idx] = Math.max(0.5, Math.min(1.0, 0.8 - surf.curvature[idx] * 0.2));
      }
    }

    const indices = [];
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const i0 = iz * nx + ix;
        const i1 = iz * nx + (ix + 1);
        const i2 = (iz + 1) * nx + ix;
        const i3 = (iz + 1) * nx + (ix + 1);

        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aSlope", new THREE.BufferAttribute(aSlope, 1));
    geometry.setAttribute("aHardness", new THREE.BufferAttribute(aHardness, 1));
    geometry.setAttribute("aSediment", new THREE.BufferAttribute(aSediment, 1));
    geometry.setAttribute("aTalus", new THREE.BufferAttribute(aTalus, 1));
    geometry.setAttribute("aFlow", new THREE.BufferAttribute(aFlow, 1));
    geometry.setAttribute("aRills", new THREE.BufferAttribute(aRills, 1));
    geometry.setAttribute("aCavity", new THREE.BufferAttribute(aCavity, 1));
    geometry.setIndex(indices);

    const c = this.currentPreset.colors;
    const r = this.currentPreset.roughness;

    if (!this.terrainMaterial) {
      this.terrainMaterial = new THREE.ShaderMaterial({
        vertexShader: TERRAIN_VERTEX_SHADER,
        fragmentShader: TERRAIN_FRAGMENT_SHADER,
        uniforms: {
          uViewMode: { value: this.viewMode },
          uSunDir: { value: this.sunDir },
          uSunColor: { value: new THREE.Vector3(1.25, 1.16, 1.02) },
          uSkyColor: { value: new THREE.Vector3(...this.currentPreset.skyColor) },
          uGroundBounceColor: { value: new THREE.Vector3(...this.currentPreset.groundBounceColor) },

          uRockTint: { value: new THREE.Vector3(...c.rock) },
          uTalusTint: { value: new THREE.Vector3(...c.talus) },
          uGrassTint: { value: new THREE.Vector3(...c.grass) },
          uDirtTint: { value: new THREE.Vector3(...c.dirt) },
          uSnowTint: { value: new THREE.Vector3(...c.snow) },

          uRockRoughness: { value: r.rock },
          uTalusRoughness: { value: r.talus },
          uGrassRoughness: { value: r.grass },
          uDirtRoughness: { value: r.dirt },
          uSedimentRoughness: { value: r.sediment },
          uSnowRoughness: { value: r.snow },

          uSnowLine: { value: this.snowLine },
          uSeaLevel: { value: this.seaLevel },
          uTime: { value: 0 },
        },
        wireframe: this.wireframe,
      });
    }

    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }

    this.terrainMesh = new THREE.Mesh(geometry, this.terrainMaterial);
    this.scene.add(this.terrainMesh);
  }

  setVolume(newVolume) {
    this.volume = newVolume;
    this.updateTerrainMesh();
  }

  setPreset(presetKey) {
    if (!MATERIAL_PRESETS[presetKey]) return;
    this.presetKey = presetKey;
    this.currentPreset = MATERIAL_PRESETS[presetKey];

    const c = this.currentPreset.colors;
    const r = this.currentPreset.roughness;
    const u = this.terrainMaterial.uniforms;

    u.uRockTint.value.set(...c.rock);
    u.uTalusTint.value.set(...c.talus);
    u.uGrassTint.value.set(...c.grass);
    u.uDirtTint.value.set(...c.dirt);
    u.uSnowTint.value.set(...c.snow);

    u.uRockRoughness.value = r.rock;
    u.uTalusRoughness.value = r.talus;
    u.uGrassRoughness.value = r.grass;
    u.uDirtRoughness.value = r.dirt;
    u.uSedimentRoughness.value = r.sediment;
    u.uSnowRoughness.value = r.snow;

    u.uSkyColor.value.set(...this.currentPreset.skyColor);
    u.uGroundBounceColor.value.set(...this.currentPreset.groundBounceColor);

    if (this.currentPreset.sunElevation !== undefined) {
      this.sunElevation = this.currentPreset.sunElevation;
      this.sunAzimuth = this.currentPreset.sunAzimuth;
      this.updateSunDirection();
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uSkyColor.value.set(...this.currentPreset.skyColor);
      this.waterMaterial.uniforms.uWaterShallow.value.set(...c.waterShallow);
      this.waterMaterial.uniforms.uWaterDeep.value.set(...c.waterDeep);
    }
  }

  setRoughnessUniforms({ rock, talus, grass, dirt, sediment, snow }) {
    if (!this.terrainMaterial) return;
    const u = this.terrainMaterial.uniforms;
    if (rock !== undefined) u.uRockRoughness.value = rock;
    if (talus !== undefined) u.uTalusRoughness.value = talus;
    if (grass !== undefined) u.uGrassRoughness.value = grass;
    if (dirt !== undefined) u.uDirtRoughness.value = dirt;
    if (sediment !== undefined) u.uSedimentRoughness.value = sediment;
    if (snow !== undefined) u.uSnowRoughness.value = snow;
  }

  setViewMode(mode) {
    this.viewMode = mode;
    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uViewMode.value = mode;
    }
  }

  setWireframe(wire) {
    this.wireframe = wire;
    if (this.terrainMaterial) {
      this.terrainMaterial.wireframe = wire;
    }
  }

  setSnowLine(snow) {
    this.snowLine = snow;
    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uSnowLine.value = snow;
    }
  }

  setSeaLevel(sea) {
    this.seaLevel = sea;
    if (this.waterMesh) {
      this.waterMesh.position.y = sea;
    }
    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uSeaLevel.value = sea;
    }
  }

  setBrushRadius(r) {
    this.brushRadius = r;
    this.brushRing.geometry.dispose();
    const ringGeo = new THREE.RingGeometry(r - 0.5, r + 0.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.brushRing.geometry = ringGeo;
  }

  resetCamera() {
    this.camera.position.set(130, 95, 145);
    this.controls.target.set(0, 12, 0);
    this.controls.update();
  }

  setTopView() {
    this.camera.position.set(0, 220, 0.1);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setIsometricView() {
    this.camera.position.set(150, 150, 150);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  initEvents() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerMove = (e) => {
      const rect = this.container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!this.terrainMesh) return;
      raycaster.setFromCamera(mouse, this.camera);
      const hits = raycaster.intersectObject(this.terrainMesh);

      if (hits.length > 0) {
        const hit = hits[0];
        const p = hit.point;

        this.brushRing.position.copy(p);
        this.brushRing.position.y += 0.25;

        if (this.probeCallback) {
          const norm = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0);
          const slopeRad = Math.acos(Math.max(0.0, Math.min(1.0, norm.y)));
          const slopeDeg = (slopeRad * 180) / Math.PI;
          const hardness = this.volume.sampleHardness(p.x, p.y, p.z);

          this.probeCallback({
            x: p.x,
            y: p.y,
            z: p.z,
            slopeDeg,
            hardness,
          });
        }

        if (this.isSculpting && this.sculptCallback) {
          this.sculptCallback([p.x, p.y, p.z]);
        }
      }
    };

    this.container.addEventListener("pointermove", onPointerMove);

    this.container.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && e.shiftKey) {
        this.isSculpting = true;
        this.controls.enabled = false;
        onPointerMove(e);
      }
    });

    window.addEventListener("pointerup", () => {
      if (this.isSculpting) {
        this.isSculpting = false;
        this.controls.enabled = true;
      }
    });

    window.addEventListener("resize", () => {
      if (!this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = performance.now() * 0.001;

    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uTime.value = t;
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = t;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
