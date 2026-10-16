//! include "FrameDescriptor.wgsl"
struct CabinRecord { Body: mat4x4f, Wheel: mat4x4f, Tablet: mat4x4f }
@group(0) @binding(1) var<uniform> Cabin: CabinRecord;
@group(0) @binding(2) var Cluster: texture_2d<f32>;
@group(0) @binding(3) var Tablet: texture_2d<f32>;
@group(0) @binding(4) var Linear: sampler;
struct CabinVarying {
    @builtin(position) Position: vec4f,
    @location(0) Normal: vec3f,
    @location(1) World: vec3f,
    @location(2) UV: vec2f,
    @location(3) @interpolate(flat) Material: u32,
}
@vertex fn CabinVertex(@location(0) P: vec3f, @location(1) N: vec3f,
                       @location(2) UV: vec2f, @location(3) Material: u32) -> CabinVarying
{
    var Pose = Cabin.Body;
    if (Material == 1u || Material == 2u) { Pose = Cabin.Wheel; }
    if (Material == 3u || Material == 4u) { Pose = Cabin.Tablet; }
    let World = Pose * vec4f(P, 1.0);
    var V: CabinVarying;
    V.Position = Frame.ViewProjection * World;
    V.World = World.xyz;
    V.Normal = (Pose * vec4f(N, 0.0)).xyz;
    V.UV = UV;
    V.Material = Material;
    return V;
}
@fragment fn CabinFragment(V: CabinVarying) -> @location(0) vec4f
{
    if (V.Material == 2u) {
        let C = textureSampleLevel(Cluster, Linear, V.UV, 0.0);
        if (C.a < 0.5) { discard; }
        return vec4f(C.rgb * 0.85, 1.0);
    }
    if (V.Material == 4u) { return vec4f(textureSampleLevel(Tablet, Linear, V.UV, 0.0).rgb * 0.85, 1.0); }
    let N = normalize(V.Normal);
    let View = normalize(Frame.CameraPosition - V.World);
    let Facing = abs(dot(N, View));
    if (V.Material == 0u) {
        // Thin smoked glazing, alpha/Fresnel forward pass: NOT opaque G-buffer glass or full refraction.
        let Fresnel = 0.04 + 0.96 * pow(1.0 - Facing, 5.0);
        let Sky = mix(vec3f(0.06, 0.09, 0.12), vec3f(0.32, 0.46, 0.58), abs(N.z));
        let Highlight = pow(max(0.0, dot(reflect(-View, N), Frame.SunDirection)), 160.0);
        return vec4f(Sky + vec3f(Highlight * 0.6), clamp(0.075 + Fresnel * 0.5, 0.075, 0.55));
    }
    let Shade = 0.16 + 0.4 * max(0.0, dot(N, Frame.SunDirection)) + 0.12 * max(0.0, N.z);
    let Rim = pow(1.0 - Facing, 3.0) * 0.055;
    return vec4f(vec3f(0.065, 0.075, 0.078) * Shade + vec3f(Rim), 1.0);
}
