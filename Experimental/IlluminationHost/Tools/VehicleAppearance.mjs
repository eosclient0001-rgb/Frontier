import assert from "node:assert/strict";
import { ScreenSequence } from "../Source/Cabin/ScreenSequence.js";
import { CourseMaterial, ConstructMaterialSpecification, EncodeMaterialRecord, EncodeMaterialRecords } from "../Source/MaterialSpecification.js";
import { VehicleAppearanceDefaults, VehiclePaints, ResolveVehiclePaintMaterial, VehicleViewModes } from "../Source/VehicleAppearance.js";
import { TyreCarcassSolver, VehicleRecordBytes } from "../Source/TyreCarcassSolver.js";

const Canvas = { width: 0, height: 0, getContext: () => ({}) };
const Screen = new ScreenSequence(Canvas, {}, () => {});
const Changes = [];
Screen.OnVehicleAppearanceChange = (Appearance) => Changes.push(Appearance);
Screen.NotifyVehicleAppearance();
assert.equal(Changes[0].PaintId, VehicleAppearanceDefaults.PaintId);
assert.equal(Changes[0].Finish, VehicleAppearanceDefaults.Finish);

Screen.ApplyVehiclePaint("red");
Screen.ApplyVehicleFinish("matte");
Screen.ApplyVehicleViewMode("ghost");
Screen.AdvanceSlider({ Slider: "ghostOpacity", TrackLeft: 0, TrackWidth: 100, Minimum: 10, Maximum: 90, Step: 1 }, 50);
assert.equal(Changes.at(-1).PaintId, "red");
assert.equal(Changes.at(-1).Finish, "matte");
assert.equal(Changes.at(-1).ViewMode, "ghost");
assert.equal(Changes.at(-1).GhostOpacity, 0.5);
assert.equal(VehicleViewModes.find((Mode) => Mode.Id === "wireframe").Value, 2);

const Materials = ConstructMaterialSpecification();
const Records = EncodeMaterialRecords(Materials);
assert.equal(CourseMaterial.VehicleGhost, 79);
assert.equal(Materials.length, 80);
assert.equal(Records.length, Materials.length * 12);
assert.equal(EncodeMaterialRecord(Materials[CourseMaterial.BodyCoat]).length, 12);
assert.equal(ResolveVehiclePaintMaterial("silver", "gloss").Albedo.length, 3);
assert.equal(VehiclePaints.length, 8);

const Solver = new TyreCarcassSolver();
const VehicleRecord = new Float32Array(Solver.EncodeRecord({
  VehicleViewMode: 2,
  GhostOpacity: 0.5,
  WireWidth: 1.25,
  GhostGlow: 0.4,
}, false));
assert.equal(VehicleRecord.byteLength, VehicleRecordBytes);
assert.deepEqual(Array.from(VehicleRecord.slice(20, 23)), [2, 0.5, 1.25]);
assert.ok(Math.abs(VehicleRecord[23] - 0.4) < 1e-6);
console.log("vehicle appearance HMI/material checks passed");
