//============================================================================================================================================
//                                                  MATERIALFURNACEPROOF.CPP
//============================================================================================================================================
// 🧩 M0 — the R4b math proofs re-seated in the verification wing: Engine/Shaders/MaterialEvaluation.slang compiled 1:1
//    as C++ (FRONTIER_CPU_PORT, see SlangCpuShim.h) against ShadingTableCodec-baked tables. White furnace (EON / GGX +
//    Kulla–Conty / fuzz / coat stack), reciprocity, and sampling consistency. Deterministic (splitmix64); MC tolerances
//    are %level, analytic ones tight.
//
//    Build (see CheckMaterialsProof.sh): g++ -std=c++20 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials
//        -I Engine/DisplayPresentation -I Engine/Shaders MaterialFurnaceProof.cpp
//        Engine/DisplayPresentation/ShadingTableCodec.cpp

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"

#include <cstdint>
#include <cstdio>

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

#include "MaterialEvaluation.slang"

namespace {

int g_Fail = 0;

#define CHECK(Cond, ...)                                                                                        \
    do { if (!(Cond)) { ++g_Fail; std::printf("  FAIL "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

uint64_t g_Rng = 0x9E3779B97F4A7C15ull;   // splitmix64 state (fixed seed → deterministic)

float Rand01()
{
    uint64_t z = (g_Rng += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    z = z ^ (z >> 31);
    return static_cast<float>((z >> 11) * (1.0 / 9007199254740992.0));
}

// Cosine-weighted hemisphere sample about +Z (pdf = cosθ/π).
vec3 CosineSample(float u1, float u2)
{
    float r = sqrt(u1), phi = 2.0f * 3.14159265358979f * u2;
    return vec3(r * cos(phi), r * sin(phi), sqrt(1.0f - u1));
}

vec3 UniformHemisphere(float u1, float u2)
{
    float z = u1, s = sqrt(1.0f - z * z), phi = 2.0f * 3.14159265358979f * u2;
    return vec3(s * cos(phi), s * sin(phi), z);
}

ShadingRecord StandardMaterial(vec3 albedo, float roughness)
{
    ShadingRecord m;
    m.BaseColor = albedo; m.Metalness = 0.0f; m.DiffuseRoughness = 0.0f;
    m.SpecularWeight = 1.0f; m.SpecularColor = vec3(1.0f); m.SpecularRoughness = roughness;
    m.SpecularAnisotropy = 0.0f; m.SpecularIor = 1.5f;
    m.ThinFilmWeight = 0.0f; m.ThinFilmThickness = 0.5f; m.ThinFilmIor = 1.4f;
    m.HazinessWeight = 0.0f; m.HazinessRoughness = 0.5f;
    m.CoatWeight = 0.0f; m.CoatColor = vec3(1.0f); m.CoatRoughness = 0.0f; m.CoatIor = 1.6f; m.CoatDarkening = 1.0f;
    m.FuzzWeight = 0.0f; m.FuzzColor = vec3(1.0f); m.FuzzRoughness = 0.5f;
    m.Emission = vec3(0.0f);
    return m;
}

// EON at roughness 0 is bit-exact Lambert (Cornell identity); EON albedo ≈ base colour elsewhere.
void ProofEon()
{
    std::printf("[furnace] EON diffuse\n");
    for (float mu : { 0.05f, 0.3f, 0.6f, 1.0f })
    {
        vec3 e = EonAlbedo(vec3(0.5f), 0.0f, mu);
        CHECK(std::fabs(e.x - 0.5f) < 1e-4f && std::fabs(e.y - 0.5f) < 1e-4f && std::fabs(e.z - 0.5f) < 1e-4f,
              "EON r=0 == Lambert at mu=%.2f (%.5f)", mu, e.x);
    }
    for (float r : { 0.5f, 1.0f })
    {
        for (float mu : { 0.25f, 0.6f, 1.0f })
        {
            vec3 wo = vec3(sqrt(1.0f - mu * mu), 0.0f, mu);
            vec3 acc = vec3(0.0f);
            const int N = 60000;
            for (int i = 0; i < N; ++i)
            {
                vec3 wi = CosineSample(Rand01(), Rand01());
                acc += EonEvaluate(vec3(0.5f), r, wi, wo);
            }
            acc = acc * (3.14159265358979f / static_cast<float>(N));   // ∫f·cosθ dω, cosine-weighted
            vec3 analytic = EonAlbedo(vec3(0.5f), r, mu);
            CHECK(std::fabs(acc.x - analytic.x) < 0.01f, "EON furnace r=%.1f mu=%.2f num=%.4f ana=%.4f", r, mu, acc.x, analytic.x);
            // EON's energy property is E ≤ ρ (never creates light) with the MS term recycling most of the FON loss —
            // it is NOT E == ρ (normal incidence, r=1, ρ=0.5 gives 0.439: the R4b plan's "± 0.5 %" claim was wrong and
            // is corrected here). Both bounds below are analytic facts, not fitted numbers.
            CHECK(acc.x <= 0.5f * 1.005f, "EON never exceeds rho r=%.1f mu=%.2f E=%.4f", r, mu, acc.x);
            CHECK(acc.x >= 0.5f * 0.85f, "EON MS floor r=%.1f mu=%.2f E=%.4f", r, mu, acc.x);
        }
    }
}

// Compensated GGX integrates to 1 for white F0; the table's split-sum matches numeric single-scatter.
void ProofGgxFurnace()
{
    std::printf("[furnace] GGX + Kulla–Conty (white F0)\n");
    const vec3 f0 = vec3(1.0f);
    for (float rough : { 0.15f, 0.55f, 1.0f })
    {
        vec2 a = AnisotropicAlpha(rough, 0.0f);
        for (float muO : { 0.1f, 0.5f, 1.0f })
        {
            vec3 wo = vec3(sqrt(1.0f - muO * muO), 0.0f, muO);
            // Single-scatter via VNDF (cosine sampling has ruinous variance once the lobe spikes at low roughness);
            // the multiple-scatter term is smooth, so plain cosine sampling is the right estimator for it.
            float ss = 0.0f;
            const int N = 120000;
            for (int i = 0; i < N; ++i)
            {
                vec3 h = SampleGgxVndf(wo, a, vec2(Rand01(), Rand01()));
                vec3 wi = reflect(-wo, h);
                if (wi.z <= 0.0f) continue;
                float pdf = GgxVndfPdf(wo, h, a) / (4.0f * max(dot(wo, h), 1e-4f));
                float d = GgxD(h, a) * GgxG2(wo, wi, a) / (4.0f * wo.z * wi.z);
                ss += d * wi.z / max(pdf, 1e-9f);
            }
            float Ess = ss / static_cast<float>(N);
            float ms = 0.0f;
            const int M = 60000;
            for (int i = 0; i < M; ++i)
            {
                vec3 wi = CosineSample(Rand01(), Rand01());
                ms += GgxMultiScatter(f0, wo.z, wi.z, a).x;
            }
            float Ems = ms * 3.14159265358979f / static_cast<float>(M);
            vec3 e = FetchEnergy(muO, rough * rough);
            CHECK(std::fabs(Ess - (e.x + e.y)) < 0.02f, "GGX ss r=%.2f mu=%.1f num=%.4f table=%.4f",
                  rough, muO, Ess, e.x + e.y);
            CHECK(std::fabs(Ess + Ems - 1.0f) < 0.02f, "GGX compensated r=%.2f mu=%.1f E=%.4f", rough, muO, Ess + Ems);
        }
    }
}

void ProofFuzzAndCoat()
{
    std::printf("[furnace] fuzz bound + coat stack\n");
    for (float a = 0.0f; a <= 1.0f; a += 0.1f)
        for (float mu = 0.02f; mu <= 1.0f; mu += 0.1f)
            CHECK(SheenAlbedo(a, mu) <= 1.001f, "sheen albedo ≤ 1 (a=%.1f mu=%.2f R=%.4f)", a, mu, SheenAlbedo(a, mu));

    ShadingRecord m = StandardMaterial(vec3(0.5f), 0.4f);
    m.CoatWeight = 0.5f; m.CoatRoughness = 0.1f; m.FuzzWeight = 0.3f;
    for (float muO : { 0.3f, 0.8f })
    {
        vec3 wo = vec3(sqrt(1.0f - muO * muO), 0.0f, muO);
        ResolvedLayers L = ResolveLayers(m, wo);
        vec3 acc = vec3(0.0f);
        const int N = 100000;
        for (int i = 0; i < N; ++i)
        {
            vec3 wi = CosineSample(Rand01(), Rand01());
            acc += EvaluateBsdf(m, L, wo, wi);
        }
        acc = acc * (3.14159265358979f / static_cast<float>(N));
        float peak = acc.x > acc.y ? (acc.x > acc.z ? acc.x : acc.z) : (acc.y > acc.z ? acc.y : acc.z);
        CHECK(peak <= 1.01f, "coat+fuzz+base stack albedo ≤ 1 (mu=%.1f E=%.4f)", muO, peak);
    }
}

void ProofReciprocity()
{
    std::printf("[furnace] reciprocity (EON / GGX / Kulla–Conty; coat stack excluded by design)\n");
    const int N = 5000;
    float worstEon = 0.0f, worstGgx = 0.0f, worstMs = 0.0f;
    vec2 a = AnisotropicAlpha(0.4f, 0.0f);
    for (int i = 0; i < N; ++i)
    {
        vec3 wi = UniformHemisphere(Rand01(), Rand01());
        vec3 wo = UniformHemisphere(Rand01(), Rand01());
        vec3 e1 = EonEvaluate(vec3(0.6f), 0.7f, wi, wo), e2 = EonEvaluate(vec3(0.6f), 0.7f, wo, wi);
        worstEon = max(worstEon, std::fabs(e1.x - e2.x) / max(e1.x, 1e-3f));
        vec3 h = normalize(wo + wi);
        float g1 = GgxD(h, a) * GgxG2(wo, wi, a) / (4.0f * wo.z * wi.z);
        float g2 = GgxD(h, a) * GgxG2(wi, wo, a) / (4.0f * wi.z * wo.z);
        worstGgx = max(worstGgx, std::fabs(g1 - g2) / max(g1, 1e-3f));
        vec3 ms1 = GgxMultiScatter(vec3(0.9f), wo.z, wi.z, a), ms2 = GgxMultiScatter(vec3(0.9f), wi.z, wo.z, a);
        worstMs = max(worstMs, std::fabs(ms1.x - ms2.x) / max(ms1.x, 1e-3f));
    }
    CHECK(worstEon < 1e-3f, "EON reciprocal (worst %.2e)", worstEon);
    CHECK(worstGgx < 1e-3f, "GGX single-scatter reciprocal (worst %.2e)", worstGgx);
    CHECK(worstMs < 1e-3f, "Kulla–Conty reciprocal (worst %.2e)", worstMs);
}

void ProofSampling()
{
    std::printf("[furnace] sampling consistency E[f·cosθ/pdf]\n");
    // VNDF vs the table single-scatter.
    {
        vec2 a = AnisotropicAlpha(0.35f, 0.0f);
        vec3 wo = normalize(vec3(0.3f, 0.2f, 0.9f));
        vec3 e = FetchEnergy(wo.z, 0.35f * 0.35f);
        float acc = 0.0f;
        const int N = 150000;
        for (int i = 0; i < N; ++i)
        {
            vec3 h = SampleGgxVndf(wo, a, vec2(Rand01(), Rand01()));
            vec3 wi = reflect(-wo, h);
            if (wi.z <= 0.0f) continue;
            float pdf = GgxVndfPdf(wo, h, a) / (4.0f * max(dot(wo, h), 1e-4f));
            float d = GgxD(h, a) * GgxG2(wo, wi, a) / (4.0f * wo.z * wi.z);
            acc += d * wi.z / max(pdf, 1e-9f);
        }
        acc /= static_cast<float>(N);
        CHECK(std::fabs(acc - (e.x + e.y)) / max(e.x + e.y, 1e-3f) < 0.03f,
              "VNDF E[f·cos/pdf]=%.4f table=%.4f", acc, e.x + e.y);
    }
    // CLTC vs the EON analytic albedo.
    {
        vec3 wo = normalize(vec3(0.4f, 0.1f, 0.9f));
        vec3 ana = EonAlbedo(vec3(0.5f), 0.6f, wo.z);
        float acc = 0.0f;
        const int N = 150000;
        for (int i = 0; i < N; ++i)
        {
            vec4 s = EonSampleCltc(wo, 0.6f, Rand01(), Rand01());
            vec3 wi = s.xyz;
            vec3 f = EonEvaluate(vec3(0.5f), 0.6f, wi, wo);
            acc += f.x * wi.z / max(s.w, 1e-9f);
        }
        acc /= static_cast<float>(N);
        CHECK(std::fabs(acc - ana.x) / ana.x < 0.03f, "CLTC E[f·cos/pdf]=%.4f ana=%.4f", acc, ana.x);
    }
    // Full mixture vs its own numeric furnace.
    {
        ShadingRecord m = StandardMaterial(vec3(0.5f), 0.4f);
        vec3 wo = normalize(vec3(0.3f, 0.25f, 0.9f));
        ResolvedLayers L = ResolveLayers(m, wo);
        float ref = 0.0f;
        const int N0 = 120000;
        for (int i = 0; i < N0; ++i)
        {
            vec3 wi = CosineSample(Rand01(), Rand01());
            ref += EvaluateBsdf(m, L, wo, wi).x;
        }
        ref *= 3.14159265358979f / static_cast<float>(N0);
        float acc = 0.0f;
        const int N = 150000;
        for (int i = 0; i < N; ++i)
        {
            vec4 s = SampleBsdf(m, L, wo, vec3(Rand01(), Rand01(), Rand01()));
            if (s.w <= 0.0f) continue;
            vec3 wi = s.xyz;
            acc += EvaluateBsdf(m, L, wo, wi).x * wi.z / s.w;
        }
        acc /= static_cast<float>(N);
        CHECK(std::fabs(acc - ref) / max(ref, 1e-3f) < 0.03f, "mixture E[f·cos/pdf]=%.4f furnace=%.4f", acc, ref);
    }
}

} // namespace

int main()
{
    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);   // production bakes 4096; 1024 proves the maths
    g_Tables = &Tables;
    std::printf("[furnace] tables baked (32×32, 1024 spp/cell)\n");
    ProofEon();
    ProofGgxFurnace();
    ProofFuzzAndCoat();
    ProofReciprocity();
    ProofSampling();
    std::printf(g_Fail == 0 ? "MATERIAL FURNACE: PASS\n" : "MATERIAL FURNACE: FAIL (%d)\n", g_Fail);
    return g_Fail == 0 ? 0 : 1;
}
