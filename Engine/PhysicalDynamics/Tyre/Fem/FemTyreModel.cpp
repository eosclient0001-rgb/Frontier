//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Tyre/Fem/FemTyreModel.cpp
//============================================================================================================================================

#include "FemTyreModel.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace Frontier::Vehicle {

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                             column-major 3×3 helpers
//------------------------------------------------------------------------------------------------------------------------
// The reference stores every matrix as nine floats, column-major (WGSL convention). Keeping that layout here is what
// lets the port be checked element by element against `tyreCore.js` instead of "roughly the same equations".

struct Mat3
{
    float m[9]{1.0f, 0.0f, 0.0f,
               0.0f, 1.0f, 0.0f,
               0.0f, 0.0f, 1.0f};

    [[nodiscard]] Vec3 Column(std::size_t Index) const noexcept
    {
        return {m[3 * Index + 0], m[3 * Index + 1], m[3 * Index + 2]};
    }
    void SetColumn(std::size_t Index, const Vec3& Value) noexcept
    {
        m[3 * Index + 0] = Value.x;
        m[3 * Index + 1] = Value.y;
        m[3 * Index + 2] = Value.z;
    }
};

[[nodiscard]] Mat3 FromColumns(const Vec3& C0, const Vec3& C1, const Vec3& C2) noexcept
{
    Mat3 Out{};
    Out.SetColumn(0, C0);
    Out.SetColumn(1, C1);
    Out.SetColumn(2, C2);
    return Out;
}

[[nodiscard]] Vec3 Multiply(const Mat3& A, const Vec3& V) noexcept
{
    return {A.m[0] * V.x + A.m[3] * V.y + A.m[6] * V.z,
            A.m[1] * V.x + A.m[4] * V.y + A.m[7] * V.z,
            A.m[2] * V.x + A.m[5] * V.y + A.m[8] * V.z};
}

[[nodiscard]] Mat3 Multiply(const Mat3& A, const Mat3& B) noexcept
{
    return FromColumns(Multiply(A, B.Column(0)), Multiply(A, B.Column(1)), Multiply(A, B.Column(2)));
}

[[nodiscard]] Mat3 Transpose(const Mat3& A) noexcept
{
    Mat3 Out{};
    for (std::size_t C = 0; C < 3; ++C)
        for (std::size_t R = 0; R < 3; ++R) Out.m[3 * R + C] = A.m[3 * C + R];
    return Out;
}

// Adjugate inverse, identical to the reference's `invertColMajor`.
//
// ⚠️ The reference indexes a row-major copy `a[]`, so `a3` is `m1` and `a5` is `m7`. Writing the JS expressions
// against the column-major `m[]` directly silently transposes the cofactors and yields a wrong inverse — which does not
// fail loudly, it produces NaN element forces on the first substep. The expressions below are the JS ones translated
// through that mapping, and the validation program checks F = I for a rigidly translated rest configuration.
[[nodiscard]] bool Invert(const Mat3& A, Mat3& Out) noexcept
{
    const float C00 = A.m[4] * A.m[8] - A.m[7] * A.m[5];
    const float C01 = A.m[7] * A.m[2] - A.m[1] * A.m[8];
    const float C02 = A.m[1] * A.m[5] - A.m[4] * A.m[2];
    const float Determinant = A.m[0] * C00 + A.m[3] * C01 + A.m[6] * C02;
    if (!std::isfinite(Determinant) || std::fabs(Determinant) < 1.0e-20f) return false;

    const float Inverse = 1.0f / Determinant;
    Mat3 RowMajor{};
    RowMajor.m[0] = C00 * Inverse;                                    // a0..a2 row 0
    RowMajor.m[1] = (A.m[6] * A.m[5] - A.m[3] * A.m[8]) * Inverse;
    RowMajor.m[2] = (A.m[3] * A.m[7] - A.m[6] * A.m[4]) * Inverse;
    RowMajor.m[3] = C01 * Inverse;                                    // row 1
    RowMajor.m[4] = (A.m[0] * A.m[8] - A.m[6] * A.m[2]) * Inverse;
    RowMajor.m[5] = (A.m[6] * A.m[1] - A.m[0] * A.m[7]) * Inverse;
    RowMajor.m[6] = C02 * Inverse;                                    // row 2
    RowMajor.m[7] = (A.m[3] * A.m[2] - A.m[0] * A.m[5]) * Inverse;
    RowMajor.m[8] = (A.m[0] * A.m[4] - A.m[3] * A.m[1]) * Inverse;
    Out = Transpose(RowMajor);
    return true;
}

[[nodiscard]] float Determinant4(const Vec3& X0, const Vec3& X1, const Vec3& X2, const Vec3& X3) noexcept
{
    return Dot(X1 - X0, Cross(X2 - X0, X3 - X0));
}

// Rounded sidewall: 0 at the bead, full tread half-width at u = Shoulder. Reference `shoulderProfile`.
[[nodiscard]] float ShoulderProfile(float U, float Shoulder) noexcept
{
    const float Limit = (Shoulder > 1.0e-6f) ? Shoulder : 1.0e-6f;
    const float S = std::min(U / Limit, 1.0f);
    return std::sqrt(std::max(0.0f, 1.0f - (1.0f - S) * (1.0f - S)));
}

// Kuhn 6-tet split of a hex cell. Corner bit order: bit0 = circumferential, bit1 = radial, bit2 = lateral.
constexpr std::uint8_t KuhnTets[6][4] = {
    {0, 1, 3, 7}, {0, 1, 5, 7}, {0, 2, 3, 7}, {0, 2, 6, 7}, {0, 4, 5, 7}, {0, 4, 6, 7}};

//------------------------------------------------------------------------------------------------------------------------
//                    first-Piola element forces — port of tyreCore.js `tetElementForces`
//------------------------------------------------------------------------------------------------------------------------
//    Ψ = μ E:E + ½λ tr(E)²,  E = ½(FᵀF − I)          (Green–Lagrange strain, rotation invariant)
//    S = 2μE + λ tr(E) I
//    cof(F) = [f₁×f₂, f₂×f₀, f₀×f₁]                  (volumetric pressure direction)
//    P = F·S − p·cof(F)
//    f_k = −V₀ · P · G_{k−1},  k = 1…3;  f_0 = −Σ f_k
//
// `InverseGradientColumns` are the three columns of Dm⁻ᵀ = G.
void TetElementForces(const Vec3 X[4], const Vec3 InverseGradientColumns[3], float RestVolume,
                      float Mu, float Lambda, float Pressure, Vec3 Out[4]) noexcept
{
    const Mat3 Ds = FromColumns(X[1] - X[0], X[2] - X[0], X[3] - X[0]);
    const Mat3 B  = Transpose(FromColumns(InverseGradientColumns[0], InverseGradientColumns[1],
                                          InverseGradientColumns[2]));
    const Mat3 F  = Multiply(Ds, B);

    const Mat3 Ft = Transpose(F);
    const Mat3 FtF = Multiply(Ft, F);

    const float E00 = 0.5f * (FtF.m[0] - 1.0f);
    const float E11 = 0.5f * (FtF.m[4] - 1.0f);
    const float E22 = 0.5f * (FtF.m[8] - 1.0f);
    const float Trace = E00 + E11 + E22;

    Mat3 S{};
    for (std::size_t i = 0; i < 9; ++i)
    {
        const float Strain = (i == 0 || i == 4 || i == 8) ? 0.5f * (FtF.m[i] - 1.0f) : 0.5f * FtF.m[i];
        S.m[i] = 2.0f * Mu * Strain + ((i == 0 || i == 4 || i == 8) ? Lambda * Trace : 0.0f);
    }

    const Vec3 F0 = F.Column(0);
    const Vec3 F1 = F.Column(1);
    const Vec3 F2 = F.Column(2);
    const Mat3 Cofactor = FromColumns(Cross(F1, F2), Cross(F2, F0), Cross(F0, F1));

    const Mat3 FS = Multiply(F, S);
    Mat3 P{};
    for (std::size_t i = 0; i < 9; ++i) P.m[i] = FS.m[i] - Pressure * Cofactor.m[i];

    Vec3 Sum{};
    for (std::size_t k = 0; k < 3; ++k)
    {
        const Vec3 Force = Multiply(P, InverseGradientColumns[k]) * (-RestVolume);
        Out[k + 1] = Force;
        Sum += Force;
    }
    Out[0] = Sum * -1.0f;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       MESH
//------------------------------------------------------------------------------------------------------------------------
void FemTyreModel::BuildMesh() noexcept
{
    Settings.CircumferentialNodes = std::max<std::uint32_t>(Settings.CircumferentialNodes, 8u);
    Settings.RadialNodes          = std::max<std::uint32_t>(Settings.RadialNodes, 2u);
    Settings.LateralNodes         = std::max<std::uint32_t>(Settings.LateralNodes, 2u);

    const std::uint32_t Circumferential = Settings.CircumferentialNodes;
    const std::uint32_t Radial          = Settings.RadialNodes;
    const std::uint32_t Lateral         = Settings.LateralNodes;
    const std::uint32_t NodeTotal       = Circumferential * Radial * Lateral;

    const auto Index = [&](std::uint32_t T, std::uint32_t I, std::uint32_t J) noexcept
    {
        const std::uint32_t WrappedT = T % Circumferential;
        return (WrappedT * Radial + I) * Lateral + J;
    };

    RestPositions.assign(NodeTotal, Vec3{});
    for (std::uint32_t T = 0; T < Circumferential; ++T)
    {
        for (std::uint32_t I = 0; I < Radial; ++I)
        {
            for (std::uint32_t J = 0; J < Lateral; ++J)
            {
                const float U = static_cast<float>(I) / static_cast<float>(Radial - 1u);
                const float V = -1.0f + 2.0f * static_cast<float>(J) / static_cast<float>(Lateral - 1u);
                const float R = Settings.RimRadius + (Settings.TreadRadius - Settings.RimRadius) * U;
                const float HalfWidth = Settings.BeadHalfWidth +
                    (Settings.TreadHalfWidth - Settings.BeadHalfWidth) * ShoulderProfile(U, Settings.Shoulder);
                const float Theta = 6.28318530717958647692f * static_cast<float>(T) /
                                    static_cast<float>(Circumferential);
                // Axle is +Y: the ring lies in the X–Z plane and the section runs along Y.
                RestPositions[Index(T, I, J)] = {R * std::cos(Theta), HalfWidth * V, R * std::sin(Theta)};
            }
        }
    }

    const std::uint32_t ElementTotal = Circumferential * (Radial - 1u) * (Lateral - 1u) * 6u;
    TetIndices.assign(static_cast<std::size_t>(ElementTotal) * 4u, 0u);

    std::vector<float> NodeVolume(NodeTotal, 0.0f);
    TetInverseGradient.assign(static_cast<std::size_t>(ElementTotal) * 9u, 0.0f);
    TetRestVolume.assign(ElementTotal, 0.0f);
    TetInverseGradientRow.assign(static_cast<std::size_t>(ElementTotal) * 3u, Vec3{});

    std::uint32_t Element = 0;
    for (std::uint32_t T = 0; T < Circumferential; ++T)
    {
        for (std::uint32_t I = 0; I + 1u < Radial; ++I)
        {
            for (std::uint32_t J = 0; J + 1u < Lateral; ++J)
            {
                const auto Corner = [&](std::uint8_t Bits) noexcept
                {
                    return Index(T + (Bits & 1u), I + ((Bits >> 1) & 1u), J + ((Bits >> 2) & 1u));
                };

                for (const auto& Tet : KuhnTets)
                {
                    std::uint32_t Ids[4] = {Corner(Tet[0]), Corner(Tet[1]), Corner(Tet[2]), Corner(Tet[3])};

                    float Determinant = Determinant4(RestPositions[Ids[0]], RestPositions[Ids[1]],
                                                     RestPositions[Ids[2]], RestPositions[Ids[3]]);
                    if (Determinant < 0.0f)
                    {
                        std::swap(Ids[2], Ids[3]);
                        Determinant = -Determinant;
                    }
                    if (Determinant <= 1.0e-14f) continue;   // degenerate sliver: no volume, no stiffness

                    const Vec3 D0 = RestPositions[Ids[1]] - RestPositions[Ids[0]];
                    const Vec3 D1 = RestPositions[Ids[2]] - RestPositions[Ids[0]];
                    const Vec3 D2 = RestPositions[Ids[3]] - RestPositions[Ids[0]];

                    Mat3 InverseShape{};
                    if (!Invert(FromColumns(D0, D1, D2), InverseShape)) continue;
                    const Mat3 InverseShapeTransposed = Transpose(InverseShape);

                    const float RestVolume = Determinant / 6.0f;
                    TetRestVolume[Element] = RestVolume;
                    for (std::size_t K = 0; K < 4; ++K)
                    {
                        TetIndices[static_cast<std::size_t>(Element) * 4u + K] = Ids[K];
                        NodeVolume[Ids[K]] += RestVolume * 0.25f;
                    }
                    for (std::size_t K = 0; K < 3; ++K)
                        TetInverseGradientRow[static_cast<std::size_t>(Element) * 3u + K] =
                            InverseShapeTransposed.Column(K);
                    for (std::size_t K = 0; K < 9; ++K)
                        TetInverseGradient[static_cast<std::size_t>(Element) * 9u + K] = InverseShapeTransposed.m[K];

                    ++Element;
                }
            }
        }
    }

    TetIndices.resize(static_cast<std::size_t>(Element) * 4u);
    TetInverseGradient.resize(static_cast<std::size_t>(Element) * 9u);
    TetInverseGradientRow.resize(static_cast<std::size_t>(Element) * 3u);
    TetRestVolume.resize(Element);

    // Lumped rest volume → mass. The reference multiplies by the effective density, not rubber's true 1100 kg/m³.
    NodeMass.assign(NodeTotal, 0.0f);
    MassTotal = 0.0f;
    for (std::uint32_t N = 0; N < NodeTotal; ++N)
    {
        NodeMass[N] = Settings.Density * NodeVolume[N];
        MassTotal += NodeMass[N];
    }

    // Bead nodes: the innermost radial shell, welded to the rim.
    IsBead.assign(NodeTotal, 0u);
    for (std::uint32_t N = 0; N < NodeTotal; ++N)
    {
        const Vec3& Rest = RestPositions[N];
        const float RadialDistance = std::sqrt(Rest.x * Rest.x + Rest.z * Rest.z);
        if (RadialDistance <= Settings.RimRadius + Settings.BeadRadiusTolerance) IsBead[N] = 1u;
    }

    BeadTargets.assign(NodeTotal, Vec3{});
    BeadForceOnNode.assign(NodeTotal, Vec3{});
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       BUILD
//------------------------------------------------------------------------------------------------------------------------
void FemTyreModel::Build(const TyreModelConfiguration& Configuration, const Vec3& HubPosition,
                         const Quat& HubOrientation) noexcept
{
    Settings = Configuration.Fem ? *Configuration.Fem : FemTyreParameters{};

    BuildMesh();

    const std::uint32_t NodeTotal = static_cast<std::uint32_t>(RestPositions.size());
    Positions.assign(NodeTotal, Vec3{});
    Velocities.assign(NodeTotal, Vec3{});
    NodeForces.assign(NodeTotal, Vec3{});
    BeadForceOnNode.assign(NodeTotal, Vec3{});
    for (std::uint32_t N = 0; N < NodeTotal; ++N) Positions[N] = HubPosition + HubOrientation.Rotate(RestPositions[N]);

    Mu = Settings.YoungsModulus / (2.0f * (1.0f + Settings.PoissonRatio));
    Lambda = (Settings.YoungsModulus * Settings.PoissonRatio) /
             ((1.0f + Settings.PoissonRatio) * (1.0f - 2.0f * Settings.PoissonRatio));
    Gravity = Settings.Gravity;
    SpinAngle = 0.0f;
    ContactReaction = TyreReaction{};
    MinimumDeformationDeterminant = 1.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BEAD TARGETS
//------------------------------------------------------------------------------------------------------------------------
// The rim the tyre is bolted to is kinematic: the vehicle owns it. Each substep re-derives the world-space anchor as
//     target = hubPosition(t) + hubRotation · R_axle(spin) · rest
// rather than freezing the pose for the whole step. At 36 m/s a frozen 60 Hz pose moves the anchors 0.6 m between
// frames; the carcass would be yanked after it in one substep. (Same defect the XPBD carcass records in its header.)
void FemTyreModel::ResolveBeadTargets(const Vec3& HubPosition, const Quat& HubOrientation) noexcept
{
    const Quat Spin = Quat::AxisAngle({0.0f, 1.0f, 0.0f}, SpinAngle);
    const Quat Material = (HubOrientation * Spin).Normalized();

    for (std::size_t N = 0; N < RestPositions.size(); ++N)
    {
        if (!IsBead[N]) continue;
        BeadTargets[N] = HubPosition + Material.Rotate(RestPositions[N]);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ELEMENT FORCES
//------------------------------------------------------------------------------------------------------------------------
void FemTyreModel::AccumulateTetForces() noexcept
{
    for (Vec3& Force : NodeForces) Force = Vec3{};

    const std::size_t ElementTotal = TetRestVolume.size();
    MinimumDeformationDeterminant = 1.0f;

    for (std::size_t Element = 0; Element < ElementTotal; ++Element)
    {
        const std::uint32_t* Ids = &TetIndices[Element * 4u];
        Vec3 Local[4] = {Positions[Ids[0]], Positions[Ids[1]], Positions[Ids[2]], Positions[Ids[3]]};
        const Vec3* InverseGradient = &TetInverseGradientRow[Element * 3u];

        // Track element inversion (the reference's INVERTED ELEMENTS warning) without paying for a second pass.
        const float Determinant = Determinant4(Local[0], Local[1], Local[2], Local[3]) / 6.0f;
        const float RestVolume = TetRestVolume[Element];
        if (RestVolume > 0.0f) MinimumDeformationDeterminant = std::min(MinimumDeformationDeterminant,
                                                                      Determinant / RestVolume);

        Vec3 Forces[4];
        TetElementForces(Local, InverseGradient, RestVolume, Mu, Lambda, Settings.InflationPressure, Forces);
        for (std::size_t K = 0; K < 4; ++K) NodeForces[Ids[K]] += Forces[K];
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SUBSTEP
//------------------------------------------------------------------------------------------------------------------------
void FemTyreModel::IntegrateSubstep(float DeltaSeconds, const TyreStep& Input) noexcept
{
    AccumulateTetForces();

    const Vec3 SpinAxis = Input.Hub.Orientation.Rotate({0.0f, 1.0f, 0.0f});
    const Vec3 AngularVelocity = Input.Hub.AngularVelocity + SpinAxis * Input.Hub.SpinRate;
    const Vec3 HubVelocity = Input.Hub.LinearVelocity;

    Vec3 SupportSum{};
    Vec3 PatchSum{};
    std::uint32_t ContactCount = 0u;
    float DeepestDeflection = 0.0f;

    for (std::size_t N = 0; N < Positions.size(); ++N)
    {
        const float Mass = NodeMass[N];
        if (!(Mass > 0.0f)) continue;

        Vec3& Position = Positions[N];
        Vec3& Velocity = Velocities[N];

        Vec3 Force = NodeForces[N] + Gravity * Mass;
        Force -= Velocity * (Settings.DampingRate * Mass);

        BeadForceOnNode[N] = Vec3{};
        if (IsBead[N])
        {
            const Vec3 Radius = BeadTargets[N] - Input.Hub.Position;
            const Vec3 TargetVelocity = HubVelocity + Cross(AngularVelocity, Radius);
            const Vec3 BeadForce = (BeadTargets[N] - Position) * Settings.BeadStiffness +
                                   (TargetVelocity - Velocity) * (Settings.BeadDampingRate * Mass);
            Force += BeadForce;
            BeadForceOnNode[N] = BeadForce;
        }

        // ── ground contact: surface query, not a heightfield, so kerbs and mesh colliders behave ────────────────────
        if (Input.Ground)
        {
            Vec3 SurfacePoint{};
            Vec3 Normal{0.0f, 0.0f, 1.0f};
            if (Input.Ground(Position, SurfacePoint, Normal))
            {
                const float Penetration = Dot(SurfacePoint - Position, Normal);
                if (Penetration > 0.0f)
                {
                    const float NormalVelocity = Dot(Velocity - Input.SurfaceVelocity, Normal);
                    const float NormalForce = std::max(
                        Settings.GroundStiffness * Penetration - Settings.GroundDampingRate * Mass * NormalVelocity,
                        0.0f);
                    const Vec3 NormalContribution = Normal * NormalForce;
                    Force += NormalContribution;
                    SupportSum += NormalContribution;

                    const Vec3 Relative = Velocity - Input.SurfaceVelocity;
                    const Vec3 Tangential = Relative - Normal * Dot(Relative, Normal);
                    const float TangentialSpeed = Tangential.Length();
                    if (TangentialSpeed > 1.0e-6f)
                    {
                        const float Limit = std::min(Settings.FrictionDampingRate * Mass * TangentialSpeed,
                                                     Settings.Friction * NormalForce);
                        Force -= Tangential * (Limit / TangentialSpeed);
                    }

                    PatchSum += Position;
                    ++ContactCount;
                    DeepestDeflection = std::max(DeepestDeflection, Penetration);
                }
            }
        }

        Velocity += Force * (DeltaSeconds / Mass);
        Position += Velocity * DeltaSeconds;
    }

    SpinAngle += Input.Hub.SpinRate * DeltaSeconds;

    ContactReaction.SupportReaction = SupportSum;
    ContactReaction.ContactCount = ContactCount;
    ContactReaction.Deflection = DeepestDeflection;
    if (ContactCount > 0u) ContactReaction.PatchCentre = PatchSum * (1.0f / static_cast<float>(ContactCount));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     REACTION
//------------------------------------------------------------------------------------------------------------------------
// The force the deformed bead spring carries is the force the road puts into the car: equal and opposite on the rim,
// taken about the hub centre so the chassis integrates a moment as well as a push.
void FemTyreModel::ResolveReaction(const Vec3& HubPosition, const Vec3& HubVelocity,
                                   const Vec3& HubAngularVelocity, float SpinRate) noexcept
{
    Vec3 RimForce{};
    Vec3 RimTorque{};
    for (std::size_t N = 0; N < Positions.size(); ++N)
    {
        if (!IsBead[N]) continue;
        const Vec3 Reaction = BeadForceOnNode[N] * -1.0f;
        RimForce += Reaction;
        RimTorque += Cross(Positions[N] - HubPosition, Reaction);
    }

    (void)HubVelocity;
    (void)HubAngularVelocity;
    (void)SpinRate;

    ContactReaction.RimForce = RimForce;
    ContactReaction.RimTorque = RimTorque;
    // Summary in the vehicle layer's {Fx, Fy, Fz} slot: world components are what the chassis consumes.
    ContactReaction.Force = RimForce;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       STEP
//------------------------------------------------------------------------------------------------------------------------
void FemTyreModel::Step(const TyreStep& Input) noexcept
{
    if (Positions.empty()) return;

    // Explicit-FEM stability: the critical step scales with sqrt(density / E). The reference clamps to 1e-4 s at the
    // defaults and scales down for a stiffer or lighter carcass; the same rule is applied here, then a hard substep
    // cap protects frame time when a caller asks for a very long step.
    const float StabilityScale = std::sqrt((Settings.Density / 1000.0f) * (6.0e6f /
        std::max(Settings.YoungsModulus, 1.0e3f)));
    const float SubstepLimit = Settings.StepLimit * std::min(1.0f, StabilityScale);

    const float Delta = std::max(Input.DeltaSeconds, 0.0f);
    std::uint32_t Substeps = 1u;
    if (SubstepLimit > 0.0f)
        Substeps = static_cast<std::uint32_t>(std::ceil(Delta / SubstepLimit));
    Substeps = std::max<std::uint32_t>(Substeps, 1u);
    Substeps = std::min(Substeps, std::max<std::uint32_t>(Settings.MaxSubsteps, 1u));

    const float SubstepSeconds = (Substeps > 0u) ? Delta / static_cast<float>(Substeps) : 0.0f;
    LastSubstepSeconds = SubstepSeconds;
    LastSubstepCount = Substeps;

    // The hub pose handed in is the pose at the END of the step; walk it backwards across the substeps so the anchors
    // never teleport.
    for (std::uint32_t Substep = 0; Substep < Substeps; ++Substep)
    {
        const float Remaining = Delta - static_cast<float>(Substep) * SubstepSeconds;
        const Vec3 HubPosition = Input.Hub.Position - Input.Hub.LinearVelocity * Remaining;

        ResolveBeadTargets(HubPosition, Input.Hub.Orientation);
        IntegrateSubstep(SubstepSeconds, Input);
    }

    ResolveReaction(Input.Hub.Position, Input.Hub.LinearVelocity, Input.Hub.AngularVelocity, Input.Hub.SpinRate);
}

} // namespace Frontier::Vehicle
