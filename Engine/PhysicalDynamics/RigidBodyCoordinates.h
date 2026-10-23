/*==========================================================================================================================================
                                               RIGID BODY COORDINATES
==========================================================================================================================================*/
// 🧩 Compact vector and orientation values used by the backend-neutral rigid-body records.

#pragma once

#include <cmath>

namespace Frontier
{

struct Vector3
{
    float x = 0.0f; // [m] or [m/s], according to its field
    float y = 0.0f;
    float z = 0.0f;
    float w = 0.0f; // [-] padding / homogeneous component

    constexpr Vector3() noexcept = default;
    constexpr Vector3(float X, float Y, float Z, float W = 0.0f) noexcept : x(X), y(Y), z(Z), w(W) {}

    [[nodiscard]] float LengthSquared() const noexcept { return x * x + y * y + z * z; }
    [[nodiscard]] Vector3 Normalized() const noexcept
    {
        const float Magnitude = std::sqrt(LengthSquared());
        return Magnitude > 1.0e-7f ? Vector3{x / Magnitude, y / Magnitude, z / Magnitude} : Vector3{};
    }
};

struct Quaternion
{
    float x = 0.0f; // [-]
    float y = 0.0f;
    float z = 0.0f;
    float w = 1.0f;

    constexpr Quaternion() noexcept = default;
    constexpr Quaternion(float X, float Y, float Z, float W) noexcept : x(X), y(Y), z(Z), w(W) {}
    [[nodiscard]] static Quaternion Identity() noexcept { return {}; }
};

} // namespace Frontier
