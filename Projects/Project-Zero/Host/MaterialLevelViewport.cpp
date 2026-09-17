//============================================================================================================================================
// 📦 Projects/Project-Zero/Host/MaterialLevelViewport.cpp — the material library level, rendered by the Project-Zero CPU stack
//============================================================================================================================================
// 🖼️ What the Vulkan build draws when it opens `--scene materials`, drawn on the CPU instead: the SAME level (built by
//    Engine/ContentInterchange/MaterialSwatchStructure — the same Construct the app exports to Materials.gltf; the
//    export → decode round trip between authoring and the GPU import is the M10 gate's A/E checks, 65/65 zero drift),
//    the SAME material records (MaterialIndex's MaterialRecord / MaterialSlabRecord at the same Tier A slab limit,
//    resolved to a ShadingRecord by the transcription of ReSTIRViewport.slang's `ResolveMaterial` below), the SAME BSDF (Engine/Shaders/MaterialEvaluation.slang compiled 1:1 as C++, FRONTIER_CPU_PORT), the SAME
//    sky (Project-Zero's own SkySpecification/FogSpecification core, at the product's 17.93 h sunset staging), the SAME
//    camera (GameExecution's materials branch: (0, −5, 2.6), pitch −13°, FoV 55°), and the SAME tone map
//    (Engine/DisplayPresentation/ColourTransfer.h — the engine's single definition of linear → display).
//
//    What it is NOT is the ReSTIR kernel: no reservoirs, no reuse, no à-trous. Those are variance machinery, and a CPU
//    render can afford the samples the GPU cannot, so the picture here is the converged answer the GPU's ReSTIR+denoiser
//    is trying to estimate. Physics for physics the two agree — the same shader text turns the same lights into the same
//    radiance — so this is the honest stand-in for "what the level looks like", with the GPU's own frame being noisier
//    (or smoother, with the denoiser on), never different.
//
//    Deviations, all of them display-side and all deliberate (no GPU, no window, no Vulkan here):
//      · no lens flare, no panel post (the sky core's SkyPostApply vignette/flare chain) — those are the viewer's
//        post-process, not the level's radiance;
//      · no fog march / aerial perspective (the studio is 3–15 m deep and the level's own fog scenario is Clear);
//      · textures are not bound — the level is constants-only by design (the M10 gate prints the four texture-shaped
//        channels as acknowledged gaps), so every SampleChannel call resolves to its documented constant;
//      · one medium at a time while walking glass (M4b's v1 rule: no nested dielectrics), which the level never hits.
//
//    KEPT ON PURPOSE — the pure path tracer. Without `--restir` this file is a plain brute-force estimator: NEE with
//    power-heuristic MIS, BSDF sampling, the 8.0 firefly clamp, no reservoirs, no reuse, no history. It is not dead
//    code and is not to be removed when the ReSTIR path grows: it is the reference oracle. Every ReSTIR/denoiser number
//    in this repository is measured against it (the driver's ① panel is 192 spp of exactly this path, and the RMSE
//    table against it is the sheet's claim), and it stays available for whatever cross-check the GPU side needs later —
//    a converged image to A/B against the Vulkan frame, a per-material truth render, or a variance baseline for a new
//    reuse rule. It is also the bit-stability floor: 480×270 at 80 spp reproduces MaterialLibrary_Wide.png to a single
//    pixel (AE = 1, the standing PNG-metadata difference), which is how a change to the shared code is shown not to
//    have touched the physics.
//
//    Build/run: Projects/Project-Zero/Host/Makefile target `MaterialLevelViewport`, or
//    `Exhibits/Workbench/Materials/RunMaterialLevelViewport.sh` (which seats the third-party headers, renders the kept
//    sheets and prints their sha256).
//
//    Usage: MaterialLevelViewport [--out <file.png>] [--width 960] [--height 540] [--spp 64]
//                                 [--bounce 6] [--sun 17.93] [--fog clear|morning|backlit] [--view default|wide|glass|row5]
//                                 [--exposure 1.05] [--threads 2]

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"
#include "AtrousDenoiseMirror.h"

#include <algorithm>
#include <cmath>
#include <clocale>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

const Frontier::ShadingTableSet* g_Tables = nullptr;

} // namespace

inline vec3 FetchEnergy(float mu, float alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleEnergy(*g_Tables, mu, alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec3 FetchSheen(float mu, float alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheen(*g_Tables, mu, alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec4 FetchSheenFull(float mu, float alpha)
{
    float Out[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheenFull(*g_Tables, mu, alpha, Out);
    return vec4(Out[0], Out[1], Out[2], Out[3]);
}

#include "MaterialEvaluation.slang"   // the shipped OpenPBR lobe set, compiled 1:1 as C++ (see the file's own header)
#include "PngWriteCounterpart.h"

#include "CameraProjection.h"
#include "ColourTransfer.h"
#include "MaterialIndex.h"
#include "MaterialSwatchStructure.h"
#include "SkyFogIntegrator.h"

namespace {

using Frontier::ColourPipeline;
using Frontier::ColourTransfer;
using Frontier::MaterialFlagAlphaMask;
using Frontier::MaterialRecord;
using Frontier::MaterialSlabRecord;
using Frontier::MaterialSwatchStructure;
using Frontier::MaterialFlagThinWalled;
using Frontier::MaterialIndex;

//------------------------------------------------------------------------------------------------------------------------
//                                                    RENDER SCENE
//------------------------------------------------------------------------------------------------------------------------
// One flat triangle list, one BVH, one material table — the same three things the GPU build hands the kernel, just in
//    CPU memory. Positions come world-space from the level's facet soup and the normals are the three authored corner
//    normals per triangle, which is what the kernel interpolates at a hit from its vertex/index path.

struct RenderTriangle
{
    vec3 P0, P1, P2;      // [m]  world-space corners
    vec3 N0, N1, N2;      // [-]  vertex normals (smooth; the level's CornerNormals)
    float U0, V0, U1, V1, U2, V2;
    int  Material;        // [idx] material record slot
    int  Light;           // [idx] emissive-triangle list entry, -1 when the triangle does not emit
};

struct BvhNode
{
    vec3 Min, Max;
    int  Left = -1, Right = -1, Start = 0, Count = 0;
};

// [nit] the emissive triangles' total power, for the discrete selection pdf (see PickLight).
float TotalLightPower();

struct EmissiveTriangle
{
    vec3 P0, P1, P2;
    vec3 Ng;
    vec3 Radiance;        // [nit] emission_luminance × emission_color — the luminaire table's radiance
    float Area;           // [m²]
    float Power;          // [-] area × luminance, the discrete selection weight
};

std::vector<RenderTriangle>    g_Tris;
std::vector<BvhNode>           g_Nodes;
std::vector<int>               g_Order;
std::vector<EmissiveTriangle>  g_Lights;
std::vector<ShadingRecord>     g_Mat;
std::vector<uint32_t>          g_MatFlags;
std::vector<float>             g_MatCutoff;
std::vector<bool>              g_MatCutAway;   // [-] the material's constant opacity fails its cutoff: never hit

Frontier::ProjectZero::SkyFogIntegrator g_Sky;
vec3  g_SunDirRender(0.0f, 0.0f, 1.0f);   // [-] unit vector toward the sun, render frame (Y-up)
float g_SunAngularRadius = 0.00465f;      // [rad] the sky core's disc radius (0.53° diameter)
bool  g_SunNee = true;
int   g_RowFilter = -1;    // [-] -1 = the whole grid; 0..5 = one sphere row (a lookdev crop, printed when used)

//------------------------------------------------------------------------------------------------------------------------
//                                                          RNG
//------------------------------------------------------------------------------------------------------------------------

struct Rng
{
    uint32_t S;
    explicit Rng(uint32_t Seed) noexcept : S(Seed * 747796405u + 2891336453u) {}
    float Next() noexcept
    {
        S = S * 747796405u + 2891336453u;
        uint32_t W = ((S >> ((S >> 28u) + 4u)) ^ S) * 277803737u;
        W = (W >> 22u) ^ W;
        return static_cast<float>(W) * (1.0f / 4294967296.0f);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                     DESCRIPTOR RECORDS → SHADING RECORD
//------------------------------------------------------------------------------------------------------------------------
// A transcription of ReSTIRViewport.slang's `ResolveMaterial` for the constants-only case (no textures bound). Every
//    line below corresponds to a line of that function; the channel fetches all resolve to their documented default
//    (`SampleChannel*` with no slot returns vec4(1.0) / vec4(1.0, 0.5, 1.0, 1.0) for anisotropy), which is why the folds
//    collapse to plain multiplies. Keeping the shape of the kernel's code — rather than writing "the obvious fold" —
//    is what makes this the engine's material model instead of a lookalike.

ShadingRecord TranscribeShadingRecord(const MaterialSlabRecord& S, uint32_t Selection)
{
    ShadingRecord m;
    m.BaseColor          = vec3(S.BaseWeight * S.BaseColorR, S.BaseWeight * S.BaseColorG, S.BaseWeight * S.BaseColorB);
    m.Metalness          = S.BaseMetalness;
    m.DiffuseRoughness   = S.BaseDiffuseRoughness;
    m.SpecularWeight     = S.SpecularWeight;
    m.SpecularColor      = vec3(S.SpecularColorR, S.SpecularColorG, S.SpecularColorB);
    m.SpecularRoughness  = S.SpecularRoughness;
    m.SpecularAnisotropy = S.SpecularRoughnessAnisotropy;                 // × anisoTex.z (=1 unbound)
    m.AnisotropyAngle    = S.AnisotropyRotation;                          // atan(1,0)=0 + Slate2.x
    m.SpecularIor        = S.SpecularIor;
    m.ThinFilmWeight     = S.ThinFilmWeight;
    m.ThinFilmThickness  = S.ThinFilmThickness;
    m.ThinFilmIor        = S.ThinFilmIor;
    m.HazinessWeight     = S.SlateHazinessWeight;
    m.HazinessRoughness  = S.SlateHazinessRoughness;
    m.CoatWeight         = S.CoatWeight;
    m.CoatColor          = vec3(S.CoatColorR, S.CoatColorG, S.CoatColorB);
    m.CoatRoughness      = S.CoatRoughness;
    m.CoatAnisotropy     = S.CoatRoughnessAnisotropy;
    m.CoatIor            = S.CoatIor;
    m.CoatDarkening      = S.CoatDarkening;
    m.CoatTangent        = vec3(1.0f, 0.0f, 0.0f);                        // identity (no coat normal texture bound)
    m.CoatNormal         = vec3(0.0f, 0.0f, 1.0f);
    m.FuzzWeight         = S.FuzzWeight;
    m.FuzzColor          = vec3(S.FuzzColorR, S.FuzzColorG, S.FuzzColorB);
    m.FuzzRoughness      = S.FuzzRoughness;
    m.Emission           = vec3(S.EmissionLuminance * S.EmissionColorR, S.EmissionLuminance * S.EmissionColorG,
                                S.EmissionLuminance * S.EmissionColorB);
    m.TransmissionWeight = S.TransmissionWeight;
    m.TransmissionColor  = vec3(S.TransmissionColorR, S.TransmissionColorG, S.TransmissionColorB);
    m.TransmissionDepth  = S.TransmissionDepth;
    m.TransmissionThickness = 0.0f;                                       // tracer-side: the true chord, or the no-exit fallback
    m.Selection          = Selection;
    m.SssWeight          = S.SubsurfaceWeight;
    m.SssColor           = vec3(S.SubsurfaceColorR, S.SubsurfaceColorG, S.SubsurfaceColorB);
    m.SssRadius          = S.SubsurfaceRadius;
    m.SssRadiusScale     = vec3(S.SubsurfaceRadiusScaleR, S.SubsurfaceRadiusScaleG, S.SubsurfaceRadiusScaleB);
    m.SssThickness       = 0.0f;                                          // filled per hit by SssChord
    return m;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CAMERA
//------------------------------------------------------------------------------------------------------------------------
// GameExecution's Z-up fly-through camera, posed by the level's own branch. `ConstructRay` takes normalized viewport
//    coordinates in [-1, 1] with +Y up.

struct Viewpoint
{
    Frontier::Vector3 Position;
    float             PitchDegrees;
    float             YawDegrees;
    float             FieldOfView;
};

// Yaw is clockwise from north (+Y) with +Z up, so yaw 90° looks along +X — the direction a row runs in. The two row
//    views therefore stand just west of the grid, level with their row, and look down it: the seven spheres recede
//    left to right in ordinal order, which is how a lookdev sheet is read.
Viewpoint ViewpointFor(const std::string& Name)
{
    if (Name == "wide")  return { Frontier::Vector3{  0.0f, -7.20f, 3.05f }, -12.0f,  0.0f, 58.0f };   // the whole set
    if (Name == "glass") return { Frontier::Vector3{ -4.60f, 1.50f, 2.00f }, -16.0f, 60.0f, 50.0f };   // row 3, 3/4 down the row
    if (Name == "row5")  return { Frontier::Vector3{ -4.60f, 3.70f, 2.00f }, -16.0f, 60.0f, 50.0f };   // row 5, 3/4 down the row
    // Default: the product's own entry framing for `--scene materials` (GameExecution.cpp, the "Materials" branch).
    return { Frontier::Vector3{ 0.0f, -5.00f, 2.60f }, -13.0f, 0.0f, 55.0f };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        BVH
//------------------------------------------------------------------------------------------------------------------------

void BuildBvh(int Node, int Start, int Count)
{
    BvhNode& N = g_Nodes[Node];
    N.Min = vec3(1e30f); N.Max = vec3(-1e30f);
    vec3 CMin(1e30f), CMax(-1e30f);
    for (int I = 0; I < Count; ++I)
    {
        const RenderTriangle& T = g_Tris[g_Order[Start + I]];
        N.Min = min(N.Min, min(T.P0, min(T.P1, T.P2)));
        N.Max = max(N.Max, max(T.P0, max(T.P1, T.P2)));
        vec3 C = (T.P0 + T.P1 + T.P2) / 3.0f;
        CMin = min(CMin, C); CMax = max(CMax, C);
    }
    if (Count <= 4)
    {
        N.Start = Start; N.Count = Count;
        return;
    }
    vec3 Ext = CMax - CMin;
    int Axis = Ext.x > Ext.y ? (Ext.x > Ext.z ? 0 : 2) : (Ext.y > Ext.z ? 1 : 2);
    int Mid = Start + Count / 2;
    std::nth_element(g_Order.begin() + Start, g_Order.begin() + Mid, g_Order.begin() + Start + Count,
        [Axis](int A, int B)
        {
            vec3 CA = (g_Tris[A].P0 + g_Tris[A].P1 + g_Tris[A].P2) / 3.0f;
            vec3 CB = (g_Tris[B].P0 + g_Tris[B].P1 + g_Tris[B].P2) / 3.0f;
            float VA = Axis == 0 ? CA.x : (Axis == 1 ? CA.y : CA.z);
            float VB = Axis == 0 ? CB.x : (Axis == 1 ? CB.y : CB.z);
            return VA < VB;
        });
    // ⚠️ Never hold a reference into g_Nodes across emplace_back: the vector can reallocate (the exhibit documents the
    //    exact bug this warning came from — a dangling root reference silently dropped half the scene).
    int L = static_cast<int>(g_Nodes.size()); g_Nodes.emplace_back();
    int R = static_cast<int>(g_Nodes.size()); g_Nodes.emplace_back();
    g_Nodes[Node].Left = L; g_Nodes[Node].Right = R;
    BuildBvh(L, Start, Mid - Start);
    BuildBvh(R, Mid, Start + Count - Mid);
}

struct Hit
{
    bool  Valid = false;
    float T = 1e30f;
    float U = 0.0f, V = 0.0f;
    int   TriId = -1;
};

bool IntersectTri(const vec3& O, const vec3& D, const RenderTriangle& T, float TMax, float& THit, float& U, float& V)
{
    vec3 E1 = T.P1 - T.P0, E2 = T.P2 - T.P0;
    vec3 P = cross(D, E2);
    float Det = dot(E1, P);
    if (Det > -1e-12f && Det < 1e-12f) return false;
    float Inv = 1.0f / Det;
    vec3 S = O - T.P0;
    U = dot(S, P) * Inv;
    if (U < 0.0f || U > 1.0f) return false;
    vec3 Q = cross(S, E1);
    V = dot(D, Q) * Inv;
    if (V < 0.0f || U + V > 1.0f) return false;
    THit = dot(E2, Q) * Inv;
    return THit > 1e-4f && THit < TMax;
}

bool IntersectBox(const vec3& O, const vec3& Inv, const vec3& Min, const vec3& Max, float TMax)
{
    vec3 T0 = (Min - O) * Inv, T1 = (Max - O) * Inv;
    vec3 TMin = min(T0, T1), TMax3 = max(T0, T1);
    float Near = TMin.x > TMin.y ? (TMin.x > TMin.z ? TMin.x : TMin.z) : (TMin.y > TMin.z ? TMin.y : TMin.z);
    float Far  = TMax3.x < TMax3.y ? (TMax3.x < TMax3.z ? TMax3.x : TMax3.z) : (TMax3.y < TMax3.z ? TMax3.y : TMax3.z);
    return Near <= Far && Far > 0.0f && Near < TMax;
}

// skipMat ≥ 0 skips every triangle carrying that material (the thin-wall transmission continuation).
Hit Intersect(const vec3& O, const vec3& D, float TMax, int SkipMat)
{
    Hit H;
    vec3 Inv(1.0f / D.x, 1.0f / D.y, 1.0f / D.z);
    int Stack[64]; int Depth = 0;
    Stack[Depth++] = 0;
    while (Depth > 0)
    {
        const BvhNode& N = g_Nodes[Stack[--Depth]];
        if (!IntersectBox(O, Inv, N.Min, N.Max, H.T)) continue;
        if (N.Count > 0)
        {
            for (int I = 0; I < N.Count; ++I)
            {
                const RenderTriangle& T = g_Tris[g_Order[N.Start + I]];
                if (SkipMat >= 0 && T.Material == SkipMat) continue;
                if (g_MatCutAway[T.Material]) continue;   // alpha test (constants-only level: per material, not per texel)
                float TH, UH, VH;
                if (IntersectTri(O, D, T, H.T < TMax ? H.T : TMax, TH, UH, VH))
                {
                    H.Valid = true; H.T = TH; H.U = UH; H.V = VH; H.TriId = g_Order[N.Start + I];
                }
            }
        }
        else
        {
            Stack[Depth++] = N.Left;
            Stack[Depth++] = N.Right;
        }
    }
    if (H.T >= TMax) H.Valid = false;
    return H;
}

bool Occluded(const vec3& A, const vec3& B)
{
    vec3 D = B - A;
    float Len = length(D);
    D = D / Len;
    Hit H = Intersect(A, D, Len - 1e-3f, -1);
    return H.Valid;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SKY, SUN, LUMINAIRES
//------------------------------------------------------------------------------------------------------------------------

// World (Z-up) → render (Y-up) for the sky core, and the radiance the environment sends along a WORLD direction.
vec3 SkyRadianceWorld(const vec3& DirectionWorld)
{
    const vec3 Render = vec3(DirectionWorld.x, DirectionWorld.z, -DirectionWorld.y);
    const Frontier::Vector3 R = g_Sky.ComputeSkyRadiance(Frontier::Vector3{ Render.x, Render.y, Render.z });
    return vec3(R.x, R.y, R.z);
}

// A uniformly chosen emissive triangle, weighted by power (area × luminance) — the same discrete distribution the
//    engine's alias table approximates, exact here because the level has six emissive triangles.
int PickLight(Rng& R, float& OutPdf, float& OutArea, vec3& OutRadiance)
{
    if (g_Lights.empty()) return -1;
    float Total = 0.0f;
    for (const EmissiveTriangle& L : g_Lights) Total += L.Power;
    float Pick = R.Next() * Total;
    int Chosen = static_cast<int>(g_Lights.size()) - 1;
    for (size_t I = 0; I < g_Lights.size(); ++I)
    {
        Pick -= g_Lights[I].Power;
        if (Pick <= 0.0f) { Chosen = static_cast<int>(I); break; }
    }
    OutPdf = g_Lights[Chosen].Power / Total;
    OutArea = g_Lights[Chosen].Area;
    OutRadiance = g_Lights[Chosen].Radiance;
    return Chosen;
}

void ShadingFrame(const vec3& N, vec3& T, vec3& B)
{
    vec3 Helper = fabs(N.z) < 0.9f ? vec3(0.0f, 0.0f, 1.0f) : vec3(1.0f, 0.0f, 0.0f);
    T = normalize(cross(Helper, N));
    B = cross(N, T);
}

//------------------------------------------------------------------------------------------------------------------------
//                              RESTIR DIRECT LIGHTING — CPU MIRROR OF THE KERNEL'S DI BLOCK
//------------------------------------------------------------------------------------------------------------------------
// ReSTIRViewport.slang is not compilable off-GPU (bindless tables, a BVH in buffers, storage images), so this is the
//    same move the M9 proof made for the filter: a line-for-line mirror of the kernel's direct-lighting block, checked
//    against the shader text by the driver (it prints the constants it mirrors). What is mirrored:
//
//      · DrawDirectCandidate — the lamp/sun coin flip (kSunPickProbability 0.5), the sun's disc sample, w = p̂/p with
//        BOTH continuous pdfs (a mesh sample pays area/(p_source·p_pick), a sun sample pays Ω/p_pick);
//      · ResampleCandidate — the streaming RIS resample, weightSum/count accumulation, 1-in-M selection;
//      · the temporal merge — back-projection, the 25° normal and 10 % depth validation, the stride guard, the 20×
//        M-clamp, pairwise MIS on w = p̂·W·M, and the p̂ re-evaluation of the stored sample at THIS pixel (the
//        "revalidation re-evaluates the BSDF" claim: no Jacobian, no per-lobe history, just the same target function);
//      · the spatial merge — K taps on a rotated cross at radius 4…16 px (scaled by width/1280), read from the previous
//        frame's buffer, same validation and the same pairwise algebra;
//      · visibility re-traced at the shading pixel, an occluded reservoir contributing nothing (but still counting for
//        M next frame), and the shade step's own f·L·cos·cosL·W/dist² form;
//      · the running mean + first two luminance moments of ResolveSurface, so the filter downstream reads the variance
//        of the mean the kernel would have handed it.
//
//    Deviations, all deliberate and all because this is a harness and not the dispatch (printed by the driver):
//      · the reprojection is computed from the previous camera pose, not read from the R2 motion image: on the CPU the
//        pose is exact, and the kernel's rule (a back-projection off screen is a disocclusion, not a clamp) is kept;
//      · a pixel that missed geometry clears its reservoir slot; the kernel leaves the stale one for the M/stride
//        guards to reject (same outcome, one fewer way to read uninitialised memory);
//      · no cloud-shadow transmittance (the level's scenario is Clear) and no R2 raster jitter: the primary ray is the
//        pixel's own camera ray with the pixel's own sub-pixel offset.
//
//    Gated by --restir. With it off, Radiance() below is untouched: the sheets' reference and plain-accumulation
//    panels are the same estimator that produced the kept MaterialLibrary_Viewport sheets, bit for bit.

const float    kRestirNormalCos     = 0.906308f;   // cos(25°) — kTemporalNormalCos
const float    kRestirDepthTol      = 0.10f;       // kTemporalDepthTol
const uint32_t kRestirMClamp        = 20u;         // kTemporalMClamp
uint32_t g_RestirSpatialTaps = 4u;  // SpatialTapCount: the shipped default (R6 row 3 cross)
const uint32_t kRestirTapCeiling    = 4u;          // kSpatialTapCeiling
const float    kRestirRadiusMinPx   = 4.0f;        // kSpatialRadiusMinPx
const float    kRestirRadiusMaxPx   = 16.0f;       // kSpatialRadiusMaxPx
const float    kRestirSunPick       = 0.5f;        // kSunPickProbability
const float    kRestirSunDistance   = 1.0e4f;      // kSunShadowDistance
const uint32_t kRestirSunLight      = 0xFFFFFFFFu; // kSunLightIndex

struct CpuReservoir
{
    vec3     SelectedPoint   = vec3(0.0f);
    uint32_t SelectedLight   = 0u;
    float    SelectedUvU     = 0.0f;
    float    SelectedUvV     = 0.0f;
    float    WeightSum       = 0.0f;
    uint32_t SampleCount     = 0u;
    float    UnbiasedWeight  = 0.0f;
    uint32_t Visible         = 0u;
    uint32_t Age             = 0u;
    vec3     Normal          = vec3(0.0f, 0.0f, 1.0f);   // geometric normal of the reservoir's pixel
    float    Depth           = 0.0f;                      // primaryT there
    float    StrideWidth     = 0.0f;                      // the kernel's prev.Normal.w stride guard
    float    MotionU         = 0.0f, MotionV = 0.0f;      // what the R2 image would have carried
};

bool g_RestirNoReproject = false;   // [-] the pre-R7a same-pixel history read (the D9 switch, for the A/B sheet)
bool g_RestirBounceMis = false;   // [-] DIAGNOSTIC: exclude the first-bounce emitter hit (see Radiance)
bool g_RestirNoSunCoin = false;   // [-] DIAGNOSTIC: lamps-only candidates (what the sun coin costs in this scene)
uint32_t g_RestirMCap = 0u;         // [-] 0 = the kernel's own rules (no absolute cap); >0 = a candidate ceiling, to
                                    //     measure what one would buy (the shipped kernel has only the 20x relative clamp)

// The camera pose, captured once per frame: the previous frame's copy is what reprojection projects into.
struct CameraPose
{
    vec3 Origin, Forward, Right, Up;
    float TanHalf = 0.0f, Aspect = 1.0f;
};

CameraPose CapturePose(const Frontier::CameraProjection& Camera)
{
    CameraPose Pose;
    const Frontier::Vector3 O = Camera.QuerySpatialLocation();
    const Frontier::Vector3 F = Camera.QueryForwardVector();
    const Frontier::Vector3 R = Camera.QueryRightVector();
    const Frontier::Vector3 U = Camera.QueryUpwardVector();
    Pose.Origin  = vec3(O.x, O.y, O.z);
    Pose.Forward = normalize(vec3(F.x, F.y, F.z));
    Pose.Right   = normalize(vec3(R.x, R.y, R.z));
    Pose.Up      = normalize(vec3(U.x, U.y, U.z));
    Pose.TanHalf = tanf(Camera.QueryFieldOfViewRadians() * 0.5f);
    Pose.Aspect  = Camera.QueryAspectRatio();
    return Pose;
}

// CameraProjection::ConstructRay's own maths, inverted: the pixel a world point lands on in THIS pose.
bool ProjectPoint(const CameraPose& Pose, const vec3& P, float& OutU, float& OutV)
{
    const vec3 D = P - Pose.Origin;
    const float Z = dot(D, Pose.Forward);
    if (Z <= 1.0e-4f) return false;
    const float ScreenX = dot(D, Pose.Right) / Z;
    const float ScreenY = dot(D, Pose.Up) / Z;
    OutU = 0.5f * (ScreenX / (Pose.TanHalf * Pose.Aspect) + 1.0f);
    OutV = 0.5f * (1.0f - ScreenY / Pose.TanHalf);
    return true;
}

float PHatSurface(const ShadingRecord& m, const ResolvedLayers& L, const vec3& Ng, const vec3& T, const vec3& B,
                  const vec3& Ns, const vec3& wo, const vec3& Emit, const vec3& ToLight, const vec3& LightNormal)
{
    const float Dist2 = dot(ToLight, ToLight);
    const float Dist  = sqrtf(max(Dist2, 1.0e-18f));
    const vec3  Ld    = ToLight / Dist;
    const float CosT  = max(0.0f, dot(Ng, Ld));
    if (CosT <= 0.0f) return 0.0f;
    const float CosL = max(0.0f, dot(LightNormal, -Ld));
    if (CosL <= 0.0f) return 0.0f;
    const vec3 wi(dot(Ld, T), dot(Ld, B), dot(Ld, Ns));
    if (wi.z <= 0.0f) return 0.0f;
    return max(dot(EvaluateBsdf(m, L, wo, wi), Emit), 0.0f) * CosT * CosL / (Dist2 + 0.001f);
}

float PHatSun(const ShadingRecord& m, const ResolvedLayers& L, const vec3& Ng, const vec3& T, const vec3& B,
              const vec3& Ns, const vec3& wo, const vec3& SunEmit, const vec3& SunDir)
{
    const float CosT = max(0.0f, dot(Ng, SunDir));
    if (CosT <= 0.0f) return 0.0f;
    const vec3 wi(dot(SunDir, T), dot(SunDir, B), dot(SunDir, Ns));
    if (wi.z <= 0.0f) return 0.0f;
    return max(dot(EvaluateBsdf(m, L, wo, wi), SunEmit), 0.0f) * CosT;
}

vec3 SunEmissionRender() { return SkyRadianceWorld(g_SunDirRender); }

float SunSolidAngleRender()
{
    const float S = sinf(g_SunAngularRadius * 0.5f);
    return 4.0f * kPi * S * S;
}

// An ABSOLUTE cap on M, applied consistently: the weight sum is scaled with the count, so W (the estimate) is
//    untouched and only this reservoir's future *confidence* shrinks. The shipped kernel has no such cap — only the
//    20x relative clamp — which is exactly what the driver's --m-cap sweep measures (see RunRestirViewport.sh).
void ClampReservoirM(CpuReservoir& Res)
{
    if (g_RestirMCap == 0u || Res.SampleCount <= g_RestirMCap) return;
    Res.WeightSum *= static_cast<float>(g_RestirMCap) / static_cast<float>(Res.SampleCount);
    Res.SampleCount = g_RestirMCap;
}

void ResampleCandidate(CpuReservoir& Res, const vec3& Point, uint32_t Light, float UvU, float UvV, float Weight, Rng& R)
{
    Res.WeightSum   += Weight;
    Res.SampleCount += 1u;
    if (R.Next() * Res.WeightSum <= Weight)
    {
        Res.SelectedPoint = Point;
        Res.SelectedLight = Light;
        Res.SelectedUvU = UvU;
        Res.SelectedUvV = UvV;
    }
}

// DrawDirectCandidate: one candidate, lamp or sun, w = p̂/p with every continuous pdf included.
void DrawDirectCandidate(const ShadingRecord& m, const ResolvedLayers& L, const vec3& Ng, const vec3& T, const vec3& B,
                         const vec3& Ns, const vec3& wo, const vec3& HitPos, bool SunUp, Rng& R,
                         vec3& OutPoint, uint32_t& OutLight, float& OutU, float& OutV, float& OutWeight)
{
    const bool Sun = SunUp && !g_RestirNoSunCoin && (g_Lights.empty() || R.Next() < kRestirSunPick);
    if (Sun)
    {
        const float U1 = R.Next(), U2 = R.Next();
        // Uniform in the sun's cone (pdf 1/Ω) around the sun direction, basis excluding the dominant axis.
        const float CosMax = cosf(g_SunAngularRadius);
        const float CosT   = 1.0f - U1 * (1.0f - CosMax);
        const float SinT   = sqrtf(max(0.0f, 1.0f - CosT * CosT));
        const float Phi    = 2.0f * kPi * U2;
        vec3 St, Sb;
        ShadingFrame(g_SunDirRender, St, Sb);
        const vec3 SunDir = normalize(St * (SinT * cosf(Phi)) + Sb * (SinT * sinf(Phi)) + g_SunDirRender * CosT);
        OutPoint = HitPos + SunDir * kRestirSunDistance;
        OutLight = kRestirSunLight;
        OutU = U1; OutV = U2;
        const float PHat = PHatSun(m, L, Ng, T, B, Ns, wo, SunEmissionRender(), SunDir);
        const float PPick = g_Lights.empty() ? 1.0f : kRestirSunPick;
        OutWeight = PHat * SunSolidAngleRender() / PPick;
        return;
    }
    float Pl = 0.0f, Area = 0.0f;
    vec3 Radiance(0.0f);
    const int Li = PickLight(R, Pl, Area, Radiance);
    if (Li < 0) { OutPoint = vec3(0.0f); OutLight = 0u; OutU = OutV = 0.0f; OutWeight = 0.0f; return; }
    const float U1 = R.Next(), U2 = R.Next();
    float Su = U1, Sv = U2;
    if (Su + Sv > 1.0f) { Su = 1.0f - Su; Sv = 1.0f - Sv; }
    const EmissiveTriangle& Q = g_Lights[Li];
    OutPoint = Q.P0 * (1.0f - Su - Sv) + Q.P1 * Su + Q.P2 * Sv;
    OutLight = static_cast<uint32_t>(Li);
    OutU = Su; OutV = Sv;
    const vec3 ToLight = OutPoint - HitPos;
    const float PHat = PHatSurface(m, L, Ng, T, B, Ns, wo, Q.Radiance, ToLight, Q.Ng);
    const float PPick = (SunUp && !g_RestirNoSunCoin) ? 1.0f - kRestirSunPick : 1.0f;
    OutWeight = PHat * Area / (Pl * PPick);
}

// p̂ of a STORED sample — the one question every merge asks.
float PHatSelected(const ShadingRecord& m, const ResolvedLayers& L, const vec3& Ng, const vec3& T, const vec3& B,
                   const vec3& Ns, const vec3& wo, uint32_t Light, const vec3& ToLight)
{
    if (Light == kRestirSunLight)
    {
        const float Dist = max(sqrtf(dot(ToLight, ToLight)), 1.0e-9f);
        return PHatSun(m, L, Ng, T, B, Ns, wo, SunEmissionRender(), ToLight / Dist);
    }
    if (Light >= g_Lights.size()) return 0.0f;
    const EmissiveTriangle& Q = g_Lights[Light];
    return PHatSurface(m, L, Ng, T, B, Ns, wo, Q.Radiance, ToLight, Q.Ng);
}

struct RestirFrameState
{
    std::vector<CpuReservoir> Current;      // written this frame
    std::vector<CpuReservoir> Previous;     // the stable buffer the merges read
    CameraPose PreviousPose;
    CameraPose LastPose;
    int        FrameIndex  = 0;
    bool       HasPrevious = false;
};

// The kernel's DI block, per pixel. Returns the direct-lighting radiance the reservoir estimates and writes the
//    reservoir this pixel publishes for next frame's reuse. `Accumulated` is the running mean the pixel already holds
//    (the kernel's ResolveSurface recursion), which sets the variance the filter will read.
vec3 RestirDirect(const vec3& O, const vec3& D, Rng& R, int Spp, bool SunUp, RestirFrameState& State, int Width, int Height,
                  int X, int Y, float& OutDepth, vec3& OutNormal)
{
    OutDepth = 0.0f;
    OutNormal = vec3(0.0f, 0.0f, 1.0f);
    CpuReservoir& Slot = State.Current[static_cast<size_t>(Y) * Width + X];
    Slot = CpuReservoir();

    const Hit H = Intersect(O, D, 1.0e30f, -1);
    if (!H.Valid) return vec3(0.0f);                       // sky: the kernel returns before the DI block
    const RenderTriangle& Tri = g_Tris[H.TriId];
    const vec3 P = O + D * H.T;
    OutDepth = H.T;
    if (Tri.Light >= 0) return vec3(0.0f);                 // a directly hit emitter: emission, no BSDF
    const ShadingRecord& Mat = g_Mat[Tri.Material];
    if (Mat.Selection == static_cast<uint>(kReflectanceEmissiveOnly)) return vec3(0.0f);
    if (Mat.Selection == static_cast<uint>(kReflectanceUnlit)) return vec3(0.0f);

    vec3 Ng = normalize(cross(Tri.P1 - Tri.P0, Tri.P2 - Tri.P0));
    if (dot(Ng, D) > 0.0f) Ng = -Ng;
    vec3 Ns = normalize(Tri.N0 * (1.0f - H.U - H.V) + Tri.N1 * H.U + Tri.N2 * H.V);
    if (dot(Ns, D) > 0.0f) Ns = -Ns;
    OutNormal = Ng;
    vec3 T, B;
    ShadingFrame(Ns, T, B);
    const vec3 wo(dot(-D, T), dot(-D, B), dot(-D, Ns));

    ShadingRecord m = Mat;
    ResolvedLayers L = ResolveLayers(m, wo);
    const bool SolidHit = m.TransmissionWeight > 0.0f && (g_MatFlags[Tri.Material] & Frontier::MaterialFlagThinWalled) == 0u;
    if (SolidHit) { L.SolidInterface = true; L.IncidentIor = 1.0f; }

    CpuReservoir Res;
    Res.StrideWidth = static_cast<float>(Width);   // the kernel's prev.Normal.w stride guard, carried on the reservoir
    for (int S = 0; S < Spp; ++S)
    {
        vec3 Point; uint32_t Light; float U1, U2, Weight;
        DrawDirectCandidate(m, L, Ng, T, B, Ns, wo, P, SunUp, R, Point, Light, U1, U2, Weight);
        ResampleCandidate(Res, Point, Light, U1, U2, Weight, R);
    }

    float SelectedPHat = 0.0f;
    if (Res.WeightSum > 0.0f && Res.SampleCount > 0u)
    {
        SelectedPHat = PHatSelected(m, L, Ng, T, B, Ns, wo, Res.SelectedLight, Res.SelectedPoint - P);
        Res.UnbiasedWeight = SelectedPHat > 0.0f ? Res.WeightSum / (static_cast<float>(Res.SampleCount) * SelectedPHat) : 0.0f;

        // Motion: the pixel this surface point lands on in the PREVIOUS pose (the R2 image's content, computed exactly).
        float PrevU = 0.0f, PrevV = 0.0f;
        if (State.HasPrevious && ProjectPoint(State.PreviousPose, P, PrevU, PrevV))
        {
            const float CurU = (static_cast<float>(X) + 0.5f) / static_cast<float>(Width);
            const float CurV = (static_cast<float>(Y) + 0.5f) / static_cast<float>(Height);
            Res.MotionU = CurU - PrevU;
            Res.MotionV = CurV - PrevV;
        }
        Res.Normal = Ng;
        Res.Depth = H.T;

        if (State.HasPrevious)
        {
            // Temporal reuse.
            {
                const float CurU = (static_cast<float>(X) + 0.5f) / static_cast<float>(Width);
                const float CurV = (static_cast<float>(Y) + 0.5f) / static_cast<float>(Height);
                const float PU = g_RestirNoReproject ? CurU : CurU - Res.MotionU;
                const float PV = g_RestirNoReproject ? CurV : CurV - Res.MotionV;
                const int PrevX = static_cast<int>(floorf(PU * static_cast<float>(Width)));
                const int PrevY = static_cast<int>(floorf(PV * static_cast<float>(Height)));
                if (PrevX >= 0 && PrevY >= 0 && PrevX < Width && PrevY < Height)
                {
                    const CpuReservoir& Prev = State.Previous[static_cast<size_t>(PrevY) * Width + PrevX];
                    const uint32_t PrevM = Prev.SampleCount;
                    const bool Valid = PrevM > 0u
                        && Prev.StrideWidth == static_cast<float>(Width)
                        && dot(Ng, Prev.Normal) > kRestirNormalCos
                        && fabsf(H.T - Prev.Depth) / max(H.T, 1.0e-3f) < kRestirDepthTol;
                    if (Valid)
                    {
                        const uint32_t PrevCapped = std::min(PrevM, kRestirMClamp * Res.SampleCount);
                        const float PPrev = PHatSelected(m, L, Ng, T, B, Ns, wo, Prev.SelectedLight, Prev.SelectedPoint - P);
                        const float PCur = SelectedPHat;
                        const float WCur = PCur * Res.UnbiasedWeight * static_cast<float>(Res.SampleCount);
                        const float WPrev = PPrev * Prev.UnbiasedWeight * static_cast<float>(PrevCapped);
                        const float Total = WCur + WPrev;
                        if (Total > 0.0f && R.Next() * Total <= WPrev)
                        {
                            Res.SelectedPoint = Prev.SelectedPoint;
                            Res.SelectedLight = Prev.SelectedLight;
                            Res.SelectedUvU = Prev.SelectedUvU;
                            Res.SelectedUvV = Prev.SelectedUvV;
                            SelectedPHat = PPrev;
                        }
                        Res.SampleCount += PrevCapped;
                        Res.WeightSum = Total;
                        ClampReservoirM(Res);
                        Res.Age = Prev.Age + 1u;
                        // W from the reservoir's own sum, not the local `Total`: ClampReservoirM may have rescaled it,
                        //    and W must stay the estimate the sum encodes. (Without a cap the two are equal to the bit.)
                        Res.UnbiasedWeight = SelectedPHat > 0.0f ? Res.WeightSum / (static_cast<float>(Res.SampleCount) * SelectedPHat) : 0.0f;
                    }
                }
            }

            // Spatial reuse: K taps on a rotated cross, read from the stable previous buffer (a separate RNG stream,
            //    seeded from pixel and frame, exactly like the kernel's tapSeed).
            {
                // Seeded from the pixel AND the frame, like the kernel's tapSeed (MakeSeed(pixel, FrameIndex)): the
                //    cross is re-aimed and re-reached every frame, so no direction is systematically favoured over time.
                Rng TapRng((static_cast<uint32_t>(Y) * 73856093u) ^ (static_cast<uint32_t>(X) * 19349663u)
                           ^ (static_cast<uint32_t>(State.FrameIndex + 1) * 83492791u) ^ 0x9E3779B9u);
                const float Scale = static_cast<float>(Width) / 1280.0f;
                const float Angle = TapRng.Next() * 6.28318531f;
                const float Radius = (kRestirRadiusMinPx + (kRestirRadiusMaxPx - kRestirRadiusMinPx) * TapRng.Next()) * Scale;
                const uint32_t Taps = std::min<uint32_t>(g_RestirSpatialTaps, kRestirTapCeiling);
                for (uint32_t Tap = 0u; Tap < Taps; ++Tap)
                {
                    const float Theta = Angle + static_cast<float>(Tap) * (6.28318531f / static_cast<float>(Taps));
                    const int OffX = static_cast<int>(lroundf(Radius * cosf(Theta)));
                    const int OffY = static_cast<int>(lroundf(Radius * sinf(Theta)));
                    if (OffX == 0 && OffY == 0) continue;
                    const int NX = X + OffX, NY = Y + OffY;
                    if (NX < 0 || NY < 0 || NX >= Width || NY >= Height) continue;
                    const CpuReservoir& Neigh = State.Previous[static_cast<size_t>(NY) * Width + NX];
                    const uint32_t NeighM = Neigh.SampleCount;
                    const bool NValid = NeighM > 0u
                        && Neigh.StrideWidth == static_cast<float>(Width)
                        && dot(Ng, Neigh.Normal) > kRestirNormalCos
                        && fabsf(H.T - Neigh.Depth) / max(H.T, 1.0e-3f) < kRestirDepthTol;
                    if (!NValid) continue;
                    const uint32_t NeighCapped = std::min(NeighM, kRestirMClamp * Res.SampleCount);
                    const float PNeigh = PHatSelected(m, L, Ng, T, B, Ns, wo, Neigh.SelectedLight, Neigh.SelectedPoint - P);
                    const float PSelf = SelectedPHat;
                    const float WSelf = PSelf * Res.UnbiasedWeight * static_cast<float>(Res.SampleCount);
                    const float WNeigh = PNeigh * Neigh.UnbiasedWeight * static_cast<float>(NeighCapped);
                    const float NTotal = WSelf + WNeigh;
                    uint32_t TakeAge = Res.Age;
                    if (NTotal > 0.0f && R.Next() * NTotal <= WNeigh)
                    {
                        Res.SelectedPoint = Neigh.SelectedPoint;
                        Res.SelectedLight = Neigh.SelectedLight;
                        Res.SelectedUvU = Neigh.SelectedUvU;
                        Res.SelectedUvV = Neigh.SelectedUvV;
                        TakeAge = Neigh.Age + 1u;
                        SelectedPHat = PNeigh;
                    }
                    Res.SampleCount += NeighCapped;
                    Res.WeightSum = NTotal;
                    ClampReservoirM(Res);
                    Res.Age = TakeAge;
                    Res.UnbiasedWeight = SelectedPHat > 0.0f ? Res.WeightSum / (static_cast<float>(Res.SampleCount) * SelectedPHat) : 0.0f;
                }
            }
        }

        // Visibility re-traced at the current pixel; an occluded merged sample contributes nothing.
        const bool Blocked = Res.SelectedLight == kRestirSunLight
            ? Occluded(P + Ng * 1.0e-4f, P + normalize(Res.SelectedPoint - P) * 1.0e4f)
            : Occluded(P + Ng * 1.0e-4f, Res.SelectedPoint - normalize(Res.SelectedPoint - P) * 1.0e-3f);
        Res.Visible = Blocked ? 0u : 1u;
        if (Res.Visible == 0u) Res.UnbiasedWeight = 0.0f;
    }

    Slot = Res;

    vec3 Acc(0.0f);
    if (Res.Visible == 1u && Res.SampleCount > 0u)
    {
        const vec3 ShadeDir = normalize(Res.SelectedPoint - P);
        const float ShadeCos = max(0.0f, dot(Ng, ShadeDir));
        const vec3 Wi(dot(ShadeDir, T), dot(ShadeDir, B), dot(ShadeDir, Ns));
        const vec3 F = Wi.z > 0.0f ? EvaluateBsdf(m, L, wo, Wi) : vec3(0.0f);
        if (Res.SelectedLight == kRestirSunLight)
            Acc = F * SunEmissionRender() * ShadeCos * Res.UnbiasedWeight;
        else
        {
            const EmissiveTriangle& Q = g_Lights[Res.SelectedLight];
            const float ShadeCosL = max(0.0f, dot(Q.Ng, -ShadeDir));
            const float Dist2 = dot(Res.SelectedPoint - P, Res.SelectedPoint - P);
            Acc = F * Q.Radiance * ShadeCos * ShadeCosL * Res.UnbiasedWeight / (Dist2 + 0.01f);
        }
    }
    return Acc;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

// NEE on the level's emissive triangles with power-heuristic MIS against the BSDF strategy (the exhibit's DirectMIS,
//    unchanged but for the light list being the level's own luminaires).
vec3 DirectMIS(const ShadingRecord& m, const ResolvedLayers& L, const vec3& P, const vec3& N,
               const vec3& T, const vec3& B, const vec3& wo, Rng& R)
{
    float Pl = 0.0f, Area = 0.0f;
    vec3 Radiance(0.0f);
    const int Li = PickLight(R, Pl, Area, Radiance);
    if (Li < 0) return vec3(0.0f);
    const EmissiveTriangle& Q = g_Lights[Li];
    float Su = R.Next(), Sv = R.Next();
    if (Su + Sv > 1.0f) { Su = 1.0f - Su; Sv = 1.0f - Sv; }
    const vec3 Lp = Q.P0 * (1.0f - Su - Sv) + Q.P1 * Su + Q.P2 * Sv;
    vec3 Dw = Lp - P;
    float D2 = dot(Dw, Dw);
    float Dist = sqrt(D2);
    Dw = Dw / Dist;
    float CosL = dot(-Dw, Q.Ng);
    if (CosL <= 1e-3f) return vec3(0.0f);   // grazing-epsilon: 1/CosL → ∞ along the quad silhouette
    vec3 wi(dot(Dw, T), dot(Dw, B), dot(Dw, N));
    if (wi.z <= 0.0f) return vec3(0.0f);
    if (Occluded(P + N * 1e-4f, Lp - Dw * 1e-3f)) return vec3(0.0f);
    vec3 F = EvaluateBsdf(m, L, wo, wi);
    // area → solid angle: pdf_Ω = pdf_A · d² / cosθ_l
    float PdfOmega = Pl * (D2 / (Area * CosL));
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (PdfOmega * PdfOmega) / (PdfOmega * PdfOmega + Pb * Pb + 1e-12f);
    return F * (wi.z * W / max(PdfOmega, 1e-12f)) * Radiance;
}

// The SSS below-horizon stratum (M5 v2): the light-sampled twin of the BSDF's dipole branch. No occlusion test — the
//    chord transport replaces visibility, so light behind the surface shines through, attenuated.
vec3 DirectMISsss(const ShadingRecord& m, const ResolvedLayers& L, const vec3& P, const vec3& N,
                  const vec3& T, const vec3& B, const vec3& wo, Rng& R)
{
    if (g_Lights.empty() || L.SssMix <= 0.0f) return vec3(0.0f);
    float Pl = 0.0f, Area = 0.0f;
    vec3 Radiance(0.0f);
    const int Li = PickLight(R, Pl, Area, Radiance);
    if (Li < 0) return vec3(0.0f);
    const EmissiveTriangle& Q = g_Lights[Li];
    float Su = R.Next(), Sv = R.Next();
    if (Su + Sv > 1.0f) { Su = 1.0f - Su; Sv = 1.0f - Sv; }
    const vec3 Lp = Q.P0 * (1.0f - Su - Sv) + Q.P1 * Su + Q.P2 * Sv;
    vec3 Dw = Lp - P;
    float D2 = dot(Dw, Dw);
    Dw = Dw / sqrt(D2);
    float CosL = dot(-Dw, Q.Ng);
    if (CosL <= 1e-3f) return vec3(0.0f);
    vec3 wi(dot(Dw, T), dot(Dw, B), dot(Dw, N));
    if (wi.z >= 0.0f) return vec3(0.0f);   // the above-stratum owns wi.z ≥ 0 (partition)
    vec3 F = EvaluateBsdf(m, L, wo, wi);
    float PdfOmega = Pl * (D2 / (Area * CosL));
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (PdfOmega * PdfOmega) / (PdfOmega * PdfOmega + Pb * Pb + 1e-12f);
    return F * ((-wi.z) * W / max(PdfOmega, 1e-12f)) * Radiance;
}

// The sun's disc as a light: a cone of half-angle g_SunAngularRadius around the sun direction, radiance read from the
//    sky core itself (disc + aureole + the veil in front of it), MIS-weighted against the BSDF strategy.
vec3 SunNee(const ShadingRecord& m, const ResolvedLayers& L, const vec3& P, const vec3& N,
            const vec3& T, const vec3& B, const vec3& wo, Rng& R)
{
    if (!g_SunNee) return vec3(0.0f);
    const float CosMax = cosf(g_SunAngularRadius);
    const float PdfSolid = 1.0f / (2.0f * kPi * (1.0f - CosMax));
    vec3 St, Sb;
    ShadingFrame(g_SunDirRender, St, Sb);
    const float CosTheta = 1.0f - R.Next() * (1.0f - CosMax);
    const float SinTheta = sqrtf(max(0.0f, 1.0f - CosTheta * CosTheta));
    const float Phi = 2.0f * kPi * R.Next();
    const vec3 DirWorld = normalize(St * (SinTheta * cosf(Phi)) + Sb * (SinTheta * sinf(Phi)) + g_SunDirRender * CosTheta);
    const float wiZ = dot(DirWorld, N);
    if (wiZ <= 0.0f) return vec3(0.0f);
    if (Occluded(P + N * 1e-4f, P + DirWorld * 1.0e4f)) return vec3(0.0f);
    const vec3 wi(dot(DirWorld, T), dot(DirWorld, B), wiZ);
    const vec3 F = EvaluateBsdf(m, L, wo, wi);
    const vec3 Sky = SkyRadianceWorld(DirWorld);            // the disc lives in the sky core, not beside it
    const float Pb = PdfBsdf(m, L, wo, wi);
    const float W = (PdfSolid * PdfSolid) / (PdfSolid * PdfSolid + Pb * Pb + 1e-12f);
    return F * (wi.z * W / PdfSolid) * Sky;
}

// The M5 geometric chord: an inward raycast from just below the surface, the exit the double-sided BVH finds. Miss ⇒
//    +∞ ⇒ Beer 0 (the ray crossed the whole volume).
float SssChord(const vec3& P, const vec3& N)
{
    Hit H = Intersect(P - N * 3e-4f, -N, 1e30f, -1);
    return H.Valid ? H.T : 1e30f;
}

vec3 Radiance(vec3 O, vec3 D, Rng& R, int Bounces, bool SkipPrimaryDirect = false)
{
    vec3 L(0.0f), Beta(1.0f);
    int Skip = -1;
    float LastPdf = 0.0f;
    bool Inside = false;       // M4b: the ray is inside solid glass (single medium — nesting is v1-out)
    int EntryMat = -1;
    vec3 EntrySigma(0.0f);
    bool NeeSkipped = false;
    for (int Depth = 0; Depth < Bounces + 4; ++Depth)
    {
        const bool ReservoirOwnsDirect = SkipPrimaryDirect && Depth == 0;
        Hit H = Intersect(O, D, 1e30f, Skip);
        Skip = -1;
        const bool PrevNeeSkipped = NeeSkipped;
        NeeSkipped = false;
        if (!H.Valid)
        {
            if (Inside)   // open mesh / numeric leak: the nominal-Beer fallback, then out
            {
                Beta = Beta * exp(-EntrySigma * g_Mat[EntryMat].TransmissionThickness);
                Inside = false;
            }
            // Sky from a BSDF-sampled direction. Inside the sun cone the light strategy could have generated this
            //    direction, so the disc's share is MIS-weighted (the whole sky when the cone covers the ray — the disc
            //    is orders of magnitude brighter than the rest of the sky, so this is the term that matters).
            vec3 E = SkyRadianceWorld(D);
            if (g_SunNee && dot(D, g_SunDirRender) > cosf(g_SunAngularRadius))
            {
                const float PdfSolid = 1.0f / (2.0f * kPi * (1.0f - cosf(g_SunAngularRadius)));
                const float W = (LastPdf * LastPdf) / (LastPdf * LastPdf + PdfSolid * PdfSolid + 1e-12f);
                E = E * W;
            }
            L += Beta * E;
            break;
        }
        const RenderTriangle& T = g_Tris[H.TriId];
        vec3 P = O + D * H.T;
        if (Inside) Beta = Beta * exp(-EntrySigma * H.T);   // Beer over the interior segment just travelled
        const ShadingRecord& Mat = g_Mat[T.Material];

        if (T.Light >= 0)
        {
            // DIAGNOSTIC (--restir-bounce-mis): with the reservoir owning the primary pixel's direct integral, a
            //    first-bounce emitter hit is that same integral seen through the BSDF strategy a second time. The
            //    kernel adds it unweighted; this switch measures what excluding it does.
            if (g_RestirBounceMis && SkipPrimaryDirect && Depth == 1) break;
            const vec3 Ng = normalize(cross(T.P1 - T.P0, T.P2 - T.P0));
            if (dot(D, Ng) < 0.0f)
            {
                float W = 1.0f;
                if (Depth > 0 && !PrevNeeSkipped)
                {
                    const EmissiveTriangle& Q = g_Lights[T.Light];
                    const float CosL = dot(-D, Q.Ng);
                    const float PdfOmega = (Q.Power / TotalLightPower()) * (H.T * H.T / (Q.Area * max(CosL, 1e-6f)));
                    const float Pb = LastPdf;
                    W = (Pb * Pb) / (PdfOmega * PdfOmega + Pb * Pb + 1e-12f);
                }
                L += Beta * Mat.Emission * W;
            }
            break;
        }

        vec3 Ng = normalize(cross(T.P1 - T.P0, T.P2 - T.P0));
        if (dot(Ng, D) > 0.0f) Ng = -Ng;
        vec3 Ns = normalize(T.N0 * (1.0f - H.U - H.V) + T.N1 * H.U + T.N2 * H.V);
        if (dot(Ns, D) > 0.0f) Ns = -Ns;
        vec3 Tt, Bt;
        ShadingFrame(Ns, Tt, Bt);
        vec3 wo(dot(-D, Tt), dot(-D, Bt), dot(-D, Ns));

        ShadingRecord m = Mat;                                  // local copy: the nested fallback may zero transmission
        const bool SolidHit = m.TransmissionWeight > 0.0f && (g_MatFlags[T.Material] & Frontier::MaterialFlagThinWalled) == 0u;
        const bool FromInside = Inside && T.Material == EntryMat;
        if (Inside && T.Material != EntryMat && m.TransmissionWeight > 0.0f)
        {
            m.TransmissionWeight = 0.0f;   // v1: no nested dielectrics — shade R-only, stay inside
        }
        if (!FromInside && m.SssWeight > 0.0f) m.SssThickness = SssChord(P, Ns);

        // Emissive-only and unlit short-circuits, exactly as the kernel orders them (radiance in, no BSDF).
        if (m.Selection == static_cast<uint>(kReflectanceEmissiveOnly))
        {
            L += Beta * m.Emission;
            break;
        }
        if (m.Selection == static_cast<uint>(kReflectanceUnlit))
        {
            L += Beta * m.BaseColor;
            break;
        }

        ResolvedLayers Lr = ResolveLayers(m, wo);
        if (SolidHit)
        {
            Lr.SolidInterface = true;
            Lr.IncidentIor = FromInside ? Lr.SpecularEta : 1.0f;
        }
        if (!FromInside)
        {
            if (ReservoirOwnsDirect)
                L += Beta * DirectMISsss(m, Lr, P, Ns, Tt, Bt, wo, R);   // the below-stratum stays outside the reservoir
            else
                L += Beta * (DirectMIS(m, Lr, P, Ns, Tt, Bt, wo, R) + DirectMISsss(m, Lr, P, Ns, Tt, Bt, wo, R)
                             + SunNee(m, Lr, P, Ns, Tt, Bt, wo, R));     // untouched: the reference/plain panels' estimator
        }
        else
            NeeSkipped = true;   // interior: an occlusion test would hit the exit wall — skip the light strata

        vec4 S = SampleBsdf(m, Lr, wo, vec4(R.Next(), R.Next(), R.Next(), R.Next()));
        if (S.w <= 0.0f) break;
        const vec3 wi = S.xyz;
        const vec3 F = EvaluateBsdf(m, Lr, wo, wi);
        const float CosS = wi.z < 0.0f ? -wi.z : wi.z;
        Beta *= F * (CosS / max(S.w, 1e-12f));
        Beta = min(Beta, vec3(8.0f, 8.0f, 8.0f));   // firefly clamp (softboxes through smooth glass)
        LastPdf = S.w;
        vec3 Dw = Tt * wi.x + Bt * wi.y + Ns * wi.z;
        if (wi.z < 0.0f && Lr.TransmitMix <= 0.0f && Lr.SssMix > 0.0f)
        {
            // M5 v2 dipole-virtual: a BSDF-sampled backlight direction, not a transport vertex. Skip non-emitters
            //    (bound 4, like the M4 shadow walk), then the environment; the light-sampled twin is DirectMISsss.
            vec3 Vo = P + Dw * 3e-4f;
            vec3 Vl(0.0f);
            bool Vhit = false;
            for (int Vs = 0; Vs < 4 && !Vhit; ++Vs)
            {
                Hit Vh = Intersect(Vo, Dw, 1e30f, -1);
                if (!Vh.Valid) break;
                const RenderTriangle& Vt = g_Tris[Vh.TriId];
                if (Vt.Light >= 0 && dot(Dw, normalize(cross(Vt.P1 - Vt.P0, Vt.P2 - Vt.P0))) < 0.0f)
                { Vl = g_Mat[Vt.Material].Emission; Vhit = true; }
                else Vo = Vo + Dw * (Vh.T + 3e-4f);
            }
            if (!Vhit) Vl = SkyRadianceWorld(Dw);
            L += Beta * Vl;
            break;
        }
        if (wi.z < 0.0f)
        {
            if (SolidHit)
            {
                if (!FromInside) { Inside = true; EntryMat = T.Material; EntrySigma = Lr.TransmissionSigma; }
                else { Inside = false; EntryMat = -1; }
            }
            else
                Skip = T.Material;   // thin-wall exit: continue past this wall's own interior
        }
        O = SolidHit ? P + Dw * 3e-4f : P + Ng * 1e-4f + Dw * 1e-4f;
        D = normalize(Dw);
    }
    return L;
}

float TotalLightPower()
{
    float Total = 0.0f;
    for (const EmissiveTriangle& L : g_Lights) Total += L.Power;
    return Total;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  LEVEL BUILD
//------------------------------------------------------------------------------------------------------------------------

// The level, straight from its authoring source: MaterialSwatchStructure::Construct builds the same 42 spheres, floor,
//    backdrop, signs and luminaires the exporter writes to Content/Scenes/Materials.gltf, and MaterialIndex turns the
//    same descriptors into the same MaterialRecord / MaterialSlabRecord rows the GPU build uploads (the export → decode
//    round trip that stands between the two is the M10 gate's A/E checks: 65/65, zero drift). Geometry arrives
//    world-space with three authored smooth normals per triangle, exactly what the kernel interpolates per hit.
bool BuildLevel()
{
    MaterialSwatchStructure Library;
    Library.Construct();

    const std::vector<Frontier::TriangleIndex>& Tris = Library.QueryTriangles();
    const std::vector<Frontier::Vector3>& Corners = Library.QueryCornerNormals();
    if (Tris.empty() || Corners.size() != Tris.size() * 3u)
    {
        std::printf("[material-level] the level's triangle soup is malformed (%zu tris, %zu corner normals)\n",
                    Tris.size(), Corners.size());
        return false;
    }

    MaterialIndex Index;
    for (const Frontier::MaterialDescriptor& D : Library.QueryMaterials()) Index.Register(D);
    Index.Finalise(1u, nullptr);   // Tier A: the flattened resident level the GPU build seats

    const std::vector<MaterialRecord>& Records = Index.QueryRecords();
    const std::vector<MaterialSlabRecord>& Slabs = Index.QuerySlabRecords();
    g_Mat.resize(Records.size());
    g_MatFlags.resize(Records.size(), 0u);
    g_MatCutoff.resize(Records.size(), 0.5f);
    for (size_t I = 0; I < Records.size(); ++I)
    {
        const uint32_t Selection = (Records[I].Flags & Frontier::kMaterialReflectanceMask) >> Frontier::kMaterialReflectanceShift;
        const MaterialSlabRecord& S = Slabs[std::min(static_cast<size_t>(Records[I].SlabOffset), Slabs.size() - 1u)];
        g_Mat[I] = TranscribeShadingRecord(S, Selection);
        g_MatFlags[I] = Records[I].Flags;
        g_MatCutoff[I] = Records[I].AlphaCutoff;
    }
    // Alpha test, resolved once per material. The level is constants-only, so the kernel's per-hit `F.Opacity <
    //    AlphaCutoff` discard is a property of the material here — a material that discards every texel is a material
    //    no ray can hit. (With the panel's authored opacity 0.62 against a 0.5 cutoff the panel survives, exactly as it
    //    does in the kernel; a level authored below its cutoff renders as the hole it is.)
    g_MatCutAway.assign(Records.size(), false);
    for (size_t I = 0; I < Records.size(); ++I)
    {
        const MaterialSlabRecord& S = Slabs[std::min(static_cast<size_t>(Records[I].SlabOffset), Slabs.size() - 1u)];
        g_MatCutAway[I] = (Records[I].Flags & MaterialFlagAlphaMask) != 0u && S.GeometryOpacity < Records[I].AlphaCutoff;
    }

    g_Tris.reserve(Tris.size());
    for (size_t I = 0; I < Tris.size(); ++I)
    {
        const Frontier::TriangleIndex& T = Tris[I];
        RenderTriangle R;
        R.P0 = vec3(T.VertexAlphaX, T.VertexAlphaY, T.VertexAlphaZ);
        R.P1 = vec3(T.VertexBetaX,  T.VertexBetaY,  T.VertexBetaZ);
        R.P2 = vec3(T.VertexGammaX, T.VertexGammaY, T.VertexGammaZ);
        R.N0 = vec3(Corners[I * 3u + 0u].x, Corners[I * 3u + 0u].y, Corners[I * 3u + 0u].z);
        R.N1 = vec3(Corners[I * 3u + 1u].x, Corners[I * 3u + 1u].y, Corners[I * 3u + 1u].z);
        R.N2 = vec3(Corners[I * 3u + 2u].x, Corners[I * 3u + 2u].y, Corners[I * 3u + 2u].z);
        R.U0 = T.TextureAlphaU; R.V0 = T.TextureAlphaV;
        R.U1 = T.TextureBetaU;  R.V1 = T.TextureBetaV;
        R.U2 = T.TextureGammaU; R.V2 = T.TextureGammaV;
        // ⚠️ MaterialSlot is a uint32 whose BITS live in a float (MaterialSwatchStructure::AppendTriangle memcpys it in,
        //    the GPU reads it back the same way). Casting the float's VALUE would read a denormal and land every
        //    triangle on material 0 — bit-cast, exactly as the facet's own comment says.
        uint32_t Slot = 0u;
        std::memcpy(&Slot, &T.MaterialSlot, sizeof(Slot));
        R.Material = static_cast<int>(Slot);
        R.Light = -1;
        if (R.Material < 0 || R.Material >= static_cast<int>(g_Mat.size())) return false;
        if (g_RowFilter >= 0)
        {
            // A lookdev crop: keep one sphere row and the studio around it, drop the other five. The material slots are
            //    laid out as floor, backdrop, swatch 0…41, panels, luminaires (MaterialSwatchStructure's constants), so
            //    "row N" is a range of slots — no geometry needs rebuilding, and the surviving pixels are the level's.
            const int First = static_cast<int>(MaterialSwatchStructure::kFirstSwatchMaterial);
            const uint32_t Row = static_cast<uint32_t>(g_RowFilter);
            const bool IsSwatch = R.Material >= First && R.Material < First + static_cast<int>(MaterialSwatchStructure::kSwatchCount);
            if (IsSwatch)
            {
                const uint32_t Ordinal = static_cast<uint32_t>(R.Material - First);
                if (Ordinal / MaterialSwatchStructure::kSwatchColumns != Row) continue;
            }
        }
        g_Tris.push_back(R);
    }

    // Luminaires: every emissive triangle (the level's key, fill and emissive panel — the same set Finalise gathers).
    for (size_t I = 0; I < g_Tris.size(); ++I)
    {
        RenderTriangle& T = g_Tris[I];
        if (g_MatCutAway[T.Material]) continue;
        const vec3 E = g_Mat[T.Material].Emission;
        const float Lum = 0.2126f * E.x + 0.7152f * E.y + 0.0722f * E.z;
        if (Lum <= 0.0f) continue;
        EmissiveTriangle L;
        L.P0 = T.P0; L.P1 = T.P1; L.P2 = T.P2;
        L.Ng = normalize(cross(T.P1 - T.P0, T.P2 - T.P0));
        L.Radiance = E;
        L.Area = 0.5f * length(cross(T.P1 - T.P0, T.P2 - T.P0));
        L.Power = L.Area * Lum;
        T.Light = static_cast<int>(g_Lights.size());
        g_Lights.push_back(L);
    }

    g_Order.resize(g_Tris.size());
    for (size_t I = 0; I < g_Tris.size(); ++I) g_Order[I] = static_cast<int>(I);
    g_Nodes.clear();
    g_Nodes.emplace_back();
    BuildBvh(0, 0, static_cast<int>(g_Order.size()));
    if (g_RowFilter >= 0)
        std::printf("[material-level] row crop: only swatch row %d is in the scene (the studio stays; other rows dropped)\n",
                    g_RowFilter);
    std::printf("[material-level] level: %zu triangles, %zu material records (%zu slabs), %zu emissive triangles\n",
                g_Tris.size(), Records.size(), Slabs.size(), g_Lights.size());
    return true;
}


//------------------------------------------------------------------------------------------------------------------------
//                                    SEQUENCE RENDER — frames, the running mean, and the filter
//------------------------------------------------------------------------------------------------------------------------
// The app renders one frame per dispatch and accumulates in ResolveSurface; a sheet needs the same thing off-GPU, so
//    this is that loop: N frames, a camera that may drift (to put the reprojection to work), the kernel's own
//    accumulator per pixel, and — when asked — the shipped à-trous chain over the result, level by level, exactly as
//    SwapchainExchange dispatches it.

struct SequenceResult
{
    std::vector<float> Mean;        // [W*H*3] the running mean, linear radiance (what ResolveSurface publishes)
    std::vector<float> Surface;     // [W*H*4] normal xyz + depth in w (0 = sky): the filter's geometry buffer
    std::vector<float> Variance;    // [W*H]   the variance of the mean the kernel's recursion reports
    long               NonFinite = 0;
    double             ReservoirCoverage = 0.0;   // [%] pixels whose reservoir survived the frame
    double             MeanReservoirM = 0.0;      // [-] mean M over the surface pixels (reuse is visible here)
};

SequenceResult RenderSequence(const Viewpoint& VP, int Width, int Height, int Spp, int Bounces, int Frames,
                              float PanPerFrame, bool UseRestir, unsigned Threads, bool Verbose)
{
    SequenceResult Out;
    Out.Mean.assign(static_cast<size_t>(Width) * Height * 3u, 0.0f);
    Out.Surface.assign(static_cast<size_t>(Width) * Height * 4u, 0.0f);
    Out.Variance.assign(static_cast<size_t>(Width) * Height, 0.0f);

    // The running mean. The kernel keeps it in HistoryImage/HistorySurfaceImage and REPROJECTS it through the R2
    //    motion vectors (ResolveSurface, R7a), so the CPU mirror does too: read the previous frame's texel the motion
    //    points at, validate with the 25° / 10 % rule, write this frame's mean back at the pixel's own address.
    //    Double-buffered — the shader reads and writes one image in a single dispatch, which is a read-write hazard on
    //    a GPU (a neighbour's write can land before a reprojected read); the mirror reads a stable previous frame.
    const size_t PixelCount = static_cast<size_t>(Width) * Height;
    std::vector<DenoiseMirror::Accumulator> FilmPrevious(PixelCount), FilmCurrent(PixelCount);
    std::vector<float> FilmSurfacePrevious(PixelCount * 4u, 0.0f), FilmSurfaceCurrent(PixelCount * 4u, 0.0f);
    std::mutex TallyMutex;   // the row threads' per-frame tallies land here
    RestirFrameState State;
    State.Current.resize(PixelCount);
    State.Previous.resize(PixelCount);

    // The base camera, then one pose per frame: `PanPerFrame` metres along the view's right vector, out and back —
    //    a TRIANGULAR excursion, so the last frame sits exactly on the base pose again. That is what makes the pan
    //    A/B measurable: with the reprojection on, the running mean follows the surface out and back and the closing
    //    frame is the base view with its samples intact; with the pre-R7a same-pixel read, the closing frame is a
    //    blend of every pose the pixel passed through (and the error against ① shows it).
    Frontier::CameraProjection Base;
    Base.AssignSpatialLocation(VP.Position);
    Base.AssignOrientationEuler(VP.PitchDegrees * kPi / 180.0f, VP.YawDegrees * kPi / 180.0f, 0.0f);
    Base.AssignFieldOfView(VP.FieldOfView);
    Base.AssignAspectRatio(static_cast<float>(Width) / static_cast<float>(Height));

    bool SunUp = false;
    for (const EmissiveTriangle& L : g_Lights) (void)L;
    SunUp = dot(g_SunDirRender, g_SunDirRender) > 0.0f && SkyRadianceWorld(g_SunDirRender).y > 0.0f;

    for (int F = 0; F < Frames; ++F)
    {
        Frontier::CameraProjection Camera = Base;
        if (PanPerFrame != 0.0f)
        {
            const int Peak = (Frames - 1) / 2;                       // 0 … Peak … 0: the excursion returns home
            const int Drift = F <= Peak ? F : (Frames - 1 - F);
            const Frontier::Vector3 R = Base.QueryRightVector();
            Camera.AssignSpatialLocation(Frontier::Vector3{ VP.Position.x + R.x * PanPerFrame * static_cast<float>(Drift),
                                                            VP.Position.y + R.y * PanPerFrame * static_cast<float>(Drift),
                                                            VP.Position.z + R.z * PanPerFrame * static_cast<float>(Drift) });
        }
        const CameraPose Pose = CapturePose(Camera);
        if (UseRestir)
        {
            State.FrameIndex = F;
            State.HasPrevious = F > 0;
            if (F > 0) State.PreviousPose = State.LastPose;
            State.LastPose = Pose;
        }

        double CoverageSum = 0.0, MSum = 0.0;
        double OccludedSum = 0.0;   // surface pixels whose merged selection failed its shadow re-trace this frame
        double ReprojectedSum = 0.0, MovedSum = 0.0, DisocclusionSum = 0.0;   // the film's R7a history read, by outcome
        double SurfaceSum = 0.0, CountSum = 0.0;   // the film's own tallies: surface pixels, mean samples behind them
        uint32_t MaxM = 0u;
        long FrameNonFinite = 0;
        std::vector<std::thread> Pool;
        for (unsigned Th = 0u; Th < Threads; ++Th)
            Pool.emplace_back([&, Th]()
            {
                long LocalBad = 0;
                double LocalCoverage = 0.0, LocalM = 0.0, LocalOccluded = 0.0;
                double LocalReprojected = 0.0, LocalMoved = 0.0, LocalDisocclusion = 0.0;
                double LocalSurfaces = 0.0, LocalCountSum = 0.0;
                uint32_t LocalMaxM = 0u;
                for (int Y = static_cast<int>(Th); Y < Height; Y += static_cast<int>(Threads))
                    for (int X = 0; X < Width; ++X)
                    {
                        const size_t Pixel = static_cast<size_t>(Y) * Width + X;
                        DenoiseMirror::Accumulator& Accumulator = FilmCurrent[Pixel];
                        Accumulator = DenoiseMirror::Accumulator();

                        // Primary visibility at the pixel CENTRE: the app's G-buffer (ray-traced on the GPU), what
                        //    Out.Surface publishes to the filter, and the normal/depth ResolveSurface validates the
                        //    film's reprojected read against.
                        const float CurU = (static_cast<float>(X) + 0.5f) / static_cast<float>(Width);
                        const float CurV = (static_cast<float>(Y) + 0.5f) / static_cast<float>(Height);
                        float Depth = 0.0f;
                        vec3 Normal(0.0f, 0.0f, 1.0f);
                        float MotionU = 0.0f, MotionV = 0.0f;
                        {
                            const Frontier::ViewRay CentreRay = Camera.ConstructRay(CurU, CurV);
                            const vec3 CO(CentreRay.OriginLocation.x, CentreRay.OriginLocation.y, CentreRay.OriginLocation.z);
                            const vec3 CD = normalize(vec3(CentreRay.UnitDirection.x, CentreRay.UnitDirection.y,
                                                           CentreRay.UnitDirection.z));
                            const Hit CentreHit = Intersect(CO, CD, 1.0e30f, -1);
                            if (CentreHit.Valid)
                            {
                                const RenderTriangle& Tri = g_Tris[CentreHit.TriId];
                                Depth = CentreHit.T;
                                Normal = normalize(cross(Tri.P1 - Tri.P0, Tri.P2 - Tri.P0));
                                if (dot(Normal, CD) > 0.0f) Normal = -Normal;
                                if (State.HasPrevious)
                                {
                                    float PrevU = 0.0f, PrevV = 0.0f;
                                    const vec3 HitPoint = CO + CD * CentreHit.T;
                                    if (ProjectPoint(State.PreviousPose, HitPoint, PrevU, PrevV))
                                    {
                                        MotionU = CurU - PrevU;
                                        MotionV = CurV - PrevV;
                                    }
                                }
                            }
                        }

                        // ResolveSurface's history read: reproject the mean through the motion vectors, validated with
                        //    the SAME rule the reservoirs use. A failure is disocclusion — restart at n = 1 rather than
                        //    smear a neighbour's colour across the silhouette. With the feature off, or on a background
                        //    pixel (no surface, so no motion), the read is the pixel's own address: the pre-R7a rule.
                        if (F > 0)
                        {
                            bool Resolved = false;
                            if (Depth > 0.0f && !g_RestirNoReproject)
                            {
                                const float PU = CurU - MotionU, PV = CurV - MotionV;
                                const int PrevX = static_cast<int>(floorf(PU * static_cast<float>(Width)));
                                const int PrevY = static_cast<int>(floorf(PV * static_cast<float>(Height)));
                                if (PrevX >= 0 && PrevY >= 0 && PrevX < Width && PrevY < Height)
                                {
                                    const size_t PrevPixel = static_cast<size_t>(PrevY) * Width + PrevX;
                                    const float* PrevSurf = &FilmSurfacePrevious[PrevPixel * 4u];
                                    if (PrevSurf[3] > 0.0f
                                        && dot(Normal, vec3(PrevSurf[0], PrevSurf[1], PrevSurf[2])) > kRestirNormalCos
                                        && fabsf(Depth - PrevSurf[3]) / max(Depth, 1.0e-3f) < kRestirDepthTol)
                                    {
                                        Accumulator = FilmPrevious[PrevPixel];
                                        LocalReprojected += 1.0;
                                        if (PrevPixel != Pixel) LocalMoved += 1.0;
                                        Resolved = true;
                                    }
                                    else { LocalDisocclusion += 1.0; Resolved = true; }   // a real disocclusion: count restarts at 0
                                }
                                else { LocalDisocclusion += 1.0; Resolved = true; }       // off screen — also a disocclusion
                            }
                            if (!Resolved) Accumulator = FilmPrevious[Pixel];
                        }
                        for (int S = 0; S < Spp; ++S)
                        {
                            Rng R((static_cast<uint32_t>(Y) * 73856093u) ^ (static_cast<uint32_t>(X) * 19349663u)
                                  ^ (static_cast<uint32_t>(F * Spp + S + 1) * 83492791u));
                            const float U = (static_cast<float>(X) + R.Next()) / static_cast<float>(Width);
                            const float V = (static_cast<float>(Y) + R.Next()) / static_cast<float>(Height);
                            const Frontier::ViewRay Ray = Camera.ConstructRay(U, V);
                            const vec3 O(Ray.OriginLocation.x, Ray.OriginLocation.y, Ray.OriginLocation.z);
                            const vec3 D = normalize(vec3(Ray.UnitDirection.x, Ray.UnitDirection.y, Ray.UnitDirection.z));
                            vec3 L;
                            if (UseRestir)
                            {
                                float SampleDepth = 0.0f;
                                vec3 SampleNormal(0.0f, 0.0f, 1.0f);
                                const vec3 Direct = RestirDirect(O, D, R, 1, SunUp, State, Width, Height, X, Y,
                                                                 SampleDepth, SampleNormal);
                                L = Direct + Radiance(O, D, R, Bounces, true);
                            }
                            else
                            {
                                L = Radiance(O, D, R, Bounces, false);
                            }
                            const float Sample[3] = { L.x, L.y, L.z };
                            float RadianceOut[3], VarianceOut = 0.0f;
                            Accumulator.Resolve(Sample, RadianceOut, &VarianceOut);
                            for (int C = 0; C < 3; ++C)
                                if (!(RadianceOut[C] >= 0.0f) || RadianceOut[C] > 1.0e7f) ++LocalBad;
                            Out.Mean[(static_cast<size_t>(Y) * Width + X) * 3u + 0u] = RadianceOut[0];
                            Out.Mean[(static_cast<size_t>(Y) * Width + X) * 3u + 1u] = RadianceOut[1];
                            Out.Mean[(static_cast<size_t>(Y) * Width + X) * 3u + 2u] = RadianceOut[2];
                            Out.Variance[static_cast<size_t>(Y) * Width + X] = VarianceOut;
                        }
                        float* Surf = &Out.Surface[Pixel * 4u];
                        Surf[0] = Normal.x; Surf[1] = Normal.y; Surf[2] = Normal.z; Surf[3] = Depth;
                        float* FilmSurf = &FilmSurfaceCurrent[Pixel * 4u];
                        FilmSurf[0] = Normal.x; FilmSurf[1] = Normal.y; FilmSurf[2] = Normal.z; FilmSurf[3] = Depth;
                        if (Depth > 0.0f)
                        {
                            LocalCountSum += static_cast<double>(Accumulator.Count);
                            LocalSurfaces += 1.0;
                        }
                        if (UseRestir && Depth > 0.0f)
                        {
                            const CpuReservoir& Res = State.Current[Pixel];
                            LocalCoverage += 1.0;
                            LocalM += static_cast<double>(Res.SampleCount);
                            if (Res.SampleCount > LocalMaxM) LocalMaxM = Res.SampleCount;
                            if (Res.Visible == 0u) LocalOccluded += 1.0;
                        }
                    }
                {
                    std::lock_guard<std::mutex> Guard(TallyMutex);
                    FrameNonFinite += LocalBad;
                    CoverageSum += LocalCoverage;
                    MSum += LocalM;
                    OccludedSum += LocalOccluded;
                    ReprojectedSum += LocalReprojected;
                    MovedSum += LocalMoved;
                    DisocclusionSum += LocalDisocclusion;
                    SurfaceSum += LocalSurfaces;
                    CountSum += LocalCountSum;
                    if (LocalMaxM > MaxM) MaxM = LocalMaxM;
                }
            });
        for (std::thread& T : Pool) T.join();
        Out.NonFinite += FrameNonFinite;
        const bool FrameSurface = SurfaceSum > 0.0;
        if (Verbose && (UseRestir || PanPerFrame != 0.0f))
            std::printf("[film]   frame %3d: running mean reprojected on %.1f%% of surface pixels (%.1f%% of those to a "
                        "moved texel), %.1f%% restarted on disocclusion, %.0f samples behind the mean\n",
                        F + 1, FrameSurface ? 100.0 * ReprojectedSum / SurfaceSum : 0.0,
                        ReprojectedSum > 0.0 ? 100.0 * MovedSum / ReprojectedSum : 0.0,
                        FrameSurface ? 100.0 * DisocclusionSum / SurfaceSum : 0.0,
                        FrameSurface ? CountSum / SurfaceSum : 0.0);
        if (UseRestir)
        {
            long SurfacePixels = 0;
            for (size_t I = 0; I < Out.Variance.size(); ++I) if (Out.Surface[I * 4u + 3u] > 0.0f) ++SurfacePixels;
            Out.ReservoirCoverage = SurfacePixels > 0 ? 100.0 * CoverageSum / static_cast<double>(SurfacePixels) : 0.0;
            Out.MeanReservoirM = CoverageSum > 0.0 ? MSum / CoverageSum : 0.0;
            if (Verbose)
                std::printf("[restir] frame %3d: %zu surface pixels, reservoirs on %.1f%% of them, mean M %.1f (max M %u), "
                            "occluded selections %.1f%%, %ld bad samples%s\n",
                            F + 1, static_cast<size_t>(SurfacePixels), Out.ReservoirCoverage, Out.MeanReservoirM, MaxM,
                            CoverageSum > 0.0 ? 100.0 * OccludedSum / CoverageSum : 0.0, FrameNonFinite,
                            MaxM > 100000000u ? "  ⚠ M is approaching the uint32 ceiling the kernel stores it in" : "");
        }
        std::swap(FilmPrevious, FilmCurrent);
        std::swap(FilmSurfacePrevious, FilmSurfaceCurrent);
        std::swap(State.Previous, State.Current);
    }
    return Out;
}

// The shipped à-trous chain, dispatched the way SwapchainExchange does it: one level per call, StepSize 1 << level,
//    the engine's σn/σz/σl, the filter's own 8×8 workgroup per level, the presentation tone map on the last live level.
void ApplyAtrousChain(SequenceResult& Result, int Extent, int Levels, float Exposure)
{
    const size_t Count = static_cast<size_t>(Extent) * Extent;
    std::vector<float> A(Count * 4u, 0.0f), B(Count * 4u, 0.0f);
    for (size_t I = 0; I < Count; ++I)
    {
        A[I * 4u + 0u] = Result.Mean[I * 3u + 0u];
        A[I * 4u + 1u] = Result.Mean[I * 3u + 1u];
        A[I * 4u + 2u] = Result.Mean[I * 3u + 2u];
        A[I * 4u + 3u] = Result.Variance[I];
    }
    std::vector<float> Output(Count * 4u, 0.0f);
    bool SourceIsA = true;
    for (int Level = 0; Level < Levels; ++Level)
    {
        DenoiseMirror::RunConfiguration Config;
        Config.Extent = static_cast<uint32_t>(Extent);
        Config.StepSize = 1u << Level;
        Config.Enabled = true;
        Config.FinalLevel = (Level == Levels - 1);
        Config.Exposure = Exposure;
        Config.ColourSaturation = 1.0f;
        DenoiseMirror::Run(Config, (SourceIsA ? A : B).data(), Result.Surface.data(),
                           (SourceIsA ? B : A).data(), Output.data());
        SourceIsA = !SourceIsA;
    }
    const std::vector<float>& Filtered = SourceIsA ? A : B;
    for (size_t I = 0; I < Count; ++I)
    {
        Result.Mean[I * 3u + 0u] = Filtered[I * 4u + 0u];
        Result.Mean[I * 3u + 1u] = Filtered[I * 4u + 1u];
        Result.Mean[I * 3u + 2u] = Filtered[I * 4u + 2u];
        Result.Variance[I] = Filtered[I * 4u + 3u];
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        MAIN
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** ArgumentValues)
{
    std::setlocale(LC_ALL, "C");
    std::string OutPath = "Exhibits/Gallery/Materials/MaterialLibrary_View.png";
    std::string View = "default";
    std::string FogName = "clear";
    int Width = 960, Height = 540, Spp = 64, Bounces = 6;
    int Frames = 1;             // accumulation frames: the app's own ResolveSurface loop, off-GPU
    int DenoiseLevels = 5;      // the shipped chain's ceiling (ReSTIRIntegratorConfiguration::DenoiseLevelCount)
    double SunHour = 17.93;
    float Exposure = 1.05f;
    float PanPerFrame = 0.0f;   // [m/frame] camera drift, so the reprojection has something to reproject
    bool  UseRestir = false;    // the CPU ReSTIR DI mirror (see the block above)
    bool  Denoise = false;      // the shipped à-trous chain over the accumulated film
    unsigned Threads = std::thread::hardware_concurrency();
    if (Threads == 0u) Threads = 2u;

    for (int I = 1; I < ArgumentCount; ++I)
    {
        const std::string A = ArgumentValues[I];
        auto Next = [&](const char* Name) -> const char*
        {
            if (I + 1 >= ArgumentCount) { std::printf("[material-level] %s needs a value\n", Name); std::exit(2); }
            return ArgumentValues[++I];
        };
        if      (A == "--out")      OutPath = Next("--out");
        else if (A == "--view")     View = Next("--view");
        else if (A == "--fog")      FogName = Next("--fog");
        else if (A == "--width")    Width = std::atoi(Next("--width"));
        else if (A == "--height")   Height = std::atoi(Next("--height"));
        else if (A == "--spp")      Spp = std::atoi(Next("--spp"));
        else if (A == "--bounce")   Bounces = std::atoi(Next("--bounce"));
        else if (A == "--sun")      SunHour = std::atof(Next("--sun"));
        else if (A == "--exposure") Exposure = static_cast<float>(std::atof(Next("--exposure")));
        else if (A == "--threads")  Threads = static_cast<unsigned>(std::atoi(Next("--threads")));
        else if (A == "--no-sun")   g_SunNee = false;
        else if (A == "--row")      g_RowFilter = std::atoi(Next("--row"));
        else if (A == "--frames")   Frames = std::atoi(Next("--frames"));
        else if (A == "--pan")      PanPerFrame = static_cast<float>(std::atof(Next("--pan")));
        else if (A == "--restir")   UseRestir = true;
        else if (A == "--no-reproject") g_RestirNoReproject = true;
        else if (A == "--no-sun-coin") g_RestirNoSunCoin = true;
        else if (A == "--taps")     g_RestirSpatialTaps = static_cast<uint32_t>(std::atoi(Next("--taps")));
        else if (A == "--restir-bounce-mis") g_RestirBounceMis = true;
        else if (A == "--m-cap")    g_RestirMCap = static_cast<uint32_t>(std::atoi(Next("--m-cap")));
        else if (A == "--denoise")  Denoise = true;
        else if (A == "--denoise-levels") DenoiseLevels = std::atoi(Next("--denoise-levels"));
        else if (A == "--help")
        {
            std::printf("usage: MaterialLevelViewport [--out file.png] [--view default|wide|glass|row5] [--row N]\n"
                        "                            [--width W] [--height H] [--spp N] [--bounce N] [--sun H]\n"
                        "                            [--fog clear|morning|backlit] [--exposure X] [--threads N]\n"
                        "                            [--frames N] [--pan metres] [--restir] [--no-reproject]\n"
                        "                            [--denoise] [--denoise-levels N]\n");
            return 0;
        }
        else { std::printf("[material-level] unknown argument '%s' (try --help)\n", A.c_str()); return 2; }
    }
    if (Width < 8) Width = 8;
    if (Height < 8) Height = 8;
    if (Spp < 1) Spp = 1;

    std::printf("================================================================================\n");
    std::printf("   PROJECT-ZERO — MATERIAL LIBRARY LEVEL (M10), CPU RENDER OF THE VULKAN SCENE   \n");
    std::printf("================================================================================\n");

    if (!BuildLevel())
    {
        std::printf("[material-level] RED — the level did not build\n");
        return 1;
    }
    g_Sky.AssignSunHour(SunHour);
    if      (FogName == "morning") g_Sky.AssignFogScenario(Frontier::ProjectZero::SkyFogIntegrator::FogScenario::Morning);
    else if (FogName == "backlit") g_Sky.AssignFogScenario(Frontier::ProjectZero::SkyFogIntegrator::FogScenario::Backlit);
    else                           g_Sky.AssignFogScenario(Frontier::ProjectZero::SkyFogIntegrator::FogScenario::Clear);
    {
        const Frontier::Vector3 S = g_Sky.QuerySunDirectionRender();
        g_SunDirRender = normalize(vec3(S.x, S.y, S.z));
    }
    std::printf("[material-level] sky: sun hour %.2f, sun dir render (%.3f %.3f %.3f), fog %s\n",
                SunHour, g_SunDirRender.x, g_SunDirRender.y, g_SunDirRender.z, FogName.c_str());

    const Viewpoint VP = ViewpointFor(View);
    std::printf("[material-level] view '%s': eye (%.2f %.2f %.2f), pitch %.1f°, yaw %.1f°, FoV %.0f°, %dx%d @ %d spp, %d bounces, %d frame%s%s%s%s\n",
                View.c_str(), VP.Position.x, VP.Position.y, VP.Position.z, VP.PitchDegrees, VP.YawDegrees, VP.FieldOfView,
                Width, Height, Spp, Bounces, Frames, Frames == 1 ? "" : "s",
                UseRestir ? ", RESTIR DI (CPU mirror)" : "",
                PanPerFrame != 0.0f ? ", camera pan" : "",
                Denoise ? ", à-trous" : "");

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    g_Tables = &Tables;

    if (Denoise && Width != Height)
    {
        std::printf("[material-level] RED — --denoise runs the shipped filter, whose dispatch is square (8×8 workgroup); "
                    "render a square panel\n");
        return 2;
    }

    std::printf("[material-level] %s\n", UseRestir
        ? "estimator: the kernel's DI block on the CPU — RIS candidates, temporal + spatial reuse (25° / 10 % validation, "
          "20× M-clamp, pairwise MIS), visibility re-trace; indirect from the same BSDF-sampled bounce."
        : "estimator: brute-force accumulation — NEE with MIS for lamps, the sun's disc, and the sky on a missed ray.");
    if (UseRestir && g_RestirNoReproject)
        std::printf("[material-level] reprojection DISABLED: the temporal merge reads the same pixel (the pre-R7a rule)\n");

    SequenceResult Sequence = RenderSequence(VP, Width, Height, Spp, Bounces, Frames, PanPerFrame, UseRestir, Threads, true);
    if (Denoise) ApplyAtrousChain(Sequence, Width, DenoiseLevels, Exposure);
    const std::vector<float>& Film = Sequence.Mean;
    if (UseRestir)
        std::printf("[material-level] reservoirs: %.1f %% of surface pixels held one, mean M %.1f\n",
                    Sequence.ReservoirCoverage, Sequence.MeanReservoirM);

    // Presentation: the engine's own transfer, at the engine's own manual exposure.
    ColourTransfer Transfer;
    Transfer.ToneMap = Frontier::ToneMapCategory::Aces;
    Transfer.Exposure = Exposure;
    Transfer.Saturation = 1.0f;   // Manual mode hard-wires the Purkinje curve to 1.0 (ExposureIntegrator)
    std::vector<unsigned char> Png(static_cast<size_t>(Width) * Height * 3u);
    double Mean = 0.0;
    long Bad = 0;
    for (size_t I = 0; I < Film.size(); I += 3u)
    {
        const float Linear[3] = { Film[I], Film[I + 1u], Film[I + 2u] };
        for (int C = 0; C < 3; ++C)
            if (!(Film[I + static_cast<size_t>(C)] >= 0.0f) || Film[I + static_cast<size_t>(C)] > 1.0e7f) ++Bad;
        Mean += (Linear[0] + Linear[1] + Linear[2]) / 3.0;
        ColourPipeline::ApplyToByte(Transfer, Linear, &Png[I]);
    }
    Mean /= static_cast<double>(Film.size() / 3u);
    std::printf("[material-level] film: mean %.4f, %ld non-finite/out-of-range samples\n", Mean, Bad + Sequence.NonFinite);

    const int Ok = PngWriteCounterpart::WritePng(OutPath.c_str(), Width, Height, 3, Png.data(), Width * 3);
    std::printf("[material-level] %s -> %s\n", Ok != 0 ? "wrote" : "FAILED", OutPath.c_str());
    return Ok != 0 ? 0 : 1;
}
