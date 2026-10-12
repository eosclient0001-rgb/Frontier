// Three.js scene: materials per build key, the world group, and ground picking for the editor.

import {
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
  WebGLRenderer
} from "three";
import { FlyCamera } from "./camera";
import { MATERIAL_KEYS, MaterialKey } from "../mesh/worldBuilder";
import { MAP_HALF_EXTENT, terrainHeight } from "../core/terrain";

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly fly: FlyCamera;
  readonly world = new Group();
  readonly overlay = new Group();
  private readonly materials: Record<MaterialKey, MeshStandardMaterial>;
  private readonly terrainMaterial: MeshStandardMaterial;

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = "srgb";
    this.renderer.setClearColor(0x0b0d12, 1);
    host.prepend(this.renderer.domElement);
    this.fly = new FlyCamera(this.renderer.domElement, 1);

    this.scene.background = new Color(0x9db1c6);
    this.scene.fog = new Fog(0x9db1c6, 1400, 5200);
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x3a3328, 1.25));
    const sun = new DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(-700, 1100, 500);
    this.scene.add(sun);
    this.scene.add(this.world, this.overlay);

    const base = { vertexColors: true, side: DoubleSide };
    this.materials = {
      asphalt: new MeshStandardMaterial({ ...base, roughness: 0.92 }),
      ground: new MeshStandardMaterial({ ...base, roughness: 0.95 }),
      paving: new MeshStandardMaterial({ ...base, roughness: 0.85 }),
      marking: new MeshStandardMaterial({ ...base, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      concrete: new MeshStandardMaterial({ ...base, roughness: 0.9 }),
      steel: new MeshStandardMaterial({ ...base, roughness: 0.55, metalness: 0.35 }),
      prop: new MeshStandardMaterial({ ...base, roughness: 0.8 }),
      lamp: new MeshStandardMaterial({ ...base, roughness: 0.5, emissive: 0x3a2a12, emissiveIntensity: 0.7 }),
      terrain: new MeshStandardMaterial({ ...base, roughness: 0.96 }),
      water: new MeshStandardMaterial({ ...base, color: 0x2c5f8a, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.88 }),
      tunnel: new MeshStandardMaterial({ ...base, transparent: true, opacity: 0.32, depthWrite: false, color: 0xff9d4d })
    } as Record<MaterialKey, MeshStandardMaterial>;
    this.terrainMaterial = this.materials.terrain;
    for (const key of MATERIAL_KEYS) if (!this.materials[key]) throw new Error(`missing material ${key}`);

    const resize = (): void => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      this.renderer.setSize(w, h, false);
      this.fly.setAspect(w / Math.max(1, h));
    };
    new ResizeObserver(resize).observe(host);
    resize();
  }

  // Replaces the world meshes with a freshly built set and disposes the old ones.
  setWorld(geometries: Map<MaterialKey, BufferGeometry>): void {
    for (const child of [...this.world.children]) {
      this.world.remove(child);
      (child as Mesh).geometry.dispose();
    }
    for (const [key, geometry] of geometries) {
      const mesh = new Mesh(geometry, this.materials[key]);
      mesh.name = key;
      mesh.frustumCulled = true;
      this.world.add(mesh);
    }
  }

  setUnderground(show: boolean): void {
    this.terrainMaterial.transparent = show;
    this.terrainMaterial.opacity = show ? 0.22 : 1;
    this.terrainMaterial.depthWrite = !show;
    this.terrainMaterial.needsUpdate = true;
  }

  clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      const m = child as Mesh;
      m.geometry?.dispose();
      const mat = m.material as MeshStandardMaterial | undefined;
      mat?.dispose?.();
    }
  }

  // Ray-marches the camera ray against the height field. Returns the first ground hit inside the map, or null.
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5);
    ndc.unproject(this.fly.camera);
    const origin = this.fly.camera.position.clone();
    const dir = ndc.sub(origin).normalize();
    let prev = 0;
    for (let t = 1; t < 9000; t += 6) {
      const p = origin.clone().addScaledVector(dir, t);
      if (Math.abs(p.x) > MAP_HALF_EXTENT || Math.abs(p.z) > MAP_HALF_EXTENT) {
        if (t > 20) return null;
        continue;
      }
      if (p.y < terrainHeight(p.x, p.z)) {
        // Refine between prev and t.
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          const q = origin.clone().addScaledVector(dir, mid);
          if (q.y < terrainHeight(q.x, q.z)) hi = mid;
          else lo = mid;
        }
        const hit = origin.clone().addScaledVector(dir, hi);
        return { x: hit.x, z: hit.z };
      }
      prev = t;
    }
    return null;
  }

  // Projects a world point to CSS pixels inside the viewport.
  toScreen(p: Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.fly.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      visible: v.z < 1 && v.z > -1
    };
  }

  start(onFrame: (dt: number) => void): void {
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.fly.update(dt);
      onFrame(dt);
      this.renderer.render(this.scene, this.fly.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
