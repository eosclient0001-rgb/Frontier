/*============================================================================================================================================
                                                        WHEELINPUTVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Replay registered GLFW wheel callbacks through the existing input exchange and native docked UV panes.

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Components/Appearance/TypographyRepository.h"
#include "Engine/Components/Docking/WorkspaceDockContainer.h"
#include "Engine/Configuration/EngineConfiguration.h"
#include "Engine/GeometricRaster/VulkanInterchange.h"
#include "Engine/GeometricRaster/UV/UVWorkspaceRasterizer.h"
#include "Engine/Input/InputExtension.h"
#include "Engine/Windowing/PlatformWindow.h"
#include "Engine/Workspaces/UV/UVWorkspaceHost.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS & TYPES
//------------------------------------------------------------------------------------------------------------------------

constexpr uint32_t SurfaceWidth  = 1600u; // [px] - Native dock surface width
constexpr uint32_t SurfaceHeight = 800u;  // [px] - Native dock surface height

struct WheelSample
{
    double HorizontalNotches = 0.0; // [step] - GLFW horizontal wheel offset
    double VerticalNotches   = 0.0; // [step] - GLFW vertical wheel offset
};

struct WheelInputValidation
{
    Frontier::Windowing::DesktopPlatformWindow             Window {};
    Frontier::Input::InputExtension                        InputCoordinator {};
    Frontier::Components::HeadlessWorkspaceDockContainer   Dock {};
    Frontier::Workspaces::UVWorkspaceHost                  Host {};
    GLFWwindow*                                           NativeWindow = nullptr;
    GLFWscrollfun                                         ScrollCallback = nullptr;
    GLFWcursorposfun                                      CursorCallback = nullptr;
    float                                                 ImGuiWheelX = 0.0f;
    float                                                 ImGuiWheelY = 0.0f;
    uint32_t                                              AssertionCount = 0u;
    uint32_t                                              FailureCount = 0u;

    bool Verify(bool Condition, const char* Description);
    void ExecuteTick(Frontier::Point2D Cursor, std::span<const WheelSample> Samples = {});
    void ExecuteWheel(Frontier::Point2D Cursor, double VerticalNotches);
    void StabilizeCursor(Frontier::Point2D Cursor);
    bool Capture(const std::filesystem::path& Destination);
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] Frontier::Rectangle2D InspectPaneBounds(std::string_view Title);
[[nodiscard]] bool VerifyDesktopLoopOrder(const std::filesystem::path& RepositoryRoot);
[[nodiscard]] uint64_t ComputeChangedChannelCount(const std::vector<uint8_t>& Before, const std::vector<uint8_t>& After);
[[nodiscard]] int ValidateWheelInput(const std::filesystem::path& RepositoryRoot, const std::filesystem::path& ImageDirectory);

//------------------------------------------------------------------------------------------------------------------------
//                                                CALLBACK & NATIVE UI REPLAY
//------------------------------------------------------------------------------------------------------------------------

bool WheelInputValidation::Verify(bool Condition, const char* Description)
{
    ++AssertionCount;
    if (!Condition) ++FailureCount;
    std::printf("[%s] %s\n", Condition ? "PASS" : "FAIL", Description);
    return Condition;
}

void WheelInputValidation::ExecuteTick(Frontier::Point2D Cursor, std::span<const WheelSample> Samples)
{
    // 📝 Use the installed platform callback, not a fabricated PaneInputReading or direct ImGui wheel injection.
    InputCoordinator.BeginTick();
    CursorCallback(NativeWindow, Cursor.X, Cursor.Y);
    for (const auto& Sample : Samples)
    {
        ScrollCallback(NativeWindow, Sample.HorizontalNotches, Sample.VerticalNotches);
    }
    Window.PollOperatingEvents(InputCoordinator);
    struct EditorIntake
    {
        void IntakeSignalPacket(const Frontier::Input::InputSignalPacket& Packet) noexcept
        {
            Frontier::WorkspaceAppearance::ForwardEditorInputToImGui(Packet);
        }
    } Intake;
    (void)InputCoordinator.TickExchangeWithSink(Intake);

    auto& Io = ImGui::GetIO();
    Io.DisplaySize = ImVec2(static_cast<float>(SurfaceWidth), static_cast<float>(SurfaceHeight));
    Io.DeltaTime   = 1.0f / 60.0f;
    ImGui::NewFrame();
    ImGuiWheelX = Io.MouseWheelH;
    ImGuiWheelY = Io.MouseWheel;
    Dock.PresentWindowImGuiPanes(Frontier::Components::HostWindowToken{ 0u });
    ImGui::Render();
}

void WheelInputValidation::ExecuteWheel(Frontier::Point2D Cursor, double VerticalNotches)
{
    const std::array<WheelSample, 1u> Samples {{ { 0.0, VerticalNotches } }};
    ExecuteTick(Cursor, Samples);
}

void WheelInputValidation::StabilizeCursor(Frontier::Point2D Cursor)
{
    // 📝 Keep ImGui's default event trickling enabled; settle pointer motion before asserting a wheel tick.
    ExecuteTick(Cursor);
    ExecuteTick(Cursor);
}

bool WheelInputValidation::Capture(const std::filesystem::path& Destination)
{
    Frontier::Exhibits::SoftwareRasterCanvas Canvas(SurfaceWidth, SurfaceHeight, { 14u, 14u, 16u, 255u });
    Canvas.RasterizeImGuiBatches(ImGui::GetDrawData());
    return Verify(Canvas.WritePngFile(Destination), Destination.filename().string().c_str());
}

Frontier::Rectangle2D InspectPaneBounds(std::string_view Title)
{
    const std::string Prefix = std::string(Title) + "##FRNT_";
    for (ImGuiWindow* Window : ImGui::GetCurrentContext()->Windows)
    {
        if (std::string_view(Window->Name).starts_with(Prefix))
        {
            return { Window->Pos.x, Window->Pos.y, Window->Size.x, Window->Size.y };
        }
    }
    return {};
}

bool VerifyDesktopLoopOrder(const std::filesystem::path& RepositoryRoot)
{
    // 📝 The runtime replay also guards the actual caller: otherwise a correct unit test could hide an undrained desktop loop.
    std::ifstream Source(RepositoryRoot / "Engine/Lifecycle/DesktopWorkspaceLaunch.cpp");
    const std::string Text((std::istreambuf_iterator<char>(Source)), std::istreambuf_iterator<char>());
    const auto Begin    = Text.find("InputCoordinator.BeginTick();");
    const auto Poll     = Text.find("DesktopWindow.PollOperatingEvents(InputCoordinator);", Begin);
    const auto Drain    = Text.find("InputCoordinator.TickExchangeWithSink(EditorIntake);", Poll);
    const auto Extent   = Text.find("DesktopWindow.InspectExtent();", Poll);
    const auto Minimized = Text.find("if (Extent.SurfacePixelWidth == 0u", Poll);
    const auto NewTick  = Text.find("ImGui::NewFrame();", Poll);
    return Begin != std::string::npos && Poll != std::string::npos && Drain != std::string::npos &&
        Extent != std::string::npos && Minimized != std::string::npos && NewTick != std::string::npos &&
        Begin < Poll && Poll < Drain && Drain < Extent && Extent < Minimized && Minimized < NewTick &&
        Text.find("SynchronizeGlfwToImGui") == std::string::npos &&
        Text.find("glfwGetKey(") == std::string::npos && Text.find("glfwGetMouseButton(") == std::string::npos &&
        Text.find("glfwGetCursorPos(") == std::string::npos;
}

uint64_t ComputeChangedChannelCount(const std::vector<uint8_t>& Before, const std::vector<uint8_t>& After)
{
    if (Before.size() != After.size()) return 0u;
    uint64_t ChangedCount = 0u;
    for (std::size_t ChannelIndex = 0u; ChannelIndex < Before.size(); ++ChannelIndex)
    {
        ChangedCount += Before[ChannelIndex] != After[ChannelIndex] ? 1u : 0u;
    }
    return ChangedCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FOCUSED VALIDATION
//------------------------------------------------------------------------------------------------------------------------

int ValidateWheelInput(const std::filesystem::path& RepositoryRoot, const std::filesystem::path& ImageDirectory)
{
    using namespace Frontier;
    using namespace Frontier::Workspaces;

    std::filesystem::create_directories(ImageDirectory);
    GeometricRaster::VulkanInterchange Device {};
    std::string Diagnostic;
    if (!Device.InitializeInterchange(RepositoryRoot, &Diagnostic))
    {
        std::fprintf(stderr, "Vulkan initialization failed: %s\n", Diagnostic.c_str());
        return 1;
    }
    GeometricRaster::UVWorkspaceRasterizer Rasterizer {};
    if (!Rasterizer.InitializeRasterizer(&Device, std::filesystem::path(FRONTIER_COMPILED_SHADER_DIR))) return 1;

    WheelInputValidation Validation {};
    const auto WindowConfiguration = Windowing::WindowConfigurationDescriptor::ConstructApplicationWindow(
        "UV Wheel Validation", SurfaceWidth, SurfaceHeight, false);
    if (!Validation.Window.Initialize(WindowConfiguration)) return 1;
    Validation.NativeWindow = static_cast<GLFWwindow*>(Validation.Window.NativeGlfwHandle());
    Validation.CursorCallback = glfwSetCursorPosCallback(Validation.NativeWindow, nullptr);
    glfwSetCursorPosCallback(Validation.NativeWindow, Validation.CursorCallback);
    Validation.ScrollCallback = glfwSetScrollCallback(Validation.NativeWindow, nullptr);
    glfwSetScrollCallback(Validation.NativeWindow, Validation.ScrollCallback);
    if (!Validation.Verify(Validation.ScrollCallback != nullptr, "desktop window installed its real GLFW scroll callback")) return 1;
    Validation.InputCoordinator.Initialize();
    Validation.Verify(
        VerifyDesktopLoopOrder(RepositoryRoot),
        "desktop loop drains editor packets before minimized-window branch without UI device polling");

    // ① Reproduce the original loop's omitted TickExchange using a separate existing InputExtension.
    Input::InputExtension UndrainedInput {};
    UndrainedInput.Initialize();
    UndrainedInput.BeginTick();
    Validation.ScrollCallback(Validation.NativeWindow, 0.0, -1.0);
    Validation.Window.PollOperatingEvents(UndrainedInput);
    Validation.Verify(
        UndrainedInput.InspectExchange().PendingSignalCount() > 0u &&
            UndrainedInput.InspectPointerSnapshot().ScrollDeltaY == 0.0f,
        "REPRODUCED original defect: callback packet queued, wheel snapshot remains zero without TickExchange");
    (void)UndrainedInput.TickExchange();
    Validation.Verify(
        UndrainedInput.InspectExchange().PendingSignalCount() == 0u &&
            UndrainedInput.InspectPointerSnapshot().ScrollDeltaY == -1.0f,
        "existing InputExtension::TickExchange alone restores the missing wheel delta");
    UndrainedInput.Finalize();

    const Configuration::EngineConfiguration LaunchConfiguration(
        Configuration::EngineConfiguration::ConstructStandaloneUVDefault());
    Validation.Host.ConfigureLaunchPolicy(LaunchConfiguration);
    if (!Validation.Verify(Validation.Host.AttachVulkanRasterizer(&Rasterizer), "attach production Vulkan UV rasterizer")) return 1;
    if (!Validation.Verify(Validation.Dock.Initialize(WindowConfiguration), "initialize native docked UV workspace")) return 1;
    Validation.Host.RegisterDockPanes(Validation.Dock);
    auto& Session = Validation.Host.AccessSession();
    auto& Projection = Session.AccessViewportProjection();
    for (uint32_t LayerIndex = 0u; LayerIndex < 16u; ++LayerIndex)
    {
        (void)Session.CreatePriorityLayer("Scroll layer " + std::to_string(LayerIndex + 1u), { 0.62f, 0.81f, 1.0f }, 0.0f);
    }
    Validation.StabilizeCursor({ 4.0f, 4.0f });
    Validation.ExecuteTick({ 4.0f, 4.0f });
    const auto OutlinerBounds  = InspectPaneBounds("Outliner");
    const auto InspectorBounds = InspectPaneBounds("Inspector");
    const auto ViewportBounds  = InspectPaneBounds("Viewport");
    if (!Validation.Verify(
        OutlinerBounds.Width > 100.0f && InspectorBounds.Width > 100.0f && ViewportBounds.Width > 300.0f,
        "all three real docked panes rendered")) return 1;
    Validation.Capture(ImageDirectory / "Before.png");
    const Point2D InspectorCursor { InspectorBounds.X + InspectorBounds.Width * 0.5f, InspectorBounds.Y + InspectorBounds.Height * 0.65f };
    const Point2D OutlinerCursor  { OutlinerBounds.X + OutlinerBounds.Width * 0.5f, OutlinerBounds.Y + OutlinerBounds.Height * 0.65f };
    const Point2D PlanarCursor    { ViewportBounds.X + ViewportBounds.Width * 0.30f, ViewportBounds.Y + ViewportBounds.Height * 0.60f };
    const Point2D SpatialCursor   { ViewportBounds.X + ViewportBounds.Width * 0.75f, ViewportBounds.Y + ViewportBounds.Height * 0.60f };
    const float InitialZoom     = Projection.InspectPlanarWindow().ZoomScale;
    const float InitialDistance = Projection.InspectSpatialCamera().DistanceMeters;

    // ② Inspector scrolling, direction, clamping, idle reset, and independent pointer ownership.
    Validation.StabilizeCursor(InspectorCursor);
    Validation.ExecuteWheel(InspectorCursor, -3.0);
    const float InspectorDown = Validation.Host.AccessInspector().InspectVerticalScroll();
    Validation.Verify(
        Validation.ImGuiWheelY == -3.0f,
        "GLFW wheel delta reaches ImGui through both existing exchanges");
    Validation.Verify(
        std::abs(InspectorDown - 84.0f) < 0.01f,
        "Inspector wheel-down moves content by 84 pixels");
    Validation.Verify(
        Validation.Host.AccessOutliner().InspectVerticalScroll() == 0.0f,
        "Inspector scrolling does not scroll Outliner");
    Validation.Verify(
        Projection.InspectPlanarWindow().ZoomScale == InitialZoom && Projection.InspectSpatialCamera().DistanceMeters == InitialDistance,
        "Inspector scrolling does not zoom either viewport");
    Validation.ExecuteTick(InspectorCursor);
    Validation.Verify(
        Validation.ImGuiWheelY == 0.0f && Validation.InputCoordinator.InspectPointerSnapshot().ScrollDeltaY == 0.0f &&
            Validation.Host.AccessInspector().InspectVerticalScroll() == InspectorDown,
        "idle tick clears the wheel delta and does not repeat scrolling");
    Validation.ExecuteWheel(InspectorCursor, 1.0);
    Validation.Verify(
        std::abs(Validation.Host.AccessInspector().InspectVerticalScroll() - 56.0f) < 0.01f,
        "Inspector wheel-up reverses scrolling");
    Validation.ExecuteWheel(InspectorCursor, -100.0);
    const float InspectorBottom = Validation.Host.AccessInspector().InspectVerticalScroll();
    Validation.ExecuteWheel(InspectorCursor, -100.0);
    Validation.Verify(
        InspectorBottom > 0.0f && Validation.Host.AccessInspector().InspectVerticalScroll() == InspectorBottom,
        "Inspector clamps at its content bottom");
    Validation.ExecuteWheel(InspectorCursor, 100.0);
    Validation.Verify(
        Validation.Host.AccessInspector().InspectVerticalScroll() == 0.0f,
        "Inspector can scroll all the way back to the top");

    // ③ Outliner scrolling uses overflowing layer content and leaves the viewport cameras unchanged.
    Validation.StabilizeCursor(OutlinerCursor);
    Validation.ExecuteWheel(OutlinerCursor, -2.0);
    Validation.Verify(
        std::abs(Validation.Host.AccessOutliner().InspectVerticalScroll() - 56.0f) < 0.01f,
        "Outliner wheel-down moves layer content by 56 pixels");
    Validation.Verify(
        Validation.Host.AccessInspector().InspectVerticalScroll() == 0.0f,
        "Outliner scrolling does not scroll Inspector");
    Validation.ExecuteWheel(OutlinerCursor, 1.0);
    Validation.Verify(
        std::abs(Validation.Host.AccessOutliner().InspectVerticalScroll() - 28.0f) < 0.01f,
        "Outliner wheel-up reverses scrolling");
    Validation.ExecuteWheel(OutlinerCursor, -100.0);
    const float OutlinerBottom = Validation.Host.AccessOutliner().InspectVerticalScroll();
    Validation.ExecuteWheel(OutlinerCursor, -100.0);
    Validation.Verify(
        OutlinerBottom > 0.0f && Validation.Host.AccessOutliner().InspectVerticalScroll() == OutlinerBottom,
        "Outliner clamps at its layer-list bottom");
    Validation.ExecuteWheel(OutlinerCursor, 100.0);
    Validation.Verify(
        Validation.Host.AccessOutliner().InspectVerticalScroll() == 0.0f,
        "Outliner can scroll all the way back to the top");
    Validation.Verify(
        Projection.InspectPlanarWindow().ZoomScale == InitialZoom && Projection.InspectSpatialCamera().DistanceMeters == InitialDistance,
        "Outliner scrolling does not zoom either viewport");

    // ④ Exercise zoom through PresentInImGuiPane, not direct camera/interactor calls.
    Validation.StabilizeCursor(PlanarCursor);
    const auto PlanarPixelsBefore = Session.Framebuffer2DRGBA;
    Validation.ExecuteWheel(PlanarCursor, 1.0);
    const float PlanarZoomIn = Projection.InspectPlanarWindow().ZoomScale;
    const uint64_t PlanarChanged = ComputeChangedChannelCount(PlanarPixelsBefore, Session.Framebuffer2DRGBA);
    Validation.Verify(
        PlanarZoomIn > InitialZoom,
        "2D viewport wheel-up zooms in through the native pane");
    Validation.Verify(
        PlanarChanged > 100u,
        "2D zoom changes the actual Vulkan framebuffer pixels");
    Validation.Verify(
        Projection.InspectSpatialCamera().DistanceMeters == InitialDistance,
        "2D zoom does not move the 3D camera");
    Validation.ExecuteWheel(PlanarCursor, -1.0);
    Validation.Verify(
        std::abs(Projection.InspectPlanarWindow().ZoomScale - InitialZoom) < 0.0001f,
        "2D viewport wheel-down reverses zoom");

    Validation.StabilizeCursor(SpatialCursor);
    const auto SpatialPixelsBefore = Session.Framebuffer3DRGBA;
    const auto CameraBefore = Projection.InspectSpatialCamera();
    Validation.ExecuteWheel(SpatialCursor, 1.0);
    const float SpatialZoomIn = Projection.InspectSpatialCamera().DistanceMeters;
    Validation.ExecuteTick(SpatialCursor);
    const uint64_t SpatialChanged = ComputeChangedChannelCount(SpatialPixelsBefore, Session.Framebuffer3DRGBA);
    Validation.Verify(
        SpatialZoomIn < InitialDistance,
        "3D viewport wheel-up dollies the camera closer");
    Validation.Verify(
        SpatialChanged > 100u,
        "3D zoom changes the actual Vulkan framebuffer pixels");
    Validation.Verify(
        Projection.InspectSpatialCamera().YawRadians == CameraBefore.YawRadians &&
            Projection.InspectSpatialCamera().PitchRadians == CameraBefore.PitchRadians,
        "3D wheel zoom does not rotate the camera");
    Validation.Verify(
        std::abs(Projection.InspectPlanarWindow().ZoomScale - InitialZoom) < 0.0001f,
        "3D zoom does not zoom the 2D viewport");
    Validation.ExecuteWheel(SpatialCursor, -1.0);
    Validation.Verify(
        std::abs(Projection.InspectSpatialCamera().DistanceMeters - InitialDistance) < 0.0001f,
        "3D viewport wheel-down reverses the dolly");

    // ⑤ Header regions must not consume viewport navigation or panel scrolling.
    const Point2D HeaderCursor { ViewportBounds.X + ViewportBounds.Width * 0.5f, ViewportBounds.Y + 45.0f };
    Validation.StabilizeCursor(HeaderCursor);
    Validation.ExecuteWheel(HeaderCursor, -2.0);
    Validation.Verify(
        std::abs(Projection.InspectPlanarWindow().ZoomScale - InitialZoom) < 0.0001f &&
            std::abs(Projection.InspectSpatialCamera().DistanceMeters - InitialDistance) < 0.0001f &&
            Validation.Host.AccessOutliner().InspectVerticalScroll() == 0.0f && Validation.Host.AccessInspector().InspectVerticalScroll() == 0.0f,
        "wheel over viewport header does not leak into cameras or side panels");

    // ⑥ More than a queue-capacity worth of fractional wheel callbacks, drained on every tick.
    const Point2D OutsideCursor { 4.0f, 4.0f };
    Validation.StabilizeCursor(OutsideCursor);
    std::array<WheelSample, 48u> Burst {};
    Burst.fill({ 0.125, -0.25 });
    bool AllBurstTicksCorrect = true;
    for (uint32_t TickIndex = 0u; TickIndex < 40u; ++TickIndex)
    {
        Validation.ExecuteTick(OutsideCursor, Burst);
        AllBurstTicksCorrect = AllBurstTicksCorrect && Validation.ImGuiWheelX == 6.0f && Validation.ImGuiWheelY == -12.0f &&
            Validation.InputCoordinator.InspectExchange().PendingSignalCount() == 0u;
    }
    Validation.Verify(
        AllBurstTicksCorrect,
        "1920 fractional GLFW callbacks accumulate both axes correctly across 40 ticks");
    Validation.Verify(
        Validation.InputCoordinator.InspectExchange().DroppedSignalCount() == 0u,
        "continued input does not fill or overflow the existing input ring");
    Validation.ExecuteTick(OutsideCursor);
    Validation.Verify(
        Validation.ImGuiWheelX == 0.0f && Validation.ImGuiWheelY == 0.0f,
        "horizontal and vertical deltas both reset on an idle tick");

    // ⑦ Retain a native rendered result with both side panels scrolled and both viewports zoomed.
    Validation.StabilizeCursor(InspectorCursor);
    Validation.ExecuteWheel(InspectorCursor, -6.0);
    Validation.StabilizeCursor(OutlinerCursor);
    Validation.ExecuteWheel(OutlinerCursor, -8.0);
    Validation.StabilizeCursor(PlanarCursor);
    Validation.ExecuteWheel(PlanarCursor, 1.0);
    Validation.ExecuteWheel(PlanarCursor, 1.0);
    Validation.StabilizeCursor(SpatialCursor);
    Validation.ExecuteWheel(SpatialCursor, 1.0);
    Validation.ExecuteWheel(SpatialCursor, 1.0);
    Validation.StabilizeCursor(OutsideCursor);
    Validation.Capture(ImageDirectory / "After.png");
    std::printf(
        "MEASUREMENTS InspectorDown=%.3f OutlinerBottom=%.3f PlanarZoom=%.6f->%.6f "
        "SpatialDistance=%.6f->%.6f PlanarChangedChannels=%llu SpatialChangedChannels=%llu\n",
        InspectorDown,
        OutlinerBottom,
        InitialZoom,
        PlanarZoomIn,
        InitialDistance,
        SpatialZoomIn,
        static_cast<unsigned long long>(PlanarChanged),
        static_cast<unsigned long long>(SpatialChanged));
    std::printf(
        "CAPTURE InspectorScroll=%.3f OutlinerScroll=%.3f PlanarZoom=%.6f SpatialDistance=%.6f DroppedSignals=%llu\n",
        Validation.Host.AccessInspector().InspectVerticalScroll(),
        Validation.Host.AccessOutliner().InspectVerticalScroll(),
        Projection.InspectPlanarWindow().ZoomScale,
        Projection.InspectSpatialCamera().DistanceMeters,
        static_cast<unsigned long long>(Validation.InputCoordinator.InspectExchange().DroppedSignalCount()));
    std::printf("RESULT %u/%u assertions passed\n", Validation.AssertionCount - Validation.FailureCount, Validation.AssertionCount);
    Validation.Dock.Finalize();
    Validation.InputCoordinator.Finalize();
    return Validation.FailureCount == 0u ? 0 : 1;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       ENTRY POINT
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** Arguments)
{
    const std::filesystem::path RepositoryRoot = std::filesystem::path(FRONTIER_REPO_ROOT_DIR);
    const std::filesystem::path ImageDirectory = ArgumentCount > 1
        ? std::filesystem::path(Arguments[1]) : RepositoryRoot / "Exhibits/UVWorkspaceRepair/Images/WheelRegression";
    ImGuiContext* Context = ImGui::CreateContext();
    auto& Io = ImGui::GetIO();
    Io.IniFilename = nullptr;
    Io.LogFilename = nullptr;
    Io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    Frontier::TypographyRepository Typefaces {};
    (void)Typefaces.LoadRepository(RepositoryRoot / "EngineContent/FontsArchives");
    Frontier::TypographyRepository::AssignCurrent(&Typefaces);
    if (ImFont* Font = Typefaces.QueryTabStripFont()) Io.FontDefault = Font;
    unsigned char* AtlasPixels = nullptr;
    int AtlasWidth = 0;
    int AtlasHeight = 0;
    Io.Fonts->GetTexDataAsRGBA32(&AtlasPixels, &AtlasWidth, &AtlasHeight);
    const int Result = ValidateWheelInput(RepositoryRoot, ImageDirectory);
    Frontier::TypographyRepository::AssignCurrent(nullptr);
    ImGui::DestroyContext(Context);
    return Result;
}
