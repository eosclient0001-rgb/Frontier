/*============================================================================================================================================
                                                       CELESTIALATMOSPHERE.SLANG
============================================================================================================================================*/
// 🧩 Executable surface/orbit atmosphere, same-texture Moon/exosphere, finite Sun/corona, catalogue stars and six independent lens components.

module CelestialAtmosphere;
#include "CelestialFootprint.slang"
#include "AtmosphereScattering.slang"
#include "SolarAtmosphere.slang"
#include "LunarScattering.slang"
#include "StellarRadiance.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                   COMPLETE RADIANCE / OCCLUSION
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")][numthreads(64, 1, 1)] void RenderCelestialAtmosphere(uint3 Dispatch
                                                                         : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    float2 Coordinate = float2(Pixel % Extent.History.x, Pixel / Extent.History.x) + .5;
    float3 Position = Configuration(0).xyz, Direction = CameraRay(Coordinate);
    float3 Transmission = 1, Sky = 0;
    bool   GroundHit = false;
    if (Configuration(10).x > .5)
        Sky = IntegrateSky(
            Position, Direction, Configuration(29).x > .5, uint(Configuration(24).w), Transmission, GroundHit);
    else if (Configuration(11).w > .5)
        GroundHit = GroundOccluded(Position, Direction);
    float3 Background = 0;
    if (GroundHit && Configuration(11).w > .5)
    {
        float  Distance = SphereAhead(Position, Direction, Configuration(9).x);
        float3 At       = Position + Direction * Distance;
        float3 Normal   = Unit(At);
        float3 SunT = Configuration(10).x > .5 ? SunTransmission(At + Normal * .02, Configuration(4).xyz) : float3(1);
        float3 Ambient = Configuration(10).x > .5 && Configuration(29).x > .5
                             ? MultipleRadiance(length(At + Normal * .02), dot(Normal, Configuration(4).xyz))
                             : float3(0);
        Background     = Configuration(28).xyz * Configuration(5).xyz * Configuration(5).w *
                     (max(0, dot(Normal, Configuration(4).xyz)) * SunT / CelestialPi + Ambient);
    }
    else
    {
        float  Coverage;
        float3 Moon = LunarPixel(Coordinate, Coverage);
        Background  = (CataloguePixel(Coordinate) + GalacticRadiance(Direction)) * (1 - Coverage) + Moon +
                     LunarExosphere(Direction) * Configuration(11).z;
    }
    float3 Solar = SolarPixel(Coordinate);
    if (!OccludedGeometry(Position, Direction, 1e30)) Solar += SolarAtmosphericRadiance(Direction) * Transmission;
    float3 Lens         = Configuration(11).y > 0 ? LensPixel(Coordinate) : float3(0);
    OutputColour[Pixel] = float4(Sky + Transmission * Background + Solar + Lens, GroundHit ? 1 : 0);
    OutputColour[Extent.Dimensions.x + Pixel]     = float4(Sky, 1);
    OutputColour[2 * Extent.Dimensions.x + Pixel] = float4(Transmission, 1);
}

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  ACTUAL SHADER PHYSICS READBACK
    //------------------------------------------------------------------------------------------------------------------------

    [shader("compute")][numthreads(64, 1, 1)] void InspectCelestialPhysics(uint3 Dispatch
                                                                           : SV_DispatchThreadID)
{
    uint Index = Dispatch.x;
    if (Index >= Extent.Dimensions.x) return;
    float4 A = ProbeInput(Index, 0), B = ProbeInput(Index, 1);
    uint   Selection = uint(A.w);
    float4 Result    = 0;
    if (Selection == 0) Result = float4(MediumDensity(A.x), RayleighPhase(A.y));
    if (Selection == 1)
    {
        float3 Position  = float3(0, 0, A.x);
        float3 Direction = float3(sqrt(max(0, 1 - A.y * A.y)), 0, A.y);
        Result           = float4(SunTransmission(Position, Direction), GroundOccluded(Position, Direction) ? 0 : 1);
    }
    if (Selection == 2)
    {
        float3 Transmission;
        bool   GroundHit;
        Result =
            float4(IntegrateSky(
                       Configuration(0).xyz, Unit(A.xyz), B.x > .5, uint(Configuration(24).w), Transmission, GroundHit),
                   GroundHit ? 1 : 0);
        OutputColour[Extent.Dimensions.x + Index] = float4(Transmission, 1);
    }
    if (Selection == 3)
    {
        bool Covered;
        Result = float4(LunarSurface(A.x, A.y, Covered), Covered ? 1 : 0);
    }
    if (Selection == 4) Result = float4(SampleLunarAlbedo(A.x, A.y), 1);
    if (Selection == 5)
        Result = float4(SolarResolvedRadiance(A.x, SolarPayload(0), SolarPayload(2), SolarPayload(1).w),
                        SolarPayload(0).w,
                        SolarPayload(1).w,
                        SolarErf((A.x - SolarPayload(0).w) / (1.4142135623730951 * SolarPayload(1).w)));
    if (Selection == 6) Result = float4(ExperimentalLensFlare(A.xy, B.xy, float3(1)), 1);
    if (Selection == 7) Result = float4(GalacticDirection(Unit(A.xyz)), SampleGalacticContours(Unit(A.xyz)));
    if (Selection == 8) Result = float4(StellarColour(A.x), Configuration(30).x * pow(10., -.4 * A.y));
    if (Selection == 9) Result = CoronaDensity(A.x);
    if (Selection == 10) Result = float4(LunarExosphere(Unit(A.xyz)), 1);
    if (Selection == 11) Result = float4(SolarAtmosphericRadiance(Unit(A.xyz)), 1);
    if (Selection == 12) Result = float4(SpectralDepth(A.xyz), AerosolPhase(B.x));
    if (Selection == 13) Result = float4(GalacticBulgeRadiance(A.xyz), 1);
    if (Selection == 14) Result = float4(StellarPsfDensity(A.x), 0, 0, 1);
    if (Selection == 15) Result = float4(ReferenceNebulae(A.xyz), 1);
    OutputColour[Index] = Result;
}
