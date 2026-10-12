/**
 * Frontier Road Editor — viewport.
 *
 * A hand-rolled software renderer on a 2D canvas: no WebGL, no dependency, and the same code path
 * runs the "measure" harness in node. The design follows the native editor's fly camera: WASD to
 * travel, Q/E for altitude, right-drag or arrows to look, shift to sprint — the Unreal-style mapping
 * the project already documents in Docs/ImGuiControlMapping.md.
 *
 * Draw order is painter's-algorithm back to front, in four passes (ground, surfaces, markings,
 * props). Everything is culled twice: once by an axis-aligned bounding box against the view distance,
 * then by the frustum side planes.
 */

const DEG = Math.PI / 180;
const NEAR = 0.6;

/* ── small vector helpers ─────────────────────────────────────────────────────────────────────── */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cameraBasis(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // World Y is up; yaw turns about it, pitch tilts. Right is horizontal, up follows from right x forward.
  const forward = [cp * sy, sp, -cp * cy];
  const right = [cy, 0, sy];
  const up = [-sy * sp, cp, cy * sp];
  return { forward, right, up };
}

/* ── the viewport ─────────────────────────────────────────────────────────────────────────────── */

export function createViewport(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });

  const state = {
    /** Camera pose, metresh and radians, world Y up. */
    cam: { x: 0, y: 34, z: 520, yaw: 0, pitch: -0.22 },
    fov: 62 * DEG,
    speed: 42,
    viewDistance: 1500,
    fogDistance: 1250,
    sky: [116, 138, 160],
    flags: {
      terrain: true,
      markings: true,
      markingsDistant: true,
      details: true,
      kerbs: true,
      structures: true,
      wires: false,
      grid: false,
      minimapRoads: true,
    },
    geometry: null,
    project: null,
    hover: null,
    hoverLabel: null,
    selection: { roadId: null, nodeId: null },
    stats: { drawn: 0, culled: 0, ms: 0, fps: 0 },
    lastFrame: { w: 0, h: 0, focal: 600 },
  };

  /* scratch buffers, reused every frame so a 200k-triangle city does not allocate per frame */
  const view = { cam: null, focal: 1, cx: 0, cy: 0 };
  const drawList = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    lastFrame.w = w;
    lastFrame.h = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.lastFrame.dpr = dpr;
  }
  const lastFrame = state.lastFrame;

  /** Camera-space coordinates of a world point (z is depth in front of the lens). */
  function toView(p, out) {
    const d = sub(p, view.cam.pos);
    out[0] = dot(d, view.cam.right);
    out[1] = dot(d, view.cam.up);
    out[2] = dot(d, view.cam.forward);
    return out;
  }

  /** Clip a polyline/polygon against z = NEAR, in camera space. Returns [] when fully behind. */
  function clipNear(pts, closed) {
    const out = [];
    const n = pts.length;
    if (!n) return out;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const aIn = a[2] >= NEAR;
      const bIn = b[2] >= NEAR;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    if (!closed) {
      const last = pts[n - 1];
      if (last[2] >= NEAR) out.push(last);
    }
    return out;
  }

  function project(v) {
    const z = v[2] === 0 ? 1e-6 : v[2];
    return [view.cx + (view.focal * v[0]) / z, view.cy - (view.focal * v[1]) / z];
  }

  /** Fog: blend a colour toward the sky by distance, so the map reads as a large place. */
  function shade(colour, depth, extra) {
    const f = Math.max(0, Math.min(1, (depth - state.viewDistance * 0.25) / state.fogDistance));
    const k = 1 - f * 0.85;
    const e = extra ?? 1;
    return [
      Math.round(Math.min(255, colour[0] * k * e + state.sky[0] * (1 - k))),
      Math.round(Math.min(255, colour[1] * k * e + state.sky[1] * (1 - k))),
      Math.round(Math.min(255, colour[2] * k * e + state.sky[2] * (1 - k))),
    ];
  }

  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  /** Frustum test: a box is visible when any corner is inside, or the camera is inside it. */
  function boxVisible(bb) {
    if (!bb) return true;
    const cam = view.cam;
    const tanY = Math.tan(state.fov / 2);
    const tanX = tanY * (lastFrame.w / Math.max(1, lastFrame.h));
    const corners = [
      [bb.minX, bb.minY, bb.minZ], [bb.maxX, bb.minY, bb.minZ],
      [bb.minX, bb.maxY, bb.minZ], [bb.maxX, bb.maxY, bb.minZ],
      [bb.minX, bb.minY, bb.maxZ], [bb.maxX, bb.minY, bb.maxZ],
      [bb.minX, bb.maxY, bb.maxZ], [bb.maxX, bb.maxY, bb.maxZ],
    ];
    const pad = 24;
    for (const c of corners) {
      const d = sub(c, cam.pos);
      const z = dot(d, cam.forward);
      if (z < NEAR) continue;
      const x = dot(d, cam.right);
      const y = dot(d, cam.up);
      if (Math.abs(x) <= z * tanX + pad && Math.abs(y) <= z * tanY + pad) return true;
    }
    // The camera may be inside the box (driving through a junction slab): treat that as visible.
    if (bb.minX - 1 < cam.pos[0] && bb.maxX + 1 > cam.pos[0]
      && bb.minZ - 1 < cam.pos[2] && bb.maxZ + 1 > cam.pos[2]
      && bb.minY - 1 < cam.pos[1] && bb.maxY + 1 > cam.pos[1]) return true;
    return false;
  }

  function distToBox(bb) {
    if (!bb) return 0;
    const cam = view.cam.pos;
    const dx = Math.max(bb.minX - cam.x, 0, cam.x - bb.maxX);
    const dz = Math.max(bb.minZ - cam.z, 0, cam.z - bb.maxZ);
    const dy = Math.max(bb.minY - cam.y, 0, cam.y - bb.maxY);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* ── frame ──────────────────────────────────────────────────────────────────────────────────── */

  function render(now = 0) {
    const t0 = performance.now ? performance.now() : Date.now();
    resize();
    const { w, h } = lastFrame;
    const focal = h / 2 / Math.tan(state.fov / 2);
    lastFrame.focal = focal;
    state.tanHalf = Math.tan(state.fov / 2) * (w / h);

    const cam = state.cam;
    const basis = cameraBasis(cam.yaw, cam.pitch);
    view.cam = { pos: [cam.x, cam.y, cam.z], forward: basis.forward, right: basis.right, up: basis.up };
    view.focal = focal;
    view.cx = w / 2;
    view.cy = h / 2;

    // Sky gradient, cheap and far away.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, rgb(shade([86, 106, 132], 0, 1)));
    sky.addColorStop(0.55, rgb(state.sky));
    sky.addColorStop(1, rgb(shade([150, 152, 150], 0, 1)));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const geo = state.geometry;
    let drawn = 0;
    let culled = 0;
    drawList.length = 0;

    if (geo) {
      const score = (entry) => {
        const bb = entry.bb;
        if (!bb) return null;
        const d = distToBox(bb);
        if (d > state.viewDistance) { culled += 1; return null; }
        if (!boxVisible(bb)) { culled += 1; return null; }
        const c = toView([bb.cx, bb.cy, bb.cz], [0, 0, 0]);
        return { entry, depth: c[2], dist: d };
      };

      /* pass 1 — ground and water */
      if (state.flags.terrain) {
        for (const p of geo.polys) {
          if (p.kind !== 'terrain' && p.kind !== 'water') continue;
          const s = score(p);
          if (!s) continue;
          drawList.push(s);
        }
        drawList.sort((a, b) => b.depth - a.depth);
        for (const s of drawList) drawFlatPoly(s.entry, s.depth, s.dist);
        drawList.length = 0;
      }

      /* pass 2 — road, junction and structure surfaces */
      const showKerb = state.flags.kerbs;
      for (const p of geo.polys) {
        if (p.kind === 'terrain' || p.kind === 'water') continue;
        if (p.kind === 'kerb-face' && !showKerb) continue;
        if ((p.kind === 'pier' || p.kind === 'parapet' || p.kind === 'deck-edge') && !state.flags.structures) continue;
        const s = score(p);
        if (!s) continue;
        if (!state.flags.markingsDistant && p.kind === 'marking' && s.dist > 260) { culled += 1; continue; }
        drawList.push(s);
      }
      drawList.sort((a, b) => b.depth - a.depth);
      for (const s of drawList) drawFlatPoly(s.entry, s.depth, s.dist);
      drawn += drawList.length;
      drawList.length = 0;

      /* pass 3 — markings, kerb lines, rails */
      if (state.flags.markings) {
        for (const l of geo.lines) {
          if (l.kind === 'rail' && !state.flags.structures) continue;
          if (l.kind === 'marking' && !state.flags.markings) continue;
          const bb = l.bb;
          const d = distToBox(bb);
          if (d > (l.kind === 'marking' ? state.viewDistance * 0.75 : state.viewDistance)) { culled += 1; continue; }
          if (!boxVisible(bb)) { culled += 1; continue; }
          const c = toView([bb.cx, bb.cy, bb.cz], [0, 0, 0]);
          drawList.push({ entry: l, depth: c[2], dist: d });
        }
        drawList.sort((a, b) => b.depth - a.depth);
        for (const s of drawList) drawLine(s.entry, s.depth, s.dist);
        drawn += drawList.length;
        drawList.length = 0;
      }

      /* pass 4 — vertical objects */
      if (state.flags.details) {
        for (const p of geo.props) {
          const dx = p.x - cam.x;
          const dz = p.z - cam.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > state.viewDistance * 0.55) { culled += 1; continue; }
          const v = toView([p.x, p.y, p.z], [0, 0, 0, 0]);
          if (v[2] < NEAR) { culled += 1; continue; }
          const sp = project(v);
          if (sp[0] < -60 || sp[0] > w + 60 || sp[1] < -160 || sp[1] > h + 60) { culled += 1; continue; }
          drawList.push({ entry: p, depth: v[2], dist: d, sp });
        }
        drawList.sort((a, b) => b.depth - a.depth);
        for (const s of drawList) drawProp(s.entry, s.depth, s.sp);
        drawn += drawList.length;
        drawList.length = 0;
      }

      /* roundabout islands, drawn as live annulus geometry */
      for (const r of geo.rings || []) {
        drawRing(r);
      }

      if (state.flags.grid) drawGrid();

      if (geo.lens) {
        // debug: nothing extra
      }
    }

    // hover readout
    if (state.hoverLabel) {
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,14,0.78)';
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      const label = state.hoverLabel;
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillRect(w / 2 - tw / 2 - 8, 12, tw + 16, 22);
      ctx.strokeRect(w / 2 - tw / 2 - 8, 12, tw + 16, 22);
      ctx.fillStyle = 'rgb(232,236,242)';
      ctx.fillText(label, w / 2 - tw / 2, 27);
      ctx.restore();
    }

    const ms = (performance.now ? performance.now() : Date.now()) - t0;
    state.stats.drawn = drawn;
    state.stats.culled = culled;
    state.stats.ms = ms;
    state.stats.frame = now;
    return state.stats;
  }

  /* ── primitives ─────────────────────────────────────────────────────────────────────────────── */

  function drawFlatPoly(poly, depth, dist) {
    let colour = poly.colour;
    if (poly.kind === 'water') colour = [56, 92, 124];
    if (state.selection?.roadId && (poly.roadId === state.selection.roadId)) colour = [206, 168, 78];
    if (state.selection?.nodeId && poly.nodeId === state.selection.nodeId) colour = [200, 176, 104];
    const v = [];
    for (const p of poly.pts) {
      v.push(toView(p, [0, 0, 0]));
    }
    const clipped = clipNear(v, true);
    if (clipped.length < 3) return;
    const screen = clipped.map(project);
    ctx.beginPath();
    ctx.moveTo(screen[0][0], screen[0][1]);
    for (let i = 1; i < screen.length; i += 1) ctx.lineTo(screen[i][0], screen[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgb(shade(colour, dist));
    ctx.fill();
    if (poly.kind === 'deck-edge' || poly.kind === 'kerb-face') {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawLine(line, depth, dist) {
    const isMark = line.kind === 'marking';
    const fadeIn = isMark ? Math.max(0, Math.min(1, (state.viewDistance * 0.7 - dist) / 220)) : 1;
    if (fadeIn <= 0) return;
    const widthPx = Math.max(0.6, (view.focal * (line.width || 0.15)) / Math.max(6, depth));
    if (!state.flags.markingsDistant && widthPx < 1) return;
    const v = line.pts.map((p) => toView(p, [0, 0, 0]));
    const clipped = clipNear(v, false);
    if (clipped.length < 2) return;
    const pairs = clipped.map((p) => [p, project(p)]);
    const screen = pairs.map((x) => x[1]);
    const colour = state.selection?.roadId && line.roadId === state.selection.roadId ? [240, 200, 90] : line.colour || [200, 200, 200];
    ctx.strokeStyle = rgb(shade(colour, dist));
    ctx.lineWidth = Math.max(0.7, widthPx);
    ctx.lineCap = line.pattern === 'dash' ? 'butt' : 'round';
    ctx.setLineDash([]);
    if (line.pattern === 'dash' && line.pitch) {
      // Dash in world space, then draw segment by segment so perspective shortens the dashes.
      const pitch = line.pitch;
      const duty = line.duty || 0.5;
      let carry = 0;
      ctx.beginPath();
      for (let i = 1; i < pairs.length; i += 1) {
        const a = pairs[i - 1][0];
        const b = pairs[i][0];
        const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]);
        let t = 0;
        while (t < segLen) {
          const phase = (carry + t) % pitch;
          const on = phase < pitch * duty;
          const remain = on ? pitch * duty - phase : pitch - phase;
          const step = Math.min(remain, segLen - t);
          if (on) {
            const t0 = t / segLen;
            const t1 = (t + step) / segLen;
            const pa = pairs[i - 1][1];
            const pb = pairs[i][1];
            ctx.moveTo(pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0);
            ctx.lineTo(pa[0] + (pb[0] - pa[0]) * t1, pa[1] + (pb[1] - pa[1]) * t1);
          }
          t += step;
        }
        carry = (carry + segLen) % pitch;
      }
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(screen[0][0], screen[0][1]);
    for (let i = 1; i < screen.length; i += 1) ctx.lineTo(screen[i][0], screen[i][1]);
    ctx.stroke();
  }

  const PROP_COLOUR = {
    bollard: [188, 190, 194], cone: [216, 108, 52], sign: [198, 200, 204], signal: [38, 40, 44],
    light: [46, 48, 52], tree: [64, 92, 58], bench: [110, 84, 58], bin: [86, 88, 90],
    shelter: [120, 126, 132], 'shelter-roof': [150, 154, 158], 'subway-sign': [30, 96, 168],
    'subway-stair': [96, 98, 100], 'parapet-post': [156, 158, 160], pier: [146, 144, 138],
    'pier-footing': [122, 120, 116], portal: [104, 104, 108], 'tunnel-light': [236, 226, 180],
    sleeper: [96, 78, 62], 'rail-crossing': [220, 220, 220], hump: [140, 140, 130],
    gully: [70, 70, 72], manhole: [78, 78, 80], 'passing-place': [120, 120, 116], signpost: [190, 192, 196],
  };

  function drawProp(prop, depth, sp) {
    const h = prop.h || 1;
    const w = prop.w || 0.4;
    const halfW = Math.max(0.9, (view.focal * w) / Math.max(6, depth) / 2);
    const scale = view.focal / Math.max(6, depth);
    const topY = sp[1] - h * scale;
    const colour = shade(PROP_COLOUR[prop.kind] || prop.colour || [160, 160, 160], depth);
    const sel = Boolean(state.selection?.roadId) && prop.roadId === state.selection.roadId;

    // shadow / contact patch, so objects do not float
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(sp[0], sp[1], halfW * 1.5, Math.max(1, halfW * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = sel ? 'rgb(226,186,96)' : rgb(colour);
    ctx.fillRect(sp[0] - halfW, topY, halfW * 2, sp[1] - topY);
    if (prop.kind === 'sign' || prop.kind === 'signal' || prop.kind === 'subway-sign' || prop.kind === 'light') {
      // a plate or head on top of the post
      const pw = Math.max(1.6, halfW * 2.6);
      const ph = prop.kind === 'light' ? Math.max(1.2, halfW * 1.2) : Math.max(2.2, halfW * 2.4);
      const plateColour = prop.kind === 'signal' ? [26, 28, 30] : prop.kind === 'light' ? [64, 66, 70] : prop.colour || [200, 200, 205];
      ctx.fillStyle = rgb(shade(plateColour, depth));
      ctx.fillRect(sp[0] - pw / 2, topY - ph, pw, ph);
      if (prop.kind === 'signal') {
        ctx.fillStyle = 'rgb(210,180,80)';
        ctx.beginPath();
        ctx.arc(sp[0], topY - ph * 0.5, Math.max(0.8, pw * 0.18), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawRing(ring) {
    const seg = 28;
    const v = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      v.push(toView([ring.cx + Math.cos(a) * ring.r1, ring.y + 0.02, ring.cz + Math.sin(a) * ring.r1], [0, 0, 0]));
    }
    const depth = Math.hypot(ring.cx - state.cam.x, ring.cz - state.cam.z);
    if (depth > state.viewDistance) return;
    const clipped = clipNear(v, true);
    if (clipped.length < 3) return;
    const screen = clipped.map(project);
    ctx.beginPath();
    ctx.moveTo(screen[0][0], screen[0][1]);
    for (let i = 1; i < screen.length; i += 1) ctx.lineTo(screen[i][0], screen[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgb(shade([62, 62, 64], depth));
    ctx.fill();
    ctx.strokeStyle = rgb(shade([150, 150, 146], depth));
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // island on top
    const iv = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      iv.push(toView([ring.cx + Math.cos(a) * ring.r0, ring.y + 0.22, ring.cz + Math.sin(a) * ring.r0], [0, 0, 0]));
    }
    const ic = clipNear(iv, true);
    if (ic.length < 3) return;
    const is = ic.map(project);
    ctx.beginPath();
    ctx.moveTo(is[0][0], is[0][1]);
    for (let i = 1; i < is.length; i += 1) ctx.lineTo(is[i][0], is[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgb(shade([96, 112, 84], depth));
    ctx.fill();
    ctx.strokeStyle = rgb(shade([176, 176, 172], depth));
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Ground reference grid for the "roads only" view. */
  function drawGrid() {
    const step = 100;
    const span = Math.ceil(state.viewDistance / step) * step;
    const c = state.cam;
    const x0 = Math.floor((c.x - span) / step) * step;
    const x1 = Math.ceil((c.x + span) / step) * step;
    const z0 = Math.floor((c.z - span) / step) * step;
    const z1 = Math.ceil((c.z + span) / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const a = project(toView([x, 0, z0], [0, 0, 0]));
      const b = project(toView([x, 0, z1], [0, 0, 0]));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let z = z0; z <= z1; z += step) {
      const a = project(toView([x0, 0, z], [0, 0, 0]));
      const b = project(toView([x1, 0, z], [0, 0, 0]));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }

  /* ── picking ────────────────────────────────────────────────────────────────────────────────── */

  function pickAt(px, py) {
    const geo = state.geometry;
    if (!geo) return null;
    let best = null;
    let bestD = 14;
    const cam = view.cam.pos;
    const test = (pts, meta, limit) => {
      let prev = null;
      for (const p of pts) {
        const v = toView(p, [0, 0, 0]);
        if (v[2] < NEAR) { prev = null; continue; }
        const s = project(v);
        if (prev) {
          // distance from the pointer to this screen segment
          const dx = s[0] - prev[0];
          const dy = s[1] - prev[1];
          const len2 = dx * dx + dy * dy;
          let t = len2 > 0 ? ((px - prev[0]) * dx + (py - prev[1]) * dy) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          const qx = prev[0] + dx * t;
          const qy = prev[1] + dy * t;
          const d = Math.hypot(px - qx, py - qy);
          if (d < bestD) { bestD = d; best = { ...meta, screen: [qx, qy] }; }
        }
        prev = s;
      }
    };
    for (const road of state.project?.roads || []) {
      const dx = road.points[0][0] - cam[0];
      const dz = road.points[0][2] - cam[2];
      if (dx * dx + dz * dz > state.viewDistance * state.viewDistance * 4) continue;
      test(road.points, { roadId: road.id, kind: 'road' });
    }
    for (const node of state.project?.nodes || []) {
      const v = toView([node.x, node.y, node.z], [0, 0, 0]);
      if (v[2] < NEAR) continue;
      const s = project(v);
      const d = Math.hypot(px - s[0], py - s[1]);
      if (d < bestD + 4) { bestD = Math.min(bestD, d); best = { nodeId: node.id, kind: 'junction', screen: s }; }
    }
    return best;
  }

  /* ── minimap ────────────────────────────────────────────────────────────────────────────────── */

  function drawMinimap(target, size = 168) {
    const c = target.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (target.width !== size * dpr) {
      target.width = size * dpr;
      target.height = size * dpr;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = 'rgb(18,20,24)';
    c.fillRect(0, 0, size, size);
    const project2 = state.project;
    if (!project2) return;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const r of project2.roads) {
      for (const p of r.points) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[2] < minZ) minZ = p[2];
        if (p[2] > maxZ) maxZ = p[2];
      }
    }
    if (!Number.isFinite(minX)) return;
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.05 || 1;
    const k = size / span;
    const ox = (size - (maxX - minX) * k) / 2;
    const oz = (size - (maxZ - minZ) * k) / 2;
    const P = (x, z) => [ox + (x - minX) * k, oz + (z - minZ) * k];
    const CLASS_COLOUR = {
      motorway: '#d9a13c', expressway: '#d9a13c', arterial: '#e8e2d0', collector: '#b9bfc6',
      local: '#8d949c', lane: '#8d949c', service: '#7c8288', ramp: '#7fd6a0', busway: '#c98ad6',
      tramway: '#c98ad6', cycleway: '#6fd0a8', footway: '#7fa8d6', pedestrian: '#7fa8d6', 'parking-aisle': '#6f747a',
    };
    for (const r of project2.roads) {
      c.strokeStyle = CLASS_COLOUR[r.class] || '#8d949c';
      c.lineWidth = r.class === 'motorway' ? 2.2 : r.class === 'expressway' ? 1.8 : r.class === 'ramp' ? 1.2 : 1;
      c.beginPath();
      r.points.forEach((p, i) => {
        const s = P(p[0], p[2]);
        if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
      });
      c.stroke();
    }
    const t2 = project2.terrain;
    if (t2 && t2.isWater) {
      c.fillStyle = 'rgba(58,104,146,0.6)';
      const cells = 56;
      for (let i = 0; i < cells; i += 1) {
        for (let j = 0; j < cells; j += 1) {
          const x = minX + ((i + 0.5) / cells) * (maxX - minX);
          const z = minZ + ((j + 0.5) / cells) * (maxZ - minZ);
          if (!t2.isWater(x, z)) continue;
          const s = P(x, z);
          c.fillRect(s[0] - (size / cells) * 0.6, s[1] - (size / cells) * 0.6, (size / cells) * 1.2, (size / cells) * 1.2);
        }
      }
    }
    // camera
    const cam = state.cam;
    const cs = P(cam.x, cam.z);
    c.fillStyle = '#ffd166';
    c.beginPath();
    c.moveTo(cs[0], cs[1] - 6);
    c.lineTo(cs[0] - 4.4, cs[1] + 5);
    c.lineTo(cs[0] + 4.4, cs[1] + 5);
    c.closePath();
    c.save();
    c.translate(cs[0], cs[1]);
    c.rotate(cam.yaw + Math.PI);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -13);
    c.strokeStyle = 'rgba(255,209,102,0.75)';
    c.lineWidth = 1.4;
    c.stroke();
    c.restore();
    c.restore();
  }

  /* ── camera helpers ─────────────────────────────────────────────────────────────────────────── */

  function move(dt, keys) {
    const cam = state.cam;
    const basis = cameraBasis(cam.yaw, cam.pitch);
    const flat = [basis.forward[0], 0, basis.forward[2]];
    const fl = Math.hypot(flat[0], flat[2]) || 1;
    flat[0] /= fl; flat[2] /= fl;
    let speed = state.speed * (keys.shift ? 4 : 1) * (keys.ctrl ? 0.25 : 1) * dt;
    const strafe = [basis.right[0], 0, basis.right[2]];
    if (keys.w) { cam.x += flat[0] * speed; cam.z += flat[2] * speed; }
    if (keys.s) { cam.x -= flat[0] * speed; cam.z -= flat[2] * speed; }
    if (keys.d) { cam.x += strafe[0] * speed; cam.z += strafe[2] * speed; }
    if (keys.a) { cam.x -= strafe[0] * speed; cam.z -= strafe[2] * speed; }
    if (keys.e) cam.y += speed;
    if (keys.q) cam.y -= speed;
    if (keys.left) cam.yaw -= 1.6 * dt;
    if (keys.right) cam.yaw += 1.6 * dt;
    if (keys.up) cam.pitch = Math.min(Math.PI / 2 - 0.05, cam.pitch + 1.1 * dt);
    if (keys.down) cam.pitch = Math.max(-Math.PI / 2 + 0.05, cam.pitch - 1.1 * dt);
    cam.y = Math.max(1.2, cam.y);
  }

  function focusOn(target) {
    const cam = state.cam;
    if (!target) return;
    cam.x = target.x ?? cam.x;
    cam.z = target.z ?? cam.z;
    cam.y = (target.y ?? 0) + (target.height ?? 22);
    if (target.yaw !== undefined) cam.yaw = target.yaw;
    if (target.pitch !== undefined) cam.pitch = target.pitch;
  }

  /** Frame a road from a distance, looking along it — the "fly to" of the road list. */
  function focusRoad(road, back = 90, height = 26) {
    if (!road || road.points.length < 2) return;
    const a = road.points[0];
    const b = road.points[road.points.length - 1];
    const mid = road.points[Math.floor(road.points.length / 2)];
    const yaw = Math.atan2(a[0] - b[0], -(a[2] - b[2]));
    const cam = state.cam;
    cam.x = mid[0] - Math.sin(yaw) * back;
    cam.z = mid[2] + Math.cos(yaw) * back;
    cam.y = mid[1] + height;
    cam.yaw = yaw;
    cam.pitch = -0.18;
  }

  return {
    state,
    render,
    resize,
    move,
    pickAt,
    focusOn,
    focusRoad,
    drawMinimap,
    cameraBasis,
  };
}

/**
 * Headless proof that the renderer's maths is sound without a browser: the checker imports this and
 * runs the projection/clipping core over real generated geometry.
 */
export function projectPoint(cam, fov, w, h, p) {
  const basis = cameraBasis(cam.yaw, cam.pitch);
  const d = sub(p, [cam.x, cam.y, cam.z]);
  const z = dot(d, basis.forward);
  if (z < NEAR) return null;
  const focal = h / 2 / Math.tan(fov / 2);
  return [w / 2 + (focal * dot(d, basis.right)) / z, h / 2 - (focal * dot(d, basis.up)) / z, z];
}
