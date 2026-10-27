/*==========================================================================================================================================
                                                  PATHREPLAYRESERVOIR.SLANG
==========================================================================================================================================*/
// 🧩 Reservoir sampling of replayable diffuse or rough-opaque random sequences in a common positive-support domain.
// 📝 Every reused sequence is fully retraced in the current triangle BVH. This is not vertex reconnection,
//    a hardware ray-query implementation, or a complete general-material ReSTIR GI renderer.
#include "LightInfluence.slang"
uint ReplayHistoryStart() { return Extent.Dimensions.x * 25u + 13889u + SolarSourceSampleCount; }
uint ReplaySlot(uint Slot, uint Pixel) { return ReplayHistoryStart() + Slot * Extent.Dimensions.x + Pixel; }
float2 EncodeReplaySeed(uint Seed) { return float2(float(Seed & 65535u), float(Seed >> 16u)); }
uint DecodeReplaySeed(float2 Packed) { return uint(Packed.x) | (uint(Packed.y) << 16u); }
float3 ReplayDirection(float3 Normal, inout uint Bits)
{
    float Radius = sqrt(RandomUnit(Bits)), Azimuth = 6.283185307179586 * RandomUnit(Bits);
    float3 Tangent = Unit(cross(abs(Normal.z) < .999 ? float3(0,0,1) : float3(0,1,0), Normal));
    float3 Bitangent = cross(Normal, Tangent);
    return Unit(Tangent * (Radius * cos(Azimuth)) + Bitangent * (Radius * sin(Azimuth)) +
                Normal * sqrt(max(0, 1 - Radius * Radius)));
}
// 📝 Test the open segment and skip only the sampled endpoint triangle, rather than shortening the shadow ray.
bool ReplaySegmentOccluded(float3 Origin, float3 Direction, float Distance, uint Endpoint)
{
    if (Extent.Grid.w == 0 || Distance <= 0) return false;
    InterlockedAdd(Counters[2], 1);
    uint Stack[64], Count = 1;
    Stack[0] = 0;
    while (Count > 0)
    {
        FacetEnclosure Box = Enclosures[Stack[--Count]];
        if (!IntersectsBox(Box, Origin, Direction, Distance)) continue;
        if (Box.Links.z != 0)
        {
            for (uint I = 0; I < Box.Links.y; ++I)
            {
                uint Index = Box.Links.x + I;
                float3 Strike;
                if (Index != Endpoint && FacetStrike(Facets[Index], Origin, Direction, 0, Distance, Strike))
                    return true;
            }
        }
        else
        {
            if (Count + 2 > min(64u, max(1u, Extent.Sampling.w)))
            {
                InterlockedAdd(Counters[3], 1);
                for (uint I = 0; I < Extent.Sampling.z; ++I)
                {
                    float3 Strike;
                    if (I != Endpoint && FacetStrike(Facets[I], Origin, Direction, 0, Distance, Strike))
                        return true;
                }
                return false;
            }
            Stack[Count++] = Box.Links.x;
            Stack[Count++] = Box.Links.y;
        }
    }
    return false;
}
// 📝 Uniformly select one emissive facet, then a uniform point on its area. No BSDF-hit light is added in this mode.
float3 ReplayFacetRadiance(SurfacePoint Receiver, float3 Origin, bool RoughOpaque, inout uint Bits)
{
    uint FacetCount = Extent.Reconstruction.z;
    if (FacetCount == 0) return 0;
    // 📝 Rejection removes modulo bias for a uniformly distributed 32-bit draw.
    uint Threshold = (0u - FacetCount) % FacetCount, SampleBits;
    do { SampleBits = NextRandom(Bits); } while (SampleBits < Threshold);
    uint Offset = asuint(Extent.Maximum.y), FacetIndex = uint(Angles[Offset + SampleBits % FacetCount]);
    FacetCorners F = Facets[FacetIndex];
    float3 EdgeA = F.B.xyz - F.A.xyz, EdgeB = F.C.xyz - F.A.xyz;
    float3 AreaNormal = cross(EdgeA, EdgeB);
    float DoubleArea = length(AreaNormal);
    float Root = sqrt(RandomUnit(Bits)), Along = RandomUnit(Bits);
    float3 Point = F.A.xyz * (1 - Root) + F.B.xyz * (Root * (1 - Along)) + F.C.xyz * (Root * Along);
    float3 Delta = Point - Origin;
    float DistanceSquared = dot(Delta, Delta);
    if (DoubleArea <= 0 || DistanceSquared <= 1e-10) return 0;
    float Distance = sqrt(DistanceSquared), DirectionCosine;
    float3 Direction = Delta / Distance;
    DirectionCosine = max(0, dot(Unit(Receiver.NormalRoughness.xyz), Direction));
    float SourceCosine = abs(dot(AreaNormal / DoubleArea, Direction));
    if (DirectionCosine <= 0 || SourceCosine <= 0 ||
        ReplaySegmentOccluded(Origin, Direction, Distance, FacetIndex)) return 0;
    float3 Scattering = RoughOpaque ? Brdf(Receiver, Direction) : clamp(Receiver.AlbedoIor.xyz, 0, 1) / 3.141592653589793;
    float Measure = DirectionCosine * SourceCosine * (.5 * DoubleArea) * float(FacetCount) / DistanceSquared;
    // 📝 For cosine sampling, Measure/π is the ratio p_bsdf / p_facet in solid angle.
    float Balance = (Extent.Primary.w & 1024u) != 0 ? 1 / (1 + Measure / 3.141592653589793) : 1;
    return Scattering * max(F.Emissive.xyz, 0) * (Measure * Balance);
}
float3 EvaluateReplayPath(SurfacePoint Receiver, uint Seed)
{
    uint Bits = Seed;
    float3 Normal = Unit(Receiver.NormalRoughness.xyz);
    float3 Origin = Receiver.PositionHit.xyz + Normal * .001;
    float3 Throughput = 1, Radiance = 0;
    bool RoughOpaque = (Extent.Primary.w & 64u) != 0, SampleFacets = (Extent.Primary.w & 128u) != 0;
    SurfacePoint Current = Receiver;
    for (uint Bounce = 0; Bounce < Extent.Primary.z; ++Bounce)
    {
        if (SampleFacets) Radiance += Throughput * ReplayFacetRadiance(Current, Origin, RoughOpaque, Bits);
        float3 Direction = ReplayDirection(Normal, Bits), Strike;
        // With cosine-weighted sampling, f*cos/pdf = pi*f. The original diffuse mode stays Lambertian.
        Throughput *= RoughOpaque ? 3.141592653589793 * Brdf(Current, Direction) : clamp(Current.AlbedoIor.xyz, 0, 1);
        if (max(Throughput.x, max(Throughput.y, Throughput.z)) <= 0) break;
        uint Index = NearestFacet(Origin, Direction, .0001, 1e30, Strike);
        if (Index == 0xffffffffu)
        {
            Radiance += Throughput * max(Extent.Minimum.xyz, 0); // Uniform environment, not an importance map.
            break;
        }
        FacetCorners F = Facets[Index];
        // 📝 Without balance weighting, explicit facet sampling accounts for emissive hits; bit 256 is a wrong control.
        if (!SampleFacets || (Extent.Primary.w & 256u) != 0)
            Radiance += Throughput * max(F.Emissive.xyz, 0);
        else if ((Extent.Primary.w & 1024u) != 0 && any(F.Emissive.xyz > 0) && Extent.Reconstruction.z > 0)
        {
            float3 AreaNormal = cross(F.B.xyz - F.A.xyz, F.C.xyz - F.A.xyz);
            float DoubleArea = length(AreaNormal), DistanceSquared = Strike.x * Strike.x;
            if (DoubleArea > 0 && DistanceSquared > 0)
            {
                float ReceiverCosine = max(0, dot(Normal, Direction));
                float SourceCosine = abs(dot(AreaNormal / DoubleArea, Direction));
                float Ratio = ReceiverCosine * SourceCosine * (.5 * DoubleArea) * float(Extent.Reconstruction.z) /
                              (3.141592653589793 * DistanceSquared);
                Radiance += Throughput * max(F.Emissive.xyz, 0) * (Ratio / (1 + Ratio));
            }
        }
        Normal = Unit(F.NormalA.xyz * (1 - Strike.y - Strike.z) + F.NormalB.xyz * Strike.y + F.NormalC.xyz * Strike.z);
        if (dot(Normal, Direction) > 0) Normal = -Normal;
        float3 HitPosition = Origin + Direction * Strike.x;
        Current = (SurfacePoint)0;
        Current.PositionHit = float4(HitPosition, 1);
        Current.NormalRoughness = float4(Normal, F.AlbedoRoughness.w);
        Current.ViewMetallic = float4(-Direction, F.OpticalToken.x);
        Current.AlbedoIor = float4(F.AlbedoRoughness.xyz, F.OpticalToken.y);
        Current.ResidualSpecular.w = F.OpticalToken.z;
        // 📝 The host admits only opaque single-stratum albedo maps in this opt-in mode.
        if ((Extent.Primary.w & 2048u) != 0 && F.Emissive.w > 0)
            ApplyRayMaterial(Current, F, Strike.yz);
        Origin = HitPosition + Normal * .001;
    }
    return Radiance;
}
float ReplayTarget(float3 Radiance) { return max(0, Power(Radiance)) + Extent.Maximum.x; }
[shader("compute")][numthreads(64,1,1)] void GenerateReplayReservoirs(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    SurfacePoint R = Receivers[Pixel];
    float4 Packed = 0, SelectedRadiance = 0;
    if (R.PositionHit.w != 0 && R.MotionPositionToken.w > 0 &&
        (R.ViewMetallic.w == 0 || (Extent.Primary.w & 64u) != 0))
    {
        uint SeedBits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u);
        uint SelectionBits = (Extent.Sampling.x * 277803737u + 1597334677u) ^ (Pixel * 2891336453u + 1u);
        uint Selected = NextRandom(SeedBits);
        float3 Radiance = EvaluateReplayPath(R, Selected);
        float Target = ReplayTarget(Radiance), Sum = Target, Count = 1;
        if (Extent.Reconstruction.x != 0 && Extent.History.z != 0 && Extent.History.w == 0 && R.MotionPixel.w != 0)
        {
            int2 P = int2(floor(R.MotionPixel.xy + .5));
            if (all(P >= 0) && all(P < int2(Extent.History.xy)))
            {
                uint Previous = uint(P.y) * Extent.History.x + uint(P.x);
                float4 Source = OutputColour[ReplaySlot(0, Previous)];
                float4 Guide = OutputColour[ReplaySlot(1, Previous)];
                float3 PriorNormal = OutputColour[ReplaySlot(4, Previous)].xyz;
                float3 MotionNormal = R.MotionNormal.xyz;
                float PriorLength = dot(PriorNormal, PriorNormal), MotionLength = dot(MotionNormal, MotionNormal);
                bool MatchingPosition = all(Guide.xyz == R.MotionPositionToken.xyz);
                // Round-to-pixel reprojection generally lands on a nearby point, not the identical world position.
                // The audit flag retains the old exact test; missing normals also fall back to exact positions.
                if ((Extent.Primary.w & 512u) == 0 && PriorLength > 1e-12 && MotionLength > 1e-12)
                {
                    float3 Delta = Guide.xyz - R.MotionPositionToken.xyz;
                    float Radius = clamp(R.MotionPixel.z, 0.0, .25);
                    MatchingPosition = dot(Delta, Delta) <= Radius * Radius &&
                                       dot(PriorNormal, MotionNormal) >= .9 * sqrt(PriorLength * MotionLength);
                }
                bool Compatible = Source.w > 0 && Source.z > 0 && Guide.w == R.MotionPositionToken.w &&
                                  MatchingPosition;
                if (Compatible)
                {
                    uint Candidate = DecodeReplaySeed(Source.xy);
                    float3 Replayed = EvaluateReplayPath(R, Candidate);
                    // A domain-change cap scales represented count and weight together; W remains per sample.
                    float ReplayedTarget = ReplayTarget(Replayed);
                    float Retained = min(Source.w, float(max(1u, Extent.Reconstruction.w)));
                    float Weight = ReplayedTarget * Source.z * Retained;
                    Sum += Weight; Count += Retained;
                    if (RandomUnit(SelectionBits) * Sum < Weight)
                    {
                        Selected = Candidate; Radiance = Replayed; Target = ReplayedTarget;
                    }
                    InterlockedAdd(Counters[20], 1);
                }
                else InterlockedAdd(Counters[21], 1);
            }
        }
        Packed = float4(EncodeReplaySeed(Selected), Sum / (Count * Target), Count);
        SelectedRadiance = float4(Radiance, Target);
    }
    OutputColour[ReplaySlot(2, Pixel)] = Packed;
    OutputColour[ReplaySlot(3, Pixel)] = SelectedRadiance;
}
[shader("compute")][numthreads(64,1,1)] void ResolveReplayReservoirs(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    SurfacePoint R = Receivers[Pixel];
    float4 Local = OutputColour[ReplaySlot(2, Pixel)];
    float3 Chosen = 0;
    float ChosenTarget = Extent.Maximum.x, Sum = 0, Count = 0;
    uint SelectionBits = (Extent.Sampling.x * 2891336453u + 1013904223u) ^ (Pixel * 277803737u + 13u);
    int2 Centre = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    static const int2 Offsets[5] = {int2(0,0), int2(-1,0), int2(1,0), int2(0,-1), int2(0,1)};
    uint ProposalCount = Extent.Reconstruction.y != 0 ? 5u : 1u;
    if (Local.w > 0)
        for (uint I = 0; I < ProposalCount; ++I)
        {
            int2 P = Centre + Offsets[I];
            if (any(P < 0) || any(P >= int2(Extent.History.xy))) continue;
            uint Donor = uint(P.y) * Extent.History.x + uint(P.x);
            float4 Source = OutputColour[ReplaySlot(2, Donor)];
            if (Source.w <= 0 || Source.z <= 0) continue;
            float3 Radiance = I == 0 ? OutputColour[ReplaySlot(3, Pixel)].xyz :
                                       EvaluateReplayPath(R, DecodeReplaySeed(Source.xy));
            float Target = ReplayTarget(Radiance), Weight = Target * Source.z * Source.w;
            Sum += Weight; Count += Source.w;
            if (RandomUnit(SelectionBits) * Sum < Weight)
            {
                Chosen = Radiance; ChosenTarget = Target;
            }
            if (I != 0) InterlockedAdd(Counters[22], 1);
        }
    float3 Indirect = Count > 0 ? Chosen * (Sum / (Count * ChosenTarget)) : float3(0);
    OutputColour[Pixel] = float4(Indirect + R.ResidualSpecular.xyz, 1);
    // Persist only pre-spatial history; cross-pixel candidates are retraced, not assumed statistically independent.
    OutputColour[ReplaySlot(0, Pixel)] = Local;
    OutputColour[ReplaySlot(1, Pixel)] = float4(R.PositionHit.xyz, R.PositionHit.w != 0 ? R.MotionPositionToken.w : 0);
    OutputColour[ReplaySlot(4, Pixel)] = float4(R.NormalRoughness.xyz, 0);
}
