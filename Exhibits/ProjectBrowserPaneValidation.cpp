/*============================================================================================================================================
                                                   PROJECTBROWSERPANEVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Project browser side panes: eased collapse (cubic-bezier(.22,.8,.24,1), 0.32 s), drag-resizable inner edges, snap-collapse and
//    width restore - the C++ port of Experimental/Project browser/PanelLayout.css + Browser.js "DRAGGABLE PANEL EDGES".

#include "Engine/Configuration/BuildConfiguration.h"
#include "Engine/Components/Appearance/TypographyRepository.h"
#include "Engine/Editor/Explorer/ProjectBrowser.h"
#include "Engine/Input/InputExtension.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <imgui.h>

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <string>

#ifndef FRONTIER_REPO_ROOT_DIR
#define FRONTIER_REPO_ROOT_DIR "."
#endif

int main()
{
    using namespace Frontier;
    const std::filesystem::path TempBase     = std::filesystem::temp_directory_path() / "FrontierProjectBrowserPanes";
    const std::filesystem::path RepoRoot(FRONTIER_REPO_ROOT_DIR);
    const std::filesystem::path ActiveBinDir = std::filesystem::current_path() / "Binaries" / "Win64";
    std::error_code TempEc{};
    std::filesystem::create_directories(TempBase, TempEc);

    // Side panes: eased collapse (cubic-bezier(.22,.8,.24,1), 0.32 s), draggable edges, snap-collapse (HTML: PanelLayout.css)
    {
        IMGUI_CHECKVERSION();
        ImGuiContext* Ctx = ImGui::CreateContext();
        ImGui::SetCurrentContext(Ctx);
        ImGuiIO& Io    = ImGui::GetIO();
        Io.IniFilename = nullptr;
        Io.DisplaySize = ImVec2(1440.0f, 900.0f);
        TypographyRepository Typefaces{};
        if (Typefaces.LoadRepository(RepoRoot / "EngineContent/FontsArchives") > 0u)
        {
            TypographyRepository::AssignCurrent(&Typefaces);
            if (ImFont* DefaultFont = Typefaces.QueryTabStripFont())
            {
                Io.FontDefault = DefaultFont;
            }
        }
        unsigned char* FontPixels = nullptr;
        int FontW = 0, FontH = 0;
        Io.Fonts->GetTexDataAsRGBA32(&FontPixels, &FontW, &FontH);

        Editor::Explorer::ProjectBrowser Browser {};
        Browser.InitializeDefaultCollection(TempBase, RepoRoot, ActiveBinDir);

        const auto ProofDir = RepoRoot / "Exhibits/ProjectZeroEditor/FollowUp73";
        std::error_code ProofEc{};
        std::filesystem::create_directories(ProofDir, ProofEc);
        // Pointer packets go through InputExtension (PixelSpace reads the editor snapshot), one 60 Hz tick per frame
        Input::InputExtension InputExt {};
        InputExt.Initialize();
        Input::InputExtension::AssignActiveExtension(&InputExt);
        uint64_t Clock    = 1'000'000'000ull;
        bool     PrevDown = false;
        auto StepBrowser = [&](ImVec2 MousePos, bool Down, const char* PngName = nullptr)
        {
            Clock += 16'666'667ull;
            if (Down && !PrevDown)
            {
                Clock += 600'000'000ull; // separate gestures never read as a double-click
            }
            InputExt.BeginTick();
            Input::InputSignalPacket Motion {};
            Motion.TimestampNanoseconds = Clock;
            Motion.Category             = Input::InputSignalCategory::PointerMotion;
            Motion.PrimaryAxis          = MousePos.x;
            Motion.SecondaryAxis        = MousePos.y;
            (void)InputExt.IntakeHardwareSignal(Motion);
            if (Down != PrevDown)
            {
                Input::InputSignalPacket Button {};
                Button.TimestampNanoseconds = Clock + 1000ull;
                Button.Category             = Input::InputSignalCategory::PointerButton;
                Button.ControlCode          = 0u;
                Button.Transition           = Down ? Input::ButtonTransitionCategory::Pressed : Input::ButtonTransitionCategory::Released;
                Button.PrimaryAxis          = MousePos.x;
                Button.SecondaryAxis        = MousePos.y;
                (void)InputExt.IntakeHardwareSignal(Button);
            }
            (void)InputExt.TickExchange();
            PrevDown = Down;
            Io.MousePos = MousePos;
            ImGui::NewFrame();
            Browser.Render({ 0.0f, 0.0f, 1440.0f, 900.0f }, 1.0 / 60.0, 1.0f);
            ImGui::Render();
            if (PngName != nullptr)
            {
                Exhibits::SoftwareRasterCanvas Canvas(1440u, 900u, Components::RgbaColor8{ 0, 0, 0, 255 });
                Canvas.RasterizeImGuiBatches(ImGui::GetDrawData());
                (void)Canvas.WritePngFile(ProofDir / PngName);
            }
        };
        auto Fail = [&](const char* Message)
        {
            std::fprintf(stderr, "[FAIL] %s (left %.1f, right %.1f)\n", Message, Browser.QueryLeftRailWidth(), Browser.QueryRightPaneWidth());
            Input::InputExtension::AssignActiveExtension(nullptr);
            Browser.ReleaseGpuTextures();
            ImGui::DestroyContext(Ctx);
            return 1;
        };

        for (int Frame = 0; Frame < 30; ++Frame) StepBrowser(ImVec2(700.0f, 600.0f), false);
        StepBrowser(ImVec2(700.0f, 600.0f), false, "ProjectBrowserPanelsOpen.png");
        if (std::fabs(Browser.QueryLeftRailWidth() - 204.0f) > 0.5f || std::fabs(Browser.QueryRightPaneWidth() - 302.0f) > 0.5f)
            return Fail("Side panes did not settle at 204 / 302 px");

        // Collapse the left rail via its header toggle (26x28 at LeftW - 36, 18)
        StepBrowser(ImVec2(181.0f, 32.0f), true);
        StepBrowser(ImVec2(181.0f, 32.0f), false);
        for (int Frame = 0; Frame < 5; ++Frame) StepBrowser(ImVec2(700.0f, 600.0f), false);
        const float MidWidth = Browser.QueryLeftRailWidth();
        StepBrowser(ImVec2(700.0f, 600.0f), false, "ProjectBrowserPanelsEasing.png");
        if (!Browser.QueryLeftRailCollapsed() || MidWidth <= 44.5f || MidWidth >= 203.5f)
            return Fail("Left rail did not ease between 204 and 44 px");
        for (int Frame = 0; Frame < 30; ++Frame) StepBrowser(ImVec2(700.0f, 600.0f), false);
        StepBrowser(ImVec2(700.0f, 600.0f), false, "ProjectBrowserPanelsCollapsed.png");
        if (std::fabs(Browser.QueryLeftRailWidth() - 44.0f) > 0.5f)
            return Fail("Left rail did not settle at the 44 px collapsed width");

        // Drag the collapsed rail edge out to 300 px, then the right edge in by 100 px
        StepBrowser(ImVec2(41.0f, 500.0f), false);
        StepBrowser(ImVec2(41.0f, 500.0f), true);
        for (int Step = 1; Step <= 8; ++Step) StepBrowser(ImVec2(41.0f + 32.0f * static_cast<float>(Step), 500.0f), true);
        StepBrowser(ImVec2(297.0f, 500.0f), false);
        const float RightEdge = 1440.0f - Browser.QueryRightPaneWidth();
        StepBrowser(ImVec2(RightEdge + 2.0f, 500.0f), false);
        StepBrowser(ImVec2(RightEdge + 2.0f, 500.0f), true);
        for (int Step = 1; Step <= 8; ++Step) StepBrowser(ImVec2(RightEdge + 2.0f - 12.5f * static_cast<float>(Step), 500.0f), true);
        StepBrowser(ImVec2(RightEdge - 98.0f, 500.0f), false, "ProjectBrowserPanelsDragged.png");
        std::printf("    Pane widths after drag: left %.1f, right %.1f (mid-ease %.1f)\n", Browser.QueryLeftRailWidth(), Browser.QueryRightPaneWidth(), MidWidth);
        if (Browser.QueryLeftRailCollapsed() || std::fabs(Browser.QueryLeftRailWidth() - 300.0f) > 2.0f || std::fabs(Browser.QueryRightPaneWidth() - 402.0f) > 2.0f)
            return Fail("Dragging the pane edges did not resize the side panes");

        // Drag the left edge inward past the snap threshold: collapses, and reopening restores 300 px
        StepBrowser(ImVec2(297.0f, 500.0f), false);
        StepBrowser(ImVec2(297.0f, 500.0f), true);
        for (int Step = 1; Step <= 8; ++Step) StepBrowser(ImVec2(297.0f - 30.0f * static_cast<float>(Step), 500.0f), true);
        StepBrowser(ImVec2(57.0f, 500.0f), false);
        for (int Frame = 0; Frame < 30; ++Frame) StepBrowser(ImVec2(700.0f, 600.0f), false);
        if (!Browser.QueryLeftRailCollapsed() || std::fabs(Browser.QueryLeftRailWidth() - 44.0f) > 0.5f)
            return Fail("Dragging below 112 px did not snap the left rail shut");
        StepBrowser(ImVec2(22.0f, 32.0f), true);
        StepBrowser(ImVec2(22.0f, 32.0f), false);
        for (int Frame = 0; Frame < 30; ++Frame) StepBrowser(ImVec2(700.0f, 600.0f), false);
        if (std::fabs(Browser.QueryLeftRailWidth() - 300.0f) > 0.5f)
            return Fail("Reopening after a snap-collapse did not restore the dragged width");

        std::printf("[PASS] Side panes ease open / shut, drag-resize, snap-collapse and restore their width\n");
        Input::InputExtension::AssignActiveExtension(nullptr);
        Browser.ReleaseGpuTextures();
        ImGui::DestroyContext(Ctx);
    }

    return 0;
}
