//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Vehicle/VehiclePhysicsComponent.h — complete drivable vehicle lifecycle component
//============================================================================================================================================
#pragma once

#include "JoltVehicleBinding.h"
#include "VehicleGeometry.h"

#include <memory>

namespace Frontier::Vehicle {

struct VehiclePhysicsComponentConfiguration
{
    VehiclePhysicsComponentConfiguration() noexcept
    {
        ChassisShape.Category = CollisionShapeCategory::Box;
        ChassisShape.HalfExtents = {2.3f, 1.15f, 0.20f};
    }

    RigidBodyConfiguration Physics{};
    VehicleGeometry Geometry{};
    VehicleSolverConfiguration Dynamics{};
    CollisionShapeDescription ChassisShape{};
    Vector3 InitialPosition{0.0f, 0.0f, 0.53f};
    Quaternion InitialOrientation = Quaternion::Identity();
    float ChassisFriction = 0.9f;
    float ChassisRestitution = 0.0f;
    float RoadFriction = 0.82f;
    bool CreateFlatRoad = true;
    float RoadHalfExtent = 500.0f;
};

// Engine-facing component that owns the Jolt world, road and ControlVehicle chassis, and composes the native drivetrain,
// suspension, four tyre models and vehicle-level systems through JoltVehicleBinding. Custom scenes may omit the flat road
// and provide their own ground/material callbacks. Advance exactly once per configured fixed step.
class VehiclePhysicsComponent
{
public:
    VehiclePhysicsComponent() noexcept = default;
    ~VehiclePhysicsComponent() noexcept;
    VehiclePhysicsComponent(const VehiclePhysicsComponent&) = delete;
    VehiclePhysicsComponent& operator=(const VehiclePhysicsComponent&) = delete;

    [[nodiscard]] bool Bring(const VehiclePhysicsComponentConfiguration& Configuration,
                             GroundQuery Ground = {},
                             std::function<float(const Vec3&)> RoadFrictionAt = {}) noexcept;
    void Retire() noexcept;
    void AssignInput(const DriverInput& Input) noexcept { PendingInput = Input; }
    [[nodiscard]] bool StepFixed() noexcept;

    [[nodiscard]] bool IsReady() const noexcept { return Ready; }
    [[nodiscard]] RigidBodyIdentity Chassis() const noexcept { return ChassisIdentity; }
    [[nodiscard]] const VehicleTelemetry& Telemetry() const noexcept;
    [[nodiscard]] bool QueryChassisPose(RigidBodyPose& Pose) const noexcept;
    [[nodiscard]] RigidBodySolver& PhysicsWorld() noexcept { return World; }
    [[nodiscard]] const RigidBodySolver& PhysicsWorld() const noexcept { return World; }

private:
    RigidBodySolver World;
    std::unique_ptr<JoltVehicleBinding> Binding;
    RigidBodyIdentity ChassisIdentity = InvalidRigidBody;
    DriverInput PendingInput{};
    VehicleTelemetry EmptyTelemetry{};
    bool Ready = false;
};

} // namespace Frontier::Vehicle
