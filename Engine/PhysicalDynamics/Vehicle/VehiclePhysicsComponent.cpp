//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Vehicle/VehiclePhysicsComponent.cpp — vehicle system composition and lifetime
//============================================================================================================================================
#include "VehiclePhysicsComponent.h"

namespace Frontier::Vehicle {

VehiclePhysicsComponent::~VehiclePhysicsComponent() noexcept
{
    Retire();
}

bool VehiclePhysicsComponent::Bring(const VehiclePhysicsComponentConfiguration& Configuration,
                                    GroundQuery Ground,
                                    std::function<float(const Vec3&)> RoadFrictionAt) noexcept
{
    Retire();
    if (!World.Bring(Configuration.Physics)) return false;

    if (Configuration.CreateFlatRoad)
    {
        RigidBodyDescription Road;
        Road.Name = "VehiclePhysicsComponent-road";
        Road.Motion = RigidBodyMotionCategory::Static;
        Road.Shape.Category = CollisionShapeCategory::Plane;
        Road.Shape.PlaneNormal = {0.0f, 0.0f, 1.0f};
        Road.Shape.PlaneOffset = 0.0f;
        Road.Shape.PlaneHalfExtent = Configuration.RoadHalfExtent;
        Road.Friction = Configuration.RoadFriction;
        Road.Restitution = 0.0f;
        if (World.CreateBody(Road) == InvalidRigidBody)
        {
            Retire();
            return false;
        }
    }

    RigidBodyDescription Body;
    Body.Name = "ControlVehicle-chassis";
    Body.Motion = RigidBodyMotionCategory::Dynamic;
    Body.Shape = Configuration.ChassisShape;
    Body.Position = Configuration.InitialPosition;
    Body.Orientation = Configuration.InitialOrientation;
    Body.MassKilograms = Configuration.Geometry.Mass;
    Body.Friction = Configuration.ChassisFriction;
    Body.Restitution = Configuration.ChassisRestitution;
    Body.LinearDamping = 0.015f;
    Body.AngularDamping = 0.025f;
    ChassisIdentity = World.CreateBody(Body);
    if (ChassisIdentity == InvalidRigidBody)
    {
        Retire();
        return false;
    }

    VehicleSolverConfiguration Dynamics = Configuration.Dynamics;
    ApplyGeometry(Dynamics, Configuration.Geometry);
    Binding = std::make_unique<JoltVehicleBinding>(World, ChassisIdentity);
    if (!Binding->Build(Dynamics, std::move(Ground), std::move(RoadFrictionAt)))
    {
        Retire();
        return false;
    }

    PendingInput = {};
    Ready = true;
    return true;
}

void VehiclePhysicsComponent::Retire() noexcept
{
    Ready = false;
    Binding.reset();
    ChassisIdentity = InvalidRigidBody;
    if (World.IsReady()) World.Retire();
}

bool VehiclePhysicsComponent::StepFixed() noexcept
{
    if (!Ready || Binding == nullptr) return false;
    Binding->AssignInput(PendingInput);
    return Binding->StepFixed();
}

const VehicleTelemetry& VehiclePhysicsComponent::Telemetry() const noexcept
{
    return Binding != nullptr ? Binding->Telemetry() : EmptyTelemetry;
}

bool VehiclePhysicsComponent::QueryChassisPose(RigidBodyPose& Pose) const noexcept
{
    return Ready && ChassisIdentity != InvalidRigidBody && World.QueryPose(ChassisIdentity, Pose);
}

} // namespace Frontier::Vehicle
