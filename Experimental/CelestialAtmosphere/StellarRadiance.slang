/*============================================================================================================================================
                                                         STELLARRADIANCE.SLANG
============================================================================================================================================*/
// 🧩 Hipparcos photometry, pixel-integrated Gaussian star images and pinned J2000 Milky Way contours behind atmosphere and opaque bodies.

//------------------------------------------------------------------------------------------------------------------------
//                                                 CATALOGUE COLOUR / VISUAL FLUX
//------------------------------------------------------------------------------------------------------------------------

float SpectralGaussian(float Wavelength, float Centre, float Left, float Right)
{
    float Distance = (Wavelength - Centre) * (Wavelength < Centre ? Left : Right);
    return exp(-.5 * Distance * Distance);
}
float3 ApproximateCie(float Wavelength)
{
    return float3(1.056 * SpectralGaussian(Wavelength, 599.8, .0264, .0323) +
                      .362 * SpectralGaussian(Wavelength, 442, .0624, .0374) -
                      .065 * SpectralGaussian(Wavelength, 501.1, .0490, .0382),
                  .821 * SpectralGaussian(Wavelength, 568.8, .0213, .0247) +
                      .286 * SpectralGaussian(Wavelength, 530.9, .0613, .0322),
                  1.217 * SpectralGaussian(Wavelength, 437, .0845, .0278) +
                      .681 * SpectralGaussian(Wavelength, 459, .0385, .0725));
}
float3 StellarColour(float ColourIndex)
{
    float  Bv          = clamp(ColourIndex, -.39, 2);
    float  Temperature = 4600 * (1 / (.92 * Bv + 1.7) + 1 / (.92 * Bv + .62));
    float3 Xyz         = 0;
    for (uint Sample = 0; Sample < 40; ++Sample)
    {
        float Wavelength = 385 + Sample * 10;
        float Planck     = pow(550 / Wavelength, 5) / (exp(14387768.77 / (Wavelength * Temperature)) - 1);
        Xyz += ApproximateCie(Wavelength) * Planck;
    }
    float3 Rgb = max(0,
                     float3(dot(float3(3.2406, -1.5372, -.4986), Xyz),
                            dot(float3(-.9689, 1.8758, .0415), Xyz),
                            dot(float3(.0557, -.2040, 1.0570), Xyz)));
    return Rgb / max(1e-20, dot(Rgb, float3(.2126, .7152, .0722)));
}
[shader("compute")][numthreads(64, 1, 1)] void ResolveCataloguePhotometry(uint3 Dispatch
                                                                          : SV_DispatchThreadID)
{
    uint Index = Dispatch.x;
    if (Index >= Extent.Dimensions.z) return;
    StellarSource Source    = Stars[Index];
    float3        Direction = Source.DirectionMagnitude.xyz;
    float         Depth     = dot(Direction, Configuration(1).xyz);
    float2        Tangent =
        float2(dot(Direction, Configuration(2).xyz), dot(Direction, Configuration(3).xyz)) / max(1e-10, Depth);
    float2 Ndc             = Tangent / float2(Configuration(1).w * Configuration(2).w, Configuration(1).w);
    Source.ProjectionFlux  = float4((.5 + .5 * Ndc.x) * Extent.History.x,
                                   (.5 - .5 * Ndc.y) * Extent.History.y,
                                   Configuration(30).x * pow(10., -.4 * Source.DirectionMagnitude.w),
                                   Depth);
    Source.ColourIndex.xyz = StellarColour(Source.ColourIndex.w);
    if (Depth <= 0 || OccludedGeometry(Configuration(0).xyz, Direction, 1e30)) Source.ProjectionFlux.z = 0;
    Stars[Index] = Source;
} float3 CataloguePixel(float2 Coordinate)
{
    if (Configuration(10).w < .5) return 0;
    uint   Columns = (Extent.History.x + 15) / 16;
    uint   Tile    = (uint(Coordinate.y) / 16) * Columns + uint(Coordinate.x) / 16;
    float3 Sum     = 0;
    float  Sigma   = Configuration(24).y;
    for (uint Location = StellarBins[Tile]; Location < StellarBins[Tile + 1]; ++Location)
    {
        StellarSource Source = Stars[StellarBins[Location]];
        float2        Delta  = Coordinate - Source.ProjectionFlux.xy;
        float2        Low    = (Delta - .5) / (1.4142135623730951 * Sigma);
        float2        High   = (Delta + .5) / (1.4142135623730951 * Sigma);
        float         Mass =
            max(0, .5 * (SolarErf(High.x) - SolarErf(Low.x))) * max(0, .5 * (SolarErf(High.y) - SolarErf(Low.y)));
        Sum += Source.ColourIndex.xyz * Source.ProjectionFlux.z * Mass;
    }
    return Sum / PixelSolidAngle(Coordinate);
}

//------------------------------------------------------------------------------------------------------------------------
//                                               EQUATORIAL / GALACTIC BACKGROUND
//------------------------------------------------------------------------------------------------------------------------

float3 EquatorialDirection(float3 Local)
{
    return Unit(float3(
        dot(Configuration(15).xyz, Local), dot(Configuration(16).xyz, Local), dot(Configuration(17).xyz, Local)));
}
float3 GalacticDirection(float3 Local)
{
    float3 Equatorial = EquatorialDirection(Local);
    return float3(dot(Configuration(25).xyz, Equatorial),
                  dot(Configuration(26).xyz, Equatorial),
                  dot(Configuration(27).xyz, Equatorial));
}
float SampleGalacticContours(float3 Direction)
{
    float3 Equatorial = EquatorialDirection(Direction);
    float  Longitude = atan2(Equatorial.y, Equatorial.x), Latitude = asin(clamp(Equatorial.z, -1, 1));
    uint   Width = uint(Configuration(22).z), Height = uint(Configuration(22).w);
    float2 Coordinate = float2(frac((Longitude + CelestialPi) / (2 * CelestialPi)) * Width - .5,
                               saturate((.5 * CelestialPi - Latitude) / CelestialPi) * Height - .5);
    int2   Low        = int2(floor(Coordinate));
    float2 Fraction   = Coordinate - float2(Low);
    float  Sum        = 0;
    for (int Y = 0; Y < 2; ++Y)
        for (int X = 0; X < 2; ++X)
        {
            int Column = ((Low.x + X) % int(Width) + int(Width)) % int(Width);
            int Row    = clamp(Low.y + Y, 0, int(Height) - 1);
            Sum += GalacticContours[Row * Width + Column] * (X == 0 ? 1 - Fraction.x : Fraction.x) *
                   (Y == 0 ? 1 - Fraction.y : Fraction.y);
        }
    return Sum;
}
float3 GalacticRadiance(float3 Direction)
{
    if (Configuration(11).x < .5) return 0;
    float Density = SampleGalacticContours(Direction);
    // 📝 Authentic contour geometry, assigned (unmeasured) visual surface brightness, not random stars or a fake HDR photograph.
    float Brightness =
        Density * Configuration(30).x * pow(10., -.4 * (22.0 - 2.2 * Density)) / pow(CelestialPi / (180 * 3600), 2);
    return Brightness * float3(1.12, 1, .86);
}
