import {
  fractureScale,
  MIN,
  MAX,
  CELL,
  SCENE_SCALE,
  footprintLimits,
} from "./domain.js";

// Spatial controls are in world metres. Dimensionless strengths, SI material
// coefficients, grain diameters (mm), velocities and captured rain ages stay SI.
export function configureTerrainTools(params, reset = false) {
  if (reset && !params.worldEnabled) {
    params.timeLapse = 1;
    params.weatheringRate = 1;
  }
  if (params.preset === 3 && params.hydraulicCell > 0.25)
    params.hydraulicCell = 0.25;
  const scale = SCENE_SCALE,
    maxCell = Math.max(...CELL),
    span = MAX.map((v, i) => v - MIN[i]);
  const set = (id, min, max, step, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.min = min;
    el.max = max;
    el.step = step;
    if (reset && value !== undefined) {
      el.value = value;
      if (id in params) params[id] = value;
    } else if (id in params) {
      params[id] = Math.max(min, Math.min(max, params[id]));
      el.value = params[id];
    }
  };
  const [minFoot, maxFoot] = footprintLimits();
  set(
    "radius",
    Math.max(0.5, maxCell),
    Math.min(...span) * 0.4,
    Math.max(0.1, maxCell * 0.1),
    maxCell * 3,
  );
  set("brushStrength", 0.01, Math.max(2, maxCell * 3), 0.01, maxCell * 0.8);
  set(
    "brushNoiseScale",
    Math.max(0.25, maxCell),
    Math.max(10, maxCell * 20),
    0.1,
    maxCell * 4,
  );
  set(
    "footprint",
    minFoot,
    maxFoot,
    Math.max(0.01, minFoot * 0.01),
    Math.min(maxFoot, minFoot * 1.25),
  );
  set(
    "windHeight",
    MIN[1],
    MAX[1],
    0.1,
    params.worldEnabled ? params.terrainHeight * 0.65 : 6,
  );
  set("windSpread", 0.1, span[1], 0.1, Math.max(2, span[1] * 0.1));
  set("riverDepth", 0.1, span[1] * 0.25, 0.1, Math.max(0.6, maxCell));
  for (const id of ["waterLevel", "point-y"])
    set(id, MIN[1], MAX[1], 0.1, undefined);
  set("waterOffset", -span[1] * 0.5, span[1] * 0.5, 0.1, 0);
  for (const [axis, k] of [
    ["x", 0],
    ["y", 1],
    ["z", 2],
  ]) {
    set("point-" + axis, MIN[k], MAX[k], 0.1);
    set("transform-" + axis, MIN[k], MAX[k], 0.1);
    set("shape-position-" + axis, MIN[k], MAX[k], 0.1);
    set("shape-size-" + axis, maxCell, span[k] * 0.8, 0.1);
  }
  for (const id of ["path-width", "path-depth"])
    set(id, maxCell * 0.5, Math.min(span[0], span[2]) * 0.5, 0.1);
  set("shape-noise-Amount", 0, maxCell * 8, 0.1);
  set("shape-noise-Scale", maxCell, Math.max(...span), 0.1);
  set("shape-rounding", 0, maxCell * 4, 0.1);
  set("shape-terrace-height", maxCell * 0.5, span[1] * 0.2, 0.1);
  const crackScale = fractureScale();
  set("fracture-size", 2 * crackScale, 12 * crackScale, 0.1, 4.5 * crackScale);
  set("fracture-brush", 0.5 * crackScale, 12 * crackScale, 0.1, 4 * crackScale);
  set("fracture-depth", crackScale, 50 * crackScale, 0.1, 18 * crackScale);
  for (const id of ["waveLength", "foamReach", "foamScale"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.dataset.baseMin ??= el.min;
    el.dataset.baseMax ??= el.max;
    set(
      id,
      Number(el.dataset.baseMin),
      Number(el.dataset.baseMax) * scale,
      0.1,
    );
  }
  const gap = document.getElementById("fracture-width");
  if (gap && document.getElementById("fracture-kind")?.value === "solid") {
    gap.min = 0.8 * crackScale;
    gap.max = 2 * crackScale;
    gap.value = Math.max(
      Number(gap.min),
      Math.min(Number(gap.max), Number(gap.value)),
    );
  }
  const warning = document.getElementById("fracture-gap-warning");
  if (warning)
    warning.textContent = `Resolved cuts remove rock and require gaps at least ${(crackScale * 0.8).toFixed(1)} m wide at this resolution. Use intact/hairline cracking for narrow visual seams.`;
  const size = document.getElementById("world-size"),
    detail = document.getElementById("world-detail");
  if (size)
    size.textContent = `${(params.terrainWidth / 1000).toFixed(2)} × ${(params.terrainLength / 1000).toFixed(2)} km`;
  if (detail)
    detail.textContent = `${CELL.map((v) => v.toFixed(2)).join(" × ")} m voxels · full-terrain simulation`;
  const bounds = document.getElementById("world-bounds");
  if (bounds)
    bounds.textContent = `X ${MIN[0].toFixed(1)}…${MAX[0].toFixed(1)} · Y ${MIN[1].toFixed(1)}…${MAX[1].toFixed(1)} · Z ${MIN[2].toFixed(1)}…${MAX[2].toFixed(1)} m`;
}
