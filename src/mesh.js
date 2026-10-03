/**
 * Mesh generation utilities for XPBD metal
 */
import * as THREE from 'three';

export function createSheetMesh(width, height, segW, segH) {
  const positions = [];
  const indices = [];
  const particles = [];

  // grid
  for (let y=0; y<=segH; y++) {
    for (let x=0; x<=segW; x++) {
      const u = x/segW, v = y/segH;
      const px = (u-0.5)*width;
      const py = 0;
      const pz = (v-0.5)*height;
      positions.push(px,py,pz);
      particles.push([px,py,pz]);
    }
  }

  const vert = (x,y)=> y*(segW+1)+x;

  for (let y=0; y<segH; y++) {
    for (let x=0; x<segW; x++) {
      const a = vert(x,y);
      const b = vert(x+1,y);
      const c = vert(x+1,y+1);
      const d = vert(x,y+1);
      // two tris
      indices.push(a,b,c);
      indices.push(a,c,d);
    }
  }

  return { positions: new Float32Array(positions), indices, particles };
}

export function createCanMesh(radius, height, radialSegs, heightSegs, caps=true) {
  const positions = [];
  const indices = [];

  // side
  for (let y=0; y<=heightSegs; y++) {
    const v = y/heightSegs;
    const py = (v-0.5)*height;
    for (let x=0; x<radialSegs; x++) {
      const u = x/radialSegs;
      const theta = u*Math.PI*2;
      const px = Math.cos(theta)*radius;
      const pz = Math.sin(theta)*radius;
      positions.push(px,py,pz);
    }
  }
  const vert = (r,h)=> h*radialSegs + r;

  for (let y=0; y<heightSegs; y++) {
    for (let x=0; x<radialSegs; x++) {
      const a = vert(x,y);
      const b = vert((x+1)%radialSegs,y);
      const c = vert((x+1)%radialSegs,y+1);
      const d = vert(x,y+1);
      indices.push(a,b,c);
      indices.push(a,c,d);
    }
  }

  // caps if needed (simple fan)
  if (caps) {
    const topCenterIdx = positions.length/3;
    positions.push(0,height*0.5,0);
    const bottomCenterIdx = positions.length/3;
    positions.push(0,-height*0.5,0);

    const topRingStart = heightSegs*radialSegs;
    const bottomRingStart = 0;
    for (let x=0; x<radialSegs; x++) {
      const a = topCenterIdx;
      const b = topRingStart + x;
      const c = topRingStart + (x+1)%radialSegs;
      indices.push(a,c,b); // winding

      const a2 = bottomCenterIdx;
      const b2 = bottomRingStart + x;
      const c2 = bottomRingStart + (x+1)%radialSegs;
      indices.push(a2,b2,c2);
    }
  }

  return { positions: new Float32Array(positions), indices };
}

export function createCarShellMesh() {
  // Build a simplified car body from box geometry with more subdivisions at front
  // Use Three BoxGeometry and deduplicate vertices
  const box = new THREE.BoxGeometry(4.5, 1.2, 1.8, 12, 3, 4);
  // deform to car-like shape: taper front, raise rear etc.
  const posAttr = box.attributes.position;
  for (let i=0;i<posAttr.count;i++) {
    let x = posAttr.getX(i);
    let y = posAttr.getY(i);
    let z = posAttr.getZ(i);
    // x: -2.25 to 2.25, front is +x
    // make front narrower and lower (hood)
    const frontFactor = Math.max(0, (x+0.5)/2.5); // 0 at rear, 1 at front
    if (x>0) {
      // hood slopes down
      if (y>0) {
        // roof to hood transition: if front half, lower roof
        if (x>0.8) {
          y *= (1 - 0.5* Math.min(1,(x-0.8)/1.5));
          // also cabin ends at x~0.5
          if (x<1.2 && Math.abs(z)<0.6) {
            // windshield area - keep higher? simplify
          }
        }
      }
      // taper width at front bumper
      if (x>1.5) {
        z *= 0.85;
      }
    }
    // wheel arches: indent bottom sides
    if (y<0 && Math.abs(z)>0.6) {
      // slight
    }
    posAttr.setXYZ(i,x,y,z);
  }
  posAttr.needsUpdate=true;
  box.computeVertexNormals();

  // deduplicate
  return deduplicateGeometry(box);
}

export function deduplicateGeometry(geom) {
  const posAttr = geom.attributes.position;
  const indexAttr = geom.index;
  const positions = [];
  const indices = [];
  const map = new Map();
  const newIndices = [];
  const tolerance = 1e-4;

  const keyFor = (x,y,z)=> `${Math.round(x/tolerance)}_${Math.round(y/tolerance)}_${Math.round(z/tolerance)}`;

  let nextIdx=0;
  const oldToNew = new Array(posAttr.count);

  for (let i=0;i<posAttr.count;i++) {
    const x=posAttr.getX(i), y=posAttr.getY(i), z=posAttr.getZ(i);
    const key = keyFor(x,y,z);
    if (map.has(key)) {
      oldToNew[i]=map.get(key);
    } else {
      map.set(key,nextIdx);
      oldToNew[i]=nextIdx;
      positions.push(x,y,z);
      nextIdx++;
    }
  }

  if (indexAttr) {
    for (let i=0;i<indexAttr.count;i++) {
      const oldIdx = indexAttr.getX(i);
      newIndices.push(oldToNew[oldIdx]);
    }
  } else {
    for (let i=0;i<posAttr.count;i++) newIndices.push(oldToNew[i]);
  }

  return { positions: new Float32Array(positions), indices: newIndices };
}

export function buildConstraintsFromTrimesh(solver, positions, indices, options={}) {
  const edgeMap = new Map(); // edge key -> [tri opposite vertex, ...]
  const addEdge = (a,b,opp)=>{
    const key = a<b ? `${a}_${b}` : `${b}_${a}`;
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key).push(opp);
  };

  for (let i=0;i<indices.length;i+=3) {
    const a=indices[i], b=indices[i+1], c=indices[i+2];
    addEdge(a,b,c);
    addEdge(b,c,a);
    addEdge(c,a,b);
    solver.addDistanceConstraint(a,b);
    solver.addDistanceConstraint(b,c);
    solver.addDistanceConstraint(c,a);
  }

  // bending: for each edge shared by two tris, connect opposite verts
  let bendCount=0;
  for (let [key, opps] of edgeMap.entries()) {
    if (opps.length===2) {
      const [o1,o2]=opps;
      // avoid degenerate
      if (o1!==o2) {
        solver.addBendingConstraint(o1,o2);
        bendCount++;
      }
    }
  }

  // shear? already have diagonals via triangulation, but add second neighbor for sheet if grid detected?
  return { edgeCount: edgeMap.size, bendCount };
}

export function createBallShellMesh(radius, detail=2) {
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  return deduplicateGeometry(ico);
}
