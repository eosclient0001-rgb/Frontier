/*============================================================================================================================================
                                                        QUICKSYMBOLREPOSITORY.CPP
============================================================================================================================================*/
// 🧩 ActionIcon.jsx silhouettes (generated 1:1 from the React render: circle/ellipse/rect/rotate converted to exact SVG paths) + scanline mask

#include "Engine/Components/Controls/QuickSymbolRepository.h"

#include "Engine/Components/VectorIcons/VectorIconRepository.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <utility>

namespace Frontier
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   SILHOUETTE LAYERS
//------------------------------------------------------------------------------------------------------------------------

constexpr std::array QuickSymbolLayers = std::to_array<QuickSymbolLayer>({
    { QuickSymbol::Lock, 1.00f, false, "M8 10L16 10A3 3 0 0 1 19 13L19 19A3 3 0 0 1 16 22L8 22A3 3 0 0 1 5 19L5 13A3 3 0 0 1 8 10Z" },
    { QuickSymbol::Lock, 1.00f, false, "M7 11V7a5 5 0 0 1 10 0v4h-3V7a2 2 0 0 0-4 0v4Z" },
    { QuickSymbol::Shadow, 1.00f, false, "M3 5h10v10H3z" },
    { QuickSymbol::Shadow, 0.40f, false, "m13 8 9 9-8 5-8-7h7Z" },
    { QuickSymbol::Gi, 1.00f, false, "M3 8A5 5 0 1 0 13 8A5 5 0 1 0 3 8Z" },
    { QuickSymbol::Gi, 1.00f, false, "m3 19 8-7 3 3 7-7v6h-3v-1l-4 6-4-3-5 5Z" },
    { QuickSymbol::Visible, 1.00f, true , "M1 12C3.7 6.8 7.4 4 12 4s8.3 2.8 11 8c-2.7 5.2-6.4 8-11 8S3.7 17.2 1 12Zm11-5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M7 12A5 5 0 1 0 17 12A5 5 0 1 0 7 12Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M12 1L12 1A1 1 0 0 1 13 2L13 4A1 1 0 0 1 12 5L12 5A1 1 0 0 1 11 4L11 2A1 1 0 0 1 12 1Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M19.7782 4.2218L19.7782 4.2218A1 1 0 0 1 19.7782 5.636L18.364 7.0503A1 1 0 0 1 16.9497 7.0503L16.9497 7.0503A1 1 0 0 1 16.9497 5.636L18.364 4.2218A1 1 0 0 1 19.7782 4.2218Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M23 12L23 12A1 1 0 0 1 22 13L20 13A1 1 0 0 1 19 12L19 12A1 1 0 0 1 20 11L22 11A1 1 0 0 1 23 12Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M19.7782 19.7782L19.7782 19.7782A1 1 0 0 1 18.364 19.7782L16.9497 18.364A1 1 0 0 1 16.9497 16.9497L16.9497 16.9497A1 1 0 0 1 18.364 16.9497L19.7782 18.364A1 1 0 0 1 19.7782 19.7782Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M12 23L12 23A1 1 0 0 1 11 22L11 20A1 1 0 0 1 12 19L12 19A1 1 0 0 1 13 20L13 22A1 1 0 0 1 12 23Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M4.2218 19.7782L4.2218 19.7782A1 1 0 0 1 4.2218 18.364L5.636 16.9497A1 1 0 0 1 7.0503 16.9497L7.0503 16.9497A1 1 0 0 1 7.0503 18.364L5.636 19.7782A1 1 0 0 1 4.2218 19.7782Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M1 12L1 12A1 1 0 0 1 2 11L4 11A1 1 0 0 1 5 12L5 12A1 1 0 0 1 4 13L2 13A1 1 0 0 1 1 12Z" },
    { QuickSymbol::Sunlight, 1.00f, false, "M4.2218 4.2218L4.2218 4.2218A1 1 0 0 1 5.636 4.2218L7.0503 5.636A1 1 0 0 1 7.0503 7.0503L7.0503 7.0503A1 1 0 0 1 5.636 7.0503L4.2218 5.636A1 1 0 0 1 4.2218 4.2218Z" },
    { QuickSymbol::Disc, 0.18f, false, "M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z" },
    { QuickSymbol::Disc, 1.00f, false, "M4.5 12A7.5 7.5 0 1 0 19.5 12A7.5 7.5 0 1 0 4.5 12Z" },
    { QuickSymbol::Disc, 0.45f, false, "M5 19h14v2H5z" },
    { QuickSymbol::Stars, 1.00f, false, "m9 2 2.6 6.4L18 11l-6.4 2.6L9 20l-2.6-6.4L0 11l6.4-2.6L9 2Zm10 0 1.1 2.9L23 6l-2.9 1.1L19 10l-1.1-2.9L15 6l2.9-1.1L19 2Zm0 13 1.1 2.9L23 19l-2.9 1.1L19 23l-1.1-2.9L15 19l2.9-1.1L19 15Z" },
    { QuickSymbol::Twinkle, 1.00f, false, "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" },
    { QuickSymbol::Twinkle, 0.45f, false, "M2 2h3v3H2zm17 0h3v3h-3zM2 19h3v3H2zm17 0h3v3h-3z" },
    { QuickSymbol::Cycle, 1.00f, false, "M19.3 4.7A10 10 0 0 0 2 11h3a7 7 0 0 1 12.2-4.6L14 10h9V1l-3.7 3.7ZM4.7 19.3A10 10 0 0 0 22 13h-3a7 7 0 0 1-12.2 4.6L10 14H1v9l3.7-3.7Z" },
    { QuickSymbol::Cycle, 1.00f, false, "M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z" },
    { QuickSymbol::Motion, 1.00f, false, "M10 4v16l12-8ZM1 6h6v3H1zm-1 5h7v2H0zm1 4h6v3H1z" },
    { QuickSymbol::Pause, 1.00f, false, "M6.5 4L8.5 4A1.5 1.5 0 0 1 10 5.5L10 18.5A1.5 1.5 0 0 1 8.5 20L6.5 20A1.5 1.5 0 0 1 5 18.5L5 5.5A1.5 1.5 0 0 1 6.5 4Z" },
    { QuickSymbol::Pause, 1.00f, false, "M15.5 4L17.5 4A1.5 1.5 0 0 1 19 5.5L19 18.5A1.5 1.5 0 0 1 17.5 20L15.5 20A1.5 1.5 0 0 1 14 18.5L14 5.5A1.5 1.5 0 0 1 15.5 4Z" },
    { QuickSymbol::Orbit, 1.00f, false, "M6.5 3.3A10 10 0 1 0 21 8l-2.7 1.2a7 7 0 1 1-10.3-3.3Z" },
    { QuickSymbol::Orbit, 1.00f, false, "M8 12A4 4 0 1 0 16 12A4 4 0 1 0 8 12Z" },
    { QuickSymbol::Orbit, 1.00f, false, "M15 4A3 3 0 1 0 21 4A3 3 0 1 0 15 4Z" },
    { QuickSymbol::Wind, 1.00f, false, "M2 6h11a2 2 0 1 0-2-2H8a5 5 0 1 1 5 5H2V6Zm0 5h16a5 5 0 1 1-5 5h3a2 2 0 1 0 2-2H2v-3Zm0 5h5a4 4 0 1 1-4 4h2a2 2 0 1 0 2-2H2v-2Z" },
    { QuickSymbol::Shear, 1.00f, false, "M1 5h14V2l7 5-7 5V9H1zM23 15H9v-3l-7 5 7 5v-3h14z" },
    { QuickSymbol::Cloud, 1.00f, false, "M6 20a6 6 0 0 1-.8-11.9A7.5 7.5 0 0 1 20 9a5.5 5.5 0 0 1-1.5 11Z" },
    { QuickSymbol::CloudSpawn, 0.70f, false, "M6 14a5 5 0 0 1-.5-10 6.5 6.5 0 0 1 12 1A4.5 4.5 0 0 1 20 14h-6v-4h-4v4Z" },
    { QuickSymbol::CloudSpawn, 1.00f, false, "M10 12h4v6h4l-6 6-6-6h4z" },
    { QuickSymbol::Rain, 1.00f, false, "M6 14a5 5 0 0 1-.5-10 6.5 6.5 0 0 1 12 1A4.5 4.5 0 0 1 20 14Z" },
    { QuickSymbol::Rain, 0.60f, false, "m6 16 2 1-3 6-2-1Zm7 0 2 1-3 6-2-1Zm7 0 2 1-3 6-2-1Z" },
    { QuickSymbol::Collision, 1.00f, false, "M10 1h4v8h4l-6 6-6-6h4ZM2 20h20v3H2zM3 12l4 3-2 2-4-3Zm18 0 2 2-4 3-2-2Z" },
    { QuickSymbol::Fog, 1.00f, false, "M3 4L16 4A2 2 0 0 1 18 6L18 6A2 2 0 0 1 16 8L3 8A2 2 0 0 1 1 6L1 6A2 2 0 0 1 3 4Z" },
    { QuickSymbol::Fog, 0.70f, false, "M8 10L21 10A2 2 0 0 1 23 12L23 12A2 2 0 0 1 21 14L8 14A2 2 0 0 1 6 12L6 12A2 2 0 0 1 8 10Z" },
    { QuickSymbol::Fog, 0.40f, false, "M4 16L17 16A2 2 0 0 1 19 18L19 18A2 2 0 0 1 17 20L4 20A2 2 0 0 1 2 18L2 18A2 2 0 0 1 4 16Z" },
    { QuickSymbol::Rainbow, 1.00f, false, "M1 21v-7a11 11 0 0 1 22 0v7h-3v-7a8 8 0 0 0-16 0v7Z" },
    { QuickSymbol::Rainbow, 0.50f, false, "M6 21v-7a6 6 0 0 1 12 0v7h-3v-7a3 3 0 0 0-6 0v7Z" },
    { QuickSymbol::Band, 0.40f, false, "M1 21v-7a11 11 0 0 1 22 0v7h-2v-7a9 9 0 0 0-18 0v7Z" },
    { QuickSymbol::Band, 1.00f, false, "M6 21v-7a6 6 0 0 1 12 0v7h-4v-7a2 2 0 0 0-4 0v7Z" },
    { QuickSymbol::Bake, 1.00f, false, "M3 14h4v5h10v-5h4v8H3zM10 1h4v8h5l-7 7-7-7h5Z" },
    { QuickSymbol::Image, 1.00f, true , "M4 2h18v17H4V2Zm3 12h12l-4-6-3 4-2-2-3 4Zm2-9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" },
    { QuickSymbol::Image, 0.50f, false, "M0 6h2v15h16v2H0Z" },
    { QuickSymbol::Anamorphic, 1.00f, false, "M8 12A4 8 0 1 0 16 12A4 8 0 1 0 8 12Z" },
    { QuickSymbol::Anamorphic, 1.00f, false, "M0 11h24v2H0Z" },
    { QuickSymbol::Anamorphic, 0.40f, false, "M2 7h20v1H2zm0 9h20v1H2z" },
    { QuickSymbol::Streaks, 1.00f, false, "m0 3 24 6-1 3L0 6Zm0 8 24 3-1 3L0 14Zm0 8h24v3H0Z" },
    { QuickSymbol::Starburst, 1.00f, false, "m12 0 2 8 7-5-5 7 8 2-8 2 5 7-7-5-2 8-2-8-7 5 5-7-8-2 8-2-5-7 7 5Z" },
    { QuickSymbol::Construct, 0.65f, false, "m8 2 8 4v7l-8 4-8-4V6Z" },
    { QuickSymbol::Construct, 1.00f, false, "M17 11h3v4h4v3h-4v4h-3v-4h-4v-3h4Z" },
    { QuickSymbol::Focus, 1.00f, false, "M2 2h7v3H5v4H2zm13 0h7v7h-3V5h-4ZM2 15h3v4h4v3H2zm17 0h3v7h-7v-3h4Z" },
    { QuickSymbol::Focus, 1.00f, false, "M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z" },
    { QuickSymbol::Split, 1.00f, true , "M2 4h20v16H2Zm3 3v10h6V7Zm9 0v10h5V7Z" },
    { QuickSymbol::Diagnostics, 1.00f, false, "M4.75 12L4.75 12A2.25 2.25 0 0 1 7 14.25L7 19.75A2.25 2.25 0 0 1 4.75 22L4.75 22A2.25 2.25 0 0 1 2.5 19.75L2.5 14.25A2.25 2.25 0 0 1 4.75 12Z" },
    { QuickSymbol::Diagnostics, 1.00f, false, "M12 6L12 6A2.25 2.25 0 0 1 14.25 8.25L14.25 19.75A2.25 2.25 0 0 1 12 22L12 22A2.25 2.25 0 0 1 9.75 19.75L9.75 8.25A2.25 2.25 0 0 1 12 6Z" },
    { QuickSymbol::Diagnostics, 1.00f, false, "M19.25 2L19.25 2A2.25 2.25 0 0 1 21.5 4.25L21.5 19.75A2.25 2.25 0 0 1 19.25 22L19.25 22A2.25 2.25 0 0 1 17 19.75L17 4.25A2.25 2.25 0 0 1 19.25 2Z" },
    { QuickSymbol::Edit, 1.00f, false, "m15 2 7 7-12 12-8 1 1-8Zm-9 13-1 4 4-1 10-10-3-3Z" },
    { QuickSymbol::Simulate, 1.00f, false, "M6 1h12v3h-3v4l7 11a3 3 0 0 1-2.5 4h-15A3 3 0 0 1 2 19L9 8V4H6Zm5 8-4 7h10l-4-7V4h-2Z" },
    { QuickSymbol::Simulate, 0.30f, false, "M9 19A1 1 0 1 0 11 19A1 1 0 1 0 9 19Z" },
    { QuickSymbol::Play, 1.00f, false, "M6 2a1 1 0 0 1 1.5-.8l15 10a1 1 0 0 1 0 1.6l-15 10A1 1 0 0 1 6 22Z" },
    { QuickSymbol::Settings, 1.00f, true , "m9 1 6 0 1 4 3-1 3 5-3 3 3 3-3 5-3-1-1 4H9l-1-4-3 1-3-5 3-3-3-3 3-5 3 1Zm3 6a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" },
    { QuickSymbol::Compass, 1.00f, true , "M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22Zm0 2.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z" },
    { QuickSymbol::Compass, 1.00f, false, "m12 5 2.6 7H9.4Z" },
    { QuickSymbol::Compass, 0.40f, false, "m12 19-2.6-7h5.2Z" },
    { QuickSymbol::Horizon, 1.00f, false, "M5 15a7 7 0 0 1 14 0Z" },
    { QuickSymbol::Horizon, 1.00f, false, "M2.2 16.5L21.8 16.5A1.2 1.2 0 0 1 23 17.7L23 17.8A1.2 1.2 0 0 1 21.8 19L2.2 19A1.2 1.2 0 0 1 1 17.8L1 17.7A1.2 1.2 0 0 1 2.2 16.5Z" },
    { QuickSymbol::Horizon, 0.40f, false, "M5 20.5L19 20.5A1 1 0 0 1 20 21.5L20 21.5A1 1 0 0 1 19 22.5L5 22.5A1 1 0 0 1 4 21.5L4 21.5A1 1 0 0 1 5 20.5Z" },
    { QuickSymbol::Horizon, 0.60f, false, "M11 2h2v4h-2zM3.5 6.6l1.4-1.4 2.8 2.8-1.4 1.4zM16.3 8l2.8-2.8 1.4 1.4-2.8 2.8z" },
    { QuickSymbol::Atmosphere, 1.00f, false, "M5.5 12A6.5 6.5 0 1 0 18.5 12A6.5 6.5 0 1 0 5.5 12Z" },
    { QuickSymbol::Atmosphere, 0.45f, true , "M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22Zm0 2a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" },
    { QuickSymbol::Galaxy, 0.40f, false, "M2.0306 16.6488A11 4.5 -25 1 0 21.9694 7.3512A11 4.5 -25 1 0 2.0306 16.6488Z" },
    { QuickSymbol::Galaxy, 1.00f, false, "M6.5622 14.5357A6 2.6 -25 1 0 17.4378 9.4643A6 2.6 -25 1 0 6.5622 14.5357Z" },
    { QuickSymbol::Galaxy, 1.00f, false, "M9.6 12A2.4 2.4 0 1 0 14.4 12A2.4 2.4 0 1 0 9.6 12Z" },
    { QuickSymbol::Zodiac, 0.45f, false, "M12 3 20 20H4Z" },
    { QuickSymbol::Zodiac, 1.00f, false, "M12 9 16 20H8Z" },
    { QuickSymbol::Zodiac, 1.00f, false, "M2.2 20L21.8 20A1.2 1.2 0 0 1 23 21.2L23 21.3A1.2 1.2 0 0 1 21.8 22.5L2.2 22.5A1.2 1.2 0 0 1 1 21.3L1 21.2A1.2 1.2 0 0 1 2.2 20Z" },
    { QuickSymbol::Tripod, 1.00f, false, "M7 2L17 2A2 2 0 0 1 19 4L19 8A2 2 0 0 1 17 10L7 10A2 2 0 0 1 5 8L5 4A2 2 0 0 1 7 2Z" },
    { QuickSymbol::Tripod, 1.00f, false, "M11 10h2v3l6 9h-2.4L12 15l-4.6 7H5l6-9Z" },
    { QuickSymbol::Tripod, 0.50f, false, "M11 13h2v9h-2z" },
    { QuickSymbol::Vignette, 1.00f, true , "M2 4h20v16H2Zm10 2.5c-4.4 0-7.5 2.5-7.5 5.5s3.1 5.5 7.5 5.5 7.5-2.5 7.5-5.5-3.1-5.5-7.5-5.5Z" },
    { QuickSymbol::Toggle, 1.00f, true , "M7 6h10a6 6 0 0 1 0 12H7A6 6 0 0 1 7 6Zm10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" },
    { QuickSymbol::Debug, 0.55f, true , "M3 3h18v18H3Zm2 2v6h6V5Zm8 0v6h6V5Zm-8 8v6h6v-6Zm8 0v6h6v-6Z" },
    { QuickSymbol::Debug, 1.00f, false, "M11 7h2v4h4v2h-4v4h-2v-4H7v-2h4Z" },
    { QuickSymbol::Clock, 1.00f, true , "M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22Zm0 2.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z" },
    { QuickSymbol::Clock, 1.00f, false, "M10.8 6h2.4v5.5l3.6 2.1-1.2 2.1-4.8-2.8Z" },
    { QuickSymbol::Clock, 0.25f, false, "M6.4 12A5.6 5.6 0 1 0 17.6 12A5.6 5.6 0 1 0 6.4 12Z" },
});

constexpr std::array<std::string_view, static_cast<std::size_t>(QuickSymbol::Count)> QuickSymbolNames = {{
    "lock", "shadow", "gi", "visible", "sunlight", "disc", "stars", "twinkle", "cycle", "motion", "pause", "orbit", "wind", "shear", "cloud",
    "cloud-spawn", "rain", "collision", "fog", "rainbow", "band", "bake", "image", "anamorphic", "streaks", "starburst", "construct", "focus",
    "split", "diagnostics", "edit", "simulate", "play", "settings", "compass", "horizon", "atmosphere", "galaxy", "zodiac", "tripod",
    "vignette", "toggle", "debug", "clock",
}};

struct LabelSymbolPair
{
    std::string_view Label  {};
    std::string_view Symbol {};
};

// The Named lookup of QuickSymbol() in ActionIcon.jsx, in source order
constexpr std::array<LabelSymbolPair, 39u> NamedLabels = {{
    { "Visible", "visible" }, { "Star field", "stars" }, { "Twinkle", "twinkle" }, { "Bake", "bake" }, { "Use baked", "image" },
    { "Use baked image", "image" }, { "Sunlight", "sunlight" }, { "Sun disc", "disc" }, { "Day cycle", "cycle" }, { "Real time", "clock" },
    { "Dynamic", "motion" }, { "Static", "pause" }, { "Follow Sky", "orbit" }, { "Follow Wind", "wind" }, { "Spawn from Clouds", "cloud-spawn" },
    { "Ground Collision", "collision" }, { "Air shear", "shear" }, { "Alexander's Band", "band" }, { "Anamorphic", "anamorphic" },
    { "Streaks", "streaks" }, { "Starburst", "starburst" }, { "Cast shadows", "shadow" }, { "GI", "gi" }, { "Physics", "collision" },
    { "Locked", "lock" }, { "Manual direction", "compass" }, { "Line at civil only", "horizon" }, { "Orbital view", "atmosphere" },
    { "Has atmosphere", "atmosphere" }, { "Milky Way", "galaxy" }, { "Zodiacal light", "zodiac" }, { "Bright star catalogue", "stars" },
    { "Tripod", "tripod" }, { "Vignette", "vignette" }, { "Depth of field", "focus" }, { "Location lag", "motion" },
    { "Rotation lag", "orbit" }, { "Cloud interaction", "cloud" }, { "Fog interaction", "fog" },
}};

// The "Enabled" label resolves by panel context
constexpr std::array<LabelSymbolPair, 12u> EnabledByContext = {{
    { "wind", "wind" }, { "clouds", "cloud" }, { "local-cloud", "cloud" }, { "height-fog", "fog" }, { "aerial-fog", "fog" },
    { "local-fog", "fog" }, { "precipitation", "rain" }, { "rainbow", "rainbow" }, { "environment-light", "sunlight" },
    { "flare", "starburst" }, { "god-rays", "sunlight" }, { "motion-blur", "motion" },
}};

struct ScanEdge
{
    float X0 = 0.0f; // [px] - Upper endpoint horizontal
    float Y0 = 0.0f; // [px] - Upper endpoint vertical
    float X1 = 0.0f; // [px] - Lower endpoint horizontal
    float Y1 = 0.0f; // [px] - Lower endpoint vertical
    int   Winding = 1; // [-] - +1 downward source edge, -1 upward
};

constexpr int SubRowsPerPixel = 4; // [count] - Vertical sub-scanlines per pixel (horizontal spans are analytic)

void AccumulateSpan(std::vector<float>& Row, float SpanFrom, float SpanTo, float Weight, uint32_t WidthPx) noexcept
{
    SpanFrom = std::clamp(SpanFrom, 0.0f, static_cast<float>(WidthPx));
    SpanTo   = std::clamp(SpanTo, 0.0f, static_cast<float>(WidthPx));
    if (SpanTo <= SpanFrom)
    {
        return;
    }
    const int FirstPx = static_cast<int>(std::floor(SpanFrom));
    const int LastPx  = std::min(static_cast<int>(WidthPx) - 1, static_cast<int>(std::ceil(SpanTo)) - 1);
    for (int Px = FirstPx; Px <= LastPx; ++Px)
    {
        const float Overlap = std::min(SpanTo, static_cast<float>(Px + 1)) - std::max(SpanFrom, static_cast<float>(Px));
        if (Overlap > 0.0f)
        {
            Row[static_cast<std::size_t>(Px)] += Overlap * Weight;
        }
    }
}

void FillLayerMask(
    const QuickSymbolLayer& Layer,
    float                   OriginX,
    float                   OriginY,
    float                   Scale,
    uint32_t                WidthPx,
    uint32_t                HeightPx,
    std::vector<float>&     OutLayer) noexcept
{
    std::vector<ScanEdge> Edges{};
    for (const VectorIconRepository::Contour& Path : VectorIconRepository::FlattenSvgPath(Layer.SvgPath))
    {
        const std::size_t Count = Path.Points.size();
        if (Count < 2u)
        {
            continue;
        }
        // SVG fill closes every subpath implicitly
        for (std::size_t Index = 0u; Index < Count; ++Index)
        {
            const Point2D From = Path.Points[Index];
            const Point2D To   = Path.Points[(Index + 1u) % Count];
            const float   Ax   = OriginX + From.X * Scale, Ay = OriginY + From.Y * Scale;
            const float   Bx   = OriginX + To.X * Scale,   By = OriginY + To.Y * Scale;
            if (Ay == By)
            {
                continue;
            }
            Edges.push_back(Ay < By ? ScanEdge{ Ax, Ay, Bx, By, 1 } : ScanEdge{ Bx, By, Ax, Ay, -1 });
        }
    }

    OutLayer.assign(static_cast<std::size_t>(WidthPx) * HeightPx, 0.0f);
    std::vector<std::pair<float, int>> Crossings{};
    std::vector<float>                 Row(WidthPx, 0.0f);
    const float                        Weight = 1.0f / static_cast<float>(SubRowsPerPixel);
    for (uint32_t Py = 0u; Py < HeightPx; ++Py)
    {
        std::fill(Row.begin(), Row.end(), 0.0f);
        for (int Sub = 0; Sub < SubRowsPerPixel; ++Sub)
        {
            const float SampleY = static_cast<float>(Py) + (static_cast<float>(Sub) + 0.5f) * Weight;
            Crossings.clear();
            for (const ScanEdge& Edge : Edges)
            {
                if (SampleY >= Edge.Y0 && SampleY < Edge.Y1)
                {
                    const float T = (SampleY - Edge.Y0) / (Edge.Y1 - Edge.Y0);
                    Crossings.emplace_back(Edge.X0 + (Edge.X1 - Edge.X0) * T, Edge.Winding);
                }
            }
            std::sort(Crossings.begin(), Crossings.end(), [](const auto& Left, const auto& Right) { return Left.first < Right.first; });
            int Winding = 0;
            for (std::size_t Index = 0u; Index + 1u <= Crossings.size(); ++Index)
            {
                Winding += Crossings[Index].second;
                const bool Inside = Layer.EvenOdd ? ((Index + 1u) % 2u == 1u) : (Winding != 0);
                if (Inside && Index + 1u < Crossings.size())
                {
                    AccumulateSpan(Row, Crossings[Index].first, Crossings[Index + 1u].first, Weight, WidthPx);
                }
            }
        }
        for (uint32_t Px = 0u; Px < WidthPx; ++Px)
        {
            OutLayer[static_cast<std::size_t>(Py) * WidthPx + Px] = std::min(1.0f, Row[Px]);
        }
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    LABEL RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

QuickSymbol QuickSymbolRepository::ResolveNamed(std::string_view Name, QuickSymbol Missing) noexcept
{
    for (std::size_t Index = 0u; Index < QuickSymbolNames.size(); ++Index)
    {
        if (QuickSymbolNames[Index] == Name)
        {
            return static_cast<QuickSymbol>(Index);
        }
    }
    return Missing;
}

QuickSymbol QuickSymbolRepository::ResolveSymbol(std::string_view Label, std::string_view Context, std::string_view Fallback) noexcept
{
    if (!Fallback.empty() && ResolveNamed(Fallback, QuickSymbol::Count) != QuickSymbol::Count)
    {
        return ResolveNamed(Fallback, QuickSymbol::Toggle);
    }
    if (Label == "Enabled")
    {
        for (const LabelSymbolPair& Pair : EnabledByContext)
        {
            if (Pair.Label == Context)
            {
                return ResolveNamed(Pair.Symbol, QuickSymbol::Visible);
            }
        }
        return QuickSymbol::Visible;
    }
    for (const LabelSymbolPair& Pair : NamedLabels)
    {
        if (Pair.Label == Label)
        {
            return ResolveNamed(Pair.Symbol, QuickSymbol::Toggle);
        }
    }
    return QuickSymbol::Toggle;
}

std::span<const QuickSymbolLayer> QuickSymbolRepository::QueryLayers(QuickSymbol Symbol) noexcept
{
    std::size_t First = QuickSymbolLayers.size();
    std::size_t Count = 0u;
    for (std::size_t Index = 0u; Index < QuickSymbolLayers.size(); ++Index)
    {
        if (QuickSymbolLayers[Index].Symbol == Symbol)
        {
            First = std::min(First, Index);
            ++Count;
        }
    }
    return Count == 0u ? std::span<const QuickSymbolLayer>{} : std::span<const QuickSymbolLayer>(QuickSymbolLayers.data() + First, Count);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     MASK RASTER
//------------------------------------------------------------------------------------------------------------------------

void QuickSymbolRepository::RasterizeAlphaMask(
    QuickSymbol         Symbol,
    float               OriginX,
    float               OriginY,
    float               Size,
    uint32_t            WidthPx,
    uint32_t            HeightPx,
    std::vector<float>& OutAlpha) noexcept
{
    OutAlpha.assign(static_cast<std::size_t>(WidthPx) * HeightPx, 0.0f);
    std::vector<float> LayerMask{};
    const float        Scale = Size / ViewBox;
    for (const QuickSymbolLayer& Layer : QueryLayers(Symbol))
    {
        FillLayerMask(Layer, OriginX, OriginY, Scale, WidthPx, HeightPx, LayerMask);
        for (std::size_t Index = 0u; Index < OutAlpha.size(); ++Index)
        {
            const float Top = LayerMask[Index] * Layer.Opacity;
            OutAlpha[Index] = Top + OutAlpha[Index] * (1.0f - Top);
        }
    }
}

} // namespace Frontier
