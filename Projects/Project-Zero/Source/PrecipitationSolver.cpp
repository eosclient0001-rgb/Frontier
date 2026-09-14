//============================================================================================================================================
// 📦 Project-Zero/Source/PrecipitationSolver.cpp — Hydrometeor Pool Implementation
//============================================================================================================================================

#include "PrecipitationSolver.h"

namespace Frontier::ProjectZero {

namespace {

//    The reference's cloud-coverage sampler, `cloudCoverAt` — the 2-D mirror of the volumetric cloud's base
//    shape, deliberately a little wider than the render threshold so the whole footprint rains while the core
//    rains hardest.
float Fraction(float v) noexcept { return v - std::floor(v); }

float Hash3(float x, float y, float z) noexcept
{
    float px = Fraction(x * 0.1031f), py = Fraction(y * 0.1031f), pz = Fraction(z * 0.1031f);
    const float d = px * (pz + 31.32f) + py * (py + 31.32f) + pz * (px + 31.32f);
    px += d; py += d; pz += d;
    return Fraction((px + py) * pz);
}

float ValueNoise3(float x, float y, float z) noexcept
{
    const float ix = std::floor(x), iy = std::floor(y), iz = std::floor(z);
    float fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3.0f - 2.0f * fx);
    fy = fy * fy * (3.0f - 2.0f * fy);
    fz = fz * fz * (3.0f - 2.0f * fz);
    auto C = [&](float a, float b, float c) { return Hash3(ix + a, iy + b, iz + c); };
    auto L = [](float a, float b, float t) { return a + (b - a) * t; };
    return L(L(L(C(0,0,0), C(1,0,0), fx), L(C(0,1,0), C(1,1,0), fx), fy),
             L(L(C(0,0,1), C(1,0,1), fx), L(C(0,1,1), C(1,1,1), fx), fy), fz);
}

} // namespace

PrecipitationSolver::PrecipitationSolver(const CelestialCriteria& Parameters) noexcept
    : Criteria(Parameters)
{
    Pool.reserve(4096u);
}

float PrecipitationSolver::RandomScalar() noexcept
{
    //    xorshift32 — deterministic, so a proof frame is reproducible run to run.
    RandomState ^= RandomState << 13;
    RandomState ^= RandomState >> 17;
    RandomState ^= RandomState << 5;
    return static_cast<float>(RandomState & 0x00FFFFFFu) / static_cast<float>(0x01000000u);
}

float PrecipitationSolver::QueryVisibilityKilometres() const noexcept
{
    const float Rate = std::max(Criteria.Precipitation.RateMillimetres, 0.01f);
    if (Criteria.Precipitation.Variety == 3u)                   // snow
    {
        return std::max(0.2f, 1.2f / std::max(0.05f, Rate / 10.0f));
    }
    return std::max(0.3f, 20.0f / Rate);
}

void PrecipitationSolver::Advance(float DeltaSeconds, const Vector3& ObserverPosition, const CelestialFrame& Frame,
                                  float GroundHeight) noexcept
{
    const PrecipitationCriteria& P = Criteria.Precipitation;
    const VolumetricCloudCriteria& C = Criteria.VolumetricCloud;

    const bool Active = P.Visible && C.Visible && P.RateMillimetres > 0.0f;
    if (!Active)
    {
        Pool.clear();
        FallingCount = 0u;
        LandedCount  = 0u;
        return;
    }

    const HydrometeorClass& Class = QueryClass();
    constexpr float SpawnRadius = 45.0f;                        // [m] the reference's own spawn radius

    //    Nothing falls above the cloud that makes it.
    const float Ceiling = P.FromClouds ? C.BaseAltitude + C.Thickness * 0.5f : std::min(C.BaseAltitude, 3000.0f);
    const float AltitudeFade = 1.0f - std::min(1.0f, std::max(0.0f, (ObserverPosition.y - (Ceiling - 150.0f)) / 150.0f));
    if (AltitudeFade <= 0.0f)
    {
        Pool.clear();
        FallingCount = 0u;
        LandedCount  = 0u;
        return;
    }

    //    Drops per m² per second from the rate in mm/h — the reference's own coefficients, which encode the
    //    drop-size distribution of each class.
    const float PerSquareMetre = (P.Variety == 3u) ? P.RateMillimetres * 0.9f
                               : (P.Variety == 1u) ? P.RateMillimetres * 2.2f
                               :                     P.RateMillimetres * 0.55f;
    const float Area = kPi * SpawnRadius * SpawnRadius;
    const float Budget = static_cast<float>(P.Budget);
    const float SpawnRate = std::min(Budget * 1.5f, PerSquareMetre * Area * P.DensityScale) * AltitudeFade;
    SpawnAccumulator += SpawnRate * DeltaSeconds;

    //    The ambient wind the drops relax toward.
    float WindX = std::sin(PanelRadians(C.DriftDegrees)) * C.DriftSpeed * P.WindCoupling;
    float WindZ = std::cos(PanelRadians(C.DriftDegrees)) * C.DriftSpeed * P.WindCoupling;
    if (Criteria.Wind.DrivesPrecipitation && Criteria.Wind.Visible)
    {
        const float Bearing = PanelRadians(Criteria.Wind.BearingDegrees);
        const float Gust = 1.0f + Criteria.Wind.Gust * 0.55f * std::sin(Frame.WindGustPhase);
        WindX = std::sin(Bearing) * Criteria.Wind.Speed * Gust * P.WindCoupling * 2.0f;
        WindZ = std::cos(Bearing) * Criteria.Wind.Speed * Gust * P.WindCoupling * 2.0f;
    }

    const float Top = std::min(Ceiling, P.FromClouds
                             ? std::min(ObserverPosition.y + 400.0f, std::max(ObserverPosition.y + 30.0f, C.BaseAltitude))
                             : ObserverPosition.y + 60.0f);
    const float Floor = std::max(GroundHeight, ObserverPosition.y - 40.0f);

    //    Spawn. The cloud-coverage gate is what keeps the rain under the clouds.
    const size_t BudgetCount = static_cast<size_t>(P.Budget);
    while (SpawnAccumulator >= 1.0f && Pool.size() < BudgetCount)
    {
        SpawnAccumulator -= 1.0f;
        const float r = std::sqrt(RandomScalar()) * SpawnRadius;
        const float a = RandomScalar() * 2.0f * kPi;
        const float px = ObserverPosition.x + std::cos(a) * r;
        const float pz = ObserverPosition.z + std::sin(a) * r;

        if (P.FromClouds)
        {
            //    cloudCoverAt: the same 4-octave value noise the volumetric layer uses for its base shape.
            const float sc = 1.0f / (C.NoiseScale * 900.0f);
            const float wd = PanelRadians(C.DriftDegrees);
            const float w  = C.DriftSpeed * Frame.TimeSeconds * 0.8f;
            const float qx = px + std::sin(wd) * w;
            const float qz = pz + std::cos(wd) * w;
            const float sx = qx * sc, sy = (C.BaseAltitude + C.Thickness * 0.25f) * sc, sz = qz * sc;
            float n = ValueNoise3(sx, sy, sz) * 0.5f
                    + ValueNoise3(sx * 2.02f + 3.1f, sy * 2.02f + 1.7f, sz * 2.02f + 9.2f) * 0.25f
                    + ValueNoise3(sx * 4.1f + 7.7f, sy * 4.1f + 2.2f, sz * 4.1f + 1.1f) * 0.125f
                    + ValueNoise3(sx * 8.3f + 1.3f, sy * 8.3f + 8.8f, sz * 8.3f + 4.4f) * 0.0625f;
            n /= 0.9375f;
            const float Threshold = 1.0f - C.Coverage;
            const float Cover = Clamp01((n - (Threshold - 0.12f)) / std::max(1e-3f, C.Coverage + 0.12f));
            if (Cover < 0.04f || RandomScalar() > std::min(1.0f, 0.25f + Cover * 1.2f))
            {
                continue;
            }
        }

        Hydrometeor Drop{};
        Drop.Position = Vector3{ px, Floor + std::pow(RandomScalar(), 0.8f) * (Top - Floor), pz };
        Drop.Velocity = Vector3{ WindX * (0.6f + RandomScalar() * 0.6f),
                                 -Class.TerminalVelocity * (0.85f + RandomScalar() * 0.3f),
                                 WindZ * (0.6f + RandomScalar() * 0.6f) };
        Drop.Scale   = (0.7f + RandomScalar() * 0.6f) * P.SizeScale;
        Drop.Flutter = RandomScalar() * 6.28f;
        Pool.push_back(Drop);
    }
    if (SpawnAccumulator > 3.0f)
    {
        SpawnAccumulator = 3.0f;
    }

    //    Integrate. Drag relaxes each drop toward terminal velocity and the ambient wind; flakes flutter.
    FallingCount = 0u;
    LandedCount  = 0u;
    const float Restitution = P.Restitution * Class.Bounce;

    for (size_t i = Pool.size(); i-- > 0;)
    {
        Hydrometeor& Drop = Pool[i];

        if (!Drop.Landed)
        {
            Drop.Velocity.y += (-Class.TerminalVelocity - Drop.Velocity.y) * std::min(1.0f, DeltaSeconds * 2.5f);
            Drop.Velocity.x += (WindX - Drop.Velocity.x) * std::min(1.0f, DeltaSeconds * Class.Drag);
            Drop.Velocity.z += (WindZ - Drop.Velocity.z) * std::min(1.0f, DeltaSeconds * Class.Drag);

            if (Class.Shape == 2u)                              // a flake does not fall, it tumbles
            {
                Drop.Flutter += DeltaSeconds * 2.2f;
                Drop.Velocity.x += std::sin(Drop.Flutter) * DeltaSeconds * 1.4f;
                Drop.Velocity.z += std::cos(Drop.Flutter * 0.7f) * DeltaSeconds * 1.2f;
            }

            Drop.Position += Drop.Velocity * DeltaSeconds;

            const float Ground = P.Collide ? GroundHeight : -1e9f;
            if (Drop.Position.y <= Ground)
            {
                Drop.Position.y = Ground;
                if (Restitution > 0.05f && std::abs(Drop.Velocity.y) > 1.5f && Drop.Bounces < 3u)
                {
                    Drop.Velocity.y = -Drop.Velocity.y * Restitution;
                    Drop.Velocity.x *= 0.8f;
                    Drop.Velocity.z *= 0.8f;
                    ++Drop.Bounces;
                    Drop.Position.y += 0.01f;
                }
                else
                {
                    Drop.Landed = true;
                    Drop.RestedFor = 0.0f;
                    Drop.Velocity = Vector3{ 0.0f, 0.0f, 0.0f };
                }
            }
            else
            {
                const float dx = Drop.Position.x - ObserverPosition.x;
                const float dz = Drop.Position.z - ObserverPosition.z;
                if (Drop.Position.y < ObserverPosition.y - 60.0f
                    || std::sqrt(dx * dx + dz * dz) > SpawnRadius * 2.2f)
                {
                    Pool[i] = Pool.back();
                    Pool.pop_back();
                    continue;
                }
            }
            ++FallingCount;
        }
        else
        {
            Drop.RestedFor += DeltaSeconds;
            ++LandedCount;
            if (Drop.RestedFor > P.RestSeconds)
            {
                Pool[i] = Pool.back();
                Pool.pop_back();
                continue;
            }
        }
    }
}

} // namespace Frontier::ProjectZero
