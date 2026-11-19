/*============================================================================================================================================
                                                           CELESTIALLENS.H
============================================================================================================================================*/
// 🧩 Experimental finite anamorphic coating streak and independent eight-point star-filter response; shared parameters for native verification.

#pragma once
#include "Frontier/Engine/Rendering/LensFlareModel.h"
#include <algorithm>
#include <array>
#include <cmath>

namespace Frontier::CelestialAtmosphereExperiment
{

struct StarFilterProfile
{
    double Strength    = 0;
    double RotationRad = .3926990816987241548;
    double ReachNdc    = .72;
    double WidthNdc    = .005;
};

inline double FiniteLensTaper(double Coordinate, double Reach)
{
    const double Fraction = std::clamp((std::abs(Coordinate) / Reach - .80) / .20, 0., 1.);
    return 1 - Fraction * Fraction * (3 - 2 * Fraction);
}
inline SpectrumRgb EvaluateAnamorphicPoint(double X, double Y, const FlareOpticsProfile& Profile)
{
    if (Profile.AnamorphicStrength <= 0 || Profile.AnamorphicLengthNdc <= 0 || Profile.AnamorphicThicknessNdc <= 0)
        return {};
    const double Along  = X * std::cos(Profile.AnamorphicAngleRad) + Y * std::sin(Profile.AnamorphicAngleRad);
    const double Across = -X * std::sin(Profile.AnamorphicAngleRad) + Y * std::cos(Profile.AnamorphicAngleRad);
    const double Reach = Profile.AnamorphicLengthNdc, Width = Profile.AnamorphicThicknessNdc;
    const double Longitudinal = std::exp(-4 * Along * Along / (Reach * Reach)) * FiniteLensTaper(Along, Reach);
    const double Central      = std::exp(-.5 * Across * Across / (Width * Width));
    const double Bloom        = .18 * std::exp(-.5 * Across * Across / (16 * Width * Width));
    const double Satellite    = .07 *
                             (std::exp(-.5 * std::pow((Along - .32 * Reach) / (.12 * Reach), 2)) +
                              std::exp(-.5 * std::pow((Along + .32 * Reach) / (.12 * Reach), 2))) *
                             std::exp(-.5 * Across * Across / (9 * Width * Width));
    const double Light = .030 * Profile.AnamorphicStrength * Longitudinal * (Central + Bloom + Satellite);
    return {.18 * Light, .44 * Light, Light};
}
inline SpectrumRgb EvaluateStarFilterPoint(double X, double Y, const StarFilterProfile& Profile)
{
    if (Profile.Strength <= 0 || Profile.ReachNdc <= 0 || Profile.WidthNdc <= 0) return {};
    std::array<double, 3> Light{};
    for (unsigned Axis = 0; Axis < 4; ++Axis)
    {
        const double Angle  = Profile.RotationRad + Axis * .7853981633974483096;
        const double Along  = X * std::cos(Angle) + Y * std::sin(Angle);
        const double Across = -X * std::sin(Angle) + Y * std::cos(Angle);
        const double Radial = std::pow(1 + std::abs(Along) / .04, -1.2) *
                              std::exp(-2 * Along * Along / (Profile.ReachNdc * Profile.ReachNdc)) *
                              FiniteLensTaper(Along, Profile.ReachNdc);
        for (unsigned Channel = 0; Channel < 3; ++Channel)
        {
            const double Width = Profile.WidthNdc * (Channel == 0 ? 1.16 : Channel == 1 ? 1 : .86);
            Light[Channel] += .16 * Radial * std::exp(-.5 * Across * Across / (Width * Width)) *
                              (Channel == 0   ? 1
                               : Channel == 1 ? .93
                                              : .82);
        }
    }
    return {Profile.Strength * Light[0], Profile.Strength * Light[1], Profile.Strength * Light[2]};
}
inline SpectrumRgb EvaluateExperimentalLens(double                    X,
                                            double                    Y,
                                            double                    SunX,
                                            double                    SunY,
                                            const SpectrumRgb&        Flux,
                                            const FlareOpticsProfile& Profile,
                                            const StarFilterProfile&  Filter,
                                            double                    PixelStep = 2. / 270)
{
    auto Legacy               = Profile;
    Legacy.AnamorphicStrength = 0;
    auto Result               = EvaluateLensFlareRadiance(X, Y, SunX, SunY, Flux, 1, Legacy);
    for (unsigned Vertical = 0; Vertical < 4; ++Vertical)
        for (unsigned Horizontal = 0; Horizontal < 4; ++Horizontal)
        {
            const double Dx     = X - SunX + ((Horizontal + .5) / 4 - .5) * PixelStep;
            const double Dy     = Y - SunY + ((Vertical + .5) / 4 - .5) * PixelStep;
            const auto   Streak = EvaluateAnamorphicPoint(Dx, Dy, Profile);
            const auto   Star   = EvaluateStarFilterPoint(Dx, Dy, Filter);
            Result.R += Flux.R * (Streak.R + Star.R) / 16;
            Result.G += Flux.G * (Streak.G + Star.G) / 16;
            Result.B += Flux.B * (Streak.B + Star.B) / 16;
        }
    return Result;
}

} // namespace Frontier::CelestialAtmosphereExperiment
