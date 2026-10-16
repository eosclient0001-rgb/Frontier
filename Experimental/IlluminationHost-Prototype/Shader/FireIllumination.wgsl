//============================================================================================================================================
//                                                          FIREILLUMINATION.WGSL
//============================================================================================================================================
// 🧩 A burning tyre as a point light on the scene: inverse-square, windowed to its reach, shadowed through the scene distance field.

// 📝 Read by the direct pass (screen) and the card direct pass (the surface cache), so a tyre fire lights the course
//    and the car directly and, through the cards the final gather reads, bounces into the indirect term as well.
//    The shadow ray stops short of the light: the light sits inside the burning wheel, which must not shadow itself.

//! include "FrameDescriptor.wgsl"
//! include "DistanceTraversal.wgsl"

struct FireArrival
{
    Direction   : vec3f,   // [-]  toward the fire
    Illuminance : vec3f,   // [-]  arriving at normal incidence, shadowed and windowed
}

fn ResolveFireArrival(Position: vec3f, Normal: vec3f) -> FireArrival
{
    var Arrival: FireArrival;
    Arrival.Direction = vec3f(0.0, 0.0, 1.0);
    Arrival.Illuminance = vec3f(0.0);
    if (Frame.FireLightIntensity <= 0.0)
    {
        return Arrival;
    }
    let Toward = Frame.FireLightPosition - Position;
    let Squared = dot(Toward, Toward);
    let Reach = Frame.FireLightReach;
    if (Squared >= Reach * Reach)
    {
        return Arrival;
    }
    let Range = sqrt(Squared);
    Arrival.Direction = Toward / max(Range, 1.0e-4);
    if (dot(Normal, Arrival.Direction) <= 0.0)
    {
        return Arrival;
    }
    let Ratio = Squared / (Reach * Reach);
    let Window = (1.0 - Ratio * Ratio) * (1.0 - Ratio * Ratio);
    var Visibility = 1.0;
    if (FeatureEnabled(Frame, FeatureDirectShadow))
    {
        let Bias = ResolveSurfaceBias(Position);
        Visibility = TraverseSceneShadow(Position + Normal * Bias, Arrival.Direction, 0.5 * Bias, max(Range - 0.6, 0.0), 4.0);
    }
    Arrival.Illuminance = Frame.FireLightColour * Frame.FireLightIntensity * Window * Visibility / max(Squared, 0.25);
    return Arrival;
}

// A bounded number of transient emitter clusters share the fire's shadowed inverse-square model.
fn ResolveTransientArrival(Position: vec3f, Normal: vec3f, Index: u32) -> FireArrival
{
    var Arrival: FireArrival;
    Arrival.Direction = vec3f(0.0, 0.0, 1.0);
    Arrival.Illuminance = vec3f(0.0);
    let Source = Frame.TransientPosition[Index];
    let Colour = Frame.TransientColour[Index];
    if (Source.w <= 0.0 || Colour.w <= 0.0) { return Arrival; }
    let Toward = Source.xyz - Position;
    let Squared = dot(Toward, Toward);
    if (Squared >= Colour.w * Colour.w) { return Arrival; }
    let Range = sqrt(Squared);
    Arrival.Direction = Toward / max(Range, 1.0e-4);
    if (dot(Normal, Arrival.Direction) <= 0.0) { return Arrival; }
    let Ratio = Squared / (Colour.w * Colour.w);
    let Window = (1.0 - Ratio * Ratio) * (1.0 - Ratio * Ratio);
    var Visibility = 1.0;
    if (FeatureEnabled(Frame, FeatureDirectShadow))
    {
        let Bias = ResolveSurfaceBias(Position);
        Visibility = TraverseSceneShadow(Position + Normal * Bias, Arrival.Direction, 0.5 * Bias, max(Range - 0.25, 0.0), 4.0);
    }
    Arrival.Illuminance = Colour.rgb * Source.w * Window * Visibility / max(Squared, 0.3);
    return Arrival;
}
