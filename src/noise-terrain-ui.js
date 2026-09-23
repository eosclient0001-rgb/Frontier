import { normalizeTerrain, terrainDefaults } from "./noise-terrain.js";
const metreKeys = new Set([
  "terrainWidth",
  "terrainLength",
  "terrainHeight",
  "terrainAmplitude",
  "terrainScale",
  "terrainTerraceHeight",
]);
export function createNoiseTerrainUI({ params, canEdit, generate, erode }) {
  const $ = (id) => document.getElementById(id),
    keys = Object.keys(terrainDefaults);
  let busy = false;
  const read = () =>
    normalizeTerrain(
      Object.fromEntries(keys.map((key) => [key, $(key).value])),
    );
  const changed = () => {
    const draft = read();
    return keys.some((key) => draft[key] !== params[key]);
  };
  function updateValues() {
    for (const key of keys) {
      const el = $(key),
        out = $(key + "-value");
      if (!out) continue;
      const value = Number(el.value);
      out.textContent =
        metreKeys.has(key) && value >= 1000
          ? `${(value / 1000).toFixed(2)} km`
          : `${value}${metreKeys.has(key) ? " m" : key === "terrainHeading" ? "°" : ""}`;
      el.style.setProperty(
        "--range-progress",
        `${(100 * (value - Number(el.min))) / (Number(el.max) - Number(el.min))}%`,
      );
    }
  }
  function draftChanged() {
    updateValues();
    $("terrain-generator-status").textContent = changed()
      ? "Draft changed. Generate to apply; your current terrain is untouched."
      : "Base ready. Choose erosion when you are happy with the shape.";
  }
  function load() {
    const p = normalizeTerrain(params);
    for (const key of keys) $(key).value = p[key];
    draftChanged();
  }
  for (const key of keys) $(key).addEventListener("input", draftChanged);
  $("terrain-randomize").onclick = () => {
    $("terrainSeed").value = 1 + Math.floor(Math.random() * 99998);
    draftChanged();
  };
  $("terrain-generate").onclick = async () => {
    if (busy || !canEdit()) {
      $("terrain-generator-status").textContent =
        "Wait for the current edit, or pause erosion, before generating.";
      return;
    }
    const draft = read();
    if (
      !confirm(
        "Generate a new noise landscape? This replaces sculpting, erosion and fracture edits. Live objects are reapplied. Export first to keep your current result.",
      )
    )
      return;
    busy = true;
    $("terrain-generate").disabled = true;
    $("terrain-erode").disabled = true;
    // Prevent a draft changing while it is being applied.
    for (const key of keys) $(key).disabled = true;
    $("terrain-randomize").disabled = true;
    $("terrain-generator-status").textContent =
      "Generating the 3D noise volume…";
    try {
      await generate(draft);
      load();
    } catch (error) {
      $("terrain-generator-status").textContent = error.message;
    } finally {
      busy = false;
      $("terrain-generate").disabled = false;
      $("terrain-erode").disabled = false;
      for (const key of keys) $(key).disabled = false;
      $("terrain-randomize").disabled = false;
    }
  };
  $("terrain-erode").onclick = () => {
    if (busy) return;
    if (changed()) {
      $("terrain-generator-status").textContent =
        "Generate to apply your draft first, or keep editing the existing terrain using the Erosion tab.";
      return;
    }
    erode();
  };
  load();
  return { load };
}
