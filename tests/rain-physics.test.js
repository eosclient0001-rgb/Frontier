import test from "node:test";
import assert from "node:assert/strict";
import {
  rainExchange,
  rainStepVolume,
  rainTerminalSpeed,
} from "../src/rain-physics.js";
import {
  performancePresets,
  acceleratedSolidChange,
} from "../src/erosion-performance.js";
import { terrainDomain } from "../src/domain.js";

test("rain volume is rate × area × time, independent of particles and artistic multipliers", () => {
  const p = { rainRate: 20, rainfall: 1 };
  assert(Math.abs(rainStepVolume(p, 3600, 1e6) - 20000) < 1e-8);
  for (const count of [256, 4096, 16384])
    for (const dose of [1, 64])
      assert.equal(
        rainStepVolume(
          {
            ...p,
            particleCount: count,
            weatheringRate: dose,
            hydraulicPreview: 200,
          },
          0.32,
          1e6,
        ),
        rainStepVolume(p, 0.32, 1e6),
      );
  assert.equal(rainStepVolume({ ...p, rainfall: 0 }, 3600, 1e6), 0);
});
test("flat terrain has zero gravity-driven shear and cannot become an erosion sink even at high speed/dose", () => {
  for (const speed of [0, 3, 12])
    for (const dose of [1, 64]) {
      const r = rainExchange({
        volume: 10,
        speed,
        slope: 0,
        dose,
        looseVolume: 100,
        rainSubstrateShear: 1,
        rainSubstrateErodibility: 1,
      });
      assert.equal(r.tau, 0);
      assert.equal(r.detach, 0);
      assert.equal(r.capacity, 0);
    }
});
test("resistant substrate erodes less than loose material; saturated flow deposits rather than detaching", () => {
  const p = { volume: 0.001, speed: 6, slope: 0.5, dt: 0.32, hardness: 0.6 };
  const rock = rainExchange(p),
    soil = rainExchange({ ...p, looseVolume: 1 }),
    saturated = rainExchange({ ...p, load: 0.001 });
  assert(rock.detach > 0);
  assert(soil.detach > rock.detach * 10);
  assert.equal(saturated.detach, 0);
  assert(saturated.deposit > 0);
  assert(rock.capacity <= 0.006 * p.volume);
});
test("rain concentration bound cannot be enlarged by weathering dose or preview", () => {
  for (const dose of [1, 16, 64]) {
    const r = rainExchange({
      volume: 0.01,
      speed: 12,
      slope: 1,
      looseVolume: 1,
      dose,
      hydraulicPreview: 200,
    });
    assert(r.detach <= r.capacity);
    assert(r.capacity <= 0.006 * 0.01);
  }
  // Worst-case mean net loss bound for 20 mm/h over 800 seconds, capacity=.6.
  assert(
    (rainStepVolume({ rainRate: 20, rainfall: 1 }, 800, 1e6) * 0.006) / 1e6 <
      0.000027,
  );
});
test("incoming diameter controls bounded terminal velocity in SI units", () => {
  assert(rainTerminalSpeed(0.5) < rainTerminalSpeed(1));
  assert(rainTerminalSpeed(1) < rainTerminalSpeed(3));
  assert(Math.abs(rainTerminalSpeed(3) - 7.947) < 0.01);
  assert(rainTerminalSpeed(8) <= 9.2);
});
test("presets change transport time only and rain aggregate rate is not multiplied by dose", () => {
  assert.equal(performancePresets.fast.weatheringRate, 1);
  assert.equal(performancePresets.rapid.weatheringRate, 1);
  const d = terrainDomain({ worldEnabled: true });
  assert.equal(
    acceleratedSolidChange({ timeLapse: 8, weatheringRate: 1 }, d),
    acceleratedSolidChange({ timeLapse: 8, weatheringRate: 64 }, d),
  );
});
