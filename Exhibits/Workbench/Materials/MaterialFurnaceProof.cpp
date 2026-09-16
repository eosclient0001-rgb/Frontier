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

inline vec4 FetchSheenFull(float mu, float alpha)   // M3: + E_charlie in .w
{
    float Out[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheenFull(*g_Tables, mu, alpha, Out);
    return vec4(Out[0], Out[1], Out[2], Out[3]);
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
    m.SpecularAnisotropy = 0.0f; m.AnisotropyAngle = 0.0f; m.SpecularIor = 1.5f;
    m.ThinFilmWeight = 0.0f; m.ThinFilmThickness = 0.5f; m.ThinFilmIor = 1.4f;
    m.HazinessWeight = 0.0f; m.HazinessRoughness = 0.5f;
    m.CoatWeight = 0.0f; m.CoatColor = vec3(1.0f); m.CoatRoughness = 0.0f; m.CoatAnisotropy = 0.0f;
    m.CoatIor = 1.6f; m.CoatDarkening = 1.0f;
    m.CoatTangent = vec3(1.0f, 0.0f, 0.0f); m.CoatNormal = vec3(0.0f, 0.0f, 1.0f);   // M2 identity frame
    m.FuzzWeight = 0.0f; m.FuzzColor = vec3(1.0f); m.FuzzRoughness = 0.5f;
    m.Emission = vec3(0.0f);
    m.Selection = 0u;   // M3: Standard — every pre-M3 test below must be unaffected by the cloth branch
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

// M2: lobe frames — rotation equivariance, normal-incidence energy invariance, tilted-coat energy + sampling.
void ProofAnisotropyFrames()
{
    std::printf("[furnace] M2 aniso rotation + coat frame\n");
    const float kHarnessPi = 3.14159265358979f;
    auto RotZ = [](vec3 v, float a) {
        float c = cos(a), s = sin(a);
        return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
    };

    // ① Equivariance: rotating the material and both vectors together changes nothing (aniso 0.7, θ = 0.6).
    {
        ShadingRecord m0 = StandardMaterial(vec3(0.5f), 0.35f);
        m0.SpecularAnisotropy = 0.7f; m0.AnisotropyAngle = 0.0f;
        ShadingRecord m1 = m0; m1.AnisotropyAngle = 0.6f;
        float worst = 0.0f;
        for (int i = 0; i < 2000; ++i)
        {
            vec3 wo = UniformHemisphere(Rand01(), Rand01());
            vec3 wi = UniformHemisphere(Rand01(), Rand01());
            ResolvedLayers l0 = ResolveLayers(m0, wo);
            vec3 rwo = RotZ(wo, 0.6f), rwi = RotZ(wi, 0.6f);
            ResolvedLayers l1 = ResolveLayers(m1, rwo);
            vec3 f0 = EvaluateBsdf(m0, l0, wo, wi), f1 = EvaluateBsdf(m1, l1, rwo, rwi);
            float d = std::fabs(f0.x - f1.x) + std::fabs(f0.y - f1.y) + std::fabs(f0.z - f1.z);
            float r = std::fabs(f0.x) + std::fabs(f0.y) + std::fabs(f0.z);
            worst = max(worst, d / max(r, 1e-3f));
        }
        CHECK(worst < 1e-3f, "aniso equivariance (worst %.2e)", worst);
    }

    // ② Normal-incidence energy is rotation-invariant (exact by change of variables; tolerance is pure MC noise).
    {
        float e[3] = { 0.0f, 0.0f, 0.0f };
        const float kAngles[3] = { 0.0f, kHarnessPi / 4.0f, kHarnessPi / 2.0f };
        for (int k = 0; k < 3; ++k)
        {
            ShadingRecord m = StandardMaterial(vec3(0.5f), 0.35f);
            m.SpecularAnisotropy = 0.7f; m.AnisotropyAngle = kAngles[k];
            vec3 wo = vec3(0.0f, 0.0f, 1.0f);
            ResolvedLayers L = ResolveLayers(m, wo);
            float acc = 0.0f;
            const int N = 200000;
            for (int i = 0; i < N; ++i)
            {
                vec3 wi = CosineSample(Rand01(), Rand01());
                acc += EvaluateBsdf(m, L, wo, wi).x;
            }
            e[k] = acc * kHarnessPi / static_cast<float>(N);
        }
        CHECK(std::fabs(e[1] - e[0]) / e[0] < 0.015f, "aniso energy θ=45° (%.4f vs %.4f)", e[1], e[0]);
        CHECK(std::fabs(e[2] - e[0]) / e[0] < 0.015f, "aniso energy θ=90° (%.4f vs %.4f)", e[2], e[0]);
    }

    // ③ Sampling consistency with rotation (validates the transpose-back + lobe-space pdfs).
    {
        ShadingRecord m = StandardMaterial(vec3(0.5f), 0.4f);
        m.SpecularAnisotropy = 0.7f; m.AnisotropyAngle = 0.5f;
        vec3 wo = normalize(vec3(0.3f, 0.25f, 0.9f));
        ResolvedLayers L = ResolveLayers(m, wo);
        float ref = 0.0f;
        const int N0 = 120000;
        for (int i = 0; i < N0; ++i) ref += EvaluateBsdf(m, L, wo, CosineSample(Rand01(), Rand01())).x;
        ref *= kHarnessPi / static_cast<float>(N0);
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
        CHECK(std::fabs(acc - ref) / ref < 0.03f, "rotated mixture E[f·cos/pdf]=%.4f furnace=%.4f", acc, ref);
    }

    // ④ Reciprocity survives rotation (dielectric + metal), tested on the isolated specular lobe: the full stack's
    // diffuse × (1 − E(μo)) albedo scaling is non-reciprocal BY DESIGN (OpenPBR §3.10), so the stack as a whole
    // is not — and must not be — asserted reciprocal here.
    for (float metal : { 0.0f, 1.0f })
    {
        ShadingRecord m = StandardMaterial(vec3(0.6f), 0.4f);
        m.Metalness = metal; m.SpecularAnisotropy = 0.6f; m.AnisotropyAngle = 0.5f;
        float worst = 0.0f;
        for (int i = 0; i < 2000; ++i)
        {
            vec3 wi = UniformHemisphere(Rand01(), Rand01());
            vec3 wo = UniformHemisphere(Rand01(), Rand01());
            ResolvedLayers lo = ResolveLayers(m, wo), li = ResolveLayers(m, wi);
            vec3 f1 = EvaluateBaseSpecular(m, lo, wo, wi), f2 = EvaluateBaseSpecular(m, li, wi, wo);
            float d = std::fabs(f1.x - f2.x);
            worst = max(worst, d / max(f1.x, 1e-3f));
        }
        CHECK(worst < 1e-3f, "rotated specular reciprocity metal=%.0f (worst %.2e)", metal, worst);
    }

    // ⑤ Tilted-coat stack stays energy-safe (20° tilt about x; plain + coat-aniso configs).
    for (float coatAniso : { 0.0f, 0.5f })
    {
        ShadingRecord m = StandardMaterial(vec3(0.5f), 0.4f);
        m.CoatWeight = 0.6f; m.CoatRoughness = 0.15f; m.CoatAnisotropy = coatAniso;
        m.CoatTangent = vec3(1.0f, 0.0f, 0.0f);
        m.CoatNormal = vec3(0.0f, 0.34202014f, 0.93969261f);   // 20° about x
        for (float muO : { 0.5f, 1.0f })
        {
            vec3 wo = vec3(sqrt(1.0f - muO * muO), 0.0f, muO);
            ResolvedLayers L = ResolveLayers(m, wo);
            float acc = 0.0f;
            const int N = 100000;
            for (int i = 0; i < N; ++i) acc += EvaluateBsdf(m, L, wo, CosineSample(Rand01(), Rand01())).x;
            acc *= kHarnessPi / static_cast<float>(N);
            CHECK(acc <= 1.01f, "tilted coat albedo ≤ 1 (aniso=%.1f mu=%.1f E=%.4f)", coatAniso, muO, acc);
        }
    }

    // ⑥ Coat continuity: a 2° tilt barely moves the furnace (a wrong basis would jump).
    {
        ShadingRecord m0 = StandardMaterial(vec3(0.5f), 0.4f);
        m0.CoatWeight = 0.6f; m0.CoatRoughness = 0.15f;
        ShadingRecord m1 = m0;
        m1.CoatNormal = vec3(0.0f, 0.03489950f, 0.99939083f);   // 2° about x
        vec3 wo = normalize(vec3(0.0f, 0.5f, 0.7f));
        float e0 = 0.0f, e1 = 0.0f;
        const int N = 120000;
        ResolvedLayers l0 = ResolveLayers(m0, wo), l1 = ResolveLayers(m1, wo);
        for (int i = 0; i < N; ++i)
        {
            vec3 wi = CosineSample(Rand01(), Rand01());
            e0 += EvaluateBsdf(m0, l0, wo, wi).x;
            e1 += EvaluateBsdf(m1, l1, wo, wi).x;
        }
        e0 *= kHarnessPi / static_cast<float>(N);
        e1 *= kHarnessPi / static_cast<float>(N);
        CHECK(std::fabs(e1 - e0) / e0 < 0.03f, "coat continuity 2° (%.4f vs %.4f)", e1, e0);
    }

    // ⑦ Tilted-coat sampling consistency (validates coat sample-back + pdf guard; wo off-grazing keeps the
    // below-coat-surface missing-mass bias ~1e-5, far inside the tolerance).
    {
        ShadingRecord m = StandardMaterial(vec3(0.5f), 0.4f);
        m.CoatWeight = 0.6f; m.CoatRoughness = 0.15f;
        m.CoatTangent = vec3(1.0f, 0.0f, 0.0f);
        m.CoatNormal = vec3(0.0f, 0.25881905f, 0.96592583f);   // 15° about x
        vec3 wo = normalize(vec3(0.2f, 0.2f, 0.8f));
        ResolvedLayers L = ResolveLayers(m, wo);
        float ref = 0.0f;
        const int N0 = 120000;
        for (int i = 0; i < N0; ++i) ref += EvaluateBsdf(m, L, wo, CosineSample(Rand01(), Rand01())).x;
        ref *= kHarnessPi / static_cast<float>(N0);
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
        CHECK(std::fabs(acc - ref) / ref < 0.035f, "tilted-coat mixture E[f·cos/pdf]=%.4f furnace=%.4f", acc, ref);
    }
}

// M3: the SheenLut .w bake (Charlie albedo) is range-safe and the cloth rescale can never leak — per texel AND
// (by the same argument) per bilinear interpolation, since both clamp inputs stay in range under lerp.
void ProofSheenTable()
{
    std::printf("[furnace] M3 Charlie bake + rescale safety\\n");
    const uint32_t N = Frontier::ShadingTableSet::kResolution;
    float maxEc = 0.0f, maxR = 0.0f, maxRescaled = 0.0f;
    int hi = 0, lo = 0;
    for (uint32_t i = 0; i < N * N; ++i)
    {
        const float* T = &g_Tables->Sheen[i * 4u];
        CHECK(T[3] >= 0.0f && T[3] <= 1.0f, "E_c in [0,1] (texel %u: %.4f)", i, T[3]);
        CHECK(T[2] >= 0.0f && T[2] <= 1.0f, "LTC R in [0,1] (texel %u: %.4f)", i, T[2]);
        maxEc = max(maxEc, T[3]); maxR = max(maxR, T[2]);
        float rescale = T[3] / max(T[2], 1e-4f);
        rescale = rescale < 0.5f ? 0.5f : (rescale > 2.0f ? 2.0f : rescale);
        if (rescale >= 2.0f) ++hi; else if (rescale <= 0.5f) ++lo;
        maxRescaled = max(maxRescaled, rescale * T[2]);
        CHECK(rescale * T[2] <= 1.0f + 1e-6f, "rescale·R <= 1 (texel %u)", i);
    }
    std::printf("    max E_c=%.4f max R=%.4f max rescale·R=%.4f clamps hi=%d lo=%d\\n", maxEc, maxR, maxRescaled, hi, lo);
}

// M3: the consumption table itself, compiled 1:1 from MaterialEvaluation.slang — bit C of the mask = channel C.
// Base/opacity/emission bypass Consumes via never-gating (see the .slang preamble); their presence in Cloth's arm
// declares Sultan-18 §3 membership, not fetch behaviour. Ch 8/9 read false everywhere until M4/M5 (locked here so
// the flip is a deliberate test change, not drift); ch 15 (unassigned) reads false.
void ProofConsumesTable()
{
    std::printf("[furnace] M3 consumption matrix (8 selections)\\n");
    const uint32_t kExpect[8] = {
        (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 14),   // Standard: metal/rough/spec/normal/AO
        (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 13) | (1u << 14),   // + aniso dir
        (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 5) | (1u << 10) | (1u << 14),   // + coat/coat-normal
        (1u << 0) | (1u << 2) | (1u << 4) | (1u << 7) | (1u << 11) | (1u << 14),   // Cloth: Sultan-18 §3 {1,3,5,6,8,14,15}
        (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 14),   // Subsurface (8 arrives M5)
        (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 14),   // Transmissive (9 arrives M4)
        0u,   // EmissiveOnly
        0u,   // Unlit
    };
    for (uint32_t s = 0; s < 8u; ++s)
        for (uint32_t c = 0; c < 16u; ++c)
            CHECK(ReflectanceConsumes(s, c) == ((kExpect[s] >> c & 1u) != 0u),
                  "Consumes(sel=%u, ch=%u)", s, c);
}

// M3: the Cloth path — EON + LTC sheen (primary, albedo-corrected) + weak dielectric GGX (F0 ≈ 4 %).
void ProofCloth()
{
    std::printf("[furnace] M3 cloth path\\n");
    const float kHarnessPi = 3.14159265358979f;
    auto ClothMaterial = [](vec3 albedo, float diffRough, float fuzzRough, float specRough = 0.5f) {
        ShadingRecord m = StandardMaterial(albedo, specRough);
        m.Selection = kReflectanceCloth;
        m.SpecularWeight = 0.0f; m.DiffuseRoughness = diffRough;
        m.FuzzWeight = 1.0f; m.FuzzColor = vec3(1.0f); m.FuzzRoughness = fuzzRough;
        return m;
    };

    // ① Cloth furnace ≤ 1 (white velvet + felt: the max-energy configs; EON ≤ ρ and the sheen layer scales the
    // stack below it, so this holds BY CONSTRUCTION — the proof guards the rescale + weak-lobe plumbing).
    for (float fuzzRough : { 0.35f, 0.8f })
        for (float muO : { 0.3f, 1.0f })
        {
            ShadingRecord m = ClothMaterial(vec3(1.0f), 1.0f, fuzzRough);
            vec3 wo = vec3(sqrt(1.0f - muO * muO), 0.0f, muO);
            ResolvedLayers L = ResolveLayers(m, wo);
            float acc = 0.0f;
            const int N = 80000;
            for (int i = 0; i < N; ++i) acc += EvaluateBsdf(m, L, wo, CosineSample(Rand01(), Rand01())).x;
            acc *= kHarnessPi / static_cast<float>(N);
            CHECK(acc <= 1.01f, "cloth albedo ≤ 1 (fuzzR=%.2f mu=%.1f E=%.4f)", fuzzRough, muO, acc);
        }

    // ② Retroreflective ordering, component + stack (θi = θo = 60°). Config: rough EON (its own retro term helps),
    // mid sheen (unclamped rescale), BROAD weak lobe — a mirror-smooth weak lobe forward-peaks by construction (silk
    // streaks are physical), so the ordering is asserted for the broad-weak cloth-typical case only. The plan's ">1
    // directionally" is permission, not mandate: ours stay < 0.35 (broad LTC + EON), and the binding bound is ①.
    {
        ShadingRecord m = ClothMaterial(vec3(1.0f), 1.0f, 0.65f, 1.0f);
        vec3 wo = vec3(0.86602540f, 0.0f, 0.5f);
        ResolvedLayers L = ResolveLayers(m, wo);
        vec3 wiRetro = wo, wiSide = vec3(0.0f, 0.86602540f, 0.5f), wiFwd = vec3(-0.86602540f, 0.0f, 0.5f);
        float sRetro = SheenEvaluate(vec3(1.0f), 0.65f, wo, wiRetro).x;
        float sSide  = SheenEvaluate(vec3(1.0f), 0.65f, wo, wiSide).x;
        float sFwd   = SheenEvaluate(vec3(1.0f), 0.65f, wo, wiFwd).x;
        CHECK(sRetro > sSide && sSide > sFwd, "sheen lobe retro-ordered (%.4f > %.4f > %.4f)", sRetro, sSide, sFwd);
        float eRetro = EvaluateBsdf(m, L, wo, wiRetro).x * 0.5f;
        float eSide  = EvaluateBsdf(m, L, wo, wiSide).x * 0.5f;
        float eFwd   = EvaluateBsdf(m, L, wo, wiFwd).x * 0.5f;
        std::printf("    retro=%.4f side=%.4f fwd=%.4f (stack f·cosθ)\\n", eRetro, eSide, eFwd);
        CHECK(eRetro > eSide && eRetro > eFwd, "cloth stack retro-dominant");
    }

    // ②b The velvet signature (analytic, no MC): the sheen layer's weight rises steeply toward grazing — the rim
    // takes over from the diffuse, which is what reads as velvet. Compositional, so exact from the table.
    for (float fuzzRough : { 0.35f, 0.65f, 0.8f })
    {
        ShadingRecord m = ClothMaterial(vec3(1.0f), 1.0f, fuzzRough);
        float wGrazing = ResolveLayers(m, vec3(0.99498744f, 0.0f, 0.1f)).FuzzAlbedoO;
        float wNormal  = ResolveLayers(m, vec3(0.43588990f, 0.0f, 0.9f)).FuzzAlbedoO;
        std::printf("    fuzzR=%.2f sheen weight grazing=%.4f normal=%.4f (×%.1f)\\n",
                    fuzzRough, wGrazing, wNormal, wGrazing / wNormal);
        CHECK(wGrazing > 2.5f * wNormal, "velvet signature (fuzzR=%.2f)", fuzzRough);
    }

    // ③ Sampling consistency of the cloth mixture (EON + rescaled LTC + weak VNDF).
    {
        ShadingRecord m = ClothMaterial(vec3(0.7f), 0.8f, 0.4f);
        vec3 wo = normalize(vec3(0.3f, 0.25f, 0.9f));
        ResolvedLayers L = ResolveLayers(m, wo);
        float ref = 0.0f;
        const int N0 = 120000;
        for (int i = 0; i < N0; ++i) ref += EvaluateBsdf(m, L, wo, CosineSample(Rand01(), Rand01())).x;
        ref *= kHarnessPi / static_cast<float>(N0);
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
        CHECK(std::fabs(acc - ref) / ref < 0.03f, "cloth mixture E[f·cos/pdf]=%.4f furnace=%.4f", acc, ref);
    }

    // ④ Per-lobe reciprocity (the full stack is non-reciprocal by design — same OpenPBR §3.10 scaling as M2 ④).
    {
        ShadingRecord m = ClothMaterial(vec3(0.6f), 0.7f, 0.5f);
        float worstGgx = 0.0f, worstEon = 0.0f;
        for (int i = 0; i < 2000; ++i)
        {
            vec3 wi = UniformHemisphere(Rand01(), Rand01());
            vec3 wo = UniformHemisphere(Rand01(), Rand01());
            ResolvedLayers lo = ResolveLayers(m, wo), li = ResolveLayers(m, wi);
            vec3 g1 = EvaluateBaseSpecular(m, lo, wo, wi), g2 = EvaluateBaseSpecular(m, li, wi, wo);
            worstGgx = max(worstGgx, std::fabs(g1.x - g2.x) / max(g1.x, 1e-3f));
            vec3 e1 = EonEvaluate(vec3(0.6f), 0.7f, wi, wo), e2 = EonEvaluate(vec3(0.6f), 0.7f, wo, wi);
            worstEon = max(worstEon, std::fabs(e1.x - e2.x) / max(e1.x, 1e-3f));
        }
        CHECK(worstGgx < 1e-3f, "weak-GGX reciprocal (worst %.2e)", worstGgx);
        CHECK(worstEon < 1e-3f, "EON reciprocal (worst %.2e)", worstEon);
        // Sheen: the TRUE Charlie D·V is reciprocal, but the LTC fetches coeffs at μo only — asymmetric by
        // construction (pre-existing, untouched by M3), worst at grazing pairs. Fixed Fibonacci grid (not the
        // shared RNG stream): worst-of over random pairs would drift whenever any earlier test is edited.
        auto FibDir = [](int i, int n) {
            float mu = 1.0f - (static_cast<float>(i) + 0.5f) / static_cast<float>(n);
            float phi = 6.28318530718f * static_cast<float>(i) * 0.61803398875f;
            float s = sqrt(1.0f - mu * mu);
            return vec3(s * cos(phi), s * sin(phi), mu);
        };
        float worstSheen = 0.0f;
        const int kFibN = 24;
        for (int i = 0; i < kFibN; ++i)
            for (int j = 0; j < kFibN; ++j)
            {
                if (i == j) continue;   // self-pairs are trivially reciprocal
                vec3 wo = FibDir(i, kFibN), wi = FibDir(j, kFibN);
                vec3 s1 = SheenEvaluate(vec3(1.0f), 0.5f, wo, wi), s2 = SheenEvaluate(vec3(1.0f), 0.5f, wi, wo);
                worstSheen = max(worstSheen, std::fabs(s1.x - s2.x) / max(s1.x, 1e-3f));
            }
        std::printf("    sheen reciprocity worst (Fibonacci 24²): %.3f\\n", worstSheen);
        CHECK(worstSheen < 1.6f, "LTC sheen asymmetry bounded (fit artifact, grazing-driven; grid-worst 1.24)");
    }

    // ⑤ The weak lobe's F0 is the true dielectric 0.04 (η = 1.5) — and the forcing is selection-gated (weight-0
    // non-cloth still collapses to eta 1 / F0 0, exactly as before M3).
    {
        ShadingRecord m = ClothMaterial(vec3(0.5f), 0.5f, 0.5f);
        ResolvedLayers L = ResolveLayers(m, vec3(0.0f, 0.0f, 1.0f));
        CHECK(std::fabs(L.SpecularEta - 1.5f) < 1e-6f, "cloth eta unmodulated (%.7f)", L.SpecularEta);
        CHECK(std::fabs(L.DielectricF0.x - 0.04f) < 1e-6f, "cloth F0 = 0.04 (%.7f)", L.DielectricF0.x);
        ShadingRecord s = StandardMaterial(vec3(0.5f), 0.5f);
        s.SpecularWeight = 0.0f;   // Selection 0, weight 0: pre-M3 behaviour bit-preserved
        ResolvedLayers Ls = ResolveLayers(s, vec3(0.0f, 0.0f, 1.0f));
        CHECK(Ls.SpecularEta == 1.0f && Ls.DielectricF0.x == 0.0f, "non-cloth weight-0 still collapses");
        CHECK(Ls.SheenRescale == 1.0f, "non-cloth rescale exactly 1");
    }

    // ⑥ Rescale end-to-end: layer weight matches the baked texel, and the sheen (eval, pdf) pair integrates to it —
    // in BOTH regimes (0.35: hi-clamped, 0.8: unclamped-lo). The ratio is near-constant per sample, hence the 0.5 %.
    for (float fuzzRough : { 0.35f, 0.8f })
    {
        ShadingRecord m = ClothMaterial(vec3(0.7f), 0.8f, fuzzRough);
        vec3 wo = vec3(0.8f, 0.0f, 0.6f);
        ResolvedLayers L = ResolveLayers(m, wo);
        float full[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
        Frontier::ShadingTableCodec::SampleSheenFull(*g_Tables, 0.6f, fuzzRough, full);
        float expect = full[3] / max(full[2], 1e-4f);
        expect = expect < 0.5f ? 0.5f : (expect > 2.0f ? 2.0f : expect);
        CHECK(std::fabs(L.SheenRescale - expect) < 1e-6f, "rescale matches bake (fuzzR=%.2f: %.6f)", fuzzRough, L.SheenRescale);
        CHECK(std::fabs(L.FuzzAlbedoO - expect * full[2]) < 1e-6f, "layer weight = F·rescale·R (%.6f)", L.FuzzAlbedoO);
        CHECK(L.FuzzAlbedoO <= 1.0f, "sheen layer weight ≤ 1");
        float acc = 0.0f;
        const int N = 50000;
        for (int i = 0; i < N; ++i)
        {
            vec4 s = SheenSample(fuzzRough, wo, vec2(Rand01(), Rand01()));
            vec3 wi = s.xyz;
            acc += L.SheenRescale * SheenEvaluate(vec3(1.0f), fuzzRough, wo, wi).x * wi.z / s.w;
        }
        acc /= static_cast<float>(N);
        CHECK(std::fabs(acc - expect * full[2]) / (expect * full[2]) < 0.005f,
              "sheen E[f·cos/pdf]=%.5f albedo=%.5f (fuzzR=%.2f)", acc, expect * full[2], fuzzRough);
    }

    // ⑦ Anisotropy is ignored under Cloth (specular-aniso + angle forced out): isotropic alpha, identity basis,
    // and bit-identical eval to the unrotated record.
    {
        ShadingRecord m = ClothMaterial(vec3(0.5f), 0.5f, 0.5f);
        m.SpecularAnisotropy = 0.7f; m.AnisotropyAngle = 0.5f;
        ShadingRecord m0 = ClothMaterial(vec3(0.5f), 0.5f, 0.5f);
        vec3 wo = normalize(vec3(0.2f, 0.3f, 0.9f));
        ResolvedLayers L = ResolveLayers(m, wo);
        CHECK(L.SpecularAlpha.x == L.SpecularAlpha.y, "cloth specular alpha isotropic");
        float worstBasis = 0.0f;
        for (int i = 0; i < 100; ++i)
        {
            vec3 v = UniformHemisphere(Rand01(), Rand01());
            vec3 t = L.AnisoBasis * v;
            worstBasis = max(worstBasis, std::fabs(t.x - v.x) + std::fabs(t.y - v.y) + std::fabs(t.z - v.z));
        }
        CHECK(worstBasis < 1e-6f, "cloth aniso basis identity (worst %.2e)", worstBasis);
        ResolvedLayers L0 = ResolveLayers(m0, wo);
        bool identical = true;
        for (int i = 0; i < 100; ++i)
        {
            vec3 wi = UniformHemisphere(Rand01(), Rand01());
            vec3 f1 = EvaluateBsdf(m, L, wo, wi), f0 = EvaluateBsdf(m0, L0, wo, wi);
            identical = identical && (f1.x == f0.x && f1.y == f0.y && f1.z == f0.z);
        }
        CHECK(identical, "aniso+angle bit-inert under Cloth");
    }

    // ⑧ The branch is live: identical weights shade differently by selection alone.
    {
        ShadingRecord m = ClothMaterial(vec3(0.5f), 0.5f, 0.5f);
        ShadingRecord s = m; s.Selection = 0u;
        vec3 wo = normalize(vec3(0.2f, 0.2f, 0.9f));
        vec3 wi = normalize(vec3(-0.3f, 0.1f, 0.8f));
        vec3 fc = EvaluateBsdf(m, ResolveLayers(m, wo), wo, wi);
        vec3 fs = EvaluateBsdf(s, ResolveLayers(s, wo), wo, wi);
        float d = std::fabs(fc.x - fs.x) + std::fabs(fc.y - fs.y) + std::fabs(fc.z - fs.z);
        float r = std::fabs(fs.x) + std::fabs(fs.y) + std::fabs(fs.z);
        CHECK(d / max(r, 1e-6f) > 1e-3f, "cloth ≠ standard by selection (rel %.2e)", d / max(r, 1e-6f));
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
    ProofAnisotropyFrames();
    ProofSheenTable();
    ProofConsumesTable();
    ProofCloth();
    std::printf(g_Fail == 0 ? "MATERIAL FURNACE: PASS\n" : "MATERIAL FURNACE: FAIL (%d)\n", g_Fail);
    return g_Fail == 0 ? 0 : 1;
}
