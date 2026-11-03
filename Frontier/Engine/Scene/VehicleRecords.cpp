// 🧩 Scene records for the vehicle slice: the ControlVehicle body record and its four tyre records, bound to Project Drive.

#include "Engine/Scene/VehicleRecords.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace Frontier
{

namespace
{

// 📝 Thermal constants the grip rule reads. They are the recovered demo's ThermalSpecification values, which the native
//    thermal port follows; they are named here rather than inlined because the tyre editor shows all four.
constexpr double OptimumTreadK      = 353.15;   // [K] - Grip plateau end (80 °C)
constexpr double GripFadeK          = 473.15;   // [K] - Grip reaches its floor (200 °C)
constexpr double MinimumGripFactor  = 0.60;     // [-] - Grip at the fade temperature, before pressure
constexpr double PressureSensitivity = 0.30;    // [-] - Grip lost per fractional deviation from cold pressure
constexpr double AmbientTemperatureK = 293.15;  // [K] - A freshly fitted tyre starts at ambient
constexpr double RpmToRadPerSecond   = 2.0 * 3.14159265358979323846 / 60.0;   // [rad/s per rpm]

constexpr double ClampDouble(double Value, double Low, double High) noexcept
{
    return Value < Low ? Low : (Value > High ? High : Value);
}

// 📝 Static compound table: the four tyres the editor offers. Values are presentation presets, labelled as such in the UI.
constexpr TyreCompound CompoundTable[] = {
    {"Slick",     200.0, 1.00, 1.10, "Dry only; 4 mm tread"},
    {"Semi-slick", 220.0, 0.94, 1.30, "Road-legal track tyre"},
    {"Road",      240.0, 0.84, 1.60, "Grooved, wet-capable"},
    {"Wet",       210.0, 0.72, 1.80, "High void ratio; cold-favoured"}
};

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     VEHICLE RECORD
//------------------------------------------------------------------------------------------------------------------------

// 📝 The engine and turbo structures start as the authored DefaultGTR specification, curves included: a default-constructed
//    EngineParameters has empty curve tables, and every peak/power query below reads them.
VehicleRecord::VehicleRecord()
    : RecordEntry(RecordClassification::Vehicle),
      Engine(Vehicle::EngineParameters::DefaultGTR()),
      Turbo(Vehicle::TurbochargerParameters::DefaultGTR())
{
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Description;
    Description.StableId    = "vehicle";
    Description.Group       = "Vehicle";
    Description.DisplayName = "ControlVehicle";
    Description.Category    = "Vehicle";
    Description.Glyph       = "Car";
    Description.Colour      = "#e1d34a";
    Description.Description = "Telemetry, burnout, tyres & camera";
    Description.Enabled     = &Enabled;
    // 📝 Bounds are the authored vehicle's own range plus a tuning margin: the vehicle is a muscle/GT wedge, so mass runs
    //    from a stripped shell to a loaded grand tourer and the wheelbase covers the model's 3.396 m with room to stretch.
    // 📝 Engine geometry is float, so those rows bind FloatTarget; the record's own sheet values are double.
    RecordEditorScalarField Mass{"Mass", "kg", 600.0, 2200.0, 10.0, 0, nullptr, &Geometry.Mass};
    RecordEditorScalarField CoMHeight{"Centre of mass height", "m", 0.20, 1.00, 0.01, 2, nullptr, &Geometry.CoMHeight};
    RecordEditorScalarField Wheelbase{"Wheelbase", "m", 1.50, 5.00, 0.001, 3, nullptr, &Geometry.Wheelbase};
    RecordEditorScalarField TrackFront{"Track front", "m", 1.00, 2.50, 0.001, 3, nullptr, &Geometry.TrackFront};
    RecordEditorScalarField TrackRear{"Track rear", "m", 1.00, 2.50, 0.001, 3, nullptr, &Geometry.TrackRear};
    RecordEditorScalarField RideHeight{"Ride height", "m", 0.02, 0.30, 0.005, 3, nullptr, &Geometry.StaticRideHeight};
    RecordEditorScalarField FrontWeight{"Front weight", "%", 30.0, 70.0, 0.1, 1, &FrontWeightPercent};
    RecordEditorScalarField Downforce{"Downforce scale", "-", 0.0, 2.5, 0.05, 2, &DownforceScale};
    Description.ScalarFields = {Mass, CoMHeight, Wheelbase, TrackFront, TrackRear, RideHeight, FrontWeight, Downforce};
    Description.Switches = {{"Line lock", &Powertrain.LineLock}, {"Thermal grip", &Powertrain.ThermalGrip}};
    RegisterEditorDescription(std::move(Description));
#endif
}

// 📐 Overall envelope from the authored sockets: the two id-plate hard-points give the nose-to-tail length, the side-skirt
//    sockets the widest section. Both are read from VehicleGeometry.h's ControlVehicleSockets, so a moved socket moves these.
float VehicleRecord::QueryWheelbase() const noexcept
{
    return Geometry.Wheelbase;
}

float VehicleRecord::QueryTrackFront() const noexcept
{
    return Geometry.TrackFront;
}

float VehicleRecord::QueryOverallLength() const noexcept
{
    namespace S = Vehicle::ControlVehicleSockets;
    return S::IdPlate_Primary.x - S::IdPlate_Secondary.x;
}

float VehicleRecord::QueryOverallWidth() const noexcept
{
    namespace S = Vehicle::ControlVehicleSockets;
    return S::SideSkirt_L.y - S::SideSkirt_R.y;
}

float VehicleRecord::QueryCoMHeight() const noexcept
{
    return Geometry.CoMHeight;
}

uint32_t VehicleRecord::QueryFittedTyreCount() const noexcept
{
    uint32_t Fitted = 0;
    for (const TyreSheet &Tyre : Tyres)
    {
        if (Tyre.Fitted) ++Fitted;
    }
    return Fitted;
}

uint32_t VehicleRecord::QueryPitBayCount() const noexcept
{
    uint32_t Count = 0;
    for (const PitBayTyre &Slot : PitBay)
    {
        if (Slot.Occupied) ++Count;
    }
    return Count;
}

// 📐 Half the front track over the centre-of-mass height: the lateral acceleration at which the inside wheels lift. Wide
//    track and a low CoM put this above the tyre's own limit, so the car slides before it rolls (VehicleGeometry.h).
float VehicleRecord::QueryRolloverThresholdG() const noexcept
{
    return Geometry.CoMHeight > 0.01f ? (0.5f * Geometry.TrackFront) / Geometry.CoMHeight : 0.0f;
}

void VehicleRecord::AlignPowertrain() noexcept
{
    Engine.IdleRPM          = static_cast<float>(ClampDouble(Powertrain.IdleRpm, 200.0, 3000.0));
    Engine.RedlineRPM       = static_cast<float>(ClampDouble(Powertrain.RedlineRpm, Engine.IdleRPM + 100.0, 15000.0));
    Engine.MaxRPMIncrease   = static_cast<float>(ClampDouble(Powertrain.RpmRiseLimit, 100.0, 20000.0));
    Engine.MaxRPMDecrease   = static_cast<float>(ClampDouble(Powertrain.RpmFallLimit, 100.0, 20000.0));
    Engine.EngineInertia    = static_cast<float>(ClampDouble(Powertrain.EngineInertia, 0.01, 5.0));
    Engine.InvEngineInertia = 1.0f / Engine.EngineInertia;
    Turbo.WastegateMaxBoost = static_cast<float>(ClampDouble(Powertrain.WastegateCeiling, 0.0, 3.0));
}

float VehicleRecord::QueryPeakTorqueNm() const noexcept
{
    float Peak = 0.0f;
    for (const float Torque : Engine.TorqueCurve.Y)
    {
        Peak = std::max(Peak, Torque);
    }
    return Peak;
}

float VehicleRecord::QueryPeakTorqueRpm() const noexcept
{
    float PeakTorque = 0.0f;
    float PeakRpm    = 0.0f;
    for (size_t Index = 0; Index < Engine.TorqueCurve.X.size() && Index < Engine.TorqueCurve.Y.size(); ++Index)
    {
        // 📝 Ties resolve to the first key, which is what an engine tuner reads off a flat plateau.
        if (Engine.TorqueCurve.Y[Index] > PeakTorque)
        {
            PeakTorque = Engine.TorqueCurve.Y[Index];
            PeakRpm    = Engine.TorqueCurve.X[Index];
        }
    }
    return PeakRpm;
}

// 📐 Crank power P = T·ω, sampled at every key inside the redline band plus the band's own end. The DefaultGTR table runs to
//    8500 rpm while the engine's redline is 7200, so integrating the whole table would report power the engine never makes.
float VehicleRecord::QueryPeakPowerKwInBand() const noexcept
{
    const double Redline = Powertrain.RedlineRpm > 0.0 ? Powertrain.RedlineRpm
                                                       : static_cast<double>(Engine.RedlineRPM);
    double PeakKilowatts = 0.0;
    for (size_t Index = 0; Index < Engine.TorqueCurve.X.size() && Index < Engine.TorqueCurve.Y.size(); ++Index)
    {
        const double Rpm = Engine.TorqueCurve.X[Index];
        if (Rpm > Redline) continue;
        PeakKilowatts = std::max(PeakKilowatts,
                                 static_cast<double>(Engine.TorqueCurve.Y[Index]) * Rpm * RpmToRadPerSecond / 1000.0);
    }
    // 📝 The band end is evaluated on the interpolated torque whenever the redline falls between two keys. The emptiness test
    //    comes first: an empty curve has no back() to compare against.
    if (!Engine.TorqueCurve.X.empty() && Redline <= static_cast<double>(Engine.TorqueCurve.X.back()))
    {
        PeakKilowatts = std::max(PeakKilowatts,
                                 static_cast<double>(Engine.TorqueCurve.Sample(static_cast<float>(Redline)))
                                     * Redline * RpmToRadPerSecond / 1000.0);
    }
    return static_cast<float>(PeakKilowatts);
}

bool VehicleRecord::IsCornerFront(uint32_t Corner) const noexcept
{
    return Corner == FrontLeftCorner || Corner == FrontRightCorner;
}

double VehicleRecord::QueryColdPressureKpa(uint32_t Corner) const noexcept
{
    return IsCornerFront(Corner) ? ColdPressureFrontKpa : ColdPressureRearKpa;
}

// 📝 Removal is refused when there is no tyre or the bay is full: both leave the vehicle exactly as it was, so the caller
//    can surface the refusal rather than half-performing a pit stop.
bool VehicleRecord::RemoveTyre(uint32_t Corner, double ClockSeconds)
{
    if (Corner >= CornerCount || !Tyres[Corner].Fitted) return false;
    PitBayTyre *Vacancy = nullptr;
    for (PitBayTyre &Slot : PitBay)
    {
        if (!Slot.Occupied) { Vacancy = &Slot; break; }
    }
    if (Vacancy == nullptr) return false;   // Bay full: nothing is silently dropped.

    Vacancy->CornerIndex      = Corner;
    Vacancy->Compound         = 1;          // [-] - SemiSlick, the authored default (compound selection is presentation)
    Vacancy->PressureKpa      = Tyres[Corner].PressureKpa;
    Vacancy->TreadCelsius     = Tyres[Corner].TreadCelsius;
    Vacancy->WearPercent      = Tyres[Corner].WearPercent;
    Vacancy->RemovedAtSeconds = ClockSeconds;
    Vacancy->Occupied         = true;

    Tyres[Corner].Fitted       = false;
    Tyres[Corner].PressureKpa  = 0.0;                              // A hub with no tyre holds no pressure.
    Tyres[Corner].TreadCelsius = AmbientTemperatureK - 273.15;     // It also stops being hot: it is off the car, cooling.
    return true;
}

bool VehicleRecord::FitTyre(uint32_t Corner, double ClockSeconds)
{
    if (Corner >= CornerCount || Tyres[Corner].Fitted) return false;
    (void)ClockSeconds;

    // 📝 The most recently removed tyre for this corner is the one that goes back on; older ones stay in the bay.
    PitBayTyre *BayTyre = nullptr;
    for (PitBayTyre &Slot : PitBay)
    {
        if (!Slot.Occupied || Slot.CornerIndex != Corner) continue;
        if (BayTyre == nullptr || Slot.RemovedAtSeconds > BayTyre->RemovedAtSeconds) BayTyre = &Slot;
    }

    if (BayTyre != nullptr)
    {
        Tyres[Corner].PressureKpa  = BayTyre->PressureKpa;
        Tyres[Corner].TreadCelsius = BayTyre->TreadCelsius;
        Tyres[Corner].WearPercent  = BayTyre->WearPercent;
        *BayTyre = PitBayTyre{};   // Empty the slot only after the values are copied out.
    }
    else
    {
        // A fresh tyre: the set's cold pressure for this axle, ambient tread, no wear.
        Tyres[Corner].PressureKpa  = QueryColdPressureKpa(Corner);
        Tyres[Corner].TreadCelsius = AmbientTemperatureK - 273.15;
        Tyres[Corner].WearPercent  = 0.0;
    }
    Tyres[Corner].Fitted = true;
    return true;
}

void VehicleRecord::RefitAllTyres(double ClockSeconds)
{
    for (uint32_t Corner = 0; Corner < CornerCount; ++Corner)
    {
        if (!Tyres[Corner].Fitted) (void)FitTyre(Corner, ClockSeconds);
    }
}

// 📐 Front weight percent → the engine's 0..1 fraction, the one conversion the vehicle sheet needs. It is a method rather than
//    an inline expression so a host has exactly one place to call after an edit, and so the direction is never ambiguous.
void VehicleRecord::AlignGeometrySheet() noexcept
{
    Geometry.FrontWeightFraction = static_cast<float>(ClampDouble(FrontWeightPercent, 0.0, 100.0) / 100.0);
}

void VehicleRecord::ApplyColdPressure(uint32_t Corner, double PressureKpa)
{
    if (Corner >= CornerCount) return;
    const double Clamped = ClampDouble(PressureKpa, 0.0, 400.0);   // [kPa] - The tyre's own pressure window
    if (IsCornerFront(Corner)) ColdPressureFrontKpa = Clamped;
    else                       ColdPressureRearKpa  = Clamped;

    // 📝 The live tyres on that axle take the new pressure: inflating the set inflates the car, not the next tyre fitted.
    if (Tyres[Corner].Fitted) Tyres[Corner].PressureKpa = Clamped;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      TYRE RECORD
//------------------------------------------------------------------------------------------------------------------------

TyreRecord::TyreRecord(VehicleRecord &Vehicle, uint32_t Corner)
    : RecordEntry(RecordClassification::Tyre), Vehicle(Vehicle), Corner(Corner < VehicleRecord::CornerCount ? Corner : 0u)
{
#if defined(FRONTIER_EDITOR_PROFILE)
    // 📝 The tyre's inspector description is built from the corner it is: group and colour nest it under the vehicle, and the
    //    fields bind straight to that corner's sheet in the vehicle, so the editor edits the fitted tyre's own state.
    TyreSheet &Sheet = Vehicle.Tyres[this->Corner];
    const char *Label = CornerLabel();
    RecordEditorDescription Description;
    Description.StableId    = this->Corner == VehicleRecord::FrontLeftCorner ? "tyre-FL"
                            : this->Corner == VehicleRecord::FrontRightCorner ? "tyre-FR"
                            : this->Corner == VehicleRecord::RearLeftCorner ? "tyre-RL" : "tyre-RR";
    Description.Group       = "Vehicle";
    Description.DisplayName = Label;
    Description.Category    = "Tyre";
    Description.Glyph       = "CircleDot";
    Description.Colour      = "#d9c46a";
    Description.Description = "Parented to the vehicle · removable at a pit stop";
    Description.Enabled     = &Sheet.Fitted;
    Description.ScalarFields = {
        {"Pressure", "kPa", 0.0, 400.0, 5.0, 0, &Sheet.PressureKpa},
        {"Tread temperature", "°C", -20.0, 250.0, 1.0, 0, &Sheet.TreadCelsius},
        {"Tread wear", "%", 0.0, 100.0, 0.5, 1, &Sheet.WearPercent}};
    RegisterEditorDescription(std::move(Description));
#endif
}

const char *TyreRecord::CornerLabel() const noexcept
{
    switch (Corner)
    {
        case 0: return "Front left";
        case 1: return "Front right";
        case 2: return "Rear left";
        case 3: return "Rear right";
        default: break;
    }
    return "Tyre";
}

const char *TyreRecord::CornerAbbreviation() const noexcept
{
    switch (Corner)
    {
        case 0: return "FL";
        case 1: return "FR";
        case 2: return "RL";
        case 3: return "RR";
        default: break;
    }
    return "??";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TYRE COMPOUNDS
//------------------------------------------------------------------------------------------------------------------------

const TyreCompound *QueryTyreCompounds(size_t &Count) noexcept
{
    Count = sizeof(CompoundTable) / sizeof(CompoundTable[0]);
    return CompoundTable;
}

// 📐 Thermal fade to the floor, then the pressure term: a tyre at its optimum with cold pressure has full compound grip; a
//    tyre over-pressure loses 30 % per 100 % deviation, floored at a quarter so a burst reading never goes negative.
double EvaluateTyreGrip(double SurfaceK, double PressureKpa, double ColdPressureKpa,
                        double OptimumK, double FadeK, double MinimumFactor,
                        double PressureSensitivity, double CompoundGripScale) noexcept
{
    const double Fade = std::max(OptimumK + 1.0, FadeK);
    const double Hot = ClampDouble((SurfaceK - OptimumK) / (Fade - OptimumK), 0.0, 1.0);
    const double Thermal = 1.0 - Hot * (1.0 - ClampDouble(MinimumFactor, 0.0, 1.0));
    const double Deviation = ColdPressureKpa > 1.0 ? (PressureKpa - ColdPressureKpa) / ColdPressureKpa : 0.0;
    const double Pressure = std::max(0.25, 1.0 - ClampDouble(PressureSensitivity, 0.0, 1.0) * Deviation);
    return ClampDouble(Thermal * Pressure * CompoundGripScale, 0.0, 1.3);
}

} // namespace Frontier
