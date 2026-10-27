//============================================================================================================================
// 🧩 Frontier — TyreCarcassLattice.h
//============================================================================================================================
// 📝 ⚠️ Provenance, stated plainly: this is NOT a port. The HTML demonstration contains no XPBD tyre — its own text says
//    "there is no XPBD carcass here" and attributes the soft-body lattice to Frontier's C++ code, which is not in this
//    repository. This is a new implementation of that described model — an XPBD particle lattice for the carcass of the
//    same authored tyre (0.50855 m radius, 0.3958 m width, 0.3446 m rim) — calibrated so its radial load/deflection
//    matches the demo's pressure-fed carcass spring K = 25 kN/m + 0.9 N/m/Pa·p (≈223 kN/m at 220 kPa). Structure: tread
//    particles in 28 sectors × 3 rows (two shoulders and the crown) tied to a kinematic rim ring by compliant spokes,
//    belt/lateral/shear distance constraints between tread particles, and one global volume constraint whose compliance
//    is the enclosed air's bulk compliance V/(γ·p_abs), so inflation pressure stiffens the carcass the way the spring's
//    air term does. Ground contact is a positional constraint with Coulomb-capped tangential friction; the summed
//    contact impulse is the tyre's normal force, which is what lets the lattice stand in for the spring inside
//    VehicleSolver's strut/tyre series stack. The lattice is solved in the steered wheel frame: the rim ring is
//    axisymmetric, so spin does not change the carcass shape — rolling enters through the contact slip velocity the
//    solver supplies for friction. Rolling hysteresis from material cycling is represented by the lattice's velocity
//    damping, not modelled per-particle.
//============================================================================================================================

#pragma once

namespace Frontier
{

// 📝 One lattice step's boundary conditions, supplied by VehicleSolver each substep.
struct TyreLatticeInput
{
    double HubPosition[3]    = { 0.0, 0.0, 0.0 };   // [m]       world
    double HubOrientation[4] = { 0.0, 0.0, 0.0, 1.0 };  // [x,y,z,w] steered wheel frame (no spin; see header)
    double HubVelocity[3]    = { 0.0, 0.0, 0.0 };   // [m/s]     world, at the hub
    double Spin              = 0.0;                 // [rad/s]   wheel spin, for contact slip velocity
    double GroundHeight      = 0.0;                 // [m]       ground plane height under the hub
    double GroundNormal[3]   = { 0.0, 0.0, 1.0 };   // [-]       unit
    double GaugePressure     = 220000.0;            // [Pa]      from the thermal gas law
    double Seconds           = 1.0 / 480.0;         // [s]
};

struct TyreLatticeOutput
{
    double NormalForce      = 0.0;   // [N]    road normal force on the tyre (summed contact impulse / step)
    double Deflection       = 0.0;   // [m]    radial deflection at the contact (R − hub height over the road)
    double TangentStiffness = 0.0;   // [N/m]  dF/dδ, smoothed — feeds VehicleSolver's stack bisection
    double Volume           = 0.0;   // [m³]   enclosed volume now
    double RestVolume       = 0.0;   // [m³]   enclosed volume of the undeformed authored tyre
};

class TyreCarcassLattice
{
public:
    static const int SectorCount = 28;                       // [-] around the circumference
    static const int RowCount = 3;                           // [-] shoulder, crown, shoulder
    static const int ParticleCount = SectorCount * RowCount; // [-] 84 tread particles

    TyreCarcassLattice();

    // 📝 Undeformed authored tyre at rest in the wheel frame.
    void Reset();

    // 📐 One XPBD step: predict under gravity, iterate spokes/belt/lateral/shear/volume/contact, derive velocities.
    TyreLatticeOutput Step(const TyreLatticeInput& Input);

    // 📝 Tread particle position [m] in the wheel frame (hub at origin), for rendering and proofs.
    void QueryParticle(int Index, double OutPosition[3]) const;

    // 📝 Calibration constants (defaults measured against the demo's carcass spring in the VehiclePhysics exhibit).
    double SpokeCompliance  = 2.2e-7;   // [m/N]  radial spokes rim→tread
    double BeltCompliance   = 2.0e-8;   // [m/N]  circumferential belt
    double LateralCompliance = 8.0e-8;  // [m/N]  across the tread
    double ShearCompliance  = 1.2e-7;   // [m/N]  diagonals
    double DampingPerSecond = 24.0;     // [1/s]  carcass hysteresis velocity damping in the wheel frame
    double FrictionCoefficient = 1.0;   // [-]    contact friction cap (tangential/normal correction)
    int    Iterations       = 6;        // [-]    XPBD iterations per step

private:
    void BuildRestShape();
    double ComputeVolume(double* OutGradients) const;  // OutGradients: ParticleCount×3, may be null

    double m_Positions[ParticleCount][3];    // [m] wheel frame
    double m_Predicted[ParticleCount][3];    // [m]
    double m_Velocities[ParticleCount][3];   // [m/s] wheel frame
    double m_RestPositions[ParticleCount][3];// [m]
    double m_RimAnchors[ParticleCount][3];   // [m] kinematic
    double m_InvMass[ParticleCount];         // [1/kg]
    double m_RestVolume = 0.0;               // [m³]
    double m_VolumeSign = 1.0;               // [-]
    double m_LastForce = 0.0;                // [N]
    double m_LastDeflection = 0.0;           // [m]
    double m_TangentStiffness = 223000.0;    // [N/m]
};

} // namespace Frontier
