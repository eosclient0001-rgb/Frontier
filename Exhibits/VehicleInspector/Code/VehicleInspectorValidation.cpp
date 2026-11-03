/*====================================================================================================================================
                                            VEHICLEINSPECTORVALIDATION.CPP
====================================================================================================================================*/
// 🧩 Vehicle and tyre records, their editor descriptions, the pit-stop lifecycle and the plan-view stage render.

// 📝 What this proves: the vehicle record exists as a scene record, owns the authored geometry and the engine's powertrain
//    structures, nests four tyre records beneath it in the SceneDirectory, exposes editor descriptions the inspector host can
//    draw, and behaves correctly when a tyre is removed and refitted. The stage render draws the vehicle from the record's own
//    geometry — it is the host CPU drawing the same plan view the prototype draws on a canvas, not an editor viewport frame.
//    Nothing here creates modelling geometry, and no Jolt body, GPU renderer or ImGui window is involved.

#include "Engine/Interface/SceneDirectoryPanel.h"
#include "Engine/Scene/SceneDirectory.h"
#include "Engine/Scene/VehicleRecords.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace
{
using namespace Frontier;

int Failures = 0;

void Check(bool Condition, const char *Name, const std::string &Detail = {})
{
    std::printf("%s %s%s%s\n", Condition ? "PASS" : "FAIL", Name, Detail.empty() ? "" : " — ", Detail.c_str());
    if (!Condition) ++Failures;
}

bool Near(double Left, double Right, double Tolerance)
{
    return std::fabs(Left - Right) <= Tolerance;
}

std::string Format(const char *Message, double A = 0.0, double B = 0.0)
{
    char Buffer[256] = {};
    std::snprintf(Buffer, sizeof(Buffer), Message, A, B);
    return Buffer;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                EDITOR DESCRIPTION ACCESS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The descriptions live in the SceneDirectory under the record's token; this is exactly how the inspector host reaches
//    them, so the checks below exercise the real path rather than a record-side copy.
const RecordEditorDescription *FindDescription(RecordToken Token)
{
    return SceneDirectory::Instance().QueryEditorDescription(Token);
}

int CountScalarFields(const RecordEditorDescription *Description)
{
    return Description == nullptr ? 0 : static_cast<int>(Description->ScalarFields.size());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        RECORDS
//------------------------------------------------------------------------------------------------------------------------

void CheckRecords()
{
    VehicleRecord Vehicle;
    std::printf("\n-- records --\n");
    Check(Vehicle.Classification() == RecordClassification::Vehicle, "vehicle record is classified Vehicle");
    Check(SceneDirectory::Instance().QueryRegistered(Vehicle.Token()), "construction registers the vehicle in the directory");
    Check(Vehicle.QueryFittedTyreCount() == 4, "the vehicle starts with four fitted tyres");

    // 📐 Authored geometry: sockets, envelope and the derived rollover limit.
    Check(Near(Vehicle.QueryWheelbase(), 3.396, 1e-6), "wheelbase is the authored socket span",
          Format("%.3f m", Vehicle.QueryWheelbase()));
    Check(Near(Vehicle.QueryOverallLength(), 5.9748, 1e-4), "overall length comes from the id-plate sockets",
          Format("%.4f m", Vehicle.QueryOverallLength()));
    Check(Near(Vehicle.QueryOverallWidth(), 2.1490, 1e-4), "overall width comes from the side-skirt sockets",
          Format("%.4f m", Vehicle.QueryOverallWidth()));
    Check(Near(Vehicle.QueryRolloverThresholdG(), (0.5 * 2.095) / 0.53, 1e-6), "rollover limit is half-track over CoM height",
          Format("%.3f g", Vehicle.QueryRolloverThresholdG()));

    // 📐 Powertrain: the DefaultGTR curves the record owns.
    Check(Near(Vehicle.QueryPeakTorqueNm(), 520.0, 1e-6), "peak torque is the DefaultGTR table peak",
          Format("%.0f Nm", Vehicle.QueryPeakTorqueNm()));
    Check(Near(Vehicle.QueryPeakTorqueRpm(), 4800.0, 1e-6), "peak torque speed is the first 520 Nm key",
          Format("%.0f rpm", Vehicle.QueryPeakTorqueRpm()));
    // 7200 rpm sits between the 7000 (462 Nm) and 7600 (448 Nm) keys: 462 + (200/600)·(448−462) = 457.333 Nm.
    const double TorqueAtRedline = static_cast<double>(Vehicle.Engine.TorqueCurve.Sample(7200.0f));
    Check(Near(TorqueAtRedline, 457.333, 5e-3), "the torque curve interpolates at the redline",
          Format("%.3f Nm", TorqueAtRedline));
    const double ExpectedKw = TorqueAtRedline * 7200.0 * (2.0 * 3.14159265358979323846 / 60.0) / 1000.0;
    Check(Near(Vehicle.QueryPeakPowerKwInBand(), ExpectedKw, 1e-3), "peak power stops at the redline, not at the last key",
          Format("%.2f kW", Vehicle.QueryPeakPowerKwInBand()));
}

void CheckTyreRecords()
{
    std::printf("\n-- tyre records --\n");
    VehicleRecord Vehicle;
    std::array<TyreRecord *, VehicleRecord::CornerCount> Tyres{};
    std::array<TyreRecord, VehicleRecord::CornerCount> TyreStorage = {
        TyreRecord(Vehicle, 0), TyreRecord(Vehicle, 1), TyreRecord(Vehicle, 2), TyreRecord(Vehicle, 3)};

    for (uint32_t Corner = 0; Corner < VehicleRecord::CornerCount; ++Corner)
    {
        Tyres[Corner] = &TyreStorage[Corner];
        const bool Nested = SceneDirectory::Instance().ConfigureParent(Tyres[Corner]->Token(), Vehicle.Token());
        Check(Nested, "tyre record is parented to the vehicle",
              std::string(Tyres[Corner]->CornerAbbreviation()) + " under " + std::to_string(Vehicle.Token().Value));
    }
    Check(SceneDirectory::Instance().QueryChildCount(Vehicle.Token()) == 4, "the vehicle reports four nested tyre records",
          std::to_string(SceneDirectory::Instance().QueryChildCount(Vehicle.Token())) + " children");
    Check(std::string(Tyres[0]->CornerLabel()) == "Front left" && std::string(Tyres[3]->CornerAbbreviation()) == "RR",
          "tyre records carry their own corner labels");
    Check(&Tyres[0]->OwningVehicle() == &Vehicle, "a tyre record reaches its own vehicle, and owns nothing");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   EDITOR DESCRIPTIONS
//------------------------------------------------------------------------------------------------------------------------

void CheckEditorDescriptions()
{
    std::printf("\n-- editor descriptions --\n");
    VehicleRecord Vehicle;
    TyreRecord FrontLeft(Vehicle, 0);

    const RecordEditorDescription *VehicleDescription = FindDescription(Vehicle.Token());
    Check(VehicleDescription != nullptr, "the vehicle registered an editor description");
    if (VehicleDescription != nullptr)
    {
        Check(std::string(VehicleDescription->StableId) == "vehicle", "vehicle description uses the pinned HTML stable id");
        Check(std::string(VehicleDescription->Group) == "Vehicle", "vehicle description sits in the Vehicle group");
        Check(CountScalarFields(VehicleDescription) == 8, "vehicle description binds eight scalar fields",
              std::to_string(CountScalarFields(VehicleDescription)));
        Check(VehicleDescription->Switches.size() == 2, "vehicle description exposes two property switches");
        Check(VehicleDescription->Enabled == &Vehicle.Enabled, "the enabled setting is the record's own");

        // 📝 Every field must be bound, and bound to a record member rather than a copy.
        int Unbound = 0;
        int FloatBound = 0;
        for (const RecordEditorScalarField &Field : VehicleDescription->ScalarFields)
        {
            if (Field.Target == nullptr && Field.FloatTarget == nullptr) ++Unbound;
            if (Field.FloatTarget != nullptr) ++FloatBound;
        }
        Check(Unbound == 0, "every vehicle field is bound to a live setting");
        Check(FloatBound == 6, "engine geometry fields bind their float members directly",
              std::to_string(FloatBound) + " float-bound");

        // 📝 An edit through the description edits the record: the mass field writes Geometry.Mass.
        RecordEditorScalarField MassField = VehicleDescription->ScalarFields[0];
        if (MassField.FloatTarget != nullptr) *MassField.FloatTarget = 1450.0f;
        Check(Near(Vehicle.Geometry.Mass, 1450.0, 1e-6), "editing a bound field edits the record's geometry",
              Format("%.0f kg", Vehicle.Geometry.Mass));
        Vehicle.Geometry.Mass = 1300.0f;

        // 📝 Front weight is percent in the sheet and a fraction in the engine: AlignGeometrySheet is the one conversion.
        Vehicle.FrontWeightPercent = 47.5;
        Vehicle.AlignGeometrySheet();
        Check(Near(Vehicle.Geometry.FrontWeightFraction, 0.475, 1e-6), "front weight percent aligns onto the engine fraction",
              Format("%.3f", Vehicle.Geometry.FrontWeightFraction));
        Vehicle.FrontWeightPercent = 49.14;
        Vehicle.AlignGeometrySheet();
    }

    const RecordEditorDescription *TyreDescription = FindDescription(FrontLeft.Token());
    Check(TyreDescription != nullptr, "the tyre record registered an editor description");
    if (TyreDescription != nullptr)
    {
        Check(std::string(TyreDescription->StableId) == "tyre-FL", "tyre description uses the pinned per-corner id");
        Check(std::string(TyreDescription->Category) == "Tyre", "tyre description is categorised Tyre");
        Check(CountScalarFields(TyreDescription) == 3, "tyre description binds pressure, temperature and wear");
        Check(TyreDescription->Enabled == &Vehicle.Tyres[0].Fitted, "the tyre's enabled setting is its fitted state");
        RecordEditorScalarField PressureField = TyreDescription->ScalarFields[0];
        if (PressureField.Target != nullptr) *PressureField.Target = 186.0;
        Check(Near(Vehicle.Tyres[0].PressureKpa, 186.0, 1e-9), "editing the tyre's field edits that corner only",
              Format("%.0f kPa", Vehicle.Tyres[0].PressureKpa));
        Check(Near(Vehicle.Tyres[1].PressureKpa, 220.0, 1e-9), "the neighbouring corner is untouched",
              Format("%.0f kPa", Vehicle.Tyres[1].PressureKpa));
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PIT STOP LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

void CheckPitStop()
{
    std::printf("\n-- pit stop --\n");
    VehicleRecord Vehicle;
    Vehicle.Tyres[0].PressureKpa  = 238.0;
    Vehicle.Tyres[0].TreadCelsius = 96.0;
    Vehicle.Tyres[0].WearPercent  = 41.0;

    Check(Vehicle.RemoveTyre(0, 15.0), "removing the front-left tyre succeeds");
    Check(!Vehicle.Tyres[0].Fitted, "the corner is no longer fitted");
    Check(Near(Vehicle.Tyres[0].PressureKpa, 0.0, 1e-9), "a hub with no tyre holds no pressure");
    Check(Near(Vehicle.Tyres[0].TreadCelsius, 20.0, 1e-9), "a removed tyre cools to ambient",
          Format("%.1f °C", Vehicle.Tyres[0].TreadCelsius));
    Check(Vehicle.QueryPitBayCount() == 1, "the removed tyre is kept in the pit bay");
    Check(Vehicle.QueryFittedTyreCount() == 3, "three tyres remain on the vehicle");
    Check(!Vehicle.RemoveTyre(0, 16.0), "removing a corner that has no tyre is refused");

    Check(Vehicle.FitTyre(0, 40.0), "refitting the corner succeeds");
    Check(Vehicle.Tyres[0].Fitted, "the corner is fitted again");
    Check(Near(Vehicle.Tyres[0].PressureKpa, 238.0, 1e-9), "refitting returns the used tyre's pressure",
          Format("%.0f kPa", Vehicle.Tyres[0].PressureKpa));
    Check(Near(Vehicle.Tyres[0].TreadCelsius, 96.0, 1e-9), "refitting returns the used tyre's temperature",
          Format("%.1f °C", Vehicle.Tyres[0].TreadCelsius));
    Check(Near(Vehicle.Tyres[0].WearPercent, 41.0, 1e-9), "refitting returns the used tyre's wear",
          Format("%.1f %%", Vehicle.Tyres[0].WearPercent));
    Check(Vehicle.QueryPitBayCount() == 0, "the pit bay slot is emptied by the refit");
    Check(!Vehicle.FitTyre(0, 41.0), "fitting a corner that already has a tyre is refused");

    // 📝 An empty bay for the corner means a fresh tyre at that axle's cold pressure.
    Check(Vehicle.RemoveTyre(2, 60.0), "removing a rear tyre succeeds");
    Vehicle.PitBay[0] = PitBayTyre{};   // Emptied deliberately: this is the "no used tyre for this corner" path.
    Vehicle.ApplyColdPressure(2, 215.0);
    Check(Vehicle.FitTyre(2, 61.0), "refitting with an empty bay succeeds");
    Check(Near(Vehicle.Tyres[2].PressureKpa, 215.0, 1e-9), "a fresh tyre takes the axle's cold pressure",
          Format("%.0f kPa", Vehicle.Tyres[2].PressureKpa));
    Check(Near(Vehicle.Tyres[2].WearPercent, 0.0, 1e-9), "a fresh tyre starts with no wear");

    // 📝 Pit-bay capacity: a full bay refuses removals rather than silently dropping a tyre.
    VehicleRecord FullBay;
    for (uint32_t Slot = 0; Slot < VehicleRecord::PitBayCapacity; ++Slot)
    {
        FullBay.PitBay[Slot].Occupied = true;
        FullBay.PitBay[Slot].CornerIndex = Slot % 4;
    }
    Check(!FullBay.RemoveTyre(1, 10.0), "a full pit bay refuses further removals");
    Check(FullBay.Tyres[1].Fitted, "the refused removal left the tyre on the vehicle");

    // 📝 RefitAll closes a pit stop in one call.
    VehicleRecord Service;
    Service.RemoveTyre(0, 5.0);
    Service.RemoveTyre(3, 6.0);
    Service.RefitAllTyres(30.0);
    Check(Service.QueryFittedTyreCount() == 4 && Service.QueryPitBayCount() == 0,
          "refit-all restores a full set and empties the bay");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        GRIP RULE
//------------------------------------------------------------------------------------------------------------------------

void CheckTyreGrip()
{
    std::printf("\n-- grip rule --\n");
    const double Optimum = 353.15, Fade = 473.15, Minimum = 0.60, Sensitivity = 0.30, CompoundGrip = 1.0;
    const double AtOptimum = EvaluateTyreGrip(Optimum, 220.0, 220.0, Optimum, Fade, Minimum, Sensitivity, CompoundGrip);
    const double AtFade = EvaluateTyreGrip(Fade, 220.0, 220.0, Optimum, Fade, Minimum, Sensitivity, CompoundGrip);
    const double OverPressure = EvaluateTyreGrip(Optimum, 264.0, 220.0, Optimum, Fade, Minimum, Sensitivity, CompoundGrip);
    const double WetCompound = EvaluateTyreGrip(Optimum, 220.0, 220.0, Optimum, Fade, Minimum, Sensitivity, 0.72);

    Check(Near(AtOptimum, 1.0, 1e-9), "optimum tread and cold pressure give full grip", Format("%.3f", AtOptimum));
    Check(Near(AtFade, 0.60, 1e-9), "the fade temperature reaches the minimum factor", Format("%.3f", AtFade));
    Check(Near(OverPressure, 0.94, 1e-9), "20 % over-pressure costs 6 % grip", Format("%.3f", OverPressure));
    Check(Near(WetCompound, 0.72, 1e-9), "the compound scale multiplies the thermal rule", Format("%.3f", WetCompound));

    std::printf("\n-- compounds --\n");
    size_t Count = 0;
    const TyreCompound *Compounds = QueryTyreCompounds(Count);
    Check(Count == 4, "four tyre compounds are offered", std::to_string(Count) + " compounds");
    bool PressuresSane = true;
    for (size_t Index = 0; Index < Count; ++Index)
    {
        PressuresSane = PressuresSane && Compounds[Index].ColdPressureKpa >= 150.0 && Compounds[Index].ColdPressureKpa <= 300.0;
    }
    Check(PressuresSane, "every compound's cold pressure is a plausible road/race value");
    Check(std::string(Compounds[1].Name) == "Semi-slick", "the authored default compound is the semi-slick");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     POWERTRAIN SHEET
//------------------------------------------------------------------------------------------------------------------------

void CheckPowertrainSheet()
{
    std::printf("\n-- powertrain sheet --\n");
    VehicleRecord Vehicle;
    Vehicle.Powertrain.RedlineRpm = 6800.0;
    Vehicle.Powertrain.IdleRpm = 850.0;
    Vehicle.Powertrain.WastegateCeiling = 1.6;
    Vehicle.Powertrain.EngineInertia = 0.42;
    Vehicle.AlignPowertrain();

    Check(Near(Vehicle.Engine.RedlineRPM, 6800.0, 1e-3), "the sheet's redline lands on the engine",
          Format("%.0f rpm", Vehicle.Engine.RedlineRPM));
    Check(Near(Vehicle.Engine.IdleRPM, 850.0, 1e-3), "the sheet's idle speed lands on the engine",
          Format("%.0f rpm", Vehicle.Engine.IdleRPM));
    Check(Near(Vehicle.Turbo.WastegateMaxBoost, 1.6, 1e-6), "the sheet's wastegate ceiling lands on the turbo",
          Format("%.2f bar", Vehicle.Turbo.WastegateMaxBoost));
    Check(Near(Vehicle.Engine.InvEngineInertia, 1.0 / 0.42, 1e-5), "the inverse inertia is recomputed, not copied",
          Format("%.4f", Vehicle.Engine.InvEngineInertia));

    // 📐 A lower redline moves the power band with it; the peak torque itself is a property of the curve.
    const double BandKw = Vehicle.QueryPeakPowerKwInBand();
    const double TorqueAt6800 = Vehicle.Engine.TorqueCurve.Sample(6800.0f) * 6800.0 * (2.0 * 3.14159265358979323846 / 60.0) / 1000.0;
    Check(Near(BandKw, TorqueAt6800, 1e-3), "the power band follows the edited redline", Format("%.2f kW", BandKw));
    Check(Near(Vehicle.QueryPeakTorqueNm(), 520.0, 1e-6), "peak torque is unchanged by the redline");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void CheckOutlinerProjection()
{
    std::printf("\n-- outliner projection --\n");
    VehicleRecord Vehicle;
    SceneDirectory::Instance().ConfigureName(Vehicle.Token(), "ControlVehicle");
    std::array<TyreRecord, VehicleRecord::CornerCount> TyreStorage = {
        TyreRecord(Vehicle, 0), TyreRecord(Vehicle, 1), TyreRecord(Vehicle, 2), TyreRecord(Vehicle, 3)};
    static const char *Labels[VehicleRecord::CornerCount] = {"Tyre · FL", "Tyre · FR", "Tyre · RL", "Tyre · RR"};
    for (uint32_t Corner = 0; Corner < VehicleRecord::CornerCount; ++Corner)
    {
        (void)SceneDirectory::Instance().ConfigureName(TyreStorage[Corner].Token(), Labels[Corner]);
        (void)SceneDirectory::Instance().ConfigureParent(TyreStorage[Corner].Token(), Vehicle.Token());
    }

    SceneDirectoryPanel Panel;
    Panel.Synchronize(SceneDirectory::Instance());
    int VehicleRows = 0;
    int TyreRows = 0;
    for (const SceneDirectoryRow &Row : Panel.QueryRows())
    {
        if (Row.Classification == RecordClassification::Vehicle) ++VehicleRows;
        if (Row.Classification == RecordClassification::Tyre) ++TyreRows;
    }
    Check(VehicleRows == 1, "the outliner projects one vehicle row", std::to_string(VehicleRows) + " rows");
    Check(TyreRows == 4, "the outliner projects four tyre rows", std::to_string(TyreRows) + " rows");

    Panel.Select(TyreStorage[0].Token());
    Panel.Synchronize(SceneDirectory::Instance());
    const SceneInspectorModel &Model = Panel.QueryInspectorModel();
    Check(Model.HasSelection, "selecting a tyre selects it in the inspector model");
    Check(Model.Name == "Tyre · FL", "the inspector model names the selected tyre", Model.Name);
    Check(Model.Group == "Vehicle", "the tyre's inspector group is the Vehicle group", Model.Group);
    Check(Model.ScalarFields.size() == 3, "the inspector model carries the tyre's three fields",
          std::to_string(Model.ScalarFields.size()) + " fields");
    Check(Model.HasEnabled && !Model.Enabled == !Vehicle.Tyres[0].Fitted,
          "the tyre's enabled pill mirrors its fitted state");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      STAGE RENDER
//------------------------------------------------------------------------------------------------------------------------

// 📝 A host CPU drawing of the plan view, from the record's own geometry: body outline from the measured envelope, one tyre
//    rectangle per fitted corner at its authored socket, and a dashed ring where a tyre has been removed. Same projection as
//    the prototype's stage canvas. Not a renderer output.
struct StageFrame
{
    uint32_t Width = 0, Height = 0;
    std::vector<std::array<double, 3>> Pixels;
    uint64_t Hash = 1469598103934665603ull;   // [-] - FNV-1a over the pixels
    uint32_t TyrePixels = 0;                  // [px] - Pixels belonging to a fitted tyre
    uint32_t SocketPixels = 0;                // [px] - Dashed ring pixels for a hub with no tyre
};

void Plot(StageFrame &Frame, int X, int Y, const std::array<double, 3> &Colour)
{
    if (X < 0 || Y < 0 || X >= static_cast<int>(Frame.Width) || Y >= static_cast<int>(Frame.Height)) return;
    Frame.Pixels[static_cast<size_t>(Y) * Frame.Width + static_cast<size_t>(X)] = Colour;
}

StageFrame RenderStage(const VehicleRecord &Vehicle, uint32_t Width, uint32_t Height)
{
    StageFrame Frame;
    Frame.Width = Width;
    Frame.Height = Height;
    Frame.Pixels.assign(static_cast<size_t>(Width) * Height, {0.043, 0.043, 0.043});

    const double ModelLength = std::max(Vehicle.QueryWheelbase() * 1.2f, Vehicle.QueryOverallLength());
    const double ModelWidth  = std::max(Vehicle.Geometry.TrackFront * 0.9f, Vehicle.QueryOverallWidth());
    const double Scale = std::min((Width * 0.7) / ModelLength, (Height * 0.66) / (ModelWidth * 1.4));
    const double CentreX = Width * 0.5;
    const double CentreY = Height * 0.54;

    // 📝 Body: the measured envelope, drawn as a filled wedge outline in the vehicle accent at low alpha.
    const double HalfLength = (ModelLength / 2.0) * Scale;
    const double HalfWidth  = (ModelWidth / 2.0) * Scale;
    const std::array<double, 3> BodyFill{0.088, 0.083, 0.040};
    const std::array<double, 3> BodyEdge{0.88, 0.82, 0.29};
    const std::array<double, 3> TyreFill{0.13, 0.15, 0.20};
    const std::array<double, 3> TyreEdge{0.88, 0.82, 0.29};
    const std::array<double, 3> SocketEdge{0.29, 0.29, 0.29};
    for (int Y = 0; Y < static_cast<int>(Height); ++Y)
    {
        for (int X = 0; X < static_cast<int>(Width); ++X)
        {
            const double Dx = (X - CentreX) / HalfLength;
            const double Dy = (Y - CentreY) / HalfWidth;
            // A tapered nose and tail: |Dx| beyond 0.72 narrows the allowed |Dy| linearly to 0.42.
            const double Narrowing = std::fabs(Dx) > 0.72 ? 1.0 - (std::fabs(Dx) - 0.72) * (1.0 - 0.42) / 0.28 : 1.0;
            if (std::fabs(Dx) <= 1.0 && std::fabs(Dy) <= Narrowing)
            {
                const bool Edge = std::fabs(Dx) > 0.97 || std::fabs(Dy) > Narrowing * 0.95;
                Plot(Frame, X, Y, Edge ? BodyEdge : BodyFill);
            }
        }
    }

    // 📝 Tyres at their authored sockets: fore-aft along the body's long axis, a 2 px rim when fitted, a dashed hub ring
    //    when the tyre has been removed. The rect is a rounded rectangle of the tyre's own radius and width, so a geometry
    //    edit moves it — the frame is drawn from the record, not stamped from a bitmap.
    const double HalfLengthPx = Vehicle.Geometry.TyreRadius * Scale;
    const double HalfWidthPx  = Vehicle.Geometry.TyreWidth * 0.5 * Scale;
    const double CornerPx     = std::min(HalfLengthPx, HalfWidthPx) * 0.45;
    for (uint32_t Corner = 0; Corner < VehicleRecord::CornerCount; ++Corner)
    {
        const Vehicle::Vec3 *Sockets[VehicleRecord::CornerCount] = {
            &Vehicle::ControlVehicleSockets::AxleMount_FL, &Vehicle::ControlVehicleSockets::AxleMount_FR,
            &Vehicle::ControlVehicleSockets::AxleMount_RL, &Vehicle::ControlVehicleSockets::AxleMount_RR};
        const double Px = CentreX + static_cast<double>(Sockets[Corner]->x) * Scale;
        const double Py = CentreY - static_cast<double>(Sockets[Corner]->y) * Scale;
        const bool Fitted = Vehicle.Tyres[Corner].Fitted;

        for (int Y = static_cast<int>(Py - HalfWidthPx) - 1; Y <= static_cast<int>(Py + HalfWidthPx) + 1; ++Y)
        {
            for (int X = static_cast<int>(Px - HalfLengthPx) - 1; X <= static_cast<int>(Px + HalfLengthPx) + 1; ++X)
            {
                // Rounded rectangle: the straight bands are half-extent minus the corner radius, the quadrants are circular.
                const double Dx = std::fabs(X - Px) - (HalfLengthPx - CornerPx);
                const double Dy = std::fabs(Y - Py) - (HalfWidthPx - CornerPx);
                const bool OutsideCorner = Dx > 0.0 && Dy > 0.0 && (Dx * Dx + Dy * Dy) > CornerPx * CornerPx;
                const bool Inside = (std::fabs(X - Px) <= HalfLengthPx) && (std::fabs(Y - Py) <= HalfWidthPx) && !OutsideCorner;
                if (!Inside) continue;

                const bool Rim = std::fabs(X - Px) >= HalfLengthPx - 2.0 || std::fabs(Y - Py) >= HalfWidthPx - 1.5;
                if (Fitted)
                {
                    Plot(Frame, X, Y, Rim ? TyreEdge : TyreFill);
                    ++Frame.TyrePixels;
                }
                else if (Rim)
                {
                    // 📝 A 3 px on / 3 px off dash around the hub, so "no tyre here" reads differently from a black tyre.
                    const int Along = static_cast<int>(std::fabs(Y - Py) > HalfWidthPx - 1.5 ? X - Px : Y - Py);
                    if (((Along % 6) + 6) % 6 < 3)
                    {
                        Plot(Frame, X, Y, SocketEdge);
                        ++Frame.SocketPixels;
                    }
                }
            }
        }
    }

    for (const std::array<double, 3> &Pixel : Frame.Pixels)
    {
        for (const double Channel : Pixel)
        {
            const uint8_t Quantized = static_cast<uint8_t>(std::min(255.0, std::max(0.0, Channel * 255.0)));
            Frame.Hash ^= Quantized;
            Frame.Hash *= 1099511628211ull;
        }
    }
    return Frame;
}

void WritePpm(const StageFrame &Frame, const char *Path)
{
    std::FILE *File = std::fopen(Path, "wb");
    if (File == nullptr) return;
    std::fprintf(File, "P6\n%u %u\n255\n", Frame.Width, Frame.Height);
    for (const std::array<double, 3> &Pixel : Frame.Pixels)
    {
        const uint8_t Bytes[3] = {static_cast<uint8_t>(std::min(255.0, std::max(0.0, Pixel[0] * 255.0))),
                                  static_cast<uint8_t>(std::min(255.0, std::max(0.0, Pixel[1] * 255.0))),
                                  static_cast<uint8_t>(std::min(255.0, std::max(0.0, Pixel[2] * 255.0)))};
        std::fwrite(Bytes, 1, 3, File);
    }
    std::fclose(File);
}

void CheckStage(const char *OutputPath)
{
    std::printf("\n-- stage render --\n");
    VehicleRecord Vehicle;
    const uint32_t Width = 640, Height = 400;
    const StageFrame Fitted = RenderStage(Vehicle, Width, Height);
    Check(Fitted.TyrePixels > 2000, "four fitted tyres cover a plausible number of pixels",
          std::to_string(Fitted.TyrePixels) + " tyre px");
    Check(Fitted.SocketPixels == 0, "a fully fitted vehicle draws no socket rings");

    Vehicle.RemoveTyre(0, 8.0);
    Vehicle.RemoveTyre(3, 9.0);
    const StageFrame Removed = RenderStage(Vehicle, Width, Height);
    Check(Removed.SocketPixels > 100, "removed tyres leave dashed socket rings",
          std::to_string(Removed.SocketPixels) + " socket px");
    Check(Removed.TyrePixels < Fitted.TyrePixels, "removing tyres paints fewer tyre pixels",
          std::to_string(Fitted.TyrePixels) + " -> " + std::to_string(Removed.TyrePixels));
    Check(Removed.Hash != Fitted.Hash, "the frame changes when a tyre comes off");

    // 📐 A wider track moves the tyres and therefore the frame: the stage reads the record, it does not draw a bitmap.
    Vehicle.Geometry.TrackFront *= 1.15f;
    const StageFrame Widened = RenderStage(Vehicle, Width, Height);
    Check(Widened.Hash != Removed.Hash, "a geometry edit changes the drawn frame");
    Vehicle.Geometry.TrackFront /= 1.15f;

    Vehicle.RefitAllTyres(40.0);
    const StageFrame Refitted = RenderStage(Vehicle, Width, Height);
    Check(Refitted.Hash == Fitted.Hash, "refitting every tyre restores the original frame exactly");

    WritePpm(Fitted, OutputPath);
    std::printf("      frame written to %s (640x400, host CPU plan view)\n", OutputPath);
    std::printf("      hash %016llx fitted / %016llx removed\n",
                static_cast<unsigned long long>(Fitted.Hash), static_cast<unsigned long long>(Removed.Hash));
}

} // namespace

int main(int ArgumentCount, char **Arguments)
{
    const char *OutputPath = ArgumentCount > 1 ? Arguments[1] : "VehicleStage.ppm";
    std::printf("Vehicle and tyre records, editor descriptions, pit-stop lifecycle and the plan-view stage\n");
    CheckRecords();
    CheckTyreRecords();
    CheckEditorDescriptions();
    CheckPitStop();
    CheckTyreGrip();
    CheckPowertrainSheet();
    CheckOutlinerProjection();
    CheckStage(OutputPath);
    std::printf("\n%s (%d failure%s)\n", Failures == 0 ? "ALL CHECKS PASSED" : "CHECKS FAILED",
                Failures, Failures == 1 ? "" : "s");
    return Failures == 0 ? 0 : 1;
}
