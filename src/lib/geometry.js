/**
 * Low-level procedural geometry for the eagle.
 *
 * Nothing here is a primitive box or sphere: body volumes are lofted from
 * per-station cross-sections, limbs are swept tubes whose section radii follow
 * real bone + muscle profiles, and every feather is generated as an airfoil
 * blade with its own camber, thickness distribution, rachis curve and
 * emargination (the notch in the outer vane of an eagle's outer primaries).
 */

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Vector3,
} from 'three';
import { clamp, lerp, smoothstep, smootherstep, TAU } from './mathx.js';

const _v1 = new Vector3();
const _v2 = new Vector3();

/* -------------------------------------------------------------------------- */
/*  Frames                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parallel-transport frames along a polyline.  Produces a continuous normal
 * (no twist popping) which is what you need for neck vertebrae, feather
 * rachides and limb tubes.
 */
export function frameFromPoints(points, upHint = new Vector3(0, 1, 0)) {
  const n = points.length;
  const tangents = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) _v1.copy(points[1]).sub(points[0]);
    else if (i === n - 1) _v1.copy(points[n - 1]).sub(points[n - 2]);
    else _v1.copy(points[i + 1]).sub(points[i - 1]);
    if (_v1.lengthSq() < 1e-12) _v1.set(0, 1, 0);
    tangents.push(_v1.clone().normalize());
  }

  // Seed normal: any vector perpendicular to the first tangent.
  let normal = upHint.clone();
  if (Math.abs(normal.dot(tangents[0])) > 0.95) {
    normal.set(1, 0, 0);
    if (Math.abs(normal.dot(tangents[0])) > 0.95) normal.set(0, 0, 1);
  }
  normal.sub(tangents[0].clone().multiplyScalar(normal.dot(tangents[0]))).normalize();

  const normals = [normal.clone()];
  for (let i = 1; i < n; i++) {
    // Rotate the previous normal into the new tangent's plane using the
    // minimal-rotation (Rodrigues) formula — the discrete version of parallel
    // transport.
    const t0 = tangents[i - 1];
    const t1 = tangents[i];
    const axis = _v1.copy(t0).cross(t1);
    const s = axis.length();
    const prev = normals[i - 1];
    if (s < 1e-8) {
      normals.push(prev.clone());
    } else {
      axis.multiplyScalar(1 / s);
      const ang = Math.atan2(s, t0.dot(t1));
      const q = new Vector3().copy(prev);
      q.applyAxisAngle(axis, ang);
      q.addScaledVector(t1, -q.dot(t1)).normalize();
      normals.push(q);
    }
  }

  const binormals = tangents.map((t, i) => new Vector3().copy(t).cross(normals[i]).normalize());
  return { points, tangents, normals, binormals, length: n };
}

/* -------------------------------------------------------------------------- */
/*  Lofting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Loft a sequence of rings (each an array of Vector3, all the same length)
 * into a closed surface.
 *
 * @param {Vector3[][]} rings
 * @param {{closedProfile?: boolean, capStart?: boolean, capEnd?: boolean,
 *          uvScale?: [number, number]}} opts
 */
export function loftRings(rings, opts = {}) {
  const { closedProfile = true, capStart = true, capEnd = true } = opts;
  const R = rings.length;
  const C = rings[0].length;
  const pos = [];
  const uv = [];
  const idx = [];

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const p = rings[r][c];
      pos.push(p.x, p.y, p.z);
      uv.push(c / C, r / (R - 1));
    }
  }

  const cMax = closedProfile ? C : C - 1;
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < cMax; c++) {
      const c1 = (c + 1) % C;
      const a = r * C + c;
      const b = r * C + c1;
      const d = (r + 1) * C + c;
      const e = (r + 1) * C + c1;
      idx.push(a, d, b, b, d, e);
    }
  }

  const addCap = (ringIndex, flip) => {
    // Fan-cap around the ring centroid.
    const centre = new Vector3();
    for (const p of rings[ringIndex]) centre.add(p);
    centre.multiplyScalar(1 / C);
    const base = pos.length / 3;
    pos.push(centre.x, centre.y, centre.z);
    uv.push(0.5, 0.5);
    for (let c = 0; c < C; c++) {
      const c1 = (c + 1) % C;
      const a = ringIndex * C + c;
      const b = ringIndex * C + c1;
      if (flip) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  };

  if (capStart && closedProfile) addCap(0, true);
  if (capEnd && closedProfile) addCap(R - 1, false);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Sweep a section generator along a path.
 *
 * @param {Vector3[]} path
 * @param {(t:number, i:number) => {pts:[number,number][], scale?:number}} sectionFn
 *        returns 2-D points in the (normal, binormal) plane for parameter t
 * @param {{up?:Vector3, closedProfile?:boolean, capStart?:boolean, capEnd?:boolean}} opts
 */
export function sweepPath(path, sectionFn, opts = {}) {
  const { closedProfile = true, capStart = true, capEnd = true } = opts;
  const frames = frameFromPoints(path, opts.up ?? new Vector3(0, 1, 0));
  const R = path.length;
  const rings = [];
  let C = 0;
  for (let i = 0; i < R; i++) {
    const t = R === 1 ? 0 : i / (R - 1);
    const sec = sectionFn(t, i);
    const pts = sec.pts;
    C = pts.length;
    const scale = sec.scale ?? 1;
    const ring = [];
    for (const [u, v] of pts) {
      ring.push(
        new Vector3()
          .copy(frames.points[i])
          .addScaledVector(frames.normals[i], u * scale)
          .addScaledVector(frames.binormals[i], v * scale),
      );
    }
    rings.push(ring);
  }
  const g = loftRings(rings, { closedProfile, capStart, capEnd });
  g.userData.frames = frames;
  return g;
}

/** Resample a Catmull-Rom through `controls` into `n` points. */
export function sampleCurve(controls, n, tension = 0.5) {
  const curve = new CatmullRomCurve3(
    controls.map((c) => (c.isVector3 ? c : new Vector3(...c))),
    false,
    'catmullrom',
    tension,
  );
  const out = [];
  for (let i = 0; i < n; i++) out.push(curve.getPoint(i / (n - 1)));
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Cross-sections                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Superellipse cross-section (rounded-rectangle family) — gives us control
 * over how "boxy" a body/limb section is: e=2 is a plain ellipse, e>2 is
 * increasingly flattened, e<2 is a diamond.
 *
 * `keel` pushes the ventral (v<0) half downward/forward, producing the
 * breast-keel silhouette of a bird's trunk.
 */
export function superellipse(n, rx, ry, e = 2.4, keel = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * rx;
    let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * ry;
    if (y < 0 && keel) y -= keel * Math.pow(-y / ry, 1.2);
    pts.push([x, y]);
  }
  return pts;
}

/* -------------------------------------------------------------------------- */
/*  Feathers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Generate a single flight feather as a cambered airfoil blade.
 *
 * Local frame (before the caller transforms it):
 *   +Y  = distal, out along the feather from the quill base
 *   +X  = toward the trailing edge of the wing
 *   +Z  = dorsal (upper) surface of the wing
 *
 * Real-eagle details that are modelled:
 *  - asymmetric vanes: the leading (outer) vane is narrow, the trailing
 *    (inner) vane is wide, especially on primaries  [5]
 *  - the outer vane of primaries 6-10 is EMARGINATED (notched) at ~30-45 %
 *    from the tip, leaving the characteristic narrow "finger"  [5]
 *  - the inner vane of the outer primaries is notched near the base
 *  - rounded, symmetric vanes on secondaries  [5]
 *  - the rachis is curved (swept back) with a gentle dorsal camber
 *  - the tip is twisted slightly (the feathers twist under load, [Wikipedia
 *    "Bird flight": rotation of the feather in its follicle])
 */
export function makeFeather(spec) {
  const {
    length = 0.3,
    width = 0.06, // mm of the widest chord
    outerVane = 0.32, // fraction of chord on the leading/outer side
    emarginate = 0, // 0..1 depth of the notch in the outer vane
    emarginateAt = 0.55, // where along the feather the notch begins
    innerNotch = 0,
    camber = 0.045, // dorsal bow, as a fraction of width
    sweep = 0.05, // rachis curvature, as a fraction of length
    tipTwist = 0.18, // radians of twist at the tip
    tipRoundness = 0.35, // 0 = needle, 1 = fully rounded tip
    thickness = 0.0016, // blade thickness (m)
    segments = 22,
    calamus = 0.0, // bare quill length at the base
    profileN = 8,
    hue = 0,
  } = spec;

  const rachis = (t) => {
    // t in [0,1] along the feather
    const y = t * length;
    const x = -sweep * length * t * t * 0.5;
    return { x, y };
  };

  /** half-chord widths to leading (-) and trailing (+) side at t */
  const widths = (t) => {
    // Base: narrow (the quill region).  Widens quickly to full chord, holds,
    // then tapers into the tip.
    const baseRamp = smoothstep(t / 0.22);
    const tip = t < 1 - tipRoundness ? 1 : 1 - smootherstep((t - (1 - tipRoundness)) / tipRoundness);
    let w = baseRamp * tip;

    // Emargination: a step-notch in the outer (leading) vane.
    let outer = outerVane;
    if (emarginate > 0) {
      const notchStart = emarginateAt;
      const notchEnd = 1 - tipRoundness - 0.06;
      if (t > notchStart) {
        const k = smoothstep(clamp((t - notchStart) / 0.22, 0, 1));
        outer *= 1 - emarginate * k * (notchEnd > notchStart ? 1 : 1);
      }
    }
    let inner = 1 - outerVane;
    if (innerNotch > 0 && t < 0.3) {
      inner *= 1 - innerNotch * (1 - smoothstep(t / 0.3));
    }
    const chord = width * w;
    return { le: chord * outer, te: chord * inner };
  };

  const rings = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const rc = rachis(t);
    const { le, te } = widths(t);
    const twist = tipTwist * t * t;
    const cT = Math.cos(twist);
    const sT = Math.sin(twist);
    const camberZ = camber * width * Math.sin(Math.PI * clamp(t / 0.9, 0, 1)) * (1 - 0.5 * t);

    const ring = [];
    for (let j = 0; j < profileN; j++) {
      const a = (j / profileN) * TAU;
      const cx = Math.cos(a); // +1 = leading edge (outer vane), -1 = trailing vane
      const cz = Math.sin(a); // +1 = dorsal
      // chordwise coordinate: positive = leading/outer vane, negative = trailing
      const xv = cx > 0 ? cx * le : cx * te;
      // airfoil-ish thickness distribution: thickest ~30 % back from the
      // leading edge, tapering to nothing at both edges
      const local = clamp((le - xv) / Math.max(le + te, 1e-6), 0, 1);
      const th = Math.sin(Math.PI * Math.pow(local, 0.62)) * thickness * (0.35 + 0.65 * (1 - t));
      const z = cz * (th * 0.5) + camberZ;

      // apply tip twist about the rachis
      const px = xv;
      const pz = z;
      let ax = px * cT - pz * sT;
      let az = px * sT + pz * cT;

      // The calamus (bare quill) tapers to a point below the vane.
      const q = calamus > 0 && t < calamus / length ? 0.25 + 0.75 * ((t * length) / calamus) : 1;

      ring.push(new Vector3(rc.x + ax * q, rc.y, az * q));
    }
    rings.push(ring);
  }

  const g = loftRings(rings, { closedProfile: true, capStart: true, capEnd: true });
  g.userData.featherHue = hue;
  return g;
}

/* -------------------------------------------------------------------------- */
/*  Simple sculpted parts                                                      */
/* -------------------------------------------------------------------------- */

/** Curved, laterally-compressed talon. */
export function makeTalon(length, baseRadius, curve = 0.55, sections = 14) {
  const path = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    // Circular arc: the talon curves down and back toward the toe.
    const ang = t * curve * Math.PI * 0.9;
    path.push(
      new Vector3(
        0,
        Math.sin(ang) * length * 0.92,
        -(1 - Math.cos(ang)) * length * 0.72,
      ),
    );
  }
  return sweepPath(
    path,
    (t) => {
      const r = baseRadius * (1 - Math.pow(t, 1.45)) * (0.4 + 0.6 * Math.sin(Math.PI * clamp(0.1 + t * 0.9, 0, 1)));
      const rr = Math.max(r, baseRadius * 0.06);
      return { pts: superellipse(10, rr, rr * 0.78, 2.2) };
    },
    { capStart: true, capEnd: true, up: new Vector3(0, 0, 1) },
  );
}

/**
 * Spherical cap (a dome section) with the pole on +Y.  Used for the eyelids:
 * mounted with its origin at the eyeball's centre, rotating it about X sweeps
 * the lid down over the cornea exactly like a real eyelid.
 */
export function makeSphericalCap(radius, coverage, segs = 24, rings = 8) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * coverage;
    const rad = Math.sin(phi) * radius;
    const y = Math.cos(phi) * radius;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * TAU;
      pos.push(Math.cos(th) * rad, y, Math.sin(th) * rad);
      uv.push(s / segs, r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = r * segs + s;
      const b = r * segs + s1;
      const c = (r + 1) * segs + s;
      const d = (r + 1) * segs + s1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Biconvex lens, used for the cornea. */
export function makeLens(radius, bulge, segs = 20, rings = 8) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * (Math.PI / 2);
    const rad = Math.sin(phi) * radius;
    const z = Math.cos(phi) * bulge;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * TAU;
      pos.push(Math.cos(th) * rad, Math.sin(th) * rad, z);
      uv.push(s / segs, r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = r * segs + s;
      const b = r * segs + s1;
      const c = (r + 1) * segs + s;
      const d = (r + 1) * segs + s1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merge helper: append geometry `src` into arrays with an optional transform. */
export function pushGeometry(target, src, matrix) {
  const p = src.getAttribute('position');
  const n = src.getAttribute('normal');
  const u = src.getAttribute('uv');
  const base = target.positions.length / 3;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (matrix) v.applyMatrix4(matrix);
    target.positions.push(v.x, v.y, v.z);
    if (n) {
      v.fromBufferAttribute(n, i);
      if (matrix) v.transformDirection(matrix);
      target.normals.push(v.x, v.y, v.z);
    }
    if (u) target.uvs.push(u.getX(i), u.getY(i));
    else target.uvs.push(0, 0);
  }
  const index = src.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i++) target.indices.push(base + index.getX(i));
  } else {
    for (let i = 0; i < p.count; i++) target.indices.push(base + i);
  }
  return target;
}

export function createMergeTarget() {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function finishMerge(target, name = '') {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(target.positions), 3));
  if (target.normals.length === target.positions.length)
    g.setAttribute('normal', new BufferAttribute(new Float32Array(target.normals), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(target.uvs), 2));
  g.setIndex(target.indices);
  if (!target.normals.length) g.computeVertexNormals();
  g.name = name;
  return g;
}

export { lerp, clamp };
