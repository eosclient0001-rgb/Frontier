import { RockGenerator } from '../src/rock-generator.js';
import { RockFractureEngine } from '../src/rock-fracture-engine.js';
import { RockSDFErosionEngine } from '../src/rock-sdf-erosion.js';
import { extractIsosurface } from '../src/marching-cubes.js';

console.log('--- Testing Full 4-Step Pipeline ---');

const config = {
  nx: 64,
  ny: 64,
  nz: 64,
  boundsMin: [-1.8, -1.8, -1.8],
  boundsMax: [1.8, 1.8, 1.8]
};

const rockGen = new RockGenerator(config);
const fractureEngine = new RockFractureEngine(config);
const erosionEngine = new RockSDFErosionEngine(config);

// 1. Generate Base Rock
console.log('1. Generating Base Rock...');
const rockVol = rockGen.generate({
  facets: 14,
  baseRoundness: 0.35,
  noiseAmp: 0.08,
  noiseFreq: 0.75,
  strataAmp: 0.02,
  strataFreq: 1.2,
  strataDip: 15,
  hardness: 1.4
});
console.log('Rock volume generated:', rockVol.nx, rockVol.ny, rockVol.nz);

// 2. Generate 3D Fracture
console.log('2. Generating 3D Fracture...');
const fracture = fractureEngine.generateFracture(rockVol.sdf, {
  seed: 42,
  fractureType: 'voronoi_cleavage',
  crackDensity: 0.6,
  aperture: 0.06,
  depthReach: 0.8,
  branching: 0.6,
  jaggedness: 0.45,
  chipDensity: 0.55,
  chipDepth: 0.06,
  chipScale: 0.45
});
console.log('Fracture generated. Pieces:', fracture.pieceCount, 'Chips:', fracture.chipCount);

// 3. SDF Erosion
console.log('3. Simulating SDF Erosion...');
const erosion = erosionEngine.erode(rockVol.sdf, fracture, rockVol.hardness, {
  iterations: 12,
  frostWedging: 0.65,
  edgeBevel: 0.55,
  dissolution: 0.4,
  sedimentFill: 0.45,
  oxidation: 0.7
});
console.log('Erosion complete. Cracked voxels:', erosion.diagnostics.crackedVoxelCount);

// 4. Marching Cubes Mesh Extraction
console.log('4. Extracting Isosurface Mesh...');
const mesh = extractIsosurface(
  {
    sdf: erosion.erodedSDF,
    nx: config.nx,
    ny: config.ny,
    nz: config.nz,
    boundsMin: config.boundsMin,
    boundsMax: config.boundsMax
  },
  {
    isovalue: 0.0,
    step: 1,
    crackMask: fracture.crackMask,
    erosionDepth: erosion.erosionDepth,
    sediment: erosion.cavitySediment,
    oxidation: erosion.oxidationHalo
  }
);

console.log('Mesh extracted:');
console.log('- Vertices:', mesh.vertexCount);
console.log('- Triangles:', mesh.triangleCount);

// Validation checks
let nanCount = 0;
let zeroNormals = 0;
let centerSpokes = 0;

for (let i = 0; i < mesh.positions.length; i += 3) {
  const x = mesh.positions[i];
  const y = mesh.positions[i + 1];
  const z = mesh.positions[i + 2];
  if (isNaN(x) || isNaN(y) || isNaN(z)) nanCount++;
  
  const nx = mesh.normals[i];
  const ny = mesh.normals[i + 1];
  const nz = mesh.normals[i + 2];
  if (isNaN(nx) || isNaN(ny) || isNaN(nz)) nanCount++;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-4) zeroNormals++;
  
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) {
    centerSpokes++;
  }
}

console.log('- NaN/Inf count:', nanCount);
console.log('- Zero-length normals:', zeroNormals);
console.log('- Exact center (0,0,0) vertices:', centerSpokes);

if (mesh.triangleCount > 500 && nanCount === 0 && zeroNormals === 0 && centerSpokes === 0) {
  console.log('>>> SUCCESS: Full rock pipeline test passed with ZERO anomalies!');
} else {
  console.error('>>> FAILED: Anomaly detected!');
  process.exit(1);
}
