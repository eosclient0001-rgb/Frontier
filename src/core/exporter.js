// Frontier Road Editor — mesh export (OBJ + GLB) for Unreal / Blender round-trips
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { download } from './util.js';

function eachMesh(root, fn) {
  root.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) fn(o);
  });
}

// OBJ export. Streams lines into a flushing buffer of moderate chunks and hands
// the chunk array directly to Blob(), so we never hold one giant joined string
// nor a million-element line array. Bounded, linear memory.
export function exportOBJ(root, name = 'frontier-city') {
  const chunks = [];   // coarse output chunks handed to Blob
  let buf = [];        // current line buffer
  let bufLen = 0;
  let total = 0;
  const FLUSH = 40000; // lines per chunk
  const push = s => {
    buf.push(s); bufLen += s.length;
    if (buf.length >= FLUSH) flush();
  };
  const flush = () => { if (buf.length) { const s = buf.join(''); chunks.push(s); total += s.length; buf = []; bufLen = 0; } };
  void bufLen;

  let vi = 1;
  const mtlNames = new Set();
  push('# Frontier Road Editor export\nmtllib ' + name + '.mtl\n');

  const v = new THREE.Vector3();
  const m4t = new THREE.Matrix4();

  eachMesh(root, m => {
    if (m.isInstancedMesh) return; // expanded in second pass
    const g = m.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const matName = (Array.isArray(m.material) ? m.material[0] : m.material)?.name?.replace(/\s+/g, '_') || 'mat';
    mtlNames.add(matName);
    push(`o ${m.name || 'mesh'}\n`);
    m4t.copy(m.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4t);
      push(`v ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}\n`);
    }
    if (nrm) for (let i = 0; i < nrm.count; i++) {
      v.fromBufferAttribute(nrm, i).transformDirection(m4t);
      push(`vn ${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}\n`);
    }
    if (uv) for (let i = 0; i < uv.count; i++) {
      push(`vt ${uv.getX(i).toFixed(3)} ${uv.getY(i).toFixed(3)}\n`);
    }
    push(`usemtl ${matName}\n`);
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = (idx ? idx.getX(i) : i) + vi;
      const b = (idx ? idx.getX(i + 1) : i + 1) + vi;
      const c = (idx ? idx.getX(i + 2) : i + 2) + vi;
      push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`);
    }
    vi += pos.count;
  });

  // expand instanced meshes (props, sleepers, trees…)
  const mat4 = new THREE.Matrix4(), rotM = new THREE.Matrix4(), sclM = new THREE.Matrix4();
  const loc = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  eachMesh(root, m => {
    if (!m.isInstancedMesh) return;
    const g = m.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const matName = m.material?.name?.replace(/\s+/g, '_') || 'imat';
    mtlNames.add(matName);
    push(`o ${m.name || 'instanced'}\n`);
    const idx = g.index;
    const nTriVerts = idx ? idx.count : pos.count;
    for (let k = 0; k < m.count; k++) {
      m.getMatrixAt(k, mat4);
      mat4.premultiply(m.matrixWorld);
      mat4.decompose(loc, quat, scl);
      rotM.makeRotationFromQuaternion(quat);
      sclM.makeScale(scl.x, scl.y, scl.z);
      rotM.multiply(sclM);
      const vBase = vi;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rotM).add(loc);
        push(`v ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}\n`);
      }
      for (let i = 0; i < (nrm?.count || 0); i++) {
        v.fromBufferAttribute(nrm, i).applyMatrix4(rotM).normalize();
        push(`vn ${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}\n`);
      }
      for (let i = 0; i < (uv?.count || 0); i++) {
        push(`vt ${uv.getX(i).toFixed(3)} ${uv.getY(i).toFixed(3)}\n`);
      }
      for (let i = 0; i < nTriVerts; i += 3) {
        const a = (idx ? idx.getX(i) : i) + vBase;
        const b = (idx ? idx.getX(i + 1) : i + 1) + vBase;
        const c = (idx ? idx.getX(i + 2) : i + 2) + vBase;
        push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`);
      }
      vi += pos.count;
    }
  });

  flush();
  let mtl = '# Frontier materials (flat shading placeholders)\n';
  for (const mn of mtlNames) mtl += `newmtl ${mn}\nKa 0.1 0.1 0.1\nKd 0.62 0.62 0.62\nKs 0 0 0\nNs 10\n\n`;

  download(new Blob(chunks, { type: 'text/plain' }), name + '.obj');
  download(new Blob([mtl], { type: 'text/plain' }), name + '.mtl');
  return total;
}

export function exportGLB(root, name = 'frontier-city') {
  const exporter = new GLTFExporter();
  exporter.parse(
    root,
    result => {
      download(new Blob([result], { type: 'model/gltf-binary' }), name + '.glb');
    },
    err => { console.error('GLB export failed', err); },
    { binary: true, maxTextureSize: 1024 },
  );
}
