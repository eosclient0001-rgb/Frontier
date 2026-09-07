// ===========================================================================
//  frontier_erode3d.slang — TRUE volumetric erosion. The pass a heightmap
//  cannot have.
//
//  Slang/Vulkan port of src/shaders/erode3d.wgsl. Evolves the signed-distance
//  field as a level set, moving the rock surface along its own normal at a
//  locally varying speed:
//
//        d(phi)/dt = F(x) * |grad phi|
//
//  Because the surface is an isosurface of a full 3D field rather than a
//  function of (x,z), material can be removed from UNDER an overhang, from the
//  BACK of an alcove, or from the middle of a fin, and the topology is free to
//  change. Cliffs undercut and collapse; arches open, widen and finally fall.
//  None of that is representable in 2.5D.
//
//  Dispatch: (VOLX+3)/4, (VOLY+3)/4, (VOLZ+3)/4
// ===========================================================================

import frontier_params;
import frontier_geology;

// --- descriptor set 0 -------------------------------------------------------
[[vk::binding(0, 0)]] ConstantBuffer<Params>            U;
[[vk::binding(1, 0)]] Texture3D<float4>                 srcVol;
[[vk::binding(2, 0)]] RWTexture3D<float4>               dstVol;
[[vk::binding(3, 0)]] RWStructuredBuffer<SimCell>       sim;
[[vk::binding(4, 0)]] SamplerState                      linSampler;

float4 loadVox(int3 c)
{
    int3 cc = clamp(c, int3(0), int3(VOLX - 1, VOLY - 1, VOLZ - 1));
    return srcVol.Load(int4(cc, 0));
}

float loadD(int3 c) { return loadVox(c).r; }

float3 gradD(int3 c)
{
    float dx = loadD(c + int3(1, 0, 0)) - loadD(c - int3(1, 0, 0));
    float dy = loadD(c + int3(0, 1, 0)) - loadD(c - int3(0, 1, 0));
    float dz = loadD(c + int3(0, 0, 1)) - loadD(c - int3(0, 0, 1));
    return float3(dx, dy, dz) / (2.0 * VOXEL_SIZE);
}

float3 normalD(int3 c)
{
    float3 g = gradD(c);
    float l = length(g);
    return l > 1e-6 ? g / l : float3(0, 1, 0);
}

/// Laplacian of the SDF ~ mean curvature of the isosurface.
/// > 0 on convex rock (edges, spires), < 0 in concavities (alcoves, gullies).
float curvD(int3 c)
{
    float cc = loadD(c);
    float lap = loadD(c + int3(1, 0, 0)) + loadD(c - int3(1, 0, 0))
              + loadD(c + int3(0, 1, 0)) + loadD(c - int3(0, 1, 0))
              + loadD(c + int3(0, 0, 1)) + loadD(c - int3(0, 0, 1))
              - 6.0 * cc;
    return lap / VOXEL_SIZE.x;
}

/// Fraction of the neighbourhood that is open air — cheap ambient exposure.
float opennessAt(int3 c)
{
    float open = 0.0, n = 0.0;
    const int R = 2;
    [unroll]
    for (int dz = -R; dz <= R; dz += 2)
    [unroll]
    for (int dy = -R; dy <= R; dy += 2)
    [unroll]
    for (int dx = -R; dx <= R; dx += 2)
    {
        if (dx == 0 && dy == 0 && dz == 0) continue;
        open += loadD(c + int3(dx, dy, dz)) > 0.0 ? 1.0 : 0.0;
        n += 1.0;
    }
    return open / max(n, 1.0);
}

[shader("compute")]
[numthreads(4, 4, 4)]
void main(uint3 gid : SV_DispatchThreadID)
{
    int3 c = int3(gid);
    if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) return;

    float4 vox = loadVox(c);
    float d      = vox.r;
    float sedCh  = vox.g;
    float damage = vox.b;
    float wetCh  = vox.a;

    float3 p = voxelCenterToWorld(c);
    float vs = VOXEL_SIZE.x;

    // Narrow-band level set: only voxels near the surface need work. The vast
    // majority of the volume is deep rock or open sky.
    float band = vs * 3.0;
    if (abs(d) > band)
    {
        dstVol[c] = float4(d, sedCh, damage, wetCh * 0.999);
        return;
    }

    float3 n = normalD(c);
    float curv = curvD(c);
    float hard = clamp(rockHardness(p, U), 0.02, 1.0);
    float resist = 1.0 / (0.10 + hard * hard * 3.0);

    int2 sc = int2(clamp(c.x, 0, SIMX - 1), clamp(c.z, 0, SIMZ - 1));
    SimCell cell = sim[simIndex(sc)];

    float dt = U.dt;
    float erode = 0.0; // metres of surface retreat this step

    // ---- 1. LATERAL UNDERCUTTING -------------------------------------------
    // Water attacks the banks it touches, not just the bed. Soft beds retreat
    // beneath resistant caps: this is the direct cause of overhangs and of
    // cliff retreat by undermining.
    float waterY = cell.h + cell.water;
    float above = p.y - waterY;

    if (cell.water > 0.002 && above > -vs * 2.0 && above < U.undercutReach)
    {
        float reach = 1.0 - saturate(above / max(U.undercutReach, 0.5));
        float band2 = reach * reach;
        float lateral = 1.0 - abs(n.y);
        float power = cell.flowAcc * 6.0 + length(cell.vel) * cell.water * 2.0;

        erode += U.undercut * band2 * lateral * power * resist * dt * 2.2;
        wetCh = max(wetCh, reach * 0.9);
    }

    // ---- 2. DIFFERENTIAL WEATHERING ----------------------------------------
    float openness = opennessAt(c);
    float exposure = lerp(1.0, openness * 2.0, saturate(U.exposureBias));
    erode += U.weathering * resist * exposure * dt * 0.06;

    // ---- 3. CAVERNOUS WEATHERING (tafoni / alcoves) ------------------------
    // Salt and moisture attack concentrated in concavities. Self-reinforcing,
    // exactly as in nature: a hollow collects moisture, which deepens it.
    if (curv < 0.0)
    {
        float concavity = saturate(-curv * vs * 4.0);
        float shelter = 1.0 - openness;
        erode += U.saltWeather * concavity * shelter * resist * dt * 0.5;
    }

    // ---- 4. GRAVITATIONAL COLLAPSE -----------------------------------------
    // Unsupported rock fails. Look down for a void; compare the span against
    // the strength of the rock bridging it.
    if (d < 0.0)
    {
        float voidDepth = 0.0;
        bool isRoof = false;
        for (int k = 1; k <= 7; k++)
        {
            float below = loadD(c - int3(0, k, 0));
            if (below > 0.0) { voidDepth += vs; isRoof = true; }
            else if (k <= 2) break; // supported directly underneath
        }

        if (isRoof && voidDepth > vs)
        {
            float strength = U.collapseThresh * (0.35 + hard * 1.65) * vs * 7.0;
            float ratio = voidDepth / max(strength, 1e-4);
            if (ratio > 1.0)
                erode += U.collapseRate * saturate(ratio - 1.0) * dt * 1.6;
        }
    }

    // ---- 5. AEOLIAN ABRASION ------------------------------------------------
    if (U.aeolian > 0.0)
    {
        float3 wd = dirFromAngles(U.windDir, 0.0);
        float facing = saturate(-dot(n, wd));
        float heightFall = exp(-max(0.0, p.y - cell.h) / 14.0);
        float dryness = 1.0 - saturate(cell.wet);
        erode += U.aeolian * facing * heightFall * dryness * resist * dt * 0.09;

        // Lee-side deposition: fines drift into sheltered pockets.
        float lee = saturate(dot(n, wd)) * saturate(-curv * vs * 2.0);
        erode -= U.aeolian * lee * heightFall * dryness * dt * 0.03;
    }

    // ---- integrate ----------------------------------------------------------
    // |grad phi| ~ 1 for a well-formed SDF, so advancing the interface by
    // `erode` metres is just adding it to the distance.
    if (isnan(erode)) erode = 0.0;
    float maxStep = vs * 0.6;              // CFL-style clamp
    float step = clamp(erode, -maxStep, maxStep);
    d += step;

    damage = saturate(damage + max(step, 0.0) / max(vs, 1e-4) * 0.12);

    if (abs(p.y - cell.h) < vs * 2.0)
    {
        sedCh = lerp(sedCh, saturate(cell.reg * 1.6), 0.06);
        wetCh = lerp(wetCh, saturate(cell.wet), 0.05);
    }
    else
    {
        wetCh *= 0.995;
    }

    d = max(d, domainSDF(p));
    dstVol[c] = float4(d, sedCh, damage, wetCh);
}
