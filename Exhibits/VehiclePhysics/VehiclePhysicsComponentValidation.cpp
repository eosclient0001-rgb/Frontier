#include "Engine/PhysicalDynamics/Vehicle/VehiclePhysicsComponent.h"

#include <cmath>
#include <cstdio>

int main()
{
    using namespace Frontier;
    using namespace Frontier::Vehicle;

    VehiclePhysicsComponent Vehicle;
    VehiclePhysicsComponentConfiguration Configuration;
    Configuration.Physics.FixedStepSeconds = 1.0f / 120.0f;
    Configuration.Physics.WorkerThreads = 1;
    Configuration.Dynamics.Aero.Enabled = false;
    if (!Vehicle.Bring(Configuration) || !Vehicle.IsReady())
    {
        std::printf("FAIL vehicle component Bring\n");
        return 1;
    }

    DriverInput Input{};
    Vehicle.AssignInput(Input);
    for (uint32_t Tick = 0; Tick < 360; ++Tick)
    {
        if (!Vehicle.StepFixed())
        {
            std::printf("FAIL component fixed-step during contact settle at %u\n", Tick);
            return 1;
        }
    }

    const VehicleTelemetry& Rest = Vehicle.Telemetry();
    if (!Rest.PacejkaActive || Rest.WheelCount != 4u || Rest.WheelsInContact != 4u ||
        !std::isfinite(Rest.TotalVerticalLoad) || Rest.TotalVerticalLoad < 5000.0f)
    {
        std::printf("FAIL composed vehicle state: pacejka=%d wheels=%u contact=%u load=%.1f\n",
                    Rest.PacejkaActive, Rest.WheelCount, Rest.WheelsInContact, Rest.TotalVerticalLoad);
        return 1;
    }

    Input.Throttle = 0.75f;
    Vehicle.AssignInput(Input);
    for (uint32_t Tick = 0; Tick < 480; ++Tick)
        if (!Vehicle.StepFixed()) return 1;

    RigidBodyPose Driven{};
    if (!Vehicle.QueryChassisPose(Driven) || !std::isfinite(Driven.LinearVelocity.x) || Driven.LinearVelocity.x < 1.0f ||
        Vehicle.Telemetry().Wheels[2].WheelOmega <= 0.0f || Vehicle.Telemetry().GearboxDriveTorque_Nm <= 0.0f)
    {
        std::printf("FAIL drivetrain/tyre-to-chassis integration: vx=%.3f omega=%.3f torque=%.3f\n",
                    Driven.LinearVelocity.x, Vehicle.Telemetry().Wheels[2].WheelOmega,
                    Vehicle.Telemetry().GearboxDriveTorque_Nm);
        return 1;
    }
    const float SpeedBeforeBraking = Driven.LinearVelocity.x;

    Input.Throttle = 0.0f;
    Input.Brake = 1.0f;
    Vehicle.AssignInput(Input);
    for (uint32_t Tick = 0; Tick < 360; ++Tick)
        if (!Vehicle.StepFixed()) return 1;

    RigidBodyPose Braked{};
    if (!Vehicle.QueryChassisPose(Braked) || !std::isfinite(Braked.LinearVelocity.x) ||
        Braked.LinearVelocity.x >= SpeedBeforeBraking)
    {
        std::printf("FAIL brake integration: before=%.3f after=%.3f\n",
                    SpeedBeforeBraking, Braked.LinearVelocity.x);
        return 1;
    }

    Vehicle.Retire();
    if (Vehicle.IsReady() || Vehicle.Chassis() != InvalidRigidBody || Vehicle.StepFixed())
    {
        std::printf("FAIL vehicle component retirement\n");
        return 1;
    }
    std::printf("VehiclePhysicsComponent passed: 4-wheel suspension/contact, drivetrain, tyres, brakes and Jolt lifecycle\n");
    return 0;
}
