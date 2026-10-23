/*==========================================================================================================================================
                                                JOLT PHYSICS VALIDATION
==========================================================================================================================================*/
// 🧩 Native Jolt C++ rigid-body lifecycle, fixed-step accumulation and ground-contact validation.

#include "Engine/PhysicalDynamics/RigidBodySolver.h"

#include <cmath>
#include <cstdio>
#include <string>

int main()
{
    using namespace Frontier;
    RigidBodySolver Solver;
    RigidBodyConfiguration Configuration;
    Configuration.FixedStepSeconds = 1.0f / 120.0f;
    Configuration.WorkerThreads = 1;
    if (!Solver.Bring(Configuration))
    {
        std::printf("FAIL Jolt initialization: %s\n", Solver.QueryLastRefusal().c_str());
        return 1;
    }
    if (std::string(RigidBodySolver::QueryBackendVersion()) != "Jolt 5.3.0")
    {
        std::printf("FAIL expected reference-pinned native Jolt 5.3.0, got %s\n", RigidBodySolver::QueryBackendVersion());
        return 1;
    }

    RigidBodyDescription Ground;
    Ground.Name = "validation-ground";
    Ground.Motion = RigidBodyMotionCategory::Static;
    Ground.Shape.Category = CollisionShapeCategory::Plane;
    const RigidBodyIdentity GroundIdentity = Solver.CreateBody(Ground);

    RigidBodyDescription Crate;
    Crate.Name = "validation-crate";
    Crate.Shape.Category = CollisionShapeCategory::Box;
    Crate.Shape.HalfExtents = {0.25f, 0.25f, 0.25f};
    Crate.Position = {0.0f, 0.0f, 2.0f};
    Crate.MassKilograms = 10.0f;
    Crate.Friction = 0.7f;
    Crate.Restitution = 0.0f;
    const RigidBodyIdentity CrateIdentity = Solver.CreateBody(Crate);
    if (GroundIdentity == InvalidRigidBody || CrateIdentity == InvalidRigidBody || Solver.QueryMetrics().BodyCount != 2)
    {
        std::printf("FAIL Jolt body construction: %s\n", Solver.QueryLastRefusal().c_str());
        return 1;
    }

    for (uint32_t Index = 0; Index < 600; ++Index)
    {
        Solver.Advance(1.0f / 120.0f);
    }
    RigidBodyPose CratePose;
    if (!Solver.QueryPose(CrateIdentity, CratePose) || !std::isfinite(CratePose.Position.z) ||
        std::abs(CratePose.Position.z - 0.25f) > 0.04f || Solver.QueryMetrics().StepCount != 600)
    {
        std::printf("FAIL Jolt fixed-step settling: z=%.7f steps=%llu\n",
                    CratePose.Position.z, static_cast<unsigned long long>(Solver.QueryMetrics().StepCount));
        return 1;
    }

    const RigidBodyMetrics BeforeDestroy = Solver.QueryMetrics();
    Solver.DestroyBody(CrateIdentity);
    if (Solver.QueryMetrics().BodyCount + 1 != BeforeDestroy.BodyCount)
    {
        std::printf("FAIL Jolt body destruction\n");
        return 1;
    }

    RigidBodyDescription InvalidPlane = Ground;
    InvalidPlane.Motion = RigidBodyMotionCategory::Dynamic;
    if (Solver.CreateBody(InvalidPlane) != InvalidRigidBody || Solver.QueryLastRefusal().empty())
    {
        std::printf("FAIL dynamic plane was not refused\n");
        return 1;
    }

    Solver.Retire();
    if (Solver.IsReady())
    {
        std::printf("FAIL Jolt world did not retire\n");
        return 1;
    }

    std::printf("Jolt native validation: rigid-body lifecycle, fixed stepping, contact and refusal checks passed (%s)\n",
                RigidBodySolver::QueryBackendVersion());
    return 0;
}
