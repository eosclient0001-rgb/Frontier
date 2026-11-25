/*====================================================================================================================================
                                                    INTERACTIONVALIDATION.MJS
====================================================================================================================================*/
// 🧩 Drives the prototype with real pointer/keyboard events: 3D sculpt, spline drag, undo, empty world → shape → bounds

const Images = new URL("../Images/", import.meta.url).pathname;
const Results = [];
const Pause = Milliseconds => new Promise(Resolve => setTimeout(Resolve, Milliseconds));

async function SceneBox(Page)
{
    return Page.evaluate(() => { const Box = document.getElementById("Scene").getBoundingClientRect(); return { X: Box.left, Y: Box.top, W: Box.width, H: Box.height }; });
}

async function Idle(Page, Milliseconds = 1500) { await Pause(Milliseconds); }

function Report(Name, Pass, Detail) { Results.push({ Name, Pass, Detail }); console.log(`[T] ${Pass ? "PASS" : "FAIL"} ${Name} — ${Detail}`); }

export default async function Run(Page)
{
    const Box = await SceneBox(Page);
    const Half = Box.W / 2;
    await Page.screenshot({ path: Images + "01_ExampleWorldSplit.png" });

    // ---- 3D sculpt: raise stroke across the massif
    await Page.keyboard.press("b");
    const SculptBefore = await Page.evaluate(() => { const S = window.TerrainAuthoring; const F = S.ActiveField(); const L = S.ResolveSculptLayer(); return F.SculptRevisions.get(L.Id) || 0; });
    const Sx = Box.X + Half + Half * 0.42, Sy = Box.Y + Box.H * 0.55;
    await Page.mouse.move(Sx, Sy);
    await Pause(400);
    await Page.mouse.down();
    for (let Step = 0; Step <= 12; ++Step) { await Page.mouse.move(Sx + Step * 14, Sy - Step * 4); await Pause(120); }
    await Page.mouse.up();
    await Idle(Page, 2500);
    const SculptAfter = await Page.evaluate(() => { const S = window.TerrainAuthoring; const F = S.ActiveField(); const L = S.ResolveSculptLayer(); return { Revision: F.SculptRevisions.get(L.Id) || 0, Stamps: S.Metrics.TotalStamps, Undo: S.History.Undo.map(Entry => Entry.Label) }; });
    Report("Sculpt stroke in 3D", SculptAfter.Revision > SculptBefore && SculptAfter.Stamps > 0, `revision ${SculptBefore}→${SculptAfter.Revision}, stamps ${SculptAfter.Stamps}, history [${SculptAfter.Undo.join(", ")}]`);
    await Page.screenshot({ path: Images + "02_AfterSculptStroke.png" });

    // ---- Undo restores the raster
    const HeightProbe = () => Page.evaluate(() => { const S = window.TerrainAuthoring; const T = S.Document.RetrieveTerrain(); const F = S.ActiveField(); const Heights = S.Pipeline.ReadHeightField(F); let Sum = 0; for (const H of Heights) Sum += H; return Sum / Heights.length; });
    const MeanSculpted = await HeightProbe();
    await Page.keyboard.down("Control"); await Page.keyboard.press("z"); await Page.keyboard.up("Control");
    await Idle(Page, 2500);
    const MeanUndone = await HeightProbe();
    await Page.keyboard.down("Control"); await Page.keyboard.press("y"); await Page.keyboard.up("Control");
    await Idle(Page, 2500);
    const MeanRedone = await HeightProbe();
    Report("Sculpt undo / redo", Math.abs(MeanSculpted - MeanRedone) < 1e-3 && Math.abs(MeanSculpted - MeanUndone) > 1e-4, `mean height ${MeanSculpted.toFixed(4)} → undo ${MeanUndone.toFixed(4)} → redo ${MeanRedone.toFixed(4)} m`);

    // ---- Spline control point drag in 2D (road)
    await Page.keyboard.press("v");
    const Handle = await Page.evaluate(() =>
    {
        const S = window.TerrainAuthoring;
        const Layer = S.Document.Layers.find(Candidate => Candidate.Variant === "Road");
        const Point = Layer.Splines[0].Points[2];
        const [X, Y] = S.Plan.WorldToScreen(Point.X, Point.Z);
        return { X, Y, WorldX: Point.X, WorldZ: Point.Z };
    });
    await Page.mouse.move(Box.X + Handle.X, Box.Y + Handle.Y);
    await Page.mouse.down();
    const DragModes = [];
    for (let Step = 1; Step <= 8; ++Step)
    {
        await Page.mouse.move(Box.X + Handle.X + Step * 5, Box.Y + Handle.Y + Step * 6);
        await Pause(150);
        DragModes.push(await Page.evaluate(() => { const E = window.TerrainAuthoring.ActiveField().LastEvaluation; return E.Region ? (E.Region === "Refine" ? "Refine" : "Region") : "Full"; }));
    }
    await Page.mouse.up();
    await Idle(Page, 2500);
    const Moved = await Page.evaluate(() => { const S = window.TerrainAuthoring; const Layer = S.Document.Layers.find(Candidate => Candidate.Variant === "Road"); const P = Layer.Splines[0].Points[2]; return { X: P.X, Z: P.Z, Selection: S.Selection, Evaluation: S.ActiveField().LastEvaluation }; });
    Report("Spline point drag (2D)", Math.hypot(Moved.X - Handle.WorldX, Moved.Z - Handle.WorldZ) > 50 && Moved.Evaluation.FromCache && !DragModes.includes("Full"),
        `moved ${Math.hypot(Moved.X - Handle.WorldX, Moved.Z - Handle.WorldZ).toFixed(0)} m; cached layer ${Moved.Evaluation.CacheIndex}; evaluation per drag tick [${DragModes.join(", ")}]`);
    await Page.screenshot({ path: Images + "03_AfterRoadDrag.png" });

    // ---- Empty world: draw a shape stroke, then bounds
    await Page.evaluate(() => window.TerrainAuthoring.ResetWorld(false));
    await Idle(Page, 800);
    await Page.keyboard.press("d");
    const Cx = Box.X + Half * 0.5, Cy = Box.Y + Box.H * 0.5;
    await Page.mouse.move(Cx + 150, Cy);
    await Page.mouse.down();
    for (let Step = 0; Step <= 40; ++Step)
    {
        const Angle = Step / 40 * Math.PI * 2;
        const Radius = 150 * (1 + 0.25 * Math.sin(Angle * 3));
        await Page.mouse.move(Cx + Math.cos(Angle) * Radius * 1.3, Cy + Math.sin(Angle) * Radius);
        await Pause(25);
    }
    await Page.mouse.up();
    await Page.keyboard.press("r");
    await Page.mouse.move(Cx - 240, Cy - 200);
    await Page.mouse.down();
    for (let Step = 1; Step <= 10; ++Step) { await Page.mouse.move(Cx - 240 + Step * 48, Cy - 200 + Step * 40); await Pause(40); }
    await Page.mouse.up();
    await Page.keyboard.press("v");
    await Idle(Page, 6000);
    const Created = await Page.evaluate(() =>
    {
        const S = window.TerrainAuthoring, T = S.Document.Terrains[0];
        return { Terrains: S.Document.Terrains.map(C => `${C.Name} ${C.Size.map(V => V.toFixed(0)).join("×")} m`), Layers: T ? T.Layers.map(L => `${L.Name}(${L.Strokes ? L.Strokes.length : "-"})`) : [],
                 Unassigned: S.Document.Unassigned.length, Points: T?.Layers[0]?.Strokes[0]?.Points.length, Evaluated: S.ActiveField()?.HasEvaluated };
    });
    Report("Empty world → shape stroke → bounds cell", Created.Terrains.length === 1 && Created.Evaluated && Created.Points > 3 && Created.Layers.length === 1 && Created.Unassigned === 0,
        `${Created.Terrains.join(", ")}; drawn while unassigned, adopted into its stack: ${Created.Layers.join(", ")}; unassigned left ${Created.Unassigned}; stroke condensed to ${Created.Points} points`);
    await Page.evaluate(() => window.TerrainAuthoring.FrameActive());
    await Idle(Page, 3000);
    await Page.screenshot({ path: Images + "04_ShapeAndBoundsFromEmpty.png" });

    // ---- Canyon spline on the new landmass, drawn in 2D
    await Page.keyboard.press("p");
    await Page.evaluate(() => { const S = window.TerrainAuthoring; S.SplineVariant = "Canyon"; });
    for (const [Dx, Dy] of [[-200, 40], [-80, -20], [40, 30], [190, -10]]) { await Page.mouse.click(Cx + Dx, Cy + Dy); await Pause(200); }
    await Page.keyboard.press("Enter");
    await Page.keyboard.press("v");
    await Idle(Page, 4000);
    const Canyon = await Page.evaluate(() => { const S = window.TerrainAuthoring; const L = S.Document.Layers.find(Candidate => Candidate.Variant === "Canyon"); return L ? L.Splines.map(Spline => Spline.Points.length) : []; });
    Report("Canyon spline drawn in 2D", Canyon.length === 1 && Canyon[0] === 4, `splines/points ${JSON.stringify(Canyon)}`);
    await Page.screenshot({ path: Images + "05_CanyonOnNewLandmass.png" });

    // ---- Second region with its own layer stack: box drawn and shape stroked with the mouse in 2D
    const First = await Page.evaluate(() =>
    {
        const S = window.TerrainAuthoring, T = S.Document.Terrains[0];
        window.FirstHeights = S.Pipeline.ReadHeightField(S.Fields.get(T.Id));
        const Second = { Min: [T.Min[0] + T.Size[0] + 400, T.Min[1]], Size: [...T.Size] };
        S.Plan.FrameRectangle(T.Min, [T.Size[0] * 2 + 400, T.Size[1]]);
        S.Invalidate();
        return { Id: T.Id, Layers: T.Layers.map(L => L.Id), Second };
    });
    await Idle(Page, 600);
    const ToScreen = (X, Z) => Page.evaluate((X, Z) => window.TerrainAuthoring.Plan.WorldToScreen(X, Z), X, Z);
    await Page.keyboard.press("r");
    const [Ax, Ay] = await ToScreen(First.Second.Min[0], First.Second.Min[1]);
    const [Bx, By] = await ToScreen(First.Second.Min[0] + First.Second.Size[0], First.Second.Min[1] + First.Second.Size[1]);
    await Page.mouse.move(Box.X + Ax, Box.Y + Ay);
    await Page.mouse.down();
    for (let Step = 1; Step <= 10; ++Step) { await Page.mouse.move(Box.X + Ax + (Bx - Ax) * Step / 10, Box.Y + Ay + (By - Ay) * Step / 10); await Pause(40); }
    await Page.mouse.up();
    await Idle(Page, 1500);
    await Page.keyboard.press("d");
    const Mx = Box.X + (Ax + Bx) / 2, My = Box.Y + (Ay + By) / 2, Rx = Math.abs(Bx - Ax) * 0.3, Ry = Math.abs(By - Ay) * 0.3;
    await Page.mouse.move(Mx + Rx, My);
    await Page.mouse.down();
    for (let Step = 0; Step <= 40; ++Step)
    {
        const Angle = Step / 40 * Math.PI * 2;
        const Wobble = 1 + 0.2 * Math.sin(Angle * 4);
        await Page.mouse.move(Mx + Math.cos(Angle) * Rx * Wobble, My + Math.sin(Angle) * Ry * Wobble);
        await Pause(25);
    }
    await Page.mouse.up();
    await Page.keyboard.press("v");
    await Idle(Page, 6000);
    const Regions = await Page.evaluate(First =>
    {
        const S = window.TerrainAuthoring, Doc = S.Document;
        const A = Doc.RetrieveTerrain(First.Id), B = Doc.Terrains.find(T => T.Id !== First.Id);
        const Heights = S.Pipeline.ReadHeightField(S.Fields.get(A.Id));
        let MaximumDifference = 0;
        for (let Index = 0; Index < Heights.length; ++Index) MaximumDifference = Math.max(MaximumDifference, Math.abs(Heights[Index] - window.FirstHeights[Index]));
        const Keys = [...document.querySelectorAll("#OutlinerRows .outliner-row")].map(Row => Row.dataset.key);
        const Position = Key => Keys.indexOf(Key);
        const NestedA = A.Layers.every(L => Position(`Layer:${L.Id}`) > Position(`Terrain:${A.Id}`) && (!B || Position(`Layer:${L.Id}`) < Position(`Terrain:${B.Id}`)));
        const NestedB = !!B && B.Layers.length > 0 && B.Layers.every(L => Position(`Layer:${L.Id}`) > Position(`Terrain:${B.Id}`));
        return { Count: Doc.Terrains.length, SecondName: B?.Name, SecondLayers: B ? B.Layers.map(L => `${L.Name}(${L.Strokes ? L.Strokes.length : "-"})`) : [],
                 FirstUnchanged: JSON.stringify(A.Layers.map(L => L.Id)) === JSON.stringify(First.Layers), MaximumDifference, NestedA, NestedB,
                 SecondEvaluated: !!(B && S.Fields.get(B.Id)?.HasEvaluated), Active: Doc.RetrieveTerrain()?.Name,
                 SecondPoints: B?.Layers[0]?.Strokes?.[0]?.Points.length || 0,
                 SecondPeak: B ? S.Pipeline.ReadHeightField(S.Fields.get(B.Id)).reduce((Peak, Height) => Math.max(Peak, Height), -Infinity) : -Infinity };
    }, First);
    Report("Second region owns its own layer stack", Regions.Count === 2 && Regions.SecondLayers.length === 1 && Regions.FirstUnchanged && Regions.MaximumDifference === 0 && Regions.NestedA && Regions.NestedB && Regions.SecondEvaluated && Regions.SecondPeak > 0 && Regions.SecondPoints > 3,
        `${Regions.SecondName} stack [${Regions.SecondLayers.join(", ")}], closed-loop stroke ${Regions.SecondPoints} points, peak ${Regions.SecondPeak.toFixed(1)} m; first stack unchanged ${Regions.FirstUnchanged}, its heights differ by ${Regions.MaximumDifference} m; outliner nests each stack under its region ${Regions.NestedA && Regions.NestedB}; active ${Regions.Active}`);
    await Page.evaluate(() => { const S = window.TerrainAuthoring; S.Relief.FrameTerrain(S.Document.RetrieveTerrain()); S.Invalidate(); });
    await Idle(Page, 3000);
    await Page.screenshot({ path: Images + "08_TwoRegionsOwnStacks.png" });

    const Fs = await import("node:fs");
    Fs.writeFileSync(new URL("../Results/InteractionValidation.json", import.meta.url), JSON.stringify(Results, null, 2));
}
