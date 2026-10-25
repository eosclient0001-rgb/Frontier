/*==========================================================================================================================================
                                                    SOLIDDIELECTRICTRANSPORT.SLANG
==========================================================================================================================================*/
// 🧩 Bounded smooth closed-dielectric paths in air; stochastic exact-Fresnel splitting and geometric-distance absorption.

#include "../../../../Engine/Render/Shader/DielectricRefraction.slang"

float3 TraceSolidDielectric(float3 Origin, float3 Direction, inout uint Bits, out uint InternalReflections,
                            out uint Capped, out uint Unsupported, out bool Hit)
{
    const float Offset = .00002;
    float DistanceCorrection = 0;
    float3 Throughput = 1, Absorption = 0;
    float MediumIor = 1;
    uint MediumAddress = 0;
    bool Inside = false;
    InternalReflections = Capped = Unsupported = 0;
    Hit = false;
    for (uint Interaction = 0; Interaction < 32; ++Interaction)
    {
        float3 Strike;
        uint Index = NearestFacet(Origin, Direction, -Offset * .25, 1e30, Strike);
        if (Index == 0xffffffffu)
        {
            if (Inside) { Unsupported = 1; return 0; }
            return Throughput * EnvironmentRadiance(Direction);
        }
        Hit = true;
        if (Inside) Throughput *= exp(-Absorption * max(0, Strike.x + DistanceCorrection));
        SurfacePoint R = FacetSurface(Index, Origin, Direction, Strike);
        uint Category = MaterialTransport(R);
        if (Category == 2)
        {
            // Retain the separate parallel-sheet approximation when a sheet is encountered in air.
            if (Inside) { Unsupported = 1; return 0; }
            float Cosine = max(.05, dot(R.NormalRoughness.xyz, -Direction));
            float F = .04 + .96 * pow(1 - Cosine, 5);
            Throughput *= (1 - F) / (1 + F) * exp(-float3(.8, .15, .4) * .006 / Cosine);
            Origin = R.PositionHit.xyz + Direction * Offset;
            continue;
        }
        if (Category != 4) return Throughput * ShadeRayStrike(R);
        FacetCorners Facet = Facets[Index];
        float3 Outward = Unit(cross(Facet.B.xyz - Facet.A.xyz, Facet.C.xyz - Facet.A.xyz));
        bool Entering = dot(Direction, Outward) < 0;
        uint Address = MaterialAddress(R);
        if (Inside == Entering || (Inside && Address != MediumAddress))
        {
            // Nested/overlapping volumes, open or incorrectly wound surfaces and inside cameras are not inferred.
            Unsupported = 1;
            return 0;
        }
        float Ior = R.AlbedoIor.w;
        float3 Normal = Entering ? Outward : -Outward;
        DielectricRefraction Boundary = EvaluateDielectricRefraction(Direction, Normal, Inside ? MediumIor : 1, Inside ? 1 : Ior);
        if (!Boundary.Valid) { Unsupported = 1; return 0; }
        if (Boundary.TotalInternalReflection || RandomUnit(Bits) < Boundary.Reflectance)
        {
            InternalReflections += Boundary.TotalInternalReflection;
            Direction = reflect(Direction, Normal);
        }
        else
        {
            Throughput *= Boundary.RadianceScale;
            Direction = Boundary.Direction;
            Inside = !Inside;
            if (Inside)
            {
                MediumAddress = Address;
                MediumIor = Ior;
                Absorption = max(0, MaterialCoefficients(Address - 1 + 16).xyz);
            }
        }
        // Offset along the geometric normal: a directional offset can cross an adjacent face at a corner.
        float3 Displacement = Outward * (Inside ? -Offset : Offset);
        Origin = R.PositionHit.xyz + Displacement;
        DistanceCorrection = dot(Displacement, Direction);
    }
    Capped = 1;
    return 0;
}
float3 IntegrateBoundaryRays(inout SurfacePoint R, uint Pixel)
{
    uint Bits = Pixel * 747796405u + Extent.Sampling.x, Internal = 0, Capped = 0, Unsupported = 0;
    // One volume integration call site serves camera and mirror rays; nested call sites crash the tested software driver.
    bool Mirror = MaterialTransport(R) == 1;
    float3 Origin = Mirror ? R.PositionHit.xyz + R.NormalRoughness.xyz * .003 : CameraProjection(0).xyz;
    float3 Direction = Mirror ? reflect(-R.ViewMetallic.xyz, R.NormalRoughness.xyz) : -R.ViewMetallic.xyz;
    uint Hits = 0;
    float3 Sum = 0;
    uint Samples = min(128u, max(1u, Extent.Primary.z));
    for (uint Sample = 0; Sample < Samples; ++Sample)
    {
        uint T, C, U;
        bool Hit;
        Sum += TraceSolidDielectric(Origin, Direction, Bits, T, C, U, Hit);
        Hits += Hit;
        Internal += T; Capped += C; Unsupported += U;
    }
    // [count] Marker 5 is distinct from plastic fallback marker 4; packed y remains exact below 2^24.
    R.ExpectedDirect.xyz = Mirror ? float3(1, Hits > 0 ? 1 : 0, Capped * 256u + Unsupported) : float3(5, Capped * 65536u + Internal, Unsupported);
    return Sum / Samples * (Mirror ? .94 : 1);
}
