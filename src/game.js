// Game flow, scoring, and the catch-the-set skill check.

import { clamp, lerp, smoothstep } from './math.js';
import { makeConditions, crestX, stageAt, zB, faceGeom, heightAt } from './waveshape.js';
import { SurfPhysics, MODE } from './physics.js';

export const GS = {
  VIEW: 'view', PADDLE: 'paddle', RIDE: 'ride', WIPEOUT: 'wipeout',
  SCORECARD: 'scorecard',   // non-modal ride log only — auto-dismisses, never blocks
};

const MANEUVERS = [
  { id: 'snap', label: 'SNAP!', pts: 120 },
  { id: 'cutback', label: 'CUTBACK!', pts: 150 },
  { id: 'reentry', label: 'RE-ENTRY!', pts: 140 },
  { id: 'floater', label: 'FLOATER!', pts: 170 },
];

export class Game {
  constructor() {
    this.state = GS.VIEW;
    this.total = 0;
    this.newWave(false);
    this.rideScore = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.barrelT = 0;
    this.barrelBest = 0;
    this.distance = 0;
    this.lastZ = 0;
    this.lastYaw = 0;
    this.yawWindow = 0;
    this.yawAccum = 0;
    this.stateT = 0;
    this.timeScale = 1;
    this.msg = '';
    this.msgT = 0;
    this.card = null;
    this.catchWindow = 0;
    this.paddleHint = '';
    this.waves = 0;
  }

  newWave(roll = true) {
    if (roll) this.p = makeConditions();
    else this.p = makeConditions(() => 0.5);
    this.waveT = 0;
    this.phys = new SurfPhysics(this.p);
    this.phys.waveT = 0;
    this.waves++;
  }

  // next set swings in with the SAME conditions (studying one wave) — the wave
  // must never just die and leave flat water
  respawnSet() {
    if (this.state === GS.PADDLE || this.state === GS.RIDE || this.state === GS.WIPEOUT) {
      this.endRide('dry');
    }
    this.waveT = 0;
    this.phys = new SurfPhysics(this.p);
    this.phys.waveT = 0;
    this.waves++;
    this.say('NEXT SET SWINGING IN', 1.8);
  }

  say(msg, dur = 1.6) {
    this.msg = msg;
    this.msgT = dur;
  }

  spawnPaddle() {
    const z = this.p.zPeel0 + 36 + Math.random() * 5;
    this.phys.spawnForPaddle(z);
    this.lastZ = z;
    this.state = GS.PADDLE;
    this.stateT = 0;
    this.say('PADDLE FOR IT', 1.4);
  }

  startRide() {
    const hFrac = clamp(1 - this.phys.info.X / Math.max(this.phys.info.Wf, 0.01), 0, 1);
    const quality = clamp(0.35 + hFrac * 0.85, 0.35, 1);
    this.phys.startRide(this.waveT, quality);
    this.state = GS.RIDE;
    this.rideScore = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.barrelT = 0;
    this.barrelBest = 0;
    this.distance = 0;
    this.lastZ = this.phys.z;
    this.lastYaw = this.phys.yaw;
    this.yawAccum = 0;
    if (quality > 0.72) { this.say('LATE DROP!', 1.8); this.rideScore += 300 * this.combo; }
    else this.say('GO!', 1.0);
  }

  endRide(cause) {
    // freeze the board where the ride ended (it just floats on the surface)
    this.phys.mode = MODE.IDLE;
    this.phys.airborne = false;
    // bank the ride: wipeout banks 50%, clean exits 100% + bonuses
    let bonus = 0;
    const labels = [];
    if (cause === 'kickout') { bonus = 150; labels.push(['Clean kickout', 150]); }
    if (cause === 'closeout') { bonus = 400; labels.push(['Covered the closeout', 400]); }
    if (cause === 'dry') { bonus = 100; labels.push(['Wave ran dry', 100]); }
    this.rideScore += bonus;
    const banked = cause === 'wipeout' ? Math.floor(this.rideScore * 0.5) : Math.floor(this.rideScore);
    if (cause === 'wipeout') labels.push(['Wipeout penalty', '-50%']);
    if (this.barrelBest > 0.8) labels.push([`Barrel ride ${this.barrelBest.toFixed(1)}s`, Math.floor(this.barrelBest * 100)]);
    this.total += banked;
    this.card = {
      cause, banked, raw: Math.floor(this.rideScore),
      distance: Math.floor(this.distance),
      barrelBest: this.barrelBest,
      labels,
      total: this.total,
    };
    this.say(`${{ kickout: 'KICKED OUT', closeout: 'CLOSEOUT COVERED', dry: 'WAVE RAN DRY', wipeout: 'WIPED OUT' }[cause] || 'RIDE OVER'} · +${banked} pts`, 2.4);
    this.state = GS.SCORECARD;
    this.stateT = 0;
  }

  update(dt, sdt, input, physEvents) {
    this.stateT += dt;
    if (this.msgT > 0) this.msgT -= dt;

    // ENDLESS SETS: when the peel is about to run off the end, the same wave
    // swings in again — the wave never disappears and the game never ends
    if (zB(this.waveT, this.p) > this.p.zLineEnd + 25) this.respawnSet();

    if (this.state === GS.VIEW) {
      this.waveT += sdt;
      this.phys.waveT = this.waveT;
      return;
    }

    if (this.state === GS.PADDLE) {
      this.waveT += sdt;
      // catch window: the crest is reaching us on the flats
      const g = faceGeom(this.phys.z, this.waveT, this.p);
      const hFrac = clamp(1 - this.phys.info.X / Math.max(this.phys.info.Wf, 0.01), 0, 1);
      const b = stageAt(this.phys.z, this.waveT, this.p);
      const near = this.phys.info.X < g.Wf * 1.15 && this.phys.info.X > g.Wf * 0.05 && b < 0.35;
      if (near) {
        this.paddleHint = hFrac > 0.5 ? 'HOLDING — TOO LATE!' : input.pump ? 'HOLDING…' : 'PRESS SPACE TO CATCH';
        // pop up when the face has lifted us a bit (hFrac > 0.2), or when we
        // waited almost too long (auto late-drop)
        if ((input.pump && hFrac > 0.2) || hFrac > 0.55) {
          this.startRide();
          return;
        }
      } else {
        this.paddleHint = this.phys.info.X >= g.Wf * 1.15 ? 'HOLD SPACE TO PADDLE' : '';
      }
      // missed the section entirely
      if (b > 0.5 && this.phys.mode === MODE.PADDLE) {
        for (const ev of physEvents) {
          if (ev.type === 'caught_inside') {
            this.say('CAUGHT INSIDE!', 2);
            this.endRide('wipeout');
            return;
          }
        }
      }
      if (this.waveT > 30) { this.endRide('dry'); }
      return;
    }

    if (this.state === GS.RIDE) {
      this.waveT += sdt;
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 1) this.combo = 1;

      // distance & flow score
      const dz = this.phys.z - this.lastZ;
      this.lastZ = this.phys.z;
      this.distance += Math.max(0, dz);
      this.rideScore += Math.max(0, dz) * 2.2 * this.combo;

      // maneuver detection from yaw history
      const dy = normalizeAngle(this.phys.yaw - this.lastYaw);
      this.lastYaw = this.phys.yaw;
      this.yawAccum = this.yawAccum * 0.92 + dy;
      this.yawWindow += dt;
      if (this.yawWindow > 0.55) {
        const turn = Math.abs(this.yawAccum);
        if (turn > 1.15 && this.phys.speed > 4.5) {
          const m = this.yawAccum > 0
            ? (this.phys.info.hFrac > 0.55 ? MANEUVERS[0] : MANEUVERS[1])
            : MANEUVERS[2];
          const pts = Math.floor(m.pts * this.combo * (0.7 + this.phys.speed / 14));
          this.rideScore += pts;
          this.combo = Math.min(5, this.combo + 1);
          this.comboTimer = 3.2;
          this.say(`${m.label} +${pts}`, 1.1);
          this.yawWindow = 0; this.yawAccum = 0;
        } else if (turn > 0.5 && this.phys.speed > 6) {
          this.rideScore += 15 * this.combo;
        }
        if (this.yawWindow > 0.8) { this.yawWindow = 0; this.yawAccum = 0; }
      }

      // physics-driven events
      let inTube = false;
      for (const ev of physEvents) {
        if (ev.type === 'in_tube') {
          inTube = true;
          const b = stageAt(this.phys.z, this.waveT, this.p);
          if (input.tuck) {
            this.barrelT += dt;
            this.barrelBest = Math.max(this.barrelBest, this.barrelT);
            this.rideScore += 55 * dt * this.combo;
            if (this.barrelT > 1.2 && this.barrelT - dt <= 1.2) {
              this.combo = Math.min(5, this.combo + 1);
              this.comboTimer = 4;
              this.say('IN THE BARREL!', 1.4);
            }
          } else if (b > 0.85 && b < 1.25 && ev.depth > 0.55) {
            // the lip is coming down and you are not tucked
            this.phys.mode = MODE.WIPEOUT;
            physEvents.push({ type: 'wipeout', cause: 'lip' });
          }
        } else if (ev.type === 'air_start') {
          this.say('AIR!', 0.9);
        } else if (ev.type === 'landed') {
          if (ev.impact < 3.6) {
            const pts = Math.floor(260 * this.combo);
            this.rideScore += pts;
            this.combo = Math.min(5, this.combo + 1);
            this.comboTimer = 3.5;
            this.say(`CLEAN AIR! +${pts}`, 1.4);
          }
        } else if (ev.type === 'pump') {
          this.rideScore += 2;
        } else if (ev.type === 'wipeout') {
          this.say(ev.cause === 'falls' ? 'OVER THE FALLS!' : ev.cause === 'lip' ? 'LIP BLEW UP!' : 'WASHED!', 2.2);
          this.state = GS.WIPEOUT;
          this.stateT = 0;
          this.wipeoutCause = ev.cause;
          return;
        }
      }
      if (!inTube) this.barrelT = 0;

      // ride ends
      const cx = crestX(this.phys.z, this.waveT, this.p);
      if (cx > this.p.xClose) {
        this.say('CLOSEOUT!!', 2);
        this.endRide('closeout');
        return;
      }
      if (this.phys.z > this.p.zLineEnd - 8) {
        this.say('THE WAVE RAN DRY', 2);
        this.endRide('dry');
        return;
      }
      if (input.kickout) {
        this.say('KICKED OUT', 1.4);
        this.endRide('kickout');
      }
      return;
    }

    if (this.state === GS.WIPEOUT) {
      this.waveT += sdt;
      if (this.stateT > 1.2) this.endRide('wipeout');
      return;
    }

    if (this.state === GS.SCORECARD) {
      this.waveT += sdt;
      if (input.start) { this.spawnPaddle(); return; }   // no menu, no waiting
      if (this.stateT > 2.5) this.state = GS.VIEW;
      return;
    }
  }
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
