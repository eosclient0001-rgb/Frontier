/**
 * 3D Low-Poly N-Gon Rock Generator (Blender-grade Polyhedral SDF Synthesizer)
 * Creates solid, well-proportioned low-poly polygonal rock bodies with flat n-gon facets,
 * strata bedding, and organic asymmetry.
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const ROCK_PRESETS = {
  granite_boulder: {
    name: "Granite Cleavage Boulder",
    description: "Solid plutonic block with angular polyhedral n-gon facets and crystalline jointing",
    shapeType: "polyhedral",
    facets: 14,
    asymmetry: [1.2, 0.95, 1.1],
    baseRoundness: 0.2,
    noiseAmp: 0.12,
    noiseFreq: 0.85,
    strataAmp: 0.04,
    strataFreq: 2.2,
    strataDip: 15,
    mineral: "granite",
    hardness: 1.4,
  },
  sandstone_slab: {
    name: "Sedimentary Sandstone Slab",
    description: "Layered sedimentary rock with prominent horizontal bedding planes",
    shapeType: "slab",
    facets: 10,
    asymmetry: [1.4, 0.7, 1.2],
    baseRoundness: 0.25,
    noiseAmp: 0.1,
    noiseFreq: 0.75,
    strataAmp: 0.14,
    strataFreq: 3.2,
    strataDip: 18,
    mineral: "sandstone",
    hardness: 0.9,
  },
  river_cobble: {
    name: "Weathered River Tor / Cobble",
    description: "Water-smoothed rounded boulder with beveled polygonal facet edges",
    shapeType: "ellipsoid",
    facets: 8,
    asymmetry: [1.25, 0.85, 1.05],
    baseRoundness: 0.65,
    noiseAmp: 0.07,
    noiseFreq: 0.9,
    strataAmp: 0.02,
    strataFreq: 2.0,
    strataDip: 0,
    mineral: "quartzite",
    hardness: 1.6,
  },
  columnar_basalt: {
    name: "Columnar Basalt Joint",
    description: "Hexagonal prismatic volcanic cooling column with sharp vertical n-gon facets",
    shapeType: "prism",
    facets: 6,
    asymmetry: [0.85, 1.5, 0.85],
    baseRoundness: 0.1,
    noiseAmp: 0.08,
    noiseFreq: 1.0,
    strataAmp: 0.05,
    strataFreq: 2.8,
    strataDip: 5,
    mineral: "basalt",
    hardness: 1.5,
  },
  cliff_shard: {
    name: "Jagged Monolith Shard",
    description: "High-energy rockfall monolith with sharp tectonic cleavage planes",
    shapeType: "shard",
    facets: 16,
    asymmetry: [1.1, 1.4, 0.9],
    baseRoundness: 0.1,
    noiseAmp: 0.16,
    noiseFreq: 0.9,
    strataAmp: 0.05,
    strataFreq: 2.8,
    strataDip: 35,
    mineral: "slate",
    hardness: 1.3,
  },
  desert_ventifact: {
    name: "Desert Ventifact",
    description: "Wind-sculpted dreikanter with aerodynamic keel facets and fluted polish",
    shapeType: "ventifact",
    facets: 10,
    asymmetry: [1.3, 0.8, 1.1],
    baseRoundness: 0.35,
    noiseAmp: 0.1,
    noiseFreq: 0.8,
    strataAmp: 0.07,
    strataFreq: 2.8,
    strataDip: 10,
    mineral: "red_sandstone",
    hardness: 1.1,
  },
  meteorite: {
    name: "Impact Meteorite (Regmaglypts)",
    description: "Extraterrestrial chondrite with thumbprint ablation cavities",
    shapeType: "meteorite",
    facets: 12,
    asymmetry: [1.05, 0.95, 1.1],
    baseRoundness: 0.45,
    noiseAmp: 0.18,
    noiseFreq: 1.1,
    strataAmp: 0.0,
    strataFreq: 1.0,
    strataDip: 0,
    mineral: "obsidian",
    hardness: 1.8,
  },
};

export class RockGenerator {
  constructor(options = {}) {
    this.nx = options.nx || 64;
    this.ny = options.ny || 64;
    this.nz = options.nz || 64;
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
   * Generates a solid low-poly base rock volume with polygonal n-gon facets
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
    const roundness = p.baseRoundness !== undefined ? p.baseRoundness : 0.2;
    const noiseAmp = p.noiseAmp !== undefined ? p.noiseAmp : 0.12;
    const noiseFreq = p.noiseFreq !== undefined ? p.noiseFreq : 0.85;
    const strataAmp = p.strataAmp !== undefined ? p.strataAmp : 0.04;
    const strataFreq = p.strataFreq || 2.2;
    const strataDipRad = ((p.strataDip || 15) * Math.PI) / 180;

    // Generate polyhedral clipping planes for clean n-gon polygonal faces
    const planes = [];
    if (p.shapeType === "prism") {
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides + (rng() - 0.5) * 0.1;
        const dist = baseRadius * (0.85 + rng() * 0.15);
        planes.push({
          nx: Math.cos(angle),
          ny: (rng() - 0.5) * 0.1,
          nz: Math.sin(angle),
          d: dist,
        });
      }
      planes.push({ nx: 0, ny: 1.0, nz: 0, d: baseRadius * 1.3 });
      planes.push({ nx: 0, ny: -1.0, nz: 0, d: baseRadius * 1.3 });
    } else {
      for (let i = 0; i < numFacets; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / numFacets);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5) + rng() * 0.2;

        let nxVal = Math.sin(phi) * Math.cos(theta);
        let nyVal = Math.cos(phi);
        let nzVal = Math.sin(phi) * Math.sin(theta);

        const len = Math.hypot(nxVal, nyVal, nzVal) || 1.0;
        nxVal /= len;
        nyVal /= len;
        nzVal /= len;

        const dist = baseRadius * (0.88 + rng() * 0.28);
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

          const px = wx / asymX;
          const py = wy / asymY;
          const pz = wz / asymZ;

          // 1. Base Ellipsoid Distance
          const distEllipsoid = Math.hypot(px, py, pz) - baseRadius;

          // 2. Polyhedral N-Gon Facet Half-Spaces
          let distPoly = -100.0;
          for (let i = 0; i < planes.length; i++) {
            const pl = planes[i];
            const dot = px * pl.nx + py * pl.ny + pz * pl.nz - pl.d;
            if (dot > distPoly) {
              distPoly = dot;
            }
          }

          const dBase = distPoly * (1.0 - roundness) + distEllipsoid * roundness;

          // 3. Low-frequency organic boulder displacement
          const n1 = noise.fBm3D(px * noiseFreq, py * noiseFreq, pz * noiseFreq, 3, 2.0, 0.5);
          const displacement = (n1 - 0.5) * 2.0 * noiseAmp;

          // 4. Geological Strata Bedding
          const strataCoord = py * cosDip + pz * sinDip;
          const strataNoise = Math.sin(strataCoord * strataFreq * Math.PI) * strataAmp;
          const strataHard = 1.0 + Math.sin(strataCoord * strataFreq * Math.PI + 0.4) * 0.35;

          const finalDist = dBase + displacement + strataNoise;
          this.sdf[idx] = finalDist;
          this.hardness[idx] = Math.max(0.3, (p.hardness || 1.2) * strataHard);
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
