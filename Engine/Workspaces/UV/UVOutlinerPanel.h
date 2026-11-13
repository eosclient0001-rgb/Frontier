/*============================================================================================================================================
                                                            UVOUTLINERPANEL.H
============================================================================================================================================*/
// 🧩 Native UV Space Outliner using HTML reference card geometry, ControlCentre styling and sharp-cornered layer rows

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Components/Controls/TextInputField.h"
#include "Engine/Components/Panes/WorkspaceAppearance.h"
#include "Engine/Workspaces/UV/UVWorkspaceSession.h"

#include <array>
#include <vector>

namespace Frontier::Workspaces
{

struct UVOutlinerCardLayout
{
    Point2D                     ScreenOrigin   {};
    float                       InterfaceScale = 1.0f;
    Rectangle2D                 UDIMFilter     {};
    std::array<Rectangle2D, 3u> KPICards        {};
    std::array<Rectangle2D, 2u> DiagnosticCards {};
    Rectangle2D                 FirstLayerRow  {};
};

class UVOutlinerPanel
{
public:
    UVOutlinerPanel() noexcept = default;

    void AttachSession(UVWorkspaceSession* TargetSession) noexcept;
    [[nodiscard]] float InspectVerticalScroll() const noexcept;
    [[nodiscard]] const UVOutlinerCardLayout& InspectCardLayout() const noexcept { return CardLayout; }

    void Render(
        PixelSpace&             Surface,
        Rectangle2D             Bounds,
        const PaneInputReading& Input,
        double                  Δt);

    void PresentInImGuiPane(double Δt, float ScaleFactor = 1.0f);

private:
    void RefreshCachedAtlasTelemetry();

    UVOutlinerCardLayout CardLayout             {};
    UVWorkspaceSession* Session                 = nullptr;
    uint32_t            CreatedLayerCount       = 3u;
    uint32_t            UDIMFilterCode          = 0u; // 0 = All UDIMs
    bool                UDIMFilterDropdownOpen  = false;
    float               ScrollOffsetY           = 0.0f;
    TextEditBuffer      SearchEditBuffer        {};
    TextEditBuffer      RenameEditBuffer        {};
    uint16_t            RenamingLayerOrd        = 0u;
    uint16_t            ColorPickerLayerOrdinal = 0u;

    uint64_t            CachedNetworkRevision   = UINT64_MAX;
    uint64_t            CachedUVRevision        = UINT64_MAX;
    uint64_t            CachedLayerAssignmentSignature = UINT64_MAX;
    uint32_t            CachedIslandCount       = 0u;
    std::vector<uint32_t> CachedFaceIslandOrdinal {};
    std::vector<uint32_t> CachedIslandUDIMNumber {};
    std::vector<uint16_t> CachedIslandLayerOrdinal {};
    std::vector<float>   CachedIslandUVArea {};
    float               CachedUtilizationPct    = 0.0f;
    float               CachedStretchCautionPct = 0.0f;
};

} // namespace Frontier::Workspaces
