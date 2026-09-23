/**
 * 3D PBR Texture Preview Viewport with Dual-Lobe Crystalline Quartz Micro-Glints
 * 
 * Interactive Three.js WebGL renderer for testing procedural PBR materials
 * on Plane (with vertex displacement), Sphere, and Cube meshes.
 */

import * as THREE from "../vendor/three.module.js";
import { OrbitControls } from "../vendor/OrbitControls.js";

const PBR_VERTEX_SHADER = `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewDir;

uniform sampler2D uHeightMap;
uniform float uDisplacementScale;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Vertex displacement from heightfield
  float h = texture2D(uHeightMap, uv).r;
  pos += normal * (h - 0.5) * uDisplacementScale;

  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(cameraPosition - vWorldPos);

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const PBR_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughnessMap;
uniform sampler2D uAoMap;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uSparkleIntensity;
uniform float uSpecularStrength;
uniform float uSubsurfaceGlow;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewDir;

// Tangent space normal mapping with cotangent frame
mat3 getCotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);

  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

  float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
  return mat3(T * invmax, B * invmax, N);
}

void main() {
  vec3 albedo = texture2D(uAlbedoMap, vUv).rgb;
  vec3 normalTex = texture2D(uNormalMap, vUv).rgb * 2.0 - 1.0;
  float roughness = texture2D(uRoughnessMap, vUv).r;
  float ao = texture2D(uAoMap, vUv).r;

  // Perturb normal with tangent frame
  mat3 TBN = getCotangentFrame(normalize(vNormal), -vViewDir, vUv);
  vec3 N = normalize(TBN * normalTex);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(vViewDir);
  vec3 H = normalize(L + V);

  float NdotL = max(0.0, dot(N, L));
  float NdotV = max(0.0, dot(N, V));
  float NdotH = max(0.0, dot(N, H));
  float VdotH = max(0.0, dot(V, H));

  // 1. Oren-Nayar / Burley Granular Diffuse
  float wrapDiff = max(0.0, (dot(N, L) + 0.25) / 1.25);
  vec3 directDiffuse = uSunColor * albedo * wrapDiff;

  // 2. Subsurface Translucent Quartz Scattering (warm backlit amber glow)
  float sssBack = pow(max(0.0, dot(-L, V)), 4.0) * uSubsurfaceGlow;
  vec3 sssColor = albedo * vec3(1.15, 0.95, 0.70) * sssBack * uSunColor;

  // 3. Primary Cook-Torrance GGX Specular BRDF
  float alpha = roughness * roughness;
  float alpha2 = max(1e-4, alpha * alpha);
  float denom = (NdotH * NdotH * (alpha2 - 1.0) + 1.0);
  float D = alpha2 / (3.14159265 * denom * denom + 1e-5);

  float baseF0 = mix(0.04, 0.25, 1.0 - roughness);
  float F = baseF0 + (1.0 - baseF0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);

  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float gL = NdotL / (NdotL * (1.0 - k) + k + 1e-5);
  float gV = NdotV / (NdotV * (1.0 - k) + k + 1e-5);
  float G = gL * gV;

  float specTerm = (D * F * G) / (4.0 * max(0.001, NdotL) * max(0.001, NdotV) + 1e-4);
  vec3 directSpecular = uSunColor * specTerm * NdotL * uSpecularStrength;

  // 4. Secondary Crystalline Quartz Micro-Glint Sparkle (Pinpoint crystal facet flashes)
  float crystalGlint = pow(NdotH, 256.0) * uSparkleIntensity * (1.0 - roughness * 0.5);
  vec3 glintColor = uSunColor * vec3(1.0, 0.96, 0.88) * crystalGlint;

  // 5. Ambient & Contact AO
  vec3 ambient = uAmbientColor * albedo * ao;

  vec3 finalColor = (directDiffuse + sssColor) * ao + (directSpecular + glintColor) * ao + ambient;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export class TexturePreviewViewport {
  constructor(containerEl) {
    this.container = containerEl;
    this.modelType = "plane";
    this.displacementScale = 0.12;
    this.sunElevation = 45.0;
    this.sunAzimuth = 135.0;

    this.sparkleIntensity = 1.2;
    this.specularStrength = 1.8;
    this.subsurfaceGlow = 0.35;

    this.initScene();
    this.initShaderMaterial();
    this.initMesh();
    this.initEvents();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0e12);

    this.camera = new THREE.PerspectiveCamera(
      40,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 1.8, 2.4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 10.0;
    this.controls.target.set(0, 0, 0);

    this.sunDir = new THREE.Vector3();
    this.updateSunPosition();
  }

  updateSunPosition() {
    const elRad = (this.sunElevation * Math.PI) / 180;
    const azRad = (this.sunAzimuth * Math.PI) / 180;

    this.sunDir.set(
      Math.cos(elRad) * Math.sin(azRad),
      Math.sin(elRad),
      Math.cos(elRad) * Math.cos(azRad)
    ).normalize();

    if (this.material) {
      this.material.uniforms.uSunDir.value.copy(this.sunDir);
    }
  }

  setSunPosition(elevation, azimuth) {
    this.sunElevation = elevation;
    this.sunAzimuth = azimuth;
    this.updateSunPosition();
  }

  initShaderMaterial() {
    // 1x1 dummy textures
    const dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    dummyTex.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: PBR_VERTEX_SHADER,
      fragmentShader: PBR_FRAGMENT_SHADER,
      uniforms: {
        uAlbedoMap: { value: dummyTex },
        uNormalMap: { value: dummyTex },
        uHeightMap: { value: dummyTex },
        uRoughnessMap: { value: dummyTex },
        uAoMap: { value: dummyTex },

        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Vector3(1.35, 1.25, 1.10) },
        uAmbientColor: { value: new THREE.Vector3(0.22, 0.24, 0.28) },
        uSparkleIntensity: { value: this.sparkleIntensity },
        uSpecularStrength: { value: this.specularStrength },
        uSubsurfaceGlow: { value: this.subsurfaceGlow },
        uDisplacementScale: { value: this.displacementScale },
      },
      wireframe: false,
      side: THREE.DoubleSide,
    });
  }

  initMesh() {
    this.buildGeometry();
  }

  buildGeometry() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    let geo;
    if (this.modelType === "plane") {
      geo = new THREE.PlaneGeometry(2.0, 2.0, 256, 256);
      geo.rotateX(-Math.PI / 2);
    } else if (this.modelType === "sphere") {
      geo = new THREE.SphereGeometry(1.0, 256, 256);
    } else if (this.modelType === "cube") {
      geo = new THREE.BoxGeometry(1.4, 1.4, 1.4, 128, 128, 128);
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  setModelType(type) {
    this.modelType = type;
    this.buildGeometry();
  }

  setDisplacementScale(scale) {
    this.displacementScale = scale;
    if (this.material) {
      this.material.uniforms.uDisplacementScale.value = scale;
    }
  }

  setSparkleIntensity(sparkle) {
    this.sparkleIntensity = sparkle;
    if (this.material) {
      this.material.uniforms.uSparkleIntensity.value = sparkle;
    }
  }

  setSpecularStrength(spec) {
    this.specularStrength = spec;
    if (this.material) {
      this.material.uniforms.uSpecularStrength.value = spec;
    }
  }

  setSubsurfaceGlow(sss) {
    this.subsurfaceGlow = sss;
    if (this.material) {
      this.material.uniforms.uSubsurfaceGlow.value = sss;
    }
  }

  setWireframe(wire) {
    if (this.material) {
      this.material.wireframe = wire;
    }
  }

  updateTextures({ albedoImageData, normalImageData, heightImageData, roughnessImageData, aoImageData }) {
    const albedoTex = new THREE.CanvasTexture(this.imageToCanvas(albedoImageData));
    albedoTex.wrapS = THREE.RepeatWrapping;
    albedoTex.wrapT = THREE.RepeatWrapping;
    albedoTex.colorSpace = THREE.SRGBColorSpace;
    albedoTex.needsUpdate = true;

    const normalTex = new THREE.CanvasTexture(this.imageToCanvas(normalImageData));
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.needsUpdate = true;

    const heightTex = new THREE.CanvasTexture(this.imageToCanvas(heightImageData));
    heightTex.wrapS = THREE.RepeatWrapping;
    heightTex.wrapT = THREE.RepeatWrapping;
    heightTex.needsUpdate = true;

    const roughnessTex = new THREE.CanvasTexture(this.imageToCanvas(roughnessImageData));
    roughnessTex.wrapS = THREE.RepeatWrapping;
    roughnessTex.wrapT = THREE.RepeatWrapping;
    roughnessTex.needsUpdate = true;

    const aoTex = new THREE.CanvasTexture(this.imageToCanvas(aoImageData));
    aoTex.wrapS = THREE.RepeatWrapping;
    aoTex.wrapT = THREE.RepeatWrapping;
    aoTex.needsUpdate = true;

    const u = this.material.uniforms;
    u.uAlbedoMap.value = albedoTex;
    u.uNormalMap.value = normalTex;
    u.uHeightMap.value = heightTex;
    u.uRoughnessMap.value = roughnessTex;
    u.uAoMap.value = aoTex;
    u.uDisplacementScale.value = this.displacementScale;
  }

  imageToCanvas(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  initEvents() {
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
