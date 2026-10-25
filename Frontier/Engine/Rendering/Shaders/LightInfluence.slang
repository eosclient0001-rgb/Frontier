/*==========================================================================================================================================
                                                        LIGHTINFLUENCE.SLANG
==========================================================================================================================================*/
// 🧩 Conservative analytic light cells, exact or fresh-RIS illumination, and triangle-enclosure visibility.

struct LightShape
{
    float4 PositionReach, RadianceCategory, DirectionInner, UpOuter;
    uint4 Profile;
    float4 PeakActive;
};
struct SurfacePoint
{
    float4 PositionHit, NormalRoughness, ViewMetallic, AlbedoIor, ResidualSpecular, ExpectedDirect,
        MotionPositionToken, MotionNormal, MotionPixel;
};
struct FacetEnclosure
{
    float4 Minimum, Maximum;
    uint4 Links;
};
struct FacetCorners
{
    float4 A, B, C, NormalA, NormalB, NormalC, AlbedoRoughness, OpticalToken, Emissive;
};
struct ComputeExtent
{
    uint4 Dimensions; // receiver count, light count, cell capacity, evaluation: 0 all, 1 cell, 2 fresh RIS
    float4 Minimum, Maximum;
    uint4 Grid;           // xyz resolution, enclosure count
    uint4 Sampling;       // seed, RIS candidate count, facet count, enclosure-stack capacity
    uint4 History;        // width, height, sequence index, reset
    uint4 Reconstruction; // temporal reuse, spatial reuse, filtering, filter iteration
    uint4 Primary;        // enabled, camera offset in float samples, reserved
};
[[vk::binding(0, 0)]] StructuredBuffer<LightShape> Lights;
[[vk::binding(1, 0)]] RWStructuredBuffer<SurfacePoint> Receivers;
[[vk::binding(2, 0)]] StructuredBuffer<FacetEnclosure> Enclosures;
[[vk::binding(3, 0)]] StructuredBuffer<FacetCorners> Facets;
[[vk::binding(4, 0)]] StructuredBuffer<float> Angles;
[[vk::binding(5, 0)]] RWStructuredBuffer<uint> Cells;
[[vk::binding(6, 0)]] RWStructuredBuffer<float4> OutputColour;
[[vk::binding(7, 0)]] RWStructuredBuffer<uint> Counters;
[[vk::push_constant]] ConstantBuffer<ComputeExtent> Extent;

float3 Unit(float3 P)
{
    float Squared = dot(P, P);
    return Squared > 0 ? P * rsqrt(Squared) : float3(0, 0, 1);
}
float Power(float3 C) { return dot(C, float3(.2126, .7152, .0722)); }

[shader("compute")][numthreads(64, 1, 1)] void AssignLightCells(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Count = Extent.Grid.x * Extent.Grid.y * Extent.Grid.z;
    if (Dispatch.x >= Count)
        return;
    uint3 Cell = uint3(Dispatch.x % Extent.Grid.x, (Dispatch.x / Extent.Grid.x) % Extent.Grid.y,
                       Dispatch.x / (Extent.Grid.x * Extent.Grid.y));
    float3 Step = (Extent.Maximum.xyz - Extent.Minimum.xyz) / float3(Extent.Grid.xyz);
    float3 Low = Extent.Minimum.xyz + float3(Cell) * Step, High = Low + Step;
    uint First = Dispatch.x * (Extent.Dimensions.z + 1), Retained = 0;
    for (uint Index = 0; Index < Extent.Dimensions.y; ++Index)
    {
        LightShape L = Lights[Index];
        float3 Delta = L.PositionReach.xyz - clamp(L.PositionReach.xyz, Low, High);
        float Squared = dot(Delta, Delta), RadiusSquared = L.PositionReach.w * L.PositionReach.w;
        if (L.RadianceCategory.w == 0 || L.PositionReach.w == 0 ||
            Squared <= RadiusSquared + 64 * 1.1920929e-7 * max(1, max(Squared, RadiusSquared)))
        {
            if (Retained < Extent.Dimensions.z)
                Cells[First + 1 + Retained] = Index;
            ++Retained;
        }
    }
    Cells[First] = Retained; // Above capacity means exhaustive fallback, never truncated illumination.
}

bool IntersectsBox(FacetEnclosure Box, float3 Origin, float3 Direction, float Far)
{
    float Near = 0;
    for (uint Axis = 0; Axis < 3; ++Axis)
    {
        if (abs(Direction[Axis]) < 1e-30)
        {
            if (Origin[Axis] < Box.Minimum[Axis] || Origin[Axis] > Box.Maximum[Axis])
                return false;
        }
        else
        {
            float A = (Box.Minimum[Axis] - Origin[Axis]) / Direction[Axis],
                  B = (Box.Maximum[Axis] - Origin[Axis]) / Direction[Axis];
            Near = max(Near, min(A, B));
            Far = min(Far, max(A, B));
            if (Far < Near)
                return false;
        }
    }
    return Far >= Near;
}
bool IntersectsFacet(FacetCorners Triangle, float3 Origin, float3 Direction, float Far)
{
    float3 EdgeA = Triangle.B.xyz - Triangle.A.xyz, EdgeB = Triangle.C.xyz - Triangle.A.xyz;
    float3 P = cross(Direction, EdgeB);
    float Determinant = dot(EdgeA, P);
    if (abs(Determinant) < 1e-12)
        return false;
    float3 Offset = Origin - Triangle.A.xyz;
    float U = dot(Offset, P) / Determinant;
    if (U < 0 || U > 1)
        return false;
    float3 Q = cross(Offset, EdgeA);
    float V = dot(Direction, Q) / Determinant;
    if (V < 0 || U + V > 1)
        return false;
    float Distance = dot(EdgeB, Q) / Determinant;
    return Distance >= 0 && Distance <= Far;
}
bool Occluded(float3 Origin, float3 Direction, float Far)
{
    if ((Extent.Primary.w & 32u) != 0)
        return all(MaterialShadowTransmission(Origin, Direction, Far) == 0);

    if (Extent.Grid.w == 0 || Far < 0)
        return false;
    InterlockedAdd(Counters[2], 1);
    uint Stack[64];
    uint Count = 1;
    Stack[0] = 0;
    while (Count > 0)
    {
        FacetEnclosure Box = Enclosures[Stack[--Count]];
        if (!IntersectsBox(Box, Origin, Direction, Far))
            continue;
        if (Box.Links.z != 0)
        {
            for (uint I = 0; I < Box.Links.y; ++I)
                if (IntersectsFacet(Facets[Box.Links.x + I], Origin, Direction, Far))
                    return true;
        }
        else
        {
            if (Count + 2 > min(64u, max(1u, Extent.Sampling.w)))
            {
                InterlockedAdd(Counters[3], 1);
                for (uint I = 0; I < Extent.Sampling.z; ++I)
                    if (IntersectsFacet(Facets[I], Origin, Direction, Far))
                        return true;
                return false;
            }
            Stack[Count++] = Box.Links.x;
            Stack[Count++] = Box.Links.y;
        }
    }
    return false;
}
float2 Interval(uint Offset, uint Count, float Angle)
{
    if (Count == 1)
        return float2(0, 0);
    uint Low = 0;
    for (uint I = 1; I < Count; ++I)
    {
        if (Angles[Offset + I] > Angle)
            break;
        Low = I;
    }
    Low = min(Low, Count - 2);
    return float2(
        Low, saturate((Angle - Angles[Offset + Low]) / (Angles[Offset + Low + 1] - Angles[Offset + Low])));
}
float ProfileIntensity(LightShape L, float θ, float φ)
{
    if (L.Profile.y == 0)
        return 1;
    if (θ < Angles[L.Profile.x] || θ > Angles[L.Profile.x + L.Profile.y - 1])
        return 0;
    φ = fmod(φ + 360, 360);
    float Coverage = Angles[L.Profile.z + L.Profile.w - 1];
    if (L.Profile.w > 1)
    {
        if (Coverage == 90)
        {
            if (φ > 180)
                φ = 360 - φ;
            if (φ > 90)
                φ = 180 - φ;
        }
        else if (Coverage == 180 && φ > 180)
            φ = 360 - φ;
    }
    float2 V = Interval(L.Profile.x, L.Profile.y, θ), H = Interval(L.Profile.z, L.Profile.w, φ);
    uint A = uint(L.PeakActive.z) + uint(H.x) * L.Profile.y + uint(V.x);
    uint B = uint(L.PeakActive.z) + min(uint(H.x) + 1, L.Profile.w - 1) * L.Profile.y + uint(V.x);
    return lerp(lerp(Angles[A], Angles[A + 1], V.y), lerp(Angles[B], Angles[B + 1], V.y), H.y) /
           L.PeakActive.x;
}
float3 Arrival(LightShape L, float3 Point, out float3 Direction, out float Distance, float SunTransmittance = 1)
{
    Direction = L.PositionReach.xyz;
    Distance = 1e30;
    if (L.PeakActive.y == 0)
        return 0;
    if (L.RadianceCategory.w == 0)
    {
        bool Solar = (Extent.Primary.w & 16u) != 0 &&
                     dot(L.PositionReach.xyz, CloudParameter(3).xyz) > .9999;
        float FogT = asuint(Extent.Minimum.w) != 0 ? FogTransmission(Point, Direction, FogParameter(3).z) : 1;
        return L.RadianceCategory.xyz * ((Solar ? SunTransmittance : 1) * FogT);
    }
    float3 Delta = L.PositionReach.xyz - Point;
    Distance = length(Delta);
    Direction = Distance > 0 ? Delta / Distance : float3(0, 0, 1);
    if (L.PositionReach.w > 0 && Distance >= L.PositionReach.w)
        return 0;
    float Angular = 1;
    if (L.RadianceCategory.w == 2 || L.Profile.y != 0)
    {
        float3 Forward = Unit(L.DirectionInner.xyz), Toward = -Direction;
        float Cosine = clamp(dot(Forward, Toward), -1, 1);
        if (L.RadianceCategory.w == 2)
        {
            float T = saturate((Cosine - L.UpOuter.w) / (L.DirectionInner.w - L.UpOuter.w));
            Angular = T * T * (3 - 2 * T);
        }
        if (L.Profile.y != 0)
        {
            float3 Right = Unit(cross(L.UpOuter.xyz, Forward)), Up = cross(Forward, Right);
            Angular *= ProfileIntensity(L, acos(Cosine) * 180 / 3.141592653589793,
                                        atan2(dot(Toward, Right), dot(Toward, Up)) * 180 / 3.141592653589793);
        }
    }
    float Window = 1;
    if (L.PositionReach.w > 0)
    {
        float Q = Distance / L.PositionReach.w;
        Window = 1 - Q * Q * Q * Q;
        Window *= Window;
    }
    float FogT = asuint(Extent.Minimum.w) != 0
        ? FogTransmission(Point, Direction, min(Distance, FogParameter(3).z)) : 1;
    return L.RadianceCategory.xyz * (Angular * Window * FogT / max(Distance * Distance, 1e-6));
}
float ProposalPower(SurfacePoint R, uint Index)
{
    float3 Direction;
    float Distance;
    float3 Incident = Arrival(Lights[Index], R.PositionHit.xyz, Direction, Distance);
    return max(Power(Incident) * max(dot(R.NormalRoughness.xyz, Direction), 0), 1e-8);
}
#include "MaterialRayScattering.slang"

float3 Brdf(SurfacePoint R, float3 Direction)
{
    float3 N = Unit(R.NormalRoughness.xyz), V = Unit(R.ViewMetallic.xyz), L = Unit(Direction);
    float NV = max(dot(N, V), 0), NL = max(dot(N, L), 0);
    if (NV <= 0 || NL <= 0)
        return 0;
    if (MaterialAddress(R) > 0)
        return EvaluateScatteringSequence(ReadMaterialScattering(R), N, V, L, float3(1));
    float3 H = Unit(V + L);
    float NH = saturate(dot(N, H)), VH = saturate(dot(V, H));
    float Roughness = clamp(R.NormalRoughness.w, .04, 1), α = Roughness * Roughness, α2 = α * α;
    float Denominator = NH * NH * (α2 - 1) + 1;
    float Distribution = α2 / (3.141592653589793 * Denominator * Denominator);
    float Visibility =
        .5 / max(NL * sqrt(NV * NV * (1 - α2) + α2) + NV * sqrt(NL * NL * (1 - α2) + α2), 1e-12);
    float Ior = max(R.AlbedoIor.w, 1), Ratio = (Ior - 1) / (Ior + 1), Metallic = saturate(R.ViewMetallic.w);
    float Dielectric = Ratio * Ratio * saturate(R.ResidualSpecular.w) * 2;
    float3 F0 = lerp(float3(Dielectric), R.AlbedoIor.xyz, Metallic);
    float3 Fresnel = F0 + (1 - F0) * pow(1 - VH, 5);
    return Distribution * Visibility * Fresnel +
           (1 - Fresnel) * R.AlbedoIor.xyz * ((1 - Metallic) / 3.141592653589793);
}
float3 Contribution(SurfacePoint R, uint Index, out float3 Direction, out float Distance, float SunTransmittance)
{
    float3 Incoming = Arrival(Lights[Index], R.PositionHit.xyz, Direction, Distance, SunTransmittance);
    if (all(Incoming == 0))
        return 0;
    float3 Shadow = (Extent.Primary.w & 32u) != 0
        ? MaterialShadowTransmission(R.PositionHit.xyz + R.NormalRoughness.xyz * .002, Direction, Distance - .004)
        : float3(1);
    return Brdf(R, Direction) * Incoming * Shadow * max(dot(R.NormalRoughness.xyz, Direction), 0);
}
uint NextRandom(inout uint Bits)
{
    Bits = Bits * 747796405u + 2891336453u;
    uint Word = ((Bits >> ((Bits >> 28u) + 4u)) ^ Bits) * 277803737u;
    return (Word >> 22u) ^ Word;
}
float RandomUnit(inout uint Bits) { return float(NextRandom(Bits) >> 8) * (1.0 / 16777216.0); }

[shader("compute")][numthreads(64, 1, 1)] void EvaluateLightReceivers(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    if (R.PositionHit.w == 0)
    {
        OutputColour[Pixel] = float4(R.ResidualSpecular.xyz, 0);
        if (Extent.Dimensions.w == 3)
        {
            StoreHistory(2, Pixel, 0);
            StoreHistory(5, Pixel, 0);
            StoreHistory(13, Pixel, float4(-1, 0, 0, 0));
        }
        return;
    }
    float SunTransmittance = CloudSunTransmittance(R.PositionHit.xyz);
    uint First = 0, Count = Extent.Dimensions.y;
    bool Whole = Extent.Dimensions.w == 0;
    if (!Whole)
    {
        float3 Point = R.PositionHit.xyz;
        if (any(Point < Extent.Minimum.xyz) || any(Point >= Extent.Maximum.xyz))
            Whole = true;
        else
        {
            uint3 Cell = min(uint3((Point - Extent.Minimum.xyz) / (Extent.Maximum.xyz - Extent.Minimum.xyz) *
                                   float3(Extent.Grid.xyz)),
                             Extent.Grid.xyz - 1);
            First = ((Cell.z * Extent.Grid.y + Cell.y) * Extent.Grid.x + Cell.x) * (Extent.Dimensions.z + 1);
            Count = Cells[First];
            if (Count > Extent.Dimensions.z)
                Whole = true;
        }
        if (Whole)
        {
            Count = Extent.Dimensions.y;
            InterlockedAdd(Counters[1], 1);
        }
    }
    InterlockedAdd(Counters[0], Count);
    float3 Direct = 0;
    if (Extent.Dimensions.w >= 2)
    {
        float Mass = 0;
        for (uint I = 0; I < Count; ++I)
        {
            uint Index = Whole ? I : Cells[First + 1 + I];
            Mass += ProposalPower(R, Index);
        }
        uint Bits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u), Selected = 0;
        float WeightSum = 0, SelectedTarget = 0;
        for (uint C = 0; C < Extent.Sampling.y && Count > 0; ++C)
        {
            float Draw = RandomUnit(Bits) * Mass, Sum = 0;
            uint Index = Whole ? Count - 1 : Cells[First + Count];
            for (uint I = 0; I < Count; ++I)
            {
                uint Candidate = Whole ? I : Cells[First + 1 + I];
                Sum += ProposalPower(R, Candidate);
                if (Draw < Sum)
                {
                    Index = Candidate;
                    break;
                }
            }
            float3 Dir;
            float Dist;
            float Target = Power(Contribution(R, Index, Dir, Dist, SunTransmittance));
            float Proposal = ProposalPower(R, Index) / Mass, Weight = Target / Proposal;
            WeightSum += Weight;
            if (RandomUnit(Bits) * WeightSum < Weight)
            {
                Selected = Index;
                SelectedTarget = Target;
            }
        }
        float Multiplicity = Count > 0 ? float(Extent.Sampling.y) : 0;
        int Previous = -1;
        bool ColourValid = false;
        if (Extent.Dimensions.w == 3)
        {
            Previous = ReprojectReceiver(R);
            ColourValid = Previous >= 0;
            if (Previous >= 0)
            {
                InterlockedAdd(Counters[4], 1);
                float4 Source = LoadHistory(1, uint(Previous));
                if (Source.y > 0 && Source.z > 0 && uint(Source.x) < Extent.Dimensions.y &&
                    Extent.Reconstruction.x != 0)
                {
                    float3 PreviousDirection;
                    float PreviousDistance;
                    float3 F = Contribution(R, uint(Source.x), PreviousDirection, PreviousDistance, SunTransmittance);
                    float Target = Power(F), SourceCount = min(Source.z, 64);
                    float Weight = Target * Source.y * SourceCount;
                    Multiplicity += SourceCount;
                    WeightSum += Weight;
                    if (RandomUnit(Bits) * WeightSum < Weight)
                    {
                        Selected = uint(Source.x);
                        SelectedTarget = Target;
                    }
                    bool Visible = any(F != 0) && !Occluded(R.PositionHit.xyz + R.NormalRoughness.xyz * .002,
                                                            PreviousDirection, PreviousDistance - .004);
                    if (float(Visible) != Source.w)
                    {
                        ColourValid = false;
                        InterlockedAdd(Counters[7], 1);
                    }
                }
            }
            else
            {
                InterlockedAdd(Counters[5], 1);
                if (Extent.History.w != 0)
                    InterlockedAdd(Counters[6], 1);
            }
            StoreHistory(13, Pixel, float4(Previous, Previous >= 0 ? 1 : 0, ColourValid ? 1 : 0, 0));
        }
        float Visibility = 0, FinalWeight = 0;
        if (SelectedTarget > 0)
        {
            float3 Dir;
            float Dist;
            float3 F = Contribution(R, Selected, Dir, Dist, SunTransmittance);
            Visibility = Occluded(R.PositionHit.xyz + R.NormalRoughness.xyz * .002, Dir, Dist - .004) ? 0 : 1;
            FinalWeight = WeightSum / (max(Multiplicity, 1) * SelectedTarget);
            Direct = F * (FinalWeight * Visibility);
        }
        if (Extent.Dimensions.w == 3)
        {
            StoreHistory(2, Pixel, float4(Selected, FinalWeight, Multiplicity, Visibility));
            StoreHistory(5, Pixel, float4(Direct, Power(Direct)));
        }
    }
    else
    {
        for (uint I = 0; I < Count; ++I)
        {
            uint Index = Whole ? I : Cells[First + 1 + I];
            float3 Dir;
            float Dist;
            float3 F = Contribution(R, Index, Dir, Dist, SunTransmittance);
            if (any(F != 0) && !Occluded(R.PositionHit.xyz + R.NormalRoughness.xyz * .002, Dir, Dist - .004))
                Direct += F;
        }
    }
    OutputColour[Pixel] = float4(Direct + R.ResidualSpecular.xyz, Power(Direct));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   REPROJECTED RESERVOIRS
//------------------------------------------------------------------------------------------------------------------------

float4 LoadHistory(uint Slot, uint Pixel)
{
    return OutputColour[Slot * Extent.Dimensions.x + Pixel];
}
void StoreHistory(uint Slot, uint Pixel, float4 Sample)
{
    OutputColour[Slot * Extent.Dimensions.x + Pixel] = Sample;
}
int ReprojectReceiver(SurfacePoint R)
{
    if (Extent.History.w != 0 || Extent.History.z == 0 || R.MotionPixel.w == 0 ||
        R.MotionPositionToken.w == 0)
        return -1;
    int2 Corner = int2(floor(R.MotionPixel.xy));
    int Selected = -1;
    float Closest = R.MotionPixel.z;
    for (int Y = 0; Y <= 1; ++Y)
        for (int X = 0; X <= 1; ++X)
        {
            int2 P = Corner + int2(X, Y);
            if (any(P < 0) || P.x >= int(Extent.History.x) || P.y >= int(Extent.History.y))
                continue;
            uint Index = uint(P.y) * Extent.History.x + uint(P.x);
            float4 Position = LoadHistory(8, Index), Normal = LoadHistory(9, Index),
                   Material = LoadHistory(10, Index), Optics = LoadHistory(11, Index);
            if (Position.w != R.MotionPositionToken.w || dot(Normal.xyz, Unit(R.MotionNormal.xyz)) < .95)
                continue;
            if (abs(Normal.w - R.NormalRoughness.w) > 1e-4 ||
                any(abs(Material.xyz - R.AlbedoIor.xyz) > 1e-4) ||
                abs(Material.w - R.ViewMetallic.w) > 1e-4 || abs(Optics.x - R.AlbedoIor.w) > 1e-4 ||
                abs(Optics.y - R.ResidualSpecular.w) > 1e-4)
                continue;
            float Distance = length(Position.xyz - R.MotionPositionToken.xyz);
            if (Distance < Closest)
            {
                Closest = Distance;
                Selected = int(Index);
            }
        }
    return Selected;
}
bool NearbyReceiver(SurfacePoint A, SurfacePoint B, float Radius)
{
    return B.PositionHit.w != 0 && A.MotionPositionToken.w == B.MotionPositionToken.w &&
           dot(Unit(A.NormalRoughness.xyz), Unit(B.NormalRoughness.xyz)) > .95 &&
           length(A.PositionHit.xyz - B.PositionHit.xyz) < Radius &&
           all(abs(A.AlbedoIor - B.AlbedoIor) < 1e-4) && abs(A.ViewMetallic.w - B.ViewMetallic.w) < 1e-4 &&
           abs(A.NormalRoughness.w - B.NormalRoughness.w) < 1e-4 &&
           abs(A.ResidualSpecular.w - B.ResidualSpecular.w) < 1e-4;
}
[shader("compute")][numthreads(64, 1, 1)] void ReuseLightNeighbours(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    if (R.PositionHit.w == 0)
    {
        StoreHistory(3, Pixel, 0);
        return;
    }
    float SunTransmittance = CloudSunTransmittance(R.PositionHit.xyz);
    float4 Initial = LoadHistory(2, Pixel);
    float Sum = 0, Count = 0, SelectedTarget = 0;
    uint Selected = 0;
    uint Bits = Extent.Sampling.x ^ (Pixel * 2891336453u + 1013904223u);
    int2 Centre = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    for (uint I = 0; I < 5; ++I)
    {
        if (I > 0 && Extent.Reconstruction.y == 0)
            break;
        int2 Offset = I == 0   ? int2(0, 0)
                      : I == 1 ? int2(1, 0)
                      : I == 2 ? int2(-1, 0)
                      : I == 3 ? int2(0, 1)
                               : int2(0, -1);
        int2 P = Centre + Offset;
        if (any(P < 0) || P.x >= int(Extent.History.x) || P.y >= int(Extent.History.y))
            continue;
        uint Index = uint(P.y) * Extent.History.x + uint(P.x);
        if (I > 0 && !NearbyReceiver(R, Receivers[Index], max(.03, R.MotionPixel.z * 2)))
            continue;
        float4 Source = LoadHistory(2, Index);
        if (Source.y <= 0 || Source.z <= 0 || uint(Source.x) >= Extent.Dimensions.y)
            continue;
        float3 Direction;
        float Distance;
        float Target = Power(Contribution(R, uint(Source.x), Direction, Distance, SunTransmittance));
        float Multiplicity = min(Source.z, I == 0 ? 72 : 32), Weight = Target * Source.y * Multiplicity;
        Count += Multiplicity;
        Sum += Weight;
        if (RandomUnit(Bits) * Sum < Weight)
        {
            Selected = uint(Source.x);
            SelectedTarget = Target;
        }
        if (I > 0)
            InterlockedAdd(Counters[8], 1);
    }
    float3 Direct = 0;
    float Weight = 0, Visible = 0;
    if (SelectedTarget > 0)
    {
        float3 Direction;
        float Distance;
        float3 F = Contribution(R, Selected, Direction, Distance, SunTransmittance);
        Visible =
            Occluded(R.PositionHit.xyz + R.NormalRoughness.xyz * .002, Direction, Distance - .004) ? 0 : 1;
        Weight = Sum / (max(Count, 1) * SelectedTarget);
        Direct = F * (Weight * Visible);
    }
    StoreHistory(3, Pixel, float4(Selected, Weight, Count, Visible));
    StoreHistory(5, Pixel, float4(Direct, Power(Direct)));
}

    //------------------------------------------------------------------------------------------------------------------------
    //                                              TEMPORAL MOMENTS AND EDGE FILTERING
    //------------------------------------------------------------------------------------------------------------------------

    [shader("compute")][numthreads(64, 1, 1)] void ReconstructLightHistory(
        uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    float4 Raw = LoadHistory(5, Pixel), Link = LoadHistory(13, Pixel);
    float Length = 1, α = 1;
    float3 Colour = Raw.xyz;
    float Mean = Raw.w, Second = Raw.w * Raw.w;
    if (R.PositionHit.w != 0 && Extent.Reconstruction.z != 0 && Extent.Reconstruction.x != 0 && Link.z != 0)
    {
        uint Previous = uint(Link.x);
        float4 Old = LoadHistory(4, Previous), Moments = LoadHistory(11, Previous);
        float3 Average = 0, Square = 0;
        float Neighbours = 0;
        int2 Centre = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
        for (int Y = -1; Y <= 1; ++Y)
            for (int X = -1; X <= 1; ++X)
            {
                int2 P = Centre + int2(X, Y);
                if (any(P < 0) || P.x >= int(Extent.History.x) || P.y >= int(Extent.History.y))
                    continue;
                uint Index = uint(P.y) * Extent.History.x + uint(P.x);
                if (!NearbyReceiver(R, Receivers[Index], max(.03, R.MotionPixel.z * 3)))
                    continue;
                float3 C = LoadHistory(5, Index).xyz;
                Average += C;
                Square += C * C;
                Neighbours += 1;
            }
        Average /= max(Neighbours, 1);
        Square /= max(Neighbours, 1);
        float3 Deviation = sqrt(max(Square - Average * Average, 0) + 1e-6);
        float3 Clipped = clamp(Old.xyz, max(0, Average - 3 * Deviation), Average + 3 * Deviation);
        Length = min(Old.w + 1, 16);
        α = 1 / Length;
        Colour = lerp(Clipped, Raw.xyz, α);
        Mean = lerp(Moments.z, Raw.w, α);
        Second = lerp(Moments.w, Raw.w * Raw.w, α);
        InterlockedAdd(Counters[9], 1);
    }
    StoreHistory(6, Pixel, float4(Colour, max(0, Second - Mean * Mean) / Length));
    StoreHistory(14, Pixel, float4(Mean, Second, Length, 0));
}
[shader("compute")][numthreads(64, 1, 1)] void FilterLightNeighbours(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    uint Source = Extent.Reconstruction.w == 0 ? 6 : 12, Destination = Extent.Reconstruction.w == 0 ? 12 : 7;
    float4 CentreColour = LoadHistory(Source, Pixel);
    SurfacePoint R = Receivers[Pixel];
    if (R.PositionHit.w == 0 || Extent.Reconstruction.z == 0)
    {
        StoreHistory(Destination, Pixel, CentreColour);
        return;
    }
    int2 Centre = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    int Step = 1 << Extent.Reconstruction.w;
    float3 Sum = 0;
    float WeightSum = 0, Variance = 0;
    for (int Y = -2; Y <= 2; ++Y)
        for (int X = -2; X <= 2; ++X)
        {
            int2 P = Centre + int2(X, Y) * Step;
            if (any(P < 0) || P.x >= int(Extent.History.x) || P.y >= int(Extent.History.y))
                continue;
            uint Index = uint(P.y) * Extent.History.x + uint(P.x);
            SurfacePoint S = Receivers[Index];
            if (!NearbyReceiver(R, S, max(.04, R.MotionPixel.z * float(Step) * 4)))
                continue;
            float4 C = LoadHistory(Source, Index);
            float Distance = abs(Power(C.xyz) - Power(CentreColour.xyz));
            float Weight = (X == 0 ? 6 : abs(X) == 1 ? 4 : 1) * (Y == 0 ? 6 : abs(Y) == 1 ? 4 : 1);
            Weight *= exp(-Distance / (.02 + 4 * sqrt(max(0, C.w + CentreColour.w))));
            Weight *= pow(max(dot(Unit(R.NormalRoughness.xyz), Unit(S.NormalRoughness.xyz)), 0), 32);
            Sum += C.xyz * Weight;
            WeightSum += Weight;
            Variance += C.w * Weight * Weight;
        }
    StoreHistory(Destination, Pixel,
                 float4(Sum / max(WeightSum, 1e-12), Variance / max(WeightSum * WeightSum, 1e-12)));
}[shader("compute")][numthreads(64, 1, 1)] void FinalizeLightHistory(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    float4 Reconstructed = LoadHistory(7, Pixel), Moments = LoadHistory(14, Pixel);
    OutputColour[Pixel] = float4(Reconstructed.xyz + R.ResidualSpecular.xyz, Power(Reconstructed.xyz));
    StoreHistory(1, Pixel, LoadHistory(3, Pixel));
    StoreHistory(4, Pixel, float4(LoadHistory(6, Pixel).xyz, Moments.z));
    StoreHistory(8, Pixel, float4(R.PositionHit.xyz, R.PositionHit.w != 0 ? R.MotionPositionToken.w : 0));
    StoreHistory(9, Pixel, R.NormalRoughness);
    StoreHistory(10, Pixel, float4(R.AlbedoIor.xyz, R.ViewMetallic.w));
    StoreHistory(11, Pixel, float4(R.AlbedoIor.w, R.ResidualSpecular.w, Moments.xy));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PRIMARY RAY VISIBILITY
//------------------------------------------------------------------------------------------------------------------------

float4 CameraProjection(uint Slot)
{
    uint Offset = Extent.Primary.y + Slot * 4;
    return float4(Angles[Offset], Angles[Offset + 1], Angles[Offset + 2], Angles[Offset + 3]);
}
bool FacetStrike(FacetCorners Triangle, float3 Origin, float3 Direction, float Minimum, float Maximum,
                 out float3 Strike)
{
    Strike = 0;
    float3 E1 = Triangle.B.xyz - Triangle.A.xyz, E2 = Triangle.C.xyz - Triangle.A.xyz;
    float3 P = cross(Direction, E2);
    float Determinant = dot(E1, P);
    if (abs(Determinant) < 1e-12)
        return false;
    float3 Offset = Origin - Triangle.A.xyz;
    float U = dot(Offset, P) / Determinant;
    if (U < 0 || U > 1)
        return false;
    float3 Q = cross(Offset, E1);
    float V = dot(Direction, Q) / Determinant;
    if (V < 0 || U + V > 1)
        return false;
    float Distance = dot(E2, Q) / Determinant;
    Strike = float3(Distance, U, V);
    return Distance > Minimum && Distance < Maximum;
}
uint NearestFacet(float3 Origin, float3 Direction, float Minimum, float Maximum, out float3 Strike)
{
    uint Selected = 0xffffffffu;
    Strike = float3(Maximum, 0, 0);
    if (Extent.Grid.w == 0)
        return Selected;
    uint Stack[64];
    uint Count = 1;
    Stack[0] = 0;
    while (Count > 0)
    {
        FacetEnclosure Box = Enclosures[Stack[--Count]];
        if (!IntersectsBox(Box, Origin, Direction, Strike.x))
            continue;
        if (Box.Links.z != 0)
        {
            for (uint I = 0; I < Box.Links.y; ++I)
            {
                uint Index = Box.Links.x + I;
                float3 Candidate;
                if (FacetStrike(Facets[Index], Origin, Direction, Minimum, Strike.x, Candidate))
                {
                    Strike = Candidate;
                    Selected = Index;
                }
            }
        }
        else
        {
            if (Count + 2 > min(64u, max(1u, Extent.Sampling.w)))
            {
                InterlockedAdd(Counters[12], 1);
                for (uint I = 0; I < Extent.Sampling.z; ++I)
                {
                    float3 Candidate;
                    if (FacetStrike(Facets[I], Origin, Direction, Minimum, Strike.x, Candidate))
                    {
                        Strike = Candidate;
                        Selected = I;
                    }
                }
                return Selected;
            }
            Stack[Count++] = Box.Links.x;
            Stack[Count++] = Box.Links.y;
        }
    }
    return Selected;
}
float3 EnvironmentTexel(uint Face, int2 Pixel, uint Size, uint Offset, bool AtmosphereOnly = false)
{
    uint2 P = uint2(clamp(Pixel, int2(0), int2(Size - 1)));
    uint Index = Offset + ((Face * Size + P.y) * Size + P.x) * 3;
    if ((Extent.Primary.w & 16u) != 0 && !AtmosphereOnly)
        return OutputColour[Extent.Dimensions.x * 21 + (Face * Size + P.y) * Size + P.x].xyz;
    return float3(Angles[Index], Angles[Index + 1], Angles[Index + 2]);
}
float3 EnvironmentRadiance(float3 Direction, bool AtmosphereOnly = false)
{
    if ((Extent.Primary.w & 1u) == 0)
        return 0;
    float4 Map = CameraProjection(10);
    uint Size = uint(Map.y), Offset = uint(Map.x);
    if (Size == 0)
        return 0;
    float3 A = abs(Direction);
    uint Face;
    float2 Uv;
    if (A.x >= A.y && A.x >= A.z)
    {
        Face = Direction.x >= 0 ? 0 : 1;
        Uv = Direction.yz / A.x;
    }
    else if (A.y >= A.z)
    {
        Face = Direction.y >= 0 ? 2 : 3;
        Uv = Direction.xz / A.y;
    }
    else
    {
        Face = Direction.z >= 0 ? 4 : 5;
        Uv = Direction.xy / A.z;
    }
    float2 P = (Uv * .5 + .5) * Size - .5;
    int2 Low = int2(floor(P));
    float2 Fraction = frac(P);
    return lerp(lerp(EnvironmentTexel(Face, Low, Size, Offset, AtmosphereOnly),
                     EnvironmentTexel(Face, Low + int2(1, 0), Size, Offset, AtmosphereOnly), Fraction.x),
                lerp(EnvironmentTexel(Face, Low + int2(0, 1), Size, Offset, AtmosphereOnly),
                     EnvironmentTexel(Face, Low + int2(1, 1), Size, Offset, AtmosphereOnly), Fraction.x),
                Fraction.y) *
           Map.w;
}
SurfacePoint FacetSurface(uint Index, float3 Origin, float3 Direction, float3 Strike)
{
    FacetCorners F = Facets[Index];
    SurfacePoint R = (SurfacePoint)0;
    float3 Normal =
        Unit(F.NormalA.xyz * (1 - Strike.y - Strike.z) + F.NormalB.xyz * Strike.y + F.NormalC.xyz * Strike.z);
    if (dot(Normal, Direction) > 0)
        Normal = -Normal;
    R.PositionHit = float4(Origin + Direction * Strike.x, 1);
    R.NormalRoughness = float4(Normal, F.AlbedoRoughness.w);
    R.ViewMetallic = float4(-Direction, F.OpticalToken.x);
    R.AlbedoIor = float4(F.AlbedoRoughness.xyz, F.OpticalToken.y);
    R.ResidualSpecular = float4(F.Emissive.xyz, F.OpticalToken.z);
    ApplyRayMaterial(R, F, Strike.yz);
    return R;
}
[shader("compute")][numthreads(64, 1, 1)] void TracePrimarySurfaces(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    uint2 Coordinate = uint2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    float2 Ndc = (float2(Coordinate) + .5) / float2(Extent.History.xy) * 2 - 1;
    Ndc.y = -Ndc.y;
    float4 Eye = CameraProjection(0), Forward = CameraProjection(1), Right = CameraProjection(2),
           Up = CameraProjection(3);
    float3 Direction = Unit(Forward.xyz + Right.xyz * (Ndc.x * Right.w) + Up.xyz * (Ndc.y * Up.w));
    float Projection = dot(Direction, Forward.xyz);
    float3 Strike;
    uint Index = NearestFacet(Eye.xyz, Direction, Eye.w / Projection, Forward.w / Projection, Strike);
    SurfacePoint R = (SurfacePoint)0;
    R.ExpectedDirect = asfloat(uint4(0x7fc00000));
    if (Index == 0xffffffffu)
    {
        float3 Sky = EnvironmentRadiance(Direction);
        if ((Extent.Primary.w & 16u) != 0)
        {
            float4 Cloud = CloudRay(Eye.xyz, Direction);
            Sky = Cloud.xyz * CameraProjection(10).w + Cloud.w * EnvironmentRadiance(Direction, true);
        }
        R.ResidualSpecular = float4(Sky, 0);
        Receivers[Pixel] = R;
        StoreHistory(15, Pixel, float4(-1, -1, 0, 0));
        InterlockedAdd(Counters[11], 1);
        return;
    }
    InterlockedAdd(Counters[10], 1);
    FacetCorners F = Facets[Index];
    float3 Position = Eye.xyz + Direction * Strike.x;
    float3 Normal =
        Unit(F.NormalA.xyz * (1 - Strike.y - Strike.z) + F.NormalB.xyz * Strike.y + F.NormalC.xyz * Strike.z);
    if (dot(Normal, Direction) > 0)
        Normal = -Normal;
    R.PositionHit = float4(Position, 1);
    R.NormalRoughness = float4(Normal, F.AlbedoRoughness.w);
    R.ViewMetallic = float4(-Direction, F.OpticalToken.x);
    R.AlbedoIor = float4(F.AlbedoRoughness.xyz, F.OpticalToken.y);
    R.ResidualSpecular = float4(F.Emissive.xyz, F.OpticalToken.z);
    ApplyRayMaterial(R, F, Strike.yz);
    float4 CurrentRigid = CameraProjection(8), PreviousRigid = CameraProjection(9);
    float3 PreviousPosition = Position, PreviousNormal = Normal;
    if (F.OpticalToken.w > CurrentRigid.z)
    {
        float4 Rotation = CameraProjection(11);
        float X = Position.x - CurrentRigid.y, Y = Position.y;
        float2 Local = float2(Rotation.x * X + Rotation.y * Y, -Rotation.y * X + Rotation.x * Y);
        PreviousPosition.xy = float2(Rotation.z * Local.x - Rotation.w * Local.y + PreviousRigid.y,
                                     Rotation.w * Local.x + Rotation.z * Local.y);
        float Cosine = Rotation.z * Rotation.x + Rotation.w * Rotation.y;
        float Sine = Rotation.w * Rotation.x - Rotation.z * Rotation.y;
        PreviousNormal.xy = float2(Cosine * Normal.x - Sine * Normal.y, Sine * Normal.x + Cosine * Normal.y);
    }
    R.MotionPositionToken = float4(PreviousPosition, F.OpticalToken.w);
    R.MotionNormal = float4(PreviousNormal, 0);
    float4 PreviousEye = CameraProjection(4), PreviousForward = CameraProjection(5),
           PreviousRight = CameraProjection(6), PreviousUp = CameraProjection(7);
    float3 Relative = PreviousPosition - PreviousEye.xyz;
    float Depth = dot(Relative, PreviousForward.xyz);
    if (Depth > PreviousEye.w)
    {
        R.MotionPixel = float4(
            (dot(Relative, PreviousRight.xyz) / (Depth * PreviousRight.w) * .5 + .5) * Extent.History.x - .5,
            (.5 - dot(Relative, PreviousUp.xyz) / (Depth * PreviousUp.w) * .5) * Extent.History.y - .5,
            max(.03, Depth * PreviousUp.w * 4 / Extent.History.y), 1);
    }
    Receivers[Pixel] = R;
    StoreHistory(15, Pixel, float4(Strike.x, float(Index), Strike.yz));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ONE-BOUNCE DIFFUSE TRANSPORT
//------------------------------------------------------------------------------------------------------------------------
float3 DiffuseTransportResponse(SurfacePoint R, float3 Direction)
{
    float Ior = max(R.AlbedoIor.w, 1), Ratio = (Ior - 1) / (Ior + 1), Metallic = saturate(R.ViewMetallic.w);
    float3 F0 = lerp(float3(Ratio * Ratio * saturate(R.ResidualSpecular.w) * 2), R.AlbedoIor.xyz, Metallic);
    float Cosine = saturate(dot(Unit(R.ViewMetallic.xyz), Unit(Unit(R.ViewMetallic.xyz) + Direction)));
    float3 Fresnel = F0 + (1 - F0) * pow(1 - Cosine, 5);
    return (1 - Fresnel) * R.AlbedoIor.xyz * ((1 - Metallic) / 3.141592653589793);
}
float3 SampleEmissiveFacet(SurfacePoint R, inout uint Bits)
{
    uint Offset = uint(CameraProjection(10).z), Count = uint(Angles[Offset]);
    if (Count == 0)
        return 0;
    float Draw = RandomUnit(Bits);
    uint Low = 0, High = Count - 1;
    while (Low < High)
    {
        uint Mid = (Low + High) / 2;
        if (Draw < Angles[Offset + 1 + Mid * 4 + 3])
            High = Mid;
        else
            Low = Mid + 1;
    }
    uint Entry = Offset + 1 + Low * 4;
    FacetCorners F = Facets[uint(Angles[Entry])];
    float Root = sqrt(RandomUnit(Bits)), V = RandomUnit(Bits);
    float3 Position = F.A.xyz * (1 - Root) + F.B.xyz * (Root * (1 - V)) + F.C.xyz * (Root * V);
    float3 Delta = Position - R.PositionHit.xyz;
    float Squared = dot(Delta, Delta);
    if (Squared < 1e-8)
        return 0;
    float3 Direction = Delta * rsqrt(Squared), Geometric = Unit(cross(F.B.xyz - F.A.xyz, F.C.xyz - F.A.xyz));
    float Geometry = max(dot(R.NormalRoughness.xyz, Direction), 0) * abs(dot(Geometric, Direction));
    if (Geometry == 0)
        return 0;
    float3 ShadowOrigin = R.PositionHit.xyz + R.NormalRoughness.xyz * .002, Segment = Position - ShadowOrigin;
    float Length = length(Segment);
    if (Length <= .004 || Occluded(ShadowOrigin, Segment / Length, Length - .002))
        return 0;
    float FogT = asuint(Extent.Minimum.w) != 0 ? FogTransmission(ShadowOrigin, Segment / Length, Length) : 1;
    return DiffuseTransportResponse(R, Direction) * F.Emissive.xyz *
           (FogT * Geometry * Angles[Entry + 2] / (Squared * Angles[Entry + 1]));
}
#include "MaterialRayTransport.slang"

[shader("compute")][numthreads(64, 1, 1)] void TraceSurfaceTransport(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    if (R.PositionHit.w == 0)
    {
        StoreHistory(16, Pixel, 0);
        return;
    }
    if (MaterialAddress(R) > 0)
    {
        uint Category = MaterialTransport(R);
        float3 N = R.NormalRoughness.xyz, V = R.ViewMetallic.xyz;
        float3 Direction = reflect(-V, N), Origin = R.PositionHit.xyz + N * .003;
        float3 Radiance = 0;
        if (Category == 1 || Category == 2 || Category == 3)
        {
            bool Hit = false;
            SurfacePoint ScreenStrike;
            bool Screen = Category == 3 && TraceDepthScreen(Origin, Direction, ScreenStrike);
            float3 Reflected = Screen ? ShadeRayStrike(ScreenStrike) : TraceMaterialRadiance(Origin, Direction, Hit);
            float F = .04 + .96 * pow(1 - saturate(dot(N, V)), 5);
            float3 PlasticOrigin = lerp(float3(.04), R.AlbedoIor.xyz, saturate(R.ViewMetallic.w));
            float3 PlasticFresnel = PlasticOrigin + (1 - PlasticOrigin) * pow(1 - saturate(dot(N, V)), 5);
            Radiance = Reflected * (Category == 1 ? float3(.94) : Category == 2 ? float3(2 * F / (1 + F)) : PlasticFresnel);
            R.ExpectedDirect.x = Category == 3 ? (Screen ? 3 : 4) : Category;
            R.ExpectedDirect.y = Screen || Hit ? 1 : 0;
            if (Category == 2)
            {
                float3 Behind = TraceMaterialRadiance(R.PositionHit.xyz - N * .003, -V, Hit);
                Radiance += Behind * ((1 - F) / (1 + F)) *
                    exp(-float3(.8, .15, .4) * .006 / max(.05, dot(N, V)));
            }
            if (Category != 3)
            {
                StoreHistory(16, Pixel, float4(Radiance, 1));
                R.ResidualSpecular.xyz += Radiance;
                Receivers[Pixel] = R;
                return;
            }
            // 📝 Plastic uses a depth-screen specular lookup, BVH fallback and a separate diffuse estimator.
            R.ResidualSpecular.xyz += Radiance;
        }
        else
        {
            Radiance = IntegrateMaterialRays(R, Pixel);
            StoreHistory(16, Pixel, float4(Radiance, 1));
            R.ResidualSpecular.xyz += Radiance;
            Receivers[Pixel] = R;
            return;
        }
    }
    float3 N = R.NormalRoughness.xyz;
    float3 Tangent = Unit(cross(abs(N.z) < .999 ? float3(0, 0, 1) : float3(0, 1, 0), N)),
           Bitangent = cross(N, Tangent);
    uint Offset = uint(CameraProjection(8).w);
    float3 Sum = 0;
    uint EmissiveBits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u);
    for (uint Sample = 0; Sample < Extent.Primary.z; ++Sample)
    {
        uint Base = Offset + Sample * 3;
        float3 Local = float3(Angles[Base], Angles[Base + 1], Angles[Base + 2]);
        float3 Direction = Unit(Tangent * Local.x + Bitangent * Local.y + N * Local.z);
        float3 Origin = R.PositionHit.xyz + N * .002, Strike;
        uint Index = NearestFacet(Origin, Direction, 0, 1e30, Strike);
        float3 Incoming = 0;
        InterlockedAdd(Counters[13], 1);
        if (Index == 0xffffffffu)
        {
            Incoming = EnvironmentRadiance(Direction);
            InterlockedAdd(Counters[15], 1);
        }
        else
        {
            InterlockedAdd(Counters[14], 1);
            SurfacePoint Bounce = FacetSurface(Index, Origin, Direction, Strike);
            Incoming = (Extent.Primary.w & 2u) != 0 ? float3(0) : Bounce.ResidualSpecular.xyz;
            float SunTransmittance = CloudSunTransmittance(Bounce.PositionHit.xyz);
            for (uint I = 0; I < Extent.Dimensions.y; ++I)
            {
                float3 ToLight;
                float Distance;
                float3 C = Contribution(Bounce, I, ToLight, Distance, SunTransmittance);
                if (any(C != 0) && !Occluded(Bounce.PositionHit.xyz + Bounce.NormalRoughness.xyz * .002,
                                             ToLight, Distance - .004))
                    Incoming += C;
            }
        }
        Sum += DiffuseTransportResponse(R, Direction) * Incoming * 3.141592653589793;
        if ((Extent.Primary.w & 2u) != 0)
            Sum += SampleEmissiveFacet(R, EmissiveBits);
    }
    StoreHistory(16, Pixel, float4(Sum / Extent.Primary.z, 1));
    R.ResidualSpecular.xyz += Sum / Extent.Primary.z;
    Receivers[Pixel] = R;
}

    //------------------------------------------------------------------------------------------------------------------------
    //                                             TRANSPORT REPROJECTION AND SPATIAL RECONSTRUCTION
    //------------------------------------------------------------------------------------------------------------------------
    [shader("compute")][numthreads(64, 1, 1)] void ReprojectSurfaceTransport(
        uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    float4 Current = LoadHistory(16, Pixel);
    if (R.PositionHit.w == 0)
    {
        StoreHistory(17, Pixel, 0);
        StoreHistory(20, Pixel, 0);
        return;
    }
    float3 Low = Current.xyz, High = Current.xyz;
    int2 P = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    for (int Y = -1; Y <= 1; ++Y)
        for (int X = -1; X <= 1; ++X)
        {
            int2 Q = P + int2(X, Y);
            if (any(Q < 0) || Q.x >= int(Extent.History.x) || Q.y >= int(Extent.History.y))
                continue;
            uint I = uint(Q.y) * Extent.History.x + uint(Q.x);
            if (!NearbyReceiver(R, Receivers[I], R.MotionPixel.z * 2))
                continue;
            float3 C = LoadHistory(16, I).xyz;
            Low = min(Low, C);
            High = max(High, C);
        }
    int Previous = (Extent.Primary.w & 8u) != 0 ? -1 : ReprojectReceiver(R);
    float Length = 1;
    if (Previous >= 0)
    {
        float4 Old = LoadHistory(18, uint(Previous));
        if (Old.w > 0)
        {
            Length = min(Old.w + 1, 16);
            Current.xyz = lerp(clamp(Old.xyz, Low, High), Current.xyz, 1 / Length);
        }
        else
            Previous = -1;
    }
    StoreHistory(17, Pixel, float4(Current.xyz, Length));
    StoreHistory(20, Pixel, float4(Previous >= 0 ? 1 : 0, 0, Length, 0));
}
[shader("compute")][numthreads(64, 1, 1)] void FilterSurfaceTransport(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    if (R.PositionHit.w == 0)
    {
        StoreHistory(19, Pixel, 0);
        return;
    }
    int2 P = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    float3 Sum = 0;
    float Weight = 0;
    uint Count = 0;
    for (int Y = -2; Y <= 2; ++Y)
        for (int X = -2; X <= 2; ++X)
        {
            int2 Q = P + int2(X, Y);
            if (any(Q < 0) || Q.x >= int(Extent.History.x) || Q.y >= int(Extent.History.y))
                continue;
            uint I = uint(Q.y) * Extent.History.x + uint(Q.x);
            if (!NearbyReceiver(R, Receivers[I], max(.03, R.MotionPixel.z * 2)))
                continue;
            float W = (X == 0 ? 6 : abs(X) == 1 ? 4 : 1) * (Y == 0 ? 6 : abs(Y) == 1 ? 4 : 1);
            Sum += LoadHistory(17, I).xyz * W;
            Weight += W;
            ++Count;
        }
    StoreHistory(19, Pixel, float4(Sum / max(Weight, 1), LoadHistory(17, Pixel).w));
    float4 Diagnostic = LoadHistory(20, Pixel);
    Diagnostic.y = float(Count);
    StoreHistory(20, Pixel, Diagnostic);
}[shader("compute")][numthreads(64, 1, 1)] void ResolveSurfaceTransport(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    SurfacePoint R = Receivers[Pixel];
    float4 Filtered = LoadHistory(19, Pixel);
    StoreHistory(18, Pixel, Filtered);
    if (R.PositionHit.w != 0)
    {
        R.ResidualSpecular.xyz += Filtered.xyz - LoadHistory(16, Pixel).xyz;
        Receivers[Pixel] = R;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  VOLUMETRIC CLOUD RADIANCE CUBE
//------------------------------------------------------------------------------------------------------------------------
uint2 CloudAdd64(uint2 A, uint2 B)
{
    uint Low = A.x + B.x;
    return uint2(Low, A.y + B.y + (Low < A.x ? 1u : 0u));
}
uint2 CloudProduct32(uint A, uint B)
{
    uint A0 = A & 65535u, A1 = A >> 16, B0 = B & 65535u, B1 = B >> 16;
    uint W0 = A0 * B0, T = A1 * B0 + (W0 >> 16), W1 = (T & 65535u) + A0 * B1;
    return uint2((W1 << 16) | (W0 & 65535u), A1 * B1 + (T >> 16) + (W1 >> 16));
}
uint2 CloudMultiply64(uint2 A, uint2 B)
{
    uint2 P = CloudProduct32(A.x, B.x);
    P.y += A.y * B.x + A.x * B.y;
    return P;
}
float CloudLattice(int3 Cell, uint2 Seed)
{
    uint2 H =
        CloudAdd64(Seed, CloudProduct32(uint(Cell.x), 0x7f4a7c15u) + uint2(0, uint(Cell.x) * 0x9e3779b9u));
    H ^= CloudProduct32(uint(Cell.y), 0x27d4eb4fu) + uint2(0, uint(Cell.y) * 0xc2b2ae3du);
    H ^= CloudProduct32(uint(Cell.z), 0x9e3779f9u) + uint2(0, uint(Cell.z) * 0x165667b1u);
    H ^= uint2((H.x >> 29) | (H.y << 3), H.y >> 29);
    H = CloudMultiply64(H, uint2(0x1ce4e5b9u, 0xbf58476du));
    H.x ^= H.y;
    return float(H.y) * (1.0 / 4294967296.0);
}
float CloudNoise(float3 P, uint2 Seed)
{
    int3 C = int3(floor(P));
    float3 F = frac(P);
    F = F * F * (3 - 2 * F);
    float A = lerp(CloudLattice(C, Seed), CloudLattice(C + int3(1, 0, 0), Seed), F.x);
    float B = lerp(CloudLattice(C + int3(0, 1, 0), Seed), CloudLattice(C + int3(1, 1, 0), Seed), F.x);
    float D = lerp(CloudLattice(C + int3(0, 0, 1), Seed), CloudLattice(C + int3(1, 0, 1), Seed), F.x);
    float E = lerp(CloudLattice(C + int3(0, 1, 1), Seed), CloudLattice(C + int3(1, 1, 1), Seed), F.x);
    return lerp(lerp(A, B, F.y), lerp(D, E, F.y), F.z);
}
float4 CloudParameter(uint Slot)
{
    uint Offset = Extent.Primary.x - 1 + Slot * 4;
    return float4(Angles[Offset], Angles[Offset + 1], Angles[Offset + 2], Angles[Offset + 3]);
}
float CloudMedium(float3 P)
{
    float4 Layer = CloudParameter(0), Medium = CloudParameter(1), Wind = CloudParameter(2);
    if (P.z < Layer.x || P.z > Layer.y || Layer.y <= Layer.x)
        return 0;
    if (Medium.w >= 0)
        return Medium.w * Layer.w;
    float H = (P.z - Layer.x) / (Layer.y - Layer.x);
    float Profile = saturate(min(H * 4, 1) * (1 - max(H - .65, 0) / .35 * .85));
    float3 Q = float3((P.xy + Wind.xy * Medium.z) / 1400, P.z / 700);
    uint2 Seed = asuint(CloudParameter(5).xy);
    float Sum = 0, Amplitude = .5, Total = 0;
    for (uint I = 0; I < 4; ++I)
    {
        Sum += Amplitude * CloudNoise(Q, CloudAdd64(Seed, uint2(I * 131u, 0)));
        Total += Amplitude;
        Q = Q * 2.03 + float3(11.3, 7.7, 5.1);
        Amplitude *= .5;
    }
    return clamp((Sum / Total - (1 - saturate(Layer.z))) / max(saturate(Layer.z), .001), 0, 1.5) * Profile *
           Layer.w;
}
// 📝 Transmittance-only surface shadow ray: no phase or nested scattering march.
float CloudSunTransmittance(float3 Origin, uint ShadowSteps = 0)
{
    if ((Extent.Primary.w & 16u) == 0)
        return 1;
    float4 Layer = CloudParameter(0), Medium = CloudParameter(1), Wind = CloudParameter(2);
    float3 Direction = CloudParameter(3).xyz;
    float Enter = 0, Exit = Wind.z;
    if (abs(Direction.z) < 1e-9)
    {
        if (Origin.z < Layer.x || Origin.z > Layer.y)
            return 1;
    }
    else
    {
        float A = (Layer.x - Origin.z) / Direction.z, B = (Layer.y - Origin.z) / Direction.z;
        Enter = max(min(A, B), 0);
        Exit = min(max(A, B), Exit);
        if (Exit <= Enter)
            return 1;
    }
    uint Steps = ShadowSteps != 0 ? ShadowSteps : uint(Wind.w);
    if (Steps == 0 || Layer.w == 0 || Medium.x == 0)
        return 1;
    float Dt = (Exit - Enter) / Steps, T = 1;
    for (uint I = 0; I < Steps; ++I)
    {
        float Density = CloudMedium(Origin + Direction * (Enter + Dt * (I + .5)));
        T *= exp(-Medium.x * Density * Dt);
    }
    return T;
}
float4 CloudRay(float3 Origin, float3 Direction)
{
    float4 Layer = CloudParameter(0), Medium = CloudParameter(1), Wind = CloudParameter(2),
           Sun = CloudParameter(3), Solar = CloudParameter(4);
    float Enter = 0, Exit = Wind.z;
    if (abs(Direction.z) < 1e-9)
    {
        if (Origin.z < Layer.x || Origin.z > Layer.y)
            return float4(0, 0, 0, 1);
    }
    else
    {
        float A = (Layer.x - Origin.z) / Direction.z, B = (Layer.y - Origin.z) / Direction.z;
        Enter = max(min(A, B), 0);
        Exit = min(max(A, B), Exit);
        if (Exit <= Enter)
            return float4(0, 0, 0, 1);
    }
    uint Steps = uint(Wind.w);
    if (Steps == 0)
        return float4(0, 0, 0, 1);
    float Dt = (Exit - Enter) / Steps, G = Medium.y, Den = 1 + G * G - 2 * G * dot(Direction, Sun.xyz);
    float Phase = (1 - G * G) / (4 * 3.141592653589793 * Den * sqrt(max(Den, 1e-12))), T = 1;
    float3 L = 0;
    for (uint I = 0; I < Steps; ++I)
    {
        float3 P = Origin + Direction * (Enter + Dt * (I + .5));
        float Density = CloudMedium(P);
        if (Density <= 0)
            continue;
        float Step = exp(-Medium.x * Density * Dt);
        if (T < 1e-4)
        {
            T *= Step;
            continue;
        }
        float Optical = 0;
        for (uint J = 0; J < uint(Sun.w); ++J)
        {
            float3 S = P + Sun.xyz * (220 * (J + .5));
            Optical += Medium.x * CloudMedium(S) * 220;
            if (S.z > Layer.y && Sun.z > 0)
                break;
        }
        L += T * (1 - Step) * (Phase * exp(-Optical) * Solar.xyz + CloudParameter(6).xyz);
        T *= Step;
    }
    return float4(L, T);
}
[shader("compute")][numthreads(64, 1, 1)] void BakeCloudRadiance(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Size = uint(CameraProjection(10).y), Index = Dispatch.x;
    if (Index >= 6 * Size * Size)
        return;
    uint Face = Index / (Size * Size), X = Index % Size, Y = (Index / Size) % Size;
    float U = 2 * (X + .5) / Size - 1, V = 2 * (Y + .5) / Size - 1;
    float3 D = Face == 0   ? float3(1, U, V)
               : Face == 1 ? float3(-1, U, V)
               : Face == 2 ? float3(U, 1, V)
               : Face == 3 ? float3(U, -1, V)
               : Face == 4 ? float3(U, V, 1)
                           : float3(U, V, -1);
    D = Unit(D);
    float4 Cloud = CloudRay(CameraProjection(0).xyz, D);
    if (Index == 0)
    {
        float T = CloudSunTransmittance(CameraProjection(0).xyz);
        OutputColour[Extent.Dimensions.x * 21 + 6 * Size * Size] = float4(T);
    }

    uint Offset = uint(CameraProjection(10).x) + Index * 3;
    float3 Sky = float3(Angles[Offset], Angles[Offset + 1], Angles[Offset + 2]);
    OutputColour[Extent.Dimensions.x * 21 + Index] = float4(Cloud.xyz + Cloud.w * Sky, Cloud.w);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SHADOWED HEIGHT-FOG SCATTERING
//------------------------------------------------------------------------------------------------------------------------
float4 FogParameter(uint Slot)
{
    uint Offset = asuint(Extent.Minimum.w) - 1 + Slot * 4;
    return float4(Angles[Offset], Angles[Offset + 1], Angles[Offset + 2], Angles[Offset + 3]);
}
float FogAboveIntegral(float Z0, float Dz, float A, float B, float Height, float Scale)
{
    float Length = B - A, Low = min(Z0 + Dz * A, Z0 + Dz * B);
    float Q = abs(Dz) * Length / Scale;
    float Ratio = Q < .01 ? 1 - Q * .5 + Q * Q / 6 - Q * Q * Q / 24 + Q * Q * Q * Q / 120
                          : (1 - exp(-Q)) / Q;
    return exp(-max(Low - Height, 0) / Scale) * Length * Ratio;
}
float FogTransmission(float3 Origin, float3 Direction, float Distance)
{
    float4 Medium = FogParameter(0);
    float A = Origin.z, B = A + Direction.z * Distance, Integral;
    if (A <= Medium.y && B <= Medium.y)
        Integral = Distance;
    else if (A >= Medium.y && B >= Medium.y)
        Integral = FogAboveIntegral(A, Direction.z, 0, Distance, Medium.y, Medium.z);
    else
    {
        float Crossing = (Medium.y - A) / Direction.z;
        Integral = A < Medium.y
            ? Crossing + FogAboveIntegral(A, Direction.z, Crossing, Distance, Medium.y, Medium.z)
            : FogAboveIntegral(A, Direction.z, 0, Crossing, Medium.y, Medium.z) + Distance - Crossing;
    }
    return exp(-max(Medium.x * Integral, 0));
}

// 📝 The existing two-sided area/luminance CDF supplies solid-angle radiance, not a surface BRDF.
float3 SampleFogFacet(float3 At, float3 ViewDirection, inout uint Bits)
{
    uint Offset = uint(CameraProjection(10).z), Count = uint(Angles[Offset]);
    if (Count == 0)
        return 0;
    float Draw = RandomUnit(Bits);
    uint Low = 0, High = Count - 1;
    while (Low < High)
    {
        uint Mid = (Low + High) / 2;
        if (Draw < Angles[Offset + 1 + Mid * 4 + 3])
            High = Mid;
        else
            Low = Mid + 1;
    }
    uint Entry = Offset + 1 + Low * 4;
    FacetCorners F = Facets[uint(Angles[Entry])];
    float Root = sqrt(RandomUnit(Bits)), V = RandomUnit(Bits);
    float3 Position = F.A.xyz * (1 - Root) + F.B.xyz * (Root * (1 - V)) + F.C.xyz * (Root * V);
    float3 Delta = Position - At;
    float Squared = dot(Delta, Delta), Distance = sqrt(Squared);
    if (Distance <= .004)
        return 0;
    float3 Toward = Delta / Distance, Normal = Unit(cross(F.B.xyz - F.A.xyz, F.C.xyz - F.A.xyz));
    float Geometry = abs(dot(Normal, Toward));
    if (Geometry == 0 || (FogParameter(2).w != 0 &&
        Occluded(At + Toward * .002, Toward, Distance - .004)))
        return 0;
    float G = FogParameter(1).x, Den = 1 + G * G - 2 * G * dot(ViewDirection, Toward);
    float Phase = (1 - G * G) / (4 * 3.141592653589793 * Den * sqrt(max(Den, 1e-12)));
    float T = FogTransmission(At, Toward, min(Distance, FogParameter(3).z));
    return F.Emissive.xyz * (T * Phase * Geometry * Angles[Entry + 2] / (Squared * Angles[Entry + 1]));
}

[shader("compute")][numthreads(64, 1, 1)] void IntegrateFogScattering(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x)
        return;
    float4 Medium = FogParameter(0), March = FogParameter(1), Ambient = FogParameter(2), Lighting = FogParameter(3);
    if (Medium.x == 0)
        return;
    float3 Origin = CameraProjection(0).xyz;
    uint2 Coordinate = uint2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    float2 Ndc = (float2(Coordinate) + .5) / float2(Extent.History.xy) * 2 - 1;
    Ndc.y = -Ndc.y;
    float3 Direction = Unit(CameraProjection(1).xyz + CameraProjection(2).xyz * (Ndc.x * CameraProjection(2).w)
                           + CameraProjection(3).xyz * (Ndc.y * CameraProjection(3).w));
    SurfacePoint R = Receivers[Pixel];
    float Distance = R.PositionHit.w != 0 ? min(length(R.PositionHit.xyz - Origin), March.y) : March.y;
    uint Steps = uint(March.z);
    float StepM = Distance / Steps, T = 1;
    float3 Radiance = 0;
    uint EmitterBits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u);
    for (uint I = 0; I < Steps; ++I)
    {
        float3 At = Origin + Direction * (StepM * (I + .5));
        float NextT = FogTransmission(Origin, Direction, StepM * (I + 1));
        float3 Incident = Ambient.xyz;
        float SunT = Lighting.x != 0 ? CloudSunTransmittance(At, uint(March.w)) : 1;
        if (Lighting.y != 0)
            for (uint J = 0; J < Extent.Dimensions.y; ++J)
            {
                float3 Toward;
                float Far;
                float3 Light = Arrival(Lights[J], At, Toward, Far, SunT);
                if (all(Light == 0))
                    continue;
                Far = min(Far, Lighting.z);
                if (Ambient.w != 0 && Occluded(At + Toward * .002, Toward, max(Far - .004, 0)))
                    continue;
                float Den = 1 + March.x * March.x - 2 * March.x * dot(Direction, Toward);
                float Phase = (1 - March.x * March.x) / (4 * 3.141592653589793 * Den * sqrt(max(Den, 1e-12)));
                Incident += Light * Phase;
            }
        for (uint J = 0; J < uint(Lighting.w); ++J)
            Incident += SampleFogFacet(At, Direction, EmitterBits) / Lighting.w;
        Radiance += (T - NextT) * Medium.w * Incident;
        T = NextT;
    }
    OutputColour[Pixel].xyz = OutputColour[Pixel].xyz * T + Radiance;
}
