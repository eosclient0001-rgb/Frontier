/*============================================================================================================================================
                                                               PROJECTBROWSER.H
============================================================================================================================================*/
// 🧩 Native C++20 Project Browser built strictly on PixelSpace, Engine/Components/Controls, TieredWorldRenderSequence, & ProjectGenerator

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Components/Appearance/ThemeRepository.h"
#include "Engine/Components/Controls/TextInputField.h"
#include "Engine/Components/PixelSpace.h"
#include "Engine/Configuration/ProjectGenerator.h"
#include "Engine/GeometricRaster/GlobalIllumination/ShowcaseGalleryScene.h"
#include "Engine/GeometricRaster/GlobalIllumination/TieredWorldRenderSequence.h"
#include "Engine/Workspaces/WorkspaceCapabilityRegister.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

struct ImTextureData;

namespace Frontier::GeometricRaster
{
class VulkanInterchange;
class VulkanWorldRenderSequence;
}

namespace Frontier::Editor::Explorer
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

enum class BrowserFilterMode : uint8_t
{
    AllFiles = 0u,
    Recent   = 1u,
    Starred  = 2u,
    Projects = 3u,
    Cad      = 4u,
    Geometry = 5u,
};

enum class BrowserEntryCategory : uint8_t
{
    Project  = 0u,
    Cad      = 1u,
    Geometry = 2u,
};

enum class BrowserInspectorTab : uint8_t
{
    Details  = 0u,
    Comments = 1u,
    History  = 2u,
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct BrowserReviewNote
{
    std::string AuthorName {};
    std::string Initial    {};
    std::string BodyText   {};
    std::string Timestamp  {};
};

struct BrowserCollectionEntry
{
    std::string                   Identifier      {};
    std::string                   Title           {};
    std::string                   Suffix       {};
    BrowserEntryCategory          Category        = BrowserEntryCategory::Project;
    std::string                   SummaryCaption  {};
    std::string                   Description     {};
    std::string                   LastOpenedText  {};
    std::filesystem::path         FilePath        {};
    std::vector<std::string>      ViewTitles      {};
    std::vector<std::string>      RevisionTitles  {};
    std::vector<BrowserReviewNote> Notes          {};
    bool                          Starred         = false;
    bool                          LocalDiskEntry  = false;
    uint32_t                      CameraPresetIdx = 0u;
    std::unique_ptr<ImTextureData> ThumbnailTex   {};
    std::vector<uint8_t>          ThumbnailRgba   {};
    uint32_t                      ThumbnailW      = 0u;
    uint32_t                      ThumbnailH      = 0u;
};

struct BrowserWorkspaceLaunchDirective
{
    Workspaces::HostWorkspaceTarget TargetWorkspace     = Workspaces::HostWorkspaceTarget::FrontierWorld;
    std::string                     ProjectTitle        {};
    std::filesystem::path           SelectedFilePath    {};
    bool                            BlankPlaneSkyScene  = false; // [-] - True for newly created projects (blank plane & sky)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

class ProjectBrowser
{
public:
    using LaunchWorkspaceCallback = std::function<void(const BrowserWorkspaceLaunchDirective&)>;

    ProjectBrowser();
    ~ProjectBrowser();

    ProjectBrowser(const ProjectBrowser&)            = delete;
    ProjectBrowser& operator=(const ProjectBrowser&) = delete;

    void AttachVulkanWorldRenderer(
        GeometricRaster::VulkanInterchange* DeviceInterchange,
        const std::filesystem::path&        CompiledShaderDirectory);

    void InitializeDefaultCollection(
        const std::filesystem::path& DefaultProjectsDirectory = {},
        const std::filesystem::path& FrontierRootDirectory    = {},
        const std::filesystem::path& FrontierBinariesDir      = {});

    void ReleaseGpuTextures() noexcept;

    void AssignLaunchWorkspaceCallback(LaunchWorkspaceCallback Callback);
    void ConfigureThemePreset(ThemePreset Preset) noexcept;
    [[nodiscard]] ThemePreset QueryThemePreset() const noexcept { return ActiveTheme; }

    void OpenNewProjectSheet(std::string_view InitialName = "AeroGallery", const std::filesystem::path& DestinationFolder = {});
    [[nodiscard]] Configuration::ProjectScaffoldOutcome TriggerCreateProjectFromDraft(bool LaunchImmediately);
    bool RegisterDiskPathInCollection(const std::filesystem::path& DiskPath, bool ActivateInReader = true);
    uint32_t ScanFolderForEntries(const std::filesystem::path& FolderPath);

    void ActivateEntryByIndex(int32_t EntryIndex) noexcept;
    void ReturnToLibrary() noexcept;

    [[nodiscard]] bool                            QueryReaderActive() const noexcept { return ActiveEntryIndex >= 0; }
    [[nodiscard]] int32_t                         QueryActiveEntryIndex() const noexcept { return ActiveEntryIndex; }
    [[nodiscard]] float                           QueryLeftRailWidth() const noexcept { return LeftRailWidth; }
    [[nodiscard]] float                           QueryRightPaneWidth() const noexcept { return RightPaneWidth; }
    [[nodiscard]] bool                            QueryLeftRailCollapsed() const noexcept { return LeftRailCollapsed; }
    [[nodiscard]] std::span<const BrowserCollectionEntry> QueryCollection() const noexcept { return Collection; }
    [[nodiscard]] const Workspaces::WorkspaceCapabilityRegister& QueryCapabilities() const noexcept { return CapabilityRegister; }

    void Render(Rectangle2D ViewportBounds, double DeltaSeconds, float DpiScale = 1.0f);

private:
    void EnsurePreviewRendererReady();
    void RenderThumbnailForEntry(BrowserCollectionEntry& Entry, uint32_t ViewOrdinal = 0u);
    void RefreshReaderPreviewTexture();

    void RenderLibraryMode(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer, double DeltaSeconds);
    void RenderReaderMode(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer, double DeltaSeconds);
    void RenderNewProjectModal(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer);

    // Side panes: eased open / collapse (PanelLayout.css cubic-bezier(.22,.8,.24,1), 0.32 s) and draggable inner edges
    [[nodiscard]] ControlPointer ResolvePaneColumns(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer, double DeltaSeconds);
    void                         ConstructPaneEdges(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer) const;
    [[nodiscard]] ControlPointer ResolvePaneContentPointer(const ControlPointer& Pointer, bool Collapsed) const noexcept;
    [[nodiscard]] float          ConfigurePaneOpenWidth(bool LeftSide, float Width, float ViewWidth) noexcept;
    void RenderDiskPathModal(PixelSpace& Surface, Rectangle2D LogicalBounds, const ControlPointer& Pointer);

    Workspaces::WorkspaceCapabilityRegister                         CapabilityRegister   {};
    std::vector<BrowserCollectionEntry>                             Collection           {};
    std::unique_ptr<GeometricRaster::ShowcaseWorldSceneBundle>      PreviewSceneBundle   {};
    std::unique_ptr<GeometricRaster::TieredWorldRenderSequence>     PreviewWorldRenderer {};
    std::unique_ptr<GeometricRaster::VulkanWorldRenderSequence>     GpuPreviewRenderer   {};
    std::unique_ptr<ImTextureData>                                  ReaderPreviewTex     {};
    std::vector<std::unique_ptr<ImTextureData>>                  ReaderViewThumbs     {};
    std::vector<uint8_t>                                         ReaderPreviewRgba    {};
    uint32_t                                                     ReaderPreviewW       = 0u;
    uint32_t                                                     ReaderPreviewH       = 0u;

    ThemePreset             ActiveTheme           = ThemePreset::Oled;
    BrowserFilterMode       ActiveFilter          = BrowserFilterMode::AllFiles;
    BrowserInspectorTab     ActiveInspectorTab    = BrowserInspectorTab::Details;
    int32_t                 ActiveEntryIndex      = -1;
    uint32_t                ActiveViewIndex       = 0u;
    uint32_t                ActiveRevisionIndex   = 0u;
    uint32_t                SortModeIndex         = 0u;
    float                   ReaderZoomPercent     = 100.0f;
    float                   LibraryScrollY        = 0.0f;
    bool                    LeftRailCollapsed     = false;
    bool                    RightPaneCollapsed    = false;
    float                   LeftRailOpenWidth     = 204.0f; // [px]  - Dragged open width of the left rail (160..380)
    float                   RightPaneOpenWidth    = 302.0f; // [px]  - Dragged open width of the right pane (240..520)
    float                   LeftRailClock         = 1.0f;   // [s]   - Time since the left rail's open / collapsed target changed
    float                   RightPaneClock        = 1.0f;   // [s]   - Time since the right pane's open / collapsed target changed
    float                   LeftRailFrom          = 204.0f; // [px]  - Width the current left rail transition started from
    float                   RightPaneFrom         = 302.0f; // [px]  - Width the current right pane transition started from
    bool                    LeftRailWasCollapsed  = false;  // [-]   - Target the left rail transition is heading to
    bool                    RightPaneWasCollapsed = false;  // [-]   - Target the right pane transition is heading to
    float                   LeftRailSlide         = 0.0f;   // [px]  - Content translateX (0 open, -14 collapsed)
    float                   RightPaneSlide        = 0.0f;   // [px]  - Content translateX (0 open, +14 collapsed)
    float                   LeftRailFade          = 1.0f;   // [0-1] - Left rail content opacity
    float                   RightPaneFade         = 1.0f;   // [0-1] - Right pane content opacity
    float                   LeftRailWidth         = 204.0f; // [px]  - Eased on-screen width of the left rail this frame
    float                   RightPaneWidth        = 302.0f; // [px]  - Eased on-screen width of the right pane this frame
    int32_t                 PaneDragSide          = 0;      // [-]   - 0 none, 1 left edge, 2 right edge
    float                   PaneDragStartX        = 0.0f;   // [px]  - Pointer X when the edge drag began
    float                   PaneDragStartWidth    = 0.0f;   // [px]  - On-screen pane width when the edge drag began
    float                   PaneDragOpenWidth     = 0.0f;   // [px]  - Open width restored when a drag snaps the pane shut
    bool                    SortDropdownOpen      = false;
    bool                    RevisionDropdownOpen  = false;
    bool                    NewProjectModalOpen   = false;
    bool                    DiskPathModalOpen     = false;

    TextEditBuffer          SearchInput           {};
    TextEditBuffer          CommentInput          {};
    TextEditBuffer          DraftProjectNameInput    {};
    TextEditBuffer          DraftDestinationDirInput {};
    TextEditBuffer          DiskPathInput            {};

    std::filesystem::path   DefaultProjectsDir    {};
    std::filesystem::path   FrontierRootDir       {};
    std::filesystem::path   FrontierBinariesDir   {};
    std::string             StatusBannerMessage   {};
    double                  StatusBannerRemaining = 0.0;
    LaunchWorkspaceCallback LaunchCallback        {};
};

} // namespace Frontier::Editor::Explorer
