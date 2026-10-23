//============================================================================================================================================
//                                                               TYREMODEL.H
//============================================================================================================================================
// 📦 One tyre contract, three interchangeable physics backends.
//
// The vehicle stack used to hard-wire its tyre into `VehicleSolver`: the trace-fan rigid wheel and the XPBD carcass were
// compiled in turn, and the volumetric tyre never existed natively at all. This header is the seam. A `TyreModel` owns
// the deformation state of one tyre and answers exactly one question per fixed step:
//
//      "given a kinematic hub pose and velocity, what force and moment does the road put back into the hub?"
//
// Everything above the seam (drivetrain, suspension strut, thermal state, chassis, Jolt) is unchanged, and everything
// below it is replaceable. That is what makes the three models usable with any component: the chassis cannot tell which
// one it is holding, and a new backend costs one class, not a solver edit.
//
//    TyreModelKind::RigidTraceFan        — point-contact rigid wheel; load from the trace-fan sample fan, in-plane forces
//                                          from Pacejka MF6.1. The Jolt-side backend: cheap, the current production
//                                          behaviour of `VehicleSolver`, and the baseline the deformable models are
//                                          calibrated against.
//    TyreModelKind::XpbdSpringCarcass    — configurable XPBD carcass: a compliant lattice (spokes, hoop, lateral, shear,
//                                          gas, rim bottoming) solved by position projection. Recovers the source that
//                                          commit `9ceb33c` deleted; see Docs/VehiclePort/RecoveryMap.md.
//    TyreModelKind::VolumetricFem        — 3D FEM: a revolved tetrahedral solid with Green-strain first-Piola forces and a
//                                          volumetric pressure term, integrated explicitly. Native port of the WebGPU
//                                          volumetric tyre reference (`Experimental/TyreVolumetricDemo/src/tyreCore.js`).
//
// Frame conventions are the vehicle layer's: right-handed, +Z up, chassis-local +X forward, +Y left, wheel axle +Y,
// positive spin rolls the tyre toward +X. Every backend works in world space against the same `GroundQuery` the rest of
// the simulation uses, so a kerb, a heightfield and a mesh collider are all the same thing to a tyre.
//
// Units are SI throughout: metres, kilograms, seconds, newtons, pascals, radians.

#pragma once

#include "../Vehicle/RigidWheel.h"
#include "../Vehicle/TraceContactTyre.h"
#include "../Vehicle/PacejkaMagicFormula.h"
#include "Xpbd/XPBDSoftTyre.h"

#include <cstdint>
#include <memory>
#include <vector>

namespace Frontier::Vehicle {

//------------------------------------------------------------------------------------------------------------------------
//                                                  SELECTION
//------------------------------------------------------------------------------------------------------------------------
enum class TyreModelKind : std::uint8_t
{
    RigidTraceFan,       // [-] rigid point contact + Pacejka (Jolt-side production path)
    XpbdSpringCarcass,   // [-] deformable XPBD lattice (recovered 2026-10-13 source)
    VolumetricFem,       // [-] revolved tetrahedral FEM with volumetric pressure
};

[[nodiscard]] const char* TyreModelName(TyreModelKind Kind) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                              SHARED CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------
// One configuration record for every backend: a caller sets `Kind`, fills the geometry once, and only touches the
// sub-record of the backend it selected. Unused sub-records are inert, so a scene file can carry all three and switch.
struct FemTyreParameters;   // Fem/FemTyreModel.h

struct TyreModelConfiguration
{
    TyreModelKind Model = TyreModelKind::RigidTraceFan;

    // Geometry, mass and inflation. Shared by every backend, so switching models never changes the wheel the car has.
    TyreSpecification Tyre{};

    // Rigid backend: the sample fan and the Magic-Formula coefficients.
    TraceContactParameters TraceFan{};
    PacejkaParameters      Slip{};

    // XPBD backend: every constitutive knob of the recovered carcass solver.
    Xpbd::SoftTyreParameters Xpbd{};

    // FEM backend: mesh resolution, Lamé material, contact penalty, pressure.
    std::shared_ptr<const FemTyreParameters> Fem;

    // Substeps for the deformable backends. The rigid backend ignores it.
    std::uint32_t Substeps = 16u;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    STEP INPUT
//------------------------------------------------------------------------------------------------------------------------
struct TyreStep
{
    float          DeltaSeconds = 1.0f / 60.0f;   // [s]   fixed physics step
    HubMotion      Hub{};                         // [m, rad/s] hub pose at the END of the step plus its velocities
    Vec3           SurfaceVelocity{};             // [m/s] ground velocity (zero on a road, non-zero on a belt rig)
    GroundQuery    Ground{};                      // [-]   nearest surface point + outward normal
    float          DeltaSpin = 0.0f;              // [rad] wheel rotation accumulated over this step (tread advection)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE SEAM
//------------------------------------------------------------------------------------------------------------------------
class TyreModel
{
public:
    virtual ~TyreModel() = default;

    [[nodiscard]] virtual TyreModelKind Kind() const noexcept = 0;

    // Allocates the deformation state around the supplied hub pose. Safe to call again to rebuild.
    virtual void Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
                       const Quat& HubOrientation) noexcept = 0;

    // Advances one fixed step and refreshes `Reaction()`. Must be called exactly once per physics step.
    virtual void Step(const TyreStep& Input) noexcept = 0;

    // Force and moment the road/carcass puts back into the hub, in world space, about the hub centre.
    // `RimForce` and `RimTorque` are the values the chassis integrates; `Force` is the {Fx, Fy, Fz} summary.
    [[nodiscard]] virtual const TyreReaction& Reaction() const noexcept = 0;

    [[nodiscard]] virtual bool IsBuilt() const noexcept = 0;

    // Deformed particle positions for rendering, tread advection and diagnostics. Empty for a rigid backend.
    virtual void GatherNodes(std::vector<Vec3>& OutPositions) const noexcept { OutPositions.clear(); }

    // Material rotation accumulated by the carcass (radians about the axle), for procedural tread posing.
    [[nodiscard]] virtual float CarcassAngle() const noexcept { return 0.0f; }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     FACTORY
//------------------------------------------------------------------------------------------------------------------------
// Returns nullptr for an unknown kind. The caller owns the result. Backends are cheap to construct; the deformation
// state is allocated in Build so a model can be created before its wheel exists.
[[nodiscard]] std::unique_ptr<TyreModel> CreateTyreModel(TyreModelKind Kind) noexcept;

} // namespace Frontier::Vehicle
