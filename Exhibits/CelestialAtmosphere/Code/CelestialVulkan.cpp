/*============================================================================================================================================
                                                           CELESTIALVULKAN.CPP
============================================================================================================================================*/
// 🧩 Execute every celestial Slang entry, compare actual readbacks to double-precision physics and retain native surface/orbit captures.

#include "CelestialCompute.h"
#include "CelestialReference.h"
#include <bit>
#include <chrono>
#include <iostream>
#include <numeric>

using namespace Frontier;
using namespace Frontier::CelestialAtmosphereExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                              NATIVE CAPTURE / EXPLICIT GPU EXECUTION
//------------------------------------------------------------------------------------------------------------------------

constexpr unsigned             Pixels = CaptureWidth * CaptureHeight;
const std::vector<std::string> Entries{"BakeAtmosphereTransmittance",
                                       "BakeAtmosphereMultiple",
                                       "ResolveSolarVisibility",
                                       "ResolveAtmosphericSolarFlux",
                                       "ResolveCataloguePhotometry",
                                       "RenderCelestialAtmosphere",
                                       "RenderLunarSurface",
                                       "RenderSolarAtmosphere",
                                       "RenderLensFlare",
                                       "InspectCelestialPhysics"};

std::uint64_t Digest(const void* Bytes, std::size_t Count)
{
    std::uint64_t Result   = 14695981039346656037ull;
    const auto*   Sequence = static_cast<const unsigned char*>(Bytes);
    for (std::size_t Index = 0; Index < Count; ++Index)
        Result = (Result ^ Sequence[Index]) * 1099511628211ull;
    return Result;
}
void SaveFloats(const std::filesystem::path& Location, const std::vector<Float4>& Sequence)
{
    std::ofstream Output(Location, std::ios::binary);
    Output.write(reinterpret_cast<const char*>(Sequence.data()), std::streamsize(Sequence.size() * sizeof(Float4)));
    Enforce(bool(Output), "Cannot retain actual celestial Float32 readback");
}
std::string JsonVector(Vector A)
{
    std::ostringstream Text;
    Text << std::setprecision(14) << '[' << A.X << ',' << A.Y << ',' << A.Z << ']';
    return Text.str();
}

struct PhysicsProbe
{
    Float4 A{}, B{};
};

struct CelestialExecution
{
    RasterValidationDevice     Device;
    CelestialCompute           Compute;
    CelestialFootprint         Footprint{};
    LunarAlbedoMap             Map;
    std::filesystem::path      Destination, PreparedInputs;
    std::vector<std::string>   Captures, Diagnostics;
    std::vector<StellarSource> Projected;
    unsigned                   Assertions = 0, ProbeCount = 0;
    double                     DensityError = 0, TransmissionError = 0, ScatteringRelativeError = 0, LunarMapError = 0;
    double LunarSurfaceError = 0, SolarProfileError = 0, LensError = 0, GalacticError = 0, CoronaRelativeError = 0;
    double ReferenceBulgeError = 0, ReferenceNebulaError = 0, ReferencePsfError = 0;

    CelestialExecution(const char*                  Driver,
                       const std::string&           Shaders,
                       const std::filesystem::path& Inputs,
                       const std::filesystem::path& Output)
        : Device(Driver, VK_API_VERSION_1_1), Compute(Device), Destination(Output), PreparedInputs(Inputs)
    {
        std::filesystem::create_directories(Destination / "Renders");
        Enforce(Map.LoadPpm((Inputs / "MoonAlbedo2048.ppm").string().c_str()), "Same retained Moon map could not load");
        const std::array<std::size_t, 8> Bytes{(304 + SolarOpticsPayloadFloats) * sizeof(float),
                                               std::size_t(2048) * 1024 * sizeof(Float4),
                                               std::size_t(1024) * 512 * sizeof(float),
                                               60000 * sizeof(StellarSource),
                                               750000 * sizeof(unsigned),
                                               (256 * 64 + 32 * 16) * sizeof(Float4),
                                               (std::size_t(24) * Pixels + 13889 + SolarSourceCount + 128) *
                                                   sizeof(Float4),
                                               32768 * sizeof(unsigned)};
        Compute.Construct(Bytes, Shaders, Entries);
        std::vector<Float4> Texture(std::size_t(Map.Width()) * Map.Height());
        for (unsigned Y = 0; Y < Map.Height(); ++Y)
            for (unsigned X = 0; X < Map.Width(); ++X)
                Texture[std::size_t(Y) * Map.Width() + X] =
                    Encode(Map.Sample(((X + .5) / Map.Width() * 2 - 1) * π, (.5 - (Y + .5) / Map.Height()) * π), 1);
        Compute.Upload(1, Texture);
        std::ifstream      Galactic(Inputs / "MilkyWay1024x512.f32", std::ios::binary);
        std::vector<float> Field(1024 * 512);
        Enforce(
            bool(Galactic.read(reinterpret_cast<char*>(Field.data()), std::streamsize(Field.size() * sizeof(float)))),
            "Pinned Milky Way contours could not load");
        Compute.Upload(2, Field);
    }

    void Assert(bool Condition, const std::string& Description)
    {
        ++Assertions;
        Enforce(Condition, Description);
    }
    void Configure(const CelestialScene& Scene, unsigned Count = Pixels)
    {
        Footprint                = {};
        Footprint.Counts[0]      = Count;
        Footprint.Locations[1]   = 256;
        Footprint.ClipOrigin0[0] = int(CaptureWidth);
        Footprint.ClipOrigin0[1] = int(CaptureHeight);
        // 📝 The shader's third 16-byte lane is History.xy; both definitions are an explicit 128-byte ABI.
        Compute.Upload(0, Scene.Compile());
        std::vector<unsigned> Bins;
        Projected           = Scene.ProjectCatalogue(Bins);
        Footprint.Counts[2] = unsigned(Projected.size());
        if (!Projected.empty()) Compute.Upload(3, Projected);
        Compute.Upload(4, Bins);
    }
    void Dispatch(const std::string& Entry, unsigned Count)
    {
        Compute.Dispatch(Entry, Count, Footprint);
        Compute.VerifyGuards();
    }
    void Bake(const CelestialScene& Scene)
    {
        Configure(Scene);
        Dispatch("BakeAtmosphereTransmittance", 256 * 64);
        Dispatch("BakeAtmosphereMultiple", 32 * 16);
        const auto* Table = static_cast<const Float4*>(Compute.Regions[5].Mapped);
        for (unsigned Index = 0; Index < 256 * 64 + 32 * 16; ++Index)
            for (float Channel : Table[Index])
                Assert(std::isfinite(Channel) && Channel >= 0, "Invalid atmospheric table");
        for (unsigned Y = 0; Y < 16; ++Y)
            for (unsigned X = 0; X < 5; ++X)
            {
                const auto Night = Table[256 * 64 + Y * 32 + X];
                if (Night[0] != 0 || Night[1] != 0 || Night[2] != 0)
                    std::cerr << "Night closure texel " << X << ',' << Y << " radiance " << Night[0] << ',' << Night[1]
                              << ',' << Night[2] << '\n';
                Assert(Night[0] == 0 && Night[1] == 0 && Night[2] == 0,
                       "Deep planetary night leaks direct sunlight into the approximate multiple-scattering table");
            }
        for (unsigned Index = 256 * 64; Index < 256 * 64 + 32 * 16; ++Index)
            Assert(Table[Index][3] < .98, "Directional-average multiple scattering has no stable energy closure");
        SaveFloats(Destination / "AtmosphericTables.f32", std::vector<Float4>(Table, Table + 256 * 64 + 32 * 16));
    }
    void Resolve()
    {
        Dispatch("ResolveSolarVisibility", 64);
        Dispatch("ResolveAtmosphericSolarFlux", 64);
        if (Footprint.Counts[2]) Dispatch("ResolveCataloguePhotometry", Footprint.Counts[2]);
    }
    std::vector<Float4> Inspect(const CelestialScene& Scene, const std::vector<PhysicsProbe>& Probes)
    {
        Enforce(!Probes.empty() && Probes.size() <= 4000, "Invalid celestial physics probe count");
        Configure(Scene, unsigned(Probes.size()));
        std::vector<unsigned> Encoded(64 + Probes.size() * 8, 0);
        std::memcpy(Encoded.data() + 64, Probes.data(), Probes.size() * sizeof(PhysicsProbe));
        Compute.Upload(7, Encoded);
        Dispatch("InspectCelestialPhysics", unsigned(Probes.size()));
        const auto* Actual = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        ProbeCount += unsigned(Probes.size());
        return std::vector<Float4>(Actual, Actual + Probes.size());
    }
    std::vector<Float4> Capture(const CelestialScene& Scene,
                                const std::string&    Slug,
                                const std::string&    Title,
                                const std::string&    Entry,
                                unsigned              Planes = 3)
    {
        Configure(Scene);
        Resolve();
        const auto Start = std::chrono::steady_clock::now();
        Dispatch(Entry, Pixels);
        const double Milliseconds =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Start).count();
        const auto*         Mapped = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        std::vector<Float4> Actual(Mapped, Mapped + std::size_t(Pixels) * Planes);
        for (const auto& Pixel : Actual)
            for (unsigned Channel = 0; Channel < 3; ++Channel)
                Assert(std::isfinite(Pixel[Channel]) && Pixel[Channel] >= 0,
                       "Non-finite or negative captured celestial radiance");
        SaveFloats(Destination / "Renders" / (Slug + ".f32"), Actual);
        std::ostringstream Metadata;
        Metadata << std::setprecision(14) << "{\"slug\":\"" << Slug << "\",\"title\":\"" << Title << "\",\"shader\":\""
                 << Entry << "\",\"extent\":[" << CaptureWidth << ',' << CaptureHeight << "],\"planes\":" << Planes
                 << ",\"julian_utc\":" << Scene.Julian << ",\"latitude_deg\":" << Scene.Latitude
                 << ",\"longitude_deg\":" << Scene.Longitude << ",\"camera_km\":" << JsonVector(Scene.Camera.Position)
                 << ",\"forward\":" << JsonVector(Scene.Camera.Forward)
                 << ",\"right\":" << JsonVector(Scene.Camera.Right) << ",\"up\":" << JsonVector(Scene.Camera.Up)
                 << ",\"tangent\":" << Scene.Camera.Tangent << ",\"sun\":" << JsonVector(Scene.Solar.SunDirection)
                 << ",\"moon\":" << JsonVector(Scene.MoonDirection) << ",\"moon_radius_rad\":" << Scene.MoonRadius
                 << ",\"equatorial_to_local\":[" << JsonVector(Decode(Scene.Configuration[15])) << ','
                 << JsonVector(Decode(Scene.Configuration[16])) << ',' << JsonVector(Decode(Scene.Configuration[17]))
                 << ']' << ",\"exposure\":" << Scene.Exposure
                 << ",\"exosphere_display_gain\":" << Scene.Configuration[11][2]
                 << ",\"native_render_ms\":" << Milliseconds << ",\"projected_catalogue_stars\":" << Projected.size()
                 << ",\"authored_projected_stars\":"
                 << std::count_if(Projected.begin(),
                                  Projected.end(),
                                  [](const auto& Source) { return Source.ProjectionFlux[3] > .5f; })
                 << ",\"revised_stellar_psf\":" << (Scene.Configuration[34][1] > .5 ? "true" : "false")
                 << ",\"authored_catalogue_enabled\":" << (Scene.Configuration[34][0] > .5 ? "true" : "false")
                 << ",\"float_fnv1a64\":\"" << Digest(Actual.data(), Actual.size() * sizeof(Float4)) << "\"}";
        Captures.push_back(Metadata.str());
        std::cout << "Captured " << Slug << " · " << Milliseconds << " ms · " << Projected.size()
                  << " projected stars\n"
                  << std::flush;
        return Actual;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                 INDEPENDENT DOUBLE-PRECISION CHECKS
    //------------------------------------------------------------------------------------------------------------------------

    void VerifyPhysics(CelestialScene Scene)
    {
        std::vector<PhysicsProbe> Probes;
        for (unsigned Index = 0; Index < 96; ++Index)
            Probes.push_back({{float(Index * 1.1), float(-1 + 2. * Index / 95), 0, 0}, {}});
        auto Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
        {
            const auto   Input = Probes[Index].A;
            const Float4 Expected{float(RayleighDensity(Scene.Atmosphere, Input[0])),
                                  float(MieDensity(Scene.Atmosphere, Input[0])),
                                  float(OzoneDensity(Scene.Atmosphere, Input[0])),
                                  float(RayleighPhase(Input[1]))};
            for (unsigned Channel = 0; Channel < 4; ++Channel)
                DensityError = std::max(DensityError, double(std::abs(Actual[Index][Channel] - Expected[Channel])));
        }
        Assert(DensityError < 2e-6, "Slang medium density or Rayleigh phase disagrees with engine double precision");
        Probes.clear();
        for (double Altitude : {.1, 1.64, 8., 25., 60., 99., 400.})
            for (double Cosine : {-1., -.4, -.2, -.02, 0., .01, .08, .3, .7, 1.})
                Probes.push_back({{float(Scene.Atmosphere.GroundRadiusKm + Altitude), float(Cosine), 0, 1}, {}});
        Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
        {
            const auto A        = Probes[Index].A;
            const auto Expected = ReferenceSunTransmission(
                Scene.Atmosphere, {0, 0, A[0]}, {std::sqrt(1 - A[1] * double(A[1])), 0, A[1]}, 4096);
            TransmissionError = std::max(TransmissionError, Difference(Expected, DecodeRgb(Actual[Index])));
            if (Maximum(Expected) == 0)
                Assert(Maximum(DecodeRgb(Actual[Index])) == 0, "Planet shadow leaked in the actual shader");
        }
        Assert(TransmissionError < .007,
               "GPU optical-depth LUT exceeds the predeclared 0.007 absolute transmission gate");
        Scene.Configuration[10][0] = 1;
        Scene.Camera.Position      = {0, 0, 6361.64};
        Scene.Configuration[24][3] = 256;
        std::ofstream Scattering(Destination / "ScatteringProbes.csv");
        Scattering << std::setprecision(14)
                   << "sun_elevation_deg,view_elevation_deg,azimuth_deg,gpu_r,gpu_g,gpu_b,double_r,double_g,double_b,"
                      "relative_error\n";
        for (double SunAltitude : {-12., -6., 0., 5., 45., 85.})
        {
            Scene.Solar.SunDirection = {std::cos(SunAltitude * Radians), 0, std::sin(SunAltitude * Radians)};
            Probes.clear();
            for (double Elevation : {2., 15., 50., 85.})
                for (double Azimuth : {0., 120., 180.})
                {
                    const double Alt = Elevation * Radians, Az = Azimuth * Radians;
                    Probes.push_back(
                        {Encode(Vector{std::cos(Alt) * std::cos(Az), std::cos(Alt) * std::sin(Az), std::sin(Alt)}, 2),
                         {}});
                }
            Actual = Inspect(Scene, Probes);
            for (unsigned Index = 0; Index < Actual.size(); ++Index)
            {
                const auto   Direction  = Unit(Decode(Probes[Index].A));
                const auto   Expected   = ReferenceSky(Scene, Direction, 1024, 512);
                const auto   Measured   = DecodeRgb(Actual[Index]);
                const double Relative   = Difference(Expected, Measured) / std::max(1e-5, Maximum(Expected));
                ScatteringRelativeError = std::max(ScatteringRelativeError, Relative);
                Scattering << SunAltitude << ',' << std::asin(Direction.Z) / Radians << ','
                           << std::atan2(Direction.Y, Direction.X) / Radians << ',' << Measured.R << ',' << Measured.G
                           << ',' << Measured.B << ',' << Expected.R << ',' << Expected.G << ',' << Expected.B << ','
                           << Relative << '\n';
            }
        }
        Assert(ScatteringRelativeError < .04,
               "Actual single scattering exceeds the predeclared 4% high-step double-reference gate");
        Scene.Camera.Position    = {0, 0, 6760};
        Scene.Solar.SunDirection = Unit({1, 0, .2});
        Probes.clear();
        for (double Elevation : {-30., -20., -19.5, -18., -16., -10., 0., 45.})
            Probes.push_back({Encode(Vector{std::cos(Elevation * Radians), 0, std::sin(Elevation * Radians)}, 2), {}});
        Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
        {
            const auto   Expected = ReferenceSky(Scene, Unit(Decode(Probes[Index].A)), 2048, 512);
            const double Relative = Difference(Expected, DecodeRgb(Actual[Index])) / std::max(1e-5, Maximum(Expected));
            ScatteringRelativeError = std::max(ScatteringRelativeError, Relative);
            if (Relative >= .04)
                std::cerr << "Orbital ray " << Index << " relative " << Relative << " actual " << Actual[Index][0]
                          << ',' << Actual[Index][1] << ',' << Actual[Index][2] << " expected " << Expected.R << ','
                          << Expected.G << ',' << Expected.B << '\n';
            Assert(Relative < .04, "Space-entry atmosphere transport disagrees with independent clipped integration");
        }
        Scene.Camera.Position = {0, 0, 6361.64};
        Probes.clear();
        for (unsigned Index = 0; Index < 256; ++Index)
            Probes.push_back(
                {{float(-π + 2 * π * (Index * 97 % 257) / 257), float(-.5 * π + π * (Index * 53 % 257) / 257), 0, 4},
                 {}});
        Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
            LunarMapError =
                std::max(LunarMapError,
                         Difference(Map.Sample(Probes[Index].A[0], Probes[Index].A[1]), DecodeRgb(Actual[Index])));
        Assert(LunarMapError < .0003,
               "Actual GPU Moon sampler changed the retained texture, sRGB decode, orientation or seam");
        Scene.Configuration[14][0] = Scene.Configuration[14][1] = 0;
        Scene.Configuration[13][3]                              = .001f;
        Scene.MoonDirection                                     = {0, 1, 0};
        Scene.MoonNorth                                         = {0, 0, 1};
        for (double Phase : {0., .5 * π, .85 * π})
        {
            Scene.Solar.SunDirection = {std::sin(Phase), -std::cos(Phase), 0};
            Probes.clear();
            for (unsigned Index = 0; Index < 160; ++Index)
            {
                const double Radius = std::sqrt((Index + .5) / 160), Angle = 2.399963229728653 * Index;
                Probes.push_back({{float(Radius * std::cos(Angle)), float(Radius * std::sin(Angle)), 0, 3}, {}});
            }
            Actual = Inspect(Scene, Probes);
            for (unsigned Index = 0; Index < Actual.size(); ++Index)
                LunarSurfaceError =
                    std::max(LunarSurfaceError,
                             Difference(ReferenceMoon(Scene, Map, Probes[Index].A[0], Probes[Index].A[1]),
                                        DecodeRgb(Actual[Index])));
        }
        Assert(LunarSurfaceError < .0001,
               "Executed lunar Slang no longer matches the reused engine lunar BRDF/phase/earthshine");
        Probes.clear();
        for (unsigned Index = 0; Index < 128; ++Index)
            Probes.push_back({{float(Scene.Solar.Disc.AngularRadiusRad * (Index + .1) / 100), 0, 0, 5}, {}});
        Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
        {
            const double Expected = EvaluateSunDiscRadiance(Probes[Index].A[0], Scene.Solar.Disc, {1, 1, 1}).R;
            const double Error    = std::abs(Actual[Index][0] - Expected);
            SolarProfileError     = std::max(SolarProfileError, Error);
            if (Error >= 2e-5)
                std::cerr << "Solar profile " << Index << " angle " << Probes[Index].A[0] << " actual "
                          << Actual[Index][0] << " expected " << Expected << " error " << Error << " radius "
                          << Actual[Index][1] << " sigma " << Actual[Index][2] << " erf " << Actual[Index][3] << '\n';
        }
        Assert(SolarProfileError < 2e-5, "GPU solar limb/radial blur does not match double erfc/limb law");
        for (unsigned Component = 0; Component < 6; ++Component)
        {
            Scene.Solar.Flare                    = {};
            Scene.Solar.Flare.GhostStrength      = Component == 0;
            Scene.Solar.Flare.StarburstStrength  = Component == 1;
            Scene.Solar.Flare.AnamorphicStrength = Component == 2;
            Scene.Solar.Flare.HaloStrength       = Component == 3;
            Scene.Solar.Flare.VeilingStrength    = Component == 4;
            Scene.StarFilter.Strength            = Component == 5;
            Scene.Solar.Flare.GlowStrength = Scene.Solar.Flare.StreakStrength = 0;
            Probes.clear();
            for (unsigned Index = 0; Index < 384; ++Index)
                Probes.push_back(
                    {{float(-1.7 + 3.4 * (Index * 101 % 389) / 389), float(-1 + 2. * (Index * 53 % 389) / 389), 0, 6},
                     {.46f, .21f, 0, 0}});
            Actual        = Inspect(Scene, Probes);
            double Energy = 0;
            for (unsigned Index = 0; Index < Actual.size(); ++Index)
            {
                const auto A = Probes[Index].A, B = Probes[Index].B;
                const auto Expected =
                    EvaluateExperimentalLens(A[0], A[1], B[0], B[1], {1, 1, 1}, Scene.Solar.Flare, Scene.StarFilter);
                const double Error = Difference(Expected, DecodeRgb(Actual[Index]));
                LensError          = std::max(LensError, Error);
                if (Error >= 2e-5)
                    std::cerr << "Lens component " << Component << " probe " << Index << " at " << A[0] << ',' << A[1]
                              << " actual " << Actual[Index][0] << ',' << Actual[Index][1] << ',' << Actual[Index][2]
                              << " expected " << Expected.R << ',' << Expected.G << ',' << Expected.B << " error "
                              << Error << '\n';
                Energy += Maximum(DecodeRgb(Actual[Index]));
            }
            Assert(Energy > 0, "An actual requested Slang flare component is absent");
        }
        Assert(LensError < 2e-5, "Actual six-component lens shader disagrees with native experimental/reused optics");
        Probes.clear();
        std::vector<Vector> Equatorial;
        for (unsigned Index = 0; Index < 144; ++Index)
        {
            const double Longitude = 2 * π * (Index * 53 % 149) / 149,
                         Latitude  = std::asin(-1 + 2 * (Index + .5) / 144);
            const Vector E{
                std::cos(Longitude) * std::cos(Latitude), std::sin(Longitude) * std::cos(Latitude), std::sin(Latitude)};
            Equatorial.push_back(E);
            const auto Local = Decode(Scene.Configuration[15]) * E.X + Decode(Scene.Configuration[16]) * E.Y +
                               Decode(Scene.Configuration[17]) * E.Z;
            Probes.push_back({Encode(Unit(Local), 7), {}});
        }
        Actual = Inspect(Scene, Probes);
        std::ofstream Galaxy(Destination / "GalaxyProbes.csv");
        Galaxy << std::setprecision(14)
               << "equatorial_x,equatorial_y,equatorial_z,gpu_galactic_x,gpu_galactic_y,gpu_galactic_z,gpu_contour\n";
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
        {
            const auto   E = Equatorial[Index];
            const Vector Expected{-.0548755604 * E.X - .8734370902 * E.Y - .4838350155 * E.Z,
                                  .4941094279 * E.X - .4448296300 * E.Y + .7469822445 * E.Z,
                                  -.8676661490 * E.X - .1980763734 * E.Y + .4559837762 * E.Z};
            GalacticError = std::max(GalacticError, Length(Expected - Decode(Actual[Index])));
            Galaxy << E.X << ',' << E.Y << ',' << E.Z << ',' << Actual[Index][0] << ',' << Actual[Index][1] << ','
                   << Actual[Index][2] << ',' << Actual[Index][3] << '\n';
        }
        Assert(GalacticError < 1e-6, "Galaxy rotation has wrong axes, handedness or precession inverse");
        Probes.clear();
        for (unsigned Index = 0; Index < 96; ++Index)
            Probes.push_back({{float(1 + 7. * Index / 95), 0, 0, 9}, {}});
        Actual = Inspect(Scene, Probes);
        for (unsigned Index = 0; Index < Actual.size(); ++Index)
            CoronaRelativeError = std::max(CoronaRelativeError,
                                           std::abs(Actual[Index][0] / ReferenceCoronaDensity(Probes[Index].A[0]) - 1));
        Assert(CoronaRelativeError < 1e-5,
               "Actual coronal density differs from independent quiet-Sun electron-density law");
        Scene.Configuration[10][1] = 1;
        Scene.MoonDirection        = {0, 1, 0};
        Scene.MoonNorth            = {0, 0, 1};
        Scene.Solar.SunDirection   = Unit({1, 0, .2});
        Probes.clear();
        for (double Radius : {1.005, 1.01, 1.025, 1.05, 1.1, 1.16})
            Probes.push_back({Encode(Unit({std::sin(Scene.MoonRadius) * Radius, 1, 0}), 10), {}});
        Actual            = Inspect(Scene, Probes);
        double GasMaximum = 0;
        for (const auto& Gas : Actual)
            GasMaximum = std::max(GasMaximum, Maximum(DecodeRgb(Gas)));
        Assert(GasMaximum > 1e-17 && GasMaximum < 1e-12,
               "Physical lunar exosphere is missing or has an Earthlike visible optical depth");
        Scene.Configuration[5][3]  = 0;
        Scene.Solar.DiscIrradiance = {0, 0, 0};
        Actual                     = Inspect(Scene, Probes);
        for (const auto& Gas : Actual)
            Assert(Maximum(DecodeRgb(Gas)) == 0, "Lunar gas creates light without incident Sun");
        std::cout << "GPU physics probes: " << ProbeCount << " · transmission " << TransmissionError
                  << " · scattering relative " << ScatteringRelativeError << " · Moon surface " << LunarSurfaceError
                  << "\n"
                  << std::flush;
    }

    void VerifyRequestedReference(CelestialScene Scene)
    {
        std::ofstream Retained(Destination / "ReferencePortProbes.csv");
        Retained << std::setprecision(14)
                 << "selection,coordinate_x,coordinate_y,coordinate_z,gpu_r,gpu_g,gpu_b,reference_r,reference_g,"
                    "reference_b\n";
        for (const auto& Fixture :
             {std::pair{"ReferenceGalaxy.csv", 13u}, {"ReferenceNebulae.csv", 15u}, {"ReferencePsf.csv", 14u}})
        {
            std::ifstream Input(PreparedInputs / Fixture.first);
            Enforce(bool(Input), "Missing actual upstream-native reference export");
            std::string Line;
            std::getline(Input, Line);
            std::vector<PhysicsProbe> Probes;
            std::vector<Float4>       Expected;
            while (std::getline(Input, Line))
            {
                std::replace(Line.begin(), Line.end(), ',', ' ');
                std::istringstream Row(Line);
                double             X = 0, Y = 0, Z = 0, R = 0, G = 0, B = 0;
                if (Fixture.second == 14)
                {
                    Enforce(bool(Row >> X >> R), "Invalid upstream PSF export");
                }
                else
                    Enforce(bool(Row >> X >> Y >> Z >> R >> G >> B), "Invalid upstream galaxy export");
                Probes.push_back(
                    {{float(X), Fixture.second == 14 ? 0 : float(Y), float(Z), float(Fixture.second)}, {}});
                Expected.push_back({float(R), float(G), float(B), 1});
            }
            Assert(Probes.size() == (Fixture.second == 13   ? 517
                                     : Fixture.second == 14 ? 121
                                                            : 119),
                   "Incomplete original upstream probe coverage");
            const auto Actual = Inspect(Scene, Probes);
            double     Error  = 0;
            for (unsigned Index = 0; Index < Actual.size(); ++Index)
            {
                Error = std::max(Error, Difference(DecodeRgb(Actual[Index]), DecodeRgb(Expected[Index])));
                Retained << Fixture.second << ',' << Probes[Index].A[0] << ',' << Probes[Index].A[1] << ','
                         << Probes[Index].A[2] << ',' << Actual[Index][0] << ',' << Actual[Index][1] << ','
                         << Actual[Index][2] << ',' << Expected[Index][0] << ',' << Expected[Index][1] << ','
                         << Expected[Index][2] << '\n';
            }
            if (Fixture.second == 13) ReferenceBulgeError = Error;
            if (Fixture.second == 14) ReferencePsfError = Error;
            if (Fixture.second == 15) ReferenceNebulaError = Error;
            std::cout << "Actual upstream parity " << Fixture.first << " max abs " << Error << '\n' << std::flush;
            Assert(Error < (Fixture.second == 13 ? .0004 : .00001),
                   "Slang port disagrees with the original requested upstream native evaluator: " +
                       std::string(Fixture.first));
        }
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  RETAINED NATIVE CAPTURE FIXTURES
    //------------------------------------------------------------------------------------------------------------------------

    void VerifyRenderControls(CelestialScene Scene)
    {
        Scene.Camera.Position = {0, 0, 6361.64};
        Scene.Camera.Orient({1, 0, .3}, 56);
        Scene.Configuration[10]  = {1, 0, 0, 0};
        Scene.Configuration[11]  = {0, 0, 1, 1};
        Scene.Solar.SunDirection = {0, 0, -1};
        Configure(Scene);
        Resolve();
        Dispatch("RenderCelestialAtmosphere", Pixels);
        const auto* DeepNight = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        for (unsigned Pixel = 0; Pixel < Pixels; ++Pixel)
            Assert(DeepNight[Pixel][0] == 0 && DeepNight[Pixel][1] == 0 && DeepNight[Pixel][2] == 0,
                   "Deep night has sunlight through the rounded Float32 ground boundary");
        Scene.Solar.SunDirection   = Unit({1, 0, .3});
        Scene.Solar.DiscIrradiance = {0, 0, 0};
        Configure(Scene);
        Resolve();
        Dispatch("RenderCelestialAtmosphere", Pixels);
        const auto* Actual = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        for (unsigned Pixel = 0; Pixel < Pixels; ++Pixel)
            Assert(Actual[Pixel][0] == 0 && Actual[Pixel][1] == 0 && Actual[Pixel][2] == 0,
                   "Source-off atmosphere or ground produces radiance");
        Scene.Solar.DiscIrradiance = {1, 1, 1};
        Scene.Configuration[10][0] = 0;
        Scene.Configuration[11][3] = 0;
        Configure(Scene);
        Resolve();
        Dispatch("RenderCelestialAtmosphere", Pixels);
        for (unsigned Pixel = 0; Pixel < Pixels; ++Pixel)
        {
            Assert(Actual[Pixel][0] == 0 && Actual[Pixel][1] == 0 && Actual[Pixel][2] == 0,
                   "Disabled celestial sources are not exactly black");
            const auto Transmission = Actual[2 * Pixels + Pixel];
            Assert(Transmission[0] == 1 && Transmission[1] == 1 && Transmission[2] == 1, "Vacuum is not transparent");
        }
    }

    void RetainCaptures(CelestialScene Origin, const std::string& CataloguePath)
    {
        struct Illumination
        {
            const char* Slug;
            const char* Title;
            double      Elevation;
            bool        Evening;
        };
        const std::array<Illumination, 6> IlluminationSequence{
            {{"BeforeSunrise", "Before sunrise - nautical twilight", -10, false},
             {"Sunrise", "Sunrise - geometric solar centre at horizon", 0, false},
             {"Dawn", "Dawn - civil twilight before sunrise", -4, false},
             {"Zenith", "Zenith - ideal subsolar-site calibration", 90, false},
             {"Sunset", "Sunset - geometric solar centre at horizon", 0, true},
             {"Dusk", "Dusk - evening civil twilight", -6, true}}};
        for (const auto& Illumination : IlluminationSequence)
        {
            CelestialScene Scene = Origin;
            double         Low = Illumination.Evening ? 12 : 0, High = Illumination.Evening ? 20 : 10;
            if (Illumination.Elevation == 90)
            {
                Low  = 7;
                High = 14;
                for (unsigned Iteration = 0; Iteration < 64; ++Iteration)
                {
                    const double A = (2 * Low + High) / 3, B = (Low + 2 * High) / 3;
                    if (SunPosition(JulianDate(2026, 11, 18, A), Scene.Latitude, Scene.Longitude).ElevationRad <
                        SunPosition(JulianDate(2026, 11, 18, B), Scene.Latitude, Scene.Longitude).ElevationRad)
                        Low = A;
                    else
                        High = B;
                }
                const auto Noon =
                    SunPosition(JulianDate(2026, 11, 18, .5 * (Low + High)), Scene.Latitude, Scene.Longitude);
                Scene.Latitude = Noon.DeclinationRad / Radians;
            }
            else
            {
                for (unsigned Iteration = 0; Iteration < 64; ++Iteration)
                {
                    const double Midpoint = .5 * (Low + High);
                    const double Elevation =
                        SunPosition(JulianDate(2026, 11, 18, Midpoint), Scene.Latitude, Scene.Longitude).ElevationRad /
                        Radians;
                    if ((Elevation < Illumination.Elevation) != Illumination.Evening)
                        Low = Midpoint;
                    else
                        High = Midpoint;
                }
            }
            Scene.Julian = JulianDate(2026, 11, 18, .5 * (Low + High));
            Scene.LoadCatalogue(CataloguePath);
            Scene.LoadAuthoredCatalogue(PreparedInputs / "ReferenceStars.csv");
            Scene.Solar.SunDirection = SunDirectionLocal(SunPosition(Scene.Julian, Scene.Latitude, Scene.Longitude));
            const double Elevation   = std::asin(Scene.Solar.SunDirection.Z) / Radians;
            Assert(std::abs(Elevation - Illumination.Elevation) < .01,
                   "Named sky capture was not rendered at its declared actual solar elevation");
            Scene.Configuration[10]    = {1, 1, 1, 1};
            Scene.Configuration[11]    = {1, 0, 1, 1};
            Scene.Configuration[24][3] = 192;
            Scene.Exposure             = Illumination.Elevation < -5 ? 650 : (Illumination.Elevation < 0 ? 140 : 22);
            Scene.Camera.Position      = {0, 0, 6361.64};
            Vector Azimuth             = Unit({Scene.Solar.SunDirection.X, Scene.Solar.SunDirection.Y, 0});
            Scene.Camera.Orient(Illumination.Elevation == 90
                                    ? Scene.Solar.SunDirection
                                    : Azimuth * std::cos(12 * Radians) + Vector{0, 0, std::sin(12 * Radians)},
                                56);
            Capture(Scene, std::string("Surface") + Illumination.Slug, Illumination.Title, "RenderCelestialAtmosphere");
            Scene.Camera.Position  = {0, 0, 6760};
            const auto OrbitalMoon = MoonTopocentric(
                MoonGeocentric(Scene.Julian + 69.184 / 86400), Scene.Julian, Scene.Latitude, Scene.Longitude, 400000);
            Scene.MoonDirection = OrbitalMoon.Direction;
            Scene.MoonRadius    = OrbitalMoon.AngularRadiusRad;
            Scene.Camera.Orient(Azimuth * std::cos(16 * Radians) - Vector{0, 0, std::sin(16 * Radians)}, 56);
            Scene.Configuration[24][3] = 256;
            Scene.Exposure             = Illumination.Elevation < -5 ? 170 : 18;
            Capture(Scene,
                    std::string("Orbit") + Illumination.Slug,
                    std::string("400 km orbit / ") + Illumination.Title,
                    "RenderCelestialAtmosphere");
        }
        CelestialScene Scene       = Origin;
        Scene.Configuration[10]    = {0, 1, 0, 0};
        Scene.Configuration[11]    = {0, 0, 1, 0};
        Scene.Configuration[14][0] = Scene.Configuration[14][1] = 0;
        Scene.MoonDirection                                     = {0, 1, 0};
        Scene.MoonNorth                                         = {0, 0, 1};
        Scene.Camera.Orient(Scene.MoonDirection, 1.2);
        Scene.Exposure = 3;
        for (unsigned Phase = 0; Phase < 3; ++Phase)
        {
            Scene.Exposure           = Phase == 0 ? 3 : Phase == 1 ? 10 : 24;
            const double Angle       = Phase == 0 ? 0 : Phase == 1 ? .5 * π : .85 * π;
            Scene.Solar.SunDirection = {std::sin(Angle), -std::cos(Angle), 0};
            Capture(Scene,
                    Phase == 0   ? "MoonFull"
                    : Phase == 1 ? "MoonQuarter"
                                 : "MoonCrescent",
                    Phase == 0   ? "Same texture / full Moon"
                    : Phase == 1 ? "Same texture / quarter Moon"
                                 : "Same texture / crescent Moon",
                    "RenderLunarSurface");
        }
        Scene.Solar.SunDirection   = Unit({1, -.2, 0});
        Scene.Exposure             = 10;
        Scene.Configuration[11][2] = 1;
        Capture(Scene,
                "MoonExospherePhysical",
                "Lunar exosphere / physical density / not Earth atmosphere",
                "RenderLunarSurface");
        Scene.Configuration[11][2] = 1e14f;
        Capture(Scene,
                "MoonExosphereAmplified",
                "Lunar gas diagnostic / radiance amplified 100 trillion times",
                "RenderLunarSurface");
        Scene                    = Origin;
        Scene.Configuration[10]  = {0, 0, 1, 0};
        Scene.Configuration[11]  = {0, 0, 0, 0};
        Scene.Solar.SunDirection = {1, 0, 0};
        Scene.Camera.Orient(Scene.Solar.SunDirection, 1.2);
        Scene.Exposure = .00005;
        Capture(Scene,
                "SunDisc",
                "Finite Sun / quadratic limb darkening and radial sensor falloff",
                "RenderSolarAtmosphere");
        Scene.Camera.Orient(Scene.Solar.SunDirection, 3.5);
        Scene.Configuration[21][2] = 1;
        Scene.Exposure             = 250;
        Capture(Scene,
                "SolarCorona",
                "Quiet-Sun corona / occulted photosphere / coronal exposure",
                "RenderSolarAtmosphere");
        Scene.Camera.Orient({1, 0, 0}, 56);
        Scene.Solar.SunDirection   = Unit(Scene.Camera.Forward + Scene.Camera.Right * (.46 * Scene.Camera.Tangent) +
                                        Scene.Camera.Up * (.21 * Scene.Camera.Tangent));
        Scene.Configuration[21][2] = 0;
        Scene.Exposure             = 24;
        const std::array<const char*, 6> Names{
            "ApertureGhosts", "Diffraction", "Anamorphic", "AntipodeHalo", "VeilingGlare", "Starburst"};
        std::vector<Float4> Sum(2 * Pixels);
        for (unsigned Component = 0; Component < 6; ++Component)
        {
            Scene.Solar.Flare.GhostStrength      = Component == 0;
            Scene.Solar.Flare.StarburstStrength  = Component == 1;
            Scene.Solar.Flare.AnamorphicStrength = Component == 2;
            Scene.Solar.Flare.HaloStrength       = Component == 3;
            Scene.Solar.Flare.VeilingStrength    = Component == 4;
            Scene.StarFilter.Strength            = Component == 5;
            Scene.Solar.Flare.GlowStrength = Scene.Solar.Flare.StreakStrength = 0;
            const auto Actual =
                Capture(Scene, std::string("Flare") + Names[Component], Names[Component], "RenderLensFlare", 2);
            double Energy = 0;
            for (unsigned Pixel = 0; Pixel < Pixels; ++Pixel)
                for (unsigned Channel = 0; Channel < 3; ++Channel)
                {
                    Sum[Pixel + Pixels][Channel] += Actual[Pixel + Pixels][Channel];
                    Energy += Actual[Pixel + Pixels][Channel];
                }
            Assert(Energy > 0, "Requested flare type is invisible in its full native capture");
        }
        Scene.Solar.Flare.GhostStrength = Scene.Solar.Flare.StarburstStrength = Scene.Solar.Flare.AnamorphicStrength =
            1;
        Scene.Solar.Flare.HaloStrength = Scene.Solar.Flare.VeilingStrength = 1;
        Scene.StarFilter.Strength                                          = 1;
        auto Combined                                                      = Capture(
            Scene, "FlareCombined", "All six lens components / additive irradiance response", "RenderLensFlare", 2);
        double AdditionError = 0;
        for (unsigned Pixel = Pixels; Pixel < 2 * Pixels; ++Pixel)
            for (unsigned Channel = 0; Channel < 3; ++Channel)
                AdditionError =
                    std::max(AdditionError, double(std::abs(Combined[Pixel][Channel] - Sum[Pixel][Channel])));
        Assert(AdditionError < 1e-6, "Six flare layers are not simultaneously additive in the rendered output");
        Scene.Solar.DiscIrradiance = {.5, .5, .5};
        Configure(Scene);
        Resolve();
        Dispatch("RenderLensFlare", Pixels);
        const auto* HalfFlux = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        for (unsigned Pixel = 0; Pixel < 2 * Pixels; ++Pixel)
            for (unsigned Channel = 0; Channel < 3; ++Channel)
                Assert(std::abs(HalfFlux[Pixel][Channel] - .5f * Combined[Pixel][Channel]) < 1e-5,
                       "Rendered Sun/lens response is nonlinear in irradiance");
        Scene.Solar.DiscIrradiance = {1, 1, 1};
        Scene.Configuration[10][1] = 1;
        Scene.MoonRadius           = Scene.Solar.Disc.AngularRadiusRad;
        Scene.MoonDirection        = Unit(Scene.Solar.SunDirection + Scene.Camera.Right * Scene.MoonRadius);
        Configure(Scene);
        Resolve();
        const auto* Visibility = static_cast<const unsigned*>(Compute.Regions[7].Mapped);
        const float Partial    = std::bit_cast<float>(Visibility[20]);
        Assert(Partial > .3f && Partial < .85f,
               "Finite lunar eclipse did not partially attenuate incident solar/flare flux");
        Scene.Configuration[10][1] = 0;
        Scene.Configuration[24][0] = 1;
        const auto Hidden          = Capture(
            Scene, "FlareOccluded", "All six lens components / completely occluded source", "RenderLensFlare", 2);
        for (const auto& Pixel : Hidden)
            Assert(Pixel[0] == 0 && Pixel[1] == 0 && Pixel[2] == 0,
                   "Occluded Sun creates a ghost, diffraction, streak, halo or veil");
        CelestialScene LensDiagnostic    = Origin;
        LensDiagnostic.Configuration[10] = {0, 0, 1, 0};
        LensDiagnostic.Configuration[11] = {0, 0, 0, 0};
        LensDiagnostic.Camera.Orient({1, 0, 0}, 56);
        LensDiagnostic.Solar.SunDirection =
            Unit(LensDiagnostic.Camera.Forward + LensDiagnostic.Camera.Right * (.46 * LensDiagnostic.Camera.Tangent) +
                 LensDiagnostic.Camera.Up * (.21 * LensDiagnostic.Camera.Tangent));
        LensDiagnostic.Solar.Flare.AnamorphicStrength = 1;
        LensDiagnostic.Exposure                       = 24;
        for (unsigned Diagnostic = 0; Diagnostic < 3; ++Diagnostic)
        {
            LensDiagnostic.Configuration[33][0]           = Diagnostic == 0;
            LensDiagnostic.Solar.Flare.AnamorphicAngleRad = Diagnostic == 1 ? .4 : 0;
            if (Diagnostic == 2)
                LensDiagnostic.Solar.SunDirection =
                    Unit(LensDiagnostic.Camera.Forward +
                         LensDiagnostic.Camera.Right * ((.46 + 1. / CaptureHeight) * LensDiagnostic.Camera.Tangent) +
                         LensDiagnostic.Camera.Up * ((.21 + 1. / CaptureHeight) * LensDiagnostic.Camera.Tangent));
            Capture(LensDiagnostic,
                    Diagnostic == 0   ? "AnamorphicLegacy"
                    : Diagnostic == 1 ? "AnamorphicRotated"
                                      : "AnamorphicSubpixel",
                    Diagnostic == 0   ? "Before / original unbounded streak"
                    : Diagnostic == 1 ? "Repair / rotated 0.4 radians"
                                      : "Repair / half-pixel translation",
                    "RenderLensFlare",
                    2);
            Diagnostics.push_back(Captures.back());
            Captures.pop_back();
        }
        auto RetainStellarTable = [&](const char* Name)
        {
            const auto*   StellarReadback = static_cast<const StellarSource*>(Compute.Regions[3].Mapped);
            std::ofstream StellarOutput(Destination / Name);
            StellarOutput << std::setprecision(14)
                          << "east,north,up,magnitude,bv,pixel_x,pixel_y,flux,linear_r,linear_g,linear_b,authored\n";
            for (unsigned Index = 0; Index < Projected.size(); ++Index)
            {
                const auto& Source = StellarReadback[Index];
                StellarOutput << Source.DirectionMagnitude[0] << ',' << Source.DirectionMagnitude[1] << ','
                              << Source.DirectionMagnitude[2] << ',' << Source.DirectionMagnitude[3] << ','
                              << Source.ColourIndex[3] << ',' << Source.ProjectionFlux[0] << ','
                              << Source.ProjectionFlux[1] << ',' << Source.ProjectionFlux[2] << ','
                              << Source.ColourIndex[0] << ',' << Source.ColourIndex[1] << ',' << Source.ColourIndex[2]
                              << ',' << Source.ProjectionFlux[3] << '\n';
            }
            Enforce(bool(StellarOutput), "Cannot retain measured/authored stellar readback");
        };
        Scene                      = Origin;
        Scene.Configuration[10]    = {0, 0, 0, 1};
        Scene.Configuration[11]    = {1, 0, 0, 0};
        Scene.Solar.DiscIrradiance = {0, 0, 0};
        // 📝 Match the requested reference's -0.46-rad site and 266.4-degree sidereal meridian.
        // Our engine additionally applies its existing first-order precession; this is not a pixel-identical re-encoding of its PNG.
        Scene.Latitude        = -.46 / Radians;
        const double Midnight = JulianDate(2026, 11, 18, 0);
        const double Meridian =
            std::fmod((18.697374558 + 24.06570982441908 * (Midnight - 2451545)) * 15 + Scene.Longitude, 360);
        Scene.Julian = Midnight + std::fmod(266.4 - Meridian + 360, 360) / (24.06570982441908 * 15);
        Scene.LoadCatalogue(CataloguePath);
        Scene.LoadAuthoredCatalogue(PreparedInputs / "ReferenceStars.csv");
        const Vector ReferenceForward{std::cos(42 * Radians) * std::cos(200 * Radians),
                                      std::cos(42 * Radians) * std::sin(200 * Radians),
                                      std::sin(42 * Radians)};
        Scene.Camera.Orient(ReferenceForward, 2 * std::atan(std::tan(55 * Radians) / Scene.Camera.Aspect) / Radians);
        Scene.Exposure             = 2e7;
        const auto StarsAndGalaxy  = Capture(Scene,
                                            "CatalogueGalaxySpace",
                                            "Reference bulge and dust / 156 bright + 15200 authored stars",
                                            "RenderCelestialAtmosphere");
        Scene.Configuration[11][0] = 0;
        const auto StarsOnly       = Capture(Scene,
                                       "CatalogueStarsSpace",
                                       "Reference star catalogue / sharp cores and Moffat halos",
                                       "RenderCelestialAtmosphere");
        RetainStellarTable("ProjectedUpdatedStars.csv");
        unsigned GalaxyChanged = 0;
        for (unsigned Pixel = 0; Pixel < Pixels; ++Pixel)
            if (StarsAndGalaxy[Pixel] != StarsOnly[Pixel]) ++GalaxyChanged;
        Assert(GalaxyChanged > 1000, "Requested galactic bulge and dust are absent from the native field");
        Scene.Configuration[10][3] = 0;
        Scene.Configuration[11][0] = 1;
        Capture(Scene,
                "GalaxyContoursSpace",
                "Reference galactic bulge and dust / no point stars",
                "RenderCelestialAtmosphere");
        Scene.Camera.Position      = {0, 0, 6361.64};
        Scene.Solar.SunDirection   = {std::cos(-32 * Radians), 0, std::sin(-32 * Radians)};
        Scene.Solar.DiscIrradiance = {1, 1, 1};
        Scene.Configuration[10]    = {1, 0, 1, 1};
        Scene.Configuration[11]    = {1, 0, 0, 1};
        Scene.Exposure             = 3e7;
        Capture(Scene,
                "CatalogueGalaxySurface",
                "Reference night composition / stars and dust through atmosphere",
                "RenderCelestialAtmosphere");
        Scene                       = Origin;
        Scene.Configuration[10]     = {0, 0, 0, 1};
        Scene.Configuration[11]     = {0, 0, 0, 0};
        Scene.Configuration[34]     = {0, 0, 0, 0};
        Scene.Solar.DiscIrradiance  = {0, 0, 0};
        const double RightAscension = 266.4051 * Radians, Declination = -28.936175 * Radians;
        Vector GalacticCentre = Decode(Scene.Configuration[15]) * (std::cos(RightAscension) * std::cos(Declination)) +
                                Decode(Scene.Configuration[16]) * (std::sin(RightAscension) * std::cos(Declination)) +
                                Decode(Scene.Configuration[17]) * std::sin(Declination);
        Scene.Camera.Orient(GalacticCentre, 80);
        Scene.Exposure = 2e8;
        Capture(Scene,
                "MeasuredCatalogueSpace",
                "Measured-only validation / unchanged Hipparcos coordinates and flux",
                "RenderCelestialAtmosphere");
        RetainStellarTable("ProjectedStars.csv");
        CelestialScene Repeat       = Origin;
        Repeat.Configuration[10]    = {0, 1, 0, 0};
        Repeat.Configuration[11]    = {0, 0, 1, 0};
        Repeat.Configuration[14][0] = Repeat.Configuration[14][1] = 0;
        Repeat.MoonDirection                                      = {0, 1, 0};
        Repeat.MoonNorth                                          = {0, 0, 1};
        Repeat.Camera.Orient(Repeat.MoonDirection, 1.2);
        Repeat.Solar.SunDirection = {0, -1, 0};
        Configure(Repeat);
        Resolve();
        Dispatch("RenderLunarSurface", Pixels);
        const auto*         Actual = static_cast<const Float4*>(Compute.Regions[6].Mapped);
        std::ifstream       Prior(Destination / "Renders/MoonFull.f32", std::ios::binary);
        std::vector<Float4> Expected(3 * Pixels);
        Assert(bool(Prior.read(reinterpret_cast<char*>(Expected.data()),
                               std::streamsize(Expected.size() * sizeof(Float4)))),
               "Cannot reread first Moon capture");
        Assert(std::memcmp(Expected.data(), Actual, Expected.size() * sizeof(Float4)) == 0,
               "Changing celestial views leaves stale data in a fresh identical Moon capture");
    }

    void Report()
    {
        Compute.VerifyGuards();
        for (const auto& Entry : Entries)
            Assert(Compute.ExecutedEntries.contains(Entry), "Celestial entry was compiled but not executed: " + Entry);
        std::ofstream Output(Destination / "CelestialVulkan.json");
        Output << std::setprecision(14) << "{\n  \"passed\": true,\n  \"assertions\": " << Assertions
               << ",\n  \"physics_probes\": " << ProbeCount << ",\n  \"device\": \"" << Device.Properties.deviceName
               << "\",\n  \"device_type\": " << Device.Properties.deviceType
               << ",\n  \"eight_guarded_ssbos\": true,\n  \"push_constant_bytes\": 128,\n  \"density_max_abs_error\": "
               << DensityError << ",\n  \"transmission_max_abs_error\": " << TransmissionError
               << ",\n  \"single_scattering_max_relative_error\": " << ScatteringRelativeError
               << ",\n  \"moon_map_max_abs_error\": " << LunarMapError
               << ",\n  \"moon_surface_max_abs_error\": " << LunarSurfaceError
               << ",\n  \"solar_profile_max_abs_error\": " << SolarProfileError
               << ",\n  \"six_flare_max_abs_error\": " << LensError
               << ",\n  \"galactic_rotation_max_vector_error\": " << GalacticError
               << ",\n  \"corona_density_max_relative_error\": " << CoronaRelativeError
               << ",\n  \"reference_bulge_max_abs_error\": " << ReferenceBulgeError
               << ",\n  \"reference_nebula_max_abs_error\": " << ReferenceNebulaError
               << ",\n  \"reference_psf_max_abs_error\": " << ReferencePsfError
               << ",\n  \"production_accepted\": false,\n  \"executed_entries\": [";
        for (unsigned Index = 0; Index < Entries.size(); ++Index)
            Output << (Index ? "," : "") << '"' << Entries[Index] << '"';
        Output << "],\n  \"spirv_fnv1a64\": {";
        unsigned Index = 0;
        for (const auto& Pair : Compute.ShaderDigests)
            Output << (Index++ ? "," : "") << '"' << Pair.first << "\":\"" << Pair.second << '"';
        Output << "},\n  \"captures\": [\n";
        for (Index = 0; Index < Captures.size(); ++Index)
            Output << (Index ? ",\n" : "") << "    " << Captures[Index];
        Output << "\n  ],\n  \"diagnostics\": [\n";
        for (Index = 0; Index < Diagnostics.size(); ++Index)
            Output << (Index ? ",\n" : "") << "    " << Diagnostics[Index];
        Output << "\n  ]\n}\n";
        Enforce(bool(Output), "Cannot retain celestial Vulkan verification report");
        std::cout << "Celestial GPU verification completed: " << Assertions << " assertions, " << Captures.size()
                  << " captures\n";
    }
};

} // namespace

int main(int Count, char** Arguments)
{
    try
    {
        Enforce(
            Count == 7,
            "Usage: CelestialVulkan <shaders> <prepared-inputs> <Hipparcos.csv> <output> <driver> <validate|render>");
        CelestialScene Scene;
        Scene.LoadCatalogue(Arguments[3]);
        Scene.LoadAuthoredCatalogue(std::filesystem::path(Arguments[2]) / "ReferenceStars.csv");
        CelestialExecution Execution(Arguments[5], Arguments[1], Arguments[2], Arguments[4]);
        Execution.Bake(Scene);
        Execution.VerifyPhysics(Scene);
        Execution.VerifyRequestedReference(Scene);
        Execution.VerifyRenderControls(Scene);
        if (std::string(Arguments[6]) == "render")
            Execution.RetainCaptures(Scene, Arguments[3]);
        else
        {
            Execution.Configure(Scene);
            Execution.Resolve();
            Execution.Dispatch("RenderLunarSurface", Pixels);
            Execution.Dispatch("RenderSolarAtmosphere", Pixels);
            Execution.Dispatch("RenderLensFlare", Pixels);
        }
        Execution.Report();
    }
    catch (const std::exception& Failure)
    {
        std::cerr << "Celestial Vulkan failure: " << Failure.what() << '\n';
        return 1;
    }
}
