//============================================================================================================================================
//                                                  MATERIALINSPECTORPROOF.CPP
//============================================================================================================================================
// M7a gate — the material-inspector proof. Nine archetype materials (opaque, metal, folded glass, cloth, subsurface,
//    emissive-only, unlit, coated+mask, one fully-loaded slab) walk the inspector: selection resolution, the
//    reflectance/complexity cross-check against Finalise's own records, all 20 Sultan rows (value/source/texture),
//    fold attribution, registry round-trip, headless layout (null AND recording surfaces), the selector menu flow,
//    host wiring, and the F-panel summary. No GPU, no window: imgui runs context-only (draw lists accumulate in CPU
//    memory, never rendered) and Vulkan appears as headers only (RayTracingCapabilitySet declarations).

#include "MaterialInspector.h"
#include "ControlCentreHost.h"
#include "ConfigurationRegistry.h"
#include "DiagnosticInspector.h"
#include "MaterialIndex.h"
#include "TextureIndex.h"
#include "OrientationClassifier.h"
#include "ReSTIRIntegrator.h"
#include "InputExchange.h"
#include "imgui.h"

#include <clocale>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int Passed = 0, Failed = 0, Serial = 0;

void Check(bool Condition, const char* Label)
{
    ++Serial;
    if (Condition) { ++Passed; std::printf("ok %d - %s\n", Serial, Label); }
    else           { ++Failed; std::printf("FAIL %d - %s\n", Serial, Label); }
    std::fflush(stdout);
}

bool Contains(const char* Haystack, const char* Needle)
{
    return Haystack && Needle && std::strstr(Haystack, Needle) != nullptr;
}

void Bind(Frontier::MaterialSlabDescriptor& S, Frontier::MaterialTextureChannel C, uint32_t Slot, uint8_t Uv,
          Frontier::TextureChannelSelection Ch, float Scalar = 1.0f)
{
    Frontier::TextureReference& T = S.Texture(C);
    T.Texture = Slot; T.UvSet = Uv; T.Channel = Ch; T.Scalar = Scalar;
}

} // namespace

int main()
{
    std::setlocale(LC_ALL, "C");
    using namespace Frontier;

    // ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    MaterialIndex Index;
    {
        MaterialDescriptor Brick; Brick.Name = "brick-01";
        MaterialSlabDescriptor S; S.SpecularRoughness = 0.9f;
        Bind(S, MaterialTextureChannel::BaseColor, 3u, 0u, TextureChannelSelection::Rgb);
        Bind(S, MaterialTextureChannel::GeometryNormal, 4u, 0u, TextureChannelSelection::Rgb);
        Brick.Slabs.push_back(S); Index.Register(Brick);

        MaterialDescriptor Steel; Steel.Name = "steel-02";
        MaterialSlabDescriptor M; M.BaseMetalness = 1.0f; M.SpecularRoughnessAnisotropy = 0.6f; M.SlateAnisotropyRotation = 0.5f;
        Steel.Slabs.push_back(M); Index.Register(Steel);

        MaterialDescriptor Glass; Glass.Name = "glass-01";   // implicit 3-slab vertical chain → folds at limit 1
        for (float W : { 0.9f, 0.5f, 0.3f }) { MaterialSlabDescriptor T; T.TransmissionWeight = W; Glass.Slabs.push_back(T); }
        Index.Register(Glass);

        MaterialDescriptor Velvet; Velvet.Name = "velvet-03";
        MaterialSlabDescriptor F; F.FuzzWeight = 0.8f; F.SpecularWeight = 0.0f;
        Velvet.Slabs.push_back(F); Index.Register(Velvet);

        MaterialDescriptor Wax; Wax.Name = "wax-04";
        MaterialSlabDescriptor W; W.SubsurfaceWeight = 0.6f; W.SubsurfaceRadius = 0.05f;
        W.SubsurfaceColor[0] = 0.9f; W.SubsurfaceColor[1] = 0.7f; W.SubsurfaceColor[2] = 0.6f;
        Wax.Slabs.push_back(W); Index.Register(Wax);

        MaterialDescriptor Lamp; Lamp.Name = "lamp-05";
        MaterialSlabDescriptor E; E.BaseWeight = 0.0f; E.SpecularWeight = 0.0f; E.EmissionLuminance = 5.0f;
        Lamp.Slabs.push_back(E); Index.Register(Lamp);

        MaterialDescriptor Ui; Ui.Name = "ui-06"; Ui.Flags = MaterialFlagUnlit;
        MaterialSlabDescriptor U; U.BaseColor[0] = 1.0f; U.BaseColor[1] = 0.0f; U.BaseColor[2] = 0.0f;
        Ui.Slabs.push_back(U); Index.Register(Ui);

        MaterialDescriptor Helmet; Helmet.Name = "helmet-08"; Helmet.Flags = MaterialFlagAlphaMask; Helmet.AlphaCutoff = 0.4f;
        MaterialSlabDescriptor C; C.CoatWeight = 0.5f; C.CoatRoughness = 0.1f; C.ThinFilmWeight = 0.3f;
        Bind(C, MaterialTextureChannel::ThinFilm, 17u, 0u, TextureChannelSelection::Rgb);
        Bind(C, MaterialTextureChannel::GeometryOpacity, 9u, 1u, TextureChannelSelection::R);
        Helmet.Slabs.push_back(C); Index.Register(Helmet);

        MaterialDescriptor Rich; Rich.Name = "rich-00";   // every carrier loaded (the 20-row deep-dive)
        MaterialSlabDescriptor R;
        R.BaseColor[0] = 0.2f; R.BaseColor[1] = 0.4f; R.BaseColor[2] = 0.6f; R.BaseMetalness = 0.9f; R.BaseDiffuseRoughness = 0.3f;
        R.SpecularColor[0] = 1.0f; R.SpecularColor[1] = 0.9f; R.SpecularColor[2] = 0.8f;
        R.SpecularRoughness = 0.35f; R.SpecularRoughnessAnisotropy = 0.4f; R.SlateAnisotropyRotation = 1.2f;
        R.SlateHazinessWeight = 0.1f; R.SlateGlintDensity = 0.5f; R.ThinFilmWeight = 0.2f;
        R.EmissionLuminance = 2.5f; R.EmissionColor[0] = 1.0f; R.EmissionColor[1] = 0.5f; R.EmissionColor[2] = 0.25f;
        R.GeometryOpacity = 0.75f;
        R.CoatWeight = 0.3f; R.CoatRoughness = 0.15f; R.CoatIor = 1.7f;
        R.FuzzWeight = 0.2f; R.FuzzColor[0] = 0.9f; R.FuzzColor[1] = 0.1f; R.FuzzColor[2] = 0.1f; R.FuzzRoughness = 0.6f;
        R.SubsurfaceWeight = 0.1f; R.SubsurfaceColor[0] = 0.8f; R.SubsurfaceColor[1] = 0.6f; R.SubsurfaceColor[2] = 0.5f;
        R.SubsurfaceRadius = 0.02f;
        R.TransmissionWeight = 0.4f; R.TransmissionDepth = 0.1f;
        R.TransmissionScatter[0] = 0.1f; R.TransmissionScatter[1] = 0.2f; R.TransmissionScatter[2] = 0.3f;
        R.TransmissionDispersionScale = 0.5f; R.TransmissionDispersionAbbeNumber = 30.0f;
        Bind(R, MaterialTextureChannel::BaseColor, 1u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::Metalness, 1u, 0u, TextureChannelSelection::B);
        Bind(R, MaterialTextureChannel::SpecularRoughness, 1u, 0u, TextureChannelSelection::G);
        Bind(R, MaterialTextureChannel::SpecularColor, 13u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::GeometryNormal, 2u, 1u, TextureChannelSelection::Rgb, 0.8f);
        Bind(R, MaterialTextureChannel::Occlusion, 5u, 0u, TextureChannelSelection::R, 0.7f);
        Bind(R, MaterialTextureChannel::Emission, 14u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::GeometryOpacity, 6u, 0u, TextureChannelSelection::A);
        Bind(R, MaterialTextureChannel::Anisotropy, 7u, 0u, TextureChannelSelection::B);
        Bind(R, MaterialTextureChannel::Coat, 8u, 0u, TextureChannelSelection::R);
        Bind(R, MaterialTextureChannel::GeometryCoatNormal, 10u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::Fuzz, 11u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::Subsurface, 15u, 0u, TextureChannelSelection::Rgb);
        Bind(R, MaterialTextureChannel::Transmission, 16u, 0u, TextureChannelSelection::R);
        Rich.Slabs.push_back(R); Index.Register(Rich);
    }
    std::vector<std::string> Report;
    Index.Finalise(1u, &Report);

    // ── A. Registry [material] ──────────────────────────────────────────────────────────────────────────────────
    {
        SlateConfiguration C;
        Check(C.Material.Selected.empty() && C.Material.Preview, "A1 defaults: empty selection, preview on");
        C.Material.Selected = "glass-01"; C.Material.Preview = false;
        const std::string Toml = ConfigurationRegistry::Serialise(C);
        Check(Contains(Toml.c_str(), "[material]") && Contains(Toml.c_str(), "glass-01"), "A2 serialise writes [material] selected");
        SlateConfiguration Back;
        std::string Error;
        Check(ConfigurationRegistry::Deserialise(Toml, Back, &Error) && Back.Material.Selected == "glass-01" && !Back.Material.Preview,
              "A3 round-trip preserves selected + preview");
        SlateConfiguration Missing;
        Check(ConfigurationRegistry::Deserialise("[render]\nquality = \"High\"\n", Missing, &Error) && Missing.Material.Selected.empty() && Missing.Material.Preview,
              "A4 old file without [material] keeps defaults");
        SlateConfiguration Unknown;
        Check(ConfigurationRegistry::Deserialise("[material]\nselected = \"x\"\nshaderball = true\n", Unknown, &Error) && Unknown.Material.Selected == "x",
              "A5 unknown keys ignored");
        Check(Back.Material == C.Material && !(Back.Material == SlateConfiguration{}.Material), "A6 round-trip equals source, differs from defaults");
    }

    // ── B. Fold retention ───────────────────────────────────────────────────────────────────────────────────────
    {
        Check(Report.size() == 1u, "B1 one fold line at limit 1 (glass only)");
        Check(Index.QueryFoldReport() == Report && !Index.QueryFoldReport().empty(), "B2 Finalise retains the report");
        Index.Finalise(8u, nullptr);
        Check(Index.QueryFoldReport().empty() && Report.size() == 1u, "B3 re-Finalise at 8 replaces retention, caller copy kept");
        Index.Finalise(1u, &Report);
        Check(Index.QueryFoldReport().size() == 1u, "B4 re-Finalise at 1 restores the fold line");
        MaterialIndex Empty;
        Empty.Finalise(1u, nullptr);
        Check(Empty.QueryFoldReport().empty(), "B5 empty index retains nothing");
    }

    // ── C. Walkthrough: selection × records cross-check ─────────────────────────────────────────────────────────
    MaterialInspector Insp;
    const char* Names[9] = { "brick-01", "steel-02", "glass-01", "velvet-03", "wax-04", "lamp-05", "ui-06", "helmet-08", "rich-00" };
    const MaterialReflectance Sels[9] = { MaterialReflectance::Standard, MaterialReflectance::Anisotropic, MaterialReflectance::Transmissive,
        MaterialReflectance::Cloth, MaterialReflectance::Subsurface, MaterialReflectance::EmissiveOnly, MaterialReflectance::Unlit,
        MaterialReflectance::ClearCoated, MaterialReflectance::Transmissive };
    const uint32_t Comps[9] = { MaterialComplexitySimple, MaterialComplexitySingle, MaterialComplexitySpecial, MaterialComplexitySingle,
        MaterialComplexitySpecial, MaterialComplexitySimple, MaterialComplexitySimple, MaterialComplexitySpecial, MaterialComplexitySpecial };
    const uint32_t Authored[9] = { 1u, 1u, 3u, 1u, 1u, 1u, 1u, 1u, 1u };
    for (uint32_t I = 0u; I < 9u; ++I)
    {
        char Label[96];
        Insp.SeedSelection(Names[I]);
        Insp.Rebuild(&Index);
        const MaterialRecord& Rec = Index.QueryRecords()[I];
        std::snprintf(Label, sizeof(Label), "C%u id resolves (%s)", I, Names[I]);
        Check(Insp.QuerySelectedId() == I && std::strcmp(Insp.QuerySelectedName(), Names[I]) == 0, Label);
        std::snprintf(Label, sizeof(Label), "C%u selection literal + record cross-check", I);
        Check(Insp.QuerySelection() == Sels[I] && static_cast<uint32_t>(Insp.QuerySelection()) == ((Rec.Flags >> kMaterialReflectanceShift) & 0xFu), Label);
        std::snprintf(Label, sizeof(Label), "C%u complexity literal + record cross-check", I);
        Check(Insp.QueryComplexity() == Comps[I] && Insp.QueryComplexity() == Rec.Complexity, Label);
        std::snprintf(Label, sizeof(Label), "C%u slab counts %u/%u + limit", I, Rec.SlabCount, Authored[I]);
        Check(Insp.QueryAuthoredSlabs() == Authored[I] && Insp.QueryResidentSlabs() == Rec.SlabCount && Insp.QuerySlabLimit() == 1u, Label);
        std::snprintf(Label, sizeof(Label), "C%u status line", I);
        Check(Contains(Insp.QueryStatusLine(), Names[I]) && Contains(Insp.QueryStatusLine(), MaterialSelectionName(Sels[I])), Label);
        std::snprintf(Label, sizeof(Label), "C%u summary line", I);
        Check(Contains(Insp.QuerySummaryLine(), Names[I]) && Contains(Insp.QuerySummaryLine(), MaterialComplexityName(Comps[I])), Label);
        std::snprintf(Label, sizeof(Label), "C%u fold attribution (%s)", I, I == 2u ? "one line" : "none");
        Check(Insp.QueryFoldLineCount() == (I == 2u ? 1u : 0u), Label);
    }
    Insp.SeedSelection("glass-01"); Insp.Rebuild(&Index);
    Check(Contains(Insp.QueryFoldLine(0), "material 'glass-01':") && Contains(Insp.QueryFoldLine(0), "3 slab(s) folded into 1") &&
          Contains(Insp.QueryFoldLine(0), "slab_limit 1"), "C10 glass fold line text + attribution");
    Check(std::strcmp(Insp.QueryFoldLine(7), "") == 0, "C11 fold accessor out-of-range returns empty");
    Check(std::strcmp(Insp.QuerySummaryLine(), "glass-01  \xC2\xB7  Transmissive  \xC2\xB7  Special  \xC2\xB7  1/3 slabs") == 0, "C12 glass summary exact");
    Check(std::strcmp(Insp.QueryStatusLine(), "9 materials - glass-01 - Transmissive") == 0, "C13 glass status exact");
    Check(Insp.QueryMaterialCount() == 9u, "C14 material count");

    // ── D. rich-00: all 20 rows ─────────────────────────────────────────────────────────────────────────────────
    Insp.SeedSelection("rich-00"); Insp.Rebuild(&Index);
    struct RowExpect { const char* Value; MaterialChannelSource Source; const char* Texture; };
    const RowExpect Rows[20] = {
        { "(0.2, 0.4, 0.6)", MaterialChannelSource::Imported, "tex 1 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "0.9",             MaterialChannelSource::Imported, "tex 1 \xC2\xB7 uv0 \xC2\xB7 B" },
        { "0.35",            MaterialChannelSource::Imported, "tex 1 \xC2\xB7 uv0 \xC2\xB7 G" },
        { "ior 1.5",         MaterialChannelSource::Imported, "tex 13 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "map",             MaterialChannelSource::Imported, "tex 2 \xC2\xB7 uv1 \xC2\xB7 rgb" },
        { "strength 0.7",    MaterialChannelSource::Imported, "tex 5 \xC2\xB7 uv0 \xC2\xB7 R" },
        { "2.5 nit",         MaterialChannelSource::Imported, "tex 14 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "0.75",            MaterialChannelSource::Imported, "tex 6 \xC2\xB7 uv0 \xC2\xB7 A" },
        { "0.4",             MaterialChannelSource::Imported, "tex 7 \xC2\xB7 uv0 \xC2\xB7 B" },
        { "1.2 rad",         MaterialChannelSource::Imported, "tex 7 \xC2\xB7 uv0 \xC2\xB7 B" },
        { "0.3",             MaterialChannelSource::Imported, "tex 8 \xC2\xB7 uv0 \xC2\xB7 R" },
        { "0.15",            MaterialChannelSource::Constant, "\xE2\x80\x94" },
        { "map",             MaterialChannelSource::Imported, "tex 10 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "(0.9, 0.1, 0.1)", MaterialChannelSource::Imported, "tex 11 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "0.6",             MaterialChannelSource::Constant, "\xE2\x80\x94" },
        { "(0.8, 0.6, 0.5)", MaterialChannelSource::Imported, "tex 15 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "0.02 m",          MaterialChannelSource::Imported, "tex 15 \xC2\xB7 uv0 \xC2\xB7 rgb" },
        { "0.4",             MaterialChannelSource::Imported, "tex 16 \xC2\xB7 uv0 \xC2\xB7 R" },
        { "1.5",             MaterialChannelSource::Constant, "\xE2\x80\x94" },
        { "no carrier",      MaterialChannelSource::Absent,   "\xE2\x80\x94" },
    };
    for (uint32_t I = 0u; I < 20u; ++I)
    {
        char Label[96];
        const MaterialChannelRow& Row = Insp.QueryRow(I);
        std::snprintf(Label, sizeof(Label), "D%u row %u value/source/texture", I, I + 1u);
        Check(std::strcmp(Row.Value, Rows[I].Value) == 0 && Row.Source == Rows[I].Source && std::strcmp(Row.Texture, Rows[I].Texture) == 0, Label);
    }
    Check(std::strcmp(Insp.QueryRow(8).Texture, Insp.QueryRow(9).Texture) == 0, "D20 anisotropy carrier shared by 09+10");
    Check(std::strcmp(Insp.QueryRow(15).Texture, Insp.QueryRow(16).Texture) == 0, "D21 subsurface carrier shared by 16+17");
    Check(std::strcmp(Insp.QueryRow(3).Value, "ior 1.5") == 0 && std::strcmp(Insp.QueryRow(18).Value, "1.5") == 0, "D22 IOR shared by 04+19");
    Check(Contains(Insp.QueryRow(0).Detail, "eon 0.3"), "D23 detail: EON roughness");
    Check(Contains(Insp.QueryRow(2).Detail, "glint d 0.5") && Contains(Insp.QueryRow(2).Detail, "uv 1"), "D24 detail: glint");
    Check(Contains(Insp.QueryRow(3).Detail, "tint (1, 0.9, 0.8)") && Contains(Insp.QueryRow(3).Detail, "haze w 0.1 r 0.6") &&
          Contains(Insp.QueryRow(3).Detail, "film w 0.2 t 0.5 \xC2\xB5m n 1.4"), "D25 detail: tint + haze + film");
    Check(Contains(Insp.QueryRow(4).Detail, "scale 0.8"), "D26 detail: normal scale");
    Check(Contains(Insp.QueryRow(6).Detail, "tint (1, 0.5, 0.25)"), "D27 detail: emission tint");
    Check(Contains(Insp.QueryRow(10).Detail, "ior 1.7"), "D28 detail: coat IOR");
    Check(Contains(Insp.QueryRow(13).Detail, "weight 0.2") && Contains(Insp.QueryRow(13).Detail, "rough 0.6"), "D29 detail: fuzz");
    Check(Contains(Insp.QueryRow(15).Detail, "weight 0.1"), "D30 detail: subsurface weight");
    Check(Contains(Insp.QueryRow(17).Detail, "depth 0.1 m") && Contains(Insp.QueryRow(17).Detail, "atten (0.1, 0.2, 0.3)") &&
          Contains(Insp.QueryRow(17).Detail, "disp x0.5 Abbe 30"), "D31 detail: transmission volume");
    Check(!Insp.QueryRow(1).HasDetail() && !Insp.QueryRow(19).HasDetail(), "D32 no detail where no sub-params");

    // Spot rows on the other archetypes (sources + retention, one assert each).
    Insp.SeedSelection("brick-01"); Insp.Rebuild(&Index);
    Check(std::strcmp(Insp.QueryRow(0).Value, "(0.8, 0.8, 0.8)") == 0 && Insp.QueryRow(0).Source == MaterialChannelSource::Imported, "D33 brick base imported");
    Check(std::strcmp(Insp.QueryRow(2).Value, "0.9") == 0 && Insp.QueryRow(2).Source == MaterialChannelSource::Constant, "D34 brick roughness constant");
    Check(Insp.QueryRow(7).Source == MaterialChannelSource::Absent, "D35 brick opacity-1-unbound absent");
    Insp.SeedSelection("steel-02"); Insp.Rebuild(&Index);
    Check(std::strcmp(Insp.QueryRow(9).Value, "0.5 rad") == 0 && Insp.QueryRow(9).Source == MaterialChannelSource::Constant, "D36 steel direction constant (active, unbound)");
    Insp.SeedSelection("velvet-03"); Insp.Rebuild(&Index);
    Check(Insp.QueryRow(13).Source == MaterialChannelSource::Constant && Contains(Insp.QueryRow(13).Detail, "weight 0.8"), "D37 velvet sheen constant via weight");
    Check(Insp.QueryRow(14).Source == MaterialChannelSource::Constant, "D38 velvet sheen roughness constant via weight");
    Insp.SeedSelection("lamp-05"); Insp.Rebuild(&Index);
    Check(std::strcmp(Insp.QueryRow(6).Value, "5 nit") == 0, "D39 lamp emission value");
    Check(std::strcmp(Insp.QueryRow(0).Value, "(0.8, 0.8, 0.8)") == 0 && Insp.QueryRow(0).Source == MaterialChannelSource::Constant,
          "D40 lamp base retained though unread (weight 0)");
    Insp.SeedSelection("helmet-08"); Insp.Rebuild(&Index);
    Check(Insp.QueryRow(3).Source == MaterialChannelSource::Imported && Contains(Insp.QueryRow(3).Texture, "tex 17") &&
          Contains(Insp.QueryRow(3).Detail, "film w 0.3"), "D41 helmet film texture feeds 04 (spec unbound)");
    Check(Insp.QueryRow(7).Source == MaterialChannelSource::Imported && std::strcmp(Insp.QueryRow(7).Value, "1") == 0,
          "D42 helmet opacity bound-but-1 is imported, not absent");
    Check(Insp.QueryRow(11).Source == MaterialChannelSource::Constant && Insp.QueryRow(12).Source == MaterialChannelSource::Constant &&
          std::strcmp(Insp.QueryRow(12).Value, "mesh frame") == 0,
          "D43 helmet coat rough constant, coat orientation mesh-frame (active, unbound)");
    Insp.SeedSelection("ui-06"); Insp.Rebuild(&Index);
    Check(std::strcmp(Insp.QueryRow(0).Value, "(1, 0, 0)") == 0, "D44 ui base red");

    // ── E. Selection edges ──────────────────────────────────────────────────────────────────────────────────────────
    {
        const uint32_t Before = Insp.QueryRevision();
        Insp.SeedSelection("no-such-material"); Insp.Rebuild(&Index);
        Check(Insp.QuerySelectedId() == 0u && Insp.QueryRevision() == Before + 1u, "E1 unknown name falls back to 0 + bumps");
        const uint32_t AtBrick = Insp.QueryRevision();
        Insp.Rebuild(&Index);
        Check(Insp.QueryRevision() == AtBrick, "E2 steady Rebuild never bumps");
        Check(!Insp.Select(0u) && Insp.QueryRevision() == AtBrick, "E3 Select(same) returns false, no bump");
        Check(Insp.Select(4u) && Insp.QuerySelectedId() == 4u && Insp.QueryRevision() == AtBrick + 1u, "E4 Select(other) bumps");
        Check(Insp.Select(99u) && Insp.QuerySelectedId() == 8u, "E5 Select clamps to last");
        const uint32_t AtRich = Insp.QueryRevision();
        Insp.SeedSelection("steel-02"); Insp.Rebuild(&Index);
        Check(Insp.QuerySelectedId() == 1u && Insp.QueryRevision() == AtRich, "E6 valid seed resolves silently (already persisted)");
        MaterialInspector Cleared;
        Cleared.SeedSelection("brick-01"); Cleared.Rebuild(&Index);
        Cleared.Rebuild(nullptr);
        Check(Cleared.QueryMaterialCount() == 0u && std::strcmp(Cleared.QueryStatusLine(), "no scene") == 0 &&
              Cleared.QuerySummaryLine()[0] == '\0' && Cleared.QueryRow(0).Source == MaterialChannelSource::Absent,
              "E7 null Rebuild clears to no-scene state");
        MaterialIndex Empty;
        Empty.Finalise(1u, nullptr);
        Cleared.Rebuild(&Empty);
        Check(Cleared.QueryMaterialCount() == 0u, "E8 empty index clears");
        MaterialInspector Fresh;
        Fresh.Rebuild(&Index);
        Check(Fresh.QuerySelectedId() == 0u && std::strcmp(Fresh.QuerySelectedName(), "brick-01") == 0, "E9 empty seed resolves to first");
    }

    // ── F/G/H/I need imgui (recording surface) ──────────────────────────────────────────────────────────────────────
    ImGui::CreateContext();
    {
        // A bare context never ran a frame: the draw lists' pixel density is 0 until NewFrame (without this,
        //    imgui asserts inside _SetPixelDensity on the first recording call).
        ImGuiIO& IO = ImGui::GetIO();
        unsigned char* AtlasPixels = nullptr; int AtlasW = 0, AtlasH = 0;
        IO.Fonts->GetTexDataAsRGBA32(&AtlasPixels, &AtlasW, &AtlasH);   // CPU-side atlas build (never uploaded)
        IO.DisplaySize = ImVec2(1280.0f, 800.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        ImGui::NewFrame();
    }
    {
        // F. Layout headless: recording vs null surfaces agree exactly.
        Insp.SeedSelection("rich-00"); Insp.Rebuild(&Index);
        PixelSpace Recording;
        Check(Recording.Begin(SurfaceLayer::Above, 1280.0f, 800.0f, 1.0f), "F1 recording Begin succeeds with a context");
        const PlaneExtent Body = Spanning(0.0f, 0.0f, 800.0f, 600.0f);
        ControlPointer Idle{};
        const float H = Insp.ConstructMaterialsLayout(Recording, Body, 0.0f, Idle, 1.0f);
        Check(H > 600.0f, "F2 content height sane (header + 20 rows)");
        Check(Insp.QuerySelectorExtent().Width() > 100.0f, "F3 selector extent recorded");
        bool Ordered = true;
        for (uint32_t I = 1u; I < 20u; ++I)
            Ordered = Ordered && Insp.QueryRowExtent(I).MinimumY > Insp.QueryRowExtent(I - 1u).MaximumY - 4.0f;
        Check(Ordered, "F4 row extents Y-ordered");
        bool Heights = true;
        for (uint32_t I = 0u; I < 20u; ++I)
        {
            const float Want = 24.0f + (Insp.QueryRow(I).HasDetail() ? 16.0f : 0.0f);
            Heights = Heights && std::fabs(Insp.QueryRowExtent(I).Height() - Want) < 0.01f;
        }
        Check(Heights, "F5 row heights match detail presence");
        PixelSpace Null;   // never begun: every primitive is a no-op
        MaterialInspector Twin;
        Twin.SeedSelection("rich-00"); Twin.Rebuild(&Index);
        const float HNull = Twin.ConstructMaterialsLayout(Null, Body, 0.0f, Idle, 1.0f);
        Check(HNull == H && Twin.QueryRowExtent(7).MinimumY == Insp.QueryRowExtent(7).MinimumY, "F6 null surface lays out identically");
        MaterialInspector Bare;
        const float HBare = Bare.ConstructMaterialsLayout(Null, Body, 0.0f, Idle, 1.0f);
        Check(HBare > 0.0f, "F7 empty state lays out without crashing");

        // G. Selector menu flow with a synthetic pointer.
        Insp.SeedSelection("brick-01"); Insp.Rebuild(&Index);
        Insp.ConstructMaterialsLayout(Recording, Body, 0.0f, Idle, 1.0f);
        const PlaneExtent Button = Insp.QuerySelectorExtent();
        ControlPointer Tap{};
        Tap.X = (Button.MinimumX + Button.MaximumX) * 0.5f; Tap.Y = (Button.MinimumY + Button.MaximumY) * 0.5f;
        Tap.Released = true;
        Insp.ConstructMaterialsLayout(Recording, Body, 0.0f, Tap, 1.0f);
        Check(Insp.HasOpenMenu(), "G1 release on the selector opens the menu");
        const PlaneExtent Menu = ControlKit::DropdownMenuExtent(Button, 9u);
        const float OptionY = Menu.MinimumY + 6.0f + 3u * (ControlKit::DropdownOptionHeight + 2.0f) + ControlKit::DropdownOptionHeight * 0.5f;
        ControlPointer Pick{};
        Pick.X = (Menu.MinimumX + Menu.MaximumX) * 0.5f; Pick.Y = OptionY; Pick.Released = true;
        const uint32_t RevBefore = Insp.QueryRevision();
        Insp.ConstructFloatingLayout(Recording, Pick, 1.0f);
        Check(!Insp.HasOpenMenu() && Insp.QuerySelectedId() == 3u && std::strcmp(Insp.QuerySelectedName(), "velvet-03") == 0 &&
              Insp.QueryRevision() == RevBefore + 1u, "G2 option pick selects + bumps + closes");
        Insp.ConstructMaterialsLayout(Recording, Body, 0.0f, Tap, 1.0f);
        Check(Insp.HasOpenMenu(), "G3 menu reopens");
        ControlPointer Away{};
        Away.X = 5.0f; Away.Y = 595.0f; Away.Released = true;
        Insp.ConstructFloatingLayout(Recording, Away, 1.0f);
        Check(!Insp.HasOpenMenu() && Insp.QuerySelectedId() == 3u, "G4 release outside closes without picking");
        Bare.ConstructFloatingLayout(Recording, Pick, 1.0f);
        Check(!Bare.HasOpenMenu(), "G5 floating with no materials is a no-op");

        // H. Host wiring.
        ControlCentreHost Host;
        Check(Host.Initialize(1280u, 800u), "H1 host initializes headless");
        Host.OpenNotch();   // the sheet starts closed; pages record once it is open
        Host.NavigateToPage(ControlCentrePageCategory::SettingsHub);
        for (int I = 0; I < 240; ++I) Host.AdvanceLocomotion(1.0f / 60.0f);
        Check(std::fabs(Host.QueryCardExtent().Height() - 557.0f) < 2.0f && std::fabs(Host.QueryCardExtent().Width() - 420.0f) < 2.0f,
              "H2 hub card settles at 420x557 (five rows)");
        const PlaneExtent R3 = Host.QueryHubRowExtent(3u), R4 = Host.QueryHubRowExtent(4u);
        Check(R4.Height() == 76.0f && R4.MinimumY == R3.MinimumY + 77.0f, "H3 fifth hub row geometry follows row four");
        Host.NavigateToPage(ControlCentrePageCategory::Dashboard);
        for (int I = 0; I < 240; ++I) Host.AdvanceLocomotion(1.0f / 60.0f);
        Check(std::fabs(Host.QueryCardExtent().Height() - 480.0f) < 2.0f, "H4 dashboard card keeps 420x480");
        Host.NavigateToPage(ControlCentrePageCategory::Materials);
        Check(Host.QueryActivePage() == ControlCentrePageCategory::Materials, "H5 navigate to Materials");
        for (int I = 0; I < 60; ++I) Host.AdvanceLocomotion(1.0f / 60.0f);   // the swap draws PreviousPage until P >= 0.5
        Host.AccessMaterials().SeedSelection("wax-04");
        Host.AccessMaterials().Rebuild(&Index);
        Host.ConstructControlLayout(Recording);
        Check(Host.QueryMaterials().QuerySelectorExtent().Width() > 100.0f, "H6 page records the selector through the host");
        Check(!Host.IsPageDirty(), "H7 Materials never dirty (M7a read-only)");
        Host.NavigateBack();
        Check(Host.QueryActivePage() == ControlCentrePageCategory::Dashboard, "H8 back navigates away");
        Host.NavigateToPage(ControlCentrePageCategory::Materials);
        for (int I = 0; I < 60; ++I) Host.AdvanceLocomotion(1.0f / 60.0f);
        Host.ConstructControlLayout(Null);
        Check(true, "H9 full host layout on a null surface does not crash");

        // I. F-panel summary.
        DiagnosticInspector Diagnostics;
        InputExchange Keys;
        Keys.AssignKeyState(VirtualKeyCategory::KeyF3, true);
        Check(!Diagnostics.AdvanceInteraction(Keys), "I1 first F3 opens without a settings change");
        Keys.AssignKeyState(VirtualKeyCategory::KeyF3, false);
        Diagnostics.AdvanceInteraction(Keys);
        Keys.AssignKeyState(VirtualKeyCategory::KeyF3, true);
        Check(Diagnostics.AdvanceInteraction(Keys), "I2 second F3 cycles the view (proves the first opened it)");
        Insp.SeedSelection("glass-01"); Insp.Rebuild(&Index);
        const VisibilityTelemetry Tele{};
        const ReSTIRIntegratorConfiguration ReSTIR{};
        const TextureIndexMetrics TexStats{};
        Diagnostics.ConstructInspectorLayout(Recording, 0.0f, 1280.0f, Tele, 0u, false, ReSTIR,
                                             Index.QueryMetrics(), TexStats, 1u, Insp.QuerySummaryLine());
        Check(true, "I3 inspector layout with a material summary does not crash");
        Diagnostics.ConstructInspectorLayout(Recording, 0.0f, 1280.0f, Tele, 0u, false, ReSTIR,
                                             Index.QueryMetrics(), TexStats, 1u, nullptr);
        Check(true, "I4 inspector layout with no summary (omitted row) does not crash");
    }
    ImGui::DestroyContext();

    if (Failed == 0) std::printf("MATERIAL INSPECTOR: PASS (%d/%d)\n", Passed, Passed + Failed);
    else std::printf("MATERIAL INSPECTOR: FAIL (%d passed, %d failed)\n", Passed, Failed);
    return Failed == 0 ? 0 : 1;
}
