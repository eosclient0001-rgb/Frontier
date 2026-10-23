//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/Tyre/TyreModelFactory.cpp
//============================================================================================================================================
// The one place that knows every backend. Adding a fourth tyre model means adding an enumerator, a class and a line here;
// nothing in the chassis, drivetrain, suspension or Jolt binding changes.

#include "TyreModel.h"

#include "Fem/FemTyreModel.h"
#include "Jolt/RigidTyreModel.h"
#include "Xpbd/XpbdSpringTyreModel.h"

namespace Frontier::Vehicle {

const char* TyreModelName(TyreModelKind Kind) noexcept
{
    switch (Kind)
    {
        case TyreModelKind::RigidTraceFan:     return "RigidTraceFan";
        case TyreModelKind::XpbdSpringCarcass: return "XpbdSpringCarcass";
        case TyreModelKind::VolumetricFem:     return "VolumetricFem";
    }
    return "Unknown";
}

std::unique_ptr<TyreModel> CreateTyreModel(TyreModelKind Kind) noexcept
{
    switch (Kind)
    {
        case TyreModelKind::RigidTraceFan:     return std::make_unique<RigidTyreModel>();
        case TyreModelKind::XpbdSpringCarcass: return std::make_unique<XpbdSpringTyreModel>();
        case TyreModelKind::VolumetricFem:     return std::make_unique<FemTyreModel>();
    }
    return nullptr;
}

} // namespace Frontier::Vehicle
