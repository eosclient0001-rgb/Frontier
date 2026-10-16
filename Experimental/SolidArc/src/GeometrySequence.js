import { CommandProtocol, ValidateCommands } from "./CommandPacket.js";
let Geometry;
const SessionIdentity = crypto.randomUUID();
const NativeTransport = import.meta.env.VITE_SOLIDARC_TRANSPORT !== "wasm";
let Lines = [];
const Record = (Text) => {
  Lines.push(String(Text));
  if (Lines.length > 500) Lines.shift();
};
try {
  if (NativeTransport) {
    const Response = await fetch("/native/health", {cache: "no-store"});
    if (!Response.ok) throw Error("Start the native C++ command-stream service before opening SolidArc.");
  } else {
    const {default: CreateGeometry} = await import("../Runtime/GeometryModule.js");
    Geometry = await CreateGeometry({ print: Record, printErr: Record });
    if (typeof Geometry._RenderCommands !== "function")
      throw Error("The bundled WebAssembly runtime predates GPU command streams. Rebuild Native/CompileSequence.py with Emscripten; CPU raster fallback is disabled.");
  }
  postMessage({ ready: true, protocol: CommandProtocol, session: NativeTransport ? SessionIdentity : null });
} catch (ErrorValue) {
  postMessage({ fatal: String(ErrorValue) });
}
const Invoke = (Name, Result, Types = [], Arguments = []) =>
  Geometry.ccall(Name, Result, Types, Arguments);
let Gesture = null;
const PersistSelection = () => {
  const Selection = JSON.parse(Invoke("DescribeDocument", "string"));
  // Persist stable topology identities, never viewport-dependent pick coordinates.
  Invoke("ExecuteCommand", "number", ["string"], ["select none"]);
  for (const Figure of Selection.figures) {
    if (Figure.selected)
      Invoke(
        "ExecuteCommand",
        "number",
        ["string"],
        [`select ${Figure.id} --add`],
      );
    for (const [Property, Target] of [
      ["pickedFaces", "faces"],
      ["pickedEdges", "edges"],
      ["pickedPoles", "poles"],
    ]) {
      if (Figure[Property]?.length)
        Invoke(
          "ExecuteCommand",
          "number",
          ["string"],
          [`select ${Target} ${Figure.id} ${Figure[Property].join(" ")} --add`],
        );
    }
  }
  for (const Region of Selection.areas || []) {
    if (Region.selected)
      Invoke(
        "ExecuteCommand",
        "number",
        ["string"],
        [`select a${Region.id} --add`],
      );
  }
};
const MovePointer = (Request, Width, Height) => {
  if (!Gesture) return;
  if (Gesture.gizmo) {
    Invoke(
      "DragGizmoDocument",
      "number",
      ["number", "number", "number"],
      [Request.u * Width, Request.v * Height, Number(Request.snap)],
    );
    return;
  }
  if (
    Math.hypot(Request.cx - Gesture.originX, Request.cy - Gesture.originY) > 4
  )
    Gesture.moved = true;
  if (!Gesture.moved) return;
  const Horizontal = Request.cx - Gesture.x;
  const Vertical = Request.cy - Gesture.y;
  if (Gesture.pan)
    Invoke(
      "PanDocument",
      null,
      ["number", "number", "number"],
      [Horizontal, -Vertical, Request.cssHeight],
    );
  else
    Invoke(
      "OrbitDocument",
      null,
      ["number", "number"],
      [-Horizontal * 0.006, Vertical * 0.006],
    );
  Gesture.x = Request.cx;
  Gesture.y = Request.cy;
};
self.onmessage = async ({ data: Request }) => {
  if (NativeTransport) {
    try {
      const Start = performance.now();
      const Result = await fetch("/native", {method: "POST", headers: {"Content-Type": "application/json", "X-SolidArc-Session": SessionIdentity}, body: JSON.stringify(Request)});
      if (!Result.ok) throw Error(await Result.text());
      const Response = await Result.json();
      if (Response.error) throw Error(Response.error);
      ValidateCommands(Response);
      postMessage({...Response, token: Request.token, duration: performance.now() - Start});
    } catch (ErrorValue) {
      postMessage({token: Request.token, error: String(ErrorValue), lines: []});
    }
    return;
  }
  const Start = performance.now();
  Lines = [];
  try {
    if (!Geometry) throw new Error("The native geometry module is not ready.");
    let Success = true,
      File = null,
      Dirty = false;
    const Width = Math.max(64, Math.min(4096, Request.width || 800));
    const Height = Math.max(64, Math.min(4096, Request.height || 600));
    if (Request.identity)
      Invoke("ActivateDocument", "number", ["number"], [Request.identity]);
    if (Request.identity)
      Invoke(
        "SeatDocument",
        null,
        ["number", "number", "number"],
        [Width, Height, Request.scale || 1],
      );
    if (Request.identity) Invoke("ResolveIntersection", null, ["number", "number", "number"], [Request.intersection || 0, Math.max(0, Math.floor(Request.u === undefined ? Request.x || 0 : Request.u * Width)), Math.max(0, Math.floor(Request.v === undefined ? Request.y || 0 : Request.v * Height))]);
    if (Request.intersectionRuns) Invoke("ResolveIntersectionRuns", null, ["string"], [Request.intersectionRuns]);
    switch (Request.action) {
      case "pointerStart": {
        const Gizmo =
          Request.button === 0 &&
          !Request.orbit &&
          !!Invoke(
            "BeginGizmoDocument",
            "number",
            ["number", "number"],
            [Request.u * Width, Request.v * Height],
          );
        Gesture = {
          gizmo: Gizmo,
          pan: Request.button === 1 || Request.button === 2 || Request.pan,
          button: Request.button,
          extend: Request.extend,
          orbit: Request.orbit,
          moved: false,
          x: Request.cx,
          y: Request.cy,
          originX: Request.cx,
          originY: Request.cy,
        };
        break;
      }
      case "pointerMove":
        MovePointer(Request, Width, Height);
        break;
      case "pointerEnd":
        if (Gesture) {
          if (!Request.cancel) MovePointer(Request, Width, Height);
          if (Gesture.gizmo) {
            Success = !!Invoke(
              "FinishGizmoDocument",
              "number",
              ["number"],
              [Number(!!Request.cancel)],
            );
            Dirty = !Request.cancel;
            Invoke("ExecuteCommand", "number", ["string"], ["dim auto"]);
          } else if (
            !Request.cancel &&
            !Gesture.moved &&
            Gesture.button === 0 &&
            !Gesture.orbit
          ) {
            Invoke(
              "PickDocument",
              "number",
              ["number", "number", "number"],
              [Request.u * Width, Request.v * Height, Number(Gesture.extend)],
            );
            PersistSelection();
          }
        }
        Gesture = null;
        break;
      case "hover":
        if (!Gesture)
          Invoke(
            "AimGizmoDocument",
            "number",
            ["number", "number"],
            [Request.u * Width, Request.v * Height],
          );
        break;
      case "create":
        Invoke("CreateDocument", "number");
        break;
      case "close":
        Invoke("ReleaseDocument", null, ["number"], [Request.closeIdentity]);
        break;
      case "command":
        for (const Text of Request.commands) {
          if (!Invoke("ExecuteCommand", "number", ["string"], [Text])) {
            Success = false;
            break;
          }
        }
        break;
      case "orbit":
        Invoke(
          "OrbitDocument",
          null,
          ["number", "number"],
          [Request.x, Request.y],
        );
        break;
      case "pan":
        Invoke(
          "PanDocument",
          null,
          ["number", "number", "number"],
          [Request.x, Request.y, Request.height],
        );
        break;
      case "zoom":
        if (!Gesture?.gizmo)
          Invoke("ZoomDocument", null, ["number"], [Request.steps]);
        break;
      case "pick": {
        Invoke(
          "PickDocument",
          "number",
          ["number", "number", "number"],
          [Request.x, Request.y, Number(Request.extend)],
        );
        PersistSelection();
        break;
      }
      case "open":
        Geometry.FS.writeFile("/import.arc", Request.text);
        Success = !!Invoke(
          "ExecuteCommand",
          "number",
          ["string"],
          ["open /import.arc"],
        );
        Geometry.FS.unlink("/import.arc");
        break;
      case "save":
        Success = !!Invoke(
          "ExecuteCommand",
          "number",
          ["string"],
          ["save /document.arc"],
        );
        if (Success)
          File = Geometry.FS.readFile("/document.arc", { encoding: "utf8" });
        break;
      case "export":
        Success = !!Invoke(
          "ExecuteCommand",
          "number",
          ["string"],
          ["export /geometry.obj --chord=0.01"],
        );
        if (Success)
          File = Geometry.FS.readFile("/geometry.obj", {
            encoding: "utf8",
          }).replace(
            /^mtllib .*$/gm,
            "# Geometry-only browser export; material sidecars omitted.",
          );
        break;
    }
    if (["command", "open"].includes(Request.action))
      Invoke("ExecuteCommand", "number", ["string"], ["dim auto"]);

    const Frame = JSON.parse(Invoke("RenderCommands", "string", ["number", "number"], [Width, Height]));
    const Description = JSON.parse(Invoke("DescribeDocument", "string"));
    postMessage(
      {
        token: Request.token,
        success: Success,
        dirty: Dirty,
        interaction: Gesture?.gizmo
          ? "gizmo"
          : Gesture?.pan
            ? "pan"
            : Gesture
              ? "orbit"
              : "",

        description: Description,
        width: Width,
        height: Height,
        frame: Frame,
        transport: "wasm-command-stream",
        file: File,
        lines: Lines,
        duration: performance.now() - Start,
      },

    );
  } catch (ErrorValue) {
    postMessage({
      token: Request.token,
      error: String(ErrorValue),
      lines: Lines,
    });
  }
};
