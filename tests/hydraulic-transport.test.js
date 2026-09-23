import { CELL, BAND } from "../src/domain.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  hydraulicExchange as exchange,
  hydraulicUniforms,
  sampleArea,
  maxSolidChange,
  settlingVelocity,
  rainSplash,
} from "../src/hydraulic-transport.js";
const close = (a, b, tol = 1e-10) =>
  assert(
    Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)),
    `${a} != ${b}`,
  );
const advance = (p, dt) => {
  const r = exchange({ ...p, dt });
  return p.load + r.detach - r.deposit;
};
test("hydraulic exchange is bounded, one-directional, and approaches capacity without overshoot", () => {
  for (const speed of [0, 0.1, 1, 3, 8])
    for (const load of [0, 0.0001, 0.1, 1])
      for (const dt of [0.0001, 0.04, 1, 100]) {
        const r = exchange({ speed, load, dt });
        assert(r.detach >= 0 && r.deposit >= 0);
        assert(r.detach === 0 || r.deposit === 0);
        const next = load + r.detach - r.deposit;
        assert(next >= -1e-12);
        assert(
          next >= Math.min(load, r.equilibrium) - 1e-12 &&
            next <= Math.max(load, r.equilibrium) + 1e-12,
        );
        assert(r.equilibrium <= r.capacity + 1e-12);
      }
  assert.equal(exchange({ speed: 0 }).detach, 0);
  assert.equal(exchange({ speed: 4, water: 0 }).detach, 0);
  assert.equal(exchange({ speed: 4, strength: 0 }).detach, 0);
  assert.equal(exchange({ speed: 4, capacity: 0 }).detach, 0);
});
test("frozen-flow exchange is timestep-consistent rather than an explicit-Euler rate knob", () => {
  for (const load of [0, 0.005, 0.2]) {
    const p = { speed: 2.3, load };
    const full = advance(p, 0.8);
    let current = load;
    for (let i = 0; i < 80; i++)
      current = advance({ ...p, load: current }, 0.01);
    close(full, current);
    assert.equal(advance(p, 0), load);
  }
});
test("particle sampling and preview weights scale represented volume, not cubic brush size", () => {
  const total = (n) =>
    n *
    exchange({
      speed: 2,
      load: 0,
      area: sampleArea({ preset: 4, terrainWidth: 36, terrainLength: 32 }, n),
    }).detach;
  close(total(128), total(512));
  close(total(512), total(2048));
  const a = exchange({ speed: 2, hydraulicPreview: 25 }),
    b = exchange({ speed: 2, hydraulicPreview: 50 });
  close(b.detach, 2 * a.detach);
});
test("settling follows viscous small-grain limit and avoids unbounded Stokes extrapolation", () => {
  assert.equal(settlingVelocity(0), 0);
  const d = 1e-6,
    stokes = (1.65 * 9.81 * d * d) / 18e-6;
  assert(Math.abs(settlingVelocity(d) / stokes - 1) < 0.001);
  assert(settlingVelocity(0.00025) > settlingVelocity(0.00005));
  assert(settlingVelocity(0.001) < (1.65 * 9.81 * 0.001 ** 2) / 18e-6);
});
test("material resistance, preview units and surface change ceilings have consistent meanings", () => {
  assert(
    exchange({ speed: 2, hardness: 0.2 }).detach >
      exchange({ speed: 2, hardness: 0.9 }).detach,
  );
  assert(
    exchange({ speed: 2, hydraulicErodibility: 0.01 }).detach <
      exchange({ speed: 2, hydraulicErodibility: 0.05 }).detach,
  );
  assert.deepEqual(hydraulicUniforms(), [0.00002, 0.02, 0.01, 10]);
  close(maxSolidChange({}, 0.04), 2 * maxSolidChange({}, 0.02));
  assert(maxSolidChange({}, 100) <= (0.2 * Math.min(...CELL)) / (2 * BAND));
  const p = {
    waterVolume: 1,
    impactSpeed: 3,
    hardness: 0.6,
    strength: 0.45,
    capacity: 0.6,
  };
  const v = rainSplash(p);
  assert(v >= 0 && v <= 0.15 * p.capacity);
  assert(v * 1e5 * (1 + 9 * p.hardness) <= 0.5 * 1000 * p.impactSpeed ** 2);
  assert.equal(rainSplash({ ...p, strength: 0 }), 0);
});

test("exports retain hydraulic units, preview scale, and model identification", async () => {
  const { defaults, encodeScene } = await import("../src/field.js");
  const settings = {
    ...defaults,
    hydraulicPreview: 25,
    hydraulicErodibility: 0.015,
  };
  const bytes = await encodeScene(new Float32Array(4), settings).arrayBuffer();
  const length = new DataView(bytes).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 8, length)),
  );
  assert.equal(header.hydraulicExchangeModel, "si-suspension-relaxation-v2");
  assert.equal(header.settings.hydraulicPreview, 25);
  assert.equal(header.settings.hydraulicErodibility, 0.015);
  assert.equal(header.settings.hydraulicDepth, 20);
  assert.equal(header.particleStateIncluded, false);
});

test("moving water keeps fines suspended while genuinely still water deposits them", () => {
  const p = { load: 0.01, strength: 0, grain: 0.00015, dt: 10 };
  const moving = exchange({ ...p, speed: 3 }),
    still = exchange({ ...p, speed: 0 });
  assert(still.deposit > 0.005);
  assert(moving.deposit < still.deposit * 0.1);
  assert.equal(moving.detach, 0);
  assert.equal(still.detach, 0);
});
