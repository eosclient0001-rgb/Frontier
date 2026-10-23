#include "Engine/PhysicalDynamics/RigidBodySolver.h"
#include "Engine/PhysicalDynamics/Vehicle/JoltVehicleBinding.h"
#include "Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"

#include <cmath>
#include <cstdio>

int main()
{
    using namespace Frontier;
    using namespace Frontier::Vehicle;

    RigidBodySolver World;
    RigidBodyConfiguration Physics;
    Physics.FixedStepSeconds = 1.0f / 120.0f;
    Physics.WorkerThreads = 1;
    if (!World.Bring(Physics))
    {
        std::printf("FAIL Jolt initialization: %s\n", World.QueryLastRefusal().c_str());
        return 1;
    }

    RigidBodyDescription GroundBody;
    GroundBody.Name = "vehicle-test-asphalt";
    GroundBody.Motion = RigidBodyMotionCategory::Static;
    GroundBody.Shape.Category = CollisionShapeCategory::Plane;
    GroundBody.Friction = 0.82f;
    GroundBody.Restitution = 0.0f;
    if (World.CreateBody(GroundBody) == InvalidRigidBody) return 1;

    VehicleGeometry Geometry;
    VehicleSolverConfiguration Vehicle;
    ApplyGeometry(Vehicle, Geometry);
    Vehicle.Aero.Enabled = false;
    Vehicle.ActiveScheme = DrivingScheme::PacejkaDrivetrain;

    RigidBodyDescription Chassis;
    Chassis.Name = "ControlVehicle-chassis";
    Chassis.Motion = RigidBodyMotionCategory::Dynamic;
    Chassis.Shape.Category = CollisionShapeCategory::Box;
    Chassis.Shape.HalfExtents = {2.3f, 1.15f, 0.20f};
    Chassis.Position = {0.0f, 0.0f, Geometry.CoMHeight};
    Chassis.MassKilograms = Geometry.Mass;
    Chassis.Friction = 0.9f;
    Chassis.Restitution = 0.0f;
    Chassis.LinearDamping = 0.015f;
    Chassis.AngularDamping = 0.025f;
    const RigidBodyIdentity ChassisId = World.CreateBody(Chassis);
    if (ChassisId == InvalidRigidBody) return 1;

    JoltVehicleBinding Binding(World, ChassisId);
    Vector3 Surface{}, Normal{};
    float AsphaltFriction = 0.0f;
    if (!World.QuerySurface({0.0f, 0.0f, 2.0f}, {0.0f, 0.0f, -1.0f}, 4.0f,
                            ChassisId, Surface, Normal, AsphaltFriction) ||
        std::abs(Surface.z) > 0.01f || std::abs(Normal.z - 1.0f) > 0.01f ||
        std::abs(AsphaltFriction - 0.82f) > 0.01f)
    {
        std::printf("FAIL Jolt surface query: z=%.4f normalZ=%.4f friction=%.3f\n",
                    Surface.z, Normal.z, AsphaltFriction);
        return 1;
    }
    if (!Binding.Build(Vehicle, {}) || !Binding.IsBuilt())
    {
        std::printf("FAIL vehicle/Jolt binding construction\n");
        return 1;
    }

    DriverInput Input;
    for (uint32_t Tick = 0; Tick < 360; ++Tick)
    {
        Binding.AssignInput(Input);
        if (!Binding.StepFixed())
        {
            std::printf("FAIL vehicle/Jolt fixed step at tick %u\n", Tick);
            return 1;
        }
    }

    const VehicleTelemetry& Settled = Binding.Telemetry();
    if (Settled.WheelsInContact != 4u || !std::isfinite(Settled.Chassis.Position.z))
    {
        std::printf("FAIL vehicle contact/material setup: contacts=%u z=%.4f\n",
                    Settled.WheelsInContact, Settled.Chassis.Position.z);
        return 1;
    }

    Input.Throttle = 0.75f;
    for (uint32_t Tick = 0; Tick < 480; ++Tick)
    {
        Binding.AssignInput(Input);
        if (!Binding.StepFixed()) return 1;
    }
    RigidBodyPose Driven;
    if (!World.QueryPose(ChassisId, Driven) || !std::isfinite(Driven.LinearVelocity.x) || Driven.LinearVelocity.x < 1.0f)
    {
        std::printf("FAIL native vehicle did not accelerate its Jolt chassis: vx=%.4f\n", Driven.LinearVelocity.x);
        return 1;
    }

    std::printf("Jolt vehicle binding validation passed: four tyre contacts, asphalt μ=0.82 and chassis drive vx=%.3f m/s\n",
                Driven.LinearVelocity.x);
    World.Retire();
    return 0;
}
