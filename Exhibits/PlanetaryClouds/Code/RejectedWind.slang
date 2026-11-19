/*==========================================================================================================================================
                                                              REJECTEDWIND.SLANG
==========================================================================================================================================*/
// 🧩 Deliberately rejected original generic-trigonometry wind characteristic for reproducing the software-ICD radial defect.

#define CloudCaptureEntry InactiveCloudCaptureEntry
#include "../../../Experimental/PlanetaryClouds/CloudCompute.slang"
#undef CloudCaptureEntry

//------------------------------------------------------------------------------------------------------------------------
//                                                   REJECTED ROTATION CONTROL
//------------------------------------------------------------------------------------------------------------------------

float3 RejectedWindCharacteristic(CloudSpecification Specification, float3 Position)
{
    float  Radius   = length(Position);
    float  HeightKm = max(0.0, Radius - Specification.RadiusM - Specification.FloorM) * 0.001;
    float  Turn     = HeightKm * Specification.Veer;
    float2 Wind     = float2(Specification.WindVelocityMps.x * cos(Turn) - Specification.WindVelocityMps.y * sin(Turn),
                             Specification.WindVelocityMps.x * sin(Turn) + Specification.WindVelocityMps.y * cos(Turn));
    float  Speed    = length(Wind);
    if (Speed <= 1.0e-5) return Position;
    float3 Axis   = float3(-Wind.y, Wind.x, 0.0) / Speed;
    float  Angle  = -Speed * Specification.TimeSeconds * (1.0 + Specification.Shear * HeightKm) / Specification.RadiusM;
    float  Sine   = sin(Angle);
    float  Cosine = cos(Angle);
    return Position * Cosine + cross(Axis, Position) * Sine + Axis * dot(Axis, Position) * (1.0 - Cosine);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void CloudCaptureEntry(uint3 Coordinate : SV_DispatchThreadID)
{
    if (Coordinate.x >= Capture.Size.x || Coordinate.y >= Capture.Tile.y) return;
    float3 Position = CloudQueryInput(Coordinate.x, 0u).xyz;
    float3 Advected = RejectedWindCharacteristic(QueryCloudSpecification(), Position);
    CloudPixels[Coordinate.y * Capture.Size.x + Coordinate.x] = float4(Advected, length(Advected) - length(Position));
}
