//============================================================================================================================================
//                                                          XPBDSPRINGTYREMODEL.H
//============================================================================================================================================
// 📦 `TyreModel` backend over the recovered configurable XPBD carcass.
//
// The carcass solver itself (`XPBDSoftTyre`, 56 kB of measured, commented physics) is the source that commit `9ceb33c`
// deleted from `SultanAladin/Frontier-` on 2026-10-13. It is landed here unmodified apart from its namespace and its
// duplicated vector maths; this class is the only thing that had to be written to make it a pluggable tyre.
//
// Every constitutive knob the source exposes stays reachable through `TyreModelConfiguration::Xpbd`, which is what makes
// this the *configurable* spring model rather than a fixed one:
//
//    • geometry        Radius, RimRadius, Width, RingCount, SegmentCount, TotalMass
//    • stiffness       Spoke/Hoop/Lateral/Shear/Contact/TreadTangential compliance [m/N]
//    • gas             InflationPressure, AtmosphericPressure, GasCompressible (Boyle), thermal ratio
//    • damping         per-family damping ratios (ζ), converted to β at build time
//    • solve           SolverIterations, ActiveWindow*, and the substep count from the configuration
//    • limits          SidewallTensionOnly, RimBottoming + clearance/compliance/damping
//
// Geometry is taken from `TyreModelConfiguration::Tyre`, not from the XPBD sub-record: switching a wheel between the
// rigid, XPBD and FEM backends must not silently change its size or mass.

#pragma once

#include "../TyreModel.h"

#include <vector>

namespace Frontier::Vehicle {

class XpbdSpringTyreModel final : public TyreModel
{
public:
    XpbdSpringTyreModel() noexcept = default;
    ~XpbdSpringTyreModel() noexcept override = default;

    [[nodiscard]] TyreModelKind Kind() const noexcept override { return TyreModelKind::XpbdSpringCarcass; }

    void Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
               const Quat& HubOrientation) noexcept override;

    void Step(const TyreStep& Input) noexcept override;

    [[nodiscard]] const TyreReaction& Reaction() const noexcept override { return MappedReaction; }
    [[nodiscard]] bool IsBuilt() const noexcept override { return Carcass.Constructed(); }

    void GatherNodes(std::vector<Vec3>& OutPositions) const noexcept override;
    [[nodiscard]] float CarcassAngle() const noexcept override { return Carcass.CarcassAngle(); }

    // Direct access for the inspector and for validation against the recovered reference numbers.
    [[nodiscard]] const Xpbd::XPBDSoftTyre& CarcassTyre() const noexcept { return Carcass; }
    [[nodiscard]] const Xpbd::SoftTyreParameters& CarcassParameters() const noexcept { return Parameters; }

private:
    Xpbd::XPBDSoftTyre       Carcass{};
    Xpbd::SoftTyreParameters Parameters{};
    TyreReaction             MappedReaction{};
    std::uint32_t            Substeps = 16u;
};

} // namespace Frontier::Vehicle
