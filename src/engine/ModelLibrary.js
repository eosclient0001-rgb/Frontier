// ModelLibrary.js
// Procedural high-fidelity 3D models with non-overlapping UV unwrapping + OBJ Loader

import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export class ModelLibrary {
  static createUnwrappedBox() {
    // Unwrapped Box layout:
    // 6 faces cleanly unfolded onto a 3x2 UV grid (no overlapping!)
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const uvs = [];
    const indices = [];

    const faces = [
      // Front (Z+)
      { corners: [[-1,-1, 1], [ 1,-1, 1], [ 1, 1, 1], [-1, 1, 1]], uvTile: [0, 0] },
      // Back (Z-)
      { corners: [[ 1,-1,-1], [-1,-1,-1], [-1, 1,-1], [ 1, 1,-1]], uvTile: [1, 0] },
      // Top (Y+)
      { corners: [[-1, 1, 1], [ 1, 1, 1], [ 1, 1,-1], [-1, 1,-1]], uvTile: [2, 0] },
      // Bottom (Y-)
      { corners: [[-1,-1,-1], [ 1,-1,-1], [ 1,-1, 1], [-1,-1, 1]], uvTile: [0, 1] },
      // Right (X+)
      { corners: [[ 1,-1, 1], [ 1,-1,-1], [ 1, 1,-1], [ 1, 1, 1]], uvTile: [1, 1] },
      // Left (X-)
      { corners: [[-1,-1,-1], [-1,-1, 1], [-1, 1, 1], [-1, 1,-1]], uvTile: [2, 1] }
    ];

    const tileW = 1.0 / 3.0;
    const tileH = 1.0 / 2.0;

    faces.forEach((face, fIdx) => {
      const baseIdx = fIdx * 4;
      face.corners.forEach(([x, y, z]) => vertices.push(x, y, z));

      const [tx, ty] = face.uvTile;
      const u0 = tx * tileW + 0.01;
      const u1 = (tx + 1) * tileW - 0.01;
      const v0 = ty * tileH + 0.01;
      const v1 = (ty + 1) * tileH - 0.01;

      uvs.push(u0, v0,  u1, v0,  u1, v1,  u0, v1);
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    });

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  static createSciFiHelmet() {
    // Procedural Sci-Fi Helmet
    const group = new THREE.Group();

    // 1. Helmet Dome (top half sphere scaled)
    const domeGeo = new THREE.SphereGeometry(1.2, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.65);
    domeGeo.scale(1.0, 1.15, 1.1);

    // Repack UVs to top quadrant [0..1, 0.4..1]
    const domeUv = domeGeo.attributes.uv;
    for (let i = 0; i < domeUv.count; i++) {
      domeUv.setY(i, 0.4 + domeUv.getY(i) * 0.6);
    }

    // 2. Front Visor (curved shield)
    const visorGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.6, 24, 4, true, -Math.PI * 0.4, Math.PI * 0.8);
    visorGeo.translate(0, 0.05, 0.35);

    // Visor UVs into lower left quadrant [0..0.5, 0..0.4]
    const visorUv = visorGeo.attributes.uv;
    for (let i = 0; i < visorUv.count; i++) {
      visorUv.setX(i, visorUv.getX(i) * 0.5);
      visorUv.setY(i, visorUv.getY(i) * 0.4);
    }

    // 3. Chin Guard & Neck Ring
    const neckGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.5, 24, 2, true);
    neckGeo.translate(0, -0.65, 0.1);

    // Neck UVs into lower right quadrant [0.5..1.0, 0..0.4]
    const neckUv = neckGeo.attributes.uv;
    for (let i = 0; i < neckUv.count; i++) {
      neckUv.setX(i, 0.5 + neckUv.getX(i) * 0.5);
      neckUv.setY(i, neckUv.getY(i) * 0.4);
    }

    // Merge geometries into single buffer geometry
    return this.mergeGeometries([domeGeo, visorGeo, neckGeo]);
  }

  static createMechDrone() {
    // Central Drone Sphere
    const bodyGeo = new THREE.SphereGeometry(1.0, 32, 24);
    const bodyUv = bodyGeo.attributes.uv;
    for (let i = 0; i < bodyUv.count; i++) {
      bodyUv.setY(i, 0.3 + bodyUv.getY(i) * 0.7);
    }

    // Eye Lens
    const eyeGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.3, 20);
    eyeGeo.rotateX(Math.PI / 2);
    eyeGeo.translate(0, 0.1, 0.95);
    const eyeUv = eyeGeo.attributes.uv;
    for (let i = 0; i < eyeUv.count; i++) {
      eyeUv.setX(i, eyeUv.getX(i) * 0.5);
      eyeUv.setY(i, eyeUv.getY(i) * 0.3);
    }

    // Side Thrusters (Left & Right)
    const thrusterL = new THREE.CylinderGeometry(0.25, 0.35, 0.7, 16);
    thrusterL.rotateZ(Math.PI / 2);
    thrusterL.translate(1.15, 0, 0);
    const tLUv = thrusterL.attributes.uv;
    for (let i = 0; i < tLUv.count; i++) {
      tLUv.setX(i, 0.5 + tLUv.getX(i) * 0.25);
      tLUv.setY(i, tLUv.getY(i) * 0.3);
    }

    const thrusterR = new THREE.CylinderGeometry(0.25, 0.35, 0.7, 16);
    thrusterR.rotateZ(Math.PI / 2);
    thrusterR.translate(-1.15, 0, 0);
    const tRUv = thrusterR.attributes.uv;
    for (let i = 0; i < tRUv.count; i++) {
      tRUv.setX(i, 0.75 + tRUv.getX(i) * 0.25);
      tRUv.setY(i, tRUv.getY(i) * 0.3);
    }

    return this.mergeGeometries([bodyGeo, eyeGeo, thrusterL, thrusterR]);
  }

  static createTeapot() {
    // Teapot body
    const bodyGeo = new THREE.SphereGeometry(0.9, 28, 20);
    bodyGeo.scale(1.2, 0.9, 1.2);
    const bUv = bodyGeo.attributes.uv;
    for (let i = 0; i < bUv.count; i++) {
      bUv.setY(i, 0.35 + bUv.getY(i) * 0.65);
    }

    // Spout
    const spoutGeo = new THREE.CylinderGeometry(0.12, 0.25, 0.9, 16);
    spoutGeo.rotateZ(-Math.PI * 0.25);
    spoutGeo.translate(1.0, 0.2, 0);
    const sUv = spoutGeo.attributes.uv;
    for (let i = 0; i < sUv.count; i++) {
      sUv.setX(i, sUv.getX(i) * 0.35);
      sUv.setY(i, sUv.getY(i) * 0.35);
    }

    // Handle
    const handleGeo = new THREE.TorusGeometry(0.5, 0.08, 12, 24, Math.PI);
    handleGeo.rotateZ(Math.PI / 2);
    handleGeo.translate(-1.1, 0.1, 0);
    const hUv = handleGeo.attributes.uv;
    for (let i = 0; i < hUv.count; i++) {
      hUv.setX(i, 0.35 + hUv.getX(i) * 0.35);
      hUv.setY(i, hUv.getY(i) * 0.35);
    }

    // Lid knob
    const lidGeo = new THREE.SphereGeometry(0.2, 16, 12);
    lidGeo.translate(0, 0.95, 0);
    const lUv = lidGeo.attributes.uv;
    for (let i = 0; i < lUv.count; i++) {
      lUv.setX(i, 0.7 + lUv.getX(i) * 0.3);
      lUv.setY(i, lUv.getY(i) * 0.35);
    }

    return this.mergeGeometries([bodyGeo, spoutGeo, handleGeo, lidGeo]);
  }

  static createBlaster() {
    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.16, 0.18, 1.8, 16);
    barrelGeo.rotateZ(Math.PI / 2);
    barrelGeo.translate(0.3, 0.4, 0);
    const bUv = barrelGeo.attributes.uv;
    for (let i = 0; i < bUv.count; i++) {
      bUv.setX(i, bUv.getX(i) * 0.5);
      bUv.setY(i, 0.5 + bUv.getY(i) * 0.5);
    }

    // Body receiver
    const receiverGeo = new THREE.BoxGeometry(1.2, 0.5, 0.4);
    receiverGeo.translate(0.0, 0.25, 0);
    const rUv = receiverGeo.attributes.uv;
    for (let i = 0; i < rUv.count; i++) {
      rUv.setX(i, 0.5 + rUv.getX(i) * 0.5);
      rUv.setY(i, 0.5 + rUv.getY(i) * 0.5);
    }

    // Pistol Grip
    const gripGeo = new THREE.BoxGeometry(0.35, 1.0, 0.3);
    gripGeo.rotateZ(0.25);
    gripGeo.translate(-0.4, -0.4, 0);
    const gUv = gripGeo.attributes.uv;
    for (let i = 0; i < gUv.count; i++) {
      gUv.setX(i, gUv.getX(i) * 0.5);
      gUv.setY(i, gUv.getY(i) * 0.5);
    }

    // Scope
    const scopeGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 16);
    scopeGeo.rotateZ(Math.PI / 2);
    scopeGeo.translate(0.1, 0.75, 0);
    const sUv = scopeGeo.attributes.uv;
    for (let i = 0; i < sUv.count; i++) {
      sUv.setX(i, 0.5 + sUv.getX(i) * 0.5);
      sUv.setY(i, sUv.getY(i) * 0.5);
    }

    return this.mergeGeometries([barrelGeo, receiverGeo, gripGeo, scopeGeo]);
  }

  static createFuelCanister() {
    // Unwrapped Fuel Tank / Canister
    const cylGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.6, 28, 6, true);
    const cUv = cylGeo.attributes.uv;
    for (let i = 0; i < cUv.count; i++) {
      cUv.setY(i, 0.25 + cUv.getY(i) * 0.5);
    }

    const topCap = new THREE.SphereGeometry(0.7, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    topCap.translate(0, 0.8, 0);
    const tUv = topCap.attributes.uv;
    for (let i = 0; i < tUv.count; i++) {
      tUv.setX(i, tUv.getX(i) * 0.5);
      tUv.setY(i, 0.75 + tUv.getY(i) * 0.25);
    }

    const botCap = new THREE.SphereGeometry(0.7, 28, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    botCap.translate(0, -0.8, 0);
    const bUv = botCap.attributes.uv;
    for (let i = 0; i < bUv.count; i++) {
      bUv.setX(i, 0.5 + bUv.getX(i) * 0.5);
      bUv.setY(i, 0.75 + bUv.getY(i) * 0.25);
    }

    return this.mergeGeometries([cylGeo, topCap, botCap]);
  }

  static createSphere() {
    return new THREE.SphereGeometry(1.2, 48, 36);
  }

  static createTorus() {
    return new THREE.TorusGeometry(1.0, 0.4, 32, 48);
  }

  static mergeGeometries(geometries) {
    let totalPos = 0;
    let totalUv = 0;
    let totalIdx = 0;

    for (const g of geometries) {
      totalPos += g.attributes.position.count;
      totalUv += g.attributes.uv.count;
      totalIdx += g.index ? g.index.count : g.attributes.position.count;
    }

    const posArray = new Float32Array(totalPos * 3);
    const uvArray = new Float32Array(totalUv * 2);
    const indexArray = [];

    let vertexOffset = 0;
    let posPtr = 0;
    let uvPtr = 0;

    for (const g of geometries) {
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      const idx = g.index;

      for (let i = 0; i < pos.count; i++) {
        posArray[posPtr++] = pos.getX(i);
        posArray[posPtr++] = pos.getY(i);
        posArray[posPtr++] = pos.getZ(i);

        uvArray[uvPtr++] = uv.getX(i);
        uvArray[uvPtr++] = uv.getY(i);
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indexArray.push(idx.getX(i) + vertexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indexArray.push(i + vertexOffset);
        }
      }

      vertexOffset += pos.count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
    merged.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
    merged.setIndex(indexArray);
    merged.computeVertexNormals();

    return merged;
  }

  static loadOBJ(text) {
    const loader = new OBJLoader();
    const group = loader.parse(text);
    let targetMesh = null;

    group.traverse((child) => {
      if (child.isMesh && !targetMesh) {
        targetMesh = child;
      }
    });

    if (targetMesh && targetMesh.geometry) {
      targetMesh.geometry.computeVertexNormals();
      targetMesh.geometry.center();
      return targetMesh.geometry;
    }
    return null;
  }
}
