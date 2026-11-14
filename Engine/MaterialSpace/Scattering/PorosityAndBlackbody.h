/*==========================================================================================================================================
                                                      POROSITYANDBLACKBODY.H
==========================================================================================================================================*/
// 🧩 Lobe 10: Angstrom/Lekner relative-IOR porous wetness darkening, water film Fresnel, & Planckian spectral blackbody radiance

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Constants/MathConstants.h"
#include "Engine/MaterialSpace/Scattering/MetallicFresnelTint.h"
#include "Engine/MaterialSpace/SurfaceMaterial.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace Frontier::MaterialSpace::Scattering
{

//------------------------------------------------------------------------------------------------------------------------
//                                         POROSITY WETNESS & PLANCKIAN RADIATION
//------------------------------------------------------------------------------------------------------------------------

inline constexpr float LiquidWaterRefractiveIndex = 1.333f; // [-] - Pure H2O refractive index at 589 nm

struct PorosityWetnessAdjustment
{
    Mathematics::LinearRGB DarkenedDiffuseAlbedo { 0.5f, 0.5f, 0.5f }; // [-]    - Internal-reflection darkened substrate albedo
    float                  ModifiedRelativeIOR   = 1.50f;              // [-]    - Substrate IOR divided by interstitial water 1.333
    float                  WaterFilmSpecularBrdf = 0.0f;               // [1/sr] - Top adsorbed liquid water film microfacet specular
    float                  SubstrateWindowScale  = 1.0f;               // [-]    - Two-way air->water->air Fresnel transmission
};

// 📝 Lekner & Dorf (1988)物理 optical darkening of wet porous solids:
// Interstitial water (n=1.333) replaces air (n=1.0), raising internal critical angle TIR inside pores & matching substrate F0!
[[nodiscard]] inline PorosityWetnessAdjustment EvaluatePorosityWetness(
    Mathematics::Axis3D    LocalWo,
    Mathematics::Axis3D    LocalWi,
    Mathematics::LinearRGB DryDiffuseAlbedo,
    float                  DrySubstrateIOR,
    float                  PorosityFraction,
    float                  SurfaceWetnessFraction) noexcept
{
    PorosityWetnessAdjustment Out {};
    Out.DarkenedDiffuseAlbedo = DryDiffuseAlbedo;
    Out.ModifiedRelativeIOR   = DrySubstrateIOR;

    const float Saturation = std::clamp(PorosityFraction, 0.0f, 1.0f) * std::clamp(SurfaceWetnessFraction, 0.0f, 1.0f);
    if (Saturation <= 1.0e-5f)
    {
        return Out;
    }

    // Internal diffuse reflection coefficient of water->air interface (~0.478 for n=1.333) traps scattered photons for multiple absorptions:
    // A_wet = A_dry * (1 - r_int) / (1 - r_int * A_dry)  (Angstrom-Lekner nonlinear darkening: darkens midtones strongly, preserves 0 & 1!)
    constexpr float InternalWaterRefl = 0.478f;
    const auto DarkenChannel = [&](float DryA) noexcept -> float
    {
        const float Clamped = std::clamp(DryA, 0.0f, 1.0f);
        const float WetA    = (Clamped * (1.0f - InternalWaterRefl)) / std::max(1.0e-4f, 1.0f - InternalWaterRefl * Clamped);
        return Clamped * (1.0f - Saturation) + WetA * Saturation;
    };

    Out.DarkenedDiffuseAlbedo = {
        DarkenChannel(DryDiffuseAlbedo.R),
        DarkenChannel(DryDiffuseAlbedo.G),
        DarkenChannel(DryDiffuseAlbedo.B),
    };

    const float MatchedIor  = std::max(1.005f, DrySubstrateIOR / LiquidWaterRefractiveIndex);
    Out.ModifiedRelativeIOR = DrySubstrateIOR * (1.0f - Saturation) + MatchedIor * Saturation;

    // Adsorbed surface water film (smooth alpha ~= 0.045 when fully wet)
    const float FilmCoverage = std::clamp(SurfaceWetnessFraction * SurfaceWetnessFraction, 0.0f, 1.0f) *
                               (0.35f + 0.65f * PorosityFraction);
    if (FilmCoverage > 1.0e-5f && LocalWo.Z > 1.0e-6f && LocalWi.Z > 1.0e-6f)
    {
        const Mathematics::Axis3D HalfVec = Mathematics::NormalizeAxis(LocalWo + LocalWi, { 0.0f, 0.0f, 1.0f });
        const float VoDotH = std::clamp(Mathematics::EvaluateDot(LocalWo, HalfVec), 0.0f, 1.0f);
        const float FWater = EvaluateExactDielectricFresnel(VoDotH, LiquidWaterRefractiveIndex);
        const AnisotropicAlphaPair FilmAlpha { 0.045f, 0.045f };
        const float NdfD = EvaluateAnisotropicGgxNdf(HalfVec, FilmAlpha);
        const float G2   = EvaluateHeightCorrelatedSmithG2(LocalWo, LocalWi, FilmAlpha);
        Out.WaterFilmSpecularBrdf = FilmCoverage * (FWater * NdfD * G2) / std::max(1.0e-6f, 4.0f * LocalWo.Z * LocalWi.Z);

        const float Fo = EvaluateExactDielectricFresnel(LocalWo.Z, LiquidWaterRefractiveIndex);
        const float Fi = EvaluateExactDielectricFresnel(LocalWi.Z, LiquidWaterRefractiveIndex);
        Out.SubstrateWindowScale = (1.0f - FilmCoverage * Fo) * (1.0f - FilmCoverage * Fi);
    }

    return Out;
}

// 📝 Exact Planckian spectral blackbody radiator B_lambda(T) integrated into Linear Rec.709 radiance [cd/m^2 normalized]
[[nodiscard]] inline Mathematics::LinearRGB EvaluatePlanckianBlackbodyRadiance(
    const PorosityAndEmissionParameters& Params) noexcept
{
    Mathematics::LinearRGB TotalRadiance { 0.0f, 0.0f, 0.0f };

    if (Params.BlackbodyTemperatureKelvin >= 500.0f)
    {
        const float TempK = std::clamp(Params.BlackbodyTemperatureKelvin, 500.0f, 20000.0f);
        // Second radiation constant c2 = h*c / k_B = 1.438776877e7 nm*K
        constexpr double PlanckC2NmK = 1.438776877e7;

        const auto EvalBand = [&](double WavelengthNm) noexcept -> float
        {
            const double LambdaMicron = WavelengthNm * 1.0e-3;
            const double Exponent     = std::min(80.0, PlanckC2NmK / (WavelengthNm * static_cast<double>(TempK)));
            const double Denom        = std::expm1(Exponent);
            const double SpectralB    = 1.0 / (std::pow(LambdaMicron, 5.0) * std::max(1.0e-12, Denom));
            // Normalize relative to 2856 K Illuminant A green band (555 nm) so 1350 K glowing steel yields rich physical orange-red
            constexpr double Ref2856At555 = 1.0 / (0.05277319 * 107.618); // ~0.176
            return static_cast<float>(SpectralB / (Ref2856At555 * 18.0));
        };

        const float B630 = EvalBand(630.0);
        const float B535 = EvalBand(535.0);
        const float B460 = EvalBand(460.0);

        const float PhotopicLum = std::max(1.0e-7f, 0.2126f * B630 + 0.7152f * B535 + 0.0722f * B460);
        const float LumScale    = (Params.EmissionLuminanceNits > 0.0f) ? (Params.EmissionLuminanceNits * 0.00028f) : 0.26f;

        TotalRadiance.R = (B630 / PhotopicLum) * LumScale * Params.EmissionTint.R;
        TotalRadiance.G = (B535 / PhotopicLum) * LumScale * Params.EmissionTint.G;
        TotalRadiance.B = (B460 / PhotopicLum) * LumScale * Params.EmissionTint.B;
    }
    else if (Params.EmissionLuminanceNits > 0.0f)
    {
        const float ScaledNits = Params.EmissionLuminanceNits * 0.002f;
        TotalRadiance.R = ScaledNits * Params.EmissionTint.R;
        TotalRadiance.G = ScaledNits * Params.EmissionTint.G;
        TotalRadiance.B = ScaledNits * Params.EmissionTint.B;
    }

    return TotalRadiance;
}

} // namespace Frontier::MaterialSpace::Scattering
