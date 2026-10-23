//============================================================================================================================================
//                                                             FEMTYREMODEL.H
//============================================================================================================================================
// 📦 3D FEM tyre: a revolved tetrahedral solid solved by first-Piola–Kirchhoff forces.
//
// This is the native port of the WebGPU volumetric reference
// (`Experimental/TyreVolumetricDemo/src/tyreCore.js` + `shaders.js`, branch `c7egoist/Frontier arena/3488daf0-frontier`).
// The reference's equations are reproduced term for term:
//
//    mesh        a (circumferential × radial × lateral) grid revolved about the axle, each hex cell split by the same
//                Kuhn 6-tet decomposition, so element ordering and rest shape match the reference exactly;
//    energy      Ψ = μ E:E + ½λ (tr E)² with Green–Lagrange strain E, plus a volumetric pressure term −p·V;
//    stress      S = 2μE + λ tr(E) I,  P = F·S − p·cof(F),  f_k = −V₀ P·G_{k−1},  f_0 = −Σ f_k;
//    contact     penalty spring along the surface normal, viscous friction clamped by Coulomb;
//    bead        the rim-adjacent radial shell is tied to the rim by a stiff spring/damper pair;
//    integration explicit semi-implicit Euler at a step scaled for stability with E and density.
//
// What changed in the port, and why (both are integration facts, not model changes):
//
//    • The reference owns its own rim: it integrates a suspended rim mass and drives it along a fixed track at a fixed
//      speed. Here the hub is KINEMATIC — the vehicle stack already owns the chassis, the strut and the contact material,
//      and a tyre that also integrated a rim would be a second, competing chassis. The hub pose arrives per step and the
//      bead anchors follow it, which is the same boundary condition the reference applies to its rim.
//    • The reference's `terrainHeight(x)` is a heightfield along a straight track. Here contact goes through the shared
//      `GroundQuery`, so the FEM tyre reads the same road, kerb or mesh collider as every other backend and can be
//      driven anywhere rather than only along +x.
//
// Reported limitation: the reference advects only the bead anchors, not the material, so the tread does not roll through
// the contact patch (the road appears to slide under the tyre). `CarcassAngle()` reports the accumulated angle so a
// renderer can pose a procedural tread, but true material advection in the contact region is follow-up work — the same
// gap `XPBDSoftTyre` closed with its own spin integrator. Friction still produces correct in-plane force.

#pragma once

#include "../../Vehicle/RigidWheel.h"
#include "../TyreModel.h"

#include <cstdint>
#include <vector>

namespace Frontier::Vehicle {

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARAMETERS
//------------------------------------------------------------------------------------------------------------------------
struct FemTyreParameters
{
    // ── Mesh resolution ────────────────────────────────────────────────────────────────────────────────────────────────
    std::uint32_t CircumferentialNodes = 48u;   // [-] nodes around the tyre (≥ 8)
    std::uint32_t RadialNodes          = 5u;    // [-] bead → tread nodes (≥ 2)
    std::uint32_t LateralNodes         = 5u;    // [-] across the section (≥ 2)

    // ── Rest geometry [m] ─────────────────────────────────────────────────────────────────────────────────────────────
    float RimRadius      = 0.20f;   // [m] bead seat radius
    float TreadRadius    = 0.33f;   // [m] unloaded tread radius
    float BeadHalfWidth  = 0.055f;  // [m] section half-width at the bead
    float TreadHalfWidth = 0.105f;  // [m] section half-width at the tread shoulder
    float Shoulder       = 0.70f;   // [-] fraction of the radial span at which the tread width is reached

    // ── Material ─────────────────────────────────────────────────────────────────────────────────────────────────────
    float YoungsModulus     = 6.0e6f;   // [Pa]  effective rubber modulus of the reference
    float PoissonRatio      = 0.30f;    // [-]
    float Density           = 1000.0f;  // [kg/m³] effective (reference-tuned, not rubber's 1100 at full solids)
    float InflationPressure = 2.5e5f;   // [Pa]  volumetric pressure term
    float DampingRate       = 4.0f;     // [1/s] per-node mass-proportional velocity damping

    // ── Ground contact ───────────────────────────────────────────────────────────────────────────────────────────────
    float GroundStiffness    = 3.0e4f;  // [N/m]   penalty spring per node
    float GroundDampingRate  = 60.0f;   // [1/s]   normal damping (·mass·v)
    float Friction           = 0.90f;   // [-]     Coulomb limit
    float FrictionDampingRate = 600.0f; // [1/s]   tangential damping (·mass·v)

    // ── Bead attachment to the rim ───────────────────────────────────────────────────────────────────────────────────
    float BeadStiffness   = 2.5e4f;     // [N/m]   bead → rim spring
    float BeadDampingRate = 40.0f;      // [1/s]   bead → rim damping (·mass·v)
    float BeadRadiusTolerance = 1.0e-4f; // [m]   nodes at or inside RimRadius + tolerance are beads

    // ── Integration ──────────────────────────────────────────────────────────────────────────────────────────────────
    float          StepLimit   = 1.0e-4f;  // [s] largest stable substep at the reference defaults
    std::uint32_t  MaxSubsteps = 96u;      // [-] hard cap on substeps per fixed step (protects frame time)
    Vec3           Gravity{0.0f, 0.0f, -9.81f}; // [m/s²]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE MODEL
//------------------------------------------------------------------------------------------------------------------------
class FemTyreModel final : public TyreModel
{
public:
    FemTyreModel() noexcept = default;
    ~FemTyreModel() noexcept override = default;

    FemTyreModel(const FemTyreModel&) = delete;
    FemTyreModel& operator=(const FemTyreModel&) = delete;

    [[nodiscard]] TyreModelKind Kind() const noexcept override { return TyreModelKind::VolumetricFem; }

    void Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
               const Quat& HubOrientation) noexcept override;

    void Step(const TyreStep& Input) noexcept override;

    [[nodiscard]] const TyreReaction& Reaction() const noexcept override { return ContactReaction; }
    [[nodiscard]] bool IsBuilt() const noexcept override { return !Positions.empty(); }

    void GatherNodes(std::vector<Vec3>& OutPositions) const noexcept override { OutPositions = Positions; }
    [[nodiscard]] float CarcassAngle() const noexcept override { return SpinAngle; }

    // Diagnostics, for validation and the inspector.
    [[nodiscard]] std::uint32_t NodeCount()      const noexcept { return static_cast<std::uint32_t>(Positions.size()); }
    [[nodiscard]] std::uint32_t ElementCount()   const noexcept { return static_cast<std::uint32_t>(TetRestVolume.size()); }
    [[nodiscard]] float         TotalMass()      const noexcept { return MassTotal; }
    [[nodiscard]] float         LastStepSeconds() const noexcept { return LastSubstepSeconds; }
    [[nodiscard]] std::uint32_t LastSubsteps()  const noexcept { return LastSubstepCount; }
    // Worst element inversion seen in the last step: min(det F). Negative means an element folded through zero volume.
    [[nodiscard]] float MinimumElementDeterminant() const noexcept { return MinimumDeformationDeterminant; }
    [[nodiscard]] const FemTyreParameters& Parameters() const noexcept { return Settings; }

private:
    void BuildMesh() noexcept;
    void IntegrateSubstep(float DeltaSeconds, const TyreStep& Input) noexcept;
    void AccumulateTetForces() noexcept;
    void ResolveBeadTargets(const Vec3& HubPosition, const Quat& HubOrientation) noexcept;
    void ResolveReaction(const Vec3& HubPosition, const Vec3& HubVelocity,
                         const Vec3& HubAngularVelocity, float SpinRate) noexcept;

    FemTyreParameters Settings{};

    // ── Rest state (material frame: axle +Y, hub-centred) ────────────────────────────────────────────────────────────
    std::vector<Vec3>   RestPositions;   // [m]   node rest position, material frame
    std::vector<float>  NodeMass;        // [kg]  lumped ¼ of the surrounding element volumes × density
    std::vector<Vec3>   BeadTargets;     // [m]   world-space rim anchor for each node (zero for non-bead nodes)
    std::vector<std::uint8_t> IsBead;    // [-]   1 when the node is welded to the rim
    std::vector<std::uint32_t> TetIndices;      // [-]
    std::vector<float>  TetInverseGradient;     // [-]   9 floats per tet: Dm⁻ᵀ, column-major
    std::vector<float>  TetRestVolume;          // [m³]
    std::vector<Vec3>   TetInverseGradientRow;  // cached per-tet GT as three columns for the force loop

    // ── Live state (world) ───────────────────────────────────────────────────────────────────────────────────────────
    std::vector<Vec3> Positions;         // [m]
    std::vector<Vec3> Velocities;        // [m/s]
    std::vector<Vec3> NodeForces;        // [N]
    std::vector<Vec3> BeadForceOnNode;   // [N] this step, for the hub reaction

    Vec3   Gravity{0.0f, 0.0f, -9.81f};  // [m/s²]
    float  SpinAngle = 0.0f;             // [rad] accumulated carcass rotation
    float  MassTotal = 0.0f;             // [kg]
    float  Mu = 0.0f;                    // [Pa] Lamé
    float  Lambda = 0.0f;                // [Pa] Lamé

    TyreReaction ContactReaction{};

    float         LastSubstepSeconds = 0.0f;
    std::uint32_t LastSubstepCount   = 0u;
    float         MinimumDeformationDeterminant = 1.0f;
};

} // namespace Frontier::Vehicle
