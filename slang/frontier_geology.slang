// ===========================================================================
//  frontier_geology.slang — stratigraphy, noise, hardness, rock colour.
//
//  Slang port of src/shaders/common.wgsl (noise section) + geology.wgsl.
//  See docs/SLATE_INTEGRATION.md for the WGSL -> Slang mapping table.
//
//  This is the module that makes the terrain read as geology rather than as
//  noise: one analytic stratigraphic field drives BOTH erosion resistance and
//  albedo, so the colour banding and the cliff/bench geometry always agree.
// ===========================================================================

module frontier_geology;

import frontier_params;

// ---------------------------------------------------------------------------
//  Hashing
// ---------------------------------------------------------------------------
public float hash11(float x)
{
    float h = frac(x * 0.1031);
    h *= h + 33.33;
    h *= h + h;
    return frac(h);
}

public float2 hash22(float2 p)
{
    float3 p3 = frac(float3(p.x, p.y, p.x) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return frac((p3.xx + p3.yz) * p3.zy);
}

public float3 hash33(float3 p)
{
    float3 p3 = frac(p * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return frac((p3.xxy + p3.yxx) * p3.zyx);
}

// ---------------------------------------------------------------------------
//  Gradient noise
// ---------------------------------------------------------------------------
public float gnoise2(float2 p)
{
    float2 i = floor(p);
    float2 f = p - i;
    float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float2 ga = normalize(hash22(i + float2(0, 0)) * 2.0 - 1.0);
    float2 gb = normalize(hash22(i + float2(1, 0)) * 2.0 - 1.0);
    float2 gc = normalize(hash22(i + float2(0, 1)) * 2.0 - 1.0);
    float2 gd = normalize(hash22(i + float2(1, 1)) * 2.0 - 1.0);

    float va = dot(ga, f - float2(0, 0));
    float vb = dot(gb, f - float2(1, 0));
    float vc = dot(gc, f - float2(0, 1));
    float vd = dot(gd, f - float2(1, 1));

    return lerp(lerp(va, vb, u.x), lerp(vc, vd, u.x), u.y) * 1.4142;
}

public float gnoise3(float3 p)
{
    float3 i = floor(p);
    float3 f = p - i;
    float3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float n = 0.0;
    [unroll]
    for (int dz = 0; dz < 2; dz++)
    [unroll]
    for (int dy = 0; dy < 2; dy++)
    [unroll]
    for (int dx = 0; dx < 2; dx++)
    {
        float3 o = float3(dx, dy, dz);
        float3 g = normalize(hash33(i + o) * 2.0 - 1.0);
        float3 w = lerp(1.0 - u, u, o);
        n += dot(g, f - o) * w.x * w.y * w.z;
    }
    return n * 1.1547;
}

public float fbm2(float2 p, int oct)
{
    float s = 0.0, a = 0.5, nrm = 0.0;
    float2 q = p;
    for (int i = 0; i < oct; i++)
    {
        s += a * gnoise2(q);
        nrm += a;
        q = q * 2.03 + float2(11.7, -3.1);
        a *= 0.5;
    }
    return s / max(nrm, 1e-5);
}

public float fbm3(float3 p, int oct)
{
    float s = 0.0, a = 0.5, nrm = 0.0;
    float3 q = p;
    for (int i = 0; i < oct; i++)
    {
        s += a * gnoise3(q);
        nrm += a;
        q = q * 2.02 + float3(7.3, -2.9, 4.1);
        a *= 0.5;
    }
    return s / max(nrm, 1e-5);
}

public float ridged2(float2 p, int oct)
{
    float s = 0.0, a = 0.5, nrm = 0.0;
    float2 q = p;
    for (int i = 0; i < oct; i++)
    {
        float n = 1.0 - abs(gnoise2(q));
        s += a * n * n;
        nrm += a;
        q = q * 2.07 + float2(5.2, 1.3);
        a *= 0.5;
    }
    return s / max(nrm, 1e-5);
}

public float ridged3(float3 p, int oct)
{
    float s = 0.0, a = 0.5, nrm = 0.0;
    float3 q = p;
    for (int i = 0; i < oct; i++)
    {
        float n = 1.0 - abs(gnoise3(q));
        s += a * n * n;
        nrm += a;
        q = q * 2.05 + float3(3.7, 8.1, -1.7);
        a *= 0.5;
    }
    return s / max(nrm, 1e-5);
}

/// Distance to the nearest Voronoi cell boundary — the joint/fracture network.
public float voronoiEdge(float2 p, float jitter)
{
    float2 ip = floor(p);
    float2 fp = p - ip;

    float minD = 1e9;
    float2 minPt = float2(0.0);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
    {
        float2 o = float2(i, j);
        float2 pt = o + 0.5 + (hash22(ip + o) - 0.5) * jitter;
        float2 dv = pt - fp;
        float d = dot(dv, dv);
        if (d < minD) { minD = d; minPt = pt; }
    }

    float e = 1e9;
    for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++)
    {
        float2 o = float2(i, j);
        float2 pt = o + 0.5 + (hash22(ip + o) - 0.5) * jitter;
        float2 diff = pt - minPt;
        float l = length(diff);
        if (l > 1e-4)
            e = min(e, dot(0.5 * (minPt + pt) - fp, diff / l));
    }
    return e;
}

// ---------------------------------------------------------------------------
//  Stratigraphy
// ---------------------------------------------------------------------------

/// "How far up the rock column am I" — constant along a bedding plane.
public float strataCoord(float3 p, Params U)
{
    float az  = radians(U.strataAzim);
    float dip = radians(U.strataDip);
    float3 n = float3(sin(az) * sin(dip), cos(dip), cos(az) * sin(dip));

    float s = dot(p, n);
    s += U.foldAmp * fbm2(p.xz * U.foldFreq + float2(U.seed * 3.1, U.seed * 1.7), 3);
    s += U.strataWarp * fbm3(p * U.strataWarpFreq + float3(U.seed * 0.7), 3);
    return s;
}

/// Intrinsic hardness of the bed at stratigraphic height `s`, 0..1.
public float bedHardness(float s, Params U)
{
    float t = s / max(U.bedThickness, 0.5);
    float bi = floor(t);
    float fr = t - bi;

    float r0 = hash11(bi + U.seed * 13.7);
    float r1 = hash11(bi + 1.0 + U.seed * 13.7);

    float thr = 1.0 - saturate(U.capFrac);
    float h0 = r0 > thr ? 0.62 + 0.38 * (r0 - thr) / max(1.0 - thr, 1e-3) : r0 * thr * 0.55;
    float h1 = r1 > thr ? 0.62 + 0.38 * (r1 - thr) / max(1.0 - thr, 1e-3) : r1 * thr * 0.55;

    float w = 0.06;
    float m = smoothstep(1.0 - w, 1.0, fr);
    float h = lerp(h0, h1, m);

    h += 0.05 * sin(t * TAU * 3.0 + hash11(bi) * TAU);
    return saturate(h);
}

/// 1 in intact rock, falling toward 0 on a fracture plane.
public float jointFactor(float3 p, Params U)
{
    float2 q = p.xz * U.jointDensity;

    float e1 = voronoiEdge(q + float2(U.seed * 2.3, U.seed * 5.1), U.jointJitter);

    const float r = 0.7071;
    float2 q2 = float2(q.x * r - q.y * r, q.x * r + q.y * r) * 1.63;
    float e2 = voronoiEdge(q2 + float2(U.seed * 1.1, U.seed * 7.7), U.jointJitter);

    float vfade = 0.65 + 0.35 * fbm3(p * 0.006 + float3(0.0, U.seed, 0.0), 2);

    const float w = 0.055;
    float j1 = smoothstep(0.0, w, e1);
    float j2 = smoothstep(0.0, w * 0.8, e2);
    float j = min(j1, lerp(1.0, j2, 0.6));

    return lerp(1.0, j, saturate(U.jointDepth) * vfade);
}

/// Full erosional resistance, 0..1.
public float rockHardness(float3 p, Params U)
{
    float s = strataCoord(p, U);
    float h = bedHardness(s, U);

    h = saturate(0.5 + (h - 0.5) * U.hardContrast);
    h *= jointFactor(p, U);

    // Crystalline basement: hard, unlayered, stops the river cutting forever.
    float by = U.basementY * WORLD_H;
    float bmix = 1.0 - smoothstep(by - 22.0, by + 22.0, p.y);
    float basement = U.basementHard * (0.82 + 0.18 * fbm3(p * 0.012, 3));
    h = lerp(h, max(h, basement), bmix);

    return saturate(h);
}

/// Cheap variant for hot loops — skips the joint Voronoi.
public float rockHardnessFast(float3 p, Params U)
{
    float s = strataCoord(p, U);
    float h = bedHardness(s, U);
    h = saturate(0.5 + (h - 0.5) * U.hardContrast);
    float by = U.basementY * WORLD_H;
    float bmix = 1.0 - smoothstep(by - 22.0, by + 22.0, p.y);
    return saturate(lerp(h, max(h, U.basementHard), bmix));
}

// ---------------------------------------------------------------------------
//  Rock colour — same field as the hardness, so form and colour always agree.
// ---------------------------------------------------------------------------
public float3 rockAlbedo(float3 p, float hardness, float sediment, Params U)
{
    float s = strataCoord(p, U);
    float t = s / max(U.bedThickness, 0.5);
    float bi = floor(t);

    float r1 = hash11(bi * 2.17 + U.seed * 4.3);
    float r2 = hash11(bi * 5.71 + U.seed * 9.1);

    // Colorado Plateau palette.
    const float3 redBed   = float3(0.396, 0.180, 0.118); // Moenkopi mudstone
    const float3 orangeBd = float3(0.596, 0.318, 0.180); // Wingate / Kayenta
    const float3 buffBed  = float3(0.678, 0.569, 0.416); // Navajo sandstone
    const float3 paleBed  = float3(0.749, 0.722, 0.639); // Kaibab limestone
    const float3 greyBed  = float3(0.400, 0.388, 0.365); // Bright Angel shale

    float3 c = lerp(redBed, orangeBd, r1);
    c = lerp(c, buffBed, smoothstep(0.35, 0.75, hardness));
    c = lerp(c, paleBed, smoothstep(0.65, 0.95, hardness) * r2);
    c = lerp(c, greyBed, (1.0 - smoothstep(0.1, 0.55, hardness)) * (1.0 - r1) * 0.5);

    float3 variation = lerp(float3(luma(c)), c, saturate(U.stratColor));
    c = lerp(float3(luma(c)) * float3(1.05, 0.98, 0.92), variation, saturate(U.stratColor));

    // Iron oxide — the red in red rock.
    float ironMask = saturate(fbm3(p * 0.018 + float3(U.seed), 3) * 0.5 + 0.5);
    c = lerp(c, float3(0.52, 0.21, 0.10),
             saturate(U.ironStain) * ironMask * 0.45 * (1.0 - hardness * 0.4));

    // Fresh sediment is lighter and duller than the bedrock it came from.
    float3 sedCol = lerp(float3(0.60, 0.50, 0.38), float3(0.66, 0.58, 0.47), hash11(bi));
    c = lerp(c, sedCol, saturate(sediment) * saturate(U.sedimentTint));

    return c;
}
