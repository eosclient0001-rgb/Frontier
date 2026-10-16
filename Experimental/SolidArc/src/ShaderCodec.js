//============================================================================================================================================
//                                                              SHADERCODEC.JS
//============================================================================================================================================
// 📦 Translates the shared SolidArc shader vocabulary to GLSL ES; the CPU reference includes these same shader bodies.

import Records from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/ShadingRecords.slang?raw";
import Lattice from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/LatticeProjection.slang?raw";
import Surface from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/SurfaceRaster.slang?raw";
import Studio from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/MatcapStudio.slang?raw";
import Line from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/LineRaster.slang?raw";
import Point from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/PointRaster.slang?raw";

import Display from "../../../Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/DisplayTransfer.slang?raw";

const Sources = {"ShadingRecords.slang": Records, "MatcapStudio.slang": Studio};
function Translate(Source, Visited = new Set())
{
    return Source.replace(/#include\s+"([^"]+)"/g, (_, Name) =>
    {
        if (Visited.has(Name)) return "";
        if (!Sources[Name]) throw Error(`Unknown shared shader include: ${Name}`);
        Visited.add(Name);
        return Translate(Sources[Name], Visited);
    })
    .replace(/\.m\[(\d+)\]/g, (_, Index) => `[${Math.floor(Number(Index) / 4)}][${Number(Index) % 4}]`)
    .replace(/\bfloat4x4\b/g, "mat4")
    .replace(/\bfloat([234])\b/g, "vec$1")
    .replace(/(\d(?:[\d.eE+-]*))f\b/g, "$1")
    .replace(/\blerp\b/g, "mix")
    .replace(/\bsmoothstep\b/g, "CoverageRamp");
}

const Prelude = `#version 300 es
precision highp float;
precision highp int;
float saturate(float Value) { return clamp(Value, 0.0, 1.0); }
vec4 mul(mat4 Matrix, vec4 Vector) { return Matrix * Vector; }
float CoverageRamp(float Low, float High, float Value)
{
    float T = clamp((Value - Low) / (High - Low), 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
}
`;
const Uniforms = `
uniform ViewRecord View;
uniform DrawRecord Draw;
uniform bool IntersectionPass;
uniform uint PickIdentity;
uniform bool Dashed;
vec4 ProjectClip(vec4 Clip)
{
    return vec4(Clip.x, -Clip.y, 2.0 * Clip.z - Clip.w, Clip.w);
}
`;
const FragmentOutput = `
out vec4 PixelColour;
void ResolveColour(vec4 Colour)
{
    if (Colour.a < (IntersectionPass ? 0.05 : 0.002)) discard;
    if (IntersectionPass)
        PixelColour = vec4(float(PickIdentity & 255u), float((PickIdentity >> 8u) & 255u),
            float((PickIdentity >> 16u) & 255u), float((PickIdentity >> 24u) & 255u)) / 255.0;
    else PixelColour = Colour;
}
`;
const Corners = `const uint CornerIndex[6] = uint[6](0u, 1u, 2u, 2u, 1u, 3u);`;

export function CompileSources(Kind)
{
    if (Kind === "studio") return {
        vertex: Prelude + `
void main()
{
    vec2 Corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(Corner * 2.0 - 1.0, 0.0, 1.0);
}`,
        fragment: Prelude + Translate(Studio) + `
uniform uint StudioLayer;
out vec4 PixelColour;
void main()
{
    vec2 Position = vec2(gl_FragCoord.x / 128.0 * 2.0 - 1.0, 1.0 - gl_FragCoord.y / 128.0 * 2.0);
    float Radius = dot(Position, Position);
    vec3 Normal = Radius >= 1.0 ? normalize(vec3(Position, 0.02)) : vec3(Position, sqrt(1.0 - Radius));
    PixelColour = vec4(MatcapStudioSample(StudioLayer, Normal), 1.0);
}`
    };
    if (Kind === "display") return {
        vertex: Prelude + `
out vec2 Coordinate;
void main()
{
    Coordinate = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(Coordinate * 2.0 - 1.0, 0.0, 1.0);
}`,
        fragment: Prelude + Translate(Display) + `
uniform sampler2D LinearImage;
in vec2 Coordinate;
out vec4 PixelColour;
void main()
{
    vec4 LinearValue = texture(LinearImage, Coordinate);
    PixelColour = vec4(DisplayTransfer(LinearValue.r), DisplayTransfer(LinearValue.g), DisplayTransfer(LinearValue.b), LinearValue.a);
}`
    };
    const Body = Translate({lattice: Lattice, surface: Surface, line: Line, point: Point}[Kind]);
    const Shared = Prelude + Body + Uniforms;
    if (Kind === "surface")
    {
        const Lookup = `
uniform highp sampler2DArray StudioImage;
uniform bool StudioCached;
vec3 MatcapLookup(uint Layer, vec3 Normal)
{
    if (StudioCached) return texture(StudioImage, vec3(Normal.x * 0.5 + 0.5, 0.5 - Normal.y * 0.5, float(Layer < 14u ? Layer : 0u))).rgb;
    return MatcapStudioSample(Layer, Normal);
}\n`;
        return {
            vertex: Shared + Lookup + `
layout(location=0) in vec3 Position;
layout(location=1) in vec3 Normal;
layout(location=2) in vec2 Parameter;
out vec3 WorldPosition;
out vec3 WorldNormal;
out vec2 SurfaceParameter;
void main()
{
    SurfaceVarying Vertex = SurfaceVertex(View, Draw, Position, Normal, Parameter);
    WorldPosition = Vertex.WorldPosition;
    WorldNormal = Vertex.WorldNormal;
    SurfaceParameter = Vertex.Parameter;
    gl_Position = ProjectClip(Vertex.Clip);
}`,
            fragment: Shared + Lookup + FragmentOutput + `
in vec3 WorldPosition;
in vec3 WorldNormal;
in vec2 SurfaceParameter;
void main()
{
    if (IntersectionPass) { ResolveColour(vec4(1.0, 1.0, 1.0, Draw.Tint.a)); return; }
    SurfaceVarying SampleValue;
    SampleValue.WorldPosition = WorldPosition;
    SampleValue.WorldNormal = WorldNormal;
    SampleValue.Parameter = SurfaceParameter;
    ResolveColour(SurfaceFragment(View, Draw, SampleValue, gl_FrontFacing));
}`
        };
    }
    if (Kind === "line") return {
        vertex: Shared + Corners + `
layout(location=0) in vec3 SegmentA;
layout(location=1) in vec3 SegmentB;
out vec3 DistanceValues;
void main()
{
    LineVarying Vertex = LineVertex(View, Draw, SegmentA, SegmentB, CornerIndex[gl_VertexID]);
    DistanceValues = vec3(Vertex.Across, Vertex.Along, Vertex.SegmentPixels);
    gl_Position = ProjectClip(Vertex.Clip);
}`,
        fragment: Shared + FragmentOutput + `
in vec3 DistanceValues;
void main()
{
    LineVarying SampleValue;
    SampleValue.Across = DistanceValues.x;
    SampleValue.Along = DistanceValues.y;
    SampleValue.SegmentPixels = DistanceValues.z;
    ResolveColour(LineFragment(View, Draw, SampleValue, Dashed));
}`
    };
    if (Kind === "point") return {
        vertex: Shared + Corners + `
layout(location=0) in vec4 PositionGlyph;
out vec2 LocalPosition;
flat out float Glyph;
void main()
{
    PointVarying Vertex = PointVertex(View, Draw, PositionGlyph.xyz, PositionGlyph.w, CornerIndex[gl_VertexID]);
    LocalPosition = Vertex.Local;
    Glyph = Vertex.Glyph;
    gl_Position = ProjectClip(Vertex.Clip);
}`,
        fragment: Shared + FragmentOutput + `
in vec2 LocalPosition;
flat in float Glyph;
void main()
{
    PointVarying SampleValue;
    SampleValue.Local = LocalPosition;
    SampleValue.Glyph = Glyph;
    ResolveColour(PointFragment(View, Draw, SampleValue));
}`
    };
    return {
        vertex: Shared + `
void main()
{
    vec2 Position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(Position * 2.0 - 1.0, 0.0, 1.0);
}`,
        fragment: Shared + FragmentOutput + `
uniform vec2 PixelExtent;
void main()
{
    vec2 Ndc = vec2(gl_FragCoord.x / View.Viewport.x, 1.0 - gl_FragCoord.y / View.Viewport.y) * 2.0 - 1.0;
    vec4 NearClip = View.ClipView * vec4(Ndc, 0.0, 1.0);
    vec4 FarClip = View.ClipView * vec4(Ndc, 1.0, 1.0);
    vec3 NearPoint = NearClip.xyz / NearClip.w;
    vec3 FarPoint = FarClip.xyz / FarClip.w;
    vec3 Origin = View.EyePosition.w > 0.5 ? View.EyePosition.xyz : NearPoint;
    LatticeSample SampleValue = LatticeShade(View, Origin, normalize(FarPoint - NearPoint), PixelExtent.x, PixelExtent.y);
    gl_FragDepth = clamp(SampleValue.Depth, 0.0, 1.0);
    ResolveColour(SampleValue.Colour);
}`
    };
}
