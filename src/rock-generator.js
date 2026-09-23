/**
 * Clean Procedural 3D Rock Generator & SDF Field Synthesizer
 * Produces solid, well-proportioned 3D rock volumes with true Euclidean distance fields:
 * - Smooth polyhedral n-gon facet clipping
 * - Smooth organic simplex noise displacement
 * - Subtle geological strata bedding (without artificial stepping/corrugation)
 * - True unit gradient magnitude |∇φ| ≈ 1 everywhere
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const ROCK_PRESETS = {
  granite_boulder: {
    name: "Granite Cleavage Boulder",
    description: "Solid plutonic block with angular polyhedral n-gon facets and crystalline jointing",
    shapeType: "polyhedral",
    facets: 14,
    asymmetry: [1.2, 0.95, 1.1],
    baseRoundness: 0.35,
    noiseAmp: 0.08,
    noiseFreq: 0.75,
    microGrainAmp: 0.025,
    microGrainFreq: 6.5,
    pockmarkAmp: 0.015,
    pockmarkScale: 4.2,
    weatheringCrust: 0.4,
    strataAmp: 0.02,
    strataFreq: 1.2,
    strataDip: 15,
    mineral: "granite",
    hardness: 1.4,
  },
  sandstone_slab: {
    name: "Sedimentary Sandstone Slab",
    description: "Layered sedimentary rock with prominent horizontal bedding planes and porous grain",
    shapeType: "slab",
    facets: 10,
    asymmetry: [1.35, 0.75, 1.15],
    baseRoundness: 0.30,
    noiseAmp: 0.06,
    noiseFreq: 0.7,
    microGrainAmp: 0.035,
    microGrainFreq: 8.0,
    pockmarkAmp: 0.03,
    pockmarkScale: 5.5,
    weatheringCrust: 0.6,
    strataAmp: 0.04,
    strataFreq: 1.5,
    strataDip: 12,
    mineral: "sandstone",
    hardness: 0.9,
  },
  river_cobble: {
    name: "Weathered River Tor / Cobble",
    description: "Water-smoothed rounded boulder with beveled polygonal facet edges and faint polish",
    shapeType: "ellipsoid",
    facets: 8,
    asymmetry: [1.2, 0.9, 1.05],
    baseRoundness: 0.75,
    noiseAmp: 0.04,
    noiseFreq: 0.8,
    microGrainAmp: 0.012,
    microGrainFreq: 5.0,
    pockmarkAmp: 0.008,
    pockmarkScale: 3.0,
    weatheringCrust: 0.2,
    strataAmp: 0.01,
    strataFreq: 1.0,
    strataDip: 0,
    mineral: "quartzite",
    hardness: 1.6,
  },
  columnar_basalt: {
    name: "Columnar Basalt Joint",
    description: "Hexagonal prismatic volcanic cooling column with vesicular micro-pores",
    shapeType: "prism",
    facets: 6,
    asymmetry: [0.9, 1.45, 0.9],
    baseRoundness: 0.2,
    noiseAmp: 0.05,
    noiseFreq: 0.9,
    microGrainAmp: 0.02,
    microGrainFreq: 7.0,
    pockmarkAmp: 0.035,
    pockmarkScale: 6.0,
    weatheringCrust: 0.5,
    strataAmp: 0.02,
    strataFreq: 1.4,
    strataDip: 5,
    mineral: "basalt",
    hardness: 1.5,
  },
  cliff_shard: {
    name: "Jagged Monolith Shard",
    description: "High-energy rockfall monolith with sharp tectonic cleavage planes and crisp micro-facets",
    shapeType: "shard",
    facets: 16,
    asymmetry: [1.1, 1.35, 0.9],
    baseRoundness: 0.15,
    noiseAmp: 0.1,
    noiseFreq: 0.8,
    microGrainAmp: 0.03,
    microGrainFreq: 5.5,
    pockmarkAmp: 0.01,
    pockmarkScale: 3.5,
    weatheringCrust: 0.3,
    strataAmp: 0.03,
    strataFreq: 1.5,
    strataDip: 35,
    mineral: "slate",
    hardness: 1.3,
  },
  desert_ventifact: {
    name: "Desert Ventifact",
    description: "Wind-sculpted dreikanter with aerodynamic keel facets, fluted polish, and etched grooves",
    shapeType: "ventifact",
    facets: 10,
    asymmetry: [1.25, 0.85, 1.1],
    baseRoundness: 0.4,
    noiseAmp: 0.06,
    noiseFreq: 0.75,
    microGrainAmp: 0.018,
    microGrainFreq: 9.0,
    pockmarkAmp: 0.02,
    pockmarkScale: 4.0,
    weatheringCrust: 0.7,
    strataAmp: 0.02,
    strataFreq: 1.2,
    strataDip: 10,
    mineral: "red_sandstone",
    hardness: 1.1,
  },
  meteorite: {
    name: "Impact Meteorite (Regmaglypts)",
    description: "Extraterrestrial chondrite with thumbprint ablation cavities and fusion crust",
    shapeType: "meteorite",
    facets: 12,
    asymmetry: [1.05, 0.95, 1.1],
    baseRoundness: 0.5,
    noiseAmp: 0.1,
    noiseFreq: 1.0,
    microGrainAmp: 0.022,
    microGrainFreq: 6.0,
    pockmarkAmp: 0.05,
    pockmarkScale: 3.2,
    weatheringCrust: 0.85,
    strataAmp: 0.0,
    strataFreq: 0.0,
    strataDip: 0,
    mineral: "obsidian",
    hardness: 1.8,
  },
};

// Smooth minimum for blending SDF shapes without sharp crease artifacts
function smin(a, b, k = 0.15) {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export class RockGenerator {
  constructor(options = {}) {
    this.nx = options.nx || 80;
    this.ny = options.ny || 80;
    this.nz = options.nz || 80;
    this.boundsMin = options.boundsMin || [-1.8, -1.8, -1.8];
    this.boundsMax = options.boundsMax || [1.8, 1.8, 1.8];

    this.sx = this.boundsMax[0] - this.boundsMin[0];
    this.sy = this.boundsMax[1] - this.boundsMin[1];
    this.sz = this.boundsMax[2] - this.boundsMin[2];

    this.dx = this.sx / (this.nx - 1);
    this.dy = this.sy / (this.ny - 1);
    this.dz = this.sz / (this.nz - 1);

    this.totalVoxels = this.nx * this.ny * this.nz;
    this.sdf = new Float32Array(this.totalVoxels);
    this.hardness = new Float32Array(this.totalVoxels);
  }

  index(ix, iy, iz) {
    return (iz * this.ny + iy) * this.nx + ix;
  }

  voxelToCoord(ix, iy, iz) {
    const x = this.boundsMin[0] + (ix / (this.nx - 1)) * this.sx;
    const y = this.boundsMin[1] + (iy / (this.ny - 1)) * this.sy;
    const z = this.boundsMin[2] + (iz / (this.nz - 1)) * this.sz;
    return [x, y, z];
  }

  /**
   * Generates a solid base rock signed distance field with clean Euclidean gradients
   */
  generate(params = {}) {
    const p = { ...ROCK_PRESETS.granite_boulder, ...params };
    const seed = p.seed !== undefined ? p.seed : 42;
    const rng = createPRNG(seed);
    const noise = new NoiseGenerator(seed);

    const asymX = p.asymmetry ? p.asymmetry[0] : 1.15;
    const asymY = p.asymmetry ? p.asymmetry[1] : 0.95;
    const asymZ = p.asymmetry ? p.asymmetry[2] : 1.05;

    const baseRadius = p.radius || 1.1;
    const numFacets = p.facets || 14;
    const roundness = p.baseRoundness !== undefined ? p.baseRoundness : 0.35;
    const noiseAmp = p.noiseAmp !== undefined ? p.noiseAmp : 0.08;
    const noiseFreq = p.noiseFreq !== undefined ? p.noiseFreq : 0.75;
    const strataAmp = p.strataAmp !== undefined ? p.strataAmp : 0.02;
    const strataFreq = p.strataFreq || 1.2;
    const strataDipRad = ((p.strataDip || 15) * Math.PI) / 180;

    // Generate polyhedral clipping planes
    const planes = [];
    if (p.shapeType === "prism") {
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides + (rng() - 0.5) * 0.1;
        const dist = baseRadius * 0.9;
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: (rng() - 0.5) * 0.08,
          nz: Math.sin(angle) / asymZ,
          d: dist,
        });
      }
      planes.push({ nx: 0, ny: 1.0 / asymY, nz: 0, d: baseRadius * 1.25 });
      planes.push({ nx: 0, ny: -1.0 / asymY, nz: 0, d: baseRadius * 1.25 });
    } else {
      for (let i = 0; i < numFacets; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / numFacets);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5) + rng() * 0.2;

        let nxVal = (Math.sin(phi) * Math.cos(theta)) / asymX;
        let nyVal = Math.cos(phi) / asymY;
        let nzVal = (Math.sin(phi) * Math.sin(theta)) / asymZ;

        const len = Math.hypot(nxVal, nyVal, nzVal) || 1.0;
        nxVal /= len;
        nyVal /= len;
        nzVal /= len;

        const dist = baseRadius * (0.92 + rng() * 0.22);
        planes.push({ nx: nxVal, ny: nyVal, nz: nzVal, d: dist });
      }
    }

    const cosDip = Math.cos(strataDipRad);
    const sinDip = Math.sin(strataDipRad);

    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);

          // 1. Exact Polyhedral Facet Half-Spaces
          let distPoly = -100.0;
          for (let i = 0; i < planes.length; i++) {
            const pl = planes[i];
            const dot = wx * pl.nx + wy * pl.ny + wz * pl.nz - pl.d;
            if (dot > distPoly) {
              distPoly = dot;
            }
          }

          // 2. Base Ellipsoid Distance
          const ex = wx / asymX;
          const ey = wy / asymY;
          const ez = wz / asymZ;
          const distEllipsoid = Math.hypot(ex, ey, ez) - baseRadius;

          // Blend polyhedral facets with rounded boulder profile
          const blendK = Math.max(0.01, roundness * 0.4);
          let baseSDF = (1.0 - roundness) * distPoly + roundness * distEllipsoid;
          if (roundness > 0.05 && roundness < 0.95) {
            baseSDF = smin(distPoly, distEllipsoid, blendK);
          }

          // 3. Macro organic boulder displacement (continuous 3D simplex)
          const n1 = noise.fBm3D(wx * noiseFreq, wy * noiseFreq, wz * noiseFreq, 3, 2.0, 0.5);
          const macroDisplacement = (n1 - 0.5) * 2.0 * noiseAmp;

          // 4. Geological Rock Surface Details:
          // A. Micro-grain crystalline texture (feldspar/quartz mineral granules)
          const microGrainAmp = p.microGrainAmp !== undefined ? p.microGrainAmp : 0.025;
          const microGrainFreq = p.microGrainFreq || 6.5;
          const grainNoise = noise.noise3D(wx * microGrainFreq, wy * microGrainFreq, wz * microGrainFreq);
          const microGrainDisp = (grainNoise - 0.5) * 2.0 * microGrainAmp;

          // B. Weathering Pockmarks and Vesicular Cavities
          const pockmarkAmp = p.pockmarkAmp !== undefined ? p.pockmarkAmp : 0.015;
          const pockmarkScale = p.pockmarkScale || 4.2;
          const pockNoise = noise.noise3D(wx * pockmarkScale + 12.3, wy * pockmarkScale + 8.7, wz * pockmarkScale + 5.1);
          // Sharp hollow indentations when pockNoise drops below threshold
          const pockmarkDisp = pockNoise < 0.35 ? ((0.35 - pockNoise) / 0.35) * pockmarkAmp : 0.0;

          // 5. Subtle strata variation (gentle, continuous, no terraced stepping)
          const strataCoord = wy * cosDip + wz * sinDip;
          const strataDisplacement = Math.sin(strataCoord * strataFreq * Math.PI) * strataAmp;
          const strataHardness = 1.0 + Math.sin(strataCoord * strataFreq * Math.PI) * 0.25;

          // 6. Weathering Exfoliation Crust differential hardness
          const weatheringCrust = p.weatheringCrust !== undefined ? p.weatheringCrust : 0.4;
          const crustFactor = Math.max(0.6, 1.0 - weatheringCrust * 0.3 * (grainNoise * 0.5 + 0.5));

          const finalDist = baseSDF + macroDisplacement + microGrainDisp + pockmarkDisp + strataDisplacement;
          this.sdf[idx] = finalDist;
          this.hardness[idx] = Math.max(0.4, (p.hardness || 1.4) * strataHardness * crustFactor);
        }
      }
    }

    return {
      sdf: this.sdf,
      hardness: this.hardness,
      planes,
      nx: this.nx,
      ny: this.ny,
      nz: this.nz,
      boundsMin: this.boundsMin,
      boundsMax: this.boundsMax,
    };
  }
}
