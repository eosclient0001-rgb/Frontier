/*====================================================================================================================================
                                                        CURVESAMPLING.JS
====================================================================================================================================*/
// 🧩 Planar curve sampling, arc-length parameterisation, polyline distance and polygon containment (pure, GPU-free)

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

export const CenterlineSampleCeiling = 2048; // [idx] - Maximum centerline samples per spline (GPU profile texture width)

//------------------------------------------------------------------------------------------------------------------------
//                                                 PUBLIC FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Centripetal Catmull-Rom (α = 0.5) avoids cusps and self-intersections on unevenly spaced control points.
function EvaluateCentripetalSegment(P0, P1, P2, P3, SurfaceParameter)
{
    const α = 0.5;
    const KnotStep = (A, B) => Math.max(1e-4, Math.pow(Math.hypot(B.X - A.X, B.Z - A.Z), α));
    const τ0 = 0;
    const τ1 = τ0 + KnotStep(P0, P1);
    const τ2 = τ1 + KnotStep(P1, P2);
    const τ3 = τ2 + KnotStep(P2, P3);
    const τ = τ1 + (τ2 - τ1) * SurfaceParameter;
    const Blend = (A, B, τA, τB) =>
    {
        const Weight = (τ - τA) / (τB - τA);
        return { X: A.X + (B.X - A.X) * Weight, Z: A.Z + (B.Z - A.Z) * Weight, Height: A.Height + (B.Height - A.Height) * Weight };
    };
    const A1 = Blend(P0, P1, τ0, τ1);
    const A2 = Blend(P1, P2, τ1, τ2);
    const A3 = Blend(P2, P3, τ2, τ3);
    const B1 = Blend(A1, A2, τ0, τ2);
    const B2 = Blend(A2, A3, τ1, τ3);
    return Blend(B1, B2, τ1, τ2);
}

// Sample a control polygon into a dense centerline: { X, Z, Height, Arc, ControlParameter } per sample.
// Spacing is the target distance between samples in metres; output is capped at CenterlineSampleCeiling.
export function SampleCenterline(ControlPoints, Spacing)
{
    const Count = ControlPoints.length;
    if (Count === 0) return [];
    if (Count === 1)
    {
        const Single = ControlPoints[0];
        return [{ X: Single.X, Z: Single.Z, Height: Single.Height ?? 0, Arc: 0, ControlParameter: 0 }];
    }
    const Normalized = ControlPoints.map((Point) => ({ X: Point.X, Z: Point.Z, Height: Point.Height ?? 0 }));
    let ChordTotal = 0;
    for (let SegmentIndex = 0; SegmentIndex < Count - 1; SegmentIndex++)
    {
        ChordTotal += Math.hypot(Normalized[SegmentIndex + 1].X - Normalized[SegmentIndex].X, Normalized[SegmentIndex + 1].Z - Normalized[SegmentIndex].Z);
    }
    const EffectiveSpacing = Math.max(Spacing, (ChordTotal * 1.15) / (CenterlineSampleCeiling - Count));
    const Samples = [];
    for (let SegmentIndex = 0; SegmentIndex < Count - 1; SegmentIndex++)
    {
        const P1 = Normalized[SegmentIndex];
        const P2 = Normalized[SegmentIndex + 1];
        const P0 = SegmentIndex > 0 ? Normalized[SegmentIndex - 1] : { X: 2 * P1.X - P2.X, Z: 2 * P1.Z - P2.Z, Height: P1.Height };
        const P3 = SegmentIndex + 2 < Count ? Normalized[SegmentIndex + 2] : { X: 2 * P2.X - P1.X, Z: 2 * P2.Z - P1.Z, Height: P2.Height };
        const Chord = Math.hypot(P2.X - P1.X, P2.Z - P1.Z);
        const Subdivisions = Math.max(1, Math.ceil(Chord / EffectiveSpacing));
        const StartIndex = SegmentIndex === 0 ? 0 : 1;
        for (let SubIndex = StartIndex; SubIndex <= Subdivisions; SubIndex++)
        {
            const SurfaceParameter = SubIndex / Subdivisions;
            const Evaluated = Chord < 1e-6 ? { X: P1.X, Z: P1.Z, Height: P1.Height } : EvaluateCentripetalSegment(P0, P1, P2, P3, SurfaceParameter);
            Samples.push({ X: Evaluated.X, Z: Evaluated.Z, Height: Evaluated.Height, Arc: 0, ControlParameter: SegmentIndex + SurfaceParameter });
        }
    }
    let Arc = 0;
    for (let SampleIndex = 1; SampleIndex < Samples.length; SampleIndex++)
    {
        Arc += Math.hypot(Samples[SampleIndex].X - Samples[SampleIndex - 1].X, Samples[SampleIndex].Z - Samples[SampleIndex - 1].Z);
        Samples[SampleIndex].Arc = Arc;
    }
    return Samples.slice(0, CenterlineSampleCeiling);
}

// Shortest distance from a point to an open polyline [{X,Z}], plus the segment index and parameter of the foot point.
export function ProjectOntoPolyline(Polyline, X, Z)
{
    let Nearest = { Distance: Infinity, SegmentIndex: -1, SegmentParameter: 0 };
    if (Polyline.length === 1)
    {
        return { Distance: Math.hypot(X - Polyline[0].X, Z - Polyline[0].Z), SegmentIndex: 0, SegmentParameter: 0 };
    }
    for (let SegmentIndex = 0; SegmentIndex < Polyline.length - 1; SegmentIndex++)
    {
        const A = Polyline[SegmentIndex];
        const B = Polyline[SegmentIndex + 1];
        const EdgeX = B.X - A.X;
        const EdgeZ = B.Z - A.Z;
        const EdgeLengthSquared = EdgeX * EdgeX + EdgeZ * EdgeZ;
        const SegmentParameter = EdgeLengthSquared > 0 ? Math.min(1, Math.max(0, ((X - A.X) * EdgeX + (Z - A.Z) * EdgeZ) / EdgeLengthSquared)) : 0;
        const Distance = Math.hypot(X - (A.X + EdgeX * SegmentParameter), Z - (A.Z + EdgeZ * SegmentParameter));
        if (Distance < Nearest.Distance) Nearest = { Distance, SegmentIndex, SegmentParameter };
    }
    return Nearest;
}

// Even-odd containment test against a closed polygon [{X,Z}].
export function PolygonContains(Polygon, X, Z)
{
    let Inside = false;
    for (let Index = 0, Previous = Polygon.length - 1; Index < Polygon.length; Previous = Index++)
    {
        const A = Polygon[Index];
        const B = Polygon[Previous];
        if ((A.Z > Z) !== (B.Z > Z) && X < ((B.X - A.X) * (Z - A.Z)) / (B.Z - A.Z) + A.X) Inside = !Inside;
    }
    return Inside;
}

// Ramer–Douglas–Peucker reduction of freehand input; Tolerance in metres.
export function SimplifyPolyline(Polyline, Tolerance)
{
    if (Polyline.length < 3) return Polyline.slice();
    const KeepMask = new Uint8Array(Polyline.length);
    KeepMask[0] = 1;
    KeepMask[Polyline.length - 1] = 1;
    const IntervalStack = [[0, Polyline.length - 1]];
    while (IntervalStack.length)
    {
        const [First, Last] = IntervalStack.pop();
        let FarthestDistance = 0;
        let FarthestIndex = -1;
        for (let Index = First + 1; Index < Last; Index++)
        {
            const Projection = ProjectOntoPolyline([Polyline[First], Polyline[Last]], Polyline[Index].X, Polyline[Index].Z);
            if (Projection.Distance > FarthestDistance)
            {
                FarthestDistance = Projection.Distance;
                FarthestIndex = Index;
            }
        }
        if (FarthestDistance > Tolerance && FarthestIndex > 0)
        {
            KeepMask[FarthestIndex] = 1;
            IntervalStack.push([First, FarthestIndex], [FarthestIndex, Last]);
        }
    }
    return Polyline.filter((Point, Index) => KeepMask[Index] === 1);
}

// Axis-aligned extent of a point list, optionally expanded by Margin metres.
export function EvaluateExtent(Points, Margin = 0)
{
    let MinimumX = Infinity, MinimumZ = Infinity, MaximumX = -Infinity, MaximumZ = -Infinity;
    for (const Point of Points)
    {
        MinimumX = Math.min(MinimumX, Point.X);
        MinimumZ = Math.min(MinimumZ, Point.Z);
        MaximumX = Math.max(MaximumX, Point.X);
        MaximumZ = Math.max(MaximumZ, Point.Z);
    }
    return { MinimumX: MinimumX - Margin, MinimumZ: MinimumZ - Margin, MaximumX: MaximumX + Margin, MaximumZ: MaximumZ + Margin };
}

// Signed polygon area (positive = counter-clockwise in X/Z).
export function EvaluatePolygonArea(Polygon)
{
    let Area = 0;
    for (let Index = 0, Previous = Polygon.length - 1; Index < Polygon.length; Previous = Index++)
    {
        Area += (Polygon[Previous].X * Polygon[Index].Z) - (Polygon[Index].X * Polygon[Previous].Z);
    }
    return Area * 0.5;
}
