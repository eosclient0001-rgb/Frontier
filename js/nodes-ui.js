// Frontier SDF — node editor canvas (pan/zoom, drag, wire, add-menu).

import { NODE_DEFS, CATS } from "./graph.js?v=4";
import { el, clamp } from "./util.js?v=4";

export class NodeEditor {
  constructor(root, graph, opts = {}) {
    this.root = root;
    this.graph = graph;
    this.opts = opts;
    this.cam = { x: 40, y: 30, k: 0.9 };
    this.selected = null;
    this.chain = new Set();
    this.sockPos = new Map(); // nodeId -> {in:{sock:{x,y}}, out:{x,y}}
    this.wireDrag = null;
    this.build();
    this.refresh();
  }

  build() {
    this.root.innerHTML = "";
    this.world = el("div", "node-world");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("node-wires");
    this.layer = el("div", "node-layer");
    this.world.append(this.svg, this.layer);
    this.root.append(this.world);
    this.applyCam();

    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root || e.target === this.world || e.target === this.svg || e.target === this.layer) {
        this.startPan(e);
      }
    });
    this.root.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k0 = this.cam.k;
      const k1 = clamp(k0 * Math.pow(1.0015, -e.deltaY), 0.3, 1.6);
      this.cam.x = mx - ((mx - this.cam.x) / k0) * k1;
      this.cam.y = my - ((my - this.cam.y) / k0) * k1;
      this.cam.k = k1;
      this.applyCam();
      this.opts.onZoom?.(k1);
    }, { passive: false });
    this.root.addEventListener("dblclick", (e) => {
      if (e.target === this.root || e.target === this.world || e.target === this.svg || e.target === this.layer) {
        const r = this.root.getBoundingClientRect();
        this.openAddMenu(e.clientX, e.clientY, (r.left ? { x: (e.clientX - r.left - this.cam.x) / this.cam.k, y: (e.clientY - r.top - this.cam.y) / this.cam.k } : { x: 100, y: 100 }));
      }
    });
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selected && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) {
        const n = this.graph.byId(this.selected);
        if (n && n.type !== "output") {
          this.graph.removeNode(this.selected);
          this.selected = null;
          this.opts.onSelect?.(null);
          this.refresh();
        }
      }
    });
  }

  applyCam() {
    this.world.style.transform = `translate(${this.cam.x}px, ${this.cam.y}px) scale(${this.cam.k})`;
  }

  toWorld(cx, cy) {
    const r = this.root.getBoundingClientRect();
    return { x: (cx - r.left - this.cam.x) / this.cam.k, y: (cy - r.top - this.cam.y) / this.cam.k };
  }

  startPan(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const sx = e.clientX, sy = e.clientY, ox = this.cam.x, oy = this.cam.y;
    const mv = (ev) => { this.cam.x = ox + ev.clientX - sx; this.cam.y = oy + ev.clientY - sy; this.applyCam(); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  summary(n) {
    const def = NODE_DEFS[n.type];
    return def.params.slice(0, 3).map((d) => {
      const v = n.params[d.k];
      if (d.type === "select") return d.options[v];
      if (d.type === "vec3") return `[${v.map((x) => (+x).toFixed(1)).join(",")}]`;
      if (d.type === "int") return `${v}`;
      return (+v).toFixed(2);
    }).join(" · ");
  }

  refresh() {
    this.layer.innerHTML = "";
    this.svg.innerHTML = "";
    this.sockPos.clear();
    for (const n of this.graph.nodes) {
      const def = NODE_DEFS[n.type];
      const nd = el("div", `gnode cat-${def.cat.toLowerCase()}${this.selected === n.id ? " sel" : ""}${n.enabled === false ? " off" : ""}`);
      nd.style.left = n.x + "px";
      nd.style.top = n.y + "px";
      nd.dataset.id = n.id;
      const bypassed = def.erosionKind !== undefined && n.enabled !== false && !this.chain.has(n.id);
      nd.innerHTML = `
        <div class="gn-head"><span class="gn-icon">${def.icon}</span><span class="gn-title">${def.title}</span>
        <button class="gn-eye" title="enable/bypass">${n.enabled === false ? "◌" : "●"}</button></div>
        <div class="gn-sum">${this.summary(n)}</div>
        ${bypassed ? `<div class="gn-warn">bypassed — not in chain</div>` : ""}
        <div class="gn-socks"></div>`;
      const socks = nd.querySelector(".gn-socks");
      for (const s of def.inputs) {
        const so = el("div", "sock in", `<i data-sock="${s.id}"></i><span>${s.label}</span>`);
        so.dataset.sock = s.id;
        socks.append(so);
      }
      if (def.outputs.length) {
        const so = el("div", "sock out", `<span>${def.outputs[0].label}</span><i data-sock="out"></i>`);
        socks.append(so);
      }
      this.layer.append(nd);
      // drag node
      nd.querySelector(".gn-head").addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("gn-eye")) return;
        e.stopPropagation();
        this.select(n.id);
        const start = this.toWorld(e.clientX, e.clientY);
        const ox = n.x, oy = n.y;
        const mv = (ev) => {
          const w = this.toWorld(ev.clientX, ev.clientY);
          n.x = Math.round(start ? ox + w.x - start.x : ox);
          n.y = Math.round(oy + w.y - start.y);
          nd.style.left = n.x + "px";
          nd.style.top = n.y + "px";
          this.drawWires();
        };
        const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); this.graph.emit("layout"); };
        window.addEventListener("pointermove", mv);
        window.addEventListener("pointerup", up);
      });
      nd.querySelector(".gn-eye").addEventListener("click", (e) => {
        e.stopPropagation();
        n.enabled = n.enabled === false ? true : false;
        this.graph.emit("structure");
        this.refresh();
      });
      nd.addEventListener("pointerdown", (e) => { if (e.button === 0) this.select(n.id); });
      // socket wiring
      for (const dot of nd.querySelectorAll("i[data-sock]")) {
        dot.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const sock = dot.dataset.sock;
          if (sock === "out") {
            this.wireDrag = { f: n.id, x: e.clientX, y: e.clientY };
          } else {
            // drag from input: move existing wire or start new
            const l = this.graph.inputLink(n.id, sock);
            this.wireDrag = { f: l ? l.f : null, t: n.id, ts: sock, x: e.clientX, y: e.clientY };
            if (l) this.graph.disconnect(n.id, sock);
          }
          this.drawWires();
        });
        dot.addEventListener("pointerup", (e) => {
          e.stopPropagation();
          if (!this.wireDrag) return;
          const sock = dot.dataset.sock;
          if (this.wireDrag.f && sock !== "out") {
            this.graph.connect(this.wireDrag.f, n.id, sock);
          }
          this.wireDrag = null;
          this.refresh();
        });
      }
    }
    this.measure();
    this.drawWires();
  }

  measure() {
    for (const nd of this.layer.children) {
      const id = +nd.dataset.id;
      const entry = { in: {}, out: null };
      for (const row of nd.querySelectorAll(".sock")) {
        const dot = row.querySelector("i");
        const x = +nd.style.left.replace("px", "") + dot.offsetLeft + dot.offsetWidth / 2;
        const y = +nd.style.top.replace("px", "") + dot.offsetTop + dot.offsetHeight / 2;
        if (row.classList.contains("in")) entry.in[row.dataset.sock] = { x, y };
        else entry.out = { x, y };
      }
      this.sockPos.set(id, entry);
    }
  }

  wirePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  drawWires() {
    this.measure();
    const NS = "http://www.w3.org/2000/svg";
    this.svg.innerHTML = "";
    for (const l of this.graph.links) {
      const a = this.sockPos.get(l.f)?.out;
      const b = this.sockPos.get(l.t)?.in[l.ts];
      if (!a || !b) continue;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", this.wirePath(a, b));
      p.setAttribute("class", "wire");
      p.addEventListener("pointerdown", (e) => {
        if (e.altKey || e.detail === 2) { this.graph.disconnect(l.t, l.ts); this.refresh(); }
      });
      const title = document.createElementNS(NS, "title");
      title.textContent = "double-click to delete";
      p.append(title);
      this.svg.append(p);
    }
    if (this.wireDrag?.f) {
      const a = this.sockPos.get(this.wireDrag.f)?.out;
      if (a) {
        const w = this.toWorld(this.wireDrag.x, this.wireDrag.y);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", this.wirePath(a, w));
        p.setAttribute("class", "wire drag");
        this.svg.append(p);
      }
    }
  }

  onMove(e) {
    if (this.wireDrag) {
      this.wireDrag.x = e.clientX; this.wireDrag.y = e.clientY;
      this.drawWires();
    }
  }

  onUp() {
    if (this.wireDrag) { this.wireDrag = null; this.drawWires(); }
  }

  select(id) {
    this.selected = id;
    for (const nd of this.layer.children) nd.classList.toggle("sel", +nd.dataset.id === id);
    this.opts.onSelect?.(id);
  }

  setChain(chain) { this.chain = chain; }

  openAddMenu(cx, cy, at) {
    document.querySelector(".add-menu")?.remove();
    const m = el("div", "add-menu");
    for (const cat of CATS) {
      m.append(el("div", "add-cat", cat));
      for (const [type, def] of Object.entries(NODE_DEFS)) {
        if (def.cat !== cat) continue;
        const b = el("button", "add-item", `<span>${def.icon}</span> ${def.title}`);
        b.title = def.desc;
        b.addEventListener("click", () => {
          const n = this.graph.addNode(type, at.x - 100, at.y - 30);
          m.remove();
          this.select(n.id);
          this.refresh();
        });
        m.append(b);
      }
    }
    m.style.left = Math.max(8, Math.min(cx, window.innerWidth - 250)) + "px";
    m.style.top = Math.max(50, Math.min(cy, window.innerHeight - 330)) + "px";
    document.body.append(m);
    const close = (e) => { if (!m.contains(e.target)) { m.remove(); window.removeEventListener("pointerdown", close); } };
    setTimeout(() => window.addEventListener("pointerdown", close), 10);
  }

  autoLayout() {
    const depth = new Map();
    const getDepth = (id) => {
      if (depth.has(id)) return depth.get(id);
      const ins = this.graph.links.filter((l) => l.t === id);
      const d = ins.length ? Math.max(...ins.map((l) => getDepth(l.f))) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    for (const n of this.graph.nodes) getDepth(n.id);
    const layers = new Map();
    for (const n of this.graph.nodes) {
      const d = depth.get(n.id);
      if (!layers.has(d)) layers.set(d, []);
      layers.get(d).push(n);
    }
    for (const [d, arr] of layers) {
      arr.forEach((n, i) => { n.x = 60 + d * 270; n.y = 70 + i * 180; });
    }
    this.graph.emit("layout");
    this.refresh();
    this.fitView();
  }

  fitView() {
    if (!this.graph.nodes.length) return;
    const xs = this.graph.nodes.map((n) => n.x), ys = this.graph.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 60, y0 = Math.min(...ys) - 60;
    const x1 = Math.max(...xs) + 280, y1 = Math.max(...ys) + 200;
    const r = this.root.getBoundingClientRect();
    const k = clamp(Math.min(r.width / (x1 - x0), r.height / (y1 - y0)), 0.3, 1.2);
    this.cam.k = k;
    this.cam.x = (r.width - (x1 - x0) * k) / 2 - x0 * k;
    this.cam.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
    this.applyCam();
    this.opts.onZoom?.(k);
  }
}
