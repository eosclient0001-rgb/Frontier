import { initGPU } from './gpu/device';
import { diagnose, renderDiagnosis } from './gpu/diagnose';
import { configureShaders } from './gpu/shaders';
import { createResources, type Resources } from './gpu/resources';
import { RESOLUTIONS, DEFAULT_RESOLUTION, type GridConfig } from './config';
import { ParamStore, PRESETS } from './params';
import { Simulation } from './sim/simulation';
import { Renderer } from './render/renderer';
import { OrbitCamera } from './render/camera';
import { Panel } from './ui/panel';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statsEl = document.getElementById('stats')!;
const panelEl = document.getElementById('panel')!;
const gateEl = document.getElementById('gate')!;
const gateMsg = document.getElementById('gate-msg')!;

/**
 * Show the failure gate. Runs the capability probe so the user is told which
 * stage actually failed and what to do about it, rather than a bare
 * "WebGPU required".
 */
async function fail(msg: string) {
  console.error(msg);
  try {
    const d = await diagnose();
    // If WebGPU itself is fine, the failure was ours, not the browser's.
    if (d.ok) {
      d.headline = 'The terrain failed to start';
      d.detail = 'WebGPU is available on this machine, so this is a bug in the application rather than your browser.';
      d.steps = ['Open the browser console and send the error text.', 'Try the Low grid preset if this looks like a memory limit.'];
    }
    renderDiagnosis(d, msg);
  } catch {
    gateMsg.textContent = msg;
    gateEl.hidden = false;
  }
}

/** Report boot progress into the gate, so a hang is never a blank spinner. */
function boot(step: string) {
  const el = document.getElementById('gate-msg');
  if (el) el.textContent = step;
  console.info(`[frontier] ${step}`);
}

async function main() {
  boot('Requesting GPU adapter and device…');
  let gpu;
  try {
    gpu = await initGPU(canvas);
  } catch (e) {
    await fail(String(e instanceof Error ? e.message : e));
    return;
  }

  // WebGPU is alive: make certain the gate is down. Belt and braces, because
  // an overlay stuck at z-index 100 makes a perfectly working renderer look
  // completely dead.
  gateEl.hidden = true;
  gateEl.style.display = 'none';

  const { device, context, format } = gpu;

  const store = new ParamStore();
  let gridName = DEFAULT_RESOLUTION;
  let grid: GridConfig = RESOLUTIONS[gridName];

  configureShaders(grid);

  let res: Resources;
  let sim: Simulation;
  let renderer: Renderer;

  try {
    boot('Allocating volume textures…');
    res = createResources(device, grid);
    boot('Compiling simulation shaders…');
    sim = new Simulation(device, res);
    boot('Compiling renderer…');
    renderer = new Renderer(device, res, format);
  } catch (e) {
    await fail(`Failed to create GPU pipelines: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // --- camera -------------------------------------------------------------
  // Framed as a canyon overlook: high enough to clear the plateau by a
  // comfortable margin (see tools/check-camera.mjs) and angled down the
  // drainage so the trunk channel runs away from the viewer.
  const camera = new OrbitCamera(
    [grid.worldW * 0.5, grid.worldH * 0.38, grid.worldD * 0.5],
    grid.worldW * 1.15,
    0.72,
    0.42,
  );
  const camData = new Float32Array(28);

  // --- state --------------------------------------------------------------
  let running = false;
  let needsReset = true;
  let stepsPerFrame = 2;
  let frame = 0;
  let simTime = 0;
  let lastT = performance.now();
  let fps = 0;
  let brushMode = 0; // 0 subtract, 1 add, 2 smooth
  let brushRadius = 22;
  let pendingPick: { origin: [number, number, number]; dir: [number, number, number]; strength: number } | null = null;
  let pendingSculpt: { x: number; y: number; z: number; strength: number } | null = null;
  let pickInFlight = false;

  const brushData = new Float32Array(12);

  // --- panel --------------------------------------------------------------
  const panel = new Panel(panelEl, store, {
    onChange: () => { /* uniforms are re-uploaded every frame */ },
    onPreset: (name) => {
      store.applyPreset(PRESETS[name]);
      panel.refresh();
      needsReset = true;
    },
    onReset: () => { needsReset = true; },
    onTogglePlay: () => { running = !running; return running; },
    onStepOnce: () => { stepOnce = true; },
    onResolution: (name) => { pendingResolution = name; },
    onDebugView: (v) => store.set('debugView', v),
    onBrushMode: (m) => { brushMode = m; },
    onExport: () => {
      const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'frontier-terrain.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });

  let stepOnce = false;
  let pendingResolution: string | null = null;

  // --- input --------------------------------------------------------------
  let dragging = 0; // 0 none, 1 orbit, 2 pan
  let lastX = 0, lastY = 0;
  let sculpting = false;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;

    if (e.ctrlKey || e.metaKey) {
      sculpting = true;
      canvas.classList.add('sculpt');
      requestSculpt(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    dragging = e.button === 0 ? 1 : 2;
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (sculpting) {
      requestSculpt(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (dragging === 1) camera.orbit(dx, dy);
    else if (dragging === 2) camera.pan(dx, dy);
  });

  const endDrag = (e: PointerEvent) => {
    dragging = 0;
    sculpting = false;
    canvas.classList.remove('dragging', 'sculpt');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) {
      brushRadius = Math.max(4, Math.min(90, brushRadius * Math.exp(-e.deltaY * 0.0015)));
    } else {
      camera.zoom(e.deltaY);
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); running = !running; panel.setPlaying(running); }
    if (e.code === 'KeyR') needsReset = true;
    if (e.code === 'BracketLeft') brushRadius = Math.max(4, brushRadius * 0.85);
    if (e.code === 'BracketRight') brushRadius = Math.min(90, brushRadius * 1.18);
  });

  /**
   * Sculpt.
   *
   * The brush must land on the rock the user is actually pointing at, but the
   * volume lives on the GPU and reading it back synchronously would stall the
   * pipeline every frame. So the ray-cast is done by a one-thread compute pass
   * (pick.wgsl) whose result is read asynchronously: we request a pick now and
   * apply the brush when the answer arrives, typically the next frame. At
   * pointer speeds that lag is invisible.
   */
  function requestSculpt(px: number, py: number, add: boolean) {
    const rect = canvas.getBoundingClientRect();
    const dir = camera.rayFromPixel(px - rect.left, py - rect.top, rect.width, rect.height);
    pendingPick = {
      origin: camera.position,
      dir,
      strength: brushMode === 2 ? 0.6 : (add || brushMode === 1 ? 0.85 : -0.85),
    };
  }

  // --- resize -------------------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // --- frame loop ---------------------------------------------------------
  function frameLoop() {
    const now = performance.now();
    const dtMs = now - lastT;
    lastT = now;
    fps = fps * 0.9 + (1000 / Math.max(dtMs, 1)) * 0.1;

    resize();

    // Resolution change: rebuild everything.
    if (pendingResolution && pendingResolution !== gridName) {
      gridName = pendingResolution;
      pendingResolution = null;
      grid = RESOLUTIONS[gridName];
      configureShaders(grid);
      res.destroy();
      res = createResources(device, grid);
      sim = new Simulation(device, res);
      renderer = new Renderer(device, res, format);
      needsReset = true;
    }

    // Upload params.
    store.set('simTime', simTime);
    store.set('stepIndex', sim.stepCount);
    store.set('simRunning', running ? 1 : 0);
    device.queue.writeBuffer(res.paramBuf, 0, store.sync());

    // Upload camera.
    const aspect = canvas.width / Math.max(canvas.height, 1);
    camera.writeUniform(camData, aspect, canvas.width, canvas.height, now * 0.001, frame);
    device.queue.writeBuffer(res.cameraBuf, 0, camData);

    const encoder = device.createCommandEncoder({ label: 'frame' });

    if (needsReset) {
      sim.reset(encoder);
      sim.redistance(encoder, 2);
      needsReset = false;
      store.needsRebuild = false;
      simTime = 0;
    }

    // Ray-cast for the sculpt brush. Encoded now; the readback is issued
    // after submit() below, because mapAsync is only valid once the work has
    // actually been handed to the queue.
    let pickStrength = 0;
    let didPick = false;
    if (pendingPick && !pickInFlight) {
      sim.encodePick(encoder, pendingPick.origin, pendingPick.dir);
      pickStrength = pendingPick.strength;
      didPick = true;
      pendingPick = null;
    }

    // Sculpt.
    if (pendingSculpt) {
      brushData[0] = pendingSculpt.x;
      brushData[1] = pendingSculpt.y;
      brushData[2] = pendingSculpt.z;
      brushData[3] = brushRadius;
      brushData[4] = pendingSculpt.strength;
      brushData[5] = 0.55;            // hardness
      new Uint32Array(brushData.buffer)[6] = 0;                       // shape: sphere
      new Uint32Array(brushData.buffer)[7] = brushMode === 2 ? 1 : 0; // mode
      brushData[8] = 0; brushData[9] = 1; brushData[10] = 0;          // axis
      brushData[11] = 0;
      device.queue.writeBuffer(res.brushBuf, 0, brushData);
      sim.applyBrush(encoder);
      sim.redistance(encoder, 1);
      pendingSculpt = null;
    }

    // Simulate.
    if (running || stepOnce) {
      const n = stepOnce ? 1 : stepsPerFrame;
      for (let i = 0; i < n; i++) {
        sim.step(encoder);
        simTime += store.get('dt');
      }
      stepOnce = false;
    }

    // Render.
    renderer.render(encoder, context.getCurrentTexture().createView(), sim.currentTexture);
    device.queue.submit([encoder.finish()]);

    // Now that the pick pass is queued, read its result asynchronously.
    if (didPick) {
      pickInFlight = true;
      sim.readPick().then((r) => {
        pickInFlight = false;
        if (r && r.hit) {
          pendingSculpt = { x: r.pos[0], y: r.pos[1], z: r.pos[2], strength: pickStrength };
        }
      }).catch(() => { pickInFlight = false; });
    }

    const mb = (grid.volX * grid.volY * grid.volZ * 8 * 2) / 1048576;
    statsEl.textContent =
      `${fps.toFixed(0)} fps   ${canvas.width}×${canvas.height}\n` +
      `grid  ${grid.volX}×${grid.volY}×${grid.volZ}  (${mb.toFixed(0)} MB)\n` +
      `steps ${sim.stepCount}   ${running ? 'ERODING' : 'paused'}\n` +
      `brush r=${brushRadius.toFixed(0)}m`;

    frame++;
    requestAnimationFrame(frameLoop);
  }

  // Start with the canyon preset.
  store.applyPreset(PRESETS['Canyon (Colorado Plateau)']);
  panel.refresh();
  requestAnimationFrame(frameLoop);
}

main().catch((e) => { void fail(String(e instanceof Error ? e.stack ?? e.message : e)); });
