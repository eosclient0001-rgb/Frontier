/*============================================================================================================================================
                                                         CELESTIALVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Independent optical-depth, phase, lunar-map, finite Sun, five-component lens and real-catalogue validation before shader capture.

#include "CelestialReference.h"
#include <iostream>

using namespace Frontier;
using namespace Frontier::CelestialAtmosphereExperiment;

int main(int Count, char** Arguments)
{
    try
    {
        Enforce(Count == 4, "Usage: CelestialValidation <prepared-input-directory> <Hipparcos.csv> <output-directory>");
        const std::filesystem::path Inputs = Arguments[1], Destination = Arguments[3];
        std::filesystem::create_directories(Destination);
        LunarAlbedoMap Map;
        Enforce(Map.LoadPpm((Inputs / "MoonAlbedo2048.ppm").string().c_str()) && Map.Width() == 2048 &&
                    Map.Height() == 1024,
                "Actual retained lunar texture is required");
        CelestialScene Scene;
        Scene.LoadCatalogue(Arguments[2]);
        unsigned Assertions = 0;
        auto     Assert     = [&](bool Condition, const std::string& Description)
        {
            ++Assertions;
            Enforce(Condition, Description);
        };
        const auto& P = Scene.Atmosphere;
        const auto  Integrated =
            ReferenceDepth(P, {0, 0, P.GroundRadiusKm}, {0, 0, 1}, P.TopRadiusKm - P.GroundRadiusKm, 8192);
        const double ColumnR =
            P.RayleighScaleHeightKm * (1 - std::exp(-(P.TopRadiusKm - P.GroundRadiusKm) / P.RayleighScaleHeightKm));
        const double ColumnM =
            P.MieScaleHeightKm * (1 - std::exp(-(P.TopRadiusKm - P.GroundRadiusKm) / P.MieScaleHeightKm));
        const SpectrumRgb Analytic{P.RayleighScattering.R * ColumnR + (P.MieScattering + P.MieAbsorption) * ColumnM +
                                       P.OzoneAbsorption.R * P.OzoneWidthKm,
                                   P.RayleighScattering.G * ColumnR + (P.MieScattering + P.MieAbsorption) * ColumnM +
                                       P.OzoneAbsorption.G * P.OzoneWidthKm,
                                   P.RayleighScattering.B * ColumnR + (P.MieScattering + P.MieAbsorption) * ColumnM +
                                       P.OzoneAbsorption.B * P.OzoneWidthKm};
        const double      VerticalError = Difference(Integrated, Analytic);
        Assert(VerticalError < 1e-7,
               "Vertical density columns disagree with independent analytic exponential/tent integrals");
        double IntegralR = 0, IntegralM = 0;
        for (unsigned Index = 0; Index < 32768; ++Index)
        {
            const double Cosine = -1 + 2 * (Index + .5) / 32768;
            IntegralR += RayleighPhase(Cosine) * 4 * π / 32768;
            IntegralM += CornetteShanksPhase(Cosine, P.MiePhaseG) * 4 * π / 32768;
        }
        Assert(std::abs(IntegralR - 1) < 1e-8 && std::abs(IntegralM - 1) < 1e-5,
               "Scattering phases do not normalize over solid angle");
        for (unsigned Index = 0; Index < 128; ++Index)
        {
            const double Altitude = .1 + Index * .5;
            const auto   Up       = ReferenceSunTransmission(P, {0, 0, P.GroundRadiusKm + Altitude}, {0, 0, 1});
            Assert(Up.R > 0 && Up.G > 0 && Up.B > 0 && Maximum(Up) <= 1, "Nonphysical Earth transmission");
            if (Altitude < 10)
                Assert(Up.R >= Up.G && Up.G >= Up.B, "Low-altitude Rayleigh-dominated extinction ordering");
            const auto Down = ReferenceSunTransmission(P, {0, 0, P.GroundRadiusKm + Altitude}, {0, 0, -1});
            Assert(Maximum(Down) == 0, "Ground-blocked sunlight leaked through the planet");
        }
        const auto Empty = ReferenceSphere({0, 0, P.TopRadiusKm + 1000}, {0, 0, 1}, P.TopRadiusKm);
        Assert(Empty[1] < 0, "Outward space ray intersects the atmosphere ahead");
        const auto Through = ReferenceSphere({0, 0, P.TopRadiusKm + 1000}, {0, 0, -1}, P.TopRadiusKm);
        Assert(Through[0] > 0 && Through[1] > Through[0], "Orbital entry/exit clipping failed");
        double DirectionError = 0;
        for (const auto& Star : Scene.Catalogue)
        {
            DirectionError = std::max(DirectionError, std::abs(Length(Star.Direction) - 1));
            Assert(std::isfinite(Star.Magnitude) && std::isfinite(Star.ColourIndex) && Length(Star.Direction) > .999999,
                   "Catalogue contains invalid astrometric/photometric inputs");
        }
        Assert(Scene.Catalogue.size() == 41359 && DirectionError < 1e-12,
               "Retained measured catalogue coverage changed");
        const auto Centre   = Map.Sample(0, 0);
        const auto Crisium  = Map.Sample(59 * Radians, 17 * Radians);
        const auto Highland = Map.Sample(30 * Radians, -20 * Radians);
        Assert(Maximum(Centre) > 0 && Maximum(Crisium) < Maximum(Highland),
               "Same-texture lunar named-feature orientation failed");
        Assert(Difference(Map.Sample(-π, .2), Map.Sample(π, .2)) < 1e-14, "Lunar longitude seam does not wrap");
        Assert(std::abs(Scene.Configuration[14][0]) < 12 * Radians &&
                   std::abs(Scene.Configuration[14][1]) < 9 * Radians,
               "Lunar optical libration is outside its geometric range");
        Scene.Configuration[14][0] = Scene.Configuration[14][1] = 0;
        Scene.MoonDirection                                     = {0, 1, 0};
        Scene.MoonNorth                                         = {0, 0, 1};
        Scene.Solar.SunDirection                                = {0, -1, 0};
        for (double Radius : {0., .2, .6, .9})
        {
            const auto   Actual    = ReferenceMoon(Scene, Map, Radius, 0);
            const double Longitude = std::atan2(Radius, std::sqrt(1 - Radius * Radius));
            Assert(Difference(Actual, RgbScale(Map.Sample(Longitude, 0), 1 / π)) < 1e-12,
                   "Full-Moon Lommel-Seeliger shading acquired false limb darkening");
        }
        Assert(Maximum(ReferenceMoon(Scene, Map, 1.01, 0)) == 0, "Moon surface extends outside its opaque disc");
        Assert(std::abs(std::pow(10., -.4 * 5) - .01) < 1e-15, "Five visual magnitudes must be a flux factor of 100");
        double FlareLinearityError = 0;
        auto   Profile             = FlareOpticsProfile{};
        Profile.GlowStrength = Profile.StreakStrength = 0;
        for (unsigned Component = 0; Component < 5; ++Component)
        {
            auto Single               = Profile;
            Single.GhostStrength      = Component == 0 ? 1 : 0;
            Single.StarburstStrength  = Component == 1 ? 1 : 0;
            Single.AnamorphicStrength = Component == 2 ? 1 : 0;
            Single.HaloStrength       = Component == 3 ? 1 : 0;
            Single.VeilingStrength    = Component == 4 ? 1 : 0;
            double Energy             = 0;
            for (unsigned Index = 0; Index < 2048; ++Index)
            {
                const double X = -1.7 + 3.4 * (Index % 64) / 63, Y = -1 + 2. * (Index / 64) / 31;
                const auto   Full    = EvaluateLensFlareRadiance(X, Y, .46, .21, {1, 1, 1}, 1, Single);
                const auto   Partial = EvaluateLensFlareRadiance(X, Y, .46, .21, {2, 2, 2}, .25, Single);
                FlareLinearityError  = std::max(FlareLinearityError, Difference(RgbScale(Full, .5), Partial));
                Assert(Maximum(EvaluateLensFlareRadiance(X, Y, .46, .21, {1, 1, 1}, 0, Single)) == 0,
                       "A lens layer survives total source occlusion");
                Energy += Maximum(Full);
            }
            Assert(Energy > 0, "Requested flare component has no radiance");
        }
        Assert(FlareLinearityError < 1e-12, "Lens radiance is not linear in incident irradiance and source visibility");
        SunDiscProfile Disc;
        Assert(EvaluateSunDiscRadiance(0, Disc, {1, 1, 1}).R >
                   EvaluateSunDiscRadiance(.9 * Disc.AngularRadiusRad, Disc, {1, 1, 1}).R,
               "Solar limb darkening is inverted");
        Assert(EvaluateSunDiscRadiance(Disc.AngularRadiusRad + Disc.EdgeBlurRad, Disc, {1, 1, 1}).R > 0,
               "Requested radial solar blur is missing");
        const double ExosphereOpticalDepth = double(Scene.Configuration[18][2]) * Scene.Configuration[18][3];
        Assert(ExosphereOpticalDepth > 0 && ExosphereOpticalDepth < 1e-11,
               "Lunar exosphere was replaced by dense Earth atmosphere");
        Assert(ReferenceCoronaDensity(1.01) > ReferenceCoronaDensity(2) &&
                   ReferenceCoronaDensity(2) > ReferenceCoronaDensity(6),
               "Quiet-Sun coronal density does not decrease with height");
        std::ofstream Report(Destination / "CelestialNumeric.json");
        Report << std::setprecision(15) << "{\n  \"passed\": true,\n  \"assertions\": " << Assertions
               << ",\n  \"catalogue_rows\": " << Scene.Catalogue.size()
               << ",\n  \"catalogue_unit_error\": " << DirectionError
               << ",\n  \"vertical_optical_depth_error\": " << VerticalError
               << ",\n  \"rayleigh_phase_integral\": " << IntegralR << ",\n  \"aerosol_phase_integral\": " << IntegralM
               << ",\n  \"five_flare_linearity_error\": " << FlareLinearityError
               << ",\n  \"lunar_exosphere_vertical_blue_optical_depth\": " << ExosphereOpticalDepth
               << ",\n  \"same_moon_texture\": true,\n  \"renderer_accepted\": false\n}\n";
        Enforce(bool(Report), "Cannot retain native celestial validation report");
        std::cout << "Celestial numeric checks completed: " << Assertions << " assertions\n";
    }
    catch (const std::exception& Failure)
    {
        std::cerr << "Celestial numeric failure: " << Failure.what() << '\n';
        return 1;
    }
}
