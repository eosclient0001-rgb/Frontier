/*============================================================================================================================================

                                                        TERRAINSTUDIO.VALIDATION.MJS

// 🧩 Headless browser validation for the Terrain Studio prototype: real mouse strokes (3D sculpt, 2D authoring),
//    undo/redo and live spline edits are driven through Puppeteer; timings, revision counts and screenshots are
//    captured as evidence into Exhibits/TerrainStudio/.

//--------------------------------------------------------------------------------------------------------------------------------------------

Usage:   node TerrainStudio.Validation.mjs [Url] [OutDirectory]
Serve:   the studio must be reachable over HTTP, e.g.
         python3 -m http.server 8080 --bind 0.0.0.0 --directory Experimental/TerrainStudio
Browser: set CHROMIUM_PATH to a chrome/chromium binary, or install @sparticuz/chromium + extract its libraries
         (see Exhibits/TerrainStudio/README.md for the SwiftShader recipe).

============================================================================================================================================*/

import fs from "node:fs";
import puppeteer from "puppeteer-core";

//--------------------------------------------------------------------------------------------------------------------
//                                                  CONFIGURATION
//--------------------------------------------------------------------------------------------------------------------

const Url          = process.argv[2] ?? "http://127.0.0.1:8080/?example";             // [url] - served studio with the example document
const OutDirectory = process.argv[3] ?? new URL("../../../Exhibits/TerrainStudio/ValidationRun", import.meta.url).pathname;
const Viewport     = { width: 1600, height: 900 };                                    // [px]  - fixed so captures are comparable

const ResolveBrowserPath = async () =>
{
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;                  // 📝 system browser override
    const Module = await import("@sparticuz/chromium").catch(() => null);
    if (!Module) throw new Error("No browser: set CHROMIUM_PATH or npm install @sparticuz/chromium + puppeteer-core");
    return Module.default.executablePath();
};

const ResolveBrowserArgs = async () =>
{
    const SwiftShader = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
    const Module = await import("@sparticuz/chromium").catch(() => null);
    if (!Module || process.env.CHROMIUM_PATH) return ["--no-sandbox", ...SwiftShader];
    return [...Module.default.args.filter((Argument) => !Argument.startsWith("--single-process")), ...SwiftShader];
};

//--------------------------------------------------------------------------------------------------------------------
//                                                   HARNESS
//--------------------------------------------------------------------------------------------------------------------

fs.mkdirSync(OutDirectory, { recursive: true });

const Browser = await puppeteer.launch(
{
    executablePath: await ResolveBrowserPath(),
    args:           await ResolveBrowserArgs(),
    headless:       true,
    defaultViewport: Viewport,
});

const Page = await Browser.newPage();
const Logs = [];
Page.on("console",   (Message) => { if (!Message.text().includes("GPU stall")) Logs.push(`[${Message.type()}] ${Message.text()}`); });
Page.on("pageerror", (Error)    => Logs.push(`[pageerror] ${Error.message}\n${Error.stack}`));

const Sleep   = (Milliseconds) => new Promise((Resolve) => setTimeout(Resolve, Milliseconds));
const Report  = {};
const Capture = async (Name) => { await Sleep(1500); await Page.screenshot({ path: `${OutDirectory}/${Name}.png` }); };

// 📝 studio introspection: document counts, evaluation revision, CPU submit timings and the GPU timer query
const Measure = () => Page.evaluate(() =>
{
    const Studio = window.TerrainStudio;
    const Evaluation = Studio.Evaluation;
    return {
        Revision: Evaluation.Revision,
        Timings:  { ...Evaluation.Timings },
        Undo:     Studio.UndoStack.length,
        Shapes:   Studio.Document.Shapes.length,
        Regions:  Studio.Document.Regions.length,
        Splines:  Studio.Document.Layers.reduce((Total, Layer) => Total + Layer.Splines.length, 0),
        Region:   Evaluation.Region?.Name,
        Adapter:  Studio.Gpu.AdapterName,
    };
});

const CanvasRect = async (Id) => Page.evaluate((Id) =>
{
    const Rect = document.getElementById(Id).getBoundingClientRect();
    return { X: Rect.left, Y: Rect.top, W: Rect.width, H: Rect.height };
}, Id);

//--------------------------------------------------------------------------------------------------------------------
//                                            ① INITIAL LOAD · EXAMPLE DOCUMENT
//--------------------------------------------------------------------------------------------------------------------

await Page.goto(Url, { waitUntil: "load" });
await Sleep(5000);                                                                  // [ms] - GPU timer query resolves on a later loop
Report.Initial = await Measure();

//--------------------------------------------------------------------------------------------------------------------
//                                            ② 3D WORKSPACE · HEIGHT SCULPT
//--------------------------------------------------------------------------------------------------------------------

await Page.keyboard.press("2");
await Sleep(1500);
await Capture("01-Terrain");

await Page.evaluate(() =>
{
    const Studio = window.TerrainStudio;
    const Layer  = Studio.Document.Layers.find((Layer) => Layer.Category === "HeightSculpt");
    Studio.Select({ Category: "Layer", Token: Layer.Token });
    Studio.ConfigureTerrainTool("Sculpt");
    Studio.HeightBrush.Radius   = 70;                                               // [m]
    Studio.HeightBrush.Strength = 1;
});

const Terrain    = await CanvasRect("TerrainCanvas");
const BrushTimes = [];
await Page.mouse.move(Terrain.X + Terrain.W * 0.35, Terrain.Y + Terrain.H * 0.62);
await Page.mouse.down();
for (let Step = 0; Step <= 24; Step++)
{
    await Page.mouse.move(Terrain.X + Terrain.W * (0.35 + Step * 0.012), Terrain.Y + Terrain.H * (0.62 - Step * 0.004));
    await Sleep(120);
    BrushTimes.push(await Page.evaluate(() => [window.TerrainStudio.Evaluation.Timings.Brush, window.TerrainStudio.Evaluation.Timings.BrushDabs]));
}
await Page.mouse.up();
Report.HeightStroke = { ...(await Measure()), BrushBatches: BrushTimes };
await Capture("02-HeightSculpt");

//--------------------------------------------------------------------------------------------------------------------
//                                      ③ 3D WORKSPACE · VOLUME CARVE (CAVES / OVERHANGS)
//--------------------------------------------------------------------------------------------------------------------

await Page.evaluate(() =>
{
    const Studio = window.TerrainStudio;
    const Layer  = Studio.Document.Layers.find((Layer) => Layer.Category === "VolumeSculpt");
    Studio.Select({ Category: "Layer", Token: Layer.Token });
    Studio.ConfigureTerrainTool("Sculpt");
    Studio.VolumeBrush.Mode   = 1;                                                  // carve
    Studio.VolumeBrush.Radius = 30;                                                 // [m]
});

await Page.mouse.move(Terrain.X + Terrain.W * 0.55, Terrain.Y + Terrain.H * 0.45);
await Page.mouse.down();
const VolumeTimes = [];
for (let Step = 0; Step <= 12; Step++)
{
    await Page.mouse.move(Terrain.X + Terrain.W * (0.55 + Step * 0.01), Terrain.Y + Terrain.H * (0.45 + Step * 0.004));
    await Sleep(150);
    VolumeTimes.push(await Page.evaluate(() => [window.TerrainStudio.Evaluation.Timings.Brush, window.TerrainStudio.Evaluation.Timings.BrushDabs]));
}
await Page.mouse.up();
Report.VolumeStroke = { ...(await Measure()), BrushBatches: VolumeTimes, VolumeLayerCount: await Page.evaluate(() => window.TerrainStudio.Evaluation.VolumeLayerCount) };
await Capture("03-VolumeCarve");

//--------------------------------------------------------------------------------------------------------------------
//                                            ④ UNDO / REDO · GPU SNAPSHOTS
//--------------------------------------------------------------------------------------------------------------------

await Page.keyboard.down("Control"); await Page.keyboard.press("z"); await Page.keyboard.up("Control");
await Sleep(1500);
await Capture("04-UndoCarve");
Report.AfterUndo = await Measure();
await Page.keyboard.down("Control"); await Page.keyboard.press("y"); await Page.keyboard.up("Control");
await Sleep(800);
Report.AfterRedo = await Measure();

//--------------------------------------------------------------------------------------------------------------------
//                                 ⑤ 2D WORKSPACE · LASSO SHAPE + REGION BOX + CANYON SPLINE
//--------------------------------------------------------------------------------------------------------------------

await Page.keyboard.press("1");
await Sleep(1200);
await Page.evaluate(() => { const Studio = window.TerrainStudio; Studio.Planar.FocusRect(-700, -900, 3200, 1800); Studio.ConfigurePlanarTool("Lasso"); });
await Sleep(600);

const ToClient = async (WorldX, WorldZ) => Page.evaluate((WorldX, WorldZ) =>
{
    const Planar = window.TerrainStudio.Planar;
    const Screen = Planar.ProjectToScreen(WorldX, WorldZ);
    const Rect   = Planar.Canvas.getBoundingClientRect();
    return { X: Rect.left + Screen.X, Y: Rect.top + Screen.Y };
}, WorldX, WorldZ);

// ① lasso-freehand a new landmass east of the island
const Outline = [];
for (let Index = 0; Index <= 40; Index++)
{
    const θ      = Index / 40 * Math.PI * 2;
    const Radius = 420 * (1 + 0.15 * Math.sin(θ * 3) + 0.07 * Math.cos(θ * 5));
    Outline.push([1700 + Math.cos(θ) * Radius * 1.3, Math.sin(θ) * Radius]);
}
let Point = await ToClient(...Outline[0]);
await Page.mouse.move(Point.X, Point.Y);
await Page.mouse.down();
for (const [WorldX, WorldZ] of Outline.slice(1)) { Point = await ToClient(WorldX, WorldZ); await Page.mouse.move(Point.X, Point.Y, { steps: 2 }); }
await Page.mouse.up();
await Sleep(600);

// ② region box around the new landmass (world-partition bounds)
await Page.evaluate(() => window.TerrainStudio.ConfigurePlanarTool("Region"));
const CornerA = await ToClient(1050, -560), CornerB = await ToClient(2350, 560);
await Page.mouse.move(CornerA.X, CornerA.Y);
await Page.mouse.down();
await Page.mouse.move(CornerB.X, CornerB.Y, { steps: 12 });
await Page.mouse.up();
await Sleep(2500);

// ③ canyon spline through the new region
await Page.evaluate(() => { const Studio = window.TerrainStudio; Studio.ConfigurePlanarTool("Spline"); Studio.ToolOptions.SplineCategory = "Canyon"; });
const SplinePoints = [[1250, -250], [1550, -80], [1800, 60], [2150, 180]];
for (let Index = 0; Index < SplinePoints.length; Index++)
{
    const Click = await ToClient(...SplinePoints[Index]);
    await Page.mouse.click(Click.X, Click.Y, { count: Index === SplinePoints.length - 1 ? 2 : 1 });
    await Sleep(200);
}
await Sleep(3000);
Report.Authoring2D = await Measure();
await Capture("05-Planar-NewRegion");

//--------------------------------------------------------------------------------------------------------------------
//                            ⑥ SPLIT VIEW + LIVE SPLINE EDIT · RE-EVALUATION MEASUREMENT
//--------------------------------------------------------------------------------------------------------------------

await Page.keyboard.press("3");
await Page.evaluate(() => window.TerrainStudio.FocusActiveRegion());
await Sleep(3000);
await Capture("06-Split-NewRegion");

// 📝 each sample forces a full Evaluate + gl.finish so CPU and GPU cost are both inside the measurement;
//    the revision counter proves every edit re-evaluated (no-op edits would leave it unchanged)
Report.SplineEdits = await Page.evaluate(async () =>
{
    const Studio = window.TerrainStudio;
    const Spline = Studio.Document.Layers.flatMap((Layer) => Layer.Splines).find((Spline) => Spline.Category === "Canyon" && Spline.Points[0].X > 1000);
    const Samples = [];
    for (let Step = 0; Step < 6; Step++)
    {
        Studio.BeginDocumentEdit();
        Spline.Depth = 70 + Step * 12;                                              // [m]
        Spline.Width = 36 + Step * 4;                                               // [m]
        Studio.NotifyDocumentEdit("Splines");
        const Before = Studio.Evaluation.Revision;
        const Start  = performance.now();
        Studio.Evaluation.Evaluate(Studio.Document);
        Studio.Evaluation.Context.finish();                                         // ⏳ wait for the GPU queue to drain
        Samples.push({ Milliseconds: performance.now() - Start, RevisionDelta: Studio.Evaluation.Revision - Before, Depth: Spline.Depth });
    }
    Studio.FinalizeDocumentEdit();
    return Samples;
});
await Capture("07-Split-CanyonEdited");

//--------------------------------------------------------------------------------------------------------------------
//                                                   REPORT
//--------------------------------------------------------------------------------------------------------------------

Report.Logs = Logs;
Report.Errors = Logs.filter((Entry) => Entry.startsWith("[pageerror]") || Entry.startsWith("[error]"));
fs.writeFileSync(`${OutDirectory}/Report.json`, JSON.stringify(Report, null, 1));

const BrushMaximum = Math.max(...Report.HeightStroke.BrushBatches.map(([Milliseconds]) => Milliseconds));
const EditMaximum  = Math.max(...Report.SplineEdits.map((Sample) => Sample.Milliseconds));
const EditVerified = Report.SplineEdits.every((Sample) => Sample.RevisionDelta >= 1);
console.log(`✔️ validation finished → ${OutDirectory}`);
console.log(`   height brush batch max ${BrushMaximum.toFixed(2)} ms CPU · spline edit max ${EditMaximum.toFixed(2)} ms (blocking) · revisions verified: ${EditVerified}`);
console.log(`   console/page errors: ${Report.Errors.length}`);
if (Report.Errors.length || !EditVerified) process.exitCode = 1;
await Browser.close();
