//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Vehicle/JoltVehicleBinding.cpp — native vehicle/Jolt coupling
//============================================================================================================================================
#include "JoltVehicleBinding.h"

namespace Frontier::Vehicle {
namespace {

[[nodiscard]] Vec3 ToVehicle(const Frontier::Vector3& Value) noexcept
{
    return {Value.x, Value.y, Value.z};
}

[[nodiscard]] Quat ToVehicle(const Frontier::Quaternion& Value) noexcept
{
    return {Value.x, Value.y, Value.z, Value.w};
}

[[nodiscard]] Frontier::Vector3 ToRigidBody(const Vec3& Value) noexcept
{
    return {Value.x, Value.y, Value.z};
}

[[nodiscard]] ChassisState ToVehicle(const Frontier::RigidBodyPose& Pose) noexcept
{
    return {ToVehicle(Pose.Position), ToVehicle(Pose.Orientation),
            ToVehicle(Pose.LinearVelocity), ToVehicle(Pose.AngularVelocity)};
}

} // namespace

JoltVehicleBinding::JoltVehicleBinding(RigidBodySolver& World, RigidBodyIdentity Chassis) noexcept
    : PhysicsWorld(&World), ChassisBody(Chassis)
{
}

bool JoltVehicleBinding::Build(const VehicleSolverConfiguration& Configuration,
                               GroundQuery Ground,
                               std::function<float(const Vec3&)> RoadFrictionAt) noexcept
{
    if (PhysicsWorld == nullptr || !PhysicsWorld->IsReady() || ChassisBody == InvalidRigidBody)
        return false;

    Frontier::RigidBodyPose Pose;
    if (!PhysicsWorld->QueryPose(ChassisBody, Pose) || Pose.Motion != Frontier::RigidBodyMotionCategory::Dynamic)
        return false;

    ActiveConfiguration = Configuration;
    VehicleSolver::Hooks Hooks;
    Hooks.ReadChassis = [this]() {
        Frontier::RigidBodyPose Current;
        if (PhysicsWorld == nullptr || !PhysicsWorld->QueryPose(ChassisBody, Current)) return ChassisState{};
        return ToVehicle(Current);
    };
    Hooks.ApplyForceAtPoint = [this](const Vec3& Force, const Vec3& Point) {
        if (PhysicsWorld != nullptr) PhysicsWorld->ApplyForceAtPoint(ChassisBody, ToRigidBody(Force), ToRigidBody(Point));
    };
    Hooks.ApplyTorque = [this](const Vec3& Torque) {
        if (PhysicsWorld != nullptr) PhysicsWorld->ApplyTorque(ChassisBody, ToRigidBody(Torque));
    };
    if (Ground)
    {
        Hooks.Ground = std::move(Ground);
    }
    else
    {
        // Default scene bridge: narrow-phase Jolt ray query, ignoring this vehicle's own chassis.
        Hooks.Ground = [this](const Vec3& Sample, Vec3& Surface, Vec3& Normal) {
            Frontier::Vector3 HitPoint{}, HitNormal{};
            float MaterialFriction = 0.0f;
            const bool Hit = PhysicsWorld->QuerySurface(ToRigidBody(Sample + Vec3{0.0f, 0.0f, 2.0f}),
                {0.0f, 0.0f, -1.0f}, 4.0f, ChassisBody, HitPoint, HitNormal, MaterialFriction);
            if (!Hit) return false;
            Surface = ToVehicle(HitPoint);
            Normal = ToVehicle(HitNormal);
            return true;
        };
    }
    if (RoadFrictionAt)
    {
        Hooks.RoadFrictionAt = std::move(RoadFrictionAt);
    }
    else
    {
        Hooks.RoadFrictionAt = [this](const Vec3& Patch) {
            Frontier::Vector3 Surface{}, Normal{};
            float Friction = 0.0f;
            const bool Hit = PhysicsWorld->QuerySurface(ToRigidBody(Patch + Vec3{0.0f, 0.0f, 2.0f}),
                {0.0f, 0.0f, -1.0f}, 4.0f, ChassisBody, Surface, Normal, Friction);
            return Hit ? Friction : 0.0f;
        };
    }
    Dynamics.Build(ActiveConfiguration, Hooks, ToVehicle(Pose));
    return Dynamics.Constructed();
}

bool JoltVehicleBinding::StepFixed() noexcept
{
    if (!IsBuilt() || PhysicsWorld == nullptr || !PhysicsWorld->IsReady()) return false;
    const float FixedStep = PhysicsWorld->QueryConfiguration().FixedStepSeconds;
    if (!(FixedStep > 0.0f)) return false;

    Dynamics.Step(FixedStep);
    PhysicsWorld->Advance(FixedStep);
    return PhysicsWorld->QueryMetrics().StepsLastAdvance == 1u;
}

} // namespace Frontier::Vehicle
