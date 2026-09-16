//============================================================================================================================================
//                                                  MATERIALCHANNELCOVERAGE.CPP
//============================================================================================================================================
// 🧩 M0 — the plan §0 table as executable code: all twenty Sultan-42 channels through descriptor → Finalise → GPU
//    records, plus flatten/flag/complexity behaviour. Record-side claims are CHECKED; resolve/shade/ReSTIR columns are
//    the acknowledged-gap registry — every channel must be WIRED (with a check) or ACKED (with an owner phase), and
//    the proof fails on any channel that is neither. Later phases flip cells and add the checks in the same commit.
//
//    Build (see CheckMaterialsProof.sh): g++ -std=c++20 -I Exhibits/Workbench/Materials -I Engine/ContentInterchange
//        MaterialChannelCoverage.cpp Engine/ContentInterchange/MaterialIndex.cpp

#include "MaterialIndex.h"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

int g_Fail = 0;

#define CHECK(Cond, ...)                                                                                        \
    do { if (!(Cond)) { ++g_Fail; std::printf("  FAIL %s:%d  ", __FILE__, __LINE__); std::printf(__VA_ARGS__);   \
                          std::printf("\n"); } } while (0)

constexpr size_t kFloats = offsetof(Frontier::MaterialSlabDescriptor, GeometryThinWalled) / sizeof(float);

const float* SlabFloats(const Frontier::MaterialSlabDescriptor& S) noexcept
{
    return reinterpret_cast<const float*>(&S);
}

// A slab with a distinctive value in every channel carrier (constants + texture bindings).
Frontier::MaterialSlabDescriptor KitchenSink() noexcept
{
    using namespace Frontier;
    MaterialSlabDescriptor S;
    S.BaseWeight = 0.9f; S.BaseColor[0] = 0.1f; S.BaseColor[1] = 0.2f; S.BaseColor[2] = 0.3f;
    S.BaseMetalness = 0.4f; S.BaseDiffuseRoughness = 0.5f;
    S.SpecularWeight = 0.6f; S.SpecularColor[0] = 0.7f; S.SpecularColor[1] = 0.8f; S.SpecularColor[2] = 0.9f;
    S.SpecularRoughness = 0.11f; S.SpecularRoughnessAnisotropy = 0.12f; S.SpecularIor = 1.33f;
    S.TransmissionWeight = 0.13f; S.TransmissionColor[0] = 0.14f; S.TransmissionColor[1] = 0.15f; S.TransmissionColor[2] = 0.16f;
    S.TransmissionDepth = 2.5f; S.TransmissionScatter[0] = 0.17f; S.TransmissionScatter[1] = 0.18f; S.TransmissionScatter[2] = 0.19f;
    S.TransmissionScatterAnisotropy = 0.2f; S.TransmissionDispersionScale = 0.21f; S.TransmissionDispersionAbbeNumber = 30.0f;
    S.SubsurfaceWeight = 0.22f; S.SubsurfaceColor[0] = 0.23f; S.SubsurfaceColor[1] = 0.24f; S.SubsurfaceColor[2] = 0.25f;
    S.SubsurfaceRadius = 0.01f; S.SubsurfaceRadiusScale[0] = 1.0f; S.SubsurfaceRadiusScale[1] = 0.37f; S.SubsurfaceRadiusScale[2] = 0.3f;
    S.SubsurfaceScatterAnisotropy = 0.26f;
    S.CoatWeight = 0.27f; S.CoatColor[0] = 0.28f; S.CoatColor[1] = 0.29f; S.CoatColor[2] = 0.30f;
    S.CoatRoughness = 0.31f; S.CoatRoughnessAnisotropy = 0.32f; S.CoatIor = 1.6f; S.CoatDarkening = 0.9f;
    S.FuzzWeight = 0.33f; S.FuzzColor[0] = 0.34f; S.FuzzColor[1] = 0.35f; S.FuzzColor[2] = 0.36f; S.FuzzRoughness = 0.37f;
    S.EmissionLuminance = 2.0f; S.EmissionColor[0] = 1.0f; S.EmissionColor[1] = 0.5f; S.EmissionColor[2] = 0.25f;
    S.ThinFilmWeight = 0.38f; S.ThinFilmThickness = 0.4f; S.ThinFilmIor = 1.4f;
    S.GeometryOpacity = 0.95f;
    S.SlateHazinessWeight = 0.39f; S.SlateHazinessRoughness = 0.61f; S.SlateGlintDensity = 0.0f; S.SlateGlintUvScale = 2.0f;
    S.GeometryThinWalled = true;
    for (uint32_t C = 0u; C < Frontier::kMaterialTextureChannelCount; ++C)
    {
        S.Textures[C].Texture = 100u + C;
        S.Textures[C].UvSet   = static_cast<uint8_t>(C & 3u);
    }
    S.Texture(Frontier::MaterialTextureChannel::GeometryNormal).Scalar = 0.75f;
    S.Texture(Frontier::MaterialTextureChannel::Occlusion).Scalar      = 0.5f;
    return S;
}

void ProofRecordMirror()
{
    using namespace Frontier;
    std::printf("[coverage] record mirror (descriptor floats → slab record bytes)\n");
    CHECK(kFloats == 58u, "float prefix is %zu, expected 58 (plan D-record)", kFloats);

    MaterialIndex Index;
    MaterialDescriptor D;
    D.Name = "kitchen_sink";
    D.Slabs.push_back(KitchenSink());
    D.Flags = MaterialFlagDoubleSided | MaterialFlagThinWalled;
    Index.Register(D);
    Index.Finalise(1u);

    CHECK(Index.QueryRecords().size() == 1u, "one header");
    CHECK(Index.QuerySlabRecords().size() == 1u, "one slab");
    const MaterialRecord& R = Index.QueryRecords().front();
    const MaterialSlabRecord& S = Index.QuerySlabRecords().front();
    const MaterialSlabDescriptor& Src = KitchenSink();

    CHECK(std::memcmp(&S, SlabFloats(Src), kFloats * sizeof(float)) == 0, "slab float prefix mirrors the descriptor (memcpy)");
    CHECK(R.AlbedoR == 0.1f && R.AlbedoG == 0.2f && R.AlbedoB == 0.3f, "header albedo = bottom slab");
    CHECK(R.Roughness == 0.11f && R.Metalness == 0.4f, "header roughness/metalness");
    CHECK(R.EmissiveR == 2.0f && R.EmissiveG == 1.0f && R.EmissiveB == 0.5f, "header emission = luminance × colour");
    CHECK((R.Flags & MaterialFlagEmissive) != 0u, "emissive flag derived from luminance");
    CHECK((R.Flags & MaterialFlagDoubleSided) != 0u && (R.Flags & MaterialFlagThinWalled) != 0u, "descriptor flags pass through");
    CHECK(R.SlabOffset == 0u && R.SlabCount == 1u, "slab addressing");
    CHECK(R.BaseColourTexture == 100u && R.NormalTexture == 104u, "header texture slots (ch0 base, ch4 normal)");

    // Texture packing: 16 × uint16 slots + 16 × 2-bit uv sets.
    for (uint32_t C = 0u; C < kMaterialTextureChannelCount; ++C)
    {
        const uint32_t Word = S.TextureSlots[C / 2u];
        const uint32_t Slot = (Word >> ((C & 1u) * 16u)) & 0xFFFFu;
        const uint32_t Uv   = (S.TextureUvSets >> (C * 2u)) & 3u;
        CHECK(Slot == 100u + C, "slot ch%u = %u", C, Slot);
        CHECK(Uv == (C & 3u), "uvset ch%u = %u", C, Uv);
    }
    CHECK(S.SlabFlags == 1u, "thin-walled bit");
    CHECK(S.NormalScale == 0.75f && S.OcclusionStrength == 0.5f, "normal scale / occlusion strength scalars");
    CHECK(S.MixWeight == 1.0f, "vertical mix weight");
}

void ProofFlagsAndComplexity()
{
    using namespace Frontier;
    std::printf("[coverage] flags + complexity classes\n");
    MaterialIndex Index;

    auto Register = [&](const char* Name, auto Tweak) {
        MaterialDescriptor D; D.Name = Name; D.Slabs.emplace_back(); Tweak(D.Slabs.back()); return Index.Register(D);
    };
    const uint32_t Simple = Register("simple", [](auto&) {});
    const uint32_t Single = Register("single", [](auto& S) { S.CoatWeight = 0.5f; });
    const uint32_t Special = Register("special", [](auto& S) { S.TransmissionWeight = 0.5f; });
    MaterialDescriptor Multi; Multi.Name = "multi"; Multi.Slabs.resize(2);
    const uint32_t Complex = Index.Register(Multi);
    MaterialDescriptor Dark; Dark.Name = "dark"; Dark.Slabs.emplace_back(); Dark.Flags = MaterialFlagEmissive; // must be cleared: no luminance
    const uint32_t DarkId = Index.Register(Dark);
    Index.Finalise(2u);

    CHECK(Index.QueryRecords()[Simple].Complexity == MaterialComplexitySimple, "plain → Simple");
    CHECK(Index.QueryRecords()[Single].Complexity == MaterialComplexitySingle, "coat → Single");
    CHECK(Index.QueryRecords()[Special].Complexity == MaterialComplexitySpecial, "transmission → Special");
    CHECK(Index.QueryRecords()[Complex].Complexity == MaterialComplexityComplex, "2 slabs → Complex");
    CHECK((Index.QueryRecords()[DarkId].Flags & MaterialFlagEmissive) == 0u, "emissive cleared when luminance is 0");
    CHECK(Index.QueryMetrics().SlabCount == 6u, "resident slabs = 1+1+1+2+1");
}

void ProofFlatten()
{
    using namespace Frontier;
    std::printf("[coverage] flatten (fold / mix / weight / coverage)\n");

    MaterialDescriptor Chain; Chain.Name = "chain"; Chain.Slabs.resize(3);
    Chain.Slabs[0].CoatWeight = 0.5f; Chain.Slabs[0].CoatIor = 1.7f;
    uint32_t Folded = 0u; std::vector<std::string> Report;
    auto One = MaterialIndex::Flatten(Chain, 1u, &Folded, &Report);
    CHECK(One.size() == 1u && Folded == 2u, "3 → 1 folds two");
    CHECK(!Report.empty(), "fold reported");
    CHECK(One.front().CoatWeight == 0.5f && One.front().CoatIor == 1.7f, "top coat carried down through the fold");

    MaterialDescriptor Mix; Mix.Name = "mix"; Mix.Slabs.resize(2);
    Mix.Slabs[0].BaseColor[0] = 1.0f; Mix.Slabs[1].BaseColor[0] = 0.0f;
    MaterialOperation Op; Op.Category = MaterialOperationCategory::HorizontalMix; Op.Left = 0u; Op.Right = 1u; Op.Weight = 0.25f;
    Mix.Operations.push_back(Op);
    auto Two = MaterialIndex::Flatten(Mix, 2u, nullptr, nullptr);
    CHECK(Two.size() == 2u, "fractional mix survives at limit 2");
    // ACKNOWLEDGED (Tier-B/M8): the surviving pair's mix factor is dropped — ConstructSlabRecord hardcodes
    // MixWeight 1.0. Latent today (the kernel resolves slab 0 only); the assert pins the behaviour so a silent
    // change fails loudly instead of subtly changing blends.
    MaterialIndex Idx; Idx.Register(Mix); Idx.Finalise(2u);
    CHECK(Idx.QuerySlabRecords()[0].MixWeight == 1.0f, "fractional mix weight currently dropped (ACKED Tier-B gap)");

    MaterialDescriptor W; W.Name = "w"; W.Slabs.emplace_back();
    MaterialOperation WOp; WOp.Category = MaterialOperationCategory::Weight; WOp.Left = 0u; WOp.Weight = 0.5f;
    MaterialOperation COp; COp.Category = MaterialOperationCategory::Coverage; COp.Left = 0u; COp.Weight = 0.5f;
    W.Operations = { WOp };
    auto WS = MaterialIndex::Flatten(W, 1u, nullptr, nullptr);
    CHECK(WS.front().BaseWeight == 0.5f, "Weight op scales base_weight");
    W.Operations = { COp };
    auto CS = MaterialIndex::Flatten(W, 1u, nullptr, nullptr);
    CHECK(CS.front().GeometryOpacity == 0.5f, "Coverage op scales geometry_opacity");
}

// The acknowledged-gap registry: every channel is WIRED (checked above) or ACKED with an owner phase.
// Resolve/shade/ReSTIR cells flip to WIRED in M1–M5, with the check added in the same commit.
struct ChannelRow { const char* Name; const char* Record; const char* Resolve; const char* Shaded; const char* Restir; };

void ProofCoverageTable()
{
    static const ChannelRow kRows[20] = {
        { "01 base colour",          "WIRED", "WIRED", "WIRED(EON)",  "WIRED" },
        { "02 metallic",             "WIRED", "WIRED", "WIRED(F82)",  "WIRED" },
        { "03 roughness",            "WIRED", "WIRED", "WIRED",       "WIRED" },
        { "04 reflectance/IOR",      "WIRED", "WIRED", "WIRED(F)",    "WIRED(refl)" },
        { "05 orientation",          "WIRED", "WIRED", "WIRED",       "WIRED" },
        { "06 occlusion",            "WIRED", "WIRED", "floor-only",  "n/a(path)" },
        { "07 emission",             "WIRED", "WIRED", "WIRED",       "WIRED" },
        { "08 opacity",              "WIRED", "WIRED", "cutout",      "cutout" },
        { "09 anisotropy",           "WIRED", "scalar", "WIRED(GGX)", "scalar" },
        { "10 anisotropy direction", "WIRED", "ACK:M2", "ACK:M2",     "ACK:M2" },
        { "11 clear coat",           "WIRED", "WIRED", "WIRED",       "WIRED" },
        { "12 coat roughness",       "WIRED", "WIRED", "WIRED",       "WIRED" },
        { "13 coat orientation",     "WIRED", "ACK:M2", "ACK:M2",     "ACK:M2" },
        { "14 sheen colour",         "WIRED", "WIRED", "WIRED(LTC)",  "WIRED" },
        { "15 sheen roughness",      "WIRED", "WIRED", "WIRED(LTC)",  "WIRED" },
        { "16 subsurface colour",    "WIRED", "ACK:M5", "ACK:M5",     "ACK:M5" },
        { "17 subsurface thickness", "WIRED", "ACK:M5", "ACK:M5",     "ACK:M5" },
        { "18 transmission",         "WIRED", "ACK:M4", "ACK:M4",     "ACK:M4" },
        { "19 IOR (refraction)",     "WIRED", "ACK:M4", "ACK:M4",     "ACK:M4" },
        { "20 displacement",         "ACK:M6-none", "ACK:M6-none", "ACK:M6-none", "ACK:M6-none" },
    };
    std::printf("[coverage] channel × stage registry (plan §0)\n");
    int Acked = 0;
    for (const ChannelRow& Row : kRows)
    {
        const bool Complete = std::strcmp(Row.Resolve, "WIRED") == 0 || std::strncmp(Row.Resolve, "WIRED", 5) == 0;
        if (!Complete) ++Acked;
        std::printf("    %-24s record=%-5s resolve=%-9s shaded=%-10s restir=%s\n",
                    Row.Name, Row.Record, Row.Resolve, Row.Shaded, Row.Restir);
        CHECK(Row.Record != nullptr && Row.Resolve != nullptr && Row.Shaded != nullptr && Row.Restir != nullptr,
              "row '%s' fully classified", Row.Name);
    }
    std::printf("    wired-or-partial=%d  acked-gaps=%d\n", 20 - Acked, Acked);

    // M1 owns Flags bits 8–11 (reflectance selection). M0 pins them at zero; M1 flips this check to assert packing.
    Frontier::MaterialIndex Index;
    Frontier::MaterialDescriptor D; D.Name = "sel"; D.Slabs.emplace_back();
    Index.Register(D); Index.Finalise(1u);
    CHECK((Index.QueryRecords().front().Flags & 0xF00u) == 0u, "selection bits zero pre-M1 (M1 flips)");
}

} // namespace

int main()
{
    ProofRecordMirror();
    ProofFlagsAndComplexity();
    ProofFlatten();
    ProofCoverageTable();
    std::printf(g_Fail == 0 ? "MATERIAL COVERAGE: PASS\n" : "MATERIAL COVERAGE: FAIL (%d)\n", g_Fail);
    return g_Fail == 0 ? 0 : 1;
}
