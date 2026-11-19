/*============================================================================================================================================
                                                        CELESTIALUPSTREAMPROBE.CPP
============================================================================================================================================*/
// 🧩 Export the requested immutable upstream's actual catalogue, galactic radiance and stellar PSF for independent Slang comparisons.

// 📝 The original translation unit is provisioned outside Git. No copied lunar or atmosphere implementation is linked into Frontier.
#include <Graphics/Atmosphere/CelestialFieldSolver.cpp>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>

int main(int Count, char** Arguments)
{
    try
    {
        if (Count != 2) throw std::runtime_error("Usage: CelestialUpstreamProbe <output-directory>");
        const std::filesystem::path Destination = Arguments[1];
        std::filesystem::create_directories(Destination);
        using namespace Frontier;
        std::ofstream Catalogue(Destination / "ReferenceStars.csv");
        Catalogue << std::setprecision(17) << "id,ra_deg,dec_deg,mag,bv,authored\n";
        const auto& Pool    = RetrieveStellarCubeIndex();
        unsigned    Ordinal = 0;
        auto        Append  = [&](Vector3f Direction, float Magnitude, float ColourIndex, bool Authored)
        {
            const auto& Source = Pool.Stars.at(Ordinal);
            const auto  Normal = NormalizeVector(Direction);
            if (VectorLength(SubtractVector(Normal, Source.EquatorialAxis)) > 1e-6f ||
                std::abs(Source.IntegratedFlux / (StellarFluxReference * std::pow(10.f, -.4f * Magnitude)) - 1) > 1e-5f)
                throw std::runtime_error("Export no longer matches the original constructed upstream field");
            double RightAscension =
                std::atan2(double(Normal.YCoord), double(Normal.XCoord)) * 180 / 3.14159265358979323846;
            if (RightAscension < 0) RightAscension += 360;
            const double Declination =
                std::asin(std::clamp(double(Normal.ZCoord), -1., 1.)) * 180 / 3.14159265358979323846;
            Catalogue << ++Ordinal << ',' << RightAscension << ',' << Declination << ',' << Magnitude << ','
                      << ColourIndex << ',' << Authored << '\n';
        };
        for (const auto& Star : BrightStarCatalogue)
            Append(ConstructEquatorialAxis(Star.RightAscensionHours * (Atmosphere::TauConstant / 24.f),
                                           Star.DeclinationDegrees * Atmosphere::DegreesToRadians),
                   Star.VisualMagnitude,
                   Star.ColourIndexBV,
                   false);
        const auto& Basis   = RetrieveGalacticBasis();
        unsigned    Attempt = 0;
        while (Ordinal < Pool.Stars.size() && Attempt < 400000)
        {
            ++Attempt;
            const float    Vertical = 2.f * HashUnitInterval(Attempt * 3u + 1u) - 1.f;
            const float    Azimuth  = Atmosphere::TauConstant * HashUnitInterval(Attempt * 3u + 2u);
            const float    Radial   = SafeSquareRoot(1.f - Vertical * Vertical);
            const Vector3f Galactic{Radial * std::cos(Azimuth), Radial * std::sin(Azimuth), Vertical};
            const float    Longitude = std::atan2(Galactic.YCoord, Galactic.XCoord);
            const float    Latitude  = std::asin(Vertical);
            if (HashUnitInterval(Attempt * 3u + 3u) * 1.6f > EvaluateMilkyWayStarDensity(Longitude, Latitude)) continue;
            const auto  Equatorial = AddVector(AddVector(ScaleVector(Basis.CentreAxis, Galactic.XCoord),
                                                        ScaleVector(Basis.QuadratureAxis, Galactic.YCoord)),
                                              ScaleVector(Basis.PoleAxis, Galactic.ZCoord));
            const float Magnitude =
                4.6f + std::log10(1.f + HashUnitInterval(Attempt * 7u + 5u) * (std::pow(10.f, 2.5f) - 1.f)) / .5f;
            const float ColourIndex = -.28f + 2.05f * std::pow(HashUnitInterval(Attempt * 11u + 7u), 1.15f);
            Append(Equatorial, Magnitude, ColourIndex, true);
        }
        if (Ordinal != 15356 || Pool.CatalogueCount != 156)
            throw std::runtime_error("Pinned upstream catalogue coverage changed");
        std::ofstream Galaxy(Destination / "ReferenceGalaxy.csv");
        Galaxy << std::setprecision(17)
               << "equatorial_x,equatorial_y,equatorial_z,reference_r,reference_g,reference_b\n";
        auto Sample = [&](const Vector3f& Direction)
        {
            const auto Colour = EvaluateMilkyWaySurfaceBrightness(Direction);
            Galaxy << Direction.XCoord << ',' << Direction.YCoord << ',' << Direction.ZCoord << ',' << Colour.Red << ','
                   << Colour.Green << ',' << Colour.Blue << '\n';
        };
        for (unsigned Index = 0; Index < 192; ++Index)
        {
            const float Z     = -1.f + 2.f * (Index + .5f) / 192;
            const float Angle = 2.399963229728653f * Index;
            Sample(Vector3f{std::sqrt(1 - Z * Z) * std::cos(Angle), std::sqrt(1 - Z * Z) * std::sin(Angle), Z});
        }
        for (unsigned LongitudeIndex = 0; LongitudeIndex < 25; ++LongitudeIndex)
            for (unsigned LatitudeIndex = 0; LatitudeIndex < 13; ++LatitudeIndex)
            {
                const float Longitude = (-90.f + 7.5f * LongitudeIndex) * Atmosphere::DegreesToRadians;
                const float Latitude  = (-30.f + 5.f * LatitudeIndex) * Atmosphere::DegreesToRadians;
                Sample(AddVector(AddVector(ScaleVector(Basis.CentreAxis, std::cos(Longitude) * std::cos(Latitude)),
                                           ScaleVector(Basis.QuadratureAxis, std::sin(Longitude) * std::cos(Latitude))),
                                 ScaleVector(Basis.PoleAxis, std::sin(Latitude))));
            }
        std::ofstream Nebulae(Destination / "ReferenceNebulae.csv");
        Nebulae << std::setprecision(17)
                << "equatorial_x,equatorial_y,equatorial_z,reference_r,reference_g,reference_b\n";
        for (const auto Coordinates : {std::array<float, 2>{5.588f, -5.39f},
                                       {3.772f, 24.10f},
                                       {.712f, 41.27f},
                                       {5.392f, -69.76f},
                                       {.877f, -72.83f},
                                       {18.06f, -24.38f},
                                       {10.75f, -59.87f}})
        {
            const auto Centre = ConstructEquatorialAxis(Coordinates[0] * Atmosphere::TauConstant / 24.f,
                                                        Coordinates[1] * Atmosphere::DegreesToRadians);
            const auto East   = NormalizeVector(CrossVector(Vector3f{0, 0, 1}, Centre));
            const auto North  = CrossVector(Centre, East);
            for (unsigned Index = 0; Index < 17; ++Index)
            {
                const float Radius = Index == 0 ? 0 : .001f + .003f * Index;
                const float Angle  = Index * 2.399963229728653f;
                const auto  Direction =
                    NormalizeVector(AddVector(Centre,
                                              AddVector(ScaleVector(East, Radius * std::cos(Angle)),
                                                        ScaleVector(North, Radius * std::sin(Angle)))));
                const auto Colour = EvaluateDeepSkyNebulae(Direction);
                Nebulae << Direction.XCoord << ',' << Direction.YCoord << ',' << Direction.ZCoord << ',' << Colour.Red
                        << ',' << Colour.Green << ',' << Colour.Blue << '\n';
            }
        }
        std::ofstream Psf(Destination / "ReferencePsf.csv");
        Psf << std::setprecision(17) << "radius_pixels,density_per_pixel_squared\n";
        for (unsigned Index = 0; Index < 121; ++Index)
        {
            const float Radius = float(Index) * .1f;
            Psf << Radius << ',' << EvaluateStellarPointSpread(Radius * .001f, .001f) * .000001f << '\n';
        }
        std::ofstream Axes(Destination / "ReferenceBasis.csv");
        Axes << std::setprecision(17) << "x,y,z\n";
        for (const auto& Axis : {Basis.CentreAxis, Basis.QuadratureAxis, Basis.PoleAxis})
            Axes << Axis.XCoord << ',' << Axis.YCoord << ',' << Axis.ZCoord << '\n';
        if (!Catalogue || !Galaxy || !Nebulae || !Psf || !Axes)
            throw std::runtime_error("Upstream export write failed");
        std::cout << "Actual pinned upstream: 156 bright + 15200 authored stars; 517 galaxy, 119 nebular and 121 "
                     "stellar PSF probes\n";
    }
    catch (const std::exception& Failure)
    {
        std::cerr << "Upstream export failure: " << Failure.what() << '\n';
        return 1;
    }
}
