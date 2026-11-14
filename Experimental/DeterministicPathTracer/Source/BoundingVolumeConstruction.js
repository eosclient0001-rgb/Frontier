/*====================================================================================================================================
                                                  BOUNDINGVOLUMECONSTRUCTION.JS
====================================================================================================================================*/
// 🧩 Binned surface-area-heuristic bounding-volume tree over triangles, flattened into 32-byte GPU bounds entries

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const BinCount            = 16;     // [-]  - SAH split candidates per axis
const LeafTriangleLimit   = 4;      // [-]  - Ranges at or below this size always terminate
const TraversalCostRatio  = 1.0;    // [-]  - Cost of one bounds test relative to one triangle test
const BoundsEntryStride   = 8;      // [-]  - 32-bit words per entry: min.xyz, LeftOrFirst, max.xyz, PrimitiveCount


//------------------------------------------------------------------------------------------------------------------------
//                                                    INTERNAL FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

function SurfaceArea(MinX, MinY, MinZ, MaxX, MaxY, MaxZ)
{
    const ExtentX = MaxX - MinX, ExtentY = MaxY - MinY, ExtentZ = MaxZ - MinZ;
    return (ExtentX < 0.0 || ExtentY < 0.0 || ExtentZ < 0.0) ? 0.0 : 2.0 * (ExtentX * ExtentY + ExtentY * ExtentZ + ExtentZ * ExtentX);
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    PUBLIC FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Positions holds 9 floats per triangle (three world-space corners). Returns the triangle permutation the GPU arrays
//    must follow and the flattened entries. Inner entries store the first of two adjacent down-link entries; leaves store
//    the first triangle of their contiguous range. Construction is fully deterministic (no randomized splits).
export function ConstructBoundingVolumes(Positions, TriangleCount)
{
    const Centroids = new Float32Array(TriangleCount * 3);
    const Bounds    = new Float32Array(TriangleCount * 6);
    for (let Triangle = 0; Triangle < TriangleCount; Triangle++)
    {
        const P = Triangle * 9;
        for (let Axis = 0; Axis < 3; Axis++)
        {
            const A = Positions[P + Axis], B = Positions[P + 3 + Axis], C = Positions[P + 6 + Axis];
            Bounds[Triangle * 6 + Axis]     = Math.min(A, B, C);
            Bounds[Triangle * 6 + 3 + Axis] = Math.max(A, B, C);
            Centroids[Triangle * 3 + Axis]  = (A + B + C) / 3.0;
        }
    }

    const Order   = new Uint32Array(TriangleCount);
    for (let Triangle = 0; Triangle < TriangleCount; Triangle++) Order[Triangle] = Triangle;

    let EntryCapacity = Math.max(2, TriangleCount * 2);
    let EntryWords    = new Uint32Array(EntryCapacity * BoundsEntryStride);
    let EntryFloats   = new Float32Array(EntryWords.buffer);
    let EntryCount    = 1;

    const BinMinimum = new Float32Array(BinCount * 3), BinMaximum = new Float32Array(BinCount * 3);
    const BinTally   = new Uint32Array(BinCount);
    const LeftArea   = new Float32Array(BinCount), LeftTally = new Uint32Array(BinCount);

    const RangeStack = [{ EntryIndex: 0, First: 0, Count: TriangleCount }];
    let   MaximumDepthTier = 0;
    while (RangeStack.length)
    {
        const Range = RangeStack.pop();
        const { EntryIndex, First, Count } = Range;
        MaximumDepthTier = Math.max(MaximumDepthTier, Range.DepthTier || 0);

        let MinX = Infinity, MinY = Infinity, MinZ = Infinity, MaxX = -Infinity, MaxY = -Infinity, MaxZ = -Infinity;
        let CMinX = Infinity, CMinY = Infinity, CMinZ = Infinity, CMaxX = -Infinity, CMaxY = -Infinity, CMaxZ = -Infinity;
        for (let Slot = First; Slot < First + Count; Slot++)
        {
            const Triangle = Order[Slot], B = Triangle * 6, C = Triangle * 3;
            MinX = Math.min(MinX, Bounds[B]);     MinY = Math.min(MinY, Bounds[B + 1]); MinZ = Math.min(MinZ, Bounds[B + 2]);
            MaxX = Math.max(MaxX, Bounds[B + 3]); MaxY = Math.max(MaxY, Bounds[B + 4]); MaxZ = Math.max(MaxZ, Bounds[B + 5]);
            CMinX = Math.min(CMinX, Centroids[C]);     CMinY = Math.min(CMinY, Centroids[C + 1]); CMinZ = Math.min(CMinZ, Centroids[C + 2]);
            CMaxX = Math.max(CMaxX, Centroids[C]);     CMaxY = Math.max(CMaxY, Centroids[C + 1]); CMaxZ = Math.max(CMaxZ, Centroids[C + 2]);
        }
        const Word = EntryIndex * BoundsEntryStride;
        EntryFloats[Word] = MinX; EntryFloats[Word + 1] = MinY; EntryFloats[Word + 2] = MinZ;
        EntryFloats[Word + 4] = MaxX; EntryFloats[Word + 5] = MaxY; EntryFloats[Word + 6] = MaxZ;

        // 📝 Evaluate SAH over BinCount uniform centroid bins on each axis; keep the cheapest strict split.
        let BestCost = Count * SurfaceArea(MinX, MinY, MinZ, MaxX, MaxY, MaxZ), BestAxis = -1, BestBin = 0;
        const CentroidMinimum = [CMinX, CMinY, CMinZ], CentroidMaximum = [CMaxX, CMaxY, CMaxZ];
        if (Count > LeafTriangleLimit)
        {
            for (let Axis = 0; Axis < 3; Axis++)
            {
                const Extent = CentroidMaximum[Axis] - CentroidMinimum[Axis];
                if (Extent <= 1e-9) continue;
                const BinScale = BinCount / Extent;
                BinMinimum.fill(Infinity); BinMaximum.fill(-Infinity); BinTally.fill(0);
                for (let Slot = First; Slot < First + Count; Slot++)
                {
                    const Triangle = Order[Slot];
                    const Bin = Math.min(BinCount - 1, Math.floor((Centroids[Triangle * 3 + Axis] - CentroidMinimum[Axis]) * BinScale));
                    BinTally[Bin]++;
                    for (let Component = 0; Component < 3; Component++)
                    {
                        BinMinimum[Bin * 3 + Component] = Math.min(BinMinimum[Bin * 3 + Component], Bounds[Triangle * 6 + Component]);
                        BinMaximum[Bin * 3 + Component] = Math.max(BinMaximum[Bin * 3 + Component], Bounds[Triangle * 6 + 3 + Component]);
                    }
                }
                let AMinX = Infinity, AMinY = Infinity, AMinZ = Infinity, AMaxX = -Infinity, AMaxY = -Infinity, AMaxZ = -Infinity, ATally = 0;
                for (let Bin = 0; Bin < BinCount - 1; Bin++)
                {
                    ATally += BinTally[Bin];
                    if (BinTally[Bin])
                    {
                        AMinX = Math.min(AMinX, BinMinimum[Bin * 3]);     AMinY = Math.min(AMinY, BinMinimum[Bin * 3 + 1]); AMinZ = Math.min(AMinZ, BinMinimum[Bin * 3 + 2]);
                        AMaxX = Math.max(AMaxX, BinMaximum[Bin * 3]);     AMaxY = Math.max(AMaxY, BinMaximum[Bin * 3 + 1]); AMaxZ = Math.max(AMaxZ, BinMaximum[Bin * 3 + 2]);
                    }
                    LeftTally[Bin] = ATally;
                    LeftArea[Bin]  = SurfaceArea(AMinX, AMinY, AMinZ, AMaxX, AMaxY, AMaxZ);
                }
                let BMinX = Infinity, BMinY = Infinity, BMinZ = Infinity, BMaxX = -Infinity, BMaxY = -Infinity, BMaxZ = -Infinity, BTally = 0;
                for (let Bin = BinCount - 1; Bin > 0; Bin--)
                {
                    BTally += BinTally[Bin];
                    if (BinTally[Bin])
                    {
                        BMinX = Math.min(BMinX, BinMinimum[Bin * 3]);     BMinY = Math.min(BMinY, BinMinimum[Bin * 3 + 1]); BMinZ = Math.min(BMinZ, BinMinimum[Bin * 3 + 2]);
                        BMaxX = Math.max(BMaxX, BinMaximum[Bin * 3]);     BMaxY = Math.max(BMaxY, BinMaximum[Bin * 3 + 1]); BMaxZ = Math.max(BMaxZ, BinMaximum[Bin * 3 + 2]);
                    }
                    const SplitTally = LeftTally[Bin - 1];
                    if (SplitTally === 0 || BTally === 0) continue;
                    const Cost = TraversalCostRatio * SurfaceArea(MinX, MinY, MinZ, MaxX, MaxY, MaxZ)
                               + SplitTally * LeftArea[Bin - 1] + BTally * SurfaceArea(BMinX, BMinY, BMinZ, BMaxX, BMaxY, BMaxZ);
                    if (Cost < BestCost) { BestCost = Cost; BestAxis = Axis; BestBin = Bin; }
                }
            }
        }

        if (BestAxis < 0)
        {
            EntryWords[Word + 3] = First;
            EntryWords[Word + 7] = Count;
            continue;
        }

        // 📝 Deterministic in-place partition by bin index on the chosen axis.
        const Extent   = CentroidMaximum[BestAxis] - CentroidMinimum[BestAxis];
        const BinScale = BinCount / Extent;
        let   Lower = First, Upper = First + Count - 1;
        while (Lower <= Upper)
        {
            const Triangle = Order[Lower];
            const Bin = Math.min(BinCount - 1, Math.floor((Centroids[Triangle * 3 + BestAxis] - CentroidMinimum[BestAxis]) * BinScale));
            if (Bin < BestBin) { Lower++; }
            else { Order[Lower] = Order[Upper]; Order[Upper] = Triangle; Upper--; }
        }
        const LowerCount = Lower - First;

        if (EntryCount + 2 > EntryCapacity)
        {
            EntryCapacity *= 2;
            const GrownWords = new Uint32Array(EntryCapacity * BoundsEntryStride);
            GrownWords.set(EntryWords);
            EntryWords  = GrownWords;
            EntryFloats = new Float32Array(EntryWords.buffer);
        }
        const LowerEntry = EntryCount;
        EntryCount += 2;
        EntryWords[Word + 3] = LowerEntry;
        EntryWords[Word + 7] = 0;
        const DepthTier = (Range.DepthTier || 0) + 1;
        RangeStack.push({ EntryIndex: LowerEntry + 1, First: Lower, Count: Count - LowerCount, DepthTier });
        RangeStack.push({ EntryIndex: LowerEntry, First, Count: LowerCount, DepthTier });
    }

    return {
        Order,
        EntryCount,
        MaximumDepthTier,
        EntryWords: EntryWords.slice(0, EntryCount * BoundsEntryStride)
    };
}
