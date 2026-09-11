// Frontier SDF — app shell: boot, main loop, camera, wiring, export, diagnostics.

import { Graph, compileGraph, buildPreset, PRESETS, NODE_DEFS } from "./graph.js?v=3";
import { Sim } from "./sim.js?v=3";
import { Renderer } from "./render.js?v=3";
import { NodeEditor } from "./nodes-ui.js?v=3";
import { buildOutliner, buildInspector } from "./panels.js?v=3";
import { $, el, toast, download, fmt, fmtInt, clamp } from "./util.js?v=3";

const errors = [];
window.addEventListener("error", (e) => {
  errors.push(`Error: ${e.message}`);
  toast(`Error: ${e.message}`, "error", 6000);
});
window.addEventListener("unhandledrejection", (e) => {
  errors.push(`Rejection: ${e.reason?.message || e.reason}`);
  toast(`Error: ${e.reason?.message || e.reason}`, "error", 6000);
});

const S = {
  running: true, speed: 2, particles: 2048, particleSize: 1.0,
  waterLevel: 0.7, clarity: 0.6, flowK: 1.0, foamAmt: 1.0, foamReach: 1.2, ripple: 0.18,
  renderScale: 0.75, steps: 160, sunAngle: 135, sunElev: 42, haze: 0.25, strata: 1.0,
  layers: { terrain: true, water: true, ribbons: true, particles: true, plumes: true },
  ledgerHTML: "",
};
const ui = { selected: null, layers: S.layers, presets: PRESETS };
const cam = { target: [0, 2.5, 0], yaw: 0.65, pitch: 0.52, dist: 52, fov: 50 };
const HOME = JSON.parse(JSON.stringify(cam));

function eyeFromCam() {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return [
    cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
    cam.target[1] + cam.dist * sp,
    cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
  ];
}
function camBasis() {
  const eye = eyeFromCam();
  const fx = cam.target[0] - eye[0], fy = cam.target[1] - eye[1], fz = cam.target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = [fx / fl, fy / fl, fz / fl];
  let rx = f[2] * 0 - 0 * 1, ry = 0, rz = 0;
  // right = normalize(cross(f, up))
  rx = f[1] * 0 - f[2] * 1; ry = f[2] * 0 - f[0] * 0; rz = f[0] * 1 - f[1] * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  return { eye, f, r: [rx / rl, ry / rl, rz / rl] };
}

let gl, sim, renderer, graph, editor;
let canvas, renderTime = 0, lastT = 0, fpsEMA = 60, frame = 0;
let regenTimer = 0, flowTimer = 0, riverParams = null, auditTimer = 0;

function riverFromGraph() {
  if (!graph) return null;
  const chain = graph.chainSet();
  const n = graph.nodes.find((x) => x.type === "river" && x.enabled !== false && chain.has(x.id));
  if (!n) return null;
  const p = n.params;
  return { inletX: p.inletX, inletZ: p.inletZ, dirX: p.dirX || 0.001, dirZ: p.dirZ || 0.001, width: p.width, speed: p.speed };
}

function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(regen, 250);
}
function scheduleFlow() {
  clearTimeout(flowTimer);
  flowTimer = setTimeout(() => { try { sim.bakeFlow(); } catch (e) { console.warn(e); } }, 300);
}

function regen() {
  if (!sim) return;
  const t0 = performance.now();
  const res = compileGraph(graph);
  editor.setChain(res.chain);
  riverParams = riverFromGraph();
  if (!res.ok) {
    toast(res.warnings[0] || "Graph failed to compile.", "error");
    refreshPanels();
    editor.refresh();
    return;
  }
  try {
    sim.setErosion(res.erosion, S.waterLevel);
    sim.regenBase(res.code);
  } catch (e) {
    errors.push(`Regen: ${e.message}`);
    toast(`Terrain build failed: ${e.message}`, "error", 7000);
    return;
  }
  for (const w of res.warnings.slice(0, 3)) toast(w, "warn", 5000);
  const ms = (performance.now() - t0).toFixed(0);
  $("#stat-build").textContent = `build ${ms}ms`;
  audit(true);
  refreshPanels();
  editor.refresh();
  editor.select(ui.selected);
}

function refreshPanels() {
  buildOutliner($("#outliner"), graph, ui, outlinerCB);
  buildInspector($("#inspector"), graph, ui, S, inspectorCB);
}

const outlinerCB = {
  onSelect: (id) => { ui.selected = id; editor.select(id); refreshPanels(); },
  onAddMenu: (x, y) => editor.openAddMenu(x, y, { x: 200, y: 200 }),
  onLayer: (k, v) => { ui.layers[k] = v; },
  onPreset: (key) => loadPreset(key),
};
const inspectorCB = {
  onSelect: (id) => { ui.selected = id; editor.select(id); refreshPanels(); },
  onSim: (patch) => {
    Object.assign(S, patch);
    if (patch.particles) sim.activeCount = S.particles;
  },
  onWater: (patch) => {
    Object.assign(S, patch);
    sim.waterLevel = S.waterLevel;
    scheduleFlow();
  },
  onRender: (patch) => { Object.assign(S, patch); resize(); },
  onStep: (n) => { for (let i = 0; i < n; i++) sim.step(1 / 60); audit(true); toast(`Stepped ${n} ticks.`, "info", 2000); },
  onResetSim: () => { regen(); toast("Simulation reset to base graph.", "info", 2500); },
  onAudit: () => audit(false),
};

function audit(quiet) {
  try {
    const a = sim.audit(quiet);
    if (!a) return;
    const out = sim.initialSolid > 0 ? sim.initialSolid - a.solid - a.deposited - a.carried : 0;
    S.ledgerHTML =
      `<div><span>Active / resting</span><b>${fmtInt(a.active)} / ${fmtInt(a.resting)}</b></div>` +
      `<div><span>Rock mass now</span><b>${fmt(a.solid, 1)} m³</b></div>` +
      `<div><span>Deposited</span><b>${fmt(a.deposited, 2)} m³</b></div>` +
      `<div><span>Carried</span><b>${fmt(a.carried, 2)} m³</b></div>` +
      `<div><span>Boundary outflow*</span><b>${fmt(out, 2)} m³</b></div>` +
      `<div><span>River agents</span><b>${fmtInt(a.river)}</b></div>` +
      `<p class="dim">*Load carried off-domain or retired with age. Wet cells: ${fmtInt(a.wet)}.</p>`;
    const led = $("#inspector .ledger");
    if (led) led.innerHTML = S.ledgerHTML;
    $("#stat-sim").textContent =
      `tick ${fmtInt(sim.tick)} · ${fmtInt(a.active)} live · ${fmtInt(a.resting)} settled · rock ${fmt(a.solid, 0)}m³`;
  } catch (e) {
    if (!quiet) toast("Ledger readback unavailable on this GPU.", "warn");
  }
}

function loadPreset(key) {
  try {
    graph.deserialize(buildPreset(key));
    ui.selected = null;
    $("#docname").value = PRESETS[key].title;
    regen();
    editor.fitView();
    toast(`Loaded preset “${PRESETS[key].title}”.`, "info", 2500);
  } catch (e) {
    toast(`Preset failed: ${e.message}`, "error");
  }
}

// ---------- camera input ----------
function bindCamera() {
  const keys = new Set();
  let drag = null;
  const pinch = new Map();
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.size === 2) { drag = null; return; }
    drag = { b: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag?.pinchD) cam.dist = clamp(cam.dist * (drag.pinchD / Math.max(d, 1)), 6, 160);
      drag = { pinchD: d };
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.b === 1 || drag.shift) {
      // pan
      const { r, f } = camBasis();
      const s = cam.dist * 0.0016;
      const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      for (let i = 0; i < 3; i++) cam.target[i] += (-dx * r[i] + dy * up[i]) * s;
    } else {
      cam.yaw -= dx * 0.005;
      cam.pitch = clamp(cam.pitch + dy * 0.005, -1.2, 1.5);
    }
  });
  const up = (e) => { pinch.delete(e.pointerId); if (pinch.size < 2) drag = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * Math.pow(1.0012, e.deltaY), 6, 160);
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
    keys.add(e.code);
    if (e.code === "Space") { e.preventDefault(); toggleRun(); }
    if (e.code === "Home") { Object.assign(cam, JSON.parse(JSON.stringify(HOME))); }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  // WASD/QE fly while RMB held (or always when pointer over canvas? require RMB like before)
  let rmb = false;
  canvas.addEventListener("pointerdown", (e) => { if (e.button === 2) rmb = true; });
  window.addEventListener("pointerup", (e) => { if (e.button === 2) rmb = false; });
  setInterval(() => {
    if (!rmb) return;
    const sp = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 32 : 8) * 0.016;
    const { f, r } = camBasis();
    const mv = [0, 0, 0];
    const add = (v, s) => { mv[0] += v[0] * s; mv[1] += v[1] * s; mv[2] += v[2] * s; };
    if (keys.has("KeyW")) add(f, sp);
    if (keys.has("KeyS")) add(f, -sp);
    if (keys.has("KeyD")) add(r, sp);
    if (keys.has("KeyA")) add(r, -sp);
    if (keys.has("KeyE")) mv[1] += sp;
    if (keys.has("KeyQ")) mv[1] -= sp;
    for (let i = 0; i < 3; i++) cam.target[i] += mv[i];
  }, 16);
}

// ---------- frame loop ----------
function resize() {
  if (!canvas || !renderer) return;
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer.ensureScene(Math.max(2, Math.round(w * S.renderScale)), Math.max(2, Math.round(h * S.renderScale)));
}

function toggleRun() {
  S.running = !S.running;
  $("#run-label").textContent = S.running ? "Pause" : "Run erosion";
  $("#run").classList.toggle("paused", !S.running);
  $(".play-icon").textContent = S.running ? "❚❚" : "▶";
}

function loop(t) {
  requestAnimationFrame(loop);
  const dtWall = Math.min(0.1, (t - lastT) / 1000 || 0.016);
  lastT = t;
  fpsEMA += ((1 / Math.max(dtWall, 1e-3)) - fpsEMA) * 0.05;
  renderTime += dtWall;
  if (S.running) {
    for (let i = 0; i < S.speed; i++) {
      try { sim.step(1 / 60); }
      catch (e) {
        S.running = false; toggleRunFix();
        errors.push(`Step: ${e.message}`);
        toast(`Simulation halted: ${e.message}`, "error", 8000);
        break;
      }
    }
  }
  const view = { eye: eyeFromCam(), target: cam.target, fov: cam.fov };
  try {
    renderer.drawScene(view, {
      sunAngle: S.sunAngle, sunElev: S.sunElev, sunPower: 1.0, haze: S.haze, ao: 1,
      waterLevel: S.waterLevel, waterOn: ui.layers.water, clarity: S.clarity, flowK: S.flowK,
      foamReach: S.foamReach, foamAmt: S.foamAmt, ripple: S.ripple, time: renderTime,
      steps: S.steps, terrainOn: ui.layers.terrain, strata: S.strata,
    });
    renderer.blit(canvas.width, canvas.height);
    if (ui.layers.ribbons) renderer.drawRibbons(view, renderTime, true);
    if (ui.layers.plumes) renderer.drawPoints(view, sim.activeCount, S.particleSize, true);
    if (ui.layers.particles) renderer.drawPoints(view, sim.activeCount, S.particleSize, false);
  } catch (e) {
    errors.push(`Render: ${e.message}`);
    toast(`Render failed: ${e.message}`, "error", 8000);
    S.running = false; toggleRunFix();
    return;
  }
  frame++;
  if (frame % 20 === 0) $("#stat-fps").textContent = `${fpsEMA.toFixed(0)} fps`;
  if (frame % 30 === 0 && S.running && riverParams && ui.layers.ribbons) {
    try { renderer.updateRibbons(riverParams); } catch { /* ribbons optional */ }
  }
  auditTimer++;
  if (auditTimer % 150 === 0 && S.running) audit(true);
}
function toggleRunFix() {
  $("#run-label").textContent = S.running ? "Pause" : "Run erosion";
  $("#run").classList.toggle("paused", !S.running);
  $(".play-icon").textContent = S.running ? "❚❚" : "▶";
}

// ---------- export / modals ----------
function exportPNG() {
  canvas.toBlob((b) => {
    if (!b) { toast("PNG export failed.", "error"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${$("#docname").value || "frontier"}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}
function exportGraph() {
  download(`${$("#docname").value || "frontier"}.frontier.json`, JSON.stringify(graph.serialize(), null, 2));
  toast("Graph exported.", "info", 2000);
}
function importGraph(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      graph.deserialize(JSON.parse(rd.result));
      ui.selected = null;
      regen();
      editor.fitView();
      toast("Graph imported.", "info", 2500);
    } catch (e) { toast(`Import failed: ${e.message}`, "error"); }
  };
  rd.readAsText(file);
}

function diagInfo() {
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const rend = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
  return [
    `Backend: WebGL2 (${rend})`,
    `Float targets: ${!!gl.getExtension("EXT_color_buffer_float")} · float-linear: ${sim.linear} · float-blend: ${sim.floatBlend}`,
    `Volume: 128×80×128 atlas 1024×1280 · particles: ${sim.activeCount}/${4096}`,
    `Tick: ${sim.tick} · sim time: ${sim.simTime.toFixed(1)}s · readback: ${sim.readbackOK ? "ok" : "FAILED"}`,
    `Last audit: ${sim.lastAudit ? JSON.stringify(sim.lastAudit, (k, v) => typeof v === "number" ? +v.toFixed(3) : v) : "none"}`,
    `Errors (${errors.length}):`, ...errors.slice(-8),
  ].join("\n");
}

function bindChrome() {
  $("#run").addEventListener("click", toggleRun);
  $("#step-btn").addEventListener("click", () => inspectorCB.onStep(20));
  $("#reset-btn").addEventListener("click", () => inspectorCB.onResetSim());
  $("#home-btn").addEventListener("click", () => Object.assign(cam, JSON.parse(JSON.stringify(HOME))));
  $("#export-png").addEventListener("click", exportPNG);
  $("#export-graph").addEventListener("click", exportGraph);
  $("#import-graph").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (e) => {
    if (e.target.files[0]) importGraph(e.target.files[0]);
    e.target.value = "";
  });
  const diag = $("#modal-diag"), help = $("#modal-help");
  $("#diag-btn").addEventListener("click", () => { $("#diag-text").textContent = diagInfo(); diag.classList.add("open"); });
  $("#help-btn").addEventListener("click", () => help.classList.add("open"));
  $("#copy-diag").addEventListener("click", () => navigator.clipboard?.writeText(diagInfo()).then(() => toast("Diagnostics copied.", "info", 2000)));
  for (const m of [diag, help]) {
    m.addEventListener("click", (e) => { if (e.target === m || e.target.classList.contains("modal-x")) m.classList.remove("open"); });
  }
  $("#dock-toggle").addEventListener("click", () => {
    const dock = $("#node-dock");
    dock.classList.toggle("collapsed");
    $("#dock-toggle").textContent = dock.classList.contains("collapsed") ? "▲ Graph" : "▼ Graph";
    setTimeout(resize, 50);
  });
  $("#node-add").addEventListener("click", (e) => editor.openAddMenu(e.clientX, e.clientY, { x: 200, y: 200 }));
  $("#node-layout").addEventListener("click", () => editor.autoLayout());
  $("#node-fit").addEventListener("click", () => editor.fitView());
  $("#toggle-outliner").addEventListener("click", () => document.body.classList.toggle("hide-left"));
  $("#toggle-inspector").addEventListener("click", () => document.body.classList.toggle("hide-right"));
  // dock resize
  const grip = $("#dock-grip");
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const y0 = e.clientY, dock = $("#node-dock"), h0 = dock.offsetHeight;
    const mv = (ev) => {
      dock.style.height = clamp(h0 - (ev.clientY - y0), 120, window.innerHeight * 0.7) + "px";
      resize();
    };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });
  new ResizeObserver(resize).observe($("#viewport"));
  window.addEventListener("resize", resize);
}

// ---------- boot ----------
function fatal(msg) {
  $("#loading").innerHTML = `<div class="loading-mark">F</div><strong>Frontier can't start</strong><span>${msg}</span>`;
  $("#loading").classList.remove("hidden");
}

async function boot() {
  canvas = $("#scene");
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    $("#ctx-lost").classList.remove("hidden");
  });
  $("#ctx-reload").addEventListener("click", () => location.reload());
  gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  if (!gl) { fatal("WebGL2 is unavailable. Enable hardware acceleration and reload."); return; }
  try {
    sim = new Sim(gl);
  } catch (e) {
    fatal(e.message);
    return;
  }
  try {
    renderer = new Renderer(gl, sim);
  } catch (e) {
    fatal(`Renderer failed: ${e.message}`);
    return;
  }
  graph = new Graph();
  graph.deserialize(buildPreset("canyon"));
  editor = new NodeEditor($("#node-canvas"), graph, {
    onSelect: (id) => { ui.selected = id; refreshPanels(); },
    onZoom: (k) => { $("#node-zoom").textContent = `${Math.round(k * 100)}%`; },
  });
  editor.setChain(graph.chainSet());
  graph.onChange((kind) => {
    if (kind === "layout") return;
    if (kind === "structure") { refreshPanels(); editor.refresh(); editor.select(ui.selected); }
    else { editor.refresh(); editor.select(ui.selected); }
    scheduleRegen();
  });
  sim.activeCount = S.particles;
  $("#stat-backend").textContent =
    `backend: WebGL2 · float-linear ${sim.linear ? "on" : "off"} · blend ${sim.floatBlend ? "32F" : "16F"}`;
  bindChrome();
  bindCamera();
  resize();
  $("#loading").classList.add("hidden");
  regen();
  editor.fitView();
  requestAnimationFrame(loop);
  setTimeout(() => toast("Drag nodes · double-click canvas to add · right-drag + WASD to fly.", "info", 6000), 600);
}

boot();
