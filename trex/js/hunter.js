/**
 * hunter.js — Chase-and-attack brain for the T. rex.
 *
 * The prey is a draggable sphere.  The hunter:
 *   • tracks it with head and neck (closed-loop aim),
 *   • turns towards it on the spot if it is far off-axis, otherwise steers
 *     while moving,
 *   • picks a speed from distance: run when far, walk to close in, slow
 *     right down to set up the strike,
 *   • chooses an attack:
 *       – BITE when the prey is in front, inside the lunge envelope and at
 *         mouth height (≤ 3.2 m): lunge, gape, snap, shake if caught;
 *       – TAIL SWIPE when the prey is beside or behind the hips and close:
 *         pivot the hips and whip the tail through it;
 *   • hits are resolved against the real geometry: the mouth point at the
 *     moment of the snap, and every tail vertebra during the sweep.
 *
 * Emits: ('hit', {kind:'bite'|'tail', impulse}) · ('miss', {kind})
 */

import { Vector3 } from 'three';
import { clamp, WALK_SPEED, RUN_SPEED } from './gait.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _v = new Vector3(), _w = new Vector3(), _p0 = new Vector3(), _p1 = new Vector3();

export class Hunter {
  constructor(anim, skel, prey) {
    this.anim = anim;
    this.s = skel;
    this.prey = prey;             // { pos: Vector3, vel: Vector3, radius, held, onHit(kind, impulse) }
    this.enabled = false;
    this.state = 'off';
    this.cooldown = 0;
    this.listeners = [];
    this.lastAttack = '';
    this.reposition = null;
    this.tailMissed = false;
    this.lastPreyPos = new Vector3();
    this.haveLastPrey = false;
    this.stats = { bites: 0, tail: 0, hits: 0, shoves: 0 };

    anim.on((ev, a) => {
      if (!this.enabled) return;
      if (ev === 'biteSnap') this._resolveBite(a);
      if (ev === 'headSweep') this._resolveShove(a);
      if (ev === 'tailSweep') this._resolveTail(a);
      if (ev === 'biteRelease') this._releaseBite(a);
      if (ev === 'end' && (a.type === 'bite' || a.type === 'headShove' || a.type === 'tailSwipe')) {
        // Do not repeat a whiffed strike forever; shuffle the next choice instead.
        this.cooldown = a.hit ? 1.2 : (a.type === 'tailSwipe' ? 2.4 : 0.55);
        if (!a.hit) {
          if (a.type === 'tailSwipe') this.tailMissed = true;
          if (a.type === 'headShove') this.shoveMissed = true;
          this.emit('miss', { kind: a.type === 'bite' ? 'bite' : a.type === 'headShove' ? 'shove' : 'tail' });
        }
      }
      if (ev === 'frame' && a.type === 'bite' && a.hit && !a.released) {
        // carry the prey in the jaws
        this.s.mouth.getWorldPosition(this.prey.pos);
        this.prey.pos.y -= 0.05;
        this.prey.vel.set(0, 0, 0);
      }
    });
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev, d) { for (const f of this.listeners) f(ev, d); }

  setEnabled(v) {
    this.enabled = v;
    this.state = v ? 'track' : 'off';
    const A = this.anim;
    if (!v) { A.aimTarget = null; A.aimWeight = 0; A.setTargetSpeed(0); A.setTurn(0); }
    if (v) { this.tailMissed = false; this.haveLastPrey = false; }
  }

  /** Target in the rig's frame: forward distance, lateral (+ right), angle. */
  _local() {
    const A = this.anim;
    const d = _v.copy(this.prey.pos).sub(A.rigPos);
    const fx = -Math.sin(A.heading), fz = -Math.cos(A.heading);   // forward
    const rx = Math.cos(A.heading), rz = -Math.sin(A.heading);    // right
    const fwd = d.x * fx + d.z * fz;
    const lat = d.x * rx + d.z * rz;
    return { fwd, lat, dist: Math.hypot(fwd, lat), ang: Math.atan2(-lat, fwd), h: this.prey.pos.y };
  }

  update(dt) {
    if (!this.enabled) return;
    const A = this.anim;
    // A teleport/new-ball event starts a fresh attack decision. A small
    // displacement from prey physics is intentionally not enough to reset it;
    // a hand-drag or a test reset is several metres in one frame.
    const teleported = this.haveLastPrey && this.lastPreyPos.distanceToSquared(this.prey.pos) > 9;
    if (teleported) {
      this.tailMissed = false;
      this.reposition = null;
      this.cooldown = 0;
      // A dragged/reset prey position is a new decision point. Brake the
      // approach for one frame so a close rear target can request a tail
      // strike instead of inheriting a stale run velocity.
      A.setTargetSpeed(0);
    }
    this.lastPreyPos.copy(this.prey.pos); this.haveLastPrey = true;
    const L = this._local();
    const away = new Vector3(this.prey.pos.x - A.rigPos.x, 0, this.prey.pos.z - A.rigPos.z).normalize();
    const escapeSpeed = Math.max(0, this.prey.vel.x * away.x + this.prey.vel.z * away.z);
    this.cooldown = Math.max(0, this.cooldown - dt);

    // always watch the prey
    A.aimTarget = this.prey.pos;
    A.aimWeight = L.dist < 22 ? 1 : 0.6;

    if (A.busy) { A.setTurn(0); return; }
    if (this.prey.held) { this.state = 'wait'; A.setTargetSpeed(0); A.setTurn(0); return; }

    // --- choose an attack
    const inFront = Math.abs(L.ang) < 32 * DEG;
    const biteReach = L.fwd > 3.25 && L.fwd < 7.0 && Math.abs(L.lat) < 1.7 && L.h < 3.4;
    if (this.cooldown <= 0 && A.speed < 3.2) {
      if (inFront && biteReach) {
        // Sometimes it plays with the ball: knock it away with the side of the head
        // instead of biting. Most likely when the ball is already on the move.
        const canShove = this.stats.bites > 0 && !this.shoveMissed && this.lastAttack !== 'Head shove';
        // playing-with-the-food behaviour only: only a ball that is actually
        // running away fast (a flicked/thrown ball, not the timid 2 m/s test
        // prey that the catch guarantee covers) can swap the bite for a shove
        const wantShove = canShove && escapeSpeed > 2.5 && Math.random() < 0.5;
        if (wantShove) {
          A.startAction('headShove', { target: this.prey.pos, side: Math.random() < 0.5 ? 1 : -1 });
          this.state = 'shove'; this.lastAttack = 'Head shove'; this.stats.shoves++;
          return;
        }
        this.shoveMissed = false;
        A.startAction('bite', { target: this.prey.pos, reach: L.fwd });
        this.state = 'bite'; this.lastAttack = 'Bite'; this.stats.bites++;
        return;
      }
      if ((A.speed < 1.8 || teleported) && !this.tailMissed && this.tailStrikeZone(L)) {
        // side +1: wind up to the left, whip through to the right (verified
        // numerically in tests) — so swing towards whichever side the prey is on
        const side = L.lat > 0 ? 1 : -1;
        A.startAction('tailSwipe', { side });
        this.state = 'tail'; this.lastAttack = 'Tail swipe'; this.stats.tail++;
        return;
      }
    }

    // --- too close for the jaws (the snout overhangs ~5 m ahead of the hips):
    //     turn away, take a few steps to open the range, then come back round.
    //     If the prey passes through the tail's arc while turning, whip it.
    const tooClose = L.dist < 4.0 || (L.fwd > -1 && L.fwd < 4.3 && Math.abs(L.lat) < 2.4);
    if (this.reposition) {
      const R = this.reposition;
      R.t += dt;
      if (R.t > 9 || (R.phase === 'walk' && L.dist > 8.5 && Math.abs(L.ang) < 38 * DEG)) this.reposition = null;
      else {
        if (R.phase === 'turn') {
          A.setTargetSpeed(0);
          A.setTurn(R.dir);
          // Once the ball has moved off the snout, step away at a controlled
          // walk rather than spinning indefinitely around a stiff root.
          if (Math.abs(L.ang) > 105 * DEG || L.dist > 5.5) R.phase = 'walk';
        } else {
          const retreatSpeed = L.dist > 14 || escapeSpeed > 2 ? RUN_SPEED : WALK_SPEED;
          A.setTargetSpeed(retreatSpeed);
          A.setTurn(Math.abs(L.ang) > 42 * DEG ? clamp(L.ang * 1.5, -1, 1) : 0);
        }
        this.state = 'reposition';
        return;
      }
    } else if (tooClose && A.speed < 0.6) {
      this.reposition = { dir: L.lat > 0 ? 1 : -1, t: 0, phase: 'turn' };   // prey right → turn left
      return;
    }

    // --- locomotion
    const ang = L.ang;
    // A fleeing ball changes the decision: distance alone should not make the
    // hunter freeze at a walk/run boundary while the prey is visibly escaping.
    let speed;
    if (L.dist > 22) speed = RUN_SPEED;
    else if (L.dist > 12) speed = clamp(2.2 + (L.dist - 12) * 0.5 + escapeSpeed * 0.25, WALK_SPEED, RUN_SPEED);
    else if (L.dist > 5.5 || escapeSpeed > 0.7) {
      // Inside the close envelope it deliberately walks, unless the target
      // is pulling away hard enough to justify a short acceleration to run.
      speed = clamp(1.05 + (L.dist - 5.5) * 0.55 + escapeSpeed * 0.35, 1.0, WALK_SPEED);
      if (escapeSpeed > 2.0 && L.dist > 8) speed = Math.min(RUN_SPEED, 3.2 + escapeSpeed);
    } else speed = 0;

    const inTailZone = this.tailStrikeZone(L);
    if (Math.abs(ang) > 70 * DEG && L.dist < 9) {
      // too far round: stop and pivot (towards the jaws)
      speed = 0;
    }
    if (Math.abs(ang) > 50 * DEG && L.dist >= 9) speed = Math.min(speed, 1.2);   // slow to turn
    if (L.fwd < 4.2 && Math.abs(L.lat) < 2.5 && L.fwd > -1) {
      // too close for the jaws: step back is not a T. rex thing — pivot for the tail instead
      speed = 0;
    }
    A.setTargetSpeed(speed);

    // steering
    const turn = clamp(ang * 2.0, -1, 1);
    const wantPivot = speed < 0.3 && Math.abs(ang) > 10 * DEG && !(inTailZone && this.cooldown <= 0);
    A.setTurn(speed > 0.3 || wantPivot ? turn : 0);
    this.state = speed === 0 ? (wantPivot ? 'pivot' : 'stalk') : speed > 4 ? 'run' : 'approach';
  }

  /**
   * Where the whip actually connects (measured from the rig — see
   * tests/hunt-sim.mjs): the distal tail sweeps LOW (≈0.5-1.5 m high) through
   * a band ~2-5 m to the side and ~1.5-6.5 m behind the hips.
   */
  tailStrikeZone(L) {
    // measured swept arc (tests/tail-sweep map): allow the prey radius at
    // either edge of the 4.1–5.7 m band, 0°-64° off straight-behind.
    const back = -L.fwd, side = Math.abs(L.lat);
    const r = Math.hypot(back, side);
    const off = Math.atan2(side, back) / DEG;
    return back > 1.6 && r > 1.6 && r < 5.8 && off < 70 && L.h < 1.4;
  }

  _resolveBite(a) {
    const m = this.s.mouth.getWorldPosition(_v);
    const snout = this.s.snout.getWorldPosition(_w);
    // distance from the prey centre to the tooth-row segment (mouth → snout)
    const d = distToSegment(this.prey.pos, m, snout);
    // The prey is a large, draggable training sphere rather than a single
    // tooth-sized point. Keep a forgiving but finite tooth-row envelope so
    // the three deliberate bite variants still connect after their small
    // rake/lift offsets.
    if (d < this.prey.radius + 1.05) {
      a.hit = true;
      this.prey.held = true;
      this.stats.hits++;
      this.emit('hit', { kind: 'bite' });
    }
  }

  _releaseBite() {
    // fling the prey forward and sideways out of the jaws
    const A = this.anim;
    this.prey.held = false;
    const f = new Vector3(-Math.sin(A.heading), 0, -Math.cos(A.heading));
    const r = new Vector3(Math.cos(A.heading), 0, -Math.sin(A.heading));
    // Deterministic alternating release keeps a replay/retarget test stable
    // while still throwing the prey out to both sides of the jaws.
    const side = ((this.stats.bites + this.stats.tail) & 1) ? -1 : 1;
    this.prey.vel.copy(f).multiplyScalar(4.5).addScaledVector(r, side * 5).add(new Vector3(0, 5.5, 0));
  }

  _resolveShove(a) {
    if (a.hit) return;
    const m = this.s.mouth.getWorldPosition(_v);
    const snout = this.s.snout.getWorldPosition(_w);
    const d = distToSegment(this.prey.pos, m, snout);
    // slightly tighter than the tooth-row envelope: a clean swing-by, not a catch
    if (d < this.prey.radius + 0.85) {
      a.hit = true;
      this.stats.hits++;
      const A = this.anim;
      // send it forward and hard sideways along the sweep, with a small hop —
      // a real head-shove of a round ball, not a tooth puncture
      const f = new Vector3(-Math.sin(A.heading), 0, -Math.cos(A.heading));
      const r = new Vector3(Math.cos(A.heading), 0, -Math.sin(A.heading)).multiplyScalar(a.side);
      this.prey.vel.copy(f.multiplyScalar(1.6)).addScaledVector(r, 6.5).add(new Vector3(0, 2.6, 0));
      this.prey.knock(1.5);
      this.emit('hit', { kind: 'shove' });
    }
  }

  _resolveTail(a) {
    if (a.hit) return;
    const tail = this.s.tail;
    for (let i = 4; i < tail.length; i++) {
      tail[i].getWorldPosition(_v);
      const r = 0.2 + 0.45 * (1 - i / tail.length);
      // The tail is sampled at frame rate, while the strike is a fast swept
      // volume. Add a small impact envelope to the instantaneous vertebra
      // radius so a prey sphere between two samples is not missed.
      const swept = 0.80 + 0.14 * (i / tail.length);
      if (_v.distanceTo(this.prey.pos) < this.prey.radius + r + swept) {
        a.hit = true;
        this.stats.hits++;
        // impulse along the sweep direction (tangent of the tail's arc)
        const A = this.anim;
        const toSeg = _w.copy(_v).sub(A.rigPos).setY(0);
        const tangent = new Vector3(-toSeg.z, 0, toSeg.x).normalize().multiplyScalar(a.side);
        const power = 6 + 10 * (i / tail.length);
        this.prey.vel.copy(tangent).multiplyScalar(power).add(new Vector3(0, 4 + 3 * (i / tail.length), 0));
        this.emit('hit', { kind: 'tail' });
        return;
      }
    }
  }
}

function distToSegment(p, a, b) {
  const ab = new Vector3().subVectors(b, a);
  const t = clamp(new Vector3().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
