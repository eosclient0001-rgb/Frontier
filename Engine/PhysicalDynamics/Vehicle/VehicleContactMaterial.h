//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Vehicle/VehicleContactMaterial.h — mechanical tyre/road friction pairing
//============================================================================================================================================
#pragma once

#include <algorithm>
#include <cmath>

namespace Frontier::Vehicle {

// The vehicle configuration owns the tyre coefficient (GripCoefficient); each Jolt collision body owns the road
// coefficient (RigidBodyDescription::Friction). Keep both mechanical properties separate from the renderer's PBR
// material assets: appearance controls light transport, while these values control contact forces.
[[nodiscard]] inline float CombineFrictionCoefficients(float Tyre, float Road) noexcept
{
    const float T = std::isfinite(Tyre) ? std::max(0.0f, Tyre) : 0.0f;
    const float R = std::isfinite(Road) ? std::max(0.0f, Road) : 0.0f;
    // Symmetric geometric-mean pairing: neither interface can silently override the other.
    return std::sqrt(T * R);
}

} // namespace Frontier::Vehicle
