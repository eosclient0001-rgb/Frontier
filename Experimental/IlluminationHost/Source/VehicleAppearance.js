//============================================================================================================================================
//                                                        VEHICLEAPPEARANCE.JS
//============================================================================================================================================
// 🧩 Shared live-vehicle paint, finish and view-mode options for the cabin HMI and the WebGPU renderer.

// The paint names and colours follow Experimental/interactive-vehicle-hmi-configurator. Hex colours are sRGB for the
// canvas UI; ResolveVehiclePaintMaterial converts them to linear Rec.709 before writing the GPU material record.
export const VehiclePaints = Object.freeze([
    Object.freeze({ Id: "silver",  Name: "Nebula Silver",  Short: "Nebula",   Hex: "#c2c8d0", Metallic: true }),
    Object.freeze({ Id: "black",   Name: "Obsidian Black", Short: "Obsidian", Hex: "#17191d", Metallic: true }),
    Object.freeze({ Id: "red",     Name: "Command Red",    Short: "Command",  Hex: "#8a1a1d", Metallic: true }),
    Object.freeze({ Id: "blue",    Name: "Tactical Blue",  Short: "Tactical", Hex: "#1c3f73", Metallic: true }),
    Object.freeze({ Id: "sand",    Name: "Moab Sand",      Short: "Moab",     Hex: "#b2946a", Metallic: false }),
    Object.freeze({ Id: "green",   Name: "Recon Green",    Short: "Recon",    Hex: "#33442f", Metallic: false }),
    Object.freeze({ Id: "white",   Name: "Arctic White",   Short: "Arctic",   Hex: "#e7ebef", Metallic: true }),
    Object.freeze({ Id: "copper",  Name: "Copper Bronze",  Short: "Copper",   Hex: "#8c5a2e", Metallic: true })
]);

export const VehicleViewModes = Object.freeze([
    Object.freeze({ Id: "solid",     Name: "Solid",     Value: 0 }),
    Object.freeze({ Id: "ghost",     Name: "Ghost",     Value: 1 }),
    Object.freeze({ Id: "wireframe", Name: "Wireframe", Value: 2 })
]);

export const VehicleAppearanceDefaults = Object.freeze({
    PaintId: "silver",
    Finish: "gloss",
    ViewMode: "solid",
    GhostOpacity: 0.42,  // visible screen-door coverage while Ghost is selected
    WireWidth: 1.25,     // pixels
    GhostGlow: 0.55
});

function SrgbToLinear(Channel)
{
    return Channel <= 0.04045 ? Channel / 12.92 : Math.pow((Channel + 0.055) / 1.055, 2.4);
}

function HexToLinearRgb(Hex)
{
    const Match = /^#?([0-9a-f]{6})$/i.exec(Hex);
    if (!Match)
        throw new TypeError(`Invalid vehicle paint colour: ${Hex}`);
    const Packed = Match[1];
    return [0, 2, 4].map((Offset) => SrgbToLinear(parseInt(Packed.slice(Offset, Offset + 2), 16) / 255));
}

export function ResolveVehiclePaintMaterial(PaintId, Finish)
{
    const Paint = VehiclePaints.find((Option) => Option.Id === PaintId);
    if (!Paint)
        throw new RangeError(`Unknown vehicle paint: ${PaintId}`);
    if (Finish !== "gloss" && Finish !== "matte")
        throw new RangeError(`Unknown vehicle finish: ${Finish}`);

    const Matte = Finish === "matte";
    return {
        Albedo: HexToLinearRgb(Paint.Hex),
        Roughness: Matte ? 0.72 : (Paint.Metallic ? 0.26 : 0.45),
        Emission: [0.0, 0.0, 0.0],
        Metalness: Paint.Metallic ? 0.90 : 0.35,
        CoatWeight: Matte ? 0.08 : 1.0,
        CoatRoughness: Matte ? 0.65 : 0.12,
        SpecularLevel: 0.04,
        Transmission: 0.0
    };
}

export function ResolveVehicleViewMode(Identifier)
{
    return VehicleViewModes.find((Mode) => Mode.Id === Identifier)?.Value ?? 0;
}
