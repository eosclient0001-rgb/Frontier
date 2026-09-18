import test from "node:test";
import assert from "node:assert/strict";
import { cameraEye, cameraBasis, flyLook, flyMove } from "../src/camera.js";
import {
  WEATHER_PROFILES,
  profileFor,
  profileSettings,
} from "../src/weather.js";
const camera = () => ({ yaw: 0, pitch: 0, distance: 10, target: [0, 0, 0] });
const near = (a, b) =>
  a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-8, `${a} != ${b}`));
test("fly look pivots around the eye and clamps pitch without flipping", () => {
  const c = camera(),
    eye = cameraEye(c);
  flyLook(c, 120, 80);
  near(cameraEye(c), eye);
  assert.ok(cameraBasis(c).forward[0] > 0);
  assert.ok(cameraBasis(c).forward[1] < 0);
  flyLook(c, 0, 1e6);
  assert.equal(c.pitch, 1.54);
  near(cameraEye(c), eye);
});
test("WASD follows view; Q/E is world vertical; opposite keys cancel", () => {
  const c = camera();
  flyMove(c, new Set(["KeyW"]), 0.1, 10);
  near(c.target, [0, 0, -1]);
  flyMove(c, new Set(["KeyD", "KeyA"]), 0.1, 10);
  near(c.target, [0, 0, -1]);
  c.pitch = 1;
  flyMove(c, new Set(["KeyE"]), 0.1, 10);
  near(c.target, [0, 1, -1]);
  flyMove(c, new Set(["KeyQ"]), 0.1, 10);
  near(c.target, [0, 0, -1]);
  c.yaw = Math.PI / 2;
  c.pitch = 0;
  flyMove(c, new Set(["KeyW"]), 0.1, 10);
  near(c.target, [-1, 0, -1]);
});
test("normalized diagonal and Shift boost are delta-time based with a stall cap", () => {
  const a = camera(),
    b = camera();
  flyMove(a, new Set(["KeyW", "KeyD"]), 0.1, 10);
  assert.ok(Math.abs(Math.hypot(...a.target) - 1) < 1e-8);
  flyMove(b, new Set(["KeyW", "ShiftLeft"]), 0.05, 10);
  flyMove(b, new Set(["KeyW", "ShiftLeft"]), 0.05, 10);
  near(b.target, [0, 0, -4]);
  const c = camera();
  flyMove(c, new Set(["KeyW"]), 20, 10);
  near(c.target, [0, 0, -1]);
});
test("weather profiles have distinct physical diameters, valid ranges and separate voxel footprints", () => {
  assert.equal(WEATHER_PROFILES.length, 6);
  for (const p of WEATHER_PROFILES) {
    assert.ok(p.agentDiameter >= p.min && p.agentDiameter <= p.max);
    assert.ok(p.footprint >= 0.45 && p.footprint <= 1.15);
    assert.equal(profileFor(p.id), p);
    assert.notEqual(profileSettings(p), p);
  }
  assert.ok(profileFor(4).agentDiameter > profileFor(0).agentDiameter);
  assert.ok(profileFor(3).agentDiameter < profileFor(0).agentDiameter);
});
