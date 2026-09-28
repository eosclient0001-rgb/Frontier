import * as THREE from 'three';

/**
 * Anatomically accurate 3D Great Hammerhead Shark (Sphyrna mokarran)
 * Features:
 * - Cephalofoil with accurate wing foil cross section, leading edge median notch, and lateral eye pods
 * - Ventral mouth with kinetic Palatoquadrate (upper jaw protrusion) & Meckel's cartilage (lower jaw gape)
 * - Multi-row razor-sharp serrated triangular shark teeth
 * - 5 pairs of lateral gill slits
 * - Very tall falcate 1st dorsal fin (hallmark of Sphyrna mokarran)
 * - Falcate pectoral fins with hydrodynamic hydrofoil profile
 * - Heterocercal caudal fin with large upper lobe, subterminal notch, and stiff lower lobe
 * - Complete SkinnedMesh bone hierarchy with smooth vertex skinning
 */

export function createHammerheadShark() {
  const bones = [];
  const boneMap = {};

  function addBone(name, pos, parent = null) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(pos);
    if (parent) parent.add(bone);
    bones.push(bone);
    boneMap[name] = bone;
    return bone;
  }

  // Bone hierarchy along the longitudinal Z axis (Head is +Z, Tail is -Z)
  const root = addBone('root', new THREE.Vector3(0, 0, 0)); // Pelvic/mid trunk origin
  const trunkFront = addBone('trunk_front', new THREE.Vector3(0, 0.05, 0.55), root);
  const pectoralSpine = addBone('pectoral_spine', new THREE.Vector3(0, 0.04, 0.45), trunkFront); // world z=1.00
  const neck = addBone('neck', new THREE.Vector3(0, 0.02, 0.40), pectoralSpine); // world z=1.40
  const head = addBone('head_cephalofoil', new THREE.Vector3(0, -0.02, 0.48), neck); // world z=1.88

  // Kinetic Palatoquadrate (Upper Jaw): can protrude forward & downward!
  const jawUpper = addBone('jaw_upper', new THREE.Vector3(0, -0.12, -0.22), head);
  // Meckel's Cartilage (Lower Jaw): pivots downward to open gape!
  const jawLower = addBone('jaw_lower', new THREE.Vector3(0, -0.16, -0.28), head);

  // Pectoral fin bones (for hydrodynamic trim and banking)
  const pecL = addBone('pec_L', new THREE.Vector3(0.25, -0.12, 0.05), pectoralSpine);
  const pecR = addBone('pec_R', new THREE.Vector3(-0.25, -0.12, 0.05), pectoralSpine);

  // Posterior spine chain
  const trunkRear = addBone('trunk_rear', new THREE.Vector3(0, -0.02, -0.55), root); // world z=-0.55
  const pelvicSpine = addBone('pelvic_spine', new THREE.Vector3(0, -0.02, -0.50), trunkRear); // world z=-1.05
  const tailBase = addBone('tail_base', new THREE.Vector3(0, 0.01, -0.55), pelvicSpine); // world z=-1.60
  const tailMid = addBone('tail_mid', new THREE.Vector3(0, 0.02, -0.50), tailBase); // world z=-2.10
  const caudal = addBone('caudal_fin', new THREE.Vector3(0, 0.03, -0.45), tailMid); // world z=-2.55

  const skeleton = new THREE.Skeleton(bones);

  // Mapping bone world Z reference positions for longitudinal skinning
  // We'll calculate the bind world positions of each bone
  root.updateWorldMatrix(true, true);
  const boneWorldPos = bones.map(b => {
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  });

  // Build the complete body geometry
  const bodyGeom = buildSharkBodyGeometry(bones, boneMap, boneWorldPos);
  const teethGeom = buildSharkTeethGeometry(bones, boneMap);
  const eyesGeom = buildSharkEyesGeometry(bones, boneMap);

  return {
    bones,
    boneMap,
    skeleton,
    bodyGeom,
    teethGeom,
    eyesGeom
  };
}

/**
 * Builds the continuous, high-definition skinned body mesh:
 * - Cephalofoil with leading edge median notch and lateral foil wings
 * - Ventral mouth cavity indentation
 * - Gills
 * - 1st falcate dorsal fin
 * - Pectoral fins
 * - Pelvic, 2nd dorsal, and anal fins
 * - Heterocercal caudal fin with upper subterminal notch and lower lobe
 */
function buildSharkBodyGeometry(bones, boneMap, boneWorldPos) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];

  // Longitudinal slices from rostrum (+Z) to caudal peduncle (-Z)
  const numSlices = 100;
  const numRadial = 48; // Circumferential resolution

  // Z bounds: Rostrum tip at z = +2.28, Caudal peduncle starts at z = -2.45
  const zStart = 2.28;
  const zEnd = -2.45;

  const sliceData = [];

  for (let s = 0; s <= numSlices; s++) {
    const t = s / numSlices; // 0 to 1
    const z = zStart * (1 - t) + zEnd * t;

    // Cross-section profile depending on z
    let halfWidth = 0.28;
    let heightTop = 0.28;
    let heightBottom = 0.24;
    let yCenter = 0.0;
    let isCephalofoil = false;
    let isMouthZone = false;

    if (z > 1.60) {
      // Cephalofoil zone (Great Hammerhead - Sphyrna mokarran)
      // Head extends from z=1.60 up to z=2.28
      isCephalofoil = true;
      const headT = (z - 1.60) / (2.28 - 1.60); // 0 at neck, 1 at snout tip

      // Cephalofoil width: peaks around headT = 0.65 (z ~ 2.04), width ~ 1.34m (halfWidth ~ 0.67m)
      const baseW = 0.35 + 0.34 * Math.sin(Math.pow(headT, 0.7) * Math.PI);
      halfWidth = baseW;
      if (headT > 0.85) {
        // leading edge rounding
        halfWidth *= Math.sin((1 - headT) / 0.15 * Math.PI * 0.5);
        halfWidth = Math.max(halfWidth, 0.15);
      }

      // Cephalofoil hydrofoil thickness (streamlined foil: flatter bottom, arched top)
      heightTop = 0.14 * (1 - headT * 0.45);
      heightBottom = 0.10 * (1 - headT * 0.45);
      yCenter = -0.04 * (1 - headT);
    } else if (z > 1.25) {
      // Neck and Ventral Mouth Zone
      const neckT = (z - 1.25) / (1.60 - 1.25);
      halfWidth = 0.32 + 0.08 * neckT;
      heightTop = 0.34 - 0.12 * neckT;
      heightBottom = 0.28 - 0.12 * neckT;
      yCenter = 0.01;
      isMouthZone = true;
    } else if (z > 0.0) {
      // Muscular Thorax / Pectoral / 1st Dorsal base zone
      const bodyT = z / 1.25;
      halfWidth = 0.32 + 0.04 * Math.sin(bodyT * Math.PI);
      heightTop = 0.36 + 0.02 * Math.sin(bodyT * Math.PI);
      heightBottom = 0.27;
      yCenter = 0.03;
    } else if (z > -1.2) {
      // Mid trunk & pelvic zone
      const trunkT = (z - (-1.2)) / 1.2;
      halfWidth = 0.20 + 0.12 * trunkT;
      heightTop = 0.25 + 0.11 * trunkT;
      heightBottom = 0.18 + 0.09 * trunkT;
      yCenter = 0.02;
    } else {
      // Caudal peduncle zone
      const tailT = (z - zEnd) / (-1.2 - zEnd);
      halfWidth = 0.06 + 0.14 * tailT;
      heightTop = 0.08 + 0.17 * tailT;
      heightBottom = 0.06 + 0.12 * tailT;
      yCenter = 0.01;
    }

    sliceData.push({
      z,
      halfWidth,
      heightTop,
      heightBottom,
      yCenter,
      isCephalofoil,
      isMouthZone,
      t
    });
  }

  // Generate radial vertices for body tube
  for (let s = 0; s <= numSlices; s++) {
    const sl = sliceData[s];
    const z = sl.z;

    for (let r = 0; r <= numRadial; r++) {
      const u = r / numRadial;
      const angle = u * Math.PI * 2; // 0 at dorsal midline, PI/2 right flank, PI ventral, 3PI/2 left flank

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      let x = sinA * sl.halfWidth;
      let y = (cosA >= 0 ? cosA * sl.heightTop : cosA * sl.heightBottom) + sl.yCenter;
      let zOffset = 0;

      // Cephalofoil anterior leading-edge curvature and median notch:
      if (sl.isCephalofoil) {
        const normX = Math.abs(x) / Math.max(0.01, sl.halfWidth); // 0 at center, 1 at lateral tip
        // Great Hammerhead (Sphyrna mokarran) leading edge has a slight median indentation:
        // center is slightly indented, lateral lobes bow forward, then sweep back near tips
        const leadingEdgeCurve = 0.08 * Math.sin(normX * Math.PI * 0.9) - 0.03 * Math.cos(normX * Math.PI * 2);
        if (sl.t < 0.15) {
          zOffset = leadingEdgeCurve * (1 - sl.t / 0.15);
        }

        // Foil cross-section: thin leading & trailing margins, flatter ventral surface
        if (cosA < 0) {
          // Ventral flatten
          y = -sl.heightBottom * Math.pow(Math.abs(cosA), 0.8) + sl.yCenter;
        }
      }

      // Mouth cavity pocket: Ventral indentation between z=1.35 and 1.68
      if (sl.isMouthZone && cosA < -0.4 && Math.abs(x) < 0.22) {
        const mouthFactor = (1 - (Math.abs(x) / 0.22)) * ((-cosA - 0.4) / 0.6);
        // Recess the mouth pocket upward to create realistic buccal cavity
        y += mouthFactor * 0.14;
      }

      // Gill clefts: 5 lateral indentations at z in [0.95, 1.30] on flanks (|sinA| > 0.85)
      if (z > 0.95 && z < 1.30 && Math.abs(sinA) > 0.80 && Math.abs(cosA) < 0.5) {
        const gillFreq = (z - 0.95) / 0.35 * 5.0 * Math.PI;
        const gillIndent = 0.012 * Math.max(0, Math.sin(gillFreq));
        x -= Math.sign(sinA) * gillIndent;
      }

      const vx = x;
      const vy = y;
      const vz = z + zOffset;

      positions.push(vx, vy, vz);
      // UV: u across circumference (0=dorsal, 0.5=ventral), v along length (0=snout, 1=peduncle)
      uvs.push(u, sl.t);

      // Compute skin weights along spine
      computeSpineWeights(vz, vx, vy, bones, boneMap, boneWorldPos, skinIndices, skinWeights);
    }
  }

  // Generate body triangle indices
  for (let s = 0; s < numSlices; s++) {
    for (let r = 0; r < numRadial; r++) {
      const a = s * (numRadial + 1) + r;
      const b = (s + 1) * (numRadial + 1) + r;
      const c = (s + 1) * (numRadial + 1) + (r + 1);
      const d = s * (numRadial + 1) + (r + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // Close Snout Tip (Anterior Cap)
  const snoutTipIndex = positions.length / 3;
  positions.push(0, -0.04, zStart + 0.05);
  uvs.push(0.5, 0.0);
  computeSpineWeights(zStart + 0.05, 0, -0.04, bones, boneMap, boneWorldPos, skinIndices, skinWeights);

  for (let r = 0; r < numRadial; r++) {
    const a = r;
    const b = r + 1;
    indices.push(snoutTipIndex, b, a);
  }

  // Next: Add 1st Dorsal Fin (The monumental falcate fin of Sphyrna mokarran!)
  append1stDorsalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos);

  // Add 2nd Dorsal Fin & Anal Fin
  append2ndDorsalAndAnalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos);

  // Add Pelvic Fins
  appendPelvicFins(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos);

  // Add Pectoral Fins (Hydrodynamic falcate hydrofoils with wing bones)
  appendPectoralFins(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos);

  // Add Heterocercal Caudal Fin (Giant upper lobe with subterminal notch + stiff lower lobe)
  appendHeterocercalCaudalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.setIndex(indices);

  geom.computeVertexNormals();
  return geom;
}

/**
 * Calculates continuous smooth skinning weights across adjacent spine bones
 */
function computeSpineWeights(z, x, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights) {
  // Find two closest spine bones along Z
  const spineBones = [
    { name: 'head_cephalofoil', idx: bones.indexOf(boneMap['head_cephalofoil']), z: 1.88 },
    { name: 'neck', idx: bones.indexOf(boneMap['neck']), z: 1.40 },
    { name: 'pectoral_spine', idx: bones.indexOf(boneMap['pectoral_spine']), z: 1.00 },
    { name: 'trunk_front', idx: bones.indexOf(boneMap['trunk_front']), z: 0.55 },
    { name: 'root', idx: bones.indexOf(boneMap['root']), z: 0.00 },
    { name: 'trunk_rear', idx: bones.indexOf(boneMap['trunk_rear']), z: -0.55 },
    { name: 'pelvic_spine', idx: bones.indexOf(boneMap['pelvic_spine']), z: -1.05 },
    { name: 'tail_base', idx: bones.indexOf(boneMap['tail_base']), z: -1.60 },
    { name: 'tail_mid', idx: bones.indexOf(boneMap['tail_mid']), z: -2.10 },
    { name: 'caudal_fin', idx: bones.indexOf(boneMap['caudal_fin']), z: -2.55 }
  ];

  // Calculate weights based on distance to spine bone segments
  let bestIdx1 = spineBones[0].idx;
  let bestIdx2 = spineBones[1].idx;
  let weight1 = 1.0;
  let weight2 = 0.0;

  for (let i = 0; i < spineBones.length - 1; i++) {
    const bA = spineBones[i];
    const bB = spineBones[i + 1];
    if (z <= bA.z && z >= bB.z) {
      bestIdx1 = bA.idx;
      bestIdx2 = bB.idx;
      const t = (bA.z - z) / (bA.z - bB.z); // 0 at bA, 1 at bB
      // Smooth cosine curve
      const factor = 0.5 - 0.5 * Math.cos(t * Math.PI);
      weight1 = 1.0 - factor;
      weight2 = factor;
      break;
    } else if (z > spineBones[0].z) {
      bestIdx1 = spineBones[0].idx;
      bestIdx2 = spineBones[1].idx;
      weight1 = 1.0;
      weight2 = 0.0;
      break;
    } else if (z < spineBones[spineBones.length - 1].z) {
      bestIdx1 = spineBones[spineBones.length - 1].idx;
      bestIdx2 = spineBones[spineBones.length - 2].idx;
      weight1 = 1.0;
      weight2 = 0.0;
    }
  }

  skinIndices.push(bestIdx1, bestIdx2, 0, 0);
  skinWeights.push(weight1, weight2, 0, 0);
}

/**
 * Monumental 1st Dorsal Fin:
 * In Great Hammerhead (Sphyrna mokarran), the 1st dorsal fin is extraordinarily tall and falcate,
 * with pointed apex and deeply concave posterior margin.
 */
function append1stDorsalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos) {
  const baseIndex = positions.length / 3;
  const numStepsZ = 16;
  const numStepsH = 20;

  // Fin extends from z = 0.65 (anterior root) to z = -0.15 (posterior insertion)
  // Height extends up to y ~ 1.08m (apex)!
  const zRootAnt = 0.62;
  const zRootPost = -0.05;
  const rootY = 0.35;
  const finHeight = 0.88;

  for (let h = 0; h <= numStepsH; h++) {
    const ht = h / numStepsH; // 0 at base, 1 at tip
    // The leading edge curves back sharply as height increases
    const sweepBack = Math.pow(ht, 1.4) * 0.42;
    const currentZAnt = zRootAnt - sweepBack;

    // Chord length (anterior-to-posterior fin width) tapers sharply toward tip
    const chord = (zRootAnt - zRootPost) * (1 - Math.pow(ht, 0.75) * 0.88);
    const currentZPost = currentZAnt - chord;

    const y = rootY + ht * finHeight;

    for (let s = 0; s <= numStepsZ; s++) {
      const st = s / numStepsZ; // 0 at leading edge, 1 at trailing edge
      const z = currentZAnt * (1 - st) + currentZPost * st;

      // Airfoil thickness profile (NACA-like hydrofoil section)
      // Thicker near leading edge (st ~ 0.3), knife-thin at trailing edge (st ~ 1.0)
      const maxThickness = (1 - ht * 0.75) * 0.07;
      const foilProfile = Math.sin(Math.pow(st, 0.6) * Math.PI) * (1 - st * 0.6);
      const halfThick = maxThickness * foilProfile;

      // Left surface (x > 0)
      positions.push(halfThick, y, z);
      uvs.push(st * 0.5, ht);
      computeSpineWeights(z, halfThick, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);

      // Right surface (x < 0)
      positions.push(-halfThick, y, z);
      uvs.push(0.5 + st * 0.5, ht);
      computeSpineWeights(z, -halfThick, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);
    }
  }

  // Create triangles for 1st dorsal fin
  const rowStride = (numStepsZ + 1) * 2;
  for (let h = 0; h < numStepsH; h++) {
    for (let s = 0; s < numStepsZ; s++) {
      const vL0 = baseIndex + h * rowStride + s * 2;
      const vL1 = baseIndex + h * rowStride + (s + 1) * 2;
      const vL2 = baseIndex + (h + 1) * rowStride + (s + 1) * 2;
      const vL3 = baseIndex + (h + 1) * rowStride + s * 2;

      // Left side faces
      indices.push(vL0, vL2, vL1);
      indices.push(vL0, vL3, vL2);

      // Right side faces
      const vR0 = vL0 + 1;
      const vR1 = vL1 + 1;
      const vR2 = vL2 + 1;
      const vR3 = vL3 + 1;

      indices.push(vR0, vR1, vR2);
      indices.push(vR0, vR2, vR3);
    }

    // Stitch leading edge
    const lAntBottom = baseIndex + h * rowStride;
    const rAntBottom = lAntBottom + 1;
    const lAntTop = baseIndex + (h + 1) * rowStride;
    const rAntTop = lAntTop + 1;
    indices.push(lAntBottom, lAntTop, rAntTop);
    indices.push(lAntBottom, rAntTop, rAntBottom);

    // Stitch trailing edge
    const lPostBottom = baseIndex + h * rowStride + numStepsZ * 2;
    const rPostBottom = lPostBottom + 1;
    const lPostTop = baseIndex + (h + 1) * rowStride + numStepsZ * 2;
    const rPostTop = lPostTop + 1;
    indices.push(lPostBottom, rPostBottom, rPostTop);
    indices.push(lPostBottom, rPostTop, lPostTop);
  }
}

/**
 * 2nd Dorsal Fin and Anal Fin:
 * In Great Hammerhead, the 2nd dorsal is relatively large and falcate with a deeply notched rear margin.
 */
function append2ndDorsalAndAnalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos) {
  // 2nd Dorsal Fin (Dorsal, z in [-1.50, -1.85])
  appendFalcateFin(
    positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos,
    { zAnt: -1.48, zPost: -1.82, rootY: 0.16, height: 0.32, sweep: 0.18, maxThick: 0.035, isVentral: false }
  );

  // Anal Fin (Ventral, z in [-1.55, -1.88])
  appendFalcateFin(
    positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos,
    { zAnt: -1.55, zPost: -1.88, rootY: -0.15, height: 0.28, sweep: 0.16, maxThick: 0.032, isVentral: true }
  );
}

/**
 * Pelvic Fins (Paired ventro-lateral fins)
 */
function appendPelvicFins(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos) {
  for (const side of [1, -1]) {
    appendPairedFin(
      positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos,
      {
        side,
        rootX: 0.14 * side, rootY: -0.16, rootZ: -0.92,
        tipX: 0.32 * side, tipY: -0.28, tipZ: -1.18,
        length: 0.30, span: 0.22, thickness: 0.025
      }
    );
  }
}

/**
 * Broad Falcate Pectoral Fins:
 * Large hydrofoil wings for turning, banking, and vertical pitch control.
 * Connected to pec_L and pec_R bones!
 */
function appendPectoralFins(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos) {
  const pecLIdx = bones.indexOf(boneMap['pec_L']);
  const pecRIdx = bones.indexOf(boneMap['pec_R']);
  const pecSpineIdx = bones.indexOf(boneMap['pectoral_spine']);

  for (const side of [1, -1]) {
    const baseIndex = positions.length / 3;
    const targetBoneIdx = side > 0 ? pecLIdx : pecRIdx;

    const numSpan = 14;
    const numChord = 12;

    // Wing root along body flank
    const rootAntZ = 0.92;
    const rootPostZ = 0.42;
    const rootX = 0.30 * side;
    const rootY = -0.12;

    // Wing tip position
    const tipSpan = 0.82; // Lateral wing span
    const tipSweep = 0.58; // Backward sweep
    const tipDrop = 0.28; // Downward anhedral angle

    for (let sp = 0; sp <= numSpan; sp++) {
      const spt = sp / numSpan; // 0 at root, 1 at wing tip

      const curRootAntX = rootX;
      const curRootAntY = rootY;
      const curRootAntZ = rootAntZ;

      const leadingX = curRootAntX + side * tipSpan * spt;
      const leadingY = curRootAntY - tipDrop * Math.pow(spt, 1.2);
      const leadingZ = curRootAntZ - tipSweep * Math.pow(spt, 1.15);

      // Chord length tapers toward falcate tip
      const chordLen = (rootAntZ - rootPostZ) * (1 - Math.pow(spt, 0.8) * 0.82);
      const trailingZ = leadingZ - chordLen;
      const trailingY = leadingY + 0.04 * (1 - spt);

      for (let ch = 0; ch <= numChord; ch++) {
        const cht = ch / numChord; // 0 at leading edge, 1 at trailing edge

        const z = leadingZ * (1 - cht) + trailingZ * cht;
        const y = leadingY * (1 - cht) + trailingY * cht;
        const x = leadingX;

        // Hydrofoil thickness (thicker at 25% chord, sharp at trailing edge)
        const thickness = 0.045 * (1 - spt * 0.7) * Math.sin(Math.pow(cht, 0.5) * Math.PI) * (1 - cht * 0.7);

        // Upper surface
        positions.push(x, y + thickness, z);
        uvs.push(spt, cht * 0.5);
        skinIndices.push(targetBoneIdx, pecSpineIdx, 0, 0);
        skinWeights.push(0.3 + 0.7 * spt, 0.7 * (1 - spt), 0, 0);

        // Lower surface
        positions.push(x, y - thickness, z);
        uvs.push(spt, 0.5 + cht * 0.5);
        skinIndices.push(targetBoneIdx, pecSpineIdx, 0, 0);
        skinWeights.push(0.3 + 0.7 * spt, 0.7 * (1 - spt), 0, 0);
      }
    }

    const rowStride = (numChord + 1) * 2;
    for (let sp = 0; sp < numSpan; sp++) {
      for (let ch = 0; ch < numChord; ch++) {
        const vU0 = baseIndex + sp * rowStride + ch * 2;
        const vU1 = baseIndex + sp * rowStride + (ch + 1) * 2;
        const vU2 = baseIndex + (sp + 1) * rowStride + (ch + 1) * 2;
        const vU3 = baseIndex + (sp + 1) * rowStride + ch * 2;

        if (side > 0) {
          indices.push(vU0, vU1, vU2);
          indices.push(vU0, vU2, vU3);
        } else {
          indices.push(vU0, vU2, vU1);
          indices.push(vU0, vU3, vU2);
        }

        const vL0 = vU0 + 1;
        const vL1 = vU1 + 1;
        const vL2 = vU2 + 1;
        const vL3 = vU3 + 1;

        if (side > 0) {
          indices.push(vL0, vL2, vL1);
          indices.push(vL0, vL3, vL2);
        } else {
          indices.push(vL0, vL1, vL2);
          indices.push(vL0, vL2, vL3);
        }
      }

      // Stitch leading edge
      const uLead0 = baseIndex + sp * rowStride;
      const lLead0 = uLead0 + 1;
      const uLead1 = baseIndex + (sp + 1) * rowStride;
      const lLead1 = uLead1 + 1;
      indices.push(uLead0, lLead0, lLead1);
      indices.push(uLead0, lLead1, uLead1);

      // Stitch trailing edge
      const uTrail0 = baseIndex + sp * rowStride + numChord * 2;
      const lTrail0 = uTrail0 + 1;
      const uTrail1 = baseIndex + (sp + 1) * rowStride + numChord * 2;
      const lTrail1 = uTrail1 + 1;
      indices.push(uTrail0, uTrail1, lTrail1);
      indices.push(uTrail0, lTrail1, lTrail0);
    }
  }
}

/**
 * Heterocercal Caudal Fin:
 * Hallmark of pelagic sharks — immense upper lobe reaching high above body axis with subterminal notch,
 * and a powerful lower lobe for thrust generation!
 */
function appendHeterocercalCaudalFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos) {
  const caudalIdx = bones.indexOf(boneMap['caudal_fin']);
  const tailMidIdx = bones.indexOf(boneMap['tail_mid']);

  const baseIndex = positions.length / 3;

  // Upper lobe: sweeps from z = -2.40 back to z = -3.42, reaching y ~ +0.92m!
  const numStepsH = 22;
  const numStepsC = 10;

  const zOrigin = -2.35;
  const yOrigin = 0.02;

  // Upper Lobe
  for (let h = 0; h <= numStepsH; h++) {
    const ht = h / numStepsH; // 0 at base, 1 at tip
    const y = yOrigin + ht * 0.92;
    // Swept back angle
    let zLeading = zOrigin - ht * 1.05;

    // Subterminal notch near the apex (ht in [0.82, 0.92]):
    let notchOffset = 0;
    if (ht > 0.82 && ht < 0.94) {
      notchOffset = 0.05 * Math.sin((ht - 0.82) / 0.12 * Math.PI);
    }

    const chord = 0.28 * (1 - Math.pow(ht, 0.7) * 0.85);
    const zTrailing = zLeading - chord + notchOffset;

    const thickness = 0.05 * (1 - ht * 0.8);

    for (let c = 0; c <= numStepsC; c++) {
      const ct = c / numStepsC; // 0 at leading edge, 1 at trailing
      const z = zLeading * (1 - ct) + zTrailing * ct;
      const foilThick = thickness * Math.sin(Math.pow(ct, 0.5) * Math.PI);

      // Left surface
      positions.push(foilThick, y, z);
      uvs.push(ct * 0.5, ht);
      skinIndices.push(caudalIdx, tailMidIdx, 0, 0);
      skinWeights.push(0.85, 0.15, 0, 0);

      // Right surface
      positions.push(-foilThick, y, z);
      uvs.push(0.5 + ct * 0.5, ht);
      skinIndices.push(caudalIdx, tailMidIdx, 0, 0);
      skinWeights.push(0.85, 0.15, 0, 0);
    }
  }

  const rowStride = (numStepsC + 1) * 2;
  for (let h = 0; h < numStepsH; h++) {
    for (let c = 0; c < numStepsC; c++) {
      const vL0 = baseIndex + h * rowStride + c * 2;
      const vL1 = baseIndex + h * rowStride + (c + 1) * 2;
      const vL2 = baseIndex + (h + 1) * rowStride + (c + 1) * 2;
      const vL3 = baseIndex + (h + 1) * rowStride + c * 2;

      indices.push(vL0, vL2, vL1);
      indices.push(vL0, vL3, vL2);

      const vR0 = vL0 + 1;
      const vR1 = vL1 + 1;
      const vR2 = vL2 + 1;
      const vR3 = vL3 + 1;

      indices.push(vR0, vR1, vR2);
      indices.push(vR0, vR2, vR3);
    }

    // Stitch leading and trailing edges
    const lLead0 = baseIndex + h * rowStride;
    const rLead0 = lLead0 + 1;
    const lLead1 = baseIndex + (h + 1) * rowStride;
    const rLead1 = lLead1 + 1;
    indices.push(lLead0, lLead1, rLead1);
    indices.push(lLead0, rLead1, rLead0);

    const lTrail0 = baseIndex + h * rowStride + numStepsC * 2;
    const rTrail0 = lTrail0 + 1;
    const lTrail1 = baseIndex + (h + 1) * rowStride + numStepsC * 2;
    const rTrail1 = lTrail1 + 1;
    indices.push(lTrail0, rTrail0, rTrail1);
    indices.push(lTrail0, rTrail1, lTrail1);
  }

  // Lower Lobe (Hypochordal lobe)
  const lowerBaseIndex = positions.length / 3;
  const numStepsLowerH = 14;

  for (let h = 0; h <= numStepsLowerH; h++) {
    const ht = h / numStepsLowerH; // 0 at origin, 1 at lower tip
    const y = yOrigin - ht * 0.44; // Extends downward
    const zLeading = zOrigin - ht * 0.38;
    const chord = 0.22 * (1 - ht * 0.82);
    const zTrailing = zLeading - chord;
    const thickness = 0.045 * (1 - ht * 0.75);

    for (let c = 0; c <= numStepsC; c++) {
      const ct = c / numStepsC;
      const z = zLeading * (1 - ct) + zTrailing * ct;
      const foilThick = thickness * Math.sin(Math.pow(ct, 0.5) * Math.PI);

      positions.push(foilThick, y, z);
      uvs.push(ct * 0.5, ht);
      skinIndices.push(caudalIdx, tailMidIdx, 0, 0);
      skinWeights.push(0.85, 0.15, 0, 0);

      positions.push(-foilThick, y, z);
      uvs.push(0.5 + ct * 0.5, ht);
      skinIndices.push(caudalIdx, tailMidIdx, 0, 0);
      skinWeights.push(0.85, 0.15, 0, 0);
    }
  }

  for (let h = 0; h < numStepsLowerH; h++) {
    for (let c = 0; c < numStepsC; c++) {
      const vL0 = lowerBaseIndex + h * rowStride + c * 2;
      const vL1 = lowerBaseIndex + h * rowStride + (c + 1) * 2;
      const vL2 = lowerBaseIndex + (h + 1) * rowStride + (c + 1) * 2;
      const vL3 = lowerBaseIndex + (h + 1) * rowStride + c * 2;

      indices.push(vL0, vL1, vL2);
      indices.push(vL0, vL2, vL3);

      const vR0 = vL0 + 1;
      const vR1 = vL1 + 1;
      const vR2 = vL2 + 1;
      const vR3 = vL3 + 1;

      indices.push(vR0, vR2, vR1);
      indices.push(vR0, vR3, vR2);
    }

    const lLead0 = lowerBaseIndex + h * rowStride;
    const rLead0 = lLead0 + 1;
    const lLead1 = lowerBaseIndex + (h + 1) * rowStride;
    const rLead1 = lLead1 + 1;
    indices.push(lLead0, rLead1, lLead1);
    indices.push(lLead0, rLead0, rLead1);

    const lTrail0 = lowerBaseIndex + h * rowStride + numStepsC * 2;
    const rTrail0 = lTrail0 + 1;
    const lTrail1 = lowerBaseIndex + (h + 1) * rowStride + numStepsC * 2;
    const rTrail1 = lTrail1 + 1;
    indices.push(lTrail0, lTrail1, rTrail1);
    indices.push(lTrail0, rTrail1, rTrail0);
  }
}

/**
 * Helper to build falcate single fins (2nd dorsal & anal)
 */
function appendFalcateFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos, cfg) {
  const baseIndex = positions.length / 3;
  const numH = 10;
  const numZ = 8;
  const rowStride = (numZ + 1) * 2;

  for (let h = 0; h <= numH; h++) {
    const ht = h / numH;
    const ySign = cfg.isVentral ? -1 : 1;
    const y = cfg.rootY + ySign * ht * cfg.height;
    const currentZAnt = cfg.zAnt - Math.pow(ht, 1.3) * cfg.sweep;
    const chord = (cfg.zAnt - cfg.zPost) * (1 - Math.pow(ht, 0.75) * 0.85);
    const currentZPost = currentZAnt - chord;

    for (let s = 0; s <= numZ; s++) {
      const st = s / numZ;
      const z = currentZAnt * (1 - st) + currentZPost * st;
      const halfThick = cfg.maxThick * (1 - ht * 0.7) * Math.sin(Math.pow(st, 0.5) * Math.PI);

      positions.push(halfThick, y, z);
      uvs.push(st * 0.5, ht);
      computeSpineWeights(z, halfThick, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);

      positions.push(-halfThick, y, z);
      uvs.push(0.5 + st * 0.5, ht);
      computeSpineWeights(z, -halfThick, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);
    }
  }

  for (let h = 0; h < numH; h++) {
    for (let s = 0; s < numZ; s++) {
      const vL0 = baseIndex + h * rowStride + s * 2;
      const vL1 = baseIndex + h * rowStride + (s + 1) * 2;
      const vL2 = baseIndex + (h + 1) * rowStride + (s + 1) * 2;
      const vL3 = baseIndex + (h + 1) * rowStride + s * 2;

      if (!cfg.isVentral) {
        indices.push(vL0, vL2, vL1);
        indices.push(vL0, vL3, vL2);
      } else {
        indices.push(vL0, vL1, vL2);
        indices.push(vL0, vL2, vL3);
      }

      const vR0 = vL0 + 1;
      const vR1 = vL1 + 1;
      const vR2 = vL2 + 1;
      const vR3 = vL3 + 1;

      if (!cfg.isVentral) {
        indices.push(vR0, vR1, vR2);
        indices.push(vR0, vR2, vR3);
      } else {
        indices.push(vR0, vR2, vR1);
        indices.push(vR0, vR3, vR2);
      }
    }
  }
}

/**
 * Helper to build paired pelvic fins
 */
function appendPairedFin(positions, uvs, indices, skinIndices, skinWeights, bones, boneMap, boneWorldPos, cfg) {
  const baseIndex = positions.length / 3;
  const numSteps = 6;

  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const x = cfg.rootX * (1 - t) + cfg.tipX * t;
    const y = cfg.rootY * (1 - t) + cfg.tipY * t;
    const zAnt = cfg.rootZ * (1 - t) + cfg.tipZ * t;
    const zPost = zAnt - cfg.length * (1 - t * 0.7);

    positions.push(x, y + cfg.thickness, zAnt);
    uvs.push(t, 0.0);
    computeSpineWeights(zAnt, x, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);

    positions.push(x, y - cfg.thickness, zPost);
    uvs.push(t, 1.0);
    computeSpineWeights(zPost, x, y, bones, boneMap, boneWorldPos, skinIndices, skinWeights);
  }

  for (let i = 0; i < numSteps; i++) {
    const a = baseIndex + i * 2;
    const b = baseIndex + i * 2 + 1;
    const c = baseIndex + (i + 1) * 2;
    const d = baseIndex + (i + 1) * 2 + 1;

    indices.push(a, c, b);
    indices.push(c, d, b);
    indices.push(a, b, c);
    indices.push(c, b, d);
  }
}

/**
 * Builds the razor-sharp triangular serrated shark teeth:
 * Upper teeth weighted 100% to 'jaw_upper' (Palatoquadrate)
 * Lower teeth weighted 100% to 'jaw_lower' (Meckel's cartilage)
 */
function buildSharkTeethGeometry(bones, boneMap) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];

  const jawUpperIdx = bones.indexOf(boneMap['jaw_upper']);
  const jawLowerIdx = bones.indexOf(boneMap['jaw_lower']);

  // Upper Jaw Teeth: 2 rows of 18 triangular teeth along the dental arch
  const numUpperTeeth = 18;
  const archWidthUpper = 0.22;
  const archDepthUpper = 0.16;
  const archZUpper = 1.66;
  const archYUpper = -0.13;

  for (let row = 0; row < 2; row++) {
    const rowOffsetZ = -row * 0.025;
    const rowOffsetY = row * 0.01;
    const toothScale = 1.0 - row * 0.15;

    for (let i = 0; i < numUpperTeeth; i++) {
      const u = (i + 0.5) / numUpperTeeth; // 0 to 1
      const archAngle = (u - 0.5) * Math.PI * 0.95; // arch curve

      const tx = Math.sin(archAngle) * archWidthUpper;
      const tz = archZUpper - (1 - Math.cos(archAngle)) * archDepthUpper + rowOffsetZ;
      const ty = archYUpper + rowOffsetY;

      // Triangular tooth pointing DOWNWARD and slightly outward
      const toothHeight = 0.038 * toothScale;
      const toothWidth = 0.024 * toothScale;
      const toothThick = 0.007 * toothScale;

      appendToothTriangle(
        positions, uvs, indices, skinIndices, skinWeights,
        tx, ty, tz,
        toothWidth, toothHeight, toothThick,
        false, // pointing downward
        jawUpperIdx
      );
    }
  }

  // Lower Jaw Teeth: 2 rows of 16 triangular teeth pointing UPWARD
  const numLowerTeeth = 16;
  const archWidthLower = 0.19;
  const archDepthLower = 0.15;
  const archZLower = 1.63;
  const archYLower = -0.19;

  for (let row = 0; row < 2; row++) {
    const rowOffsetZ = -row * 0.022;
    const rowOffsetY = -row * 0.01;
    const toothScale = 0.95 - row * 0.15;

    for (let i = 0; i < numLowerTeeth; i++) {
      const u = (i + 0.5) / numLowerTeeth;
      const archAngle = (u - 0.5) * Math.PI * 0.92;

      const tx = Math.sin(archAngle) * archWidthLower;
      const tz = archZLower - (1 - Math.cos(archAngle)) * archDepthLower + rowOffsetZ;
      const ty = archYLower + rowOffsetY;

      const toothHeight = 0.034 * toothScale;
      const toothWidth = 0.020 * toothScale;
      const toothThick = 0.006 * toothScale;

      appendToothTriangle(
        positions, uvs, indices, skinIndices, skinWeights,
        tx, ty, tz,
        toothWidth, toothHeight, toothThick,
        true, // pointing upward
        jawLowerIdx
      );
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.setIndex(indices);

  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates a single 3D faceted triangular shark tooth with sharp apex, blade edges, and base
 */
function appendToothTriangle(positions, uvs, indices, skinIndices, skinWeights, cx, cy, cz, w, h, th, pointingUp, boneIdx) {
  const baseIdx = positions.length / 3;
  const yDir = pointingUp ? 1 : -1;

  // Base vertices
  const v0 = [cx - w * 0.5, cy, cz - th * 0.5];
  const v1 = [cx + w * 0.5, cy, cz - th * 0.5];
  const v2 = [cx + w * 0.5, cy, cz + th * 0.5];
  const v3 = [cx - w * 0.5, cy, cz + th * 0.5];
  // Apex tip
  const apex = [cx + (cx * 0.05), cy + yDir * h, cz];

  const verts = [v0, v1, v2, v3, apex];
  for (const v of verts) {
    positions.push(v[0], v[1], v[2]);
    uvs.push(0.5, 0.5);
    skinIndices.push(boneIdx, 0, 0, 0);
    skinWeights.push(1.0, 0, 0, 0);
  }

  // 4 triangular sides
  if (pointingUp) {
    indices.push(baseIdx + 0, baseIdx + 1, baseIdx + 4);
    indices.push(baseIdx + 1, baseIdx + 2, baseIdx + 4);
    indices.push(baseIdx + 2, baseIdx + 3, baseIdx + 4);
    indices.push(baseIdx + 3, baseIdx + 0, baseIdx + 4);
  } else {
    indices.push(baseIdx + 1, baseIdx + 0, baseIdx + 4);
    indices.push(baseIdx + 2, baseIdx + 1, baseIdx + 4);
    indices.push(baseIdx + 3, baseIdx + 2, baseIdx + 4);
    indices.push(baseIdx + 0, baseIdx + 3, baseIdx + 4);
  }
}

/**
 * Builds the lateral eye spheres mounted on the outer tips of the cephalofoil
 */
function buildSharkEyesGeometry(bones, boneMap) {
  const headIdx = bones.indexOf(boneMap['head_cephalofoil']);

  // Spheres at left and right lateral hammer lobes
  const eyeRadius = 0.038;
  const sphere = new THREE.SphereGeometry(eyeRadius, 24, 16);

  const positions = [];
  const normals = [];
  const uvs = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];

  const leftEyePos = new THREE.Vector3(0.66, -0.03, 1.96);
  const rightEyePos = new THREE.Vector3(-0.66, -0.03, 1.96);

  for (const [pos, side] of [[leftEyePos, 1], [rightEyePos, -1]]) {
    const baseIdx = positions.length / 3;
    const posAttr = sphere.attributes.position;
    const normAttr = sphere.attributes.normal;
    const uvAttr = sphere.attributes.uv;

    for (let i = 0; i < posAttr.count; i++) {
      positions.push(
        posAttr.getX(i) + pos.x,
        posAttr.getY(i) + pos.y,
        posAttr.getZ(i) + pos.z
      );
      normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));

      skinIndices.push(headIdx, 0, 0, 0);
      skinWeights.push(1.0, 0, 0, 0);
    }

    const sphereIndices = sphere.index.array;
    for (let i = 0; i < sphereIndices.length; i++) {
      indices.push(baseIdx + sphereIndices[i]);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.setIndex(indices);

  return geom;
}
