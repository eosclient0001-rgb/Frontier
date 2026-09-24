// SET LINE — main loop, rendering, HUD.
import { createGL } from './gl.js';
import { Cameras, setAspect } from './camera.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Beach } from './beach.js';
import { Surfer } from './surfer.js';
import { Spray } from './spray.js';
import { Input } from './input.js';
import { Game, GS } from './game.js';
import { clamp, damp, lerp } from './math.js';
import { zB, crestX, stageAt } from './waveshape.js';

const canvas = document.getElementById('view');
const gl = createGL(canvas);

const cameras = new Cameras();
const sky = new Sky(gl);
const game = new Game();
const water = new Water(gl);
const beach = new Beach(gl, game.p);
const surfer = new Surfer(gl);
const spray = new Spray(gl);
const input = new Input();
// neutral input fed to the sim while flying the free camera (spectator mode)
const BLANK = { steer: 0, pump: false, stall: false, tuck: false, launch: false, kickout: false, start: false, down: () => false, justPressed: () => false };

let zRef = 0;
let tumble = 0;

// ---- HUD ----
const el = (id) => document.getElementById(id);
const hud = {
  score: el('score'), combo: el('combo'), barrel: el('barrel'),
  speed: el('speed'), dist: el('dist'), center: el('center-msg'),
  hints: el('hints'), cond: el('conditions'),
  title: el('title'), card: el('scorecard'), cardTitle: el('card-title'), cardLines: el('card-lines'),
};

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.75);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  setAspect(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();

function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

function updateHUD() {
  hud.score.textContent = fmt(game.state === GS.RIDE || game.state === GS.WIPEOUT ? game.rideScore : game.total);
  hud.combo.textContent = game.combo > 1 ? `combo x${game.combo}` : '';
  hud.barrel.textContent = game.barrelT > 0.05 ? `BARREL ${game.barrelT.toFixed(1)}s` : '';
  const kmh = Math.abs(game.phys.speed) * 3.6;
  hud.speed.textContent = `${kmh.toFixed(0)} km/h`;
  hud.dist.textContent = game.state === GS.RIDE ? `${game.distance.toFixed(0)} m ridden` : '';
  hud.center.textContent = game.msgT > 0 ? game.msg : '';
  hud.center.style.opacity = game.msgT > 0 ? clamp(game.msgT * 2, 0, 1) : 0;

  if (game.state === GS.TITLE) {
    hud.title.classList.remove('hidden');
    hud.card.classList.add('hidden');
    hud.hints.textContent = '';
  } else if (game.state === GS.SCORECARD) {
    hud.title.classList.add('hidden');
    hud.card.classList.remove('hidden');
    if (game.card) {
      const c = game.card;
      const causeTxt = {
        wipeout: 'WIPED OUT', kickout: 'KICKED OUT', closeout: 'CLOSEOUT COVERED', dry: 'WAVE RAN DRY',
      }[c.cause] || 'RIDE COMPLETE';
      hud.cardTitle.textContent = causeTxt;
      hud.cardLines.innerHTML = c.labels.map(([k, v]) =>
        `<div class="row"><span>${k}</span><span>${typeof v === 'number' ? fmt(v) : v}</span></div>`).join('') +
        `<div class="row"><span>Distance</span><span>${c.distance} m</span></div>` +
        (c.barrelBest > 0.05 ? `<div class="row"><span>Best barrel</span><span>${c.barrelBest.toFixed(1)} s</span></div>` : '') +
        `<div class="row big"><span>SCORE</span><span>${fmt(c.banked)}</span></div>` +
        `<div class="row"><span>Session total</span><span>${fmt(c.total)}</span></div>`;
    }
    hud.hints.textContent = '';
  } else {
    hud.title.classList.add('hidden');
    hud.card.classList.add('hidden');
    if (game.state === GS.PADDLE) hud.hints.textContent = game.paddleHint || 'HOLD SPACE TO PADDLE';
    else if (game.state === GS.RIDE) hud.hints.textContent = 'A/D carve · SPACE pump · S stall · SHIFT tuck · K kick out · C camera · F free-cam';
    else hud.hints.textContent = '';
  }
  if (cameras.mode === 'free') {
    hud.title.classList.add('hidden');
    hud.hints.textContent = `FREE CAM · hold RMB (or LMB) & drag to look · WASD fly · Q/E down/up · SHIFT fast · wheel speed ×${cameras.fly.speedMul.toFixed(2)} · F to exit`;
  }
  const p = game.p;
  hud.cond.textContent =
    `wave ${p.H.toFixed(1)} m · peel ${p.vPeel.toFixed(1)} m/s · ${p.wind < -0.5 ? 'offshore' : 'light onshore'} · ${game.waves} waves`;
}

// ---- frame ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sdt = dt * game.timeScale;

  input.poll();

  // global keys
  if (input.justPressed('KeyF')) cameras.toggleFree();
  const flying = cameras.mode === 'free';
  if (!flying && input.justPressed('KeyC')) cameras.cycle();
  if (input.justPressed('KeyR')) {
    game.newWave(true);
    game.spawnPaddle();
    if (!flying) cameras.mode = 'chase';
  }

  if (game.state === GS.TITLE && input.justPressed('Space')) {
    game.spawnPaddle();
    if (!flying) cameras.mode = 'chase';
  }

  // physics (surf controls are neutralized while free-flying)
  const sim = flying ? BLANK : input;
  const events = game.phys.update(sdt, sim, game.waveT);
  game.update(dt, sdt, sim, events);

  // camera target
  if (!flying) cameras.mode = (game.state === GS.TITLE) ? 'attract' : (cameras.mode === 'attract' ? 'chase' : cameras.mode);
  cameras.setSun(game.p);
  const ph = game.phys;
  // tumble the board on wipeout
  if (game.state === GS.WIPEOUT) tumble += sdt * 9;
  else tumble = damp(tumble, 0, 6, dt);
  cameras.update(flying ? dt : sdt, game.waveT, ph, game.p, input);

  // spray clock + density target
  const zTarget = game.state === GS.TITLE || game.state === GS.SCORECARD
    ? zB(game.waveT, game.p) + 10
    : ph.z + 5;
  zRef = damp(zRef, zTarget, 2.2, dt);
  spray.update(sdt, game.waveT, game.p, ph.mode === 'ride' || ph.mode === 'air' ? ph : null);

  // ---- render ----
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.35, 0.5, 0.65, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  sky.draw(cameras);
  beach.draw(cameras, game.p);
  water.draw(cameras, { time: game.waveT, zRef, p: game.p });

  const showRider = game.state === GS.PADDLE || game.state === GS.RIDE ||
    game.state === GS.WIPEOUT || game.state === GS.SCORECARD;
  if (showRider) {
    const world = {
      pos: [ph.x, ph.y + 0.02, ph.z],
      yaw: ph.yaw,
      pitch: ph.pitch,
      roll: ph.roll + tumble,
    };
    const pose = {
      lean: clamp(ph.roll * 1.3, -0.8, 0.8),
      crouch: clamp(ph.speed / 11, 0, 1) * 0.8 + (sim.stall ? 0.4 : 0),
      tuck: sim.tuck && game.state === GS.RIDE ? 1 : 0,
      armL: clamp(sim.steer * 0.6 + (ph.airborne ? 0.8 : 0), -0.6, 1.2),
      armR: clamp(-sim.steer * 0.6 + (ph.airborne ? 0.8 : 0), -0.6, 1.2),
      airborne: ph.airborne,
      tumble: game.state === GS.WIPEOUT,
    };
    surfer.draw(cameras, world, pose);
  }
  spray.draw(cameras);

  updateHUD();
  input.endFrame();
}
requestAnimationFrame(frame);
