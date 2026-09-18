/* Frontier — combined SDF terrain engine: bootstraps the volume, wires the
 * UI, and runs the frame loop (particles → sculpt → render).
 */
import { createContext, makePingPong } from "./gl.js";
import { ATLAS_W, ATLAS_H } from "./volume.js";
import { TerrainGenerator, VolumeRepair } from "./gen.js";
import { Sculptor } from "./sculpt.js";
import { ParticleErosion } from "./particles.js";
import { FieldErosion } from "./field-erosion.js";
import { Renderer } from "./render.js";
import { Camera } from "./camera.js";
import { Reducer } from "./reduce.js";

const canvas = document.getElementById("glcanvas");
const $ = (id) => document.getElementById(id);

/* ---------- float ↔ half conversion for CPU undo snapshots ---------- */
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
function toHalf(value) {
  _f32[0] = value;
  const b = _u32[0];
  const sign = (b >>> 16) & 0x8000;
  let exp = ((b >>> 23) & 255) - 127 + 15;
  let mant = b & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7bff;
  let rounded = (mant + 0x1000) >> 13;
  if (rounded === 0x400) {
    exp++;
    rounded = 0;
  }
  return sign | (exp << 10) | rounded;
}

/* ------------------------------- boot --------------------------------- */
let gl;
try {
  gl = createContext(canvas);
} catch (err) {
  $("glError").classList.remove("hidden");
  $("glErrorMsg").textContent = String(err.message || err);
  throw err;
}
$("statGl").textContent = "WebGL2 ✓";

const volumePP = makePingPong(gl, ATLAS_W, ATLAS_H, 1, { internal: gl.RGBA32F });
const soilPP = makePingPong(gl, ATLAS_W, ATLAS_H, 1, { internal: gl.RGBA16F });
const repair = new VolumeRepair(gl);
const generator = new TerrainGenerator(gl, volumePP, soilPP, repair);
const sculptor = new Sculptor(gl, volumePP, repair);
const particles = new ParticleErosion(gl, volumePP, soilPP, repair);
const fieldErosion = new FieldErosion(gl, volumePP, soilPP, repair);
const renderer = new Renderer(gl, canvas);
const camera = new Camera(canvas);

/* ------------------------------ undo stack ---------------------------- */
const undoStack = [];
const UNDO_MAX = 5;

function snapshot() {
  const vol = volumePP.src().textures[0];
  const soil = soilPP.src().textures[0];
  gl.bindFramebuffer(gl.FRAMEBUFFER, findFboOf(volumePP.src()));
  const vf = new Float32Array(ATLAS_W * ATLAS_H * 4);
  gl.readPixels(0, 0, ATLAS_W, ATLAS_H, gl.RGBA, gl.FLOAT, vf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, findFboOf(soilPP.src()));
  const sh = new Uint16Array(ATLAS_W * ATLAS_H * 4);
  gl.readPixels(0, 0, ATLAS_W, ATLAS_H, gl.RGBA, gl.HALF_FLOAT, sh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const vh = new Uint16Array(ATLAS_W * ATLAS_H * 4);
  for (let i = 0; i < vf.length; i++) vh[i] = toHalf(vf[i]);
  undoStack.push({ vh, sh });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoButton();
}

function findFboOf(target) {
  return target.fbo;
}

function restore(snap) {
  for (const [pp, data] of [
    [volumePP, snap.vh],
    [soilPP, snap.sh],
  ]) {
    for (const side of [pp.a, pp.b]) {
      gl.bindTexture(gl.TEXTURE_2D, side.textures[0]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ATLAS_W, ATLAS_H, gl.RGBA, gl.HALF_FLOAT, data);
    }
  }
  particles.reset();
  updateUndoButton();
}

function undo() {
  const snap = undoStack.pop();
  if (snap) restore(snap);
}
function updateUndoButton() {
  $("btnUndo").disabled = undoStack.length === 0;
}

/* --------------------------------- UI --------------------------------- */
const PRESET_MODES = { canyon: 0, badlands: 1, alpine: 2, volcano: 3, coastal: 4 };

function bindRange(id, cb) {
  const el = $(id);
  const label = el.parentElement.querySelector("b");
  const apply = () => {
    const v = parseFloat(el.value);
    if (label) label.textContent = el.step === "1" ? v.toFixed(0) : v.toFixed(2);
    if (cb) cb(v);
  };
  el.addEventListener("input", apply);
  apply();
  return el;
}

for (const sec of document.querySelectorAll(".sec")) {
  sec.querySelector("h2").addEventListener("click", () => sec.classList.toggle("open"));
}

const state = {
  seed: 1284,
  relief: 1,
  rough: 0.55,
  mode: 0,
  tool: 0,
  brushRadius: 2.4,
  brushStrength: 0.45,
  brushFalloff: 0.55,
  runningParticles: false,
  spawnRate: 0.45,
  agentMode: 0,
  detach: 0.5,
  capacity: 0.45,
  deposit: 0.6,
  showGrains: true,
  iters: 36,
  fldK: 0.45,
  fldN: 1.5,
  fldD: 0.12,
  fldT: 0.5,
  fldDetail: 0.55,
  waterLevel: 0.6,
  waterOn: true,
  sunAngle: 135,
  sunHeight: 0.7,
  exposure: 1.05,
  grain: 0.6,
};

bindRange("relief", (v) => (state.relief = v));
bindRange("rough", (v) => (state.rough = v));
bindRange("brushRadius", (v) => (state.brushRadius = v));
bindRange("brushStrength", (v) => (state.brushStrength = v));
bindRange("brushFalloff", (v) => (state.brushFalloff = v));
bindRange("rainRate", (v) => (state.spawnRate = v));
bindRange("detach", (v) => (state.detach = v));
bindRange("capacity", (v) => (state.capacity = v));
bindRange("deposit", (v) => (state.deposit = v));
bindRange("iters", (v) => (state.iters = v));
bindRange("fldK", (v) => (state.fldK = v));
bindRange("fldN", (v) => (state.fldN = v));
bindRange("fldD", (v) => (state.fldD = v));
bindRange("fldT", (v) => (state.fldT = v));
bindRange("fldDetail", (v) => (state.fldDetail = v));
bindRange("waterLevel", (v) => (state.waterLevel = v));
bindRange("sunAngle", (v) => (state.sunAngle = v));
bindRange("sunHeight", (v) => (state.sunHeight = v));
bindRange("exposure", (v) => (state.exposure = v));
bindRange("grainAmt", (v) => (state.grain = v));

$("preset").addEventListener("change", (e) => (state.mode = PRESET_MODES[e.target.value] ?? 0));
$("seed").addEventListener("change", (e) => (state.seed = parseInt(e.target.value || "0", 10)));
$("tool").addEventListener("change", (e) => {
  state.tool = parseInt(e.target.value, 10);
  camera.sculptActive = state.tool > 0;
  canvas.classList.toggle("sculpt", state.tool > 0);
});
$("agent").addEventListener("change", (e) => (state.agentMode = parseInt(e.target.value, 10)));
$("showGrains").addEventListener("change", (e) => (state.showGrains = e.target.checked));
$("waterOn").addEventListener("change", (e) => (state.waterOn = e.target.checked));

$("btnDice").addEventListener("click", () => {
  state.seed = Math.floor(Math.random() * 100000);
  $("seed").value = state.seed;
});

$("btnGenerate").addEventListener("click", () => {
  snapshot();
  generator.run({ seed: state.seed, relief: state.relief, rough: state.rough, mode: state.mode });
  particles.reset();
});

$("btnParticles").addEventListener("click", () => {
  state.runningParticles = !state.runningParticles;
  if (state.runningParticles) snapshot();
  const btn = $("btnParticles");
  btn.textContent = state.runningParticles ? "⏸ Pause" : "▶ Run";
  btn.classList.toggle("on", state.runningParticles);
});

$("btnBurst").addEventListener("click", () => {
  if (!state.runningParticles) $("btnParticles").click();
  particles.burst();
});

$("btnField").addEventListener("click", () => {
  if (fieldErosion.busy) return;
  snapshot();
  const prog = $("fieldProgress");
  const bar = prog.querySelector(".bar");
  const txt = prog.querySelector(".txt");
  prog.classList.remove("hidden");
  $("btnField").disabled = true;
  fieldErosion
    .run(
      {
        seed: state.seed,
        iterations: state.iters,
        K: state.fldK,
        nExp: state.fldN,
        D: state.fldD,
        thermal: state.fldT,
        detail: state.fldDetail,
        waterLevel: state.waterLevel,
      },
      (f) => {
        bar.style.width = `${Math.round(f * 100)}%`;
        txt.textContent = `pass ${Math.round(f * state.iters)}/${state.iters}`;
      },
    )
    .then((result) => {
      stats.cut += result.carved;
      stats.fill += result.deposited;
      bar.style.width = "100%";
      txt.textContent = `done · −${result.carved.toFixed(0)} m³ / +${result.deposited.toFixed(0)} m³`;
      setTimeout(() => prog.classList.add("hidden"), 2200);
    })
    .finally(() => ($("btnField").disabled = false));
});

$("btnUndo").addEventListener("click", undo);
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    undo();
  }
});
$("btnReset").addEventListener("click", () => camera.reset());
$("btnHelp").addEventListener("click", () => $("helpModal").classList.remove("hidden"));
$("btnCloseHelp").addEventListener("click", () => $("helpModal").classList.add("hidden"));

/* ------------------------------ sculpting ------------------------------ */
let stroke = null;
let hoverPoint = null;
let lastPick = 0;

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    ((e.clientX - rect.left) / rect.width) * canvas.width,
    ((e.clientY - rect.top) / rect.height) * canvas.height,
  ];
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || state.tool <= 0) return;
  const [x, y] = pointerPos(e);
  const hit = renderer.pick(x, y, camera, volumePP.src().textures[0]);
  if (!hit) return;
  stroke = { flattenY: hit[1], lastDab: hit, undoPushed: false };
  canvas.setPointerCapture(e.pointerId);
  $("brushBadge").classList.remove("hidden");
});

canvas.addEventListener("pointermove", (e) => {
  const [x, y] = pointerPos(e);
  const now = performance.now();
  if (now - lastPick < (stroke ? 22 : 60)) return;
  lastPick = now;
  const hit = renderer.pick(x, y, camera, volumePP.src().textures[0]);
  hoverPoint = hit;
  if (!stroke || !hit) return;
  const moved = Math.hypot(hit[0] - stroke.lastDab[0], hit[1] - stroke.lastDab[1], hit[2] - stroke.lastDab[2]);
  if (moved < state.brushRadius * 0.28 && stroke.undoPushed) return;
  if (!stroke.undoPushed) {
    snapshot();
    stroke.undoPushed = true;
  }
  sculptor.dab(
    hit,
    state.tool,
    state.brushRadius,
    state.brushStrength,
    state.brushFalloff,
    state.tool === 4 ? stroke.flattenY : hit[1],
    1 / 60,
  );
  stroke.lastDab = hit;
});

const endStroke = () => {
  stroke = null;
  $("brushBadge").classList.add("hidden");
};
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointerleave", () => (hoverPoint = null));

/* ------------------------------ statistics ----------------------------- */
const stats = { cut: 0, fill: 0, agents: 0, fps: 0 };
let massReducer = null;
try {
  massReducer = new Reducer(gl, ATLAS_W, ATLAS_H);
} catch (err) {
  console.warn("mass reducer unavailable:", err);
}
let massPollCounter = 0;
const MASS_POLL_EVERY = 10;

/** Sum the acceptance texture: real per-frame eroded/deposited m³. */
function pollMass() {
  if (!massReducer || !state.runningParticles) return;
  const acc = particles.acceptance.a.textures[0];
  const [er, dr] = massReducer.sum(acc, ATLAS_W, ATLAS_H);
  stats.cut += er * MASS_POLL_EVERY;
  stats.fill += dr * MASS_POLL_EVERY;
}

function pollAgents() {
  const pos = particles.positions.src();
  gl.bindFramebuffer(gl.FRAMEBUFFER, pos.fbo);
  const buf = new Float32Array(64 * 32 * 4);
  gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.FLOAT, buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let alive = 0;
  for (let i = 0; i < 64 * 32; i++) if (buf[i * 4 + 3] >= 0) alive++;
  stats.agents = alive;
}

/* ------------------------------- resizing ------------------------------ */
const viewportEl = document.getElementById("viewport");
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
  const w = Math.floor(viewportEl.clientWidth * dpr);
  const h = Math.floor(viewportEl.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
new ResizeObserver(resize).observe(viewportEl);
resize();

/* ------------------------------- frame loop --------------------------- */
let last = performance.now();
let fpsAcc = 0;
let fpsCount = 0;
let frame = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame++;
  camera.update(dt);

  if (state.runningParticles) {
    particles.stepOnce({
      spawnRate: state.spawnRate,
      agentMode: state.agentMode,
      detach: state.detach,
      capacity: state.capacity,
      deposit: state.deposit,
      waterLevel: state.waterLevel,
    });
  }

  const brush =
    state.tool > 0 && (hoverPoint || (stroke && stroke.lastDab))
      ? [...(hoverPoint || stroke.lastDab), state.brushRadius]
      : null;

  renderer.render(
    {
      camera,
      volumeTex: volumePP.src().textures[0],
      soilTex: soilPP.src().textures[0],
      sunAngle: state.sunAngle,
      sunHeight: state.sunHeight,
      exposure: state.exposure,
      grain: state.grain,
      waterLevel: state.waterLevel,
      waterOn: state.waterOn,
      brush,
      showGrains: state.showGrains,
    },
    particles,
  );

  // stats
  if (state.runningParticles && frame % MASS_POLL_EVERY === 0) pollMass();
  fpsAcc += dt;
  fpsCount++;
  if (fpsAcc >= 0.5) {
    stats.fps = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
    $("statFps").textContent = `${stats.fps} fps`;
    if (state.runningParticles) pollAgents();
    $("statAgents").textContent = `agents ${stats.agents}`;
    $("statMass").textContent = `cut ${stats.cut.toFixed(1)} m³ · fill ${stats.fill.toFixed(1)} m³`;
    updateUndoButton();
  }

  requestAnimationFrame(loop);
}

/* ------------------------------ first render --------------------------- */
generator.run({ seed: state.seed, relief: state.relief, rough: state.rough, mode: state.mode });
updateUndoButton();
requestAnimationFrame(loop);
