import { PRIMITIVES } from "./primitives.js";
import { rayPlaneAngle, angleDelta } from "./rotation.js";
import {
  objectPivot,
  moveObject,
  scaleObject,
  rotateObject,
  rayAxisParameter,
} from "./shapes.js";
const $ = (s) => document.querySelector(s),
  copy = (x) => structuredClone(x),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function createObjectTools({
  getNode,
  getPointIndex,
  isPlacing,
  params,
  state,
  project,
  changed,
  regenerate,
  selectTool,
  refreshScene,
  deleteShape,
}) {
  let mode = "off",
    target = "object",
    dragging = null;
  const current = () => getNode(),
    pointIndex = () => (target === "point" ? getPointIndex() : -1);
  const canEdit = () =>
    state.ready && !state.rebuilding && !state.regenPending && !state.busy;
  const pivot = () => objectPivot(current(), params, pointIndex());
  function notify(n, final = true) {
    state.dirty = true;
    if (n.type === "plot") {
      if (final) regenerate();
    } else if (n.type === "water") changed(false);
    else changed(true);
    refresh();
  }
  function setMode(m) {
    const n = current();
    if (!n || n.baked || !canEdit() || dragging) return false;
    selectTool("orbit");
    if (m !== "move") target = "object";
    mode = m;
    refresh();
    return true;
  }
  $("#gizmo-move").onclick = () => setMode("move");
  $("#gizmo-rotate").onclick = () => setMode("rotate");
  $("#gizmo-scale").onclick = () => {
    target = "object";
    $("#transform-target").value = "object";
    setMode("scale");
  };
  $("#gizmo-off").onclick = () => {
    mode = "off";
    refresh();
  };
  $("#transform-target").onchange = () => {
    target = $("#transform-target").value;
    refresh();
  };
  for (const [k, axis] of [..."xyz"].entries())
    $("#transform-" + axis).onchange = () => {
      const n = current();
      if (!n || n.baked || !canEdit()) return;
      const value = Number($("#transform-" + axis).value);
      if (!Number.isFinite(value)) return;
      const p = pivot();
      p[k] = clamp(value, [-21, -3, -19][k], [21, 20, 19][k]);
      moveObject(n, params, p, pointIndex());
      notify(n);
    };
  $("#apply-object-scale").onclick = () => {
    const n = current(),
      f = Number($("#object-scale").value);
    if (!n || n.baked || !canEdit() || !Number.isFinite(f)) return;
    scaleObject(
      n,
      params,
      [1, 1, 1].map(() => clamp(f, 0.25, 4)),
    );
    $("#object-scale").value = "1";
    notify(n);
  };
  const shapeBindings = [
    ["shape-primitive", "primitive"],
    ["shape-profile", "profile"],
    ["shape-rounding", "rounding"],
    ["shape-terrace-height", "terraceHeight"],
    ["shape-terrace-strength", "terraceStrength"],
    ...[
      "Type",
      "Amount",
      "Scale",
      "Octaves",
      "Gain",
      "Lacunarity",
      "Warp",
      "Seed",
    ].map((k) => ["shape-noise-" + k, "noise" + k]),
  ];
  for (const [id, key] of shapeBindings) {
    const el = $("#" + id);
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const n = current();
      if (n?.type !== "shape" || n.baked || !canEdit()) return;
      n[key] = Number(el.value);
      notify(n);
    });
  }
  for (const property of ["size", "rotation"])
    for (const [k, axis] of [..."xyz"].entries())
      $("#shape-" + property + "-" + axis).oninput = () => {
        const n = current();
        if (n?.type !== "shape" || n.baked || !canEdit()) return;
        n[property][k] = Number($("#shape-" + property + "-" + axis).value);
        notify(n);
      };
  $("#shape-name").onchange = () => {
    const n = current();
    if (n?.type === "shape") {
      n.name = $("#shape-name").value.trim().slice(0, 60) || "Boulder";
      refreshScene();
    }
  };
  $("#shape-visible").onchange = () => {
    const n = current();
    if (n?.type === "shape") {
      n.visible = $("#shape-visible").checked;
      if (!n.baked) changed(true);
      refreshScene();
    }
  };
  $("#shape-delete").onclick = deleteShape;
  function refresh() {
    const n = current(),
      show =
        !!n &&
        !["sculpt", "erosion", "water", "fracture"].includes(
          $("#scene-properties").dataset.panel,
        );
    $("#object-transform").classList.toggle("hidden", !show);
    if (!show) return;
    const locked = !!n.baked || !canEdit();
    for (const id of [
      "gizmo-move",
      "gizmo-scale",
      "gizmo-rotate",
      "gizmo-off",
      "apply-object-scale",
      "object-scale",
    ])
      $("#" + id).disabled = locked;
    $("#gizmo-move").classList.toggle("active", mode === "move");
    $("#gizmo-rotate").classList.toggle("active", mode === "rotate");
    $("#gizmo-scale").classList.toggle("active", mode === "scale");
    $("#gizmo-off").classList.toggle("active", mode === "off");
    const isPath = n.type === "cut" || n.type === "water";
    $("#transform-target").disabled =
      !isPath || getPointIndex() < 0 || mode !== "move" || locked;
    if (!isPath || getPointIndex() < 0) target = "object";
    $("#transform-target").value = target;
    const p = pivot();
    for (let k = 0; k < 3; k++) {
      const el = $("#transform-" + "xyz"[k]);
      el.value = p[k].toFixed(2);
      el.disabled = locked;
    }
    $("#transform-help").textContent = n.baked
      ? "Baked into the volume: transforms are locked. Removing this guide will not remove its geometry."
      : n.type === "plot"
        ? "Plot transform changes regenerate the base on release and clear sculpting/erosion. Live shapes/cuts are reapplied."
        : n.type === "water"
          ? "G Move / R Rotate / S Scale. Water rotates around Y only; its shared level remains horizontal. Y translation adjusts the level for all paths."
          : n.type === "shape"
            ? "G Move / R Rotate / S Scale. Drag the world-axis handles or rotation rings. Noise and terracing stay in this shape’s local 3D coordinates."
            : "Y moves the selected point or entire spline AND its channel bed. Lower Y or increase Cut depth to cut deeper. Uniform scale changes the route, width and depth.";
    if (n.type === "shape") {
      $("#shape-name").value = n.name;
      $("#shape-visible").checked = n.visible;
      $("#shape-visible").disabled = !canEdit();
      $("#shape-delete").disabled = !canEdit();
      for (const [id, key] of shapeBindings) {
        const el = $("#" + id);
        el.value = n[key] ?? (key === "profile" ? 0.5 : 0);
        el.style.setProperty(
          "--range-progress",
          `${(100 * (Number(el.value) - Number(el.min))) / (Number(el.max) - Number(el.min))}%`,
        );
        el.disabled = locked;
        const out = $("#" + id + "-value");
        if (out) out.textContent = Number(el.value).toFixed(2);
      }
      for (const property of ["size", "rotation"])
        for (const [k, axis] of [..."xyz"].entries()) {
          const el = $("#shape-" + property + "-" + axis);
          el.value = n[property][k];
          el.style.setProperty(
            "--range-progress",
            `${(100 * (Number(el.value) - Number(el.min))) / (Number(el.max) - Number(el.min))}%`,
          );
          el.disabled = locked;
          $("#" + el.id + "-value").textContent = Number(el.value).toFixed(1);
        }
      $("#primitive-help").textContent =
        PRIMITIVES.find((p) => p.id === n.primitive)?.hint || "";
      $("#shape-profile").disabled = locked || [0, 1, 6].includes(n.primitive);
      $("#shape-profile")
        .closest(".control")
        .classList.toggle("hidden", [0, 1, 6].includes(n.primitive));
      $("#shape-rounding")
        .closest(".control")
        .classList.toggle("hidden", ![1, 6].includes(n.primitive));
      $("#shape-status").textContent = n.baked
        ? "Baked shape guide: hiding/deleting this guide does not remove the solid. Regenerating the plot reactivates remaining shape guides."
        : "Local XYZ density noise affects only this shape. Live visibility/delete recomputes the volume. All shapes are fused first; cut splines subtract afterward. Brushes and erosion bake live objects.";
    }
  }
  function axes(rect) {
    const n = current();
    if (
      !n ||
      n.baked ||
      !n.visible ||
      isPlacing() ||
      mode === "off" ||
      state.tool !== "orbit"
    )
      return [];
    const p = pivot(),
      o = project(p, rect);
    if (!o) return [];
    const length = 4;
    return (mode === "rotate" && n.type === "water" ? [1] : [0, 1, 2])
      .map((axis) => {
        const tip = [...p];
        tip[axis] += length;
        const end = project(tip, rect);
        const ring = Array.from({ length: 65 }, (_, i) => {
          const angle = (i * Math.PI * 2) / 64,
            q = [...p];
          q[(axis + 1) % 3] += length * Math.cos(angle);
          q[(axis + 2) % 3] += length * Math.sin(angle);
          return project(q, rect);
        });
        return { axis, p, o, end, length, ring };
      })
      .filter((a) =>
        mode === "rotate"
          ? a.ring.some(Boolean)
          : a.end && Math.hypot(a.end[0] - o[0], a.end[1] - o[1]) > 10,
      );
  }
  function pointerDown(ray, x, y, rect) {
    let best = null,
      distance = 10;
    for (const a of axes(rect)) {
      let d = Infinity;
      if (mode === "rotate") {
        for (let i = 1; i < a.ring.length; i++) {
          const u = a.ring[i - 1],
            v = a.ring[i];
          if (!u || !v) continue;
          const dx = v[0] - u[0],
            dy = v[1] - u[1],
            t = clamp(
              ((x - rect.left - u[0]) * dx + (y - rect.top - u[1]) * dy) /
                Math.max(0.001, dx * dx + dy * dy),
              0,
              1,
            );
          d = Math.min(
            d,
            Math.hypot(
              x - rect.left - u[0] - dx * t,
              y - rect.top - u[1] - dy * t,
            ),
          );
        }
      } else d = Math.hypot(a.end[0] + rect.left - x, a.end[1] + rect.top - y);
      if (d < distance) {
        best = a;
        distance = d;
      }
    }
    if (!best) return false;
    if (!canEdit()) return true;
    const start =
      mode === "rotate"
        ? rayPlaneAngle(ray, best.p, best.axis)
        : rayAxisParameter(ray, best.p, best.axis);
    if (start === null) return false;
    dragging = {
      ...best,
      start,
      node: copy(current()),
      params: copy(params),
      index: pointIndex(),
      mode,
      changed: false,
      angle: 0,
      lastAngle: start,
    };
    return true;
  }
  function drag(ray) {
    if (!dragging || state.rebuilding) return false;
    const n = current();
    if (!n || n.baked) return false;
    const d = dragging,
      value =
        d.mode === "rotate"
          ? rayPlaneAngle(ray, d.p, d.axis)
          : rayAxisParameter(ray, d.p, d.axis);
    if (value === null) return true;
    const delta = value - d.start;
    if (n.type === "plot") {
      for (const key of [
        "plotX",
        "plotY",
        "plotZ",
        "plotWidth",
        "plotHeight",
        "plotLength",
        "plotBase",
        "plotRotation",
      ])
        params[key] = copy(d.params[key]);
    } else Object.assign(n, copy(d.node));
    if (d.mode === "move") {
      const p = [...d.p];
      p[d.axis] = clamp(
        p[d.axis] + delta,
        [-21, -3, -19][d.axis],
        [21, 20, 19][d.axis],
      );
      moveObject(n, params, p, d.index);
    } else if (d.mode === "rotate") {
      d.angle += angleDelta(value, d.lastAngle);
      d.lastAngle = value;
      rotateObject(n, params, d.axis, d.angle);
    } else {
      const factors = [1, 1, 1];
      factors[d.axis] = clamp(1 + delta / d.length, 0.25, 4);
      scaleObject(n, params, factors);
    }
    d.changed = true;
    notify(n, false);
    return true;
  }
  function end() {
    const d = dragging;
    dragging = null;
    if (d?.changed && current()?.type === "plot") regenerate();
  }
  function overlay(rect) {
    let html = "";
    for (const a of axes(rect)) {
      const color = ["#ef8b80", "#a8d38b", "#88c8ed"][a.axis],
        x = a.end?.[0] ?? 0,
        y = a.end?.[1] ?? 0;
      if (mode === "rotate") {
        let path = "",
          pen = false;
        for (const point of a.ring) {
          if (!point) {
            pen = false;
            continue;
          }
          path += `${pen ? "L" : "M"}${point[0]},${point[1]} `;
          pen = true;
        }
        html += `<path fill="none" d="${path}" stroke="#182018" stroke-width="5"/><path fill="none" data-gizmo-axis="${"xyz"[a.axis]}" data-gizmo-rotation="true" d="${path}" stroke="${color}" stroke-width="2.5"/>`;
        const label = a.ring[8];
        if (label)
          html += `<text x="${label[0] + 8}" y="${label[1] - 8}">${"XYZ"[a.axis]}</text>`;
        continue;
      }
      html += `<path d="M${a.o[0]} ${a.o[1]}L${x} ${y}" stroke="#182018" stroke-width="5"/><path d="M${a.o[0]} ${a.o[1]}L${x} ${y}" stroke="${color}" stroke-width="2.5"/>`;
      html +=
        mode === "move"
          ? `<circle data-gizmo-axis="${"xyz"[a.axis]}" cx="${x}" cy="${y}" r="7" fill="${color}" stroke="#182018"/>`
          : `<rect data-gizmo-axis="${"xyz"[a.axis]}" x="${x - 6}" y="${y - 6}" width="12" height="12" fill="${color}" stroke="#182018"/>`;
      html += `<text x="${x + 10}" y="${y - 7}">${"XYZ"[a.axis]}</text>`;
    }
    return html;
  }
  return {
    refresh,
    setMode,
    pointerDown,
    drag,
    end,
    overlay,
    selected() {
      target = "object";
      mode = "move";
      dragging = null;
      refresh();
    },
    deactivate() {
      mode = "off";
      dragging = null;
    },
    active: () => !!dragging,
    summary: () => ({ mode, target }),
  };
}
