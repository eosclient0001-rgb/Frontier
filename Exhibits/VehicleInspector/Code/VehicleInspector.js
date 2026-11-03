//============================================================================================================================================
//                                                         VEHICLEINSPECTOR.JS
//============================================================================================================================================
// 🧩 The prototype host: outliner, vehicle inspector cards, per-tyre editor and the schematic stage, all bound to one specification.

// 📝 Structure follows the editor it must port into:
//      • one specification object (VehicleSpecification.js) — the scene record's live settings;
//      • the inspector is rebuilt from the specification whenever the selection or a reading changes, and every control
//        writes back into that same object, so there is no widget-side copy of the scene to fall out of step;
//      • cards are built by small builders (BuildIdentityCard, BuildPowertrainCard, …) rather than one long template,
//        because the C++ host will grow one record-description builder per card.
//
//    Units: every numeric control carries its unit in the number field, and every reading in a stat cell is colour-coded
//    by its unit class (see UnitClassByUnit). The unit system toggle re-labels the readings; the stored values stay SI.

import { GlyphMarkup as ConstructGlyph } from './GlyphMarkup.js';
import {
    ConstructVehicleSpecification, CurveFields, CurvePresets, TyreCompounds, LoadPreset, LoadAllAuthors,
    SampleCurve, PeakOfCurve, UnitSystems
} from './VehicleSpecification.js';
import {
    AddCurveKey, MoveCurveKey, RemoveCurveKey, RemoveTyre, FitTyre, RefitAllTyres, QueryCorner,
    EvaluateTyreGrip, EvaluateVehicleReadings, EvaluateTorqueCurve, EvaluateCurveMean,
    ConstructReading, FormatReading
} from './InspectorModel.js';
import { CurveInstrument } from './CurveInstrument.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const Accent = Object.freeze({
    Render: '#9fb4d6',
    Environment: '#e8c27a',
    Forcefield: '#a7f3d0',
    Objects: '#c7b8e8',
    Vehicle: '#e1d34a',
    Effects: '#e8833a',
    Destruction: '#8fb3a4',
    Level: '#a8bbeb',
    Tyre: '#d9c46a'
});

// 📝 HTML group order, transcribed from EditorShell.js GroupOrder at 6afb6f0 by way of the native SceneDirectoryPanel.
const GroupOrder = ['Render', 'Environment', 'Forcefield', 'Objects', 'Vehicle', 'Effects', 'Destruction', 'Level'];

const KelvinOffset = 273.15;   // [K] - 0 °C

// 📝 Outliner rows: only the vehicle slice is live in this prototype. The other rows exist so the vehicle stands in the
//    same tree as the environment records the editor already implements, and so a selection change has somewhere to go.
function ConstructOutlinerRows(Specification)
{
    return [
        { Id: 'render',   Group: 'Render',      Name: 'Render settings', Type: 'Renderer', Glyph: 'Monitor', Colour: Accent.Render, Meta: 'Editor', Selectable: false },
        { Id: 'sun',      Group: 'Environment', Name: 'Sun', Type: 'Directional light', Glyph: 'Sun', Colour: Accent.Environment, Meta: '38°', Selectable: false },
        { Id: 'atmos',    Group: 'Environment', Name: 'Atmosphere', Type: 'Environment', Glyph: 'CloudFog', Colour: Accent.Environment, Meta: 'Rayleigh', Selectable: false },
        { Id: 'wind',     Group: 'Forcefield',  Name: 'Wind', Type: 'ForceField', Glyph: 'Wind', Colour: Accent.Forcefield, Meta: '7 m/s', Selectable: false },
        { Id: 'track',    Group: 'Objects',     Name: 'Proving ground', Type: 'Level geometry', Glyph: 'Map', Colour: Accent.Objects, Meta: '43 m', Selectable: false },
        { Id: 'vehicle',  Group: 'Vehicle',     Name: 'ControlVehicle', Type: 'Vehicle', Glyph: 'Car', Colour: Accent.Vehicle,
          Meta: () => `${Specification.Corners.filter((Corner) => Corner.Fitted).length}/4 tyres`, Selectable: true },
        { Id: 'tyre-FL',  Group: 'Vehicle',     Name: 'Tyre · FL', Type: 'Tyre', Glyph: 'CircleDot', Colour: Accent.Tyre, Nested: true, Corner: 'FL',
          Meta: () => RowTyreMeta(Specification, 'FL'), Selectable: true },
        { Id: 'tyre-FR',  Group: 'Vehicle',     Name: 'Tyre · FR', Type: 'Tyre', Glyph: 'CircleDot', Colour: Accent.Tyre, Nested: true, Corner: 'FR',
          Meta: () => RowTyreMeta(Specification, 'FR'), Selectable: true },
        { Id: 'tyre-RL',  Group: 'Vehicle',     Name: 'Tyre · RL', Type: 'Tyre', Glyph: 'CircleDot', Colour: Accent.Tyre, Nested: true, Corner: 'RL',
          Meta: () => RowTyreMeta(Specification, 'RL'), Selectable: true },
        { Id: 'tyre-RR',  Group: 'Vehicle',     Name: 'Tyre · RR', Type: 'Tyre', Glyph: 'CircleDot', Colour: Accent.Tyre, Nested: true, Corner: 'RR',
          Meta: () => RowTyreMeta(Specification, 'RR'), Selectable: true },
        { Id: 'marks',    Group: 'Vehicle',     Name: 'Tyre marks', Type: 'Rubber deposit', Glyph: 'Route', Colour: Accent.Vehicle, Nested: true, Meta: '0 m', Selectable: false },
        { Id: 'smoke',    Group: 'Effects',     Name: 'Smoke & fire', Type: 'Gas domain', Glyph: 'Flame', Colour: Accent.Effects, Meta: 'idle', Selectable: false },
        { Id: 'fracture', Group: 'Destruction', Name: 'Fracture', Type: 'Breakable props', Glyph: 'Hammer', Colour: Accent.Destruction, Meta: '4/4', Selectable: false },
        { Id: 'cam',      Group: 'Level',       Name: 'Chase camera', Type: 'Camera rig', Glyph: 'Camera', Colour: Accent.Level, Meta: 'Orbit', Selectable: false }
    ];
}

function RowTyreMeta(Specification, CornerKey)
{
    const Corner = QueryCorner(Specification, CornerKey);
    if (!Corner) return '';
    if (!Corner.Fitted) return 'no tyre';
    return `${Math.round(Corner.PressureKpa)} kPa`;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          HOST
//------------------------------------------------------------------------------------------------------------------------

class VehicleInspectorHost
{
    constructor()
    {
        this.Specification = ConstructVehicleSpecification();
        LoadAllAuthors(this.Specification);

        this.UnitSystem = UnitSystems.SI;
        this.SelectedId = 'vehicle';
        this.CurveFieldKey = 'Torque';
        this.CurveIndex = 0;
        this.CurvePresetName = Object.keys(CurvePresets.Torque)[0];
        this.CurveInstrument = null;
        this.ClockSeconds = 0;
        this.StageTimeSeconds = 0;
        this.Notice = '';
        this.OutlinerFilter = '';
        this.LastRebuild = 0;

        this.CacheDom();
        this.BindChrome();
        this.PaintOutliner();
        this.RebuildInspector();
        this.StartStage();
        this.StartClock();
    }

    // -- DOM ---------------------------------------------------------------------------------------------------------------

    CacheDom()
    {
        this.OutlinerBody = document.getElementById('outliner-body');
        this.InspectorContent = document.getElementById('inspector-content');
        this.InspectorCrumbs = document.getElementById('inspector-top');
        this.StageCanvas = document.getElementById('vehicle-stage');
        this.HudText = document.getElementById('hud-text');
        this.StatusClock = document.getElementById('status-clock');
        this.StatusSelection = document.getElementById('status-selection');
        this.StatusNotice = document.getElementById('status-notice');
    }

    BindChrome()
    {
        const Search = document.getElementById('outliner-search');
        if (Search)
        {
            Search.addEventListener('input', () =>
            {
                this.OutlinerFilter = Search.value.trim().toLowerCase();
                this.PaintOutliner();
            });
        }
        document.addEventListener('keydown', (Event) =>
        {
            // 📝 Delete removes the selected curve key, but only while the plot owns the pointer: deleting a key from a
            //    numeric field elsewhere in the panel would be an unpleasant surprise.
            if ((Event.key === 'Delete' || Event.key === 'Backspace') && this.CurveInstrument
                && this.CurveInstrument.SelectedIndex >= 0 && document.activeElement === this.CurveInstrument.Canvas)
            {
                const FieldKey = this.CurveFieldKey;
                const Removed = RemoveCurveKey(this.Specification.Curves[FieldKey], this.CurveInstrument.SelectedIndex);
                if (Removed)
                {
                    this.CurveIndex = Math.max(0, this.CurveInstrument.SelectedIndex - 1);
                    this.RebuildInspector();
                }
                Event.preventDefault();
            }
        });
    }

    // -- Outliner ----------------------------------------------------------------------------------------------------------

    PaintOutliner()
    {
        const Rows = ConstructOutlinerRows(this.Specification);
        const Matches = (Row) => this.OutlinerFilter === ''
            || Row.Name.toLowerCase().includes(this.OutlinerFilter)
            || Row.Type.toLowerCase().includes(this.OutlinerFilter);
        const VisibleRows = Rows.filter(Matches);
        const EnabledTile = document.getElementById('enabled-count');
        const DisabledTile = document.getElementById('disabled-count');
        if (EnabledTile) EnabledTile.textContent = String(this.Specification.Corners.filter((Corner) => Corner.Fitted).length + 3);
        if (DisabledTile) DisabledTile.textContent = String(this.Specification.Corners.filter((Corner) => !Corner.Fitted).length);

        const Html = [];
        for (const Group of GroupOrder)
        {
            const Members = VisibleRows.filter((Row) => Row.Group === Group);
            if (Members.length === 0) continue;
            Html.push(`<div class="group"><div class="group-label">${Group}<span class="group-count">${Members.length}</span></div>`);
            for (const Row of Members)
            {
                const Selected = Row.Id === this.SelectedId ? ' selected' : '';
                const Nested = Row.Nested ? ' nested' : '';
                const IsTyre = Row.Corner ? QueryCorner(this.Specification, Row.Corner) : null;
                const Off = IsTyre && !IsTyre.Fitted ? ' is-off' : '';
                const Meta = typeof Row.Meta === 'function' ? Row.Meta() : Row.Meta;
                const State = IsTyre ? (IsTyre.Fitted ? 'live' : '') : (Row.Selectable ? 'live' : '');
                Html.push(
                    `<div class="tree-row${Selected}${Nested}${Off}" data-row="${Row.Id}" data-selectable="${Row.Selectable ? 1 : 0}"
                          style="--entity-colour:${Row.Colour}">
                        <button class="object-button" data-row="${Row.Id}" data-selectable="${Row.Selectable ? 1 : 0}">
                            <span class="glyph">${ConstructGlyph(Row.Glyph, 15)}</span>
                            <span class="row-name">${Row.Name}</span>
                            <span class="row-meta">${Meta || ''}</span>
                        </button>
                        <span class="row-state ${State}"></span>
                    </div>`);
            }
            Html.push('</div>');
        }
        this.OutlinerBody.querySelector('#outliner-tree').innerHTML = Html.join('');

        for (const Button of this.OutlinerBody.querySelectorAll('[data-row]'))
        {
            Button.addEventListener('click', () =>
            {
                const RowId = Button.getAttribute('data-row');
                if (Button.getAttribute('data-selectable') !== '1') return;
                this.SelectedId = RowId;
                this.PaintOutliner();
                this.RebuildInspector();
                this.PaintStage();
            });
        }
    }

    // -- Inspector ---------------------------------------------------------------------------------------------------------

    RebuildInspector()
    {
        const Row = ConstructOutlinerRows(this.Specification).find((Candidate) => Candidate.Id === this.SelectedId);
        const Group = Row ? Row.Group : 'Vehicle';
        const Title = Row ? Row.Name : 'Nothing selected';
        this.InspectorCrumbs.innerHTML =
            `<div class="crumbs"><span>Inspector</span><span>›</span>${Group}<span>›</span>${Title}</div>
             <div class="save-status"><span class="status-dot"></span>Changes apply live</div>`;

        const Html = [];
        if (!Row)
        {
            Html.push('<div class="empty-state">Select the vehicle or one of its tyres in the Outliner.</div>');
        }
        else if (this.SelectedId === 'vehicle')
        {
            Html.push(this.BuildVehicleInspector());
        }
        else if (Row.Corner)
        {
            Html.push(this.BuildTyreInspector(Row.Corner));
        }
        this.InspectorContent.innerHTML = Html.join('');
        this.WireInspector();
        this.LastRebuild = performance.now();
    }

    // 📝 Unit toggle + card frame shared by every card, so the unit system and the accent are applied once.
    UnitToggle()
    {
        const SI = this.UnitSystem === UnitSystems.SI ? ' active' : '';
        const Imperial = this.UnitSystem === UnitSystems.Imperial ? ' active' : '';
        return `<div class="segmented" data-units="1">
                    <button data-unit-system="${UnitSystems.SI}" class="${SI}">SI · Nm · kg · kPa</button>
                    <button data-unit-system="${UnitSystems.Imperial}" class="${Imperial}">Imperial · lb-ft · lb · psi</button>
                </div>`;
    }

    Card(Heading, Glyph, Index, Body, AccentColour, Subtitle)
    {
        return `<section class="card" style="--card-accent:${AccentColour}">
                    <div class="card-heading">
                        <span><span class="glyph">${ConstructGlyph(Glyph, 15)}</span>${Heading}</span>
                        <span class="card-index">${Index}</span>
                    </div>
                    ${Subtitle ? `<div class="card-subtitle">${Subtitle}</div>` : ''}
                    ${Body}
                </section>`;
    }

    // 📝 A stat cell: label, value and unit. The unit is in its own <small> so its colour token applies, and the value
    //    takes the unit's colour class unless the caller flags a warm/fail reading.
    StatCell(Label, Value, Unit, ExtraClass)
    {
        const Presented = this.Present(Value, Unit);
        const Class = ExtraClass || Presented.Class;
        return `<div><span>${Label}</span><strong class="${Class}">${Presented.Text}<small>${Presented.Unit}</small></strong></div>`;
    }

    Present(Value, Unit)
    {
        const Reading = ConstructReading('', Value, Unit, this.UnitSystem);
        const Digits = this.DigitsFor(Reading.PresentUnit);
        return { Text: FormatReading(Reading, Digits).replace(` ${Reading.PresentUnit}`, ''), Unit: Reading.PresentUnit,
                 Class: Reading.UnitClass };
    }

    DigitsFor(Unit)
    {
        switch (Unit)
        {
            case 'kg': case 'lb': case 'm': case 'ft': return 2;
            case 'in': case 'psi': case '%': case 'x': case '-': return 0;
            case 'bar': return 2;
            case 'K': case '°C': case '°F': return 0;
            case 'kW': case 'hp': return 0;
            default: return 1;
        }
    }

    BuildVehicleInspector()
    {
        const Specification = this.Specification;
        const Body = Specification.Body;
        const Powertrain = Specification.Powertrain;
        const Readings = EvaluateVehicleReadings(Specification);
        const Switches = [
            { Name: 'Body', Glyph: 'Car', On: Body.Enabled, Key: 'Body' },
            { Name: 'Powertrain', Glyph: 'Gauge', On: Powertrain.Enabled, Key: 'Powertrain' },
            { Name: 'Tyre set', Glyph: 'CircleDot', On: Specification.TyreSet.Enabled, Key: 'TyreSet' },
            { Name: 'Suspension', Glyph: 'Activity', On: Specification.Suspension.Enabled, Key: 'Suspension' }
        ];
        const SwitchHtml = Switches.map((Entry) =>
            `<button class="property-switch ${Entry.On ? '' : 'is-off'}" data-switch="${Entry.Key}">
                <span class="switch-icon">${ConstructGlyph(Entry.Glyph, 16)}</span>
                <span class="switch-name">${Entry.Name}</span>
                <span class="switch-state">${Entry.On ? 'ON' : 'OFF'}</span>
             </button>`).join('');

        const Header = `
            <div class="eyebrow">Vehicle · ${Specification.Identity.BodyCategory}</div>
            <div class="object-header">
                <h1>${Specification.Identity.Name}</h1>
                <div class="object-actions"><button class="reset-button" data-action="refit-all">${ConstructGlyph('RotateCcw', 13)} Refit tyres</button></div>
            </div>
            <div class="object-description">${Specification.Identity.AuthoredAsset} — sockets, mass, powertrain and tyre tables read from the engine sources, editable here.</div>
            <div class="property-switches">${SwitchHtml}</div>
            <div style="margin-bottom:12px">${this.UnitToggle()}</div>`;

        return Header + `<div class="cards">${[
            this.BuildIdentityCard(Readings),
            this.BuildBodyCard(Readings),
            this.BuildPowertrainCard(Readings),
            this.BuildPerformanceCard(Readings),
            this.BuildTyreSetCard(Readings),
            this.BuildSuspensionCard(),
            this.BuildCurveCard(),
            this.BuildAuditCard(Readings)
        ].join('')}</div>`;
    }

    BuildIdentityCard(Readings)
    {
        const Identity = this.Specification.Identity;
        const Body = this.Specification.Body;
        const Body_ = `
            <div class="metric-row">
                <div class="metric">${Body.MassKg}<small>${this.Present(Body.MassKg, 'kg').Unit}</small></div>
                <span class="small-pill live">${Readings.FittedTyres}/4 tyres fitted</span>
            </div>
            <div class="stats">
                ${this.StatCell('Wheelbase', Body.WheelbaseM, 'm')}
                ${this.StatCell('Track front', Body.TrackFrontM, 'm')}
                ${this.StatCell('Overall length', Body.OverallLengthM, 'm')}
            </div>
            <p class="muted">${Identity.Source}. Sockets are read from the authored asset, not estimated; the wheel positions below
            are those four sockets, so a tyre can be taken off without moving the hub it bolts to.</p>`;
        return this.Card('Identity & body', 'Car', '01', Body_, Accent.Vehicle, 'Authored asset · measured sockets');
    }

    // 📝 Body card: the bindable dimensions as slider+number rows (each with a unit) and the derived readings as stats.
    BuildBodyCard(Readings)
    {
        const Body = this.Specification.Body;
        const Rows = [
            this.ControlRow('Mass', 'mass-1', Body.MassKg, 'kg', 600, 2200, 10, 0),
            this.ControlRow('Centre of mass height', 'com-1', Body.CoMHeightM, 'm', 0.2, 1.0, 0.01, 2),
            this.ControlRow('Wheelbase', 'wheelbase-1', Body.WheelbaseM, 'm', 1.5, 5.0, 0.001, 3),
            this.ControlRow('Track front', 'trackf-1', Body.TrackFrontM, 'm', 1.0, 2.5, 0.001, 3),
            this.ControlRow('Track rear', 'trackr-1', Body.TrackRearM, 'm', 1.0, 2.5, 0.001, 3),
            this.ControlRow('Ride height', 'ride-1', Body.StaticRideHeightM, 'm', 0.02, 0.30, 0.005, 3),
            this.ControlRow('Front weight', 'bias-1', Body.FrontWeightFraction * 100, '%', 30, 70, 0.1, 1),
            this.ControlRow('Downforce scale', 'df-1', Body.DownforceScale, 'x', 0, 2.5, 0.05, 2)
        ].join('');
        const Stats = `<div class="stats four">
                ${this.StatCell('Sprung mass', Readings.SprungMassKg, 'kg')}
                ${this.StatCell('Unsprung', Readings.UnsprungMassKg, 'kg')}
                ${this.StatCell('Front load', Readings.FrontLoadN / 9.81, 'kg')}
                ${this.StatCell('Rollover', Readings.RolloverThresholdG, 'g')}
            </div>`;
        return this.Card('Body & mass', 'Box', '02', Rows + Stats, Accent.Vehicle, 'Bound to VehicleGeometry');
    }

    BuildPowertrainCard(Readings)
    {
        const Powertrain = this.Specification.Powertrain;
        const Ratios = Powertrain.GearRatios.map((Ratio, Index) =>
            `<div><span>${Index + 1}${['st', 'nd', 'rd'][Index] || 'th'} gear</span><strong class="unit-fraction">${Ratio.toFixed(2)}<small>x</small></strong></div>`).join('');
        const Rows = [
            this.ControlRow('Idle speed', 'idle-1', Powertrain.IdleRpm, 'rpm', 400, 1500, 10, 0),
            this.ControlRow('Redline', 'redline-1', Powertrain.RedlineRpm, 'rpm', 3000, 10000, 50, 0),
            this.ControlRow('Wastegate ceiling', 'waste-1', Powertrain.WastegateMaxBar, 'bar', 0.2, 2.5, 0.05, 2),
            this.ControlRow('Final drive', 'final-1', Powertrain.FinalDriveRatio, 'x', 2.0, 5.0, 0.01, 2),
            this.ControlRow('Launch speed target', 'launch-1', Powertrain.LaunchRpm, 'rpm', 800, 6000, 50, 0)
        ].join('');
        const Torque = EvaluateTorqueCurve(this.Specification.Curves.Torque, this.Specification.Powertrain.RedlineRpm);
        const Stats = `<div class="stats">
                ${this.StatCell('Peak torque', Torque.PeakTorqueNm, 'Nm')}
                ${this.StatCell('at', Torque.PeakTorqueRpm, 'rpm')}
                ${this.StatCell('Peak power', Torque.PeakPowerKw, 'kW')}
            </div>
            <div class="stats">
                ${this.StatCell('Turbine eff.', Powertrain.TurbineEfficiency * 100, '%')}
                ${this.StatCell('Compressor eff.', Powertrain.CompressorEfficiency * 100, '%')}
                ${this.StatCell('Engine inertia', Powertrain.EngineInertiaKgm2, 'kg·m²')}
            </div>
            <div class="corner-grid">${Ratios}</div>`;
        return this.Card('Powertrain', 'Gauge', '03', Rows + Stats, Accent.Vehicle, 'Drivetrain.h · DefaultGTR');
    }

    BuildPerformanceCard(Readings)
    {
        const Body = `
            <div class="metric-row">
                <div class="metric">${Readings.WheelTorqueFirstGearNm.toFixed(0)}<small>Nm at the wheel</small></div>
                <span class="small-pill warm">1st gear · peak torque</span>
            </div>
            <div class="stats">
                ${this.StatCell('Specific power', Readings.SpecificPowerKwPerTonne, 'kW')}
                ${this.StatCell('Yaw inertia', Readings.YawInertiaKgm2, 'kg·m²')}
                ${this.StatCell('Rollover limit', Readings.RolloverThresholdG, 'g')}
            </div>
            <p class="muted">Derived, never typed: wheel torque is the edited torque curve's peak × first gear × final drive, and
            specific power divides the same curve's peak power by the bound mass. Change a key and these move.</p>`;
        void Body;
        return this.Card('Performance (derived)', 'TrendingUp', '04', Body, Accent.Vehicle, 'Computed from the curve and the mass');
    }

    // 📝 Tyre set card: the four corners in one grid, each with its own state and a link into its own inspector, plus the
    //    compound, pressure and thermal rules that apply to all four.
    BuildTyreSetCard(Readings)
    {
        const Specification = this.Specification;
        const TyreSet = Specification.TyreSet;
        const Chips = Specification.Corners.map((Corner) =>
        {
            const Grip = Corner.Fitted ? EvaluateTyreGrip(Specification, Corner) : 0;
            const Wear = Math.round(Corner.WearFraction * 100);
            return `<button class="corner-chip ${Corner.Fitted ? '' : 'is-out'} ${this.SelectedId === `tyre-${Corner.Key}` ? 'active' : ''}"
                            data-open-tyre="${Corner.Key}">
                        <span class="corner-name">${Corner.Key}<span class="pin-disc ${Corner.Fitted ? '' : 'out'}"></span></span>
                        <span class="corner-value">${Corner.Fitted ? Math.round(Corner.PressureKpa) : '—'}<small>${Corner.Fitted ? 'kPa' : 'no tyre'}</small></span>
                        <span class="corner-name">${Corner.Fitted ? `${Math.round(Corner.SurfaceK - KelvinOffset)} °C` : 'in the bay'}</span>
                        <span class="corner-value">${Corner.Fitted ? (Grip * 100).toFixed(0) : '0'}<small>% grip</small></span>
                        <span class="corner-name">${Corner.Fitted ? `${Wear}% worn` : `${TyreCompounds[TyreSet.Compound].Label}`}</span>
                    </button>`;
        }).join('');

        const CompoundOptions = Object.entries(TyreCompounds).map(([Key, Compound]) =>
            `<option value="${Key}" ${Key === TyreSet.Compound ? 'selected' : ''}>${Compound.Label} — ${Compound.Note}</option>`).join('');

        const Body = `
            <div class="corner-grid" style="margin-top:0;padding-top:0;border-top:0">${Chips}</div>
            <div class="control" style="margin-top:14px">
                <div class="control-line"><span>Compound (all corners)</span></div>
                <select class="select-field" data-compound="1">${CompoundOptions}</select>
            </div>
            ${this.ControlRow('Front cold pressure', 'pressf-1', TyreSet.ColdPressureFrontKpa, 'kPa', 80, 400, 5, 0)}
            ${this.ControlRow('Rear cold pressure', 'pressr-1', TyreSet.ColdPressureRearKpa, 'kPa', 80, 400, 5, 0)}
            ${this.ControlRow('Radial stiffness', 'stiff-1', TyreSet.RadialStiffnessNm / 1000, 'kN/m', 100, 600, 5, 0)}
            <div class="switch-row"><div>Tread wear<div><small>Sliding work abrades the tread, faster when hot</small></div></div>
                <div class="toggle ${TyreSet.Wear ? 'on' : ''}" data-toggle="TyreSet.Wear"></div></div>
            <div class="switch-row"><div>Failure<div><small>Worn through, cooked or over-pressured tyres burst</small></div></div>
                <div class="toggle ${TyreSet.Failure ? 'on' : ''}" data-toggle="TyreSet.Failure"></div></div>
            <div class="stats">
                ${this.StatCell('Optimum tread', TyreSet.OptimumTemperatureK - KelvinOffset, '°C')}
                ${this.StatCell('Grip floor at', TyreSet.GripFadeTemperatureK - KelvinOffset, '°C')}
                ${this.StatCell('Minimum grip', TyreSet.MinimumGripFactor * 100, '%')}
            </div>
            <div class="stats">
                ${this.StatCell('Pressure sens.', TyreSet.PressureSensitivity * 100, '%')}
                ${this.StatCell('Tread mass', TyreSet.TreadMassKg, 'kg')}
                ${this.StatCell('Burst pressure', TyreSet.BurstPressureKpa, 'kPa')}
            </div>
            <p class="muted">${Readings.FittedTyres} of 4 tyres fitted · ${Readings.PitBayCount} in the pit bay ·
            ${Readings.FittedTreadMassKg.toFixed(2)} kg of tread on the vehicle. A tyre is parented to the vehicle and can be
            removed and replaced at a pit stop; removal keeps the used tyre, refitting returns it.</p>`;
        return this.Card('Tyre set', 'CircleDot', '05', Body, Accent.Vehicle, 'Volumetric tyre physics · pressure · wear · failure');
    }

    BuildSuspensionCard()
    {
        const Suspension = this.Specification.Suspension;
        const Rows = [
            this.ControlRow('Front ride frequency', 'fnf-1', Suspension.FrontNaturalFrequencyHz, 'Hz', 0.8, 4.0, 0.05, 2),
            this.ControlRow('Front damping ratio', 'zfn-1', Suspension.FrontDampingRatio, 'x', 0.1, 1.5, 0.05, 2),
            this.ControlRow('Rear ride frequency', 'fnr-1', Suspension.RearNaturalFrequencyHz, 'Hz', 0.8, 4.0, 0.05, 2),
            this.ControlRow('Rear damping ratio', 'zrn-1', Suspension.RearDampingRatio, 'x', 0.1, 1.5, 0.05, 2),
            this.ControlRow('Bump travel', 'bump-1', Suspension.BumpTravelM * 1000, 'mm', 5, 60, 1, 0),
            this.ControlRow('Droop travel', 'droop-1', Suspension.DroopTravelM * 1000, 'mm', 10, 150, 1, 0),
            this.ControlRow('Front bar stiffness', 'barf-1', Suspension.FrontBarStiffnessNm / 1000, 'kN/m', 10, 200, 5, 0),
            this.ControlRow('Rear bar stiffness', 'barr-1', Suspension.RearBarStiffnessNm / 1000, 'kN/m', 10, 200, 5, 0)
        ].join('');
        const Stats = `<div class="stats">
                ${this.StatCell('Preload', Suspension.PreloadN, 'N')}
                ${this.StatCell('Max travel', Suspension.MaxTravelM * 1000, 'mm')}
                ${this.StatCell('Bar damping', Suspension.BarDampingNs, 'N·s/m')}
            </div>
            <p class="muted">Ride frequency and damping ratio set the spring rate for the sprung mass each corner carries, as
            SuspensionSpecification::Calibrate does; the bar stiffnesses are the anti-roll bars' N/m.</p>`;
        return this.Card('Suspension', 'Activity', '06', Rows + Stats, Accent.Vehicle, 'SuspensionSpecification.h');
    }

    // 📝 The curve card: field selector, preset selector, the instrument, the readout and the selected key's numeric fields.
    BuildCurveCard()
    {
        const FieldKey = this.CurveFieldKey;
        const Field = CurveFields[FieldKey];
        const Points = this.Specification.Curves[FieldKey];
        const Presets = CurvePresets[FieldKey] || {};
        const FieldOptions = Object.entries(CurveFields).map(([Key, Entry]) =>
            `<option value="${Key}" ${Key === FieldKey ? 'selected' : ''}>${Entry.Label}</option>`).join('');
        const PresetOptions = Object.keys(Presets).map((Name) =>
            `<option value="${Name}" ${Name === this.CurvePresetName ? 'selected' : ''}>${Name}</option>`).join('');
        const Peak = PeakOfCurve(Points);
        const Mean = EvaluateCurveMean(Points);
        const Total = EvaluateTorqueCurve(this.Specification.Curves.Torque, this.Specification.Powertrain.RedlineRpm);
        const Selected = Points[this.CurveIndex] || [0, 0];

        const Body = `
            <div class="curve-toolbar">
                <select class="curve-field-select" data-curve-field="1">${FieldOptions}</select>
                <select class="curve-field-select" data-curve-preset="1">${PresetOptions}</select>
            </div>
            <div class="curve-instrument">
                <canvas class="curve-plot" id="curve-plot"></canvas>
            </div>
            <div class="curve-key-row">
                <div class="number-field"><input type="text" inputmode="decimal" data-key-x="1" value="${Selected[0].toFixed(Field.XPrecision)}"><small class="unit-rate">${Field.XUnit}</small></div>
                <div class="number-field"><input type="text" inputmode="decimal" data-key-y="1" value="${Selected[1].toFixed(Field.YPrecision)}"><small>${Field.YUnit}</small></div>
            </div>
            <div class="curve-readout">
                <div><span>Peak</span><strong>${Peak.Y.toFixed(Field.YPrecision)}<small>${Field.YUnit}</small></strong></div>
                <div><span>at</span><strong>${Peak.X.toFixed(Field.XPrecision)}<small>${Field.XUnit}</small></strong></div>
                <div><span>Mean</span><strong>${Mean.toFixed(Field.YPrecision)}<small>${Field.YUnit}</small></strong></div>
            </div>
            <div class="legend-line" style="margin-top:10px">
                <span class="legend-swatch" style="--swatch:${Field.Accent}"></span>
                ${Points.length} keys · drag to move, click empty plot to add, Delete removes the selected key
            </div>
            <div class="action-row">
                <button class="action-button" data-action="curve-sort">${ConstructGlyph('SlidersHorizontal', 12)} Sort keys</button>
                <button class="action-button" data-action="curve-reset">${ConstructGlyph('RotateCcw', 12)} Reset to preset</button>
                <button class="action-button danger" data-action="curve-delete">${ConstructGlyph('Trash2', 12)} Delete key</button>
            </div>
            <div class="readout">${FieldKey === 'Torque'
                ? `torque  peak ${Total.PeakTorqueNm} Nm @ ${Total.PeakTorqueRpm} rpm\n        power  ${Total.PeakPowerKw.toFixed(1)} kW @ ${Total.PeakPowerRpm} rpm`
                : Field.Source}</div>`;
        return this.Card(`Curve · ${Field.Short}`, Field.Glyph, '07', Body, Accent.Vehicle, Field.Source);
    }

    BuildAuditCard(Readings)
    {
        const Specification = this.Specification;
        const LogRows = Specification.PitLog.slice(-4).map((Entry) =>
            `<div><span>${Entry.Action} ${Entry.Corner}</span><strong>${Entry.Detail}</strong></div>`).join('')
            || '<div><span>No pit stops yet</span><strong>—</strong></div>';
        const Body = `
            <div class="receipt-list">
                <div><span>Fitted tyres</span><strong>${Readings.FittedTyres} / 4</strong></div>
                <div><span>Pit bay</span><strong>${Readings.PitBayCount} tyre${Readings.PitBayCount === 1 ? '' : 's'}</strong></div>
                <div><span>Tread on vehicle</span><strong>${Readings.FittedTreadMassKg.toFixed(2)} kg</strong></div>
                <div><span>Unit system</span><strong>${this.UnitSystem === UnitSystems.SI ? 'SI' : 'Imperial'}</strong></div>
            </div>
            <div class="readout">pit log\n${LogRows}</div>`;
        return this.Card('Audit & pit log', 'Shield', '08', Body, Accent.Vehicle, 'Every removal and refit is recorded');
    }

    // 📝 One labelled slider row with a numeric field. `Key` names the bound setting; the handler table in WireInspector
    //    maps it to the specification member, so the DOM never carries a path into the specification. The label sits on the
    //    line's left and the number field on its right, exactly like the pinned .control-line; the number changes width to
    //    fit the label's length because this panel's labels are longer than the reference's.
    ControlRow(Label, Key, Value, Unit, Minimum, Maximum, Step, Digits)
    {
        const Percent = Math.min(100, Math.max(0, ((Value - Minimum) / (Maximum - Minimum)) * 100));
        const UnitClass = this.UnitClassOf(Unit);
        const FieldWidth = Math.min(150, Math.max(92, 30 + Unit.length * 6));
        return `<div class="control" data-control="${Key}">
                    <div class="control-line">
                        <span>${Label}</span>
                        <span class="number-field" style="min-width:${FieldWidth}px">
                            <input type="text" inputmode="decimal" data-number="${Key}" value="${Value.toFixed(Digits)}">
                            <small class="${UnitClass}">${Unit}</small>
                        </span>
                    </div>
                    <input type="range" data-slider="${Key}" min="${Minimum}" max="${Maximum}" step="${Step}"
                           value="${Value}" style="--progress:${Percent}%">
                </div>`;
    }

    UnitClassOf(Unit)
    {
        const Reading = ConstructReading('', 0, Unit, UnitSystems.SI);
        return Reading.UnitClass;
    }

    // -- Control binding ----------------------------------------------------------------------------------------------------

    // 📝 Each keyed control writes one specification member. A setter table keeps the wiring declarative and keeps the
    //    path out of the markup; a missing entry is a programming error, not a silent no-op.
    ControlTable()
    {
        const Specification = this.Specification;
        return {
            'mass-1':      { Get: () => Specification.Body.MassKg,          Set: (Value) => { Specification.Body.MassKg = Value; } },
            'com-1':       { Get: () => Specification.Body.CoMHeightM,      Set: (Value) => { Specification.Body.CoMHeightM = Value; } },
            'wheelbase-1': { Get: () => Specification.Body.WheelbaseM,      Set: (Value) => { Specification.Body.WheelbaseM = Value; } },
            'trackf-1':    { Get: () => Specification.Body.TrackFrontM,     Set: (Value) => { Specification.Body.TrackFrontM = Value; } },
            'trackr-1':    { Get: () => Specification.Body.TrackRearM,      Set: (Value) => { Specification.Body.TrackRearM = Value; } },
            'ride-1':      { Get: () => Specification.Body.StaticRideHeightM, Set: (Value) => { Specification.Body.StaticRideHeightM = Value; } },
            'bias-1':      { Get: () => Specification.Body.FrontWeightFraction * 100,
                             Set: (Value) => { Specification.Body.FrontWeightFraction = Value / 100; } },
            'df-1':        { Get: () => Specification.Body.DownforceScale,  Set: (Value) => { Specification.Body.DownforceScale = Value; } },
            'idle-1':      { Get: () => Specification.Powertrain.IdleRpm,   Set: (Value) => { Specification.Powertrain.IdleRpm = Value; } },
            'redline-1':   { Get: () => Specification.Powertrain.RedlineRpm, Set: (Value) => { Specification.Powertrain.RedlineRpm = Value; } },
            'waste-1':     { Get: () => Specification.Powertrain.WastegateMaxBar, Set: (Value) => { Specification.Powertrain.WastegateMaxBar = Value; } },
            'final-1':     { Get: () => Specification.Powertrain.FinalDriveRatio, Set: (Value) => { Specification.Powertrain.FinalDriveRatio = Value; } },
            'launch-1':    { Get: () => Specification.Powertrain.LaunchRpm, Set: (Value) => { Specification.Powertrain.LaunchRpm = Value; } },
            'pressf-1':    { Get: () => Specification.TyreSet.ColdPressureFrontKpa,
                             Set: (Value) => { Specification.TyreSet.ColdPressureFrontKpa = Value; this.InflateCorners('Front', Value); } },
            'pressr-1':    { Get: () => Specification.TyreSet.ColdPressureRearKpa,
                             Set: (Value) => { Specification.TyreSet.ColdPressureRearKpa = Value; this.InflateCorners('Rear', Value); } },
            'stiff-1':     { Get: () => Specification.TyreSet.RadialStiffnessNm / 1000,
                             Set: (Value) => { Specification.TyreSet.RadialStiffnessNm = Value * 1000; } },
            'fnf-1':       { Get: () => Specification.Suspension.FrontNaturalFrequencyHz, Set: (Value) => { Specification.Suspension.FrontNaturalFrequencyHz = Value; } },
            'zfn-1':       { Get: () => Specification.Suspension.FrontDampingRatio, Set: (Value) => { Specification.Suspension.FrontDampingRatio = Value; } },
            'fnr-1':       { Get: () => Specification.Suspension.RearNaturalFrequencyHz, Set: (Value) => { Specification.Suspension.RearNaturalFrequencyHz = Value; } },
            'zrn-1':       { Get: () => Specification.Suspension.RearDampingRatio, Set: (Value) => { Specification.Suspension.RearDampingRatio = Value; } },
            'bump-1':      { Get: () => Specification.Suspension.BumpTravelM * 1000,
                             Set: (Value) => { Specification.Suspension.BumpTravelM = Value / 1000; } },
            'droop-1':     { Get: () => Specification.Suspension.DroopTravelM * 1000,
                             Set: (Value) => { Specification.Suspension.DroopTravelM = Value / 1000; } },
            'barf-1':      { Get: () => Specification.Suspension.FrontBarStiffnessNm / 1000,
                             Set: (Value) => { Specification.Suspension.FrontBarStiffnessNm = Value * 1000; } },
            'barr-1':      { Get: () => Specification.Suspension.RearBarStiffnessNm / 1000,
                             Set: (Value) => { Specification.Suspension.RearBarStiffnessNm = Value * 1000; } },
            'tyre-optimum-1': { Get: () => Specification.TyreSet.OptimumTemperatureK,
                                Set: (Value) => { Specification.TyreSet.OptimumTemperatureK = Value; } },
            'tyre-fade-1':    { Get: () => Specification.TyreSet.GripFadeTemperatureK,
                                Set: (Value) => { Specification.TyreSet.GripFadeTemperatureK = Value; } },
            'tyre-mingrip-1': { Get: () => Specification.TyreSet.MinimumGripFactor * 100,
                                Set: (Value) => { Specification.TyreSet.MinimumGripFactor = Value / 100; } },
            'tyre-sens-1':    { Get: () => Specification.TyreSet.PressureSensitivity * 100,
                                Set: (Value) => { Specification.TyreSet.PressureSensitivity = Value / 100; } },
            ...this.CornerControlEntries()
        };
    }

    // 📝 Per-corner controls are generated from the corner list, so adding a fifth corner (a spare) needs no new key here.
    CornerControlEntries()
    {
        const Entries = {};
        for (const Corner of this.Specification.Corners)
        {
            Entries[`corner-pressure-${Corner.Key}`] = {
                Get: () => Corner.PressureKpa,
                Set: (Value) => { Corner.PressureKpa = Value; } };
            Entries[`corner-temp-${Corner.Key}`] = {
                Get: () => Corner.SurfaceK - KelvinOffset,
                Set: (Value) => { Corner.SurfaceK = Value + KelvinOffset; } };
            Entries[`corner-wear-${Corner.Key}`] = {
                Get: () => Corner.WearFraction * 100,
                Set: (Value) => { Corner.WearFraction = Math.min(1, Math.max(0, Value / 100)); } };
        }
        return Entries;
    }

    // 📝 Inflating a corner changes the pressure of the tyres currently on that axle, so the set card's cold-pressure row
    //    is a live pit action rather than a number that only applies to the next tyre fitted.
    InflateCorners(Axle, PressureKpa)
    {
        for (const Corner of this.Specification.Corners)
        {
            if (Corner.Axle === Axle && Corner.Fitted) Corner.PressureKpa = PressureKpa;
        }
    }

    WireInspector()
    {
        const Table = this.ControlTable();

        for (const Slider of this.InspectorContent.querySelectorAll('[data-slider]'))
        {
            const Key = Slider.getAttribute('data-slider');
            const Entry = Table[Key];
            if (!Entry) continue;
            Slider.addEventListener('input', () =>
            {
                const Value = parseFloat(Slider.value);
                Entry.Set(Value);
                const Field = Slider.parentElement.querySelector(`[data-number="${Key}"]`);
                if (Field) Field.value = Value.toFixed(this.DigitsOfStep(Slider.step));
                const Minimum = parseFloat(Slider.min), Maximum = parseFloat(Slider.max);
                Slider.style.setProperty('--progress', `${Math.min(100, Math.max(0, ((Value - Minimum) / (Maximum - Minimum)) * 100))}%`);
                this.LiveRefresh(Key);
            });
        }

        for (const Field of this.InspectorContent.querySelectorAll('[data-number]'))
        {
            const Key = Field.getAttribute('data-number');
            const Entry = Table[Key];
            if (!Entry) continue;
            const Commit = () =>
            {
                const Parsed = parseFloat(Field.value);
                if (Number.isFinite(Parsed))
                {
                    Entry.Set(Parsed);
                    this.RebuildInspector();
                }
                else
                {
                    Field.value = Entry.Get().toFixed(this.DigitsOfStep('0.01'));
                }
            };
            Field.addEventListener('change', Commit);
            Field.addEventListener('keydown', (Event) => { if (Event.key === 'Enter') { Commit(); Field.blur(); } });
        }

        for (const Button of this.InspectorContent.querySelectorAll('[data-unit-system]'))
        {
            Button.addEventListener('click', () =>
            {
                this.UnitSystem = Button.getAttribute('data-unit-system');
                this.RebuildInspector();
            });
        }

        for (const Button of this.InspectorContent.querySelectorAll('[data-switch]'))
        {
            Button.addEventListener('click', () =>
            {
                const Key = Button.getAttribute('data-switch');
                const Target = { Body: this.Specification.Body, Powertrain: this.Specification.Powertrain,
                                 TyreSet: this.Specification.TyreSet, Suspension: this.Specification.Suspension }[Key];
                if (Target) Target.Enabled = !Target.Enabled;
                this.RebuildInspector();
            });
        }

        for (const Toggle of this.InspectorContent.querySelectorAll('[data-toggle]'))
        {
            Toggle.addEventListener('click', () =>
            {
                const Path = Toggle.getAttribute('data-toggle').split('.');
                const Target = Path[0] === 'TyreSet' ? this.Specification.TyreSet : null;
                if (Target) { Target[Path[1]] = !Target[Path[1]]; this.RebuildInspector(); }
            });
        }

        const Compound = this.InspectorContent.querySelector('[data-compound]');
        if (Compound)
        {
            Compound.addEventListener('change', () =>
            {
                this.Specification.TyreSet.Compound = Compound.value;
                const Preset = TyreCompounds[Compound.value];
                this.Specification.TyreSet.ColdPressureFrontKpa = Preset.ColdPressureKpa;
                this.Specification.TyreSet.ColdPressureRearKpa = Preset.ColdPressureKpa;
                this.Specification.TyreSet.TreadMassKg = Preset.TreadMassKg;
                this.InflateCorners('Front', Preset.ColdPressureKpa);
                this.InflateCorners('Rear', Preset.ColdPressureKpa);
                this.RebuildInspector();
            });
        }

        for (const Button of this.InspectorContent.querySelectorAll('[data-open-tyre]'))
        {
            Button.addEventListener('click', () =>
            {
                this.SelectedId = `tyre-${Button.getAttribute('data-open-tyre')}`;
                this.PaintOutliner();
                this.RebuildInspector();
            });
        }

        const FieldSelect = this.InspectorContent.querySelector('[data-curve-field]');
        if (FieldSelect)
        {
            FieldSelect.addEventListener('change', () =>
            {
                this.CurveFieldKey = FieldSelect.value;
                const Presets = CurvePresets[this.CurveFieldKey] || {};
                this.CurvePresetName = Object.keys(Presets)[0] || '';
                this.CurveIndex = 0;
                this.RebuildInspector();
            });
        }
        const PresetSelect = this.InspectorContent.querySelector('[data-curve-preset]');
        if (PresetSelect)
        {
            PresetSelect.addEventListener('change', () =>
            {
                this.CurvePresetName = PresetSelect.value;
                LoadPreset(this.Specification, this.CurveFieldKey, this.CurvePresetName);
                this.CurveIndex = 0;
                this.RebuildInspector();
            });
        }

        const KeyX = this.InspectorContent.querySelector('[data-key-x]');
        const KeyY = this.InspectorContent.querySelector('[data-key-y]');
        const CommitKey = () =>
        {
            if (!KeyX || !KeyY) return;
            const X = parseFloat(KeyX.value), Y = parseFloat(KeyY.value);
            if (!Number.isFinite(X) || !Number.isFinite(Y)) return;
            MoveCurveKey(this.Specification.Curves[this.CurveFieldKey], this.CurveFieldKey, this.CurveIndex, X, Y);
            this.RebuildInspector();
        };
        if (KeyX) KeyX.addEventListener('change', CommitKey);
        if (KeyY) KeyY.addEventListener('change', CommitKey);

        for (const Button of this.InspectorContent.querySelectorAll('[data-action]'))
        {
            Button.addEventListener('click', () => this.RunAction(Button.getAttribute('data-action')));
        }

        for (const Button of this.InspectorContent.querySelectorAll('[data-tyre-fit]'))
        {
            Button.addEventListener('click', () =>
            {
                FitTyre(this.Specification, Button.getAttribute('data-tyre-fit'), this.ClockSeconds);
                this.PaintOutliner();
                this.RebuildInspector();
                this.PaintStage();
            });
        }
        for (const Button of this.InspectorContent.querySelectorAll('[data-tyre-remove]'))
        {
            Button.addEventListener('click', () =>
            {
                RemoveTyre(this.Specification, Button.getAttribute('data-tyre-remove'), this.ClockSeconds);
                this.PaintOutliner();
                this.RebuildInspector();
                this.PaintStage();
            });
        }

        this.MountCurveInstrument();
    }

    RunAction(Action)
    {
        switch (Action)
        {
            case 'curve-reset':
                LoadPreset(this.Specification, this.CurveFieldKey, this.CurvePresetName);
                this.CurveIndex = 0;
                this.RebuildInspector();
                break;
            case 'curve-sort':
                this.Specification.Curves[this.CurveFieldKey].sort((A, B) => A[0] - B[0]);
                this.RebuildInspector();
                break;
            case 'curve-delete':
                if (RemoveCurveKey(this.Specification.Curves[this.CurveFieldKey], this.CurveIndex))
                {
                    this.CurveIndex = Math.max(0, this.CurveIndex - 1);
                    this.RebuildInspector();
                }
                break;
            case 'refit-all':
                RefitAllTyres(this.Specification, this.ClockSeconds);
                this.PaintOutliner();
                this.RebuildInspector();
                this.PaintStage();
                break;
            default:
                break;
        }
    }

    MountCurveInstrument()
    {
        const Canvas = this.InspectorContent.querySelector('#curve-plot');
        this.CurveInstrument = null;
        if (!Canvas) return;
        const FieldKey = this.CurveFieldKey;
        const Field = CurveFields[FieldKey];
        const Points = this.Specification.Curves[FieldKey];
        this.CurveInstrument = new CurveInstrument(Canvas, {
            OnSelect: (Index) =>
            {
                this.CurveIndex = Index;
                const Selected = Points[Index];
                const KeyX = this.InspectorContent.querySelector('[data-key-x]');
                const KeyY = this.InspectorContent.querySelector('[data-key-y]');
                if (KeyX && Selected) KeyX.value = Selected[0].toFixed(Field.XPrecision);
                if (KeyY && Selected) KeyY.value = Selected[1].toFixed(Field.YPrecision);
            },
            OnMove: (Index, X, Y) =>
            {
                MoveCurveKey(Points, FieldKey, Index, X, Y);
                // 📝 A drag updates only the readout and the peak numbers: rebuilding the inspector mid-drag would
                //    destroy the canvas under the pointer.
                if (Index === this.CurveIndex) this.RefreshCurveReadout();
                this.PaintStage();
            },
            OnAdd: (X, Y) =>
            {
                const Index = AddCurveKey(Points, FieldKey, X, Y);
                if (Index >= 0)
                {
                    this.CurveIndex = Index;
                    this.RefreshCurveReadout();
                }
                return Index;
            }
        });
        this.CurveInstrument.SelectedIndex = Math.min(this.CurveIndex, Points.length - 1);
        this.CurveInstrument.SetCurve(Points, Field, Field.Accent);
        // 📝 The canvas has no intrinsic size: it is measured from its CSS box, so the first paint waits one frame.
        if (this.CurveFrameHandle !== undefined) window.cancelAnimationFrame(this.CurveFrameHandle);
        this.CurveFrameHandle = requestAnimationFrame(() =>
        {
            this.CurveFrameHandle = undefined;
            if (this.CurveInstrument) this.CurveInstrument.Paint();
        });
    }

    // 📝 Refresh only the numbers that depend on the curve, leaving the canvas and its pointer capture alone.
    RefreshCurveReadout()
    {
        const FieldKey = this.CurveFieldKey;
        const Field = CurveFields[FieldKey];
        const Points = this.Specification.Curves[FieldKey];
        const Peak = PeakOfCurve(Points);
        const Mean = EvaluateCurveMean(Points);
        const Readout = this.InspectorContent.querySelectorAll('.curve-readout strong');
        if (Readout.length >= 3)
        {
            Readout[0].innerHTML = `${Peak.Y.toFixed(Field.YPrecision)}<small>${Field.YUnit}</small>`;
            Readout[1].innerHTML = `${Peak.X.toFixed(Field.XPrecision)}<small>${Field.XUnit}</small>`;
            Readout[2].innerHTML = `${Mean.toFixed(Field.YPrecision)}<small>${Field.YUnit}</small>`;
        }
        const Selected = Points[this.CurveIndex];
        const KeyX = this.InspectorContent.querySelector('[data-key-x]');
        const KeyY = this.InspectorContent.querySelector('[data-key-y]');
        if (KeyX && Selected) KeyX.value = Selected[0].toFixed(Field.XPrecision);
        if (KeyY && Selected) KeyY.value = Selected[1].toFixed(Field.YPrecision);
    }

    LiveRefresh()
    {
        // 📝 Cheap live update for the derived numbers a slider moves: repaint the stage and the outliner row metadata,
        //    keep the control under the pointer. A full rebuild happens on change/blur, not on every input event.
        this.PaintStage();
        this.PaintOutliner();
    }

    DigitsOfStep(Step)
    {
        const Text = String(Step);
        const Dot = Text.indexOf('.');
        return Dot < 0 ? 0 : Text.length - Dot - 1;
    }

    // -- Tyre editor -------------------------------------------------------------------------------------------------------

    // 📝 The tyre editor: one corner's own record. It is the same card vocabulary, with the fitted state first because a
    //    pit stop is the action this panel exists for. Every field edits that corner, not the shared set.
    BuildTyreInspector(CornerKey)
    {
        const Specification = this.Specification;
        const Corner = QueryCorner(Specification, CornerKey);
        const TyreSet = Specification.TyreSet;
        const Compound = TyreCompounds[TyreSet.Compound];
        const Grip = Corner.Fitted ? EvaluateTyreGrip(Specification, Corner) : 0;
        const SurfaceC = Corner.SurfaceK - KelvinOffset;
        const Hot = SurfaceC > TyreSet.OptimumTemperatureK - KelvinOffset;
        const ReadingClass = Hot ? 'reading-warm' : null;

        const Header = `
            <div class="eyebrow">Tyre · ${Corner.Axle} axle · corner ${Corner.Key}</div>
            <div class="object-header">
                <h1>${Corner.Label}</h1>
                <div class="object-actions">
                    <span class="enabled-pill ${Corner.Fitted ? '' : 'disabled'}"><span></span>${Corner.Fitted ? 'Fitted' : 'Removed'}</span>
                </div>
            </div>
            <div class="object-description">Parented to the vehicle at socket (${Corner.Local.map((Value) => Value.toFixed(4)).join(', ')}) m —
            removals and replacements are pit actions; the hub stays on the vehicle.</div>
            <div style="margin-bottom:12px">${this.UnitToggle()}</div>`;

        const FitCard = this.Card('Fitting', 'CircleDot', '01', `
            <div class="metric-row">
                <div class="metric">${Corner.Fitted ? Math.round(Corner.PressureKpa) : '—'}<small>${Corner.Fitted ? 'kPa cold' : 'no tyre'}</small></div>
                <span class="small-pill ${Corner.Fitted ? 'live' : 'warm'}">${Corner.Fitted ? `${Compound.Label} fitted` : 'in the pit bay'}</span>
            </div>
            <div class="stats">
                ${this.StatCell('Tread', SurfaceC, '°C', ReadingClass)}
                ${this.StatCell('Wear', Corner.WearFraction * 100, '%')}
                ${this.StatCell('Grip', Grip * 100, '%')}
            </div>
            <div class="action-row">
                <button class="action-button primary" data-tyre-fit="${Corner.Key}" ${Corner.Fitted ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>
                    ${ConstructGlyph('CircleDot', 12)} Fit tyre
                </button>
                <button class="action-button danger" data-tyre-remove="${Corner.Key}" ${Corner.Fitted ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'}>
                    ${ConstructGlyph('Trash2', 12)} Remove (pit stop)
                </button>
            </div>
            <p class="muted">Removing keeps this tyre's own pressure, temperature, wear and grip in the pit bay; fitting returns the
            same used tyre, or builds a new one at the set's cold pressure when the bay is empty for this corner.</p>`,
            Accent.Tyre, 'Parented to the vehicle · removable');

        const SpecCard = this.Card('Tyre specification', 'Droplets', '02', `
            ${this.ControlRow('Pressure', `corner-pressure-${Corner.Key}`, Corner.PressureKpa, 'kPa', 0, 400, 5, 0)}
            ${this.ControlRow('Tread temperature', `corner-temp-${Corner.Key}`, SurfaceC, '°C', -20, 250, 1, 0)}
            ${this.ControlRow('Tread wear', `corner-wear-${Corner.Key}`, Corner.WearFraction * 100, '%', 0, 100, 0.5, 1)}
            <div class="stats">
                ${this.StatCell('Radius', TyreSet.RadiusM, 'm')}
                ${this.StatCell('Rim radius', TyreSet.RimRadiusM, 'm')}
                ${this.StatCell('Section width', TyreSet.WidthM, 'm')}
            </div>
            <div class="stats">
                ${this.StatCell('Radial stiffness', TyreSet.RadialStiffnessNm / 1000, 'kN/m')}
                ${this.StatCell('Reference pressure', TyreSet.ReferencePressureKpa, 'kPa')}
                ${this.StatCell('Pressure share', TyreSet.PressureShare * 100, '%')}
            </div>
            <p class="muted">Compound ${Compound.Label} · ${Compound.Note}. Radius, rim and width are the measured mesh bounds from
            the authored asset; stiffness and pressure share are the contact fan's radial spring.</p>`,
            Accent.Tyre, 'Measured geometry · radial spring');

        const ThermalCard = this.Card('Thermal & grip', 'Thermometer', '03', `
            ${this.ControlRow('Optimum tread', 'tyre-optimum-1', TyreSet.OptimumTemperatureK, 'K', 280, 420, 1, 1)}
            ${this.ControlRow('Grip floor at', 'tyre-fade-1', TyreSet.GripFadeTemperatureK, 'K', 360, 620, 1, 1)}
            ${this.ControlRow('Minimum grip', 'tyre-mingrip-1', TyreSet.MinimumGripFactor * 100, '%', 20, 100, 1, 0)}
            ${this.ControlRow('Pressure sensitivity', 'tyre-sens-1', TyreSet.PressureSensitivity * 100, '%', 0, 80, 1, 0)}
            <div class="stats">
                ${this.StatCell('Wear rate', TyreSet.WearCoefficient * 1e8, 'x')}
                ${this.StatCell('Carcass limit', TyreSet.CarcassFailureK - KelvinOffset, '°C')}
                ${this.StatCell('Burst', TyreSet.BurstPressureKpa, 'kPa')}
            </div>
            <p class="muted">Grip = thermal fade from ${(TyreSet.OptimumTemperatureK - KelvinOffset).toFixed(0)} °C to
            ${(TyreSet.GripFadeTemperatureK - KelvinOffset).toFixed(0)} °C, times the fractional cold-pressure deviation and the
            compound's grip scale. This corner reads ${(Grip * 100).toFixed(1)} % right now.</p>`,
            Accent.Tyre, 'Optimum, fade and pressure rules');

        const GripCurve = this.Card('Curve · grip', 'TrendingUp', '04', `
            <div class="curve-instrument"><canvas class="curve-plot" id="curve-plot"></canvas></div>
            <div class="readout">Field: ${CurveFields.GripTemperature.Label}\n${CurveFields.GripTemperature.Source}</div>`,
            Accent.Tyre, 'Editable grip against tread temperature');

        return Header + `<div class="cards">${FitCard}${SpecCard}${ThermalCard}${GripCurve}</div>`;
    }

    // -- Stage -------------------------------------------------------------------------------------------------------------

    StartStage()
    {
        window.addEventListener('resize', () => this.PaintStage());
        this.StageRunning = true;
        const Animate = () =>
        {
            if (!this.StageRunning) return;
            this.StageTimeSeconds += 1 / 60;
            this.PaintStage();
            this.StageHandle = requestAnimationFrame(Animate);
        };
        this.StageHandle = requestAnimationFrame(Animate);
    }

    // 📝 The host owns the only animation loop; a validation or an embedding page stops it here rather than leaving a frame
    //    callback pointing at a window that is going away.
    StopStage()
    {
        this.StageRunning = false;
        if (this.CurveFrameHandle !== undefined) window.cancelAnimationFrame(this.CurveFrameHandle);
        this.CurveFrameHandle = undefined;
        this.CurveInstrument = null;
        clearInterval(this.ClockHandle);
        clearInterval(this.SelectionHandle);
        if (this.StageHandle !== undefined) window.cancelAnimationFrame(this.StageHandle);
        this.StageHandle = undefined;
    }

    // 📝 Plan view drawn from the bound geometry: length and width come from the body card, hubs from the corner sockets,
    //    and a tyre that is removed is simply not drawn at its hub. Axle load arrows and the ride-frequency labels are the
    //    reason the stage exists — a slider move is visible here without an editor viewport.
    PaintStage()
    {
        const Canvas = this.StageCanvas;
        if (!Canvas) return;
        const Ratio = Math.min(window.devicePixelRatio || 1, 2);
        const Width = Canvas.clientWidth || 640;
        const Height = Canvas.clientHeight || 480;
        if (Canvas.width !== Math.round(Width * Ratio) || Canvas.height !== Math.round(Height * Ratio))
        {
            Canvas.width = Math.round(Width * Ratio);
            Canvas.height = Math.round(Height * Ratio);
        }
        const Context = Canvas.getContext('2d');
        Context.setTransform(Ratio, 0, 0, Ratio, 0, 0);
        Context.clearRect(0, 0, Width, Height);

        const Specification = this.Specification;
        const Body = Specification.Body;
        const Corners = Specification.Corners;
        const Wheelbase = Math.max(0.5, Body.WheelbaseM);
        const ModelLength = Math.max(Wheelbase * 1.2, Body.OverallLengthM);
        const ModelWidth = Math.max(Body.TrackFrontM * 0.9, Body.OverallWidthM);

        // 📝 Ground: a faint grid that shows the scale, with the yaw axis through the vehicle.
        Context.strokeStyle = '#1a1a1a';
        Context.lineWidth = 1;
        const GridMetres = 1.0;
        const Scale = Math.min((Width * 0.74) / ModelLength, (Height * 0.74) / (ModelWidth * 1.9));
        const CentreX = Width * 0.5;
        const CentreY = Height * 0.52;
        for (let Metres = -20; Metres <= 20; Metres += GridMetres)
        {
            const X = CentreX + Metres * Scale;
            const Y = CentreY + Metres * Scale;
            if (X > 0 && X < Width) { Context.beginPath(); Context.moveTo(X, 0); Context.lineTo(X, Height); Context.stroke(); }
            if (Y > 0 && Y < Height) { Context.beginPath(); Context.moveTo(0, Y); Context.lineTo(Width, Y); Context.stroke(); }
        }

        // 📝 Body: a wedge outline whose length follows the bound overall length (or the wheelbase once that is stretched
        //    past it), nose to the right, drawn in the vehicle accent at low alpha.
        const HalfLengthPx = (ModelLength / 2) * Scale;
        const HalfWidthPx = (ModelWidth / 2) * Scale;
        Context.beginPath();
        Context.moveTo(CentreX + HalfLengthPx, CentreY - HalfWidthPx * 0.42);
        Context.lineTo(CentreX + HalfLengthPx * 0.72, CentreY - HalfWidthPx);
        Context.lineTo(CentreX - HalfLengthPx * 0.84, CentreY - HalfWidthPx);
        Context.lineTo(CentreX - HalfLengthPx, CentreY - HalfWidthPx * 0.72);
        Context.lineTo(CentreX - HalfLengthPx, CentreY + HalfWidthPx * 0.72);
        Context.lineTo(CentreX - HalfLengthPx * 0.84, CentreY + HalfWidthPx);
        Context.lineTo(CentreX + HalfLengthPx * 0.72, CentreY + HalfWidthPx);
        Context.lineTo(CentreX + HalfLengthPx, CentreY + HalfWidthPx * 0.42);
        Context.closePath();
        Context.fillStyle = 'rgba(225, 211, 74, 0.07)';
        Context.fill();
        Context.strokeStyle = 'rgba(225, 211, 74, 0.5)';
        Context.lineWidth = 1.4;
        Context.stroke();

        // 📝 Centre of mass marker at its true height ratio, so the rollover limit reads graphically.
        const CoMOffset = ((Body.CoMHeightM - 0.2) / 0.8) * 26;
        Context.beginPath();
        Context.arc(CentreX, CentreY + CoMOffset, 4, 0, Math.PI * 2);
        Context.fillStyle = '#e1d34a';
        Context.fill();
        Context.strokeStyle = '#1f1f1f';
        Context.lineWidth = 2;
        Context.stroke();

        // 📝 Tyres: at their socket's forward/lateral offset, sized from the measured radius and width. A removed tyre
        //    leaves a dashed socket ring, which is the visual statement that it is parented, not welded.
        for (const Corner of Corners)
        {
            const Forward = Corner.Local[0];
            const Lateral = Corner.Local[1];
            const Px = CentreX + Forward * Scale;
            const Py = CentreY - Lateral * Scale;
            const RadiusPx = Specification.TyreSet.RadiusM * Scale;
            const WidthPx = Specification.TyreSet.WidthM * Scale;

            Context.save();
            Context.translate(Px, Py);
            // 📝 Plan view: the tyre's long axis runs fore-and-aft (x) and its section width across the vehicle (y); the
            //    roundRect below therefore spans the diameter horizontally and the width vertically.
            Context.beginPath();
            Context.roundRect(-RadiusPx, -WidthPx / 2, RadiusPx * 2, WidthPx, Math.min(WidthPx, RadiusPx) * 0.42);

            if (Corner.Fitted)
            {
                const Grip = EvaluateTyreGrip(Specification, Corner);
                const Heat = Math.min(1, Math.max(0, (Corner.SurfaceK - 293.15) / 160));
                const R = Math.round(30 + Heat * 200);
                const G = Math.round(38 + Heat * 60);
                const B = Math.round(40 * (1 - Heat) + 20);
                Context.fillStyle = `rgba(${R}, ${G}, ${B}, 0.92)`;
                Context.fill();
                Context.strokeStyle = Grip > 0.95 ? '#e1d34a' : (Grip > 0.8 ? '#c9a24a' : '#a26a3a');
                Context.lineWidth = 1.6;
                Context.stroke();
                // Tread wear bar across the contact patch: green fresh, amber half, red worn out.
                const Wear = Math.min(1, Corner.WearFraction);
                Context.beginPath();
                Context.roundRect(RadiusPx - 6, -WidthPx / 2, 3, WidthPx, 1.5);
                Context.fillStyle = Wear < 0.4 ? '#3ec46d' : (Wear < 0.75 ? '#e0a24a' : '#ff6b6b');
                Context.fill();
            }
            else
            {
                Context.setLineDash([3, 3]);
                Context.strokeStyle = '#4a4a4a';
                Context.lineWidth = 1.2;
                Context.stroke();
                Context.setLineDash([]);
            }
            Context.restore();

            // 📝 Corner key to the outboard side of the tyre, where the plan view has empty ground to write on.
            Context.font = '9px "DM Sans", sans-serif';
            Context.fillStyle = Corner.Fitted ? '#8a8a80' : '#5c5c5c';
            Context.textAlign = Corner.Local[1] > 0 ? 'right' : 'left';
            Context.textBaseline = 'middle';
            Context.fillText(Corner.Key, Px + (Corner.Local[1] > 0 ? -RadiusPx - 6 : RadiusPx + 6), Py);
        }

        // 📝 Pulse along the driveline when the powertrain is enabled: the power chain is the one thing that is not
        //    visible in a plan view, so it is drawn rather than claimed.
        if (Specification.Powertrain.Enabled)
        {
            const Pulse = (Math.sin(this.StageTimeSeconds * 2.2) + 1) / 2;
            const FrontAxle = Corners[0].Local[0] * Scale + CentreX;
            const RearAxle = Corners[2].Local[0] * Scale + CentreX;
            Context.beginPath();
            Context.moveTo(RearAxle, CentreY);
            Context.lineTo(FrontAxle, CentreY);
            Context.strokeStyle = `rgba(225, 211, 74, ${0.1 + Pulse * 0.35})`;
            Context.lineWidth = 2;
            Context.stroke();
        }

        this.PaintHud(Context, Width, Height);
    }

    PaintHud(Context, Width, Height)
    {
        const Specification = this.Specification;
        const Readings = EvaluateVehicleReadings(Specification);
        const Torque = EvaluateTorqueCurve(Specification.Curves.Torque);
        if (this.HudText)
        {
            this.HudText.textContent =
                `${Specification.Identity.Name}   ${Specification.Identity.BodyCategory}\n`
              + `mass ${Specification.Body.MassKg.toFixed(0)} kg   wheelbase ${Specification.Body.WheelbaseM.toFixed(3)} m   track ${(Specification.Body.TrackFrontM * 1000).toFixed(0)} mm\n`
              + `tyres ${Readings.FittedTyres}/4   pit bay ${Readings.PitBayCount}   yaw inertia ${Readings.YawInertiaKgm2.toFixed(0)} kg·m²\n`
              + `torque peak ${Torque.PeakTorqueNm} Nm @ ${Torque.PeakTorqueRpm} rpm   power ${Torque.PeakPowerKw.toFixed(1)} kW\n`
              + `curve keys ${Specification.Curves[this.CurveFieldKey].length} (${CurveFields[this.CurveFieldKey].Short})   units ${this.UnitSystem === UnitSystems.SI ? 'SI' : 'imperial'}`;
        }
        void Context;
        void Height;
        void Width;
    }

    // -- Clock -------------------------------------------------------------------------------------------------------------

    // 📝 A session clock the pit log stamps entries with. It is not vehicle time: nothing in this prototype integrates physics,
    //    and the log says so.
    StartClock()
    {
        this.ClockHandle = setInterval(() =>
        {
            this.ClockSeconds += 1;
            if (this.StatusClock) this.StatusClock.textContent = `session ${String(Math.floor(this.ClockSeconds / 60)).padStart(2, '0')}:${String(this.ClockSeconds % 60).padStart(2, '0')}`;
        }, 1000);
        if (this.StatusSelection)
        {
            this.SelectionHandle = setInterval(() => { this.StatusSelection.textContent = `selection: ${this.SelectedId}`; }, 400);
        }
        void this.StatusNotice;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          BOOT
//------------------------------------------------------------------------------------------------------------------------

// 📝 Booting: the script is a module, so in a browser the document is parsed and DOMContentLoaded is still ahead of it.
//    A host that has already finished parsing (jsdom, a re-import, an inlined bundle) boots immediately instead of waiting
//    for an event that will not fire again.
function BootVehicleInspector()
{
    window.FrontierVehicleInspector = new VehicleInspectorHost();
}

if (document.readyState === 'loading')
{
    window.addEventListener('DOMContentLoaded', BootVehicleInspector);
}
else
{
    BootVehicleInspector();
}
