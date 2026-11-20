/*============================================================================================================================================
                                                    FORCEFIELDVALIDATION.MJS
============================================================================================================================================*/
// Automated verification for Frontier ForceField Studio (math kernel, 19 force laws, flow viz, TOML codec, DOM wiring).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BuildFlowParticleBuffers,
  BuildForceOverlayGeometry,
  CreateFlowParticleSystem,
  CreateForceNodeFromModel,
  DEFAULT_FLOW_VIZ,
  EvaluateForceSourceAt,
  EvaluateSceneCompositeTelemetry,
  FORCE_MODELS,
  FORMULA_PRESETS,
  GetCompiledForceFormula,
  ParseForceModelToml,
  ResetFlowParticles,
  SCENE_PRESETS,
  SerializeForceModelToml,
  SerializeSimulationSpaceToml,
  StepFlowParticles,
} from "./Engine/ForceFieldCore.js";
import { RenderInspectorHtml } from "./UI/InspectorRenderer.js";
import { ForceModelIconHtml, SvgGlyph } from "./UI/SvgIcons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let Passed = 0;

function Check(Name, Fn) {
  Fn();
  Passed += 1;
  console.log(`  [PASS] ${Name}`);
}

console.log("=== Frontier ForceField Studio Validation ===");

Check("All 19 canonical ForceModel laws exist and produce finite non-NaN vectors", () => {
  assert.equal(FORCE_MODELS.length, 19);
  for (const Meta of FORCE_MODELS) {
    const Node = CreateForceNodeFromModel(Meta.Id, 1, [0, 0, 1]);
    Node.Force.Radius = 5;
    Node.Force.Strength = 14;
    const Res = EvaluateForceSourceAt(Node.Force, Node.Position, Node.Rotation, 0.7, -0.5, 1.2, 1.5);
    assert.ok(Array.isArray(Res) && Res.length === 3, `Model ${Meta.Id} should return [x,y,z]`);
    assert.ok(Number.isFinite(Res[0]) && Number.isFinite(Res[1]) && Number.isFinite(Res[2]), `Model ${Meta.Id} returned non-finite`);
    assert.ok(ForceModelIconHtml(Meta.Id).includes("<svg"), `Model ${Meta.Id} missing SVG icon`);
  }
});

Check("VectorFieldLang custom formula override evaluates via Prog.JsFn", () => {
  const Node = CreateForceNodeFromModel("LinearWind", 1, [0, 0, 1]);
  Node.Force.FormulaCode = FORMULA_PRESETS[0].Code;
  const Compiled = GetCompiledForceFormula(Node.Force.FormulaCode);
  assert.equal(Compiled.Ok, true, "Preset formula should compile");
  Node.Force.FormulaEnabled = true;
  Node.Force.Radius = 6;
  const ResFormula = EvaluateForceSourceAt(Node.Force, Node.Position, Node.Rotation, 1.5, 0.2, 1.4, 0);
  Node.Force.FormulaEnabled = false;
  const ResBase = EvaluateForceSourceAt(Node.Force, Node.Position, Node.Rotation, 1.5, 0.2, 1.4, 0);
  const Diff = Math.hypot(ResFormula[0] - ResBase[0], ResFormula[1] - ResBase[1], ResFormula[2] - ResBase[2]);
  assert.ok(Diff > 0.1, `Custom formula should change force vector (diff=${Diff})`);
});

Check("Solo / Mute / Impulse duration modes behave deterministically", () => {
  const A = CreateForceNodeFromModel("LinearWind", 1, [0, 0, 1]);
  const B = CreateForceNodeFromModel("Attractor", 2, [1, 0, 1]);
  B.Force.Solo = true;
  const TelSolo = EvaluateSceneCompositeTelemetry([A, B], 0.5, 0, 1, 0.5);
  B.Force.Solo = false;
  B.Force.Enabled = false;
  const TelMuted = EvaluateSceneCompositeTelemetry([A, B], 0.5, 0, 1, 0.5);
  assert.ok(Number.isFinite(TelSolo.Speed) && Number.isFinite(TelMuted.Speed));

  const Imp = CreateForceNodeFromModel("RadialBurst", 1, [0, 0, 1]);
  Imp.Force.Duration = "Impulse";
  Imp.Force.LastTriggerTime = 2.0;
  Imp.Force.WaveSpeed = 6.0;
  Imp.Force.Radius = 6.0;
  const ActiveImp = EvaluateForceSourceAt(Imp.Force, Imp.Position, Imp.Rotation, 1.5, 0, 1, 2.25);
  const ExpiredImp = EvaluateForceSourceAt(Imp.Force, Imp.Position, Imp.Rotation, 1.5, 0, 1, 5.0);
  assert.ok(Math.hypot(...ActiveImp) > 0.05, "Active impulse should exert force");
  assert.equal(Math.hypot(...ExpiredImp), 0, "Expired impulse should exert zero force");
});

Check("RK2 FlowParticleSystem steps and builds GPU trail + head buffers", () => {
  const Nodes = SCENE_PRESETS[0].BuildNodes();
  const Sys = CreateFlowParticleSystem(240, 10);
  const Viz = { ...DEFAULT_FLOW_VIZ, ParticleCount: 240 };
  ResetFlowParticles(Sys, Nodes, Viz, 0, Nodes[0].Id);
  for (let I = 0; I < 8; ++I) {
    StepFlowParticles(Sys, Nodes, 0.016, Viz, I * 0.016, Nodes[0].Id);
  }
  const Bufs = BuildFlowParticleBuffers(Sys, Viz, [6, -6, 4]);
  assert.ok(Bufs.TrailVertexCount > 0, "Expected non-zero trail vertices");
  assert.equal(Bufs.HeadCount, 240, "Expected 240 particle head instances");
});

Check("3D Force & Flow Overlay Geometry generates heatmap, streamlines, arrows, and envelopes", () => {
  const Nodes = SCENE_PRESETS[1].BuildNodes();
  const Geo = BuildForceOverlayGeometry(Nodes, DEFAULT_FLOW_VIZ, Nodes[0].Id, 0.8, [7, -7, 5]);
  assert.ok(Geo.OpaqueVertexCount > 100, `Expected opaque overlay vertices, got ${Geo.OpaqueVertexCount}`);
  assert.ok(Geo.TranslucentVertexCount > 100, `Expected translucent envelope/heatmap vertices, got ${Geo.TranslucentVertexCount}`);
});

Check("TOML serialization & parse round-trip preserves ForceModel parameters", () => {
  const Node = CreateForceNodeFromModel("RotationalColumn", 1, [1.5, -2.25, 0.9]);
  Node.Force.Strength = 17.5;
  Node.Force.Radius = 4.5;
  const Toml = SerializeForceModelToml(Node.Name, Node.Force, { Position: Node.Position, Rotation: Node.Rotation });
  const Parsed = ParseForceModelToml(Toml);
  assert.ok(Parsed, "TOML parse returned null");
  assert.equal(Parsed.Force.Model, "RotationalColumn");
  assert.ok(Math.abs(Parsed.Force.Strength - 17.5) < 1e-4);
  assert.ok(Math.abs(Parsed.Position[0] - 1.5) < 1e-4);

  const SpaceToml = SerializeSimulationSpaceToml([Node], "ValidationSpace");
  assert.ok(SpaceToml.includes("Frontier.VectorFieldSpace.v2") && SpaceToml.includes("[[ForceSource]]") && SpaceToml.includes("RotationalColumn"));
});

Check("InspectorRenderer renders all selection contexts cleanly", () => {
  const Nodes = SCENE_PRESETS[0].BuildNodes();
  const BaseState = { ForceNodes: Nodes, FlowViz: { ...DEFAULT_FLOW_VIZ }, CameraState: { FovDeg: 45, NearPlane: 0.1, FarPlane: 400, OrbitSpeed: 0.45, MoveSpeed: 6 }, TimeSec: 1.0 };
  for (const Sel of [Nodes[0].Id, "flow_viz", "probe_cursor", "editor_camera", "forces"]) {
    const Html = RenderInspectorHtml({ ...BaseState, SelectedId: Sel });
    assert.ok(Html.length > 100 && !Html.includes("undefined"), `Inspector failed for ${Sel}`);
  }
});

Check("index.html and ForceFieldEditor.js DOM IDs and SVG glyphs match", () => {
  const Html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const Js = fs.readFileSync(path.join(__dirname, "ForceFieldEditor.js"), "utf8");
  const IdRefs = [...Js.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((M) => M[1]);
  for (const Id of new Set(IdRefs)) {
    assert.ok(Html.includes(`id="${Id}"`), `Missing id="${Id}" in index.html`);
  }
  const GlyphRefs = [...Js.matchAll(/SvgGlyph\("([a-zA-Z0-9_-]+)"/g)].map((M) => M[1]);
  for (const G of new Set(GlyphRefs)) {
    assert.ok(SvgGlyph(G).includes("<svg"), `Missing SVG glyph "${G}"`);
  }
});

console.log(`\nAll ${Passed} checks passed.`);
