//============================================================================================================================================
//                                                            RIGIDTYREMODEL.H
//============================================================================================================================================
// 📦 `TyreModel` backend for the rigid wheel: trace-fan load, Magic-Formula force.
//
// This is the backend the Jolt chassis drives today, expressed through the same seam as the deformable ones. It exists so
// the two can be compared on identical inputs — same hub pose, same ground query, same step — which is the only way a
// claim like "the XPBD carcass reproduces the Pacejka peak" can be checked rather than asserted.
//
// It is deliberately *not* Jolt's own `VehicleConstraint` wheel: Jolt is the rigid-body world and the contact solver here,
// the tyre force model is ours. Keeping it that way means the same tyre code runs against a mock integrator in a headless
// validation program and against the Jolt world in the editor.
//
// Chain per step:
//    TraceWheelContact  → contact sample fan → normal load Fz, patch centre, averaged normal, deflection
//    slip               → κ = (ω·R − Vx)/max(|Vx|, 1),  α = atan2(Vy, |Vx|)
//    PacejkaMagicFormula→ pure Fx, Fy, then the MF6.1 combined-slip weighting
//    reaction           → force at the patch, Mz about the contact normal

#pragma once

#include "../TyreModel.h"

#include <vector>

namespace Frontier::Vehicle {

class RigidTyreModel final : public TyreModel
{
public:
    RigidTyreModel() noexcept = default;
    ~RigidTyreModel() noexcept override = default;

    [[nodiscard]] TyreModelKind Kind() const noexcept override { return TyreModelKind::RigidTraceFan; }

    void Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
               const Quat& HubOrientation) noexcept override;

    void Step(const TyreStep& Input) noexcept override;

    [[nodiscard]] const TyreReaction& Reaction() const noexcept override { return ContactReaction; }
    [[nodiscard]] bool IsBuilt() const noexcept override { return Built; }

    [[nodiscard]] float CarcassAngle() const noexcept override { return SpinAngle; }

    // Diagnostics
    [[nodiscard]] float SlipRatio() const noexcept { return LastSlipRatio; }
    [[nodiscard]] float SlipAngleRad() const noexcept { return LastSlipAngleRad; }
    [[nodiscard]] float LastLoad() const noexcept { return LastLoadNewtons; }
    [[nodiscard]] const TraceContactReading& LastReading() const noexcept { return LastContact; }

private:
    TyreSpecification     Tyre{};
    TraceContactParameters TraceFan{};
    PacejkaMagicFormula   MagicFormula{};

    TyreReaction      ContactReaction{};
    TraceContactReading LastContact{};
    float LastSlipRatio   = 0.0f;
    float LastSlipAngleRad = 0.0f;
    float LastLoadNewtons = 0.0f;
    float SpinAngle       = 0.0f;
    float WheelAngleRate  = 0.0f;   // [rad/s] wheel rotational speed handed in by the drivetrain
    bool  Built           = false;
};

} // namespace Frontier::Vehicle
