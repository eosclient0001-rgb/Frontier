import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { XPBDMetalSolver } from './xpbd.js';
import { createSheetMesh, createCanMesh, createCarShellMesh, createBallShellMesh, buildConstraintsFromTrimesh } from './mesh.js';

// Renderer
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);
scene.fog = new THREE.Fog(0x0a0a0f, 15, 35);

// Camera
const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(3.5, 3.0, 4.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.3,0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 1;
controls.maxDistance = 15;

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 2.5);
dir.position.set(5,8,3);
dir.castShadow = true;
dir.shadow.mapSize.set(2048,2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 20;
dir.shadow.camera.left = -6;
dir.shadow.camera.right = 6;
dir.shadow.camera.top = 6;
dir.shadow.camera.bottom = -6;
scene.add(dir);
const fill = new THREE.DirectionalLight(0x8899ff, 0.6);
fill.position.set(-4,3,-5);
scene.add(fill);

// Environment for metal reflections (simple)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x222233);
const envLight = new THREE.PointLight(0xffffff, 10);
envLight.position.set(0,5,0);
envScene.add(envLight);
const envMap = pmrem.fromScene(envScene, 0.04).texture;

// Ground
const groundGeo = new THREE.PlaneGeometry(30,30);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.85, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI/2;
ground.position.y = -0.8;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30,30,0x333344,0x222233);
grid.position.y = -0.79;
scene.add(grid);

// Wall for car crash
const wallGeo = new THREE.BoxGeometry(0.5, 4, 6);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.7, metalness: 0.2 });
const wallMesh = new THREE.Mesh(wallGeo, wallMat);
wallMesh.position.set(4, 0.8, 0);
wallMesh.receiveShadow = true;
wallMesh.castShadow = true;
wallMesh.visible = false;
scene.add(wallMesh);

// Hammer / impactor
const hammerGeo = new THREE.SphereGeometry(0.45, 24, 24);
const hammerMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.4, metalness: 0.3, emissive: 0x331100, emissiveIntensity:0.2 });
const hammerMesh = new THREE.Mesh(hammerGeo, hammerMat);
hammerMesh.castShadow = true;
hammerMesh.receiveShadow = true;
scene.add(hammerMesh);

const hammer = {
  pos: new THREE.Vector3(0, 3, 0),
  vel: new THREE.Vector3(0,0,0),
  radius: 0.45,
  mass: 30,
  active: true,
  isDragging: false,
  dragPlane: new THREE.Plane(new THREE.Vector3(0,1,0),0),
  dragOffset: new THREE.Vector3(),
};

// Metal mesh visualization
let metalMesh = null;
let metalMaterial = null;
let solver = null;
let geometry = null;

let mode = 'sheet'; // sheet, can, car, ball

const params = {
  mode: 'sheet',
  stretchCompliance: 1e-7,
  bendCompliance: 2e-6,
  yieldStretch: 0.02,
  yieldBend: 0.12,
  plasticRate: 0.85,
  hardening: 0.15,
  velocityDamping: 0.995,
  substeps: 12,
  iterations: 8,
  showWireframe: false,
  showPlasticHeatmap: true,
  autoDrop: true,
};

function createMetalMaterial() {
  if (params.showPlasticHeatmap) {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.85,
      roughness: 0.35,
      envMap: envMap,
      envMapIntensity: 0.6,
      wireframe: params.showWireframe,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
  } else {
    return new THREE.MeshStandardMaterial({
      color: 0xc0c0c8,
      metalness: 0.85,
      roughness: 0.28,
      envMap: envMap,
      envMapIntensity: 0.8,
      wireframe: params.showWireframe,
      side: THREE.DoubleSide,
    });
  }
}

function initSolverForMode(newMode) {
  mode = newMode;
  params.mode = newMode;

  // cleanup old
  if (metalMesh) {
    scene.remove(metalMesh);
    metalMesh.geometry.dispose();
  }
  solver = new XPBDMetalSolver();
  solver.params.stretchCompliance = params.stretchCompliance;
  solver.params.bendCompliance = params.bendCompliance;
  solver.params.stretchYield = params.yieldStretch;
  solver.params.bendYield = params.yieldBend;
  solver.params.plasticRate = params.plasticRate;
  solver.params.hardening = params.hardening;
  solver.params.velocityDamping = params.velocityDamping;
  solver.substeps = params.substeps;
  solver.iterations = params.iterations;

  let meshData;
  if (mode==='sheet') {
    meshData = createSheetMesh(3.5, 3.5, 22, 22);
    wallMesh.visible = false;
    hammer.pos.set(0, 3.2, 0);
    hammer.vel.set(0,0,0);
    hammerMesh.visible = true;
    hammerMesh.scale.set(1,1,1);
    hammer.radius = 0.45;
    camera.position.set(2.5, 2.8, 2.5);
    controls.target.set(0,0,0);
  } else if (mode==='can') {
    meshData = createCanMesh(0.7, 1.6, 20, 10, true);
    wallMesh.visible = false;
    hammer.pos.set(0, 2.5, 0);
    hammer.vel.set(0,0,0);
    hammerMesh.visible = true;
    hammerMesh.scale.set(1.8,0.4,1.8);
    hammer.radius = 0.9;
    camera.position.set(2.2, 1.5, 2.2);
    controls.target.set(0,0.2,0);
  } else if (mode==='car') {
    meshData = createCarShellMesh();
    wallMesh.visible = true;
    wallMesh.position.set(3.5, 0.5, 0);
    hammerMesh.visible = false;
    hammerMesh.scale.set(1,1,1);
    hammer.pos.set(-5, 0.4, 0);
    hammer.vel.set(8,0,0);
    camera.position.set(1, 1.8, 4);
    controls.target.set(0,0.5,0);
  } else if (mode==='ball') {
    meshData = createBallShellMesh(0.9, 3);
    wallMesh.visible = false;
    hammerMesh.visible = true;
    hammerMesh.scale.set(1,1,1);
    hammer.pos.set(0, 3, 0);
    hammer.radius = 0.45;
    camera.position.set(2,1.5,2);
    controls.target.set(0,0,0);
  }

  // init particles
  solver.initParticles(meshData.positions);

  // build constraints
  const { edgeCount, bendCount } = buildConstraintsFromTrimesh(solver, meshData.positions, meshData.indices);

  // for car, add initial velocity towards wall
  if (mode==='car') {
    for (let i=0;i<solver.numParticles;i++) {
      solver.velocities[i*3] = 7 + Math.random()*0.5; // moving +X towards wall
    }
  }

  // Create Three mesh
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(solver.positions, 3));
  geometry.setIndex(meshData.indices);
  geometry.computeVertexNormals();

  // color attribute for plastic strain heatmap
  const colors = new Float32Array(solver.numParticles*3);
  for (let i=0;i<solver.numParticles;i++) {
    colors[i*3]=0.75; colors[i*3+1]=0.75; colors[i*3+2]=0.8;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));

  metalMaterial = createMetalMaterial();
  metalMesh = new THREE.Mesh(geometry, metalMaterial);
  metalMesh.castShadow = true;
  metalMesh.receiveShadow = true;
  scene.add(metalMesh);

  console.log(`Mode ${mode}: ${solver.numParticles} particles, ${solver.distanceConstraints.length} stretch, ${solver.bendingConstraints.length} bend`);

  document.getElementById('solver-info').textContent = `${solver.numParticles} pts | ${solver.distanceConstraints.length} stretch | ${solver.bendingConstraints.length} bend | sub ${solver.substeps}x${solver.iterations}`;
}

function updateHeatmapColors() {
  if (!geometry || !solver) return;
  const colorAttr = geometry.getAttribute('color');
  if (!colorAttr) return;

  // Need per-particle max plastic from constraints incident to particle
  const particlePlastic = new Float32Array(solver.numParticles);
  const counts = new Float32Array(solver.numParticles);

  const accum = (arr)=>{
    for (let c of arr) {
      const p = Math.abs(c.plasticStrain);
      particlePlastic[c.i] += p; counts[c.i]++;
      particlePlastic[c.j] += p; counts[c.j]++;
    }
  };
  accum(solver.distanceConstraints);
  accum(solver.bendingConstraints);
  for (let i=0;i<solver.numParticles;i++) if (counts[i]>0) particlePlastic[i]/=counts[i];

  for (let i=0;i<solver.numParticles;i++) {
    const p = Math.min(1, particlePlastic[i]/0.35); // normalize
    // heatmap: low = steel blue-grey, high = orange-red-yellow (heated metal)
    // 0: (0.75,0.75,0.8) -> 0.5: (1.0,0.4,0.0) -> 1.0: (1.0,1.0,0.3)
    let r,g,b;
    if (p<0.5) {
      const t = p/0.5;
      r = 0.75 + (1.0-0.75)*t;
      g = 0.75 + (0.35-0.75)*t;
      b = 0.8 + (0.0-0.8)*t;
    } else {
      const t = (p-0.5)/0.5;
      r = 1.0;
      g = 0.35 + (1.0-0.35)*t;
      b = 0.0 + (0.3-0.0)*t;
    }
    colorAttr.array[i*3]=r;
    colorAttr.array[i*3+1]=g;
    colorAttr.array[i*3+2]=b;
  }
  colorAttr.needsUpdate = true;

  // update stats
  document.getElementById('plastic-info').textContent = `plastic avg ${(solver.stats.avgPlastic*100).toFixed(2)}% | max ${(solver.stats.maxPlastic*100).toFixed(1)}% | yielded ${solver.stats.numYielded}`;
}

// Collision handling
function collisionCallback(solverInst, dt) {
  if (mode==='sheet' || mode==='ball' || mode==='can') {
    // ground
    solverInst.collidePlane([0,-0.8,0],[0,1,0],0.4);
    // hammer sphere/box
    if (mode==='can') {
      // for can, hammer is a flat box crushing from top: treat as plane moving down + sphere
      // Use sphere but also top plane
      const hammerPos = [hammer.pos.x, hammer.pos.y, hammer.pos.z];
      // large flat disc: we approximate with plane at hammer bottom
      const planeY = hammer.pos.y - 0.25;
      // collide with plane (top crusher)
      solverInst.collidePlane([0,planeY,0],[0,-1,0],0.3); // actually need upward normal? Let's push particles below plane down? Wait.
      // We want crusher coming from above, so particles above plane should be pushed down.
      // Our plane collision pushes if dist<0. So if normal is (0,-1), point at planeY, then dist = (p - planePoint)·normal = (y-planeY)*(-1) = planeY - y. So dist<0 when y>planeY -> particle above plane -> pushed down. Good.
      // Also sphere collision for edges
      solverInst.collideSphere(hammerPos, hammer.radius, 0.35);
    } else {
      solverInst.collideSphere([hammer.pos.x, hammer.pos.y, hammer.pos.z], hammer.radius, 0.35);
    }
  } else if (mode==='car') {
    solverInst.collidePlane([0,-0.8,0],[0,1,0],0.5);
    // wall at x=3.5, thickness 0.5 -> wall spans x 3.25 to 3.75
    solverInst.collideBox([3.25,-1,-3],[3.75,3,3],0.6);
  }
}

// Hammer physics
function updateHammer(dt) {
  if (hammer.isDragging) return;
  if (!hammer.active) return;

  if (mode==='can') {
    // crusher moves down slowly then up
    hammer.vel.y -= 9.81*dt*0.5;
    hammer.pos.addScaledVector(hammer.vel, dt);
    if (hammer.pos.y < 0.2) {
      hammer.pos.y = 0.2;
      hammer.vel.y = 0;
      // stay crushing, then after 1.5 sec retract? For demo, just stay
    }
    if (hammer.pos.y < -0.5) {
      hammer.pos.y = 2.5;
      hammer.vel.set(0,0,0);
    }
  } else if (mode==='sheet' || mode==='ball') {
    hammer.vel.y -= 9.81*dt;
    hammer.pos.addScaledVector(hammer.vel, dt);
    if (hammer.pos.y < -0.2) {
      // bounce slightly but damped heavily (metal hammer)
      hammer.pos.y = -0.2;
      hammer.vel.y *= -0.15;
      hammer.vel.x *= 0.85;
      hammer.vel.z *= 0.85;
      if (Math.abs(hammer.vel.y)<0.1) {
        hammer.vel.set(0,0,0);
        if (params.autoDrop) {
          setTimeout(()=>{ if (!hammer.isDragging) resetHammer(); }, 1200);
        }
      }
    }
  }

  hammerMesh.position.copy(hammer.pos);
}

// Drag controls for hammer
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isMouseDown = false;

renderer.domElement.addEventListener('pointerdown', (e)=>{
  if (mode==='car') return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(hammerMesh);
  if (hits.length>0) {
    hammer.isDragging = true;
    controls.enabled = false;
    // create drag plane perpendicular to camera through hammer
    hammer.dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hammer.pos);
    const inter = new THREE.Vector3();
    raycaster.ray.intersectPlane(hammer.dragPlane, inter);
    hammer.dragOffset.copy(inter).sub(hammer.pos);
    hammer.vel.set(0,0,0);
  }
});
renderer.domElement.addEventListener('pointermove', (e)=>{
  if (!hammer.isDragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const inter = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(hammer.dragPlane, inter)) {
    hammer.pos.copy(inter).sub(hammer.dragOffset);
    hammerMesh.position.copy(hammer.pos);
  }
});
renderer.domElement.addEventListener('pointerup', ()=>{
  if (hammer.isDragging) {
    hammer.isDragging = false;
    controls.enabled = true;
    // give velocity based on movement? Keep zero for now
  }
});

// Keyboard
window.addEventListener('keydown', (e)=>{
  if (e.code==='Space') {
    resetHammer();
  } else if (e.code==='KeyR') {
    resetCurrentMode();
  } else if (e.code==='Digit1') {
    initSolverForMode('sheet');
  } else if (e.code==='Digit2') {
    initSolverForMode('can');
  } else if (e.code==='Digit3') {
    initSolverForMode('car');
  } else if (e.code==='Digit4') {
    initSolverForMode('ball');
  }
});

function resetHammer() {
  if (mode==='sheet') {
    hammer.pos.set((Math.random()-0.5)*1.5, 3.2, (Math.random()-0.5)*1.5);
    hammer.vel.set(0,0,0);
  } else if (mode==='can') {
    hammer.pos.set(0,2.5,0);
    hammer.vel.set(0,-1.5,0);
  } else if (mode==='ball') {
    hammer.pos.set((Math.random()-0.5)*1, 3, (Math.random()-0.5)*1);
    hammer.vel.set(0,0,0);
  }
  hammerMesh.position.copy(hammer.pos);
}

function resetCurrentMode() {
  initSolverForMode(mode);
}

// GUI
const gui = new GUI({ title: 'Metal XPBD Controls' });
gui.add(params,'mode',['sheet','can','car','ball']).name('Demo Mode').onChange(v=>initSolverForMode(v));
const metalFolder = gui.addFolder('Metal Properties (Steel-like)');
metalFolder.add(params,'stretchCompliance',1e-9,1e-4,1e-9).name('Stretch Compliance (1/stiff)').onChange(v=>{ if(solver) solver.params.stretchCompliance=v; solver.distanceConstraints.forEach(c=>c.compliance=v); }).listen();
metalFolder.add(params,'bendCompliance',1e-8,1e-3,1e-8).name('Bend Compliance').onChange(v=>{ if(solver) solver.params.bendCompliance=v; solver.bendingConstraints.forEach(c=>c.compliance=v); });
metalFolder.add(params,'yieldStretch',0.001,0.1,0.001).name('Yield Stretch').onChange(v=>{ if(solver) solver.params.stretchYield=v; solver.distanceConstraints.forEach(c=>c.yield=v); });
metalFolder.add(params,'yieldBend',0.01,0.5,0.01).name('Yield Bend').onChange(v=>{ if(solver) solver.params.bendYield=v; solver.bendingConstraints.forEach(c=>c.yield=v); });
metalFolder.add(params,'plasticRate',0.1,1.0,0.01).name('Plastic Flow Rate').onChange(v=>{ if(solver) solver.params.plasticRate=v; solver.distanceConstraints.forEach(c=>c.plasticRate=v); solver.bendingConstraints.forEach(c=>c.plasticRate=v); });
metalFolder.add(params,'hardening',0.0,0.5,0.01).name('Hardening').onChange(v=>{ if(solver) solver.params.hardening=v; });
metalFolder.add(params,'velocityDamping',0.9,1.0,0.001).name('Damping').onChange(v=>{ if(solver) solver.params.velocityDamping=v; });

const simFolder = gui.addFolder('Solver');
simFolder.add(params,'substeps',1,24,1).name('Substeps').onChange(v=>{ if(solver) solver.substeps=v; });
simFolder.add(params,'iterations',1,20,1).name('Iterations').onChange(v=>{ if(solver) solver.iterations=v; });

const viewFolder = gui.addFolder('View');
viewFolder.add(params,'showWireframe').name('Wireframe').onChange(v=>{
  if (metalMaterial) metalMaterial.wireframe = v;
});
viewFolder.add(params,'showPlasticHeatmap').name('Plastic Heatmap').onChange(v=>{
  if (metalMesh) {
    scene.remove(metalMesh);
    metalMaterial = createMetalMaterial();
    metalMesh.material = metalMaterial;
    scene.add(metalMesh);
  }
});
viewFolder.add(params,'autoDrop').name('Auto Redrop');

gui.add({reset:()=>resetCurrentMode()},'reset').name('Reset (R)');
gui.add({drop:()=>resetHammer()},'drop').name('Drop Hammer (Space)');

const explainFolder = gui.addFolder('Why this is Metal, not Cloth');
explainFolder.add({info:`
XPBD Cloth: high compliance (0.001), pure elastic, low bend stiffness, no plasticity -> bounces back.

XPBD Metal (this demo):
- compliance 1e-7 (200GPa steel)
- yield surface: |elastic strain| > yield?
- if yielded: rest length += (strain-yield)*plasticRate
- hardening: yield += hardening*|plastic|
- rest state permanently changed -> no rebound, stays crumpled
- bending plasticity creates sharp folds
- velocity damping kills vibration
`},'info').name('Explanation');

// Init
initSolverForMode('sheet');

// Animation loop
let lastTime = performance.now();
let accumulator = 0;
let frameCount=0;
let lastFpsTime=lastTime;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now-lastTime)/1000;
  lastTime = now;
  dt = Math.min(dt, 1/30);

  controls.update();
  updateHammer(dt);

  if (solver && geometry) {
    const t0 = performance.now();
    solver.step(dt, collisionCallback);
    const t1 = performance.now();

    // update Three geometry
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    if (params.showPlasticHeatmap && frameCount%3===0) {
      updateHeatmapColors();
    }

    frameCount++;
    if (now-lastFpsTime>500) {
      const ms = (t1-t0).toFixed(1);
      document.getElementById('perf').textContent = `${(1/dt).toFixed(0)} fps | solve ${ms} ms | ${mode}`;
      lastFpsTime = now;
    }
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initial hammer drop sequence for demo
setTimeout(()=>resetHammer(), 500);
