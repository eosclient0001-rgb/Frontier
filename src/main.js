import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createHammerheadShark } from './shark/HammerheadMesh.js';
import { createSharkMaterials } from './shark/SharkMaterials.js';
import { SharkController } from './shark/SharkController.js';
import { createUnderwaterEnvironment } from './environment/UnderwaterScene.js';
import { createPreyStingray } from './environment/PreyTarget.js';
import { UnderwaterAudio } from './audio/UnderwaterAudio.js';

// Setup Scene, Camera, Renderer
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.8, 6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = false;
container.appendChild(renderer.domElement);

// Orbit Controls for Inspection Mode
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 45.0;
controls.target.set(0, 0, 0);

// Initialize Underwater Audio
const audio = new UnderwaterAudio();
window.addEventListener('click', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });

// Create Underwater Environment (Fog, Seabed, God Rays, Caustics, Marine Snow)
const ocean = createUnderwaterEnvironment(scene);

// Create Prey (Southern Stingray)
const prey = createPreyStingray(scene);

// Create Great Hammerhead Shark Model
const sharkData = createHammerheadShark();
const materials = createSharkMaterials();

// Shark Mesh Group
const sharkGroup = new THREE.Group();
scene.add(sharkGroup);

// Add Root Bone to Shark Group
sharkGroup.add(sharkData.bones[0]);

// Create Skinned Meshes
const bodyMesh = new THREE.SkinnedMesh(sharkData.bodyGeom, materials.bodyMaterial);
bodyMesh.add(sharkData.bones[0]);
bodyMesh.bind(sharkData.skeleton);
sharkGroup.add(bodyMesh);

const teethMesh = new THREE.SkinnedMesh(sharkData.teethGeom, materials.teethMaterial);
teethMesh.bind(sharkData.skeleton);
sharkGroup.add(teethMesh);

const eyesMesh = new THREE.SkinnedMesh(sharkData.eyesGeom, materials.eyeMaterial);
eyesMesh.bind(sharkData.skeleton);
sharkGroup.add(eyesMesh);

// Internal Skeleton / Bone Visualizer for X-Ray Mode
const skeletonHelper = new THREE.SkeletonHelper(sharkGroup);
skeletonHelper.visible = false;
skeletonHelper.material.linewidth = 2;
scene.add(skeletonHelper);

// Shark Biomechanical Controller
const controller = new SharkController(sharkGroup, sharkData.boneMap, sharkData.bones);

// Hook Audio Callbacks
controller.onBiteSnap = () => audio.playBiteSnap();
controller.onThrash = () => audio.playThrash();
controller.onRush = () => audio.playRush();

// Camera Mode State: 'ORBIT', 'CHASE', 'HEAD', 'ACTION'
let cameraMode = 'ORBIT';
let isXRayMode = false;

// Keyboard input state
const keys = {
  w: false, s: false, a: false, d: false,
  ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
  shift: false, space: false
};

window.addEventListener('keydown', (e) => {
  if (keys.hasOwnProperty(e.key) || keys.hasOwnProperty(e.code)) {
    keys[e.key] = true;
  }
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    controller.triggerBite();
  }
  if (e.key === 'r' || e.key === 'R') {
    controller.turnAround180();
  }
});

window.addEventListener('keyup', (e) => {
  if (keys.hasOwnProperty(e.key) || keys.hasOwnProperty(e.code)) {
    keys[e.key] = false;
  }
});

// UI HUD References
const hudSpeed = document.getElementById('hud-speed');
const hudHeading = document.getElementById('hud-heading');
const hudBank = document.getElementById('hud-bank');
const hudTailFreq = document.getElementById('hud-freq');
const hudState = document.getElementById('hud-state');
const hudGape = document.getElementById('hud-gape');
const hudProtrude = document.getElementById('hud-protrude');
const turnSlider = document.getElementById('turn-slider');
const turnSliderVal = document.getElementById('turn-slider-val');

// Procedural Turn Slider event
if (turnSlider) {
  turnSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    controller.setTurnInput(val);
    if (turnSliderVal) turnSliderVal.textContent = `${(val * 90).toFixed(0)}°`;
  });
  turnSlider.addEventListener('change', () => {
    // Snap back to neutral after user releases slider
    turnSlider.value = 0;
    controller.setTurnInput(0);
    if (turnSliderVal) turnSliderVal.textContent = '0° (Neutral)';
  });
}

// Button Events
setupUIButtons();

function setupUIButtons() {
  const btnTurn180 = document.getElementById('btn-turn-180');
  if (btnTurn180) btnTurn180.addEventListener('click', () => controller.turnAround180());

  const btnTurnLeft = document.getElementById('btn-turn-left');
  if (btnTurnLeft) btnTurnLeft.addEventListener('click', () => controller.turnLeft90());

  const btnTurnRight = document.getElementById('btn-turn-right');
  if (btnTurnRight) btnTurnRight.addEventListener('click', () => controller.turnRight90());

  const btnCruise = document.getElementById('btn-cruise');
  if (btnCruise) btnCruise.addEventListener('click', () => {
    controller.state = 'CRUISE';
    controller.setTargetPoint(null);
  });

  const btnSprint = document.getElementById('btn-sprint');
  if (btnSprint) btnSprint.addEventListener('click', () => {
    controller.state = 'SPRINT';
  });

  const btnBite = document.getElementById('btn-bite');
  if (btnBite) btnBite.addEventListener('click', () => controller.triggerBite());

  const btnAttackCombo = document.getElementById('btn-attack');
  if (btnAttackCombo) btnAttackCombo.addEventListener('click', () => controller.triggerAttackCombo());

  const btnHunt = document.getElementById('btn-hunt');
  if (btnHunt) btnHunt.addEventListener('click', () => {
    controller.setTargetPoint(prey.position, true);
  });

  // Camera Mode buttons
  const camButtons = {
    'cam-orbit': 'ORBIT',
    'cam-chase': 'CHASE',
    'cam-head': 'HEAD',
    'cam-action': 'ACTION'
  };

  for (const [id, mode] of Object.entries(camButtons)) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        cameraMode = mode;
        document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (mode === 'ORBIT') {
          controls.enabled = true;
          controls.target.copy(controller.position);
        } else {
          controls.enabled = false;
        }
      });
    }
  }

  // X-Ray Mode Toggle
  const btnXRay = document.getElementById('btn-xray');
  if (btnXRay) {
    btnXRay.addEventListener('click', () => {
      isXRayMode = !isXRayMode;
      btnXRay.classList.toggle('active', isXRayMode);
      bodyMesh.material = isXRayMode ? materials.wireMaterial : materials.bodyMaterial;
      skeletonHelper.visible = isXRayMode;
    });
  }

  // Audio Toggle
  const btnAudio = document.getElementById('btn-audio');
  if (btnAudio) {
    btnAudio.addEventListener('click', () => {
      audio.init();
      const muted = audio.toggleMute();
      btnAudio.textContent = muted ? '🔇 Sound Off' : '🔊 Sound On';
    });
  }
}

// Window Resize Handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Main Animation & Render Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.08);
  const elapsedTime = clock.getElapsedTime();

  // Process Keyboard Steering
  handleKeyboardSteering(delta);

  // Update Shark Biomechanics & Procedural Kinematics
  controller.update(delta);

  // Update Underwater Audio
  audio.updateSpeed(controller.speed / controller.cruiseSpeed);

  // Update Prey (Stingray)
  prey.update(delta, elapsedTime);

  // Update Ocean Environment (Seabed caustics, marine snow, god rays)
  ocean.update(delta, elapsedTime);

  // Update Skeleton Helper if in X-Ray
  if (isXRayMode) {
    skeletonHelper.update();
  }

  // Update Camera View according to active mode
  updateCamera(delta);

  // Update HUD Telemetry
  updateHUD();

  renderer.render(scene, camera);
}

animate();

/**
 * Keyboard Steering:
 * Direct steering with A/D or Left/Right turns the shark procedurally;
 * W/S or Up/Down controls vertical pitch; Shift sprints; Space bites.
 */
function handleKeyboardSteering(delta) {
  let steer = 0;
  if (keys.a || keys.ArrowLeft) steer -= 1;
  if (keys.d || keys.ArrowRight) steer += 1;

  if (steer !== 0) {
    controller.setTurnInput(steer * 0.85);
  } else if (!turnSlider || parseFloat(turnSlider.value) === 0) {
    // If not using slider, return to zero input
    controller.setTurnInput(0);
  }

  let pitchInput = 0;
  if (keys.w || keys.ArrowUp) pitchInput += 1;
  if (keys.s || keys.ArrowDown) pitchInput -= 1;
  if (pitchInput !== 0) {
    controller.pitch = THREE.MathUtils.clamp(controller.pitch - pitchInput * delta * 0.9, -0.5, 0.5);
  }

  if (keys.shift && controller.state === 'CRUISE') {
    controller.state = 'SPRINT';
  } else if (!keys.shift && controller.state === 'SPRINT') {
    controller.state = 'CRUISE';
  }
}

/**
 * Camera update logic for multiple viewing modes
 */
function updateCamera(delta) {
  const sharkPos = controller.position;
  const heading = controller.heading;
  const pitch = controller.pitch;

  if (cameraMode === 'ORBIT') {
    controls.target.lerp(sharkPos, delta * 5.0);
    controls.update();
  } else if (cameraMode === 'CHASE') {
    // Chase camera behind and above the shark
    const backDist = 7.5;
    const height = 2.4;
    const targetX = sharkPos.x - Math.sin(heading) * backDist;
    const targetY = sharkPos.y + height - Math.sin(pitch) * 2.0;
    const targetZ = sharkPos.z - Math.cos(heading) * backDist;

    camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), delta * 4.5);
    camera.lookAt(sharkPos.x, sharkPos.y + 0.3, sharkPos.z);
  } else if (cameraMode === 'HEAD') {
    // Cephalofoil First-Person Cam (mounted directly on hammerhead's rostrum)
    const headX = sharkPos.x + Math.sin(heading) * 2.1;
    const headY = sharkPos.y + 0.35 - Math.sin(pitch) * 1.5;
    const headZ = sharkPos.z + Math.cos(heading) * 2.1;

    camera.position.lerp(new THREE.Vector3(headX, headY, headZ), delta * 12.0);
    const lookTarget = new THREE.Vector3(
      sharkPos.x + Math.sin(heading) * 15.0,
      sharkPos.y - Math.sin(pitch) * 15.0,
      sharkPos.z + Math.cos(heading) * 15.0
    );
    camera.lookAt(lookTarget);
  } else if (cameraMode === 'ACTION') {
    // Cinematic Action Cam: Flank 3/4 view focusing on cephalofoil, jaws, and tall dorsal fin
    const flankDist = 4.8;
    const actionX = sharkPos.x + Math.cos(heading) * flankDist - Math.sin(heading) * 1.5;
    const actionY = sharkPos.y - 0.2;
    const actionZ = sharkPos.z - Math.sin(heading) * flankDist - Math.cos(heading) * 1.5;

    camera.position.lerp(new THREE.Vector3(actionX, actionY, actionZ), delta * 3.5);
    camera.lookAt(sharkPos.x + Math.sin(heading) * 1.2, sharkPos.y - 0.1, sharkPos.z + Math.cos(heading) * 1.2);
  }
}

/**
 * HUD Telemetry & Biomechanical readouts
 */
function updateHUD() {
  if (hudSpeed) {
    const knots = (controller.speed * 1.94384).toFixed(1);
    hudSpeed.textContent = `${controller.speed.toFixed(1)} m/s (${knots} kts)`;
  }
  if (hudHeading) {
    const deg = (THREE.MathUtils.radToDeg(controller.heading) % 360 + 360) % 360;
    hudHeading.textContent = `${deg.toFixed(0)}°`;
  }
  if (hudBank) {
    const bankDeg = THREE.MathUtils.radToDeg(controller.bankAngle).toFixed(1);
    hudBank.textContent = `${bankDeg}°`;
  }
  if (hudTailFreq) {
    hudTailFreq.textContent = `${controller.tailFrequency.toFixed(2)} Hz`;
  }
  if (hudState) {
    const stateNames = {
      'CRUISE': 'Cruising (Sub-carangiform)',
      'SPRINT': 'High-Speed Sprint',
      'RUSH': 'Predatory Burst Rush',
      'BITE_GAPE': 'Kinetic Gape Initiation',
      'BITE_PROTRUDE': 'Palatoquadrate Protrusion',
      'BITE_SNAP': 'Jaw Clamp Snap',
      'BITE_THRASH': 'Violent Lateral Thrash',
      'RECOVER': 'Palatoquadrate Retraction'
    };
    hudState.textContent = stateNames[controller.state] || controller.state;
  }
  if (hudGape) {
    hudGape.style.width = `${(controller.jawGape * 100).toFixed(0)}%`;
  }
  if (hudProtrude) {
    hudProtrude.style.width = `${(controller.palatoquadrateProtrusion * 100).toFixed(0)}%`;
  }
}
