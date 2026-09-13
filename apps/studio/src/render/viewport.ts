/**
 * Three.js viewport: sun + sky + terrain + water + particle points + brush ring.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshData } from '../mesher/surfaceNets';
import { ParticlePool } from '../erosion/particles';
import {
  ShadeParams, createSkyMaterial, createTerrainMaterial, createWaterMaterial,
  updateTerrainUniforms,
} from './materials';

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  terrain: THREE.Mesh;
  terrainMat: THREE.MeshStandardMaterial;
  water: THREE.Mesh;
  waterMat: THREE.ShaderMaterial;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  rainPts: THREE.Points;
  windPts: THREE.Points;
  brushRing: THREE.Mesh;
  worldSize = 96;

  private rainPos: THREE.BufferAttribute;
  private rainCol: THREE.BufferAttribute;
  private windPos: THREE.BufferAttribute;
  private raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement, shade: ShadeParams, worldSize: number) {
    this.worldSize = worldSize;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfdfe8, worldSize * 1.6, worldSize * 4.2);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, worldSize * 12);
    const c = worldSize;
    this.camera.position.set(c * 0.95, c * 0.85, c * 1.05);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, c * 0.32, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = c * 4;
    this.controls.minDistance = c * 0.05;
    this.controls.update();

    // Lights.
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.position.set(c * 0.55, c * 0.9, c * 0.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -c * 0.8; sc.right = c * 0.8; sc.top = c * 0.8; sc.bottom = -c * 0.8;
    sc.near = c * 0.1; sc.far = c * 4;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = c * 0.004;
    this.sun.target.position.set(0, c * 0.25, 0);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ea, 0x8a7f6a, 0.85));

    // Sky dome.
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(c * 5, 32, 16), createSkyMaterial());
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Terrain.
    this.terrainMat = createTerrainMaterial(shade);
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.terrainMat);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);

    // Water plane.
    this.waterMat = createWaterMaterial();
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(c * 1.2, c * 1.2, 1, 1), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = shade.waterLevel;
    this.scene.add(this.water);

    // Particle points (rain + wind share layout; separate systems).
    const mkPoints = (cap: number, size: number) => {
      const g = new THREE.BufferGeometry();
      const posA = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
      const colA = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
      posA.setUsage(THREE.DynamicDrawUsage);
      colA.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', posA);
      g.setAttribute('color', colA);
      g.setDrawRange(0, 0);
      const m = new THREE.PointsMaterial({
        size, vertexColors: true, transparent: true, opacity: 0.75,
        sizeAttenuation: true, depthWrite: false,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      return { pts, posA, colA };
    };
    const r = mkPoints(30000, worldSize * 0.006 + 0.35);
    this.rainPts = r.pts; this.rainPos = r.posA; this.rainCol = r.colA;
    this.scene.add(this.rainPts);
    const w = mkPoints(16000, worldSize * 0.005 + 0.3);
    this.windPts = w.pts; this.windPos = w.posA;
    this.scene.add(this.windPts);

    // Brush ring for painting.
    this.brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
    );
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 999;
    this.scene.add(this.brushRing);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const el = this.renderer.domElement.parentElement!;
    const w = Math.max(2, el.clientWidth), h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTerrain(data: MeshData): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('aFlow', new THREE.BufferAttribute(data.aFlow, 1));
    g.setAttribute('aErode', new THREE.BufferAttribute(data.aErode, 1));
    g.setAttribute('aWet', new THREE.BufferAttribute(data.aWet, 1));
    g.setAttribute('aSed', new THREE.BufferAttribute(data.aSed, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(data.aAO, 1));
    g.setAttribute('aCurv', new THREE.BufferAttribute(data.aCurv, 1));
    g.setAttribute('aHard', new THREE.BufferAttribute(data.aHard, 1));
    g.setAttribute('aRain', new THREE.BufferAttribute(data.aRain, 1));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.terrain.geometry.dispose();
    this.terrain.geometry = g;
  }

  updatePoints(pool: ParticlePool, which: 'rain' | 'wind', visible: boolean): void {
    const pts = which === 'rain' ? this.rainPts : this.windPts;
    pts.visible = visible && pool.alive > 0;
    if (!pts.visible) return;
    const posA = which === 'rain' ? this.rainPos : this.windPos;
    const colA = which === 'rain' ? this.rainCol : null;
    // Grow buffers if the pool grew.
    const need = pool.cap * 3;
    if ((posA.array as Float32Array).length < need) {
      const np = new THREE.BufferAttribute(new Float32Array(need), 3);
      np.setUsage(THREE.DynamicDrawUsage);
      pts.geometry.setAttribute('position', np);
      if (which === 'rain') {
        const nc = new THREE.BufferAttribute(new Float32Array(need), 3);
        nc.setUsage(THREE.DynamicDrawUsage);
        pts.geometry.setAttribute('color', nc);
        this.rainCol = nc;
      }
      this.rainPos = which === 'rain' ? np : this.rainPos;
      if (which === 'wind') this.windPos = np;
    }
    const P = (pts.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const C = which === 'rain'
      ? (pts.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array
      : null;
    const n = pool.alive;
    for (let i = 0; i < n; i++) {
      P[i * 3] = pool.px[i]; P[i * 3 + 1] = pool.py[i]; P[i * 3 + 2] = pool.pz[i];
      if (C) {
        if (pool.state[i] === 1) { C[i * 3] = 0.3; C[i * 3 + 1] = 0.95; C[i * 3 + 2] = 0.9; }
        else {
          const s = Math.min(1, Math.hypot(pool.vx[i], pool.vy[i], pool.vz[i]) / 18);
          C[i * 3] = 0.45 + 0.3 * s; C[i * 3 + 1] = 0.65 + 0.25 * s; C[i * 3 + 2] = 1.0;
        }
      }
    }
    if (!C) {
      // Wind: sandy tint baked once per frame into color attr (reuse rainCol? no—own).
      const wc = pts.geometry.getAttribute('color') as THREE.BufferAttribute;
      const W = wc.array as Float32Array;
      for (let i = 0; i < n; i++) { W[i * 3] = 0.95; W[i * 3 + 1] = 0.85; W[i * 3 + 2] = 0.6; }
      wc.needsUpdate = true;
      (wc as THREE.BufferAttribute).updateRanges;
    } else {
      (pts.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    pts.geometry.setDrawRange(0, n);
  }

  setWater(level: number, visible: boolean): void {
    this.water.position.y = level;
    this.water.visible = visible;
  }

  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.terrainMat.needsUpdate = true;
  }

  setWireframe(on: boolean): void {
    this.terrainMat.wireframe = on;
  }

  updateShade(shade: ShadeParams): void {
    updateTerrainUniforms(this.terrainMat, shade);
    (this.waterMat.uniforms.uSunDir.value as THREE.Vector3)
      .set(shade.sunDirX, shade.sunDirY, shade.sunDirZ).normalize();
    (this.sky.material as THREE.ShaderMaterial).uniforms.uSunDir.value
      .set(shade.sunDirX, shade.sunDirY, shade.sunDirZ).normalize();
    this.sun.position.set(
      shade.sunDirX * this.worldSize, shade.sunDirY * this.worldSize, shade.sunDirZ * this.worldSize
    );
  }

  /** Raycast from client coords → terrain hit (point + face normal). */
  pick(clientX: number, clientY: number): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0] as
      (THREE.Intersection & { face?: { normal: THREE.Vector3 } }) | undefined;
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    return { point: hit.point.clone(), normal: n };
  }

  showBrush(point: THREE.Vector3, normal: THREE.Vector3, radius: number, color: number): void {
    this.brushRing.visible = true;
    this.brushRing.position.copy(point).addScaledVector(normal, 0.15);
    this.brushRing.lookAt(point.clone().add(normal));
    this.brushRing.scale.setScalar(Math.max(radius, 0.01));
    (this.brushRing.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  hideBrush(): void { this.brushRing.visible = false; }

  render(time: number): void {
    this.waterMat.uniforms.uTime.value = time;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  exportPNG(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
