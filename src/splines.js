export const MAX_POINTS = 12,
  MAX_CUTS = 4,
  MAX_WATER_PATHS = 4;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function sampleSpline(points, budget = 32) {
  if (points.length < 2) return points.map((p) => [...p]);
  const per = Math.max(1, Math.floor(budget / (points.length - 1))),
    out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        b.map((v, k) =>
          clamp(
            0.5 *
              (2 * v +
                (-a[k] + c[k]) * t +
                (2 * a[k] - 5 * v + 4 * c[k] - d[k]) * t2 +
                (-a[k] + 3 * v - 3 * c[k] + d[k]) * t3),
            [-21.5, -3.5, -19.5][k],
            [21.5, 21.5, 19.5][k],
          ),
        ),
      );
    }
  }
  out.push([...points.at(-1)]);
  return out;
}
export function nearestSplineXZ(p, points) {
  let best = { distance: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      l2 = dx * dx + dz * dz;
    if (l2 < 1e-8) continue;
    const t = clamp(((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / l2, 0, 1),
      position = a.map((v, k) => v + (b[k] - v) * t),
      distance = Math.hypot(p[0] - position[0], p[2] - position[2]);
    if (distance < best.distance)
      best = {
        distance,
        position,
        t,
        index: i,
        tangent: [dx / Math.sqrt(l2), 0, dz / Math.sqrt(l2)],
      };
  }
  return best;
}
export function pathCutDistance(p, node) {
  const points = sampleSpline(node.points);
  let d = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const sample = nearestSplineXZ(p, points.slice(i, i + 2));
    if (!sample.position) continue;
    const bed = sample.position[1] - node.depth,
      slope = node.bankSlope ?? 0.25;
    d = Math.min(
      d,
      Math.max(
        (sample.distance - node.width * 0.5 - Math.max(0, p[1] - bed) * slope) /
          Math.sqrt(1 + slope * slope),
        bed - p[1],
      ),
    );
  }
  return d;
}
export function makePath(id, type) {
  return {
    id,
    type,
    name: type === "cut" ? "Channel cut" : "Water flow",
    visible: true,
    baked: false,
    width: type === "cut" ? 4.5 : 3.5,
    depth: 2,
    bankSlope: 0.25,
    speed: 3.2,
    points: [],
  };
}
export function packFlowPaths(settings = {}) {
  const nodes = (settings.sceneObjects || []).filter((n) => n.type === "water"),
    active = nodes
      .filter((n) => n.visible && n.points.length >= 2)
      .slice(0, MAX_WATER_PATHS);
  const data = new Float32Array(256 * 4);
  let count = 0,
    total = 0;
  for (const node of active) {
    const points = sampleSpline(node.points, 16);
    let along = 0;
    for (let i = 0; i < points.length - 1 && count < 64; i++) {
      const a = points[i],
        b = points[i + 1],
        len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < 0.001) continue;
      data.set([a[0], a[2], along, node.width * 0.5], (1 + count * 3) * 4);
      data.set([b[0], b[2], total + len, node.speed], (2 + count * 3) * 4);
      data.set([points[0][0], points[0][2], total, 0], (3 + count * 3) * 4);
      along += len;
      total += len;
      count++;
    }
  }
  data.set([count, settings.preset === 3 || nodes.length ? 1 : 0, total, 0], 0);
  return data;
}
export function uploadFlowPaths(gl, texture, data) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    256,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    data,
  );
  for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
  for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
    gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
}
export class FlowPathTexture {
  constructor(gl) {
    this.gl = gl;
    this.texture = gl.createTexture();
    this.key = null;
  }
  update(settings = {}) {
    const key = JSON.stringify([
      settings.preset === 3,
      (settings.sceneObjects || [])
        .filter((n) => n.type === "water")
        .map((n) => [n.visible, n.width, n.speed, n.points]),
    ]);
    if (key !== this.key) {
      uploadFlowPaths(this.gl, this.texture, packFlowPaths(settings));
      this.key = key;
    }
    return this.texture;
  }
}
