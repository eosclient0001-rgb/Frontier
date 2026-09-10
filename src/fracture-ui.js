import { validSelectionResult } from "./selection-result.js";
import { generateCellPattern, MAX_PAINT_STAMPS } from "./cell-fracture.js";
import { cameraBasis, cameraEye } from "./camera.js";
const $ = (s) => document.querySelector(s),
  clone = (v) => structuredClone(v);
export function createFractureTool({
  renderer,
  worker,
  params,
  camera,
  state,
  edit,
  activate,
  toast,
}) {
  let mode = null,
    stamps = [],
    preview = null,
    detail = null,
    partition = null,
    chunk = null,
    undo = null,
    lastApplied = null,
    show = true,
    epoch = 0;
  let painting = false,
    queued = null,
    lastPoint = null,
    stroke = 0;
  const ids = ["brush", "size", "variation", "depth", "width"];
  const number = (id) => Number($(`#fracture-${id}`).value);
  const options = () => ({
    size: number("size"),
    variation: number("variation"),
    depth: number("depth"),
    gap: number("width"),
    seed: number("seed"),
    separate:
      $("#fracture-kind").value === "solid" && $("#fracture-separate").checked,
    detail: $("#fracture-kind").value !== "solid",
    intact: $("#fracture-kind").value === "intact",
  });
  const canEdit = () =>
    state.ready &&
    !state.busy &&
    !state.rebuilding &&
    !state.regenPending &&
    renderer.gpuErosion;
  const status = (text) => {
    $("#fracture-status").textContent = text;
  };
  function sync() {
    renderer.fractureGuides = [];
    renderer.setCellPatterns(show ? preview : null, detail);
    params.cellFractureDetail = detail ? clone(detail) : null;
  }
  function regenerate() {
    preview = generateCellPattern(stamps, options());
    sync();
  }
  function setWidth() {
    const visual = options().detail,
      el = $("#fracture-width");
    el.min = visual ? 0.002 : 0.8;
    el.max = visual ? 0.08 : 2;
    el.step = visual ? 0.002 : 0.1;
    el.value = visual ? 0.014 : 0.8;
  }
  function update() {
    for (const id of ids) {
      const el = $(`#fracture-${id}`),
        v = Number(el.value);
      $(`#fracture-${id}-value`).textContent =
        id === "variation"
          ? `${Math.round(v * 100)}%`
          : id === "width" && options().detail
            ? `${(v * 1000).toFixed(0)} mm`
            : `${v.toFixed(1)} m`;
      const pct =
        ((v - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
      el.style.setProperty("--range-progress", `${pct}%`);
      el.disabled = !canEdit();
    }
    $("#fracture-seed").disabled = !canEdit();
    $("#fracture-kind").disabled = !canEdit();
    $("#fracture-separate").disabled = !canEdit() || options().detail;
    $("#fracture-separate")
      .closest("label")
      .classList.toggle("hidden", options().detail);
    $("#fracture-gap-warning").classList.toggle("hidden", options().detail);
    $("#fracture-width-label").textContent = options().detail
      ? "Hairline width"
      : "Gap width (removes rock)";
    for (const [id, m] of [
      ["paint", "paint"],
      ["erase", "erase"],
      ["select", "chunk"],
    ]) {
      const b = $(`#fracture-${id}`);
      b.disabled = !canEdit();
      b.classList.toggle("active", mode === m);
      b.setAttribute("aria-pressed", mode === m);
    }
    $("#fracture-clear").disabled = !canEdit() || !stamps.length;
    $("#fracture-reroll").disabled = !canEdit() || !stamps.length;
    $("#fracture-apply").disabled =
      !canEdit() || !preview || preview.sites.length < 2;
    $("#fracture-apply").textContent = options().intact
      ? "Mark cracks · keep intact"
      : options().detail
        ? "Apply visual fissures"
        : "Cut open gaps";
    $("#fracture-undo").disabled =
      !canEdit() || !undo || !renderer.solver?.fractureUndoValid;
    $("#fracture-delete").disabled =
      !canEdit() ||
      !chunk ||
      chunk.whole ||
      (chunk.fraction > 0.65 && !$("#fracture-large").checked);
    $("#fracture-large-row").classList.toggle(
      "hidden",
      !chunk || chunk.whole || chunk.fraction <= 0.65,
    );
    $("#fracture-clear-details").disabled = !canEdit() || !detail;
    $("#fracture-paint-count").textContent =
      `${stamps.length} / ${MAX_PAINT_STAMPS} paint samples`;
    $("#fracture-pattern-info").textContent = preview
      ? `${preview.sites.length} 3D sites · ${preview.effectiveSize.toFixed(1)} m spacing${preview.effectiveSize > preview.requestedSize + 0.01 ? " (coarsened to fit GPU budget)" : ""}. Some cells may lie in air.`
      : lastApplied
        ? `Last ${lastApplied.intact ? "intact map" : "open fracture"}: ${lastApplied.sites} sites. Select a piece, or paint a replacement map.`
        : "Paint to reveal irregular, interlocking cells—not parallel slices.";
    $("#fracture-detail-count").textContent = detail
      ? partition
        ? "One intact, selectable crack map. New maps replace it; no rock is removed by marking."
        : "One visual-only layer. Applying another replaces it."
      : "No visual crack layer.";
    $("#fracture-hint").textContent =
      mode === "paint"
        ? "Drag on rock to paint fracture regions · Alt-drag orbit"
        : mode === "erase"
          ? "Drag to erase pending paint · baked rock is unchanged"
          : mode === "chunk"
            ? "Click a marked piece · inspect orange, then remove only that piece"
            : "Paint → mark hairlines → select → remove only chosen pieces";
  }
  function clearSelection() {
    chunk = null;
    renderer.solver?.clearFractureSelection();
    $("#fracture-large").checked = false;
  }
  function cancelStroke() {
    epoch++;
    queued = null;
    lastPoint = null;
  }
  function choose(m) {
    if (!canEdit()) return;
    activate();
    mode = m;
    cancelStroke();
    clearSelection();
    status(
      m === "paint"
        ? "Paint on the rock. Depth extends each brush into the formation along your view. The preview shows 3D Voronoi cells; paint does not carve yet."
        : m === "erase"
          ? "Erase nearby pending brush samples. To undo baked fractures, use Undo last fracture edit."
          : partition
            ? "Click a cell inside the marked region. Touching pieces stay joined until you remove the orange selection."
            : "Mark an intact crack map first, or select an already disconnected fragment from a previous open-gap fracture.",
    );
    update();
  }
  $("#fracture-paint").onclick = () => choose("paint");
  $("#fracture-erase").onclick = () => choose("erase");
  $("#fracture-select").onclick = () => choose("chunk");
  for (const id of ids)
    $(`#fracture-${id}`).oninput = () => {
      if (!canEdit()) return;
      if (id !== "brush") regenerate();
      update();
    };
  $("#fracture-kind").onchange = () => {
    setWidth();
    regenerate();
    update();
  };
  $("#fracture-seed").onchange = () => {
    $("#fracture-seed").value = Math.max(
      1,
      Math.min(99999, Math.round(number("seed") || 4101)),
    );
    regenerate();
    update();
  };
  $("#fracture-separate").onchange = () => {
    regenerate();
    update();
  };
  $("#fracture-reroll").onclick = () => {
    $("#fracture-seed").value = (number("seed") % 99999) + 1;
    regenerate();
    update();
  };
  $("#fracture-show").onchange = () => {
    show = $("#fracture-show").checked;
    sync();
  };
  $("#fracture-large").onchange = update;
  $("#fracture-clear").onclick = () => {
    if (!canEdit()) return;
    cancelStroke();
    stamps = [];
    preview = null;
    sync();
    update();
    status("Pending paint cleared. Baked geometry is unchanged.");
  };
  async function action(fn) {
    if (!canEdit()) return;
    const task = edit(async () => {
      await fn();
      sync();
      state.dirty = true;
    });
    update();
    try {
      await task;
    } catch (error) {
      status(error.message);
      toast(error.message, 5500);
    } finally {
      update();
    }
  }
  async function saveUndo() {
    await renderer.solver.saveFractureUndo();
    undo = {
      stamps: clone(stamps),
      preview: clone(preview),
      detail: clone(detail),
      partition: clone(partition),
      lastApplied: clone(lastApplied),
      options: options(),
    };
  }
  $("#fracture-apply").onclick = () =>
    action(async () => {
      if (!preview || preview.sites.length < 2)
        throw new Error("Paint a larger volume for multiple fracture cells.");
      cancelStroke();
      await saveUndo();
      if (preview.intact) {
        partition = clone(preview);
        detail = clone(preview);
        lastApplied = {
          sites: preview.sites.length,
          spacing: preview.effectiveSize,
          intact: true,
        };
        status(
          "Hairline cracks marked. The rock is unchanged and still joined. Click a piece, then remove only the orange selection.",
        );
      } else if (preview.detail) {
        partition = null;
        detail = clone(preview);
        status(
          "Painted visual fissures applied. These are a visual layer only, not separated geometry.",
        );
      } else {
        partition = null;
        detail = null;
        await renderer.solver.fractureCells(preview);
        lastApplied = {
          sites: preview.sites.length,
          spacing: preview.effectiveSize,
        };
        status(
          "Rock fractured into irregular cells. Click a chunk to inspect and remove it. Exterior fragments may remain attached if boundary separation was disabled.",
        );
      }
      stamps = [];
      preview = null;
      clearSelection();
      mode = "chunk";
    });
  $("#fracture-delete").onclick = () =>
    action(async () => {
      if (
        !chunk ||
        chunk.whole ||
        (chunk.fraction > 0.65 && !$("#fracture-large").checked)
      )
        return;
      await saveUndo();
      await renderer.solver.deleteChunk();
      clearSelection();
      status(
        "Selected fragment subtracted from the SDF. The neighbouring fracture faces remain.",
      );
    });
  $("#fracture-undo").onclick = () =>
    action(async () => {
      if (!undo) return;
      cancelStroke();
      await renderer.solver.undoFracture();
      ({ stamps, preview, detail, partition, lastApplied } = undo);
      const cfg = undo.options;
      $("#fracture-kind").value = cfg.intact
        ? "intact"
        : cfg.detail
          ? "detail"
          : "solid";
      setWidth();
      for (const id of ["size", "variation", "depth", "seed"])
        $(`#fracture-${id}`).value = cfg[id];
      $("#fracture-width").value = cfg.gap;
      $("#fracture-separate").checked = cfg.separate;
      undo = null;
      clearSelection();
      status(
        "Last fracture edit restored. Painting is nondestructive until you apply it.",
      );
    });
  $("#fracture-clear-details").onclick = () =>
    action(async () => {
      await saveUndo();
      detail = null;
      partition = null;
      clearSelection();
      status("Crack map cleared. Already removed fragments are unchanged.");
    });
  function addSample(point, view) {
    const radius = number("brush"),
      spacing = Math.max(0.6, radius * 0.65);
    if (lastPoint && lastPoint.stroke === stroke) {
      const d = Math.hypot(...point.map((v, k) => v - lastPoint.point[k]));
      if (d < spacing) return;
      const n = Math.ceil(d / spacing);
      for (let j = 1; j < n && stamps.length < MAX_PAINT_STAMPS; j++) {
        const t = j / n;
        stamps.push({
          point: point.map(
            (v, k) => lastPoint.point[k] + (v - lastPoint.point[k]) * t,
          ),
          view: [...view],
          radius,
        });
      }
    }
    if (stamps.length < MAX_PAINT_STAMPS)
      stamps.push({ point: [...point], view: [...view], radius });
    lastPoint = { point: [...point], stroke };
    if (stamps.length === MAX_PAINT_STAMPS)
      status(
        "Paint budget reached. Apply this region, erase samples, or clear paint before adding more.",
      );
  }
  async function paint(ray, begin = false) {
    if (mode !== "paint" && mode !== "erase") return;
    if (painting) {
      queued = { ray, begin: begin || queued?.begin || false };
      return;
    }
    if (!canEdit()) return;
    painting = true;
    const token = epoch,
      currentMode = mode;
    if (begin) {
      stroke++;
      lastPoint = null;
    }
    try {
      await action(async () => {
        const point = await renderer.pick(ray.origin, ray.direction);
        if (token !== epoch || mode !== currentMode) return;
        if (!point) {
          if (begin) status("Aim at a visible rock surface to paint.");
          lastPoint = null;
          return;
        }
        clearSelection();
        if (mode === "erase") {
          const radius = number("brush");
          stamps = stamps.filter(
            (s) => Math.hypot(...point.map((v, k) => v - s.point[k])) > radius,
          );
          lastPoint = null;
        } else addSample(point, ray.direction);
        regenerate();
      });
    } finally {
      painting = false;
      const next = queued;
      queued = null;
      if (next && token === epoch) paint(next.ray, next.begin);
    }
  }
  async function click(ray) {
    if (mode === "paint" || mode === "erase") {
      paint(ray, true);
      return;
    }
    if (mode !== "chunk") return;
    await action(async () => {
      const point = await renderer.pick(ray.origin, ray.direction);
      if (!point) throw new Error("No rock under the pointer.");
      clearSelection();
      status(
        partition
          ? "Selecting this marked cell in the current rock…"
          : "Finding the connected fragment from the current GPU SDF…",
      );
      const volume = await renderer.readVolume(),
        result = partition
          ? await worker.request("selectIntactCell", {
              volume,
              point,
              pattern: partition,
            })
          : await worker.request("selectChunk", { volume, point });
      if (!validSelectionResult(result))
        throw new Error(
          "No valid piece selection was returned. No rock was removed; please select again.",
        );
      renderer.solver.setChunkSelection(result.mask);
      const { mask, ...stats } = result;
      chunk = stats;
      status(
        result.whole
          ? "This would select the entire body. Mark a smaller region with multiple cells instead."
          : `Selected ${(result.fraction * 100).toFixed(2)}% of solid cells. Inspect the orange fragment before removing.${result.fraction > 0.65 ? " This is a large selection; confirm below." : ""}`,
      );
    });
  }
  function invalidate() {
    cancelStroke();
    clearSelection();
    undo = null;
    if (renderer.solver) renderer.solver.fractureUndoValid = false;
    update();
  }
  function reset() {
    cancelStroke();
    mode = null;
    stamps = [];
    preview = null;
    detail = null;
    partition = null;
    lastApplied = null;
    invalidate();
    sync();
    status("Paint where you want irregular fracture cells.");
  }
  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && mode) {
      mode = null;
      cancelStroke();
      status("Painting ended. Pending paint is kept.");
      update();
    }
  });
  function overlay(rect) {
    const svg = $("#fracture-overlay");
    if (!show || !stamps.length) {
      svg.replaceChildren();
      return;
    }
    const eye = cameraEye(camera),
      { forward, right, up } = cameraBasis(camera),
      dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    svg.innerHTML = stamps
      .map((s) => {
        const r = s.point.map((v, k) => v - eye[k]),
          z = dot(r, forward);
        if (z < 0.1) return "";
        const x =
            (0.5 +
              (dot(r, right) / ((0.62 * z * rect.width) / rect.height)) * 0.5) *
            rect.width,
          y = (0.5 - (dot(r, up) / (0.62 * z)) * 0.5) * rect.height;
        return `<circle class="paint-dab" cx="${x}" cy="${y}" r="3"/>`;
      })
      .join("");
  }
  setWidth();
  sync();
  update();
  if (!renderer.gpuErosion)
    status(
      "Cell fracture needs WebGL2 floating-point render targets. No CPU erosion fallback is used.",
    );
  return {
    active: () => !!mode,
    click,
    drag: (ray) => paint(ray),
    endStroke() {},
    overlay,
    deactivate() {
      mode = null;
      cancelStroke();
      update();
    },
    invalidate,
    reset,
    refresh: update,
    summary: () =>
      clone({
        mode,
        stamps,
        preview,
        detail,
        partition,
        selection: chunk
          ? {
              count: chunk.count,
              fraction: chunk.fraction,
              whole: chunk.whole,
              kind: chunk.kind,
              cellId: chunk.cellId,
            }
          : null,
        lastApplied,
        canUndo: !!undo && !!renderer.solver?.fractureUndoValid,
      }),
  };
}
