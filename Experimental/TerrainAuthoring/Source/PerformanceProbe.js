/*====================================================================================================================================
                                                      PERFORMANCEPROBE.JS
====================================================================================================================================*/
// 🧩 In-app edit-cost benchmark (GPU-synchronised wall clock) — same code drives the Exhibits timing validation

//------------------------------------------------------------------------------------------------------------------------
//                                                    MEASUREMENT
//------------------------------------------------------------------------------------------------------------------------

const Median = List => [...List].sort((A, B) => A - B)[List.length >> 1];

// 📝 Measures the active cell at its current resolution. The document and sculpt rasters are snapshotted first and
//    restored afterwards, so the benchmark leaves the user's work untouched.
export function MeasureEditCosts(Session, Repetitions = 3)
{
    const D = Session.Device, P = Session.Pipeline, Doc = Session.Document;
    const Terrain = Doc.RetrieveTerrain();
    const Field = Session.ActiveField();
    if (!Terrain || !Field) return null;
    Session.Paused = true;
    const SavedDocument = Doc.Encode();
    const SavedRasters = new Map();
    Field.SculptFields.forEach((Surface, LayerId) => SavedRasters.set(LayerId, P.CloneSculpt(Surface)));
    const Sync = () => D.ReadSynchronous(Field.Final, 0, 0, 1, 1);
    const Time = (Action, Count = Repetitions) =>
    {
        const Samples = [];
        let Passes = 0;
        for (let Index = 0; Index < Count; ++Index)
        {
            Sync();
            const Started = performance.now();
            Passes = Action() ?? Passes;
            Sync();
            Samples.push(performance.now() - Started);
        }
        return { Milliseconds: Median(Samples), Passes };
    };
    const Rows = {};
    try
    {
        const Stack = Terrain.Layers;
        let Sculpt = [...Stack].reverse().find(Layer => Layer.Category === "Sculpt");
        if (!Sculpt || Stack[Stack.length - 1] !== Sculpt) Sculpt = Doc.CreateSculptLayer("Benchmark sculpt", Terrain.Id);
        const Spline = Stack.find(Layer => Layer.Category === "Spline" && Layer.Variant !== "Tunnel" && Layer.Splines.length && Layer.Splines[0].Points.length > 2);
        const Shape = Stack.find(Layer => Layer.Category === "Shape" && Layer.Strokes.length);
        const Evaluate = (Selected, Options = {}) => { P.EvaluateCell(Field, Doc, Terrain, { SelectedLayerId: Selected, ...Options }); return Field.LastEvaluation.Passes; };
        const Centre = [Terrain.Min[0] + Terrain.Size[0] * 0.45, Terrain.Min[1] + Terrain.Size[1] * 0.45];
        const Stamp = Radius => P.StampSculpt(Field, Terrain, Sculpt, { X: Centre[0] + Math.random() * 200, Z: Centre[1] + Math.random() * 200, Radius, Strength: 0.4, Hardness: 0.3, Mode: 0, FlattenHeight: 0 });
        Evaluate(null);
        Sync();
        Rows.ColdEvaluate = Time(() => { Doc.TouchTerrain(Terrain); return Evaluate(null); });
        Evaluate(Sculpt.Id);
        Rows.StampOnly160m = Time(() => { Stamp(160); return 1; }, Repetitions * 3);
        Rows.StampOnly1000m = Time(() => { Stamp(1000); return 1; }, Repetitions * 3);
        Rows.SculptEditFullFromCache = Time(() => { Stamp(160); return Evaluate(Sculpt.Id); });
        Rows.SculptEditRegion160m = Time(() => { const Rect = Stamp(160); return Evaluate(Sculpt.Id, { Interactive: true, DirtyRect: Rect }); }, Repetitions * 3);
        Rows.SculptEditRegion1000m = Time(() => { const Rect = Stamp(1000); return Evaluate(Sculpt.Id, { Interactive: true, DirtyRect: Rect }); }, Repetitions * 3);
        Rows.StrokeEndRefine = Time(() => { Field.NeedsRefine = true; return Evaluate(Sculpt.Id); });
        for (let Index = 0; Index < 40; ++Index) { const Rect = Stamp(120 + Index * 5); Evaluate(Sculpt.Id, { Interactive: true, DirtyRect: Rect }); }
        const RegionHeights = P.ReadHeightField(Field);
        Doc.TouchTerrain(Terrain);
        Evaluate(null);
        const FullHeights = P.ReadHeightField(Field);
        let MaximumDifference = 0;
        for (let Index = 0; Index < FullHeights.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(FullHeights[Index] - RegionHeights[Index]));
        Rows.RegionExactness = { MaximumHeightDifferenceMetres: MaximumDifference, Texels: FullHeights.length };
        const Compare = () =>
        {
            const RegionHeights = P.ReadHeightField(Field);
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const FullHeights = P.ReadHeightField(Field);
            let MaximumDifference = 0;
            for (let Index = 0; Index < FullHeights.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(FullHeights[Index] - RegionHeights[Index]));
            return MaximumDifference;
        };
        if (Spline)
        {
            Evaluate(Spline.Id);
            const Point = Spline.Splines[0].Points[1];
            Rows.SplineDragIncremental = Time(() => { Point.X += 3; Doc.TouchLayer(Spline, true); return Evaluate(Spline.Id, { Interactive: true }); });
            const Region = Field.LastEvaluation.Region;
            Rows.SplineDragIncremental.AreaFraction = Region ? (Region[2] * Region[3]) / (Field.Resolution * Field.Resolution) : 1;
            Rows.SplineDragIncremental.LayersApplied = Field.LastEvaluation.Layers;
            // 📝 Exactness: point moves (small and large), add / remove a spline (atlas row shift), parameter change.
            const Modes = [];
            const RegisterMode = () => { Modes.push(Field.LastEvaluation.Region ? "Region" : "Full"); };
            for (let Step = 0; Step < 12; ++Step)
            {
                const Target = Spline.Splines[0].Points[Step % Spline.Splines[0].Points.length];
                Target.X += (Step % 3 === 0 ? 180 : 9) * (Step % 2 ? -1 : 1);
                Target.Z += (Step % 4 === 0 ? 140 : -6);
                Doc.TouchLayer(Spline, true);
                Evaluate(Spline.Id, { Interactive: true });
                RegisterMode();
            }
            const C = [Terrain.Min[0] + Terrain.Size[0] * 0.3, Terrain.Min[1] + Terrain.Size[1] * 0.7];
            Spline.Splines.push({ Id: "BenchmarkSpline", Points: [{ X: C[0], Z: C[1], Width: 1, Lift: 0 }, { X: C[0] + 600, Z: C[1] - 200, Width: 1, Lift: 0 }, { X: C[0] + 1100, Z: C[1] + 100, Width: 1, Lift: 0 }] });
            Doc.TouchLayer(Spline, true); Evaluate(Spline.Id, { Interactive: true }); RegisterMode();
            Spline.Splines[Spline.Splines.length - 1].Points[1].Z += 250;
            Doc.TouchLayer(Spline, true); Evaluate(Spline.Id, { Interactive: true }); RegisterMode();
            Spline.Splines.pop();
            Doc.TouchLayer(Spline, true); Evaluate(Spline.Id, { Interactive: true }); RegisterMode();
            Spline.Parameters.Width *= 1.3;
            Doc.TouchLayer(Spline, true); Evaluate(Spline.Id, { Interactive: true }); RegisterMode();
            Rows.SplineRegionExactness = { MaximumHeightDifferenceMetres: Compare(), Edits: Modes.length, RegionEdits: Modes.filter(Mode => Mode === "Region").length, Modes };
        }
        // 📝 Binning exactness: binned spline query vs one bin holding every group (the exhaustive loop).
        {
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const Binned = P.ReadHeightField(Field);
            const SavedBin = P.BinTexels;
            P.BinTexels = Field.Resolution;
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const Exhaustive = P.ReadHeightField(Field);
            P.BinTexels = SavedBin;
            let MaximumDifference = 0;
            for (let Index = 0; Index < Binned.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(Binned[Index] - Exhaustive[Index]));
            let Entries = 0;
            Field.SplineBins.forEach(Entry => Entries += Entry.Entries || 0);
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            Rows.BinningExactness = { MaximumHeightDifferenceMetres: MaximumDifference, ExhaustiveBinEntries: Entries };
        }
        // 📝 Noise cache exactness: ocean skip + cached noise vs every octave evaluated inline on every texel.
        {
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const Skipped = P.ReadHeightField(Field);
            P.ExhaustiveNoise = true;
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const Exhaustive = P.ReadHeightField(Field);
            P.ExhaustiveNoise = false;
            let MaximumDifference = 0;
            for (let Index = 0; Index < Skipped.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(Skipped[Index] - Exhaustive[Index]));
            Rows.NoiseCacheExactness = { MaximumHeightDifferenceMetres: MaximumDifference, Texels: Skipped.length };
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
        }
        if (Shape)
        {
            Rows.ShapeParameterEdit = Time(() => { Shape.Parameters.Relief += 1; Doc.TouchLayer(Shape); return Evaluate(Shape.Id); });
            Rows.ShapeStrokeEdit = Time(() => { Shape.Strokes[0].Points[0][0] += 2; Doc.TouchLayer(Shape, true); return Evaluate(Shape.Id); });
            // 📝 Grown stroke: the cached noise rectangle must extend under a scissor; compared against inline noise.
            const Stroke = Shape.Strokes[0].Points;
            const Centre = Stroke.reduce((Sum, Point) => [Sum[0] + Point[0] / Stroke.length, Sum[1] + Point[1] / Stroke.length], [0, 0]);
            const Outward = [Stroke[0][0] - Centre[0], Stroke[0][1] - Centre[1]];
            const Length = Math.hypot(Outward[0], Outward[1]) || 1;
            Stroke[0][0] += Outward[0] / Length * 600;
            Stroke[0][1] += Outward[1] / Length * 600;
            Shape.Parameters.Relief += 15;
            Doc.TouchLayer(Shape, true);
            Evaluate(Shape.Id);
            const Cached = P.ReadHeightField(Field);
            P.ExhaustiveNoise = true;
            Doc.TouchTerrain(Terrain);
            Evaluate(null);
            const Inline = P.ReadHeightField(Field);
            P.ExhaustiveNoise = false;
            let MaximumDifference = 0;
            for (let Index = 0; Index < Cached.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(Cached[Index] - Inline[Index]));
            Rows.ShapeNoiseCacheExactness = { MaximumHeightDifferenceMetres: MaximumDifference, GrowthMetres: 600 };
        }
        const Relief = Session.Relief;
        const Region = Session.Regions.Relief || { X: 0, Y: 0, Width: Session.SceneWidth, Height: Session.SceneHeight };
        const SavedScale = [Relief.Scale, Relief.ScaleMode];
        const Render = Scale => { Relief.Scale = Scale; Relief.ScaleMode = "Full"; Relief.Render(Region, Session.DevicePixels, Session.GpuCanvas.height, Doc, Field, Terrain); D.GL.readPixels(0, 0, 1, 1, D.GL.RGBA, D.GL.UNSIGNED_BYTE, new Uint8Array(4)); return 1; };
        Rows.ReliefRenderFull = Time(() => Render(1));
        Rows.ReliefRenderHalf = Time(() => Render(0.5));
        [Relief.Scale, Relief.ScaleMode] = SavedScale;
        Rows.CalibrationSeedPass = Time(() => { D.RasterizeTriangle(P.Programs.StackSeed, Field.StackB, { uSeabed: -70 }); return 1; });
    }
    finally
    {
        Doc.Decode(SavedDocument);
        const Current = Session.ActiveField();
        SavedRasters.forEach((Surface, LayerId) =>
        {
            if (Current === Field) { D.CopyRegion(Surface, P.EnsureSculpt(Field, LayerId)); Field.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1); }
            D.ReleaseTexture(Surface);
        });
        Session.Paused = false;
        Session.Invalidate();
    }
    return { Resolution: Field.Resolution, Viewport: [Math.round((Session.Regions.Relief || { Width: Session.SceneWidth }).Width * Session.DevicePixels), Math.round((Session.Regions.Relief || { Height: Session.SceneHeight }).Height * Session.DevicePixels)], Renderer: D.RendererLabel, Rows };
}

// 📝 Stamps Total brush dabs into a scratch sculpt layer and reports per-batch cost and GPU memory before/after.
export function MeasureUnboundedStamps(Session, Total = 3000, Batch = 300)
{
    const D = Session.Device, P = Session.Pipeline, Doc = Session.Document;
    const Terrain = Doc.RetrieveTerrain();
    const Field = Session.ActiveField();
    const Sculpt = [...Terrain.Layers].reverse().find(Layer => Layer.Category === "Sculpt");
    const Sync = () => D.ReadSynchronous(Field.Final, 0, 0, 1, 1);
    P.EnsureSculpt(Field, Sculpt.Id);
    const MemoryBefore = Field.MemoryBytes();
    const Batches = [];
    let Done = 0;
    while (Done < Total)
    {
        Sync();
        const Started = performance.now();
        for (let Index = 0; Index < Batch; ++Index, ++Done)
        {
            const Angle = Done * 0.037;
            const Radius = 600 + 500 * Math.sin(Done * 0.011);
            P.StampSculpt(Field, Terrain, Sculpt, { X: Terrain.Min[0] + Terrain.Size[0] * 0.5 + Math.cos(Angle) * Radius, Z: Terrain.Min[1] + Terrain.Size[1] * 0.5 + Math.sin(Angle) * Radius,
                                                   Radius: 110, Strength: 1.5, Hardness: 0.5, Mode: Done % 9 === 0 ? 2 : 0, FlattenHeight: 0 });
        }
        Sync();
        Batches.push({ After: Done, MillisecondsPerStamp: (performance.now() - Started) / Batch });
    }
    Session.Invalidate();
    return { Total, MemoryBefore, MemoryAfter: Field.MemoryBytes(), Batches };
}
