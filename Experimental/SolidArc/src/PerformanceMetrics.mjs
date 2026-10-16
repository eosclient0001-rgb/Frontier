import Assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const Browser = await chromium.launch({headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const Page = await Browser.newPage({viewport: {width: 1280, height: 850}});
const Errors = [];
Page.on("pageerror", (Value) => Errors.push(Value.message));
let Lag = false, Requests = 0;
await Page.route(/\/native$/, async (Route) => {
  if (Route.request().method() === "POST") {
    ++Requests;
    if (Lag) await new Promise((Resolve) => setTimeout(Resolve, 800));
  }
  await Route.continue();
});
const Ready = () => Page.waitForFunction(() => window.solidArc?.Ready && !solidArc.Busy && !solidArc.Motion && !solidArc.ResolveDetail);
const Run = async (Commands) => {await Ready(); await Page.evaluate((Commands) => solidArc.Command(Commands), Commands); await Ready();};
const Report = {};
try {
  await Page.addInitScript(() => {
    window.AnimationWitness = {uploads: 0, reads: 0};
    for (const [Name, Counter] of [["bufferData", "uploads"], ["readPixels", "reads"]]) {
      const Call = WebGL2RenderingContext.prototype[Name];
      WebGL2RenderingContext.prototype[Name] = function(...Values) {++AnimationWitness[Counter]; return Call.apply(this, Values);};
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
  Report.scene = await Page.evaluate(() => ({triangles: solidArcGraphics.triangles,
    lastNativeResponseBytes: solidArcPerformance.response.responseBytes, adapter: solidArcGraphics.adapter}));
  Assert.ok(Report.scene.triangles < 10000);
  console.log("SCENE", JSON.stringify(Report.scene));

  // Compare the numeric camera mirror to actual C++ view/clip/inverse matrices, including
  // both projections, near-pole views, pan, dolly and yaw wrapping. This is not visual guessing.
  const Parity = [];
  for (const Mode of ["view iso", "view top", "view bottom"]) {
    await Run([Mode]);
    Parity.push(...await Page.evaluate(async () => {
      const {CameraView, CopyCamera, MoveCamera} = await import("./src/CameraSequence.js");
      const Channel = solidArc.Worker, Output = [];
      for (const [Action, X, Y] of [["orbit", 0.12, -0.08], ["pan", 13, -7], ["zoom", 0.3, 0], ["orbit", 7.2, 0.02]]) {
        const Base = Channel.Cache, Camera = CopyCamera(Base.description.camera);
        MoveCamera(Camera, Action, X, Y, Base.height);
        const View = CameraView(Camera, Base.width, Base.height, Base.frame.view);
        const Response = await Channel.Fetch({identity: Base.description.identity, action: Action, x: X, y: Y, steps: X, width: Base.width, height: Base.height, scale: 1});
        let ErrorValue = 0;
        for (const Name of ["ViewClip", "ClipView", "ViewWorld", "EyePosition", "Viewport", "LatticeStyle", "DepthPolicy"])
          for (let Index = 0; Index < View[Name].length; ++Index)
            ErrorValue = Math.max(ErrorValue, Math.abs(View[Name][Index] - Response.frame.view[Name][Index]) / Math.max(1, Math.abs(Response.frame.view[Name][Index])));
        Output.push(ErrorValue);
      }
      return Output;
    }));
  }
  Report.maximumCameraRelativeError = Math.max(...Parity);
  Assert.ok(Report.maximumCameraRelativeError < 2e-5, JSON.stringify(Parity));
  console.log("PASS: 12 camera predictions match native C++ projection/inverse matrices", Report.maximumCameraRelativeError);
  await Run(["view iso", "view fit"]);
  const Rectangle = await Page.locator("#cad-canvas").boundingBox();
  // Use a visible empty corner outside the native gizmo. No Alt bypass is needed: this
  // tests ordinary left-button orbit, not merely a special navigation shortcut.
  const X = Rectangle.x + Rectangle.width * 0.92, Y = Rectangle.y + Rectangle.height * 0.18;
  await Page.mouse.move(X, Y);
  await Ready();
  Lag = true;
  await Page.mouse.down();
  await Ready();
  const Before = await Page.evaluate(() => ({frame: solidArc.Device.FrameNumber, uploads: AnimationWitness.uploads,
    reads: AnimationWitness.reads, native: solidArc.Worker.Stats.requests, yaw: solidArc.Description.camera.yaw}));
  const RequestCount = Requests;
  const Elapsed = await Page.evaluate(async ({X, Y}) => {
    const Canvas = document.querySelector("#cad-canvas"), Identity = solidArc.ViewDrag.identity, Start = performance.now();
    // Drive the original pointer handler at animation cadence without adding one DevTools
    // protocol round-trip per event to the measurement. Real pointer/gizmo checks are separate.
    for (let Index = 1; Index <= 60; ++Index) {
      Canvas.dispatchEvent(new PointerEvent("pointermove", {pointerId: Identity, clientX: X - Index * 1.2,
        clientY: Y + Index * 0.4, buttons: 1, bubbles: true}));
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - Start;
  }, {X, Y});
  await Ready();
  const After = await Page.evaluate(() => ({frame: solidArc.Device.FrameNumber, uploads: AnimationWitness.uploads,
    reads: AnimationWitness.reads, native: solidArc.Worker.Stats.requests, yaw: solidArc.Description.camera.yaw,
    frameVertexBytes: solidArcGraphics.frameVertexBytes}));
  Report.drag = {milliseconds: Elapsed, submittedFrames: After.frame - Before.frame,
    httpRequests: Requests - RequestCount, nativeRequests: After.native - Before.native,
    vertexUploads: After.uploads - Before.uploads, gpuReadbacks: After.reads - Before.reads,
    finalFrameVertexBytes: After.frameVertexBytes, artificialNetworkDelayMilliseconds: 800};
  Assert.ok(Report.drag.submittedFrames >= 12, JSON.stringify(Report.drag));
  Assert.equal(Report.drag.httpRequests, 0);
  Assert.equal(Report.drag.nativeRequests, 0);
  Assert.equal(Report.drag.vertexUploads, 0);
  Assert.equal(Report.drag.gpuReadbacks, 0);
  Assert.equal(Report.drag.finalFrameVertexBytes, 0);
  Assert.ok(Math.abs(After.yaw - Before.yaw) > 0.3);
  console.log("PASS: ordinary orbit animates with 800 ms network delay; zero HTTP, vertex uploads or pick readbacks", JSON.stringify(Report.drag));
  await Page.mouse.move(X - 72, Y + 24);
  await Page.mouse.up();
  await Ready();
  await Page.waitForFunction(() => !solidArc.Worker.CameraDirty, null, {timeout: 15000});
  await Ready();
  Report.nativeSync = await Page.evaluate(() => Math.abs(solidArc.Worker.Cache.description.camera.yaw - solidArc.Description.camera.yaw));
  Assert.ok(Report.nativeSync < 1e-8);
  console.log("PASS: final camera synchronizes back to C++ without changing the final pose");
  const HoverFrames = await Page.evaluate(async () => {
    const Before = solidArc.Device.FrameNumber;
    for (let Index = 0; Index < 20; ++Index) await solidArc.Request("hover", {u: -10, v: -10});
    return solidArc.Device.FrameNumber - Before;
  });
  Assert.equal(HoverFrames, 0);
  Report.idleHoverRedraws = HoverFrames;
  console.log("PASS: 20 unchanged idle hover events cause zero GPU redraws");
  Assert.deepEqual(Errors, []);
  Report.physicalGpuVerified = false;
  if (process.env.BROWSER_ARTIFACTS) {
    await mkdir(process.env.BROWSER_ARTIFACTS, {recursive: true});
    await writeFile(`${process.env.BROWSER_ARTIFACTS}/SolidArcPerformance.json`, JSON.stringify(Report, null, 2) + "\n");
  }
  console.log(JSON.stringify(Report, null, 2));
  await Page.goto("about:blank");
} finally {await Browser.close();}
