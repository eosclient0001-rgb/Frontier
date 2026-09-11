// Frontier SDF — node graph model, Gaea-style node set, GLSL compiler, presets.
// The graph compiles to a single GLSL `baseField(vec3 p)` function which the GPU
// evaluates once per voxel to build the base SDF volume. Erosion nodes in the
// chain configure the live particle simulation (they pass the field through).

const F = (k, label, min, max, step, def) => ({ k, label, min, max, step, def });
const V3 = (k, label, def, min = -24, max = 24) => ({ k, label, type: "vec3", def, min, max });
const SEL = (k, label, options, def = 0) => ({ k, label, type: "select", options, def });
const INT = (k, label, min, max, def) => ({ k, label, type: "int", min, max, def });

export const NODE_DEFS = {
  output: { title: "Terrain Output", icon: "◉", cat: "Output", desc: "Final SDF handed to the simulator and renderer.", inputs: [{ id: "in", label: "field" }], outputs: [], params: [] },

  plot: { title: "Land Plot", icon: "▦", cat: "Sources", desc: "Bevelled box landmass — the usual graph root.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [F("width", "Width", 8, 48, 0.5, 40), F("length", "Length", 8, 44, 0.5, 36), F("height", "Top height", -2, 18, 0.1, 3.0), F("base", "Base", -6, 6, 0.1, -2.0), F("bevel", "Bevel", 0, 3, 0.05, 0.5), V3("pos", "Position", [0, 0, 0]), F("rotY", "Rotate Y°", -180, 180, 1, 0)] },
  sphere: { title: "Sphere", icon: "●", cat: "Sources", desc: "Solid sphere with optional surface roughness.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("center", "Center", [0, 6, 0]), F("radius", "Radius", 0.5, 16, 0.1, 6), F("rough", "Roughness", 0, 3, 0.05, 0), F("rscale", "Rough scale", 0.1, 3, 0.05, 0.8), INT("seed", "Seed", 0, 99, 3)] },
  box: { title: "Box", icon: "■", cat: "Sources", desc: "Rounded box primitive.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("center", "Center", [0, 4, 0]), V3("size", "Size", [8, 5, 8], 0.5, 30), F("bevel", "Bevel", 0, 3, 0.05, 0.5), F("rough", "Roughness", 0, 3, 0.05, 0), F("rscale", "Rough scale", 0.1, 3, 0.05, 0.8), INT("seed", "Seed", 0, 99, 5)] },
  torus: { title: "Torus", icon: "◎", cat: "Sources", desc: "Ring — subtract it for arches and tunnels.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("center", "Center", [0, 4, 0]), F("R", "Ring radius", 1, 16, 0.1, 6), F("r", "Tube radius", 0.3, 8, 0.1, 2), SEL("axis", "Axis", ["Y (flat ring)", "Z (standing ring)"], 0), F("rough", "Roughness", 0, 3, 0.05, 0), INT("seed", "Seed", 0, 99, 7)] },
  cylinder: { title: "Cylinder", icon: "▮", cat: "Sources", desc: "Capped cylinder — mesas and sea stacks.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("center", "Center", [0, 5, 0]), F("r", "Radius", 0.5, 14, 0.1, 4), F("h", "Height", 0.5, 24, 0.1, 10), F("rough", "Roughness", 0, 3, 0.05, 0), INT("seed", "Seed", 0, 99, 9)] },
  capsule: { title: "Capsule", icon: "⬯", cat: "Sources", desc: "Capsule between two points.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("a", "Point A", [-6, 4, 0]), V3("b", "Point B", [6, 4, 0]), F("r", "Radius", 0.3, 10, 0.1, 2.5), F("rough", "Roughness", 0, 3, 0.05, 0), INT("seed", "Seed", 0, 99, 11)] },
  ridge: { title: "Ridge", icon: "⛰", cat: "Sources", desc: "Mountain ridge with tapered ends.", inputs: [], outputs: [{ id: "out", label: "field" }], params: [V3("center", "Center", [0, 0, 0]), F("height", "Height", 1, 22, 0.1, 10), F("width", "Width", 1, 20, 0.1, 7), F("length", "Length", 4, 48, 0.5, 34), F("angle", "Angle°", -90, 90, 1, 0), F("rough", "Roughness", 0, 4, 0.05, 1.2), INT("seed", "Seed", 0, 99, 13)] },

  fbm: { title: "Noise Detail", icon: "≋", cat: "Modify", desc: "fBm / ridged / billow displacement.", inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("amount", "Amount", 0, 8, 0.05, 2.0), F("scale", "Scale", 0.02, 1.5, 0.01, 0.16), INT("octaves", "Octaves", 1, 6, 4), SEL("ntype", "Noise type", ["fBm", "Ridged", "Billow"], 0), INT("seed", "Seed", 0, 99, 21)] },
  terrace: { title: "Terrace", icon: "☰", cat: "Modify", desc: "Quantize Y for strata benches.", inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("height", "Step height", 0.3, 6, 0.1, 1.6), F("strength", "Strength", 0, 1, 0.01, 0.6)] },
  warp: { title: "Domain Warp", icon: "🌀", cat: "Modify", desc: "Warp space with fBm before sampling.", inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("amount", "Amount", 0, 10, 0.05, 3.0), F("scale", "Scale", 0.02, 1.0, 0.01, 0.12), INT("octaves", "Octaves", 1, 5, 3), INT("seed", "Seed", 0, 99, 31)] },
  caves: { title: "Cave Worms", icon: "🕳", cat: "Modify", desc: "Carve tunnel networks (true 3D caves).", inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("scale", "Scale", 0.03, 0.6, 0.005, 0.11), F("width", "Tunnel width", 0.01, 0.3, 0.005, 0.07), INT("seed", "Seed", 0, 99, 41), F("yMin", "Floor Y", -6, 10, 0.5, -3), F("yMax", "Ceiling Y", 0, 20, 0.5, 12)] },

  union: { title: "Union", icon: "∪", cat: "Combine", desc: "Merge two fields (optional smooth blend).", inputs: [{ id: "a", label: "A" }, { id: "b", label: "B" }], outputs: [{ id: "out", label: "field" }], params: [F("smooth", "Smooth blend", 0, 4, 0.05, 0)] },
  subtract: { title: "Subtract", icon: "−", cat: "Combine", desc: "Cut B out of A — arches, tunnels, notches.", inputs: [{ id: "a", label: "solid" }, { id: "b", label: "cutter" }], outputs: [{ id: "out", label: "field" }], params: [F("smooth", "Smooth edge", 0, 4, 0.05, 0)] },
  intersect: { title: "Intersect", icon: "∩", cat: "Combine", desc: "Keep the overlap of A and B.", inputs: [{ id: "a", label: "A" }, { id: "b", label: "B" }], outputs: [{ id: "out", label: "field" }], params: [F("smooth", "Smooth edge", 0, 4, 0.05, 0)] },
  transform: { title: "Transform", icon: "✥", cat: "Combine", desc: "Move / rotate-Y / scale a field.", inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [V3("move", "Translate", [0, 0, 0], -24, 24), F("rotY", "Rotate Y°", -180, 180, 1, 0), F("scale", "Scale", 0.2, 3, 0.01, 1)] },

  hydraulic: { title: "Rain Erosion", icon: "🌧", cat: "Erosion", desc: "Droplet rain + runoff. Passes field through; drives the live sim.", erosionKind: 0, inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("intensity", "Intensity", 0, 1, 0.01, 0.7), F("capacity", "Capacity", 0.1, 2, 0.01, 0.6), F("detach", "Detach", 0.1, 2, 0.01, 0.8), F("deposit", "Deposit", 0.1, 2, 0.01, 0.8), F("evap", "Evaporation", 0.2, 2.5, 0.01, 1.0), F("dropSize", "Drop size mm", 0.5, 6, 0.1, 2.5), F("footprint", "Footprint", 0.25, 1.5, 0.01, 0.8)] },
  river: { title: "River", icon: "🌊", cat: "Erosion", desc: "Guided stream from an inlet, carving downhill.", erosionKind: 1, inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("intensity", "Intensity", 0, 1, 0.01, 0.8), F("inletX", "Inlet X", -22, 22, 0.1, 0), F("inletZ", "Inlet Z", -20, 20, 0.1, -14), F("dirX", "Flow dir X", -1, 1, 0.01, 0), F("dirZ", "Flow dir Z", -1, 1, 0.01, 1), F("width", "Width", 1, 7, 0.1, 3), F("speed", "Speed", 1, 8, 0.1, 3.5), F("detach", "Scour", 0.1, 2, 0.01, 1.0)] },
  wind: { title: "Wind", icon: "💨", cat: "Erosion", desc: "Saltating sand: windward abrasion, lee dunes.", erosionKind: 2, inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("intensity", "Intensity", 0, 1, 0.01, 0.5), F("dirDeg", "Direction°", 0, 360, 1, 90), F("speed", "Speed", 2, 12, 0.1, 6), F("height", "Height", 2, 16, 0.1, 8), F("spread", "Spread", 1, 8, 0.1, 3), F("grain", "Grain mm", 0.05, 0.6, 0.01, 0.15), F("abrasion", "Abrasion", 0.1, 2, 0.01, 1.0)] },
  thermal: { title: "Thermal / Talus", icon: "⛰", cat: "Erosion", desc: "Rockfall off steep slopes, talus cones below.", erosionKind: 3, inputs: [{ id: "in", label: "field" }], outputs: [{ id: "out", label: "field" }], params: [F("intensity", "Intensity", 0, 1, 0.01, 0.6), F("repose", "Repose angle°", 22, 48, 0.5, 34), F("rate", "Rate", 0.1, 2, 0.01, 1.0), F("rest", "Restitution", 0, 0.5, 0.01, 0.12)] },
};

export const CATS = ["Sources", "Modify", "Combine", "Erosion", "Output"];

// ---------- graph model ----------

let nextId = 1;
export function defaultParams(type) {
  const p = {};
  for (const d of NODE_DEFS[type].params) {
    p[d.k] = Array.isArray(d.def) ? [...d.def] : d.def;
  }
  return p;
}

export function makeNode(type, x = 60, y = 60) {
  return { id: nextId++, type, x, y, enabled: true, params: defaultParams(type) };
}

export class Graph {
  constructor() {
    this.nodes = [];
    this.links = []; // {f, t, ts}
    this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind); }
  byId(id) { return this.nodes.find((n) => n.id === id); }
  inputLink(toId, sock) { return this.links.find((l) => l.t === toId && l.ts === sock); }
  addNode(type, x, y) {
    const n = makeNode(type, x, y);
    this.nodes.push(n);
    this.emit("structure");
    return n;
  }
  removeNode(id) {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.links = this.links.filter((l) => l.f !== id && l.t !== id);
    this.emit("structure");
  }
  connect(f, t, ts) {
    if (f === t) return false;
    if (!this.byId(f) || !this.byId(t)) return false;
    this.links = this.links.filter((l) => !(l.t === t && l.ts === ts));
    if (this.links.some((l) => l.f === f && l.t === t && l.ts === ts)) return true;
    this.links.push({ f, t, ts });
    if (this.hasCycle()) {
      this.links = this.links.filter((l) => !(l.f === f && l.t === t && l.ts === ts));
      return false;
    }
    this.emit("structure");
    return true;
  }
  disconnect(t, ts) {
    this.links = this.links.filter((l) => !(l.t === t && l.ts === ts));
    this.emit("structure");
  }
  hasCycle() {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(this.nodes.map((n) => [n.id, WHITE]));
    const adj = new Map(this.nodes.map((n) => [n.id, []]));
    for (const l of this.links) adj.get(l.t).push(l.f);
    const visit = (id) => {
      color.set(id, GRAY);
      for (const m of adj.get(id) || []) {
        if (color.get(m) === GRAY) return true;
        if (color.get(m) === WHITE && visit(m)) return true;
      }
      color.set(id, BLACK);
      return false;
    };
    return this.nodes.some((n) => color.get(n.id) === WHITE && visit(n.id));
  }
  outputNode() { return this.nodes.find((n) => n.type === "output"); }
  chainSet() {
    const out = this.outputNode();
    const set = new Set();
    if (!out) return set;
    const walk = (id) => {
      if (set.has(id)) return;
      set.add(id);
      for (const l of this.links.filter((x) => x.t === id)) walk(l.f);
    };
    walk(out.id);
    return set;
  }
  serialize() {
    return {
      app: "frontier-sdf",
      version: 1,
      nextId,
      nodes: this.nodes.map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y), enabled: n.enabled, params: n.params })),
      links: this.links.map((l) => ({ ...l })),
    };
  }
  deserialize(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error("Not a Frontier graph file.");
    nextId = data.nextId || 1000;
    this.nodes = [];
    for (const s of data.nodes) {
      if (!NODE_DEFS[s.type]) continue;
      const n = { id: s.id, type: s.type, x: s.x || 60, y: s.y || 60, enabled: s.enabled !== false, params: { ...defaultParams(s.type), ...(s.params || {}) } };
      this.nodes.push(n);
      if (n.id >= nextId) nextId = n.id + 1;
    }
    this.links = (data.links || []).filter((l) => this.byId(l.f) && this.byId(l.t));
    this.emit("structure");
  }
}

// ---------- GLSL compiler ----------

const gl = (v) => Number(v).toFixed(4);
const glv3 = (v) => `vec3(${gl(v[0])}, ${gl(v[1])}, ${gl(v[2])})`;
const fni = (id) => `nd${id}`;

function emitNode(n, P, child) {
  // child(sockId) -> GLSL expression string for that input, or null
  const T = n.type;
  const rough = (seedK) => {
    if (!(P.rough > 0.001)) return "";
    return `d -= ${gl(P.rough)} * (fbmN(p * ${gl(P.rscale || 0.8)} + vec3(${(P.seed || 0) * 3.1}), ${(P.seed || 0).toFixed(1)}, 3) - 0.5) * 2.0;`;
  };
  switch (T) {
    case "plot": {
      return `float ${fni(n.id)}(vec3 p) {
  vec3 q = p - ${glv3(P.pos)};
  float ca = cos(radians(-(${gl(P.rotY)}))); float sa = sin(radians(-(${gl(P.rotY)})));
  q.xz = mat2(ca, -sa, sa, ca) * q.xz;
  float bev = min(${gl(P.bevel)}, min(${gl(P.width)} * 0.5, min(${gl(P.length)} * 0.5, (${gl(P.height)} - (${gl(P.base)})) * 0.5)) * 0.9);
  float d = sdRoundBox(vec3(q.x, q.y - ((${gl(P.height)}) + (${gl(P.base)})) * 0.5, q.z),
    vec3(${gl(P.width)} * 0.5 - bev, ((${gl(P.height)}) - (${gl(P.base)})) * 0.5 - bev, ${gl(P.length)} * 0.5 - bev), bev);
  return d;
}`;
    }
    case "sphere":
      return `float ${fni(n.id)}(vec3 p) { vec3 q = p - ${glv3(P.center)}; float d = sdSphere(q, ${gl(P.radius)}); ${rough()} return d; }`;
    case "box":
      return `float ${fni(n.id)}(vec3 p) { vec3 q = p - ${glv3(P.center)}; float d = sdRoundBox(q, ${glv3(P.size)} * 0.5 - vec3(${gl(P.bevel)}), ${gl(P.bevel)}); ${rough()} return d; }`;
    case "torus": {
      const fn = P.axis === 1 ? "sdTorusZ" : "sdTorusY";
      return `float ${fni(n.id)}(vec3 p) { vec3 q = p - ${glv3(P.center)}; float d = ${fn}(q, ${gl(P.R)}, ${gl(P.r)}); ${rough()} return d; }`;
    }
    case "cylinder":
      return `float ${fni(n.id)}(vec3 p) { vec3 q = p - ${glv3(P.center)}; float d = sdCylinder(q, ${gl(P.r)}, ${gl(P.h)}); ${rough()} return d; }`;
    case "capsule":
      return `float ${fni(n.id)}(vec3 p) { float d = sdCapsule(p, ${glv3(P.a)}, ${glv3(P.b)}, ${gl(P.r)}); ${rough()} return d; }`;
    case "ridge":
      return `float ${fni(n.id)}(vec3 p) {
  vec3 q = p - ${glv3(P.center)};
  float ca = cos(radians(-(${gl(P.angle)}))); float sa = sin(radians(-(${gl(P.angle)})));
  q.xz = mat2(ca, -sa, sa, ca) * q.xz;
  float ends = 1.0 - smoothstep(0.65, 1.0, abs(q.z) / max(${gl(P.length)} * 0.5, 0.01));
  float lat = q.x / max(${gl(P.width)}, 0.01);
  float top = ${gl(P.height)} * exp(-lat * lat) * ends;
  float d = q.y - top; ${rough()} return d;
}`;
    case "fbm": {
      const c = child("in");
      const fn = P.ntype === 1 ? "ridgedN" : P.ntype === 2 ? "billowN" : "fbmN";
      const mid = P.ntype === 1 ? "0.55" : "0.5";
      return `float ${fni(n.id)}(vec3 p) { float d = ${c}; d -= ${gl(P.amount)} * (${fn}(p * ${gl(P.scale)}, ${(P.seed || 0).toFixed(1)}, ${P.octaves | 0}) - ${mid}) * 2.0; return d; }`;
    }
    case "terrace": {
      const c = child("in", "q");
      return `float ${fni(n.id)}(vec3 p) { vec3 q = p; float st = ${gl(P.height)}; float cell = floor(q.y / st) * st + st * 0.5; q.y = mix(q.y, cell, ${gl(P.strength)}); return ${c}; }`;
    }
    case "warp": {
      const c = child("in", "q");
      return `float ${fni(n.id)}(vec3 p) {
  vec3 q = p + ${gl(P.amount)} * (vec3(fbmN(p * ${gl(P.scale)}, ${(P.seed || 0).toFixed(1)}, ${P.octaves | 0}),
    fbmN(p * ${gl(P.scale)} + vec3(5.2, 1.3, 2.8), ${(P.seed || 0).toFixed(1)}, ${P.octaves | 0}),
    fbmN(p * ${gl(P.scale)} + vec3(1.7, 9.2, 4.5), ${(P.seed || 0).toFixed(1)}, ${P.octaves | 0})) - 0.5) * 2.0);
  return ${c}; }`;
    }
    case "caves":
      return `float ${fni(n.id)}(vec3 p) {
  float d = ${child("in")};
  float w = abs(fbmN(p * ${gl(P.scale)}, ${(P.seed || 0).toFixed(1)}, 4) - 0.5);
  float tun = (${gl(P.width)} - w) * 6.0;
  float mask = smoothstep(${gl(P.yMin)} - 2.0, ${gl(P.yMin)} + 1.0, p.y) * (1.0 - smoothstep(${gl(P.yMax)} - 1.0, ${gl(P.yMax)} + 2.0, p.y));
  tun = mix(-1.0, tun, mask);
  return max(d, tun);
}`;
    case "union": {
      const a = child("a"), b = child("b");
      if (!a) return `float ${fni(n.id)}(vec3 p) { return ${b || "100.0"}; }`;
      if (!b) return `float ${fni(n.id)}(vec3 p) { return ${a}; }`;
      return `float ${fni(n.id)}(vec3 p) { return opBlend(${a}, ${b}, ${gl(P.smooth)}); }`;
    }
    case "subtract": {
      const a = child("a"), b = child("b");
      if (!a) return `float ${fni(n.id)}(vec3 p) { return 100.0; }`;
      if (!b) return `float ${fni(n.id)}(vec3 p) { return ${a}; }`;
      return `float ${fni(n.id)}(vec3 p) { return opBlendSub(${a}, ${b}, ${gl(P.smooth)}); }`;
    }
    case "intersect": {
      const a = child("a"), b = child("b");
      if (!a) return `float ${fni(n.id)}(vec3 p) { return ${b || "100.0"}; }`;
      if (!b) return `float ${fni(n.id)}(vec3 p) { return ${a}; }`;
      return `float ${fni(n.id)}(vec3 p) { return opBlendInt(${a}, ${b}, ${gl(P.smooth)}); }`;
    }
    case "transform": {
      const c = child("in", "q");
      return `float ${fni(n.id)}(vec3 p) {
  vec3 q = p - ${glv3(P.move)};
  float ca = cos(radians(-(${gl(P.rotY)}))); float sa = sin(radians(-(${gl(P.rotY)})));
  q.xz = mat2(ca, -sa, sa, ca) * q.xz;
  q /= ${gl(P.scale)};
  return (${c}) * ${gl(P.scale)}; }`;
    }
    case "hydraulic":
    case "river":
    case "wind":
    case "thermal":
      return `float ${fni(n.id)}(vec3 p) { return ${child("in") || "100.0"}; }`;
    default:
      return `float ${fni(n.id)}(vec3 p) { return 100.0; }`;
  }
}

export function compileGraph(graph) {
  const warnings = [];
  const out = graph.outputNode();
  if (!out) return { ok: false, warnings: ["No Terrain Output node — add one from the Erosion/Output menu."], code: "", erosion: [], chain: new Set() };
  const chain = graph.chainSet();
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const l of graph.links.filter((x) => x.t === id)) visit(l.f);
    if (id !== out.id) order.push(graph.byId(id));
  };
  visit(out.id);
  const childOf = (node, sock, arg = "p") => {
    // Follow the wire, transparently bypassing disabled single-input nodes
    // (modifiers / erosion / transform) so disable never breaks the chain.
    let l = graph.inputLink(node.id, sock);
    let guard = 0;
    while (l && guard++ < 64) {
      const src = graph.byId(l.f);
      if (!src) return null;
      if (src.enabled === false) {
        const def = NODE_DEFS[src.type];
        if (def.inputs.length === 1) {
          l = graph.inputLink(src.id, def.inputs[0].id);
          continue;
        }
        return null;
      }
      return `${fni(src.id)}(${arg})`;
    }
    return null;
  };
  const fns = [];
  for (const n of order) {
    if (!n || n.enabled === false) continue;
    const P = { ...defaultParams(n.type), ...n.params };
    const child = (sock, arg) => childOf(n, sock, arg || "p") || "100.0";
    try {
      fns.push(emitNode(n, P, child));
    } catch (e) {
      return { ok: false, warnings: [`Node "${NODE_DEFS[n.type].title}" failed to compile: ${e.message}`], code: "", erosion: [], chain };
    }
  }
  const outLink = graph.inputLink(out.id, "in");
  const outSrc = outLink && graph.byId(outLink.f);
  const baseCall = outSrc && outSrc.enabled !== false ? `${fni(outSrc.id)}(p)` : null;
  if (!baseCall) warnings.push("Terrain Output has no input — showing a flat plot.");
  const code = `${fns.join("\n")}\nfloat baseField(vec3 p) { return ${baseCall || "(p.y - 1.0)"}; }\n`;
  // Erosion config from enabled erosion nodes that are actually in the chain.
  const erosion = [];
  for (const n of order) {
    const def = NODE_DEFS[n.type];
    if (def.erosionKind === undefined || n.enabled === false) continue;
    erosion.push({ kind: def.erosionKind, params: { ...defaultParams(n.type), ...n.params }, id: n.id, title: def.title });
  }
  for (const n of graph.nodes) {
    const def = NODE_DEFS[n.type];
    if (def.erosionKind !== undefined && n.enabled !== false && !chain.has(n.id)) {
      warnings.push(`"${def.title}" is not connected to the output — bypassed.`);
    }
  }
  return { ok: true, warnings, code, erosion, chain };
}

// ---------- presets ----------

function presetGraph(build) {
  const g = new Graph();
  build(g);
  return g.serialize();
}
function N(g, type, x, y, params = {}, enabled = true) {
  const n = g.addNode(type, x, y);
  Object.assign(n.params, params);
  n.enabled = enabled;
  return n;
}
function L(g, f, t, ts = "in") { g.connect(f.id, t.id, ts); }

export const PRESETS = {
  canyon: {
    title: "Canyon Rivers",
    desc: "Ridged plateau, river down the middle, rain + talus.",
    build(g) {
      const plot = N(g, "plot", 60, 200, { width: 44, length: 40, height: 4.5, rough: 0 });
      const fbm = N(g, "fbm", 300, 200, { amount: 5.5, scale: 0.09, octaves: 4, ntype: 1, seed: 7 });
      const terr = N(g, "terrace", 540, 200, { height: 1.8, strength: 0.45 });
      const hyd = N(g, "hydraulic", 780, 120, { intensity: 0.7 });
      const river = N(g, "river", 780, 300, { intensity: 0.85, inletZ: -15, dirZ: 1, width: 3, speed: 3.5 });
      const therm = N(g, "thermal", 1020, 200, { intensity: 0.6 });
      const out = N(g, "output", 1260, 200);
      L(g, plot, fbm); L(g, fbm, terr); L(g, terr, hyd); L(g, hyd, river); L(g, river, therm); L(g, therm, out);
    },
  },
  arch: {
    title: "Sea Arch",
    desc: "Torus subtract carves an arch; wind + rain finish it.",
    build(g) {
      const plot = N(g, "plot", 60, 160, { width: 40, length: 34, height: 2.5 });
      const mesa = N(g, "cylinder", 60, 380, { center: [0, 7, 0], r: 7, h: 12, rough: 0.8, seed: 4 });
      const u = N(g, "union", 300, 260, { smooth: 1.2 });
      const cutter = N(g, "torus", 300, 460, { center: [0, 4.5, 0], R: 5, r: 2.6, axis: 1 });
      const sub = N(g, "subtract", 540, 260, { smooth: 0.4 });
      const fbm = N(g, "fbm", 780, 260, { amount: 1.6, scale: 0.3, octaves: 3, ntype: 0, seed: 9 });
      const wind = N(g, "wind", 1020, 160, { intensity: 0.65, dirDeg: 90, speed: 7 });
      const hyd = N(g, "hydraulic", 1020, 360, { intensity: 0.45 });
      const out = N(g, "output", 1260, 260);
      L(g, plot, u, "a"); L(g, mesa, u, "b"); L(g, u, sub, "a"); L(g, cutter, sub, "b");
      L(g, sub, fbm); L(g, fbm, wind); L(g, wind, hyd); L(g, hyd, out);
    },
  },
  caves: {
    title: "Cave Network",
    desc: "Worm tunnels through a plateau — fly inside.",
    build(g) {
      const plot = N(g, "plot", 60, 200, { width: 44, length: 40, height: 6, base: -3 });
      const fbm = N(g, "fbm", 300, 200, { amount: 3.0, scale: 0.1, octaves: 4, ntype: 0, seed: 12 });
      const cav = N(g, "caves", 540, 200, { scale: 0.1, width: 0.075, seed: 5, yMin: -2, yMax: 9 });
      const hyd = N(g, "hydraulic", 780, 200, { intensity: 0.4 });
      const out = N(g, "output", 1020, 200);
      L(g, plot, fbm); L(g, fbm, cav); L(g, cav, hyd); L(g, hyd, out);
    },
  },
  dunes: {
    title: "Dune Field",
    desc: "Low sand sea, strong wind saltation + slip faces.",
    build(g) {
      const plot = N(g, "plot", 60, 200, { width: 46, length: 42, height: 1.2 });
      const fbm = N(g, "fbm", 300, 200, { amount: 1.8, scale: 0.08, octaves: 3, ntype: 2, seed: 17 });
      const wind = N(g, "wind", 540, 120, { intensity: 0.9, dirDeg: 70, speed: 8, height: 6, spread: 2.5 });
      const therm = N(g, "thermal", 540, 300, { intensity: 0.7, repose: 32 });
      const out = N(g, "output", 780, 200);
      L(g, plot, fbm); L(g, fbm, wind); L(g, wind, therm); L(g, therm, out);
    },
  },
  alpine: {
    title: "Alpine Lake",
    desc: "Ridged peaks, lake plane, river outlet.",
    build(g) {
      const r1 = N(g, "ridge", 60, 120, { center: [-8, -1, 0], height: 15, width: 8, length: 36, angle: 8, rough: 2.2, seed: 3 });
      const r2 = N(g, "ridge", 60, 360, { center: [10, -1, 2], height: 12, width: 7, length: 34, angle: -12, rough: 2.0, seed: 8 });
      const u = N(g, "union", 300, 240, { smooth: 2.0 });
      const plot = N(g, "plot", 60, 560, { width: 46, length: 42, height: 0.5, base: -3 });
      const u2 = N(g, "union", 540, 300, { smooth: 1.5 });
      const hyd = N(g, "hydraulic", 780, 200, { intensity: 0.6 });
      const river = N(g, "river", 780, 380, { intensity: 0.7, inletX: -4, inletZ: -12, dirX: 0.2, dirZ: 1, width: 2.5, speed: 4 });
      const therm = N(g, "thermal", 1020, 290, { intensity: 0.65 });
      const out = N(g, "output", 1260, 290);
      L(g, r1, u, "a"); L(g, r2, u, "b"); L(g, u, u2, "a"); L(g, plot, u2, "b");
      L(g, u2, hyd); L(g, hyd, river); L(g, river, therm); L(g, therm, out);
    },
  },
};

export function buildPreset(key) {
  const p = PRESETS[key];
  if (!p) throw new Error("Unknown preset " + key);
  return presetGraph((g) => p.build(g));
}
