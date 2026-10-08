//============================================================================================================================================
//                                                              PRIMITIVESHAPE.H
//============================================================================================================================================
// 📦 Which authored solid a placement was constructed as. The fracture card and the outliner read this identity, never the name.

#pragma once
#include <cstdint>

namespace Frontier {
// 🔢 Constructed solid identity. Unlisted is the honest answer for imported or renamed geometry: it is never guessed from text.
enum class PrimitiveShape : uint8_t
{
    Unlisted = 0u,
    Cube,
    Sphere,
    Cylinder,
    Cone,
    Plane,
    Torus
};

// 📝 The lowercase word the browser takes from the outliner icon once its "editor-" prefix is stripped. Unlisted reads
//    as "mesh", the generic icon, so the fracture card reports it as pending exactly as the browser does.
inline const char* PrimitiveIconWord(PrimitiveShape Shape) noexcept
{
    switch (Shape)
    {
    case PrimitiveShape::Cube:     return "cube";
    case PrimitiveShape::Sphere:   return "sphere";
    case PrimitiveShape::Cylinder: return "cylinder";
    case PrimitiveShape::Cone:     return "cone";
    case PrimitiveShape::Plane:    return "plane";
    case PrimitiveShape::Torus:    return "torus";
    default:                       return "mesh";
    }
}
}
