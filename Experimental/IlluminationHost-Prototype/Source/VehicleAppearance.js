// Garage appearance controls, adapted from interactive-vehicle-hmi-configurator/src/data/config.ts.
// The WebGPU exhibit has authored facets rather than interchangeable wheel meshes: wheel choices
// change the Hub material on the four real rims, not their spoke count or diameter.
import { CourseMaterial } from "./MaterialSpecification.js";

export const PaintFinishes = Object.freeze([
    { Id: "silver", Name: "Silver", Hex: "#c2c8d0", Metallic: true },
    { Id: "black", Name: "Black", Hex: "#17191d", Metallic: true },
    { Id: "red", Name: "Red", Hex: "#8a1a1d", Metallic: true },
    { Id: "blue", Name: "Blue", Hex: "#1c3f73", Metallic: true },
    { Id: "sand", Name: "Sand", Hex: "#b2946a", Metallic: false },
    { Id: "green", Name: "Green", Hex: "#33442f", Metallic: false },
    { Id: "white", Name: "White", Hex: "#e7ebef", Metallic: true },
    { Id: "copper", Name: "Copper", Hex: "#8c5a2e", Metallic: true }
]);

export const RimFinishes = Object.freeze([
    { Id: "trail", Name: "Dark", Hex: "#2b2e33" },
    { Id: "sport", Name: "Silver", Hex: "#c9ced4" },
    { Id: "blackout", Name: "Black", Hex: "#0e0f11" },
    { Id: "bronze", Name: "Bronze", Hex: "#9a6a2f" }
]);

export function LinearColour(Hex)
{
    if (!/^#[0-9a-f]{6}$/i.test(Hex)) throw new Error("Invalid colour");
    return [1, 3, 5].map((Index) => {
        const Channel = parseInt(Hex.slice(Index, Index + 2), 16) / 255;
        return Channel <= 0.04045 ? Channel / 12.92 : ((Channel + 0.055) / 1.055) ** 2.4;
    });
}

export function ConstructAppearance()
{
    return { Paint: "factory", Wheel: "factory", Finish: "gloss", Ghost: false };
}

// Mutate only the two owned families; never overwrite glass, tyre, cabin, derez or world materials.
// Return the touched family IDs so the host can update exactly two 48-byte GPU records.
export function ApplyAppearance(Materials, Factory, Appearance)
{
    const Paint = PaintFinishes.find((Item) => Item.Id === Appearance.Paint);
    const Rim = RimFinishes.find((Item) => Item.Id === Appearance.Wheel);
    const Body = { ...Factory[CourseMaterial.BodyCoat], Albedo: [...Factory[CourseMaterial.BodyCoat].Albedo],
                   Emission: [...Factory[CourseMaterial.BodyCoat].Emission] };
    const Hub = { ...Factory[CourseMaterial.Hub], Albedo: [...Factory[CourseMaterial.Hub].Albedo],
                  Emission: [...Factory[CourseMaterial.Hub].Emission] };
    if (Paint)
    {
        Body.Albedo = LinearColour(Paint.Hex).map((Channel) => Channel * 0.78);
        Body.Metalness = Paint.Metallic ? 0.58 : 0.0;
    }
    if (Appearance.Finish === "matte")
    {
        Body.Roughness = 0.82;
        Body.CoatWeight = 0.0;
        Body.Metalness *= 0.35;
    }
    if (Rim)
    {
        Hub.Albedo = LinearColour(Rim.Hex);
        Hub.Emission = [0, 0, 0];
        Hub.Metalness = 0.92;
        Hub.Roughness = 0.28;
    }
    Materials[CourseMaterial.BodyCoat] = Body;
    Materials[CourseMaterial.Hub] = Hub;
    return [CourseMaterial.BodyCoat, CourseMaterial.Hub];
}
