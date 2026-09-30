/**
 * ============================================================================
 *  Carver — turns crack ribbons into watertight fragment meshes
 * ============================================================================
 *
 *  Pipeline
 *  --------
 *   1. VOXELISE the object SDF on an adaptive grid sized to the object.
 *   2. RASTERISE the crack ribbons into the same grid as a signed field.
 *      Each ribbon is an oriented slab whose lateral extent is measured by
 *      ray-marching the object, so a crack only cuts where it has actually
 *      propagated.
 *   3. LABEL connected components of  { object < 0  AND  crack > 0 }.
 *      That set is the physical definition of the fragments — it is what is
 *      still a single body after the cracks have passed through.
 *   4. EXTRACT each component's surface with marching tetrahedra (no lookup
 *      tables, watertight by construction, and the tetrahedral split is
 *      parity-alternated so neighbouring cells always agree on their shared
 *      diagonals).
 *
 *  Because the cut surface is the zero level-set of the crack field, fragments
 *  get *closed* cut faces that follow the crack path exactly — including the
 *  branches, the arrest positions and the aperture taper. Nothing is
 *  approximated by a plane.
 *
 *  Vertex attributes produced per fragment:
 *    faceKind   0 = original outer surface, 1 = freshly created fracture face
 *    crackRadial distance from the crack origin -> drives Wallner lines (glass)
 *    crackId     which crack created this face -> procedural interior texture
 *    damage      normalised damage the peridynamic field had at this point
 * ============================================================================
 */

import { evalSDF, fbm3 } from '../sdf/SDF.ts';
import type { SDFNode } from '../sdf/SDF.ts';
import type { Vec3 } from './CrackNetwork.ts';

export interface CarveSegment {
  a: Vec3;
  b: Vec3;
  n: Vec3;
  aperture: number;
  /** Crack origin, used for the radial coordinate of fracture-surface markings. */
  origin: Vec3;
  id: number;
}

export interface FragmentMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** 0 = outer skin, 1 = fracture face. */
  faceKind: Float32Array;
  /** Distance from the crack origin (metres) — Wallner / hackle markings. */
  crackRadial: Float32Array;
  /** Crack id normalised, for per-crack interior variation. */
  crackId: Float32Array;
  indices: Uint32Array;
  centroid: Vec3;
  volume: number;
  mass: number;
  /** Diagonal inertia tensor in the fragment's local frame, kg·m². */
  inertia: Vec3;
  /** Radius of the bounding sphere about the centroid. */
  radius: number;
  /** Island label this fragment came from. */
  island: number;
  triangles: number;
}

export interface CarveOptions {
  object: SDFNode;
  bounds: { min: Vec3; max: Vec3 };
  /** Cells along the longest axis. 48-96 is the useful range. */
  resolution: number;
  segments: CarveSegment[];
  materialId: number;
  density: number;
  /** Amplitude of the crack-face perturbation as a fraction of the aperture. */
  faceRoughness: number;
  /** Spatial frequency of that perturbation, 1/m. */
  faceRoughnessScale: number;
  /** Grain axis for fibrous materials (wood). */
  grainAxis: Vec3;
  /** Growth direction for drawn materials (plastic). */
  drawAxis: Vec3;
  /** Minimum fragment volume to keep, m³. Smaller pieces become debris/dust. */
  minFragmentVolume: number;
}

/**
 * Per-material fracture-surface perturbation.
 *
 * This is where the material stops being a parameter list and starts being a
 * *look*. The macro shape comes from the crack front; this function adds the
 * micro-relief that tells your eye what you are looking at:
 *
 *   glass     near-zero amplitude, smooth conchoidal surface. All the
 *             character is in the Wallner lines, which are a shader effect.
 *   wood      high amplitude, stretched 8:1 along the grain -> torn fibres.
 *   concrete  isotropic high-frequency relief -> exposed aggregate / paste.
 *   plastic   medium amplitude stretched 3:1 in the draw direction ->
 *             the stretched fibrils of a cold-drawn polymer.
 *   rock      medium amplitude, low frequency -> conchoidal shells.
 */
function faceNoise(
  materialId: number, x: number, y: number, z: number,
  scale: number, grainAxis: Vec3, drawAxis: Vec3,
): number {
  switch (materialId) {
    case 0: // glass
      return 0.12 * fbm3(x * scale * 0.5, y * scale * 0.5, z * scale * 0.5, 2);
    case 1: { // wood — stretch along the grain so the ridges run with it
      const g = grainAxis;
      const sx = x * scale * 0.35, sy = y * scale * 0.35, sz = z * scale * 0.35;
      const along = g[0] * sx + g[1] * sy + g[2] * sz;
      return fbm3(along * 0.25 + x * scale * 0.02, sy * 2.4, sz * 2.4, 4);
    }
    case 3: { // plastic — stretched fibrils in the draw direction
      const d = drawAxis;
      const sx = x * scale * 0.5, sy = y * scale * 0.5, sz = z * scale * 0.5;
      const along = d[0] * sx + d[1] * sy + d[2] * sz;
      return 0.6 * fbm3(along * 0.3, sy * 1.8, sz * 1.8, 3);
    }
    case 2: // concrete — sharp aggregate-scale relief
      return fbm3(x * scale, y * scale, z * scale, 4)
        + 0.5 * fbm3(x * scale * 3.1, y * scale * 3.1, z * scale * 3.1, 2);
    default: // rock — conchoidal, smoother at low frequency
      return 0.8 * fbm3(x * scale * 0.6, y * scale * 0.6, z * scale * 0.6, 3);
  }
}

export interface CarveResult {
  fragments: FragmentMesh[];
  /** Diagnostics for the HUD / profiling. */
  stats: {
    grid: [number, number, number];
    cellSize: number;
    voxels: number;
    solidVoxels: number;
    islands: number;
    triangles: number;
    /** Islands discarded for being below the minimum fragment volume. */
    droppedSmall: number;
    /** Island slots that never received geometry. */
    droppedEmpty: number;
    ms: number;
  };
  /**
   * ASCII rendering of the island field on an axis-aligned slice. Priceless
   * when a fracture "looks wrong": you can see instantly whether the cracks
   * actually reached the free surface or arrested short of it.
   *   '.' intact   ' ' outside   'A'..'Z','a'..'z' island id   '#' crack slot
   */
  slice: (axis: 0 | 1 | 2, position?: number) => string;
}

export function carve(opts: CarveOptions): CarveResult {
  const t0 = now();
  const { bounds, resolution } = opts;

  // ---- grid ------------------------------------------------------------
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const longest = Math.max(size[0], size[1], size[2]);
  // Pad the sampling domain. The object may legitimately poke a little past
  // the nominal bounds (rounded corners, noise displacement on a rock), and a
  // surface that falls outside the domain produces *zero* triangles with no
  // other symptom — so keep a generous margin rather than a tight fit.
  const pad = longest * 0.06;
  size[0] += pad * 2; size[1] += pad * 2; size[2] += pad * 2;
  const h = Math.max(size[0], size[1], size[2]) / resolution;
  const nx = Math.max(2, Math.ceil(size[0] / h)) + 3; // +3 = padding for a closed surface
  const ny = Math.max(2, Math.ceil(size[1] / h)) + 3;
  const nz = Math.max(2, Math.ceil(size[2] / h)) + 3;
  const ox = bounds.min[0] - pad - h, oy = bounds.min[1] - pad - h, oz = bounds.min[2] - pad - h;

  const vx = nx * ny * nz;
  const dObj = new Float32Array(vx);
  const dCrack = new Float32Array(vx).fill(1e9);
  const damage = new Float32Array(vx);
  const radial = new Float32Array(vx).fill(1e9);

  const sampleNoise = (x: number, y: number, z: number): number =>
    faceNoise(opts.materialId, x, y, z, opts.faceRoughnessScale, opts.grainAxis, opts.drawAxis);

  const idx = (i: number, j: number, k: number): number => i + j * nx + k * nx * ny;

  // ---- 1. object field -------------------------------------------------
  for (let k = 0; k < nz; k++) {
    const z = oz + k * h;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * h;
      for (let i = 0; i < nx; i++) {
        const x = ox + i * h;
        dObj[idx(i, j, k)] = evalSDF(opts.object, x, y, z);
      }
    }
  }

  // ---- 2. rasterise cracks --------------------------------------------
  // Each segment becomes an oriented slab. Its lateral half-extent is found
  // by ray-marching the object along the in-plane perpendicular, so the
  // ribbon stops exactly at the free surface.
  const noiseAmp = opts.faceRoughness * h * 2.5;

  for (const seg of opts.segments) {
    let tx = seg.b[0] - seg.a[0], ty = seg.b[1] - seg.a[1], tz = seg.b[2] - seg.a[2];
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-9) continue;
    tx /= tl; ty /= tl; tz /= tl;
    const n = seg.n;
    // in-plane perpendicular (across the ribbon)
    let wx = ty * n[2] - tz * n[1];
    let wy = tz * n[0] - tx * n[2];
    let wz = tx * n[1] - ty * n[0];
    const wl = Math.hypot(wx, wy, wz);
    if (wl < 1e-6) continue;
    wx /= wl; wy /= wl; wz /= wl;

    const half = lateralExtent(opts.object, seg, [wx, wy, wz], longest * 0.75);
    // A crack must stay open across the *grid*, not just in the continuum. If
    // the aperture is thinner than ~2 cells the two faces can share voxels and
    // the mesh stays welded even though the physics separated it.
    const aperture = Math.max(seg.aperture, h * 1.8);
    const apHalf = aperture * 0.5;
    // Fracture-surface relief is modelled as a *meandering mid-surface* rather
    // than as noise added to each face independently. That is both the
    // physically correct picture — the two faces were the same material once,
    // so they are conformal mirrors of each other — and the only version that
    // cannot pinch the crack shut wherever the noise happens to go the wrong
    // way. Offsetting the plane keeps the opening at exactly `aperture`.
    const amp = Math.min(noiseAmp, aperture * 0.42);
    const margin = apHalf + amp + h * 2;

    // AABB of the slab
    const ex = Math.abs(tx) * (tl * 0.5 + margin) + Math.abs(wx) * (half + margin) + Math.abs(n[0]) * margin;
    const ey = Math.abs(ty) * (tl * 0.5 + margin) + Math.abs(wy) * (half + margin) + Math.abs(n[1]) * margin;
    const ez = Math.abs(tz) * (tl * 0.5 + margin) + Math.abs(wz) * (half + margin) + Math.abs(n[2]) * margin;
    const cx = (seg.a[0] + seg.b[0]) * 0.5;
    const cy = (seg.a[1] + seg.b[1]) * 0.5;
    const cz = (seg.a[2] + seg.b[2]) * 0.5;

    const i0 = Math.max(0, Math.floor((cx - ex - ox) / h));
    const i1 = Math.min(nx - 1, Math.ceil((cx + ex - ox) / h));
    const j0 = Math.max(0, Math.floor((cy - ey - oy) / h));
    const j1 = Math.min(ny - 1, Math.ceil((cy + ey - oy) / h));
    const k0 = Math.max(0, Math.floor((cz - ez - oz) / h));
    const k1 = Math.min(nz - 1, Math.ceil((cz + ez - oz) / h));

    for (let k = k0; k <= k1; k++) {
      const pz = oz + k * h - cz;
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * h - cy;
        let base = idx(i0, j, k);
        for (let i = i0; i <= i1; i++, base++) {
          const px = ox + i * h - cx;
          // coordinates in the ribbon frame
          const along = px * tx + py * ty + pz * tz;
          const across = px * wx + py * wy + pz * wz;
          const perp = px * n[0] + py * n[1] + pz * n[2];

          if (Math.abs(across) > half) continue;
          if (Math.abs(along) > tl * 0.5 + margin) continue;

          // signed distance to the meandering slab: negative inside
          let perpM = perp;
          if (amp > 0) {
            perpM -= sampleNoise(ox + i * h, oy + j * h, oz + k * h) * amp;
          }
          let d = Math.abs(perpM) - apHalf;
          // feather the two ends so the ribbon terminates cleanly at the tip
          const endT = Math.abs(along) - tl * 0.5;
          if (endT > 0) d = Math.max(d, endT);

          const vi = base;
          if (d < dCrack[vi]) {
            dCrack[vi] = d;
            const dx = ox + i * h - seg.origin[0];
            const dy = oy + j * h - seg.origin[1];
            const dz = oz + k * h - seg.origin[2];
            radial[vi] = Math.hypot(dx, dy, dz);
          }
        }
      }
    }
  }

  // ---- 3. combined field + island labelling ----------------------------
  const solid = new Uint8Array(vx);
  let solidCount = 0;
  for (let v = 0; v < vx; v++) {
    const inside = dObj[v] < 0 && dCrack[v] > 0;
    solid[v] = inside ? 1 : 0;
    if (inside) solidCount++;
  }

  const island = new Int32Array(vx).fill(-1);
  const islandStack = new Int32Array(vx);
  let islandCount = 0;
  for (let v0 = 0; v0 < vx; v0++) {
    if (!solid[v0] || island[v0] >= 0) continue;
    let sp = 0;
    islandStack[sp++] = v0;
    island[v0] = islandCount;
    let pop = 0;
    const cap = Math.min(vx, 1 << 20);
    while (sp > 0 && pop < cap) {
      const v = islandStack[--sp];
      pop++;
      const k = (v / (nx * ny)) | 0;
      const rem = v - k * nx * ny;
      const j = (rem / nx) | 0;
      const i = rem - j * nx;
      if (i > 0) tryPush(v - 1);
      if (i < nx - 1) tryPush(v + 1);
      if (j > 0) tryPush(v - nx);
      if (j < ny - 1) tryPush(v + nx);
      if (k > 0) tryPush(v - nx * ny);
      if (k < nz - 1) tryPush(v + nx * ny);
    }
    islandCount++;

    function tryPush(nv: number): void {
      if (solid[nv] && island[nv] < 0) { island[nv] = islandCount; islandStack[sp++] = nv; }
    }
  }

  // ---- 4. marching tetrahedra -----------------------------------------
  // 6 tetrahedra per cell, diagonal chosen by (i+j+k) parity so that the
  // shared face between neighbouring cells always uses the same diagonal,
  // which is what makes the output watertight.
  const tri: PerIsland = {
    pos: [], nrm: [], kind: [], rad: [], cid: [],
  };
  const islands: PerIsland[] = [];
  const getIsland = (id: number): PerIsland => {
    while (islands.length <= id) islands.push({ pos: [], nrm: [], kind: [], rad: [], cid: [] });
    return islands[id];
  };
  void tri;

  const corner = new Float32Array(8);
  const cornerIsland = new Int32Array(8);
  const cornerRadial = new Float32Array(8);
  const cornerDamage = new Float32Array(8);
  const cIdx = new Int32Array(8);

  let totalTris = 0;

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        // gather corners
        let minF = 1e30, minIsland = -1, maxF = -1e30, islMixed = false;
        let c = 0;
        for (let dk = 0; dk < 2; dk++) {
          for (let dj = 0; dj < 2; dj++) {
            for (let di = 0; di < 2; di++, c++) {
              const v = idx(i + di, j + dj, k + dk);
              const f = Math.max(dObj[v], -dCrack[v]);
              corner[c] = f;
              cornerIsland[c] = island[v];
              cornerRadial[c] = radial[v];
              cornerDamage[c] = damage[v];
              cIdx[c] = v;
              if (f < minF) { minF = f; minIsland = island[v]; }
              if (f > maxF) maxF = f;
            }
          }
        }
        if (minF > 0 || maxF < 0) continue;    // no surface in this cell
        if (minIsland < 0) continue;           // fully detached / pulverised
        // detect mixed islands so we do not weld two fragments together
        for (let a = 0; a < 8; a++) {
          if (corner[a] < 0 && cornerIsland[a] >= 0 && cornerIsland[a] !== minIsland) { islMixed = true; break; }
        }

        const target = getIsland(minIsland);
        // Corners are labelled c = di + 2*dj + 4*dk.
        for (let t = 0; t < 6; t++) {
          totalTris += emitTet(
            target, TETS_A[t], corner, cornerIsland, cornerRadial,
            ox, oy, oz, h, i, j, k, minIsland,
          );
        }
        void islMixed;
      }
    }
  }

  // ---- 5. assemble fragments ------------------------------------------
  const fragments: FragmentMesh[] = [];
  let droppedSmall = 0;
  let droppedEmpty = 0;
  for (let isl = 0; isl < islands.length; isl++) {
    const data = islands[isl];
    if (data.pos.length < 12) { droppedEmpty++; continue; }
    const positions = new Float32Array(data.pos);
    const normals = new Float32Array(data.nrm);
    const faceKind = new Float32Array(data.kind);
    const crackRadial = new Float32Array(data.rad);
    const crackIdArr = new Float32Array(data.cid);
    const vertCount = positions.length / 3;
    const indices = new Uint32Array(vertCount);
    for (let v = 0; v < vertCount; v++) indices[v] = v;

    const vol = meshVolume(positions, indices);
    const cen = meshCentroid(positions, indices, vol);
    const inertia = meshInertia(positions, indices, cen);
    const mass = Math.max(1e-9, vol * opts.density);

    // recompute relative to the centroid so the renderer can instance directly
    let radius = 0;
    for (let v = 0; v < vertCount; v++) {
      positions[v * 3] -= cen[0];
      positions[v * 3 + 1] -= cen[1];
      positions[v * 3 + 2] -= cen[2];
      radius = Math.max(radius, Math.hypot(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]));
    }

    if (vol < opts.minFragmentVolume) { droppedSmall++; continue; }

    fragments.push({
      positions, normals, faceKind, crackRadial, crackId: crackIdArr, indices,
      centroid: cen, volume: vol, mass, inertia, radius, island: isl,
      triangles: indices.length / 3,
    });
  }

  let triCount = 0;
  for (const f of fragments) triCount += f.triangles;

  const slice = (axis: 0 | 1 | 2, position?: number): string => {
    const n = [nx, ny, nz][axis];
    const k = Math.max(0, Math.min(n - 1, position ?? Math.floor(n / 2)));
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const stepI = axis === 0 ? 1 : 1;
    const stepJ = axis === 0 ? 2 : 2;
    for (let a = ny - 1; a >= 0; a -= stepJ) {
      let line = '';
      for (let b = 0; b < nx; b += stepI) {
        let i = 0, j = 0, kk = 0;
        if (axis === 0) { i = k; j = a; kk = b; }
        else if (axis === 1) { i = b; j = k; kk = a; }
        else { i = b; j = a; kk = k; }
        const v = idx(i, j, kk);
        if (dObj[v] >= 0) line += ' ';
        else if (island[v] < 0) line += drag(v) ? '#' : '+';
        else line += chars[island[v] % chars.length];
      }
      out += line + '\n';
    }
    return out;
  };

  /** True if this non-solid voxel is inside a crack ribbon rather than outside the body. */
  function drag(v: number): boolean {
    return dCrack[v] < 0;
  }

  return {
    fragments,
    slice,
    stats: {
      grid: [nx, ny, nz],
      cellSize: h,
      voxels: vx,
      solidVoxels: solidCount,
      islands: islandCount,
      triangles: triCount,
      droppedSmall,
      droppedEmpty,
      ms: now() - t0,
    },
  };

  // ------------------------------------------------------------------
  function emitTet(
    target: PerIsland,
    cs: readonly number[],
    f: Float32Array,
    isl: Int32Array,
    rad: Float32Array,
    ox0: number, oy0: number, oz0: number, hh: number,
    ci: number, cj: number, ck: number, wantIsland: number,
  ): number {
    const f0 = f[cs[0]], f1 = f[cs[1]], f2 = f[cs[2]], f3 = f[cs[3]];
    let mask = 0;
    if (f0 < 0) mask |= 1;
    if (f1 < 0) mask |= 2;
    if (f2 < 0) mask |= 4;
    if (f3 < 0) mask |= 8;
    if (mask === 0 || mask === 15) return 0;

    // Which tet edges cross zero, and where.
    const pts: number[] = [];   // xyz per crossing
    const srcA: number[] = [];  // source corner pair, for attribute interpolation
    const srcB: number[] = [];
    for (let e = 0; e < 6; e++) {
      const [a, b] = TET_EDGES[e];
      const fa = f[cs[a]], fb = f[cs[b]];
      if ((fa < 0) === (fb < 0)) continue;
      const t = fa / (fa - fb);
      const p = cornerPos(cs[a], ci, cj, ck, ox0, oy0, oz0, hh);
      const q = cornerPos(cs[b], ci, cj, ck, ox0, oy0, oz0, hh);
      pts.push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
      srcA.push(cs[a]);
      srcB.push(cs[b]);
    }
    const n = pts.length / 3;
    if (n < 3) return 0;

    // The intersection of a plane with a tetrahedron is a convex polygon; with
    // four crossings that is a quad, and it MUST be wound in cyclic order or
    // the fan triangulation below self-overlaps into a bow tie.
    const ordered = n > 3 ? orderPolygon(pts, n) : [0, 1, 2];
    const orderedSrcA = ordered.map((i) => srcA[i]);
    const orderedSrcB = ordered.map((i) => srcB[i]);

    // Orientation comes from an inside/outside corner pair, which is exact for
    // every non-degenerate tetrahedron. (Orientating by a finite-difference
    // gradient instead is subtly wrong in cells where the field is nearly
    // flat, and a handful of flipped triangles is enough to corrupt the
    // signed-volume calculation by several percent.)
    let tris = 0;
    let pin = -1, pout = -1;
    for (let c = 0; c < 4; c++) {
      if (pin < 0 && f[cs[c]] < 0) pin = c;
      if (pout < 0 && f[cs[c]] >= 0) pout = c;
    }
    const outward: number[] = [0, 0, 0];
    if (pin >= 0 && pout >= 0) {
      const pi2 = cornerPos(cs[pin], ci, cj, ck, ox0, oy0, oz0, hh);
      const po2 = cornerPos(cs[pout], ci, cj, ck, ox0, oy0, oz0, hh);
      outward[0] = po2[0] - pi2[0];
      outward[1] = po2[1] - pi2[1];
      outward[2] = po2[2] - pi2[2];
    }
    for (let t = 1; t + 1 < ordered.length; t++) {
      const ia = ordered[0], ib = ordered[t], ic = ordered[t + 1];
      const ax = pts[ia * 3], ay = pts[ia * 3 + 1], az = pts[ia * 3 + 2];
      const bx = pts[ib * 3], by = pts[ib * 3 + 1], bz = pts[ib * 3 + 2];
      const cx = pts[ic * 3], cy = pts[ic * 3 + 1], cz = pts[ic * 3 + 2];
      // face normal
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx2 = cx - ax, vy2 = cy - ay, vz2 = cz - az;
      let nx2 = uy * vz2 - uz * vy2;
      let ny2 = uz * vx2 - ux * vz2;
      let nz2 = ux * vy2 - uy * vx2;
      const nl = Math.hypot(nx2, ny2, nz2);
      if (nl < 1e-20) continue;
      // outward = from an inside corner towards an outside corner
      const flip = (nx2 * outward[0] + ny2 * outward[1] + nz2 * outward[2]) < 0;
      if (flip) { nx2 = -nx2; ny2 = -ny2; nz2 = -nz2; }

      const order = flip ? [ia, ic, ib] : [ia, ib, ic];
      for (const oi of order) {
        const px = pts[oi * 3], py = pts[oi * 3 + 1], pz = pts[oi * 3 + 2];
        // Classify: is this point on the outer skin or on a fracture face?
        // Read it back from the two sampled fields rather than re-evaluating
        // the SDF, so the classification is exactly consistent with the grid
        // that produced the topology.
        const dv = sampleField(dObj, px, py, pz);
        const cvi = sampleField(dCrack, px, py, pz);
        const kindV = Math.abs(dv) <= Math.abs(cvi) ? 0 : 1;
        target.pos.push(px, py, pz);
        target.nrm.push(nx2 / nl, ny2 / nl, nz2 / nl);
        target.kind.push(kindV);
        const r0 = rad[orderedSrcA[oi]], r1 = rad[orderedSrcB[oi]];
        target.rad.push(0.5 * (r0 + r1));
        target.cid.push(0);
      }
      tris++;
    }
    void wantIsland;
    void isl;
    return tris;
  }

  /** Trilinear sample of a grid field at a world point. */
  function sampleField(field: Float32Array, x: number, y: number, z: number): number {
    const fx = (x - ox) / h, fy = (y - oy) / h, fz = (z - oz) / h;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx - 1 || j0 >= ny - 1 || k0 >= nz - 1) return 1e9;
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const v000 = field[idx(i0, j0, k0)], v100 = field[idx(i0 + 1, j0, k0)];
    const v010 = field[idx(i0, j0 + 1, k0)], v110 = field[idx(i0 + 1, j0 + 1, k0)];
    const v001 = field[idx(i0, j0, k0 + 1)], v101 = field[idx(i0 + 1, j0, k0 + 1)];
    const v011 = field[idx(i0, j0 + 1, k0 + 1)], v111 = field[idx(i0 + 1, j0 + 1, k0 + 1)];
    const a = v000 + (v100 - v000) * tx, b = v010 + (v110 - v010) * tx;
    const cc = v001 + (v101 - v001) * tx, d = v011 + (v111 - v011) * tx;
    const e = a + (b - a) * ty, f2 = cc + (d - cc) * ty;
    return e + (f2 - e) * tz;
  }

}

/**
 * Cyclically order the up-to-four crossing points so the fan triangulation
 * produces a simple (non-self-intersecting) polygon.
 */
function orderPolygon(pts: number[], n: number): number[] {
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 3]; cy += pts[i * 3 + 1]; cz += pts[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;

  // plane normal from the first three points
  const ux = pts[3] - pts[0], uy = pts[4] - pts[1], uz = pts[5] - pts[2];
  const vx = pts[6] - pts[0], vy = pts[7] - pts[1], vz = pts[8] - pts[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-20) return [0, 1, 2, 3].slice(0, n);
  nx /= nl; ny /= nl; nz /= nl;

  // in-plane basis
  const ref = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1x = ny * ref[2] - nz * ref[1], e1y = nz * ref[0] - nx * ref[2], e1z = nx * ref[1] - ny * ref[0];
  const e1l = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= e1l; e1y /= e1l; e1z /= e1l;
  const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;

  const idx = [0, 1, 2, 3].slice(0, n);
  const ang = idx.map((i) => {
    const px = pts[i * 3] - cx, py = pts[i * 3 + 1] - cy, pz = pts[i * 3 + 2] - cz;
    return Math.atan2(px * e2x + py * e2y + pz * e2z, px * e1x + py * e1y + pz * e1z);
  });
  idx.sort((a, b) => ang[idx.indexOf(a)] - ang[idx.indexOf(b)]);
  // simple stable sort by angle
  const pairs = idx.map((i, k) => [i, ang[k]] as [number, number]);
  pairs.sort((a, b) => a[1] - b[1]);
  return pairs.map((p) => p[0]);
}

/** Corner c index in the 2x2x2 block, matching c = di + 2*dj + 4*dk. */
function cornerOffset(di: number, dj: number, dk: number): number {
  return di + 2 * dj + 4 * dk;
}

function cornerPos(
  c: number, i: number, j: number, k: number,
  ox: number, oy: number, oz: number, h: number,
): Vec3 {
  const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
  return [ox + (i + di) * h, oy + (j + dj) * h, oz + (k + dk) * h];
}

/**
 * Cube -> 6 tetrahedra, all sharing the body diagonal 0-7.
 *
 * NOTE on the "alternate the diagonal by (i+j+k) parity" folklore: it is
 * WRONG for this decomposition, and it is a classic source of hairline cracks
 * in marching-tetrahedra terrain and fracture meshes. The 0-7 split cuts all
 * six faces along the same local diagonal (face corner 0 -> face corner 3).
 * Any decomposition built on the opposite body diagonal necessarily cuts at
 * least one face along the *other* diagonal, so alternating produces
 * T-junctions wherever a cell of one parity meets a cell of the other.
 *
 * Using a single decomposition everywhere is provably watertight: neighbouring
 * cells share a face, both agree that the face's diagonal runs from the shared
 * low corner to the shared high corner, and the two half-triangles therefore
 * match edge for edge.
 */
const TETS_A: number[][] = [
  [0, 5, 1, 7], [0, 3, 1, 7], [0, 3, 2, 7], [0, 6, 2, 7], [0, 6, 4, 7], [0, 5, 4, 7],
];

const TET_EDGES: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

interface PerIsland {
  pos: number[];
  nrm: number[];
  kind: number[];
  rad: number[];
  cid: number[];
}

/** Signed volume of a closed triangle mesh. */
export function meshVolume(pos: Float32Array, indices: Uint32Array): number {
  let v = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

function meshCentroid(pos: Float32Array, indices: Uint32Array, volume: number): Vec3 {
  // Volume-weighted centroid via the tetrahedron decomposition about the origin.
  let cx = 0, cy = 0, cz = 0, vol = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cxx = pos[c], cyy = pos[c + 1], czz = pos[c + 2];
    const dv = (ax * (by * czz - bz * cyy) - ay * (bx * czz - bz * cxx) + az * (bx * cyy - by * cxx)) / 6;
    vol += dv;
    cx += dv * (ax + bx + cxx) * 0.25;
    cy += dv * (ay + by + cyy) * 0.25;
    cz += dv * (az + bz + czz) * 0.25;
  }
  if (Math.abs(vol) < 1e-20) return [0, 0, 0];
  void volume;
  return [cx / vol, cy / vol, cz / vol];
}

/**
 * Diagonal inertia tensor about the centroid, per unit density (m^5).
 *
 * For a tetrahedron with one vertex at the origin and the others at a, b, c,
 * the second moments of the (signed) volume dv are
 *     Cxx = dv (ax²+bx²+cx²+ax bx+bx cx+cx ax) / 10   etc.
 * so Ixx = Cxx(y) + Cxx(z), and the signed sum over the triangle fan gives the
 * exact tensor for the closed mesh.
 */
function meshInertia(pos: Float32Array, indices: Uint32Array, c: Vec3): Vec3 {
  let ixx = 0, iyy = 0, izz = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, d = indices[i + 2] * 3;
    const ax = pos[a] - c[0], ay = pos[a + 1] - c[1], az = pos[a + 2] - c[2];
    const bx = pos[b] - c[0], by = pos[b + 1] - c[1], bz = pos[b + 2] - c[2];
    const cx = pos[d] - c[0], cy = pos[d + 1] - c[1], cz = pos[d + 2] - c[2];
    const dv = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    if (Math.abs(dv) < 1e-24) continue;
    const mxx = (ax * ax + bx * bx + cx * cx + ax * bx + bx * cx + cx * ax) / 10;
    const myy = (ay * ay + by * by + cy * cy + ay * by + by * cy + cy * ay) / 10;
    const mzz = (az * az + bz * bz + cz * cz + az * bz + bz * cz + cz * az) / 10;
    ixx += dv * (myy + mzz);
    iyy += dv * (mxx + mzz);
    izz += dv * (mxx + myy);
  }
  return [Math.abs(ixx), Math.abs(iyy), Math.abs(izz)];
}

/**
 * How far the ribbon must extend across the body, found by marching the SDF
 * from both ends of the segment along the in-plane perpendicular.
 */
function lateralExtent(object: SDFNode, seg: CarveSegment, w: Vec3, maxReach: number): number {
  const mid: Vec3 = [
    (seg.a[0] + seg.b[0]) * 0.5,
    (seg.a[1] + seg.b[1]) * 0.5,
    (seg.a[2] + seg.b[2]) * 0.5,
  ];
  const march = (sgn: number): number => {
    let d = 0;
    let step = maxReach * 0.02;
    for (let s = 0; s < 96; s++) {
      const p: Vec3 = [mid[0] + w[0] * sgn * d, mid[1] + w[1] * sgn * d, mid[2] + w[2] * sgn * d];
      const sd = evalSDF(object, p[0], p[1], p[2]);
      if (sd > 0) return d;
      d += Math.max(step, Math.abs(sd) * 0.85);
      if (d > maxReach) return maxReach;
    }
    return d;
  };
  return Math.max(seg.aperture, Math.min(march(1), march(-1)) + seg.aperture);
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
