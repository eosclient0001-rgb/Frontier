/*====================================================================================================================================
                                                    VEHICLERECORDS.H
====================================================================================================================================*/
// 🧩 Scene records for the vehicle slice: the ControlVehicle body record and its four tyre records, bound to Project Drive.

#pragma once

#include "RecordEntry.h"

#include "Engine/Physics/ProjectDrive/Drivetrain.h"
#include "Engine/Physics/ProjectDrive/VehicleGeometry.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                        STRUCTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The editable powertrain sheet. Values are Drivetrain.h's DefaultGTR specification, held here as live settings so the
//    inspector edits the same numbers the solver reads; the curves are the ones the record owns (see VehicleRecord::Engine).
struct PowertrainSheet
{
    double IdleRpm          = 700.0;    // [rpm] - EngineParameters::IdleRPM
    double RedlineRpm       = 7200.0;   // [rpm] - EngineParameters::RedlineRPM
    double RpmRiseLimit     = 1800.0;   // [rpm/s] - EngineParameters::MaxRPMIncrease
    double RpmFallLimit     = 2600.0;   // [rpm/s] - EngineParameters::MaxRPMDecrease
    double EngineInertia    = 0.38;     // [kg·m²] - EngineParameters::EngineInertia
    double WastegateCeiling = 1.2;      // [bar] - TurbochargerParameters::WastegateMaxBoost
    double FinalDriveRatio  = 3.55;     // [-] - Drivetrain.h FinalDriveRatio
    double LaunchRpm        = 2600.0;   // [rpm] - the AMT slip target while the wheels cannot carry the engine
    bool   ThermalGrip      = true;     // [-] - Hot or under-inflated tyres lose grip
    bool   LineLock         = false;    // [-] - Front brakes only, gear held
    bool   Enabled          = true;     // [-] - Powertrain row toggle
};

// 📝 One tyre's own state. The tyre is parented to the vehicle; a pit stop removes it (Fitted = false) and keeps the used
//    tyre in the vehicle record's pit bay so refitting returns the same tyre rather than a new one.
//    💡 The stored quantities are the ones the inspector shows — °C and percent — because the editor binds a field to one
//       member and writes it directly. The physical forms the solver needs (K, 0..1) are computed beside them, so there is
//       no second copy that can drift and no hidden conversion inside a control.
struct TyreSheet
{
    double PressureKpa   = 220.0;   // [kPa] - Gauge pressure; 220 kPa is the demo's cold default
    double TreadCelsius  = 20.0;    // [°C] - Tread temperature; ambient at rest (ThermalSpecification::AmbientTemperature)
    double WearPercent   = 2.0;     // [%] - Tread worn away, 0 new to 100 worn through
    bool   Fitted        = true;    // [-] - On the vehicle (a hub with no tyre reads as removed)
    bool   Visible       = true;    // [-] - Outliner eye

    [[nodiscard]] double SurfaceK() const noexcept { return TreadCelsius + 273.15; }   // [K] - Absolute tread temperature
    [[nodiscard]] double WearFraction() const noexcept { return WearPercent / 100.0; } // [-] - 0 new to 1 worn through
};

// 📝 A tyre taken off the vehicle. It keeps its own state so refitting replaces the tyre, not the tyre's history.
struct PitBayTyre
{
    uint32_t CornerIndex       = 0;     // [-] - 0 FL, 1 FR, 2 RL, 3 RR
    uint32_t Compound          = 0;     // [-] - Index into the compound list the record exposes
    double   PressureKpa       = 0.0;   // [kPa]
    double   TreadCelsius      = 0.0;   // [°C]
    double   WearPercent       = 0.0;   // [%]
    double   RemovedAtSeconds  = 0.0;   // [s] - Session clock at removal
    bool     Occupied          = false; // [-] - A slot is only meaningful when occupied
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     VEHICLE RECORD
//------------------------------------------------------------------------------------------------------------------------

// 📝 The vehicle owns the authored geometry (VehicleGeometry) and the engine's curves; the four TyreRecords are constructed
//    with it and nested beneath it in the SceneDirectory. Nothing here creates geometry: the record carries data, and the
//    stage draws from it.
class VehicleRecord final : public RecordEntry
{
  public:
    // 📝 Wheel classification constants for the four corners, in the authored order FL, FR, RL, RR.
    static constexpr uint32_t FrontLeftCorner  = 0;   // [-] - Socket AxleMount_FL
    static constexpr uint32_t FrontRightCorner = 1;   // [-] - Socket AxleMount_FR
    static constexpr uint32_t RearLeftCorner   = 2;   // [-] - Socket AxleMount_RL
    static constexpr uint32_t RearRightCorner  = 3;   // [-] - Socket AxleMount_RR
    static constexpr uint32_t CornerCount      = 4;   // [-] - Wheels per vehicle
    static constexpr uint32_t PitBayCapacity   = 8;   // [-] - Tyres a session can keep off the vehicle

    VehicleRecord();

    // -- Authored data ----------------------------------------------------------------------------------------------------
    Vehicle::VehicleGeometry Geometry;          // [-] - VehicleGeometry.h defaults (ControlVehicle sockets)
    Vehicle::EngineParameters Engine;           // [-] - DefaultGTR torque / flow / temperature curves
    Vehicle::TurbochargerParameters Turbo;      // [-] - DefaultGTR boost and multiplier curves
    PowertrainSheet           Powertrain;       // [-] - Live inspector-bound powertrain sheet
    std::array<TyreSheet, CornerCount>         Tyres;   // [-] - One state per corner
    std::array<PitBayTyre, PitBayCapacity>     PitBay;  // [-] - Tyres removed and kept for refitting
    bool                      Enabled = true;   // [-] - Vehicle row toggle
    double                    DownforceScale = 1.0;   // [-] - Inspector multiplier on the aero devices
    // 📝 Front weight is edited in percent: Geometry.FrontWeightFraction is 0..1 and feeds VehicleGeometry's axle formulas,
    //    so the record holds the editor's percent and AlignGeometrySheet() copies it across before the geometry is handed on.
    double                    FrontWeightPercent = 49.14;   // [%] - Static front mass fraction, as the inspector shows it

    // -- Queries the inspector and the validation use ----------------------------------------------------------------
    [[nodiscard]] float   QueryWheelbase() const noexcept;                     // [m]
    [[nodiscard]] float   QueryTrackFront() const noexcept;                    // [m]
    [[nodiscard]] float   QueryOverallLength() const noexcept;                 // [m]
    [[nodiscard]] float   QueryOverallWidth() const noexcept;                  // [m]
    [[nodiscard]] float   QueryCoMHeight() const noexcept;                     // [m]
    [[nodiscard]] uint32_t QueryFittedTyreCount() const noexcept;              // [tyres] - 0..4
    [[nodiscard]] uint32_t QueryPitBayCount() const noexcept;                  // [tyres]
    [[nodiscard]] float   QueryRolloverThresholdG() const noexcept;            // [g]
    // 📝 Applies the inspector's powertrain sheet to the engine/turbo structures the solver samples: redline, idle and the
    //    engine's rpm-rate limits onto EngineParameters, the wastegate ceiling onto TurbochargerParameters. Curves are not
    //    touched — they are the record's own live tables. Call before handing the record to a solver step.
    void AlignPowertrain() noexcept;

    [[nodiscard]] float   QueryPeakTorqueNm() const noexcept;                  // [Nm] - Peak of the live torque curve
    [[nodiscard]] float   QueryPeakTorqueRpm() const noexcept;                 // [rpm]
    [[nodiscard]] float   QueryPeakPowerKwInBand() const noexcept;             // [kW] - Peak inside the redline band

    // -- Editing operations ---------------------------------------------------------------------------------------------
    // 📝 Removing keeps the tyre's own state in the pit bay; refitting returns that used tyre when the bay holds one for this
    //    corner, otherwise it builds a fresh tyre at the vehicle's cold pressure. Both return false when they cannot act
    //    (no tyre fitted, a tyre already fitted, the bay is full) so the caller can leave the UI consistent.
    bool RemoveTyre(uint32_t Corner, double ClockSeconds);   // [-] - Pit-stop removal
    bool FitTyre(uint32_t Corner, double ClockSeconds);      // [-] - Refit the bay tyre, else a new one
    void RefitAllTyres(double ClockSeconds);                 // [-] - Close the pit stop

    // 📝 Cold pressure applies to the tyres currently on that axle, so editing the sheet is a live pit action.
    void ApplyColdPressure(uint32_t Corner, double PressureKpa);   // [kPa] - Writes the corner's tyre and the geometry's sheet

    [[nodiscard]] bool   IsCornerFront(uint32_t Corner) const noexcept;   // [-] - Front axle corners steer
    [[nodiscard]] double QueryColdPressureKpa(uint32_t Corner) const noexcept;   // [kPa] - The set's pressure for that axle

    // 📝 Writes the editor-presented quantities back into the engine's structured geometry: front weight percent → fraction.
    //    A host calls this once per edit (or per frame, before ApplyGeometry) so the solver never reads a stale fraction.
    void AlignGeometrySheet() noexcept;

  private:
    double ColdPressureFrontKpa = 220.0;   // [kPa] - Front axle cold pressure for a fresh tyre
    double ColdPressureRearKpa  = 220.0;   // [kPa] - Rear axle cold pressure for a fresh tyre
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      TYRE RECORD
//------------------------------------------------------------------------------------------------------------------------

// 📝 One tyre as a record of its own: the Outliner nests it under the vehicle, selecting it opens the tyre editor, and it
//    reaches its own state through the vehicle rather than owning a copy. Destruction of the vehicle removes the tyre rows
//    because the records are destroyed together (the tyre holds no up-link of its own).
class TyreRecord final : public RecordEntry
{
  public:
    TyreRecord(VehicleRecord &Vehicle, uint32_t Corner);

    [[nodiscard]] uint32_t       CornerIndex() const noexcept { return Corner; }        // [-] - 0 FL, 1 FR, 2 RL, 3 RR
    [[nodiscard]] VehicleRecord &OwningVehicle() noexcept { return Vehicle; }           // [-] - Never owned here
    [[nodiscard]] const VehicleRecord &OwningVehicle() const noexcept { return Vehicle; }
    [[nodiscard]] const char    *CornerLabel() const noexcept;                          // [text] - "Front left", ...
    [[nodiscard]] const char    *CornerAbbreviation() const noexcept;                   // [text] - "FL", "FR", "RL", "RR"

  private:
    VehicleRecord &Vehicle;    // [-] - The vehicle the tyre is parented to; outlives the tyre
    uint32_t       Corner;     // [-] - Which corner of that vehicle this record is
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    TYRE COMPOUNDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Presentation presets for the tyre editor: a compound selects the cold-pressure window, the grip scale and the wearable
//    tread mass. The thermal constants stay the solver's; these rows are the authored choice of which tyre is fitted.
struct TyreCompound
{
    const char *Name        = "";
    double      ColdPressureKpa = 220.0;   // [kPa] - Cold inflation the compound is specified at
    double      GripScale   = 1.0;         // [-] - Multiplier on the thermal grip curve
    double      TreadMassKg = 1.1;         // [kg] - Wearable tread rubber
    const char *Note        = "";
};

[[nodiscard]] const TyreCompound *QueryTyreCompounds(size_t &Count) noexcept;   // [-] - Static table; never owned by caller

// 📝 Grip from tread temperature and pressure deviation: full grip to the optimum, a linear fade to the minimum factor at the
//    fade temperature, scaled by the fractional cold-pressure deviation and the compound. Mirrors TyreThermalSolver.js.
[[nodiscard]] double EvaluateTyreGrip(double SurfaceK, double PressureKpa, double ColdPressureKpa,
                                      double OptimumK, double FadeK, double MinimumFactor,
                                      double PressureSensitivity, double CompoundGripScale) noexcept;

} // namespace Frontier
