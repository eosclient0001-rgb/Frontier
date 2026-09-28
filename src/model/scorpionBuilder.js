import * as THREE from 'three';
import { createScorpionMaterials } from './scorpionMaterials.js';

/**
 * Procedural Builder for an Ultra-Realistic Anatomical Scorpion Model
 * Based on Emperor Scorpion (Pandinus imperator) / Asian Forest Scorpion (Heterometrus spinifer).
 */
export function buildScorpionModel(customMaterials = null) {
  const materials = customMaterials || createScorpionMaterials();
  const root = new THREE.Group();
  root.name = 'ScorpionRoot';

  // Master model container
  const model = new THREE.Group();
  model.name = 'Scorpion';
  root.add(model);

  // Store references to all articulated joints for the animation system
  const joints = {};

  // ==========================================
  // 1. PROSOMA (Carapace / Cephalothorax)
  // ==========================================
  const prosoma = new THREE.Group();
  prosoma.name = 'prosoma';
  prosoma.position.set(0, 0.22, 0.25); // elevated on legs
  model.add(prosoma);
  joints['prosoma'] = prosoma;

  // Carapace Shell Geometry (Trapezoidal arched shield with anterior notch)
  const carapaceGeo = createCarapaceGeometry();
  const carapaceMesh = new THREE.Mesh(carapaceGeo, materials.chitin);
  carapaceMesh.name = 'carapace';
  carapaceMesh.castShadow = true;
  carapaceMesh.receiveShadow = true;
  prosoma.add(carapaceMesh);

  // Median Ocular Tubercle & Median Ocelli (Eyes)
  const ocularTubercle = createMedianEyes(materials);
  prosoma.add(ocularTubercle);

  // Lateral Ocelli (3 pairs on anterolateral corners)
  const lateralEyes = createLateralEyes(materials);
  prosoma.add(lateralEyes);

  // Chelicerae (Mouthparts)
  const chelicerae = createChelicerae(materials);
  prosoma.add(chelicerae);

  // Ventral Sternum (Pentagonal plate between legs)
  const sternum = createSternum(materials);
  prosoma.add(sternum);

  // ==========================================
  // 2. MESOSOMA (Pre-Abdomen: 7 Tergite Segments)
  // ==========================================
  // Segments 1-7 form an articulated chain starting from the rear of prosoma
  const mesosomaJoints = [];
  let parentSegment = prosoma;

  // Tergite dimensions (width, height, length)
  const tergiteDimensions = [
    { w: 0.52, h: 0.16, l: 0.11, zOffset: -0.22 }, // Tergite 1
    { w: 0.56, h: 0.17, l: 0.12, zOffset: -0.11 }, // Tergite 2
    { w: 0.60, h: 0.18, l: 0.12, zOffset: -0.11 }, // Tergite 3 (widest)
    { w: 0.60, h: 0.18, l: 0.12, zOffset: -0.11 }, // Tergite 4
    { w: 0.56, h: 0.17, l: 0.12, zOffset: -0.11 }, // Tergite 5
    { w: 0.48, h: 0.16, l: 0.12, zOffset: -0.11 }, // Tergite 6
    { w: 0.38, h: 0.15, l: 0.13, zOffset: -0.11 }, // Tergite 7 (taper to metasoma)
  ];

  tergiteDimensions.forEach((dim, idx) => {
    const segNum = idx + 1;
    const segGroup = new THREE.Group();
    segGroup.name = `mesosoma_${segNum}`;
    segGroup.position.set(0, 0, dim.zOffset);

    // Sculpted Tergite Shell with median carina and overlapping rim
    const tergiteMesh = createTergiteMesh(dim.w, dim.h, dim.l, segNum, materials);
    segGroup.add(tergiteMesh);

    // Ventral Sternite with Book Lung Spiracles (segments 3-7)
    if (segNum >= 3) {
      const sterniteMesh = createSterniteMesh(dim.w * 0.9, dim.h * 0.8, dim.l * 0.9, materials);
      segGroup.add(sterniteMesh);
    }

    // Ventral Pectines on segment 2
    if (segNum === 2) {
      const pectines = createPectines(materials);
      segGroup.add(pectines);
    }

    parentSegment.add(segGroup);
    joints[`mesosoma_${segNum}`] = segGroup;
    mesosomaJoints.push(segGroup);
    parentSegment = segGroup;
  });

  // ==========================================
  // 3. METASOMA (Tail: 5 Caudal Segments + Telson)
  // ==========================================
  // Metasoma segments 1-5 articulate sequentially, terminating in the telson
  const metasomaDimensions = [
    { r: 0.09, l: 0.20, keels: 8 }, // Metasoma 1 (broadest)
    { r: 0.085, l: 0.22, keels: 8 }, // Metasoma 2
    { r: 0.08, l: 0.24, keels: 8 }, // Metasoma 3
    { r: 0.075, l: 0.26, keels: 8 }, // Metasoma 4
    { r: 0.07, l: 0.30, keels: 8 }, // Metasoma 5 (longest, ventral serration)
  ];

  // Default natural curled posture angles for metasoma segments
  // Scorpions carry their tail arched forward over the mesosoma
  const defaultTailCurvature = [
    { pitch: 0.32, y: 0.04, z: -0.10 },  // Segment 1: curves upward
    { pitch: 0.42, y: 0.08, z: -0.19 },  // Segment 2: ascends steeply
    { pitch: 0.50, y: 0.16, z: -0.18 },  // Segment 3: arches over apex
    { pitch: 0.58, y: 0.18, z: -0.14 },  // Segment 4: curves forward
    { pitch: 0.65, y: 0.16, z: -0.10 },  // Segment 5: points forward/downward
  ];

  let tailParent = joints['mesosoma_7'];

  metasomaDimensions.forEach((dim, idx) => {
    const segNum = idx + 1;
    const tailSeg = new THREE.Group();
    tailSeg.name = `metasoma_${segNum}`;

    const def = defaultTailCurvature[idx];
    tailSeg.position.set(0, def.y, def.z);
    tailSeg.rotation.x = def.pitch;

    // Segment cylinder with 8 longitudinal carinae keels & granules
    const segMesh = createMetasomaSegmentMesh(dim.r, dim.l, segNum, materials);
    tailSeg.add(segMesh);

    tailParent.add(tailSeg);
    joints[`metasoma_${segNum}`] = tailSeg;
    tailParent = tailSeg;
  });

  // TELSON (Venom Vesicle Ampulla + Curved Aculeus Stinger Barb)
  const telsonGroup = new THREE.Group();
  telsonGroup.name = 'telson';
  telsonGroup.position.set(0, 0.08, 0.26);
  telsonGroup.rotation.x = 0.55; // Angle stinger poised forward

  const telsonMesh = createTelsonMesh(materials);
  telsonGroup.add(telsonMesh);

  tailParent.add(telsonGroup);
  joints['telson'] = telsonGroup;

  // ==========================================
  // 4. PEDIPALPS (Raptorial Pincers: Left & Right)
  // ==========================================
  ['L', 'R'].forEach((side) => {
    const isLeft = side === 'L';
    const sign = isLeft ? 1 : -1;

    // Coxa / Base on Prosoma
    const pedipalpBase = new THREE.Group();
    pedipalpBase.name = `pedipalp_${side}_base`;
    pedipalpBase.position.set(sign * 0.16, 0.02, 0.22);
    prosoma.add(pedipalpBase);
    joints[pedipalpBase.name] = pedipalpBase;

    // Trochanter (horizontal/vertical swivel)
    const trochanter = new THREE.Group();
    trochanter.name = `pedipalp_${side}_trochanter`;
    trochanter.rotation.y = sign * 0.45;
    trochanter.rotation.z = -sign * 0.1;
    pedipalpBase.add(trochanter);
    joints[trochanter.name] = trochanter;

    const trochMesh = createTrochanterMesh(materials);
    trochanter.add(trochMesh);

    // Femur (Humerus) - prismatic keeled segment extending outward/forward
    const femur = new THREE.Group();
    femur.name = `pedipalp_${side}_femur`;
    femur.position.set(sign * 0.14, 0.02, 0.08);
    femur.rotation.y = sign * 0.35;
    femur.rotation.z = -sign * 0.08;
    trochanter.add(femur);
    joints[femur.name] = femur;

    const femurMesh = createPedipalpFemurMesh(sign, materials);
    femur.add(femurMesh);

    // Patella (Brachium / Elbow) - curves forward and inward
    const patella = new THREE.Group();
    patella.name = `pedipalp_${side}_patella`;
    patella.position.set(sign * 0.36, 0.0, 0.22);
    patella.rotation.y = -sign * 0.85; // bent inward toward center
    patella.rotation.x = -0.15;
    femur.add(patella);
    joints[patella.name] = patella;

    const patellaMesh = createPedipalpPatellaMesh(sign, materials);
    patella.add(patellaMesh);

    // Chela (Hand / Pincer): Manus (Palm) + Fixed Finger
    const chelaManus = new THREE.Group();
    chelaManus.name = `chela_${side}_manus`;
    chelaManus.position.set(sign * 0.08, -0.01, 0.40);
    chelaManus.rotation.y = -sign * 0.25;
    chelaManus.rotation.z = -sign * 0.18;
    patella.add(chelaManus);
    joints[chelaManus.name] = chelaManus;

    // Manus & Fixed Finger Mesh
    const manusMesh = createChelaManusMesh(sign, materials);
    chelaManus.add(manusMesh);

    // Movable Finger (Articulated Dactyl / Claw)
    const movableFinger = new THREE.Group();
    movableFinger.name = `finger_${side}_movable`;
    // Pivot at inner base of manus
    movableFinger.position.set(-sign * 0.07, 0.02, 0.22);
    movableFinger.rotation.y = -sign * 0.20; // slightly open at rest
    chelaManus.add(movableFinger);
    joints[movableFinger.name] = movableFinger;

    const fingerMesh = createMovableFingerMesh(sign, materials);
    movableFinger.add(fingerMesh);
  });

  // ==========================================
  // 5. WALKING LEGS (4 Pairs: L1-L4 & R1-R4)
  // ==========================================
  const legConfigs = [
    // Leg 1: Front agile probe (shortest, angled forward)
    { id: 1, angleY: 0.45, zPos: 0.14, lFemur: 0.28, lTibia: 0.24, lTarsus: 0.22 },
    // Leg 2: Mid-front
    { id: 2, angleY: 0.15, zPos: 0.04, lFemur: 0.34, lTibia: 0.28, lTarsus: 0.25 },
    // Leg 3: Mid-rear
    { id: 3, angleY: -0.22, zPos: -0.06, lFemur: 0.40, lTibia: 0.32, lTarsus: 0.28 },
    // Leg 4: Rear drive leg (longest, angled rearward)
    { id: 4, angleY: -0.62, zPos: -0.16, lFemur: 0.46, lTibia: 0.36, lTarsus: 0.32 },
  ];

  ['L', 'R'].forEach((side) => {
    const isLeft = side === 'L';
    const sign = isLeft ? 1 : -1;

    legConfigs.forEach((cfg) => {
      const legName = `leg_${side}${cfg.id}`;

      // Leg Base / Coxa attached to ventrolateral prosoma
      const coxaGroup = new THREE.Group();
      coxaGroup.name = `${legName}_coxa`;
      coxaGroup.position.set(sign * 0.18, -0.05, cfg.zPos);
      prosoma.add(coxaGroup);
      joints[coxaGroup.name] = coxaGroup;

      const coxaMesh = createCoxaMesh(sign, materials);
      coxaGroup.add(coxaMesh);

      // Trochanter (azimuth swivel)
      const trochGroup = new THREE.Group();
      trochGroup.name = `${legName}_trochanter`;
      trochGroup.position.set(sign * 0.06, 0.0, 0.0);
      trochGroup.rotation.y = sign * cfg.angleY;
      coxaGroup.add(trochGroup);
      joints[trochGroup.name] = trochGroup;

      // Femur (Elevates upward and outward in sprawling arch)
      const femurGroup = new THREE.Group();
      femurGroup.name = `${legName}_femur`;
      femurGroup.position.set(sign * 0.04, 0.02, 0.0);
      femurGroup.rotation.z = -sign * 0.55; // Arch knee upward
      femurGroup.rotation.x = 0.05;
      trochGroup.add(femurGroup);
      joints[femurGroup.name] = femurGroup;

      const femurMesh = createLegSegmentMesh(cfg.lFemur, 0.032, 0.026, materials);
      femurMesh.position.set(sign * (cfg.lFemur * 0.5), 0, 0);
      femurGroup.add(femurMesh);

      // Patella / Tibia (Bends downward toward ground)
      const tibiaGroup = new THREE.Group();
      tibiaGroup.name = `${legName}_tibia`;
      tibiaGroup.position.set(sign * cfg.lFemur, 0.0, 0.0);
      tibiaGroup.rotation.z = sign * 1.05; // Bend down sharply
      tibiaGroup.rotation.y = -sign * 0.1;
      femurGroup.add(tibiaGroup);
      joints[tibiaGroup.name] = tibiaGroup;

      const tibiaMesh = createLegSegmentMesh(cfg.lTibia, 0.026, 0.020, materials);
      tibiaMesh.position.set(sign * (cfg.lTibia * 0.5), 0, 0);
      tibiaGroup.add(tibiaMesh);

      // Tarsus / Basitarsus + Claws (Contacts ground plane)
      const tarsusGroup = new THREE.Group();
      tarsusGroup.name = `${legName}_tarsus`;
      tarsusGroup.position.set(sign * cfg.lTibia, 0.0, 0.0);
      tarsusGroup.rotation.z = -sign * 0.40; // Flatten foot toward ground
      tibiaGroup.add(tarsusGroup);
      joints[tarsusGroup.name] = tarsusGroup;

      const tarsusMesh = createTarsusAndClawsMesh(sign, cfg.lTarsus, materials);
      tarsusGroup.add(tarsusMesh);
    });
  });

  return { root, model, joints, materials };
}

// =========================================================================
// GEOMETRY GENERATORS WITH HIGH BIOLOGICAL FIDELITY
// =========================================================================

/**
 * Creates the contoured Carapace (Prosoma) dorsal shield
 */
function createCarapaceGeometry() {
  const geom = new THREE.BufferGeometry();
  const rows = 18;
  const cols = 18;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const length = 0.50; // Z dimension
  const widthFront = 0.34;
  const widthBack = 0.52;
  const height = 0.16;

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const z = -0.25 + v * length; // -0.25 (back) to +0.25 (front)

    // Taper width from back to front
    const currentWidth = widthBack + (widthFront - widthBack) * v;

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const xNorm = (u - 0.5) * 2; // -1 to +1
      const x = (xNorm * currentWidth) * 0.5;

      // Parabolic dome height
      const domeFactor = Math.cos(xNorm * (Math.PI * 0.48));
      const longitudinalFactor = Math.sin(v * Math.PI * 0.85 + 0.15);
      let y = height * (domeFactor * 0.7 + longitudinalFactor * 0.3) * domeFactor;

      // Anterior median notch (clypeal emarginations at front center)
      if (v > 0.85 && Math.abs(xNorm) < 0.25) {
        const notchDepth = Math.cos((xNorm / 0.25) * Math.PI * 0.5);
        y -= notchDepth * 0.04 * (v - 0.85) / 0.15;
      }

      // Median groove depression running along centerline
      if (Math.abs(xNorm) < 0.12) {
        const groove = Math.cos((xNorm / 0.12) * Math.PI * 0.5);
        y -= groove * 0.008;
      }

      // Lateral carina ridge along edges
      if (Math.abs(xNorm) > 0.82 && Math.abs(xNorm) < 0.98) {
        y += 0.006;
      }

      // Granulation micro-relief
      const gran = (Math.sin(x * 60) * Math.cos(z * 60)) * 0.0025;
      y += gran;

      positions.push(x, Math.max(0, y), z);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = (r + 1) * (cols + 1) + c;
      const d = (r + 1) * (cols + 1) + (c + 1);
      const e = r * (cols + 1) + (c + 1);
      indices.push(a, b, d);
      indices.push(a, d, e);
    }
  }

  geom.setIndex(indices);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  return geom;
}

/**
 * Median Ocular Tubercle + 2 Median Ocelli
 */
function createMedianEyes(materials) {
  const group = new THREE.Group();
  group.name = 'median_eyes';

  // Raised rounded tubercle mound
  const tubercleGeo = new THREE.SphereGeometry(0.04, 16, 12);
  tubercleGeo.scale(1.2, 0.6, 1.5);
  const tubercleMesh = new THREE.Mesh(tubercleGeo, materials.chitin);
  tubercleMesh.position.set(0, 0.142, 0.06); // anterior 35%
  group.add(tubercleMesh);

  // Left & Right median eye lenses (glossy black ocelli)
  const eyeGeo = new THREE.SphereGeometry(0.015, 16, 16);
  eyeGeo.scale(1, 0.8, 1.3);

  const eyeL = new THREE.Mesh(eyeGeo, materials.eye);
  eyeL.position.set(0.024, 0.156, 0.065);
  group.add(eyeL);

  const eyeR = new THREE.Mesh(eyeGeo, materials.eye);
  eyeR.position.set(-0.024, 0.156, 0.065);
  group.add(eyeR);

  return group;
}

/**
 * 3 pairs of Lateral Ocelli (anterolateral corners)
 */
function createLateralEyes(materials) {
  const group = new THREE.Group();
  group.name = 'lateral_eyes';

  const lateralEyeGeo = new THREE.SphereGeometry(0.009, 12, 12);

  [-1, 1].forEach((sign) => {
    // 3 small eyes in a cluster on each shoulder
    for (let i = 0; i < 3; i++) {
      const eye = new THREE.Mesh(lateralEyeGeo, materials.eye);
      const zOffset = 0.18 - i * 0.016;
      const xOffset = sign * (0.135 - i * 0.008);
      const yOffset = 0.075 - i * 0.005;
      eye.position.set(xOffset, yOffset, zOffset);
      group.add(eye);
    }
  });

  return group;
}

/**
 * Chelicerae (anterior pincer mouthparts)
 */
function createChelicerae(materials) {
  const group = new THREE.Group();
  group.name = 'chelicerae';

  [-1, 1].forEach((sign) => {
    const chelGroup = new THREE.Group();
    chelGroup.position.set(sign * 0.04, 0.03, 0.23);

    // Basal segment
    const baseGeo = new THREE.BoxGeometry(0.035, 0.04, 0.07);
    const baseMesh = new THREE.Mesh(baseGeo, materials.chelicera);
    baseMesh.position.set(0, 0, 0);
    chelGroup.add(baseMesh);

    // Fixed tooth with serrations
    const toothGeo = new THREE.ConeGeometry(0.012, 0.05, 8);
    toothGeo.rotateX(Math.PI * 0.5);
    const toothMesh = new THREE.Mesh(toothGeo, materials.denticle);
    toothMesh.position.set(sign * 0.01, -0.01, 0.045);
    chelGroup.add(toothMesh);

    // Movable claw tooth
    const clawGeo = new THREE.ConeGeometry(0.010, 0.045, 8);
    clawGeo.rotateX(Math.PI * 0.45);
    clawGeo.rotateY(-sign * 0.3);
    const clawMesh = new THREE.Mesh(clawGeo, materials.denticle);
    clawMesh.position.set(-sign * 0.01, -0.015, 0.04);
    chelGroup.add(clawMesh);

    group.add(chelGroup);
  });

  return group;
}

/**
 * Ventral Sternum (pentagonal/triangular sternal plate)
 */
function createSternum(materials) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.08);
  shape.lineTo(0.06, 0.04);
  shape.lineTo(0.04, -0.08);
  shape.lineTo(-0.04, -0.08);
  shape.lineTo(-0.06, 0.04);
  shape.closePath();

  const extrudeSettings = { depth: 0.015, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.005, bevelThickness: 0.005 };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.rotateX(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.name = 'sternum';
  mesh.position.set(0, -0.05, 0.02);
  return mesh;
}

/**
 * Ventral Pectines (Comb-like sensory appendages with teeth)
 */
function createPectines(materials) {
  const group = new THREE.Group();
  group.name = 'pectines';

  [-1, 1].forEach((sign) => {
    const pectine = new THREE.Group();
    pectine.position.set(sign * 0.08, -0.07, 0.0);
    pectine.rotation.z = sign * 0.35; // Inverted V angle
    pectine.rotation.y = sign * 0.2;

    // Rachis (Shaft of comb)
    const shaftGeo = new THREE.CylinderGeometry(0.008, 0.006, 0.16, 8);
    shaftGeo.rotateZ(Math.PI * 0.5);
    const shaftMesh = new THREE.Mesh(shaftGeo, materials.chitin);
    pectine.add(shaftMesh);

    // Comb teeth (pectinal teeth: 18-24 individual teeth)
    const numTeeth = 18;
    const toothGeo = new THREE.BoxGeometry(0.005, 0.035, 0.006);
    for (let i = 0; i < numTeeth; i++) {
      const tooth = new THREE.Mesh(toothGeo, materials.pectine);
      const tX = -0.07 + (i / numTeeth) * 0.14;
      tooth.position.set(tX, -0.02, 0);
      tooth.rotation.x = 0.2;
      pectine.add(tooth);
    }

    group.add(pectine);
  });

  return group;
}

/**
 * Creates a sculptured Tergite plate for Mesosoma
 */
function createTergiteMesh(width, height, length, segIndex, materials) {
  const geom = new THREE.BufferGeometry();
  const rows = 10;
  const cols = 16;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const z = -length * 0.5 + v * length;

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const xNorm = (u - 0.5) * 2; // -1 to +1
      const x = (xNorm * width) * 0.5;

      // Convex transverse arch
      const arch = Math.cos(xNorm * Math.PI * 0.46);
      let y = height * arch;

      // Median carina ridge running axially
      if (Math.abs(xNorm) < 0.15) {
        y += (1 - Math.abs(xNorm) / 0.15) * 0.015;
      }

      // Posterior overlapping flange (shingling over the next tergite)
      if (v < 0.25) {
        y += 0.012 * (1 - v / 0.25);
      }

      // Lateral pleural margin curve downward
      if (Math.abs(xNorm) > 0.85) {
        y -= 0.025 * ((Math.abs(xNorm) - 0.85) / 0.15);
      }

      // Surface tubercles/granulation
      y += (Math.sin(x * 50) * Math.cos(z * 50)) * 0.0018;

      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = (r + 1) * (cols + 1) + c;
      const d = (r + 1) * (cols + 1) + (c + 1);
      const e = r * (cols + 1) + (c + 1);
      indices.push(a, b, d);
      indices.push(a, d, e);
    }
  }

  geom.setIndex(indices);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, materials.chitin);
  mesh.name = `tergite_${segIndex}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Creates Ventral Sternite with Book Lung Spiracles
 */
function createSterniteMesh(width, height, length, materials) {
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.48, -length * 0.45);
  shape.lineTo(width * 0.48, -length * 0.45);
  shape.lineTo(width * 0.44, length * 0.45);
  shape.lineTo(-width * 0.44, length * 0.45);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.004, bevelThickness: 0.004 });
  geo.rotateX(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.position.set(0, -height * 0.65, 0);
  group.add(mesh);

  // Book lung spiracles (paired oblique slits)
  const slitGeo = new THREE.BoxGeometry(0.04, 0.005, 0.008);
  const slitMat = materials.eye; // dark slit interior

  [-1, 1].forEach((sign) => {
    const slit = new THREE.Mesh(slitGeo, slitMat);
    slit.position.set(sign * width * 0.32, -height * 0.66, 0);
    slit.rotation.y = sign * 0.3; // oblique angle
    group.add(slit);
  });

  return group;
}

/**
 * Creates an articulated Metasoma (Tail) Segment with 8 Keels & Granulations
 */
function createMetasomaSegmentMesh(radius, length, segNum, materials) {
  const group = new THREE.Group();
  group.name = `metasoma_segment_${segNum}_mesh`;

  // Segment Body (Cylindrical body ring with longitudinal facets)
  const bodyGeo = new THREE.CylinderGeometry(radius * 0.94, radius, length, 16, 8, true);
  bodyGeo.rotateX(Math.PI * 0.5);
  const bodyMesh = new THREE.Mesh(bodyGeo, materials.chitin);
  bodyMesh.position.set(0, 0, length * 0.5);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // 8 Longitudinal Keels (Carinae) with granulated beads
  // Carinae pairs: Dorsolateral (2), Lateral (2), Ventrolateral (2), Ventral Submedian (2)
  const keelAngles = [
    Math.PI * 0.25, Math.PI * 0.75,     // Dorsolateral
    0, Math.PI,                          // Lateral
    -Math.PI * 0.25, -Math.PI * 0.75,   // Ventrolateral
    -Math.PI * 0.42, -Math.PI * 0.58    // Ventral submedian
  ];

  const keelGeom = new THREE.CylinderGeometry(0.008, 0.008, length * 0.96, 6);
  keelGeom.rotateX(Math.PI * 0.5);

  keelAngles.forEach((ang, idx) => {
    const keelMesh = new THREE.Mesh(keelGeom, materials.chitin);
    const kx = Math.cos(ang) * (radius * 0.98);
    const ky = Math.sin(ang) * (radius * 0.98);
    keelMesh.position.set(kx, ky, length * 0.5);

    // Segment 5 has heavy serrated denticles on the ventral keels
    if (segNum === 5 && ky < 0) {
      keelMesh.scale.set(1.5, 1.5, 1.0);
    }

    group.add(keelMesh);
  });

  // End Caps / Intersegmental Joint Rings
  const ringGeo = new THREE.TorusGeometry(radius * 0.92, 0.012, 8, 16);
  const ringMesh = new THREE.Mesh(ringGeo, materials.membrane);
  ringMesh.position.set(0, 0, length);
  group.add(ringMesh);

  return group;
}

/**
 * Creates the Telson (Bulbous Venom Vesicle + Curved Aculeus Stinger Barb)
 */
function createTelsonMesh(materials) {
  const group = new THREE.Group();
  group.name = 'telson_anatomy';

  // 1. Vesicle Ampulla (Pear-shaped bulb containing venom glands)
  // Constructed via LatheGeometry with biological cross-section
  const points = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 to 1
    const z = t * 0.22;  // length of vesicle
    // Pear profile: narrow at base, bulbous at 60%, tapering to sting base
    let r = Math.sin(t * Math.PI) * 0.095;
    if (t > 0.5) {
      r *= (1 + (t - 0.5) * 0.4); // fuller toward the distal end
    }
    points.push(new THREE.Vector2(Math.max(0.005, r), z));
  }
  const vesicleGeo = new THREE.LatheGeometry(points, 24);
  vesicleGeo.rotateX(-Math.PI * 0.5); // orient along Z axis
  vesicleGeo.scale(1.15, 0.85, 1.0); // slight lateral compression (wider than tall)
  const vesicleMesh = new THREE.Mesh(vesicleGeo, materials.telson);
  vesicleMesh.castShadow = true;
  vesicleMesh.receiveShadow = true;
  group.add(vesicleMesh);

  // Dorsal groove impression
  const grooveGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8);
  grooveGeo.rotateX(Math.PI * 0.5);
  const grooveMesh = new THREE.Mesh(grooveGeo, materials.chitin);
  grooveMesh.position.set(0, 0.07, 0.11);
  group.add(grooveMesh);

  // Subaculear Tubercle / Tooth (small bump under stinger base)
  const subaculearGeo = new THREE.ConeGeometry(0.014, 0.025, 8);
  subaculearGeo.rotateX(Math.PI * 0.3);
  const subaculearMesh = new THREE.Mesh(subaculearGeo, materials.denticle);
  subaculearMesh.position.set(0, -0.065, 0.20);
  group.add(subaculearMesh);

  // 2. Aculeus (Curved hypodermic stinger needle)
  // Modeled with a smooth 3D curved tube / sweep
  const curvePoints = [];
  const numCurvePts = 20;
  for (let i = 0; i <= numCurvePts; i++) {
    const t = i / numCurvePts;
    const ang = t * Math.PI * 0.65; // ~117 degree arc
    const radiusArc = 0.15;
    // Sweeps forward and curves sharply downward
    const cz = 0.22 + Math.sin(ang) * radiusArc;
    const cy = -0.02 - (1 - Math.cos(ang)) * radiusArc * 1.3;
    curvePoints.push(new THREE.Vector3(0, cy, cz));
  }
  const aculeusCurve = new THREE.CatmullRomCurve3(curvePoints);

  // Custom tapered tube geometry for the stinger needle
  const aculeusGeo = createTaperedTubeGeometry(aculeusCurve, 32, 0.028, 0.003, 12);
  const aculeusMesh = new THREE.Mesh(aculeusGeo, materials.aculeus);
  aculeusMesh.castShadow = true;
  group.add(aculeusMesh);

  // Hardened Black Stinger Tip (Apex needle point)
  const tipPoint = curvePoints[curvePoints.length - 1];
  const tipGeo = new THREE.ConeGeometry(0.004, 0.02, 10);
  tipGeo.rotateX(-Math.PI * 0.65);
  const tipMesh = new THREE.Mesh(tipGeo, materials.eye); // pitch black hardened tip
  tipMesh.position.copy(tipPoint);
  group.add(tipMesh);

  return group;
}

/**
 * Creates a Tapered Tube along a 3D curve (thick base -> ultra-sharp needle point)
 */
function createTaperedTubeGeometry(curve, segments, baseRadius, tipRadius, radialSegments) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const frames = curve.computeFrenetFrames(segments, false);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const radius = baseRadius * (1 - t * 0.92) + tipRadius;
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const angle = v * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const vx = normal.x * cos + binormal.x * sin;
      const vy = normal.y * cos + binormal.y * sin;
      const vz = normal.z * cos + binormal.z * sin;

      positions.push(
        point.x + vx * radius,
        point.y + vy * radius,
        point.z + vz * radius
      );
      normals.push(vx, vy, vz);
      uvs.push(t, v);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      const d = (i + 1) * (radialSegments + 1) + (j + 1);
      const c = i * (radialSegments + 1) + (j + 1);
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  geom.setIndex(indices);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Pedipalp Trochanter
 */
function createTrochanterMesh(materials) {
  const geo = new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12);
  geo.rotateZ(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Pedipalp Femur (Humerus) - Prismatic keeled segment
 */
function createPedipalpFemurMesh(sign, materials) {
  const group = new THREE.Group();

  // Prismatic body
  const length = 0.40;
  const geo = new THREE.CylinderGeometry(0.048, 0.055, length, 7);
  geo.rotateZ(sign * Math.PI * 0.45);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.position.set(sign * (length * 0.45), 0, length * 0.25);
  mesh.castShadow = true;
  group.add(mesh);

  // Longitudinal carinae ridges with granules
  for (let i = 0; i < 3; i++) {
    const kGeo = new THREE.CylinderGeometry(0.008, 0.008, length * 0.95, 6);
    kGeo.rotateZ(sign * Math.PI * 0.45);
    const kMesh = new THREE.Mesh(kGeo, materials.chitin);
    const ang = i * 2.0;
    kMesh.position.set(
      sign * (length * 0.45) + Math.cos(ang) * 0.05,
      Math.sin(ang) * 0.05,
      length * 0.25
    );
    group.add(kMesh);
  }

  return group;
}

/**
 * Pedipalp Patella (Brachium / Elbow)
 */
function createPedipalpPatellaMesh(sign, materials) {
  const group = new THREE.Group();
  const length = 0.38;

  const geo = new THREE.CylinderGeometry(0.058, 0.062, length, 10);
  geo.rotateX(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.position.set(0, 0, length * 0.45);
  mesh.castShadow = true;
  group.add(mesh);

  return group;
}

/**
 * Massive Chela Manus (Palm) + Fixed Finger with Denticles
 * Emperor Scorpion's famous massive raptorial pincers
 */
function createChelaManusMesh(sign, materials) {
  const group = new THREE.Group();
  group.name = `chela_manus_${sign > 0 ? 'L' : 'R'}`;

  // 1. Manus (Swollen, bulbous, heavily granulate palm)
  // High-poly sculpted palm
  const palmGeo = new THREE.SphereGeometry(0.18, 20, 16);
  palmGeo.scale(1.2, 0.9, 1.6); // bulbous elongated egg
  // Add surface granulations
  const pos = palmGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Distinct dorsal keel ridge
    if (y > 0.08 && Math.abs(x) < 0.08) {
      pos.setY(i, y + 0.025);
    }
    // High-density granular pustules
    const gran = (Math.sin(x * 45) * Math.cos(y * 45) * Math.sin(z * 45)) * 0.007;
    pos.setXYZ(i, x + gran * 0.5, y + gran, z + gran * 0.5);
  }
  palmGeo.computeVertexNormals();

  const palmMesh = new THREE.Mesh(palmGeo, materials.chela);
  palmMesh.castShadow = true;
  palmMesh.receiveShadow = true;
  group.add(palmMesh);

  // 2. Fixed Finger (Tibia extension curving forward & inward)
  const curvePts = [];
  const numPts = 16;
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts;
    const ang = t * Math.PI * 0.35; // gentle inward curve
    const cz = 0.22 + t * 0.32;
    const cx = sign * (0.05 + Math.sin(ang) * 0.08);
    const cy = 0.02 - t * 0.04;
    curvePts.push(new THREE.Vector3(cx, cy, cz));
  }
  const fingerCurve = new THREE.CatmullRomCurve3(curvePts);
  const fingerGeo = createTaperedTubeGeometry(fingerCurve, 24, 0.038, 0.006, 10);
  const fingerMesh = new THREE.Mesh(fingerGeo, materials.chela);
  fingerMesh.castShadow = true;
  group.add(fingerMesh);

  // Hooked terminal tooth
  const apex = curvePts[curvePts.length - 1];
  const apexGeo = new THREE.ConeGeometry(0.008, 0.035, 8);
  apexGeo.rotateX(Math.PI * 0.45);
  apexGeo.rotateZ(-sign * 0.4);
  const apexMesh = new THREE.Mesh(apexGeo, materials.denticle);
  apexMesh.position.copy(apex);
  group.add(apexMesh);

  // Denticle cutting row along the inner edge of fixed finger
  for (let i = 2; i < numPts - 1; i++) {
    const pt = curvePts[i];
    const toothGeo = new THREE.ConeGeometry(0.006, 0.015, 6);
    toothGeo.rotateX(Math.PI * 0.5);
    toothGeo.rotateZ(sign * 0.6);
    const toothMesh = new THREE.Mesh(toothGeo, materials.denticle);
    toothMesh.position.set(pt.x - sign * 0.012, pt.y, pt.z);
    group.add(toothMesh);
  }

  return group;
}

/**
 * Movable Finger (Articulated Dactyl / Claw with Denticle Teeth)
 */
function createMovableFingerMesh(sign, materials) {
  const group = new THREE.Group();

  const curvePts = [];
  const numPts = 16;
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts;
    const ang = t * Math.PI * 0.40;
    const cz = t * 0.30;
    const cx = -sign * (0.01 + Math.sin(ang) * 0.09);
    const cy = 0.0 - t * 0.03;
    curvePts.push(new THREE.Vector3(cx, cy, cz));
  }
  const fingerCurve = new THREE.CatmullRomCurve3(curvePts);
  const fingerGeo = createTaperedTubeGeometry(fingerCurve, 24, 0.035, 0.005, 10);
  const fingerMesh = new THREE.Mesh(fingerGeo, materials.chela);
  fingerMesh.castShadow = true;
  group.add(fingerMesh);

  // Hooked apex claw
  const apex = curvePts[curvePts.length - 1];
  const apexGeo = new THREE.ConeGeometry(0.007, 0.032, 8);
  apexGeo.rotateX(Math.PI * 0.45);
  apexGeo.rotateZ(sign * 0.4);
  const apexMesh = new THREE.Mesh(apexGeo, materials.denticle);
  apexMesh.position.copy(apex);
  group.add(apexMesh);

  // Denticle cutting row along inner margin of movable finger
  for (let i = 2; i < numPts - 1; i++) {
    const pt = curvePts[i];
    const toothGeo = new THREE.ConeGeometry(0.006, 0.014, 6);
    toothGeo.rotateX(Math.PI * 0.5);
    toothGeo.rotateZ(-sign * 0.6);
    const toothMesh = new THREE.Mesh(toothGeo, materials.denticle);
    toothMesh.position.set(pt.x + sign * 0.010, pt.y, pt.z);
    group.add(toothMesh);
  }

  return group;
}

/**
 * Walking Leg Coxa
 */
function createCoxaMesh(sign, materials) {
  const geo = new THREE.CylinderGeometry(0.032, 0.040, 0.08, 8);
  geo.rotateZ(sign * Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Standard Walking Leg Segment (Femur / Tibia)
 */
function createLegSegmentMesh(length, radStart, radEnd, materials) {
  const geo = new THREE.CylinderGeometry(radEnd, radStart, length, 10);
  geo.rotateZ(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Terminal Tarsus / Basitarsus + Paired Claws (Ungues)
 */
function createTarsusAndClawsMesh(sign, length, materials) {
  const group = new THREE.Group();

  // Tarsus strut
  const geo = new THREE.CylinderGeometry(0.012, 0.020, length, 8);
  geo.rotateZ(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, materials.chitin);
  mesh.position.set(sign * (length * 0.5), 0, 0);
  mesh.castShadow = true;
  group.add(mesh);

  // Paired curved dactylar claws (ungues) at foot tip
  [-0.012, 0.012].forEach((offsetZ) => {
    const clawGeo = new THREE.ConeGeometry(0.006, 0.03, 8);
    clawGeo.rotateX(Math.PI * 0.7);
    clawGeo.rotateZ(-sign * 0.3);
    const clawMesh = new THREE.Mesh(clawGeo, materials.claw);
    clawMesh.position.set(sign * length, -0.012, offsetZ);
    group.add(clawMesh);
  });

  return group;
}
