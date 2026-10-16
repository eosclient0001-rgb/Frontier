import { test } from "node:test";
import assert from "node:assert/strict";
import { ConstructMaterialSpecification, CourseMaterial, EncodeMaterialRecords } from "../Source/MaterialSpecification.js";
import { ConstructAppearance, ApplyAppearance, LinearColour } from "../Source/VehicleAppearance.js";

test("colours are converted from sRGB before encoding GPU materials", () => {
    assert.deepEqual(LinearColour("#000000"), [0, 0, 0]);
    assert.deepEqual(LinearColour("#ffffff"), [1, 1, 1]);
    assert.throws(() => LinearColour("red"));
});

test("Garage paints only real body and rim families, preserving factory and world materials", () => {
    const Factory = ConstructMaterialSpecification();
    const Materials = ConstructMaterialSpecification();
    const State = ConstructAppearance();
    Object.assign(State, { Paint: "red", Wheel: "bronze", Finish: "matte" });
    assert.deepEqual(ApplyAppearance(Materials, Factory, State), [CourseMaterial.BodyCoat, CourseMaterial.Hub]);
    assert.equal(Materials[CourseMaterial.BodyCoat].CoatWeight, 0);
    assert.equal(Materials[CourseMaterial.BodyCoat].Roughness, 0.82);
    assert.deepEqual(Materials[CourseMaterial.Hub].Emission, [0, 0, 0]);
    assert.deepEqual(Materials[CourseMaterial.Tyre], Factory[CourseMaterial.Tyre]);
    assert.deepEqual(Materials[CourseMaterial.VehicleGlass], Factory[CourseMaterial.VehicleGlass]);
    assert.deepEqual(Materials[CourseMaterial.Asphalt], Factory[CourseMaterial.Asphalt]);
    assert.equal(EncodeMaterialRecords(Materials).byteLength, Materials.length * 48);
    Object.assign(State, { Paint: "factory", Wheel: "factory", Finish: "gloss" });
    ApplyAppearance(Materials, Factory, State);
    assert.deepEqual(Materials[CourseMaterial.BodyCoat], Factory[CourseMaterial.BodyCoat]);
    assert.deepEqual(Materials[CourseMaterial.Hub], Factory[CourseMaterial.Hub]);
});
