/**
 * Golden Eagle — real-time 3D model and animation viewer.
 */

import { Vector3 } from 'three';
import { buildEagle } from './model/eagle.js';
import { EagleRig } from './anim/rig.js';
import { createViewer, setCameraPreset } from './viewer.js';
import { EAGLE_REFERENCE } from './anatomy.js';
import {
  FLAP_PARAMS,
  HEADTURN_PARAMS,
  SCREECH_PARAMS,
  WALK_PARAMS,
  defaultPose,
  flapBodyResponse,
  flapCycle,
  glidePose,
  headTurnPose,
  idlePose,
  screechPose,
  walkCycle,
  walkSpeed,
} from './anim/cycles.js';

/* -------------------------------------------------------------------------- */
/*  Clips                                                                      */
/* -------------------------------------------------------------------------- */

const CLIPS = [
  {
    id: 'flap',
    label: 'Wing Flap Cycle',
    group: 'Flight',
    duration: 1 / FLAP_PARAMS.frequency,
    loop: true,
    airborne: true,
    height: 1.35,
    camera: { view: 'side', distance: 3.1, height: 0.1 },
    note: `${FLAP_PARAMS.frequency} Hz — the measured wingbeat of a wild Golden Eagle`,
  },
  {
    id: 'glide',
    label: 'Glide / Soar Cycle',
    group: 'Flight',
    duration: 12,
    loop: true,
    airborne: true,
    height: 1.35,
    camera: { view: 'three-quarter', distance: 3.4, height: 0.05 },
    note: 'Wings in a shallow dihedral, primaries slotted, aeroelastic flutter',
  },
  {
    id: 'walk',
    label: 'Walk Cycle',
    group: 'Ground',
    duration: 1 / WALK_PARAMS.frequency,
    loop: true,
    airborne: false,
    camera: { view: 'three-quarter', distance: 2.4, height: 0.16 },
    note: `Duty factor ${WALK_PARAMS.duty}, ${(walkSpeed() * 100).toFixed(0)} cm/s ground speed`,
  },
  {
    id: 'idle',
    label: 'Idle',
    group: 'Behaviour',
    duration: 14,
    loop: true,
    airborne: false,
    camera: { view: 'three-quarter', distance: 2.3, height: 0.12 },
    note: 'Breathing, weight shifts, micro-saccades, tail flicks, blinking',
  },
  {
    id: 'screech',
    label: 'Screech',
    group: 'Behaviour',
    duration: 0.55 + SCREECH_PARAMS.calls * SCREECH_PARAMS.callPeriod + 1.1,
    loop: false,
    airborne: false,
    camera: { view: 'front', distance: 2.4, height: 0.16 },
    note: 'Head thrown back, bill thrown open, three yelps',
  },
  {
    id: 'headturn',
    label: 'Head Turn',
    group: 'Behaviour',
    duration: 4.4,
    loop: true,
    airborne: false,
    camera: { view: 'front', distance: 2.2, height: 0.14 },
    note: 'Eyes lead, saccadic skull turn, cervical twist distributed over 11 vertebrae',
  },
];

/* -------------------------------------------------------------------------- */
/*  Build                                                                      */
/* -------------------------------------------------------------------------- */

const canvas = document.getElementById('view');
const viewer = createViewer(canvas);
const eagle = buildEagle();
const rig = new EagleRig(eagle);
viewer.scene.add(eagle.root);

/**
 * Trunk origin above the sole plane, measured off the built leg by the rig.
 * The first attempt at this was a hand-written 0.256 m and it put the bird's
 * feet 4 cm into the floor; it is a property of the geometry, so it is read
 * from the geometry.
 */
const STAND_HEIGHT = rig.calibrateStance();
const GROUND = -STAND_HEIGHT;

const pose = defaultPose();
let current = { clip: CLIPS[0], time: 0, playing: true, speed: 1 };
let walkDistance = 0;

/* -------------------------------------------------------------------------- */
/*  Pose evaluation                                                            */
/* -------------------------------------------------------------------------- */

function evaluate(clipId, t, dt) {
  const p = defaultPose();
  const root = eagle.root;
  let airborne = false;
  let rootZ = 0;
  let scrollZ = 0;

  switch (clipId) {
    case 'flap': {
      airborne = true;
      const phase = t * FLAP_PARAMS.frequency;
      flapCycle(phase, p.wings.R, FLAP_PARAMS, 1);
      flapCycle(phase, p.wings.L, FLAP_PARAMS, -1);
      const resp = flapBodyResponse(phase);
      p.trunk.y = resp.y;
      p.trunk.z = resp.z;
      p.trunk.pitch = resp.pitch;
      p.trunk.roll = resp.rollOsc;
      p.tail.pitch = 4 + Math.sin(phase * Math.PI * 2 + 0.8) * 6;
      p.tail.spread = 42;
      p.head.curve = 0.55;
      p.head.aim.pitch = 2;
      p.head.aim.yaw = 0;
      p.head.localOffset = new Vector3(0, 0.055, 0.045);
      p.spring.featherBend = p.wings.R.feather.bend;
      p.spring.tailOmega = 26;
      break;
    }
    case 'glide': {
      airborne = true;
      glidePose(t, p.wings.R, { dihedral: 6.5 });
      glidePose(t + 0.7, p.wings.L, { dihedral: 6.9 });
      const roll = Math.sin(t * 0.37) * 3.2 + Math.sin(t * 0.71 + 2.1) * 1.1;
      p.trunk.roll = roll;
      p.trunk.yaw = Math.sin(t * 0.29 + 0.5) * 2.4;
      p.trunk.pitch = 1.5 + Math.sin(t * 0.43) * 1.8;
      p.trunk.y = Math.sin(t * 0.31) * 0.012;
      p.tail.pitch = 2 + Math.sin(t * 0.41) * 3;
      p.tail.spread = 68 + Math.sin(t * 0.5) * 6;
      p.tail.roll = -roll * 0.6;
      p.head.curve = 0.42;
      p.head.aim.pitch = -2 + Math.sin(t * 0.53) * 3;
      p.head.aim.yaw = Math.sin(t * 0.23) * 14;
      p.head.aim.roll = -roll * 0.5;
      p.head.localOffset = new Vector3(0, 0.05, 0.05);
      p.spring.featherBend = 1.2;
      p.head.aimOmega = 14;
      break;
    }
    case 'walk': {
      walkCycle(t * WALK_PARAMS.frequency, p, GROUND, WALK_PARAMS);
      // The cycle is authored in place: the stance foot slides backward
      // through the body at exactly the ground speed.  So the bird stays put
      // and the substrate is scrolled under it, which is both correct and the
      // only way a looping clip can walk forever.
      const periods = (walkSpeed() * t) / viewer.ground.userData.period;
      scrollZ = periods - Math.floor(periods);
      p.spring.featherBend = 1.0;
      p.spring.headOmega = 34;
      p.spring.tailOmega = 30;
      p.head.noSpring = false;
      break;
    }
    case 'idle': {
      idlePose(t, p, { ground: GROUND });
      p.spring.featherBend = 0.8;
      p.spring.headOmega = 20;
      p.spring.tailOmega = 16;
      break;
    }
    case 'screech': {
      screechPose(t, p);
      standing(p);
      p.spring.featherBend = 0.8;
      p.spring.headOmega = 40;
      p.spring.tailOmega = 22;
      break;
    }
    case 'headturn': {
      headTurnPose(t, p);
      standing(p);
      p.spring.featherBend = 0.8;
      p.spring.headOmega = 46;
      p.spring.tailOmega = 18;
      break;
    }
  }

  return { pose: p, airborne, rootZ, scrollZ };
}

function standing(p) {
  // The height is the rig's own calibrated stance, and the sole is planted by
  // the rig's solver -- not nudged by a hand-tuned offset, which is how the
  // bird came to hover a centimetre above its own shadow.
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? 1 : -1;
    p.legs[side].footRoot = new Vector3(s * 0.043, GROUND, -0.012);
    p.legs[side].plantY = GROUND;
    p.legs[side].footYaw = s * 3.5;
  }
}

/* -------------------------------------------------------------------------- */
/*  Loop                                                                       */
/* -------------------------------------------------------------------------- */

let last = performance.now();
let fpsAcc = 0;
let fpsCount = 0;

function frame(now) {
  const dtRaw = Math.min((now - last) / 1000, 0.05);
  last = now;
  fpsAcc += dtRaw;
  fpsCount++;

  const clip = current.clip;
  if (current.playing) {
    current.time += dtRaw * current.speed;
    if (clip.loop && clip.duration > 0) {
      // Wrap rather than accumulate: an unbounded clock loses float precision
      // within minutes and the springs see a discontinuity when it does.
      // The ground distance is re-derived from the wrapped phase instead of
      // being counted up separately, so scrubbing the timeline can never leave
      // the bird strolling away from where its feet think they are.
      current.time -= Math.floor(current.time / clip.duration) * clip.duration;
    } else if (!clip.loop && current.time > clip.duration) {
      current.time = clip.duration;
      current.playing = false;
      syncPlayButton();
    }
  }
  const t = clip.loop ? current.time : Math.min(current.time, clip.duration);

  const { pose: p, airborne, rootZ, scrollZ } = evaluate(clip.id, t, dtRaw);

  eagle.root.position.set(0, airborne ? clip.height ?? 1.35 : STAND_HEIGHT, rootZ);
  rig.apply(p, current.playing ? dtRaw * current.speed : 1e-4);
  eagle.root.updateMatrixWorld(true);

  viewer.controls.target.x = 0;
  viewer.controls.target.z = 0;
  viewer.ground.visible = !airborne;
  // One whole number of tiles is invisible, so wrapping here is seamless.
  viewer.ground.position.z = clip.id === 'walk' ? scrollZ * viewer.ground.userData.period : 0;

  viewer.resize();
  viewer.controls.update();
  viewer.renderer.render(viewer.scene, viewer.camera);

  if (fpsAcc > 0.5) {
    hudFps.textContent = `${(fpsCount / fpsAcc).toFixed(0)} fps`;
    fpsAcc = 0;
    fpsCount = 0;
  }
  requestAnimationFrame(frame);
}

/* -------------------------------------------------------------------------- */
/*  UI                                                                         */
/* -------------------------------------------------------------------------- */

const hudFps = document.getElementById('fps');
const clipList = document.getElementById('clips');
const timeline = document.getElementById('timeline');
const playBtn = document.getElementById('play');
const timeLabel = document.getElementById('timelabel');
const noteLabel = document.getElementById('clipnote');

function syncPlayButton() {
  playBtn.textContent = current.playing ? '❚❚  Pause' : '▶  Play';
}

for (const clip of CLIPS) {
  const b = document.createElement('button');
  b.className = 'clip';
  b.dataset.id = clip.id;
  b.innerHTML = `<span class="grp">${clip.group}</span><span class="lbl">${clip.label}</span>`;
  b.onclick = () => selectClip(clip);
  clipList.appendChild(b);
}

function selectClip(clip) {
  current.clip = clip;
  current.time = 0;
  current.playing = true;
  walkDistance = 0;
  rig.resetSprings();
  for (const el of clipList.children) el.classList.toggle('active', el.dataset.id === clip.id);
  timeline.max = 1000;
  noteLabel.textContent = clip.note ?? '';
  setCameraPreset(viewer.camera, viewer.controls, clip.camera, { height: 0 });
  document.body.classList.toggle('airborne', clip.airborne);
  syncPlayButton();
}

playBtn.onclick = () => {
  current.playing = !current.playing;
  syncPlayButton();
};

timeline.addEventListener('input', () => {
  const clip = current.clip;
  const frac = timeline.value / 1000;
  const jump = clip.loop ? frac * clip.duration : frac * clip.duration;
  current.time = jump;
  rig.resetSprings();
});

document.getElementById('speed').addEventListener('input', (e) => {
  current.speed = parseFloat(e.target.value);
  document.getElementById('speedval').textContent = `${current.speed.toFixed(2)}×`;
});

document.getElementById('slowmo').onclick = () => {
  const steps = [1, 0.5, 0.25, 0.1, 0.04];
  const i = steps.indexOf(current.speed);
  current.speed = steps[(i + 1) % steps.length];
  document.getElementById('speed').value = String(current.speed);
  document.getElementById('speedval').textContent = `${current.speed.toFixed(2)}×`;
};

document.getElementById('wire').onchange = (e) => {
  eagle.root.traverse((o) => {
    if (o.isMesh && o.material) o.material.wireframe = e.target.checked;
  });
};

document.getElementById('skeleton').onchange = (e) => {
  document.body.classList.toggle('skeleton', e.target.checked);
};

document.getElementById('sun').addEventListener('input', (e) => {
  const a = parseFloat(e.target.value);
  const r = 12;
  const el = (a * Math.PI) / 180;
  viewer.sun.position.set(Math.cos(el) * 0.5 * r, Math.sin(el) * r, 0.6 * r);
  viewer.sun.target.position.set(0, 0.4, 0);
  viewer.sun.target.updateMatrixWorld();
});

/* -------------------------------------------------------------------------- */
/*  Reference data in the panel                                                */
/* -------------------------------------------------------------------------- */

document.getElementById('refdata').innerHTML = `
  <table>
    <tr><th>Wingspan</th><td>${(EAGLE_REFERENCE.wingspan_m * 100).toFixed(1)} cm</td></tr>
    <tr><th>Body mass</th><td>${EAGLE_REFERENCE.bodyMass_kg.toFixed(2)} kg</td></tr>
    <tr><th>Wing chord</th><td>${(EAGLE_REFERENCE.foldedWingChord_m * 100).toFixed(1)} cm</td></tr>
    <tr><th>Wing area (1)</th><td>${(EAGLE_REFERENCE.wingAreaSingle_m2 * 10000).toFixed(0)} cm²</td></tr>
    <tr><th>Wing loading</th><td>${EAGLE_REFERENCE.wingLoading_gcm2} g/cm²</td></tr>
    <tr><th>Tail</th><td>${(EAGLE_REFERENCE.tailLength_m * 100).toFixed(0)} cm</td></tr>
    <tr><th>Flap rate</th><td>${EAGLE_REFERENCE.flapFrequency_hz} Hz</td></tr>
    <tr><th>Primaries</th><td>10 / wing</td></tr>
    <tr><th>Secondaries</th><td>14 / wing</td></tr>
    <tr><th>Rectrices</th><td>12</td></tr>
    <tr><th>Cervicals</th><td>11 nodes</td></tr>
  </table>
`;

selectClip(CLIPS[0]);
requestAnimationFrame(frame);
