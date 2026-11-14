/*============================================================================================================================================
                                                NANITEGEOMETRYGENERATORS.JS
============================================================================================================================================*/
/**
 * Procedural 3D Geometry Generators & Wavefront OBJ Parser for Nanite Virtual Geometry.
 * Provides high-poly test assets (Stanford Bunny, Dragon, Fractal Canyon, Suzanne, Geodesic Sphere, Column),
 * plus runtime OBJ file loading and Multi-Instance grid scene generation.
 */

import { Math3D } from './NaniteMesh.js';

/**
 * Procedural Stanford Bunny Generator
 * Generates an organic, high-poly model capturing the characteristic Stanford Bunny proportions:
 * upright curved ears, arched back, chest, paws, and round tail.
 */
export function generateStanfordBunny(subdivisionsU = 64, subdivisionsV = 48) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // Parametric organic multi-lobed shape approximating the Stanford Bunny
    const uCount = subdivisionsU;
    const vCount = subdivisionsV;

    for (let i = 0; i <= uCount; i++) {
        const u = i / uCount;
        const theta = u * Math.PI * 2.0;

        for (let j = 0; j <= vCount; j++) {
            const v = j / vCount;
            const phi = (v - 0.5) * Math.PI;

            // Base ellipsoid body
            let r = 1.0;
            let cy = Math.sin(phi);
            let cx = Math.cos(phi) * Math.cos(theta);
            let cz = Math.cos(phi) * Math.sin(theta);

            // Back hunch & chest asymmetry
            const hunch = 0.35 * Math.exp(-Math.pow(cz - 0.4, 2) * 4.0) * Math.max(0, cy);
            const chest = 0.25 * Math.exp(-Math.pow(cz + 0.6, 2) * 5.0) * Math.max(0, -cy);

            // Left ear protrusion
            const earLDist = Math.sqrt(Math.pow(cx - 0.35, 2) + Math.pow(cy - 0.85, 2) + Math.pow(cz - 0.1, 2));
            const earL = 0.9 * Math.exp(-earLDist * earLDist * 8.0);

            // Right ear protrusion
            const earRDist = Math.sqrt(Math.pow(cx + 0.35, 2) + Math.pow(cy - 0.85, 2) + Math.pow(cz - 0.1, 2));
            const earR = 0.9 * Math.exp(-earRDist * earRDist * 8.0);

            // Tail protrusion
            const tailDist = Math.sqrt(Math.pow(cx, 2) + Math.pow(cy + 0.35, 2) + Math.pow(cz - 0.9, 2));
            const tail = 0.35 * Math.exp(-tailDist * tailDist * 12.0);

            // Snout/nose protrusion
            const snoutDist = Math.sqrt(Math.pow(cx, 2) + Math.pow(cy - 0.3, 2) + Math.pow(cz + 0.8, 2));
            const snout = 0.3 * Math.exp(-snoutDist * snoutDist * 10.0);

            // Surface ripple noise (micro-fur organic detail)
            const ripple = 0.04 * (Math.sin(theta * 8.0) * Math.cos(phi * 6.0) + Math.sin(theta * 14.0 + phi * 10.0) * 0.5);

            r = 1.0 + hunch + chest + earL + earR + tail + snout + ripple;

            const px = cx * r * 0.85;
            const py = (cy * r + 0.25) * 1.05;
            const pz = cz * r * 1.1;

            positions.push(px, py, pz);
            uvs.push(u, v);
        }
    }

    // Generate quads to triangles
    for (let i = 0; i < uCount; i++) {
        for (let j = 0; j < vCount; j++) {
            const p0 = i * (vCount + 1) + j;
            const p1 = (i + 1) * (vCount + 1) + j;
            const p2 = (i + 1) * (vCount + 1) + (j + 1);
            const p3 = i * (vCount + 1) + (j + 1);

            indices.push(p0, p1, p2);
            indices.push(p0, p2, p3);
        }
    }

    // Compute normals
    const computedNormals = computeSmoothNormals(positions, indices);

    return {
        name: "Stanford Bunny (High-Poly)",
        positions: new Float32Array(positions),
        normals: new Float32Array(computedNormals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Procedural Stanford Dragon / Serpentine Generator
 * Complex coiling serpentine geometry with spinal ridges and horns
 */
export function generateStanfordDragon(segments = 72, rings = 32) {
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 4.0;
        const progress = i / segments;

        // Serpentine curve in 3D
        const curveX = Math.sin(t) * 1.2 * (1.0 - progress * 0.3);
        const curveY = (progress - 0.5) * 2.8 + Math.cos(t * 1.5) * 0.35;
        const curveZ = Math.cos(t) * 1.1 * (1.0 - progress * 0.3);

        // Frenet frame approximation
        const tx = Math.cos(t) * 1.2;
        const ty = 0.5;
        const tz = -Math.sin(t) * 1.1;
        const tangent = Math3D.normalize([tx, ty, tz]);

        let normal = Math3D.normalize([-tangent[1], tangent[0], 0]);
        let binormal = Math3D.cross(tangent, normal);

        // Radius taper along body
        let radius = 0.35 * Math.sin(progress * Math.PI);
        if (progress > 0.85) radius += 0.15; // Dragon head enlargement

        for (let j = 0; j <= rings; j++) {
            const angle = (j / rings) * Math.PI * 2.0;

            // Spines along dorsal ridge
            const isDorsal = Math.abs(Math.sin(angle)) < 0.2 && Math.cos(angle) > 0.8;
            const spine = isDorsal ? 0.25 * (Math.sin(i * 1.2) > 0.2 ? 1.0 : 0.0) : 0.0;

            // Horns at head
            const isHeadHorn = progress > 0.9 && Math.abs(angle - Math.PI * 0.5) < 0.4;
            const horn = isHeadHorn ? 0.4 : 0.0;

            const rEff = radius + spine + horn;

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            const px = curveX + (normal[0] * cosA + binormal[0] * sinA) * rEff;
            const py = curveY + (normal[1] * cosA + binormal[1] * sinA) * rEff;
            const pz = curveZ + (normal[2] * cosA + binormal[2] * sinA) * rEff;

            positions.push(px, py, pz);
            uvs.push(progress, j / rings);
        }
    }

    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < rings; j++) {
            const p0 = i * (rings + 1) + j;
            const p1 = (i + 1) * (rings + 1) + j;
            const p2 = (i + 1) * (rings + 1) + (j + 1);
            const p3 = i * (rings + 1) + (j + 1);

            indices.push(p0, p1, p2);
            indices.push(p0, p2, p3);
        }
    }

    const normals = computeSmoothNormals(positions, indices);

    return {
        name: "Stanford Dragon (Serpentine)",
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Procedural Fractal Mountain & Canyon Relief
 * High-detail 120x120 heightfield grid with multi-octave fBm fractal noise,
 * deep eroded canyons, sharp rocky ridges, and valley terraces.
 */
export function generateFractalMountain(resolution = 120) {
    const positions = [];
    const uvs = [];
    const indices = [];

    const size = 4.0;
    const half = size * 0.5;

    // Simple deterministic multi-octave pseudo-noise
    function noise2D(x, y) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
        return (n - Math.floor(n)) * 2.0 - 1.0;
    }

    function smoothNoise2D(x, y) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;

        // Smoothstep interpolation
        const sx = fx * fx * (3.0 - 2.0 * fx);
        const sy = fy * fy * (3.0 - 2.0 * fy);

        const n00 = noise2D(ix, iy);
        const n10 = noise2D(ix + 1, iy);
        const n01 = noise2D(ix, iy + 1);
        const n11 = noise2D(ix + 1, iy + 1);

        const nx0 = n00 * (1.0 - sx) + n10 * sx;
        const nx1 = n01 * (1.0 - sx) + n11 * sx;
        return nx0 * (1.0 - sy) + nx1 * sy;
    }

    function fbm(x, y, octaves = 6) {
        let val = 0.0;
        let amp = 0.55;
        let freq = 1.0;
        for (let o = 0; o < octaves; o++) {
            val += smoothNoise2D(x * freq, y * freq) * amp;
            amp *= 0.5;
            freq *= 2.05;
        }
        return val;
    }

    for (let y = 0; y <= resolution; y++) {
        const v = y / resolution;
        const pz = (v - 0.5) * size;

        for (let x = 0; x <= resolution; x++) {
            const u = x / resolution;
            const px = (u - 0.5) * size;

            // Multi-scale terrain noise
            const nx = px * 1.5;
            const nz = pz * 1.5;

            // Mountain central mass + canyon erosion
            const distFromCenter = Math.sqrt(px * px + pz * pz) / half;
            const dome = Math.max(0, 1.0 - distFromCenter * distFromCenter);

            const elevation = fbm(nx, nz, 5) * 1.1 + fbm(nx * 2.5, nz * 2.5, 4) * 0.45;
            const canyon = Math.pow(Math.abs(smoothNoise2D(nx * 0.8, nz * 0.8)), 1.8) * 0.8;

            const py = (elevation - canyon) * dome * 1.6;

            positions.push(px, py, pz);
            uvs.push(u, v);
        }
    }

    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const p0 = y * (resolution + 1) + x;
            const p1 = y * (resolution + 1) + (x + 1);
            const p2 = (y + 1) * (resolution + 1) + (x + 1);
            const p3 = (y + 1) * (resolution + 1) + x;

            indices.push(p0, p2, p1);
            indices.push(p0, p3, p2);
        }
    }

    const normals = computeSmoothNormals(positions, indices);

    return {
        name: "Fractal Mountain & Canyon Relief",
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Procedural Geodesic Icosahedron Megasphere Generator
 * High-subdivision geodesic sphere (Level 4/5) with 20,480 triangles
 */
export function generateGeodesicSphere(subdivisionLevel = 4) {
    const t = (1.0 + Math.sqrt(5.0)) / 2.0;

    let vertices = [
        Math3D.normalize([-1,  t,  0]),
        Math3D.normalize([ 1,  t,  0]),
        Math3D.normalize([-1, -t,  0]),
        Math3D.normalize([ 1, -t,  0]),

        Math3D.normalize([ 0, -1,  t]),
        Math3D.normalize([ 0,  1,  t]),
        Math3D.normalize([ 0, -1, -t]),
        Math3D.normalize([ 0,  1, -t]),

        Math3D.normalize([ t,  0, -1]),
        Math3D.normalize([ t,  0,  1]),
        Math3D.normalize([-t,  0, -1]),
        Math3D.normalize([-t,  0,  1])
    ];

    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];

    const midpointCache = new Map();
    function getMidpoint(v1, v2) {
        const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
        if (midpointCache.has(key)) return midpointCache.get(key);

        const p1 = vertices[v1];
        const p2 = vertices[v2];
        const mid = Math3D.normalize([
            (p1[0] + p2[0]) * 0.5,
            (p1[1] + p2[1]) * 0.5,
            (p1[2] + p2[2]) * 0.5
        ]);

        const idx = vertices.length;
        vertices.push(mid);
        midpointCache.set(key, idx);
        return idx;
    }

    // Subdivide
    for (let lvl = 0; lvl < subdivisionLevel; lvl++) {
        const nextFaces = [];
        midpointCache.clear();

        for (const f of faces) {
            const a = getMidpoint(f[0], f[1]);
            const b = getMidpoint(f[1], f[2]);
            const c = getMidpoint(f[2], f[0]);

            nextFaces.push([f[0], a, c]);
            nextFaces.push([f[1], b, a]);
            nextFaces.push([f[2], c, b]);
            nextFaces.push([a, b, c]);
        }
        faces = nextFaces;
    }

    const positions = [];
    const normals = [];
    const uvs = [];
    const radius = 1.35;

    for (const v of vertices) {
        positions.push(v[0] * radius, v[1] * radius, v[2] * radius);
        normals.push(v[0], v[1], v[2]);

        const u = 0.5 + Math.atan2(v[2], v[0]) / (2 * Math.PI);
        const vCoord = 0.5 - Math.asin(v[1]) / Math.PI;
        uvs.push(u, vCoord);
    }

    const indices = [];
    for (const f of faces) {
        indices.push(f[0], f[1], f[2]);
    }

    return {
        name: `Geodesic Icosahedron (Lvl ${subdivisionLevel})`,
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Procedural Classical Gothic Column & Capital
 * Fluted shaft with 24 vertical flutes, torus base, scotia, and carved capital
 */
export function generateGothicColumn(heightRings = 72, radialSlices = 48) {
    const positions = [];
    const uvs = [];
    const indices = [];

    const height = 3.6;
    const baseRadius = 0.55;
    const flutes = 20;

    for (let y = 0; y <= heightRings; y++) {
        const v = y / heightRings;
        const py = (v - 0.5) * height;

        // Radius profile along column height:
        // Stepped square plinth base at bottom, fluted tapered shaft in middle, carved capital at top
        let r = baseRadius;
        if (v < 0.12) {
            // Base moldings (torus, scotia, plinth)
            const baseT = v / 0.12;
            r = baseRadius * (1.35 - Math.sin(baseT * Math.PI) * 0.25);
        } else if (v > 0.88) {
            // Capital moldings (echinus, abacus, volute flare)
            const capT = (v - 0.88) / 0.12;
            r = baseRadius * (0.85 + Math.pow(capT, 1.8) * 0.7);
        } else {
            // Entasis & shaft fluting
            const shaftT = (v - 0.12) / 0.76;
            const entasis = Math.sin(shaftT * Math.PI) * 0.04;
            r = (baseRadius * 0.88 - shaftT * 0.08 + entasis);
        }

        for (let s = 0; s <= radialSlices; s++) {
            const u = s / radialSlices;
            const angle = u * Math.PI * 2.0;

            // Fluting ripples on shaft
            let fluteDepth = 0.0;
            if (v >= 0.12 && v <= 0.88) {
                const flutePattern = Math.cos(angle * flutes);
                fluteDepth = -Math.max(0, flutePattern) * 0.035;
            }

            const px = Math.cos(angle) * (r + fluteDepth);
            const pz = Math.sin(angle) * (r + fluteDepth);

            positions.push(px, py, pz);
            uvs.push(u, v);
        }
    }

    for (let y = 0; y < heightRings; y++) {
        for (let s = 0; s < radialSlices; s++) {
            const p0 = y * (radialSlices + 1) + s;
            const p1 = y * (radialSlices + 1) + (s + 1);
            const p2 = (y + 1) * (radialSlices + 1) + (s + 1);
            const p3 = (y + 1) * (radialSlices + 1) + s;

            indices.push(p0, p1, p2);
            indices.push(p0, p2, p3);
        }
    }

    const normals = computeSmoothNormals(positions, indices);

    return {
        name: "Classical Gothic Column",
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Procedural Suzanne Monkey Head
 * High-quality geometric approximation of the iconic Blender Suzanne head
 */
export function generateSuzanneHead(uSegs = 48, vSegs = 36) {
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs;
        const theta = u * Math.PI * 2.0;

        for (let j = 0; j <= vSegs; j++) {
            const v = j / vSegs;
            const phi = (v - 0.5) * Math.PI;

            let cx = Math.cos(phi) * Math.cos(theta);
            let cy = Math.sin(phi);
            let cz = Math.cos(phi) * Math.sin(theta);

            // Forehead brow ridge
            const brow = 0.45 * Math.exp(-Math.pow(cz - 0.45, 2) * 8.0) * Math.exp(-Math.pow(cy - 0.35, 2) * 12.0);

            // Deep eye sockets
            const eyeDistL = Math.sqrt(Math.pow(cx - 0.42, 2) + Math.pow(cy - 0.15, 2) + Math.pow(cz - 0.55, 2));
            const eyeDistR = Math.sqrt(Math.pow(cx + 0.42, 2) + Math.pow(cy - 0.15, 2) + Math.pow(cz - 0.55, 2));
            const eyeSocket = -0.35 * (Math.exp(-eyeDistL * eyeDistL * 15.0) + Math.exp(-eyeDistR * eyeDistR * 15.0));

            // Wide round monkey ears
            const earDistL = Math.sqrt(Math.pow(cx - 0.95, 2) + Math.pow(cy - 0.1, 2) + Math.pow(cz + 0.1, 2));
            const earDistR = Math.sqrt(Math.pow(cx + 0.95, 2) + Math.pow(cy - 0.1, 2) + Math.pow(cz + 0.1, 2));
            const ears = 0.7 * (Math.exp(-earDistL * earDistL * 7.0) + Math.exp(-earDistR * earDistR * 7.0));

            // Protruding snout / muzzle
            const snoutDist = Math.sqrt(Math.pow(cx * 1.5, 2) + Math.pow(cy + 0.35, 2) + Math.pow(cz - 0.85, 2));
            const snout = 0.55 * Math.exp(-snoutDist * snoutDist * 5.0);

            const r = 1.0 + brow + eyeSocket + ears + snout;

            positions.push(cx * r * 1.15, cy * r * 1.05, cz * r * 1.1);
            uvs.push(u, v);
        }
    }

    for (let i = 0; i < uSegs; i++) {
        for (let j = 0; j < vSegs; j++) {
            const p0 = i * (vSegs + 1) + j;
            const p1 = (i + 1) * (vSegs + 1) + j;
            const p2 = (i + 1) * (vSegs + 1) + (j + 1);
            const p3 = i * (vSegs + 1) + (j + 1);

            indices.push(p0, p1, p2);
            indices.push(p0, p2, p3);
        }
    }

    const normals = computeSmoothNormals(positions, indices);

    return {
        name: "Suzanne Monkey Head",
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs)
    };
}

/**
 * Generate Multi-Instance Transform Grid (Matrix of Nanite Instances)
 */
export function generateInstanceTransforms(count = 25, spacing = 2.8) {
    const transforms = [];
    const side = Math.ceil(Math.sqrt(count));
    const half = (side - 1) * 0.5 * spacing;

    let index = 0;
    for (let r = 0; r < side; r++) {
        for (let c = 0; c < side; c++) {
            if (index >= count) break;

            const x = c * spacing - half;
            const z = r * spacing - half;
            const y = 0.0;

            // Small rotation variation
            const rotY = (index * 0.37) % (Math.PI * 2);
            const cos = Math.cos(rotY);
            const sin = Math.sin(rotY);

            // 4x4 matrix (column-major for WebGL)
            const m = [
                cos,  0, sin, 0,
                0,    1,   0, 0,
                -sin, 0, cos, 0,
                x,    y,   z, 1
            ];

            transforms.push(m);
            index++;
        }
    }

    return transforms;
}

/**
 * Wavefront OBJ Format Parser
 * Converts OBJ text string to { positions, normals, indices, uvs }
 */
export function parseWavefrontOBJ(objText, name = "Imported OBJ") {
    const lines = objText.split('\n');
    const rawPositions = [];
    const rawNormals = [];
    const rawUvs = [];

    const finalPositions = [];
    const finalNormals = [];
    const finalUvs = [];
    const finalIndices = [];

    const vertexCache = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.startsWith('#')) continue;

        const parts = line.split(/\s+/);
        const type = parts[0];

        if (type === 'v') {
            rawPositions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (type === 'vn') {
            rawNormals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (type === 'vt') {
            rawUvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
        } else if (type === 'f') {
            // Triangulate faces (handles quads and n-gons via triangle fan)
            const faceVertices = parts.slice(1);
            if (faceVertices.length < 3) continue;

            const triIndices = [];
            for (const fv of faceVertices) {
                let cachedIdx = vertexCache.get(fv);
                if (cachedIdx === undefined) {
                    const comps = fv.split('/');
                    const vIdx = parseInt(comps[0], 10) - 1;
                    const vtIdx = comps[1] ? parseInt(comps[1], 10) - 1 : -1;
                    const vnIdx = comps[2] ? parseInt(comps[2], 10) - 1 : -1;

                    const pos = rawPositions[vIdx] || [0, 0, 0];
                    const norm = (vnIdx >= 0 && rawNormals[vnIdx]) ? rawNormals[vnIdx] : null;
                    const uv = (vtIdx >= 0 && rawUvs[vtIdx]) ? rawUvs[vtIdx] : [0, 0];

                    cachedIdx = finalPositions.length / 3;
                    vertexCache.set(fv, cachedIdx);

                    finalPositions.push(pos[0], pos[1], pos[2]);
                    finalUvs.push(uv[0], uv[1]);

                    if (norm) {
                        finalNormals.push(norm[0], norm[1], norm[2]);
                    }
                }
                triIndices.push(cachedIdx);
            }

            // Triangle fan: (0, 1, 2), (0, 2, 3), ...
            for (let t = 1; t < triIndices.length - 1; t++) {
                finalIndices.push(triIndices[0], triIndices[t], triIndices[t + 1]);
            }
        }
    }

    // Auto-normalize geometry scale and center
    normalizeGeometry(finalPositions);

    // Compute normals if not supplied
    let computedNormals = finalNormals;
    if (finalNormals.length !== finalPositions.length) {
        computedNormals = computeSmoothNormals(finalPositions, finalIndices);
    }

    return {
        name,
        positions: new Float32Array(finalPositions),
        normals: new Float32Array(computedNormals),
        indices: new Uint32Array(finalIndices),
        uvs: new Float32Array(finalUvs)
    };
}

/**
 * Center and normalize mesh bounds to fit within unit radius
 */
function normalizeGeometry(positions) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
    const scale = 2.4 / maxDim;

    for (let i = 0; i < count; i++) {
        positions[i * 3 + 0] = (positions[i * 3 + 0] - cx) * scale;
        positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
        positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * scale;
    }
}

/**
 * Compute smooth vertex normals
 */
function computeSmoothNormals(positions, indices) {
    const numVerts = positions.length / 3;
    const normals = new Float32Array(numVerts * 3);
    const numTris = indices.length / 3;

    for (let t = 0; t < numTris; t++) {
        const i0 = indices[t * 3 + 0];
        const i1 = indices[t * 3 + 1];
        const i2 = indices[t * 3 + 2];

        const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

        const n = Math3D.triangleNormal(p0, p1, p2);

        for (const idx of [i0, i1, i2]) {
            normals[idx * 3 + 0] += n[0];
            normals[idx * 3 + 1] += n[1];
            normals[idx * 3 + 2] += n[2];
        }
    }

    for (let v = 0; v < numVerts; v++) {
        const nx = normals[v * 3 + 0];
        const ny = normals[v * 3 + 1];
        const nz = normals[v * 3 + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-9) {
            normals[v * 3 + 0] /= len;
            normals[v * 3 + 1] /= len;
            normals[v * 3 + 2] /= len;
        } else {
            normals[v * 3 + 1] = 1.0;
        }
    }

    return normals;
}
