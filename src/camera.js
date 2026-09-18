// Orbit and free-flight share one camera representation. Flight translates the
// eye AND target; mouse look pivots about the eye (not the old orbit target).
export function cameraBasis(camera) {
  const sy = Math.sin(camera.yaw),
    cy = Math.cos(camera.yaw),
    sp = Math.sin(camera.pitch),
    cp = Math.cos(camera.pitch);
  return {
    forward: [-sy * cp, -sp, -cy * cp],
    right: [cy, 0, -sy],
    up: [-sy * sp, cp, -cy * sp],
  };
}
export function cameraEye(camera) {
  const { forward } = cameraBasis(camera);
  return camera.target.map((v, k) => v - forward[k] * camera.distance);
}
export function flyLook(camera, dx, dy) {
  const eye = cameraEye(camera);
  camera.yaw -= dx * 0.003;
  camera.pitch = Math.max(-1.54, Math.min(1.54, camera.pitch + dy * 0.003));
  const { forward } = cameraBasis(camera);
  camera.target = eye.map((v, k) => v + forward[k] * camera.distance);
}
export function flyMove(camera, keys, dt, speed = 8) {
  const has = (k) => keys.has(k);
  const f = Number(has("KeyW")) - Number(has("KeyS"));
  const r = Number(has("KeyD")) - Number(has("KeyA"));
  const y = Number(has("KeyE")) - Number(has("KeyQ"));
  const { forward, right } = cameraBasis(camera);
  const motion = forward.map(
    (v, k) => f * v + r * right[k] + (k === 1 ? y : 0),
  );
  const length = Math.hypot(...motion);
  if (!length) return;
  const amount =
    (Math.max(0, Math.min(0.1, dt)) *
      speed *
      (has("ShiftLeft") || has("ShiftRight") ? 4 : 1)) /
    length;
  camera.target = camera.target.map((v, k) => v + motion[k] * amount);
}
export const FLIGHT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
]);
