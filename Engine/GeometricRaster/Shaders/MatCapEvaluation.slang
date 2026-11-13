//============================================================================================================================================
//                                                           MATCAPEVALUATION.SLANG
//============================================================================================================================================
// Shared baked engineering MatCap atlas sampling and Cook-Torrance studio-material evaluation

module MatCapEvaluation;

[[vk::binding(3, 0)]] Texture2D<float4> BakedMatCapAtlas;
[[vk::binding(4, 0)]] SamplerState BakedMatCapSampler;

public float3 SampleBakedMatCap(uint SlotIndex, float3 ViewSpaceNormal)
{
    uint Slot = SlotIndex & 15u;
    float2 LocalUV = clamp(float2(0.5 + ViewSpaceNormal.x * 0.485, 0.5 - ViewSpaceNormal.y * 0.485), 0.012, 0.988);
    float2 TileOrigin = float2(float(Slot & 3u), float(Slot >> 2u));
    float2 AtlasUV = (TileOrigin + LocalUV) * 0.25;
    return BakedMatCapAtlas.SampleLevel(BakedMatCapSampler, AtlasUV, 0.0).rgb;
}

// Spatial finish detail is separate from the normal-indexed illumination atlas. A flat panel
// must not collapse a carbon weave or metallic flake field to one atlas texel.
float EvaluateFinishNoise(float2 Cell)
{
    return frac(sin(dot(Cell, float2(127.1, 311.7))) * 43758.5453);
}

public float3 EvaluateSpatialMatCapFinish(uint Slot, float3 Position, float3 Normal, float3 ViewNormal, float3 Illumination)
{
    float3 AxisWeight = abs(normalize(Normal));
    float2 SurfaceCoord = AxisWeight.y >= max(AxisWeight.x, AxisWeight.z) ? Position.xz :
        (AxisWeight.x >= AxisWeight.z ? Position.zy : Position.xy);
    if (Slot == 12u || Slot == 13u || Slot == 15u)
    {
        float Scale = Slot == 12u ? 26.0 : (Slot == 13u ? 38.0 : 24.0);
        float2 Thread = SurfaceCoord * Scale;
        float2 Cell = floor(Thread);
        float2 Within = frac(Thread);
        float Warp = frac((Cell.x + Cell.y) * 0.25) < 0.5 ? 1.0 : 0.0;
        float Across = lerp(Within.x, Within.y, Warp);
        float Tow = pow(max(0.0, sin(Across * 3.14159265)), 0.45);
        float Filament = 0.5 + 0.5 * sin(Across * 50.2654825);
        float Glint = pow(saturate(lerp(abs(ViewNormal.x), abs(ViewNormal.y), Warp)), 5.0);
        float Visibility = 1.0 - smoothstep(0.25, 1.1, max(fwidth(Thread.x), fwidth(Thread.y)));
        float Modulation = Slot == 12u ? 0.42 + 0.68 * Tow + 0.14 * Filament + 0.5 * Glint :
            0.65 + 0.38 * Tow + 0.09 * Filament;
        if (Slot == 15u)
        {
            float2 Rip = abs(frac(SurfaceCoord * 5.0) - 0.5);
            Modulation *= 0.8 + 0.35 * smoothstep(0.42, 0.48, max(Rip.x, Rip.y));
        }
        return saturate(Illumination * lerp(1.0, Modulation, Visibility));
    }
    if (Slot == 10u || Slot == 11u)
    {
        float2 FlakeCoord = SurfaceCoord * 135.0;
        float2 Cell = floor(FlakeCoord);
        float Seed = EvaluateFinishNoise(Cell);
        float2 Center = float2(0.18 + 0.64 * Seed, 0.18 + 0.64 * EvaluateFinishNoise(Cell + 17.0));
        float Radius = length(frac(FlakeCoord) - Center);
        float Coverage = 1.0 - smoothstep(0.10, 0.29, Radius);
        float Facet = 0.25 + 0.75 * pow(saturate(Seed + ViewNormal.x * 0.32 - ViewNormal.y * 0.23), 6.0);
        float Visibility = 1.0 - smoothstep(0.3, 1.2, max(fwidth(FlakeCoord.x), fwidth(FlakeCoord.y)));
        float3 SparkTint = Slot == 10u ? float3(0.48, 0.72, 1.0) : float3(1.0, 0.55, 0.44);
        return saturate(Illumination * (0.82 + 0.18 * Seed * Visibility) +
            SparkTint * Coverage * Facet * Visibility * 0.6);
    }
    return Illumination;
}

public float3 EvaluateStudioSurfaceMaterial(
    float3 WorldNormal,
    float3 ViewDir,
    float3 AlbedoLinear,
    float  Metallic,
    float  Roughness,
    float  Specular)
{
    float3 N = normalize(WorldNormal);
    float3 V = normalize(ViewDir);
    float3 KeyDir  = normalize(float3(0.52, 0.76, 0.39));
    float3 FillDir = normalize(float3(-0.64, 0.34, -0.68));
    float3 HalfKey = normalize(KeyDir + V);

    float NdotL = saturate(dot(N, KeyDir));
    float NdotF = saturate(dot(N, FillDir));
    float NdotH = saturate(dot(N, HalfKey));
    float NdotV = saturate(dot(N, V));

    float ClampedRough = clamp(Roughness, 0.05, 1.0);
    float Alpha2       = ClampedRough * ClampedRough * ClampedRough * ClampedRough;
    float Denom        = (NdotH * NdotH * (Alpha2 - 1.0) + 1.0);
    float GGX          = Alpha2 / max(3.14159265 * Denom * Denom, 1.0e-4);

    float3 F0      = lerp(float3(0.08 * Specular), AlbedoLinear, Metallic);
    float3 Fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
    float3 DiffuseTerm  = AlbedoLinear * (1.0 - Metallic) * (0.20 + 0.82 * NdotL + 0.28 * NdotF);
    float3 SpecularTerm = Fresnel * min(GGX * 0.28, 3.5) * (0.25 + 0.75 * NdotL);
    // Broad studio reflections keep metal/roughness edits visible away from a point-light highlight.
    float3 Reflection = reflect(-V, N);
    float Horizon = smoothstep(-0.18 - ClampedRough * 0.35, 0.22 + ClampedRough * 0.35, Reflection.y);
    float3 Environment = lerp(float3(0.055, 0.065, 0.085), float3(0.44, 0.50, 0.61), Horizon);
    float StripAlignment = saturate(dot(Reflection, normalize(float3(-0.25, 0.82, 0.51))));
    float Strip = pow(StripAlignment, lerp(90.0, 2.0, ClampedRough));
    Environment += float3(1.0, 0.98, 0.93) * Strip * (1.8 - 1.35 * ClampedRough);
    float3 EnvironmentSpecular = Fresnel * Environment * (1.0 - 0.55 * ClampedRough);
    return DiffuseTerm + SpecularTerm + EnvironmentSpecular;
}

public float3 CompressRadiometricACESFilmic(float3 LinearHDR)
{
    float3 X = max(LinearHDR, float3(0.0));
    float3 CompressedTone = (X * (2.51 * X + 0.03)) / (X * (2.43 * X + 0.59) + 0.14);
    return pow(saturate(CompressedTone), float3(1.0 / 2.2));
}
