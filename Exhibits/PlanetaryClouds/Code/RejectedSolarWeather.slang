/*==========================================================================================================================================
                                                         REJECTEDSOLARWEATHER.SLANG
==========================================================================================================================================*/
// 🧩 Deliberately rejected endpoint-weather interpolation for reconstructing the solar/view density disagreement.

CloudWeatherSample LerpRejectedCloudWeather(CloudWeatherSample Near, CloudWeatherSample Far, float Fraction)
{
    CloudWeatherSample Weather;
    Weather.Moisture = lerp(Near.Moisture, Far.Moisture, Fraction);
    Weather.Type     = lerp(Near.Type, Far.Type, Fraction);
    Weather.Lift     = lerp(Near.Lift, Far.Lift, Fraction);
    Weather.Rain     = lerp(Near.Rain, Far.Rain, Fraction);
    Weather.Bands    = lerp(Near.Bands, Far.Bands, Fraction);
    return Weather;
}

float IntegrateCloudSolarDepth(
    CloudSpecification Specification, CloudDeck Layer, float3 Position, float2 Span, uint Steps, float FootprintM)
{
    if (Span.y <= Span.x) return 0.0;
    float              LengthM = Span.y - Span.x;
    float              τ       = 0.0;
    float              StartM  = 0.0;
    CloudWeatherSample NearWeather =
        CloudWeatherAtPoint(Specification, Position + Specification.SunDirection * Span.x, Layer.Category);
    CloudWeatherSample FarWeather =
        CloudWeatherAtPoint(Specification, Position + Specification.SunDirection * (Span.x + LengthM), Layer.Category);
    for (uint Index = 0u; Index < Steps; ++Index)
    {
        float              Fraction = float(Index + 1u) / float(Steps);
        float              EndM     = LengthM * Fraction * Fraction;
        float              SampleM  = Span.x + 0.5 * (StartM + EndM);
        float              SegmentM = EndM - StartM;
        CloudWeatherSample Weather  = LerpRejectedCloudWeather(NearWeather, FarWeather, (SampleM - Span.x) / LengthM);
        float Sampleσ = SamplePlanetCloudDensity(Specification, Layer, Position + Specification.SunDirection * SampleM,
                                                 Weather, max(FootprintM, 8.0 + 0.12 * SegmentM), true);
        τ += SegmentM * Sampleσ;
        if (τ >= 18.0) return 18.0;
        StartM = EndM;
    }
    return τ;
}
