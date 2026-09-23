import fs from "fs";

// Read marching-cubes.js
const code = fs.readFileSync("./src/marching-cubes.js", "utf8");

// Extract tables
const edgeTableMatch = code.match(/const EDGE_TABLE = new Int32Array\(\[([\s\S]*?)\]\);/);
const triTableMatch = code.match(/const TRI_TABLE = (\[[\s\S]*?\]);\s*const CORNER_OFFSETS/);

const EDGE_TABLE = eval(`new Int32Array([${edgeTableMatch[1]}])`);
const TRI_TABLE = eval(triTableMatch[1]);

console.log("EDGE_TABLE length:", EDGE_TABLE.length, "TRI_TABLE length:", TRI_TABLE.length);

let totalMismatches = 0;
for (let c = 0; c < 256; c++) {
  const mask = EDGE_TABLE[c];
  const tris = TRI_TABLE[c];
  if (!tris) {
    console.log(`Missing TRI_TABLE entry for cubeIndex ${c}`);
    totalMismatches++;
    continue;
  }
  for (let i = 0; i < tris.length && tris[i] !== -1; i++) {
    const e = tris[i];
    if (!(mask & (1 << e))) {
      console.log(`CubeIndex ${c}: edge ${e} in TRI_TABLE is NOT in EDGE_TABLE bitmask (mask: 0x${mask.toString(16)})`);
      totalMismatches++;
    }
  }
}

console.log("Total edge mismatches between TRI_TABLE and EDGE_TABLE:", totalMismatches);
