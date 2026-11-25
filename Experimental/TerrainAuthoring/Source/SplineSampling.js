/*====================================================================================================================================
                                                        SPLINESAMPLING.JS
====================================================================================================================================*/
// 🧩 Centripetal Catmull–Rom sampling, Ramer–Douglas–Peucker stroke condensing and GPU sample-atlas packing

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

export const AtlasColumns   = 1024;   // [idx] - Samples per spline row
export const AtlasRows      = 256;    // [idx] - Spline rows (one spline per row)
export const GroupColumns   = 1024;   // [idx] - Group atlas width (2 texels per group)
export const GroupRows      = 64;     // [idx] - Group atlas height
export const GroupSegments  = 8;      // [-]   - Segments per culling group

//------------------------------------------------------------------------------------------------------------------------
//                                                    CURVE EVALUATION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Centripetal (α = 0.5) Catmull–Rom between P1 and P2 using Barry–Goldman pyramidal evaluation; avoids cusps.
function EvaluateCentripetal(P0, P1, P2, P3, U)
{
    const Knot = (A, B) => Math.max(Math.pow(Math.hypot(B[0] - A[0], B[1] - A[1]), 0.5), 1e-4);
    const T0 = 0, T1 = T0 + Knot(P0, P1), T2 = T1 + Knot(P1, P2), T3 = T2 + Knot(P2, P3);
    const T = T1 + (T2 - T1) * U;
    const Blend = (A, B, Ta, Tb) => A.map((Component, Index) => ((Tb - T) * Component + (T - Ta) * B[Index]) / (Tb - Ta));
    const A1 = Blend(P0, P1, T0, T1), A2 = Blend(P1, P2, T1, T2), A3 = Blend(P2, P3, T2, T3);
    const B1 = Blend(A1, A2, T0, T2), B2 = Blend(A2, A3, T1, T3);
    return Blend(B1, B2, T1, T2);
}

// 📝 Returns dense samples [x, z, halfWidth, lift, arcFraction, control index or −1]. Control vectors carry (x, z, width scale, lift).
export function SampleSpline(Points, LayerWidth, Spacing)
{
    if (Points.length < 2) return [];
    const Controls = Points.map(Point => [Point.X, Point.Z, Point.Width ?? 1, Point.Lift ?? 0]);
    const Extended = [Controls[0].map((Component, Index) => Index < 2 ? 2 * Component - Controls[1][Index] : Component), ...Controls,
                      Controls[Controls.length - 1].map((Component, Index) => Index < 2 ? 2 * Component - Controls[Controls.length - 2][Index] : Component)];
    let Chord = 0;
    for (let Index = 1; Index < Controls.length; ++Index) Chord += Math.hypot(Controls[Index][0] - Controls[Index - 1][0], Controls[Index][1] - Controls[Index - 1][1]);
    const Budget = Math.min(AtlasColumns - 1, Math.max(Controls.length * 2, Math.ceil(Chord / Spacing)));
    const Samples = [];
    for (let Span = 0; Span < Controls.length - 1; ++Span)
    {
        const SpanLength = Math.hypot(Controls[Span + 1][0] - Controls[Span][0], Controls[Span + 1][1] - Controls[Span][1]);
        const Steps = Math.max(2, Math.round(Budget * SpanLength / Math.max(Chord, 1e-6)));
        for (let Step = 0; Step < Steps; ++Step)
        {
            const U = Step / Steps;
            const Position = EvaluateCentripetal(Extended[Span].slice(0, 2), Extended[Span + 1].slice(0, 2), Extended[Span + 2].slice(0, 2), Extended[Span + 3].slice(0, 2), U);
            const Smooth = U * U * (3 - 2 * U);
            const Width = Controls[Span][2] + (Controls[Span + 1][2] - Controls[Span][2]) * Smooth;
            const Lift = Controls[Span][3] + (Controls[Span + 1][3] - Controls[Span][3]) * Smooth;
            Samples.push([Position[0], Position[1], Math.max(Width * LayerWidth * 0.5, 0.25), Lift, 0, Step === 0 ? Span : -1]);
        }
    }
    const Last = Controls[Controls.length - 1];
    Samples.push([Last[0], Last[1], Math.max(Last[2] * LayerWidth * 0.5, 0.25), Last[3], 0, Controls.length - 1]);
    while (Samples.length > AtlasColumns) Samples.splice(1 + Math.floor(Math.random() * (Samples.length - 2)), 1);
    let Arc = 0;
    const Lengths = [0];
    for (let Index = 1; Index < Samples.length; ++Index)
    {
        Arc += Math.hypot(Samples[Index][0] - Samples[Index - 1][0], Samples[Index][1] - Samples[Index - 1][1]);
        Lengths.push(Arc);
    }
    Samples.forEach((Sample, Index) => { Sample[4] = Arc > 0 ? Lengths[Index] / Arc : 0; });
    return Samples;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STROKE CONDENSING
//------------------------------------------------------------------------------------------------------------------------

export function CondenseStroke(Points, Tolerance)
{
    if (Points.length < 3) return Points.slice();
    const Keep = new Uint8Array(Points.length);
    Keep[0] = Keep[Points.length - 1] = 1;
    const Stack = [[0, Points.length - 1]];
    while (Stack.length)
    {
        const [First, Last] = Stack.pop();
        const [Ax, Az] = Points[First], [Bx, Bz] = Points[Last];
        // 📝 Point-to-segment distance: a closed loop (first point == last point) has a zero-length chord, where a
        //    point-to-line distance is 0 everywhere and would condense the whole stroke to two points.
        const Dx = Bx - Ax, Dz = Bz - Az, LengthSquared = Dx * Dx + Dz * Dz;
        let Farthest = -1, FarthestDistance = Tolerance;
        for (let Index = First + 1; Index < Last; ++Index)
        {
            const [Px, Pz] = Points[Index];
            const T = LengthSquared > 0 ? Math.max(0, Math.min(1, ((Px - Ax) * Dx + (Pz - Az) * Dz) / LengthSquared)) : 0;
            const Distance = Math.hypot(Px - Ax - T * Dx, Pz - Az - T * Dz);
            if (Distance > FarthestDistance) { FarthestDistance = Distance; Farthest = Index; }
        }
        if (Farthest >= 0)
        {
            Keep[Farthest] = 1;
            Stack.push([First, Farthest], [Farthest, Last]);
        }
    }
    return Points.filter((_, Index) => Keep[Index]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ATLAS PACKING
//------------------------------------------------------------------------------------------------------------------------

// 📝 Packs every spline layer into one row-per-spline atlas plus culling groups. Returns per-layer ranges and the
//    CPU-side samples (used for overlays and portal bounds). Layer order in the stack does not affect packing.
export function PackSplineAtlas(Layers)
{
    const Samples = new Float32Array(AtlasColumns * AtlasRows * 4);
    const Arcs = new Float32Array(AtlasColumns * AtlasRows);
    const RowTable = new Float32Array(AtlasRows * 4);
    const Groups = new Float32Array(GroupColumns * GroupRows * 4);
    const Ranges = new Map();
    let Row = 0, GroupCursor = 0, MaxCount = 1;
    for (const Layer of Layers)
    {
        if (Layer.Category !== "Spline") continue;
        const P = Layer.Parameters;
        const Width = Layer.Variant === "Tunnel" ? P.Width * 2 : P.Width;
        const Spacing = Math.max(1.5, Math.min(Width * 0.35, 24));
        const Range = { RowStart: Row, RowCount: 0, GroupStart: GroupCursor, GroupCount: 0, Bounds: [Infinity, Infinity, -Infinity, -Infinity], MaxHalfWidth: 0, SplineRows: new Map(), SampleSets: new Map() };
        for (const Spline of Layer.Splines)
        {
            if (Row >= AtlasRows) break;
            const Dense = SampleSpline(Spline.Points, Width, Spacing);
            if (Dense.length < 2) continue;
            Range.SplineRows.set(Spline.Id, Row);
            Range.SampleSets.set(Spline.Id, Dense);
            Dense.forEach((Sample, Column) =>
            {
                const Offset = (Row * AtlasColumns + Column) * 4;
                Samples[Offset] = Sample[0];
                Samples[Offset + 1] = Sample[1];
                Samples[Offset + 2] = Sample[2];
                Samples[Offset + 3] = Sample[3];
                Arcs[Row * AtlasColumns + Column] = Sample[4];
                Range.Bounds[0] = Math.min(Range.Bounds[0], Sample[0] - Sample[2]);
                Range.Bounds[1] = Math.min(Range.Bounds[1], Sample[1] - Sample[2]);
                Range.Bounds[2] = Math.max(Range.Bounds[2], Sample[0] + Sample[2]);
                Range.Bounds[3] = Math.max(Range.Bounds[3], Sample[1] + Sample[2]);
                Range.MaxHalfWidth = Math.max(Range.MaxHalfWidth, Sample[2]);
            });
            RowTable[Row * 4] = Dense.length;
            MaxCount = Math.max(MaxCount, Dense.length);
            for (let First = 0; First < Dense.length - 1; First += GroupSegments)
            {
                if (GroupCursor >= (GroupColumns * GroupRows) / 2) break;
                const Count = Math.min(GroupSegments + 1, Dense.length - First);
                let Cx = 0, Cz = 0;
                for (let K = 0; K < Count; ++K) { Cx += Dense[First + K][0]; Cz += Dense[First + K][1]; }
                Cx /= Count;
                Cz /= Count;
                let Radius = 0;
                for (let K = 0; K < Count; ++K) Radius = Math.max(Radius, Math.hypot(Dense[First + K][0] - Cx, Dense[First + K][1] - Cz) + Dense[First + K][2]);
                const Offset = GroupCursor * 8;
                Groups.set([Cx, Cz, Radius + 0.5, Row, First, Count, 0, 0], Offset);
                GroupCursor++;
            }
            Row++;
            Range.RowCount++;
        }
        Range.GroupCount = GroupCursor - Range.GroupStart;
        const Reach = Layer.Variant === "Tunnel" ? P.Width * 2 : P.Shoulder;
        Range.Bounds = [Range.Bounds[0] - Reach, Range.Bounds[1] - Reach, Range.Bounds[2] + Reach, Range.Bounds[3] + Reach];
        Ranges.set(Layer.Id, Range);
    }
    return { Samples, Arcs, RowTable, Groups, Ranges, RowsUsed: Row, GroupsUsed: GroupCursor, MaxCount };
}
