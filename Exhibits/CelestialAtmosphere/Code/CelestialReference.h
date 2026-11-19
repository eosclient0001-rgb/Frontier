/*============================================================================================================================================
                                                          CELESTIALREFERENCE.H
============================================================================================================================================*/
// 🧩 Double-precision independent integration and engine-model references for executed celestial shader readback.

#pragma once
#include "Experimental/CelestialAtmosphere/CelestialScene.h"

namespace Frontier::CelestialAtmosphereExperiment
{

inline SpectrumRgb RgbAdd(SpectrumRgb A, SpectrumRgb B)
{
    return {A.R + B.R, A.G + B.G, A.B + B.B};
}
inline SpectrumRgb RgbScale(SpectrumRgb A, double Scale)
{
    return {A.R * Scale, A.G * Scale, A.B * Scale};
}
inline SpectrumRgb RgbMultiply(SpectrumRgb A, SpectrumRgb B)
{
    return {A.R * B.R, A.G * B.G, A.B * B.B};
}
inline SpectrumRgb RgbExp(SpectrumRgb A)
{
    return {std::exp(-A.R), std::exp(-A.G), std::exp(-A.B)};
}
inline double Maximum(SpectrumRgb A)
{
    return std::max({A.R, A.G, A.B});
}
inline double Difference(SpectrumRgb A, SpectrumRgb B)
{
    return std::max({std::abs(A.R - B.R), std::abs(A.G - B.G), std::abs(A.B - B.B)});
}
inline SpectrumRgb DecodeRgb(Float4 A)
{
    return {A[0], A[1], A[2]};
}
inline std::array<double, 2> ReferenceSphere(Vector Position, Vector Direction, double Radius)
{
    const double Along         = Dot(Position, Direction);
    const double Perpendicular = Length(Cross(Position, Direction));
    if (Perpendicular > Radius) return {1, -1};
    const double Root = std::sqrt(std::max(0., (Radius - Perpendicular) * (Radius + Perpendicular)));
    return {-Along - Root, -Along + Root};
}
inline bool ReferenceGround(const AtmosphereParameters& P, Vector Position, Vector Direction)
{
    const auto Segment = ReferenceSphere(Position, Direction, P.GroundRadiusKm);
    return Segment[0] > .0001 && Segment[1] >= Segment[0];
}
inline SpectrumRgb
ReferenceDepth(const AtmosphereParameters& P, Vector Position, Vector Direction, double Limit, unsigned Steps = 1024)
{
    double Rayleigh = 0, Aerosol = 0, Ozone = 0;
    for (unsigned Index = 0; Index < Steps; ++Index)
    {
        const double Near     = Limit * std::pow(double(Index) / Steps, 2);
        const double Far      = Limit * std::pow(double(Index + 1) / Steps, 2);
        const double Altitude = std::max(0., Length(Position + Direction * (.5 * (Near + Far))) - P.GroundRadiusKm);
        Rayleigh += RayleighDensity(P, Altitude) * (Far - Near);
        Aerosol += MieDensity(P, Altitude) * (Far - Near);
        Ozone += OzoneDensity(P, Altitude) * (Far - Near);
    }
    const double MieExtinction = P.MieScattering + P.MieAbsorption;
    return {P.RayleighScattering.R * Rayleigh + MieExtinction * Aerosol + P.OzoneAbsorption.R * Ozone,
            P.RayleighScattering.G * Rayleigh + MieExtinction * Aerosol + P.OzoneAbsorption.G * Ozone,
            P.RayleighScattering.B * Rayleigh + MieExtinction * Aerosol + P.OzoneAbsorption.B * Ozone};
}
inline SpectrumRgb
ReferenceSunTransmission(const AtmosphereParameters& P, Vector Position, Vector Direction, unsigned Steps = 1024)
{
    if (ReferenceGround(P, Position, Direction)) return {};
    const auto Segment = ReferenceSphere(Position, Direction, P.TopRadiusKm);
    if (Segment[1] <= 0) return {1, 1, 1};
    const double Near = std::max(0., Segment[0]);
    return RgbExp(ReferenceDepth(P, Position + Direction * Near, Direction, Segment[1] - Near, Steps));
}
inline SpectrumRgb
ReferenceSky(const CelestialScene& Scene, Vector Direction, unsigned Steps = 1024, unsigned SunSteps = 256)
{
    const auto& P       = Scene.Atmosphere;
    auto        Segment = ReferenceSphere(Scene.Camera.Position, Direction, P.TopRadiusKm);
    Segment[0]          = std::max(0., Segment[0]);
    const auto Ground   = ReferenceSphere(Scene.Camera.Position, Direction, P.GroundRadiusKm);
    if (Ground[0] > .0001 && Ground[1] >= Ground[0] && Ground[0] < Segment[1]) Segment[1] = Ground[0];
    if (Segment[1] <= Segment[0]) return {};
    SpectrumRgb  Sum{}, Transmission{1, 1, 1};
    const double Step   = (Segment[1] - Segment[0]) / Steps;
    const double PhaseR = RayleighPhase(Dot(Direction, Scene.Solar.SunDirection));
    const double PhaseM = CornetteShanksPhase(Dot(Direction, Scene.Solar.SunDirection), P.MiePhaseG);
    for (unsigned Index = 0; Index < Steps; ++Index)
    {
        const auto   At       = Scene.Camera.Position + Direction * (Segment[0] + (Index + .5) * Step);
        const double Altitude = std::max(0., Length(At) - P.GroundRadiusKm);
        const double DensityR = RayleighDensity(P, Altitude), DensityM = MieDensity(P, Altitude),
                     DensityO           = OzoneDensity(P, Altitude);
        const double      MieExtinction = P.MieScattering + P.MieAbsorption;
        const SpectrumRgb Depth{
            (P.RayleighScattering.R * DensityR + MieExtinction * DensityM + P.OzoneAbsorption.R * DensityO) * Step,
            (P.RayleighScattering.G * DensityR + MieExtinction * DensityM + P.OzoneAbsorption.G * DensityO) * Step,
            (P.RayleighScattering.B * DensityR + MieExtinction * DensityM + P.OzoneAbsorption.B * DensityO) * Step};
        auto Weight = [](double OpticalDepth)
        { return OpticalDepth > 1e-12 ? -std::expm1(-OpticalDepth) / OpticalDepth : 1.; };
        const SpectrumRgb Scatter{
            (P.RayleighScattering.R * DensityR * PhaseR + P.MieScattering * DensityM * PhaseM) * Step * Weight(Depth.R),
            (P.RayleighScattering.G * DensityR * PhaseR + P.MieScattering * DensityM * PhaseM) * Step * Weight(Depth.G),
            (P.RayleighScattering.B * DensityR * PhaseR + P.MieScattering * DensityM * PhaseM) * Step *
                Weight(Depth.B)};
        Sum = RgbAdd(
            Sum,
            RgbMultiply(RgbMultiply(Transmission, ReferenceSunTransmission(P, At, Scene.Solar.SunDirection, SunSteps)),
                        Scatter));
        Transmission = RgbMultiply(Transmission, RgbExp(Depth));
    }
    return RgbMultiply(Sum, Scene.Solar.DiscIrradiance);
}
inline SpectrumRgb ReferenceMoon(const CelestialScene& Scene, const LunarAlbedoMap& Map, double A, double B)
{
    const double Toward = std::sqrt(std::max(0., 1 - A * A - B * B));
    const auto   Moon   = Unit(Scene.MoonDirection);
    const auto   North  = Unit(Scene.MoonNorth - Moon * Dot(Scene.MoonNorth, Moon));
    const auto   East   = Cross(Moon, North);
    const auto   Normal = East * A + North * B - Moon * Toward;
    return EvaluateLunarDiscRadiance(Map,
                                     A,
                                     B,
                                     Scene.Configuration[14][0],
                                     Scene.Configuration[14][1],
                                     std::max(0., Dot(Normal, Scene.Solar.SunDirection)),
                                     Toward,
                                     std::acos(std::clamp(Dot(Moon * -1, Scene.Solar.SunDirection), -1., 1.)),
                                     Scene.Solar.DiscIrradiance,
                                     Scene.Configuration[13][3]);
}
inline double ReferenceCoronaDensity(double Radius)
{
    return 1e8 * (2.99 * std::pow(Radius, -16) + 1.55 * std::pow(Radius, -6) + .036 * std::pow(Radius, -1.5));
}

} // namespace Frontier::CelestialAtmosphereExperiment
