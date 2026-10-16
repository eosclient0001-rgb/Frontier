import Assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const Browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const Page = await Browser.newPage({viewport: {width: 1440, height: 900}});
const Errors = [];
const ModuleRequests = [];
Page.on("request", (Value) => { if (/GeometryModule/.test(Value.url())) ModuleRequests.push(Value.url()); });
Page.on("pageerror", (Value) => Errors.push(Value.message));
Page.on("console", (Value) => { if (Value.type() === "error") Errors.push(Value.text()); });
let Count = 0;
const Pass = (Text) => console.log(`PASS ${++Count}: ${Text}`);
const Ready = () => Page.waitForFunction(() => window.solidArc?.Ready && !solidArc.Busy && !solidArc.Motion && !solidArc.ResolveDetail && window.solidArcGraphics, null, {timeout: 60000});
const Run = async (...Commands) => {
  await Ready();
  await Page.evaluate((Commands) => solidArc.Command(Commands), Commands);
  await Ready();
};
const Checksum = () => Page.evaluate(() => {
  const Gl = solidArc.Device.Gl, Canvas = solidArc.Device.Canvas;
  const Pixels = new Uint8Array(Canvas.width * Canvas.height * 4);
  Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
  // Explicit test evidence only; production presentation never reads display pixels.
  Gl.readPixels(0, 0, Canvas.width, Canvas.height, Gl.RGBA, Gl.UNSIGNED_BYTE, Pixels);
  let Hash = 2166136261;
  for (const Value of Pixels) Hash = Math.imul(Hash ^ Value, 16777619) >>> 0;
  return Hash;
});
try {
  await Page.addInitScript(() => {
    window.DeviceWitness = {draws: 0, textureUploads: 0, cpuImages: 0};
    const CpuDraw = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function(...Values) {
      ++DeviceWitness.cpuImages;
      return CpuDraw.apply(this, Values);
    };
    for (const Name of ["drawArrays", "drawElements", "drawArraysInstanced"]) {
      const Draw = WebGL2RenderingContext.prototype[Name];
      WebGL2RenderingContext.prototype[Name] = function(...Values) {
        ++DeviceWitness.draws;
        return Draw.apply(this, Values);
      };
    }
    for (const Name of ["texImage2D", "texImage3D"]) {
      const Upload = WebGL2RenderingContext.prototype[Name];
      WebGL2RenderingContext.prototype[Name] = function(...Values) {
        const Data = Name === "texImage3D" ? Values[9] : Values.length === 9 ? Values[8] : Values[5];
        if (Data != null) ++DeviceWitness.textureUploads;
        return Upload.apply(this, Values);
      };
    }
  });
  await Page.goto(process.env.SOLIDARC_URL || "http://127.0.0.1:5173/");
  await Page.waitForFunction(() => window.solidArc?.Documents.length === 1 && !solidArc.Busy && !solidArc.ResolveDetail);
  await Page.evaluate(async () => {
    const {Examples} = await import("./src/CommandSpecification.js");
    await solidArc.Command(["gizmo on", "show shading matcap", ...Examples.mount.commands], false);
    solidArc.Document.name = Examples.mount.name;
    solidArc.Refresh();
  });
  await Ready();
  Assert.deepEqual(await Page.evaluate(() => solidArcGraphics.primitives.sort()), ["lattice", "line", "surface"]);
  Assert.equal(await Page.evaluate(() => document.querySelector("#cad-canvas").getContext("2d")), null);
  Assert.ok(await Page.evaluate(() => DeviceWitness.draws > 0));
  Pass("Approved scene uses actual WebGL2 draw calls for surfaces, shader grid and native gizmo");
  Assert.equal(await Page.evaluate(() => solidArcGraphics.samples), 4);
  Assert.equal(await Page.evaluate(() => solidArc.Device.Gl.getError()), 0);
  Pass("Shared shaders compile/link and multisampled colour resolves GPU-to-GPU without GL errors");
  if (process.env.BROWSER_ARTIFACTS) {
    await mkdir(process.env.BROWSER_ARTIFACTS, {recursive: true});
    await Page.screenshot({path: `${process.env.BROWSER_ARTIFACTS}/SolidArcBrowserGpu.png`});
  }
  const Initial = await Checksum();
  await Page.evaluate(() => solidArc.Request("orbit", {x: 0.2, y: 0.1}));
  await Ready();
  Assert.notEqual(await Checksum(), Initial);
  Pass("Native camera matrices change GPU-rendered pixels");
  await Run("reset", "sphere (0,0,0) 1 --name=Finish", "view fit", "gizmo off", "show shading matcap", "matcap all steel");
  const Steel = await Checksum();
  await Run("matcap all copper");
  Assert.notEqual(await Checksum(), Steel);
  Pass("The shared studio shader changes surface appearance for steel and copper");
  await Run("reset", "sphere (-2,0,0) 1 --name=Left", "sphere (2,0,0) 1 --name=Right", "view top", "view fit", "gizmo off", "select none");
  const Extent = await Page.evaluate(() => [solidArc.Device.Canvas.width, solidArc.Device.Canvas.height]);
  await Run(`select box 0 0 ${Extent[0] / 2 - 1} ${Extent[1] - 1}`);
  Assert.deepEqual(await Page.evaluate(() => solidArc.Description.figures.filter((Figure) => Figure.selected).map((Figure) => Figure.name)), ["Left"]);
  await Run(`select box 0 0 ${Extent[0] - 1} ${Extent[1] - 1}`);
  Assert.equal(await Page.evaluate(() => solidArc.Description.figures.filter((Figure) => Figure.selected).length), 2);
  await Run(`select box 0 0 ${Extent[0] - 1} ${Extent[1] - 1} --subtract`);
  Assert.equal(await Page.evaluate(() => solidArc.Description.figures.filter((Figure) => Figure.selected).length), 0);
  Pass("GPU identity-region readback selects different rectangle contents; subtract clears selection");
  await Run("reset", "cpcurve (0,0) (1,2) (3,-1) (5,1) --name=Profile", "select Profile", "selectmode control", "show cages on", "view top", "view fit", "gizmo off");
  const Point = await Page.evaluate(async () => {
    const Response = await solidArc.Request("render");
    const Command = Response.frame.draws.find((Draw) => Draw.kind === "point" && Draw.pick);
    if (!Command) return null;
    const Product = (Matrix, Vector) => Array.from({length: 4}, (_, Row) => Vector.reduce((Sum, Value, Column) => Sum + Matrix[Column * 4 + Row] * Value, 0));
    const Clip = Product(Response.frame.view.ViewClip, Product(Command.local, [...Command.positions.slice(0, 3), 1]));
    const U = Clip[0] / Clip[3] * 0.5 + 0.5, V = Clip[1] / Clip[3] * 0.5 + 0.5;
    window.DevicePointProbe = {frame: Response.frame, command: Command, u: U, v: V};
    return {expected: Command.pick, actual: solidArc.Device.ResolveIntersection(U, V), x: U * Response.width, y: V * Response.height};
  });
  Assert.ok(Point, "Native control points must produce a real point draw");
  Assert.equal(Point.actual, Point.expected);
  await Page.evaluate(({x, y}) => solidArc.Request("pick", {x, y}), Point);
  await Ready();
  Assert.equal(await Page.evaluate(() => solidArc.Description.figures[0].pickedPoles.length), 1);
  const HighIdentity = await Page.evaluate(() => {
    const {frame, command, u, v} = DevicePointProbe;
    command.pick = 0xfedcba98;
    solidArc.Device.Render(frame);
    return solidArc.Device.ResolveIntersection(u, v);
  });
  Assert.equal(HighIdentity, 0xfedcba98);
  await Page.evaluate(() => solidArc.Request("render"));
  Pass("GPU point quads select native control poles; unblended RGBA8 also round-trips the full 0xfedcba98 identity");
  await Page.setViewportSize({width: 760, height: 920});
  await Ready();
  Assert.equal(await Page.evaluate(() => solidArc.Device.Gl.getError()), 0);
  await Page.setViewportSize({width: 1440, height: 900});
  await Ready();
  Assert.equal(await Page.evaluate(() => solidArc.Device.Gl.getError()), 0);
  Pass("Resize destroys and recreates GPU colour/depth/pick targets without device errors");
  await Run("reset");
  Assert.deepEqual(await Page.evaluate(() => solidArcGraphics.primitives), ["lattice"]);
  const Witness = await Page.evaluate(() => DeviceWitness);
  Assert.equal(Witness.cpuImages, 0);
  Assert.equal(Witness.textureUploads, 0);
  if (await Page.evaluate(() => !!solidArc.NativeSession)) Assert.equal(ModuleRequests.length, 0, "Native GPU mode must not initialize the retained CPU WASM reference");
  Assert.deepEqual(Errors, []);
  Pass("Empty-scene cleanup works; observed zero CPU image blits, zero image texture uploads, zero browser errors");
  const Report = await Page.evaluate(() => ({graphics: solidArcGraphics, witness: DeviceWitness, nativeSession: !!solidArc.NativeSession}));
  Report.checks = Count;
  Report.physicalGpuVerified = false; // Driver strings alone do not independently prove physical hardware.
  console.log(JSON.stringify(Report, null, 2));
  if (process.env.BROWSER_ARTIFACTS) await writeFile(`${process.env.BROWSER_ARTIFACTS}/SolidArcGpuMetrics.json`, JSON.stringify(Report, null, 2) + "\n");
} finally {
  const Session = await Page.evaluate(() => window.solidArc?.NativeSession).catch(() => null);
  if (Session) await Page.request.delete(new URL("/native", process.env.SOLIDARC_URL || "http://127.0.0.1:5173/").href,
    {headers: {"X-SolidArc-Session": Session}}).catch(() => {});
  await Browser.close();
}
