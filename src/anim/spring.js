/**
 * Critically-damped springs.
 *
 * These carry the *secondary* animation: the head/neck lag behind the trunk,
 * the tail feathers trail the pelvis, and the outer primaries flex under
 * aerodynamic load instead of snapping rigidly to the wing's motion.
 *
 * Critically damped so nothing ever overshoots into a wobble — a 5 kg eagle's
 * soft tissue dampens far more than an elastic toy.  `damping` can be pushed
 * slightly below 1 for the springy feather bounce where some overshoot is
 * physically right.
 */

export class Spring {
  /**
   * @param {number} value    initial value
   * @param {number} omega    natural frequency, rad/s (higher = snappier)
   * @param {number} zeta     damping ratio; 1 = critical, <1 overshoots
   */
  constructor(value = 0, omega = 12, zeta = 1) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.omega = omega;
    this.zeta = zeta;
  }

  reset(v) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
    return this;
  }

  step(dt) {
    // Semi-implicit Euler on the canonical 2nd-order system; stable for
    // dt * omega < ~0.5, which the substepping in Rig.update guarantees.
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    const a = -k * (this.value - this.target) - c * this.velocity;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  set omegaOf(v) {
    this.omega = v;
  }
}

/** Vector spring: three independent scalar springs. */
export class Spring3 {
  constructor(value = [0, 0, 0], omega = 12, zeta = 1) {
    this.x = new Spring(value[0], omega, zeta);
    this.y = new Spring(value[1], omega, zeta);
    this.z = new Spring(value[2], omega, zeta);
  }
  get omega() {
    return this.x.omega;
  }
  set omega(v) {
    this.x.omega = v;
    this.y.omega = v;
    this.z.omega = v;
  }
  setDamping(z) {
    this.x.zeta = z;
    this.y.zeta = z;
    this.z.zeta = z;
    return this;
  }
  reset(v) {
    this.x.reset(v[0]);
    this.y.reset(v[1]);
    this.z.reset(v[2]);
    return this;
  }
  step(dt) {
    this.x.step(dt);
    this.y.step(dt);
    this.z.step(dt);
    return [this.x.value, this.y.value, this.z.value];
  }
  setTarget(v) {
    this.x.target = v[0];
    this.y.target = v[1];
    this.z.target = v[2];
    return this;
  }
}

/**
 * Fixed-step spring driver: runs the springs at a constant internal rate so
 * behaviour does not change with the render frame rate.
 */
export class SpringDriver {
  constructor(springs, hz = 240) {
    this.springs = springs;
    this.h = 1 / hz;
    this.acc = 0;
  }
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= this.h) {
      for (const s of this.springs) s.step(this.h);
      this.acc -= this.h;
    }
  }
}
