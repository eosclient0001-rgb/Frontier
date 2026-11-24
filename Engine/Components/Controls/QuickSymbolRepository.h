/*============================================================================================================================================
                                                         QUICKSYMBOLREPOSITORY.H
============================================================================================================================================*/
// 🧩 Exact 1:1 port of ProjectZeroEditor ActionIcon.jsx: 44 solid 24x24 silhouettes (path, opacity, fill rule) + QuickSymbol() label rules

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

// Declaration order matches ActionIconNames in ActionIcon.jsx
enum class QuickSymbol : uint8_t
{
    Lock        = 0u,
    Shadow      = 1u,
    Gi          = 2u,
    Visible     = 3u,
    Sunlight    = 4u,
    Disc        = 5u,
    Stars       = 6u,
    Twinkle     = 7u,
    Cycle       = 8u,
    Motion      = 9u,
    Pause       = 10u,
    Orbit       = 11u,
    Wind        = 12u,
    Shear       = 13u,
    Cloud       = 14u,
    CloudSpawn  = 15u,
    Rain        = 16u,
    Collision   = 17u,
    Fog         = 18u,
    Rainbow     = 19u,
    Band        = 20u,
    Bake        = 21u,
    Image       = 22u,
    Anamorphic  = 23u,
    Streaks     = 24u,
    Starburst   = 25u,
    Construct   = 26u,
    Focus       = 27u,
    Split       = 28u,
    Diagnostics = 29u,
    Edit        = 30u,
    Simulate    = 31u,
    Play        = 32u,
    Settings    = 33u,
    Compass     = 34u,
    Horizon     = 35u,
    Atmosphere  = 36u,
    Galaxy      = 37u,
    Zodiac      = 38u,
    Tripod      = 39u,
    Vignette    = 40u,
    Toggle      = 41u,
    Debug       = 42u,
    Clock       = 43u,
    Count       = 44u,
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct QuickSymbolLayer
{
    QuickSymbol      Symbol  = QuickSymbol::Toggle; // [-]   - Owning silhouette
    float            Opacity = 1.0f;                // [0-1] - SVG element opacity attribute
    bool             EvenOdd = false;               // [-]   - fill-rule="evenodd" (otherwise nonzero)
    std::string_view SvgPath {};                   // [-]   - SVG 1.1 path in the 24x24 viewBox (shapes converted 1:1)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

class QuickSymbolRepository
{
public:
    static constexpr float ViewBox = 24.0f; // [px] - ActionIcon.jsx viewBox extent

    // QuickSymbol(Label, Context, Fallback) from ActionIcon.jsx; Fallback names a symbol the caller asked for ("" = none)
    [[nodiscard]] static QuickSymbol ResolveSymbol(std::string_view Label, std::string_view Context = {}, std::string_view Fallback = {}) noexcept;
    [[nodiscard]] static QuickSymbol ResolveNamed(std::string_view Name, QuickSymbol Missing) noexcept;

    [[nodiscard]] static std::span<const QuickSymbolLayer> QueryLayers(QuickSymbol Symbol) noexcept;

    // Straight-alpha mask (0..1) of the silhouette placed at (OriginX, OriginY) with edge Size, inside a WidthPx x HeightPx grid.
    // Each layer is filled with its fill rule, scaled by its opacity, and composited "over" the previous layers.
    static void RasterizeAlphaMask(
        QuickSymbol         Symbol,
        float               OriginX,
        float               OriginY,
        float               Size,
        uint32_t            WidthPx,
        uint32_t            HeightPx,
        std::vector<float>& OutAlpha) noexcept;
};

} // namespace Frontier
