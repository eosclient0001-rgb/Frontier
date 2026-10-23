//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Vehicle/JoltVehicleBinding.h — fixed-step bridge from the native vehicle model to Jolt
//============================================================================================================================================
#pragma once

#include "../RigidBodySolver.h"
#include "VehicleSolver.h"

namespace Frontier::Vehicle {

// Binds the engine-agnostic vehicle dynamics to a dynamic Jolt chassis. The scene supplies its ground-surface query and
// road-material friction sampler (e.g. from a heightfield or collision-world query). Tyre/suspension forces are applied
// to the Jolt chassis at their physical points; Jolt remains the authority for chassis pose and velocity integration.
class JoltVehicleBinding
{
public:
    JoltVehicleBinding(RigidBodySolver& World, RigidBodyIdentity Chassis) noexcept;

    [[nodiscard]] bool Build(const VehicleSolverConfiguration& Configuration,
                             GroundQuery Ground,
                             std::function<float(const Vec3&)> RoadFrictionAt = {}) noexcept;

    void AssignInput(const DriverInput& Input) noexcept { Dynamics.AssignInput(Input); }
    // Exactly one fixed step: vehicle forces are accumulated first, then Jolt integrates one matching fixed step.
    [[nodiscard]] bool StepFixed() noexcept;

    [[nodiscard]] const VehicleTelemetry& Telemetry() const noexcept { return Dynamics.Telemetry(); }
    [[nodiscard]] bool IsBuilt() const noexcept { return Dynamics.Constructed(); }

private:
    RigidBodySolver* PhysicsWorld = nullptr;
    RigidBodyIdentity ChassisBody = InvalidRigidBody;
    VehicleSolverConfiguration ActiveConfiguration;
    VehicleSolver Dynamics;
};

} // namespace Frontier::Vehicle
