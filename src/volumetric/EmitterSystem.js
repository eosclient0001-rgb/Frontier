/**
 * Emitter pool.
 *
 * Emitters are short-lived "sources" that the GPU pass reads out of a uniform
 * array (max 16). They can be continuous (a campfire, a jet) or one-shot
 * (an explosion), and they support a lifetime ramp so rate/density/velocity
 * can fall off over their life instead of cutting out abruptly.
 */

export const EMITTER_KIND = {
  smoke: 0,
  fire: 1,
  explosion: 2,
  debris: 3,
};

let NEXT_ID = 1;

export function makeEmitter(options = {}) {
  const o = {
    kind: EMITTER_KIND.smoke,
    position: [0, 1, 0],
    radius: 0.6,
    size: [1, 1, 1],
    velocity: [0, 0, 0],
    densityRate: 0.8,
    temperatureRate: 0.0,
    fuelRate: 0.0,
    emberRate: 0.0,
    color: [0.8, 0.8, 0.85],
    softness: 0.15,
    flicker: 0.0,
    swirl: 0.0,
    life: Infinity,
    fadeIn: 0.0,
    fadeOut: 0.25,
    ...options,
  };
  return { ...o, id: NEXT_ID++, age: 0, alive: true, lifeValue: o.life };
}

/** Tracks ages, applies life ramps, drops dead emitters. */
export class EmitterSystem {
  constructor({ max = 16 } = {}) {
    this.max = max;
    this.emitters = [];
  }

  clear() {
    this.emitters.length = 0;
  }

  add(emitter) {
    const e = emitter.id ? emitter : makeEmitter(emitter);
    e.age = 0;
    e.alive = true;
    this.emitters.push(e);
    // hard cap: keep the newest
    while (this.emitters.length > this.max) this.emitters.shift();
    return e;
  }

  remove(id) {
    this.emitters = this.emitters.filter((e) => e.id !== id);
  }

  update(dt) {
    for (const e of this.emitters) {
      e.age += dt;
      if (e.age >= e.life) e.alive = false;
    }
    this.emitters = this.emitters.filter((e) => e.alive);
  }

  /** Emitters prepared for the GPU: rates scaled by the lifetime ramp. */
  packed(now = 0) {
    const out = [];
    for (const e of this.emitters) {
      const t = e.life === Infinity ? 0 : Math.min(1, e.age / e.life);
      let ramp = 1;
      if (e.life !== Infinity) {
        const fadeIn = e.fadeIn > 0 ? Math.min(1, e.age / e.fadeIn) : 1;
        const fadeOut = Math.max(0, Math.min(1, (1 - t) / Math.max(e.fadeOut, 1e-3)));
        ramp = fadeIn * fadeOut;
      }
      out.push({
        position: e.position,
        radius: e.radius,
        size: e.size,
        velocity: e.velocity,
        densityRate: e.densityRate * ramp,
        temperatureRate: e.temperatureRate * ramp,
        fuelRate: e.fuelRate * ramp,
        emberRate: e.emberRate * ramp,
        color: e.color,
        kind: e.kind,
        softness: e.softness,
        flicker: e.flicker,
        swirl: e.swirl * ramp,
        life: 1 - t,
      });
    }
    // most important first (explosions should survive the 16-slot cap)
    out.sort((a, b) => a.life - b.life);
    void now;
    return out.slice(0, this.max);
  }

  /** Average position of "hot" emitters - used for the plume light. */
  lightPosition(fallback = [0, 1.5, 0]) {
    let x = 0;
    let y = 0;
    let z = 0;
    let w = 0;
    for (const e of this.emitters) {
      const weight = e.kind === EMITTER_KIND.fire || e.kind === EMITTER_KIND.explosion ? 2 : 0.4;
      x += e.position[0] * weight;
      y += e.position[1] * weight;
      z += e.position[2] * weight;
      w += weight;
    }
    if (w <= 0) return fallback;
    return [x / w, y / w, z / w];
  }
}
