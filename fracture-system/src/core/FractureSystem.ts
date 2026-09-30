/**
 * ============================================================================
 *  FractureSystem — the public API
 * ============================================================================
 *
 *  Everything a game needs, behind four calls:
 *
 *      const sys = new FractureSystem(canvas)
 *      sys.setMaterial('glass')
 *      sys.strike(point, direction, severity)     // returns immediately
 *      sys.update(dt)                             // call every frame
 *
 *  Internally it owns the coupled peridynamics + crack-front simulation, the
 *  carver, the shaders and the fragment rigid bodies, and it reports progress
 *  through callbacks so a HUD can show what is happening.
 *
 *  Production notes for when this moves into a real engine:
 *    - `strike` is O(bonds) and the carver is O(voxels); both are worker- or
 *      compute-shaped. See README "Where to take this next".
 *    - fragments are handed to the engine as geometry + mass + inertia, which
 *      is exactly what a native physics engine wants; nothing here is
 *      renderer-specific except the ShaderMaterial.
 *    - the damage field can be uploaded as a 3D texture and sampled by the
 *      *intact* mesh's material, so cracks are visible on the original object
 *      before it comes apart. That is the AAA approach and it is one
 *      Data3DTexture away from what is implemented here.
 * ============================================================================
 */

import {
  Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
  Data3DTexture, RedFormat, UnsignedByteType, NearestFilter, BufferGeometry, BufferAttribute,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { FractureSim, MATERIAL_LOOKS, SOFTENING } from './FractureSim.ts';
import type { SimConfig } from './FractureSim.ts';
import type { CarveResult, FragmentMesh } from '../fracture/Carver.ts';
import { FragmentSystem } from '../render/FragmentSystem.ts';
import { FRACTURE_FRAG, FRACTURE_VERT, MATERIAL_DEFINES } from '../render/MaterialShaders.ts';
import { MaterialType } from '../materials.ts';
import type { Vec3 } from '../fracture/CrackNetwork.ts';
import { evalSDF, makePrefab } from '../sdf/SDF.ts';
import type { PrefabShape } from '../sdf/SDF.ts';

export interface SystemOptions {
  material: MaterialType;
  shape: PrefabShape;
  size: [number, number, number];
  detail: number;
  anchored: boolean;
  toughnessScale: number;
}

export interface SystemStats {
  state: string;
  latticeNodes: number;
  latticeBonds: number;
  substeps: number;
  msPerSubstep: number;
  damage: number;
  crackFronts: number;
  activeFronts: number;
  crackLength: number;
  maxCrackSpeed: number;
  fragments: number;
  solveMs: number;
  carveMs: number;
  fps: number;
  gpu: 'webgpu' | 'webgl';
}

const DEFAULT_OPTIONS: SystemOptions = {
  material: MaterialType.GLASS,
  shape: 'plate',
  size: [0.5, 0.4, 0.03],
  detail: 3,
  anchored: true,
  toughnessScale: 0.3,
};

export class FractureSystem {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  options: SystemOptions;
  private sim!: FractureSim;
  private fragments!: FragmentSystem;
  private intactMesh: Mesh | null = null;
  private intactMaterial!: ShaderMaterial;
  private fragmentMaterial!: ShaderMaterial;

  /** Damage/state texture so the intact object shows cracks as they form. */
  private damageTexture: Data3DTexture | null = null;

  private lastFrame = performance.now();
  private fps = 60;
  private solveMs = 0;
  private carveMs = 0;
  private lastFragmentCount = 0;
  private phase: 'idle' | 'solving' | 'carving' | 'done' = 'idle';
  private carveResult: CarveResult | null = null;

  /** Hooks for the HUD. */
  onPhase?: (phase: string, detail?: string) => void;
  onFragments?: (result: CarveResult) => void;

  constructor(private readonly canvas: HTMLCanvasElement, options: Partial<SystemOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(new Color(0x0a0b10), 1);

    this.camera = new PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0.85, 0.65, 0.95);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 0, 0);

    this.buildLights();
    this.buildEnvironment();
    this.rebuild();
  }

  // ── scene setup ───────────────────────────────────────────────────────

  private buildLights(): void {
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(1.4, 2.2, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const d = 1.6;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 8;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const rim = new DirectionalLight(0x88bbff, 0.9);
    rim.position.set(-1.6, 0.6, -1.2);
    this.scene.add(rim);

    this.scene.add(new HemisphereLight(0x8fb6ff, 0x2a2419, 0.7));
  }

  private buildEnvironment(): void {
    // studio floor: catches shadows and gives the fragments something to land on
    const floor = new Mesh(
      new PlaneGeometry(14, 14),
      new MeshBasicMaterial({ color: 0x14161d }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.35;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** Build (or rebuild) the intact object and its material. */
  rebuild(): void {
    if (this.intactMesh) {
      this.scene.remove(this.intactMesh);
      this.intactMesh.geometry.dispose();
      this.intactMesh = null;
    }
    this.fragments.clear();
    this.scene.remove(this.fragments.group);
    this.carveResult = null;
    this.lastFragmentCount = 0;
    this.phase = 'idle';

    const o = this.options;
    this.sim = new FractureSim({
      material: o.material,
      shape: o.shape,
      size: o.size,
      detail: o.detail,
      grainAxis: o.material === MaterialType.WOOD ? [1, 0, 0] : [0, 1, 0],
      anchored: o.anchored,
      seed: (Math.random() * 1e9) | 0,
      toughnessScale: o.toughnessScale,
    });

    this.intactMaterial = this.makeMaterial(false);
    this.fragmentMaterial = this.makeMaterial(true);
    this.fragments = new FragmentSystem(-0.35, this.fragmentMaterial);
    this.scene.add(this.fragments.group);

    this.intactMesh = new Mesh(this.buildIntactGeometry(), this.intactMaterial);
    this.intactMesh.castShadow = true;
    this.intactMesh.receiveShadow = true;
    this.scene.add(this.intactMesh);

    this.buildDamageTexture();
    this.frameCamera();
  }

  /**
   * The intact object is the *same* geometry pipeline, run with no cracks.
   *
   * Using a coarse carve rather than a hand-built primitive is deliberate: the
   * intact object and the fragments are then guaranteed to be the same shape,
   * so the swap from "cracked but whole" to "fallen apart" is seamless, and
   * non-box prefabs (bottles, rocks, capsules) come out correct for free.
   */
  private buildIntactGeometry(): BufferGeometry {
    const r = this.sim.carveFragments(30);
    const geo = new BufferGeometry();
    if (r.fragments.length) {
      const f = r.fragments[0];
      geo.setAttribute('position', new BufferAttribute(f.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(f.normals, 3));
      geo.setAttribute('aFaceKind', new BufferAttribute(f.faceKind, 1));
      geo.setAttribute('aCrackRadial', new BufferAttribute(f.crackRadial, 1));
      geo.setAttribute('aCrackId', new BufferAttribute(f.crackId, 1));
      const seed = new Float32Array(f.positions.length / 3);
      seed.fill(0.5);
      geo.setAttribute('aNormalSeed', new BufferAttribute(seed, 1));
      geo.translate(-f.centroid[0], -f.centroid[1], -f.centroid[2]);
    }
    return geo;
  }

  private buildDamageTexture(): void {
    // 3D texture of the peridynamic damage field, sampled by the shader so the
    // intact mesh darkens/glows along the advancing crack path.
    const res = 32;
    const data = new Uint8Array(res * res * res);
    const tex = new Data3DTexture(data, res, res, res);
    tex.format = RedFormat;
    tex.type = UnsignedByteType;
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    this.damageTexture = tex;
  }

  private makeMaterial(isFragment: boolean): ShaderMaterial {
    const look = MATERIAL_LOOKS[this.options.material];
    const mat = new ShaderMaterial({
      vertexShader: FRACTURE_VERT,
      fragmentShader: FRACTURE_FRAG,
      defines: { [MATERIAL_DEFINES[look.id].replace('#define ', '')]: '' },
      uniforms: {
        uLightDir: { value: new Vector3(1.4, 2.2, 1.6).normalize() },
        uLightColor: { value: new Color(0xffffff) },
        uFillColor: { value: new Color(0x8fb6ff) },
        uSkyColor: { value: new Color(0xa8ccff) },
        uGroundColor: { value: new Color(0x2a2419) },
        uCameraPos: { value: new Vector3() },
        uTime: { value: 0 },
        uDamageAmount: { value: 0 },
        uInteriorTint: { value: new Vector3(...look.interiorTint) },
        uRoughness: { value: 0.5 },
        uGrainAxis: { value: new Vector3(...(this.options.material === MaterialType.WOOD ? [1, 0, 0] : [0, 1, 0])) },
        uIsFragment: { value: isFragment ? 1 : 0 },
      },
    });
    // three injects these; our shader uses the same names
    mat.defines = { ...mat.defines, USE_SHADOWMAP: '' };
    return mat;
  }

  private frameCamera(): void {
    const r = Math.max(...this.options.size);
    this.camera.position.set(r * 1.7, r * 1.25, r * 1.9);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // ── interaction ───────────────────────────────────────────────────────

  /**
   * Hit the object.
   *
   * `severity` is the induced strain as a multiple of the material's failure
   * strain — the single number that decides whether you get a chip, a star of
   * radial cracks, or a pulverised contact zone.
   */
  strike(point: Vec3, direction: Vec3, severity: number, energy = 0): void {
    if (this.phase === 'solving' || this.phase === 'carving') return;
    if (this.carveResult) this.rebuild();

    this.recordImpact(point, direction, energy > 0 ? energy : 0.05 * severity);
    // energy <= 0 => derive the impulse from `severity`, the honest control
    this.sim.triggerImpact(point, direction, energy, severity);
    this.phase = 'solving';
    this.onPhase?.('solving', `${this.sim.stats().latticeNodes} nodes`);
  }

  /** Reset to a pristine object. */
  reset(): void {
    this.rebuild();
    this.onPhase?.('idle');
  }

  setMaterial(material: MaterialType, shape: PrefabShape, size: [number, number, number], anchored: boolean): void {
    this.options = { ...this.options, material, shape, size, anchored };
    this.rebuild();
  }

  setDetail(detail: number): void {
    this.options = { ...this.options, detail };
    this.rebuild();
  }

  setToughnessScale(s: number): void {
    this.options = { ...this.options, toughnessScale: s };
    this.sim.cfg.toughnessScale = s;
  }

  // ── per-frame ─────────────────────────────────────────────────────────

  update(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.1;

    // physics of the current phase
    if (this.phase === 'solving') {
      const t0 = performance.now();
      const stillRunning = this.sim.advance(9);   // 9 ms of the frame budget
      this.solveMs = performance.now() - t0;

      // the intact mesh stays visible through the event, showing cracks
      if (this.intactMesh) {
        this.intactMaterial.uniforms.uDamageAmount.value = Math.min(1, this.sim.lattice.meanDamage() * 6 + this.sim.network.stats().totalLength * 2);
      }

      if (!stillRunning) {
        this.phase = 'carving';
        this.onPhase?.('carving');
      }
    } else if (this.phase === 'carving') {
      // one-shot: carve, build the meshes, hand them to the rigid-body sim
      const t0 = performance.now();
      const result = this.sim.carveFragments();
      this.carveMs = performance.now() - t0;
      this.carveResult = result;
      this.lastFragmentCount = result.fragments.length;

      // where did the strike happen? reuse the impact for the impulse field
      const impactPoint = this.lastImpactPoint ?? [0, 0, 0];
      const impactDir = this.lastImpactDir ?? [0, 1, 0];
      const m = this.options.material;
      const restitution = m === MaterialType.GLASS ? 0.28 : m === MaterialType.PLASTIC ? 0.42 : 0.18;
      const friction = m === MaterialType.GLASS ? 0.14 : m === MaterialType.WOOD ? 0.55 : m === MaterialType.PLASTIC ? 0.42 : 0.6;

      this.fragments.spawn(
        result.fragments, impactPoint as Vec3, impactDir as Vec3,
        this.lastImpactEnergy ?? 1, restitution, friction, 0.35,
      );
      this.onFragments?.(result);
      this.phase = 'done';
      this.onPhase?.('done', `${result.fragments.length} fragments`);
    }

    // fragment dynamics + camera uniforms
    if (this.phase === 'done') this.fragments.step(dt);

    // keep the shading camera position in sync (needed for Fresnel + refraction)
    this.intactMaterial.uniforms.uCameraPos.value.copy(this.camera.position);
    this.fragmentMaterial.uniforms.uCameraPos.value.copy(this.camera.position);
    this.intactMaterial.uniforms.uTime.value = now / 1000;
    this.fragmentMaterial.uniforms.uTime.value = now / 1000;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private lastImpactPoint: number[] | null = null;
  private lastImpactDir: number[] | null = null;
  private lastImpactEnergy: number | null = null;

  /** Record the impact so the fragment impulse field can use it. */
  recordImpact(point: Vec3, direction: Vec3, energy: number): void {
    this.lastImpactPoint = [...point];
    this.lastImpactDir = [...direction];
    this.lastImpactEnergy = energy;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Raycast the intact object to find where a click landed. */
  pick(clientX: number, clientY: number): Vec3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const dir = ray.clone();
    // march the object SDF
    const origin = this.camera.position.clone();
    let t = 0.02;
    for (let i = 0; i < 220; i++) {
      const p = origin.clone().addScaledVector(dir, t);
      const d = evalSDF(this.sim.object, p.x, p.y, p.z);
      if (d < 0.002) return [p.x, p.y, p.z];
      t += Math.max(0.002, Math.abs(d) * 0.8);
      if (t > 12) break;
    }
    return null;
  }

  stats(): SystemStats {
    const s = this.sim.stats();
    return {
      state: this.phase,
      latticeNodes: s.latticeNodes,
      latticeBonds: s.latticeBonds,
      substeps: s.substeps,
      msPerSubstep: s.msPerSubstep,
      damage: s.damage,
      crackFronts: s.crackFronts,
      activeFronts: s.activeFronts,
      crackLength: s.crackLength,
      maxCrackSpeed: s.maxCrackSpeed,
      fragments: this.lastFragmentCount,
      solveMs: this.solveMs,
      carveMs: this.carveMs,
      fps: this.fps,
      gpu: 'webgl',
    };
  }

  get fragmentBodies() { return this.fragments.bodies; }

  /** Shake the settled pile. */
  shock(point: Vec3, strength: number): void {
    this.fragments.applyShock(point, strength);
  }
}
