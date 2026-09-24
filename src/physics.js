// Surfboard dynamics on the moving wave heightfield.
//
// The wave translates shoreward at c; the board slides on its face. Holding a
// line just ahead of the peel (the pocket) is the whole game: slide too slow
// and the crest climbs over you ("over the falls"), drop too low and the foam
// ball eats you. Down-the-line speed comes from the face's along-shore slope
// near the peel — exactly like a real peeling wave.

import { clamp, lerp, smoothstep, damp } from './math.js';
import { heightAt, surfaceSlope, crestX, stageAt, zB, faceGeom } from './waveshape.js';

const G = 9.81;

export const MODE = {
  IDLE: 'idle', PADDLE: 'paddle', RIDE: 'ride', AIR: 'air', WIPEOUT: 'wipeout', KICKOUT: 'kickout',
};

export class SurfPhysics {
  constructor(p) {
    this.p = p;
    this.x = 0; this.z = 0; this.y = 0;
    this.yaw = Math.PI / 2;      // heading: 0 = +X (shore), PI/2 = +Z (down the line)
    this.speed = 0;
    this.pitch = 0; this.roll = 0;
    this.mode = MODE.IDLE;
    this.airborne = false;
    this.vx = 0; this.vy = 0; this.vz = 0;     // world velocity while airborne
    this.pumpCooldown = 0;
    this.slope = [0, 0];
    this.info = { b: 0, Hf: 1, Wf: 1, foam: 0, pitch: 0, X: 0, hFrac: 0 };
    this.events = [];
    this.bob = 0;
  }

  spawnForPaddle(z) {
    // out the back on the flats, waiting for the set, facing shore-ish/along
    const t = this.waveT || 0;
    const cx = crestX(z, t, this.p);
    this.x = cx + 14 + Math.random() * 4;
    this.z = z;
    this.yaw = Math.PI * 0.5;    // looking along the line, glancing at the sea
    this.speed = 0.8;
    this.mode = MODE.PADDLE;
    this.airborne = false;
    this.y = heightAt(this.x, this.z, t, this.p);
    this.events.push({ type: 'spawned' });
  }

  startRide(t, dropQuality) {
    // caught! pop up where the wave lifted us — the drop quality (how high on
    // the face we got in) sets speed & angle down the line. Heading is biased
    // DOWN-FACE so the first move of the ride is sliding along with the crest.
    this.yaw = Math.PI * 0.5 - 0.38 + dropQuality * 0.15;
    this.speed = 4.5 + dropQuality * 5.0;
    this.mode = MODE.RIDE;
    this.airborne = false;
    this.pitch = 0; this.roll = 0;
    this.events.push({ type: 'drop', quality: dropQuality });
  }

  update(dt, input, t) {
    this.waveT = t;
    this.events.length = 0;
    const p = this.p;
    if (this.mode === MODE.IDLE || this.mode === MODE.WIPEOUT || this.mode === MODE.KICKOUT) {
      this.y = heightAt(this.x, this.z, t, p, this.info);
      return this.events;
    }

    if (this.mode === MODE.PADDLE) {
      // paddling trim: slow, can slide slightly toward the wave
      const pad = input.pump ? 1.6 : 0.4;
      this.speed = damp(this.speed, pad, 2.5, dt);
      this.yaw += input.steer * 1.2 * dt;
      this.x += Math.cos(this.yaw) * this.speed * dt;
      this.z += Math.sin(this.yaw) * this.speed * dt;
      this.y = heightAt(this.x, this.z, t, p, this.info);
      this.info.hFrac = clamp(1 - this.info.X / Math.max(this.info.Wf, 0.01), 0, 1);
      // "caught inside" if the crest is already past us while paddling
      const b = stageAt(this.z, t, p);
      if (this.info.X < this.info.Wf * 0.4 && b > 0.55) {
        this.events.push({ type: 'caught_inside' });
        this.mode = MODE.WIPEOUT;
      }
      return this.events;
    }

    if (this.airborne) {
      // ballistic until we meet the surface again
      this.vy -= G * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      const h = heightAt(this.x, this.z, t, p, this.info);
      this.info.hFrac = clamp(this.info.X / Math.max(this.info.Wf, 0.01), 0, 1);
      if (this.y <= h + 0.02 && this.vy < 0) {
        this.y = h;
        this.airborne = false;
        const impact = -this.vy;
        const sp = Math.hypot(this.vx, this.vz);
        this.speed = sp * 0.8;
        this.yaw = Math.atan2(this.vz, this.vx);
        if (impact > 6.2 || this.info.foam > 0.5) {
          this.mode = MODE.WIPEOUT;
          this.events.push({ type: 'wipeout', cause: 'landing' });
        } else {
          this.events.push({ type: 'landed', impact });
          this.mode = MODE.RIDE;
        }
      }
      return this.events;
    }

    // ---------- RIDE: car-like dynamics on the heightfield ----------
    surfaceSlope(this.x, this.z, t, p, this.slope);
    heightAt(this.x, this.z, t, p, this.info);
    const hx = Math.cos(this.yaw), hz = Math.sin(this.yaw);
    const slopeAlong = this.slope[0] * hx + this.slope[1] * hz;
    const gradN = Math.sqrt(1 + this.slope[0] ** 2 + this.slope[1] ** 2);

    //  The surface MOVES (the wave translates & morphs). Where it rises under
    //  the board it shoves it along the slope — the "wave push" every surfer
    //  feels. Yt = partial dY/dt at the contact point.
    const Yt = clamp(
      (heightAt(this.x, this.z, t + 0.03, p) - heightAt(this.x, this.z, t - 0.03, p)) / 0.06,
      -3, 5
    );

    // gravity along the slope (negative slopeAlong = heading downhill = +X mostly)
    let a = -G * slopeAlong / gradN;
    // the rising face shoves you down the hill / along the line
    a += 0.4 * Yt * Math.max(0, -slopeAlong) / gradN;
    // drag (relative to the water rushing with the wave)
    a -= 0.030 * this.speed * Math.abs(this.speed);
    // pump
    this.pumpCooldown = Math.max(0, this.pumpCooldown - dt);
    if (input.pump && this.pumpCooldown <= 0) {
      const downhillBonus = slopeAlong < 0 ? 1.5 : 0.7;
      a += 4.2 * downhillBonus;
      this.pumpCooldown = 0.32;
      this.events.push({ type: 'pump' });
    }
    // stall / air brake
    if (input.stall) a -= 5.5;

    // pocket tow: the peeling crest feeds a little energy near the curl
    const zb = zB(t, p);
    const dPocket = (this.z - zb - 2.5) / 16;
    const pocket = Math.exp(-(dPocket * dPocket)) * smoothstep(-0.2, 0.3, this.info.b + 0.2);
    a += 1.8 * pocket * Math.max(0, hz);   // only helps down-the-line progress

    this.speed = clamp(this.speed + a * dt, -1.5, 16);

    // steering — carve radius shrinks with speed (rails bite)
    const steerRate = (1.2 + 1.4 * clamp(this.speed / 8, 0, 1)) * (this.speed > 0.3 ? 1 : 0.35);
    this.yaw += input.steer * steerRate * dt;
    // hard carves scrub a touch of speed
    this.speed *= 1 - Math.min(0.4, Math.abs(input.steer) * 0.18 * dt * 6);

    this.x += hx * this.speed * dt;
    this.z += hz * this.speed * dt;

    // visual attitude from slope + lean
    const targetPitch = clamp(Math.atan2(this.slope[0] * hx + this.slope[1] * hz, 1) * 0.8, -0.6, 0.6);
    this.pitch = damp(this.pitch, targetPitch, 10, dt);
    this.roll = damp(this.roll, -input.steer * clamp(this.speed / 7, 0, 1) * 0.55, 8, dt);
    this.y = heightAt(this.x, this.z, t, p, this.info) + 0.05;

    // face height fraction: 0 = bottom of the face, 1 = at the crest spine
    const hFrac = this.info.X <= 0 ? 1 : clamp(1 - this.info.X / Math.max(this.info.Wf, 0.01), 0, 1);
    this.info.hFrac = hFrac;
    const b = this.info.b;

    // ---- launch: flying off the top of a ramping section ----
    if (hFrac > 0.9 && slopeAlong < -0.6 && this.speed > 6.5 && b < 0.5 && input.launch) {
      this.airborne = true;
      this.mode = MODE.AIR;
      const up = 3.2 + this.speed * 0.25;
      this.vx = hx * this.speed * 0.95;
      this.vz = hz * this.speed * 0.95;
      this.vy = up;
      this.events.push({ type: 'air_start', speed: this.speed });
      return this.events;
    }

    // ---- wipeout: over the falls (too high while the lip is throwing) ----
    if ((hFrac > 0.88 && b > 0.45 && b < 1.35) || (this.info.X < -0.05 && b < 1.0)) {
      this.mode = MODE.WIPEOUT;
      this.events.push({ type: 'wipeout', cause: 'falls' });
      return this.events;
    }
    // ---- wipeout: engulfed by the foam ball (the SOUP, well behind the peel)
    // the pitch/barrel zone lives at b in (0..1) — only the collapsed soup
    // (b > 1.45) or wash climbing over a low board ends the ride
    if (b > 1.45 || (this.info.foam > 0.5 && b > 1.1 && hFrac < 0.8)) {
      this.mode = MODE.WIPEOUT;
      this.events.push({ type: 'wipeout', cause: 'foam' });
      return this.events;
    }
    // ---- lip landing on a rider who is high & not tucked: handled by game
    // (needs the tuck input) — report proximity for scoring
    if (hFrac > 0.5 && b > 0.3 && b < 1.15) {
      this.events.push({ type: 'in_tube', depth: hFrac });
    }
    return this.events;
  }
}
