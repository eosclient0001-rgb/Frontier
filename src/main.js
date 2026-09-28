import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScorpionModel } from './model/scorpionBuilder.js';
import { createScorpionAnimations } from './model/scorpionAnimations.js';

// =========================================================================
// 1. SCENE SETUP & RENDERER INITIALIZATION
// =========================================================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080a0c);
scene.fog = new THREE.FogExp2(0x080a0c, 0.22);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(1.4, 0.9, 1.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0.22, 0.1);
controls.maxPolarAngle = Math.PI * 0.495; // Don't go below ground
controls.minDistance = 0.3;
controls.maxDistance = 5.0;

// =========================================================================
// 2. LIGHTING RIG & ENVIRONMENT
// =========================================================================
const ambientLight = new THREE.AmbientLight(0x222830, 0.8);
scene.add(ambientLight);

// Key Directional Light (Main shadow caster)
const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.2);
keyLight.position.set(2.5, 4.0, 2.0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 10;
keyLight.shadow.camera.left = -1.5;
keyLight.shadow.camera.right = 1.5;
keyLight.shadow.camera.top = 1.5;
keyLight.shadow.camera.bottom = -1.5;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

// Rim Light (Accentuates carapace edge, tail curvature and stinger barb)
const rimLight = new THREE.DirectionalLight(0x40a9ff, 1.8);
rimLight.position.set(-2.5, 3.0, -2.5);
scene.add(rimLight);

// Fill Light (Soft amber bounce)
const fillLight = new THREE.DirectionalLight(0xffaa55, 0.7);
fillLight.position.set(-2.0, 1.5, 2.5);
scene.add(fillLight);

// Ground plane for realistic contact shadows
const groundGeo = new THREE.PlaneGeometry(12, 12);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x0c0f12,
  roughness: 0.95,
  metalness: 0.1
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);

// Subtle ground grid
const grid = new THREE.GridHelper(8, 32, 0x00f5d4, 0x18242a);
grid.position.y = 0.001;
scene.add(grid);

// =========================================================================
// 3. BUILD THE SCORPION 3D MODEL
// =========================================================================
const { root, model, joints, materials } = buildScorpionModel();
scene.add(root);

// Generate Animation Clips
const animationClips = createScorpionAnimations(joints);
const mixer = new THREE.AnimationMixer(model);
const actions = {};

animationClips.forEach((clip) => {
  const action = mixer.clipAction(clip);
  actions[clip.name] = action;
});

// Start with Walk cycle
let currentAction = actions['Walk'];
currentAction.play();
let currentClipName = 'Walk';
let isPaused = false;
let timeScale = 1.0;

// Switch animation smoothly with cross-fade
function playAnimation(name, duration = 0.35) {
  if (name === currentClipName) return;
  const nextAction = actions[name];
  if (!nextAction) return;

  nextAction.reset();
  nextAction.setEffectiveTimeScale(timeScale);
  nextAction.setEffectiveWeight(1);
  nextAction.crossFadeFrom(currentAction, duration, true);
  nextAction.play();

  currentAction = nextAction;
  currentClipName = name;

  // Update UI cards
  document.querySelectorAll('.anim-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.anim === name);
  });
}

// =========================================================================
// 4. ANATOMICAL ANNOTATION PINS (3D to 2D screen tracking)
// =========================================================================
const anatomicalPoints = [
  {
    id: 'prosoma',
    name: 'Prosoma (Carapace)',
    pos: new THREE.Vector3(0, 0.38, 0.25),
    desc: 'The dorsal carapace shield covering the cephalothorax. Features median and lateral ocular tubercles, clypeal notch, and protects vital cephalic organs.'
  },
  {
    id: 'chela',
    name: 'Pedipalp Chela (Pincer)',
    pos: new THREE.Vector3(0.42, 0.22, 0.62),
    desc: 'Massive bulbous raptorial chela (manus) with fixed finger and articulated movable finger. Used to grapple prey with powerful crushing force before stinging.'
  },
  {
    id: 'denticles',
    name: 'Pincer Denticles',
    pos: new THREE.Vector3(0.38, 0.22, 0.78),
    desc: 'Serrated primary and secondary cutting tooth rows along the inner margin of the claws, preventing captured prey from slipping.'
  },
  {
    id: 'mesosoma',
    name: 'Mesosoma (Pre-Abdomen)',
    pos: new THREE.Vector3(0, 0.36, -0.15),
    desc: '7 distinct articulated dorsal tergites (Tergites I-VII) overlapping sequentially. Houses digestive tract, heart vessel, book lung spiracles, and reproductive organs.'
  },
  {
    id: 'metasoma',
    name: 'Metasoma (Tail Rings)',
    pos: new THREE.Vector3(0, 0.58, -0.32),
    desc: 'Five cylindrical caudal segments (Cauda I-V), each fortified with 8 longitudinal carinae (keels) and granular pustules, providing muscular whip propulsion.'
  },
  {
    id: 'telson',
    name: 'Telson (Venom Vesicle)',
    pos: new THREE.Vector3(0, 0.68, -0.05),
    desc: 'Bulbous ampulla housing a symmetrical pair of venom glands and compression muscles that expel venom through internal ducts upon impact.'
  },
  {
    id: 'aculeus',
    name: 'Aculeus (Stinger Needle)',
    pos: new THREE.Vector3(0, 0.54, 0.04),
    desc: 'Curved hypodermic needle-sharp barb fortified with zinc and manganese metalloproteins for extreme hardness. Capable of striking at over 100 cm/s.'
  },
  {
    id: 'legs',
    name: 'Walking Legs (Alternating Tetrapods)',
    pos: new THREE.Vector3(0.46, 0.15, -0.05),
    desc: '4 pairs (8 legs total) operating in an alternating tetrapod gait (Group A: R1, L2, R3, L4; Group B: L1, R2, L3, R4) with metachronal wave propulsion.'
  }
];

const markerContainer = document.getElementById('annotations-overlay');
const markerElements = [];

anatomicalPoints.forEach((pt) => {
  const el = document.createElement('div');
  el.className = 'annotation-marker';
  el.innerHTML = `
    <div class="marker-dot"></div>
    <div class="marker-label">${pt.name}</div>
  `;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnatomyDetail(pt);
  });
  markerContainer.appendChild(el);
  markerElements.push({ el, pt });
});

let showAnnotations = true;

function updateAnnotations() {
  if (!showAnnotations) {
    markerContainer.style.display = 'none';
    return;
  }
  markerContainer.style.display = 'block';

  const tempV = new THREE.Vector3();
  markerElements.forEach(({ el, pt }) => {
    tempV.copy(pt.pos);
    tempV.project(camera);

    // Behind camera check
    if (tempV.z > 1) {
      el.style.display = 'none';
      return;
    }

    const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tempV.y * 0.5 + 0.5) * window.innerHeight;

    el.style.display = 'flex';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
}

function openAnatomyDetail(pt) {
  const modal = document.getElementById('anatomy-modal');
  document.getElementById('modal-part-title').textContent = pt.name;
  document.getElementById('modal-part-desc').textContent = pt.desc;
  modal.classList.add('open');
}

// =========================================================================
// 5. CAMERA VIEW PRESETS (Smooth Tweens)
// =========================================================================
const cameraPresets = {
  hero: { pos: [1.4, 0.9, 1.6], target: [0, 0.22, 0.1] },
  dorsal: { pos: [0.0, 2.8, 0.1], target: [0, 0.15, 0.1] },
  pincers: { pos: [0.1, 0.45, 1.15], target: [0, 0.24, 0.45] },
  lateral: { pos: [2.2, 0.35, 0.1], target: [0, 0.25, 0.1] },
  stinger: { pos: [0.35, 0.75, 0.4], target: [0, 0.58, -0.05] }
};

let tweeningCamera = false;
let camStartPos = new THREE.Vector3();
let camEndPos = new THREE.Vector3();
let targetStart = new THREE.Vector3();
let targetEnd = new THREE.Vector3();
let tweenProgress = 1.0;

function setCameraPreset(key) {
  const preset = cameraPresets[key];
  if (!preset) return;

  camStartPos.copy(camera.position);
  camEndPos.set(...preset.pos);
  targetStart.copy(controls.target);
  targetEnd.set(...preset.target);

  tweenProgress = 0.0;
  tweeningCamera = true;
}

// =========================================================================
// 6. LIGHTING & SHADER MODES (Including Biological UV Blacklight!)
// =========================================================================
let currentLightingMode = 'studio';

function setLightingMode(mode) {
  currentLightingMode = mode;

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });

  if (mode === 'studio') {
    scene.background.set(0x080a0c);
    scene.fog.color.set(0x080a0c);
    ambientLight.color.set(0x222830);
    ambientLight.intensity = 0.8;
    keyLight.color.set(0xfff5e6);
    keyLight.intensity = 2.2;
    rimLight.color.set(0x40a9ff);
    rimLight.intensity = 1.8;
    fillLight.color.set(0xffaa55);
    resetMaterialsFromUV();
    setWireframe(false);
  } else if (mode === 'desert') {
    scene.background.set(0x1a0f08);
    scene.fog.color.set(0x1a0f08);
    ambientLight.color.set(0x4a2c14);
    ambientLight.intensity = 1.0;
    keyLight.color.set(0xff9e40);
    keyLight.intensity = 2.6;
    rimLight.color.set(0xffd166);
    rimLight.intensity = 1.2;
    fillLight.color.set(0x9d4edd);
    resetMaterialsFromUV();
    setWireframe(false);
  } else if (mode === 'uv') {
    // BIOLUMINESCENT UV BLACKLIGHT MODE (365nm Fluorescence)
    // In real life, beta-carbolines and 7-hydroxy-4-methylcoumarin in the scorpion cuticle
    // absorb UV light and fluoresce in brilliant electric neon cyan/green!
    scene.background.set(0x04020a);
    scene.fog.color.set(0x04020a);
    ambientLight.color.set(0x150030); // deep ultraviolet glow
    ambientLight.intensity = 0.5;
    keyLight.color.set(0x5a00ff);     // blacklight beam
    keyLight.intensity = 1.5;
    rimLight.color.set(0x00f5d4);     // fluorescent rim
    rimLight.intensity = 2.5;
    fillLight.color.set(0x05ffa1);

    applyUVFluorescence();
    setWireframe(false);
  } else if (mode === 'wireframe') {
    setWireframe(true);
  }
}

function applyUVFluorescence() {
  model.traverse((child) => {
    if (child.isMesh && child.material) {
      if (!child.userData.originalColor) {
        child.userData.originalColor = child.material.color.clone();
        child.userData.originalEmissive = child.material.emissive ? child.material.emissive.clone() : new THREE.Color(0x000000);
        child.userData.originalEmissiveIntensity = child.material.emissiveIntensity || 0;
      }
      // Glowing electric neon cyan fluorescence
      child.material.color.set(0x00f5d4);
      child.material.emissive.set(0x00e5c0);
      child.material.emissiveIntensity = 0.85;
      child.material.roughness = 0.3;
    }
  });
}

function resetMaterialsFromUV() {
  model.traverse((child) => {
    if (child.isMesh && child.material && child.userData.originalColor) {
      child.material.color.copy(child.userData.originalColor);
      child.material.emissive.copy(child.userData.originalEmissive);
      child.material.emissiveIntensity = child.userData.originalEmissiveIntensity;
      child.material.roughness = 0.22;
    }
  });
}

function setWireframe(enabled) {
  model.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.wireframe = enabled;
    }
  });
}

// =========================================================================
// 7. UI EVENT LISTENERS
// =========================================================================

// Animation Card click handlers
document.querySelectorAll('.anim-card').forEach((card) => {
  card.addEventListener('click', () => {
    const animName = card.dataset.anim;
    playAnimation(animName);
  });
});

// Play / Pause toggle
const playPauseBtn = document.getElementById('play-pause-btn');
playPauseBtn.addEventListener('click', () => {
  isPaused = !isPaused;
  currentAction.paused = isPaused;
  playPauseBtn.innerHTML = isPaused
    ? `<span class="btn-icon">▶</span> Play`
    : `<span class="btn-icon">⏸</span> Pause`;
});

// Speed Chips
document.querySelectorAll('.speed-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.speed-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    timeScale = parseFloat(chip.dataset.speed);
    mixer.timeScale = timeScale;
    document.getElementById('speed-slider').value = timeScale;
  });
});

// Speed Slider
const speedSlider = document.getElementById('speed-slider');
speedSlider.addEventListener('input', (e) => {
  timeScale = parseFloat(e.target.value);
  mixer.timeScale = timeScale;
  document.querySelectorAll('.speed-chip').forEach((c) => {
    c.classList.toggle('active', parseFloat(c.dataset.speed) === timeScale);
  });
});

// Timeline Scrubber
const timelineSlider = document.getElementById('timeline-slider');
timelineSlider.addEventListener('input', (e) => {
  const normTime = parseFloat(e.target.value);
  if (currentAction) {
    currentAction.time = normTime * currentAction.getClip().duration;
  }
});

// Camera View Preset Buttons
document.querySelectorAll('.view-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setCameraPreset(btn.dataset.view);
  });
});

// Lighting Mode Buttons
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setLightingMode(btn.dataset.mode);
  });
});

// Annotations Toggle
const toggleAnnotBtn = document.getElementById('toggle-annotations-btn');
toggleAnnotBtn.addEventListener('click', () => {
  showAnnotations = !showAnnotations;
  toggleAnnotBtn.classList.toggle('active', showAnnotations);
});

// Auto Rotate Toggle
const autoRotateBtn = document.getElementById('auto-rotate-btn');
autoRotateBtn.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  autoRotateBtn.classList.toggle('active', controls.autoRotate);
});

// Modal Close Handlers
document.querySelectorAll('.close-modal-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('open'));
  });
});

document.querySelectorAll('.modal-overlay').forEach((m) => {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.remove('open');
  });
});

document.getElementById('open-dossier-btn').addEventListener('click', () => {
  document.getElementById('dossier-modal').classList.add('open');
});

// Download GLB
document.getElementById('download-glb-btn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/models/scorpion.glb';
  link.download = 'scorpion_ultra_realistic.glb';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Download OBJ
document.getElementById('download-obj-btn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/models/scorpion.obj';
  link.download = 'scorpion_ultra_realistic.obj';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Capture Screenshot
document.getElementById('screenshot-btn').addEventListener('click', () => {
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'scorpion_render_3d.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// =========================================================================
// 8. ANIMATION LOOP & LIVE TELEMETRY
// =========================================================================
const clock = new THREE.Clock();

const telemetryGait = document.getElementById('telemetry-gait');
const telemetryPhase = document.getElementById('telemetry-phase');
const telemetryTailSpeed = document.getElementById('telemetry-tail-speed');
const telemetryJoints = document.getElementById('telemetry-joints');

telemetryJoints.textContent = Object.keys(joints).length;

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Update Animation Mixer
  if (!isPaused) {
    mixer.update(delta);
  }

  // Update Timeline Scrubber
  if (currentAction && currentAction.getClip()) {
    const clipDur = currentAction.getClip().duration;
    const progress = (currentAction.time % clipDur) / clipDur;
    timelineSlider.value = progress;

    // Telemetry updates based on current animation
    if (currentClipName === 'Walk') {
      telemetryGait.textContent = 'Alternating Tetrapod';
      const tetrapodActive = progress < 0.5 ? 'Tetrapod A (R1-L2-R3-L4)' : 'Tetrapod B (L1-R2-L3-R4)';
      telemetryPhase.textContent = tetrapodActive;
      telemetryTailSpeed.textContent = '12.4 cm/s (Counterbalance)';
    } else if (currentClipName === 'Attack') {
      telemetryGait.textContent = 'Predatory Strike';
      if (progress < 0.25) {
        telemetryPhase.textContent = 'Threat Wind-Up & Pincer Splay';
        telemetryTailSpeed.textContent = '8.0 cm/s';
      } else if (progress < 0.38) {
        telemetryPhase.textContent = 'Chelae Snap Clamp';
        telemetryTailSpeed.textContent = '24.5 cm/s';
      } else if (progress < 0.6) {
        telemetryPhase.textContent = 'Overhead Stinger Whip Plunge!';
        telemetryTailSpeed.textContent = '118.2 cm/s (Peak)';
      } else if (progress < 0.75) {
        telemetryPhase.textContent = 'Envenomation & Muscle Pulse';
        telemetryTailSpeed.textContent = '2.1 cm/s';
      } else {
        telemetryPhase.textContent = 'Snap Retraction & Guard Return';
        telemetryTailSpeed.textContent = '45.0 cm/s';
      }
    } else if (currentClipName === 'StingerStrike') {
      telemetryGait.textContent = 'Defensive Tail Whip';
      telemetryPhase.textContent = progress < 0.5 ? 'Forward Thrust' : 'Recoil';
      telemetryTailSpeed.textContent = progress > 0.2 && progress < 0.5 ? '124.6 cm/s' : '15.0 cm/s';
    } else if (currentClipName === 'PincerAttack') {
      telemetryGait.textContent = 'Double Chela Grapple';
      telemetryPhase.textContent = 'Claw Clamp & Hold';
      telemetryTailSpeed.textContent = '5.0 cm/s';
    } else if (currentClipName === 'Threat') {
      telemetryGait.textContent = 'Warning Intimidation';
      telemetryPhase.textContent = 'Reared Posture + Tremor';
      telemetryTailSpeed.textContent = '1.2 cm/s';
    } else {
      telemetryGait.textContent = 'Stationary Respiration';
      telemetryPhase.textContent = 'Tergite Book Lung Cycle';
      telemetryTailSpeed.textContent = '0.4 cm/s';
    }
  }

  // Smooth Camera Tweens
  if (tweeningCamera) {
    tweenProgress += delta * 2.2;
    if (tweenProgress >= 1.0) {
      tweenProgress = 1.0;
      tweeningCamera = false;
    }
    const ease = 0.5 - 0.5 * Math.cos(tweenProgress * Math.PI);
    camera.position.lerpVectors(camStartPos, camEndPos, ease);
    controls.target.lerpVectors(targetStart, targetEnd, ease);
  }

  controls.update();
  updateAnnotations();
  renderer.render(scene, camera);
}

// Window resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start animation loop
animate();
