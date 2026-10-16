//============================================================================================================================================
//                                                             GHOSTVIEW.WGSL
//============================================================================================================================================
// 🧩 The car's ghost and wireframe views: one test both car raster paths (SurfaceRaster, ForwardRaster) run per fragment.

// 📝 Facets are drawn as non-indexed triangles (FacetStructure: three vertices per facet, FirstVertex a multiple of 3), so a
//    vertex's corner, vertex_index mod 3, is its barycentric weight: (1,0,0), (0,1,0) or (0,0,1). Interpolated, the weight
//    is zero on the triangle's edge; its fwidth turns that into a distance in pixels, which is what the wireframe reads.
const GhostWireWidth = 1.1;      // [px] wire half-width kept on each edge

fn CornerBarycentric(VertexIndex: u32) -> vec3f
{
    let Corner = VertexIndex % 3u;
    return vec3f(select(0.0, 1.0, Corner == 0u), select(0.0, 1.0, Corner == 1u), select(0.0, 1.0, Corner == 2u));
}

// 📝 True where a car fragment is not drawn in the chosen view (VehicleState.Cabin.z: 0 solid, 1 ghost, 2 wireframe).
//    Ghost: screen-door transparency — a fixed dither per pixel, shifted each frame so temporal antialiasing averages it
//    into a fade; CabinShift.w is the fraction of pixels kept (the ghost opacity). Wireframe: only the pixels within
//    GhostWireWidth of a triangle's edge survive.
fn ShouldDiscardForGhost(Pixel: vec2f, Bary: vec3f, Derivative: vec3f) -> bool
{
    let Mode = u32(VehicleState.Cabin.z + 0.5);
    if (Mode == 1u)
    {
        let Shifted = Pixel + vec2f(5.588238 * f32(Frame.FrameIndex % 32u));
        let Threshold = fract(52.9829189 * fract(dot(Shifted, vec2f(0.06711056, 0.00583715))));
        return Threshold >= VehicleState.CabinShift.w;
    }
    if (Mode == 2u)
    {
        let Distance = Bary / max(Derivative, vec3f(1.0e-5));
        return min(min(Distance.x, Distance.y), Distance.z) > GhostWireWidth;
    }
    return false;
}
