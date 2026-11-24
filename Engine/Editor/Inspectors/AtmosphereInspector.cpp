/*============================================================================================================================================
                                                          ATMOSPHEREINSPECTOR.CPP
============================================================================================================================================*/
// 🧩 Implementation of standalone AtmosphereInspector (Overview limb, Scattering, Density, Sky colour, View, Baking Transmittance & Sky-View LUTs)

#include "Engine/Editor/Inspectors/AtmosphereInspector.h"

#include "Engine/Editor/Inspectors/AtmosphereLimbRaster.h"

#include "Engine/Components/Panes/WorkspaceAppearance.h"
#include "Engine/GeometricRaster/Atmosphere/AtmosphericSkySequence.h"
#include "Engine/GeometricRaster/Atmosphere/CelestialEphemerisSolver.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>

namespace Frontier
{

namespace
{
constexpr float PiF = 3.14159265359f;

inline uint8_t ToneSrgb8(float Hdr) noexcept
{
    const float M = std::clamp(Hdr / (1.0f + std::max(0.0f, Hdr)), 0.0f, 1.0f);
    const float S = (M <= 0.0031308f) ? (M * 12.92f) : (1.055f * std::pow(M, 1.0f / 2.4f) - 0.055f);
    return static_cast<uint8_t>(std::clamp(std::lround(S * 255.0f), 0l, 255l));
}

inline uint8_t LinearSrgb8(float Linear) noexcept
{
    const float C = std::clamp(Linear, 0.0f, 1.0f);
    const float S = (C <= 0.0031308f) ? (C * 12.92f) : (1.055f * std::pow(C, 1.0f / 2.4f) - 0.055f);
    return static_cast<uint8_t>(std::clamp(std::lround(S * 255.0f), 0l, 255l));
}

inline void PutPixel(std::vector<uint8_t>& Buf, uint32_t W, uint32_t X, uint32_t Y, uint8_t R, uint8_t G, uint8_t B) noexcept
{
    const std::size_t Off = (static_cast<std::size_t>(Y) * W + X) * 4u;
    Buf[Off + 0u] = R; Buf[Off + 1u] = G; Buf[Off + 2u] = B; Buf[Off + 3u] = 255u;
}
} // namespace

void AtmosphereInspector::UpdateLimbSurface(
    const GeometricRaster::AtmosphericMediumConfiguration& Medium, float SunAtLimbDeg, uint32_t WidthPx, uint32_t HeightPx)
{
    const LimbSkyMedium Sky = AtmosphereLimbRaster::ResolveMedium(Medium);
    uint64_t Sig = 0xA7001001ull;
    for (const float Reading : { Sky.Planet, Sky.Top, Sky.Rayleigh[0], Sky.RayleighHeight, Sky.Mie, Sky.MieHeight, Sky.Lean, Sky.Ozone[0],
                                 Sky.Tint[0], Sky.Tint[1], Sky.Tint[2], Sky.Gain, Sky.Ground[0], Sky.Ground[1], Sky.Ground[2], SunAtLimbDeg })
    {
        Sig = InspectorPrimitives::MixRevisionFloat(Sig, Reading);
    }
    LimbPreview.EnsureUpdated(Sig, WidthPx, HeightPx, [&](std::vector<uint8_t>& Pixels)
    {
        AtmosphereLimbRaster::RasterizeLimb(Sky, SunAtLimbDeg, WidthPx, HeightPx, Pixels);
    });
}

void AtmosphereInspector::UpdateSunTrackSurface(uint32_t WidthPx)
{
    // linear-gradient(90deg, #1b1f3a, #e58a52 23%, #9cc6ff 50%, #e9eef8), height 4, border-radius 2
    SunTrack.EnsureUpdated(0x5A7001ull, WidthPx, 4u, [&](std::vector<uint8_t>& Pixels)
    {
        constexpr std::array<std::array<float, 4>, 4u> Stops = {{
            { 0.00f, 27.0f, 31.0f, 58.0f }, { 0.23f, 229.0f, 138.0f, 82.0f }, { 0.50f, 156.0f, 198.0f, 255.0f }, { 1.00f, 233.0f, 238.0f, 248.0f },
        }};
        const float W = static_cast<float>(WidthPx);
        for (uint32_t Y = 0u; Y < 4u; ++Y)
        {
            for (uint32_t X = 0u; X < WidthPx; ++X)
            {
                const float T = (static_cast<float>(X) + 0.5f) / W;
                std::size_t Upper = 1u;
                while (Upper + 1u < Stops.size() && T > Stops[Upper][0]) ++Upper;
                const auto& L = Stops[Upper - 1u];
                const auto& H = Stops[Upper];
                const float F = std::clamp((T - L[0]) / (H[0] - L[0]), 0.0f, 1.0f);
                int Hits = 0; // 4x4 rounded-corner alpha (radius 2)
                for (int Sy = 0; Sy < 4; ++Sy)
                {
                    for (int Sx = 0; Sx < 4; ++Sx)
                    {
                        const float Px = static_cast<float>(X) + (static_cast<float>(Sx) + 0.5f) * 0.25f;
                        const float Py = static_cast<float>(Y) + (static_cast<float>(Sy) + 0.5f) * 0.25f;
                        const float Dx = std::max(std::fabs(Px - W * 0.5f) - (W * 0.5f - 2.0f), 0.0f);
                        const float Dy = std::max(std::fabs(Py - 2.0f), 0.0f);
                        Hits += (Dx * Dx + Dy * Dy <= 4.0f) ? 1 : 0;
                    }
                }
                const std::size_t Off = (static_cast<std::size_t>(Y) * WidthPx + X) * 4u;
                Pixels[Off + 0u] = static_cast<uint8_t>(std::lround(L[1] + (H[1] - L[1]) * F));
                Pixels[Off + 1u] = static_cast<uint8_t>(std::lround(L[2] + (H[2] - L[2]) * F));
                Pixels[Off + 2u] = static_cast<uint8_t>(std::lround(L[3] + (H[3] - L[3]) * F));
                Pixels[Off + 3u] = static_cast<uint8_t>(std::lround(255.0f * static_cast<float>(Hits) / 16.0f));
            }
        }
    });
}

void AtmosphereInspector::UpdateTransmittanceSurface(const GeometricRaster::AtmosphericMediumConfiguration& Medium)
{
    uint64_t Sig = 0x7A002002ull;
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.RayleighStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.MieStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.OzoneStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.RayleighScaleHeightMeters);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.MieScaleHeightMeters);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.AtmosphereThicknessMeters);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.PlanetRadiusMeters);

    const uint32_t W = 256u, H = 64u;
    TransmittanceLut.EnsureUpdated(Sig, W, H, [&](std::vector<uint8_t>& Pixels)
    {
        for (uint32_t Y = 0u; Y < H; ++Y)
        {
            const float V   = 1.0f - (static_cast<float>(Y) + 0.5f) / static_cast<float>(H);
            const float Alt = 2.0f + (Medium.AtmosphereThicknessMeters - 2.0f) * (V * V);
            for (uint32_t X = 0u; X < W; ++X)
            {
                const float U       = (static_cast<float>(X) + 0.5f) / static_cast<float>(W);
                const float ElevRad = (-6.0f + U * 96.0f) * (PiF / 180.0f);
                const Mathematics::Axis3D Dir { std::cos(ElevRad), 0.0f, std::sin(ElevRad) };
                const auto T = GeometricRaster::AtmosphericSkySequence::ComputeSolarTransmittance(Dir, Medium, Alt);
                PutPixel(Pixels, W, X, Y, LinearSrgb8(T.R), LinearSrgb8(T.G), LinearSrgb8(T.B));
            }
        }
    });
}

void AtmosphereInspector::UpdateSkyViewSurface(
    const GeometricRaster::AtmosphericMediumConfiguration& Medium,
    const GeometricRaster::SolarCelestialConfiguration&    Solar)
{
    const auto Ephem = GeometricRaster::CelestialEphemerisSolver::SolveSolarEphemeris(Solar);
    uint64_t Sig = 0x5B003003ull;
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.RayleighStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.MieStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.OzoneStrength);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Medium.SkyBrightnessMultiplier);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Ephem.AzimuthDegrees);
    Sig = InspectorPrimitives::MixRevisionFloat(Sig, Ephem.ElevationDegrees);

    const uint32_t W = 192u, H = 96u;
    SkyViewLut.EnsureUpdated(Sig, W, H, [&](std::vector<uint8_t>& Pixels)
    {
        const float SunAz = Ephem.AzimuthDegrees * (PiF / 180.0f);
        const float SunEl = Ephem.ElevationDegrees * (PiF / 180.0f);
        const float SX = std::cos(SunEl) * std::sin(SunAz);
        const float SY = std::cos(SunEl) * std::cos(SunAz);
        const float SZ = std::sin(SunEl);
        const float DayVis  = std::clamp((SunEl + 0.14f) / 0.34f, 0.0f, 1.0f);
        const float SunsetW = std::exp(-std::pow((SunEl - 0.06f) * 4.5f, 2.0f));
        const float G       = std::clamp(Medium.MieAnisotropy, 0.0f, 0.96f);

        for (uint32_t Y = 0u; Y < H; ++Y)
        {
            const float El = (0.5f - (static_cast<float>(Y) + 0.5f) / static_cast<float>(H)) * PiF;
            for (uint32_t X = 0u; X < W; ++X)
            {
                const float Az   = ((static_cast<float>(X) + 0.5f) / static_cast<float>(W)) * 2.0f * PiF;
                const float CosA = std::clamp(std::cos(El) * std::sin(Az) * SX + std::cos(El) * std::cos(Az) * SY + std::sin(El) * SZ, -1.0f, 1.0f);
                float R = 0.0f, Gc = 0.0f, B = 0.0f;
                if (El >= 0.0f)
                {
                    const float SinEl = std::sin(El);
                    const float Air   = 1.0f / std::max(0.035f, SinEl + 0.06f);
                    const float PhRay = 0.75f * (1.0f + CosA * CosA);
                    const float PhMie = (1.0f - G * G) / std::max(0.06f, 4.0f * PiF * std::pow(1.0f + G * G - 2.0f * G * CosA, 1.5f));
                    const float Br    = Medium.SkyBrightnessMultiplier * (0.04f + 0.96f * DayVis);
                    R  = (((1.0f - std::exp(-0.065f * Air * Medium.RayleighStrength)) * 0.42f + SunsetW * (1.0f - SinEl) * 0.78f) * Medium.RayleighStrength * 0.42f * PhRay + Medium.MieStrength * 0.20f * PhMie * std::min(6.0f, Air * 0.45f) * Ephem.EffectiveSolarTint.R) * Br * Medium.SkyTint.R;
                    Gc = (((1.0f - std::exp(-0.145f * Air * Medium.RayleighStrength)) * 0.72f * std::exp(-0.06f * Air * Medium.OzoneStrength) + SunsetW * (1.0f - SinEl) * 0.36f) * Medium.RayleighStrength * 0.42f * PhRay + Medium.MieStrength * 0.20f * PhMie * std::min(6.0f, Air * 0.45f) * Ephem.EffectiveSolarTint.G) * Br * Medium.SkyTint.G;
                    B  = (((1.0f - std::exp(-0.310f * Air * Medium.RayleighStrength)) * 1.48f) * Medium.RayleighStrength * 0.42f * PhRay + Medium.MieStrength * 0.20f * PhMie * std::min(6.0f, Air * 0.45f) * Ephem.EffectiveSolarTint.B) * Br * Medium.SkyTint.B;
                    if (CosA > 0.9965f)
                    {
                        const float Disc = std::pow((CosA - 0.9965f) / 0.0035f, 1.5f) * 8.0f;
                        R += Disc * Ephem.EffectiveSolarTint.R; Gc += Disc * Ephem.EffectiveSolarTint.G; B += Disc * Ephem.EffectiveSolarTint.B;
                    }
                }
                else
                {
                    const float GF = std::exp(El * 5.0f) * 0.25f;
                    R = Medium.GroundAlbedo.R * GF; Gc = Medium.GroundAlbedo.G * GF; B = Medium.GroundAlbedo.B * GF;
                }
                PutPixel(Pixels, W, X, Y, ToneSrgb8(R), ToneSrgb8(Gc), ToneSrgb8(B));
            }
        }
    });
}

float AtmosphereInspector::Construct(
    PixelSpace&                                         Surface,
    float                                               LeftX,
    float                                               TopY,
    float                                               InnerWidth,
    OutlinerRecordEntry&                                Entry,
    AtmosphereInstanceData&                             Instance,
    const GeometricRaster::SolarCelestialConfiguration& ActiveSolar,
    const PaneInputReading&                             Input,
    bool&                                               OutMutated,
    bool&                                               OutPageSwitched)
{
    static constexpr std::array<const char*, 6u> Pages = {{
        "Overview", "Scattering", "Density", "Sky colour", "View", "Baking",
    }};
    float CursorY = InspectorPrimitives::ConstructPageStrip(Surface, LeftX, TopY, InnerWidth, Pages, ActivePage, Input, OutPageSwitched);

    auto& Medium = Instance.Medium;
    const float PadX  = InspectorMetrics::SectionPadX;
    const float BodyW = InnerWidth - PadX * 2.0f;

    if (ActivePage == 0u)
    {
        // ---- AtmosphereCards.jsx AtmosphereCard (measured: HtmlGeometry/Atmosphere-01-Overview.json) ----------------------
        const float       ContentX  = LeftX + PadX + 1.0f;
        const float       ContentW  = InnerWidth - (PadX + 1.0f) * 2.0f;
        const float       LimbH     = ContentW / 1.15f;                 // .atmosphere-limb aspect-ratio 1.15
        const float       SunRowH   = 13.0f;                            // 10px "normal" line of .atmosphere-card-sun
        const float       SectionH  = 24.0f + 16.0f + 12.0f + LimbH + 12.0f + SunRowH + 23.0f;
        const Rectangle2D Section { LeftX, CursorY, InnerWidth, SectionH };
        InspectorPrimitives::ConstructSectionSurface(Surface, Section, "Atmosphere overview");

        const Rectangle2D LimbRect { ContentX, CursorY + 52.0f, ContentW, LimbH };
        const uint32_t    LimbW = static_cast<uint32_t>(std::lround(ContentW));
        const uint32_t    LimbHpx = static_cast<uint32_t>(LimbH); // ResizeObserver rounds the content box (193.03 -> 193)
        const LimbSkyMedium SkyMedium = AtmosphereLimbRaster::ResolveMedium(Medium);
        UpdateLimbSurface(Medium, Instance.SunAtLimbDeg, LimbW, LimbHpx);
        Surface.FillRectangle(LimbRect, ColorRgba{ 2u, 2u, 3u, 255u }, 14.0f);
        LimbPreview.Present(Surface, LimbRect, 14.0f);

        // SVG overlay (viewBox = canvas size): dashed top outline, handle, "60 km" readout
        const LimbViewSetup View    = AtmosphereLimbRaster::ResolveView(SkyMedium, static_cast<float>(LimbW) / static_cast<float>(LimbHpx));
        const auto          Outline = AtmosphereLimbRaster::ResolveTopOutline(View, SkyMedium.Top);
        const auto          ToLimb  = [&](const std::array<float, 2>& At) { return Point2D{ LimbRect.X + At[0] * static_cast<float>(LimbW), LimbRect.Y + At[1] * static_cast<float>(LimbHpx) }; };
        Surface.PushClip(LimbRect);
        {
            float Phase = 0.0f; // stroke-dasharray: 3 4
            for (std::size_t Index = 0u; Index + 1u < Outline.size(); ++Index)
            {
                const Point2D From = ToLimb(Outline[Index]), To = ToLimb(Outline[Index + 1u]);
                const float   Span = std::hypot(To.X - From.X, To.Y - From.Y);
                float         At   = 0.0f;
                while (At < Span)
                {
                    const float Cycle = std::fmod(Phase, 7.0f);
                    const float Run   = std::min(Span - At, Cycle < 3.0f ? 3.0f - Cycle : 7.0f - Cycle);
                    if (Cycle < 3.0f)
                    {
                        const float T0 = At / Span, T1 = (At + Run) / Span;
                        Surface.StrokeLine({ From.X + (To.X - From.X) * T0, From.Y + (To.Y - From.Y) * T0 },
                                           { From.X + (To.X - From.X) * T1, From.Y + (To.Y - From.Y) * T1 }, ColorRgba{ 255u, 255u, 255u, 97u }, 1.0f);
                    }
                    At += Run;
                    Phase += Run;
                }
            }
        }
        std::array<float, 2> Middle { 0.5f, 0.3f };
        for (const auto& Point : Outline)
        {
            if (std::fabs(Point[0] - 0.5f) < std::fabs(Middle[0] - 0.5f) || &Point == &Outline.front()) Middle = Point;
        }
        const Point2D Handle = ToLimb({ std::round(Middle[0] * static_cast<float>(LimbW) * 10.0f) / (10.0f * static_cast<float>(LimbW)),
                                        std::round(Middle[1] * static_cast<float>(LimbHpx) * 10.0f) / (10.0f * static_cast<float>(LimbHpx)) });
        Surface.FillCircle(Handle, 4.5f + 0.75f, ColorRgba{ 10u, 10u, 12u, 255u });   // stroke #0a0a0c 1.5 (centred on r 4.5)
        Surface.FillCircle(Handle, 4.5f - 0.75f, ColorRgba{ 245u, 247u, 255u, 255u }); // fill #f5f7ff
        char KmBuf[24]{};
        std::snprintf(KmBuf, sizeof(KmBuf), "%ld km", std::lround(Medium.AtmosphereThicknessMeters / 1000.0f));
        const float   KmW      = InspectorPrimitives::MeasureCssText(Surface, FontWeightClass::Regular, 9.0f, KmBuf);
        const Point2D KmCorner { Handle.X - KmW * 0.5f, Handle.Y - 10.0f - 9.0f * 0.992f }; // text-anchor middle, baseline y = -10
        for (int Ring = 0; Ring < 8; ++Ring)                                                 // paint-order stroke #000000a0 3px
        {
            const float A = static_cast<float>(Ring) * 0.78539816f;
            InspectorPrimitives::ConstructCssText(Surface, FontWeightClass::Regular, { KmCorner.X + std::cos(A) * 1.5f, KmCorner.Y + std::sin(A) * 1.5f }, 9.0f, 0.0f, ColorRgba{ 0u, 0u, 0u, 46u }, KmBuf);
        }
        InspectorPrimitives::ConstructCssText(Surface, FontWeightClass::Regular, KmCorner, 9.0f, 0.0f, ColorRgba{ 242u, 244u, 250u, 255u }, KmBuf);
        Surface.PopClip();

        // label.atmosphere-card-sun: span (10px #9a9a9a) | range (flex 1, gap 8) | b (min-width 38, right, #e8e8e8)
        const float SunRowY  = LimbRect.Bottom() + 12.0f;
        const float LabelW   = std::round(InspectorPrimitives::MeasureCssText(Surface, FontWeightClass::Regular, 10.0f, "Sun at the limb"));
        InspectorPrimitives::ConstructCssText(Surface, FontWeightClass::Regular, { ContentX, SunRowY }, 10.0f, 0.0f, ColorRgba{ 154u, 154u, 154u, 255u }, "Sun at the limb");
        char DegBuf[20]{};
        std::snprintf(DegBuf, sizeof(DegBuf), "%.1f\xC2\xB0", Instance.SunAtLimbDeg);
        const float DegW = InspectorPrimitives::MeasureCssText(Surface, FontWeightClass::Regular, 10.0f, DegBuf);
        InspectorPrimitives::ConstructCssText(Surface, FontWeightClass::Regular, { ContentX + ContentW - DegW, SunRowY }, 10.0f, 0.0f, ColorRgba{ 232u, 232u, 232u, 255u }, DegBuf);

        const Rectangle2D Track { ContentX + LabelW + 8.0f, SunRowY + SunRowH * 0.5f - 2.0f, ContentW - LabelW - 8.0f - 8.0f - 38.0f, 4.0f };
        UpdateSunTrackSurface(static_cast<uint32_t>(std::lround(Track.Width)));
        SunTrack.Present(Surface, Track, 0.0f);
        const float   SunFraction = std::clamp((Instance.SunAtLimbDeg - SunAtLimbMinimum) / (SunAtLimbMaximum - SunAtLimbMinimum), 0.0f, 1.0f);
        const Point2D Thumb { Track.X + 7.0f + SunFraction * (Track.Width - 14.0f), Track.Center().Y };
        Surface.FillCircle(Thumb, 8.0f, ColorRgba{ 255u, 255u, 255u, 64u }); // box-shadow 0 0 0 1px #ffffff40
        Surface.FillCircle(Thumb, 7.0f, ColorRgba{ 26u, 26u, 26u, 255u });   // 2px #1a1a1a border
        Surface.FillCircle(Thumb, 5.0f, ColorRgba{ 244u, 244u, 244u, 255u }); // #f4f4f4

        // Interaction: range (-12..40, step 0.5) and the outline/handle drag that sets "Atmosphere" (TopThrough)
        const Point2D     Cursor { Input.PrimaryPointer.X, Input.PrimaryPointer.Y };
        const Rectangle2D TrackHit { Track.X, SunRowY - 2.0f, Track.Width, SunRowH + 4.0f };
        if (Input.PrimaryPointer.Pressed)
        {
            if (TrackHit.Contains(Cursor)) ActiveDragId = SunAtLimbDragId;
            else if (LimbRect.Contains(Cursor) && std::hypot(Cursor.X - Handle.X, Cursor.Y - Handle.Y) <= 11.0f) ActiveDragId = AtmosphereTopDragId;
        }
        if (ActiveDragId == SunAtLimbDragId && Input.PrimaryPointer.Down)
        {
            const float Fraction = std::clamp((Cursor.X - Track.X - 7.0f) / std::max(1.0f, Track.Width - 14.0f), 0.0f, 1.0f);
            const float Reading  = std::round((SunAtLimbMinimum + Fraction * (SunAtLimbMaximum - SunAtLimbMinimum)) / 0.5f) * 0.5f;
            if (Reading != Instance.SunAtLimbDeg) { Instance.SunAtLimbDeg = Reading; OutMutated = true; }
        }
        else if (ActiveDragId == AtmosphereTopDragId && Input.PrimaryPointer.Down)
        {
            const float Top = AtmosphereLimbRaster::ResolveTopThrough(View, (Cursor.X - LimbRect.X) / LimbRect.Width, (Cursor.Y - LimbRect.Y) / LimbRect.Height);
            if (Top != Medium.AtmosphereThicknessMeters) { Medium.AtmosphereThicknessMeters = Top; OutMutated = true; }
        }
        else if (!Input.PrimaryPointer.Down && (ActiveDragId == SunAtLimbDragId || ActiveDragId == AtmosphereTopDragId))
        {
            ActiveDragId = 0u;
        }

        CursorY = Section.Bottom() + InspectorMetrics::SectionGap;

        const std::array<InspectorQuickSwitchSpec, 3u> Quick = {{
            { "Visible",            InspectorSwitchSymbol::Eye,      Entry.VisibilityEnabled,   false, "atmosphere" },
            { "Line at civil only", InspectorSwitchSymbol::LimbLine, Instance.LineAtCivilOnly,  false, "atmosphere" },
            { "Orbital view",       InspectorSwitchSymbol::Orbit,    Medium.OrbitalViewEnabled, false, "atmosphere" },
        }};
        int32_t Clicked = -1;
        CursorY = InspectorPrimitives::ConstructQuickSwitchSection(Surface, LeftX, CursorY, InnerWidth, Quick, Input, Clicked);
        if (Clicked == 0) { Entry.VisibilityEnabled = !Entry.VisibilityEnabled; OutMutated = true; }
        else if (Clicked == 1) { Instance.LineAtCivilOnly = !Instance.LineAtCivilOnly; OutMutated = true; }
        else if (Clicked == 2) { Medium.OrbitalViewEnabled = !Medium.OrbitalViewEnabled; OutMutated = true; }

        // Inspectors.jsx panel tag table: atmosphere: ["environment", "sky"]
        static constexpr std::array<const char*, 2u> Tags = {{ "environment", "sky" }};
        CursorY = InspectorPrimitives::ConstructTagsSection(Surface, LeftX, CursorY, InnerWidth, Tags);
        CursorY = InspectorPrimitives::ConstructNotesSection(Surface, LeftX, CursorY, InnerWidth, Entry.AuthorNotes);
    }
    else if (ActivePage == 1u)
    {
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 286.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Atmospheric scattering");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            char Num[16]{}; std::snprintf(Num, sizeof(Num), "%.1f", Medium.RayleighStrength);
            Y = InspectorPrimitives::ConstructMetricReadout(Surface, LeftX + PadX, Y, Num, "x", "How air molecules scatter sunlight");
            std::array<float, 32u> Curve{};
            for (std::size_t I = 0u; I < Curve.size(); ++I)
            {
                const float Lambda = 0.40f + 0.30f * (static_cast<float>(I) / 31.0f);
                Curve[I] = std::clamp(std::pow(0.45f / Lambda, 4.0f) * 0.42f * Medium.RayleighStrength, 0.0f, 1.0f);
            }
            InspectorPrimitives::ConstructCurvePlot(Surface, { LeftX + PadX, Y, BodyW, 82.0f }, Curve, ColorRgba{ 116u, 178u, 255u, 255u }, ColorRgba{ 76u, 138u, 232u, 42u }, "400 nm", "700 nm");
            Y += 94.0f;
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1101u, "Rayleigh", "x", "%.2f", 0.0f, 4.0f, Medium.RayleighStrength, ActiveDragId, Input, OutMutated);
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 344.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Aerosol haze");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            char Num[16]{}; std::snprintf(Num, sizeof(Num), "%.2f", Medium.MieStrength);
            Y = InspectorPrimitives::ConstructMetricReadout(Surface, LeftX + PadX, Y, Num, "x", "Suspended particles soften light");
            std::array<float, 32u> Curve{};
            const float G = std::clamp(Medium.MieAnisotropy, 0.0f, 0.96f);
            for (std::size_t I = 0u; I < Curve.size(); ++I)
            {
                const float CosT  = 1.0f - 2.0f * (static_cast<float>(I) / 31.0f);
                const float Phase = (1.0f - G * G) / std::pow(1.0f + G * G - 2.0f * G * CosT, 1.5f);
                Curve[I] = std::clamp(std::log2(1.0f + Phase * Medium.MieStrength) / 5.5f, 0.0f, 1.0f);
            }
            InspectorPrimitives::ConstructCurvePlot(Surface, { LeftX + PadX, Y, BodyW, 74.0f }, Curve, ColorRgba{ 238u, 198u, 132u, 255u }, ColorRgba{ 238u, 188u, 110u, 38u }, "Forward", "Back");
            Y += 86.0f;
            Y = InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1102u, "Mie", "x", "%.2f", 0.0f, 6.0f, Medium.MieStrength, ActiveDragId, Input, OutMutated);
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1103u, "Mie Anisotropy", "g", "%.2f", 0.0f, 0.99f, Medium.MieAnisotropy, ActiveDragId, Input, OutMutated);
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 276.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Ozone absorption");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            char Num[16]{}; std::snprintf(Num, sizeof(Num), "%.2f", Medium.OzoneStrength);
            Y = InspectorPrimitives::ConstructMetricReadout(Surface, LeftX + PadX, Y, Num, "x", "Selective Chappuis absorption");
            std::array<float, 32u> Curve{};
            for (std::size_t I = 0u; I < Curve.size(); ++I)
            {
                const float T = static_cast<float>(I) / 31.0f;
                Curve[I] = std::clamp(std::exp(-std::pow((T - 0.64f) * 4.2f, 2.0f)) * 0.68f * Medium.OzoneStrength, 0.0f, 1.0f);
            }
            InspectorPrimitives::ConstructCurvePlot(Surface, { LeftX + PadX, Y, BodyW, 72.0f }, Curve, ColorRgba{ 168u, 148u, 255u, 255u }, ColorRgba{ 148u, 118u, 245u, 42u }, "450 nm", "700 nm");
            Y += 84.0f;
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1104u, "Ozone", "x", "%.2f", 0.0f, 4.0f, Medium.OzoneStrength, ActiveDragId, Input, OutMutated);
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
    }
    else if (ActivePage == 2u)
    {
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 304.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Density falloff");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            Y = InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1201u, "Rayleigh Scale H", "m", "%.0f", 1000.0f, 20000.0f, Medium.RayleighScaleHeightMeters, ActiveDragId, Input, OutMutated);
            std::array<float, 32u> Curve{};
            for (std::size_t I = 0u; I < Curve.size(); ++I)
            {
                const float Alt = (static_cast<float>(I) / 31.0f) * 30000.0f;
                Curve[I] = std::exp(-Alt / std::max(500.0f, Medium.RayleighScaleHeightMeters));
            }
            InspectorPrimitives::ConstructCurvePlot(Surface, { LeftX + PadX, Y, BodyW, 78.0f }, Curve, ColorRgba{ 118u, 204u, 255u, 255u }, ColorRgba{ 98u, 178u, 245u, 40u }, "0 km", "30 km");
            Y += 90.0f;
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1202u, "Mie Scale H", "m", "%.0f", 200.0f, 6000.0f, Medium.MieScaleHeightMeters, ActiveDragId, Input, OutMutated);
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 212.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Planet & air");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            Y = InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1203u, "Atmosphere", "m", "%.0f", 10000.0f, 150000.0f, Medium.AtmosphereThicknessMeters, ActiveDragId, Input, OutMutated);
            float RadiusKm = Medium.PlanetRadiusMeters * 0.001f;
            bool RadChanged = false;
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1204u, "Planet radius", "km", "%.0f", 1000.0f, 12000.0f, RadiusKm, ActiveDragId, Input, RadChanged);
            if (RadChanged) { Medium.PlanetRadiusMeters = RadiusKm * 1000.0f; OutMutated = true; }
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
    }
    else if (ActivePage == 3u)
    {
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 272.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Sky colour");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            Y = InspectorPrimitives::ConstructColourFieldRow(Surface, LeftX + PadX, Y, BodyW, 1301u, "Sky Tint", Medium.SkyTint, ActiveDragId, Input, OutMutated);
            Y = InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1310u, "Sky Brightness", "x", "%.2f", 0.0f, 3.0f, Medium.SkyBrightnessMultiplier, ActiveDragId, Input, OutMutated);
            (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1311u, "Limb Glow", "x", "%.2f", 0.0f, 3.0f, Medium.LimbGlowIntensity, ActiveDragId, Input, OutMutated);
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
        {
            const Rectangle2D S { LeftX, CursorY, InnerWidth, 162.0f };
            InspectorPrimitives::ConstructSectionSurface(Surface, S, "Ground reflectance");
            float Y = CursorY + InspectorMetrics::SectionPadTop + 28.0f;
            Y = InspectorPrimitives::ConstructColourFieldRow(Surface, LeftX + PadX, Y, BodyW, 1320u, "Ground Albedo", Medium.GroundAlbedo, ActiveDragId, Input, OutMutated);
            WorkspaceAppearance::ConstructTruncatedText(Surface, FontWeightClass::Regular, { LeftX + PadX, Y + 4.0f }, BodyW, 10.0f, InspectorMetrics::MutedInk, "Linear RGB ground bounce reflectance.");
            CursorY = S.Bottom() + InspectorMetrics::SectionGap;
        }
    }
    else if (ActivePage == 4u)
    {
        // PENDING PORT (ledger Atmosphere-05): replaced in the next parity step
        const Rectangle2D S { LeftX, CursorY, InnerWidth, 344.0f };
        InspectorPrimitives::ConstructSectionSurface(Surface, S, "Planet from orbit");
        const Rectangle2D Img { LeftX + PadX, CursorY + InspectorMetrics::SectionPadTop + 28.0f, BodyW, 168.0f };
        UpdateLimbSurface(Medium, Instance.SunAtLimbDeg, static_cast<uint32_t>(BodyW), 168u);
        LimbPreview.Present(Surface, Img, 14.0f);
        float Y = Img.Bottom() + 14.0f;
        Y = InspectorPrimitives::ConstructToggleFieldRow(Surface, LeftX + PadX, Y, BodyW, "Orbital view", Medium.OrbitalViewEnabled, Input, OutMutated);
        (void)InspectorPrimitives::ConstructScalarFieldRow(Surface, LeftX + PadX, Y, BodyW, 1401u, "Observer altitude", "m", "%.0f", 0.0f, 250000.0f, Medium.ObserverAltitudeMeters, ActiveDragId, Input, OutMutated);
        CursorY = S.Bottom() + InspectorMetrics::SectionGap;
    }
    else
    {
        UpdateTransmittanceSurface(Medium);
        UpdateSkyViewSurface(Medium, ActiveSolar);
        WorkspaceAppearance::ConstructWeightedText(Surface, FontWeightClass::Medium, { LeftX + 2.0f, CursorY }, 9.5f, InspectorMetrics::DimInk, "BAKING   ·   Live atmospheric LUTs");
        CursorY += 20.0f;
        bool TransRebake = false, SkyRebake = false;
        CursorY = InspectorPrimitives::ConstructBakedLutSection(
            Surface, LeftX, CursorY, InnerWidth, "Transmittance LUT", "256 x 64",
            "RGB32F -> RGBA8 sRGB  ·  elevation x altitude",
            "X: View elevation (-6..90 deg)   ·   Y: Altitude (0..60 km)",
            TransmittanceLut, 74.0f, &Input, &TransSettingsOpen, &TransResolutionTier, &TransRebake);
        CursorY = InspectorPrimitives::ConstructBakedLutSection(
            Surface, LeftX, CursorY, InnerWidth, "Sky-view LUT", "192 x 108",
            "RGBA32F -> RGBA8 sRGB  ·  equirectangular sky dome",
            "X: Azimuth (0..360 deg)   ·   Y: Elevation (+90..-90 deg)",
            SkyViewLut, 112.0f, &Input, &SkyViewSettingsOpen, &SkyViewResolutionTier, &SkyRebake);
        if (TransRebake || SkyRebake) OutMutated = true;
    }

    return CursorY;
}

} // namespace Frontier
