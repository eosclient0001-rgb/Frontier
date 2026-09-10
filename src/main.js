import "./studio-ui.js";
import { gizmoShortcut, isTextEditing } from "./editor-shortcuts.js";
import { createSceneEditor } from "./scene-editor.js";
import { createFractureTool } from "./fracture-ui.js";
import { cameraEye, flyLook, flyMove, FLIGHT_KEYS } from "./camera.js";
import { WEATHER_PROFILES, profileFor, profileSettings } from "./weather.js";
import "@fontsource-variable/dm-sans";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./editor-layout.js";
import { defaults, SIZE, encodeScene } from "./field.js";
import { FieldWorker, createRenderer } from "./renderer.js";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const params = { ...defaults };
const state = {
  running: false,
  iterations: 0,
  tool: "orbit",
  clay: false,
  ready: false,
  rebuilding: false,
  regenPending: false,
  busy: false,
  brush: null,
  revision: 0,
  renderedFrames: 0,
  dirty: false,
  lastError: null,
};
const camera = { yaw: 0.39, pitch: 0.65, distance: 46, target: [0, 4, 0] };
let drawPending = false;
let fractureTool, sceneEditor;
let renderer,
  canvas = $("#scene"),
  lastTime = 0,
  lastSim = 0,
  frameCount = 0,
  fpsTime = 0,
  scale = 0.65,
  toastTimer,
  regenTimer,
  operation = Promise.resolve();
const worker = new FieldWorker();
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const navigation = {
  mode: "orbit",
  looking: false,
  locked: false,
  lockPending: false,
};
const flightKeys = new Set();
let navigationTime = 0;
const weatherSettings = new Map(
  WEATHER_PROFILES.map((p) => [p.id, profileSettings(p)]),
);
function eye() {
  return cameraEye(camera);
}
function updateNavigationUI() {
  const fly = navigation.mode === "fly";
  $("#navigation-mode").textContent = fly ? "Fly" : "Orbit";
  $("#navigation-mode").setAttribute("aria-pressed", fly);
  if (state.tool === "orbit")
    $("#mouse-action").textContent = fly ? "Look" : "Orbit";
  if (state.tool === "orbit")
    $("#sculpt-note").innerHTML = fly
      ? "Hold RMB: look + WASD move + Q/E down/up.<br>Shift boosts speed. Wheel adjusts speed."
      : "Drag to orbit. Hold RMB + WASD / Q/E to fly.<br>Shift boosts speed. Middle mouse pans.";
}
$("#navigation-mode").onclick = () => {
  navigation.mode = navigation.mode === "fly" ? "orbit" : "fly";
  updateNavigationUI();
  canvas.focus();
};
function stopFlight() {
  flightKeys.clear();
  navigation.looking = false;
  canvas.dispatchEvent(new Event("cancelnavigation"));
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}
window.addEventListener("blur", stopFlight);
window.addEventListener("editor-modal", stopFlight);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopFlight();
});
document.addEventListener("focusin", () => {
  if (document.activeElement !== canvas) flightKeys.clear();
});
window.addEventListener("keyup", (e) => flightKeys.delete(e.code));
window.addEventListener("keydown", (e) => {
  if (
    navigation.looking &&
    !sceneEditor?.transformDragging() &&
    FLIGHT_KEYS.has(e.code) &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    document.activeElement === canvas &&
    !document.querySelector("dialog[open]")
  ) {
    flightKeys.add(e.code);
    e.preventDefault();
  }
  if (e.code === "Escape") stopFlight();
});

function toast(text, duration = 3500) {
  $("#toast").textContent = text;
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), duration);
}
function diagnosticReport() {
  return {
    backend: renderer?.backend || "Starting",
    ready: state.ready,
    renderedFrames: state.renderedFrames,
    frameHealth: renderer?.frameHealth || null,
    ...renderer?.diagnostics,
    lastError: state.lastError,
    canvas: { width: canvas.width, height: canvas.height },
    secureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
  };
}
function showDiagnostics() {
  $("#renderer-diagnostics").textContent = JSON.stringify(
    diagnosticReport(),
    null,
    2,
  );
  if (!document.querySelector("dialog[open]")) $("#help-dialog").showModal();
}
function fatal(message) {
  state.running = false;
  state.ready = false;
  state.lastError = message;
  updateSimulation();
  $("#loading").classList.remove("hidden");
  $("#loading strong").textContent = "The terrain renderer stopped";
  $("#loading>span").textContent = message;
  $("#render-recovery").classList.remove("hidden");
  $("#renderer-label").textContent = "Renderer interrupted";
  $("#backend").textContent = "RENDER ERROR";
  $("#renderer-info").textContent = "Render error";
}

function setRun(value) {
  if (!state.ready || state.rebuilding || !renderer.gpuErosion) return;
  state.running = value;
  updateSimulation();
}
function updateSimulation() {
  $("#run-label").textContent = state.running ? "Pause erosion" : "Run erosion";
  $("#run .play-icon").textContent = state.running ? "Ⅱ" : "▶";
  $("#simulation-label").textContent = state.running
    ? "Erosion in progress"
    : state.iterations
      ? "Landscape at rest"
      : "Erosion ready";
  $("#sim-detail").textContent = state.running
    ? `${profileFor(params.sourceMode).name} · GPU transport`
    : state.iterations
      ? "Simulation paused"
      : `Ready for ${profileFor(params.sourceMode).name.toLowerCase()}`;
  $("#iterations").textContent = state.iterations.toLocaleString();
  $(".simulation-bar").classList.toggle("running", state.running);
}
function formatValue(id, v) {
  if (id === "particleCount") return String(v);
  if (["canyonWidth", "waveLength", "foamReach", "foamScale"].includes(id))
    return `${Number(v).toFixed(1)} m`;
  if (id === "waveHeight") return `${Math.round(v * 100)} cm`;
  if (id === "canyonFlare") return `${Number(v).toFixed(3)} m/m`;
  if (["waveSpeed", "canyonMeander"].includes(id))
    return `${Number(v).toFixed(2)}×`;
  if (id === "waterDirection") return `${v}°`;
  if (id === "agentDiameter") return `${Number(v).toFixed(v < 1 ? 2 : 1)} mm`;
  if (["cameraSpeed", "riverSpeed", "windSpeed"].includes(id))
    return `${Number(v).toFixed(1)} m/s`;
  if (
    [
      "riverWidth",
      "riverDepth",
      "riverOffset",
      "windHeight",
      "windSpread",
    ].includes(id)
  )
    return `${Number(v).toFixed(1)} m`;
  if (id === "windDirection") return `${v}°`;
  if (id === "footprint") return `${Number(v).toFixed(2)} m`;
  if (id === "grainSize") return `${Number(v).toFixed(2)} mm`;
  if (["relief", "radius", "waterLevel"].includes(id))
    return `${Number(v).toFixed(1)} m`;
  if (id === "speed") return `${v}×`;
  if (id === "sun") return `${v}°`;
  return Number(v).toFixed(2);
}
function syncControls() {
  for (const input of $$(
    "input[type=range]:not([data-fracture]):not([data-editor])",
  )) {
    const v = params[input.id];
    input.value = v;
    const pct = ((v - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--range-progress", `${pct}%`);
    $(`#${input.id}-value`).textContent = formatValue(input.id, v);
  }
  $("#seed").value = params.seed;
  $("#app").classList.toggle("land-mode", params.preset === 3);
  $("#procedural-controls").classList.toggle("hidden", params.preset === 3);
  $("#plot-controls").classList.toggle("hidden", params.preset !== 3);
  $("#canyon-controls").classList.toggle("hidden", params.preset !== 0);
}
function activateTab(name) {
  if ($("#scene-properties").dataset.panel !== name)
    $(".panels").scrollTo(0, 0);
  $("#scene-properties").dataset.panel = name;
  $("#inspector-mode-label").textContent = {
    terrain: "Object properties",
    shape: "Object properties",
    path: "Object properties",
    sculpt: "Sculpt",
    erosion: "Erosion",
    water: "Water",
    fracture: "Fracture",
  }[name];
  if (name !== "sculpt" && state.tool !== "orbit") selectTool("orbit");
  if (name !== "path") sceneEditor?.deactivate();
  if (name !== "fracture") fractureTool?.deactivate();
  fractureTool?.refresh();
  sceneEditor?.refresh();
  $("#fracture-hint").classList.toggle("hidden", name !== "fracture");
  $$(".tab").forEach((el) => {
    const active =
      el.dataset.tab === name ||
      (el.dataset.tab === "terrain" && ["shape", "path"].includes(name));
    el.classList.toggle("active", active);
    el.setAttribute("aria-checked", active);
    el.tabIndex = active ? 0 : -1;
    if (el.dataset.tab === "terrain" && active)
      el.setAttribute("aria-controls", `panel-${name}`);
  });
  $$(".panel").forEach((el) =>
    el.classList.toggle("hidden", el.id !== `panel-${name}`),
  );
}
$$(".tab").forEach((el) =>
  el.addEventListener("click", () =>
    el.dataset.tab === "terrain" && sceneEditor
      ? sceneEditor.inspectSelection()
      : activateTab(el.dataset.tab),
  ),
);
$$("input[type=range]:not([data-fracture]):not([data-editor])").forEach(
  (input) =>
    input.addEventListener("input", () => {
      params[input.id] = Number(input.value);
      params.plotBase = Math.min(params.plotBase, params.plotHeight - 0.8);
      syncControls();
      if (
        input.id.startsWith("plot") ||
        [
          "plotWidth",
          "plotLength",
          "plotHeight",
          "relief",
          "strata",
          "roughness",
          "canyonWidth",
          "canyonMeander",
          "canyonFlare",
        ].includes(input.id)
      ) {
        queueRebuild();
      }
    }),
);
$$("select[data-parameter]").forEach((input) => {
  input.value = params[input.id];
  input.onchange = () => {
    params[input.id] = Number(input.value);
    if (input.id.startsWith("plot")) {
      queueRebuild();
    }
  };
});
function queueRebuild(delay = 220) {
  clearTimeout(regenTimer);
  state.regenPending = true;
  setRun(false);
  sceneEditor?.refresh();
  regenTimer = setTimeout(rebuild, delay);
}
async function rebuild() {
  if (!state.ready) return;
  clearTimeout(regenTimer);
  state.regenPending = false;
  state.revision++;
  if (state.rebuilding) return;
  state.rebuilding = true;
  sceneEditor?.beforeRebuild();
  sceneEditor?.refresh();
  fractureTool?.reset();
  state.running = false;
  state.brush = null;
  updateSimulation();
  $("#simulation-label").textContent = "Reforming landscape…";
  try {
    let revision;
    do {
      revision = state.revision;
      await operation;
      const result = await worker.request("init", { params: { ...params } });
      if (revision === state.revision) renderer.upload(result.volume);
    } while (revision !== state.revision);
    await sceneEditor?.afterRebuild();
    state.iterations = 0;
    fractureTool?.reset();
    $("#erosion-audit").classList.add("hidden");
    state.dirty = true;
    updateSimulation();
    toast("Fresh formation. Your landscape starts here.");
  } catch (error) {
    fatal(error.message);
  } finally {
    state.rebuilding = false;
    fractureTool?.refresh();
    sceneEditor?.refresh();
  }
}
function changeSeed() {
  params.seed = 1 + Math.floor(Math.random() * 99998);
  syncControls();
  rebuild();
}
$("#seed").addEventListener("change", () => {
  params.seed = Math.max(
    1,
    Math.min(99999, Math.round(Number($("#seed").value) || 4821)),
  );
  syncControls();
  rebuild();
});
$("#randomize").onclick = changeSeed;
const presets = [
  {
    name: "Desert canyon",
    region: "01 — COLORADO PLATEAU",
    title: "A landscape,<br>shaped by time.",
    relief: 12,
    strata: 0.65,
    roughness: 0.48,
    seed: 4821,
  },
  {
    name: "The badlands",
    region: "02 — PAINTED DESERT",
    title: "Wild by nature.<br>Yours by design.",
    relief: 13,
    strata: 0.8,
    roughness: 0.72,
    seed: 7309,
  },
  {
    name: "Monument valley",
    region: "03 — THE HIGH DESERT",
    title: "Quiet giants.<br>Endless possibility.",
    relief: 17,
    strata: 0.72,
    roughness: 0.38,
    seed: 2163,
  },
];
presets.push({
  name: "Land plot",
  region: "04 — LANDSCAPE WORKSPACE",
  title: "Your land.<br>Your contours.",
  relief: 12,
  strata: 0.65,
  roughness: 0.48,
  seed: 4821,
});
function choosePreset(i) {
  if (!state.ready) return;
  const p = presets[i];
  params.sceneObjects = [];
  params.showTerrain = true;
  params.preset = i;
  Object.assign(params, {
    relief: p.relief,
    strata: p.strata,
    roughness: p.roughness,
    seed: p.seed,
  });
  $$(".preset").forEach((el) =>
    el.classList.toggle("active", Number(el.dataset.preset) === i),
  );
  $("#biome-name").textContent = p.name;
  syncControls();
  sceneEditor?.select("terrain");
  resetCamera();
  rebuild();
}
$$(".preset").forEach(
  (el) => (el.onclick = () => choosePreset(Number(el.dataset.preset))),
);
function selectTool(tool) {
  sceneEditor?.deactivate();
  fractureTool?.deactivate();
  state.tool = tool;
  state.brush = null;
  $$(".sculpt-tool").forEach((el) =>
    el.classList.toggle("active", el.dataset.tool === tool),
  );
  $("#viewport").classList.toggle("sculpting", tool !== "orbit");
  $("#brush-hint").classList.toggle("hidden", tool === "orbit");
  $("#brush-hint").innerHTML =
    `${tool.toUpperCase()} <span>Click + drag on rock · Alt to orbit</span>`;
  $("#mouse-action").textContent =
    tool === "orbit"
      ? "Orbit"
      : tool === "add"
        ? "Build"
        : tool[0].toUpperCase() + tool.slice(1);
  $("#sculpt-note").innerHTML =
    tool === "orbit"
      ? "Drag to orbit. Scroll to explore.<br>Select a brush to shape the rock."
      : "Click + drag on rock to sculpt.<br>Hold Alt to orbit. 1–6 to switch tools.";
  if (tool === "orbit") updateNavigationUI();
  else if ($("#scene-properties").dataset.panel !== "sculpt")
    activateTab("sculpt");
}
$$(".sculpt-tool").forEach(
  (el) => (el.onclick = () => selectTool(el.dataset.tool)),
);
$("#run").onclick = () => setRun(!state.running);
$("#particle-toggle").onclick = () => {
  params.showParticles = !params.showParticles;
  if (renderer) renderer.showParticles = params.showParticles;
  $("#particle-toggle").classList.toggle("on", params.showParticles);
  $("#particle-toggle").setAttribute("aria-checked", params.showParticles);
};
$$("[data-source]").forEach(
  (button) =>
    (button.onclick = () => {
      weatherSettings.set(params.sourceMode, {
        footprint: params.footprint,
        agentDiameter: params.agentDiameter,
        restitution: params.restitution,
      });
      params.sourceMode = Number(button.dataset.source);
      Object.assign(params, weatherSettings.get(params.sourceMode));
      const profile = profileFor(params.sourceMode),
        diameter = $("#agentDiameter");
      diameter.min = profile.min;
      diameter.max = profile.max;
      diameter.step = profile.step;
      $$("[data-source]").forEach((b) =>
        b.classList.toggle("active", b === button),
      );
      $("#weather-description").textContent = profile.description;
      if (params.sourceMode === 2) $("#river-controls").open = true;
      if (params.sourceMode === 3) $("#wind-controls").open = true;
      if (params.sourceMode === 5) $("#chemical-controls").open = true;
      syncControls();
      updateSimulation();
      toast(
        `${profile.name} emitter selected. Clean agents switch; loaded agents retain their material and birth properties.`,
      );
    }),
);
$("#river-toggle").onclick = () => {
  params.riverEnabled = !params.riverEnabled;
  $("#river-toggle").classList.toggle("on", params.riverEnabled);
  $("#river-toggle").setAttribute("aria-checked", params.riverEnabled);
};
$("#sediment-toggle").onclick = () => {
  params.showSediment = !params.showSediment;
  if (renderer) renderer.showSediment = params.showSediment;
  $("#sediment-toggle").classList.toggle("on", params.showSediment);
  $("#sediment-toggle").setAttribute("aria-checked", params.showSediment);
};
$("#audit-erosion").onclick = async () => {
  if (!state.ready || !renderer.gpuErosion) return;
  setRun(false);
  $("#audit-erosion").disabled = true;
  const output = $("#erosion-audit");
  output.classList.remove("hidden");
  output.textContent = "Reading GPU sediment ledger…";
  try {
    await operation;
    const a = await renderer.auditErosion();
    output.textContent = `Active agents  ${a.active}\nDetached       ${a.eroded.toFixed(4)} m³\nDeposited      ${a.deposited.toFixed(4)} m³\nIn transport   ${a.carried.toFixed(4)} m³\nSand           ${a.composition.sand.toFixed(4)} m³\nWet fines      ${a.composition.fines.toFixed(4)} m³\nCoarse chips   ${a.composition.coarse.toFixed(4)} m³\nDissolved      ${a.composition.dissolved.toFixed(4)} m³\nRetired/outflow ${a.retired.toFixed(4)} m³\nLedger error   ${a.ledgerError.toExponential(2)} m³\nVolume error   ${a.massError === null ? "N/A after sculpting" : a.massError.toExponential(2) + " m³"}\nVoxel-volume accounting; not physical calibration.`;
  } catch (error) {
    output.textContent = error.message;
  } finally {
    $("#audit-erosion").disabled = false;
  }
};
async function step(count = 1) {
  if (!state.ready || state.busy || state.rebuilding || state.regenPending)
    return;
  await sceneEditor?.flush();
  if (state.busy || state.rebuilding) return;
  state.busy = true;
  sceneEditor?.refresh();
  fractureTool?.invalidate();
  operation = renderer.step({ ...params }, count);
  try {
    await operation;
    state.iterations += count;
    state.dirty = true;
    updateSimulation();
  } catch (error) {
    fatal(error.message);
  } finally {
    state.busy = false;
    fractureTool?.refresh();
    sceneEditor?.refresh();
  }
}
$("#step").onclick = () => {
  setRun(false);
  step(1);
};
$("#reset-erosion").onclick = () => {
  rebuild();
};
$("#water-toggle").onclick = () => {
  params.waterEnabled = !params.waterEnabled;
  $("#water-toggle").classList.toggle("on", params.waterEnabled);
  $("#water-toggle").setAttribute("aria-checked", params.waterEnabled);
};
$("#view-mode").onclick = () => {
  state.clay = !state.clay;
  $("#view-mode span").textContent = state.clay ? "Clay view" : "Lit view";
};
function resetCamera() {
  stopFlight();
  camera.yaw = 0.39;
  camera.pitch = 0.65;
  const bounds = canvas.getBoundingClientRect();
  camera.distance =
    (params.preset === 1 ? 43 : 46) *
    Math.min(
      1.6,
      Math.max(1, (1.12 * bounds.height) / Math.max(1, bounds.width)),
    );
  camera.target = [
    0,
    params.preset === 3 ? params.plotHeight : params.preset === 1 ? 2 : 4,
    0,
  ];
}
$("#reset-camera").onclick = resetCamera;
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#viewport").requestFullscreen();
  } catch {
    toast("Fullscreen is not available in this browser preview.");
  }
};
$("#help").onclick = showDiagnostics;
$("#renderer-info").onclick = showDiagnostics;
$("#error-details").onclick = showDiagnostics;
$("#copy-diagnostics").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(diagnosticReport(), null, 2),
    );
    toast("Renderer diagnostics copied.");
  } catch {
    toast("Copy the diagnostic text shown in Field Notes.");
  }
};
for (const link of $$(".compatibility-link")) {
  const url = new URL(location.href);
  url.searchParams.set("webgl", "1");
  link.href = url.href;
  link.onclick = (event) => {
    if (
      state.dirty &&
      !confirm(
        "Restarting WebGL2 reloads the scene. Export first if the renderer still works; unsaved edits will be lost. Continue?",
      )
    )
      event.preventDefault();
  };
}
$("#retry-renderer").onclick = () => location.reload();
$("#close-help").onclick = () => $("#help-dialog").close();
$("#help-dialog").onclick = (e) => {
  if (e.target === $("#help-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
};
$("#export").onclick = async () => {
  if (!state.ready || state.rebuilding || state.regenPending) {
    toast("Your landscape is still forming. Try again in a moment.");
    return;
  }
  const button = $("#export");
  button.disabled = true;
  state.running = false;
  updateSimulation();
  toast("Packing the SDF volume and scene settings…", 15000);
  try {
    await operation;
    await sceneEditor?.flush();
    const volume = await renderer.readVolume();
    const blob = encodeScene(
      volume,
      { ...params },
      { ...camera },
      state.iterations,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `frontier-${presets[params.preset].name.toLowerCase().replaceAll(" ", "-")}-${params.seed}.frontier`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast("Scene exported · 3D volume, camera, and simulation settings.");
  } catch (error) {
    toast(`Export failed: ${error.message}`, 8000);
  } finally {
    button.disabled = false;
  }
};
window.addEventListener("keydown", (e) => {
  if (
    isTextEditing(document.activeElement) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    document.querySelector("dialog[open], [popover]:popover-open")
  )
    return;
  const gizmo = gizmoShortcut(e, {
    flying: navigation.looking,
    dragging: sceneEditor?.transformDragging(),
  });
  if (gizmo) {
    e.preventDefault();
    flightKeys.clear();
    if (sceneEditor?.activateGizmo(gizmo)) canvas.focus();
    else
      toast(
        "Select a live shape, spline or land plot; wait for any current edit.",
        2000,
      );
    return;
  }
  if (navigation.looking) return;
  if (e.code === "Space") {
    e.preventDefault();
    setRun(!state.running);
  }
  if (e.code === "Home") {
    e.preventDefault();
    resetCamera();
  }
  if (["1", "2", "3", "4", "5", "6"].includes(e.key))
    selectTool(
      ["orbit", "carve", "add", "smooth", "ridge", "dent"][Number(e.key) - 1],
    );
});
function rayAt(x, y) {
  const rect = canvas.getBoundingClientRect(),
    uv = [
      ((x - rect.left) / rect.width) * 2 - 1,
      1 - ((y - rect.top) / rect.height) * 2,
    ];
  const origin = eye(),
    forward = norm(camera.target.map((v, k) => v - origin[k])),
    right = norm(cross(forward, [0, 1, 0])),
    up = cross(right, forward);
  return {
    origin,
    direction: norm(
      forward.map(
        (v, k) =>
          v +
          ((right[k] * uv[0] * rect.width) / rect.height) * 0.62 +
          up[k] * uv[1] * 0.62,
      ),
    ),
  };
}
function bindCanvas() {
  let pointer = null,
    picking = false,
    queuedPick = null,
    lastPick = 0,
    lastTouchDistance = 0,
    lastStrokePoint = null;
  let strokeVersion = 0;
  const touches = new Map();
  const pick = async (x, y, apply, stroke = strokeVersion) => {
    if (
      state.rebuilding ||
      state.regenPending ||
      !state.ready ||
      state.tool === "orbit"
    )
      return;
    if (picking) {
      queuedPick = { x, y, stroke, apply: apply || queuedPick?.apply || false };
      return;
    }
    picking = true;
    try {
      const ray = rayAt(x, y);
      const point = await renderer.pick(ray.origin, ray.direction);
      state.brush = point;
      if (apply && point && !state.busy && !state.rebuilding) {
        await sceneEditor?.flush();
        if (state.busy || state.rebuilding) return;
        state.busy = true;
        sceneEditor?.refresh();
        fractureTool?.invalidate();
        const detailed = [
          "ridge",
          "dent",
          "smooth",
          "flatten",
          "texture",
        ].includes(state.tool);
        const previous = stroke === strokeVersion ? lastStrokePoint : null;
        const spacing = params.radius * params.brushSpacing,
          distance = previous
            ? Math.hypot(...point.map((v, k) => v - previous[k]))
            : 0;
        const count =
          detailed && previous
            ? Math.min(8, Math.max(1, Math.ceil(distance / spacing)))
            : 1;
        const from = previous || point,
          direction =
            distance > 0.001
              ? norm(point.map((v, k) => v - from[k]))
              : [1, 0, 0];
        operation = (async () => {
          if (detailed && previous && distance < spacing) return;
          for (let i = 1; i <= count; i++) {
            const dab = from.map((v, k) => v + ((point[k] - v) * i) / count);
            await renderer.sculpt(dab, params.radius, state.tool, {
              ...params,
              brushDirection: direction,
            });
          }
          if (stroke === strokeVersion) lastStrokePoint = [...point];
        })();
        try {
          await operation;
          state.dirty = true;
        } finally {
          state.busy = false;
          fractureTool?.refresh();
          sceneEditor?.refresh();
        }
      } else if (apply && !point)
        toast("Aim at the rock surface to sculpt.", 1600);
    } catch (error) {
      console.error(error);
      toast("The brush could not reach the surface. Try again.");
    } finally {
      picking = false;
      if (queuedPick) {
        const next = queuedPick;
        queuedPick = null;
        pick(next.x, next.y, next.apply, next.stroke);
      }
    }
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (
      !state.ready ||
      (e.pointerType !== "touch" &&
        (pointer || navigation.looking || sceneEditor?.transformDragging()))
    )
      return;
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      lastTouchDistance = Math.hypot(
        ...[...touches.values()][0].map(
          (v, k) => v - [...touches.values()][1][k],
        ),
      );
      return;
    }
    strokeVersion++;
    lastStrokePoint = null;
    pointer = { x: e.clientX, y: e.clientY, button: e.button, alt: e.altKey };
    if (e.button === 2) {
      if (sceneEditor?.transformDragging()) return;
      flightKeys.clear();
      navigation.looking = true;
      state.brush = null;
      navigation.lockPending = true;
      try {
        const lock = canvas.requestPointerLock?.();
        Promise.resolve(lock)
          .catch(() => {})
          .finally(() => {
            navigation.lockPending = false;
            if (!navigation.looking && document.pointerLockElement === canvas)
              document.exitPointerLock();
          });
      } catch {
        navigation.lockPending = false;
      }
    }
    if (
      e.button === 0 &&
      !e.altKey &&
      sceneEditor?.pointerDown(
        rayAt(e.clientX, e.clientY),
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      )
    ) {
      pointer.spline = true;
      return;
    }
    if (e.button === 0 && !e.altKey && fractureTool?.active()) {
      pointer.fracture = true;
      fractureTool.click(rayAt(e.clientX, e.clientY));
      return;
    }
    if (e.button === 0 && !e.altKey && state.tool !== "orbit")
      pick(e.clientX, e.clientY, true);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId))
      touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      const t = [...touches.values()],
        d = Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]);
      camera.distance = Math.max(
        12,
        Math.min(90, (camera.distance * lastTouchDistance) / Math.max(1, d)),
      );
      lastTouchDistance = d;
      return;
    }
    if (pointer) {
      if (pointer.spline) {
        if (e.buttons & 1) sceneEditor?.drag(rayAt(e.clientX, e.clientY));
        return;
      }
      if (pointer.fracture) {
        if (e.buttons & 1 && !e.altKey)
          fractureTool?.drag(rayAt(e.clientX, e.clientY));
        return;
      }
      const dx =
          document.pointerLockElement === canvas
            ? e.movementX
            : e.clientX - pointer.x,
        dy =
          document.pointerLockElement === canvas
            ? e.movementY
            : e.clientY - pointer.y;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (
        pointer.button === 2 ||
        (pointer.button === 0 &&
          navigation.mode === "fly" &&
          state.tool === "orbit" &&
          !e.altKey &&
          !pointer.alt)
      ) {
        flyLook(camera, dx, dy);
      } else if (pointer.button === 1) {
        const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)],
          factor = camera.distance * 0.0015;
        camera.target[0] -= right[0] * dx * factor;
        camera.target[2] -= right[2] * dx * factor;
        camera.target[1] += dy * factor;
      } else if (state.tool === "orbit" || e.altKey || pointer.alt) {
        camera.yaw -= dx * 0.006;
        camera.pitch = Math.max(
          0.08,
          Math.min(1.35, camera.pitch + dy * 0.005),
        );
      } else if (performance.now() - lastPick > 55) {
        lastPick = performance.now();
        pick(e.clientX, e.clientY, true);
      }
    } else if (state.tool !== "orbit" && performance.now() - lastPick > 80) {
      lastPick = performance.now();
      pick(e.clientX, e.clientY, false);
    }
  });
  const end = (e) => {
    if (
      e.type === "lostpointercapture" &&
      (navigation.lockPending || document.pointerLockElement === canvas)
    )
      return;
    if (pointer?.spline) sceneEditor?.end();
    if (pointer?.fracture) fractureTool?.endStroke();
    touches.delete(e.pointerId);
    lastStrokePoint = null;
    pointer = null;
    navigation.looking = false;
    flightKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      navigation.locked = true;
      if (!navigation.looking) document.exitPointerLock();
    } else if (navigation.locked) {
      navigation.locked = false;
      navigation.looking = false;
      pointer = null;
      flightKeys.clear();
    }
  });
  canvas.addEventListener("cancelnavigation", () => {
    if (pointer?.spline) sceneEditor?.end();
    if (pointer?.fracture) fractureTool?.endStroke();
    lastStrokePoint = null;
    strokeVersion++;
    pointer = null;
    for (const id of touches.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    touches.clear();
  });
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("pointerleave", () => {
    if (!pointer) state.brush = null;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if ((navigation.mode === "fly" || navigation.looking) && !e.altKey) {
        params.cameraSpeed = Math.max(
          0.5,
          Math.min(40, params.cameraSpeed * Math.exp(-e.deltaY * 0.001)),
        );
        syncControls();
        return;
      }
      camera.distance = Math.max(
        12,
        Math.min(90, camera.distance * Math.exp(e.deltaY * 0.001)),
      );
    },
    { passive: false },
  );
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  const maxPixels = 650000;
  const ratio = Math.min(
    Math.min(window.devicePixelRatio || 1, 1.3) * scale,
    Math.sqrt(maxPixels / Math.max(1, rect.width * rect.height)),
    4096 / Math.max(1, rect.width, rect.height),
  );
  const width = Math.max(1, Math.round(rect.width * ratio)),
    height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}
function makeUniforms(now) {
  const pos = eye(),
    rect = canvas.getBoundingClientRect();
  return new Float32Array([
    ...pos,
    now * 0.001,
    ...camera.target,
    Math.max(1, rect.width) / Math.max(1, rect.height),
    canvas.width,
    canvas.height,
    state.iterations,
    0,
    params.sun,
    params.haze,
    params.waterLevel,
    params.waterEnabled ? 1 : 0,
    params.strata,
    params.roughness,
    params.clarity,
    params.ripple,
    ...(state.brush || [0, 0, 0]),
    state.brush ? params.radius : -1,
    state.clay ? 1 : 0,
    params.preset,
    0,
    0,
  ]);
}
function frame(now) {
  requestAnimationFrame(frame);
  const navDt = (now - navigationTime) * 0.001;
  navigationTime = now;
  if (
    state.ready &&
    !document.hidden &&
    navigation.looking &&
    !sceneEditor?.transformDragging() &&
    document.activeElement === canvas &&
    !document.querySelector("dialog[open]")
  )
    flyMove(camera, flightKeys, navDt, params.cameraSpeed);
  if (!state.ready || document.hidden || drawPending) return;
  // Cap queue submission at 60 Hz; browser GPU work remains bounded.
  if (now - lastTime < 15) return;
  lastTime = now;
  try {
    resize();
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    fractureTool?.overlay(rect);
    sceneEditor?.overlay(rect);
    const uniforms = makeUniforms(now);
    const completion = renderer.draw(uniforms);
    if (completion) {
      drawPending = true;
      completion
        .then(() => {
          state.renderedFrames++;
        })
        .catch((error) => fatal(error.message))
        .finally(() => {
          drawPending = false;
        });
    } else {
      state.renderedFrames++;
    }
  } catch (error) {
    state.ready = false;
    fatal(error.message);
    return;
  }
  if (state.running && !state.busy && !state.rebuilding && now - lastSim > 40) {
    lastSim = now;
    step(params.speed);
  }
  frameCount++;
  if (now - fpsTime > 1800) {
    const fps = Math.round((frameCount * 1000) / (now - fpsTime));
    $("#fps").textContent = fps;
    frameCount = 0;
    fpsTime = now;
    if (fps < 25 && scale > 0.55) scale = Math.max(0.55, scale - 0.1);
    else if (fps > 49 && scale < 1) scale = Math.min(1, scale + 0.05);
  }
}
async function init() {
  syncControls();
  updateSimulation();
  try {
    const result = await worker.request("init", { params });
    $("#loading strong").textContent = "Checking the terrain renderer";
    $("#loading>span").textContent = "Rendering and reading back a real frame…";
    resetCamera();
    renderer = await createRenderer(
      canvas,
      worker,
      result.volume,
      fatal,
      makeUniforms(0),
      params,
    );
    canvas = renderer.canvas;
    bindCanvas();
    updateNavigationUI();
    state.ready = true;
    fractureTool = createFractureTool({
      renderer,
      worker,
      params,
      camera,
      state,
      toast,
      activate: () => {
        setRun(false);
        selectTool("orbit");
      },
      edit: async (fn) => {
        await sceneEditor?.flush();
        if (state.busy || state.rebuilding)
          throw new Error("Wait for the current terrain edit.");
        setRun(false);
        state.busy = true;
        sceneEditor?.refresh();
        operation = (async () => {
          try {
            await fn();
          } finally {
            state.busy = false;
            updateSimulation();
          }
        })();
        return operation;
      },
    });
    sceneEditor = createSceneEditor({
      renderer,
      params,
      state,
      camera,
      toast,
      showTab: activateTab,
      selectTool: (tool) => {
        setRun(false);
        selectTool(tool);
      },
      whenIdle: () => operation,
      regenerate: () => {
        syncControls();
        queueRebuild(200);
      },
      newPlot: () => {
        params.radius = 4;
        choosePreset(3);
        activateTab("terrain");
        selectTool("ridge");
      },
      edit: async (fn) => {
        if (state.busy || state.rebuilding)
          throw new Error("Wait for the current terrain edit.");
        setRun(false);
        state.busy = true;
        sceneEditor?.refresh();
        fractureTool?.invalidate();
        operation = (async () => {
          try {
            return await fn();
          } finally {
            state.busy = false;
            updateSimulation();
            fractureTool?.refresh();
            sceneEditor?.refresh();
          }
        })();
        return operation;
      },
    });
    state.renderedFrames = 1;
    $("#renderer-info").textContent = "WebGL2 ✓";
    $("#loading").classList.add("hidden");
    renderer.showParticles = params.showParticles;
    renderer.showSediment = params.showSediment;
    $("#renderer-label").textContent = renderer.gpuErosion
      ? "WebGL2 · GPU particles"
      : "WebGL2 · GPU erosion unavailable";
    if (!renderer.gpuErosion) {
      for (const id of [
        "#run",
        "#step",
        "#audit-erosion",
        "[data-tool=ridge]",
        "[data-tool=dent]",
        "[data-tool=flatten]",
        "[data-tool=texture]",
      ])
        $(id).disabled = true;
      toast(renderer.erosionError, 12000);
    }
    $("#backend").textContent = "WEBGL2";
    $("#resolution").textContent = SIZE.join(" × ");
    $("#voxel-label").textContent = "0.90M VOXELS";
    fpsTime = performance.now();
    requestAnimationFrame(frame);
    // A small read-only diagnostic surface for engine integration and smoke tests.
    window.frontier = {
      get backend() {
        return renderer.backend;
      },
      get iterations() {
        return state.iterations;
      },
      get settings() {
        return structuredClone(params);
      },
      get camera() {
        return {
          ...camera,
          target: [...camera.target],
          eye: eye(),
          navigation: navigation.mode,
        };
      },
      get scene() {
        return sceneEditor.summary();
      },
      get fractures() {
        return fractureTool.summary();
      },
      get diagnostics() {
        return diagnosticReport();
      },
      readVolume: () => renderer.readVolume(),
      auditErosion: () => renderer.auditErosion(),
    };
  } catch (error) {
    console.error(error);
    fatal(error.message);
    $("#renderer-label").textContent = "Graphics unavailable";
  }
}
init();
