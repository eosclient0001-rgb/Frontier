/*============================================================================================================================================
                                                         CELESTIALLENS.SLANG
============================================================================================================================================*/
// 🧩 Finite blue anamorphic streak with transverse bloom and pixel coverage, plus a separate four-groove-pair / eight-ray star filter.

float FiniteLensTaper(float Coordinate, float Reach)
{
    return 1 - smoothstep(.80, 1, abs(Coordinate) / Reach);
}
float3 AnamorphicPoint(float2 Offset)
{
    float4 Shape = Configuration(31), Optics = Configuration(32);
    if (Shape.x <= 0 || Shape.w <= 0 || Optics.x <= 0) return 0;
    float Along        = Offset.x * CelestialCosine(Shape.z) + Offset.y * CelestialSine(Shape.z);
    float Across       = -Offset.x * CelestialSine(Shape.z) + Offset.y * CelestialCosine(Shape.z);
    float Longitudinal = exp(-4 * Along * Along / (Shape.w * Shape.w)) * FiniteLensTaper(Along, Shape.w);
    float Central      = exp(-.5 * Across * Across / (Optics.x * Optics.x));
    float Bloom        = .18 * exp(-.5 * Across * Across / (16 * Optics.x * Optics.x));
    float Satellite    = .07 *
                      (exp(-.5 * pow((Along - .32 * Shape.w) / (.12 * Shape.w), 2)) +
                       exp(-.5 * pow((Along + .32 * Shape.w) / (.12 * Shape.w), 2))) *
                      exp(-.5 * Across * Across / (9 * Optics.x * Optics.x));
    return float3(.18, .44, 1) * (.030 * Shape.x * Longitudinal * (Central + Bloom + Satellite));
}
float3 StarFilterPoint(float2 Offset)
{
    float  Strength = Configuration(31).y;
    float4 Optics   = Configuration(32);
    if (Strength <= 0 || Optics.z <= 0 || Optics.w <= 0) return 0;
    float3 Light = 0;
    for (uint Axis = 0; Axis < 4; ++Axis)
    {
        float Angle  = Optics.y + Axis * .7853981633974483096;
        float Along  = Offset.x * CelestialCosine(Angle) + Offset.y * CelestialSine(Angle);
        float Across = -Offset.x * CelestialSine(Angle) + Offset.y * CelestialCosine(Angle);
        float Radial = pow(1 + abs(Along) / .04, -1.2) * exp(-2 * Along * Along / (Optics.z * Optics.z)) *
                       FiniteLensTaper(Along, Optics.z);
        float3 Width = Optics.w * float3(1.16, 1, .86);
        Light += .16 * Radial * exp(-.5 * Across * Across / (Width * Width)) * float3(1, .93, .82);
    }
    return Strength * Light;
}
float3 ExperimentalLensFlare(float2 Pixel, float2 Sun, float3 Flux)
{
    // 📝 Existing ghost, six-blade diffraction, antipode halo and veil remain the production implementation.
    // Its legacy anamorphic payload is disabled on the host, so this repair is not stacked over the rejected flat line.
    float3 Light     = SolarLensFlare(Pixel, Sun, Flux);
    float  PixelStep = 2.0 / Extent.History.y;
    for (uint Y = 0; Y < 4; ++Y)
        for (uint X = 0; X < 4; ++X)
        {
            float2 Offset = Pixel - Sun + ((float2(X, Y) + .5) / 4 - .5) * PixelStep;
            Light += Flux * (AnamorphicPoint(Offset) + StarFilterPoint(Offset)) / 16;
        }
    return Light;
}
