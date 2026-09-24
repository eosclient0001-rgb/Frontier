// SET LINE — main loop, rendering, HUD.
// The free camera is the ONLY camera. No menus, no game-over: sets roll forever.
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
// neutral input fed to the sim while spectating (no board on a wave)
const BLANK = { steer: 0, pump: false, stall: false, tuck: false, launch: false, kickout: false, start: false, down: () => false, justPressed: () => false };

// ---- boot straight into the wave viewer ----
const TIME_SPEEDS = [1, 0.3, 0];   // T cycles: real time / slow-mo / frozen
let timeIdx = 0;

function defaultVantage() {
  const p = game.p;
  cameras.pos[0] = p.xC0 + 52;
  cameras.pos[1] = p.H + 4;
  cameras.pos[2] = p.zPeel0 + 18;
  cameras.look[0] = p.xC0 + 4;
  cameras.look[1] = p.H * 0.5;
  cameras.look[2] = p.zPeel0 + 30;
  cameras.enterFree();
}
defaultVantage();
cameras.fly.attach(canvas);   // <- wire look/zoom input to the canvas (was missing!)

let zRef = 0;
let tumble = 0;

// ---- HUD ----
const el = (id) => document.getElementById(id);
const hud = {
  score: el('score'), combo: el('combo'), barrel: el('barrel'),
  speed: el('speed'), dist: el('dist'), center: el('center-msg'),
  hints: el('hints'), cond: el('conditions'),
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
  const riding = game.state === GS.PADDLE || game.state === GS.RIDE || game.state === GS.WIPEOUT;
  hud.score.textContent = fmt(game.state === GS.RIDE || game.state === GS.WIPEOUT ? game.rideScore : game.total);
  hud.combo.textContent = game.combo > 1 ? `combo x${game.combo}` : '';
  hud.barrel.textContent = game.barrelT > 0.05 ? `BARREL ${game.barrelT.toFixed(1)}s` : '';
  hud.speed.textContent = riding ? `${(Math.abs(game.phys.speed) * 3.6).toFixed(0)} km/h` : '';
  hud.dist.textContent = game.state === GS.RIDE ? `${game.distance.toFixed(0)} m ridden` : '';
  hud.center.textContent = game.msgT > 0 ? game.msg : '';
  hud.center.style.opacity = game.msgT > 0 ? clamp(game.msgT * 2, 0, 1) : 0;

  // one always-visible, never-blocking hint line
  const surf = game.state === GS.PADDLE
    ? (game.paddleHint || 'HOLD SPACE TO PADDLE') + ' · '
    : game.state === GS.RIDE
      ? 'A/D carve · SPACE pump · S stall · SHIFT tuck · K kick out · '
      : '';
  const fly = riding
    ? 'drag to look'
    : `drag to look · WASD fly · Q/E up/down · SHIFT fast · wheel ×${cameras.fly.speedMul.toFixed(2)}`;
  const tLabel = game.timeScale === 0 ? 'FROZEN' : `×${game.timeScale}`;
  hud.hints.textContent = `${surf}${fly} · T wave-time ${tLabel} · SPACE surf · F reset view · R new set`;

  const p = game.p;
  hud.cond.textContent =
    `wave ${p.H.toFixed(1)} m · peel ${p.vPeel.toFixed(1)} m/s · ${p.wind < -0.5 ? 'offshore' : 'light onshore'} · set #${game.waves}`;
}

// ---- frame ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.timeScale = TIME_SPEEDS[timeIdx];
  const sdt = dt * game.timeScale;

  input.poll();
  const riding = game.state === GS.PADDLE || game.state === GS.RIDE || game.state === GS.WIPEOUT;

  // global keys — the camera is never taken away from you
  if (input.justPressed('KeyT')) timeIdx = (timeIdx + 1) % TIME_SPEEDS.length;
  if (input.justPressed('KeyF')) defaultVantage();
  if (!riding && input.justPressed('KeyR')) game.newWave(true);
  if (!riding && input.justPressed('Space')) game.spawnPaddle();

  // while riding, WASD belongs to surfing and the free cam softly follows;
  // drag-to-look always works. Off the board: full free flight.
  const sim = riding ? input : BLANK;
  const events = game.phys.update(sdt, sim, game.waveT);
  game.update(dt, sdt, sim, events);

  cameras.setSun(game.p);
  const ph = game.phys;
  if (game.state === GS.WIPEOUT) tumble += dt * 9;
  else tumble = damp(tumble, 0, 6, dt);

  if (riding) {
    // soft-follow: same free camera, anchored near the rider
    const hx = Math.cos(ph.yaw), hz = Math.sin(ph.yaw);
    const lam = 2.4;
    cameras.fly.pos[0] = damp(cameras.fly.pos[0], ph.x - hx * 9, lam, dt);
    cameras.fly.pos[1] = damp(cameras.fly.pos[1], ph.y + 4.2, lam, dt);
    cameras.fly.pos[2] = damp(cameras.fly.pos[2], ph.z - hz * 9, lam, dt);
    cameras.fly.vel[0] = cameras.fly.vel[1] = cameras.fly.vel[2] = 0;
  }
  cameras.update(dt, game.waveT, ph, game.p, input, !riding);

  // spray clock + density target
  const zTarget = (game.state === GS.VIEW || game.state === GS.SCORECARD)
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

  const showRider = riding || game.state === GS.SCORECARD;
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
