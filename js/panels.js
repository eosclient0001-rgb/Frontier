// Frontier SDF — outliner (left) + inspector (right) panels.

import { NODE_DEFS, CATS } from "./graph.js?v=2";
import { el, fmt } from "./util.js?v=2";

function sliderRow(label, min, max, step, value, onInput, format = (v) => fmt(v, 2)) {
  const row = el("div", "p-row");
  row.innerHTML = `<label>${label}</label>`;
  const wrap = el("div", "p-ctl");
  const range = document.createElement("input");
  range.type = "range"; range.min = min; range.max = max; range.step = step; range.value = value;
  const num = document.createElement("input");
  num.type = "number"; num.className = "pill"; num.min = min; num.max = max; num.step = step; num.value = value;
  range.addEventListener("input", () => { num.value = range.value; onInput(+range.value); });
  num.addEventListener("change", () => {
    let v = +num.value;
    if (isFinite(v)) { v = Math.min(max, Math.max(min, v)); range.value = v; num.value = v; onInput(v); }
  });
  wrap.append(range, num);
  row.append(wrap);
  const val = el("span", "p-val", format(value));
  row.append(val);
  const orig = onInput;
  return { row, sync(v) { range.value = v; num.value = v; val.textContent = format(v); } };
}

function section(title, open = true) {
  const s = el("details", "sect");
  if (open) s.open = true;
  s.innerHTML = `<summary>${title}</summary>`;
  const body = el("div", "sect-body");
  s.append(body);
  return { s, body };
}

// ---------- outliner ----------
export function buildOutliner(root, graph, ui, cb) {
  root.innerHTML = "";
  const head = el("div", "side-head", `<span>Scene</span><span class="cap">OUTLINER</span>`);
  root.append(head);
  const actions = el("div", "side-actions");
  const addBtn = el("button", "btn primary", "+ Add node");
  addBtn.addEventListener("click", (e) => cb.onAddMenu(e.clientX, e.clientY));
  actions.append(addBtn);
  root.append(actions);
  const tree = el("div", "tree");
  for (const cat of CATS) {
    const items = graph.nodes.filter((n) => NODE_DEFS[n.type].cat === cat);
    if (!items.length) continue;
    tree.append(el("div", "tree-cat", cat.toUpperCase()));
    for (const n of items) {
      const def = NODE_DEFS[n.type];
      const row = el("div", `tree-row${ui.selected === n.id ? " sel" : ""}${n.enabled === false ? " off" : ""}`);
      row.innerHTML = `<span class="t-ico">${def.icon}</span><span class="t-name">${def.title}</span>`;
      const eye = el("button", "t-eye", n.enabled === false ? "◌" : "●");
      eye.title = "enable / bypass";
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        n.enabled = n.enabled === false ? true : false;
        graph.emit("structure");
      });
      const del = el("button", "t-del", "×");
      del.title = "delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (n.type !== "output") graph.removeNode(n.id);
      });
      row.append(eye, del);
      row.addEventListener("click", () => cb.onSelect(n.id));
      tree.append(row);
    }
  }
  root.append(tree);
  root.append(el("div", "mono dim", `${graph.nodes.length} NODES`));

  const lay = section("Layers", true);
  const layers = [
    ["terrain", "Terrain"], ["water", "Water + foam"], ["ribbons", "River ribbons"],
    ["particles", "Particles"], ["plumes", "Sediment plumes"],
  ];
  for (const [k, label] of layers) {
    const lab = el("label", "chk", `<input type="checkbox" ${ui.layers[k] ? "checked" : ""}><span>${label}</span>`);
    lab.querySelector("input").addEventListener("change", (e) => cb.onLayer(k, e.target.checked));
    lay.body.append(lab);
  }
  root.append(lay.s);

  const pre = section("Presets", true);
  for (const [key, p] of Object.entries(ui.presets)) {
    const b = el("button", "preset", `<b>${p.title}</b><span>${p.desc}</span>`);
    b.addEventListener("click", () => cb.onPreset(key));
    pre.body.append(b);
  }
  root.append(pre.s);
}

// ---------- inspector ----------
export function buildInspector(root, graph, ui, S, cb) {
  root.innerHTML = "";
  root.append(el("div", "side-head", `<span>Inspector</span><span class="cap">PROPERTIES</span>`));
  const node = ui.selected ? graph.byId(ui.selected) : null;
  if (node) {
    const def = NODE_DEFS[node.type];
    const box = el("div", "node-card");
    box.innerHTML = `<div class="nc-head"><span class="nc-ico">${def.icon}</span><div><b>${def.title}</b><span>${def.cat} · #${node.id}</span></div></div><p class="nc-desc">${def.desc}</p>`;
    const enRow = el("label", "chk", `<input type="checkbox" ${node.enabled !== false ? "checked" : ""}><span>Enabled in chain</span>`);
    enRow.querySelector("input").addEventListener("change", (e) => {
      node.enabled = e.target.checked;
      graph.emit("structure");
    });
    box.append(enRow);
    const btns = el("div", "row2");
    const dup = el("button", "btn", "Duplicate");
    dup.addEventListener("click", () => {
      const c = graph.addNode(node.type, node.x + 40, node.y + 40);
      c.params = JSON.parse(JSON.stringify(node.params));
      graph.emit("structure");
      cb.onSelect(c.id);
    });
    const del = el("button", "btn danger", "Delete");
    del.disabled = node.type === "output";
    del.addEventListener("click", () => { graph.removeNode(node.id); cb.onSelect(null); });
    btns.append(dup, del);
    box.append(btns);
    root.append(box);
    const ps = section("Parameters", true);
    for (const d of def.params) {
      if (d.type === "vec3") {
        const row = el("div", "p-row", `<label>${d.label}</label>`);
        const wrap = el("div", "vec3");
        ["X", "Y", "Z"].forEach((ax, i) => {
          const inp = document.createElement("input");
          inp.type = "number"; inp.className = "pill"; inp.step = "0.1";
          inp.value = node.params[d.k][i];
          inp.title = ax;
          inp.addEventListener("change", () => {
            const v = +inp.value;
            if (isFinite(v)) { node.params[d.k][i] = v; graph.emit("params"); }
          });
          const lab = el("label", "", `${ax} `);
          lab.append(inp);
          wrap.append(lab);
        });
        row.append(wrap);
        ps.body.append(row);
      } else if (d.type === "select") {
        const row = el("div", "p-row", `<label>${d.label}</label>`);
        const sel = document.createElement("select");
        d.options.forEach((o, i) => {
          const op = document.createElement("option");
          op.value = i; op.textContent = o;
          if (i === node.params[d.k]) op.selected = true;
          sel.append(op);
        });
        sel.addEventListener("change", () => { node.params[d.k] = +sel.value; graph.emit("params"); });
        row.append(sel);
        ps.body.append(row);
      } else if (d.type === "int") {
        const { row, sync } = sliderRow(d.label, d.min, d.max, 1, node.params[d.k], (v) => {
          node.params[d.k] = Math.round(v); sync(node.params[d.k]); graph.emit("params");
        }, (v) => `${Math.round(v)}`);
        ps.body.append(row);
      } else {
        const { row, sync } = sliderRow(d.label, d.min, d.max, d.step, node.params[d.k], (v) => {
          node.params[d.k] = v; sync(v); graph.emit("params");
        });
        ps.body.append(row);
      }
    }
    root.append(ps.s);
  } else {
    const box = el("div", "node-card dim", "Select a node in the graph or outliner to edit its parameters.");
    root.append(box);
  }

  // global simulation
  const sm = section("Simulation", true);
  const addS = (label, min, max, step, get, set, f) => {
    const { row, sync } = sliderRow(label, min, max, step, get(), (v) => { set(v); sync(v); }, f);
    sm.body.append(row);
  };
  addS("Speed (steps/frame)", 1, 8, 1, () => S.speed, (v) => cb.onSim({ speed: Math.round(v) }), (v) => `${Math.round(v)}×`);
  addS("Particles", 256, 4096, 256, () => S.particles, (v) => cb.onSim({ particles: Math.round(v) }), (v) => `${Math.round(v)}`);
  addS("Particle size", 0.4, 3, 0.05, () => S.particleSize, (v) => cb.onSim({ particleSize: v }), (v) => `${v.toFixed(2)}×`);
  const runRow = el("div", "row2");
  const stepBtn = el("button", "btn", "Step ×20");
  stepBtn.addEventListener("click", () => cb.onStep(20));
  const resetBtn = el("button", "btn", "Reset sim");
  resetBtn.addEventListener("click", () => cb.onResetSim());
  runRow.append(stepBtn, resetBtn);
  sm.body.append(runRow);
  root.append(sm.s);

  const wt = section("Water", true);
  const addW = (label, min, max, step, get, set, f) => {
    const { row, sync } = sliderRow(label, min, max, step, get(), (v) => { set(v); sync(v); }, f);
    wt.body.append(row);
  };
  addW("Level", -3, 10, 0.05, () => S.waterLevel, (v) => cb.onWater({ waterLevel: v }));
  addW("Clarity (absorption)", 0.1, 2, 0.01, () => S.clarity, (v) => cb.onWater({ clarity: v }));
  addW("Current strength", 0, 3, 0.05, () => S.flowK, (v) => cb.onWater({ flowK: v }));
  addW("Foam amount", 0, 2, 0.05, () => S.foamAmt, (v) => cb.onWater({ foamAmt: v }));
  addW("Foam reach", 0.2, 3, 0.05, () => S.foamReach, (v) => cb.onWater({ foamReach: v }));
  addW("Ripple", 0, 0.6, 0.01, () => S.ripple, (v) => cb.onWater({ ripple: v }));
  root.append(wt.s);

  const rd = section("Render", false);
  const addR = (label, min, max, step, get, set, f) => {
    const { row, sync } = sliderRow(label, min, max, step, get(), (v) => { set(v); sync(v); }, f);
    rd.body.append(row);
  };
  addR("Resolution scale", 0.4, 1, 0.05, () => S.renderScale, (v) => cb.onRender({ renderScale: v }), (v) => `${Math.round(v * 100)}%`);
  addR("March steps", 64, 256, 8, () => S.steps, (v) => cb.onRender({ steps: Math.round(v) }), (v) => `${Math.round(v)}`);
  addR("Sun angle°", 0, 360, 1, () => S.sunAngle, (v) => cb.onRender({ sunAngle: v }), (v) => `${Math.round(v)}°`);
  addR("Sun height°", 5, 80, 1, () => S.sunElev, (v) => cb.onRender({ sunElev: v }), (v) => `${Math.round(v)}°`);
  addR("Haze", 0, 1, 0.01, () => S.haze, (v) => cb.onRender({ haze: v }));
  addR("Strata", 0, 2, 0.05, () => S.strata, (v) => cb.onRender({ strata: v }));
  root.append(rd.s);

  const lg = section("Sediment ledger", true);
  lg.body.append(el("div", "ledger", S.ledgerHTML || "Run the audit to read GPU totals."));
  const ab = el("button", "btn", "Audit sediment balance");
  ab.addEventListener("click", () => cb.onAudit());
  lg.body.append(ab);
  root.append(lg.s);
}
