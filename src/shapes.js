import { EDIT_MIN, EDIT_MAX, MIN, MAX, CELL, SCENE_SCALE } from "./domain.js";
import { primitiveDistance } from "./primitives.js";
import { rotateEuler, rotateVector } from "./rotation.js";
import { noiseDefaults, fractalNoise, terraceY } from "./volume-noise.js";
export const MAX_SHAPES = 6;
export function makeShape(id) {
  return {
    ...noiseDefaults,
    id,
    type: "shape",
    name: "Boulder",
    visible: true,
    baked: false,
    primitive: 0,
    profile: 0.5,
    position: [0, 4, 0],
    size: [5, 5, 5],
    rotation: [0, 0, 0],
    rounding: 0.3,
    noiseAmount: 0.45,
    noiseType: 2,
    points: [],
  };
}
export function localPoint(p, n) {
  let q = p.map((v, k) => v - n.position[k]);
  for (const k of [2, 1, 0]) {
    if (!n.rotation?.[k]) continue;
    const a = (-(n.rotation?.[k] ?? 0) * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a),
      i = (k + 1) % 3,
      j = (k + 2) % 3;
    [q[i], q[j]] = [q[i] * c - q[j] * s, q[i] * s + q[j] * c];
  }
  return q;
}
export function shapeDistance(p, n) {
  const q = localPoint(p, n),
    noisePoint = [...q],
    r = n.size.map((v) => Math.max(0.4, v * 0.5));
  q[1] = terraceY(q[1], n.terraceHeight ?? 1, n.terraceStrength ?? 0);
  const d = primitiveDistance(
    q,
    r,
    n.primitive,
    n.rounding ?? 0.3,
    n.profile ?? 0.5,
  );
  return d - (n.noiseAmount ?? 0) * fractalNoise(noisePoint, n);
}
export function objectPivot(n, params, pointIndex = -1) {
  if (n.type === "plot")
    return [params.plotX ?? 0, params.plotY ?? 0, params.plotZ ?? 0];
  if (n.type === "shape") return [...n.position];
  if (pointIndex >= 0 && n.points[pointIndex]) {
    const p = [...n.points[pointIndex]];
    if (n.type === "water") p[1] += params.waterOffset ?? 0;
    return p;
  }
  if (!n.points.length) return [0, params.plotHeight ?? 2.5, 0];
  return [0, 1, 2].map(
    (k) =>
      n.points.reduce((s, p) => s + p[k], 0) / n.points.length +
      (n.type === "water" && k === 1 ? (params.waterOffset ?? 0) : 0),
  );
}
// Clamp a translation as one delta so a path does not shear against the boundary.
export function moveObject(n, params, to, pointIndex = -1) {
  const pivot = objectPivot(n, params, pointIndex),
    delta = to.map((v, k) => v - pivot[k]);
  if (n.type === "plot") {
    [params.plotX, params.plotY, params.plotZ] = to;
    return;
  }
  if (n.type === "shape") {
    n.position = [...to];
    return;
  }
  const points = pointIndex >= 0 ? [n.points[pointIndex]] : n.points;
  if (!points.length) return;
  for (let k = 0; k < 3; k++) {
    const low = Math.min(...points.map((p) => p[k])),
      high = Math.max(...points.map((p) => p[k]));
    delta[k] = Math.max(
      EDIT_MIN[k] - low,
      Math.min(EDIT_MAX[k] - high, delta[k]),
    );
    for (const p of points) p[k] += delta[k];
  }
}
export function scaleObject(n, params, factors) {
  if (n.type === "plot") {
    params.plotWidth = Math.max(
      10,
      Math.min(40, params.plotWidth * factors[0]),
    );
    params.plotLength = Math.max(
      10,
      Math.min(36, params.plotLength * factors[2]),
    );
    params.plotHeight = Math.max(
      params.plotBase + 0.8,
      Math.min(
        12,
        params.plotBase + (params.plotHeight - params.plotBase) * factors[1],
      ),
    );
    return;
  }
  if (n.type === "shape") {
    n.size = n.size.map((v, k) =>
      Math.max(0.8, Math.min((MAX[k] - MIN[k]) * 0.8, v * factors[k])),
    );
    return;
  }
  const pivot = objectPivot(n, params);
  if (n.type === "water") pivot[1] -= params.waterOffset ?? 0;
  n.points = n.points.map((p) =>
    p.map((v, k) =>
      Math.max(
        EDIT_MIN[k],
        Math.min(EDIT_MAX[k], pivot[k] + (v - pivot[k]) * factors[k]),
      ),
    ),
  );
  n.width = Math.max(
    0.8,
    Math.min(
      (MAX[0] - MIN[0]) * 0.5,
      n.width * Math.sqrt(factors[0] * factors[2]),
    ),
  );
  if (n.type === "cut")
    n.depth = Math.max(
      0.2,
      Math.min((MAX[1] - MIN[1]) * 0.5, n.depth * factors[1]),
    );
}
export function rayAxisParameter(ray, pivot, axis) {
  const w = ray.origin.map((v, k) => v - pivot[k]),
    b = ray.direction[axis],
    d = w.reduce((s, v, k) => s + v * ray.direction[k], 0),
    den = 1 - b * b;
  return den < 0.015 ? null : (w[axis] - b * d) / den;
}

export function rotateObject(n, params, axis, angle) {
  if (n.type === "shape") {
    n.rotation = rotateEuler(n.rotation || [0, 0, 0], axis, angle);
    return;
  }
  if (n.type === "plot") {
    params.plotRotation = rotateEuler(
      params.plotRotation || [0, 0, 0],
      axis,
      angle,
    );
    return;
  }
  if (n.type === "water" && axis !== 1) return;
  const pivot = objectPivot(n, params);
  n.points = n.points.map((p) => {
    const q = rotateVector(
      p.map((v, k) => v - pivot[k]),
      axis,
      angle,
    );
    return q.map((v, k) =>
      Math.max(EDIT_MIN[k], Math.min(EDIT_MAX[k], v + pivot[k])),
    );
  });
}
