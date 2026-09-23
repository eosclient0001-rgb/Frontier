/**
 * Procedural 3D Rock Generator & SDF Field Synthesizer
 * 
 * Features crisp, geologically authentic rock archetypes:
 * 1. Granite Cleavage Boulder (angular polyhedral crystalline block)
 * 2. Vertical Cliff Monolith (sheer vertical walls, overhangs, stepped ledges)
 * 3. Sedimentary Sandstone Slab (horizontal stratified flagstone tablet)
 * 4. Hexagonal Columnar Basalt (prismatic volcanic joint column)
 * 5. Sharp Scree Stone / Small Gravel (angular jagged fragments)
 * 6. Smooth River Pebble / Cobble (water-worn rounded stone with beveled facets)
 * 7. Alpine Mountain Spire / Crag (sharp towering pinnacle with razor arêtes)
 * 8. Desert Ventifact / Dreikanter (aerodynamic keel facets)
 * 9. Crystal Geode Cluster (sharp geometric quartz/calcite terminations)
 */

import { NoiseGenerator, createPRNG } from "./math-noise.js";

export const ROCK_PRESETS = {
  granite_boulder: {
    id: "granite_boulder",
    name: "Granite Cleavage Boulder",
    category: "Boulders",
    description: "Solid plutonic block with crisp planar cleavage facets and crystalline jointing",
    shapeType: "polyhedral",
    facets: 14,
    asymmetry: [1.15, 0.95, 1.05],
    baseRoundness: 0.20,
    noiseAmp: 0.03,
    noiseFreq: 0.8,
    facetSharpness: 0.95,
    microGrainAmp: 0.015,
    pockmarkAmp: 0.005,
    strataAmp: 0.0,
    strataFreq: 1.0,
    strataDip: 15,
    mineral: "granite",
    hardness: 1.5,
  },
  cliff_monolith: {
    id: "cliff_monolith",
    name: "Vertical Cliff Face / Monolith",
    category: "Cliffs",
    description: "Towering vertical shear rock face with planar joint cleavage and stepped ledges",
    shapeType: "cliff",
    facets: 18,
    asymmetry: [1.3, 1.6, 0.85],
    baseRoundness: 0.05,
    noiseAmp: 0.02,
    noiseFreq: 0.6,
    facetSharpness: 1.0,
    microGrainAmp: 0.01,
    pockmarkAmp: 0.008,
    strataAmp: 0.035,
    strataFreq: 2.2,
    strataDip: 4,
    mineral: "slate",
    hardness: 1.6,
  },
  sandstone_slab: {
    id: "sandstone_slab",
    name: "Sedimentary Flagstone Slab",
    category: "Slabs",
    description: "Flat tabular sedimentary rock with crisp parallel bedding planes and stepped edges",
    shapeType: "slab",
    facets: 12,
    asymmetry: [1.6, 0.45, 1.4],
    baseRoundness: 0.10,
    noiseAmp: 0.015,
    noiseFreq: 0.7,
    facetSharpness: 0.95,
    microGrainAmp: 0.02,
    pockmarkAmp: 0.015,
    strataAmp: 0.05,
    strataFreq: 3.5,
    strataDip: 0,
    mineral: "sandstone",
    hardness: 0.9,
  },
  columnar_basalt: {
    id: "columnar_basalt",
    name: "Hexagonal Columnar Basalt",
    category: "Volcanic",
    description: "Prismatic hexagonal volcanic cooling column with crisp vertical planar joints",
    shapeType: "prism",
    facets: 6,
    asymmetry: [0.95, 1.55, 0.95],
    baseRoundness: 0.08,
    noiseAmp: 0.01,
    noiseFreq: 0.9,
    facetSharpness: 1.0,
    microGrainAmp: 0.012,
    pockmarkAmp: 0.02,
    strataAmp: 0.01,
    strataFreq: 1.5,
    strataDip: 0,
    mineral: "basalt",
    hardness: 1.7,
  },
  small_stone: {
    id: "small_stone",
    name: "Sharp Scree Rock / Small Stone",
    category: "Stones",
    description: "Jagged small gravel stone with sharp irregular cleavage facets and chipped edges",
    shapeType: "scree",
    facets: 16,
    asymmetry: [1.05, 0.8, 1.2],
    baseRoundness: 0.12,
    noiseAmp: 0.025,
    noiseFreq: 1.2,
    facetSharpness: 0.98,
    microGrainAmp: 0.01,
    pockmarkAmp: 0.005,
    strataAmp: 0.0,
    strataFreq: 1.0,
    strataDip: 25,
    mineral: "slate",
    hardness: 1.4,
  },
  river_cobble: {
    id: "river_cobble",
    name: "Water-Worn River Cobble",
    category: "Stones",
    description: "Smooth, naturally rounded stream pebble with softly beveled facet outlines",
    shapeType: "ellipsoid",
    facets: 8,
    asymmetry: [1.25, 0.85, 1.1],
    baseRoundness: 0.75,
    noiseAmp: 0.015,
    noiseFreq: 0.75,
    facetSharpness: 0.35,
    microGrainAmp: 0.008,
    pockmarkAmp: 0.003,
    strataAmp: 0.005,
    strataFreq: 1.0,
    strataDip: 0,
    mineral: "quartzite",
    hardness: 1.6,
  },
  mountain_spire: {
    id: "mountain_spire",
    name: "Alpine Mountain Spire / Crag",
    category: "Cliffs",
    description: "Towering mountain crag needle with steep razor-sharp arêtes and knife-edge crests",
    shapeType: "spire",
    facets: 14,
    asymmetry: [0.85, 1.8, 0.85],
    baseRoundness: 0.05,
    noiseAmp: 0.02,
    noiseFreq: 0.7,
    facetSharpness: 1.0,
    microGrainAmp: 0.015,
    pockmarkAmp: 0.005,
    strataAmp: 0.025,
    strataFreq: 2.0,
    strataDip: 45,
    mineral: "slate",
    hardness: 1.5,
  },
  desert_ventifact: {
    id: "desert_ventifact",
    name: "Desert Ventifact (Dreikanter)",
    category: "Boulders",
    description: "Wind-sculpted aerodynamic rock with sharp keel facets and polished fluted slopes",
    shapeType: "ventifact",
    facets: 10,
    asymmetry: [1.3, 0.75, 1.15],
    baseRoundness: 0.18,
    noiseAmp: 0.015,
    noiseFreq: 0.8,
    facetSharpness: 0.95,
    microGrainAmp: 0.01,
    pockmarkAmp: 0.01,
    strataAmp: 0.015,
    strataFreq: 1.2,
    strataDip: 12,
    mineral: "red_sandstone",
    hardness: 1.2,
  },
  crystal_cluster: {
    id: "crystal_cluster",
    name: "Faceted Quartz Crystal Cluster",
    category: "Crystals",
    description: "Geometric mineral crystal cluster with sharp prism faces and pyramidal terminations",
    shapeType: "crystal",
    facets: 18,
    asymmetry: [0.9, 1.4, 0.9],
    baseRoundness: 0.0,
    noiseAmp: 0.0,
    noiseFreq: 1.0,
    facetSharpness: 1.0,
    microGrainAmp: 0.005,
    pockmarkAmp: 0.0,
    strataAmp: 0.0,
    strataFreq: 0.0,
    strataDip: 0,
    mineral: "quartzite",
    hardness: 1.8,
  },
};

// Smooth minimum for blending SDF shapes without sharp crease artifacts
function smin(a, b, k = 0.08) {
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
   * Generates a solid, geologically authentic rock SDF with crisp planar facets
   */
  generate(params = {}) {
    const p = { ...ROCK_PRESETS.granite_boulder, ...params };
    const seed = p.seed !== undefined ? p.seed : 42;
    const rng = createPRNG(seed);
    const noise = new NoiseGenerator(seed);

    const asymX = p.asymmetry ? p.asymmetry[0] : 1.15;
    const asymY = p.asymmetry ? p.asymmetry[1] : 0.95;
    const asymZ = p.asymmetry ? p.asymmetry[2] : 1.05;

    const baseRadius = p.radius || 1.15;
    const numFacets = p.facets || 14;
    const roundness = p.baseRoundness !== undefined ? p.baseRoundness : 0.2;
    const noiseAmp = p.noiseAmp !== undefined ? p.noiseAmp : 0.03;
    const noiseFreq = p.noiseFreq !== undefined ? p.noiseFreq : 0.8;
    const strataAmp = p.strataAmp !== undefined ? p.strataAmp : 0.0;
    const strataFreq = p.strataFreq || 1.5;
    const strataDipRad = ((p.strataDip || 0) * Math.PI) / 180;
    const shapeType = p.shapeType || "polyhedral";

    // 1. Generate Sharp Planar Half-Spaces tailored to each geological archetype
    const planes = [];

    if (shapeType === "prism") {
      // Hexagonal basalt column
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides + (rng() - 0.5) * 0.05;
        const dist = baseRadius * 0.75 * (0.95 + rng() * 0.1);
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: 0,
          nz: Math.sin(angle) / asymZ,
          d: dist,
        });
      }
      // Top and bottom cross-joint planes with subtle tilt
      planes.push({ nx: (rng() - 0.5) * 0.1, ny: 1.0 / asymY, nz: (rng() - 0.5) * 0.1, d: baseRadius * 1.25 });
      planes.push({ nx: (rng() - 0.5) * 0.1, ny: -1.0 / asymY, nz: (rng() - 0.5) * 0.1, d: baseRadius * 1.25 });
    } else if (shapeType === "cliff") {
      // Vertical cliff face with prominent sheer front wall, stepped side ledges, and steep overhangs
      planes.push({ nx: 0.98, ny: -0.15, nz: 0.05, d: baseRadius * 0.45 }); // Main vertical sheer face
      planes.push({ nx: -0.9, ny: -0.1, nz: 0.0, d: baseRadius * 1.1 }); // Back wall
      planes.push({ nx: 0.0, ny: 1.0 / asymY, nz: 0.0, d: baseRadius * 1.2 }); // Cliff summit plateau
      planes.push({ nx: 0.0, ny: -1.0 / asymY, nz: 0.0, d: baseRadius * 1.3 }); // Cliff base

      // Stepped side facets and angular cleavage corners
      for (let i = 0; i < numFacets - 4; i++) {
        const phi = Math.PI * (0.2 + 0.6 * (i / (numFacets - 4)));
        const theta = (i * 1.8) + (rng() - 0.5) * 0.3;
        let nx_ = Math.sin(phi) * Math.cos(theta) / asymX;
        let ny_ = (Math.cos(phi) * 0.4) / asymY;
        let nz_ = Math.sin(phi) * Math.sin(theta) / asymZ;
        const len = Math.hypot(nx_, ny_, nz_) || 1;
        planes.push({ nx: nx_ / len, ny: ny_ / len, nz: nz_ / len, d: baseRadius * (0.85 + rng() * 0.3) });
      }
    } else if (shapeType === "slab") {
      // Flat sedimentary tablet
      planes.push({ nx: 0, ny: 1.0 / asymY, nz: 0, d: baseRadius * 0.38 }); // Top bedding plane
      planes.push({ nx: 0, ny: -1.0 / asymY, nz: 0, d: baseRadius * 0.38 }); // Bottom bedding plane
      for (let i = 0; i < numFacets - 2; i++) {
        const angle = (i * 2 * Math.PI) / (numFacets - 2) + (rng() - 0.5) * 0.2;
        const dist = baseRadius * (1.1 + rng() * 0.25);
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: (rng() - 0.5) * 0.15,
          nz: Math.sin(angle) / asymZ,
          d: dist,
        });
      }
    } else if (shapeType === "spire") {
      // Alpine mountain needle crag
      const spireSides = 5;
      for (let i = 0; i < spireSides; i++) {
        const angle = (i * 2 * Math.PI) / spireSides;
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: 0.45 / asymY, // Steep slope to peak
          nz: Math.sin(angle) / asymZ,
          d: baseRadius * 0.65,
        });
      }
      planes.push({ nx: 0, ny: -1.0 / asymY, nz: 0, d: baseRadius * 1.35 });
      for (let i = 0; i < numFacets - spireSides - 1; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / numFacets);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
        let nx_ = Math.sin(phi) * Math.cos(theta) / asymX;
        let ny_ = Math.cos(phi) / asymY;
        let nz_ = Math.sin(phi) * Math.sin(theta) / asymZ;
        const len = Math.hypot(nx_, ny_, nz_) || 1;
        planes.push({ nx: nx_ / len, ny: ny_ / len, nz: nz_ / len, d: baseRadius * (0.8 + rng() * 0.35) });
      }
    } else if (shapeType === "crystal") {
      // Sharp geometric quartz crystal terminations
      const crystalSides = 6;
      for (let i = 0; i < crystalSides; i++) {
        const angle = (i * 2 * Math.PI) / crystalSides;
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: 0,
          nz: Math.sin(angle) / asymZ,
          d: baseRadius * 0.72,
        });
        // Pyramidal apex faces
        planes.push({
          nx: Math.cos(angle) / asymX,
          ny: 0.95 / asymY,
          nz: Math.sin(angle) / asymZ,
          d: baseRadius * 0.98,
        });
      }
      planes.push({ nx: 0, ny: -1.0 / asymY, nz: 0, d: baseRadius * 1.1 });
    } else {
      // Standard Polyhedral Cleavage Facets (Golden Spiral distribution for crisp convex polyhedron)
      for (let i = 0; i < numFacets; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / numFacets);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5) + (rng() - 0.5) * 0.15;

        let nx_ = (Math.sin(phi) * Math.cos(theta)) / asymX;
        let ny_ = Math.cos(phi) / asymY;
        let nz_ = (Math.sin(phi) * Math.sin(theta)) / asymZ;

        const len = Math.hypot(nx_, ny_, nz_) || 1.0;
        nx_ /= len;
        ny_ /= len;
        nz_ /= len;

        const dist = baseRadius * (0.9 + rng() * 0.22);
        planes.push({ nx: nx_, ny: ny_, nz: nz_, d: dist });
      }
    }

    const cosDip = Math.cos(strataDipRad);
    const sinDip = Math.sin(strataDipRad);

    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);

          // 1. Exact Convex Polyhedral Clipping Half-Spaces
          let distPoly = -100.0;
          for (let i = 0; i < planes.length; i++) {
            const pl = planes[i];
            const dot = wx * pl.nx + wy * pl.ny + wz * pl.nz - pl.d;
            if (dot > distPoly) {
              distPoly = dot;
            }
          }

          // 2. Base Ellipsoid Bound
          const ex = wx / asymX;
          const ey = wy / asymY;
          const ez = wz / asymZ;
          const distEllipsoid = Math.hypot(ex, ey, ez) - baseRadius;

          // Blend polyhedral facets with roundness
          let baseSDF = distPoly;
          if (roundness > 0.02) {
            const blendK = Math.max(0.01, roundness * 0.35);
            baseSDF = smin(distPoly, distEllipsoid, blendK);
            baseSDF = (1.0 - roundness) * baseSDF + roundness * distEllipsoid;
          }

          // 3. Crisp Geological Contouring (Anisotropic, subtle, NOT puffy cloud dough)
          let displacement = 0.0;
          if (noiseAmp > 0.001) {
            // Subtle directional cleavage warps
            const n1 = noise.noise3D(wx * noiseFreq, wy * noiseFreq * 0.5, wz * noiseFreq);
            displacement = (n1 - 0.5) * noiseAmp;
          }

          // 4. Geological Strata Bedding Planes (Terraced / stepped horizontal ledges)
          let strataDisplacement = 0.0;
          let strataHardness = 1.0;
          if (strataAmp > 0.001) {
            const strataCoord = wy * cosDip + wz * sinDip;
            const strataWave = Math.sin(strataCoord * strataFreq * Math.PI);
            // Sharp planar step modulation for authentic geological strata ledges
            const steppedStrata = Math.sign(strataWave) * Math.pow(Math.abs(strataWave), 0.4);
            strataDisplacement = steppedStrata * strataAmp;
            strataHardness = 1.0 + steppedStrata * 0.3;
          }

          // 5. High-Frequency Micro-Grain Pitting
          let microGrainDisp = 0.0;
          const microGrainAmp = p.microGrainAmp || 0.0;
          if (microGrainAmp > 0.001) {
            const gFreq = 8.0;
            const gNoise = noise.noise3D(wx * gFreq, wy * gFreq, wz * gFreq);
            microGrainDisp = (gNoise - 0.5) * microGrainAmp;
          }

          const finalDist = baseSDF + displacement + strataDisplacement + microGrainDisp;
          this.sdf[idx] = finalDist;
          this.hardness[idx] = Math.max(0.4, (p.hardness || 1.4) * strataHardness);
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
