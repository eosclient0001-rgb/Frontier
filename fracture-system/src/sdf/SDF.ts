/**
 * ============================================================================
 *  SDF — Signed Distance Field primitives, CSG operators and transform stacks
 * ============================================================================
 *
 *  Why SDFs and not cells/Voronoi?
 *  ------------------------------
 *  Voronoi cell fracture produces *convex* polyhedra whose faces are pieces of
 *  bisector planes. Real cracks are not bisector planes: they start at a
 *  defect, follow a *stress field*, propagate at a finite velocity, branch when
 *  the energy release rate exceeds a threshold, and arrest at free surfaces or
 *  compressive zones. A bisector-plane tessellation cannot express any of that.
 *
 *  We therefore describe fracture as an *implicit carving volume*:
 *
 *      solid(p)      -- the object, any SDF you like
 *      crackField(p) -- the union of every propagating crack ribbon
 *      damaged(p)    = max(solid(p), -crackField(p))     <-- boolean subtract
 *
 *  The cracks themselves come from the peridynamics solver (see
 *  `src/peridynamics`), which produces a scalar damage field D(p) in [0,1].
 *  The crack SDF is derived from D with a distance transform, so the geometry
 *  you finally extract is a *faithful* consequence of the physics, not a
 *  decorative pattern bolted on afterwards.
 *
 *  This module is the glue: compact SDF node graph + CPU evaluator + WGSL
 *  code generator, so the exact same description runs on the CPU for
 *  fragment extraction and on the GPU for real-time raymarched preview.
 * ============================================================================
 */

export type SDFType =
  | 'sphere'
  | 'box'
  | 'boxFrame'
  | 'cylinder'
  | 'cone'
  | 'capsule'
  | 'torus'
  | 'plane'
  | 'octahedron'
  | 'roundBox'
  | 'union'
  | 'subtract'
  | 'intersect'
  | 'smoothUnion'
  | 'smoothSubtract'
  | 'smoothIntersect'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'repeat'
  | 'noise'
  | 'shell'
  | 'onion'
  | 'displace'
  | 'custom';

/** A single node of the implicit description graph. */
export interface SDFNode {
  type: SDFType;
  /** Primitive dimensions / rotation angles / plane normal+d / repeat cell size. */
  params: number[];
  children?: SDFNode[];
  /** Blend radius for the smooth* operators. */
  blend?: number;
  /** Arbitrary per-node data (e.g. crack id, material index). */
  tag?: number;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const sphere = (r: number): SDFNode => ({ type: 'sphere', params: [r] });
export const box = (x: number, y: number, z: number): SDFNode => ({ type: 'box', params: [x, y, z] });
export const roundBox = (x: number, y: number, z: number, r: number): SDFNode => ({ type: 'roundBox', params: [x, y, z, r] });
export const cylinder = (r: number, h: number): SDFNode => ({ type: 'cylinder', params: [r, h] });
export const capsule = (r: number, h: number): SDFNode => ({ type: 'capsule', params: [r, h] });
export const cone = (r1: number, r2: number, h: number): SDFNode => ({ type: 'cone', params: [r1, r2, h] });
export const torus = (R: number, r: number): SDFNode => ({ type: 'torus', params: [R, r] });
export const octahedron = (s: number): SDFNode => ({ type: 'octahedron', params: [s] });
export const plane = (nx: number, ny: number, nz: number, d: number): SDFNode => ({ type: 'plane', params: [nx, ny, nz, d] });

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export const opUnion = (...c: SDFNode[]): SDFNode => ({ type: 'union', params: [], children: c });
export const opSubtract = (a: SDFNode, b: SDFNode): SDFNode => ({ type: 'subtract', params: [], children: [a, b] });
export const opIntersect = (a: SDFNode, b: SDFNode): SDFNode => ({ type: 'intersect', params: [], children: [a, b] });
export const opSmoothUnion = (a: SDFNode, b: SDFNode, k: number): SDFNode => ({ type: 'smoothUnion', params: [k], children: [a, b] });
export const opSmoothSubtract = (a: SDFNode, b: SDFNode, k: number): SDFNode => ({ type: 'smoothSubtract', params: [k], children: [a, b] });
export const opSmoothIntersect = (a: SDFNode, b: SDFNode, k: number): SDFNode => ({ type: 'smoothIntersect', params: [k], children: [a, b] });

export const translate = (n: SDFNode, x: number, y: number, z: number): SDFNode => ({ type: 'translate', params: [x, y, z], children: [n] });
export const rotate = (n: SDFNode, rx: number, ry: number, rz: number): SDFNode => ({ type: 'rotate', params: [rx, ry, rz], children: [n] });
export const scale = (n: SDFNode, s: number): SDFNode => ({ type: 'scale', params: [s], children: [n] });
export const shell = (n: SDFNode, t: number): SDFNode => ({ type: 'shell', params: [t], children: [n] });

/** Fractal value noise displacement — gives crack faces their micro-roughness. */
export const noise = (n: SDFNode, amp: number, freq: number, octaves: number): SDFNode =>
  ({ type: 'noise', params: [amp, freq, octaves], children: [n] });

// ---------------------------------------------------------------------------
// Distance-query combinators (operate on already-evaluated distances)
// ---------------------------------------------------------------------------

export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

// ---------------------------------------------------------------------------
// CPU evaluator
// ---------------------------------------------------------------------------

const rot3 = (p: number[], rx: number, ry: number, rz: number): void => {
  // inverse-rotate the sample point (SDF transforms are domain-warping)
  let c = Math.cos(rz), s = Math.sin(rz);
  let x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c;
  p[0] = x; p[1] = y;
  c = Math.cos(ry); s = Math.sin(ry);
  x = p[0] * c + p[2] * s;
  const z = -p[0] * s + p[2] * c;
  p[0] = x; p[2] = z;
  c = Math.cos(rx); s = Math.sin(rx);
  const yy = p[1] * c - p[2] * s;
  const zz = p[1] * s + p[2] * c;
  p[1] = yy; p[2] = zz;
};

/** Hash-based 3D value noise (no tables, deterministic across CPU/GPU intent). */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number): number => {
    let n = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c00 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
  const c10 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
  const c01 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
  const c11 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w) * 2 - 1;
}

export function fbm3(x: number, y: number, z: number, octaves: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * f, y * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Evaluate the graph at a world-space point. Returns signed distance in metres.
 * Allocates one scratch vec3 per call — hot paths use the flat-grid variant.
 */
export function evalSDF(node: SDFNode, px: number, py: number, pz: number, _d = 0): number {
  const p = [px, py, pz];

  switch (node.type) {
    case 'sphere': return Math.hypot(p[0], p[1], p[2]) - node.params[0];

    case 'box': {
      const qx = Math.abs(p[0]) - node.params[0];
      const qy = Math.abs(p[1]) - node.params[1];
      const qz = Math.abs(p[2]) - node.params[2];
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
      return Math.hypot(mx, my, mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    }

    case 'roundBox': {
      const qx = Math.abs(p[0]) - node.params[0];
      const qy = Math.abs(p[1]) - node.params[1];
      const qz = Math.abs(p[2]) - node.params[2];
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
      return Math.hypot(mx, my, mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - node.params[3];
    }

    case 'cylinder': {
      const d = Math.hypot(Math.hypot(p[0], p[2]) - node.params[0], Math.abs(p[1]) - node.params[1]);
      return Math.min(d, 0) + Math.hypot(Math.max(Math.hypot(p[0], p[2]) - node.params[0], 0), Math.max(Math.abs(p[1]) - node.params[1], 0));
    }

    case 'capsule': {
      const yc = Math.max(-node.params[1], Math.min(node.params[1], p[1]));
      return Math.hypot(p[0], p[1] - yc, p[2]) - node.params[0];
    }

    case 'cone': {
      const q = Math.hypot(p[0], p[2]);
      const h0 = node.params[2];
      const t = Math.min(1, Math.max(0, (q - node.params[0]) / Math.max(1e-6, node.params[1] - node.params[0])));
      const r = node.params[0] + (node.params[1] - node.params[0]) * t;
      const dy = Math.abs(p[1]) - h0;
      return Math.max(Math.hypot(q - r, Math.max(dy, 0)), dy);
    }

    case 'torus': {
      const q = Math.hypot(p[0], p[2]) - node.params[0];
      return Math.hypot(q, p[1]) - node.params[1];
    }

    case 'octahedron': {
      const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
      return (ax + ay + az - node.params[0]) * 0.57735027;
    }

    case 'plane': return p[0] * node.params[0] + p[1] * node.params[1] + p[2] * node.params[2] + node.params[3];

    case 'union': {
      let d = Infinity;
      for (const c of node.children!) d = Math.min(d, evalSDF(c, px, py, pz));
      return d;
    }

    case 'intersect': {
      let d = -Infinity;
      for (const c of node.children!) d = Math.max(d, evalSDF(c, px, py, pz));
      return d;
    }

    case 'subtract':
      return Math.max(evalSDF(node.children![0], px, py, pz), -evalSDF(node.children![1], px, py, pz));

    case 'smoothUnion': {
      const a = evalSDF(node.children![0], px, py, pz);
      const b = evalSDF(node.children![1], px, py, pz);
      return smin(a, b, node.params[0]);
    }

    case 'smoothSubtract': {
      const a = evalSDF(node.children![0], px, py, pz);
      const b = evalSDF(node.children![1], px, py, pz);
      return smax(a, -b, node.params[0]);
    }

    case 'smoothIntersect': {
      const a = evalSDF(node.children![0], px, py, pz);
      const b = evalSDF(node.children![1], px, py, pz);
      return smax(a, b, node.params[0]);
    }

    case 'translate':
      return evalSDF(node.children![0], px - node.params[0], py - node.params[1], pz - node.params[2]);

    case 'rotate': {
      rot3(p, node.params[0], node.params[1], node.params[2]);
      return evalSDF(node.children![0], p[0], p[1], p[2]);
    }

    case 'scale': {
      const s = node.params[0];
      return evalSDF(node.children![0], px / s, py / s, pz / s) * s;
    }

    case 'shell':
      return Math.abs(evalSDF(node.children![0], px, py, pz)) - node.params[0];

    case 'onion':
      return Math.abs(evalSDF(node.children![0], px, py, pz) + node.params[1]) - node.params[1];

    case 'noise': {
      const [amp, freq, oct] = node.params;
      return evalSDF(node.children![0], px, py, pz) + amp * fbm3(px * freq, py * freq, pz * freq, oct);
    }

    case 'repeat': {
      const [cx, cy, cz] = node.params;
      const qx = px - cx * Math.round(px / cx);
      const qy = py - cy * Math.round(py / cy);
      const qz = pz - cz * Math.round(pz / cz);
      return evalSDF(node.children![0], qx, qy, qz);
    }

    case 'custom':
    default:
      return Infinity;
  }
}

/** Central-difference gradient. */
export function sdfNormal(node: SDFNode, x: number, y: number, z: number, h = 1e-3): [number, number, number] {
  const dx = evalSDF(node, x + h, y, z) - evalSDF(node, x - h, y, z);
  const dy = evalSDF(node, x, y + h, z) - evalSDF(node, x, y - h, z);
  const dz = evalSDF(node, x, y, z + h) - evalSDF(node, x, y, z - h);
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
}

// ---------------------------------------------------------------------------
// WGSL code generation
// ---------------------------------------------------------------------------

/**
 * Emits a WGSL function `fn sdf_eval(p: vec3<f32>) -> SDFSample` for the graph.
 * The identical description is then raymarched on the GPU for:
 *   - the "crack damage" overlay drawn on intact surfaces,
 *   - secondary debris previews that never need a CPU mesh,
 *   - and authoring tools (Houdini / Unreal PCG style) inside the browser.
 */
export interface WGSLGenResult { code: string; defines: string; }

export function sdfToWGSL(root: SDFNode, fnName = 'sdf_eval'): WGSLGenResult {
  let counter = 0;
  const lines: string[] = [];
  const defines: string[] = [];

  const emit = (n: SDFNode): string => {
    const id = `d${counter++}`;
    switch (n.type) {
      case 'sphere':
        lines.push(`  let ${id} = length(p) - ${f(n.params[0])};`); break;
      case 'box':
        lines.push(`  let q_${id} = abs(p) - vec3<f32>(${f(n.params[0])}, ${f(n.params[1])}, ${f(n.params[2])});`);
        lines.push(`  let ${id} = length(max(q_${id}, vec3<f32>(0.0))) + min(max(q_${id}.x, max(q_${id}.y, q_${id}.z)), 0.0);`);
        break;
      case 'roundBox':
        lines.push(`  let q_${id} = abs(p) - vec3<f32>(${f(n.params[0])}, ${f(n.params[1])}, ${f(n.params[2])});`);
        lines.push(`  let ${id} = length(max(q_${id}, vec3<f32>(0.0))) + min(max(q_${id}.x, max(q_${id}.y, q_${id}.z)), 0.0) - ${f(n.params[3])};`);
        break;
      case 'cylinder':
        lines.push(`  let ${id} = min(max(length(p.xz) - ${f(n.params[0])}, abs(p.y) - ${f(n.params[1])}), 0.0) + length(max(vec2<f32>(length(p.xz) - ${f(n.params[0])}, abs(p.y) - ${f(n.params[1])}), vec2<f32>(0.0)));`);
        break;
      case 'capsule': {
        lines.push(`  let c_${id} = clamp(p.y, -${f(n.params[1])}, ${f(n.params[1])});`);
        lines.push(`  let ${id} = length(p - vec3<f32>(0.0, c_${id}, 0.0)) - ${f(n.params[0])};`);
        break;
      }
      case 'torus': {
        lines.push(`  let q_${id} = vec2<f32>(length(p.xz) - ${f(n.params[0])}, p.y);`);
        lines.push(`  let ${id} = length(q_${id}) - ${f(n.params[1])};`);
        break;
      }
      case 'octahedron':
        lines.push(`  let ${id} = (abs(p.x) + abs(p.y) + abs(p.z) - ${f(n.params[0])}) * 0.57735027;`);
        break;
      case 'plane':
        lines.push(`  let ${id} = dot(p, vec3<f32>(${f(n.params[0])}, ${f(n.params[1])}, ${f(n.params[2])})) + ${f(n.params[3])};`);
        break;
      case 'union': {
        const ds = n.children!.map(emit);
        lines.push(`  var ${id} = ${ds[0]};`);
        for (let i = 1; i < ds.length; i++) lines.push(`  ${id} = min(${id}, ${ds[i]});`);
        break;
      }
      case 'intersect': {
        const ds = n.children!.map(emit);
        lines.push(`  var ${id} = ${ds[0]};`);
        for (let i = 1; i < ds.length; i++) lines.push(`  ${id} = max(${id}, ${ds[i]});`);
        break;
      }
      case 'subtract': {
        const a = emit(n.children![0]), b = emit(n.children![1]);
        lines.push(`  let ${id} = max(${a}, -${b});`);
        break;
      }
      case 'smoothUnion': {
        const a = emit(n.children![0]), b = emit(n.children![1]);
        lines.push(`  let ${id} = smin(${a}, ${b}, ${f(n.params[0])});`);
        break;
      }
      case 'smoothSubtract': {
        const a = emit(n.children![0]), b = emit(n.children![1]);
        lines.push(`  let ${id} = smax(${a}, -${b}, ${f(n.params[0])});`);
        break;
      }
      case 'smoothIntersect': {
        const a = emit(n.children![0]), b = emit(n.children![1]);
        lines.push(`  let ${id} = smax(${a}, ${b}, ${f(n.params[0])});`);
        break;
      }
      case 'translate': {
        const c = emit(n.children![0]);
        lines.push(`  let p_${id} = p - vec3<f32>(${f(n.params[0])}, ${f(n.params[1])}, ${f(n.params[2])});`);
        // Re-emit child against the shifted point by nesting a scope
        lines.push(`  let ${id} = ${c.replace(/\bp\b/g, `p_${id}`)};`);
        break;
      }
      case 'scale': {
        const s = n.params[0];
        const c = emit(n.children![0]);
        lines.push(`  let p_${id} = p / ${f(s)};`);
        lines.push(`  let ${id} = (${c.replace(/\bp\b/g, `p_${id}`)}) * ${f(s)};`);
        break;
      }
      case 'shell': {
        const c = emit(n.children![0]);
        lines.push(`  let ${id} = abs(${c}) - ${f(n.params[0])};`);
        break;
      }
      case 'noise': {
        const c = emit(n.children![0]);
        lines.push(`  let ${id} = ${c} + ${f(n.params[0])} * fbm3(p * ${f(n.params[1])}, ${n.params[2] | 0});`);
        break;
      }
      default: {
        // Unsupported node -> neutral element so we still produce compilable WGSL
        defines.push(`// WARNING: SDF node '${n.type}' has no WGSL emitter; substituted +1e9`);
        lines.push(`  let ${id} = 1e9;`);
      }
    }
    return id;
  };

  const rootId = emit(root);

  const code = `// ==== auto-generated from SDF graph (${fnName}) ====
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(a, b, h) + k * h * (1.0 - h);
}
fn fbm3(p: vec3<f32>, octaves: i32) -> f32 {
  var s = 0.0; var a = 0.5; var fr = 1.0; var nrm = 0.0;
  for (var i = 0; i < octaves; i = i + 1) {
    s = s + a * noise3d(p * fr);
    nrm = nrm + a; a = a * 0.5; fr = fr * 2.03;
  }
  return s / max(nrm, 1e-6);
}
fn ${fnName}(p: vec3<f32>) -> f32 {
${lines.join('\n')}
  return ${rootId};
}
`;
  return { code, defines: defines.join('\n') };
}

const f = (v: number): string => {
  let s = v.toString();
  if (!s.includes('.') && !s.includes('e') && !s.includes('E') && !s.includes('n') && !s.includes('i')) s += '.0';
  return s;
};

// ---------------------------------------------------------------------------
// Prefab objects
// ---------------------------------------------------------------------------

export type PrefabShape = 'plate' | 'brick' | 'beam' | 'sphere' | 'rock' | 'bottle' | 'bar';

export function makePrefab(shape: PrefabShape, size: [number, number, number]): SDFNode {
  const [sx, sy, sz] = size;
  switch (shape) {
    case 'plate': // window pane / sheet glass
      return box(sx * 0.5, sy * 0.5, sz * 0.5);
    case 'brick': {
      // A rounded box's *outer* extent is half-extent + radius, so inset the
      // core by the radius. Getting this wrong makes the object silently
      // larger than the declared size, which pushes its surface outside the
      // carve grid and makes the carver return nothing at all.
      const r = Math.min(sx, sy, sz) * 0.04;
      return roundBox(sx * 0.5 - r, sy * 0.5 - r, sz * 0.5 - r, r);
    }
    case 'beam': { // timber / I-beam
      const r = Math.min(sx, sz) * 0.08;
      return roundBox(sx * 0.5 - r, sy * 0.5 - r, sz * 0.5 - r, r);
    }
    case 'bar': { // plastic pipe / rebar — capsule along whichever axis is longest
      const axes: [number, number][] = [[sx, 0], [sy, 1], [sz, 2]];
      axes.sort((a, b) => b[0] - a[0]);
      const longAxis = axes[0][1];
      const radius = Math.min(...axes.slice(1).map((a) => a[0])) * 0.5;
      const halfLen = axes[0][0] * 0.5;
      const cap = capsule(radius, Math.max(1e-4, halfLen - radius));
      if (longAxis === 0) return rotate(cap, 0, 0, Math.PI / 2);
      if (longAxis === 2) return rotate(cap, Math.PI / 2, 0, 0);
      return cap;
    }
    case 'sphere':
      return sphere(sx * 0.5);
    case 'rock':
      return noise(octahedron(sx * 0.55), sx * 0.18, 2.4 / Math.max(0.05, sx), 4);
    case 'bottle': {
      const bodyR = sx * 0.5;
      const body = capsule(bodyR, sy * 0.28);
      const neck = translate(cylinder(bodyR * 0.32, sy * 0.14), 0, sy * 0.42, 0);
      return opSmoothUnion(body, neck, bodyR * 0.35);
    }
    default:
      return box(sx * 0.5, sy * 0.5, sz * 0.5);
  }
}
