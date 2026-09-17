/* ============================================================
 * Frontier · SDF Terrain Lab — 3D viewport
 *
 * MeshStandardMaterial + onBeforeCompile splat injection:
 *  · 5 procedural layer textures (grass/dirt/rock/sand/snow)
 *  · per-vertex splat weights baked from the Gaea-style
 *    channels (height/slope/flow/erosion/sediment/peaks/points)
 *  · slope-driven rock override, wetness darkening + gloss
 *  · grayscale channel preview (splatmap inspect mode)
 * The SDF grid stays the source of truth; the mesh is a
 * visualization of it.
 * ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const SUN_DIR = new THREE.Vector3(0.55, 0.72, 0.38).normalize();

export class TerrainView {
  constructor(container, { onProbe, onFps } = {}) {
    this.container = container;
    this.onProbe = onProbe;
    this.onFps = onFps;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xd8e2ea, 170, 480);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1200);
    camera.position.set(86, 64, 88);
    this.camera = camera;
    this.homePos = camera.position.clone();
    this.homeTarget = new THREE.Vector3(0, 13, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(this.homeTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 380;
    controls.maxPolarAngle = Math.PI * 0.495;
    this.controls = controls;

    // ---------------- lights ----------------
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
    sun.position.copy(SUN_DIR).multiplyScalar(140);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.55;
    scene.add(sun, sun.target);
    this.sun = sun;

    scene.add(new THREE.HemisphereLight(0xbcd4e8, 0x49543f, 0.8));
    const fill = new THREE.DirectionalLight(0x93b7d8, 0.55);
    fill.position.set(-70, 50, -60);
    scene.add(fill);

    // ---------------- sky dome ----------------
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topCol: { value: new THREE.Color(0x4d7fae) },
        midCol: { value: new THREE.Color(0xa9c4d8) },
        botCol: { value: new THREE.Color(0xd8e2ea) },
        sunDir: { value: SUN_DIR.clone() },
        sunCol: { value: new THREE.Color(0xffe9c4) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topCol; uniform vec3 midCol; uniform vec3 botCol;
        uniform vec3 sunDir; uniform vec3 sunCol;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h < 0.12
            ? mix(botCol, midCol, smoothstep(-0.08, 0.12, h))
            : mix(midCol, topCol, smoothstep(0.12, 0.6, h));
          float s = max(dot(d, sunDir), 0.0);
          col += sunCol * (pow(s, 420.0) * 1.4 + pow(s, 14.0) * 0.14);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(560, 32, 16), skyMat);
    scene.add(sky);
    this.sky = sky;

    // ---------------- lab grid (context reference) ----------------
    const grid = new THREE.GridHelper(420, 42, 0x8fa3b5, 0x9db0c0);
    grid.position.y = -16.5;
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    scene.add(grid);
    this.grid = grid;

    // ---------------- terrain material ----------------
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.0,
    });
    this.material.defines = { USE_UV: '' };
    this.uniforms = {
      tLayer0: { value: null }, // grass
      tLayer1: { value: null }, // dirt
      tLayer2: { value: null }, // rock
      tLayer3: { value: null }, // sand
      tLayer4: { value: null }, // snow
      tPreview: { value: null },
      uPreviewOn: { value: 0 },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 splatA;
          attribute float snowA;
          attribute float slopeA;
          attribute float wetA;
          attribute float sedA;
          attribute float waterA;
          varying vec4 vSplatC;
          varying float vSnowC;
          varying float vSlopeC;
          varying float vWetC;
          varying float vSedC;
          varying float vWaterC;`
        )
        .replace(
          '#include <fog_vertex>',
          `vSplatC = splatA;
          vSnowC = snowA;
          vSlopeC = slopeA;
          vWetC = wetA;
          vSedC = sedA;
          vWaterC = waterA;
          #include <fog_vertex>`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D tLayer0; uniform sampler2D tLayer1; uniform sampler2D tLayer2;
          uniform sampler2D tLayer3; uniform sampler2D tLayer4;
          uniform sampler2D tPreview;
          uniform float uPreviewOn;
          varying vec4 vSplatC;
          varying float vSnowC;
          varying float vSlopeC;
          varying float vWetC;
          varying float vSedC;
          varying float vWaterC;`
        )
        .replace(
          '#include <map_fragment>',
          `{
            vec2 uvB = fract(vUv * 9.0);
            vec2 uvD = fract(vUv * 26.0 + vec2(0.37, 0.11));
            vec3 gL  = texture2D(tLayer0, uvB).rgb * 0.72 + texture2D(tLayer0, uvD).rgb * 0.28;
            vec3 dL  = texture2D(tLayer1, uvB).rgb * 0.72 + texture2D(tLayer1, uvD).rgb * 0.28;
            vec3 rL  = texture2D(tLayer2, uvB).rgb * 0.68 + texture2D(tLayer2, uvD).rgb * 0.32;
            vec3 sL  = texture2D(tLayer3, uvB).rgb * 0.72 + texture2D(tLayer3, uvD).rgb * 0.28;
            vec3 snL = texture2D(tLayer4, uvB).rgb * 0.70 + texture2D(tLayer4, uvD).rgb * 0.30;

            vec4 w = vSplatC;
            float rockUp = smoothstep(0.55, 0.9, vSlopeC);
            w.x = min(w.x, 1.0 - rockUp * 0.8);
            w.z = max(w.z, rockUp * 0.65);
            vec3 baseCol = gL * w.x + dL * w.y + rL * w.z + sL * w.w + snL * vSnowC;
            baseCol = mix(baseCol, rL, rockUp * 0.4);

            // flow lines: darkened, slightly cool (wet rock), hue kept
            float wet = smoothstep(0.12, 0.65, vWetC);
            baseCol = mix(baseCol, baseCol * vec3(0.60, 0.59, 0.58), wet * 0.55);

            // alluvium: lighter warm gravel (coarser), not yellow-white
            float sed = clamp(vSedC, 0.0, 1.0);
            baseCol = mix(baseCol, baseCol * vec3(1.12, 1.09, 1.03) + vec3(0.045, 0.034, 0.018), sed * 0.5);

            // large-scale tonal variation (soil/rock variation, kills flat CG color)
            float lv1 = sin(vUv.x * 5.1 + 1.3) * sin(vUv.y * 4.7 - 0.8);
            float lv2 = sin(vUv.x * 9.7 - 2.1) * sin(vUv.y * 8.3 + 1.7);
            baseCol *= 0.945 + 0.05 * lv1 + 0.02 * lv2;

            // rivers & lakes: flat blue water, glossy
            float wat = smoothstep(0.35, 0.7, vWaterC);
            if (wat > 0.001) {
              vec3 wDeep = vec3(0.045, 0.16, 0.26);
              vec3 wShal = vec3(0.12, 0.34, 0.47);
              // subtle flow shimmer so rivers read as moving water
              float shim = sin(vUv.x * 220.0 + vUv.y * 140.0) * 0.5 + 0.5;
              vec3 wCol = mix(wDeep, wShal, 0.45 + shim * 0.25);
              baseCol = mix(baseCol, wCol, wat);
            }

            diffuseColor.rgb = baseCol;
            if (uPreviewOn > 0.5) {
              float pv = texture2D(tPreview, vUv).r;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(pv), 0.94);
            }
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = min(roughnessFactor, 0.95) * (1.0 - 0.42 * smoothstep(0.08, 0.6, vWetC));
          // water (rivers/lakes) is glossy
          roughnessFactor = mix(roughnessFactor, 0.30, smoothstep(0.35, 0.7, vWaterC));`
        );
    };
    this.material.customProgramCacheKey = () => 'frontier-splat-v2';

    this.terrainMesh = null;

    // ---------------- water ----------------
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        deep: { value: new THREE.Color(0x14405a) },
        shal: { value: new THREE.Color(0x4f95b8) },
        sunDir: { value: SUN_DIR.clone() },
        camPos: { value: new THREE.Vector3() },
      },
      vertexShader: `
        varying vec2 vUvW;
        varying vec3 vPosW;
        void main() {
          vUvW = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPosW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 deep; uniform vec3 shal;
        uniform vec3 sunDir; uniform vec3 camPos;
        varying vec2 vUvW;
        varying vec3 vPosW;
        void main() {
          vec2 p = vUvW * 24.0;
          vec3 n = normalize(vec3(
            sin(p.x + uTime * 0.7) * 0.05 + sin(p.y * 1.7 - uTime * 0.5) * 0.03,
            1.0,
            cos(p.y + uTime * 0.6) * 0.05 + cos(p.x * 1.3 + uTime * 0.4) * 0.03
          ));
          vec3 V = normalize(camPos - vPosW);
          float fres = pow(1.0 - max(dot(V, n), 0.0), 2.6);
          vec3 col = mix(deep, shal, 0.35 + fres * 0.65);
          vec3 H = normalize(V + sunDir);
          float spec = pow(max(dot(n, H), 0.0), 90.0);
          col += vec3(1.0, 0.95, 0.85) * spec * 0.7;
          float a = 0.80 + 0.18 * fres;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -7;
    scene.add(this.water);

    // ---------------- probe ----------------
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerDirty = false;
    renderer.domElement.addEventListener('pointermove', (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      this.pointerDirty = true;
    });

    // ---------------- sizing ----------------
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.ro = ro;
    this.resize();

    // ---------------- loop ----------------
    this.disposed = false;
    this.frames = 0;
    this.lastFpsT = performance.now();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 2);
    const h = Math.max(this.container.clientHeight, 2);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTextures(tex) {
    this.uniforms.tLayer0.value = tex.grass;
    this.uniforms.tLayer1.value = tex.dirt;
    this.uniforms.tLayer2.value = tex.rock;
    this.uniforms.tLayer3.value = tex.sand;
    this.uniforms.tLayer4.value = tex.snow;
  }

  /**
   * Rebuild the terrain mesh from the SDF field.
   * @param {object} d {h, N, voxel, weights, channels, previewField, seaLevel}
   */
  rebuild({ h, N, voxel, weights, channels, previewField: pf, seaLevel, water }) {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const splat = new Float32Array(N * N * 4);
    const snow = new Float32Array(N * N);
    const slopeA = new Float32Array(N * N);
    const wet = new Float32Array(N * N);
    const sed = new Float32Array(N * N);
    const waterA = new Float32Array(N * N);

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        pos[idx * 3] = (i - (N - 1) / 2) * voxel;
        pos[idx * 3 + 1] = h[idx];
        pos[idx * 3 + 2] = (j - (N - 1) / 2) * voxel;
        uv[idx * 2] = i / (N - 1);
        uv[idx * 2 + 1] = j / (N - 1);
        splat[idx * 4] = weights[idx * 5 + 0];
        splat[idx * 4 + 1] = weights[idx * 5 + 1];
        splat[idx * 4 + 2] = weights[idx * 5 + 2];
        splat[idx * 4 + 3] = weights[idx * 5 + 3];
        snow[idx] = weights[idx * 5 + 4];
        slopeA[idx] = channels ? channels.slope[idx] / (channels.slopeRef * 1.05) : 0;
        wet[idx] = channels ? Math.min(1, channels.flowN[idx] * 1.15) : 0;
        sed[idx] = channels ? Math.min(1, channels.sedimentN[idx] * 1.3 + channels.erosionN[idx] * 0.35) : 0;
        waterA[idx] = water ? water[idx] : 0;
      }
    }

    const index = new Uint32Array((N - 1) * (N - 1) * 6);
    let p = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('splatA', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('snowA', new THREE.BufferAttribute(snow, 1));
    geo.setAttribute('slopeA', new THREE.BufferAttribute(slopeA, 1));
    geo.setAttribute('wetA', new THREE.BufferAttribute(wet, 1));
    geo.setAttribute('sedA', new THREE.BufferAttribute(sed, 1));
    geo.setAttribute('waterA', new THREE.BufferAttribute(waterA, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terrainMesh = new THREE.Mesh(geo, this.material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // preview channel texture
    if (this._prevTex) { this._prevTex.dispose(); this._prevTex = null; }
    if (pf) {
      const data = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) data[i] = Math.round(Math.min(1, Math.max(0, pf[i])) * 255);
      const prev = new THREE.DataTexture(data, N, N, THREE.RedFormat);
      prev.minFilter = THREE.LinearFilter;
      prev.magFilter = THREE.LinearFilter;
      prev.needsUpdate = true;
      this._prevTex = prev;
      this.uniforms.tPreview.value = prev;
      this.uniforms.uPreviewOn.value = 1;
    } else {
      this.uniforms.uPreviewOn.value = 0;
    }

    if (seaLevel !== undefined) {
      this.water.position.y = seaLevel;
      this.grid.position.y = seaLevel - 9.5;
    }

    // probe data cache
    this.probe = { h, N, voxel, geo };
  }

  setPreviewOn(on) {
    this.uniforms.uPreviewOn.value = on ? 1 : 0;
  }

  setWaterVisible(v) { this.water.visible = v; }
  setWireframe(v) { this.material.wireframe = v; }
  setAutoOrbit(v) { this.controls.autoRotate = v; this.controls.autoRotateSpeed = 0.8; }
  resetCamera() {
    this.camera.position.copy(this.homePos);
    this.controls.target.copy(this.homeTarget);
  }

  doProbe() {
    if (!this.pointerDirty || !this.terrainMesh || !this.probe) return;
    this.pointerDirty = false;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    if (!hits.length) { if (this.onProbe) this.onProbe(null); return; }
    const { h, N, voxel } = this.probe;
    const uvv = hits[0].uv;
    const i = Math.min(N - 1, Math.max(0, Math.round(uvv.x * (N - 1))));
    const j = Math.min(N - 1, Math.max(0, Math.round(uvv.y * (N - 1))));
    const idx = j * N + i;
    const x = (i - (N - 1) / 2) * voxel;
    const z = (j - (N - 1) / 2) * voxel;
    let slope = 0;
    if (i > 0 && i < N - 1 && j > 0 && j < N - 1) {
      const gx = (h[idx + 1] - h[idx - 1]) / (2 * voxel);
      const gz = (h[idx + N] - h[idx - N]) / (2 * voxel);
      slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    }
    this.onProbe && this.onProbe({ x, z, elev: h[idx], slope });
  }

  tick() {
    const dt = this.clock.getDelta();
    this.waterMat.uniforms.uTime.value += dt;
    this.waterMat.uniforms.camPos.value.copy(this.camera.position);
    this.controls.update();
    this.doProbe();
    this.renderer.render(this.scene, this.camera);

    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsT >= 500) {
      const fps = (this.frames * 1000) / (now - this.lastFpsT);
      this.frames = 0;
      this.lastFpsT = now;
      this.onFps && this.onFps(fps);
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.renderer.dispose();
    if (this.terrainMesh) this.terrainMesh.geometry.dispose();
  }
}
