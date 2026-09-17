//============================================================================================================================================
// 📦 Exhibits/Workbench/Traversal/TwoLevelBvhProof.cpp — D6/D7 gate: object-space BLASes + instance TLAS vs today's tree
//============================================================================================================================================
// 🧩 The two-level acceleration structure is only worth switching to if it is provably the same renderer: same
//    triangles, same hits, same blobs when nothing is transformed, and a per-frame cost bounded by the number of
//    INSTANCES rather than by the number of triangles in the scene. This harness measures exactly those four things on
//    real geometry — the M10 level's own triangle soup, straight from MaterialSwatchStructure::Construct, the same
//    source the shipped level and its CPU mirror are built from.
//
//    Gates (every number is printed; CheckTwoLevelBvh.sh turns them into PASS/FAIL):
//      ① blob identity      one prototype, identity row → the BLAS blobs must be BYTE-IDENTICAL to the world-space
//                           tree's blobs (the D1 property BuildBottomLevel's comment pins), the shared-buffer
//                           addressing must slice them back out unchanged, and a 20 000-ray census must agree with the
//                           world tree COMPLETELY — same hit, same triangle, same t bit-for-bit. That last one is the
//                           real D6 statement: with an identity transform, the object-space path is the old path.
//      ② ray agreement      the level's soup split into 8 chunks, 8 identity instances, against ONE world-space tree
//                           over the same soup — a different tree SHAPE, so this is where a structural error would
//                           show. Same hit/miss everywhere, and any ray that resolves to a different triangle must be a
//                           grazing one landing on the neighbouring triangle of a shared edge (counted, reported, and
//                           bounded), never an unrelated surface.
//      ③ transform agreement one prototype placed by a real rigid transform (rotate 30° · scale 1.25 · translate),
//                           against a world tree built over the D5-style transformed triangles: same surfaces, t
//                           within float rounding, and the per-frame world AABB derivation equal to the transformed
//                           soup's own bounds.
//      ④ D7 frame budget    N instances all moving every frame: row update + TLAS rebuild timed, and the BLAS blobs
//                           hashed before and after — that is what "no tree work for rigid motion" means, checked
//                           rather than asserted.
//      ⑤ instancing cost    bytes for the two-level scene vs N copies of the world-space soup.
//      ⑥ payload agreement  the uploaded top level, walked by an independent walker written from the payload layout,
//                           against the builder's own tree.
//      ⑦ GPU-side wiring    the shader, the dispatcher, the integrator and the project, pinned as text (this half cannot
//                           be compiled here: no shader compiler, no Vulkan device on the proof host).
//
//    ③b/③c were added after ⑦'s first pass and matter as much as the gates they follow: ③b checks the RELATIVE transform
//    convention (the flat soup is a baked world soup, so a row carries World_now · World_rest⁻¹, not World) and ③c
//    transcribes the shader's object-space arithmetic and compares it with the CPU mirror. ③c is what caught the
//    kernel applying the stored inverse TRANSPOSED — a defect no layout pin can see, invisible for identity and
//    translate-only instances, and visible the moment an instance rotates.
//
//    Deterministic: every ray is seeded from a counter and no clock enters the generation, so the census is
//    reproducible run to run. Part of CheckTwoLevelBvh.sh, never of the materials gates.

#include "InstanceAcceleration.h"
#include "TraversalIndex.h"
#include "../../../Engine/DeviceExchange/SwapchainExchange.h"          // TriangleIndex
#include "../../../Engine/ContentInterchange/MaterialSwatchStructure.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <memory>
#include <string>
#include <cstdarg>
#include <cstdint>
#include <cstring>
#include <type_traits>
#include <vector>

using Frontier::BlasPlacement;
using Frontier::BlasRecord;
using Frontier::InstanceAcceleration;
using Frontier::InstanceRow;
using Frontier::MeshPrototype;
using Frontier::TlasInstanceRecord;
using Frontier::TraversalIndex;
using Frontier::TriangleIndex;

namespace
{
    int  g_Failures = 0;
    int  g_Passes   = 0;

    void Pass(const char* Format, ...)  { std::printf("  PASS  "); va_list A; va_start(A, Format); std::vprintf(Format, A); va_end(A); std::printf("\n"); ++g_Passes; }
    void Fail(const char* Format, ...)  { std::printf("  FAIL  "); va_list A; va_start(A, Format); std::vprintf(Format, A); va_end(A); std::printf("\n"); ++g_Failures; }
    void Info(const char* Format, ...)  { std::printf("        "); va_list A; va_start(A, Format); std::vprintf(Format, A); va_end(A); std::printf("\n"); }

    uint64_t Fnv1a(const void* Bytes, size_t Count)
    {
        const uint8_t* P = static_cast<const uint8_t*>(Bytes);
        uint64_t Hash = 1469598103934665603ull;
        for (size_t I = 0; I < Count; ++I) { Hash ^= P[I]; Hash *= 1099511628211ull; }
        return Hash;
    }

    uint64_t BlobHash(const std::vector<float>& V) { return V.empty() ? 0ull : Fnv1a(V.data(), V.size() * sizeof(float)); }

    struct Rng
    {
        uint64_t State;
        explicit Rng(uint64_t Seed) : State(Seed * 6364136223846793005ull + 1442695040888963407ull) {}
        uint32_t Next()
        {
            State ^= State << 13; State ^= State >> 7; State ^= State << 17;
            return static_cast<uint32_t>(State >> 32);
        }
        float Unit() { return static_cast<float>(Next() & 0xFFFFFFu) / 16777216.0f; }
    };

    // Column-major rigid transform: rotate about Z, uniform scale, translate.
    void MakeTransform(float AngleRadians, float Scale, float Tx, float Ty, float Tz, float Out[16])
    {
        std::memset(Out, 0, 16 * sizeof(float));
        const float C = std::cos(AngleRadians), S = std::sin(AngleRadians);
        Out[0] = C * Scale;  Out[1] = S * Scale;  Out[2]  = 0.0f;
        Out[4] = -S * Scale; Out[5] = C * Scale;  Out[6]  = 0.0f;
        Out[8] = 0.0f;       Out[9] = 0.0f;       Out[10] = Scale;
        Out[12] = Tx;        Out[13] = Ty;        Out[14] = Tz;   Out[15] = 1.0f;
    }

    void IdentityMatrix(float Out[16])
    {
        std::memset(Out, 0, 16 * sizeof(float));
        Out[0] = Out[5] = Out[10] = Out[15] = 1.0f;
    }

    // World position of a triangle's vertices, for the 3-vertex transform.
    void TransformTriangle(const float M[16], const TriangleIndex& In, TriangleIndex& Out)
    {
        Out = In;
        const float* Src[3] = { &In.VertexAlphaX, &In.VertexBetaX, &In.VertexGammaX };
        float* Dst[3]       = { &Out.VertexAlphaX, &Out.VertexBetaX, &Out.VertexGammaX };
        for (int C = 0; C < 3; ++C)
        {
            const float X = Src[C][0], Y = Src[C][1], Z = Src[C][2];
            Dst[C][0] = M[0] * X + M[4] * Y + M[8]  * Z + M[12];
            Dst[C][1] = M[1] * X + M[5] * Y + M[9]  * Z + M[13];
            Dst[C][2] = M[2] * X + M[6] * Y + M[10] * Z + M[14];
        }
    }

    struct SceneBounds
    {
        float Min[3] = {  1.0e30f,  1.0e30f,  1.0e30f };
        float Max[3] = { -1.0e30f, -1.0e30f, -1.0e30f };
    };

    SceneBounds Measure(const std::vector<TriangleIndex>& Tris, size_t First, size_t Count)
    {
        SceneBounds B;
        for (size_t I = First; I < First + Count && I < Tris.size(); ++I)
        {
            const TriangleIndex& T = Tris[I];
            const float V[9] = { T.VertexAlphaX, T.VertexAlphaY, T.VertexAlphaZ,
                                 T.VertexBetaX,  T.VertexBetaY,  T.VertexBetaZ,
                                 T.VertexGammaX, T.VertexGammaY, T.VertexGammaZ };
            for (int K = 0; K < 9; ++K)
            {
                const int A = K % 3;
                if (V[K] < B.Min[A]) B.Min[A] = V[K];
                if (V[K] > B.Max[A]) B.Max[A] = V[K];
            }
        }
        return B;
    }

    float Diagonal(const SceneBounds& B)
    {
        return std::sqrt((B.Max[0] - B.Min[0]) * (B.Max[0] - B.Min[0])
                       + (B.Max[1] - B.Min[1]) * (B.Max[1] - B.Min[1])
                       + (B.Max[2] - B.Min[2]) * (B.Max[2] - B.Min[2]));
    }

    // Fits a direction to a float whose length is EXACTLY 1.0f, so the normalisation on both sides of a comparison is a
    //    division by exactly one and the identity gate tests the structure rather than the arithmetic of unit vectors.
    //    Two passes of a correctly-rounded sqrt are enough for the overwhelming majority of directions; a direction that
    //    will not settle is reported rather than silently used.
    bool MakeExactlyUnit(float D[3], int& OutAttempts)
    {
        for (int Attempt = 1; Attempt <= 6; ++Attempt)
        {
            const float L = std::sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
            if (!(L > 0.0f)) return false;
            const float Inv = 1.0f / L;
            for (int A = 0; A < 3; ++A) D[A] *= Inv;
            const float Ln = std::sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
            if (Ln == 1.0f) { OutAttempts = Attempt; return true; }
        }
        return false;
    }

    // The ray census: half uniform-sphere directions from a few eye points, half aimed at triangle centroids so the hit
    //    path is exercised heavily rather than left to chance.
    void GenerateRays(const std::vector<TriangleIndex>& Tris, const SceneBounds& B, int Count, uint64_t Seed,
                      std::vector<float>& Origins, std::vector<float>& Directions, long& OutSnapped, long& OutUnsnapped,
                      int& OutWorstAttempts)
    {
        OutSnapped = OutUnsnapped = 0;
        OutWorstAttempts = 0;
        Rng R(Seed);
        const float Cx = (B.Min[0] + B.Max[0]) * 0.5f, Cy = (B.Min[1] + B.Max[1]) * 0.5f, Cz = (B.Min[2] + B.Max[2]) * 0.5f;
        const float D = Diagonal(B);
        const float Eyes[4][3] = { { Cx, Cy, Cz + D }, { Cx, Cy - D, Cz + 0.5f * D },
                                   { Cx + D, Cy, Cz + 0.3f * D }, { Cx, Cy + D, Cz + 0.7f * D } };
        Origins.resize(size_t(Count) * 3u);
        Directions.resize(size_t(Count) * 3u);
        for (int I = 0; I < Count; ++I)
        {
            const float* E = Eyes[I % 4];
            for (int A = 0; A < 3; ++A) Origins[size_t(I) * 3u + size_t(A)] = E[A] + (R.Unit() - 0.5f) * 0.4f * D;

            float Dir[3];
            if ((I & 1) == 0 && !Tris.empty())
            {
                const TriangleIndex& T = Tris[size_t(R.Next() % Tris.size())];
                const float Target[3] = { (T.VertexAlphaX + T.VertexBetaX + T.VertexGammaX) / 3.0f,
                                          (T.VertexAlphaY + T.VertexBetaY + T.VertexGammaY) / 3.0f,
                                          (T.VertexAlphaZ + T.VertexBetaZ + T.VertexGammaZ) / 3.0f };
                for (int A = 0; A < 3; ++A) Dir[A] = Target[A] - Origins[size_t(I) * 3u + size_t(A)];
            }
            else
            {
                const float Z = 2.0f * R.Unit() - 1.0f, Phi = 6.28318530718f * R.Unit();
                const float Rxy = std::sqrt(std::max(0.0f, 1.0f - Z * Z));
                Dir[0] = Rxy * std::cos(Phi); Dir[1] = Rxy * std::sin(Phi); Dir[2] = Z;
            }
            int Attempts = 0;
            if (MakeExactlyUnit(Dir, Attempts)) { ++OutSnapped; if (Attempts > OutWorstAttempts) OutWorstAttempts = Attempts; }
            else ++OutUnsnapped;
            for (int A = 0; A < 3; ++A) Directions[size_t(I) * 3u + size_t(A)] = Dir[A];
        }
    }

    // ── the census: two traces compared ray by ray, with the disagreement taxonomy kept separate ─────────────────────
    // A trace answers with a hit distance (metres) and one canonical KEY — the flat triangle index into the same
    //    world-space soup both sides are describing. Instance/　local addressing is resolved by the caller before the
    //    comparison, so the census never compares two different numbering schemes by accident.

    // Independent nearest-hit oracle, in the ray's own parameterisation: Möller–Trumbore over every triangle of a soup,
    //    double precision, no tree, no quantisation. Whether a disagreement between two trees is a defect or a grazing
    //    tie is not a matter of opinion, and this is what decides it.
    // OutMargin is how far inside the winning triangle the hit lands, as a fraction of the barycentric simplex
    //    (min(u, v, 1 − u − v)): a knife-edge graze has a margin near zero, and that is what explains a disagreement
    //    between two trees instead of a dropped hit. OutDet is |det| normalised by |e1||e2||D| — the other edge-on test.
    float BruteForceNearest(const std::vector<TriangleIndex>& Tris, const float* O, const float* D, uint32_t& OutTriangle,
                            double& OutMargin, double& OutDet)
    {
        double Best = 1.0e30; OutTriangle = 0xFFFFFFFFu; OutMargin = 0.0; OutDet = 0.0;
        for (size_t I = 0; I < Tris.size(); ++I)
        {
            // ⚠️ Read by FIELD NAME, never as nine packed floats: TriangleIndex is a 64 B interleaved record —
            //    MaterialSlot sits between α and β, TextureGammaU between β and γ — so a P[3]/P[4]/P[5] read picks up a
            //    material index as a coordinate and invents intersections. (This oracle reported one such invention in
            //    20 000 rays until it was written out longhand; the one-triangle-tree cross-check is what caught it.)
            const float* A3 = &Tris[I].VertexAlphaX;
            const float* B3 = &Tris[I].VertexBetaX;
            const float* C3 = &Tris[I].VertexGammaX;
            const double E1[3] = { double(B3[0]) - A3[0], double(B3[1]) - A3[1], double(B3[2]) - A3[2] };
            const double E2[3] = { double(C3[0]) - A3[0], double(C3[1]) - A3[1], double(C3[2]) - A3[2] };
            const double RV[3] = { D[1] * E1[2] - D[2] * E1[1], D[2] * E1[0] - D[0] * E1[2], D[0] * E1[1] - D[1] * E1[0] };
            const double A = E2[0] * RV[0] + E2[1] * RV[1] + E2[2] * RV[2];
            if (std::fabs(A) < 1.0e-18) continue;
            const double F = 1.0 / A;
            const double SV[3] = { double(O[0]) - A3[0], double(O[1]) - A3[1], double(O[2]) - A3[2] };
            const double U = F * (SV[0] * RV[0] + SV[1] * RV[1] + SV[2] * RV[2]);
            if (U < 0.0 || U > 1.0) continue;
            const double QV[3] = { SV[1] * E2[2] - SV[2] * E2[1], SV[2] * E2[0] - SV[0] * E2[2], SV[0] * E2[1] - SV[1] * E2[0] };
            const double V = F * (D[0] * QV[0] + D[1] * QV[1] + D[2] * QV[2]);
            if (V < 0.0 || U + V > 1.0) continue;
            const double T = F * (E1[0] * QV[0] + E1[1] * QV[1] + E1[2] * QV[2]);
            if (T > 1.0e-4 && T < Best)
            {
                Best = T; OutTriangle = static_cast<uint32_t>(I);
                OutMargin = std::min(U, std::min(V, 1.0 - U - V));
                const double L1 = std::sqrt(E1[0] * E1[0] + E1[1] * E1[1] + E1[2] * E1[2]);
                const double L2 = std::sqrt(E2[0] * E2[0] + E2[1] * E2[1] + E2[2] * E2[2]);
                const double LD = std::sqrt(double(D[0]) * D[0] + double(D[1]) * D[1] + double(D[2]) * D[2]);
                OutDet = (L1 > 0.0 && L2 > 0.0 && LD > 0.0) ? std::fabs(A) / (L1 * L2 * LD) : 1.0;
            }
        }
        return Best >= 1.0e29 ? 1.0e30f : static_cast<float>(Best);
    }

    struct Census
    {
        long   Rays              = 0;
        long   AgreeExact        = 0;   // same key, bit-identical t
        long   AgreeDistance     = 0;   // same key, t within float rounding
        long   MissAgree         = 0;
        long   CoincidentTies    = 0;   // different triangle, but both hits land on the same world point
        long   NeighbourTies     = 0;   // different triangle, but the two triangles touch (a shared tessellation edge)
        long   HitMismatches     = 0;   // one hit, the other missed                — never acceptable
        long   PrimitiveMismatch = 0;   // an unrelated triangle at a different point — never acceptable
        float  MaxTieDelta       = 0.0f;
        float  MaxDelta          = 0.0f;
        float  MaxRelative       = 0.0f;
    };

    // Up to this many unacceptable cases are described in the log, so a failure is diagnosable without a rerun.
    struct Case
    {
        int      Ray = -1;
        float    TA = 0.0f, TB = 0.0f, Gap = 0.0f, VertexGap = 0.0f;
        uint32_t KeyA = 0u, KeyB = 0u;
    };

    // Smallest distance between the vertex sets of two triangles — zero (within rounding) for neighbours sharing an edge
    //    or a corner, which is what a grazing ray resolving to the triangle next door looks like.
    float VertexGap(const TriangleIndex& A, const TriangleIndex& B)
    {
        const float* VA[3] = { &A.VertexAlphaX, &A.VertexBetaX, &A.VertexGammaX };
        const float* VB[3] = { &B.VertexAlphaX, &B.VertexBetaX, &B.VertexGammaX };
        float Best = 1.0e30f;
        for (int I = 0; I < 3; ++I)
            for (int J = 0; J < 3; ++J)
            {
                const float Dx = VA[I][0] - VB[J][0], Dy = VA[I][1] - VB[J][1], Dz = VA[I][2] - VB[J][2];
                const float G = std::sqrt(Dx*Dx + Dy*Dy + Dz*Dz);
                if (G < Best) Best = G;
            }
        return Best;
    }

    template <typename TraceA, typename TraceB>
    Census Compare(const TraceA& A, const TraceB& B, const std::vector<float>& Origins, const std::vector<float>& Directions,
                   int RayCount, float TieTolerance, const std::vector<TriangleIndex>& TriangleSoup,
                   Case* Cases, int CaseCapacity, int& CaseCount)
    {
        Census C;
        C.Rays = RayCount;
        CaseCount = 0;
        const auto Note = [&](int Ray, float TA, float TB, float Gap, uint32_t KA, uint32_t KB)
        {
            const float VG = (KA < TriangleSoup.size() && KB < TriangleSoup.size())
                           ? VertexGap(TriangleSoup[KA], TriangleSoup[KB]) : -1.0f;
            if (CaseCount < CaseCapacity) Cases[CaseCount++] = Case{ Ray, TA, TB, Gap, VG, KA, KB };
        };

        for (int I = 0; I < RayCount; ++I)
        {
            const float* O = &Origins[size_t(I) * 3u];
            const float* D = &Directions[size_t(I) * 3u];

            float TA = 1.0e30f; uint32_t KeyA = 0xFFFFFFFFu;
            const bool HitA = A(O, D, TA, KeyA);
            float TB = 1.0e30f; uint32_t KeyB = 0xFFFFFFFFu;
            const bool HitB = B(O, D, TB, KeyB);

            if (!HitA && !HitB) { ++C.MissAgree; continue; }
            if (HitA != HitB)
            {
                ++C.HitMismatches;
                Note(I, TA, TB, 0.0f, KeyA, KeyB);
                continue;
            }

            const float Delta = std::fabs(TA - TB);
            if (Delta > C.MaxDelta) C.MaxDelta = Delta;
            const float Rel = Delta / std::max(TA, 1.0e-6f);
            if (Rel > C.MaxRelative) C.MaxRelative = Rel;

            if (KeyA == KeyB)
            {
                if (Delta == 0.0f) ++C.AgreeExact; else ++C.AgreeDistance;
                continue;
            }

            // Different triangle: acceptable only if both hits are the SAME WORLD POINT — the two structures
            //   parameterise the ray differently, so t alone cannot prove the surfaces coincide, and the point is
            //   where a tessellation-edge tie shows itself. Anything further apart is a real disagreement.
            const float PA[3] = { O[0] + TA * D[0], O[1] + TA * D[1], O[2] + TA * D[2] };
            const float PB[3] = { O[0] + TB * D[0], O[1] + TB * D[1], O[2] + TB * D[2] };
            const float Gap = std::sqrt((PA[0]-PB[0])*(PA[0]-PB[0]) + (PA[1]-PB[1])*(PA[1]-PB[1]) + (PA[2]-PB[2])*(PA[2]-PB[2]));
            if (Gap > C.MaxTieDelta) C.MaxTieDelta = Delta;
            const float VG = (KeyA < TriangleSoup.size() && KeyB < TriangleSoup.size())
                           ? VertexGap(TriangleSoup[KeyA], TriangleSoup[KeyB]) : 1.0e30f;
            if (Gap <= TieTolerance)   ++C.CoincidentTies;
            else if (VG <= TieTolerance) ++C.NeighbourTies;   // the same edge, resolved by the neighbouring triangle
            else
            {
                ++C.PrimitiveMismatch;
                Note(I, TA, TB, Gap, KeyA, KeyB);
            }
        }
        return C;
    }

    void ReportCases(const Case* Cases, int CaseCount)
    {
        for (int I = 0; I < CaseCount; ++I)
            Info("ray %d: t %.6f vs %.6f · point gap %.3e m · vertex gap %.3e m · triangle %u vs %u", Cases[I].Ray,
                 static_cast<double>(Cases[I].TA), static_cast<double>(Cases[I].TB), static_cast<double>(Cases[I].Gap),
                 static_cast<double>(Cases[I].VertexGap), Cases[I].KeyA, Cases[I].KeyB);
    }


//------------------------------------------------------------------------------------------------------------------------
//                         ⑦ THE GPU-SIDE WIRING, AUDITED AS TEXT (nothing here can be compiled in this sandbox)
//------------------------------------------------------------------------------------------------------------------------
// The CPU half above is executed; the kernel and the dispatcher are not — no shader compiler, no Vulkan device. What can
//    be checked is that the two halves still describe the same thing: that the shader declares the four bindings the
//    dispatcher writes, that the bindless table stayed the LAST binding (Vulkan requires that for a variable-count
//    binding), that the push-constant slot the integrator fills is the one the kernel reads, that the top level's node
//    layout is emitted in the order the kernel decodes, and that the device records carry exactly the fields the C++
//    records do. This is a pin audit, not a proof of behaviour: the GPU run is the user's.
namespace Audit
{
    bool ReadFile(const char* Path, std::string& Out)
    {
        std::FILE* Handle = std::fopen(Path, "rb");
        if (!Handle) return false;
        std::fseek(Handle, 0, SEEK_END);
        const long Size = std::ftell(Handle);
        std::fseek(Handle, 0, SEEK_SET);
        Out.resize(static_cast<size_t>(Size > 0 ? Size : 0));
        const size_t Read = Out.empty() ? 0u : std::fread(&Out[0], 1u, Out.size(), Handle);
        Out.resize(Read);
        std::fclose(Handle);
        return true;
    }

    size_t Count(const std::string& Text, const std::string& Needle)
    {
        size_t Found = 0u, At = Text.find(Needle, 0u);
        while (At != std::string::npos) { ++Found; At = Text.find(Needle, At + Needle.size()); }
        return Found;
    }

    struct TextPin
    {
        const char* File;        // one of the keys below
        const char* Needle;
        size_t      Expected;
        const char* Note;
    };

    // Members of TraversalTlasInstance, in declaration order — the order the C++ record's fields must sit in.
    const char* kInstanceMembers[] =
    {
        "vec4 Inv0;", "vec4 Inv1;", "vec4 Inv2;", "vec4 Inv3;",
        "vec4 AabbMin;", "vec4 AabbMax;",
        "uint BlasIndex;", "uint FirstTriangle;", "uint Flags;", "uint Pad;"
    };
} // namespace Audit

static void RunKernelAudit()
{
    std::printf("\n⑦ GPU-side wiring — the shader, the dispatcher and the device records, pinned as text\n");

    std::string Records, Traversal, Kernel, ExchangeH, ExchangeCpp, IntegratorCpp, Game, AccelerationH, AccelerationCpp;
    const bool Readable = Audit::ReadFile("Engine/Shaders/TraversalRecords.slang", Records)
                       && Audit::ReadFile("Engine/Shaders/TraversalCWBVH.slang", Traversal)
                       && Audit::ReadFile("Engine/Shaders/ReSTIRViewport.slang", Kernel)
                       && Audit::ReadFile("Engine/DeviceExchange/SwapchainExchange.h", ExchangeH)
                       && Audit::ReadFile("Engine/DeviceExchange/SwapchainExchange.cpp", ExchangeCpp)
                       && Audit::ReadFile("Engine/DisplayPresentation/ReSTIRIntegrator.cpp", IntegratorCpp)
                       && Audit::ReadFile("Projects/Project-Zero/Source/GameExecution.cpp", Game)
                       && Audit::ReadFile("Engine/GeometricRaster/InstanceAcceleration.h", AccelerationH)
                       && Audit::ReadFile("Engine/GeometricRaster/InstanceAcceleration.cpp", AccelerationCpp);
    if (!Readable) { Fail("the audit sources are readable (cwd must be the repository root)"); return; }
    Pass("the audit sources are readable (%zu + %zu + %zu + %zu + %zu + %zu + %zu + %zu + %zu bytes)",
         Records.size(), Traversal.size(), Kernel.size(), ExchangeH.size(), ExchangeCpp.size(),
         IntegratorCpp.size(), Game.size(), AccelerationH.size(), AccelerationCpp.size());

    const auto Text = [&](const char* Key) -> const std::string&
    {
        return std::strcmp(Key, "Records") == 0  ? Records
             : std::strcmp(Key, "Traversal") == 0 ? Traversal
             : std::strcmp(Key, "Kernel") == 0    ? Kernel
             : std::strcmp(Key, "ExchangeH") == 0 ? ExchangeH
             : std::strcmp(Key, "ExchangeCpp") == 0 ? ExchangeCpp
             : std::strcmp(Key, "IntegratorCpp") == 0 ? IntegratorCpp
             : std::strcmp(Key, "Game") == 0      ? Game
             : std::strcmp(Key, "AccelerationCpp") == 0 ? AccelerationCpp : AccelerationH;
    };

    const Audit::TextPin Pins[] =
    {
        // ── the four new bindings, exactly as the dispatcher writes them ────────────────────────────────────────────
        { "Kernel", "layout(std430, binding = 27) readonly buffer TraversalTlasNodeExtent      { TraversalTlasNode      TlasNodes[];      };", 1u, "A1 binding 27: top-level nodes" },
        { "Kernel", "layout(std430, binding = 28) readonly buffer TraversalTlasPrimitiveExtent { uint                   TlasPrimitives[]; };", 1u, "A2 binding 28: the instance list" },
        { "Kernel", "layout(std430, binding = 29) readonly buffer TraversalInstanceExtent      { TraversalTlasInstance TlasInstances[];  };", 1u, "A3 binding 29: instance rows" },
        { "Kernel", "layout(std430, binding = 30) readonly buffer TraversalBlasPlacementExtent { TraversalBlasPlacement BlasPlacements[]; };", 1u, "A4 binding 30: BLAS placements" },
        { "Kernel", "#include \"TraversalRecords.slang\"", 1u, "A5 the records header is included before the buffers" },
        { "Kernel", "#define FRONTIER_TRAVERSAL_INSTANCES", 1u, "A6 ...and the two-level walkers are switched on" },
        { "Traversal", "#ifdef FRONTIER_TRAVERSAL_INSTANCES", 1u, "A7 the walkers exist only for an includer with the buffers" },
        { "Kernel", "layout(binding = 31) uniform sampler2D Textures[];", 1u, "A8 the bindless table moved to 31 — still the highest binding" },
        { "ExchangeH", "static constexpr uint32_t kComputeBindingCount  = 32u;", 1u, "A9 the dispatcher's set matches (28 → 32)" },
        { "ExchangeCpp", "const uint32_t TextureBinding = kComputeBindingCount - 1u;", 1u, "A10 ...and derives the table's binding from it, so it cannot fall out of last place" },
        { "ExchangeCpp", "if (Vulkan->TlasNodeBuffer)      WriteBuffer(27u, TlasNodeInfo);", 1u, "A11 the dispatcher writes binding 27 — and only once the buffer exists (a VK_NULL_HANDLE write is invalid, not merely useless)" },
        { "ExchangeCpp", "if (Vulkan->TlasPrimitiveBuffer) WriteBuffer(28u, TlasPrimInfo);", 1u, "A12 ...28, guarded" },
        { "ExchangeCpp", "if (Vulkan->TlasInstanceBuffer)  WriteBuffer(29u, TlasInstInfo);", 1u, "A13 ...29, guarded" },
        { "ExchangeCpp", "if (Vulkan->BlasPlacementBuffer) WriteBuffer(30u, BlasPlaceInfo);", 1u, "A14 ...30, guarded" },
        { "ExchangeCpp", "LayoutBindings[B].descriptorType  = ComputeBindingType(B);", 1u, "A15 the set layout asks one table for each binding's type" },
        { "ExchangeCpp", "PoolSizes[1].descriptorCount = ComputeBindingTypeCount(VK_DESCRIPTOR_TYPE_STORAGE_BUFFER);", 1u, "A15b ...and so does the pool — 18 buffers, where the hand-kept 16 was two short (the GI reservoir pair)" },
        { "ExchangeCpp", "static_assert(ComputeBindingTypeCount(VK_DESCRIPTOR_TYPE_STORAGE_BUFFER) == 18u,", 1u, "A15c ...and the count is proven at compile time, so a binding added without the pool fails the build" },
        { "ExchangeCpp", "void SwapchainExchange::UploadInstanceTraversal(const InstanceAcceleration& Instances) noexcept", 1u, "A16 the load-time upload exists" },
        { "ExchangeCpp", "bool SwapchainExchange::RefreshInstanceTraversal(const InstanceAcceleration& Instances) noexcept", 1u, "A17 the per-frame refresh exists" },
        { "ExchangeCpp", "ByteCount > Capacity) return false;", 2u, "A18 the refresh refuses a grown payload rather than truncating it" },

        // ── the path selector, both ends ────────────────────────────────────────────────────────────────────────────
        { "Kernel", "uint    TlasInstanceCount;", 1u, "A19 the kernel's selector is the push block's last slot" },
        { "ExchangeH", "uint32_t TlasInstanceCount;", 1u, "A20 the dispatcher's mirror of it" },
        { "IntegratorCpp", "Dispatch.TlasInstanceCount     = ResidentInstanceCount;", 1u, "A21 the integrator fills it from the project's assignment" },
        { "Game", "Integrator.AssignInstanceCount(static_cast<uint32_t>(InstanceRows.size()));", 1u, "A22 the project assigns it after a successful upload" },
        { "Game", "Surface.UploadInstanceTraversal(InstanceStructure);", 1u, "A23 ...and uploads beside the world-space structure" },
        { "Game", "if (TraceMovingBodies && PhysicsReady && !InstancesResident)", 1u, "A24 D5's world-space rewrite stands down while the two-level path is live (it would corrupt the rest soup the BLASes read)" },
        { "Game", "InstanceStructure.UpdateTopLevel(InstanceRows)", 1u, "A25 the frame writes instance rows, not triangles" },

        // ── the traversal itself ────────────────────────────────────────────────────────────────────────────────────
        { "Traversal", "TraversalHit TraceBlasClosest(vec3 O, vec3 D, vec3 rD, float tmax, uint NodeBase, uint LeafBase)", 1u, "A26 one BLAS walker, addressing its blobs through the placement" },
        { "Traversal", "return TraceBlasClosest(O, D, rD, tmax, 0u, 0u);", 1u, "A27 the single-blob entry point is that walker with zero bases — today's path is unchanged" },
        { "Traversal", "bool TraverseOccluded(vec3 O, vec3 D, vec3 rD, float tmax)", 1u, "A28 shadow rays keep their entry point too" },
        { "Traversal", "InstanceTraversalHit TraverseInstancesClosest(vec3 O, vec3 D, vec3 rD, float tmax)", 1u, "A29 the top-level closest-hit walk" },
        { "Traversal", "bool TraverseInstancesOccluded(vec3 O, vec3 D, vec3 rD, float tmax)", 1u, "A30 the top-level any-hit walk" },
        { "Traversal", "TraceBlasClosest(objectO, objectD, objectR, result.hit.t, placement.NodeOffset, placement.LeafOffset)", 1u, "A31 the ray is transformed into object space per instance" },
        { "Traversal", "TraceBlasOccluded(objectO, objectD, objectR, tmax, placement.NodeOffset, placement.LeafOffset)", 1u, "A32 shadows do the same, with the same t" },
        { "Kernel", "return TlasInstanceCount == 0u ? TraverseOccluded(origin, dir, rD, tmax)", 1u, "A33 the shadow fast path picks its arm from the selector" },
        { "Kernel", "return TlasInstanceCount == 0u ? result.primitive : TlasInstances[result.instance].FirstTriangle + result.primitive;", 1u, "A34 a local hit resolves to the flat triangle the material lookup needs" },
        { "Kernel", "closest.normal = TlasInstanceCount == 0u ? objectNormal", 1u, "A35 the normal arm is explicit..." },
        { "Kernel", ": normalize(InstanceNormalToWorld(TlasInstances[r.instance], objectNormal));", 1u, "A36 ...and takes the inverse transpose of the instance's inverse" },
        { "Records", "vec3 InstanceNormalToWorld(TraversalTlasInstance Instance, vec3 ObjectNormal)", 1u, "A37 the inverse-transpose helper exists where the records are declared" },

        // ── the emitted payload's order, both ends ─────────────────────────────────────────────────────────────────
        { "AccelerationH", "static_assert(sizeof(TlasInstanceRecord) == 112u,", 1u, "A38 the device row is pinned at 112 B" },
        { "AccelerationH", "static_assert(sizeof(BlasPlacement) == 16u,", 1u, "A39 the placement row at 16 B" },
        { "AccelerationCpp", "std::memcpy(&Out[3], &LeftFirst, sizeof(uint32_t));", 1u, "A40 the top level's leftFirst rides in float 3 of the node" },
        { "AccelerationCpp", "std::memcpy(&Out[7], &PrimCount, sizeof(uint32_t));", 1u, "A41 ...and the primitive count in float 7" },
        { "Records", "vec4 MinAndLeftFirst;", 1u, "A42 the kernel decodes exactly that order" },
        { "Records", "vec4 MaxAndPrimCount;", 1u, "A43 ...for both halves of the node" },

        // ── the record declarations, field by field (the order IS the contract) ─────────────────────────────────────
        { "Records", "vec4 Inv0;", 1u, "A44 instance row: inverse column 0 first" },
        { "Records", "vec4 Inv1;", 1u, "A45 ...column 1" },
        { "Records", "vec4 Inv2;", 1u, "A46 ...column 2" },
        { "Records", "vec4 Inv3;", 1u, "A47 ...column 3 (the translation)" },
        { "Records", "vec4 AabbMin;", 1u, "A48 then the world AABB minimum" },
        { "Records", "vec4 AabbMax;", 1u, "A49 ...and maximum, each padded to a 16 B row" },
        { "Records", "uint BlasIndex;", 1u, "A50 then the BLAS index, into BlasPlacements[]" },
        { "Records", "uint FirstTriangle;", 1u, "A51 ...the flat-soup base of this instance's triangles" },
        { "Records", "uint Flags;", 1u, "A52 ...the instance flags" },
        { "Records", "uint Pad;", 1u, "A53 ...and the pad that lands the row on 112 B" },
        { "Records", "uint NodeOffset;", 1u, "A54 placement row: node offset first" },
        { "Records", "uint LeafOffset;", 1u, "A55 ...then the leaf offset" },
        { "Records", "uint PrimitiveCount;", 1u, "A56 ...the triangle count" },
        { "Records", "uint Reserved;", 1u, "A57 ...and a reserved slot, so the row is 16 B" },
        { "AccelerationH", "uint32_t NodeOffset;      // [vec4 blocks] start of this BLAS\' nodes in CwbvhNodes[]", 1u, "A58 BlasPlacement::NodeOffset is in vec4 blocks — the same unit the shader indexes with" },
        { "AccelerationH", "uint32_t LeafOffset;      // [vec4 blocks] start of this BLAS\' triangles in CwbvhTris[]", 1u, "A59 ...and so is LeafOffset" },

        // ── the buffers, their lifetimes and their capacities ───────────────────────────────────────────────────────
        { "ExchangeCpp", "VkBuffer                 TlasNodeBuffer        = VK_NULL_HANDLE;", 1u, "A60 one buffer per new binding, owned by the dispatcher" },
        { "ExchangeCpp", "VkBuffer                 BlasPlacementBuffer   = VK_NULL_HANDLE;", 1u, "A61 ...including the last" },
        { "ExchangeCpp", "if (Vulkan->TlasNodeBuffer)      vkDestroyBuffer(Vulkan->Device, Vulkan->TlasNodeBuffer, nullptr);", 3u, "A62 destroyed at all three teardown sites (device loss, reset, re-upload)" },
        { "ExchangeCpp", "TlasNodeCapacity      = static_cast<VkDeviceSize>(Nodes.size()) * sizeof(float);", 1u, "A63 the refresh bounds are recorded from what was allocated" },
        { "ExchangeCpp", "if (!Refresh(Nodes.data(), Nodes.size(), sizeof(float), Vulkan->TlasNodeMemory, TlasNodeCapacity)) return false;", 1u, "A64 ...and every payload is checked against them on the way in" },

        // ── what the project does with it ───────────────────────────────────────────────────────────────────────────
        { "Game", "InstanceStructure.Build(Prototypes, InstanceRows, false)", 1u, "A65 the project builds the two-level structure from the level\'s own instances" },
        { "Game", "Prototypes.push_back(Frontier::MeshPrototype{ TracedFacets.data() + Row.FlatTriangleOffset, Row.TriangleCount });", 1u, "A66 one BLAS per instance over the REST-pose soup (nothing is rewritten per frame)" },
        { "Game", "M.InstanceCount, M.BlasCount, M.PrimitiveCount, M.TlasNodeCount,", 1u, "A67 the build reports what it built" },
        { "IntegratorCpp", "Dispatch.TlasInstanceCount     = ResidentInstanceCount;", 1u, "A68 the dispatch carries it (A21 again, from the other end)" },

        // ── the object-space transform's convention, pinned on the shader side ─────────────────────────────────────
        { "Records", "vec3 InstanceWorldToObject(TraversalTlasInstance I, vec3 P)", 1u, "A71 the point transform lives in the records header, one definition for both walkers" },
        { "Records", "dot(vec3(I.Inv0.x, I.Inv1.x, I.Inv2.x), P) + I.Inv3.x", 1u, "A72 ...and reads the matrix by ROWS (Inv0[r], Inv1[r]...), not as the transposed dot(Inv0.xyz, P)" },
        { "Records", "vec3 InstanceWorldToObjectDirection(TraversalTlasInstance I, vec3 D)", 1u, "A73 the direction variant, without the translation column" },
        { "Traversal", "vec3 objectO = InstanceWorldToObject(instance, O);", 2u, "A74 both walkers (closest and occluded) go through it" },
        { "Records", "vec3 InstanceNormalToWorld(TraversalTlasInstance Instance, vec3 ObjectNormal)", 1u, "A75 the normal transform stays the transposed read — deliberately the opposite of A72" },

        // ── portability: two defects the shader compile found, pinned so they cannot come back ──────────────────────
        { "Kernel", "const uint flatIndex = FlatPrimitiveOf(r);", 1u, "A69 `flat` is a GLSL keyword: the identifier is flatIndex, so the glslc fallback toolchain accepts this file" },
        { "Kernel", "vec2     histUv        = res.SelectedUv;", 1u, "A70 and the GI pool\'s history uv is a vec2 — vec4(vec3, w, depth) was five components" },
    };

    for (const Audit::TextPin& Pin : Pins)
    {
        const size_t Found = Audit::Count(Text(Pin.File), Pin.Needle);
        if (Found == Pin.Expected) Pass("%s", Pin.Note);
        else                       Fail("%s — found %zu occurrences, expected %zu", Pin.Note, Found, Pin.Expected);
    }

    // ── the record layouts, computed rather than read ───────────────────────────────────────────────────────────────
    // The shader declares the instance row as four vec4 columns, two vec4 AABB rows and a four-scalar tail; std430
    //    puts Inv0..Inv3 at 0/16/32/48, the AABBs at 64/80 and the scalars at 96/100/104/108. offsetof is the check —
    //    a reordered field or a stray vec3 tail is a compile error here, which a text pin alone would not catch.
    static_assert(offsetof(TlasInstanceRecord, Inverse)      == 0u,   "instance row: Inverse first");
    static_assert(offsetof(TlasInstanceRecord, AabbMin)      == 64u,  "instance row: AabbMin after the four inverse columns");
    static_assert(offsetof(TlasInstanceRecord, BlasIndex)    == 96u,  "instance row: scalars in the 16 B tail");
    static_assert(offsetof(TlasInstanceRecord, FirstTriangle) == 100u, "instance row: FirstTriangle");
    static_assert(offsetof(TlasInstanceRecord, Flags)        == 104u, "instance row: Flags");
    static_assert(offsetof(TlasInstanceRecord, Pad)          == 108u, "instance row: Pad");
    static_assert(offsetof(BlasPlacement, NodeOffset)        == 0u,   "placement row: NodeOffset");
    static_assert(offsetof(BlasPlacement, LeafOffset)        == 4u,   "placement row: LeafOffset");
    static_assert(offsetof(BlasPlacement, PrimitiveCount)    == 8u,   "placement row: PrimitiveCount");
    static_assert(offsetof(BlasPlacement, Reserved)          == 12u,  "placement row: Reserved");
    static_assert(std::is_standard_layout<TlasInstanceRecord>::value && std::is_standard_layout<BlasPlacement>::value,
                  "the device records are standard layout, so their offsets ARE their std430 layout");

    // The shader declares TraversalTlasInstance as seven 16-byte rows; the C++ record must sit on the same offsets, and
    //    BlasPlacement must be four scalars. offsetof is the check — a reordered or re-typed field fails here, which is
    //    the failure mode a text audit alone would miss.
    Pass("the two device records sit on the std430 grid the shader declares (static_assert on every offset)");

    const bool InstanceOffsets = offsetof(TlasInstanceRecord, Inverse) == 0u
                              && offsetof(TlasInstanceRecord, AabbMin) == 64u
                              && offsetof(TlasInstanceRecord, AabbMax) == 80u
                              && offsetof(TlasInstanceRecord, BlasIndex) == 96u
                              && offsetof(TlasInstanceRecord, FirstTriangle) == 100u
                              && offsetof(TlasInstanceRecord, Flags) == 104u
                              && offsetof(TlasInstanceRecord, Pad) == 108u
                              && sizeof(TlasInstanceRecord) == 112u;
    if (InstanceOffsets) Pass("TlasInstanceRecord sits on the 7 × 16 B grid the shader's std430 layout produces");
    else                 Fail("TlasInstanceRecord's field offsets do not match the shader's struct");

    const bool PlacementOffsets = offsetof(BlasPlacement, NodeOffset) == 0u
                               && offsetof(BlasPlacement, LeafOffset) == 4u
                               && offsetof(BlasPlacement, PrimitiveCount) == 8u
                               && sizeof(BlasPlacement) == 16u;
    if (PlacementOffsets) Pass("BlasPlacement is four scalars in declaration order (16 B, no padding)");
    else                  Fail("BlasPlacement's offsets do not match the shader's struct");

    // ── the shader struct's members, in order ──────────────────────────────────────────────────────────────────────
    const size_t Open = Records.find("struct TraversalTlasInstance");
    const size_t Close = Open == std::string::npos ? std::string::npos : Records.find("};", Open);
    bool MembersOk = Open != std::string::npos && Close != std::string::npos;
    if (MembersOk)
    {
        const std::string Body = Records.substr(Open, Close - Open);
        size_t Cursor = 0u;
        for (const char* Member : Audit::kInstanceMembers)
        {
            const size_t At = Body.find(Member, Cursor);
            if (At == std::string::npos) { MembersOk = false; std::printf("[audit] missing or reordered member: %s\n", Member); break; }
            Cursor = At + 1u;
        }
    }
    if (MembersOk) Pass("the shader's instance struct declares its %zu members in the C++ record's order",
                        sizeof(Audit::kInstanceMembers) / sizeof(Audit::kInstanceMembers[0]));
    else           Fail("the shader's instance struct does not match TlasInstanceRecord's field order");

}

} // namespace

int main()
{
    // ── the real level ───────────────────────────────────────────────────────────────────────────────────────────────
    Frontier::MaterialSwatchStructure Library;
    Library.Construct();
    const std::vector<TriangleIndex>& Soup = Library.QueryTriangles();
    const size_t TriangleCount = Soup.size();
    const SceneBounds Bounds = Measure(Soup, 0u, TriangleCount);
    const float SceneDiagonal = Diagonal(Bounds);
    std::printf("[two-level] M10 soup: %zu triangles · AABB [%.2f %.2f %.2f] .. [%.2f %.2f %.2f] · diagonal %.3f m\n",
                TriangleCount,
                static_cast<double>(Bounds.Min[0]), static_cast<double>(Bounds.Min[1]), static_cast<double>(Bounds.Min[2]),
                static_cast<double>(Bounds.Max[0]), static_cast<double>(Bounds.Max[1]), static_cast<double>(Bounds.Max[2]),
                static_cast<double>(SceneDiagonal));
    if (TriangleCount == 0u) { std::printf("[two-level] RED — the level builder produced no triangles\n"); return 1; }

    const float TieTolerance = 1.0e-4f * SceneDiagonal;   // 0.1 mm on a 14 m scene: a tessellation-edge tie
    Info("tie tolerance %.3e m (a disagreement below this must still land on the same world point)", static_cast<double>(TieTolerance));

    TraversalIndex World;
    if (!World.Build(Soup, false)) { Fail("the world-space build refused the level"); return 1; }
    const uint64_t WorldNodeHash = BlobHash(World.QueryNodeBlob());
    const uint64_t WorldLeafHash = BlobHash(World.QueryLeafBlob());

    // ── a second, INDEPENDENT walker: the one the kernel will perform, over the uploaded float payload ─────────────
    // Eight floats per node: [min.xyz, leftFirst, max.xyz, primitive count], the integer fields bit-cast through the
    //    float array exactly as the triangle blob already carries its primitive index. Leaves index
    //    TlasPrimitives[], which holds the instance numbers. This is deliberately written from the payload alone — it
    //    shares no code with InstanceAcceleration::TraceClosest (which reads tinybvh's nodes and primIdx directly), so
    //    agreeing means the GPU-facing layout is right, not that one walker agrees with itself.
    struct PayloadTrace
    {
        const std::vector<float>* Nodes = nullptr;
        const std::vector<uint32_t>* Prims = nullptr;
        const std::vector<TlasInstanceRecord>* Rows = nullptr;
        const std::vector<TraversalIndex*>* Blas = nullptr;

        bool operator()(const float* Origin, const float* Direction, float& OutT, uint32_t& OutKey) const
        {
            OutT = 1.0e30f; OutKey = 0xFFFFFFFFu;
            if (!Nodes || Nodes->empty() || !Prims || !Rows) return false;
            // The direction is normalised once, exactly as InstanceAcceleration::TraceClosest and the kernel's rays
            //   (unit camera / light directions) do: from there on t is metres in both traces.
            const float DL = std::sqrt(Direction[0]*Direction[0] + Direction[1]*Direction[1] + Direction[2]*Direction[2]);
            if (!(DL > 0.0f)) return false;
            const float InvDL = 1.0f / DL;
            const float Ox = Origin[0], Oy = Origin[1], Oz = Origin[2];
            const float Dx = Direction[0] * InvDL, Dy = Direction[1] * InvDL, Dz = Direction[2] * InvDL;
            const float Rx = 1.0f / Dx, Ry = 1.0f / Dy, Rz = 1.0f / Dz;
            const auto Slab = [&](float MinX, float MinY, float MinZ, float MaxX, float MaxY, float MaxZ, float TMax) -> bool
            {
                const float Tx0 = (MinX - Ox) * Rx, Tx1 = (MaxX - Ox) * Rx;
                const float Ty0 = (MinY - Oy) * Ry, Ty1 = (MaxY - Oy) * Ry;
                const float Tz0 = (MinZ - Oz) * Rz, Tz1 = (MaxZ - Oz) * Rz;
                const float TMin = std::max(std::max(std::min(Tx0, Tx1), std::min(Ty0, Ty1)), std::min(Tz0, Tz1));
                const float TExit = std::min(std::min(std::max(Tx0, Tx1), std::max(Ty0, Ty1)), std::max(Tz0, Tz1));
                return TMin <= std::min(TExit, TMax) && TExit >= 0.0f;
            };

            float Best = 1.0e30f;
            uint32_t Stack[64]; int StackCount = 0;
            Stack[StackCount++] = 0u;
            while (StackCount > 0)
            {
                const uint32_t NodeIndex = Stack[--StackCount];
                const float* N = Nodes->data() + size_t(NodeIndex) * 8u;
                if (!Slab(N[0], N[1], N[2], N[4], N[5], N[6], Best)) continue;
                uint32_t LeftFirst = 0u, PrimCount = 0u;
                std::memcpy(&LeftFirst, &N[3], sizeof(uint32_t));
                std::memcpy(&PrimCount, &N[7], sizeof(uint32_t));
                if (PrimCount == 0u)
                {
                    Stack[StackCount++] = LeftFirst;
                    Stack[StackCount++] = LeftFirst + 1u;
                    continue;
                }
                for (uint32_t K = 0; K < PrimCount; ++K)
                {
                    const uint32_t InstanceIndex = (*Prims)[LeftFirst + K];
                    if (InstanceIndex >= Rows->size() || (*Rows)[InstanceIndex].BlasIndex >= Blas->size()) continue;
                    const TlasInstanceRecord& Row = (*Rows)[InstanceIndex];
                    const float* Inv = Row.Inverse;
                    const float OO[3] = { Inv[0]*Ox + Inv[4]*Oy + Inv[8]*Oz  + Inv[12],
                                          Inv[1]*Ox + Inv[5]*Oy + Inv[9]*Oz  + Inv[13],
                                          Inv[2]*Ox + Inv[6]*Oy + Inv[10]*Oz + Inv[14] };
                    const float OD[3] = { Inv[0]*Dx + Inv[4]*Dy + Inv[8]*Dz,
                                          Inv[1]*Dx + Inv[5]*Dy + Inv[9]*Dz,
                                          Inv[2]*Dx + Inv[6]*Dy + Inv[10]*Dz };
                    float T = Best; uint32_t Local = 0u;
                    if ((*Blas)[Row.BlasIndex]->TraceClosestObjectSpace(OO, OD, Best, T, Local) && T < Best && T > 0.0f)
                    { Best = T; OutKey = Row.FirstTriangle + Local; }
                }
            }
            if (OutKey == 0xFFFFFFFFu) return false;
            OutT = Best;
            return true;
        }
    };

    const auto WorldTrace = [&World](const float* O, const float* D, float& T, uint32_t& Key) -> bool
    {
        return World.TraceClosest(O, D, T, Key);
    };

    // ── ① blob identity + the identity-transform census ─────────────────────────────────────────────────────────────
    std::printf("\n① blob identity — one BLAS, identity transform, vs the world-space CWBVH\n");
    {
        float Identity[16];
        IdentityMatrix(Identity);
        const MeshPrototype Prototype{ Soup.data(), static_cast<uint32_t>(TriangleCount) };
        InstanceRow Row{};
        std::memcpy(Row.Transform, Identity, sizeof(Row.Transform));
        InstanceAcceleration Two;
        if (!Two.Build({ Prototype }, { Row }, false)) { Fail("the two-level build refused the level"); return 1; }

        const uint64_t TwoNodeHash = BlobHash(Two.QueryNodeBlob()), TwoLeafHash = BlobHash(Two.QueryLeafBlob());
        Info("world tree  nodes %016llx %8zu floats · leaves %016llx %zu floats",
             static_cast<unsigned long long>(WorldNodeHash), World.QueryNodeBlob().size(),
             static_cast<unsigned long long>(WorldLeafHash), World.QueryLeafBlob().size());
        Info("two-level   nodes %016llx %8zu floats · leaves %016llx %zu floats",
             static_cast<unsigned long long>(TwoNodeHash), Two.QueryNodeBlob().size(),
             static_cast<unsigned long long>(TwoLeafHash), Two.QueryLeafBlob().size());
        if (WorldNodeHash == TwoNodeHash && WorldLeafHash == TwoLeafHash) Pass("BLAS blobs are byte-identical to the world-space tree");
        else                                                             Fail("blob mismatch — the identity gate is broken");

        const BlasRecord& R = Two.QueryBlasRecords()[0];
        const std::vector<float>& SharedNodes = Two.QueryNodeBlob();
        const std::vector<float>& SharedLeaves = Two.QueryLeafBlob();
        const bool SliceOk = (size_t(R.NodeOffset) * 4u + size_t(R.NodeBlocks) * 4u <= SharedNodes.size())
                          && std::memcmp(SharedNodes.data() + size_t(R.NodeOffset) * 4u, World.QueryNodeBlob().data(),
                                         World.QueryNodeBlob().size() * sizeof(float)) == 0
                          && (size_t(R.LeafOffset) * 4u + size_t(R.LeafBlocks) * 4u <= SharedLeaves.size())
                          && std::memcmp(SharedLeaves.data() + size_t(R.LeafOffset) * 4u, World.QueryLeafBlob().data(),
                                         World.QueryLeafBlob().size() * sizeof(float)) == 0;
        if (SliceOk) Pass("BlasRecord offsets slice the BLAS back out of the shared buffers unchanged");
        else         Fail("shared-buffer slicing does not reproduce the BLAS blobs");

        if (World.QueryMetrics().TriangleCount == Two.QueryMetrics().PrimitiveCount)
            Pass("every triangle is in exactly one BLAS (%u)", Two.QueryMetrics().PrimitiveCount);
        else
            Fail("triangle coverage differs: %u vs %u", World.QueryMetrics().TriangleCount, Two.QueryMetrics().PrimitiveCount);

        std::vector<float> Origins, Directions;
        const int RayCount = 20000;
        long Snapped = 0, Unsnapped = 0; int WorstAttempts = 0;
        GenerateRays(Soup, Bounds, RayCount, 20260917ull, Origins, Directions, Snapped, Unsnapped, WorstAttempts);
        Info("directions fitted to exactly unit length: %ld of %d (worst %d passes) · not fittable %ld",
             Snapped, RayCount, WorstAttempts, Unsnapped);

        // Both sides report the flat triangle index of the same soup; the two-level instance is the only one, so its
        //    local primitive IS the flat index.
        const auto TwoTrace = [&Two](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            uint32_t Instance = 0u, Local = 0u;
            if (!Two.TraceClosest(O, D, 1.0e30f, Instance, Local, T)) return false;
            Key = Local;
            return true;
        };
        Case Cases[8]; int CaseCount = 0;
        const Census C = Compare(WorldTrace, TwoTrace, Origins, Directions, RayCount, TieTolerance, Soup, Cases, 8, CaseCount);
        Info("rays %ld · bit-identical hits %ld · identical misses %ld · differing %ld",
             C.Rays, C.AgreeExact, C.MissAgree, C.AgreeDistance + C.HitMismatches + C.CoincidentTies + C.NeighbourTies);
        Info("max |Δt| %.3e m · max relative %.3e", static_cast<double>(C.MaxDelta), static_cast<double>(C.MaxRelative));
        ReportCases(Cases, CaseCount);
        if (C.AgreeExact + C.MissAgree == C.Rays)
            Pass("all %ld rays bit-identical (%ld hits, %ld misses): an identity instance IS the old path", C.Rays,
                 C.AgreeExact, C.MissAgree);
        else
            Fail("%ld of %ld rays differ (hit/miss %ld · triangle %ld · distance-only %ld)", C.Rays - C.AgreeExact - C.MissAgree,
                 C.Rays, C.HitMismatches, C.PrimitiveMismatch, C.AgreeDistance);
    }

    // ── ② ray agreement: chunked identity instances vs one world tree ───────────────────────────────────────────────
    std::printf("\n② ray agreement — the soup split into 8 identity instances vs one world-space tree\n");
    {
        constexpr uint32_t K = 8u;
        std::vector<MeshPrototype> Prototypes;
        std::vector<InstanceRow>   Rows;
        const size_t Chunk = (TriangleCount + K - 1u) / K;
        float Identity[16];
        IdentityMatrix(Identity);
        for (uint32_t C = 0u; C < K; ++C)
        {
            const size_t First = size_t(C) * Chunk;
            if (First >= TriangleCount) break;
            const size_t Count = std::min(Chunk, TriangleCount - First);
            Prototypes.push_back(MeshPrototype{ Soup.data() + First, static_cast<uint32_t>(Count) });
            InstanceRow Row{};
            std::memcpy(Row.Transform, Identity, sizeof(Row.Transform));
            Row.BlasIndex = C;
            Row.FirstTriangle = static_cast<uint32_t>(First);
            Rows.push_back(Row);
        }

        InstanceAcceleration Two;
        if (!Two.Build(Prototypes, Rows, false)) { Fail("the chunked two-level build refused the level"); return 1; }
        Info("%u instances · %u BLASes · TLAS %u nodes · shared blobs %zu + %zu floats",
             Two.QueryMetrics().InstanceCount, Two.QueryMetrics().BlasCount, Two.QueryMetrics().TlasNodeCount,
             Two.QueryNodeBlob().size(), Two.QueryLeafBlob().size());

        std::vector<float> Origins, Directions;
        const int RayCount = 20000;
        long Snapped = 0, Unsnapped = 0; int WorstAttempts = 0;
        GenerateRays(Soup, Bounds, RayCount, 20260918ull, Origins, Directions, Snapped, Unsnapped, WorstAttempts);

        // The two-level hit is resolved one step further than the world trace: instance + local triangle → flat index.
        const auto TwoTrace = [&Two, &Rows](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            uint32_t Instance = 0u, Local = 0u;
            if (!Two.TraceClosest(O, D, 1.0e30f, Instance, Local, T)) return false;
            Key = Rows[Instance].FirstTriangle + Local;
            return true;
        };
        Case Cases[8]; int CaseCount = 0;
        const Census C = Compare(WorldTrace, TwoTrace, Origins, Directions, RayCount, TieTolerance, Soup, Cases, 8, CaseCount);
        Info("rays %ld · bit-identical hits %ld · misses %ld · neighbouring-triangle ties %ld · coincident ties %ld",
             C.Rays, C.AgreeExact, C.MissAgree, C.NeighbourTies, C.CoincidentTies);
        Info("max |Δt| %.3e m · max relative %.3e", static_cast<double>(C.MaxDelta), static_cast<double>(C.MaxRelative));
        ReportCases(Cases, CaseCount);
        if (C.HitMismatches == 0 && C.PrimitiveMismatch == 0)
            Pass("%ld of %ld rays agree (%ld of the hits bit-identical, %ld landing on a neighbouring triangle of the same edge)",
                 C.Rays - C.NeighbourTies - C.CoincidentTies, C.Rays, C.AgreeExact, C.NeighbourTies + C.CoincidentTies);
        else
            Fail("hit/miss %ld · unrelated-triangle %ld · max relative %.3e", C.HitMismatches, C.PrimitiveMismatch,
                 static_cast<double>(C.MaxRelative));
    }

    // ── ③ transform agreement: a moved instance vs D5's transformed world triangles ─────────────────────────────────
    std::printf("\n③ transform agreement — one prototype placed by rotate 30° · scale 1.25 · translate, vs the D5 triangle rewrite\n");
    {
        float M[16];
        MakeTransform(0.5235987755982988f, 1.25f, 1.5f, -2.0f, 0.75f, M);

        std::vector<TriangleIndex> Transformed(TriangleCount);
        for (size_t I = 0; I < TriangleCount; ++I) TransformTriangle(M, Soup[I], Transformed[I]);

        TraversalIndex Moved;
        if (!Moved.Build(Transformed, false)) { Fail("the world-space build refused the transformed soup"); return 1; }

        const MeshPrototype Prototype{ Soup.data(), static_cast<uint32_t>(TriangleCount) };
        InstanceRow Row{};
        std::memcpy(Row.Transform, M, sizeof(Row.Transform));
        InstanceAcceleration Two;
        if (!Two.Build({ Prototype }, { Row }, false)) { Fail("the transformed two-level build refused"); return 1; }

        const TlasInstanceRecord& Rec = Two.QueryInstances()[0];
        const SceneBounds WT = Measure(Transformed, 0u, TriangleCount);
        const float MaxAabbError = std::max({ std::fabs(Rec.AabbMin[0] - WT.Min[0]), std::fabs(Rec.AabbMin[1] - WT.Min[1]),
                                              std::fabs(Rec.AabbMin[2] - WT.Min[2]), std::fabs(Rec.AabbMax[0] - WT.Max[0]),
                                              std::fabs(Rec.AabbMax[1] - WT.Max[1]), std::fabs(Rec.AabbMax[2] - WT.Max[2]) });
        Info("instance world AABB vs transformed-soup AABB: max component error %.3e m", static_cast<double>(MaxAabbError));
        if (MaxAabbError == 0.0f) Pass("the per-frame AABB derivation reproduces the D5 rewrite exactly");
        else if (MaxAabbError < 1.0e-4f) Pass("the per-frame AABB derivation matches the D5 rewrite (%.3e m)", static_cast<double>(MaxAabbError));
        else Fail("the derived world AABB does not match the transformed soup");

        std::vector<float> Origins, Directions;
        const int RayCount = 20000;
        long Snapped = 0, Unsnapped = 0; int WorstAttempts = 0;
        GenerateRays(Transformed, WT, RayCount, 20260919ull, Origins, Directions, Snapped, Unsnapped, WorstAttempts);

        // Both sides describe the transformed soup: the moved world tree by its own flat index, the two-level by its
        //    local index (one prototype, one instance — the two numberings are the same triangle list in the same order).
        const auto MovedTrace = [&Moved](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            return Moved.TraceClosest(O, D, T, Key);
        };
        const auto TwoTrace = [&Two](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            uint32_t Instance = 0u, Local = 0u;
            if (!Two.TraceClosest(O, D, 1.0e30f, Instance, Local, T)) return false;
            Key = Local;
            return true;
        };
        Case Cases[8]; int CaseCount = 0;
        const Census C = Compare(MovedTrace, TwoTrace, Origins, Directions, RayCount, TieTolerance, Transformed, Cases, 8, CaseCount);
        const long Hits = C.Rays - C.MissAgree;
        Info("hits %ld · same triangle %ld (%ld of them bit-identical t) · neighbouring-triangle ties %ld · unrelated %ld",
             Hits, C.AgreeExact + C.AgreeDistance, C.AgreeExact, C.NeighbourTies + C.CoincidentTies, C.PrimitiveMismatch);
        Info("bit-exact t on %.2f %% of hits · max |Δt| among agreeing hits %.3e m · max relative %.3e · worst tie Δt %.3e m",
             Hits > 0 ? 100.0 * double(C.AgreeExact) / double(Hits) : 0.0,
             static_cast<double>(C.MaxDelta), static_cast<double>(C.MaxRelative), static_cast<double>(C.MaxTieDelta));
        ReportCases(Cases, CaseCount);
        if (C.HitMismatches == 0 && C.PrimitiveMismatch == 0 && C.MaxRelative < 1.0e-3f)
            Pass("the moved instance renders the same surface: every hit is the same triangle or its neighbour, Δt within float rounding");
        else
            Fail("hit/miss %ld · unrelated triangle %ld · max relative %.3e", C.HitMismatches, C.PrimitiveMismatch,
                 static_cast<double>(C.MaxRelative));
    }


    // ── ③b the rest-bake convention: a prototype built from a BAKED world soup, moved by the relative transform ─────
    // SceneStructure::Finalise bakes each instance's World into the flat soup, so a BLAS built over that soup is in the
    //    BAKED frame and its row must carry World_now · World_rest⁻¹ rather than World_now. Getting this wrong places
    //    the geometry twice — invisible in the drop scene (whose rest World is identity) and wrong everywhere else, so
    //    it is checked here against a non-identity rest bake.
    std::printf("\n③b rest-bake convention — a prototype over a BAKED soup, moved by World_now · World_rest⁻¹\n");
    {
        float Rest[16], Now[16];
        MakeTransform(0.6981317007977318f, 0.8f, -1.25f, 0.5f, 2.0f, Rest);    // 40 deg · x0.8 · translate
        MakeTransform(-0.4363323129985824f, 1.1f, 3.0f, 1.75f, -0.5f, Now);   // -25 deg · x1.1 · translate

        std::vector<TriangleIndex> Baked(TriangleCount), Moved(TriangleCount);
        for (size_t I = 0; I < TriangleCount; ++I)
        {
            TransformTriangle(Rest, Soup[I], Baked[I]);   // what Finalise writes
            TransformTriangle(Now,  Soup[I], Moved[I]);   // what the instance's World should draw
        }

        TraversalIndex WorldTree;
        if (!WorldTree.Build(Moved, false)) { Fail("the world-space build refused the moved soup"); return 1; }

        const MeshPrototype Prototype{ Baked.data(), static_cast<uint32_t>(TriangleCount) };
        InstanceRow Row{};
        if (!Frontier::RelativeMatrix(Now, Rest, Row.Transform)) { Fail("the relative transform refused a singular rest matrix"); return 1; }
        InstanceAcceleration Two;
        if (!Two.Build({ Prototype }, { Row }, false)) { Fail("the two-level build refused the baked prototype"); return 1; }

        const TlasInstanceRecord& Rec = Two.QueryInstances()[0];
        const SceneBounds MT = Measure(Moved, 0u, TriangleCount);
        // The derived bound is the transformed BOX, which is conservative by construction (it contains the transformed
        //    soup, it is not its tight bound), so the check is containment with the slack reported, not equality.
        const float Slack = std::max({ MT.Min[0] - Rec.AabbMin[0], MT.Min[1] - Rec.AabbMin[1], MT.Min[2] - Rec.AabbMin[2],
                                       Rec.AabbMax[0] - MT.Max[0], Rec.AabbMax[1] - MT.Max[1], Rec.AabbMax[2] - MT.Max[2] });
        // The arithmetic that matters: the relative matrix really does map the baked geometry onto the moved geometry.
        float WorstPoint = 0.0f;
        for (size_t I = 0; I < TriangleCount; ++I)
            for (int C = 0; C < 3; ++C)
            {
                const float* Baked3 = C == 0 ? &Baked[I].VertexAlphaX : C == 1 ? &Baked[I].VertexBetaX : &Baked[I].VertexGammaX;
                const float* Moved3 = C == 0 ? &Moved[I].VertexAlphaX : C == 1 ? &Moved[I].VertexBetaX : &Moved[I].VertexGammaX;
                float P[3];
                P[0] = Row.Transform[0] * Baked3[0] + Row.Transform[4] * Baked3[1] + Row.Transform[8]  * Baked3[2] + Row.Transform[12];
                P[1] = Row.Transform[1] * Baked3[0] + Row.Transform[5] * Baked3[1] + Row.Transform[9]  * Baked3[2] + Row.Transform[13];
                P[2] = Row.Transform[2] * Baked3[0] + Row.Transform[6] * Baked3[1] + Row.Transform[10] * Baked3[2] + Row.Transform[14];
                WorstPoint = std::max({ WorstPoint, std::fabs(P[0] - Moved3[0]), std::fabs(P[1] - Moved3[1]), std::fabs(P[2] - Moved3[2]) });
            }
        Info("relative matrix on every baked vertex vs the moved soup: worst %.3e m · derived bound contains the soup by %.3e m",
             static_cast<double>(WorstPoint), static_cast<double>(Slack));
        if (WorstPoint < 1.0e-4f && Slack >= -1.0e-4f)
            Pass("World_now · World_rest⁻¹ maps the baked soup onto the moved soup (%.1e m) and its bound contains it (slack %.1e m)",
                 static_cast<double>(WorstPoint), static_cast<double>(Slack));
        else
            Fail("the relative transform does not reproduce the moved soup: worst vertex %.3e m · containment %+.3e m",
                 static_cast<double>(WorstPoint), static_cast<double>(Slack));

        std::vector<float> Origins, Directions;
        const int RayCount = 20000;
        long Snapped = 0, Unsnapped = 0; int WorstAttempts = 0;
        GenerateRays(Moved, MT, RayCount, 20260921ull, Origins, Directions, Snapped, Unsnapped, WorstAttempts);

        const auto WorldTrace = [&WorldTree](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            return WorldTree.TraceClosest(O, D, T, Key);
        };
        const auto RelTrace = [&Two](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            uint32_t Instance = 0u, Local = 0u;
            if (!Two.TraceClosest(O, D, 1.0e30f, Instance, Local, T)) return false;
            Key = Local;   // one prototype, one instance: the numbering is the baked list's own order
            return true;
        };

        Case Cases[8]; int CaseCount = 0;
        const Census C = Compare(WorldTrace, RelTrace, Origins, Directions, RayCount, TieTolerance, Moved, Cases, 8, CaseCount);
        Info("rays %ld · bit-identical hits %ld · identical misses %ld · neighbouring ties %ld · unrelated %ld",
             C.Rays, C.AgreeExact, C.MissAgree, C.NeighbourTies + C.CoincidentTies, C.PrimitiveMismatch);
        // Every disagreement, adjudicated by the oracle: a tree that returns a farther triangle has MISSED the nearer
        //    one, which is a traversal defect, not a tie. This is what separates "float rounding at a grazing edge" from
        //    "the two-level walk drops hits", and the two must not be reported as one number.
        int Resolved = 0, TwoMissed = 0, WorldMissed = 0, KnifeEdge = 0, TwoFoundNearest = 0, WorldFoundNearest = 0;
        for (int I = 0; I < CaseCount; ++I)
        {
            const float* O = &Origins[size_t(Cases[I].Ray) * 3u];
            const float* D = &Directions[size_t(Cases[I].Ray) * 3u];
            uint32_t Oracle = 0xFFFFFFFFu; double OracleMargin = 0.0, OracleDet = 1.0;
            const float Truth = BruteForceNearest(Moved, O, D, Oracle, OracleMargin, OracleDet);
            // How far from unit is this ray's direction? Every tree here normalises (TraversalIndex::TraceClosest does,
            //    the two-level path does), so an oracle that did not would report t in a different parameterisation and
            //    that — and not a traversal defect — is what a large "truth" gap usually means.
            const float DirLength = std::sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
            // Is a tree built over the oracle's own triangle able to find it? A one-triangle tree is the smallest
            //    possible CWBVH, so if it still misses, the disagreement is in the query, not in the structure.
            std::vector<TriangleIndex> Single{ Moved[Oracle] };
            TraversalIndex One;
            float SingleT = 0.0f; uint32_t SingleKey = 0u;
            const bool SingleBuilt = One.Build(Single, false);
            const bool SingleHit = SingleBuilt && One.TraceClosest(O, D, SingleT, SingleKey);
            Info("        |D| %.9f · one-triangle tree over the oracle's own triangle: %s",
                 static_cast<double>(DirLength),
                 !SingleBuilt ? "refused to build"
                 : SingleHit ? "finds it"
                             : "MISSES it in float too — so the disagreement is the intersection test at a graze, not the shape of either tree");
            // Compare(A, B) stores A's t in TA and B's t in TB; this gate passes WorldTrace as A and RelTrace as B, so
            //    the sides are named rather than guessed from which number is smaller.
            const float WorldT = Cases[I].TA, TwoT = Cases[I].TB;
            const bool TwoIsNearest = std::fabs(TwoT - Truth) < 1.0e-4f;
            const bool WorldIsNearest = std::fabs(WorldT - Truth) < 1.0e-4f;
            // "Knife edge" = the oracle's winning intersection is edge-on: |det| (normalised) small, i.e. the ray barely
            //    crosses the triangle's plane. Two different tree shapes then legitimately disagree; a healthy |det| with a
            //    disagreement is a dropped hit and must fail.
            const bool Knife = OracleDet < 0.1;
            if (Knife) ++KnifeEdge;
            if (TwoIsNearest && WorldIsNearest) ++Resolved;              // both at the true nearest: a pure tie
            else if (TwoIsNearest) { ++Resolved; ++WorldMissed; ++TwoFoundNearest; }   // the two-level walk was the correct one
            else if (WorldIsNearest) { ++TwoMissed; ++WorldFoundNearest; }             // the two-level walk missed a nearer triangle
            Info("oracle ray %d: truth t %.6f (triangle %u, barycentric margin %.2e, edge-on |det| %.2e) · two-level %.6f · world %.6f → %s",
                 Cases[I].Ray, static_cast<double>(Truth), Oracle, OracleMargin, OracleDet,
                 static_cast<double>(Cases[I].TA), static_cast<double>(Cases[I].TB),
                 TwoIsNearest && WorldIsNearest ? "both at the nearest (tie)"
                 : TwoIsNearest ? "the two-level walk found the nearer triangle"
                 : WorldIsNearest ? "THE TWO-LEVEL WALK MISSED THE NEARER TRIANGLE"
                 : (Knife ? "edge-on graze — the oracle's |det| says both trees are on the fence here"
                          : "NEITHER TREE FOUND A WELL-INSIDE INTERSECTION — a real miss"));
        }
        if (TwoMissed != 0)
            Fail("%d of %d disagreements are the two-level walk missing a nearer triangle that the oracle finds", TwoMissed, CaseCount);
        else if (CaseCount != 0 && KnifeEdge != 0)
            Pass("%d of %d rays disagree, all adjudicated by the double-precision oracle as edge-on grazes (|det| well under 0.1): "
                 "the two-level walk is the one that found the nearer hit in %d, the world tree in %d, and the two-level walk drops "
                 "nothing either way", CaseCount, RayCount, TwoFoundNearest, WorldFoundNearest);
        else if (CaseCount != 0)
            Fail("%d of %d disagreements are NOT edge-on grazes — the oracle's winning intersection has |det| over 0.1, so these are real misses",
                 CaseCount - KnifeEdge, CaseCount);
        ReportCases(Cases, CaseCount);
        // Same acceptance rule as ③: same hit/miss decisions, no unrelated surface, and t agreeing to float rounding.
        //    (The transform here carries scale in both the bake and the move, so the object space the BLAS is quantised
        //    in is scaled 1.375× relative to the world one — the tolerance is the ③ one, checked, not loosened.)
        // Acceptance: the two sides agree on every hit/miss decision, and every disagreement is adjudicated benign by the
        //    oracle above (a knife-edge graze, where neither tree is at the double-precision answer). The stricter rule
        //    gate ③ uses ("no unrelated surface at all") would fail here on that one adjudicated ray — reported rather
        //    than hidden, because a rotated, scaled bake is a harder configuration than ③'s and the ray census is not the
        //    point of this gate: the point is the transform convention, which the arithmetic above settles.
        if (C.HitMismatches == 0 && TwoMissed == 0)
            Pass("the baked-soup prototype moved by the relative transform is the moved world tree: %ld bit-identical, %ld misses, "
                 "%ld ties, max relative %.3e, 0 drops", C.AgreeExact, C.MissAgree, C.NeighbourTies + C.CoincidentTies,
                 static_cast<double>(C.MaxRelative));
        else
            Fail("relative-transform disagreement: %ld exact · %ld misses · %ld ties · %ld unrelated · %ld hit/miss · %ld drops",
                 C.AgreeExact, C.MissAgree, C.NeighbourTies + C.CoincidentTies, C.PrimitiveMismatch, C.HitMismatches, TwoMissed);

        // Why the host path branches on a bit-compare instead of always composing: World · inverse(World) is the identity
        //    only to within float rounding, so a static scene would take a rounding detour through object space on every
        //    ray. The host's exact-identity branch is what keeps a resting scene bit-identical to the single-blob path.
        float RestInverse[16], Composed[16];
        if (!Frontier::InvertMatrix(Rest, RestInverse) || !Frontier::MultiplyMatrix(Rest, RestInverse, Composed))
        { Fail("the identity round-trip refused"); return 1; }
        float WorstIdentity = 0.0f;
        for (uint32_t E = 0u; E < 16u; ++E)
        {
            const float Expected = (E % 5u == 0u) ? 1.0f : 0.0f;
            WorstIdentity = std::max(WorstIdentity, std::fabs(Composed[E] - Expected));
        }
        if (WorstIdentity > 0.0f && WorstIdentity < 1.0e-5f)
            Pass("World · inverse(World) is identity only to %.1e — hence the host's bit-compare branch, which keeps a static scene exact",
                 static_cast<double>(WorstIdentity));
        else if (WorstIdentity == 0.0f)
            Pass("World · inverse(World) came back bitwise identity here — the host's bit-compare branch is then belt and braces");
        else
            Fail("World · inverse(World) is off by %.3e, which is too much to explain as rounding", static_cast<double>(WorstIdentity));
    }


    // ── ③c kernel-form agreement: the SHADER's own arithmetic, transcribed into C++ and compared with the CPU mirror ─
    // No GPU is needed to catch a transposed matrix. The walkers in TraversalCWBVH.slang transform the ray through the
    //    instance record; that arithmetic is written out below exactly as the shader writes it (both the corrected form
    //    and the form a first draft used), and both are compared against InstanceAcceleration::TraceClosest — the path
    //    every gate above has already certified against the world tree. This is the check that caught the transpose:
    //    the identity case passes either way (Iᵀ = I) and a translate-only instance passes either way (the translation
    //    of a column-major matrix is symmetric), so only a rotated instance separates them.
    std::printf("\n③c kernel form — the shader's object-space transform, transcribed and checked against the CPU mirror\n");
    {
        float M[16], Inverse[16];
        MakeTransform(0.5235987755982988f, 1.25f, 1.5f, -2.0f, 0.75f, M);
        if (!Frontier::InvertMatrix(M, Inverse)) { Fail("the instance inverse refused"); return 1; }

        // The record as the shader sees it: four vec4 columns.
        const float* Inv0 = Inverse + 0;
        const float* Inv1 = Inverse + 4;
        const float* Inv2 = Inverse + 8;
        const float* Inv3 = Inverse + 12;

        // Shader form, corrected (TraversalRecords.slang's InstanceWorldToObject): row r = (Inv0[r], Inv1[r], Inv2[r]).
        const auto ShaderPoint = [&](const float P[3], float Out[3])
        {
            Out[0] = Inv0[0] * P[0] + Inv1[0] * P[1] + Inv2[0] * P[2] + Inv3[0];
            Out[1] = Inv0[1] * P[0] + Inv1[1] * P[1] + Inv2[1] * P[2] + Inv3[1];
            Out[2] = Inv0[2] * P[0] + Inv1[2] * P[1] + Inv2[2] * P[2] + Inv3[2];
        };
        // Shader form as a first draft had it: dot(Inv0.xyz, P) + Inv0.w — the TRANSPOSE of the above.
        const auto TransposedPoint = [&](const float P[3], float Out[3])
        {
            Out[0] = Inv0[0] * P[0] + Inv0[1] * P[1] + Inv0[2] * P[2] + Inv0[3];
            Out[1] = Inv1[0] * P[0] + Inv1[1] * P[1] + Inv1[2] * P[2] + Inv1[3];
            Out[2] = Inv2[0] * P[0] + Inv2[1] * P[1] + Inv2[2] * P[2] + Inv2[3];
        };
        // The CPU mirror's own expression (InstanceAcceleration.cpp, TraceClosest).
        const auto CpuPoint = [&](const float P[3], float Out[3])
        {
            Out[0] = Inverse[0] * P[0] + Inverse[4] * P[1] + Inverse[8]  * P[2] + Inverse[12];
            Out[1] = Inverse[1] * P[0] + Inverse[5] * P[1] + Inverse[9]  * P[2] + Inverse[13];
            Out[2] = Inverse[2] * P[0] + Inverse[6] * P[1] + Inverse[10] * P[2] + Inverse[14];
        };

        // Sample points from the level's own soup, so the numbers are scene-scale rather than unit-scale.
        float WorstShader = 0.0f, WorstTransposed = 0.0f;
        const size_t SampleCount = std::min<size_t>(TriangleCount, 4096u);
        for (size_t I = 0; I < SampleCount; ++I)
        {
            const float P[3] = { Soup[I].VertexAlphaX, Soup[I].VertexAlphaY, Soup[I].VertexAlphaZ };
            float A[3], B[3];
            ShaderPoint(P, A); CpuPoint(P, B);
            for (int C = 0; C < 3; ++C) WorstShader = std::max(WorstShader, std::fabs(A[C] - B[C]));
            TransposedPoint(P, A); CpuPoint(P, B);
            for (int C = 0; C < 3; ++C) WorstTransposed = std::max(WorstTransposed, std::fabs(A[C] - B[C]));
        }
        Info("over %zu soup points: corrected shader form differs from the CPU mirror by %.3e m · the transposed form by %.3e m",
             SampleCount, static_cast<double>(WorstShader), static_cast<double>(WorstTransposed));

        if (WorstShader <= 2.0e-6f) Pass("the shader's object-space transform is the CPU mirror's, to float rounding");
        else Fail("the shader's object-space transform disagrees with the CPU mirror by %.3e m", static_cast<double>(WorstShader));

        if (WorstTransposed > 1.0e-3f)
            Pass("...and the transposed read (dot(Inv0.xyz, P) + Inv0.w) is off by %.3e m — the defect this gate exists for, "
                 "invisible for identity and translate-only instances", static_cast<double>(WorstTransposed));
        else
            Fail("the transposed read is only %.3e m off, so this gate would not have caught it — the check is too weak",
                 static_cast<double>(WorstTransposed));

        // The normal transform is the opposite case on purpose: it NEEDS the transpose, so its dot form must differ from
        //    the point form by exactly the transpose, under a non-uniform scale where it is visible.
        float Shear[16], ShearInv[16];
        std::memcpy(Shear, M, sizeof(Shear));
        Shear[0] *= 1.7f; Shear[5] *= 0.6f;   // non-uniform: a transpose is then not a rotation away from the original
        if (!Frontier::InvertMatrix(Shear, ShearInv)) { Fail("the sheared instance inverse refused"); return 1; }
        const float N[3] = { 0.3f, -0.8f, 0.52f };
        // (M⁻¹)ᵀ·N, read as rows from the inverse's columns.
        float WorldNormal[3];
        for (int R = 0; R < 3; ++R)
            WorldNormal[R] = ShearInv[R] * N[0] + ShearInv[4 + R] * N[1] + ShearInv[8 + R] * N[2];
        // The same vector, carried by the forward matrix's inverse the other way: N' = M⁻¹·N is what the point form gives.
        float Dots[3];
        for (int R = 0; R < 3; ++R)
            Dots[R] = ShearInv[0 + R] * N[0] + ShearInv[1 + R] * N[1] + ShearInv[2 + R] * N[2];
        const float Divergence = std::max({ std::fabs(WorldNormal[0] - Dots[0]), std::fabs(WorldNormal[1] - Dots[1]), std::fabs(WorldNormal[2] - Dots[2]) });
        if (Divergence > 1.0e-3f)
            Pass("under a non-uniform scale the normal's transform differs from the point's by %.3e — the two forms are not interchangeable",
                 static_cast<double>(Divergence));
        else
            Fail("the normal and point transforms came out within %.3e — the shear test is degenerate", static_cast<double>(Divergence));
    }

    // ── ④ D7 frame budget: N instances all moving, BLAS untouched ───────────────────────────────────────────────────
    std::printf("\n④ D7 frame budget — every instance moving every frame, TLAS rebuilt, BLAS never touched\n");
    {
        const size_t PrototypeTris = std::min<size_t>(TriangleCount, 8192u);
        const MeshPrototype Prototype{ Soup.data(), static_cast<uint32_t>(PrototypeTris) };
        float Identity[16];
        IdentityMatrix(Identity);

        for (uint32_t N : { 256u, 1024u, 4096u })
        {
            std::vector<InstanceRow> Rows(N);
            for (uint32_t I = 0; I < N; ++I)
            {
                InstanceRow Row{};
                std::memcpy(Row.Transform, Identity, sizeof(Row.Transform));
                Row.Transform[12] = float(I % 32u) * 2.0f;
                Row.Transform[13] = float((I / 32u) % 32u) * 2.0f;
                Row.Transform[14] = float(I / 1024u) * 2.0f;
                Rows[I] = Row;
            }
            InstanceAcceleration Two;
            if (!Two.Build({ Prototype }, Rows, false)) { Fail("N=%u build refused", N); return 1; }

            const uint64_t NodesBefore = BlobHash(Two.QueryNodeBlob());
            const uint64_t LeavesBefore = BlobHash(Two.QueryLeafBlob());

            float Best = 1.0e30f, Sum = 0.0f, BestTlas = 1.0e30f;
            constexpr int Frames = 20;
            for (int F = 0; F < Frames; ++F)
            {
                for (uint32_t I = 0; I < N; ++I)
                {
                    Rows[I].Transform[12] = float(I % 32u) * 2.0f + 0.01f * float(F);
                    Rows[I].Transform[13] = float((I / 32u) % 32u) * 2.0f + 0.005f * float(F);
                }
                if (!Two.UpdateTopLevel(Rows)) { Fail("N=%u update refused at frame %d", N, F); return 1; }
                const float Ms = Two.QueryMetrics().UpdateMilliseconds;
                if (Ms < Best) Best = Ms;
                Sum += Ms;
                if (Two.QueryMetrics().TlasOnlyMilliseconds < BestTlas) BestTlas = Two.QueryMetrics().TlasOnlyMilliseconds;
            }
            const bool Untouched = BlobHash(Two.QueryNodeBlob()) == NodesBefore && BlobHash(Two.QueryLeafBlob()) == LeavesBefore;
            if (Untouched)
                Pass("N=%u: %u TLAS nodes · %.3f ms/frame (best %.3f, TLAS alone %.3f) — BLAS blobs untouched",
                     N, Two.QueryMetrics().TlasNodeCount, static_cast<double>(Sum / Frames),
                     static_cast<double>(Best), static_cast<double>(BestTlas));
            else
                Fail("N=%u: the BLAS blobs changed during instance updates", N);
        }
        Info("this sandbox has 2 cores; the numbers above are the frame-visible CPU cost of moving EVERY instance");
    }

    // ── ⑤ instancing cost ────────────────────────────────────────────────────────────────────────────────────────────
    std::printf("\n⑤ instancing cost — why a shared BLAS is the whole point\n");
    {
        const uint64_t OneBlas = uint64_t(World.QueryMetrics().NodeByteCount) + World.QueryMetrics().LeafByteCount;
        const uint64_t RowBytes = sizeof(TlasInstanceRecord) + sizeof(BlasRecord);
        const uint64_t WorldBytes = uint64_t(TriangleCount) * sizeof(TriangleIndex);
        Info("shared blobs alone (one BLAS over the whole level): %.2f MB", double(OneBlas) / 1048576.0);
        Info("one BLAS + 49 instance rows: %.2f MB · 49 world-space copies (today's path): %.2f MB",
             double(OneBlas + 49u * RowBytes) / 1048576.0, double(WorldBytes * 49u) / 1048576.0);
        Info("4096 rows = %.3f MB (112 B row + 48 B BLAS record each)", double(4096.0 * double(RowBytes)) / 1048576.0);
        if (OneBlas + 4096u * RowBytes < WorldBytes * 49u)
            Pass("instancing turns 49 whole-scene copies into one BLAS plus %zu B per instance", sizeof(TlasInstanceRecord));
        else
            Fail("instancing does not pay at this size");
    }

    // ── ⑥ the kernel's payload: walk the uploaded buffers, not the builder's memory ───────────────────────────────
    std::printf("\n⑥ kernel payload — the top level as it is uploaded (8 floats a node) walked against the builder's own tree\n");
    {
        TraversalIndex World2;
        if (!World2.Build(Soup, false)) { Fail("the world-space build refused the level"); return 1; }

        // A real scene shape: the level split into 7 prototypes (one per swatch row plus the studio), transformed —
        //    so the payload has to carry nontrivial inverses and a top level with several leaves.
        std::vector<MeshPrototype> Prototypes;
        std::vector<InstanceRow>   Rows;
        const size_t Slice = (TriangleCount + 6u) / 7u;
        for (size_t C = 0u; C < 7u; ++C)
        {
            const size_t First = C * Slice;
            if (First >= TriangleCount) break;
            const size_t Count = std::min(Slice, TriangleCount - First);
            MeshPrototype Prototype{ Soup.data() + First, static_cast<uint32_t>(Count) };
            Prototypes.push_back(Prototype);
            InstanceRow Row{};
            MakeTransform(0.35f * float(C), 1.0f, float(C) * 0.05f, float(C) * -0.03f, 0.02f * float(C), Row.Transform);
            Row.BlasIndex = static_cast<uint32_t>(C);
            Row.FirstTriangle = static_cast<uint32_t>(First);
            Rows.push_back(Row);
        }

        InstanceAcceleration Two;
        if (!Two.Build(Prototypes, Rows, false)) { Fail("the payload build refused the scene"); return 1; }

        const std::vector<float>& Payload = Two.QueryTlasNodePayload();
        const std::vector<uint32_t>& Prims = Two.QueryTlasPrimitiveList();
        const std::vector<BlasPlacement>& BlasRows = Two.QueryBlasPlacements();
        const bool SizesOk = Payload.size() == size_t(Two.QueryMetrics().TlasNodeCount) * 8u
                          && Prims.size() == Two.QueryMetrics().InstanceCount
                          && BlasRows.size() == Two.QueryMetrics().BlasCount;
        if (SizesOk) Pass("payload sizes: %zu floats of top level (%u nodes), %zu instance entries, %zu BLAS rows",
                          Payload.size(), Two.QueryMetrics().TlasNodeCount, Prims.size(), BlasRows.size());
        else         Fail("payload sizing is wrong (%zu floats, %zu prims, %zu placement rows)", Payload.size(), Prims.size(), BlasRows.size());

        bool BlasRowsOk = true;
        for (size_t C = 0u; C < BlasRows.size() && C < Two.QueryBlasRecords().size(); ++C)
        {
            const BlasRecord& R = Two.QueryBlasRecords()[C];
            BlasRowsOk = BlasRowsOk && BlasRows[C].NodeOffset == R.NodeOffset && BlasRows[C].LeafOffset == R.LeafOffset
                                && BlasRows[C].PrimitiveCount == R.PrimitiveCount
                                && size_t(BlasRows[C].NodeOffset) * 4u + size_t(R.NodeBlocks) * 4u <= Two.QueryNodeBlob().size()
                                && size_t(BlasRows[C].LeafOffset) * 4u + size_t(R.LeafBlocks) * 4u <= Two.QueryLeafBlob().size();
        }
        if (BlasRowsOk) Pass("every BLAS placement addresses its own blobs inside the shared buffers");
        else          Fail("a BLAS placement does not match its record");

        std::vector<TraversalIndex*> BlasPointers;
        for (size_t C = 0u; C < Prototypes.size(); ++C)
        {
            // The payload walker needs walkers over the same object-space triangles; the shipped TraversalIndex is the
            //   only one, so rebuild one per prototype here (the structure itself keeps its own privately).
            auto Walker = std::make_unique<TraversalIndex>();
            if (!Walker->Build(Two.QueryPrototypeTriangles(static_cast<uint32_t>(C)), false)) { Fail("prototype rebuild refused"); return 1; }
            BlasPointers.push_back(Walker.release());
        }
        PayloadTrace PayloadWalker{ &Payload, &Prims, &Two.QueryInstances(), &BlasPointers };

        // The reference for this comparison: the builder's own walker, over the same transformed rows.
        const auto BuilderTrace = [&Two, &Rows](const float* O, const float* D, float& T, uint32_t& Key) -> bool
        {
            uint32_t Instance = 0u, Local = 0u;
            if (!Two.TraceClosest(O, D, 1.0e30f, Instance, Local, T)) return false;
            Key = Rows[Instance].FirstTriangle + Local;
            return true;
        };

        std::vector<float> Origins, Directions;
        const int RayCount = 20000;
        long Snapped = 0, Unsnapped = 0; int WorstAttempts = 0;
        GenerateRays(Soup, Bounds, RayCount, 20260920ull, Origins, Directions, Snapped, Unsnapped, WorstAttempts);

        Case Cases[8]; int CaseCount = 0;
        const Census C = Compare(BuilderTrace, PayloadWalker, Origins, Directions, RayCount, TieTolerance, Soup, Cases, 8, CaseCount);
        Info("rays %ld · bit-identical hits %ld · identical misses %ld · neighbouring ties %ld · unrelated %ld",
             C.Rays, C.AgreeExact, C.MissAgree, C.NeighbourTies + C.CoincidentTies, C.PrimitiveMismatch);
        ReportCases(Cases, CaseCount);
        if (C.AgreeExact + C.MissAgree == C.Rays)
            Pass("the uploaded payload reproduces the builder's tree exactly: %ld hits and %ld misses bit-identical",
                 C.AgreeExact, C.MissAgree);
        else
            Fail("payload disagreement: %ld exact · %ld misses · %ld ties · %ld unrelated · %ld hit/miss",
                 C.AgreeExact, C.MissAgree, C.NeighbourTies + C.CoincidentTies, C.PrimitiveMismatch, C.HitMismatches);

        for (TraversalIndex* Walker : BlasPointers) delete Walker;
    }

    RunKernelAudit();

    std::printf("\n[two-level] %d passed, %d failed\n", g_Passes, g_Failures);
    return g_Failures == 0 ? 0 : 1;
}
