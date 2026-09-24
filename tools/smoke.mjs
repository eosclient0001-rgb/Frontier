// Headless smoke test: simulate bot rides through the full game/physics loop.
// Verifies: no crashes, plausible ride durations/scores, wipeouts & catches fire.
import { Game, GS } from '../src/game.js';
import { SurfPhysics, MODE } from '../src/physics.js';
import { heightAt, stageAt, crestX, zB, faceGeom } from '../src/waveshape.js';

function runBot(seed, label) {
  // deterministic-ish rng
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const game = new Game();
  game.p = (() => {
    const p = game.p;
    return p;
  })();

  const fakeInput = {
    steer: 0, pump: false, stall: false, tuck: false, launch: false, kickout: false, start: false,
    justPressed: () => false, down: () => false,
  };

  const dt = 1 / 60;
  let t = 0;
  const log = [];
  game.spawnPaddle();
  log.push(`spawn: x=${game.phys.x.toFixed(1)} z=${game.phys.z.toFixed(1)} mode=${game.phys.mode}`);

  let caught = false, ended = false;
  while (t < 45) {
    t += dt;
    // --- bot brain ---
    if (game.state === GS.PADDLE) {
      fakeInput.pump = true;
    } else if (game.state === GS.RIDE) {
      // trim bot: hold hFrac ~0.45 (low -> climb up-face, high -> drop)
      const hF = game.phys.info.hFrac;
      const targetYaw = 1.05 - (hF - 0.52) * 1.3;
      let dy = targetYaw - game.phys.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      fakeInput.steer = Math.max(-1, Math.min(1, dy * 2));
      fakeInput.pump = Math.abs(dy) < 0.3 && game.phys.speed < 9;
      fakeInput.tuck = game.phys.info.b > 0.25 && game.phys.info.b < 1.15 && hF > 0.45;
      if (rnd() < 0.0015) fakeInput.kickout = true;
      else fakeInput.kickout = false;
    }
    const events = game.phys.update(dt, fakeInput, game.waveT);
    const before = game.state;
    game.update(dt, dt, fakeInput, events);
    if (before === GS.PADDLE && game.state === GS.RIDE) {
      caught = true;
      log.push(`caught at t=${t.toFixed(1)}s hFrac=${game.phys.info.hFrac.toFixed(2)} speed=${game.phys.speed.toFixed(1)}`);
    }
    if (game.state === GS.SCORECARD || game.state === GS.WIPEOUT) {
      if (game.state === GS.SCORECARD) {
        log.push(`ended t=${t.toFixed(1)} cause=${game.card.cause} score=${game.card.banked} dist=${game.card.distance}m barrel=${game.card.barrelBest.toFixed(1)}s`);
        ended = true;
        break;
      }
    }
  }
  if (!caught) log.push('NEVER CAUGHT THE WAVE');
  if (!ended) log.push(`timeout: state=${game.state} mode=${game.phys.mode} x=${game.phys.x.toFixed(1)} z=${game.phys.z.toFixed(1)} speed=${game.phys.speed.toFixed(1)}`);
  console.log(`--- ${label} ---`);
  for (const l of log) console.log('  ' + l);
  return { caught, ended };
}

let ok = 0;
for (let i = 1; i <= 6; i++) {
  const r = runBot(i * 17 + 3, `bot #${i}`);
  if (r.ended) ok++;
}
console.log(`\n${ok}/6 bot rides reached a scorecard`);

// sanity: heightfield continuity (no NaN / big jumps along a sweep)
import * as W from '../src/waveshape.js';
const p = W.makeConditions(() => 0.5);
let bad = 0, prev = heightAt(-20, 30, 8, p);
for (let x = -20; x < 30; x += 0.25) {
  const h = heightAt(x, 30, 8, p);
  if (!isFinite(h)) bad++;
  if (Math.abs(h - prev) > 1.2) bad++;
  prev = h;
}
console.log(`heightfield sweep: ${bad === 0 ? 'OK' : bad + ' SUSPECT SAMPLES'}`);
process.exit(bad === 0 && ok > 0 ? 0 : 1);
