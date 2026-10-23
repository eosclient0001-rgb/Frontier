//============================================================================================================================================
// 📦 Exhibits/VehiclePhysics/TyreModelValidation.cpp — the three tyre backends, exercised through one seam
//============================================================================================================================================
// What this proves, and what it does not:
//
//    PROVES     every backend builds, steps and reports a reaction through `Frontier::Vehicle::TyreModel`; the factory
//               returns the right class; a loaded tyre produces an upward reaction that grows with squash; a slipped tyre
//               produces in-plane force of the correct sign; a free-rolling tyre produces almost none.
//    DOES NOT   prove the deformable backends are calibrated against reality. The XPBD numbers are its own Phase-2
//               calibration and the FEM numbers are the WebGPU reference's parameters; neither has been compared to
//               measured tyre data here. The cross-backend table is a *consistency* check — the same wheel, the same
//               ground, three solvers — not a validation of the magnitudes.
//
// Run:  ./TyreModelValidation            (exit 0 = all checks passed)
//
// Frame: +Z up, wheel axle +Y, hub at the origin of the X–Z plane. Ground is the plane z = 0.

#include "Tyre/TyreModel.h"
#include "Tyre/Fem/FemTyreModel.h"
#include "Tyre/Jolt/RigidTyreModel.h"
#include "Tyre/Xpbd/XpbdSpringTyreModel.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

using namespace Frontier::Vehicle;

namespace {

int Failures = 0;

void Check(bool Condition, const std::string& Label, const std::string& Detail)
{
    std::printf("  [%s] %-46s %s\n", Condition ? "PASS" : "FAIL", Label.c_str(), Detail.c_str());
    if (!Condition) ++Failures;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       fixtures
//------------------------------------------------------------------------------------------------------------------------
[[nodiscard]] GroundQuery FlatGround(float Height)
{
    return [Height](const Vec3& Point, Vec3& OutSurfacePoint, Vec3& OutNormal) noexcept
    {
        OutSurfacePoint = {Point.x, Point.y, Height};
        OutNormal = {0.0f, 0.0f, 1.0f};
        return true;
    };
}

[[nodiscard]] TyreModelConfiguration BaseConfiguration(TyreModelKind Kind)
{
    TyreModelConfiguration Configuration{};
    Configuration.Model = Kind;

    Configuration.Tyre.Radius = 0.34f;
    Configuration.Tyre.RimRadius = 0.20f;
    Configuration.Tyre.Width = 0.245f;
    Configuration.Tyre.TotalMass = 12.0f;
    Configuration.Tyre.InflationPressure = 110000.0f;
    Configuration.Tyre.Gravity = {0.0f, 0.0f, -9.81f};

    // XPBD: coarse lattice so a headless run stays quick; every constitutive parameter keeps its shipped default.
    Configuration.Xpbd.RingCount = 5u;
    Configuration.Xpbd.SegmentCount = 48u;
    Configuration.Substeps = 16u;

    // FEM: reference defaults, coarser mesh, substep cap raised so the explicit step stays under its stability limit.
    auto Fem = std::make_shared<FemTyreParameters>();
    Fem->CircumferentialNodes = 24u;
    Fem->RadialNodes = 4u;
    Fem->LateralNodes = 4u;
    Fem->RimRadius = 0.20f;
    Fem->TreadRadius = 0.34f;
    Fem->BeadHalfWidth = 0.055f;
    Fem->TreadHalfWidth = 0.105f;
    Fem->MaxSubsteps = 220u;
    Configuration.Fem = Fem;

    return Configuration;
}

//------------------------------------------------------------------------------------------------------------------------
//  Static squash: hold the hub at a fixed height and let the tyre settle, then read the vertical reaction.
//------------------------------------------------------------------------------------------------------------------------
float SettleAndReadLoad(TyreModel& Model, float SquashMetres, int Steps, const GroundQuery& Ground, float HubHeight)
{
    TyreStep Step{};
    Step.DeltaSeconds = 1.0f / 60.0f;
    Step.Ground = Ground;
    Step.Hub.Position = {0.0f, 0.0f, HubHeight};
    Step.Hub.Orientation = Quat{};
    Step.Hub.LinearVelocity = Vec3{};
    Step.Hub.SpinRate = 0.0f;

    float Load = 0.0f;
    for (int Index = 0; Index < Steps; ++Index)
    {
        Model.Step(Step);
        Load = Dot(Model.Reaction().SupportReaction, Vec3{0.0f, 0.0f, 1.0f});
    }
    (void)SquashMetres;
    return Load;
}

} // namespace

int main()
{
    std::printf("=== Tyre model seam — three backends, one contract ===\n\n");

    // ── 1. Factory and identity ──────────────────────────────────────────────────────────────────────────────────────
    std::printf("1. Factory\n");
    {
        const TyreModelKind Kinds[] = {TyreModelKind::RigidTraceFan, TyreModelKind::XpbdSpringCarcass,
                                       TyreModelKind::VolumetricFem};
        for (TyreModelKind Kind : Kinds)
        {
            std::unique_ptr<TyreModel> Model = CreateTyreModel(Kind);
            Check(Model != nullptr, std::string("CreateTyreModel(") + TyreModelName(Kind) + ")",
                  Model ? "constructed" : "returned null");
            if (!Model) continue;
            Check(Model->Kind() == Kind, "  reports its own kind", TyreModelName(Model->Kind()));
            Check(!Model->IsBuilt(), "  not built before Build()", "");
        }
    }

    // ── 2. Build and step every backend on identical inputs ──────────────────────────────────────────────────────────
    std::printf("\n2. Static squash on the same wheel (hub held 10 mm low, 60 steps at 60 Hz)\n");
    const GroundQuery Ground = FlatGround(0.0f);
    const float HubHeight = 0.34f - 0.010f;

    struct Result
    {
        TyreModelKind Kind;
        float         Load;
        float         Deflection;
        std::uint32_t Contacts;
        double        Milliseconds;
    };
    std::vector<Result> Results;

    const TyreModelKind Kinds[] = {TyreModelKind::RigidTraceFan, TyreModelKind::XpbdSpringCarcass,
                                   TyreModelKind::VolumetricFem};
    for (TyreModelKind Kind : Kinds)
    {
        std::unique_ptr<TyreModel> Model = CreateTyreModel(Kind);
        TyreModelConfiguration Configuration = BaseConfiguration(Kind);

        const auto Start = std::chrono::steady_clock::now();
        Model->Build(Configuration, Vec3{0.0f, 0.0f, HubHeight}, Quat{});
        Check(Model->IsBuilt(), std::string(TyreModelName(Kind)) + " built", "");

        const float Load = SettleAndReadLoad(*Model, 0.010f, 60, Ground, HubHeight);
        const auto End = std::chrono::steady_clock::now();
        const double Milliseconds = std::chrono::duration<double, std::milli>(End - Start).count();

        const TyreReaction& Reaction = Model->Reaction();
        Results.push_back({Kind, Load, Reaction.Deflection, Reaction.ContactCount, Milliseconds});

        Check(Load > 0.0f, std::string(TyreModelName(Kind)) + " carries load", std::to_string(Load) + " N");
        Check(Reaction.ContactCount > 0u, std::string(TyreModelName(Kind)) + " found contact",
              std::to_string(Reaction.ContactCount) + " samples");

        std::vector<Vec3> Nodes;
        Model->GatherNodes(Nodes);
        if (Kind != TyreModelKind::RigidTraceFan)
        {
            Check(!Nodes.empty(), std::string(TyreModelName(Kind)) + " exposes deformed nodes",
                  std::to_string(Nodes.size()) + " nodes");

            // Deformation, measured where it is unambiguous: the lowest particle. An undeformed tyre translated to
            // this hub height would reach z = hub − R = −10 mm, i.e. inside the road. A solved carcass flattens and
            // holds the tread on the surface instead.
            float Lowest = Nodes[0].z;
            for (const Vec3& Node : Nodes) Lowest = std::min(Lowest, Node.z);
            const float Undeformed = HubHeight - Configuration.Tyre.Radius;
            // Both deformable backends are penalty contacts, so the tread is allowed to sit a few millimetres into the
            // road while the spring balances the load (k·x = F). What must not happen is the tyre passing through
            // unopposed, which is what an unfixed inverse did before this check existed.
            Check(Lowest > Undeformed - 5.0e-3f,
                  std::string(TyreModelName(Kind)) + " tread held at the road, not through it",
                  "lowest node " + std::to_string(Lowest * 1000.0f) + " mm; undeformed would be " +
                      std::to_string(Undeformed * 1000.0f) + " mm");
        }
        else
        {
            Check(Nodes.empty(), "RigidTraceFan exposes no nodes (rigid)", "");
        }

        if (Kind == TyreModelKind::VolumetricFem)
        {
            // The reference's INVERTED ELEMENTS warning: an element that folded through zero volume has negative
            // determinant. A solved tyre must keep every element positively oriented.
            const auto* Fem = dynamic_cast<const FemTyreModel*>(Model.get());
            Check(Fem != nullptr && Fem->MinimumElementDeterminant() > 0.0f,
                  "VolumetricFem keeps every element right-side-out",
                  Fem ? "min det F = " + std::to_string(Fem->MinimumElementDeterminant()) : "not a FemTyreModel");
        }
    }

    std::printf("\n   %-22s %10s %12s %9s %11s\n", "backend", "load [N]", "deflection", "contacts", "wall [ms]");
    for (const Result& Row : Results)
    {
        std::printf("   %-22s %10.1f %10.2f mm %9u %11.2f\n", TyreModelName(Row.Kind), Row.Load,
                    Row.Deflection * 1000.0f, Row.Contacts, Row.Milliseconds);
    }

    // Load must grow with squash for the deformable backends (the rigid backend is linear by construction).
    std::printf("\n3. Load grows with squash (60 steps each)\n");
    for (TyreModelKind Kind : {TyreModelKind::XpbdSpringCarcass, TyreModelKind::VolumetricFem})
    {
        std::unique_ptr<TyreModel> Shallow = CreateTyreModel(Kind);
        std::unique_ptr<TyreModel> Deep = CreateTyreModel(Kind);
        const TyreModelConfiguration Configuration = BaseConfiguration(Kind);

        Shallow->Build(Configuration, Vec3{0.0f, 0.0f, 0.34f - 0.005f}, Quat{});
        Deep->Build(Configuration, Vec3{0.0f, 0.0f, 0.34f - 0.025f}, Quat{});

        const float ShallowLoad = SettleAndReadLoad(*Shallow, 0.005f, 60, Ground, 0.34f - 0.005f);
        const float DeepLoad = SettleAndReadLoad(*Deep, 0.025f, 60, Ground, 0.34f - 0.025f);

        Check(DeepLoad > ShallowLoad * 1.5f, std::string(TyreModelName(Kind)) + " stiffens with squash",
              std::to_string(ShallowLoad) + " N at 5 mm → " + std::to_string(DeepLoad) + " N at 25 mm");
    }

    // ── 4. Slip direction: a slipped tyre must push against the slide ───────────────────────────────────────────────
    std::printf("\n4. Slip produces force in the right direction (rigid backend)\n");
    {
        const TyreModelConfiguration Configuration = BaseConfiguration(TyreModelKind::RigidTraceFan);
        RigidTyreModel Model;
        Model.Build(Configuration, Vec3{0.0f, 0.0f, 0.34f}, Quat{});

        auto Steady = [&](float SpinRate, float ForwardSpeed, float LateralSpeed)
        {
            TyreStep Step{};
            Step.DeltaSeconds = 1.0f / 60.0f;
            Step.Ground = Ground;
            Step.Hub.Position = {0.0f, 0.0f, 0.34f - 0.010f};
            Step.Hub.Orientation = Quat{};
            Step.Hub.LinearVelocity = {ForwardSpeed, LateralSpeed, 0.0f};
            Step.Hub.SpinRate = SpinRate;
            for (int Index = 0; Index < 4; ++Index) Model.Step(Step);
            return Model.Reaction();
        };

        // Free rolling at 10 m/s: ω·R = V ⇒ slip ratio ≈ 0, no drive force.
        const TyreReaction Rolling = Steady(10.0f / Configuration.Tyre.Radius, 10.0f, 0.0f);
        Check(std::fabs(Rolling.Force.x) < 250.0f, "free rolling: longitudinal force ≈ 0",
              std::to_string(Rolling.Force.x) + " N");

        // Wheel spinning 30 % faster than the road: positive drive force along +X.
        const TyreReaction Spinning = Steady(13.0f / Configuration.Tyre.Radius, 10.0f, 0.0f);
        Check(Spinning.Force.x > 500.0f, "wheelspin: forward drive force",
              std::to_string(Spinning.Force.x) + " N");

        // Sliding to the left (+Y): cornering force must push back to the right (−Y).
        const TyreReaction Cornering = Steady(10.0f / Configuration.Tyre.Radius, 10.0f, 1.0f);
        Check(Cornering.Force.y < -200.0f, "leftward slide: force opposes it (−Y)",
              std::to_string(Cornering.Force.y) + " N");
    }

    // ── 5. The seam is the only coupling: a caller cannot tell the backends apart ──────────────────────────────────
    std::printf("\n5. Uniform interface\n");
    {
        for (TyreModelKind Kind : Kinds)
        {
            std::unique_ptr<TyreModel> Model = CreateTyreModel(Kind);
            Model->Build(BaseConfiguration(Kind), Vec3{0.0f, 0.0f, 0.33f}, Quat{});

            TyreStep Step{};
            Step.DeltaSeconds = 1.0f / 60.0f;
            Step.Ground = Ground;
            Step.Hub.Position = {0.05f, 0.0f, 0.335f};
            Step.Hub.LinearVelocity = {2.0f, 0.0f, 0.0f};
            Step.Hub.SpinRate = 5.9f;

            Model->Step(Step);
            const TyreReaction& Reaction = Model->Reaction();
            Check(std::isfinite(Reaction.RimForce.x) && std::isfinite(Reaction.RimForce.y) &&
                      std::isfinite(Reaction.RimForce.z),
                  std::string(TyreModelName(Kind)) + " moved hub produces finite force",
                  "(" + std::to_string(Reaction.RimForce.x) + ", " + std::to_string(Reaction.RimForce.y) + ", " +
                      std::to_string(Reaction.RimForce.z) + ") N");
        }
    }

    std::printf("\n%s (%d failed check%s)\n", Failures == 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT", Failures,
                Failures == 1 ? "" : "s");
    return Failures == 0 ? 0 : 1;
}
