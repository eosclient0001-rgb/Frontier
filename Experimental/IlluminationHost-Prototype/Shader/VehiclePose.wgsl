// Vehicle visual pose: rigid tyres (except the stripped rubber of a shredded tyre),
// live steering-wheel/cockpit transforms and glass state. Tyre compliance stays in VehicleSolver.
struct VehicleRecord
{
    Cabin      : vec4f,
    Column     : vec4f,
    Axis       : vec4f,
    CabinFrame : vec4f,
    CabinShift : vec4f,
    WheelShape : array<vec4f, 4>, // radius, rim radius, half width, shredded
}

struct DeformedVertex
{
    Position : vec3f,
    Normal   : vec3f,
}

fn PlaceWheelVertex(Wheel: u32, Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Moved: DeformedVertex;
    Moved.Position = Position;
    Moved.Normal = Normal;
    let Shape = VehicleState.WheelShape[Wheel];
    let Radial = length(Position.xz);
    if (Shape.w < 0.5 || Radial <= Shape.y) { return Moved; }
    // Preserve the bare-rim silhouette when rubber shreds; don't deform inflated tyres.
    let Phi = atan2(Position.z, Position.x);
    let Share = clamp((Radial - Shape.y) / max(Shape.x - Shape.y, 1.0e-4), 0.0, 1.0);
    let Ragged = 0.004 * sin(23.0 * Phi + 1.7) + 0.003 * sin(41.0 * Phi);
    let Remnant = Shape.y + 0.008 + max(Ragged, -0.006) * Share;
    Moved.Position = vec3f(cos(Phi) * Remnant, clamp(Position.y, -0.13, 0.13), sin(Phi) * Remnant);
    Moved.Normal = normalize(mix(vec3f(cos(Phi), 0.0, sin(Phi)), Normal, 0.35));
    return Moved;
}

// 📐 Rodrigues: Vector turned by Angle about the unit Axis.
fn TurnAboutAxis(Vector: vec3f, Axis: vec3f, Angle: f32) -> vec3f
{
    let C = cos(Angle);
    let S = sin(Angle);
    return Vector * C + cross(Axis, Vector) * S + Axis * dot(Axis, Vector) * (1.0 - C);
}

// 📝 A steering-wheel facet (car-body frame) turned about the column by the wheel's angle.
fn TurnSteeringWheel(Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Turned: DeformedVertex;
    let Axis = normalize(VehicleState.Axis.xyz);
    let Pivot = VehicleState.Column.xyz;
    Turned.Position = Pivot + TurnAboutAxis(Position - Pivot, Axis, VehicleState.Cabin.x);
    Turned.Normal = TurnAboutAxis(Normal, Axis, VehicleState.Cabin.x);
    return Turned;
}

// 📝 The cockpit's fixtures — dashboard, column and wheel, binnacle, tablet, seats (CabinLeather … DisplayGlass and
//    SeatFabric) — scale about the anchor and shift with it; the shell, its glazing, the mirrors and the carpet stay.
fn IsCockpitFamily(Family: u32) -> bool
{
    return (Family >= CockpitFamilyFirst && Family <= CockpitFamilyLast) || Family == SeatFabricFamily;
}

fn PlaceCockpit(Position: vec3f) -> vec3f
{
    let Anchor = VehicleState.CabinFrame.xyz;
    return Anchor + (Position - Anchor) * VehicleState.CabinFrame.w + VehicleState.CabinShift.xyz;
}

// 📝 A body vertex's own motion (car-body frame): the steering wheel turns about its column, then the cockpit's
//    fixtures take its scale and offset. A uniform scale leaves normals as they are.
fn DeformBodyVertex(Family: u32, Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Moved: DeformedVertex;
    Moved.Position = Position;
    Moved.Normal = Normal;
    if (Family == SteeringWheelFamily)
    {
        Moved = TurnSteeringWheel(Position, Normal);
    }
    if (IsCockpitFamily(Family))
    {
        Moved.Position = PlaceCockpit(Moved.Position);
    }
    return Moved;
}
