//============================================================================================================================
// 🧩 Frontier — TyreDeformation.h
//============================================================================================================================
// 📝 The demo's analytical spring-deformation fallback and nodal interpolation from VehicleVisual.wgsl,
//    with the per-wheel deformation record from VehicleVisualState.js. Neither path supplies physical contact forces.
//    Provenance, stated plainly: in the demo this is a GPU vertex deformation driven by the dynamics (contact angle,
//    carcass deflection, gauge pressure, lateral-force shear) — it shapes the rubber, it does not feed forces back.
//    Here it is the same contract on CPU: VehicleSolver's wheel state in, deformed wheel-local vertex out, ready for
//    the renderer's wheel geometry or a Slang vertex port to consume identically.
//============================================================================================================================

#pragma once

#include <algorithm>
#include <cmath>

#include "Engine/Physics/VehicleSolver.h"

namespace Frontier
{

// 📝 Per-wheel deformation record (the demo's Deformation vec4 + shredded flag).
struct TyreDeformationRecord
{
    float ContactAngle      = 0.0f;   // [rad]  contact direction in the spun wheel frame
    float Deflection        = 0.0f;   // [m]    carcass radial deflection
    float GaugePressure     = 0.0f;   // [Pa]
    float LateralDistortion = 0.0f;   // [m]    cornering shear offset at the tread, clamped ±40 mm
    bool  Shredded          = false;  // [-]    rubber gone: tyre vertices collapse to the axle
};

// 📝 Encodes one wheel's record from its dynamic state (VehicleVisualState.js EncodeRecord, offsets 36..51):
//    contact angle from the ground normal carried into the steered, spun wheel frame; lateral distortion from the
//    cornering force at 150 kN per metre, clamped to ±40 mm. A shredded wheel encodes an empty record.
inline TyreDeformationRecord ResolveTyreDeformationRecord(const VehicleWheelState& Wheel, const double VehicleOrientation[4])
{
    TyreDeformationRecord Record;
    Record.Shredded = Wheel.Shredded;
    if (Wheel.Shredded)
        return Record;
    Record.Deflection = (float)std::fmax(0.0, Wheel.TyreDeflection);
    Record.GaugePressure = (float)std::fmax(0.0, Wheel.Pressure);
    // Steered = Orientation · Rz(Steer); Spun = Steered · Ry(SpinAngle); LocalDown = Spun⁻¹ · (−GroundNormal).
    const auto AxisQuat = [](double Ax, double Ay, double Az, double Angle, double Out[4])
    {
        const double Sine = std::sin(0.5 * Angle);
        Out[0] = Ax * Sine; Out[1] = Ay * Sine; Out[2] = Az * Sine; Out[3] = std::cos(0.5 * Angle);
    };
    const auto Multiply = [](const double L[4], const double R[4], double Out[4])
    {
        Out[0] = L[3] * R[0] + L[0] * R[3] + L[1] * R[2] - L[2] * R[1];
        Out[1] = L[3] * R[1] - L[0] * R[2] + L[1] * R[3] + L[2] * R[0];
        Out[2] = L[3] * R[2] + L[0] * R[1] - L[1] * R[0] + L[2] * R[3];
        Out[3] = L[3] * R[3] - L[0] * R[0] - L[1] * R[1] - L[2] * R[2];
    };
    const auto Rotate = [](const double Q[4], const double V[3], double Out[3])
    {
        const double Crossed[3] = { Q[1] * V[2] - Q[2] * V[1], Q[2] * V[0] - Q[0] * V[2], Q[0] * V[1] - Q[1] * V[0] };
        const double Twice[3] = { 2.0 * Crossed[0], 2.0 * Crossed[1], 2.0 * Crossed[2] };
        Out[0] = V[0] + Q[3] * Twice[0] + (Q[1] * Twice[2] - Q[2] * Twice[1]);
        Out[1] = V[1] + Q[3] * Twice[1] + (Q[2] * Twice[0] - Q[0] * Twice[2]);
        Out[2] = V[2] + Q[3] * Twice[2] + (Q[0] * Twice[1] - Q[1] * Twice[0]);
    };
    double SteerQuat[4]; AxisQuat(0.0, 0.0, 1.0, Wheel.Steer, SteerQuat);
    double Steered[4]; Multiply(VehicleOrientation, SteerQuat, Steered);
    double SpinQuat[4]; AxisQuat(0.0, 1.0, 0.0, Wheel.SpinAngle, SpinQuat);
    double Spun[4]; Multiply(Steered, SpinQuat, Spun);
    const double Conjugate[4] = { -Spun[0], -Spun[1], -Spun[2], Spun[3] };
    const double DownWorld[3] = { -Wheel.GroundNormal[0], -Wheel.GroundNormal[1], -Wheel.GroundNormal[2] };
    double LocalDown[3]; Rotate(Conjugate, DownWorld, LocalDown);
    Record.ContactAngle = (float)std::atan2(LocalDown[2], LocalDown[0]);
    Record.LateralDistortion = (float)std::fmax(-0.04, std::fmin(0.04, Wheel.LateralForce / 150000.0));
    return Record;
}

// 📐 ResolveWheelVertex transcribed: ① contact-patch flattening with a cosine envelope over the pressure-scaled patch
//    span, ② volume-conserving sidewall bulge (Poisson), ③ shoulder expansion wave just outside the patch, ④ lateral
//    cornering shear, and the shading-normal tilt. Position/Normal are wheel-local (axle along Y), metres, float —
//    the WGSL's own precision. IsTyreFamily false (rim/hub/brake) returns the vertex unchanged; a shredded tyre's
//    vertices collapse to the axle.
inline void ResolveDeformedWheelVertex(const TyreDeformationRecord& Record, bool IsTyreFamily,
                                       const float Position[3], const float Normal[3],
                                       float OutPosition[3], float OutNormal[3])
{
    const float TyreRimRadius = 0.3448f;
    const float TyreOuterRadius = 0.50855f;
    const float Pi = 3.141592653589793f;
    OutPosition[0] = Position[0]; OutPosition[1] = Position[1]; OutPosition[2] = Position[2];
    OutNormal[0] = Normal[0]; OutNormal[1] = Normal[1]; OutNormal[2] = Normal[2];
    if (IsTyreFamily && Record.Shredded)
    {
        OutPosition[0] = 0.0f; OutPosition[1] = 0.0f; OutPosition[2] = 0.0f;
        return;
    }
    if (!IsTyreFamily)
        return;
    const float Deflection = Record.Deflection;
    if (Deflection <= 1.0e-5f)
        return;
    const float ContactAngle = Record.ContactAngle;
    const float Pressure = std::fmax(0.0f, Record.GaugePressure);
    const float LateralDistortion = Record.LateralDistortion;
    const float R = std::sqrt(Position[0] * Position[0] + Position[2] * Position[2]);
    if (R <= TyreRimRadius + 1.0e-4f)
        return;
    const float Phi = std::atan2(Position[2], Position[0]);
    float DPhi = Phi - ContactAngle;
    DPhi = DPhi - 2.0f * Pi * std::round(DPhi / (2.0f * Pi));
    const float PNorm = std::fmax(0.05f, Pressure / 220000.0f);
    const float PatchSpan = std::fmax(0.20f, std::fmin(1.15f, 0.44f / std::sqrt(std::fmax(0.15f, PNorm))));
    const float RadialFrac = std::fmax(0.0f, std::fmin(1.0f, (R - TyreRimRadius) / (TyreOuterRadius - TyreRimRadius)));
    float DR = 0.0f;
    float DY = 0.0f;
    const float AbsDPhi = std::fabs(DPhi);
    // ① Contact flattening constraint + ② volumetric sidewall bulge.
    if (AbsDPhi < PatchSpan)
    {
        const float U = AbsDPhi / PatchSpan;
        const float Envelope = 0.5f * (1.0f + std::cos(U * Pi));
        DR = -Deflection * Envelope * RadialFrac;
        const float SidewallFactor = std::sin(RadialFrac * Pi);
        const float BulgeIntensity = 0.48f / (0.4f + 0.6f * std::sqrt(PNorm));
        const float SignY = Position[1] > 0.0f ? 1.0f : (Position[1] < 0.0f ? -1.0f : 0.0f);
        DY = SignY * (Deflection * BulgeIntensity * Envelope * SidewallFactor);
    }
    // ③ Volumetric wave expansion (bead/shoulder transition zone just outside contact).
    const float WaveOuter = PatchSpan * 1.5f;
    if (AbsDPhi >= PatchSpan && AbsDPhi < WaveOuter)
    {
        const float V = (AbsDPhi - PatchSpan) / (WaveOuter - PatchSpan);
        DR = DR + std::sin(V * Pi) * (0.12f * Deflection * RadialFrac);
    }
    // ④ Lateral cornering slip / shear strain.
    if (AbsDPhi < PatchSpan * 1.2f)
    {
        const float UShear = AbsDPhi / (PatchSpan * 1.2f);
        const float ShearEnv = 0.5f * (1.0f + std::cos(UShear * Pi));
        DY = DY + LateralDistortion * ShearEnv * RadialFrac;
    }
    const float NewR = std::fmax(TyreRimRadius, R + DR);
    OutPosition[0] = NewR * std::cos(Phi);
    OutPosition[1] = Position[1] + DY;
    OutPosition[2] = NewR * std::sin(Phi);
    if (AbsDPhi < PatchSpan)
    {
        const float Tilt = -std::sin((DPhi / PatchSpan) * Pi) * (Deflection / (TyreOuterRadius * PatchSpan));
        float Tilted[3] = { Normal[0] + (-std::sin(Phi)) * Tilt, Normal[1], Normal[2] + std::cos(Phi) * Tilt };
        const float L = std::sqrt(Tilted[0] * Tilted[0] + Tilted[1] * Tilted[1] + Tilted[2] * Tilted[2]);
        if (L > 1.0e-12f)
        {
            OutNormal[0] = Tilted[0] / L; OutNormal[1] = Tilted[1] / L; OutNormal[2] = Tilted[2] / L;
        }
    }
}

// 📝 Current demo's 32×5 nodal interpolation path, including its tangential normal adjustment.
//    A zero-load or shredded tyre follows the same guards as the retained VehicleVisual.wgsl.
inline void ResolveContinuumWheelVertex(const TyreDeformationRecord& Record, bool IsTyreFamily,
                                        const TyreContinuumPositions& Rest, const TyreContinuumPositions& Local,
                                        const float Position[3], const float Normal[3],
                                        float OutPosition[3], float OutNormal[3])
{
    for (int Axis = 0; Axis < 3; ++Axis) { OutPosition[Axis] = Position[Axis]; OutNormal[Axis] = Normal[Axis]; }
    if (IsTyreFamily && Record.Shredded)
    {
        OutPosition[0] = OutPosition[1] = OutPosition[2] = 0.0f;
        return;
    }
    if (!IsTyreFamily || Record.Deflection <= 1.0e-5f) return;
    constexpr float Pi = 3.14159265358979323846f, RimRadius = 0.3448f, OuterRadius = 0.50855f;
    const float Radius = std::sqrt(Position[0]*Position[0] + Position[2]*Position[2]);
    if (Radius <= RimRadius + 1e-4f) return;
    const float Phi = std::atan2(Position[2], Position[0]);
    float Turns = Phi / (2.0f * Pi) + 1.0f;
    Turns -= std::floor(Turns);
    const float SectorCoord = Turns * 32.0f;
    const int S0 = static_cast<int>(std::floor(SectorCoord)) & 31, S1 = (S0 + 1) & 31;
    const float SectorFraction = SectorCoord - std::floor(SectorCoord);
    const float RingCoord = std::fmax(0.5f, std::fmin(3.5f, (Position[1] / 0.118f) * 1.35f + 2.0f));
    const int M0 = std::min(static_cast<int>(std::floor(RingCoord)), 3), M1 = M0 + 1;
    const float RingFraction = std::fmax(0.0f, std::fmin(1.0f, RingCoord - M0));
    const auto Displacement = [&](int Sector, int Ring, int Axis)
    {
        const int Index = (Sector * 5 + Ring) * 3 + Axis;
        return Local[Index] - Rest[Index];
    };
    const float Fraction = std::fmax(0.0f, std::fmin(1.0f, (Radius - RimRadius) / (OuterRadius - RimRadius)));
    const float U = std::fmax(0.0f, std::fmin(1.0f, Fraction / 0.88f));
    const float Weight = U * U * (3.0f - 2.0f * U);
    float U00[3], U10[3];
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        U00[Axis] = Displacement(S0, M0, Axis); U10[Axis] = Displacement(S1, M0, Axis);
        const float U01 = Displacement(S0, M1, Axis), U11 = Displacement(S1, M1, Axis);
        const float Row0 = U00[Axis] * (1.0f - SectorFraction) + U10[Axis] * SectorFraction;
        const float Row1 = U01 * (1.0f - SectorFraction) + U11 * SectorFraction;
        OutPosition[Axis] += (Row0 * (1.0f - RingFraction) + Row1 * RingFraction) * Weight;
    }
    const float SinPhi = std::sin(Phi), CosPhi = std::cos(Phi);
    const float Tilt = ((U10[0] - U00[0]) * CosPhi + (U10[2] - U00[2]) * SinPhi) * Weight * 4.5f;
    OutNormal[0] = Normal[0] + SinPhi * Tilt;
    OutNormal[1] = Normal[1];
    OutNormal[2] = Normal[2] - CosPhi * Tilt;
    const float Magnitude = std::sqrt(OutNormal[0]*OutNormal[0] + OutNormal[1]*OutNormal[1] + OutNormal[2]*OutNormal[2]);
    if (Magnitude > 1e-12f) for (int Axis = 0; Axis < 3; ++Axis) OutNormal[Axis] /= Magnitude;
}

} // namespace Frontier
