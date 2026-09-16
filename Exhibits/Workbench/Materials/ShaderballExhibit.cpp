//============================================================================================================================================
//                                                         SHADERBALLEXHIBIT.CPP
//============================================================================================================================================
// 🧩 Headless CPU exhibit — the CC0 shaderball (Pseudopode/UnityShaderBall, Models/shaderball.obj) path-traced with
//    the proven Engine/Shaders/MaterialEvaluation.slang BSDF (FRONTIER_CPU_PORT, see SlangCpuShim.h) in three panels:
//    thin-wall glass, velvet cloth, clearcoat car paint. A studio rig (3 softbox quads + matte ground + gradient env)
//    lights every panel; the integrator is BSDF sampling + NEE with power-heuristic MIS, ACES + gamma 2.2, threaded
//    over rows, deterministic per (panel, frame, pixel).
//
//    Thin-wall honesty: the shipped BSDF's T-branch models entry+exit of a zero-thickness wall at ONE point, so a
//    transmitted ray continues past the ball interior (skip-ball segment) instead of intersecting the backface —
//    intersecting it would shade a second wall. Thick-glass traversal is M9, not this exhibit.
//
//    Kept harness: Exhibits/Workbench/Materials/ShaderballExhibit.cpp, driven by RunShaderballExhibit.sh (NOT part
//    of the materials gate — the full sheet is a ~5 min render). Mesh + sheet live in Exhibits/Gallery/Materials/.
//    Build: g++ -std=c++20 -O2 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation
//               -I Engine/Shaders -I Exhibits/Workbench/Editor Exhibits/Workbench/Materials/ShaderballExhibit.cpp
//               Engine/DisplayPresentation/ShadingTableCodec.cpp -o /tmp/sb-exhibit

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"

#include <algorithm>
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

#include "MaterialEvaluation.slang"
#include "PngWriteCounterpart.h"

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                                    RNG
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
//                                                              MESH + BVH
//------------------------------------------------------------------------------------------------------------------------

struct Tri
{
    vec3 A, B, C;      // vertices (world)
    vec3 Na, Nb, Nc;   // smooth vertex normals (world); zero when the source has none
    vec3 Ng;           // geometric normal (unit)
    int  Mat;          // material slot
    int  Light;        // emissive quad id, −1 when not a luminaire
};

struct BvhNode
{
    vec3 Min, Max;
    int  Left = -1, Right = -1;   // child indices; −1 on leaves
    int  Start = 0, Count = 0;    // leaf primitive span over Order
};

std::vector<Tri>     g_Tris;
std::vector<BvhNode> g_Nodes;
std::vector<int>     g_Order;

void BuildBvh(int Node, int Start, int Count)
{
    BvhNode& N = g_Nodes[Node];
    N.Min = vec3(1e30f); N.Max = vec3(-1e30f);
    vec3 CMin(1e30f), CMax(-1e30f);
    for (int I = 0; I < Count; ++I)
    {
        const Tri& T = g_Tris[g_Order[Start + I]];
        N.Min = min(N.Min, min(T.A, min(T.B, T.C)));
        N.Max = max(N.Max, max(T.A, max(T.B, T.C)));
        vec3 C = (T.A + T.B + T.C) / 3.0f;
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
            vec3 CA = (g_Tris[A].A + g_Tris[A].B + g_Tris[A].C) / 3.0f;
            vec3 CB = (g_Tris[B].A + g_Tris[B].B + g_Tris[B].C) / 3.0f;
            float VA = Axis == 0 ? CA.x : (Axis == 1 ? CA.y : CA.z);
            float VB = Axis == 0 ? CB.x : (Axis == 1 ? CB.y : CB.z);
            return VA < VB;
        });
    N.Left = static_cast<int>(g_Nodes.size()); g_Nodes.emplace_back();
    N.Right = static_cast<int>(g_Nodes.size()); g_Nodes.emplace_back();
    BuildBvh(N.Left, Start, Mid - Start);
    BuildBvh(N.Right, Mid, Start + Count - Mid);
}

struct Hit
{
    bool  Valid = false;
    float T = 1e30f;
    float U = 0.0f, V = 0.0f;
    int   TriId = -1;
};

// Möller–Trumbore, double-sided (emission + shading normals are resolved by the caller).
bool IntersectTri(const vec3& O, const vec3& D, const Tri& T, float TMax, float& THit, float& U, float& V)
{
    vec3 E1 = T.B - T.A, E2 = T.C - T.A;
    vec3 P = cross(D, E2);
    float Det = dot(E1, P);
    if (Det > -1e-12f && Det < 1e-12f) return false;
    float Inv = 1.0f / Det;
    vec3 S = O - T.A;
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

// skipMat ≥ 0 skips every triangle carrying that material (thin-wall transmission continuation).
Hit Intersect(const vec3& O, const vec3& D, float TMax, int skipMat)
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
                int Id = g_Order[N.Start + I];
                const Tri& T = g_Tris[Id];
                if (skipMat >= 0 && T.Mat == skipMat) continue;
                float TH, UH, VH;
                if (IntersectTri(O, D, T, H.T < TMax ? H.T : TMax, TH, UH, VH))
                {
                    H.Valid = true; H.T = TH; H.U = UH; H.V = VH; H.TriId = Id;
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
//                                                              SCENE
//------------------------------------------------------------------------------------------------------------------------

struct QuadLight
{
    vec3 Center, U, V;   // center + half-edge vectors (world)
    vec3 N;              // emission normal (unit, toward the subject)
    vec3 Radiance;
    float Area;
};

std::vector<QuadLight> g_Lights;

void AddTri(const vec3& A, const vec3& B, const vec3& C, int Mat, int Light = -1)
{
    Tri T;
    T.A = A; T.B = B; T.C = C;
    T.Na = T.Nb = T.Nc = vec3(0.0f);
    T.Ng = normalize(cross(B - A, C - A));
    T.Mat = Mat; T.Light = Light;
    g_Tris.push_back(T);
}

bool LoadObj(const char* Path, int Mat)
{
    FILE* F = std::fopen(Path, "r");
    if (!F) return false;
    std::vector<vec3> V, N;
    char Line[1024];
    int Added = 0;
    while (std::fgets(Line, sizeof(Line), F))
    {
        if (Line[0] == 'v' && Line[1] == ' ')
        {
            vec3 P;
            if (std::sscanf(Line + 2, "%f %f %f", &P.x, &P.y, &P.z) == 3) V.push_back(P);
        }
        else if (Line[0] == 'v' && Line[1] == 'n')
        {
            vec3 Q;
            if (std::sscanf(Line + 2, "%f %f %f", &Q.x, &Q.y, &Q.z) == 3) N.push_back(Q);
        }
        else if (Line[0] == 'f' && Line[1] == ' ')
        {
            // Fan-triangulate; accepts v, v/vt/vn, v//vn.
            int VI[16], NI[16], NV = 0;
            const char* P = Line + 2;
            while (*P && NV < 16)
            {
                while (*P == ' ' || *P == '\t') ++P;
                if (!*P || *P == '\n' || *P == '\r') break;
                int Vi = 0, Ti = 0, Ni = 0;
                int Read = std::sscanf(P, "%d/%d/%d", &Vi, &Ti, &Ni);
                if (Read <= 0) { Read = std::sscanf(P, "%d//%d", &Vi, &Ni); }
                if (Read <= 0) { Read = std::sscanf(P, "%d", &Vi); }
                if (Read <= 0) break;
                VI[NV] = Vi - 1; NI[NV] = (Read >= 3 || (Read == 2 && std::strchr(P, '/'))) ? Ni - 1 : -1;
                ++NV;
                while (*P && *P != ' ' && *P != '\t' && *P != '\n' && *P != '\r') ++P;
            }
            for (int K = 1; K + 1 < NV; ++K)
            {
                int I0 = VI[0], I1 = VI[K], I2 = VI[K + 1];
                if (I0 < 0 || I1 < 0 || I2 < 0 || I0 >= (int)V.size() || I1 >= (int)V.size() || I2 >= (int)V.size()) continue;
                size_t Base = g_Tris.size();
                AddTri(V[I0], V[I1], V[I2], Mat);
                Tri& T = g_Tris[Base];
                int J0 = NI[0], J1 = NI[K], J2 = NI[K + 1];
                if (J0 >= 0 && J1 >= 0 && J2 >= 0 && J0 < (int)N.size() && J1 < (int)N.size() && J2 < (int)N.size())
                {
                    T.Na = N[J0]; T.Nb = N[J1]; T.Nc = N[J2];
                }
                ++Added;
            }
        }
    }
    std::fclose(F);
    std::printf("[exhibit] mesh: %d tris from %s\n", Added, Path);
    return Added > 0;
}

void AddGround(float Z, float Half, int Mat)
{
    AddTri(vec3(-Half, -Half, Z), vec3(Half, -Half, Z), vec3(Half, Half, Z), Mat);
    AddTri(vec3(-Half, -Half, Z), vec3(Half, Half, Z), vec3(-Half, Half, Z), Mat);
}

int AddSoftbox(const vec3& Center, const vec3& ToSubject, const vec3& UpHint, float HalfU, float HalfV,
               const vec3& Radiance, int Mat)
{
    vec3 N = normalize(ToSubject);
    vec3 U = normalize(cross(UpHint, N)) * HalfU;
    vec3 Vv = normalize(cross(N, U)) * HalfV;
    QuadLight L;
    L.Center = Center; L.U = U; L.V = Vv; L.N = N; L.Radiance = Radiance;
    L.Area = 4.0f * length(U) * length(Vv) / 1.0f;   // |U|×|V| are half-edges; recompute below exactly
    L.Area = 4.0f * HalfU * HalfV * length(normalize(cross(UpHint, N))) * length(cross(N, normalize(cross(UpHint, N))));
    int Id = static_cast<int>(g_Lights.size());
    g_Lights.push_back(L);
    vec3 C00 = Center - U - Vv, C10 = Center + U - Vv, C11 = Center + U + Vv, C01 = Center - U + Vv;
    if (dot(cross(C10 - C00, C11 - C00), N) < 0.0f) { vec3 T = C10; C10 = C01; C01 = T; }   // wind toward N
    AddTri(C00, C10, C11, Mat, Id);
    AddTri(C00, C11, C01, Mat, Id);
    return Id;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                           MATERIALS
//------------------------------------------------------------------------------------------------------------------------

ShadingRecord StandardMaterial(vec3 albedo, float roughness)
{
    ShadingRecord m;
    m.BaseColor = albedo; m.Metalness = 0.0f; m.DiffuseRoughness = 0.0f;
    m.SpecularWeight = 1.0f; m.SpecularColor = vec3(1.0f); m.SpecularRoughness = roughness;
    m.SpecularAnisotropy = 0.0f; m.AnisotropyAngle = 0.0f; m.SpecularIor = 1.5f;
    m.ThinFilmWeight = 0.0f; m.ThinFilmThickness = 0.5f; m.ThinFilmIor = 1.4f;
    m.HazinessWeight = 0.0f; m.HazinessRoughness = 0.5f;
    m.CoatWeight = 0.0f; m.CoatColor = vec3(1.0f); m.CoatRoughness = 0.0f; m.CoatAnisotropy = 0.0f;
    m.CoatIor = 1.6f; m.CoatDarkening = 1.0f;
    m.CoatTangent = vec3(1.0f, 0.0f, 0.0f); m.CoatNormal = vec3(0.0f, 0.0f, 1.0f);
    m.FuzzWeight = 0.0f; m.FuzzColor = vec3(1.0f); m.FuzzRoughness = 0.5f;
    m.Emission = vec3(0.0f);
    m.TransmissionWeight = 0.0f; m.TransmissionColor = vec3(1.0f);
    m.TransmissionDepth = 0.0f; m.TransmissionThickness = 0.0f;
    m.Selection = 0u;
    return m;
}

ShadingRecord g_Mats[8];

void BuildMaterials(int Panel)
{
    // Slots: 0 ball (per panel) · 1 ground · 2/3/4 softboxes (emissive, never BRDF-shaded).
    if (Panel == 0)
    {
        ShadingRecord m = StandardMaterial(vec3(0.0f), 0.06f);   // thin-wall clear glass
        m.SpecularIor = 1.5f;
        m.TransmissionWeight = 1.0f;
        m.Selection = kReflectanceTransmissive;
        g_Mats[0] = m;
    }
    else if (Panel == 1)
    {
        ShadingRecord m = StandardMaterial(vec3(0.50f, 0.045f, 0.055f), 1.0f);   // deep-red velvet
        m.Selection = kReflectanceCloth;
        m.SpecularWeight = 0.0f; m.DiffuseRoughness = 1.0f;
        m.FuzzWeight = 1.0f; m.FuzzColor = vec3(0.62f, 0.06f, 0.07f); m.FuzzRoughness = 0.65f;
        g_Mats[0] = m;
    }
    else
    {
        ShadingRecord m = StandardMaterial(vec3(0.020f, 0.075f, 0.330f), 0.30f);   // clearcoat car paint
        m.CoatWeight = 1.0f; m.CoatColor = vec3(1.0f); m.CoatRoughness = 0.06f;
        g_Mats[0] = m;
    }
    g_Mats[1] = StandardMaterial(vec3(0.32f), 1.0f);   // matte studio ground
    g_Mats[1].SpecularWeight = 0.25f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                           INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

struct Camera
{
    vec3 O, F, R, U;
    float TanHalf, Aspect;
};

vec3 EnvRadiance(const vec3& D)
{
    float T = clamp(D.z * 0.5f + 0.5f, 0.0f, 1.0f);
    return mix(vec3(0.055f, 0.058f, 0.065f), vec3(0.30f, 0.31f, 0.34f), T * T * (3.0f - 2.0f * T));
}

void ShadingFrame(const vec3& N, vec3& T, vec3& B)
{
    vec3 Helper = abs(N.z) < 0.9f ? vec3(0.0f, 0.0f, 1.0f) : vec3(1.0f, 0.0f, 0.0f);
    T = normalize(cross(Helper, N));
    B = cross(N, T);
}

// NEE direct light with power-heuristic MIS against the BSDF strategy (above-surface only; transmitted images of the
// softboxes arrive through the BSDF-sampled path, where the light strategy has no density and the MIS weight is 1).
vec3 DirectMIS(const ShadingRecord& m, const ResolvedLayers& L, const vec3& P, const vec3& N,
               const vec3& T, const vec3& B, const vec3& wo, Rng& R)
{
    if (g_Lights.empty()) return vec3(0.0f);
    int Li = static_cast<int>(R.Next() * g_Lights.size()) % static_cast<int>(g_Lights.size());
    const QuadLight& Q = g_Lights[Li];
    float Su = R.Next() * 2.0f - 1.0f, Sv = R.Next() * 2.0f - 1.0f;
    vec3 Lp = Q.Center + Q.U * Su + Q.V * Sv;
    vec3 Dw = Lp - P;
    float D2 = dot(Dw, Dw);
    float Dist = sqrt(D2);
    Dw = Dw / Dist;
    float CosL = dot(-Dw, Q.N);
    if (CosL <= 0.0f) return vec3(0.0f);
    vec3 wi(dot(Dw, T), dot(Dw, B), dot(Dw, N));
    if (wi.z <= 0.0f) return vec3(0.0f);
    vec3 Origin = P + N * 1e-4f;
    if (Occluded(Origin, Lp - Dw * 1e-3f)) return vec3(0.0f);
    vec3 F = EvaluateBsdf(m, L, wo, wi);
    float Pl = (1.0f / g_Lights.size()) * (1.0f / Q.Area) * D2 / CosL;   // light strategy, per unit solid angle
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    return F * (wi.z * W / max(Pl, 1e-12f)) * Q.Radiance;
}

vec3 Radiance(vec3 O, vec3 D, Rng& R)
{
    vec3 L(0.0f), Beta(1.0f);
    int Skip = -1;
    float LastPdf = 0.0f;   // BSDF pdf of the segment that arrived here (luminaire MIS)
    for (int Depth = 0; Depth < 8; ++Depth)
    {
        Hit H = Intersect(O, D, 1e30f, Skip);
        Skip = -1;
        if (!H.Valid)
        {
            L += Beta * EnvRadiance(D);
            break;
        }
        const Tri& T = g_Tris[H.TriId];
        vec3 P = O + D * H.T;
        if (T.Light >= 0)
        {
            // Luminaire seen along a BSDF-sampled direction: the NEE half of MIS. Camera rays (depth 0) take it
            // whole — the light strategy never generates camera paths.
            if (dot(D, T.Ng) < 0.0f)
            {
                float W = 1.0f;
                if (Depth > 0)
                {
                    const QuadLight& Q = g_Lights[T.Light];
                    float CosL = dot(-D, Q.N);
                    float Pl = (1.0f / g_Lights.size()) * (1.0f / Q.Area) * (H.T * H.T) / max(CosL, 1e-6f);
                    float Pb = LastPdf;
                    W = (Pb * Pb) / (Pl * Pl + Pb * Pb + 1e-12f);
                }
                L += Beta * g_Lights[T.Light].Radiance * W;
            }
            break;
        }
        vec3 Ng = T.Ng;
        if (dot(Ng, D) > 0.0f) Ng = -Ng;
        vec3 Ns;
        if (length(T.Na) > 0.5f)
            Ns = normalize(T.Na * (1.0f - H.U - H.V) + T.Nb * H.U + T.Nc * H.V);
        else
            Ns = Ng;
        if (dot(Ns, D) > 0.0f) Ns = -Ns;
        vec3 Tt, Bt;
        ShadingFrame(Ns, Tt, Bt);
        vec3 wo(dot(-D, Tt), dot(-D, Bt), dot(-D, Ns));
        const ShadingRecord& m = g_Mats[T.Mat];
        ResolvedLayers Lr = ResolveLayers(m, wo);
        L += Beta * DirectMIS(m, Lr, P, Ns, Tt, Bt, wo, R);
        vec4 S = SampleBsdf(m, Lr, wo, vec4(R.Next(), R.Next(), R.Next(), R.Next()));
        if (S.w <= 0.0f) break;
        vec3 wi = S.xyz;
        vec3 F = EvaluateBsdf(m, Lr, wo, wi);
        float CosS = wi.z < 0.0f ? -wi.z : wi.z;
        Beta *= F * (CosS / max(S.w, 1e-12f));
        Beta = min(Beta, vec3(8.0f, 8.0f, 8.0f));   // firefly clamp (softboxes through smooth glass)
        LastPdf = S.w;
        vec3 Dw = Tt * wi.x + Bt * wi.y + Ns * wi.z;
        if (wi.z < 0.0f)
            Skip = T.Mat;   // thin-wall exit: continue past this wall's own interior (see header)
        O = P + Ng * 1e-4f + Dw * 1e-4f;
        D = normalize(Dw);
    }
    return L;
}

void RenderPanel(const Camera& C, int Panel, int Size, int Spp, std::vector<float>& Film)
{
    Film.assign(static_cast<size_t>(Size) * Size * 3u, 0.0f);
    unsigned Threads = std::thread::hardware_concurrency();
    if (Threads == 0u) Threads = 2u;
    for (int Frame = 0; Frame < Spp; ++Frame)
    {
        std::vector<std::thread> Pool;
        for (unsigned Th = 0u; Th < Threads; ++Th)
            Pool.emplace_back([&, Th]()
            {
                for (int Y = static_cast<int>(Th); Y < Size; Y += static_cast<int>(Threads))
                    for (int X = 0; X < Size; ++X)
                    {
                        uint32_t Seed = (static_cast<uint32_t>(Panel) + 1u) * 73856093u
                                      ^ (static_cast<uint32_t>(Frame) + 1u) * 19349663u
                                      ^ (static_cast<uint32_t>(Y * Size + X) + 1u) * 83492791u;
                        Rng R(Seed);
                        float Sx = ((static_cast<float>(X) + R.Next()) / Size * 2.0f - 1.0f) * C.TanHalf * C.Aspect;
                        float Sy = (1.0f - (static_cast<float>(Y) + R.Next()) / Size * 2.0f) * C.TanHalf;
                        vec3 D = normalize(C.F + C.R * Sx + C.U * Sy);
                        vec3 Lc = Radiance(C.O, D, R);
                        float* S = &Film[(static_cast<size_t>(Y) * Size + X) * 3u];
                        S[0] += Lc.x; S[1] += Lc.y; S[2] += Lc.z;
                    }
            });
        for (auto& Th : Pool) Th.join();
    }
    float Inv = 1.0f / static_cast<float>(Spp);
    for (float& V : Film) V *= Inv;
}

float Aces(float X)
{
    float Y = (X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f);
    return clamp(Y, 0.0f, 1.0f);
}

} // namespace

int main(int Argc, char** Argv)
{
    const char* MeshPath = "Exhibits/Gallery/Materials/shaderball.obj";
    const char* OutPath = "Exhibits/Gallery/Materials/ShaderballSheet_GlassClothCoat.png";
    int Size = 400, Spp = 128;
    float Exposure = 1.0f;
    for (int I = 1; I < Argc; ++I)
    {
        std::string A = Argv[I];
        if (A == "--mesh" && I + 1 < Argc) MeshPath = Argv[++I];
        else if (A == "--out" && I + 1 < Argc) OutPath = Argv[++I];
        else if (A == "--size" && I + 1 < Argc) Size = std::atoi(Argv[++I]);
        else if (A == "--spp" && I + 1 < Argc) Spp = std::atoi(Argv[++I]);
        else if (A == "--exposure" && I + 1 < Argc) Exposure = static_cast<float>(std::atof(Argv[++I]));
    }

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    g_Tables = &Tables;
    std::printf("[exhibit] tables baked\n");

    if (!LoadObj(MeshPath, 0)) { std::printf("[exhibit] cannot open %s\n", MeshPath); return 1; }
    AddGround(-0.865f, 15.0f, 1);
    vec3 Subject(0.0f, 0.0f, 0.0f);
    AddSoftbox(vec3(-2.6f, -1.4f, 2.6f), Subject - vec3(-2.6f, -1.4f, 2.6f), vec3(0.0f, 0.0f, 1.0f),
               1.1f, 0.8f, vec3(16.0f, 15.5f, 15.0f), 2);
    AddSoftbox(vec3(2.8f, 0.8f, 1.2f), Subject - vec3(2.8f, 0.8f, 1.2f), vec3(0.0f, 0.0f, 1.0f),
               0.35f, 1.5f, vec3(9.0f, 11.0f, 14.0f), 3);
    AddSoftbox(vec3(0.8f, 3.2f, 0.6f), Subject - vec3(0.8f, 3.2f, 0.6f), vec3(0.0f, 0.0f, 1.0f),
               1.25f, 1.25f, vec3(3.5f, 2.8f, 2.2f), 4);

    g_Order.resize(g_Tris.size());
    for (size_t I = 0; I < g_Tris.size(); ++I) g_Order[I] = static_cast<int>(I);
    g_Nodes.emplace_back();
    BuildBvh(0, 0, static_cast<int>(g_Tris.size()));
    std::printf("[exhibit] scene: %d tris, %d bvh nodes, %d lights\n",
                (int)g_Tris.size(), (int)g_Nodes.size(), (int)g_Lights.size());

    Camera C;
    C.O = vec3(2.35f, -3.05f, 1.35f);
    vec3 Look = vec3(0.0f, 0.0f, -0.05f);
    C.F = normalize(Look - C.O);
    C.R = normalize(cross(C.F, vec3(0.0f, 0.0f, 1.0f)));
    C.U = normalize(cross(C.R, C.F));
    C.TanHalf = std::tan(16.0f * 3.14159265358979f / 180.0f);
    C.Aspect = 1.0f;

    const char* Names[3] = { "glass", "cloth", "coat" };
    const int Gap = 4;
    int SheetW = 3 * Size + 2 * Gap;
    std::vector<unsigned char> Sheet(static_cast<size_t>(SheetW) * Size * 3u, 8u);
    for (int P = 0; P < 3; ++P)
    {
        BuildMaterials(P);
        std::vector<float> Film;
        RenderPanel(C, P, Size, Spp, Film);
        double Mean = 0.0;
        long Bad = 0;
        for (size_t I = 0; I < Film.size(); ++I)
        {
            float V = Film[I];
            if (!(V >= 0.0f) || !(V <= 1e6f)) ++Bad;
            Mean += V;
        }
        Mean /= Film.size();
        std::printf("[exhibit] panel %s: mean=%.4f bad=%ld\n", Names[P], Mean, Bad);
        int X0 = P * (Size + Gap);
        for (int Y = 0; Y < Size; ++Y)
            for (int X = 0; X < Size; ++X)
                for (int Ch = 0; Ch < 3; ++Ch)
                {
                    float Lin = Aces(Film[(static_cast<size_t>(Y) * Size + X) * 3u + Ch] * Exposure);
                    Sheet[(static_cast<size_t>(Y) * SheetW + X0 + X) * 3u + Ch] =
                        static_cast<unsigned char>(std::pow(Lin, 1.0f / 2.2f) * 255.0f + 0.5f);
                }
    }
    int Ok = PngWriteCounterpart::WritePng(OutPath, SheetW, Size, 3, Sheet.data(), SheetW * 3);
    std::printf("[exhibit] %s -> %s\n", Ok ? "wrote" : "FAILED", OutPath);
    return Ok ? 0 : 1;
}
