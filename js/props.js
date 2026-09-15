// ============================================================================
// props.js — talus boulders + riverside vegetation (instanced, procedural).
// Placement is rule-based: rocks where slopes + cliff bases are, bushes near
// water on gentle ground. Geometry is noise-displaced icosahedra.
// ============================================================================
import * as THREE from 'three';
import { Perlin2, mulberry32 } from './terrain.js';

function displacedBlob(rand, detail, jag) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const perlin = new Perlin2(rand);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = perlin.noise(v.x * 1.3 + 5.0, (v.y + v.z) * 1.3);
    const n2 = perlin.noise(v.z * 2.7 + 1.0, v.y * 2.7 + 3.0);
    const s = Math.max(0.25, 1 + jag * (n * 0.7 + n2 * 0.3));
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildRocks(sampler, o) {
  // o: { count, minScale, maxScale, waterY, extent, seed, color }
  const group = new THREE.Group();
  if (!o.count) return group;
  const rand = mulberry32(o.seed >>> 0);
  const placements = [];
  let guard = o.count * 60;
  while (placements.length < o.count && guard-- > 0) {
    const x = (rand() * 2 - 1) * o.extent;
    const z = (rand() * 2 - 1) * o.extent;
    const h = sampler.height(x, z);
    if (h < o.waterY + 0.4) continue;
    const sl = sampler.slope(x, z);
    if (sl < 0.18 || sl > 1.4) continue;
    if (sampler.ao(x, z) > 0.82 && rand() < 0.7) continue; // prefer cliff bases
    placements.push({
      x, z, h,
      s: o.minScale + (o.maxScale - o.minScale) * Math.pow(rand(), 2.2),
      ry: rand() * Math.PI * 2,
      v: rand(),
    });
  }
  if (!placements.length) return group;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0.0, flatShading: true,
  });
  const base = new THREE.Color(o.color);
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();
  const variants = 3;
  for (let vi = 0; vi < variants; vi++) {
    const list = placements.filter((_, k) => k % variants === vi);
    if (!list.length) continue;
    const geo = displacedBlob(mulberry32(((o.seed * 7 + vi * 101) >>> 0)), 2, 0.45);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, k) => {
      dummy.position.set(p.x, p.h - p.s * 0.35, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(p.s, p.s * (0.7 + p.v * 0.55), p.s * (0.8 + p.v * 0.4));
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      col.copy(base).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.09);
      mesh.setColorAt(k, col);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

export function buildBushes(sampler, o) {
  // o: { count, minScale, maxScale, waterY, rimY, extent, seed, color }
  const group = new THREE.Group();
  if (!o.count) return group;
  const rand = mulberry32((o.seed ^ 0x3d33a) >>> 0);
  const placements = [];
  let guard = o.count * 80;
  while (placements.length < o.count && guard-- > 0) {
    const x = (rand() * 2 - 1) * o.extent;
    const z = (rand() * 2 - 1) * o.extent;
    const h = sampler.height(x, z);
    const sl = sampler.slope(x, z);
    if (sl > 0.5) continue;
    const nearRiver = h > o.waterY + 0.6 && h < o.waterY + 30;
    const onPlateau = h > o.rimY - 12;
    if (nearRiver) {
      if (rand() < 0.25) continue;
    } else if (onPlateau) {
      if (rand() < 0.94) continue;
    } else {
      continue;
    }
    placements.push({
      x, z, h,
      s: o.minScale + (o.maxScale - o.minScale) * rand(),
      ry: rand() * Math.PI * 2,
      v: rand(),
    });
  }
  if (!placements.length) return group;

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
  const base = new THREE.Color(o.color);
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();
  const variants = 2;
  for (let vi = 0; vi < variants; vi++) {
    const list = placements.filter((_, k) => k % variants === vi);
    if (!list.length) continue;
    const geo = displacedBlob(mulberry32(((o.seed * 13 + vi * 57) >>> 0)), 1, 0.32);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, k) => {
      dummy.position.set(p.x, p.h + p.s * 0.25, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(p.s, p.s * 0.6, p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      col.copy(base).offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08);
      mesh.setColorAt(k, col);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}
