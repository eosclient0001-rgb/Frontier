//============================================================================================================================================
//                                                      MATERIALINSPECTOR.H
//============================================================================================================================================
// 🔍 M7a read-only material inspector: the loaded scene's material list, one selectable material, its reflectance
//    selection + complexity + slab counts, all 20 Sultan channels (value / source / texture), and the fold-report
//    lines attributed to it. M7b adds editing (the page's Apply/Discard pills stay dimmed until then).
//
// Data model: Rebuild() snapshots ONE material from a MaterialIndex every frame (the feeder — GameExecution or a
//    harness — calls it; the layout only reads the snapshot, so the F-panel summary stays fresh without opening the
//    page). Rows read the RESOLVED slab — Flatten(descriptor, limit).front(), the slab the Tier A kernel samples and
//    DeriveReflectance derives the selection from — never the authoring top slab, so a folded material shows exactly
//    what renders. Fold lines are attributed by the `material '<name>':` prefix Finalise writes.

#pragma once

#include "ControlKit.h"
#include "PixelSpace.h"
#include "../ContentInterchange/MaterialIndex.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                      CHANNEL SOURCE
//------------------------------------------------------------------------------------------------------------------------

// Where a channel row's value comes from. Constant = the scalar carrier holds it (a real number even when the selection
//    doesn't sample it — unread channels are retained, Sultan-42 §5); Imported = a texture is bound; Absent = nothing
//    carries the channel (scalar at default AND unbound), including row 20 which has no carrier at all (ACK:M6-none).
enum class MaterialChannelSource : uint8_t { Constant = 0u, Imported = 1u, Absent = 2u, Count = 3u };

// One of the 20 Sultan channels: formatted value, optional second detail line (sub-parameters that share the row's
//    carrier — coat IOR, film thickness, attenuation — never extra rows), source, and texture binding.
struct MaterialChannelRow
{
    const char*         Name = "";                // [txt] "01 base colour" (Sultan names, static table)
    char                Value[80]   = {};         // [txt] formatted primary value ("(0.8, 0.8, 0.8)", "0.3", "—")
    char                Detail[160] = {};         // [txt] sub-parameter line, "" when the row has none
    char                Texture[48] = {};         // [txt] "tex 3 · uv1 · B" or "—"
    MaterialChannelSource Source = MaterialChannelSource::Absent;
    [[nodiscard]] bool HasDetail() const noexcept { return Detail[0] != '\0'; }
};

static constexpr uint32_t kMaterialChannelRowCount = 20u;

// Static name tables (Sultan-42 §5 rows; MaterialReflectance / MaterialComplexityClass / MaterialChannelSource labels).
[[nodiscard]] const char* MaterialChannelRowName(uint32_t Row) noexcept;
[[nodiscard]] const char* MaterialSelectionName(MaterialReflectance Selection) noexcept;
[[nodiscard]] const char* MaterialComplexityName(uint32_t Complexity) noexcept;
[[nodiscard]] const char* MaterialChannelSourceName(MaterialChannelSource Source) noexcept;
[[nodiscard]] const char* MaterialTextureChannelName(TextureChannelSelection Channel) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                     MATERIAL INSPECTOR
//------------------------------------------------------------------------------------------------------------------------

class MaterialInspector
{
public:
    MaterialInspector() noexcept = default;

    // Seed the selection from the persisted [material] selected name (exact match at Rebuild, else material 0).
    // Never bumps the revision — the following Rebuild resolves it silently.
    void SeedSelection(const char* PersistedName) noexcept;

    // In-page selector pick. Clamps to the loaded materials, syncs the name, bumps the revision on change.
    [[nodiscard]] bool Select(uint32_t Id) noexcept;

    // Snapshot the selection from Index (nullptr or empty = cleared "no scene" state). Re-resolves the name, flattens
    //    the selected descriptor at the scene's slab limit, rebuilds the 20 rows + fold lines + status/summary lines.
    //    Bumps the revision iff the resolved NAME changed (scene swap, seed resolution, or selector pick via Select).
    void Rebuild(const MaterialIndex* Index) noexcept;

    // Records the page body (already clipped by the caller) offset by ScrollY; returns content height.
    float ConstructMaterialsLayout(PixelSpace& Surface, const PlaneExtent& Body, float ScrollY, const ControlPointer& Pointer, float Opacity) noexcept;
    // Selector dropdown menu (called after the body clip is popped, like Appearance's floating layer).
    void  ConstructFloatingLayout(PixelSpace& Surface, const ControlPointer& Pointer, float Opacity) noexcept;
    void  CloseMenus() noexcept { SelectorOpen = false; }
    [[nodiscard]] bool HasOpenMenu() const noexcept { return SelectorOpen; }

    [[nodiscard]] uint32_t                    QueryRevision()      const noexcept { return Revision; }
    [[nodiscard]] uint32_t                    QuerySelectedId()    const noexcept { return SelectedId; }
    [[nodiscard]] const char*                 QuerySelectedName()  const noexcept { return SelectedName; }
    [[nodiscard]] uint32_t                    QueryMaterialCount() const noexcept { return static_cast<uint32_t>(Names.size()); }
    [[nodiscard]] MaterialReflectance         QuerySelection()     const noexcept { return Selection; }
    [[nodiscard]] uint32_t                    QueryComplexity()    const noexcept { return Complexity; }
    [[nodiscard]] uint32_t                    QueryAuthoredSlabs() const noexcept { return AuthoredSlabs; }
    [[nodiscard]] uint32_t                    QueryResidentSlabs() const noexcept { return ResidentSlabs; }
    [[nodiscard]] uint32_t                    QuerySlabLimit()     const noexcept { return SlabLimit; }
    [[nodiscard]] const MaterialChannelRow&   QueryRow(uint32_t Row) const noexcept { return Rows[Row < kMaterialChannelRowCount ? Row : 0u]; }
    [[nodiscard]] uint32_t                    QueryFoldLineCount() const noexcept { return static_cast<uint32_t>(FoldLines.size()); }
    [[nodiscard]] const char*                 QueryFoldLine(uint32_t I) const noexcept { return I < FoldLines.size() ? FoldLines[I].c_str() : ""; }
    [[nodiscard]] const char*                 QueryStatusLine()    const noexcept { return StatusLine; }    // host footer pill
    [[nodiscard]] const char*                 QuerySummaryLine()   const noexcept { return SummaryLine; }   // F-panel row ("" = omit)
    [[nodiscard]] const PlaneExtent&          QuerySelectorExtent() const noexcept { return SelectorButton; }
    [[nodiscard]] const PlaneExtent&          QueryRowExtent(uint32_t Row) const noexcept { return RowExtents[Row < kMaterialChannelRowCount ? Row : 0u]; }

private:
    void BuildRows(const MaterialDescriptor& D, const MaterialSlabDescriptor& S) noexcept;
    void BuildStatusAndSummary() noexcept;

    uint32_t              Revision      = 0u;
    uint32_t              SelectedId    = 0u;
    char                  SelectedName[128] = {};
    MaterialReflectance   Selection     = MaterialReflectance::Standard;
    uint32_t              Complexity    = MaterialComplexitySimple;
    uint32_t              AuthoredSlabs = 0u;
    uint32_t              ResidentSlabs = 0u;
    uint32_t              SlabLimit     = 1u;
    MaterialChannelRow    Rows[kMaterialChannelRowCount];
    std::vector<std::string> Names;              // material names, Rebuild order (menu options)
    std::vector<const char*> NamePointers;       // c_str views into Names, rebuilt with them
    std::vector<std::string> FoldLines;          // fold-report lines attributed to the selection
    char                  StatusLine[192]  = {};
    char                  SummaryLine[192] = {};
    char                  HeaderSlabs[64]  = {};
    char                  HeaderFlags[128] = {};
    char                  SelectionText[32] = {};
    char                  ComplexityText[32] = {};
    bool                  SelectorOpen  = false;
    PlaneExtent           SelectorButton{};
    PlaneExtent           RowExtents[kMaterialChannelRowCount]{};
};

} // namespace Frontier
