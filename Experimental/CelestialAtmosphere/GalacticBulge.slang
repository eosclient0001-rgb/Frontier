/*============================================================================================================================================
                                                          GALACTICBULGE.SLANG
============================================================================================================================================*/
// 🧩 Slang port of the requested c519e983 Milky Way bulge, star clouds and filamentary Great Rift; authored radiance, not measured imagery.

//------------------------------------------------------------------------------------------------------------------------
//                                             PINNED UPSTREAM QUINTIC LATTICE / FBM
//------------------------------------------------------------------------------------------------------------------------

float GalacticHash(int3 Cell, uint Salt)
{
    uint Mixed =
        uint(Cell.x) * 0x9E3779B1u ^ uint(Cell.y) * 0x85EBCA77u ^ uint(Cell.z) * 0xC2B2AE3Du ^ Salt * 0x27D4EB2Fu;
    Mixed ^= Mixed >> 16;
    Mixed *= 0x7FEB352Du;
    Mixed ^= Mixed >> 15;
    Mixed *= 0x846CA68Bu;
    Mixed ^= Mixed >> 16;
    return float(Mixed >> 8) / 16777216.0;
}
float GalacticMix(float A, float B, float Fraction)
{
    return A + (B - A) * Fraction;
}
float GalacticQuintic(float3 Coordinate, uint Salt)
{
    float3 Floor    = floor(Coordinate);
    int3   Low      = int3(Floor);
    float3 Fraction = Coordinate - Floor;
    float3 Fade     = Fraction * Fraction * Fraction * (Fraction * (Fraction * 6 - 15) + 10);
    float  C00      = GalacticMix(GalacticHash(Low, Salt), GalacticHash(Low + int3(1, 0, 0), Salt), Fade.x);
    float  C10 = GalacticMix(GalacticHash(Low + int3(0, 1, 0), Salt), GalacticHash(Low + int3(1, 1, 0), Salt), Fade.x);
    float  C01 = GalacticMix(GalacticHash(Low + int3(0, 0, 1), Salt), GalacticHash(Low + int3(1, 0, 1), Salt), Fade.x);
    float  C11 = GalacticMix(GalacticHash(Low + int3(0, 1, 1), Salt), GalacticHash(Low + int3(1, 1, 1), Salt), Fade.x);
    return GalacticMix(GalacticMix(C00, C10, Fade.y), GalacticMix(C01, C11, Fade.y), Fade.z);
}
float GalacticFbm(float3 Coordinate, uint Octaves, uint Salt)
{
    float Total = 0, Amplitude = .5, Weight = 0;
    for (uint Octave = 0; Octave < Octaves; ++Octave)
    {
        Total += Amplitude * GalacticQuintic(Coordinate, Salt + Octave * 37);
        Weight += Amplitude;
        float3 Rotated = float3(.80 * Coordinate.x - .48 * Coordinate.y + .36 * Coordinate.z,
                                .48 * Coordinate.x + .86 * Coordinate.y + .16 * Coordinate.z,
                                -.36 * Coordinate.x + .04 * Coordinate.y + .93 * Coordinate.z);
        Coordinate     = Rotated * 2.03 + float3(13.7, -7.1, 5.3);
        Amplitude *= .5;
    }
    return Total / Weight;
}
float GalacticLobe(float Offset, float Width)
{
    return exp(-Offset * Offset / (Width * Width));
}
float3 ReferenceGalacticDirection(float3 Equatorial)
{
    // 📝 Exact Float32 axes exported by the original native solver, independently checked against the IAU/Astropy basis.
    return float3(dot(Equatorial, float3(-.054875578731298447, -.87343710660934448, -.48383495211601257)),
                  dot(Equatorial, float3(.4941093921661377, -.44482958316802979, .74698221683502197)),
                  dot(Equatorial, float3(-.86766612529754639, -.19807630777359009, .45598375797271729)));
}

//------------------------------------------------------------------------------------------------------------------------
//                                           BULGE / SPIRAL STAR CLOUDS / REDDENED DUST
//------------------------------------------------------------------------------------------------------------------------

float3 GalacticBulgeRadiance(float3 Equatorial)
{
    float3 Axis             = ReferenceGalacticDirection(Equatorial);
    float  Longitude        = CelestialArctangent2(Axis.y, Axis.x);
    float  Latitude         = asin(clamp(Axis.z, -1, 1));
    float  LongitudeProfile = .20 + .80 * GalacticLobe(Longitude, .95) + .32 * GalacticLobe(Longitude - .47, .22) +
                             .36 * GalacticLobe(Longitude - 1.38, .38) + .34 * GalacticLobe(Longitude + 1.30, .34) +
                             .12 * GalacticLobe(abs(Longitude) - 2.6, .6);
    float  ScaleHeight = .052 + .040 * GalacticLobe(Longitude, .6);
    float  Cosh        = cosh(clamp(Latitude / ScaleHeight, -20, 20));
    float  Disc = 1 / (Cosh * Cosh), ThickDisc = .35 * exp(-abs(Latitude) / .22);
    float  Bulge  = 1.45 * exp(-Longitude * Longitude / (2 * .19 * .19) - Latitude * Latitude / (2 * .13 * .13));
    float  Clouds = GalacticFbm(Axis * 9, 5, 1201), Fine = GalacticFbm(Axis * 31, 4, 1307);
    float  Clumping   = .50 + 1.05 * Clouds + .35 * (Fine - .5);
    float  DiscLight  = LongitudeProfile * (Disc + ThickDisc) * Clumping;
    float  BulgeLight = Bulge * (.75 + .5 * Clouds);
    float  RiftCentre = .012 + .022 * CelestialSine(2.4 * Longitude + .6);
    float  RiftMask   = smoothstep(-.75, -.35, Longitude) * (1 - smoothstep(1.35, 1.65, Longitude));
    float  RiftNoise  = GalacticFbm(Axis * 14, 5, 1409);
    float  RiftWidth  = .032 + .018 * RiftNoise;
    float  RiftDepth  = 2.2 * RiftMask * GalacticLobe(Latitude - RiftCentre, RiftWidth) * (.80 + .40 * RiftNoise);
    float  Coalsack   = 1.6 * GalacticLobe(Longitude + .9, .05) * GalacticLobe(Latitude + .015, .05);
    float3 Stretched  = Axis * float3(7, 7, 26);
    float3 Warp       = float3(GalacticFbm(Stretched * .8, 3, 1601),
                         GalacticFbm(Stretched * .8, 3, 1607),
                         GalacticFbm(Stretched * .8, 3, 1613)) -
                  .5;
    float3 Warped      = Stretched + 1.6 * Warp;
    float  CoarseRidge = 1 - abs(2 * GalacticFbm(Warped, 4, 1511) - 1);
    float  FineRidge   = 1 - abs(2 * GalacticFbm(Warped * 2.7, 3, 1523) - 1);
    float  Filaments   = smoothstep(.62, .95, .70 * CoarseRidge + .30 * FineRidge);
    float  ComplexMask = smoothstep(.42, .66, GalacticFbm(Axis * 4, 3, 1531));
    float  Dust        = RiftDepth + Coalsack + 1.15 * Filaments * ComplexMask * GalacticLobe(Latitude, .11);
    float3 Light       = float3(.78, .86, 1) * DiscLight + float3(1, .80, .58) * BulgeLight;
    return Light * exp(-Dust * float3(.75, 1, 1.32));
}

//------------------------------------------------------------------------------------------------------------------------
//                                             REFERENCE NEBULAE / SATELLITE GALAXIES
//------------------------------------------------------------------------------------------------------------------------

float3 ReferenceEquatorial(float Hours, float Degrees)
{
    float Longitude = Hours * (2 * CelestialPi / 24), Latitude = Degrees * (CelestialPi / 180);
    return float3(CelestialCosine(Longitude) * CelestialCosine(Latitude),
                  CelestialSine(Longitude) * CelestialCosine(Latitude),
                  CelestialSine(Latitude));
}
float2 ReferenceTangent(float3 Direction, float3 Target)
{
    float3 East  = Unit(cross(float3(0, 0, 1), Target));
    float3 North = cross(Target, East);
    return float2(dot(Direction, East), dot(Direction, North)) / max(1e-4, dot(Direction, Target));
}
float3 ReferenceSatellite(float3 Direction, float3 Target, float Radius, float Brightness, uint Salt)
{
    if (dot(Direction, Target) < .97) return 0;
    float2 Offset = ReferenceTangent(Direction, Target) / (CelestialPi / 180 * Radius);
    float  Clumps = GalacticFbm(Direction * 160, 5, Salt);
    return float3(.86, .90, 1) * Brightness * exp(-dot(Offset, Offset)) * (.35 + 1.3 * Clumps);
}
float3 ReferenceNebulaKnot(float3 Direction, float3 Target, float Radius, float Brightness, uint Salt)
{
    if (dot(Direction, Target) < .996) return 0;
    float2 Offset = ReferenceTangent(Direction, Target) / (CelestialPi / 180 * Radius);
    float  Knots  = GalacticFbm(Direction * 700, 4, Salt);
    return float3(1, .36, .50) * Brightness * exp(-dot(Offset, Offset)) * (.3 + 1.4 * Knots);
}
float3 ReferenceNebulae(float3 Equatorial)
{
    float3 Accumulated = 0;
    float3 GreatNebula = ReferenceEquatorial(5.588, -5.39);
    float3 Pleiades    = ReferenceEquatorial(3.772, 24.10);
    float3 Andromeda   = ReferenceEquatorial(.712, 41.27);
    if (dot(Equatorial, GreatNebula) > .995)
    {
        float2 Offset  = ReferenceTangent(Equatorial, GreatNebula) / (CelestialPi / 180);
        float  Squared = dot(Offset, Offset), Filaments = GalacticFbm(Equatorial * 900, 4, 1601);
        float  Glow   = .030 * exp(-Squared / .10) + .010 * exp(-Squared / .55) * (.4 + 1.2 * Filaments);
        float  Cavity = .016 * exp(-Squared / .012);
        Accumulated += float3(1, .30, .46) * Glow + float3(.42, .92, .86) * Cavity;
    }
    if (dot(Equatorial, Pleiades) > .997)
    {
        float2 Offset = ReferenceTangent(Equatorial, Pleiades) / (CelestialPi / 180);
        float  Wisps  = GalacticFbm(Equatorial * float3(1400, 380, 900), 4, 1703);
        Accumulated += float3(.42, .62, 1) * .0045 * exp(-dot(Offset, Offset) / .30) * (.3 + 1.4 * Wisps);
    }
    if (dot(Equatorial, Andromeda) > .997)
    {
        float2 Offset   = ReferenceTangent(Equatorial, Andromeda) / (CelestialPi / 180);
        float  Angle    = 38 * (CelestialPi / 180);
        float  Major    = (Offset.y * CelestialCosine(Angle) + Offset.x * CelestialSine(Angle)) / 1.6;
        float  Minor    = (Offset.x * CelestialCosine(Angle) - Offset.y * CelestialSine(Angle)) / .42;
        float  Elliptic = length(float2(Major, Minor));
        Accumulated += float3(1, .86, .70) * .020 * exp(-Elliptic * Elliptic * 22) +
                       float3(.86, .88, 1) * .0042 * exp(-Elliptic * 3.2);
    }
    Accumulated += ReferenceSatellite(Equatorial, ReferenceEquatorial(5.392, -69.76), 3.4, .0060, 1801);
    Accumulated += ReferenceSatellite(Equatorial, ReferenceEquatorial(.877, -72.83), 1.8, .0035, 1907);
    Accumulated += ReferenceNebulaKnot(Equatorial, ReferenceEquatorial(18.06, -24.38), .45, .010, 2003);
    Accumulated += ReferenceNebulaKnot(Equatorial, ReferenceEquatorial(10.75, -59.87), .80, .012, 2111);
    return Accumulated;
}
