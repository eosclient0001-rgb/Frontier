/*============================================================================================================================================
                                                            UVVIEWPORTHOST.H
============================================================================================================================================*/
// 🧩 UV Workspace center viewport canvas matching Experimental/UVEditor (2-row header, tool rail, UV transform readout & native browser shelf)

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Components/Panes/ViewportProjectionPane.h"
#include "Engine/Workspaces/UV/UVViewportInteractor.h"
#include "Engine/Workspaces/UV/UVWorkspaceSession.h"

namespace Frontier::Workspaces
{

struct UVViewportChromeLayout
{
    Point2D     ScreenOrigin    {};
    float       InterfaceScale  = 1.0f;
    Rectangle2D SurfaceDropdown {};
    Rectangle2D DebugDropdown   {};
    Rectangle2D ViewDropdown    {};
    Rectangle2D Canvas         {};
    Rectangle2D Planar         {};
    Rectangle2D Spatial        {};
};

class UVViewportHost
{
public:
    UVViewportHost();
    ~UVViewportHost();

    UVViewportHost(const UVViewportHost&)            = delete;
    UVViewportHost& operator=(const UVViewportHost&) = delete;

    void AttachSession(UVWorkspaceSession* TargetSession) noexcept;

    [[nodiscard]] ViewportProjectionPane&       AccessProjectionPane() noexcept { return ProjectionPane; }
    [[nodiscard]] const ViewportProjectionPane& InspectProjectionPane() const noexcept { return ProjectionPane; }
    [[nodiscard]] UVViewportInteractor&         AccessInteractor() noexcept { return Interactor; }

    [[nodiscard]] const UVViewportChromeLayout& InspectLayout() const noexcept { return ChromeLayout; }

    void Render(
        PixelSpace&             Surface,
        Rectangle2D             Bounds,
        const PaneInputReading& Input,
        double                  Δt);

    void PresentInImGuiPane(double Δt, float ScaleFactor = 1.0f);

private:
    void SynchronizeProjectionPolicy() noexcept;
    void RefreshCachedIslandCount() noexcept;

    UVWorkspaceSession*    Session               = nullptr;
    UVViewportInteractor   Interactor            {};
    ViewportProjectionPane ProjectionPane        {};
    bool                   MoreShelfExpanded     = false;
    bool                   ProjectionDropdownOpen = false;
    bool                   SurfaceDropdownOpen    = false;
    bool                   DebugDropdownOpen      = false;
    double                 ViewportStepSeconds    = 1.0 / 60.0;
    UVViewportChromeLayout ChromeLayout           {};
    uint32_t               ActiveRailSlot        = 0u;
    uint64_t               CachedUVRevision      = UINT64_MAX;
    uint32_t               CachedChartCount      = 0u;
};

} // namespace Frontier::Workspaces
