//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Tyre/Xpbd/XpbdSpringTyreModel.cpp
//============================================================================================================================================

#include "XpbdSpringTyreModel.h"

#include <algorithm>

namespace Frontier::Vehicle {

namespace {

// The recovered carcass reports its own TyreReaction in the same field layout the vehicle layer consumes. The two are
// deliberately identical so this mapping stays mechanical: if a field is added to one, the build fails here rather than
// silently dropping telemetry.
TyreReaction MapReaction(const Xpbd::TyreReaction& Source, const Xpbd::XPBDSoftTyre& Carcass) noexcept
{
    TyreReaction Out{};
    Out.RimForce        = Source.RimForce;
    Out.RimTorque       = Source.RimTorque;
    Out.Force           = Source.Force;
    Out.NormalReaction  = Source.NormalReaction;
    Out.SupportReaction = Source.SupportReaction;
    Out.Mz              = Source.Mz;
    Out.ContactCount    = Source.ContactCount;
    Out.PatchCentre     = Source.PatchCentre;
    Out.EnclosedVolume  = Source.EnclosedVolume;
    Out.GaugePressure   = Source.GaugePressure;
    Out.InflationForce  = Source.InflationForce;
    // ContactNormal / Deflection / PatchLateral were added to the vehicle-layer record after this backend was written;
    // they are derived here rather than left unset: the normal is the reaction direction and the deflection is how far
    // the patch sits inside the unloaded radius.
    const Vec3 ReactionDirection = Source.SupportReaction;
    Out.ContactNormal = (ReactionDirection.LengthSq() > 1.0e-12f) ? ReactionDirection.Normalized() : Vec3{0.0f, 0.0f, 1.0f};
    // The carcass reports the deepest residual penetration after its solve; that is the measured sag of the patch.
    Out.Deflection    = Carcass.Residual().ContactMax;
    Out.PatchLateral  = 0.0f;
    return Out;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
void XpbdSpringTyreModel::Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
                                const Quat& HubOrientation) noexcept
{
    Parameters = Configuration.Xpbd;

    // Geometry and mass come from the shared tyre record so the three backends describe the same wheel.
    Parameters.Radius       = Configuration.Tyre.Radius;
    Parameters.RimRadius    = Configuration.Tyre.RimRadius;
    Parameters.Width        = Configuration.Tyre.Width;
    Parameters.TotalMass    = Configuration.Tyre.TotalMass;
    Parameters.InflationPressure   = Configuration.Tyre.InflationPressure;
    Parameters.AtmosphericPressure = Configuration.Tyre.AtmosphericPressure;
    Parameters.Gravity      = Configuration.Tyre.Gravity;
    Parameters.BeadWidthRatio = Configuration.Tyre.BeadWidthRatio;

    Substeps = std::max<std::uint32_t>(Configuration.Substeps, 1u);

    Carcass.Build(Parameters, HubPosition, HubOrientation);
    MappedReaction = TyreReaction{};
}

//------------------------------------------------------------------------------------------------------------------------
void XpbdSpringTyreModel::Step(const TyreStep& Input) noexcept
{
    if (!Carcass.Constructed()) return;

    Xpbd::HubMotion Motion{};
    Motion.Position         = Input.Hub.Position;
    Motion.Orientation      = Input.Hub.Orientation;
    Motion.LinearVelocity   = Input.Hub.LinearVelocity;
    Motion.SpinRate         = Input.Hub.SpinRate;
    Motion.AngularVelocity  = Input.Hub.AngularVelocity;

    Carcass.Step(Input.DeltaSeconds, Substeps, Motion, Input.SurfaceVelocity, Input.Ground);
    MappedReaction = MapReaction(Carcass.Reaction(), Carcass);
}

//------------------------------------------------------------------------------------------------------------------------
void XpbdSpringTyreModel::GatherNodes(std::vector<Vec3>& OutPositions) const noexcept
{
    const auto& Nodes = Carcass.Nodes();
    OutPositions.clear();
    OutPositions.reserve(Nodes.size());
    for (const auto& Node : Nodes) OutPositions.push_back(Node.Position);
}

} // namespace Frontier::Vehicle
