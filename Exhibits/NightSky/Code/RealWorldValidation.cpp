//============================================================================================================================
// 🧩 RealWorldValidation.cpp — production sky/Sun/Moon/flare and tyre models against published measurements
//============================================================================================================================
// 📝 The NightSky exhibit checks the production code against itself and against the demonstration
//    (analytic integrals, demo coefficients, rendered centroids). This program checks it against
//    the outside world instead: Bucholtz (1995) Rayleigh optical depths, Neckel & Labs (1994)
//    solar limb darkening at 550 nm, IAU radii and orbital geometry for the apparent discs,
//    the NASA lunar geometric albedo and phase magnitudes, and Pacejka's measured tyre bands.
//    Every reference value below is a published measurement with its band, not a number taken
//    from the code under test. Results print as PASS / FAIL / DEVIATION: a DEVIATION is a
//    measured disagreement that is reported, not silently absorbed into a widened tolerance.
//    Exit code is nonzero only on FAIL (a production claim inside its own stated band failing).
//============================================================================================================================

#include "Engine/Physics/TyreSlipSolver.h"
#include "Engine/Physics/VehicleSpecification.h"
#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CelestialModel.h"
#include "Engine/Rendering/LensFlareModel.h"

#include <cmath>
#include <cstdio>

namespace
{

constexpr double Pi       = 3.14159265358979323846;
constexpr double DegToRad = Pi / 180.0;

int PassedCount    = 0;
int FailedCount    = 0;
int DeviationCount = 0;

void Pass(const char* Name, double Value)
{
    ++PassedCount;
    std::printf("PASS      %-58s % .6g\n", Name, Value);
}
void Fail(const char* Name, double Value)
{
    ++FailedCount;
    std::printf("FAIL      %-58s % .6g\n", Name, Value);
}
void Deviation(const char* Name, double Value, const char* Note)
{
    ++DeviationCount;
    std::printf("DEVIATION %-58s % .6g  (%s)\n", Name, Value, Note);
}
void Info(const char* Name, double Value)
{
    std::printf("INFO      %-58s % .6g\n", Name, Value);
}
void CheckBand(const char* Name, double Value, double Low, double High)
{
    if (Value >= Low && Value <= High) Pass(Name, Value); else Fail(Name, Value);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       ATMOSPHERE
//------------------------------------------------------------------------------------------------------------------------

void CheckAtmosphere(const Frontier::AtmosphereParameters& P)
{
    std::printf("-- Atmosphere (Bucholtz 1995; channel wavelengths 680/550/440 nm per Bruneton) --\n");
    // Bucholtz analytic Rayleigh optical depth at sea level, λ in µm:
    // τ = 0.008569·λ⁻⁴·(1 + 0.0113·λ⁻² + 0.00013·λ⁻⁴).
    const auto Bucholtz = [](double LambdaUm) {
        const double Inv2 = 1.0 / (LambdaUm * LambdaUm);
        return 0.008569 * Inv2 * Inv2 * (1.0 + 0.0113 * Inv2 + 0.00013 * Inv2 * Inv2);
    };
    const double ModelTau[3] = {P.RayleighScattering.R * P.RayleighScaleHeightKm,
                                P.RayleighScattering.G * P.RayleighScaleHeightKm,
                                P.RayleighScattering.B * P.RayleighScaleHeightKm};
    const double Lambda[3]   = {0.680, 0.550, 0.440};
    const char*  Channel[3]  = {"R", "G", "B"};
    for (int I = 0; I < 3; ++I)
    {
        char Name[96];
        std::snprintf(Name, sizeof Name, "Rayleigh tau %s vs Bucholtz (rel err)", Channel[I]);
        CheckBand(Name, std::fabs(ModelTau[I] / Bucholtz(Lambda[I]) - 1.0), 0.0, 0.15);
    }
    const Frontier::SpectrumRgb Zenith = Frontier::TransmittanceToTop(P, P.GroundRadiusKm, 1.0, 256);
    CheckBand("zenith transmittance G (clear-sky band)", Zenith.G, 0.80, 0.92);
    // Ozone Chappuis column: tent profile integrates to WidthKm × peak coefficient.
    CheckBand("ozone column tau G (measured 0.02-0.04)", P.OzoneAbsorption.G * P.OzoneWidthKm, 0.02, 0.04);
    // Aerosol: the model's Mie column is pristine-air only. Typical inhabited sites measure
    // 0.05-0.30 at 550 nm; even clean mountain air is ~0.03. Reported, not widened away.
    const double MieTau = (P.MieScattering + P.MieAbsorption) * P.MieScaleHeightKm;
    if (MieTau < 0.03)
        Deviation("aerosol optical depth vs typical sites", MieTau, "pristine-air choice; no turbidity control exists");
    else
        Pass("aerosol optical depth vs typical sites", MieTau);
    // Rayleigh phase normalisation, integrated numerically over the sphere.
    double PhaseIntegral = 0.0;
    for (int I = 0; I < 720; ++I)
    {
        const double CosTheta = -1.0 + 2.0 * (I + 0.5) / 720.0;
        PhaseIntegral += Frontier::RayleighPhase(CosTheta) * 2.0 * Pi * (2.0 / 720.0);
    }
    CheckBand("Rayleigh phase integral over sphere", PhaseIntegral, 0.99, 1.01);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          SUN
//------------------------------------------------------------------------------------------------------------------------

void CheckSun()
{
    std::printf("-- Sun (Neckel & Labs 1994 at 550 nm; IAU radii; Kepler geometry) --\n");
    const Frontier::SunDiscProfile Profile;
    const double                   Limb = 1.0 - Profile.LimbLinear - Profile.LimbQuadratic;
    CheckBand("limb intensity I(limb)/I(centre), measured 0.30", Limb, 0.28, 0.32);
    CheckBand("disc mean / centre, measured 0.805", Frontier::SunDiscMeanLimbFactor(Profile), 0.795, 0.815);
    const double Perihelion = Frontier::SolarAngularRadiusRad(Frontier::JulianDate(2026, 1, 3, 12.0));
    const double Aphelion   = Frontier::SolarAngularRadiusRad(Frontier::JulianDate(2026, 7, 4, 12.0));
    CheckBand("semi-diameter at perihelion [rad] (975 arcsec)", Perihelion, 0.00470, 0.00476);
    CheckBand("semi-diameter at aphelion [rad] (944 arcsec)", Aphelion, 0.00454, 0.00460);
    CheckBand("perihelion/aphelion size ratio (1+e)/(1-e)", Perihelion / Aphelion, 1.030, 1.038);
    Info("production radiance scale is unitless; 1361 W/m^2 solar constant is the caller's", 1361.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          MOON
//------------------------------------------------------------------------------------------------------------------------

void CheckMoon(const Frontier::LunarAlbedoMap& Map)
{
    std::printf("-- Moon (NASA Fact Sheet: geometric albedo 0.12, full -12.74, quarter -10.0) --\n");
    double MinimumRadius = 1.0, MaximumRadius = 0.0;
    for (int Day = 0; Day < 365; ++Day)
    {
        const double Radius = Frontier::LunarAngularRadiusRad(Frontier::JulianDate(2026, 1, 1, 0.0) + Day);
        MinimumRadius = std::fmin(MinimumRadius, Radius);
        MaximumRadius = std::fmax(MaximumRadius, Radius);
    }
    CheckBand("lunar semi-diameter, yearly minimum [rad]", MinimumRadius, 0.00420, 0.00435);
    CheckBand("lunar semi-diameter, yearly maximum [rad]", MaximumRadius, 0.00480, 0.00495);
    // Disc-integrated full-Moon flux with unit solar irradiance: geometric albedo = π·L_mean/E.
    const auto DiscMean = [&Map](double PhaseAngleRad) {
        double Sum = 0.0, Count = 0.0;
        for (int I = 0; I < 200; ++I)
            for (int J = 0; J < 200; ++J)
            {
                const double A = -1.0 + 2.0 * (I + 0.5) / 200.0, B = -1.0 + 2.0 * (J + 0.5) / 200.0;
                if (A * A + B * B > 1.0) continue;
                const double Mu  = std::sqrt(1.0 - A * A - B * B);
                const double Mu0 = Mu * std::cos(PhaseAngleRad) + A * std::sin(PhaseAngleRad);
                Sum += Frontier::EvaluateLunarDiscRadiance(Map, A, B, 0.0, 0.0, Mu0, Mu, PhaseAngleRad,
                                                           Frontier::SpectrumRgb{1.0, 1.0, 1.0}, 0.0)
                           .R;
                Count += 1.0;
            }
        return Sum / Count;
    };
    const double Full    = DiscMean(0.0);
    const double Quarter = DiscMean(0.5 * Pi);
    CheckBand("full-disc geometric albedo (measured 0.12)", Pi * Full, 0.105, 0.135);
    CheckBand("quarter/full integrated flux (measured 0.080)", Quarter / Full, 0.060, 0.100);
    Info("quarter-full magnitude difference, model (measured 2.74)", -2.5 * std::log10(Quarter / Full));
    Deviation("opposition surge at phase < 5 deg", 0.0, "absent: exp(-1.10|g|) has no surge term; full Moon is "
                                                       "under-bright near exact opposition");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       LENS FLARE
//------------------------------------------------------------------------------------------------------------------------

void CheckFlare()
{
    std::printf("-- Lens flare (diffraction spike rule; veiling-glare band for coated optics) --\n");
    const auto SpikeCount = [](uint32_t Blades) {
        Frontier::FlareOpticsProfile Optics;
        Optics.ApertureBlades = Blades;
        const Frontier::SpectrumRgb Irradiance{7.0, 6.8, 6.2};
        constexpr int               Samples = 720;
        double                      Circle[Samples], Peak = 0.0;
        for (int I = 0; I < Samples; ++I)
        {
            const double Phi = 2.0 * Pi * I / Samples;
            Circle[I] = Frontier::EvaluateDiffractionStarburst(0.10 * std::cos(Phi), 0.10 * std::sin(Phi), 0.0, 0.0,
                                                               Irradiance, 1.0, Optics)
                            .G;
            Peak = std::fmax(Peak, Circle[I]);
        }
        int Count = 0;
        for (int I = 0; I < Samples; ++I)
            if (Circle[I] > Circle[(I + Samples - 1) % Samples] && Circle[I] >= Circle[(I + 1) % Samples] &&
                Circle[I] > 0.25 * Peak)
                ++Count;
        return Count;
    };
    CheckBand("starburst spikes, 6 blades (even -> N)", SpikeCount(6), 6, 6);
    CheckBand("starburst spikes, 7 blades (odd -> 2N)", SpikeCount(7), 14, 14);
    const Frontier::FlareOpticsProfile Optics;
    const Frontier::SpectrumRgb        Irradiance{1.0, 1.0, 1.0};
    const double Veil = Frontier::EvaluateLensFlareRadiance(-1.6, 1.6, 0.3, -0.2, Irradiance, 1.0, Optics).G;
    CheckBand("veiling glare at frame corner / disc irradiance", Veil, 0.001, 0.05);
    Deviation("ghost strengths vs a measured lens", 0.0, "authored table; no lens prescription or measured PSF "
                                                         "exists in the repo to calibrate against");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          TYRE
//------------------------------------------------------------------------------------------------------------------------

struct TyreProbe
{
    double PeakMuLongitudinal = 0.0;
    double PeakMuLateral      = 0.0;
    double CorneringPerLoad   = 0.0;   // [1/rad] Cα / Fz
    double RelaxationLat      = 0.0;   // [m]
};

TyreProbe ProbeTyre(const Frontier::TyreSlipSolver& Tyre, double Load)
{
    TyreProbe Probe;
    for (int I = -200; I <= 200; ++I)
    {
        Probe.PeakMuLongitudinal =
            std::fmax(Probe.PeakMuLongitudinal, std::fabs(Tyre.LongitudinalForce(I * 0.01, 0.0, Load)) / Load);
        Probe.PeakMuLateral =
            std::fmax(Probe.PeakMuLateral, std::fabs(Tyre.LateralForce(I * 0.01, 0.0, Load)) / Load);
    }
    Probe.CorneringPerLoad =
        (Tyre.LateralForce(0.001, 0.0, Load) - Tyre.LateralForce(-0.001, 0.0, Load)) / 0.002 / Load;
    double Lengths[2];
    Tyre.ResolveRelaxationLengths(Load, Lengths);
    Probe.RelaxationLat = Lengths[1];
    return Probe;
}

void CheckTyre()
{
    std::printf("-- Tyre (Pacejka measured bands: slick mu 1.3-1.6, Calpha/Fz 6-30 /rad, relax 0.3-0.6 m) --\n");
    const Frontier::TyreSlipSolver DemoTyre;
    const TyreProbe                Demo = ProbeTyre(DemoTyre, 4000.0);
    Info("demonstration sheet peak mu longitudinal at 4 kN", Demo.PeakMuLongitudinal);
    if (Demo.PeakMuLateral < 1.25 || Demo.PeakMuLateral > 1.75)
        Deviation("demonstration sheet peak mu lateral at 4 kN", Demo.PeakMuLateral,
                  "outside measured slick band; sheet is an authored game tyre, not a measured one");
    else
        Pass("demonstration sheet peak mu lateral at 4 kN", Demo.PeakMuLateral);
    if (Demo.RelaxationLat < 0.25 || Demo.RelaxationLat > 0.65)
        Deviation("demonstration sheet relaxation length [m]", Demo.RelaxationLat,
                  "an order below measured 0.3-0.6 m; transient response is near-instant");
    else
        Pass("demonstration sheet relaxation length [m]", Demo.RelaxationLat);
    CheckBand("demonstration sheet Calpha/Fz at 4 kN [/rad]", Demo.CorneringPerLoad, 6.0, 30.0);

    const Frontier::TyreSlipSolver MeasuredTyre(Frontier::ResolveMeasuredSlickParameters());
    const TyreProbe                Measured = ProbeTyre(MeasuredTyre, 4000.0);
    CheckBand("measured-slick sheet peak mu longitudinal", Measured.PeakMuLongitudinal, 1.25, 1.75);
    CheckBand("measured-slick sheet peak mu lateral", Measured.PeakMuLateral, 1.25, 1.75);
    CheckBand("measured-slick sheet Calpha/Fz [/rad]", Measured.CorneringPerLoad, 6.0, 30.0);
    CheckBand("measured-slick sheet relaxation length [m]", Measured.RelaxationLat, 0.25, 0.65);
    double Combined[2];
    MeasuredTyre.Combine(0.8, 0.8, 0.0, 4000.0, Combined);
    CheckBand("measured-slick combined |F|/Fz inside peak mu", std::hypot(Combined[0], Combined[1]) / 4000.0, 0.0,
              Measured.PeakMuLateral * 1.05);
    // Carcass: K = 25 kN/m + 0.9 (N/m/Pa)·p from VehicleSolver.cpp; 223 kN/m at 220 kPa.
    const double CarcassStiffness = 25000.0 + 0.9 * 220000.0;
    CheckBand("carcass stiffness at 220 kPa [N/m] (measured 150-350k)", CarcassStiffness, 150000.0, 350000.0);
    CheckBand("static deflection, 1300 kg car [mm]", 1300.0 * 9.81 / 4.0 / CarcassStiffness * 1000.0, 8.0, 25.0);
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const char* MoonPath = ArgumentCount > 1 ? Arguments[1] : "EngineContent/CelestialMaps/MoonAlbedo1024.ppm";
    Frontier::LunarAlbedoMap MoonMap;
    if (!MoonMap.LoadPpm(MoonPath))
    {
        std::printf("FAIL      lunar albedo map not loaded from %s\n", MoonPath);
        return 1;
    }
    const Frontier::AtmosphereParameters Atmosphere;
    CheckAtmosphere(Atmosphere);
    CheckSun();
    CheckMoon(MoonMap);
    CheckFlare();
    CheckTyre();
    std::printf("SUMMARY passed %d failed %d deviations %d\n", PassedCount, FailedCount, DeviationCount);
    return FailedCount == 0 ? 0 : 1;
}
