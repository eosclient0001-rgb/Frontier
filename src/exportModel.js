import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { buildScorpionModel } from './model/scorpionBuilder.js';
import { createScorpionAnimations } from './model/scorpionAnimations.js';
import fs from 'fs';
import path from 'path';

// Polyfill FileReader for Node.js
if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  };
}

console.log('Building high-detail anatomical Scorpion model...');
const { root, model, joints } = buildScorpionModel();
const animations = createScorpionAnimations(joints);

const outputDir = path.resolve('public/models');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 1. Export Binary GLB with full skeletal/node hierarchy & all 6 animation tracks
console.log('Exporting Binary GLB with animation clips...');
const gltfExporter = new GLTFExporter();
gltfExporter.parse(
  model,
  (gltf) => {
    const glbBuffer = Buffer.from(gltf);
    const glbPath = path.join(outputDir, 'scorpion.glb');
    fs.writeFileSync(glbPath, glbBuffer);
    console.log(`✓ Saved GLB model: ${glbPath} (${(glbBuffer.length / 1024).toFixed(1)} KB)`);

    // Also copy to root for easy user access
    fs.writeFileSync(path.resolve('scorpion.glb'), glbBuffer);
    console.log(`✓ Copied scorpion.glb to workspace root`);
  },
  (err) => {
    console.error('Error during GLB export:', err);
  },
  {
    binary: true,
    animations: animations,
    embedImages: false
  }
);

// 2. Export Standard Wavefront OBJ
console.log('Exporting OBJ model...');
const objExporter = new OBJExporter();
const objResult = objExporter.parse(model);
const objPath = path.join(outputDir, 'scorpion.obj');
fs.writeFileSync(objPath, objResult);
console.log(`✓ Saved OBJ model: ${objPath} (${(objResult.length / 1024).toFixed(1)} KB)`);
fs.writeFileSync(path.resolve('scorpion.obj'), objResult);
console.log(`✓ Copied scorpion.obj to workspace root`);

console.log('Model generation complete!');
