/**
 * Frontier Studio — app entry. Wires volume + simulators + mesher + viewport + UI.
 * Frame loop: time-sliced sims → particle points → throttled remesh → stats.
 */
import * as THREE from 'three';
import './styles.css';
import { Volume } from './core/volume';
import { buildTerrain } from './core/sdf';
import { RainSim } from './erosion/rain';
import { WindSim } from './erosion/wind';
import { ThermalSim } from './erosion/thermal';
import { ChemicalSim } from './erosion/chemical';
import { polygonize, MeshData } from './mesher/surfaceNets';
import { Viewport } from './render/viewport';
import { AppState, WORLD_SIZE, defaultState, applyScenario, SCENARIOS } from './graph/nodes';
import { buildUI, UIRefs } from './ui/panels';
import { PaintTool, PAINT_COLORS, PaintMode } from './ui/paint';

class App {
  state: AppState = defaultState();
  vol = new Volume(this.state.volumeRes, WORLD_SIZE, -WORLD_SIZE / 2, 0, -WORLD_SIZE / 2);
  viewport: Viewport;
  rain = new RainSim(this.state.rain);
  wind = new WindSim(this.state.wind);
  thermal = new ThermalSim(this.state.thermal);
  chem = new ChemicalSim(this.state.chemical);
  paintTool = new PaintTool();
  ui: UIRefs;

  private mesh: MeshData | null = null;
  private busy = false;
  private painting = false;
  private paintDirty = false;
  private meshedVersion = -1;
  private remeshCount = 0;
  private lastRemesh = 0;
  private lastStats = 0;
  private lastT = performance.now();
  private fps = 60;
  private frameCount = 0;
  private bakeMs = 0;
  private genTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const canvas = document.getElementById('viewport') as HTMLCanvasElement;
    this.viewport = new Viewport(canvas, this.state.shade, WORLD_SIZE);
    this.viewport.attachFly();
    this.viewport.fly.syncSpeed(this.state.view.flySpeed);
    this.viewport.fly.onSpeedChange = (spd) => {
      this.state.view.flySpeed = spd;
      this.ui.syncAll();
    };
    this.syncPaint();
    this.ui = buildUI(this.state, {
      generate: () => this.generate(),
      togglePlay: () => this.togglePlay(),
      stepBurst: () => this.stepBurst(),
      settleNow: () => this.settleNow(),
      resetSim: () => this.resetSim(),
      remeshNow: () => { if (!this.busy) this.remesh(true); },
      scenario: (i) => this.loadScenario(i),
      exportOBJ: () => this.exportOBJ(),
      exportPNG: () => this.exportPNG(),
      resChange: (res) => this.changeRes(res),
      terrainEdited: () => this.queueGenerate(),
      shadeEdited: () => this.applyShade(),
      viewEdited: () => this.applyView(),
      maskView: () => this.applyShade(),
      brushEdited: () => this.syncPaint(),
    }, {
      top: document.getElementById('topbar')!,
      left: document.getElementById('left-panel')!,
      right: document.getElementById('right-panel')!,
      status: document.getElementById('statusbar')!,
      overlay: document.getElementById('viewport-overlay')!,
    });
    this.bindPointer(canvas);
    this.bindKeys();
    this.applyView();
    this.generate();
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ pipeline
  private async generate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.ui.setBusy(true);
    // Keep shader strata in sync with the builder.
    const t = this.state.terrain;
    this.state.shade.strataFreq = t.strataFreq / WORLD_SIZE;
    const dl = Math.hypot(1, t.dipTilt);
    this.state.shade.dipX = (t.dipTilt * 0.6) / dl;
    this.state.shade.dipY = 1 / dl;
    this.state.shade.dipZ = (t.dipTilt * 0.8) / dl;
    try {
      await buildTerrain(this.vol, t, (p, label) => this.ui.setProgress(p, label));
      this.rain.reset(); this.wind.reset(); this.thermal.reset(); this.chem.reset();
      this.applyShade();
      this.remesh(true);
      this.ui.setStatus(`Built ${t.landform} · seed ${t.seed} · ${this.state.volumeRes}³`);
    } finally {
      this.busy = false;
      this.ui.setBusy(false);
      this.ui.setProgress(1, 'done');
    }
  }

  private queueGenerate(): void {
    if (this.genTimer) clearTimeout(this.genTimer);
    this.genTimer = setTimeout(() => this.generate(), 450);
  }

  private remesh(full: boolean): void {
    const t0 = performance.now();
    const data = polygonize(this.vol, { bakeAO: true, bakeCurv: full });
    this.mesh = data;
    this.viewport.setTerrain(data);
    this.meshedVersion = this.vol.version;
    this.paintDirty = false;
    this.lastRemesh = performance.now();
    this.bakeMs = performance.now() - t0;
    this.remeshCount++;
  }

  private togglePlay(): void {
    this.state.playing = !this.state.playing;
    this.ui.setPlaying(this.state.playing);
    // Fresh full bake when pausing so AO/curvature settle on the final shape.
    if (!this.state.playing && !this.busy) this.remesh(true);
  }

  /** Run ~2 simulated seconds synchronously, chunked to keep UI alive. */
  private async stepBurst(): Promise<void> {
    if (this.busy || this.state.playing) return;
    this.busy = true;
    this.ui.setBusy(true);
    try {
      const steps = 60, dt = 1 / 30;
      const b = this.state.view.simBudgetMs;
      for (let s = 0; s < steps; s++) {
        this.rain.update(this.vol, dt, b * 0.62);
        this.wind.update(this.vol, dt, b * 0.22);
        if (this.state.thermal.enabled) this.thermal.update(this.vol, dt);
        this.chem.update(this.vol, dt, b * 0.16);
        if (s % 10 === 9) {
          this.ui.setProgress(s / steps, 'burst');
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.vol.sanitize();
      this.remesh(true);
      this.ui.setStatus('Burst complete (+2.0 s simulated).');
    } finally {
      this.busy = false;
      this.ui.setBusy(false);
      this.ui.setProgress(1, 'done');
    }
  }

  private settleNow(): void {
    if (this.busy) return;
    const was = this.state.thermal.enabled;
    this.state.thermal.enabled = true;
    for (let i = 0; i < 5; i++) this.thermal.update(this.vol, 0.12);
    this.state.thermal.enabled = was;
    this.remesh(false);
    this.ui.setStatus('Thermal settle burst applied.');
  }

  private resetSim(): void {
    this.vol.clearSim();
    this.vol.sanitize();
    this.rain.reset(); this.wind.reset(); this.thermal.reset(); this.chem.reset();
    this.remesh(false);
    this.ui.setStatus('Sim reset (terrain + paint kept).');
  }

  private loadScenario(i: number): void {
    applyScenario(this.state, i);
    this.ui.syncAll();
    this.syncPaint();
    this.ui.setStatus(`${SCENARIOS[i].name} — ${SCENARIOS[i].hint}`);
    this.generate();
  }

  private changeRes(res: number): void {
    if (res === this.state.volumeRes || this.busy) return;
    this.state.volumeRes = res;
    this.vol = new Volume(res, WORLD_SIZE, -WORLD_SIZE / 2, 0, -WORLD_SIZE / 2);
    this.meshedVersion = -1;
    this.generate();
  }

  private applyShade(): void {
    this.viewport.updateShade(this.state.shade);
    this.viewport.setWater(this.state.shade.waterLevel, this.state.view.showWater);
  }

  private applyView(): void {
    const v = this.state.view;
    this.viewport.fly.syncSpeed(v.flySpeed);
    this.viewport.setWater(this.state.shade.waterLevel, v.showWater);
    this.viewport.setWireframe(v.wireframe);
    this.viewport.setShadows(v.shadows);
    if (!v.paintArmed) this.viewport.hideBrush();
  }

  private syncPaint(): void {
    this.paintTool.mode = this.state.brush.mode;
    this.paintTool.radius = this.state.brush.radius;
    this.paintTool.strength = this.state.brush.strength;
  }

  // ------------------------------------------------------------ picking
  /** SDF sphere-tracing picker — fast on any mesh density, no BVH needed. */
  private pickSDF(clientX: number, clientY: number): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    const canvas = this.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.viewport.camera);
    const ro = rc.ray.origin, rd = rc.ray.direction;
    // Slab test vs volume AABB for a tight t-range.
    const ox = this.vol.ox, oy = this.vol.oy, oz = this.vol.oz, s = this.vol.size;
    let t0 = 0, t1 = Infinity;
    const mins = [ox, oy, oz], maxs = [ox + s, oy + s, oz + s], o = [ro.x, ro.y, ro.z], d = [rd.x, rd.y, rd.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < mins[a] || o[a] > maxs[a]) return null;
      } else {
        let ta = (mins[a] - o[a]) / d[a], tb = (maxs[a] - o[a]) / d[a];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return null;
      }
    }
    const vox = this.vol.vox;
    let t = Math.max(t0, 0);
    const n = new Float32Array(3);
    for (let i = 0; i < 300; i++) {
      const x = ro.x + rd.x * t, y = ro.y + rd.y * t, z = ro.z + rd.z * t;
      const sd = this.vol.sampleSdf(x, y, z);
      if (sd < vox * 0.55) {
        this.vol.normal(x, y, z, n);
        return { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(n[0], n[1], n[2]) };
      }
      t += Math.max(sd * 0.85, vox * 0.35);
      if (t > t1) return null;
    }
    return null;
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.state.view.paintArmed || e.button !== 0 || this.busy) return;
      this.painting = true;
      this.viewport.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      this.paintAt(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.state.view.paintArmed || this.busy) return;
      if (this.painting) this.paintAt(e);
      else {
        const hit = this.pickSDF(e.clientX, e.clientY);
        if (hit) this.viewport.showBrush(hit.p, hit.n, this.paintTool.radius, PAINT_COLORS[this.paintTool.mode]);
        else this.viewport.hideBrush();
      }
    });
    const end = (e: PointerEvent) => {
      if (e.button === 0) this.painting = false;
      // Only re-enable orbit when NO button is held (RMB-look may be active).
      if (e.buttons === 0) this.viewport.controls.enabled = true;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', (e) => {
      if (this.busy) return;
      const hit = this.pickSDF(e.clientX, e.clientY);
      if (hit) {
        this.viewport.controls.target.copy(hit.p);
        this.ui.setStatus('Orbit focus set.');
      }
    });
    canvas.addEventListener('pointerleave', () => { if (!this.painting) this.viewport.hideBrush(); });
  }

  private paintAt(e: PointerEvent): void {
    const hit = this.pickSDF(e.clientX, e.clientY);
    if (!hit) return;
    // Nudge into the surface shell so the stamp covers the skin.
    const px = hit.p.x - hit.n.x * this.vol.vox * 0.5;
    const py = hit.p.y - hit.n.y * this.vol.vox * 0.5;
    const pz = hit.p.z - hit.n.z * this.vol.vox * 0.5;
    if (this.paintTool.apply(this.vol, px, py, pz)) this.paintDirty = true;
    this.viewport.showBrush(hit.p, hit.n, this.paintTool.radius, PAINT_COLORS[this.paintTool.mode]);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.code === 'KeyR') { if (!this.busy) this.remesh(true); }
      else if (e.code === 'KeyP') {
        this.state.view.paintArmed = !this.state.view.paintArmed;
        this.ui.syncAll();
        this.applyView();
      } else if (e.code.startsWith('Digit')) {
        const modes: PaintMode[] = ['rain', 'harden', 'soften', 'soluble', 'erase'];
        const m = modes[parseInt(e.code.slice(5), 10) - 1];
        if (m) { this.state.brush.mode = m; this.syncPaint(); this.ui.syncAll(); }
      }
    });
  }

  // ------------------------------------------------------------ export
  private download(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  }

  private exportPNG(): void {
    this.download(this.viewport.exportPNG(), `frontier-${Date.now()}.png`);
    this.ui.setStatus('Viewport snapshot exported.');
  }

  private exportOBJ(): void {
    if (!this.mesh) return;
    const m = this.mesh;
    const lines: string[] = ['# Frontier SDF terrain export'];
    for (let i = 0; i < m.vertCount; i++) {
      lines.push(`v ${m.positions[i * 3].toFixed(4)} ${m.positions[i * 3 + 1].toFixed(4)} ${m.positions[i * 3 + 2].toFixed(4)}`);
    }
    for (let i = 0; i < m.vertCount; i++) {
      lines.push(`vn ${m.normals[i * 3].toFixed(4)} ${m.normals[i * 3 + 1].toFixed(4)} ${m.normals[i * 3 + 2].toFixed(4)}`);
    }
    for (let t = 0; t < m.triCount; t++) {
      const a = m.indices[t * 3] + 1, b = m.indices[t * 3 + 1] + 1, c = m.indices[t * 3 + 2] + 1;
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    this.download(url, `frontier-terrain-${Date.now()}.obj`);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.ui.setStatus(`Mesh exported (${(m.vertCount / 1000).toFixed(0)}k verts).`);
  }

  // ------------------------------------------------------------ loop
  private frame = (t: number): void => {
    requestAnimationFrame(this.frame);
    const dtRaw = (t - this.lastT) / 1000;
    this.lastT = t;
    this.fps += (1 / Math.max(dtRaw, 1e-4) - this.fps) * 0.06;
    const dt = Math.min(dtRaw, 0.05);

    let simMs = 0;
    if (this.state.playing && !this.busy) {
      const t0 = performance.now();
      const b = this.state.view.simBudgetMs;
      this.rain.update(this.vol, dt, b * 0.62);
      this.wind.update(this.vol, dt, b * 0.22);
      if (this.state.thermal.enabled) this.thermal.update(this.vol, dt);
      this.chem.update(this.vol, dt, b * 0.16);
      simMs = performance.now() - t0;
    }
    this.viewport.updatePoints(this.rain.pool, 'rain', this.state.view.showRainParticles);
    this.viewport.updatePoints(this.wind.pool, 'wind', this.state.view.showWindParticles);

    const now = performance.now();
    if (
      this.state.view.autoRemesh && !this.busy &&
      (this.vol.version !== this.meshedVersion || this.paintDirty) &&
      now - this.lastRemesh > this.state.view.remeshMs
    ) {
      this.remesh(this.remeshCount % Math.max(1, this.state.view.fullBakeEvery) === 0);
    }
    this.frameCount++;
    if (this.frameCount % 240 === 0 && this.state.playing) this.vol.sanitize();
    if (now - this.lastStats > 250) {
      this.lastStats = now;
      const carved = this.rain.stats.carved + this.wind.stats.carved + this.thermal.stats.carved + this.chem.stats.carved;
      const deposited = this.rain.stats.deposited + this.wind.stats.deposited + this.thermal.stats.deposited + this.chem.stats.deposited;
      const inFlight = this.rain.stats.inFlight + this.wind.stats.inFlight;
      this.ui.updateStats({
        fps: this.fps,
        verts: this.mesh?.vertCount ?? 0,
        tris: this.mesh?.triCount ?? 0,
        rainAlive: this.rain.pool.alive,
        windAlive: this.wind.pool.alive,
        carved, deposited, inFlight,
        bakeMs: this.bakeMs,
        sdfVersion: this.vol.version,
        simMs,
      });
    }
    this.viewport.fly.update(dt);
    this.viewport.render(t / 1000);
  };
}

new App();
