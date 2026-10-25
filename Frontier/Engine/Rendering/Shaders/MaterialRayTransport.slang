/*==========================================================================================================================================
                                                        MATERIALRAYTRANSPORT.SLANG
==========================================================================================================================================*/
// 🧩 Scene-reflecting mirrors, thin glass, depth-screen plastic reflections and stratified diffuse/GGX ray integration.

float3 MaterialShadowTransmission(float3 Origin, float3 Direction, float Far)
{
    float3 Throughput = 1;
    for (uint Pane = 0; Pane < 8; ++Pane)
    {
        float3 Strike;
        uint Index = NearestFacet(Origin, Direction, .001, Far, Strike);
        if (Index == 0xffffffffu) return Throughput;
        SurfacePoint R = FacetSurface(Index, Origin, Direction, Strike);
        if (MaterialTransport(R) != 2) return 0;
        float Cosine = max(.05, dot(R.NormalRoughness.xyz, -Direction));
        float F = .04 + .96 * pow(1 - Cosine, 5);
        Throughput *= (1 - F) / (1 + F) * exp(-float3(.8, .15, .4) * .006 / Cosine);
        Origin = R.PositionHit.xyz + Direction * .003;
        Far -= Strike.x + .003;
        if (Far <= .001) return Throughput;
    }
    return 0;
}
float3 ShadeRayStrike(SurfacePoint R)
{
    float3 Incoming = R.ResidualSpecular.xyz;
    float SunT = CloudSunTransmittance(R.PositionHit.xyz);
    for (uint I = 0; I < Extent.Dimensions.y; ++I)
    {
        float3 L;
        float Distance;
        float3 C = Contribution(R, I, L, Distance, SunT);
        if (any(C != 0) && !Occluded(R.PositionHit.xyz + R.NormalRoughness.xyz * .002, L, Distance - .004))
            Incoming += C;
    }
    return Incoming;
}
#include "SolidDielectricTransport.slang"

float3 TraceMaterialRadiance(float3 Origin, float3 Direction, out bool Hit)
{
    float3 Transmission = 1;
    Hit = false;
    for (uint Pane = 0; Pane < 8; ++Pane)
    {
        float3 Strike;
        uint Index = NearestFacet(Origin, Direction, .001, 1e30, Strike);
        if (Index == 0xffffffffu) return Transmission * EnvironmentRadiance(Direction);
        Hit = true;
        SurfacePoint R = FacetSurface(Index, Origin, Direction, Strike);
        // Secondary smooth-volume paths are not supported by this primary-volume stage.
        if (MaterialTransport(R) == 4) return 0;
        if (MaterialTransport(R) != 2) return Transmission * ShadeRayStrike(R);
        float Cosine = max(.05, dot(R.NormalRoughness.xyz, -Direction));
        float F = .04 + .96 * pow(1 - Cosine, 5);
        // 📝 Parallel thin sheet, both interfaces; not a solid-volume refraction solver.
        Transmission *= (1 - F) / (1 + F) * exp(-float3(.8, .15, .4) * .006 / Cosine);
        Origin = R.PositionHit.xyz + Direction * .003;
    }
    return 0;
}
bool TraceDepthScreen(float3 Origin, float3 Direction, out SurfacePoint StrikeSurface)
{
    StrikeSurface = (SurfacePoint)0;
    float3 Eye = CameraProjection(0).xyz;
    float4 Forward = CameraProjection(1), Right = CameraProjection(2), Up = CameraProjection(3);
    float Travel = .06;
    for (uint Step = 0; Step < 80; ++Step)
    {
        float3 P = Origin + Travel * Direction, Relative = P - Eye;
        float Depth = dot(Relative, Forward.xyz);
        if (Depth <= .01) return false;
        float2 Uv = float2(dot(Relative, Right.xyz) / (Depth * Right.w) * .5 + .5,
                          .5 - dot(Relative, Up.xyz) / (Depth * Up.w) * .5);
        if (any(Uv < 0) || any(Uv >= 1)) return false;
        uint2 Q = uint2(Uv * float2(Extent.History.xy));
        float4 Visible = LoadHistory(15, Q.y * Extent.History.x + Q.x);
        if (Visible.y >= 0)
        {
            float2 Ndc = (float2(Q) + .5) / float2(Extent.History.xy) * 2 - 1;
            float3 Ray = Unit(Forward.xyz + Right.xyz * Ndc.x * Right.w - Up.xyz * Ndc.y * Up.w);
            float SurfaceDepth = Visible.x * dot(Ray, Forward.xyz);
            float Difference = Depth - SurfaceDepth;
            if (Difference >= 0 && Difference < .10 + Travel * .012)
            {
                // 📝 Screen depth proposes a facet, never a substituted point from another viewing ray.
                // Verify the actual reflection-ray intersection and its clear segment, including thin glass.
                uint Candidate = uint(Visible.y);
                float3 Strike;
                if (FacetStrike(Facets[Candidate], Origin, Direction, .006, 1e30, Strike) &&
                    all(MaterialShadowTransmission(Origin, Direction, Strike.x - .002) == 1))
                {
                    StrikeSurface = FacetSurface(Candidate, Origin, Direction, Strike);
                    if (MaterialTransport(StrikeSurface) != 2 && MaterialTransport(StrikeSurface) != 4) return true;
                }
            }
        }
        Travel += .035 + Travel * .07;
    }
    return false;
}
float MaterialMixtureDensity(PreviewScattering S, float3 N, float3 V, float3 L)
{
    float NL = max(dot(N, L), 0), Sum = NL / π;
    float3 H = Unit(V + L);
    for (uint I = 0; I < S.Configuration.x; ++I)
        Sum += EvaluateGgxDistribution(saturate(dot(N, H)), max(.04, S.Strata[I].AlbedoRoughness.w)) *
               saturate(dot(N, H)) / max(1e-6, 4 * abs(dot(V, H)));
    return Sum;
}
float3 IntegrateMaterialRays(inout SurfacePoint R, uint Pixel)
{
    PreviewScattering S = ReadMaterialScattering(R);
    float3 N = R.NormalRoughness.xyz, V = R.ViewMetallic.xyz;
    float3 T = Unit(cross(abs(N.z) < .999 ? float3(0, 0, 1) : float3(0, 1, 0), N)), B = cross(N, T);
    uint Bits = Pixel * 747796405u + Extent.Sampling.x;
    float3 Sum = 0;
    bool ScreenEnabled = MaterialTransport(R) == 3;
    uint ScreenHits = 0, FallbackRays = 0;
    for (uint Sample = 0; Sample < Extent.Primary.z; ++Sample)
        for (uint Proposal = 0; Proposal <= S.Configuration.x; ++Proposal)
        {
            float U = min(.999999, RandomUnit(Bits)), Angle = 2 * π * RandomUnit(Bits);
            float3 L;
            if (Proposal == 0)
                L = Unit(T * (sqrt(U) * cos(Angle)) + B * (sqrt(U) * sin(Angle)) + N * sqrt(1 - U));
            else
            {
                float Roughness = max(.04, S.Strata[Proposal - 1].AlbedoRoughness.w);
                float A = Roughness * Roughness, Cosine = sqrt((1 - U) / (1 + (A * A - 1) * U));
                float Sine = sqrt(max(0, 1 - Cosine * Cosine));
                float3 H = Unit(T * (Sine * cos(Angle)) + B * (Sine * sin(Angle)) + N * Cosine);
                L = reflect(-V, H);
            }
            float NL = dot(N, L);
            if (NL <= 0) continue;
            bool Hit;
            SurfacePoint ScreenStrike;
            float3 Origin = R.PositionHit.xyz + N * .003;
            bool Screen = ScreenEnabled && TraceDepthScreen(Origin, L, ScreenStrike);
            float3 Incoming = Screen ? ShadeRayStrike(ScreenStrike) : TraceMaterialRadiance(Origin, L, Hit);
            ScreenHits += Screen;
            FallbackRays += !Screen;
            Sum += Brdf(R, L) * Incoming * NL / max(1e-8, MaterialMixtureDensity(S, N, V, L));
        }
    if (ScreenEnabled)
    {
        R.ExpectedDirect.x = ScreenHits > 0 ? 3 : 4;
        R.ExpectedDirect.y = FallbackRays;
        R.ExpectedDirect.z = ScreenHits;
    }
    return Sum / Extent.Primary.z;
}
