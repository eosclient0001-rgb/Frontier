// Editor entry point: tools, selection, undo history, generator, save/load, GLB export and the panes.

import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BridgeType, emptyProject, newId, parseProject, Project, Prop, PropKind, Road } from "../core/model";
import { PROFILES, PROFILE_ORDER, ProfileId, resolveOptions, RoadOptions } from "../core/profiles";
import { generateWithReport } from "../core/generator";
import { sampleCurve } from "../core/sampling";
import { surfaceHeight } from "../core/terrain";
import { Rng } from "../core/math";
import { buildWorld, BuiltWorld } from "../mesh/worldBuilder";
import { Viewport } from "./scene";
import { isTyping } from "./camera";
import { button, check, download, field, h, numberInput, round, section, select, tile, textInput, toast } from "./ui";

type Tool = "select" | "draw" | "prop";
type Pick =
  | { kind: "point"; road: string; index: number }
  | { kind: "road"; road: string }
  | { kind: "prop"; prop: string };

const PROP_KINDS: readonly (readonly [PropKind, string])[] = [
  ["bollard", "Bollard"],
  ["speedBump", "Speed bump"],
  ["lamp", "Street lamp"],
  ["crosswalk", "Zebra crossing"],
  ["railCrossing", "Rail crossing"],
  ["stopLine", "Stop line"]
];
const BRIDGE_LABELS: readonly (readonly [BridgeType, string])[] = [
  ["auto", "Auto (by span)"],
  ["girder", "Girder"],
  ["viaduct", "Viaduct"],
  ["arch", "Arch"],
  ["truss", "Truss"],
  ["cable-stayed", "Cable-stayed"],
  ["suspension", "Suspension"]
];
const OPTION_LABELS: readonly [keyof RoadOptions, string][] = [
  ["bus", "Bus lane"],
  ["cycle", "Cycle lane"],
  ["parking", "Parking"],
  ["sidewalks", "Sidewalks"],
  ["speedBumps", "Speed bumps"],
  ["bollards", "Bollards"],
  ["lamps", "Lamps"]
];
const SNAP_PICK_PX = 12;

const state = {
  project: emptyProject("Untitled network") as Project,
  tool: "select" as Tool,
  drawProfile: "avenue" as ProfileId,
  drawLift: 0,
  propKind: "bollard" as PropKind,
  selRoad: null as string | null,
  selPoint: null as number | null,
  selProp: null as string | null,
  draft: null as string | null,
  showOverlay: true,
  showUnderground: false,
  built: null as BuiltWorld | null,
  seed: 1,
  busy: false,
  lastReport: "",
  genCount: 0
};

const undoStack: string[] = [];
const redoStack: string[] = [];
let viewport: Viewport;
let drag: { road: string; index: number; before: string; moved: boolean } | null = null;
let ghost: { x: number; z: number } | null = null;
let rebuildTimer = 0;

const leftPane = document.getElementById("left") as HTMLElement;
const rightPane = document.getElementById("right") as HTMLElement;
const statusBar = document.getElementById("statusbar") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;
let roadListBox: HTMLElement;
let propListBox: HTMLElement;

// ---------- history and editing ----------

function snapshot(): void {
  undoStack.push(JSON.stringify(state.project));
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
}

function edit(mutator: (p: Project) => void, rebuild = true): void {
  snapshot();
  mutator(state.project);
  refreshAll(rebuild);
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return toast("Nothing to undo");
  redoStack.push(JSON.stringify(state.project));
  restore(prev);
  toast("Undo");
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return toast("Nothing to redo");
  undoStack.push(JSON.stringify(state.project));
  restore(next);
  toast("Redo");
}

function restore(json: string): void {
  state.project = parseProject(json);
  state.draft = null;
  if (state.selRoad && !state.project.roads.some((r) => r.id === state.selRoad)) state.selRoad = null;
  if (state.selProp && !state.project.props.some((p) => p.id === state.selProp)) state.selProp = null;
  refreshAll(true);
}

function refreshAll(rebuild: boolean): void {
  drawOverlay();
  renderLists();
  renderInspector();
  renderStatus();
  renderHud();
  if (rebuild) scheduleRebuild();
}

function roadById(id: string | null): Road | undefined {
  return id ? state.project.roads.find((r) => r.id === id) : undefined;
}

function nextRoadName(profile: ProfileId): string {
  const label = PROFILES[profile].label;
  const count = state.project.roads.filter((r) => r.profile === profile).length + 1;
  return `${label} ${count}`;
}

function newRoad(profile: ProfileId, points: Road["points"]): Road {
  const rng = new Rng(state.project.roads.length * 7919 + Date.now() % 100000);
  return {
    id: newId("r"),
    name: nextRoadName(profile),
    profile,
    points,
    options: {},
    bridge: "auto",
    seed: rng.int(1, 0x7fffffff)
  };
}

// ---------- rebuild ----------

function scheduleRebuild(delay = 350): void {
  state.busy = true;
  renderStatus();
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => requestAnimationFrame(rebuildNow), delay);
}

function rebuildNow(): void {
  try {
    const built = buildWorld(state.project);
    state.built = built;
    viewport.setWorld(built.geometries);
    viewport.setUnderground(state.showUnderground);
    if (built.warnings.length) console.warn(built.warnings.join("\n"));
  } catch (err) {
    console.error(err);
    toast(`Build failed: ${(err as Error).message}`);
  } finally {
    state.busy = false;
    renderStatus();
    renderInspector();
  }
}

// ---------- overlay (road centrelines, control points, props, draft, cursor) ----------

function drawOverlay(): void {
  viewport.clearOverlay();
  if (!state.showOverlay) return;
  const group = viewport.overlay;
  const pointMat = new MeshBasicMaterial({ color: 0xffffff });
  const selPointMat = new MeshBasicMaterial({ color: 0x5b8cff });
  const sphere = new SphereGeometry(1.8, 10, 8);
  for (const road of state.project.roads) {
    const selected = road.id === state.selRoad;
    const samples = sampleCurve(road.points, 4);
    const pos: number[] = [];
    for (const s of samples) pos.push(s.x, surfaceHeight(s, s.lift) + 0.6, s.z);
    if (pos.length >= 6) {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      const color = road.id === state.draft ? 0xf5b942 : selected ? 0x5b8cff : hexFromCss(PROFILES[road.profile].swatch);
      const line = new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.7 }));
      group.add(line);
    }
    road.points.forEach((p, i) => {
      const m = new Mesh(sphere, selected && state.selPoint === i ? selPointMat : pointMat);
      m.position.set(p.x, surfaceHeight(p, p.lift) + 1, p.z);
      m.scale.setScalar(selected ? 1.2 : 0.7);
      group.add(m);
    });
  }
  const propMat = new MeshBasicMaterial({ color: 0xf5b942 });
  const propSelMat = new MeshBasicMaterial({ color: 0x5b8cff });
  for (const p of state.project.props) {
    const m = new Mesh(new SphereGeometry(1.3, 8, 6), p.id === state.selProp ? propSelMat : propMat);
    m.position.set(p.x, surfaceHeight(p, 0) + 2.5, p.z);
    group.add(m);
  }
  if (ghost && state.tool !== "select") {
    const m = new Mesh(new SphereGeometry(2.4, 10, 8), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    m.position.set(ghost.x, surfaceHeight(ghost, state.drawLift) + 1, ghost.z);
    group.add(m);
  }
}

function hexFromCss(css: string): number {
  const v = css.replace("#", "");
  return parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
}

// ---------- picking (select tool) ----------

function pickAt(clientX: number, clientY: number): Pick | null {
  const local = { x: clientX, y: clientY };
  const dist = (sx: number, sy: number): number => Math.hypot(sx - local.x, sy - local.y);
  // Control points first, selected road preferred.
  const ordered = [...state.project.roads].sort((a, b) => (a.id === state.selRoad ? -1 : 0) - (b.id === state.selRoad ? -1 : 0));
  for (const road of ordered) {
    for (let i = 0; i < road.points.length; i++) {
      const p = road.points[i];
      const s = viewport.toScreen(new Vector3(p.x, surfaceHeight(p, p.lift) + 1, p.z));
      if (s.visible && dist(s.x, s.y) < SNAP_PICK_PX) return { kind: "point", road: road.id, index: i };
    }
  }
  for (const p of state.project.props) {
    const s = viewport.toScreen(new Vector3(p.x, surfaceHeight(p, 0) + 2.5, p.z));
    if (s.visible && dist(s.x, s.y) < SNAP_PICK_PX) return { kind: "prop", prop: p.id };
  }
  // Road centrelines, measured in screen space.
  let best: { road: string; d: number } | null = null;
  for (const road of ordered) {
    const samples = sampleCurve(road.points, 8);
    for (const sp of samples) {
      const s = viewport.toScreen(new Vector3(sp.x, surfaceHeight(sp, sp.lift) + 0.6, sp.z));
      if (!s.visible) continue;
      const d = dist(s.x, s.y);
      if (d < 9 && (!best || d < best.d)) best = { road: road.id, d };
    }
  }
  return best ? { kind: "road", road: best.road } : null;
}

// ---------- tool actions ----------

function setTool(tool: Tool): void {
  if (state.draft) finishDraft(true);
  state.tool = tool;
  ghost = null;
  renderLeftTools();
  renderHud();
  drawOverlay();
}

function addDraftPoint(g: { x: number; z: number }): void {
  if (!state.draft) {
    snapshot();
    const road = newRoad(state.drawProfile, []);
    state.project.roads.push(road);
    state.draft = road.id;
    state.selRoad = road.id;
    state.selProp = null;
  }
  const road = roadById(state.draft);
  if (!road) return;
  const last = road.points[road.points.length - 1];
  if (last && Math.hypot(last.x - g.x, last.z - g.z) < 2) return;
  road.points.push({ x: g.x, z: g.z, lift: state.drawLift });
  drawOverlay();
  renderLists();
  renderInspector();
  renderHud();
}

function finishDraft(keep: boolean): void {
  const road = roadById(state.draft);
  state.draft = null;
  if (!road) return;
  if (road.points.length < 2) {
    state.project.roads = state.project.roads.filter((r) => r.id !== road.id);
    state.selRoad = null;
    toast("Road discarded (needs two points)");
  } else {
    state.selRoad = keep ? road.id : null;
    toast(`${road.name} — ${road.points.length} points`);
  }
  refreshAll(true);
}

function placeProp(g: { x: number; z: number }): void {
  const prop: Prop = { id: newId("p"), kind: state.propKind, x: g.x, z: g.z, yaw: 0 };
  edit((p) => p.props.push(prop));
  state.selProp = prop.id;
  state.selRoad = null;
  refreshAll(true);
}

function deleteSelection(): void {
  if (state.draft) return finishDraft(false);
  if (state.selProp) {
    const id = state.selProp;
    state.selProp = null;
    return edit((p) => (p.props = p.props.filter((x) => x.id !== id)));
  }
  const road = roadById(state.selRoad);
  if (!road) return;
  if (state.selPoint !== null && road.points.length > 2) {
    const idx = state.selPoint;
    state.selPoint = null;
    return edit((p) => {
      const r = p.roads.find((x) => x.id === road.id);
      r?.points.splice(idx, 1);
    });
  }
  state.selRoad = null;
  state.selPoint = null;
  edit((p) => (p.roads = p.roads.filter((r) => r.id !== road.id)));
}

function duplicateRoad(): void {
  const road = roadById(state.selRoad);
  if (!road) return;
  const copy: Road = {
    ...road,
    id: newId("r"),
    name: `${road.name} copy`,
    points: road.points.map((p) => ({ ...p, x: p.x + 24, z: p.z + 24 })),
    options: { ...road.options },
    seed: (road.seed * 2654435761 + 97) >>> 0
  };
  edit((p) => p.roads.push(copy));
  state.selRoad = copy.id;
}

function frameSelection(): void {
  const road = roadById(state.selRoad);
  if (!road || road.points.length === 0) return;
  const cx = road.points.reduce((s, p) => s + p.x, 0) / road.points.length;
  const cz = road.points.reduce((s, p) => s + p.z, 0) / road.points.length;
  const cy = surfaceHeight({ x: cx, z: cz }, 0);
  viewport.fly.lookAt(new Vector3(cx, cy, cz), 260);
}

// ---------- generator and file actions ----------

function generate(seed: number): void {
  const { project, report } = generateWithReport(seed);
  state.seed = seed;
  state.lastReport = `${report.roads} roads, ${report.pruned} pruned, ${report.overlaps} overlaps removed`;
  snapshot();
  state.project = project;
  state.selRoad = null;
  state.selProp = null;
  state.draft = null;
  refreshAll(false);
  viewport.fly.lookAt(new Vector3(0, 0, 0), 2300);
  scheduleRebuild(20);
  toast(`Generated seed ${seed}: ${report.roads} roads`);
}

function saveProject(): void {
  const name = `${state.project.name.replace(/[^\w-]+/g, "_") || "network"}.frontier.json`;
  download(name, JSON.stringify(state.project, null, 2), "application/json");
  toast(`Saved ${name}`);
}

function loadProject(file: File): void {
  file
    .text()
    .then((text) => {
      snapshot();
      state.project = parseProject(text);
      state.selRoad = null;
      state.selProp = null;
      state.draft = null;
      refreshAll(true);
      toast(`Loaded ${state.project.roads.length} roads`);
    })
    .catch((err: Error) => toast(`Load failed: ${err.message}`));
}

function exportGlb(): void {
  if (state.busy) return toast("Still building, try again");
  if (!state.built) rebuildNow();
  const exporter = new GLTFExporter();
  const group = new Group();
  group.add(...viewport.world.children.map((c) => c.clone()));
  exporter.parse(
    group,
    (result) => {
      download(`${state.project.name.replace(/[^\w-]+/g, "_") || "network"}.glb`, new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }));
      toast("GLB exported");
    },
    (err: unknown) => toast(`Export failed: ${String(err)}`),
    { binary: true }
  );
}

// ---------- panes ----------

function renderLeftTools(): void {
  const body = leftPane.querySelector("#tools") as HTMLElement | null;
  if (!body) return;
  body.replaceChildren(
    h(
      "div",
      { class: "tiles" },
      tile("↖", "Select  V", state.tool === "select", () => setTool("select")),
      tile("⟋", "Draw road  B", state.tool === "draw", () => setTool("draw")),
      tile("◉", "Place prop  P", state.tool === "prop", () => setTool("prop"))
    )
  );
}

function renderLeft(): void {
  const profileOptions = PROFILE_ORDER.map((id) => [id, PROFILES[id].label] as const);
  const drawSection = section(
    "Draw",
    field("Profile", select(profileOptions, state.drawProfile, (v) => (state.drawProfile = v))),
    h(
      "label",
      { class: "field" },
      h("span", { text: "Lift" }),
      h("input", {
        type: "range",
        min: "-12",
        max: "14",
        step: "0.5",
        value: String(state.drawLift),
        oninput: (e: Event) => {
          state.drawLift = Number((e.target as HTMLInputElement).value);
          liftLabel.textContent = `${round(state.drawLift, 1)} m`;
        }
      })
    ),
    h("div", { class: "hint" }, "Click to add points. Enter or double-click to finish. Backspace removes the last point. Lift below zero draws a subway tunnel.")
  );
  const liftLabel = h("div", { class: "hint", text: `${round(state.drawLift, 1)} m` });
  drawSection.append(liftLabel);
  const propSection = section(
    "Props",
    field("Kind", select(PROP_KINDS, state.propKind, (v) => (state.propKind = v))),
    h("div", { class: "hint" }, "Place with the prop tool. R rotates the selected prop by 15°.")
  );
  const genSeed = numberInput(state.seed, (v) => (state.seed = Math.max(1, Math.floor(v))), 1, 1, 999999);
  const generateSection = section(
    "Generate",
    field("Seed", genSeed),
    h("div", { class: "btn-row" }, button("Generate map", () => generate(Math.max(1, Math.floor(Number(genSeed.value) || 1))), "btn primary"), button("New empty", () => {
      snapshot();
      state.project = emptyProject("Empty network");
      state.selRoad = null;
      state.selProp = null;
      refreshAll(true);
    })),
    h("div", { class: "hint", text: state.lastReport || "City grid, ring road, motorway, river crossings, rail, subway, countryside and footpaths." })
  );
  const fileSection = section(
    "File",
    h(
      "div",
      { class: "btn-row" },
      button("Save JSON", saveProject),
      button("Load JSON", () => fileInput.click()),
      button("Export GLB", exportGlb)
    )
  );
  const fileInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) loadProject(f);
    fileInput.value = "";
  });
  const viewSection = section(
    "View",
    check("Road overlay and control points", state.showOverlay, (v) => {
      state.showOverlay = v;
      drawOverlay();
    }),
    check("Show underground (subway, dim terrain)", state.showUnderground, (v) => {
      state.showUnderground = v;
      viewport.setUnderground(v);
    })
  );
  const roadsSection = section("Roads");
  roadListBox = h("div", { class: "list" });
  roadsSection.append(roadListBox);
  const propsSection = section("Props");
  propListBox = h("div", { class: "list" });
  propsSection.append(propListBox);

  const toolsSection = section("Tools", h("div", { id: "tools" }));
  leftPane.replaceChildren(
    h("div", { class: "pane-head" }, h("span", { text: "Frontier" }), h("small", { text: "Road editor" })),
    h(
      "div",
      { class: "pane-body" },
      toolsSection,
      drawSection,
      propSection,
      generateSection,
      fileSection,
      fileInput,
      viewSection,
      roadsSection,
      propsSection
    )
  );
  renderLeftTools();
  renderLists();
}

function renderLists(): void {
  if (!roadListBox) return;
  roadListBox.replaceChildren(
    ...state.project.roads.map((r) =>
      h(
        "div",
        {
          class: "row",
          "aria-selected": String(r.id === state.selRoad),
          onclick: () => {
            state.selRoad = r.id;
            state.selProp = null;
            state.selPoint = null;
            refreshAll(false);
          }
        },
        h("span", { class: "swatch", style: `background:${PROFILES[r.profile].swatch}` }),
        h("span", { class: "name", text: r.name }),
        h("span", { class: "meta", text: PROFILES[r.profile].label.toLowerCase() })
      )
    )
  );
  if (state.project.roads.length === 0) roadListBox.append(h("div", { class: "hint", text: "No roads yet. Use Draw or Generate." }));
  propListBox.replaceChildren(
    ...state.project.props.map((p) =>
      h(
        "div",
        {
          class: "row",
          "aria-selected": String(p.id === state.selProp),
          onclick: () => {
            state.selProp = p.id;
            state.selRoad = null;
            refreshAll(false);
          }
        },
        h("span", { class: "swatch", style: "background:#f5b942" }),
        h("span", { class: "name", text: PROP_KINDS.find((k) => k[0] === p.kind)?.[1] ?? p.kind }),
        h("span", { class: "meta", text: `${round(p.x, 0)}, ${round(p.z, 0)}` })
      )
    )
  );
  if (state.project.props.length === 0) propListBox.append(h("div", { class: "hint", text: "No props placed." }));
}

function renderInspector(): void {
  const head = (title: string, sub = ""): HTMLElement => h("div", { class: "pane-head" }, h("span", { text: title }), h("small", { text: sub }));
  const prop = state.project.props.find((p) => p.id === state.selProp);
  const road = roadById(state.selRoad);
  if (prop) {
    rightPane.replaceChildren(
      head("Prop", prop.kind),
      h(
        "div",
        { class: "pane-body" },
        section(
          "Placement",
          field("Kind", select(PROP_KINDS, prop.kind, (v) => edit((p) => (p.props.find((x) => x.id === prop.id)!.kind = v)))),
          field("Yaw °", numberInput((prop.yaw * 180) / Math.PI, (v) => edit((p) => (p.props.find((x) => x.id === prop.id)!.yaw = (v * Math.PI) / 180)), 15)),
          field("Position", h("span", { class: "meta", text: `${round(prop.x, 1)}, ${round(prop.z, 1)}` }))
        ),
        h("div", { class: "btn-row" }, button("Delete prop", () => deleteSelection(), "btn danger"))
      )
    );
    return;
  }
  if (road) {
    renderRoadInspector(road, head);
    return;
  }
  renderProjectInspector(head);
}

function renderRoadInspector(road: Road, head: (t: string, s?: string) => HTMLElement): void {
  const profile = PROFILES[road.profile];
  const eff = resolveOptions(road.profile, road.options);
  const mut = (fn: (r: Road) => void): void => edit((p) => fn(p.roads.find((r) => r.id === road.id)!));
  const setOpt = (key: keyof RoadOptions, v: boolean | number): void => mut((r) => ((r.options as Record<string, unknown>)[key] = v));
  const info = h(
    "div",
    { class: "hint" },
    profile.description
  );
  const pointRows = road.points.map((p, i) =>
    h(
      "div",
      { class: `points${state.selPoint === i ? " sel" : ""}`, onclick: () => {
        state.selPoint = i;
        drawOverlay();
      } },
      h("span", { class: "idx", text: String(i + 1) }),
      numberInput(p.x, (v) => mut((r) => (r.points[i].x = v)), 1),
      numberInput(p.z, (v) => mut((r) => (r.points[i].z = v)), 1),
      numberInput(p.lift, (v) => mut((r) => (r.points[i].lift = v)), 0.5),
      h("span", { class: "x", text: "×", title: "Remove point", onclick: () => {
        if (road.points.length <= 2) return toast("A road needs two points");
        mut((r) => r.points.splice(i, 1));
      } })
    )
  );
  rightPane.replaceChildren(
    head("Road", `${road.points.length} pts`),
    h(
      "div",
      { class: "pane-body" },
      section(
        "Identity",
        field("Name", textInput(road.name, (v) => v && mut((r) => (r.name = v)))),
        field("Profile", select(PROFILE_ORDER.map((id) => [id, PROFILES[id].label] as const), road.profile, (v) => mut((r) => {
          r.profile = v;
          r.options = {};
        }))),
        info,
        field("Bridge", select(BRIDGE_LABELS, road.bridge, (v) => mut((r) => (r.bridge = v)))),
        field("Seed", h("span", { class: "meta", text: String(road.seed) })),
        h("div", { class: "btn-row" }, button("Reroll seed", () => mut((r) => (r.seed = (r.seed * 1103515245 + 12345) >>> 0 || 1))))
      ),
      section(
        "Lanes and details",
        field("Lanes", select([["1", "1 per way"], ["2", "2 per way"], ["3", "3 per way"]] as const, String(eff.lanes) as "1" | "2" | "3", (v) => setOpt("lanes", Number(v)))),
        h(
          "div",
          { class: "checks" },
          ...OPTION_LABELS.map(([key, label]) => check(label, Boolean(eff[key as keyof typeof eff]), (v) => setOpt(key, v)))
        )
      ),
      section("Control points", h("div", { class: "hint", text: "x, z in metres. Lift is height above ground; negative lift is underground." }), h("div", { class: "points" }, h("span"), h("span", { text: "x" }), h("span", { text: "z" }), h("span", { text: "lift" }), h("span")), ...pointRows),
      h(
        "div",
        { class: "btn-row" },
        button("Frame", frameSelection),
        button("Duplicate", duplicateRoad),
        button("Reverse", () => mut((r) => r.points.reverse())),
        button("Delete road", () => deleteSelection(), "btn danger")
      )
    )
  );
}

function renderProjectInspector(head: (t: string, s?: string) => HTMLElement): void {
  const b = state.built;
  const stats = b?.stats;
  const kv = (pairs: [string, string][]): HTMLElement =>
    h("div", { class: "kv" }, ...pairs.flatMap(([k, v]) => [h("span", { text: k }), h("span", { text: v })]));
  rightPane.replaceChildren(
    head("Network", state.project.name),
    h(
      "div",
      { class: "pane-body" },
      section("Map", field("Name", textInput(state.project.name, (v) => v && edit((p) => (p.name = v), false))), kv([["Map size", "4 km square"], ["Roads", String(state.project.roads.length)], ["Props", String(state.project.props.length)]])),
      section(
        "Topology",
        stats
          ? kv([
              ["Edges", String(stats.edges)],
              ["Nodes", String(stats.nodes)],
              ["Junctions (≥3 ways)", String(stats.junctions)],
              ["Dead ends", String(stats.deadEnds)],
              ["Bridge spans", String(stats.bridgeSpans)],
              ["Level crossings", String(stats.levelCrossings)],
              ["Grade separations", String(stats.gradeCrossings)],
              ["Length", `${round(stats.lengthKm, 1)} km`]
            ])
          : h("div", { class: "hint", text: "Building…" })
      ),
      section(
        "Shortcuts",
        h(
          "div",
          { class: "hint" },
          h("div", {}, h("kbd", { text: "RMB" }), " hold to look, ", h("kbd", { text: "W A S D" }), " move, ", h("kbd", { text: "Q E" }), " down/up, ", h("kbd", { text: "Shift" }), " boost, wheel for speed"),
          h("div", {}, h("kbd", { text: "V" }), " select  ", h("kbd", { text: "B" }), " draw  ", h("kbd", { text: "P" }), " prop  ", h("kbd", { text: "F" }), " frame road"),
          h("div", {}, h("kbd", { text: "Del" }), " delete  ", h("kbd", { text: "Ctrl Z" }), " undo  ", h("kbd", { text: "Ctrl Shift Z" }), " redo  ", h("kbd", { text: "Ctrl D" }), " duplicate")
        )
      )
    )
  );
}

function renderStatus(): void {
  const s = state.built?.stats;
  const warnings = state.built?.warnings.length ?? 0;
  const cells: string[] = [];
  cells.push(`<span><span class="dot ${state.busy ? "busy" : ""}"></span>${state.busy ? "rebuilding" : "ready"}</span>`);
  if (s) {
    cells.push(`<span>roads <b>${s.roads}</b></span>`, `<span>junctions <b>${s.junctions}</b></span>`, `<span>bridges <b>${s.bridgeSpans}</b></span>`);
    cells.push(`<span>level x <b>${s.levelCrossings}</b></span>`, `<span>grade x <b>${s.gradeCrossings}</b></span>`, `<span>length <b>${round(s.lengthKm, 1)} km</b></span>`);
    cells.push(`<span>tris <b>${(s.triangles / 1000).toFixed(0)}k</b></span>`, `<span>build <b>${Math.round(s.buildMs)} ms</b></span>`);
  }
  cells.push(`<span class="grow"></span>`, `<span>speed <b>${Math.round(viewport?.fly.speed ?? 0)} m/s</b></span>`);
  if (warnings) cells.push(`<span class="warn">${warnings} topology warnings</span>`);
  statusBar.innerHTML = cells.join("");
}

function renderHud(): void {
  const toolName = state.tool === "select" ? "Select" : state.tool === "draw" ? "Draw road" : "Place prop";
  const draft = roadById(state.draft);
  hud.replaceChildren(
    h("div", { class: "chip" }, "Tool ", h("b", { text: toolName }), draft ? ` · drawing ${draft.points.length} pts` : ""),
    h("div", { class: "chip", text: "RMB look · WASD move · Q/E height · Shift boost · Ctrl Z undo" })
  );
}

function renderShell(): void {
  renderLeft();
  renderInspector();
  renderStatus();
  renderHud();
}

// ---------- input wiring ----------

function wireCanvas(): void {
  const canvas = viewport.renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (state.tool === "select") {
      const hit = pickAt(e.clientX, e.clientY);
      if (!hit) {
        state.selRoad = null;
        state.selProp = null;
        state.selPoint = null;
        refreshAll(false);
        return;
      }
      if (hit.kind === "point") {
        state.selRoad = hit.road;
        state.selProp = null;
        state.selPoint = hit.index;
        drag = { road: hit.road, index: hit.index, before: JSON.stringify(state.project), moved: false };
        canvas.setPointerCapture(e.pointerId);
      } else if (hit.kind === "road") {
        state.selRoad = hit.road;
        state.selProp = null;
        state.selPoint = null;
      } else {
        state.selProp = hit.prop;
        state.selRoad = null;
      }
      refreshAll(false);
      return;
    }
    const g = viewport.pickGround(e.clientX, e.clientY);
    if (!g) return;
    if (state.tool === "draw") addDraftPoint(g);
    else placeProp(g);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const g = viewport.pickGround(e.clientX, e.clientY);
      const road = state.project.roads.find((r) => r.id === drag!.road);
      if (g && road) {
        const p = road.points[drag.index];
        p.x = g.x;
        p.z = g.z;
        drag.moved = true;
        drawOverlay();
      }
      return;
    }
    if (state.tool === "draw" || state.tool === "prop") {
      const g = viewport.pickGround(e.clientX, e.clientY);
      ghost = g;
      drawOverlay();
    }
  });
  canvas.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    undoStack.push(d.before);
    redoStack.length = 0;
    refreshAll(true);
  });
  canvas.addEventListener("dblclick", () => {
    if (state.tool === "draw" && state.draft) finishDraft(true);
  });
}

function wireKeys(): void {
  window.addEventListener("keydown", (e) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === "KeyZ" && !e.shiftKey) return (e.preventDefault(), undo());
    if (mod && ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY")) return (e.preventDefault(), redo());
    if (mod && e.code === "KeyD") return (e.preventDefault(), duplicateRoad());
    if (mod) return;
    switch (e.code) {
      case "KeyV":
        return setTool("select");
      case "KeyB":
        return setTool("draw");
      case "KeyP":
        return setTool("prop");
      case "KeyF":
        return frameSelection();
      case "KeyR": {
        const prop = state.project.props.find((p) => p.id === state.selProp);
        if (prop) edit((p) => (p.props.find((x) => x.id === prop.id)!.yaw += Math.PI / 12));
        return;
      }
      case "Enter":
      case "Escape":
        if (state.draft) return finishDraft(e.code === "Enter");
        if (e.code === "Escape") {
          state.selRoad = null;
          state.selProp = null;
          refreshAll(false);
        }
        return;
      case "Backspace":
        if (state.draft) {
          const road = roadById(state.draft);
          if (road && road.points.length > 0) {
            road.points.pop();
            drawOverlay();
            renderHud();
          }
          return;
        }
        return deleteSelection();
      case "Delete":
        return deleteSelection();
    }
  });
}

function boot(): void {
  viewport = new Viewport(document.getElementById("viewport") as HTMLElement);
  renderShell();
  wireCanvas();
  wireKeys();
  viewport.start(() => {
    if (state.busy) return;
    if (state.tool === "select") return;
  });
  generate(state.seed);
  window.addEventListener("beforeunload", (e) => {
    if (state.draft) e.preventDefault();
  });
  // Keep the status line's camera speed fresh without rebuilding every frame.
  window.setInterval(renderStatus, 400);
}

boot();
