/* ============================================================
 * Frontier · SDF Terrain Lab — Mountain builder
 *
 * Builds the base SDF height field (signed distance from the
 * y=0 sea plane to the implicit terrain surface) on an N×N grid
 * over a 100 m × 100 m square.
 *
 * Shape = multifractal gradient noise (fBm + ridged blend),
 * shaped by a radial *peak gradient* (1 at the summit, 0 at the
 * rim) + a linear tilt, with domain warping for organic form.
 * ============================================================ */

import { Perlin2D, fbm01, ridged, subseed } from './noise.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * @param {object} p
 * @param {number} p.N            grid nodes per side (resolution)
 * @param {number} p.worldSize    world extent in meters (default 100)
 * @param {number} p.seed
 * @param {number} p.frequency    base feature frequency (features across the map)
 * @param {number} p.octaves      fBm octaves
 * @param {number} p.gain         multifractal persistence (lacunarity gain)
 * @param {number} p.ridge        0..1 blend toward ridged multifractal
 * @param {number} p.peakHeight   summit height above sea level (m)
 * @param {number} p.peakRadius   distance where the peak fades to the rim (m)
 * @param {number} p.peakSharp    peak gradient exponent
 * @param {number} p.warp         domain warp amount 0..1
 * @param {number} p.tilt         linear tilt 0..1 (valley side stretch)
 * @param {number} p.seaLevel     base/sea level (m, usually negative)
 * @returns {{h: Float32Array, N: number, voxel: number, minH: number, maxH: number, meanH: number}}
 */
export function buildMountain(p) {
  const N = p.N | 0;
  const worldSize = p.worldSize ?? 100;
  const seed = (p.seed ?? 1) >>> 0;
  const voxel = worldSize / (N - 1);

  const nBase = new Perlin2D(seed);
  const nDet = new Perlin2D(subseed(seed, 0x51a7));
  const nWarp = new Perlin2D(subseed(seed, 0x9e37));
  const nStruct = new Perlin2D(subseed(seed, 0x7c1d));

  const s = p.frequency / worldSize;            // base spatial frequency
  const warpS = s * 0.55;                        // warp operates at lower freq
  const tiltAngle = (seed % 628) / 100;          // deterministic per seed
  const tiltCos = Math.cos(tiltAngle);
  const tiltSin = Math.sin(tiltAngle);
  // per-seed summit offset so peaks land organically, not dead-centre
  const peakX = (((seed >> 3) % 25) - 12) * 0.9;
  const peakZ = (((seed >> 7) % 25) - 12) * 0.9;

  const h = new Float32Array(N * N);
  const valley = new Float32Array(N * N); // drainage-valley attractor mask (0..1)
  let minH = Infinity, maxH = -Infinity, sumH = 0;

  for (let j = 0; j < N; j++) {
    const z = (j - (N - 1) / 2) * voxel;
    for (let i = 0; i < N; i++) {
      const x = (i - (N - 1) / 2) * voxel;

      // ---- domain warp (organic displacement) ----
      let wx = x * s + p.warp * 1.7 * nWarp.noise(x * warpS + 31.4, z * warpS - 17.8);
      let wz = z * s + p.warp * 1.7 * nWarp.noise(x * warpS - 51.2, z * warpS + 44.9);

      // ---- multifractal: fBm blended with ridged multifractal ----
      const f = fbm01(nBase, wx, wz, {
        octaves: p.octaves,
        lacunarity: 2.05,
        gain: p.gain,
      });
      const r = ridged(nBase, wx * 0.9 + 7.3, wz * 0.9 - 3.1, {
        octaves: Math.max(2, p.octaves - 1),
        lacunarity: 2.2,
        gain: p.gain + 0.08,
      });
      const base = f * (1 - p.ridge) + r * p.ridge;   // ~[0,1]

      // ---- radial peak gradient: 1 at summit -> 0 at rim ----
      // Two components: a steep core peak + a broad, gentle foothill
      // skirt, so the mountain has low grasslands at its base and a
      // dramatic summit — the classic profile.
      // Tilt shifts the radial domain so the upwind flank is stretched
      // into a longer valley side.
      const dx = x - peakX, dz = z - peakZ;
      const dist0 = Math.sqrt(dx * dx + dz * dz);
      // Gentle tilt (small multiplier) — a long valley side, but not so
      // strong that it twists the upper-flank flow into a sideways saddle.
      const dist = Math.max(0.001,
        dist0 - p.tilt * (x * tiltCos + z * tiltSin) * 0.45);
      // ---- azimuthal asymmetry ----
      // Modulate the mountain's radius by compass direction, sampled on
      // the unit circle in noise space (seamless around 360°). This
      // stretches one flank into a long valley and steepens the opposite
      // face — kills the "perfect concentric dome" that reads as fake,
      // and lets erosion break into a natural dendritic pattern.
      const theta = Math.atan2(dz, dx);
      const angK = 2.4;
      const ang = fbm01(nWarp,
        Math.cos(theta) * angK + 40.2, Math.sin(theta) * angK - 12.9,
        { octaves: 2, lacunarity: 2.3, gain: 0.5 });
      const lobeR = 0.70 + 0.60 * ang;                  // 0.70..1.30
      const R2 = p.peakRadius * 1.42 * lobeR;           // core radius (broad, gentle flank)
      const R1 = p.peakRadius * 2.05 * (0.88 + 0.24 * ang); // skirt radius
      const d2 = dist / R2;
      const d1 = dist / R1;
      const mCore = Math.pow(Math.max(0, 1 - d2 * d2), p.peakSharp);
      const mEnv = Math.pow(Math.max(0, 1 - d1), 1.6);  // broad radial envelope

      // ---- structural ridges ("pre-erosion") ----
      // Gaea's core principle: the base must already look like a mountain
      // BEFORE erosion, or erosion invents a uniform groove pattern from
      // scratch. A domain-warped world-space RIDGED field, sampled at a
      // frequency that yields several spurs around the mountain, shapes
      // the flank into real radial spurs (crests) and valleys. Drainage
      // is funneled into the valleys, so hydraulic erosion REFINES them
      // into a dendritic network instead of stamping parallel slits.
      const sRidge = s * 1.7;                            // ~4 features / 100 m
      const rw1 = nWarp.noise(x * sRidge * 0.5 + 13.7, z * sRidge * 0.5 - 41.2);
      const rw2 = nWarp.noise(x * sRidge * 0.5 - 37.9, z * sRidge * 0.5 + 28.4);
      const spine = ridged(nStruct,
        (x * sRidge + rw1 * 1.8) * (1.0 + p.tilt * 0.35),
        (z * sRidge + rw2 * 1.8) * (1.0 - p.tilt * 0.35),
        { octaves: 3, lacunarity: 2.1, gain: 0.5 });
      const spineSharp = Math.pow(spine, 1.3);           // sharpen crests, keep valleys low
      // Strong world-space spurs: the flank height swings ±30% around
      // the radial profile. This is what bends the drainage: on a pure
      // radial dome every stream runs straight out (parallel spokes —
      // the #1 fake tell). Ridged structure gives each stream a
      // structurally-defined azimuth, so the network reads dendritic.
      const flank = mEnv * (0.35 + 0.65 * spineSharp) * (1 - mCore * 0.8);

      // ---- radial drainage valleys (dendritic basins) ----
      // ~5 noise-perturbed radial VALLEYS cut into the flank as real
      // incised grooves (sampled seamlessly on the compass circle).
      // Amplitude modulation alone does NOT funnel flow — only an
      // actual height deficit makes water migrate sideways into the
      // valley and run down it. With real interfluves, any erosion
      // solver carves 5-7 main valleys + dendritic tributaries and
      // the hillslopes between stay clean (Gaea's pre-erosion
      // principle: the base must already look like a mountain).
      // The window keeps the summit core clean (stable peak height)
      // and the lowland plain intact.
      // The mask defines 5 compass sectors (5th-order harmonic — a
      // plain noise sample on the circle lumps into one giant dip; a
      // per-seed phase keeps them off-axis, and seamless per-sector
      // noise varies each sector's strength). It guides the erosion
      // engine's canyon attractor and modulates the lowland below;
      // it is deliberately NOT cut into the height (see note below).
      const nSect = 5;
      const vPhase = nStruct.noise(5.5, 9.1) * 2.0;
      const vCos = Math.cos(theta * nSect + vPhase);
      const vIrreg = 0.72 + 0.56 * fbm01(nStruct,
        Math.cos(theta) * 2.3 + 1.2, Math.sin(theta) * 2.3 - 0.7,
        { octaves: 2, lacunarity: 2.1, gain: 0.5 });
      // exponent 5 → a sharp V: the axis dominates the local gradient
      // (restoring slope > relief noise), so routed flow STAYS on the
      // valley axis instead of wandering onto the flank
      const valleyMask = Math.pow(Math.max(0, -vCos), 5.0) * vIrreg;
      // Valleys run ALL the way to the coast (bays) — this is what makes
      // them capture drainage: the interfluves (valleyMask≈0) stay high
      // at the shoreline as headlands, so radial runoff can't escape
      // around the valleys and must run down them to the sea.
      // The window keeps the summit core clean (stable peak height).
      const vWindow = smoothstep(0.30, 0.55, d1) * (1 - mCore * 0.85);

      let m = 0.85 * mCore + flank;
      // only the last sliver at the map rim is softened — the terrain
      // continues as lowland to the edge (no circular island cliff)
      const rim = Math.max(Math.abs(x), Math.abs(z)) / (worldSize * 0.5);
      m *= 1 - smoothstep(0.94, 1.0, rim);

      // ---- world-space relief + fine detail, masked by the profile ----
      // The relief is sampled in world space so ridge/valley structure
      // crosses the radial profile like real mountain structure,
      // instead of wrapping around the peak like bumps on a ball.
      const det = fbm01(nDet, x * s * 3.4 + 91.2, z * s * 3.4 - 47.5, {
        octaves: 3, lacunarity: 2.3, gain: 0.5,
      }) - 0.5;
      const midRelief = fbm01(nDet, x * s * 1.35 - 33.7, z * s * 1.35 + 21.2, {
        octaves: 3, lacunarity: 2.1, gain: 0.5,
      }) - 0.5;

      const peakAmp = p.peakHeight * m * (0.80 + 0.26 * base);
      // flank relief kept moderate: if the hillslope noise rivals the
      // drainage valleys in height it scatters the flow and no solver
      // can concentrate it — clean slopes + strong valleys let the
      // erosion do the detailing (real mountains: smooth hillsides,
      // detailed drainage).
      // The valley FLOOR is kept clean: relief noise there rivals the
      // floor's restoring gradient and scatters the flow off-axis.
      // Outside the valleys the full relief stays (the hillslopes
      // need it for interfluve structure).
      const floorClean = 1 - 0.75 * Math.min(1, valleyMask);
      const reliefAmp = p.peakHeight * 0.10 * m * midRelief * 2.0 * floorClean;
      const detailAmp = p.peakHeight * 0.055 * m * det * 2.0 * floorClean;

      // ---- broad low foothills across the whole map ----
      // Low-frequency relief that keeps most of the 100 m patch dry
      // lowland (grass/dirt, piedmont fans) instead of a flooded
      // shelf. Suppressed under the core so the peak stands up clean.
      const plainN = fbm01(nWarp, x * s * 0.38 + 3.1, z * s * 0.38 - 7.7, {
        octaves: 3, lacunarity: 2.1, gain: 0.5,
      });
      // The lowland follows the shoreline: high at the interfluves
      // (headlands above the waterline) and cut down at the valleys
      // (bays below it). This is what forces the drainage — radial
      // runoff reaches the shore, hits a headland, and must turn into
      // the nearest bay/valley instead of escaping to the sea directly.
      const plainAmp = p.peakHeight * 0.14
        * (1.35 - 0.75 * valleyMask)
        * (0.10 + 0.90 * plainN)
        * (1 - smoothstep(0.12, 0.75, mCore));

      // low-frequency undulation in the low ground → irregular coast
      // line and a non-flat seafloor (fades out up the mountain)
      const shore = fbm01(nWarp, x * s * 0.55 + 5.5, z * s * 0.55 - 3.3, {
        octaves: 2, lacunarity: 2.0, gain: 0.5,
      }) - 0.5;
      const shoreAmp = shore * 2.4 * (1 - m);

      // shelf sits well below the waterline so the lowland plain crosses
      // the waterline → an irregular coastline with bays + beach.
      const hv = (p.seaLevel - 5.5) + peakAmp + plainAmp + reliefAmp + detailAmp + shoreAmp;
      h[j * N + i] = hv;
      valley[j * N + i] = valleyMask * vWindow;
      if (hv < minH) minH = hv;
      if (hv > maxH) maxH = hv;
      sumH += hv;
    }
  }

  return { h, N, voxel, minH, maxH, meanH: sumH / (N * N), valley };
}
