/*============================================================================================================================================
                                                   WORKSPACEINTERACTIONVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Installed GLFW callback replay through production editor intake, UV controls, camera motion and Vulkan resize presentation

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Components/Appearance/TypographyRepository.h"
#include "Engine/Components/Controls/DropdownSelector.h"
#include "Engine/Components/Docking/WorkspaceDockContainer.h"
#include "Engine/Components/Panes/WorkspaceAppearance.h"
#include "Engine/Configuration/BuildConfiguration.h"
#include "Engine/GeometricRaster/Rasterization/ImGuiOverlayRasterization.h"
#include "Engine/GeometricRaster/UV/UVWorkspaceRasterizer.h"
#include "Engine/Lifecycle/RuntimeLifecycle.h"
#include "Engine/Lifecycle/EditorLifecycle.h"
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
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

namespace
{

using namespace Frontier;
using namespace Frontier::Mathematics;

//------------------------------------------------------------------------------------------------------------------------
//                                                   VALIDATION & GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

uint32_t AssertionCount = 0u;
uint32_t FailureCount   = 0u;

bool Verify(bool Condition, const char* Description)
{
    ++AssertionCount;
    if (!Condition) ++FailureCount;
    std::printf("[%s] %s\n", Condition ? "PASS" : "FAIL", Description);
    return Condition;
}

Point2D Center(Rectangle2D Bounds)
{
    return { Bounds.X + Bounds.Width * 0.5f, Bounds.Y + Bounds.Height * 0.5f };
}

bool Nearly(float Left, float Right, float Tolerance = 0.001f)
{
    return std::abs(Left - Right) <= Tolerance;
}

uint64_t CountChangedChannels(const std::vector<uint8_t>& Before, const std::vector<uint8_t>& After)
{
    if (Before.size() != After.size()) return 0u;
    uint64_t Count = 0u;
    for (std::size_t Index = 0u; Index < Before.size(); ++Index)
    {
        if (Before[Index] != After[Index]) ++Count;
    }
    return Count;
}

Rectangle2D InspectPaneBounds(std::string_view Title)
{
    const std::string Prefix = std::string(Title) + "##FRNT_";
    for (const ImGuiWindow* Window : ImGui::GetCurrentContext()->Windows)
    {
        if (std::string_view(Window->Name).starts_with(Prefix))
        {
            return { Window->Pos.x, Window->Pos.y, Window->Size.x, Window->Size.y };
        }
    }
    return {};
}

std::string ReadText(const std::filesystem::path& Path)
{
    std::ifstream Input(Path);
    return std::string(std::istreambuf_iterator<char>(Input), std::istreambuf_iterator<char>());
}

//------------------------------------------------------------------------------------------------------------------------
//                                          PRODUCTION CALLBACK -> EXCHANGE -> IMGUI REPLAY
//------------------------------------------------------------------------------------------------------------------------

struct WorkspaceInteractionValidation
{
    GeometricRaster::VulkanInterchange                    Device {};
    GeometricRaster::UVWorkspaceRasterizer                 Rasterizer {};
    Windowing::DesktopPlatformWindow                       Window {};
    Input::InputExtension                                 EditorInput {};
    Components::HeadlessWorkspaceDockContainer             Dock {};
    Workspaces::UVWorkspaceHost                            Host {};
    GeometricRaster::ImGuiOverlayRasterization              Presenter {};
    GLFWwindow*                                           NativeWindow = nullptr;
    GLFWcursorposfun                                      Motion = nullptr;
    GLFWmousebuttonfun                                    Button = nullptr;
    GLFWkeyfun                                            Key = nullptr;
    GLFWcharfun                                           Text = nullptr;
    GLFWscrollfun                                         Wheel = nullptr;
    GLFWwindowfocusfun                                    Focus = nullptr;
    GLFWdropfun                                           Drop = nullptr;
    PaneInputReading                                      LastInput {};
    std::vector<Input::InputSignalPacket>                  LastPackets {};
    std::vector<std::string>                               LastDroppedPaths {};
    uint32_t                                              PresentationFailures = 0u;
    float                                                 FramebufferScale = 1.0f;
    bool                                                  SynchronizeDockExtent = true;
    std::filesystem::path                                 Root {};
    std::filesystem::path                                 Images {};

    bool Initialize(const std::filesystem::path& RepositoryRoot, const std::filesystem::path& ImageDirectory)
    {
        Root   = RepositoryRoot;
        Images = ImageDirectory;
        std::filesystem::create_directories(Images);
        std::string Diagnostic {};
        if (!Verify(Device.InitializeInterchange(Root, &Diagnostic), "initialize native Vulkan interaction device")) return false;
        if (!Verify(Rasterizer.InitializeRasterizer(&Device, FRONTIER_COMPILED_SHADER_DIR), "initialize production viewport rasterizer")) return false;
        const auto Descriptor = Windowing::WindowConfigurationDescriptor::ConstructApplicationWindow(
            "UV workspace interaction replay", 1600u, 980u, false);
        if (!Verify(Window.Initialize(Descriptor), "initialize GLFW platform window")) return false;
        NativeWindow = static_cast<GLFWwindow*>(Window.NativeGlfwHandle());
        Motion = glfwSetCursorPosCallback(NativeWindow, nullptr);
        glfwSetCursorPosCallback(NativeWindow, Motion);
        Button = glfwSetMouseButtonCallback(NativeWindow, nullptr);
        glfwSetMouseButtonCallback(NativeWindow, Button);
        Key = glfwSetKeyCallback(NativeWindow, nullptr);
        glfwSetKeyCallback(NativeWindow, Key);
        Text = glfwSetCharCallback(NativeWindow, nullptr);
        glfwSetCharCallback(NativeWindow, Text);
        Wheel = glfwSetScrollCallback(NativeWindow, nullptr);
        glfwSetScrollCallback(NativeWindow, Wheel);
        Focus = glfwSetWindowFocusCallback(NativeWindow, nullptr);
        glfwSetWindowFocusCallback(NativeWindow, Focus);
        Drop = glfwSetDropCallback(NativeWindow, nullptr);
        glfwSetDropCallback(NativeWindow, Drop);
        if (!Verify(Motion && Button && Key && Text && Wheel && Focus && Drop,
            "platform installed pointer, button, key, text, wheel, focus and drop callbacks")) return false;
        EditorInput.Initialize();
        Host.ConfigureLaunchPolicy(Configuration::EngineConfiguration(
            Configuration::EngineConfiguration::ConstructStandaloneUVDefault()));
        if (!Verify(Host.AttachVulkanRasterizer(&Rasterizer), "attach actual UV session to Vulkan rasterizer")) return false;
        if (!Verify(Dock.Initialize(Descriptor), "initialize native dock container")) return false;
        ThemeRepository Theme {};
        Components::ConfigureImGuiWorkspaceStyle(Dock.ActiveTabMetrics());
        Components::ConfigureImGuiWorkspaceTheme(Dock.ActiveTabMetrics(), Theme);
        Host.RegisterDockPanes(Dock);
        if (!Verify(Presenter.InitializeOverlay(&Device, FRONTIER_COMPILED_SHADER_DIR, nullptr, 1600u, 980u, &Diagnostic),
            "initialize actual Vulkan ImGui presenter")) return false;
        Motion(NativeWindow, 4.0, 4.0);
        Tick();
        Tick();
        Tick();
        Tick();
        return true;
    }

    void Tick(double Δt = 1.0 / 60.0)
    {
        EditorInput.BeginTick();
        Window.PollOperatingEvents(EditorInput);
        LastPackets.clear();
        LastDroppedPaths.clear();
        struct EditorIntake
        {
            WorkspaceInteractionValidation& Validation;

            void IntakeSignalPacket(const Input::InputSignalPacket& Packet) noexcept
            {
                Validation.LastPackets.push_back(Packet);
                WorkspaceAppearance::ForwardEditorInputToImGui(Packet);
                if (Packet.Category == Input::InputSignalCategory::ExternalFileDrop)
                {
                    Validation.LastDroppedPaths.push_back(Validation.Window.ExtractDroppedPath(Packet.ControlCode));
                }
            }
        } Intake { *this };
        (void)EditorInput.TickExchangeWithSink(Intake);
        const auto Extent = Window.InspectExtent();
        if (SynchronizeDockExtent)
        {
            Dock.AccessOperatingSurface(Components::HostWindowToken{ 0u })->ResizeSurface(
                Extent.PixelWidth, Extent.PixelHeight, Extent.DpiScaleFactor);
        }
        auto& Io = ImGui::GetIO();
        Io.DisplaySize = ImVec2(static_cast<float>(Extent.PixelWidth), static_cast<float>(Extent.PixelHeight));
        Io.DisplayFramebufferScale = ImVec2(FramebufferScale, FramebufferScale);
        Io.DeltaTime = static_cast<float>(Δt);
        Presenter.PrepareImGuiFrame();
        ImGui::NewFrame();
        LastInput = WorkspaceAppearance::CaptureImGuiPaneInput(
            { 0.0f, 0.0f, Io.DisplaySize.x, Io.DisplaySize.y }, 1.0f);
        Dock.PresentWindowImGuiPanes(Components::HostWindowToken{ 0u });
        ImGui::Render();
        const uint32_t Width = static_cast<uint32_t>(std::lround(Io.DisplaySize.x * FramebufferScale));
        const uint32_t Height = static_cast<uint32_t>(std::lround(Io.DisplaySize.y * FramebufferScale));
        if (!Presenter.PresentImGuiBatches(ImGui::GetDrawData(), Width, Height))
        {
            ++PresentationFailures;
            std::fprintf(stderr, "Presentation failed: %s\n", std::string(Presenter.QueryLastPresentationDiagnostic()).c_str());
        }
    }

    void Warm(Point2D Cursor)
    {
        Motion(NativeWindow, Cursor.X, Cursor.Y);
        Tick();
        Tick();
    }

    void Click(Point2D Cursor)
    {
        Warm(Cursor);
        Button(NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_PRESS, 0);
        Tick();
        Button(NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_RELEASE, 0);
        Tick();
        Tick();
    }

    void PressCommand(int Symbol, int Scancode, int Modifiers = 0)
    {
        Key(NativeWindow, Symbol, Scancode, GLFW_PRESS, Modifiers);
        Tick();
        Key(NativeWindow, Symbol, Scancode, GLFW_RELEASE, Modifiers);
        Tick();
    }

    Point2D ViewportScreen(Point2D Local)
    {
        const auto& Layout = Host.AccessViewportHost().InspectLayout();
        return { Layout.ScreenOrigin.X + Local.X * Layout.InterfaceScale,
            Layout.ScreenOrigin.Y + Local.Y * Layout.InterfaceScale };
    }

    void Capture(const char* Filename)
    {
        std::vector<uint8_t> Pixels {};
        uint32_t Width = 0u, Height = 0u;
        if (!Verify(Presenter.ReadbackLastPresentedRgba(Pixels, Width, Height), "read back actual native Vulkan presentation")) return;
        Exhibits::SoftwareRasterCanvas Canvas(Width, Height, { 14u, 14u, 16u, 255u });
        Canvas.BlitRgbaRegion(0u, 0u, Width, Height, Pixels.data());
        Verify(Canvas.WritePngFile(Images / Filename), Filename);
    }

    void Resize(uint32_t Width, uint32_t Height)
    {
        glfwSetWindowSize(NativeWindow, static_cast<int>(Width), static_cast<int>(Height));
        Tick();
        Tick();
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                             REAL CALLBACK PAYLOAD & INPUT OWNERSHIP
//------------------------------------------------------------------------------------------------------------------------

void ValidateEditorIntake(WorkspaceInteractionValidation& Validation)
{
    auto& Input = Validation.EditorInput;
    Validation.Motion(Validation.NativeWindow, 420.0, 350.0);
    Validation.Motion(Validation.NativeWindow, 437.0, 341.0);
    Validation.Key(Validation.NativeWindow, GLFW_KEY_LEFT_CONTROL, 29, GLFW_PRESS, GLFW_MOD_CONTROL);
    Validation.Key(Validation.NativeWindow, GLFW_KEY_Z, 44, GLFW_PRESS, GLFW_MOD_CONTROL);
    Validation.Text(Validation.NativeWindow, 0x03B1u);
    Validation.Text(Validation.NativeWindow, 0x10437u);
    Validation.Wheel(Validation.NativeWindow, 0.25, -0.5);
    Validation.Tick();
    const auto Keyboard = std::find_if(Validation.LastPackets.begin(), Validation.LastPackets.end(), [](const auto& Packet)
    {
        return Packet.Category == Input::InputSignalCategory::KeyboardKey && Packet.LogicalKeyCode == GLFW_KEY_Z;
    });
    Verify(Keyboard != Validation.LastPackets.end() && Keyboard->ControlCode == 44u &&
        Keyboard->ModifierBitmask == GLFW_MOD_CONTROL && Input.QueryScanCodeHeld(44u),
        "physical scancode, logical key and modifiers survive both existing exchanges");
    // ImGui's default event trickling intentionally keeps command and text transitions ordered across ticks.
    std::string Commands = Validation.LastInput.ShortcutKeys;
    std::string Typed = Validation.LastInput.TypedUtf8;
    bool ControlHeld = Validation.LastInput.ControlHeld;
    for (uint32_t Index = 0u; Index < 4u; ++Index)
    {
        Validation.Tick();
        Commands += Validation.LastInput.ShortcutKeys;
        Typed += Validation.LastInput.TypedUtf8;
        ControlHeld = ControlHeld || Validation.LastInput.ControlHeld;
    }
    Verify(ControlHeld && Commands.find('z') != std::string::npos,
        "Ctrl+Z reaches UI as a key command without relying on a GLFW character callback");
    Verify(Typed == "\xCE\xB1\xF0\x90\x90\xB7",
        "BMP and supplementary Unicode text are preserved exactly once and kept separate from shortcuts");
    Verify(Input.InspectPointerSnapshot().PositionX == 437.0f && Input.InspectPointerSnapshot().PositionY == 341.0f,
        "absolute pointer coordinates are captured by callbacks, not polled by editor UI");
    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_RIGHT, GLFW_PRESS, GLFW_MOD_CONTROL);
    Validation.Tick();
    Verify((Input.InspectPointerSnapshot().HeldButtonsMask & 2u) != 0u,
        "pointer buttons consolidate into the existing input snapshot");
    Validation.Focus(Validation.NativeWindow, GLFW_FALSE);
    Validation.Tick();
    Validation.Tick();
    Verify(!Input.QueryScanCodeHeld(44u) && !Input.QueryScanCodeHeld(29u) &&
        Input.InspectPointerSnapshot().HeldButtonsMask == 0u && !Validation.LastInput.ControlHeld &&
        !Validation.LastInput.SecondaryDown,
        "focus loss releases held keys and buttons in both InputExtension and ImGui");
    Validation.Focus(Validation.NativeWindow, GLFW_TRUE);
    Validation.Tick();
    Validation.Motion(Validation.NativeWindow, 520.0, 360.0);
    Validation.Motion(Validation.NativeWindow, 537.0, 351.0);
    Validation.Tick();
    Verify(Nearly(Input.InspectPointerSnapshot().TickDeltaX, 17.0f) &&
        Nearly(Input.InspectPointerSnapshot().TickDeltaY, -9.0f),
        "first motion after focus recovery establishes origin; subsequent motion accumulates a finite delta");
    Validation.Tick();
    Verify(Input.InspectPointerSnapshot().TickDeltaX == 0.0f && Input.InspectPointerSnapshot().ScrollDeltaY == 0.0f,
        "idle ticks clear transient pointer and wheel deltas");
    const char* Paths[] = { "First surface.obj", "Second surface.gltf" };
    Validation.Drop(Validation.NativeWindow, 2, Paths);
    Validation.Tick();
    Verify(Validation.LastDroppedPaths == std::vector<std::string>{ Paths[0], Paths[1] },
        "multiple file-drop payloads retain order and owned path lifetime through InputExchange");

    Lifecycle::RuntimeLifecycle Game {};
    Verify(Game.Initialize(), "initialize a separate runtime lifecycle");
    Input::InputSignalPacket GameWheel {};
    GameWheel.Category = Input::InputSignalCategory::ScrollWheel;
    GameWheel.SecondaryAxis = 3.0f;
    const float EditorScroll = Input.InspectPointerSnapshot().ScrollDeltaY;
    (void)Game.AccessInput().IntakeHardwareSignal(GameWheel);
    Verify(Game.ExecuteSingleTick(1.0 / 60.0) && &Game.AccessInput() != &Input &&
        Game.InspectInput().InspectPointerSnapshot().ScrollDeltaY == 3.0f &&
        Input.InspectPointerSnapshot().ScrollDeltaY == EditorScroll,
        "game exchange is distinct and cannot consume or overwrite editor input");
    Game.Finalize();

#if FRONTIER_EDITOR_ENABLED
    Lifecycle::EditorLifecycle Editor {};
    Verify(Editor.Initialize(), "initialize full editor input ownership");
    auto& OwnedEditorInput = Editor.AccessInput();
    OwnedEditorInput.BeginTick();
    (void)OwnedEditorInput.IntakeHardwareSignal(GameWheel);
    (void)OwnedEditorInput.TickExchange();
    Verify(Editor.ExecuteAuthoringTick(1.0 / 60.0, false) &&
        OwnedEditorInput.InspectPointerSnapshot().ScrollDeltaY == 3.0f &&
        OwnedEditorInput.InspectExchange().PendingSignalCount() == 0u,
        "full editor authoring tick preserves the desktop-owned intake instead of beginning a second dormant exchange");
    Editor.Finalize();
#endif
    Verify(Input.InspectExchange().DroppedSignalCount() == 0u, "editor callback replay drops no signals");
}

//------------------------------------------------------------------------------------------------------------------------
//                                            DROPDOWNS, DIVIDER & CAMERA MOTION
//------------------------------------------------------------------------------------------------------------------------

void ValidateDropdowns(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    auto& Viewport = Validation.Host.AccessViewportHost();
    Session.SelectionMask.ClearAll();
    Session.SynchronizeSelectionToGPU();
    for (uint32_t Choice : std::array<uint32_t, 6u>{{ 5u, 0u, 4u, 2u, 3u, 1u }})
    {
        const auto Button = Viewport.InspectLayout().SurfaceDropdown;
        Validation.Click(Validation.ViewportScreen(Center(Button)));
        auto Anchor = Button;
        Anchor.Width = 220.0f;
        const auto Sheet = DropdownSelector::QuerySheetBounds(Anchor, 6u);
        const Point2D Local { Sheet.X + Sheet.Width * 0.5f,
            Sheet.Y + ControlMetrics::DropdownPaddingY + ControlMetrics::DropdownOptionHeight * 0.5f +
            Choice * (ControlMetrics::DropdownOptionHeight + ControlMetrics::DropdownRowGap) };
        Validation.Click(Validation.ViewportScreen(Local));
        std::printf("MEASURE SurfaceDropdown requested=%u selected=%u\n", Choice, static_cast<uint32_t>(Session.RenderOptions3D.DisplayMode));
        Verify(static_cast<uint32_t>(Session.RenderOptions3D.DisplayMode) == Choice,
            "3D dropdown selects the requested non-adjacent mode directly");
    }
    for (uint32_t Choice : std::array<uint32_t, 3u>{{ 2u, 0u, 1u }})
    {
        const auto Button = Viewport.InspectLayout().DebugDropdown;
        Validation.Click(Validation.ViewportScreen(Center(Button)));
        auto Anchor = Button;
        Anchor.Width = 200.0f;
        const auto Sheet = DropdownSelector::QuerySheetBounds(Anchor, 3u);
        Validation.Click(Validation.ViewportScreen({ Sheet.X + 45.0f,
            Sheet.Y + ControlMetrics::DropdownPaddingY + ControlMetrics::DropdownOptionHeight * 0.5f +
            Choice * (ControlMetrics::DropdownOptionHeight + ControlMetrics::DropdownRowGap) }));
        Verify(static_cast<uint32_t>(Session.RenderOptions2D.DisplayMode) == Choice,
            "debug dropdown selects the requested diagnostic channel directly");
    }
    const auto Selection = Session.SelectionMask.CollectSelectedFaces();
    Validation.Click(Validation.ViewportScreen(Center(Viewport.InspectLayout().SurfaceDropdown)));
    Validation.Capture("SurfaceDropdown.png");
    Validation.PressCommand(GLFW_KEY_ESCAPE, 1);
    Validation.Click(Validation.ViewportScreen(Center(Viewport.InspectLayout().Spatial)));
    Verify(Session.RenderOptions3D.DisplayMode == GeometricRaster::SurfaceDisplayMode::PriorityLayerTint,
        "Escape closes the open dropdown without changing its selected mode");
    Session.SelectionMask.ClearAll();
    Session.SynchronizeSelectionToGPU();
    (void)Selection;
    Session.RenderOptions3D.DisplayMode = GeometricRaster::SurfaceDisplayMode::MatCapPreview;
    Session.RenderOptions2D.DisplayMode = GeometricRaster::UVCanvasDisplayMode::PriorityLayerFill;
    Session.FramebuffersDirty = true;
    Validation.Tick();
}

void ValidateDividerAndLag(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    auto& Projection = Session.AccessViewportProjection();
    auto Layout = Validation.Host.AccessViewportHost().InspectLayout();
    const float InitialRatio = Projection.QuerySplitRatio();
    const float InitialDistance = Projection.InspectSpatialCamera().DistanceMeters;
    const auto Selection = Session.SelectionMask.CollectSelectedFaces();
    const Point2D Divider { Layout.Planar.Right() + 1.0f, Layout.Canvas.Y + Layout.Canvas.Height * 0.58f };
    Validation.Warm(Validation.ViewportScreen(Divider));
    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_PRESS, 0);
    Validation.Tick();
    Validation.Motion(Validation.NativeWindow, Validation.ViewportScreen(Divider).X + 105.0f,
        Validation.ViewportScreen(Divider).Y);
    Validation.Tick();
    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_RELEASE, 0);
    Validation.Tick();
    const float DraggedRatio = Projection.QuerySplitRatio();
    Validation.Tick();
    Verify(DraggedRatio > InitialRatio + 0.08f && Nearly(Projection.QuerySplitRatio(), DraggedRatio) &&
        Nearly(Session.WorkspaceConfig.InspectUVPreferences().SplitRatioNormalized, DraggedRatio),
        "divider drag changes both viewport widths and persists on subsequent host renders");
    Verify(Selection == Session.SelectionMask.CollectSelectedFaces() &&
        Nearly(Projection.InspectSpatialCamera().DistanceMeters, InitialDistance),
        "divider capture does not pick geometry or navigate the camera underneath");
    Validation.Capture("ResizedDivider.png");

    Layout = Validation.Host.AccessViewportHost().InspectLayout();
    const Point2D Spatial = Validation.ViewportScreen(Center(Layout.Spatial));
    Validation.Warm(Spatial);
    const auto Before = Projection.InspectDisplayedSpatialCamera();
    const auto PixelsBefore = Session.Framebuffer3DRGBA;
    Validation.Wheel(Validation.NativeWindow, 0.0, 1.0);
    Validation.Tick(1.0 / 120.0);
    const float Target = Projection.InspectSpatialCamera().DistanceMeters;
    const float First = Projection.InspectDisplayedSpatialCamera().DistanceMeters;
    Validation.Tick(1.0 / 120.0);
    const float Second = Projection.InspectDisplayedSpatialCamera().DistanceMeters;
    Verify(Target < Before.DistanceMeters && First < Before.DistanceMeters && First > Target && Second < First && Second > Target,
        "native wheel zoom has observable multi-frame lag rather than an immediate camera jump");
    for (uint32_t Index = 0u; Index < 60u; ++Index) Validation.Tick();
    Verify(Nearly(Projection.InspectDisplayedSpatialCamera().DistanceMeters, Target) &&
        Nearly(Session.RenderOptions3D.Camera.DistanceMeters, Target),
        "displayed camera and rendered Vulkan camera converge to the target while idle");
    Verify(CountChangedChannels(PixelsBefore, Session.Framebuffer3DRGBA) > 200u,
        "damped native zoom changes the actual framebuffer pixels");

    const auto PanBefore = Projection.InspectDisplayedSpatialCamera();
    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_MIDDLE, GLFW_PRESS, GLFW_MOD_SHIFT);
    Validation.Tick();
    Validation.Motion(Validation.NativeWindow, Spatial.X + 30.0f, Spatial.Y + 18.0f);
    Validation.Tick();
    const auto PanTarget = Projection.InspectSpatialCamera();
    const auto PanFirst = Projection.InspectDisplayedSpatialCamera();
    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_MIDDLE, GLFW_RELEASE, 0);
    Validation.Tick();
    Verify(EvaluateDistance(PanTarget.TargetPivot, PanBefore.TargetPivot) > 0.001f &&
        EvaluateDistance(PanFirst.TargetPivot, PanTarget.TargetPivot) > 0.001f,
        "shift-middle pointer movement pans through the exchange and retains camera movement lag");
    for (uint32_t Index = 0u; Index < 60u; ++Index) Validation.Tick();
    Verify(EvaluateDistance(Projection.InspectDisplayedSpatialCamera().TargetPivot, PanTarget.TargetPivot) < 0.001f,
        "damped camera movement settles without continued input");
    std::printf("MEASURE DividerRatio=%.6f->%.6f CameraDistance=%.6f->%.6f First=%.6f Second=%.6f\n",
        InitialRatio, DraggedRatio, Before.DistanceMeters, Target, First, Second);
}

//------------------------------------------------------------------------------------------------------------------------
//                                            NATIVE FINISH SLIDERS & FRAMEBUFFER RESPONSE
//------------------------------------------------------------------------------------------------------------------------

void ValidateFinishControls(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    Session.SelectionMask.ClearAll();
    Session.ActiveInspectorTab = Workspaces::UVInspectorTab::Shading;
    Session.RenderOptions3D.DisplayMode = GeometricRaster::SurfaceDisplayMode::MatCapPreview;
    Session.ApplySurfaceFinish(0.3f, 0.0f, 0.25f, 0.6f);
    Session.SynchronizeSelectionToGPU();
    Validation.Tick();
    // Scroll only the real Inspector until all four finish tracks are visible.
    const auto Inspector = InspectPaneBounds("Inspector");
    Validation.Warm({ Inspector.X + Inspector.Width * 0.5f, Inspector.Y + Inspector.Height * 0.72f });
    Validation.Wheel(Validation.NativeWindow, 0.0, -5.0);
    Validation.Tick();
    Validation.Tick();
    const std::array<const char*, 4u> Labels {{ "metallic", "roughness", "specular", "MatCap blend" }};
    for (uint32_t Index = 0u; Index < 4u; ++Index)
    {
        if (Index == 2u) Session.ApplySurfaceFinish(0.3f, 0.0f, 0.05f, 0.0f);
        Validation.Tick();
        const auto Layout = Validation.Host.AccessInspector().InspectSurfaceFinishLayout();
        const auto Row = Layout.SliderRows[Index];
        const float TrackX = Row.X + 97.0f;
        const float TrackWidth = std::max(36.0f, Row.Right() - TrackX);
        const float Fraction = Index == 3u ? 0.32f : 0.82f;
        const Point2D Cursor { Layout.ScreenOrigin.X + (TrackX + 12.0f + (TrackWidth - 24.0f) * Fraction) * Layout.InterfaceScale,
            Layout.ScreenOrigin.Y + (Row.Y + 32.0f) * Layout.InterfaceScale };
        const auto Pixels = Session.Framebuffer3DRGBA;
        Validation.Click(Cursor);
        const auto& Finish = Session.Asset.Network.Faces.front().Shading;
        const std::array<float, 4u> Readings {{ Finish.Metallic, Finish.Roughness, Finish.Specular, Finish.MatCapBlend }};
        const uint64_t Changed = CountChangedChannels(Pixels, Session.Framebuffer3DRGBA);
        std::printf("MEASURE Slider=%s Requested=%.3f Actual=%.3f ChangedChannels=%llu\n", Labels[Index], Fraction,
            Readings[Index], static_cast<unsigned long long>(Changed));
        Verify(Nearly(Readings[Index], Fraction, 0.035f), "actual Inspector pointer input changes the requested per-face finish component");
        Verify(Changed > 100u, "finish control changes visible pixels in the production Vulkan viewport");
    }
    Verify(Session.RenderOptions3D.DisplayMode == GeometricRaster::SurfaceDisplayMode::MaterialAndMatCap,
        "editing a finish in pure MatCap preview switches to the material-responsive blended mode");
    Validation.Warm({ 4.0f, 4.0f });
    Validation.Capture("FinishControls.png");
}

//------------------------------------------------------------------------------------------------------------------------
//                                              RESIZE, DPI & TEXTURE RECREATION
//------------------------------------------------------------------------------------------------------------------------

void ValidateResize(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    auto& Viewport = Validation.Host.AccessViewportHost();
    Session.ActiveInspectorTab = Workspaces::UVInspectorTab::Packing;
    Session.AccessViewportProjection().ConfigureSplitRatio(0.5f);
    Session.WorkspaceConfig.AccessUVPreferences().SplitRatioNormalized = 0.5f;
    Validation.Resize(1100u, 720u);
    const auto SmallPane = InspectPaneBounds("Viewport");
    const uint32_t SmallRasterWidth = Session.Framebuffer3DWidth;
    Validation.SynchronizeDockExtent = false;
    Validation.Resize(1600u, 980u);
    const auto StalePane = InspectPaneBounds("Viewport");
    Verify(Nearly(StalePane.Width, SmallPane.Width) && Nearly(StalePane.Height, SmallPane.Height),
        "REPRODUCED stale extent: larger OS/ImGui surface alone leaves the native dock and panels small");
    Validation.SynchronizeDockExtent = true;
    Validation.Tick();
    Validation.Tick();
    const auto GrownPane = InspectPaneBounds("Viewport");
    Verify(GrownPane.Width > SmallPane.Width + 100.0f && GrownPane.Height > SmallPane.Height + 100.0f &&
        Session.Framebuffer3DWidth > SmallRasterWidth,
        "synchronizing the real extent grows docked panels and GPU attachments after maximize-sized resize");
    Validation.Capture("NativeApplication.png");
    Validation.Resize(1100u, 720u);
    const auto CompactLayout = Viewport.InspectLayout();
    Verify(CompactLayout.SurfaceDropdown.Width > 80.0f && CompactLayout.DebugDropdown.Width > 80.0f &&
        CompactLayout.ViewDropdown.Width > 80.0f && CompactLayout.ViewDropdown.Right() <= SmallPane.Width &&
        CompactLayout.Canvas.Y > CompactLayout.SurfaceDropdown.Bottom(),
        "compact native panes wrap shading/debug/projection controls instead of hiding or overlapping them");
    Validation.Capture("CompactWorkspace.png");
    const uint32_t LogicalRasterWidth = Session.Framebuffer3DWidth;
    const uint32_t LogicalRasterHeight = Session.Framebuffer3DHeight;
    const auto LogicalLayout = Viewport.InspectLayout();
    Validation.FramebufferScale = 2.0f;
    Validation.Tick();
    Validation.Tick();
    Verify(std::abs(static_cast<int>(Session.Framebuffer3DWidth) - static_cast<int>(LogicalRasterWidth * 2u)) <= 1 &&
        std::abs(static_cast<int>(Session.Framebuffer3DHeight) - static_cast<int>(LogicalRasterHeight * 2u)) <= 1 &&
        Nearly(Viewport.InspectLayout().Spatial.Width, LogicalLayout.Spatial.Width),
        "2x framebuffer scale doubles raster attachments without doubling UI bounds or pointer coordinates");
    const auto Stats = Validation.Presenter.InspectStats();
    Verify(Stats.WidthPx == 2200u && Stats.HeightPx == 1440u && Stats.TextureRecreateCount >= 4u,
        "Vulkan presenter resizes target and retires previous viewport texture allocations before recreating them");
    Validation.FramebufferScale = 1.0f;
    Validation.Resize(1600u, 980u);
    Verify(Session.Framebuffer3DWidth > LogicalRasterWidth && Validation.PresentationFailures == 0u,
        "repeated shrink/grow/DPI changes remain presentable with no stale texture assertion");
    std::printf("MEASURE Resize small=%.0fx%.0f stale=%.0fx%.0f grown=%.0fx%.0f TextureRecreations=%llu\n",
        SmallPane.Width, SmallPane.Height, StalePane.Width, StalePane.Height, GrownPane.Width, GrownPane.Height,
        static_cast<unsigned long long>(Validation.Presenter.InspectStats().TextureRecreateCount));
}

//------------------------------------------------------------------------------------------------------------------------
//                                          INITIAL FRAMING & DPI REGION SELECTION
//------------------------------------------------------------------------------------------------------------------------

void ValidateOutlinerCards(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    const auto Layout = Validation.Host.AccessOutliner().InspectCardLayout();
    Verify(Nearly(Layout.KPICards[0].X, 10.0f) && Nearly(Layout.KPICards[0].Height, 70.0f) &&
        Nearly(Layout.KPICards[1].X - Layout.KPICards[0].Right(), 7.0f) &&
        Nearly(Layout.KPICards[2].X - Layout.KPICards[1].Right(), 7.0f) &&
        Nearly(Layout.DiagnosticCards[0].Height, 64.0f) &&
        Nearly(Layout.DiagnosticCards[1].X - Layout.DiagnosticCards[0].Right(), 8.0f) &&
        Nearly(Layout.FirstLayerRow.Height, 40.0f),
        "native Outliner uses HTML reference 10px card inset, 70px KPI cards, 7px gaps, 64px diagnostics and 8px gap");
    Verify(Nearly(Layout.UDIMFilter.X, 14.0f) && Nearly(Layout.UDIMFilter.Height, 31.0f),
        "UDIM Filter retains its original native 14px inset and 31px control height");
    const auto Local = Center(Layout.KPICards[2]);
    Validation.Click({ Layout.ScreenOrigin.X + Local.X * Layout.InterfaceScale,
        Layout.ScreenOrigin.Y + Local.Y * Layout.InterfaceScale });
    auto Expected = Session.Asset.Layers.InspectPartitionSpan(Session.Asset.Network, 0u).FaceIndices;
    std::sort(Expected.begin(), Expected.end());
    const auto CpuWords = Session.SelectionMask.InspectPackedFaceWords();
    const auto GpuWords = Validation.Rasterizer.ReadbackSelectionBitmaskWords();
    Verify(!Expected.empty() && Expected == Session.SelectionMask.CollectSelectedFaces() &&
        std::vector<uint32_t>(CpuWords.begin(), CpuWords.end()) == GpuWords,
        "clicking the native Remaining card selects the real remainder consistently for GPU highlighting and CPU operations");
    Session.SelectionMask.ClearAll();
    Session.SelectionMode = Workspaces::UVSelectionMode::Layers;
    Session.SynchronizeSelectionToGPU();
    Validation.Warm({ 4.0f, 4.0f });
    std::printf("MEASURE Outliner KPI=%.3fx%.3f Diagnostics=%.3fx%.3f Layer=%.3fx%.3f UDIMFilter=%.3fx%.3f\n",
        Layout.KPICards[0].Width, Layout.KPICards[0].Height,
        Layout.DiagnosticCards[0].Width, Layout.DiagnosticCards[0].Height,
        Layout.FirstLayerRow.Width, Layout.FirstLayerRow.Height, Layout.UDIMFilter.Width, Layout.UDIMFilter.Height);
}

void ValidateInitialFraming(WorkspaceInteractionValidation& Validation)
{
    const auto& Session = Validation.Host.InspectSession();
    const auto& Projection = Session.InspectViewportProjection();
    const auto& Camera = Projection.InspectDisplayedSpatialCamera();
    Axis3D Right {}, Up {}, Forward {};
    Projection.EvaluateCameraBasis(Right, Up, Forward);
    const auto Eye = Projection.EvaluateCameraEyePosition();
    const float Tangent = std::tan(Camera.VerticalFovDeg * 0.00872664626f);
    const float Aspect = static_cast<float>(Session.Framebuffer3DWidth) / Session.Framebuffer3DHeight;
    float MaximumHorizontal = 0.0f;
    float MaximumVertical = 0.0f;
    bool PositiveDepth = true;
    for (const auto& Vertex : Session.Asset.Network.Vertices)
    {
        const Axis3D Relative = Vertex.Axes - Eye;
        const float Depth = EvaluateDot(Relative, Forward);
        PositiveDepth = PositiveDepth && Depth > 0.0f;
        MaximumHorizontal = std::max(MaximumHorizontal, std::abs(EvaluateDot(Relative, Right) / (Depth * Tangent * Aspect)));
        MaximumVertical = std::max(MaximumVertical, std::abs(EvaluateDot(Relative, Up) / (Depth * Tangent)));
    }
    std::printf("MEASURE InitialFraming viewport=%ux%u distance=%.6f maxNdc=(%.6f,%.6f)\n",
        Session.Framebuffer3DWidth, Session.Framebuffer3DHeight, Camera.DistanceMeters, MaximumHorizontal, MaximumVertical);
    Verify(PositiveDepth && MaximumHorizontal < 0.98f && MaximumVertical < 0.98f,
        "initial split framing contains every original vehicle vertex after the native dock layout settles");
}

void ValidateRegionSelection(WorkspaceInteractionValidation& Validation)
{
    auto& Session = Validation.Host.AccessSession();
    Session.RenderOptions3D.RenderGizmo = false;
    Session.SelectionMode = Workspaces::UVSelectionMode::Faces;
    for (const float Scale : { 1.0f, 2.0f })
    {
        Validation.FramebufferScale = Scale;
        Validation.Tick();
        Validation.Tick();
        for (const bool Planar : { true, false })
        {
            for (const bool Brush : { false, true })
            {
                Session.SelectionMask.ClearAll();
                Session.SynchronizeSelectionToGPU();
                Validation.Tick();
                Validation.Tick();
                const auto Layout = Validation.Host.AccessViewportHost().InspectLayout();
                const auto Bounds = Planar ? Layout.Planar : Layout.Spatial;
                const float PixelScaleX = static_cast<float>(Planar ? Session.Framebuffer2DWidth : Session.Framebuffer3DWidth) / Bounds.Width;
                const float PixelScaleY = static_cast<float>(Planar ? Session.Framebuffer2DHeight : Session.Framebuffer3DHeight) / Bounds.Height;
                Point2D Local { Bounds.Width * 0.5f, Bounds.Height * 0.52f };
                bool SurfaceFound = false;
                for (uint32_t Index = 0u; Index < 25u; ++Index)
                {
                    const Point2D Candidate { std::round(Bounds.Width * (0.30f + (Index % 5u) * 0.10f)),
                        std::round(Bounds.Height * (0.38f + (Index / 5u) * 0.06f)) };
                    const auto Hit = Planar
                        ? Validation.Rasterizer.Pick2DPixel(static_cast<int32_t>(Candidate.X * PixelScaleX),
                            static_cast<int32_t>(Candidate.Y * PixelScaleY))
                        : Validation.Rasterizer.Pick3DPixel(static_cast<int32_t>(Candidate.X * PixelScaleX),
                            static_cast<int32_t>(Candidate.Y * PixelScaleY));
                    if (Hit.HitSurfaceFace() && !Hit.HitGizmo())
                    {
                        Local = Candidate;
                        SurfaceFound = true;
                        break;
                    }
                }
                const Point2D CenterScreen = Validation.ViewportScreen({ Bounds.X + Local.X, Bounds.Y + Local.Y });
                Validation.Warm(CenterScreen);
                Validation.PressCommand(Brush ? GLFW_KEY_C : GLFW_KEY_B, Brush ? 46 : 48);
                constexpr float Radius = 22.0f;
                const uint32_t MinimumX = static_cast<uint32_t>((Local.X - Radius) * PixelScaleX);
                const uint32_t MinimumY = static_cast<uint32_t>((Local.Y - Radius) * PixelScaleY);
                const uint32_t MaximumX = static_cast<uint32_t>((Local.X + Radius) * PixelScaleX);
                const uint32_t MaximumY = static_cast<uint32_t>((Local.Y + Radius) * PixelScaleY);
                const uint32_t CenterX = static_cast<uint32_t>(Local.X * PixelScaleX);
                const uint32_t CenterY = static_cast<uint32_t>(Local.Y * PixelScaleY);
                const uint32_t PhysicalRadius = Brush ? static_cast<uint32_t>(Radius * std::max(PixelScaleX, PixelScaleY)) : 0u;
                const auto Summary = Planar
                    ? Validation.Rasterizer.Reduce2DRegionPick(MinimumX, MinimumY, MaximumX, MaximumY,
                        CenterX, CenterY, PhysicalRadius)
                    : Validation.Rasterizer.Reduce3DRegionPick(MinimumX, MinimumY, MaximumX, MaximumY,
                        CenterX, CenterY, PhysicalRadius);
                const auto Expected = Validation.Rasterizer.ReadbackSelectionBitmaskWords();
                Session.SelectionMask.ClearAll();
                Session.SynchronizeSelectionToGPU();
                Validation.Tick();
                if (Brush)
                {
                    Validation.Click(CenterScreen);
                }
                else
                {
                    Validation.Warm(Validation.ViewportScreen({ Bounds.X + Local.X - Radius, Bounds.Y + Local.Y - Radius }));
                    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_PRESS, 0);
                    Validation.Tick();
                    const auto End = Validation.ViewportScreen({ Bounds.X + Local.X + Radius, Bounds.Y + Local.Y + Radius });
                    Validation.Motion(Validation.NativeWindow, End.X, End.Y);
                    Validation.Tick();
                    Validation.Button(Validation.NativeWindow, GLFW_MOUSE_BUTTON_LEFT, GLFW_RELEASE, 0);
                    Validation.Tick();
                    Validation.Tick();
                }
                const auto Actual = Validation.Rasterizer.ReadbackSelectionBitmaskWords();
                const auto CpuSpan = Session.SelectionMask.InspectPackedFaceWords();
                const std::vector<uint32_t> Cpu(CpuSpan.begin(), CpuSpan.end());
                std::printf("MEASURE Region=%s Pane=%s FramebufferScale=%.0f ExpectedHitPixels=%u SelectedFaces=%u\n",
                    Brush ? "Circle" : "Box", Planar ? "2D" : "3D", Scale, Summary.HitPixelCount,
                    Session.SelectionMask.CountSelectedFaces());
                Verify(SurfaceFound && Summary.HitPixelCount > 0u && Session.SelectionMask.CountSelectedFaces() > 0u &&
                    Actual == Expected && Cpu == Expected,
                    "native region input matches exact GPU selection and CPU finish/operation selection at the requested framebuffer scale");
                Validation.PressCommand(GLFW_KEY_ESCAPE, 1);
            }
        }
    }
    Validation.FramebufferScale = 1.0f;
    Session.RenderOptions3D.RenderGizmo = true;
    Session.SelectionMask.ClearAll();
    Session.SynchronizeSelectionToGPU();
    Validation.Warm({ 4.0f, 4.0f });
}

void ValidateProductionIntakeSource(const std::filesystem::path& Root)
{
    const auto Desktop = ReadText(Root / "Engine/Lifecycle/DesktopWorkspaceLaunch.cpp");
    Verify(Desktop.find("ActiveEditorInput = &EditorLoop.AccessInput();") != std::string::npos &&
        Desktop.find("EditorLoop.ExecuteAuthoringTick(Dt, false)") != std::string::npos &&
        Desktop.find("InputCoordinator.TickExchangeWithSink(EditorIntake)") != std::string::npos,
        "actual desktop and full editor share one authoring exchange with one consolidation per tick");
    Verify(Desktop.find("glfwGetKey(") == std::string::npos && Desktop.find("glfwGetMouseButton(") == std::string::npos &&
        Desktop.find("glfwGetCursorPos(") == std::string::npos && Desktop.find("SupplementalQueue") == std::string::npos,
        "desktop UI contains no polled device intake or supplemental text/drop bypass");
    const auto Drain = Desktop.find("InputCoordinator.TickExchangeWithSink(EditorIntake)");
    const auto Resize = Desktop.find("DockSurface->ResizeSurface(LogicalW, LogicalH, Extent.DpiScaleFactor)", Drain);
    const auto Display = Desktop.find("Io.DisplayFramebufferScale =", Resize);
    const auto Present = Desktop.find("ImGui::NewFrame()", Display);
    Verify(Drain != std::string::npos && Resize != std::string::npos && Display != std::string::npos && Present != std::string::npos &&
        Drain < Resize && Resize < Display && Display < Present,
        "actual desktop refreshes dock extent and framebuffer scale before presenting the native frame");
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        ENTRY POINT
//------------------------------------------------------------------------------------------------------------------------

int main()
{
    const auto Root = Exhibits::ResolveRepositoryRootPath();
    ValidateProductionIntakeSource(Root);
    ImGuiContext* Context = ImGui::CreateContext();
    auto& Io = ImGui::GetIO();
    Io.IniFilename = nullptr;
    Io.LogFilename = nullptr;
    Io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    TypographyRepository Typefaces {};
    (void)Typefaces.LoadRepository(Root / "EngineContent/FontsArchives");
    TypographyRepository::AssignCurrent(&Typefaces);
    if (ImFont* Font = Typefaces.QueryTabStripFont()) Io.FontDefault = Font;
    {
        WorkspaceInteractionValidation Validation {};
        if (Validation.Initialize(Root, Root / "Exhibits/UVWorkspaceRepair/Images/After"))
        {
            ValidateInitialFraming(Validation);
            ValidateOutlinerCards(Validation);
            Validation.Capture("NativeInitial.png");
            ValidateEditorIntake(Validation);
            TypographyRepository::AssignCurrent(&Typefaces);
            ValidateDropdowns(Validation);
            ValidateDividerAndLag(Validation);
            ValidateFinishControls(Validation);
            ValidateResize(Validation);
            ValidateRegionSelection(Validation);
            Verify(Validation.PresentationFailures == 0u, "every native interaction frame was presented successfully");
            Validation.Presenter.TeardownOverlay();
            Validation.Dock.Finalize();
            Validation.EditorInput.Finalize();
        }
    }
    TypographyRepository::AssignCurrent(nullptr);
    ImGui::DestroyContext(Context);
    std::printf("WorkspaceInteractionValidation: %u/%u assertions passed\n", AssertionCount - FailureCount, AssertionCount);
    return FailureCount == 0u ? 0 : 1;
}
