/*==========================================================================================================================================
                                                        MATERIALRAYTRANSPORT.SLANG
==========================================================================================================================================*/
// 🧩 Thin-sheet transport and a shared cosine/GGX, mirror and closed-dielectric ray integration sequence.

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
float3 ShadeRayStrike(SurfacePoint R, bool ExcludeEmission = false)
{
    float3 Incoming = ExcludeEmission ? float3(0) : R.ResidualSpecular.xyz;
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
//------------------------------------------------------------------------------------------------------------------------
//                                                   FLAT BOUNDARY RAY SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

float3 IntegrateBoundaryRays(inout SurfacePoint R, uint Pixel)
{
    uint Category = MaterialTransport(R);
    bool Compact = MaterialAddress(R) == 0;
    bool Sheet = Category == 2, Delta = Category == 1 || Category == 4 || Sheet, Mirror = Category == 1;
    PreviewScattering S = (PreviewScattering)0;
    if (!Delta && !Compact) S = ReadMaterialScattering(R);
    float3 N = R.NormalRoughness.xyz, V = R.ViewMetallic.xyz;
    float3 T = Unit(cross(abs(N.z) < .999 ? float3(0, 0, 1) : float3(0, 1, 0), N)), B = cross(N, T);
    uint Bits = Pixel * 747796405u + Extent.Sampling.x;
    uint Samples = Delta ? min(128u, max(1u, Extent.Primary.z)) : max(1u, Extent.Primary.z);
    uint Proposals = Compact ? 1 : Sheet ? 2 : Delta ? 1 : S.Configuration.x + 1;
    uint EmissiveBits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u);
    uint ScreenHits = 0, FallbackRays = 0, Hits = 0, ReflectedHits = 0, Internal = 0, Capped = 0, Unsupported = 0;
    float3 Sum = 0;
    // A flat proposal sequence and one solid-trace site avoid nested material/volume call sites in the tested driver.
    for (uint Path = 0; Path < Samples * Proposals; ++Path)
    {
        uint Proposal = Path % Proposals;
        float3 L = Mirror ? reflect(-V, N) : -V;
        float3 Origin = Category == 4 ? CameraProjection(0).xyz : R.PositionHit.xyz + N * .003;
        float3 Weight = Mirror ? float3(.94) : float3(1);
        if (Sheet)
        {
            float Cosine = saturate(dot(N, V)), F = .04 + .96 * pow(1 - Cosine, 5);
            L = Proposal == 0 ? reflect(-V, N) : -V;
            Origin = R.PositionHit.xyz + N * (Proposal == 0 ? .003 : -.003);
            Weight = Proposal == 0 ? float3(2 * F / (1 + F)) :
                     (1 - F) / (1 + F) * exp(-float3(.8, .15, .4) * .006 / max(.05, Cosine));
        }
        if (Compact)
        {
            uint Base = uint(CameraProjection(8).w) + Path * 3;
            float3 Local = float3(Angles[Base], Angles[Base+1], Angles[Base+2]);
            L = Unit(T * Local.x + B * Local.y + N * Local.z);
            Origin = R.PositionHit.xyz + N * .002;
            Weight = DiffuseTransportResponse(R, L) * π;
        }
        if (!Delta && !Compact)
        {
            float U = min(.999999, RandomUnit(Bits)), Angle = 2 * π * RandomUnit(Bits);
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
            Weight = Brdf(R, L) * NL / max(1e-8, MaterialMixtureDensity(S, N, V, L));
        }
        SurfacePoint ScreenStrike;
        bool Screen = !Delta && Category == 3 && TraceDepthScreen(Origin, L, ScreenStrike);
        float3 Incoming;
        if (Screen) Incoming = ShadeRayStrike(ScreenStrike);
        else
        {
            uint Tirs, Cap, Invalid;
            bool Hit;
            // Boundary branching must not perturb the subsequent BRDF proposal sequence.
            uint BoundaryBits = Delta ? Bits : Bits ^ (Path * 2246822519u + 3266489917u);
            Incoming = TraceSolidDielectric(Origin, L, BoundaryBits, Tirs, Cap, Invalid, Hit, Compact, Compact && (Extent.Primary.w & 2u) != 0);
            if (Delta) Bits = BoundaryBits;
            Internal += Tirs; Capped += Cap; Unsupported += Invalid; Hits += Hit;
            ReflectedHits += Hit && Proposal == 0;
            if (Compact)
            {
                InterlockedAdd(Counters[13], 1);
                if (Hit) InterlockedAdd(Counters[14], 1);
                else InterlockedAdd(Counters[15], 1);
            }
        }
        ScreenHits += Screen;
        FallbackRays += !Screen;
        Sum += Weight * Incoming;
        if (Compact && (Extent.Primary.w & 2u) != 0) Sum += SampleEmissiveFacet(R, EmissiveBits);
    }
    if (Compact) R.ExpectedDirect.xyz = float3(7, Capped, Unsupported);
    else if (Category == 4) R.ExpectedDirect.xyz = float3(5, Capped * 65536u + min(65535u, Internal), Unsupported);
    else if (Mirror) R.ExpectedDirect.xyz = float3(1, Hits > 0 ? 1 : 0, Capped * 256u + Unsupported);
    else if (Sheet) R.ExpectedDirect.xyz = float3(2, ReflectedHits > 0 ? 1 : 0, Capped * 512u + Unsupported);
    else if (Category == 3) R.ExpectedDirect.xyz = float3(ScreenHits > 0 ? 3 : 4, FallbackRays, ScreenHits);
    else R.ExpectedDirect.xyz = float3(6, Capped, Unsupported);
    return Sum / Samples;
}
