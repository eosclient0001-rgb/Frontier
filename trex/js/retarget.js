/**
 * retarget.js — named, transform-only osteological rig interface.
 *
 * The viewer uses procedural animation on joints, not on meshes.  This module
 * gives every named bone a stable joint id and keeps a replacement-mesh slot
 * on that joint.  The current fossil proxy can therefore be replaced by a
 * GLTF/OBJ bone set without changing Animator or the gait code.
 *
 * Naming is intentionally boring and predictable:
 *   vertebra.cervical.01 ... vertebra.caudal.47
 *   rib.dorsal.05.L / chevron.caudal.05
 *   limb.fore.humerus.R / limb.hind.metatarsal.III.L
 *   skull.maxilla.L / skull.mandible.R
 *
 * A joint's local transform is the rest transform used by the animation rig.
 * Replacement meshes are expected to be authored in that joint's local frame;
 * attachBoneMesh() also accepts an explicit local offset for imported assets.
 */

import { Object3D } from 'three';

const pad = (n) => String(n).padStart(2, '0');

/** The complete proxy-independent bone name list. */
export function canonicalBoneNames() {
  const out = [];
  const add = (name) => out.push(name);
  const sides = (prefix) => { add(`${prefix}.L`); add(`${prefix}.R`); };

  // Axial centra.  S1 is the anterior sacral and Ca1 is the first caudal.
  for (let i = 1; i <= 10; i++) add(`vertebra.cervical.${pad(i)}`);
  for (let i = 1; i <= 13; i++) add(`vertebra.dorsal.${pad(i)}`);
  for (let i = 1; i <= 5; i++) add(`vertebra.sacral.${pad(i)}`);
  for (let i = 1; i <= 47; i++) add(`vertebra.caudal.${pad(i)}`);

  // Axial accessory bones.  The specimen has paired cervical/dorsal ribs,
  // paired gastralia and chevrons under the proximal-to-middle caudals.
  for (let i = 3; i <= 10; i++) sides(`rib.cervical.${pad(i)}`);
  for (let i = 1; i <= 13; i++) sides(`rib.dorsal.${pad(i)}`);
  for (let i = 1; i <= 5; i++) sides(`rib.sacral.${pad(i)}`);
  for (let i = 1; i <= 19; i++) sides(`gastralium.${pad(i)}`);
  for (let i = 2; i <= 37; i++) add(`chevron.caudal.${pad(i)}`);
  add('sacrum.supraneural');

  // Pelvic and pectoral girdles.
  sides('pelvis.ilium'); sides('pelvis.pubis'); sides('pelvis.pubicBoot'); sides('pelvis.ischium');
  sides('pectoral.scapula'); sides('pectoral.coracoid'); sides('pectoral.acromion'); sides('pectoral.glenoid');
  add('pectoral.furcula'); add('pectoral.sternum');

  // Skull elements.  Teeth are registered separately as replaceable display
  // slots even though they are dentine, not osteological bones.
  add('skull.cranium'); sides('skull.premaxilla'); sides('skull.maxilla'); sides('skull.nasal');
  sides('skull.lacrimal'); sides('skull.jugal'); sides('skull.postorbital'); sides('skull.squamosal');
  sides('skull.quadrate'); sides('skull.pterygoid'); sides('skull.palatine'); add('skull.vomer');
  sides('skull.mandible'); add('skull.teeth.upper'); add('skull.teeth.lower');

  // Forelimbs: three metacarpals are retained because a replacement set may
  // include the splint-like MC III even when the proxy only suggests it.
  for (const side of ['L', 'R']) {
    add(`limb.fore.scapula.${side}`); // aliases to pectoral joints are useful to importers
    for (const b of ['humerus', 'ulna', 'radius', 'carpal.1', 'carpal.2', 'carpal.3', 'metacarpal.I', 'metacarpal.II', 'metacarpal.III']) add(`limb.fore.${b}.${side}`);
    for (const digit of ['I', 'II', 'III']) {
      add(`limb.fore.digit.${digit}.root.${side}`);
      const n = digit === 'I' ? 2 : digit === 'II' ? 3 : 1;
      for (let p = 1; p <= n; p++) add(`limb.fore.digit.${digit}.phalanx.${p}.${side}`);
      add(`limb.fore.digit.${digit}.ungual.${side}`);
    }
  }

  // Hindlimbs and the complete pedal formula.  Digit IV is kept at five
  // phalanges to match the proxy's articulated hand/foot representation.
  for (const side of ['L', 'R']) {
    for (const b of ['femur', 'tibia', 'fibula', 'astragalus', 'calcaneum', 'metatarsal.II', 'metatarsal.III', 'metatarsal.IV', 'metatarsal.V']) add(`limb.hind.${b}.${side}`);
    add(`limb.hind.hallux.${side}`);
    for (const digit of ['II', 'III', 'IV']) {
      add(`limb.hind.digit.${digit}.root.${side}`);
      const n = digit === 'II' ? 3 : digit === 'III' ? 4 : 5;
      for (let p = 1; p <= n; p++) add(`limb.hind.digit.${digit}.phalanx.${p}.${side}`);
      add(`limb.hind.digit.${digit}.ungual.${side}`);
    }
  }
  return out;
}

const CANONICAL = canonicalBoneNames();

function recordRest(joint) {
  joint.userData.restPosition = joint.position.clone();
  joint.userData.restQuaternion = joint.quaternion.clone();
  joint.userData.restScale = joint.scale.clone();
  joint.userData.retargetJoint = true;
}

function makeJoint(parent, name, position = null, quaternion = null) {
  const j = new Object3D();
  j.name = `joint:${name}`;
  j.userData.boneName = name;
  if (position) j.position.copy(position);
  if (quaternion) j.quaternion.copy(quaternion);
  recordRest(j);
  parent.add(j);
  return j;
}

function findNamed(skel, names) {
  for (const name of names) {
    if (!name) continue;
    const direct = skel.rig.getObjectByName(name);
    if (direct) return direct;
    let found = null;
    skel.rig.traverse((o) => { if (!found && o.name === name) found = o; });
    if (found) return found;
  }
  return null;
}

function axial(skel, series, index) {
  const old = series === 'cervical' ? `C${index}` : series === 'dorsal' ? `D${index}` : series === 'sacral' ? `S${index}` : `Ca${index}`;
  return findNamed(skel, [old]);
}

function nearestParent(skel, name) {
  if (name.startsWith('vertebra.cervical.')) return axial(skel, 'cervical', +name.slice(-2));
  if (name.startsWith('vertebra.dorsal.')) return axial(skel, 'dorsal', +name.slice(-2));
  if (name.startsWith('vertebra.sacral.')) return skel.pelvis;
  if (name.startsWith('vertebra.caudal.')) return axial(skel, 'caudal', +name.slice(-2));
  if (name.startsWith('rib.cervical.')) return axial(skel, 'cervical', +name.slice(13, 15));
  if (name.startsWith('rib.dorsal.')) return axial(skel, 'dorsal', +name.slice(11, 13));
  if (name.startsWith('rib.sacral.')) return axial(skel, 'sacral', +name.slice(11, 13)) || skel.pelvis;
  if (name.startsWith('gastralium.')) {
    const d8 = axial(skel, 'dorsal', 8);
    return d8 || skel.pelvis;
  }
  if (name.startsWith('chevron.caudal.')) return axial(skel, 'caudal', +name.slice(-2));
  if (name === 'sacrum.supraneural' || name.startsWith('pelvis.')) return skel.pelvis;
  if (name.startsWith('pectoral.')) return axial(skel, 'dorsal', 2) || skel.pelvis;
  if (name.startsWith('skull.')) return name.includes('mandible') || name.includes('teeth.lower') ? skel.jaw : skel.head;
  if (name.startsWith('limb.fore.')) {
    const side = name.endsWith('.L') ? 'L' : 'R';
    const arm = skel.arms?.[side];
    if (!arm) return skel.pelvis;
    if (name.includes('humerus')) return arm.shoulder;
    if (name.includes('ulna') || name.includes('radius')) return arm.elbow || arm.shoulder;
    if (name.includes('carpal') || name.includes('metacarpal') || name.includes('digit')) return arm.wrist || arm.elbow || arm.shoulder;
    return arm.shoulder;
  }
  if (name.startsWith('limb.hind.')) {
    const side = name.endsWith('.L') ? 'L' : 'R';
    const leg = skel.legs?.[side];
    if (!leg) return skel.rig;
    if (name.includes('femur')) return leg.femur;
    if (name.includes('tibia') || name.includes('fibula') || name.includes('astragalus') || name.includes('calcaneum')) return leg.tibia;
    if (name.includes('metatarsal') || name.includes('hallux')) return leg.meta;
    if (name.includes('digit')) return leg.foot;
    return leg.group;
  }
  return skel.rig;
}

function existingFor(skel, name) {
  // The visible pedal chains already have animated phalanx joints. Reuse
  // those transforms so a replacement toe follows the exact same IK curl;
  // the canonical ungual gets a child slot when the proxy's final joint
  // already contains its claw mesh.
  const pedal = name.match(/^limb\.hind\.digit\.([IV]+)\.(root|phalanx)(?:\.(\d+))?\.(L|R)$/);
  if (pedal) {
    const [, digit, kind, number, side] = pedal;
    const leg = skel.legs?.[side];
    const chain = leg?.digits?.[digit];
    if (chain) {
      if (kind === 'root') return chain.root;
      const index = +number - 1;
      if (chain.joints[index]) return chain.joints[index];
    }
  }
  // Meshes are display proxies, not joints. Reuse the animated transform
  // above them so an imported replacement never inherits a mesh's geometry
  // offset or gets treated as an animator target.
  if (name.startsWith('rib.dorsal.')) {
    const index = +name.slice(11, 13);
    const side = name.endsWith('.L') ? 'L' : 'R';
    return findNamed(skel, [`Rib D${index} ${side}`]);
  }
  if (name.startsWith('gastralium.')) {
    const index = +name.slice(11, 13);
    const side = name.endsWith('.L') ? 'L' : 'R';
    return findNamed(skel, [`Gastralium ${index} ${side}`]);
  }
  if (name.startsWith('chevron.caudal.')) return findNamed(skel, [`Chevron ${+name.slice(-2)}`]);
  if (name === 'skull.cranium') return skel.head;
  if (name === 'skull.teeth.upper') return findNamed(skel, ['teeth']) || skel.head;
  if (name === 'skull.teeth.lower') return skel.jaw;
  if (name === 'skull.mandible.L' || name === 'skull.mandible.R') return null;
  const aliases = {
    'skull.cranium': ['craniumBones', 'skullBones'],
    'skull.teeth.upper': ['teeth', 'teethUpper'],
    'skull.teeth.lower': ['teethLower'],
  };
  const a = aliases[name] || [];
  const found = findNamed(skel, a);
  if (found) return found;
  if (name.startsWith('vertebra.')) return axial(skel, name.split('.')[1], +name.slice(-2));
  if (name === 'skull.mandible.L' || name === 'skull.mandible.R') return skel.jaw;
  if (name === 'limb.fore.humerus.L' || name === 'limb.fore.humerus.R') return skel.arms?.[name.endsWith('.L') ? 'L' : 'R']?.shoulder;
  if (name === 'limb.hind.femur.L' || name === 'limb.hind.femur.R') return skel.legs?.[name.endsWith('.L') ? 'L' : 'R']?.femur;
  if (name === 'limb.hind.tibia.L' || name === 'limb.hind.tibia.R') return skel.legs?.[name.endsWith('.L') ? 'L' : 'R']?.tibia;
  if (name === 'limb.hind.metatarsal.III.L' || name === 'limb.hind.metatarsal.III.R') return skel.legs?.[name.endsWith('.L') ? 'L' : 'R']?.meta;
  return null;
}

function localSlot(joint) {
  if (!joint.userData.replacementSlot) {
    joint.userData.replacementSlot = {
      joint,
      proxy: null,
      replacement: null,
      restPosition: joint.position.clone(),
      restQuaternion: joint.quaternion.clone(),
      restScale: joint.scale.clone(),
    };
  }
  return joint.userData.replacementSlot;
}

function chainParent(name, map) {
  const m = name.match(/^(limb\.(fore|hind)\.digit\.([IV]+)\.(root|phalanx|ungual)(?:\.(\d+))?\.(L|R))$/);
  if (!m) return null;
  const [, , limb, digit, kind, number, side] = m;
  const base = `limb.${limb}.digit.${digit}`;
  if (kind === 'root') return null;
  if (kind === 'phalanx' && number === '1') return map.get(`${base}.root.${side}`) || null;
  if (kind === 'phalanx') return map.get(`${base}.phalanx.${+number - 1}.${side}`) || null;
  // The canonical list puts all phalanges before the ungual. Find the final
  // one so a replacement claw inherits the last phalanx's transform.
  for (let p = 8; p >= 1; p--) {
    const parent = map.get(`${base}.phalanx.${p}.${side}`);
    if (parent) return parent;
  }
  return null;
}

/**
 * Install the retarget map on a completed visual skeleton. Existing named
 * joints are reused; missing anatomical elements get a real Object3D joint
 * in the correct animated parent chain. No animator code needs to know which
 * ones are currently proxy-only.
 */
export function installRetargetRig(skel) {
  const map = new Map();
  const aliases = new Map();

  for (const name of CANONICAL) {
    const old = existingFor(skel, name);
    let joint = old;
    let source = 'proxy-slot';
    if (joint) {
      // Never rename a visual object used by existing code. The stable id is
      // stored separately and replacement meshes attach to this object.
      joint.userData.boneName = name;
      joint.userData.retargetJoint = true;
      recordRest(joint);
      source = 'proxy';
    } else {
      const chain = chainParent(name, map);
      const parent = chain || nearestParent(skel, name) || skel.rig;
      joint = makeJoint(parent, name);
    }
    joint.userData.boneName = name;
    joint.userData.retargetSource = source;
    localSlot(joint);
    map.set(name, joint);
  }

  // Friendly aliases for code/importers that use the visible proxy names.
  for (const [alias, name] of [
    ['jaw', 'skull.mandible.L'], ['mandible', 'skull.mandible.L'], ['head', 'skull.cranium'],
    ['pelvis', 'pelvis.ilium.L'], ['arm.L', 'limb.fore.humerus.L'], ['arm.R', 'limb.fore.humerus.R'],
  ]) aliases.set(alias, map.get(name));

  const get = (name) => map.get(name) || aliases.get(name) || null;
  const attach = (name, object, options = {}) => {
    const joint = get(name);
    if (!joint) throw new Error(`Unknown retarget joint: ${name}`);
    const slot = localSlot(joint);
    if (slot.replacement) {
      joint.remove(slot.replacement);
      slot.replacement = null;
    }
    if (options.hideProxy !== false && slot.proxy) slot.proxy.visible = false;
    if (options.position) object.position.fromArray(options.position);
    else object.position.set(0, 0, 0);
    if (options.quaternion) object.quaternion.fromArray(options.quaternion);
    else if (!options.keepRotation) object.quaternion.identity();
    if (options.scale) object.scale.fromArray(options.scale);
    object.userData.retargetMesh = true;
    object.userData.boneName = name;
    joint.add(object);
    slot.replacement = object;
    return object;
  };
  const clear = (name) => {
    const joint = get(name); if (!joint) return false;
    const slot = localSlot(joint);
    if (slot.replacement) joint.remove(slot.replacement);
    slot.replacement = null;
    if (slot.proxy) slot.proxy.visible = true;
    return true;
  };
  const reset = () => {
    for (const [name] of map) clear(name);
    return map.size;
  };

  // Populate proxy slots without hiding anything. A composite visual mesh is
  // intentionally left visible until an importer supplies a replacement.
  const meshesByName = (names) => {
    let hit = null;
    skel.rig.traverse((o) => { if (!hit && o.isMesh && names.includes(o.name)) hit = o; });
    return hit;
  };
  const proxyAliases = {
    'skull.cranium': ['craniumBones'], 'skull.teeth.upper': ['teeth'], 'skull.teeth.lower': ['teethLower'],
    'skull.mandible.L': ['mandibleBones'], 'skull.mandible.R': ['mandibleBones'],
    'pelvis.ilium.L': ['Ilium'], 'pelvis.ilium.R': ['Ilium'],
    'pelvis.pubis.L': ['Pubis'], 'pelvis.pubis.R': ['Pubis'],
    'pelvis.ischium.L': ['Ischium'], 'pelvis.ischium.R': ['Ischium'],
    'pectoral.scapula.L': ['Pectoral girdle'], 'pectoral.scapula.R': ['Pectoral girdle'],
  };
  skel.rig.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.userData.boneName;
    if (name && map.has(name)) localSlot(map.get(name)).proxy = o;
  });
  for (const [name, aliasesForName] of Object.entries(proxyAliases)) {
    const joint = map.get(name);
    if (joint && !localSlot(joint).proxy) localSlot(joint).proxy = meshesByName(aliasesForName);
  }
  for (const [name, joint] of map) {
    if (localSlot(joint).proxy) continue;
    const direct = joint.children.find((child) => child.isMesh && !child.userData.retargetMesh);
    if (direct) localSlot(joint).proxy = direct;
  }

  skel.joints = [...map.values()];
  skel.jointMap = Object.fromEntries(map);
  skel.boneNames = [...CANONICAL];
  skel.getJoint = get;
  skel.getBone = get;
  skel.attachBoneMesh = attach;
  skel.replaceBone = attach;
  skel.clearBoneMesh = clear;
  skel.resetBoneMeshes = reset;
  skel.retarget = {
    names: CANONICAL,
    map,
    get,
    attach,
    replace: attach,
    clear,
    reset,
    /** Validate an importer before loading any meshes. */
    validate: (names) => {
      const incoming = names instanceof Map ? [...names.keys()] : names;
      return incoming.filter((n) => !map.has(n));
    },
  };
  return skel.retarget;
}

export { CANONICAL as RETARGET_BONE_NAMES };
