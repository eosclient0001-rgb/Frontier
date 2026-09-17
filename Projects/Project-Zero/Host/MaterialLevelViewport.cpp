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
//    Build/run: Projects/Project-Zero/Host/Makefile target `MaterialLevelViewport`, or
//    `Exhibits/Workbench/Materials/RunMaterialLevelViewport.sh` (which seats the third-party headers, renders the kept
//    sheets and prints their sha256).
//
//    Usage: MaterialLevelViewport [--out <file.png>] [--width 960] [--height 540] [--spp 64]
//                                 [--bounce 6] [--sun 17.93] [--fog clear|morning|backlit] [--view default|wide|glass|row5]
//                                 [--exposure 1.05] [--threads 2]

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"

#include <algorithm>
#include <cmath>
#include <clocale>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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

vec3 Radiance(vec3 O, vec3 D, Rng& R, int Bounces)
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
        if (!FromInside) L += Beta * (DirectMIS(m, Lr, P, Ns, Tt, Bt, wo, R) + DirectMISsss(m, Lr, P, Ns, Tt, Bt, wo, R)
                                      + SunNee(m, Lr, P, Ns, Tt, Bt, wo, R));
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
    double SunHour = 17.93;
    float Exposure = 1.05f;
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
        else if (A == "--help")
        {
            std::printf("usage: MaterialLevelViewport [--out file.png] [--view default|wide|glass|row5] [--row N]\n"
                        "                            [--width W] [--height H] [--spp N] [--bounce N] [--sun H]\n"
                        "                            [--fog clear|morning|backlit] [--exposure X] [--threads N]\n");
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
    Frontier::CameraProjection Camera;
    Camera.AssignSpatialLocation(VP.Position);
    Camera.AssignOrientationEuler(VP.PitchDegrees * kPi / 180.0f, VP.YawDegrees * kPi / 180.0f, 0.0f);
    Camera.AssignFieldOfView(VP.FieldOfView);
    Camera.AssignAspectRatio(static_cast<float>(Width) / static_cast<float>(Height));
    std::printf("[material-level] view '%s': eye (%.2f %.2f %.2f), pitch %.1f°, yaw %.1f°, FoV %.0f°, %dx%d @ %d spp, %d bounces\n",
                View.c_str(), VP.Position.x, VP.Position.y, VP.Position.z, VP.PitchDegrees, VP.YawDegrees, VP.FieldOfView,
                Width, Height, Spp, Bounces);

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    g_Tables = &Tables;

    std::vector<float> Film(static_cast<size_t>(Width) * Height * 3u, 0.0f);
    std::vector<std::thread> Pool;
    for (unsigned Th = 0u; Th < Threads; ++Th)
        Pool.emplace_back([&, Th]()
        {
            for (int Y = static_cast<int>(Th); Y < Height; Y += static_cast<int>(Threads))
                for (int X = 0; X < Width; ++X)
                {
                    double Sum[3] = { 0.0, 0.0, 0.0 };
                    for (int S = 0; S < Spp; ++S)
                    {
                        Rng R((static_cast<uint32_t>(Y) * 73856093u) ^ (static_cast<uint32_t>(X) * 19349663u)
                              ^ (static_cast<uint32_t>(S + 1) * 83492791u));
                        // CameraProjection::ConstructRay takes screen coordinates in [0, 1] (it applies 2u − 1 itself,
                        //    with the vertical FoV and the aspect on X) — feeding it [−1, 1] would render a 2×-wide,
                        //    off-centre crop of the level.
                        const float U = (static_cast<float>(X) + R.Next()) / static_cast<float>(Width);
                        const float V = (static_cast<float>(Y) + R.Next()) / static_cast<float>(Height);
                        const Frontier::ViewRay Ray = Camera.ConstructRay(U, V);
                        const vec3 RadianceValue = Radiance(vec3(Ray.OriginLocation.x, Ray.OriginLocation.y, Ray.OriginLocation.z),
                                                            normalize(vec3(Ray.UnitDirection.x, Ray.UnitDirection.y, Ray.UnitDirection.z)),
                                                            R, Bounces);
                        Sum[0] += RadianceValue.x; Sum[1] += RadianceValue.y; Sum[2] += RadianceValue.z;
                    }
                    float* Pixel = &Film[(static_cast<size_t>(Y) * Width + X) * 3u];
                    Pixel[0] = static_cast<float>(Sum[0] / Spp);
                    Pixel[1] = static_cast<float>(Sum[1] / Spp);
                    Pixel[2] = static_cast<float>(Sum[2] / Spp);
                }
        });
    for (std::thread& T : Pool) T.join();

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
    std::printf("[material-level] film: mean %.4f, %ld non-finite/out-of-range samples\n", Mean, Bad);

    const int Ok = PngWriteCounterpart::WritePng(OutPath.c_str(), Width, Height, 3, Png.data(), Width * 3);
    std::printf("[material-level] %s -> %s\n", Ok != 0 ? "wrote" : "FAILED", OutPath.c_str());
    return Ok != 0 ? 0 : 1;
}
