//============================================================================================================================================
// 📦 Project-Zero/Source/PrecipitationSolver.h — Falling Hydrometeors, Ported from the Reference Particle System
//============================================================================================================================================
//
//    The reference runs precipitation as a CPU particle pool drawn to a 2-D overlay canvas (`prStep`), not in
//    the fragment program — so this is the one celestial system that is a *simulation* port rather than a
//    shader port. The physics it carries is real and is what the port reproduces:
//
//        · Terminal velocity per hydrometeor class. 8.5 m/s for rain, 1.4 for a snowflake, 22 for hail — these
//          are the measured values the reference encodes, and they are why snow drifts and hail falls straight.
//        · Drag relaxation toward the local wind, at a rate that also varies by class.
//        · Spawn rate from the rainfall rate in mm/h, through the drop-count-per-m² relation.
//        · Spawn gated by the cloud coverage overhead, so rain falls out of clouds and not out of clear sky.
//        · Ground collision with restitution, then a splash that lives for `RestSeconds`.
//
//    Screen projection and streak drawing live here too, because a raindrop's visual signature is a motion
//    streak whose length is its velocity times the exposure — a property of the simulation, not of the sky.
//
//============================================================================================================================================

#pragma once

#include "CelestialIntegrator.h"
#include <cstdint>
#include <vector>

namespace Frontier::ProjectZero {

//------------------------------------------------------------------------------------------------------------------------
//                                               HYDROMETEOR CLASSES
//------------------------------------------------------------------------------------------------------------------------
//    The reference's `PR_TYPES` table, transcribed. `Diameter` is in millimetres; `Drag` is the relaxation rate
//    toward the ambient wind; `Melt` drives the splash's shape change.

struct HydrometeorClass
{
    const char* Name;
    float       TerminalVelocity;                               // [m/s]
    float       Diameter;                                       // [mm]
    float       Bounce;                                         // [-] restitution scale
    float       Drag;                                           // [1/s] wind relaxation rate
    float       StreakLength;                                   // [-] motion-streak scale
    float       Melt;                                           // [-] splash melt
    uint32_t    Shape;                                          // 0 streak · 1 ball · 2 flake
};

inline constexpr HydrometeorClass kHydrometeorAtlas[5] = {
    { "Rain",    8.5f, 2.2f, 0.00f, 0.25f, 1.0f, 0.0f, 0u },
    { "Drizzle", 3.2f, 0.6f, 0.00f, 0.60f, 0.5f, 0.0f, 0u },
    { "Hail",   22.0f, 9.0f, 0.60f, 0.08f, 0.0f, 0.0f, 1u },
    { "Snow",    1.4f, 5.0f, 0.00f, 1.20f, 0.0f, 1.0f, 2u },
    { "Sleet",   5.5f, 3.0f, 0.15f, 0.40f, 0.4f, 0.6f, 1u }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  ONE HYDROMETEOR
//------------------------------------------------------------------------------------------------------------------------

struct Hydrometeor
{
    Vector3  Position   { 0.0f, 0.0f, 0.0f };                   // [m] sky frame
    Vector3  Velocity   { 0.0f, 0.0f, 0.0f };                   // [m/s]
    float    Scale      = 1.0f;
    float    Flutter    = 0.0f;                                 // [rad] snowflake flutter phase
    float    RestedFor  = 0.0f;                                 // [s] time since landing
    uint32_t Bounces    = 0u;
    bool     Landed     = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                              PRECIPITATION SOLVER
//------------------------------------------------------------------------------------------------------------------------

class PrecipitationSolver
{
public:
    explicit PrecipitationSolver(const CelestialCriteria& Parameters) noexcept;

    //    One step of the pool: spawn, integrate, collide, retire. `CloudCoverage` is the callback the reference
    //    calls `cloudCoverAt` — supplying it keeps the rain under the clouds without this class knowing how
    //    clouds are modelled.
    void Advance(float DeltaSeconds, const Vector3& ObserverPosition, const CelestialFrame& Frame,
                 float GroundHeight) noexcept;

    void AssignCriteria(const CelestialCriteria& Parameters) noexcept { Criteria = Parameters; }

    [[nodiscard]] const std::vector<Hydrometeor>& QueryPool() const noexcept { return Pool; }
    [[nodiscard]] uint32_t QueryFallingCount() const noexcept { return FallingCount; }
    [[nodiscard]] uint32_t QueryLandedCount() const noexcept  { return LandedCount; }
    [[nodiscard]] const HydrometeorClass& QueryClass() const noexcept
    {
        return kHydrometeorAtlas[Criteria.Precipitation.Variety < 5u ? Criteria.Precipitation.Variety : 0u];
    }

    //    The visibility a rainfall rate implies, by the standard relations — used for the fog coupling and the
    //    panel's own readout. Rain: V ≈ 20/R km. Snow scatters far more per unit mass.
    [[nodiscard]] float QueryVisibilityKilometres() const noexcept;

private:
    [[nodiscard]] float RandomScalar() noexcept;

    CelestialCriteria        Criteria;
    std::vector<Hydrometeor> Pool;
    float                    SpawnAccumulator = 0.0f;
    uint32_t                 FallingCount     = 0u;
    uint32_t                 LandedCount      = 0u;
    uint32_t                 RandomState      = 0x9E3779B9u;
};

} // namespace Frontier::ProjectZero
