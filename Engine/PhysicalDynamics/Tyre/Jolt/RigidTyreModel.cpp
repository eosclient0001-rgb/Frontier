//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Tyre/Jolt/RigidTyreModel.cpp
//============================================================================================================================================

#include "RigidTyreModel.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Vehicle {

//------------------------------------------------------------------------------------------------------------------------
void RigidTyreModel::Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
                           const Quat& HubOrientation) noexcept
{
    (void)HubPosition;
    (void)HubOrientation;

    Tyre     = Configuration.Tyre;
    TraceFan = Configuration.TraceFan;
    MagicFormula.AssignParameters(Configuration.Slip);

    ContactReaction = TyreReaction{};
    LastContact = TraceContactReading{};
    LastSlipRatio = 0.0f;
    LastSlipAngleRad = 0.0f;
    LastLoadNewtons = 0.0f;
    SpinAngle = 0.0f;
    Built = true;
}

//------------------------------------------------------------------------------------------------------------------------
//    A rigid tyre has no deformation state to advance. The "step" is the whole force model: sample the fan, turn the
//    normal load into a deflection (so the reported sag matches the trace fan's spring), derive slip from the hub
//    velocities, and let the Magic Formula produce the in-plane force.
void RigidTyreModel::Step(const TyreStep& Input) noexcept
{
    if (!Built) return;

    ContactReaction = TyreReaction{};
    LastLoadNewtons = 0.0f;
    LastSlipRatio = 0.0f;
    LastSlipAngleRad = 0.0f;

    SpinAngle += Input.Hub.SpinRate * Input.DeltaSeconds;

    if (!Input.Ground) return;

    LastContact = TraceWheelContact(TraceFan, Tyre.Radius, Tyre.Width, Input.Hub.Position,
                                    Input.Hub.Orientation, Input.Hub.LinearVelocity, Input.Ground);
    if (LastContact.HitCount == 0u) return;

    const Vec3 Normal = LastContact.Normal;
    const float Load = std::max(Dot(LastContact.Reaction.SupportReaction, Normal), 0.0f);
    LastLoadNewtons = Load;

    // ── slip ────────────────────────────────────────────────────────────────────────────────────────────────────────
    const Vec3 Forward = Input.Hub.Orientation.Rotate({1.0f, 0.0f, 0.0f});
    const Vec3 Left    = Input.Hub.Orientation.Rotate({0.0f, 1.0f, 0.0f});

    const Vec3 Relative = Input.Hub.LinearVelocity - Input.SurfaceVelocity;
    const float ForwardSpeed = Dot(Relative, Forward);
    const float LateralSpeed = Dot(Relative, Left);

    // SAE/Jazar convention: κ = (ω·R − Vx) / max(|Vx|, 1 m/s). The 1 m/s floor is what keeps a standstill from
    // dividing by zero and reporting an infinite slip ratio the moment the car is stationary.
    const float RollingSpeed = Input.Hub.SpinRate * Tyre.Radius;
    const float Reference    = std::max(std::fabs(ForwardSpeed), 1.0f);
    const float SlipRatio    = (RollingSpeed - ForwardSpeed) / Reference;
    const float SlipAngle    = std::atan2(LateralSpeed, std::max(std::fabs(ForwardSpeed), 1.0e-3f));

    // Camber is the axle's tilt out of the road plane: the hub's +Y axis against the plane ⟂ the contact normal.
    const float Camber = std::asin(std::clamp(Dot(Left, Normal), -1.0f, 1.0f)) * -1.0f;

    LastSlipRatio = SlipRatio;
    LastSlipAngleRad = SlipAngle;

    const TyreForces Forces = MagicFormula.Combined(SlipRatio, SlipAngle, Camber, Load);

    // ── reaction ───────────────────────────────────────────────────────────────────────────────────────────────────
    // Longitudinal force follows the sign of the slip ratio (a wheel spinning faster than the ground pushes the car
    // forward). Lateral force opposes the lateral slip velocity; the Magic Formula gives the magnitude, so a sign
    // convention mistake cannot invert the cornering response.
    const Vec3 Longitudinal = Forward * Forces.Fx;
    const Vec3 Lateral = (std::fabs(LateralSpeed) > 1.0e-6f)
                             ? Left * (-std::copysign(std::fabs(Forces.Fy), LateralSpeed))
                             : Left * -Forces.Fy;

    const Vec3 InPlane = Longitudinal + Lateral;

    ContactReaction = LastContact.Reaction;
    ContactReaction.RimForce = InPlane + ContactReaction.SupportReaction;
    ContactReaction.RimTorque = Cross(ContactReaction.PatchCentre - Input.Hub.Position, InPlane);
    ContactReaction.Force = ContactReaction.RimForce;
    ContactReaction.Mz = Forces.Mz;
    ContactReaction.ContactNormal = Normal;
    ContactReaction.Deflection = LastContact.Deflection;
    ContactReaction.PatchLateral = 0.0f;
    ContactReaction.ContactCount = LastContact.HitCount;
}

} // namespace Frontier::Vehicle
