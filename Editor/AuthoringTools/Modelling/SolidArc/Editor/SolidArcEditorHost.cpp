//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/EditorStyleSpecification.h"
#include "../../../../../Engine/Editor/ShadeTick.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/FidelityClassifier.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier {

namespace
{
// The Construct menu: every figure the console builds from numbers alone, each in the section the web catalogue files
//    it under. The order here is the order of ConstructCommand's cases.
constexpr ViewportConstructTile kConstructTiles[] =
{
    { "Reference",   "Plane",         ConstructGlyph::Plane,           ""  },
    { "Sketch Draw", "Line",          ConstructGlyph::Line,            "L" },
    { "Sketch Draw", "Polyline",      ConstructGlyph::Polyline,        ""  },
    { "Sketch Draw", "Rectangle",     ConstructGlyph::Rectangle,       "R" },
    { "Sketch Draw", "Centre Rect.",  ConstructGlyph::CentreRectangle, ""  },
    { "Sketch Draw", "Slot",          ConstructGlyph::Slot,            ""  },
    { "Sketch Draw", "Circle",        ConstructGlyph::Circle,          "C" },
    { "Sketch Draw", "Arc",           ConstructGlyph::Arc,             "A" },
    { "Sketch Draw", "Ellipse",       ConstructGlyph::Ellipse,         ""  },
    { "Sketch Draw", "Polygon",       ConstructGlyph::Polygon,         "P" },
    { "Sketch Draw", "Spline",        ConstructGlyph::Spline,          ""  },
    { "Sketch Draw", "Control Curve", ConstructGlyph::ControlCurve,    ""  },
    { "Solid",       "Box",           ConstructGlyph::Box,             ""  },
    { "Solid",       "Sphere",        ConstructGlyph::Sphere,          ""  },
    { "Solid",       "Cylinder",      ConstructGlyph::Cylinder,        ""  },
    { "Solid",       "Cone",          ConstructGlyph::Cone,            ""  },
    { "Solid",       "Torus",         ConstructGlyph::Torus,           ""  },
    { "Surface",     "Sphere Sheet",  ConstructGlyph::Sphere,          ""  },
    { "Surface",     "Cylinder Sheet", ConstructGlyph::Cylinder,       ""  },
    { "Surface",     "Cone Sheet",    ConstructGlyph::Cone,            ""  },
    { "Surface",     "Torus Sheet",   ConstructGlyph::Torus,           ""  },
    { "Surface",     "Patch",         ConstructGlyph::Patch,           ""  },
};
constexpr uint32_t kConstructTileCount = static_cast<uint32_t>(sizeof(kConstructTiles) / sizeof(kConstructTiles[0]));

// The console line that places tile Index with its centre at (X, Y) on the workplane: every size is a default a
//    person can see at once and move afterwards. An empty string means the tile does not exist.
std::string ConstructCommand(uint32_t Index, double X, double Y) noexcept
{
    char Line[640];
    switch (Index)
    {
    case 0:  std::snprintf(Line, sizeof(Line), "plane (%.3f,%.3f,0) 1.4 1.4", X - 0.7, Y - 0.7); break;
    case 1:  std::snprintf(Line, sizeof(Line), "line (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 2:  std::snprintf(Line, sizeof(Line), "polyline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.5, X - 0.3, Y + 0.5, X + 0.3, Y - 0.2, X + 0.8, Y + 0.5); break;
    case 3:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 4:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (%.3f,%.3f) --center", X, Y, X + 0.7, Y + 0.5); break;
    case 5:  std::snprintf(Line, sizeof(Line), "slot (%.3f,%.3f) (%.3f,%.3f) 0.25", X - 0.5, Y, X + 0.5, Y); break;
    case 6:  std::snprintf(Line, sizeof(Line), "circle (%.3f,%.3f) 0.6", X, Y); break;
    case 7:  std::snprintf(Line, sizeof(Line), "arc (%.3f,%.3f) 0.7 -60 240", X, Y); break;
    case 8:  std::snprintf(Line, sizeof(Line), "ellipse (%.3f,%.3f) 0.8 0.45", X, Y); break;
    case 9: std::snprintf(Line, sizeof(Line), "polygon (%.3f,%.3f) 0.6 6", X, Y); break;
    case 10: std::snprintf(Line, sizeof(Line), "spline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.3, X - 0.3, Y + 0.5, X + 0.3, Y - 0.5, X + 0.8, Y + 0.3); break;
    case 11: std::snprintf(Line, sizeof(Line), "cpcurve (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.3, X - 0.3, Y + 0.6, X + 0.3, Y - 0.6, X + 0.8, Y + 0.3); break;
    case 12: std::snprintf(Line, sizeof(Line), "box (%.3f,%.3f,0) 1 1 1", X - 0.5, Y - 0.5); break;
    case 13: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6", X, Y); break;
    case 14: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2", X, Y); break;
    case 15: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2", X, Y); break;
    case 16: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25", X, Y); break;
    case 17: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6 --sheet", X, Y); break;
    case 18: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2 --sheet", X, Y); break;
    case 19: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2 --sheet", X, Y); break;
    case 20: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25 --sheet", X, Y); break;
    case 21:
    {
        // A three-by-three net with a hump in the middle: row-major, degree 2.
        int Used = std::snprintf(Line, sizeof(Line), "patch 3 3 --degree=2");
        for (int Row = 0; Row < 3; ++Row)
            for (int Column = 0; Column < 3; ++Column)
                Used += std::snprintf(Line + Used, sizeof(Line) - static_cast<size_t>(Used), " (%.3f,%.3f,%.3f)",
                                      X + (Column - 1) * 0.7, Y + (Row - 1) * 0.7, (Row == 1 && Column == 1) ? 0.5 : 0.0);
        break;
    }
    default: return std::string();
    }
    return std::string(Line);
}
}

SolidArcEditorHost::SolidArcEditorHost() noexcept
{
    Outliner_.AssignControls(&Controls_);
    Viewport_.AssignControls(&Controls_);
    Inspector_.AssignControls(&Controls_);
    Outliner_.AssignTabOpen(&OutlinerTabOpen_);
    Viewport_.AssignTabOpen(&ViewportTabOpen_);
    Inspector_.AssignTabOpen(&InspectorTabOpen_);
    Outliner_.AssignWindowTitle("SolidArc Outliner");
    Viewport_.AssignWindowTitle("SolidArc Viewport");
    Inspector_.AssignWindowTitle("SolidArc Inspector");
    Inspector_.AssignGlassCards(true);
    Outliner_.AssignDocumentStyle(true);
    // SolidArc uses its CAD filter catalogue, not Project-Zero's game narrowing labels.
    // Colours match the web editor palette: curve/sketch #4fd8e0, body #ffb454,
    // surface #4da3ff, construction plane #b48cff, dimensions #e5d33a and constraints #ff6b8a.
    const OutlinerFilterEntry SolidArcFilters[] =
    {
        { "Lines",        IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Lines },
        { "Profiles",     IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Profiles },
        { "Bodies",       IM_COL32(255, 180, 84, 255), SolidArcOutlinerFilter::Bodies },
        { "Surfaces",     IM_COL32(77, 163, 255, 255), SolidArcOutlinerFilter::Surfaces },
        { "Construction", IM_COL32(180, 140, 255, 255), SolidArcOutlinerFilter::Construction },
        { "Dimensions",   IM_COL32(229, 211, 58, 255), SolidArcOutlinerFilter::Dimensions },
        { "Constraints",  IM_COL32(255, 107, 138, 255), SolidArcOutlinerFilter::Constraints },
    };
    Outliner_.AssignFilterCatalog(SolidArcFilters, static_cast<uint32_t>(sizeof(SolidArcFilters) / sizeof(SolidArcFilters[0])));
    Viewport_.AssignChrome(ViewportPanelChrome::SolidArcCad);
    Viewport_.AssignConstructTiles(kConstructTiles, kConstructTileCount);
    Outliner_.AssignReadout(&Readout_);
    Viewport_.AssignReadout(&Readout_);
    Inspector_.AssignReadout(&Readout_);
    Viewport_.AssignShadeOpen(&ShadeOpen_);
}

SolidArcEditorHost::~SolidArcEditorHost() noexcept
{
    Shade_.Terminate();
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
#ifdef FRONTIER_DEVELOPMENT
    // 📝 One style for both editors: tab figures, geometry and every colour token come from the game editor's own seating.
    SeatEditorStyle(ImGui::GetStyle());
#endif
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTROL CENTRE NOTCH
//------------------------------------------------------------------------------------------------------------------------

bool SolidArcEditorHost::SeatShade(uint32_t Width, uint32_t Height) noexcept
{
    ShadeSeated_ = Shade_.Initialize(Width, Height);
    // 📝 The same 200 px pull the game editor seats: full width would sit on the viewport tab's close mark.
    Shade_.AssignNotchWidth(200.0f);
    Shade_.AssignProjectName("SolidArc");
    return ShadeSeated_;
}

void SolidArcEditorHost::TickShade(float CursorX, float CursorY, bool Down, float Wheel, float DeltaSeconds) noexcept
{
    if (!ShadeSeated_)
        return;
    // The host runs in logical pixels; the contact arrives in display pixels, so the exchange carries the contact
    //    scaled while the advance takes it logical.
    const float Scale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
    const ImVec2 Display = ImGui::GetIO().DisplaySize;
    Shade_.Resize(static_cast<uint32_t>(Display.x / Scale + 0.5f), static_cast<uint32_t>(Display.y / Scale + 0.5f));
    ShadeInput_.AssignCursorPosition(CursorX * Scale, CursorY * Scale);
    ShadeInput_.AssignMouseButton(MouseButtonCategory::ButtonLeft, Down);
    ShadeInput_.ResetMouseScroll();
    if (Wheel != 0.0f)
        ShadeInput_.AssignMouseScroll(Wheel);
    Shade_.AdvanceInteraction(ShadeInput_, CursorX, CursorY);
    Shade_.AdvanceLocomotion(DeltaSeconds);
    Toasts_.Advance(DeltaSeconds);

    // Only an edge past the echo moves the shade, so the publish below never fights a tap that already seated the pose.
    if (!Shade_.IsDragging() && ShadeOpen_ != OpenEcho_)
    {
        if (ShadeOpen_)
            Shade_.OpenNotch();
        else
            Shade_.CloseNotch();
        OpenEcho_ = ShadeOpen_;
    }
    ShadeOpen_ = Shade_.IsOpen();
    OpenEcho_  = ShadeOpen_;

    const ControlCentreSettings& Current = Shade_.QuerySettings();
    if (Current.Revision != ToastRevision_)
    {
        Toasts_.AssignEnabled(Current.Notifications);
        char Body[96];
        std::snprintf(Body, sizeof(Body), "%s  |  GI %s, AA %s, scale %d%%", FidelityLabel(Current.Quality),
                      Current.GlobalIllumination ? "on" : "off", Current.AntiAliasing ? "on" : "off",
                      static_cast<int>(Current.RenderScale * 100.0f + 0.5f));
        Toasts_.Push("Render settings applied", Body);
        ToastRevision_ = Current.Revision;
    }
}

bool SolidArcEditorHost::ShadeCoversPointer() const noexcept
{
    return ShadeSeated_ && Shade_.CoversPointer();
}

bool SolidArcEditorHost::QueryShadeOpen() const noexcept
{
    return ShadeSeated_ && Shade_.IsOpen();
}

float SolidArcEditorHost::QueryNotchX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryNotchY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

float SolidArcEditorHost::QueryGripX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryGripY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        DOCK LAYOUT
//------------------------------------------------------------------------------------------------------------------------

void SolidArcEditorHost::ConstructLayout() noexcept
{
    const ImGuiID DockId = ImGui::GetID("SolidArcEditorDockSpace");
    if (LayoutSeated_)
        return;
    LayoutSeated_ = true;

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::DockBuilderRemoveNode(DockId);
    ImGui::DockBuilderAddNode(DockId, ImGuiDockNodeFlags_DockSpace);
    ImGui::DockBuilderSetNodeSize(DockId, Main->Size);

    ImGuiID Left = 0u, CentreAndRight = 0u, Centre = 0u, Right = 0u;
    const float LeftShare = Main->Size.x > 0.0f ? std::clamp(300.0f / Main->Size.x, 0.18f, 0.30f) : 0.18f;
    ImGui::DockBuilderSplitNode(DockId, ImGuiDir_Left, LeftShare, &Left, &CentreAndRight);
    const float RestWidth = std::max(1.0f, Main->Size.x * (1.0f - LeftShare));
    // Roomy windows seat the inspector at its designed width; a small one keeps the compact column.
    const float RightShare = std::clamp((Main->Size.x >= 1500.0f ? 380.0f : 236.0f) / RestWidth, 0.16f, 0.34f);
    ImGui::DockBuilderSplitNode(CentreAndRight, ImGuiDir_Right, RightShare, &Right, &Centre);
    ImGui::DockBuilderDockWindow("SolidArc Outliner", Left);
    if (DocumentCommands_)
    {
        ImGuiID Commands = 0u, View = 0u;
        ImGui::DockBuilderSplitNode(Centre, ImGuiDir_Down, 0.23f, &Commands, &View);
        ImGui::DockBuilderDockWindow("Document commands", Commands);
        Centre = View;
    }
    ImGui::DockBuilderDockWindow("SolidArc Viewport", Centre);
    ImGui::DockBuilderDockWindow("SolidArc Inspector", Right);
    LeftColumn_ = Left;
    CentreColumn_ = Centre;
    RightColumn_ = Right;
    ImGui::DockBuilderFinish(DockId);
}

uint32_t SolidArcEditorHost::QueryConstructTileCount() noexcept
{
    return kConstructTileCount;
}

bool SolidArcEditorHost::PlaceConstruct(ConsoleHost& Host, uint32_t Tile) noexcept
{
    const uint32_t Slot   = ConstructPlaced_;
    const double   Radius = 2.6 + 0.9 * static_cast<double>(Slot / 8u);
    const double   Angle  = (static_cast<double>(Slot % 8u) + 0.5 * static_cast<double>((Slot / 8u) & 1u)) * 0.78539816339;
    const std::string Command = ConstructCommand(Tile, Radius * std::cos(Angle), Radius * std::sin(Angle));
    if (Command.empty())
        return false;
    const size_t Before = Host.AllFigures().size();
    const bool   Done   = Host.Execute(Command);
    ++ConstructPlaced_;
    if (Done && Host.AllFigures().size() > Before)
    {
        ConstructPlacedName_ = Host.AllFigures().back().Name;
        Host.Execute("select " + ConstructPlacedName_);
        return true;
    }
    return false;
}

void SolidArcEditorHost::SeatView(ConsoleHost& Host) noexcept
{
    // The raster takes the size of the view it fills, in device pixels, so nothing is stretched; each of its pixels is
    //    four working samples, which is what takes the stair-steps off the edges.
    const float Scale = std::max(1.0f, ImGui::GetIO().DisplayFramebufferScale.x);
    const float Width = Viewport_.QueryViewWidth() * Scale;
    const float Height = Viewport_.QueryViewHeight() * Scale;
    if (Width >= 32.0f && Height >= 32.0f)
        Host.SeatSurface(static_cast<uint32_t>(Width + 0.5f), static_cast<uint32_t>(Height + 0.5f), 2u);
}

void SolidArcEditorHost::ReconcileSelection(ConsoleHost& Host) noexcept
{
    ImGuiIO& IO = ImGui::GetIO();
    SceneDocument& Scene = Host.Document();

    // The rail's select mode drives what a tap or a box picks: body, face, edge or vertex.
    const uint32_t Mask = Viewport_.QuerySolidArcSelectMask();
    if (Mask != MirrorMask_)
    {
        MirrorMask_ = Mask;
        const char* Mode = (Mask & 8u) != 0u ? "control" : ((Mask & 4u) != 0u ? "edge" : ((Mask & 2u) != 0u ? "face" : "whole"));
        Host.Execute(std::string("selectmode ") + Mode);
    }

    auto Identities = [&](bool FromPick)
    {
        std::vector<uint32_t> Found;
        if (FromPick)
        {
            for (uint32_t Slot = 0u; Slot < Outliner_.QueryPickedCount(); ++Slot)
            {
                const uint32_t Row = Outliner_.QueryPickedAt(Slot);
                if (Row < RowCount_ && Bindings_[Row].RowRole == SolidArcOutlinerBinding::Role::Figure)
                    Found.push_back(Bindings_[Row].FigureIdentity);
            }
        }
        else
        {
            for (const SceneFigure& Figure : Scene.Figures())
                if (Figure.Selected || !Figure.SelectedFaces.empty() || !Figure.SelectedEdges.empty() || !Figure.SelectedPoles.empty())
                    Found.push_back(Figure.Identity);
        }
        return Found;
    };
    auto Sorted = [](std::vector<uint32_t> List)
    {
        std::sort(List.begin(), List.end());
        List.erase(std::unique(List.begin(), List.end()), List.end());
        return List;
    };

    // What the view did this tick: a tap, a swept box, the hover, the keys.
    bool Acted = false;
    const double ViewW = static_cast<double>(Host.Raster().Width());
    const double ViewH = static_cast<double>(Host.Raster().Height());
    float U = 0.0f, V = 0.0f, U1 = 0.0f, V1 = 0.0f;
    bool Extend = false, Subtract = false;
    if (Viewport_.QueryViewTap(&U, &V, &Extend))
    {
        Host.SelectAtView(U * ViewW, V * ViewH, Extend);
        Acted = true;
    }
    if (Viewport_.QueryViewBox(&U, &V, &U1, &V1, &Extend, &Subtract))
    {
        Host.SelectBoxAtView(U * ViewW, V * ViewH, U1 * ViewW, V1 * ViewH, Extend, Subtract);
        Acted = true;
    }
    if (float AimU = 0.0f, AimV = 0.0f; Viewport_.QueryViewAim(&AimU, &AimV))
    {
        const int32_t CellX = static_cast<int32_t>(AimU * ViewW);
        const int32_t CellY = static_cast<int32_t>(AimV * ViewH);
        if (CellX != AimCellX_ || CellY != AimCellY_)
        {
            AimCellX_ = CellX;
            AimCellY_ = CellY;
            Host.HoverAtView(CellX, CellY);
        }
    }
    else if (AimCellX_ >= 0)
    {
        AimCellX_ = -1;
        AimCellY_ = -1;
        Host.HoverNothing();
    }
    if (!IO.WantTextInput && !Viewport_.QueryConstructOpen())
    {
        if (IO.KeyCtrl && ImGui::IsKeyPressed(ImGuiKey_A, false))
        {
            Host.Execute("select all");
            Acted = true;
        }
        else if (ImGui::IsKeyPressed(ImGuiKey_Escape, false) && Scene.SelectedCount() > 0)
        {
            Host.Execute("select none");
            Acted = true;
        }
        else if (ImGui::IsKeyPressed(ImGuiKey_Delete, false) && Scene.SelectedCount() > 0)
        {
            std::string Line = "delete";
            for (const SceneFigure& Figure : Scene.Figures())
                if (Figure.Selected && !Figure.Locked)
                    Line += " #" + std::to_string(Figure.Identity);
            if (Line.size() > 6u)
                Host.Execute(Line);
            Acted = true;
        }
    }

    const std::vector<uint32_t> PickNow = Sorted(Identities(true));
    const std::vector<uint32_t> SelectedNow = Sorted(Identities(false));

    auto LeadAmong = [&](const std::vector<uint32_t>& Now, const std::vector<uint32_t>& Before)
    {
        for (uint32_t Identity : Now)
            if (!std::binary_search(Before.begin(), Before.end(), Identity))
                return Identity;
        if (std::binary_search(Now.begin(), Now.end(), Lead_))
            return Lead_;
        return Now.empty() ? 0u : Now.front();
    };
    auto PushToOutliner = [&](const std::vector<uint32_t>& Selected)
    {
        uint32_t Rows[kMaxEditorPicked] = {};
        uint32_t Count = 0u;
        auto Seat = [&](uint32_t Identity)
        {
            for (uint32_t Row = 0u; Row < RowCount_ && Count < kMaxEditorPicked; ++Row)
                if (Bindings_[Row].RowRole == SolidArcOutlinerBinding::Role::Figure && Bindings_[Row].FigureIdentity == Identity)
                {
                    Rows[Count++] = Row;
                    return;
                }
        };
        Seat(Lead_);                                                   // the lead goes first: the inspector reads the first pick
        for (uint32_t Identity : Selected)
            if (Identity != Lead_)
                Seat(Identity);
        Outliner_.AssignPicks(Rows, Count);
        MirrorPicked_ = Sorted(Identities(true));
    };

    if (!Acted && PickNow != MirrorPicked_)
    {
        // The outliner's pick moved (a click, Ctrl, Shift): the document follows it.
        Lead_ = LeadAmong(PickNow, MirrorPicked_);
        if (const uint32_t Row = Outliner_.QueryPicked(); Row < RowCount_ && Bindings_[Row].RowRole == SolidArcOutlinerBinding::Role::Figure)
            Lead_ = Bindings_[Row].FigureIdentity;
        for (SceneFigure& Figure : Scene.Figures())
        {
            const bool In = std::binary_search(PickNow.begin(), PickNow.end(), Figure.Identity);
            if (In)
                Figure.Selected = true;
            else if (Figure.Selected || !Figure.SelectedFaces.empty() || !Figure.SelectedEdges.empty() || !Figure.SelectedPoles.empty())
            {
                Figure.Selected = false;
                Figure.SelectedFaces.clear();
                Figure.SelectedEdges.clear();
                Figure.SelectedPoles.clear();
            }
        }
        MirrorPicked_   = PickNow;
        MirrorSelected_ = Sorted(Identities(false));
    }
    else if (Acted || SelectedNow != MirrorSelected_)
    {
        // The view, a key or the console moved the document's selection: the outliner follows it.
        Lead_ = LeadAmong(SelectedNow, MirrorSelected_);
        MirrorSelected_ = SelectedNow;
        PushToOutliner(SelectedNow);
    }
}

void SolidArcEditorHost::Record(ConsoleHost& Host) noexcept
{
    SeatView(Host);
    // The raster is dear and the picture rarely changes: draw and read it back only when it has.
    if (Host.RenderIfChanged() || ViewImage_.Pixels.empty())
        ViewImage_ = Host.Raster().Readback();
    // The roster is rebuilt from the document each frame, so a folder's fold would reset. Carry it by folder label.
    ShutFolders_.clear();
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
        if (Rows_[Index].Depth == 0u && Bindings_[Index].RowRole == SolidArcOutlinerBinding::Role::None && Rows_[Index].Shut)
            ShutFolders_.emplace_back(Rows_[Index].Label);
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Bindings_.data(), kMaxEditorInstances, &Readout_);
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
        if (Rows_[Index].Depth == 0u && Bindings_[Index].RowRole == SolidArcOutlinerBinding::Role::None)
            Rows_[Index].Shut = std::find(ShutFolders_.begin(), ShutFolders_.end(), std::string(Rows_[Index].Label)) != ShutFolders_.end();
    if (!ViewImage_.Pixels.empty())
        Viewport_.AssignView(ViewImage_.Pixels.data(), ViewImage_.Width, ViewImage_.Height);
    else
        Viewport_.AssignView(nullptr, 0u, 0u);

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(ImVec2(Main->Pos.x, Main->Pos.y));
    ImGui::SetNextWindowSize(ImVec2(Main->Size.x, Main->Size.y));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    constexpr ImGuiWindowFlags HostFlags = ImGuiWindowFlags_NoTitleBar
                                         | ImGuiWindowFlags_NoResize
                                         | ImGuiWindowFlags_NoMove
                                         | ImGuiWindowFlags_NoScrollbar
                                         | ImGuiWindowFlags_NoScrollWithMouse
                                         | ImGuiWindowFlags_NoSavedSettings
                                         | ImGuiWindowFlags_NoBringToFrontOnFocus
                                         | ImGuiWindowFlags_NoNavFocus;
    if (ImGui::Begin("SolidArcDockHost", nullptr, HostFlags))
    {
        const ImGuiDockNodeFlags DockFlags =
            static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoWindowMenuButton);
        ConstructLayout();
        ImGui::DockSpace(ImGui::GetID("SolidArcEditorDockSpace"), ImVec2(0.0f, 0.0f), DockFlags);
    }
    ImGui::End();
    ImGui::PopStyleVar(2);

    Outliner_.Record(Rows_.data(), RowCount_);
    Viewport_.Record(Rows_.data(), RowCount_);

    // A Construct tile was chosen: place its figure at the next free spot on the workplane, a ring around the origin that
    //    widens as it fills, and seat the pick on it so the inspector shows what was just made.
    if (uint32_t Tile = 0u; Viewport_.QueryConstructPick(&Tile))
        PlaceConstruct(Host, Tile);

    ReconcileSelection(Host);

    const uint32_t Picked = Outliner_.QueryPicked();
    EditorInstance* PickedRow = (Picked < RowCount_) ? &Rows_[Picked] : nullptr;
    const SolidArcOutlinerBinding Selection = PickedRow != nullptr ? Bindings_[Picked] : SolidArcOutlinerBinding{};
    const bool SheetReady = BuildSolidArcInspectorSheet(Host, Selection, &PickedSheet_);
    Inspector_.Record(PickedRow, Picked, SheetReady ? &PickedSheet_ : nullptr);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Bindings_.data(), RowCount_);
    if (SheetReady && Picked < RowCount_)
        ApplySolidArcInspectorSheet(Host, Bindings_[Picked], PickedSheet_);

    // The notch records last, above the dock columns, onto the foreground list: the Project-Zero order, kept.
    if (ShadeSeated_)
    {
        const float UiScale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
        if (ShadeSurface_.Begin(SurfaceLayer::Above, Main->Size.x, Main->Size.y, UiScale))
        {
            const float BandLine = ImGui::GetStyle().TabHeight + ImGui::GetStyle().TabStripPadTop;
            Shade_.ConstructControlLayout(ShadeSurface_);
            Toasts_.ConstructNotificationLayout(ShadeSurface_, BandLine);
        }
    }
}

bool SolidArcEditorHost::PickRow(const char* Label, SolidArcOutlinerBinding::Role Role) noexcept
{
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
    {
        if (Bindings_[Index].RowRole != Role || (Label != nullptr && std::strcmp(Rows_[Index].Label, Label) != 0))
            continue;
        Outliner_.PickInstance(Index);
        return true;
    }
    return false;
}

bool SolidArcEditorHost::ExtendRow(const char* Label, SolidArcOutlinerBinding::Role Role) noexcept
{
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
    {
        if (Bindings_[Index].RowRole != Role || (Label != nullptr && std::strcmp(Rows_[Index].Label, Label) != 0))
            continue;
        Outliner_.TogglePick(Index);
        return true;
    }
    return false;
}

void SolidArcEditorHost::ClearPick() noexcept
{
    Outliner_.PickInstance(kNoEditorInstance);
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

} // namespace Frontier
