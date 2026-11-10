/*==========================================================================================================================================
                                                     GPUTERRAINSTACKPIPELINE.JS
==========================================================================================================================================*/
// WebGL2 Non-Destructive GPU Terrain Layer Stack Evaluator (adapted from c7egoist/Frontier src/erosion/terrain-stack-pipeline.js
// and src/erosion/pipeline-shaders.js — Stage 1: pure 2D Mask SDF + Thin Base Surface + Procedural Landform Generators + Falloffs,
// strictly excluding Stage-2 erosion, Rock Studio, and Cliff Studio).
//
// Uses RGBA32F ping-pong FBOs with exact integer texelFetch() so OES_texture_float_linear is never required.

const FULLSCREEN_QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GPU_STACK_INIT_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSdfTex;
uniform vec4 uSlabParams; // (seaLevel, slabBottom, baseTop, shoreBevel)
uniform vec2 uStepXZ;     // (stepX, stepZ)

out vec4 outState; // (heightM, falloffPreview, waterChannel, 1.0)

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    float d2 = texelFetch(uSdfTex, coord, 0).r;
    float seaLevel = uSlabParams.x;
    float slabBottom = uSlabParams.y;
    float baseTop = uSlabParams.z;
    float shoreBevel = uSlabParams.w;
    float maxStep = max(uStepXZ.x, uStepXZ.y);

    float h = slabBottom;
    if (d2 <= 0.0) {
        if (shoreBevel > 0.5) {
            float t = clamp(-d2 / shoreBevel, 0.0, 1.0);
            float sm = t * t * (3.0 - 2.0 * t);
            h = mix(seaLevel - 0.25, baseTop, sm);
        } else {
            h = baseTop;
        }
    } else if (d2 <= maxStep * 1.55) {
        float t = clamp(d2 / (maxStep * 1.55), 0.0, 1.0);
        h = mix(seaLevel - 0.25, slabBottom, t);
    }
    outState = vec4(h, 0.0, 0.0, 1.0);
}`;

const GPU_STACK_OP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uStateTex;
uniform sampler2D uSdfTex;

uniform vec4 uBounds;     // (bx, bz, width, depth)
uniform vec4 uGridMeta;   // (nx, nz, stepX, stepZ)
uniform vec4 uSlabMeta;   // (seaLevel, slabBottom, baseTop, shoreBevel)
uniform vec4 uLayerMeta;  // (opType, combineMode, opacity, seed)
uniform vec4 uFalloff0;   // (falloffMode, distanceM, edgeFloor, recordPreview)
uniform vec4 uFalloff1;   // (noiseAmount, noiseScale, reliefScale, maxRelief)
uniform vec4 uHeightMask; // (enabled, minElev, maxElev, minSlopeDeg)
uniform vec4 uParam0;
uniform vec4 uParam1;
uniform vec4 uCurvePts[2]; // up to 4 (u, v) points for custom falloff curve

out vec4 outState;

float hash2(ivec2 p, int seed) {
    int h = p.x * 374761393 ^ p.y * 668265263 ^ (seed * 1442695041);
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return float(uint(h)) / 4294967295.0;
}

float gradNoise2D(vec2 p, int seed) {
    ivec2 i0 = ivec2(floor(p));
    vec2 f = p - vec2(i0);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float a00 = hash2(i0, seed) * 6.2831853;
    float a10 = hash2(i0 + ivec2(1, 0), seed) * 6.2831853;
    float a01 = hash2(i0 + ivec2(0, 1), seed) * 6.2831853;
    float a11 = hash2(i0 + ivec2(1, 1), seed) * 6.2831853;

    float n00 = dot(vec2(cos(a00), sin(a00)), f);
    float n10 = dot(vec2(cos(a10), sin(a10)), f - vec2(1.0, 0.0));
    float n01 = dot(vec2(cos(a01), sin(a01)), f - vec2(0.0, 1.0));
    float n11 = dot(vec2(cos(a11), sin(a11)), f - vec2(1.0, 1.0));

    return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 0.7071 + 0.5;
}

float fbm2D(vec2 p, int octs, float gain, float lac, int seed) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    float norm = 0.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octs) break;
        sum += amp * gradNoise2D(p * freq, seed + i * 131);
        norm += amp;
        amp *= gain;
        freq *= lac;
    }
    return clamp(sum / max(1e-5, norm), 0.0, 1.0);
}

float hybridMultifractal2D(vec2 p, int octs, float gain, float offset, int seed) {
    float sig = gradNoise2D(p, seed) + offset;
    float res = sig;
    float weight = clamp(sig * 0.85, 0.0, 1.0);
    float freq = 2.03;
    float amp = gain;
    float norm = 1.0 + offset;
    for (int i = 1; i < 8; i++) {
        if (i >= octs) break;
        weight = clamp(weight, 0.0, 1.0);
        sig = (gradNoise2D(p * freq, seed + i * 173) + offset) * amp;
        res += weight * sig;
        weight *= sig / max(0.12, amp) * 0.72;
        norm += amp * (1.0 + offset) * 0.65;
        freq *= 2.03;
        amp *= gain;
    }
    return clamp((res - offset * 0.8) / max(1e-4, norm * 0.78), 0.0, 1.15);
}

float ridgedMultifractal2D(vec2 p, int octs, float gain, float sharpness, int seed) {
    float sum = 0.0;
    float weight = 1.0;
    float freq = 1.0;
    float amp = 0.5;
    float norm = 0.0;
    float ex = mix(1.1, 2.5, clamp(sharpness, 0.0, 1.0));
    for (int i = 0; i < 8; i++) {
        if (i >= octs) break;
        float n = gradNoise2D(p * freq, seed + i * 211) * 2.0 - 1.0;
        float r = pow(max(0.0, 1.0 - abs(n)), ex) * weight;
        weight = clamp(r * 1.65, 0.0, 1.0);
        sum += r * amp;
        norm += amp;
        freq *= 2.07;
        amp *= gain;
    }
    return clamp(sum / max(1e-5, norm * 0.78), 0.0, 1.15);
}

float voronoi2D(vec2 p, int variant, float jitter, float sharpness, int seed) {
    ivec2 cell = ivec2(floor(p));
    vec2 f = p - vec2(cell);
    float d1 = 1e9;
    float d2 = 1e9;
    float cVal = 0.5;
    for (int dz = -1; dz <= 1; dz++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 nc = cell + ivec2(dx, dz);
            vec2 rnd = (vec2(hash2(nc, seed), hash2(nc, seed + 59)) - 0.5) * jitter + 0.5;
            float dist = length(vec2(float(dx), float(dz)) + rnd - f);
            if (dist < d1) {
                d2 = d1;
                d1 = dist;
                cVal = hash2(nc, seed + 199);
            } else if (dist < d2) {
                d2 = dist;
            }
        }
    }
    float edge = clamp(d2 - d1, 0.0, 1.0);
    if (variant == 0) {
        float rim = smoothstep(0.02, mix(0.28, 0.05, sharpness), edge);
        return (0.35 + 0.65 * cVal) * rim;
    }
    if (variant == 1) {
        return pow(clamp(1.0 - edge * 1.45, 0.0, 1.0), mix(1.0, 2.6, sharpness));
    }
    if (variant == 2) {
        float r = d1 * 1.65;
        float bowl = -(1.0 - smoothstep(0.0, 0.72, r)) * (1.0 - r * r * 0.75) * 0.65;
        float rim = exp(-pow((r - 0.74) * 5.0, 2.0)) * 0.55;
        return clamp(0.38 + bowl + rim, 0.0, 1.0);
    }
    return pow(clamp(1.0 - d1 * 1.15, 0.0, 1.0), mix(0.7, 1.8, sharpness));
}

float evalFalloff(float inlandDist, float boxDist, vec2 wxz, int seed) {
    int mode = int(uFalloff0.x + 0.5);
    if (mode == 1) return 1.0; // hard / none -> 100% full influence right to boundary!

    float distSpan = max(4.0, uFalloff0.y);
    float edgeFloor = clamp(uFalloff0.z, 0.0, 1.0);
    float metric = (mode == 5) ? max(0.0, boxDist) : max(0.0, inlandDist);
    float t = clamp(metric / distSpan, 0.0, 1.0);

    float noiseAmt = clamp(uFalloff1.x, 0.0, 1.0);
    if (noiseAmt > 0.005 && t > 0.001 && t < 0.999) {
        float ns = max(0.2, uFalloff1.y) * 0.0045;
        float n = fbm2D(wxz * ns, 3, 0.5, 2.02, seed + 911) - 0.5;
        float env = 4.0 * t * (1.0 - t);
        t = clamp(t + n * noiseAmt * 0.65 * env, 0.0, 1.0);
    }

    float shape = t;
    if (mode == 0 || mode == 5) {
        shape = t * t * (3.0 - 2.0 * t);
    } else if (mode == 2) {
        shape = pow(t, 2.25);
    } else if (mode == 3) {
        shape = 1.0 - pow(1.0 - t, 3.6);
    } else if (mode == 4) {
        float rise = smoothstep(0.0, 0.28, t);
        float decay = 1.0 - 0.72 * smoothstep(0.32, 1.0, t);
        return clamp(mix(edgeFloor, 1.0, rise * decay), 0.0, 1.0);
    } else if (mode == 6) {
        vec2 pts[4];
        pts[0] = uCurvePts[0].xy; pts[1] = uCurvePts[0].zw;
        pts[2] = uCurvePts[1].xy; pts[3] = uCurvePts[1].zw;
        for (int i = 0; i < 3; i++) {
            if (t <= pts[i + 1].x || i == 2) {
                float loc = clamp((t - pts[i].x) / max(1e-4, pts[i + 1].x - pts[i].x), 0.0, 1.0);
                float h = loc * loc * (3.0 - 2.0 * loc);
                return clamp(mix(pts[i].y, pts[i + 1].y, h), 0.0, 1.0);
            }
        }
    }
    return clamp(edgeFloor + (1.0 - edgeFloor) * shape, 0.0, 1.0);
}

void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    int nx = int(uGridMeta.x + 0.5);
    int nz = int(uGridMeta.y + 0.5);
    float stepX = uGridMeta.z;
    float stepZ = uGridMeta.w;

    vec4 st = texelFetch(uStateTex, c, 0);
    float d2 = texelFetch(uSdfTex, c, 0).r;
    if (d2 > max(stepX, stepZ) * 1.1) {
        outState = st;
        return;
    }

    vec2 wxz = vec2(uBounds.x + float(c.x) * stepX, uBounds.y + float(c.y) * stepZ);
    float boxDz = min(wxz.y - uBounds.y, uBounds.y + uBounds.w - wxz.y);
    float boxEdgeDist = min(boxDz, min(wxz.x - uBounds.x, uBounds.x + uBounds.z - wxz.x));
    float inlandDist = max(0.0, -d2);

    int opType = int(uLayerMeta.x + 0.5);
    int combineMode = int(uLayerMeta.y + 0.5);
    float opacity = uLayerMeta.z;
    int seed = int(uLayerMeta.w + 0.5);

    float fallW = evalFalloff(inlandDist, boxEdgeDist, wxz, seed);
    if (uFalloff0.w > 0.5) st.g = fallW;

    float maskW = fallW * opacity;
    if (maskW <= 1e-4) {
        outState = st;
        return;
    }

    float curH = st.r;
    if (uHeightMask.x > 0.5) {
        float hL = texelFetch(uStateTex, ivec2(max(0, c.x - 1), c.y), 0).r;
        float hR = texelFetch(uStateTex, ivec2(min(nx - 1, c.x + 1), c.y), 0).r;
        float hD = texelFetch(uStateTex, ivec2(c.x, max(0, c.y - 1)), 0).r;
        float hU = texelFetch(uStateTex, ivec2(c.x, min(nz - 1, c.y + 1)), 0).r;
        vec2 grad = vec2((hR - hL) / (2.0 * stepX), (hU - hD) / (2.0 * stepZ));
        float slopeDeg = atan(length(grad)) * 57.2957795;
        float ew = smoothstep(uHeightMask.y - 15.0, uHeightMask.y + 5.0, curH) *
                   (1.0 - smoothstep(uHeightMask.z - 5.0, uHeightMask.z + 15.0, curH));
        float sw = smoothstep(uHeightMask.w - 4.0, uHeightMask.w + 2.0, slopeDeg);
        maskW *= ew * (uHeightMask.w > 0.5 ? sw : 1.0);
        if (maskW <= 1e-4) {
            outState = st;
            return;
        }
    }

    float slabBottom = uSlabMeta.y;
    float baseTop = uSlabMeta.z;
    float shoreBevel = uSlabMeta.w;
    float reliefScale = uFalloff1.z;
    float maxRelief = max(40.0, uFalloff1.w);
    float refSpan = max(400.0, min(uBounds.z, uBounds.w));

    // Terrace / Dipping Strata operator (opType == 8)
    if (opType == 8) {
        float beds = max(2.0, uParam0.x);
        float str = clamp(uParam0.y, 0.0, 0.98);
        float dipRad = uParam0.z * 0.01745329;
        float strikeRad = uParam0.w * 0.01745329;
        float warpAmt = uParam1.x;
        vec2 dipDir = vec2(-sin(strikeRad), cos(strikeRad));
        float wp = warpAmt > 0.005 ? (fbm2D(wxz * 0.006, 3, 0.5, 2.02, seed + 307) - 0.5) * 28.0 * warpAmt : 0.0;
        float stratM = curH + dot(wxz, dipDir) * tan(dipRad) + wp;
        float ph = (stratM / maxRelief) * beds;
        float fl = floor(ph);
        float fr = ph - fl;
        float stepFr = mix(fr, smoothstep(0.16, 0.84, fr), str);
        float targetH = ((fl + stepFr) / beds) * maxRelief - dot(wxz, dipDir) * tan(dipRad) - wp;
        st.r = max(slabBottom + 0.5, mix(curH, targetH, maskW * str));
        outState = st;
        return;
    }

    float scale = max(0.2, uParam0.y);
    vec2 nc = (wxz / refSpan) * scale;
    float warpAmt = uParam1.y;
    if (warpAmt > 0.005) {
        float wpx = fbm2D(nc * 1.35 + vec2(7.1, 3.4), 3, 0.5, 2.02, seed + 701) - 0.5;
        float wpz = fbm2D(nc * 1.35 + vec2(19.8, 11.2), 3, 0.5, 2.02, seed + 809) - 0.5;
        nc += vec2(wpx, wpz) * warpAmt * 0.85;
    }

    float sig = 0.0;
    if (opType == 0) {
        // Fractal Noise (fBm)
        sig = fbm2D(nc, int(uParam0.z + 0.5), clamp(uParam0.w, 0.2, 0.85), max(1.4, uParam1.x), seed);
    } else if (opType == 1) {
        // Hybrid Multifractal
        sig = hybridMultifractal2D(nc, int(uParam0.z + 0.5), clamp(uParam0.w, 0.2, 0.85), uParam1.x, seed);
    } else if (opType == 2) {
        // Ridge Noise
        float az = uParam1.x * 0.01745329;
        float aniso = max(0.5, uParam1.z);
        vec2 rot = vec2(nc.x * cos(az) + nc.y * sin(az), (-nc.x * sin(az) + nc.y * cos(az)) * aniso);
        sig = ridgedMultifractal2D(rot, int(uParam0.z + 0.5), 0.55, uParam0.w, seed);
    } else if (opType == 3) {
        // Voronoi / Cellular
        sig = voronoi2D(nc, int(uParam0.z + 0.5), uParam0.w, uParam1.x, seed);
    } else if (opType == 4) {
        // Billow & Folded Hills
        int octs = int(uParam0.z + 0.5);
        float az = uParam1.x * 0.01745329;
        vec2 rot = vec2(nc.x * cos(az) + nc.y * sin(az), -nc.x * sin(az) + nc.y * cos(az));
        float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
        for (int i = 0; i < 7; i++) {
            if (i >= octs) break;
            float n = abs(gradNoise2D(rot * freq, seed + i * 89) * 2.0 - 1.0);
            sum += n * amp; norm += amp; freq *= 2.02; amp *= 0.5;
        }
        sig = sum / max(1e-5, norm);
    } else if (opType == 5) {
        // Aeolian Dune Field (asymmetric windward stoss & leeward slip-face crests)
        float az = uParam0.z * 0.01745329;
        float asym = clamp(uParam0.w, 0.52, 0.92);
        float sinu = uParam1.x;
        vec2 dir = vec2(cos(az), sin(az));
        vec2 perp = vec2(-dir.y, dir.x);
        float across = dot(nc, perp);
        float bend = sin(across * 2.6 + float(seed % 97) * 0.1) * sinu * 0.35;
        float ph = fract(dot(nc, dir) * 1.65 + bend);
        float stoss = smoothstep(0.0, asym, ph);
        float lee = 1.0 - smoothstep(asym, min(0.99, asym + 0.22), ph);
        sig = stoss * lee;
    } else if (opType == 6) {
        // Tectonic Fault Escarpment
        float az = uParam0.z * 0.01745329;
        float sharp = clamp(uParam0.w, 0.05, 0.98);
        float off = uParam1.x;
        vec2 center = vec2(uBounds.x + uBounds.z * 0.5, uBounds.y + uBounds.w * 0.5);
        vec2 rel = (wxz - center) / (0.5 * refSpan);
        vec2 perp = vec2(-sin(az), cos(az));
        float w = warpAmt > 0.005 ? (fbm2D(rel * 2.2, 3, 0.5, 2.02, seed + 409) - 0.5) * 0.45 * warpAmt : 0.0;
        float coord = dot(rel, perp) - off + w;
        float trans = mix(0.45, 0.035, sharp);
        float scarp = smoothstep(-trans, trans, coord);
        float dipSlope = clamp(1.0 - max(0.0, coord) * 0.36, 0.25, 1.0);
        sig = scarp * dipSlope;
    } else if (opType == 7) {
        // Volcanic Cone & Caldera
        vec2 center = vec2(uBounds.x + uBounds.z * 0.5, uBounds.y + uBounds.w * 0.5);
        vec2 rel = (wxz - center) / (0.5 * refSpan);
        if (warpAmt > 0.005) {
            rel += (vec2(fbm2D(rel * 2.1, 3, 0.5, 2.02, seed + 521), fbm2D(rel * 2.1 + 9.4, 3, 0.5, 2.02, seed + 613)) - 0.5) * 0.28 * warpAmt;
        }
        float r = length(rel) / max(0.18, uParam0.y);
        float cone = exp(-r * r * 1.85) * 1.12;
        float craterW = mix(18.0, 7.5, clamp(uParam1.x, 0.0, 1.0));
        float crater = exp(-r * r * craterW) * clamp(uParam0.z, 0.0, 1.2);
        float gullies = ridgedMultifractal2D(rel * 2.8, 4, 0.52, 0.65, seed + 77) * 0.16 * smoothstep(0.08, 0.65, r);
        sig = max(0.0, cone - crater + gullies);
    }

    float delta = sig * uParam0.x * reliefScale;
    float targetH = curH + delta;
    if (combineMode == 1) targetH = max(slabBottom + 0.5, curH - abs(delta));
    else if (combineMode == 2) targetH = max(curH, baseTop + delta);
    else if (combineMode == 3) targetH = min(curH, baseTop + delta);
    else if (combineMode == 4) targetH = baseTop + delta;
    else if (combineMode == 5) targetH = baseTop + (curH - baseTop) * clamp(sig * 1.35, 0.0, 2.0);

    int fallMode = int(uFalloff0.x + 0.5);
    float shoreProtect = (fallMode == 1)
        ? (d2 <= 0.0 ? 1.0 : 0.0)
        : (shoreBevel > 0.5 ? smoothstep(0.0, min(shoreBevel, 22.0), inlandDist) : 1.0);

    st.r = max(slabBottom + 0.5, mix(curH, targetH, maskW * shoreProtect));
    outState = st;
}`;

function CompileProgram(Gl, VsSrc, FsSrc)
{
    const Compile = (Type, Src) =>
    {
        const S = Gl.createShader(Type);
        Gl.shaderSource(S, Src);
        Gl.compileShader(S);
        if (!Gl.getShaderParameter(S, Gl.COMPILE_STATUS))
        {
            const Err = Gl.getShaderInfoLog(S);
            Gl.deleteShader(S);
            throw new Error(`GpuTerrainStackPipeline GLSL error: ${Err}`);
        }
        return S;
    };
    const Vs = Compile(Gl.VERTEX_SHADER, VsSrc);
    const Fs = Compile(Gl.FRAGMENT_SHADER, FsSrc);
    const P = Gl.createProgram();
    Gl.attachShader(P, Vs);
    Gl.attachShader(P, Fs);
    Gl.linkProgram(P);
    Gl.deleteShader(Vs);
    Gl.deleteShader(Fs);
    if (!Gl.getProgramParameter(P, Gl.LINK_STATUS))
    {
        throw new Error(`GpuTerrainStackPipeline link error: ${Gl.getProgramInfoLog(P)}`);
    }
    return P;
}

const GPU_OP_IDS = {
    fractal: 0,
    multifractal: 1,
    ridged: 2,
    voronoi: 3,
    billow: 4,
    dunes: 5,
    escarpment: 6,
    caldera: 7,
    terrace: 8
};

const FALLOFF_IDS = {
    soft: 0,
    hard: 1,
    none: 1,
    continental: 2,
    plateau: 3,
    rim: 4,
    bounds: 5,
    custom: 6
};

const COMBINE_IDS = {
    add: 0,
    sub: 1,
    max: 2,
    min: 3,
    lerp: 4,
    multiply: 5
};

export class GpuTerrainStackPipeline
{
    constructor(Gl)
    {
        this.gl = Gl || null;
        this.supported = false;
        this.allocW = 0;
        this.allocH = 0;

        if (!Gl) return;
        const FloatExt = Gl.getExtension('EXT_color_buffer_float');
        if (!FloatExt) return;

        try
        {
            this.vao = Gl.createVertexArray();
            this.initProg = CompileProgram(Gl, FULLSCREEN_QUAD_VS, GPU_STACK_INIT_FS);
            this.opProg = CompileProgram(Gl, FULLSCREEN_QUAD_VS, GPU_STACK_OP_FS);
            this.sdfTex = Gl.createTexture();
            this.pingTex = [Gl.createTexture(), Gl.createTexture()];
            this.pingFbo = [Gl.createFramebuffer(), Gl.createFramebuffer()];
            this.readBuf = new Float32Array(0);
            this.supported = true;
        }
        catch (Err)
        {
            console.warn('GpuTerrainStackPipeline fallback to CPU:', Err);
            this.supported = false;
        }
    }

    _ensureTargets(Nx, Nz)
    {
        const Gl = this.gl;
        if (this.allocW === Nx && this.allocH === Nz) return;
        this.allocW = Nx;
        this.allocH = Nz;

        Gl.bindTexture(Gl.TEXTURE_2D, this.sdfTex);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MIN_FILTER, Gl.NEAREST);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MAG_FILTER, Gl.NEAREST);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_S, Gl.CLAMP_TO_EDGE);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_T, Gl.CLAMP_TO_EDGE);
        Gl.texImage2D(Gl.TEXTURE_2D, 0, Gl.R32F, Nx, Nz, 0, Gl.RED, Gl.FLOAT, null);

        for (let I = 0; I < 2; ++I)
        {
            Gl.bindTexture(Gl.TEXTURE_2D, this.pingTex[I]);
            Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MIN_FILTER, Gl.NEAREST);
            Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MAG_FILTER, Gl.NEAREST);
            Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_S, Gl.CLAMP_TO_EDGE);
            Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_T, Gl.CLAMP_TO_EDGE);
            Gl.texImage2D(Gl.TEXTURE_2D, 0, Gl.RGBA32F, Nx, Nz, 0, Gl.RGBA, Gl.FLOAT, null);

            Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.pingFbo[I]);
            Gl.framebufferTexture2D(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Gl.TEXTURE_2D, this.pingTex[I], 0);
        }
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        this.readBuf = new Float32Array(Nx * Nz * 4);
    }

    canEvaluateStackPureGpu(Stack)
    {
        if (!this.supported) return false;
        for (const Lyr of Stack)
        {
            if (!Lyr || Lyr.enabled === false) continue;
            if (!(Lyr.type in GPU_OP_IDS)) return false;
        }
        return true;
    }

    evaluatePrefixOnGpu(World, Region, Sdf2D, Nx, Nz, StepX, StepZ, SlabBottom, BaseTop, ShoreBevel, LayersPrefix, PreviewLayerId)
    {
        if (!this.supported) return null;
        const Gl = this.gl;
        const PrevViewport = Gl.getParameter(Gl.VIEWPORT);
        const PrevBlend = Gl.isEnabled(Gl.BLEND);
        const PrevDepth = Gl.isEnabled(Gl.DEPTH_TEST);

        this._ensureTargets(Nx, Nz);
        Gl.disable(Gl.BLEND);
        Gl.disable(Gl.DEPTH_TEST);
        Gl.viewport(0, 0, Nx, Nz);
        Gl.bindVertexArray(this.vao);

        Gl.activeTexture(Gl.TEXTURE0);
        Gl.bindTexture(Gl.TEXTURE_2D, this.sdfTex);
        Gl.texSubImage2D(Gl.TEXTURE_2D, 0, 0, 0, Nx, Nz, Gl.RED, Gl.FLOAT, Sdf2D);

        // Pass 0: Thin Base Surface Initialization
        let CurIdx = 0;
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.pingFbo[CurIdx]);
        Gl.useProgram(this.initProg);
        Gl.uniform1i(Gl.getUniformLocation(this.initProg, 'uSdfTex'), 0);
        Gl.uniform4f(Gl.getUniformLocation(this.initProg, 'uSlabParams'), World.seaLevel ?? 0.0, SlabBottom, BaseTop, ShoreBevel);
        Gl.uniform2f(Gl.getUniformLocation(this.initProg, 'uStepXZ'), StepX, StepZ);
        Gl.drawArrays(Gl.TRIANGLES, 0, 3);

        // Non-destructive bottom-to-top generator passes
        const B = Region.bounds;
        const ReliefScale = Number(Region.reliefScale ?? 1.0);
        const MaxRelief = Number(Region.maxRelief ?? 280.0);

        Gl.useProgram(this.opProg);
        Gl.uniform1i(Gl.getUniformLocation(this.opProg, 'uSdfTex'), 0);
        Gl.uniform1i(Gl.getUniformLocation(this.opProg, 'uStateTex'), 1);
        Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uBounds'), B.x, B.z, B.width, B.depth);
        Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uGridMeta'), Nx, Nz, StepX, StepZ);
        Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uSlabMeta'), World.seaLevel ?? 0.0, SlabBottom, BaseTop, ShoreBevel);

        for (let I = 0; I < LayersPrefix.length; ++I)
        {
            const Lyr = LayersPrefix[I];
            if (!Lyr || Lyr.enabled === false) continue;
            const OpId = GPU_OP_IDS[Lyr.type];
            if (OpId === undefined) break;

            const NextIdx = 1 - CurIdx;
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.pingFbo[NextIdx]);
            Gl.activeTexture(Gl.TEXTURE1);
            Gl.bindTexture(Gl.TEXTURE_2D, this.pingTex[CurIdx]);

            const Fall = Lyr.falloff || {};
            const FallModeId = FALLOFF_IDS[Fall.mode || 'soft'] ?? 0;
            const RecordPrev = (Lyr.id === PreviewLayerId) || (!PreviewLayerId && I === Region.stack.length - 1) ? 1.0 : 0.0;
            const CombineId = COMBINE_IDS[Lyr.combine || 'add'] ?? 0;

            Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uLayerMeta'), OpId, CombineId, Lyr.opacity ?? 1.0, (Lyr.seed | 0) || 4029);
            Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uFalloff0'), FallModeId, Fall.distance ?? 260.0, Fall.edgeFloor ?? 0.0, RecordPrev);
            Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uFalloff1'), Fall.noiseAmount ?? 0.0, Fall.noiseScale ?? 1.0, ReliefScale, MaxRelief);

            const Hm = Lyr.heightMask || {};
            Gl.uniform4f(Gl.getUniformLocation(this.opProg, 'uHeightMask'), Hm.enabled ? 1.0 : 0.0, Hm.minElev ?? 0.0, Hm.maxElev ?? 400.0, Hm.minSlope ?? 0.0);

            const Pts = Fall.points || [[0, 0], [0.35, 0.28], [0.72, 0.84], [1, 1]];
            Gl.uniform4fv(Gl.getUniformLocation(this.opProg, 'uCurvePts'), new Float32Array([
                Pts[0]?.[0] ?? 0, Pts[0]?.[1] ?? 0, Pts[1]?.[0] ?? 0.35, Pts[1]?.[1] ?? 0.28,
                Pts[2]?.[0] ?? 0.72, Pts[2]?.[1] ?? 0.84, Pts[3]?.[0] ?? 1.0, Pts[3]?.[1] ?? 1.0
            ]));

            const [P0, P1] = PackLayerUniforms(Lyr);
            Gl.uniform4fv(Gl.getUniformLocation(this.opProg, 'uParam0'), P0);
            Gl.uniform4fv(Gl.getUniformLocation(this.opProg, 'uParam1'), P1);

            Gl.drawArrays(Gl.TRIANGLES, 0, 3);
            CurIdx = NextIdx;
        }

        Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.pingFbo[CurIdx]);
        Gl.readPixels(0, 0, Nx, Nz, Gl.RGBA, Gl.FLOAT, this.readBuf);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        Gl.bindVertexArray(null);

        Gl.viewport(PrevViewport[0], PrevViewport[1], PrevViewport[2], PrevViewport[3]);
        if (PrevBlend) Gl.enable(Gl.BLEND);
        if (PrevDepth) Gl.enable(Gl.DEPTH_TEST);

        const Count = Nx * Nz;
        const Heights = new Float32Array(Count);
        const FalloffMap = new Float32Array(Count);
        for (let K = 0; K < Count; ++K)
        {
            Heights[K] = this.readBuf[K * 4];
            FalloffMap[K] = this.readBuf[K * 4 + 1];
        }
        return { heights: Heights, falloffMap: FalloffMap };
    }
}

function PackLayerUniforms(Lyr)
{
    const P0 = new Float32Array(4);
    const P1 = new Float32Array(4);
    switch (Lyr.type)
    {
        case 'fractal':
            P0[0] = Lyr.amplitude ?? 140.0;
            P0[1] = Lyr.scale ?? 2.4;
            P0[2] = Lyr.octaves ?? 6;
            P0[3] = Lyr.gain ?? 0.5;
            P1[0] = Lyr.lacunarity ?? 2.02;
            P1[1] = Lyr.warp ?? 0.28;
            break;
        case 'multifractal':
            P0[0] = Lyr.amplitude ?? 185.0;
            P0[1] = Lyr.scale ?? 2.2;
            P0[2] = Lyr.octaves ?? 6;
            P0[3] = Lyr.gain ?? 0.52;
            P1[0] = Lyr.valleyOffset ?? 0.24;
            P1[1] = Lyr.warp ?? 0.32;
            break;
        case 'ridged':
            P0[0] = Lyr.amplitude ?? 135.0;
            P0[1] = Lyr.scale ?? 2.6;
            P0[2] = Lyr.octaves ?? 6;
            P0[3] = Lyr.sharpness ?? 0.72;
            P1[0] = Lyr.azimuth ?? 32.0;
            P1[1] = Lyr.warp ?? 0.38;
            P1[2] = Lyr.anisotropy ?? 1.28;
            break;
        case 'voronoi':
            P0[0] = Lyr.amplitude ?? 140.0;
            P0[1] = Lyr.scale ?? 3.1;
            P0[2] = Lyr.variant ?? 0;
            P0[3] = Lyr.jitter ?? 0.82;
            P1[0] = Lyr.sharpness ?? 0.74;
            P1[1] = Lyr.warp ?? 0.22;
            break;
        case 'billow':
            P0[0] = Lyr.amplitude ?? 68.0;
            P0[1] = Lyr.scale ?? 3.4;
            P0[2] = Lyr.octaves ?? 5;
            P1[0] = Lyr.azimuth ?? 45.0;
            P1[1] = Lyr.warp ?? 0.2;
            break;
        case 'dunes':
            P0[0] = Lyr.amplitude ?? 46.0;
            P0[1] = Lyr.scale ?? 4.2;
            P0[2] = Lyr.azimuth ?? 55.0;
            P0[3] = Lyr.asymmetry ?? 0.74;
            P1[0] = Lyr.sinuosity ?? 0.42;
            P1[1] = Lyr.warp ?? 0.18;
            break;
        case 'escarpment':
            P0[0] = Lyr.amplitude ?? 130.0;
            P0[1] = 1.0;
            P0[2] = Lyr.azimuth ?? 28.0;
            P0[3] = Lyr.sharpness ?? 0.78;
            P1[0] = Lyr.offset ?? 0.0;
            P1[1] = Lyr.warp ?? 0.34;
            break;
        case 'caldera':
            P0[0] = Lyr.amplitude ?? 190.0;
            P0[1] = Lyr.radiusFrac ?? 0.76;
            P0[2] = Lyr.craterDepth ?? 0.56;
            P1[0] = Lyr.rimSharpness ?? 0.65;
            P1[1] = Lyr.warp ?? 0.28;
            break;
        case 'terrace':
            P0[0] = Lyr.bedCount ?? 9;
            P0[1] = Lyr.strength ?? 0.76;
            P0[2] = Lyr.dipDeg ?? 4.0;
            P0[3] = Lyr.strikeDeg ?? 25.0;
            P1[0] = Lyr.warp ?? 0.22;
            break;
    }
    return [P0, P1];
}
