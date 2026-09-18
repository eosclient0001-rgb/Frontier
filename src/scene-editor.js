import { createObjectTools } from "./object-tools.js";
import { makeShape, MAX_SHAPES } from "./shapes.js";
import {
  makePath,
  sampleSpline,
  MAX_POINTS,
  MAX_CUTS,
  MAX_WATER_PATHS,
} from "./splines.js";
import { cameraBasis, cameraEye } from "./camera.js";
const $ = (s) => document.querySelector(s),
  clone = (x) => structuredClone(x);
export function createSceneEditor({
  renderer,
  params,
  state,
  camera,
  edit,
  whenIdle,
  showTab,
  selectTool,
  newPlot,
  toast,
  regenerate,
}) {
  let objectTools;
  let selected = "terrain",
    pointIndex = -1,
    mode = null,
    dragging = false,
    nextId = 1,
    revision = 0,
    timer,
    processing = false,
    pending = false,
    completion = Promise.resolve(),
    lastOverlay = "";
  params.sceneObjects ||= [];
  const nodes = () => params.sceneObjects,
    node = () => nodes().find((n) => n.id === selected),
    canEdit = () =>
      state.ready &&
      !state.busy &&
      !state.rebuilding &&
      !state.regenPending &&
      renderer.gpuErosion;
  const status = (t) => {
    $("#path-status").textContent = t;
  };
  const title = () =>
    params.preset === 3
      ? "Land plot"
      : ["Desert canyon", "Badlands", "Monument valley"][params.preset] ||
        "SDF terrain";
  function properties() {
    const n = node();
    const panel = $("#scene-properties").dataset.panel;
    const globalTitle = {
      sculpt: "Sculpt",
      erosion: "Erosion",
      water: "Water material",
      fracture: "Fracture",
    }[panel];
    $("#inspector-title").textContent = globalTitle || (n ? n.name : title());
    $("#object-name").value = n?.name || "";
    $("#path-kind").textContent =
      n?.type === "water"
        ? "WATER FLOW SPLINE"
        : n?.baked
          ? "BAKED CUT GUIDE"
          : "LIVE CHANNEL CUT";
    const disabled = !n || !canEdit(),
      locked = disabled || n?.baked;
    for (const id of [
      "object-name",
      "object-visible",
      "path-delete",
      "path-copy-water",
    ])
      $(`#${id}`).disabled = disabled;
    $("#object-visible").checked = n?.visible ?? true;
    $("#path-copy-water").classList.toggle("hidden", n?.type !== "cut");
    for (const id of [
      "path-place",
      "path-finish",
      "point-delete",
      "path-width",
      "path-depth",
      "path-bank",
      "path-speed",
      "path-reverse",
    ])
      $(`#${id}`).disabled = locked;
    $("#path-place").classList.toggle("active", mode === "place");
    $("#path-finish").classList.toggle("active", mode === "edit");
    $("#path-depth-row").classList.toggle("hidden", n?.type !== "cut");
    $("#path-bank-row").classList.toggle("hidden", n?.type !== "cut");
    $("#path-speed-row").classList.toggle("hidden", n?.type !== "water");
    for (const [id, key] of [
      ["width", "width"],
      ["depth", "depth"],
      ["bank", "bankSlope"],
      ["speed", "speed"],
    ]) {
      const el = $(`#path-${id}`);
      el.value = n?.[key] ?? 0;
      el.style.setProperty(
        "--range-progress",
        `${(100 * (Number(el.value) - Number(el.min))) / (Number(el.max) - Number(el.min))}%`,
      );
      $(`#path-${id}-value`).textContent =
        `${Number(el.value).toFixed(2)}${id === "speed" ? " m/s" : id === "bank" ? " m/m" : " m"}`;
    }
    $("#path-bake").disabled =
      !canEdit() ||
      !nodes().some(
        (n) =>
          n.type !== "water" &&
          !n.baked &&
          n.visible &&
          (n.type === "shape" || n.points.length >= 2),
      );
    $("#shape-bake").disabled = $("#path-bake").disabled;
    const p = n?.points[pointIndex];
    for (let k = 0; k < 3; k++) {
      const input = $(`#point-${"xyz"[k]}`);
      input.disabled = locked || !p || (n.type === "water" && k === 1);
      input.value = p
        ? (k === 1 && n.type === "water" ? params.waterLevel : p[k]).toFixed(2)
        : "";
    }
    $("#point-list").replaceChildren();
    n?.points?.forEach((p, i) => {
      const b = document.createElement("button");
      b.textContent = `${i + 1} · ${p[0].toFixed(1)}, ${(n.type === "water" ? params.waterLevel : p[1]).toFixed(1)}, ${p[2].toFixed(1)}`;
      b.className = i === pointIndex ? "active" : "";
      b.onclick = () => {
        pointIndex = i;
        mode = n.baked ? null : "edit";
        properties();
      };
      $("#point-list").append(b);
    });
    objectTools?.refresh();
    $("#path-help").textContent = n?.baked
      ? "This object is baked. Its guide can be renamed, hidden or removed, but deleting the guide cannot heal the terrain."
      : n?.type === "water"
        ? "Water and transported agents follow the arrow direction. This first version uses the shared Water level, not a sloping free-surface solver."
        : "Live SDF cut: editing, hiding or deleting this spline recomputes the channel. Volumetric brushes, erosion and fractures bake live objects.";
  }
  function row(id, name, kind, visible, onVisibility) {
    const el = document.createElement("div");
    el.className = "outliner-row";
    const b = document.createElement("button");
    b.className = "outliner-select";
    b.setAttribute("role", "treeitem");
    b.setAttribute("aria-selected", selected === id);
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.textContent = kind;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "tree-name";
    text.textContent = name;
    b.append(icon, text);
    b.title = name;
    b.dataset.object = id;
    b.onclick = () => select(id);
    b.onkeydown = (e) => {
      const rows = [...$("#scene-tree").querySelectorAll("[role=treeitem]")],
        i = rows.indexOf(b);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        rows[
          (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length
        ]?.focus();
      }
      if (e.key === "F2" && node()) {
        e.preventDefault();
        $(node().type === "shape" ? "#shape-name" : "#object-name").focus();
      }
    };
    const eye = document.createElement("button");
    eye.className = "outliner-eye";
    eye.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/>${visible ? "" : '<path d="m3 3 14 14"/>'}</svg>`;
    eye.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${name}`);
    eye.disabled = !canEdit();
    eye.onclick = onVisibility;
    el.append(b, eye);
    return el;
  }
  function refresh() {
    const tree = $("#scene-tree");
    tree.replaceChildren(
      row("terrain", title(), "▧", params.showTerrain !== false, () => {
        params.showTerrain = params.showTerrain === false;
        refresh();
      }),
    );
    for (const type of ["shape", "cut", "water"]) {
      const group = document.createElement("div");
      group.className = "outliner-group";
      const label = document.createElement("div");
      label.className = "outliner-group-label";
      label.textContent =
        type === "shape"
          ? "SHAPES / BOULDERS"
          : type === "cut"
            ? "CHANNEL CUTS"
            : "WATER PATHS";
      group.append(label);
      for (const n of nodes().filter((n) => n.type === type))
        group.append(
          row(
            n.id,
            n.name + (n.baked ? " · baked" : ""),
            type === "shape" ? "◈" : type === "cut" ? "⌁" : "≈",
            n.visible,
            () => {
              n.visible = !n.visible;
              if (n.type !== "water" && !n.baked) schedule();
              refresh();
            },
          ),
        );
      if (group.querySelector(".outliner-row")) tree.append(group);
    }
    if (params.preset !== 3 && !nodes().some((n) => n.type === "water"))
      tree.append(
        row(
          "water-material",
          "Procedural water",
          "≈",
          params.waterEnabled,
          () => {
            $("#water-toggle").click();
            refresh();
          },
        ),
      );
    $("#add-object").disabled = !canEdit();
    $("#new-scene").disabled = !canEdit();
    const count = tree.querySelectorAll("[role=treeitem]").length;
    $("#object-count").textContent = `${count} OBJECT${count === 1 ? "" : "S"}`;
    for (const id of ["add-cut", "add-water", "add-shape", "new-plot"])
      $(`#${id}`).disabled = !canEdit();
    properties();
  }
  function select(id) {
    $(
      "#" + (id === "terrain" ? "panel-terrain" : "panel-path"),
    )?.parentElement?.scrollTo(0, 0);
    selected = id;
    pointIndex = -1;
    dragging = false;
    selectTool("orbit");
    const n = node();
    if (n) {
      pointIndex = n.points.length - 1;
      showTab(n.type === "shape" ? "shape" : "path");
      mode = n.baked ? null : "edit";
      status(
        "Click a handle to drag X/Z. Edit its elevation numerically. Add points to extend the path.",
      );
    } else {
      mode = null;
      showTab(id === "water-material" ? "water" : "terrain");
    }
    objectTools?.selected();
    refresh();
  }
  function add(type) {
    if (!canEdit()) return;
    if (
      nodes().filter((n) => n.type === type).length >=
      (type === "cut" ? MAX_CUTS : MAX_WATER_PATHS)
    ) {
      toast("Up to four splines of each kind per scene.");
      return;
    }
    const n = makePath(`path-${nextId++}`, type);
    n.name += ` ${nodes().filter((n) => n.type === type).length + 1}`;
    nodes().push(n);
    select(n.id);
    mode = "place";
    status(
      "Click the terrain to place control points. Two or more points form a smooth path.",
    );
    refresh();
  }
  $("#add-shape").onclick = () => {
    if (!canEdit()) return;
    if (nodes().filter((n) => n.type === "shape").length >= MAX_SHAPES) {
      toast("Up to six shapes per scene.");
      return;
    }
    const n = makeShape(`shape-${nextId++}`);
    n.position = [
      0,
      (params.preset === 3 ? params.plotHeight + (params.plotY ?? 0) : 2) + 2,
      0,
    ];
    n.name += " " + (nodes().filter((n) => n.type === "shape").length + 1);
    nodes().push(n);
    select(n.id);
    schedule();
    state.dirty = true;
  };
  $("#add-cut").onclick = () => add("cut");
  $("#add-water").onclick = () => add("water");
  $("#new-plot").onclick = () => {
    if (
      state.dirty &&
      !confirm(
        "Start a new land plot? Existing geometry edits and path objects will be cleared. Export first to preserve them.",
      )
    )
      return;
    nodes().splice(0);
    selected = "terrain";
    mode = null;
    clearTimeout(timer);
    revision++;
    newPlot();
    refresh();
  };
  $("#object-name").onchange = () => {
    const n = node();
    if (n) {
      n.name = $("#object-name").value.trim().slice(0, 60) || "Spline";
      refresh();
    }
  };
  $("#object-visible").onchange = () => {
    const n = node();
    if (n) {
      n.visible = $("#object-visible").checked;
      if (n.type !== "water" && !n.baked) schedule();
      refresh();
    }
  };
  for (const [id, key] of [
    ["width", "width"],
    ["depth", "depth"],
    ["bank", "bankSlope"],
    ["speed", "speed"],
  ])
    $(`#path-${id}`).oninput = () => {
      const n = node();
      if (!n || n.baked) return;
      n[key] = Number($(`#path-${id}`).value);
      if (n.type !== "water") schedule();
      state.dirty = true;
      properties();
    };
  $("#path-place").onclick = () => {
    mode = "place";
    selectTool("orbit");
    mode = "place";
    status("Click to append points. Press Finish or Escape to stop placing.");
    properties();
  };
  $("#path-finish").onclick = () => {
    mode = "edit";
    properties();
  };
  function changed() {
    const n = node();
    state.dirty = true;
    if (n && n.type !== "water") schedule();
    properties();
  }
  for (let k = 0; k < 3; k++)
    $(`#point-${"xyz"[k]}`).onchange = () => {
      const n = node(),
        p = n?.points[pointIndex],
        input = $(`#point-${"xyz"[k]}`);
      if (!p) return;
      const value = Number(input.value);
      if (Number.isFinite(value))
        p[k] = Math.max(Number(input.min), Math.min(Number(input.max), value));
      changed();
    };
  $("#point-delete").onclick = () => {
    const n = node();
    if (n && pointIndex >= 0) {
      n.points.splice(pointIndex, 1);
      pointIndex = Math.min(pointIndex, n.points.length - 1);
      changed();
    }
  };
  $("#path-reverse").onclick = () => {
    const n = node();
    if (n) {
      n.points.reverse();
      pointIndex = -1;
      changed();
    }
  };
  $("#path-delete").onclick = () => {
    const n = node();
    if (!n) return;
    if (
      n.baked &&
      !confirm(
        "Remove this baked guide? Its existing geometry will remain in the SDF.",
      )
    )
      return;
    params.sceneObjects = nodes().filter((x) => x.id !== n.id);
    const rebuild = n.type !== "water" && !n.baked;
    select("terrain");
    if (rebuild) schedule();
    state.dirty = true;
  };
  $("#path-copy-water").onclick = () => {
    const source = node();
    if (!source || source.points.length < 2) {
      toast("Place at least two cut points first.");
      return;
    }
    if (nodes().filter((n) => n.type === "water").length >= MAX_WATER_PATHS) {
      toast("Up to four water splines per scene.");
      return;
    }
    const points = clone(source.points),
      depth = source.depth,
      width = source.width;
    add("water");
    const n = node();
    if (n?.type !== "water") return;
    params.waterLevel = Math.max(
      0.1,
      Math.min(
        5,
        points.reduce((s, p) => s + p[1], 0) / points.length - depth + 0.55,
      ),
    );
    n.points = points.map((p) => [p[0], params.waterLevel, p[2]]);
    n.width = Math.max(
      0.8,
      Math.min(12, width + 2 * (source.bankSlope ?? 0.25) * 0.55 + 0.4),
    );
    mode = "edit";
    pointIndex = 0;
    $("#waterLevel").value = params.waterLevel;
    $("#waterLevel").dispatchEvent(new Event("input"));
    refresh();
  };
  $("#shape-bake").onclick = () => $("#path-bake").click();
  $("#path-bake").onclick = () => {
    renderer.solver.bakeSplineCuts();
    refresh();
    toast("Live geometry baked. Its guides are now read-only.");
  };
  renderer.solver &&
    (renderer.solver.onSplineBake = (ids) => {
      for (const n of nodes()) if (ids.includes(n.id)) n.baked = true;
      refresh();
      status(
        "Live shapes/cuts were baked before a destructive terrain operation.",
      );
    });
  function schedule() {
    pending = true;
    revision++;
    clearTimeout(timer);
    timer = setTimeout(process, 100);
  }
  function process() {
    if (processing) return completion;
    processing = true;
    completion = (async () => {
      try {
        let done;
        do {
          await whenIdle();
          if (state.rebuilding || !state.ready) return;
          done = revision;
          const snapshot = clone(nodes());
          await edit(() => renderer.solver.refreshSplineCuts(snapshot));
        } while (done !== revision);
      } catch (e) {
        toast(e.message, 6000);
        status(e.message);
      } finally {
        clearTimeout(timer);
        pending = false;
        processing = false;
        refresh();
      }
    })();
    return completion;
  }
  function projection(point, rect) {
    const eye = cameraEye(camera),
      { forward, right, up } = cameraBasis(camera),
      dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0),
      r = point.map((v, k) => v - eye[k]),
      z = dot(r, forward);
    return z > 0.05
      ? [
          (0.5 +
            (dot(r, right) / ((0.62 * z * rect.width) / rect.height)) * 0.5) *
            rect.width,
          (0.5 - (dot(r, up) / (0.62 * z)) * 0.5) * rect.height,
        ]
      : null;
  }
  function shownPoint(n, p) {
    return n.type === "water" ? [p[0], params.waterLevel, p[2]] : p;
  }
  function hitHandle(x, y, rect) {
    const n = node();
    if (!n || !n.visible) return -1;
    let best = -1,
      distance = 14;
    n.points.forEach((p, i) => {
      const q = projection(shownPoint(n, p), rect);
      if (q) {
        const d = Math.hypot(q[0] + rect.left - x, q[1] + rect.top - y);
        if (d < distance) {
          best = i;
          distance = d;
        }
      }
    });
    return best;
  }
  function pointerDown(ray, x, y, rect) {
    if (objectTools?.pointerDown(ray, x, y, rect)) return true;
    const n = node();
    if (!n || n.baked || !mode || !canEdit()) return false;
    const hit = hitHandle(x, y, rect);
    if (hit >= 0) {
      pointIndex = hit;
      mode = "edit";
      dragging = true;
      properties();
      return true;
    }
    if (mode !== "place") return false;
    if (n.points.length >= MAX_POINTS) {
      toast(`Maximum ${MAX_POINTS} control points per spline.`);
      return true;
    }
    edit(async () => {
      let p =
        params.showTerrain === false
          ? null
          : await renderer.pick(ray.origin, ray.direction);
      if (!p) {
        const level =
          n.type === "water"
            ? params.waterLevel
            : params.preset === 3
              ? params.plotHeight
              : 0;
        if (Math.abs(ray.direction[1]) < 0.001) return;
        const t = (level - ray.origin[1]) / ray.direction[1];
        if (t < 0) return;
        p = ray.origin.map((v, k) => v + ray.direction[k] * t);
      }
      p = p.map((v, k) =>
        Math.max([-21, -3.5, -19][k], Math.min([21, 21, 19][k], v)),
      );
      if (n.type === "water") p[1] = params.waterLevel;
      if (
        n.points.length &&
        Math.hypot(p[0] - n.points.at(-1)[0], p[2] - n.points.at(-1)[2]) < 0.15
      )
        return;
      n.points.push(p);
      pointIndex = n.points.length - 1;
      changed();
    })
      .catch((e) => toast(e.message))
      .finally(refresh);
    return true;
  }
  function drag(ray) {
    if (objectTools?.drag(ray)) return;
    const n = node(),
      p = n?.points[pointIndex];
    if (!dragging || !p || state.rebuilding) return;
    const level = n.type === "water" ? params.waterLevel : p[1];
    if (Math.abs(ray.direction[1]) < 0.001) return;
    const t = (level - ray.origin[1]) / ray.direction[1];
    if (t <= 0) return;
    p[0] = Math.max(-21, Math.min(21, ray.origin[0] + ray.direction[0] * t));
    p[2] = Math.max(-19, Math.min(19, ray.origin[2] + ray.direction[2] * t));
    changed();
  }
  function overlay(rect) {
    const svg = $("#spline-overlay");
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    let html =
      '<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="#8cddda"/></marker></defs>';
    for (const n of nodes()) {
      if (!n.visible || n.type === "shape") continue;
      const color = n.type === "water" ? "#8cddda" : "#ebba82";
      let d = "",
        pen = false;
      for (const p of sampleSpline(n.points, 48)) {
        const q = projection(shownPoint(n, p), rect);
        if (!q) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${q[0]},${q[1]} `;
        pen = true;
      }
      html += `<path d="${d}" stroke="${color}" stroke-width="${selected === n.id ? 2.5 : 1.2}" ${n.type === "water" ? 'marker-end="url(#flow-arrow)"' : ""}/>`;
      if (selected === n.id)
        n.points.forEach((p, i) => {
          const q = projection(shownPoint(n, p), rect);
          if (q)
            html += `<circle data-spline-point="${i}" cx="${q[0]}" cy="${q[1]}" r="${i === pointIndex ? 6 : 4}" fill="${color}"/><text x="${q[0] + 9}" y="${q[1] - 7}">${i + 1}</text>`;
        });
    }
    html += objectTools?.overlay(rect) || "";
    // Keep unchanged handles mounted; replacing them every frame causes stale
    // DOM targets and unnecessary layout work while the camera is stationary.
    if (html !== lastOverlay) {
      svg.innerHTML = html;
      lastOverlay = html;
    }
  }
  function deactivate() {
    objectTools?.deactivate();
    mode = null;
    dragging = false;
  }
  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      deactivate();
      properties();
    }
  });
  objectTools = createObjectTools({
    params,
    state,
    project: projection,
    getNode: () =>
      selected === "terrain" && params.preset === 3
        ? { id: "terrain", type: "plot", visible: params.showTerrain !== false }
        : node(),
    getPointIndex: () => pointIndex,
    isPlacing: () => mode === "place",
    changed: (geometry) => {
      state.dirty = true;
      if (geometry) schedule();
    },
    regenerate,
    selectTool,
    refreshScene: refresh,
    deleteShape: () => $("#path-delete").click(),
  });
  refresh();
  return {
    inspectSelection: () => select(selected),
    activateGizmo: (mode) => {
      if (!canEdit() || objectTools?.active()) return false;
      const n = node();
      if ((!n || n.baked) && !(selected === "terrain" && params.preset === 3))
        return false;
      showTab(n?.type === "shape" ? "shape" : n ? "path" : "terrain");
      return objectTools?.setMode(mode);
    },
    transformDragging: () => objectTools?.active(),
    pointerDown,
    drag,
    end() {
      objectTools?.end();
      dragging = false;
    },
    overlay,
    refresh,
    deactivate,
    select,
    pending: () => pending,
    flush: () => (pending ? process() : completion),
    beforeRebuild() {
      pending = false;
      clearTimeout(timer);
      deactivate();
      for (const n of nodes()) if (n.type !== "water") n.baked = false;
    },
    async afterRebuild() {
      if (renderer.gpuErosion) await renderer.solver.refreshSplineCuts(nodes());
      refresh();
    },
    summary: () =>
      clone({
        selected,
        gizmo: objectTools?.summary(),
        pointIndex,
        mode,
        objects: nodes(),
        pending,
        liveBase: !!renderer.solver?.splineBaseActive,
      }),
  };
}
