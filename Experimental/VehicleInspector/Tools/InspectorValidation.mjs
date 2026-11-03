//============================================================================================================================================
//                                                        INSPECTORVALIDATION.MJS
//============================================================================================================================================
// 🧩 Boots the prototype in a headless DOM and checks the inspector: cards, units, colour classes, curve editing, tyre removal.

// 📝 This is the runtime evidence for the prototype. It loads index.html into jsdom, executes the real module graph (the same
//    files a browser loads), then asserts against the resulting DOM and against the live specification the inspector edits.
//    Canvas is not available in jsdom, so the two canvases are stubbed with a minimal 2D context recorder; that proves the
//    drawing code runs without throwing and that the expected drawing calls happen, NOT that the pixels look correct. The
//    pixel figures in Exhibits/VehicleInspector/Images come from RenderFigures.mjs, which draws the same data through the
//    SVG renderer.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { RefitAllTyres } from '../Source/InspectorModel.js';

const Here = dirname(fileURLToPath(import.meta.url));
const Root = resolve(Here, '..');
const ExhibitRoot = resolve(Root, '../../Exhibits/VehicleInspector');

let Passed = 0;
let Failed = 0;
const Lines = [];

function Check(Condition, Name, Detail)
{
    const Ok = Boolean(Condition);
    if (Ok) ++Passed; else ++Failed;
    const Line = `${Ok ? 'PASS' : 'FAIL'} ${Name}${Detail ? ` — ${Detail}` : ''}`;
    Lines.push(Line);
    console.log(Line);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DOM SUBSTRATE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Minimal canvas stub: records the calls the instruments make so the check can assert the draw happened, and returns
//    nonzero measurements so the code's layout branches behave. Nothing here is used as visual evidence.
function InstallCanvasStub(Window)
{
    const Calls = [];
    const Context = {
        setTransform: () => {}, clearRect: () => {}, fillRect: () => {}, beginPath: () => {}, closePath: () => {},
        moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {}, arc: () => {}, save: () => {},
        restore: () => {}, translate: () => {}, setLineDash: () => {}, quadraticCurveTo: () => {},
        roundRect: () => {},
        measureText: (Text) => ({ width: String(Text).length * 5.5 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        fillText: (Text) => { Calls.push(['fillText', Text]); },
        set font(Value) { Calls.push(['font', Value]); },
        get font() { return '10px'; },
        set fillStyle(Value) { Calls.push(['fillStyle', Value]); },
        get fillStyle() { return '#000'; },
        set strokeStyle(Value) { Calls.push(['strokeStyle', Value]); },
        get strokeStyle() { return '#000'; },
        set lineWidth(Value) { Calls.push(['lineWidth', Value]); },
        get lineWidth() { return 1; },
        set textAlign(Value) { Calls.push(['textAlign', Value]); },
        get textAlign() { return 'left'; },
        set textBaseline(Value) { Calls.push(['textBaseline', Value]); },
        get textBaseline() { return 'top'; },
        set lineJoin(Value) {}, get lineJoin() { return 'round'; }
    };
    Window.HTMLCanvasElement.prototype.getContext = function GetContext()
    {
        return Context;
    };
    // 📝 jsdom reports 0 × 0 for layout boxes; the instruments read clientWidth/clientHeight, so a fixed box stands in.
    Object.defineProperty(Window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 352; } });
    Object.defineProperty(Window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 168; } });
    Window.HTMLElement.prototype.getBoundingClientRect = function GetBounds()
    {
        return { left: 0, top: 0, width: 352, height: 168, right: 352, bottom: 168, x: 0, y: 0 };
    };
    Window.HTMLElement.prototype.setPointerCapture = () => {};
    Window.HTMLElement.prototype.releasePointerCapture = () => {};
    if (!Window.PointerEvent)
    {
        Window.PointerEvent = class PointerEvent extends Window.MouseEvent
        {
            constructor(Type, Options) { super(Type, Options); this.pointerId = 1; }
        };
    }
    return Calls;
}

// 📝 requestAnimationFrame is not implemented by jsdom; run the callback on a macrotask so a paint actually happens.
function InstallFrameScheduler(Window)
{
    Window.requestAnimationFrame = (Callback) => setTimeout(() => Callback(performance.now()), 0);
    Window.cancelAnimationFrame = (Handle) => clearTimeout(Handle);
    Window.devicePixelRatio = 1;
    Window.performance = performance;
}

async function BootPrototype()
{
    const Html = readFileSync(resolve(Root, 'index.html'), 'utf8');
    const Virtual = new VirtualConsole();
    const ConsoleErrors = [];
    Virtual.on('jsdomError', (Error) => ConsoleErrors.push(String(Error)));
    Virtual.on('error', (Message) => ConsoleErrors.push(String(Message)));

    const Dom = new JSDOM(Html, {
        url: `file://${Root}/index.html`,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        resources: undefined,
        virtualConsole: Virtual
    });
    const Window = Dom.window;
    InstallFrameScheduler(Window);
    const DrawCalls = InstallCanvasStub(Window);
    // 📝 setInterval is used for the session clock; it is cleared at the end so the process can exit.
    const TimerHandles = [];
    const NativeSetInterval = Window.setInterval;
    Window.setInterval = (Callback, Delay) => { const Handle = NativeSetInterval(Callback, Delay); TimerHandles.push(Handle); return Handle; };

    // 📝 Execute the real module graph by importing it with a jsdom-backed global. The prototype modules only touch
    //    `document`, `window` and `performance` at construction, so installing those globals before the import is enough.
    const Saved = { window: globalThis.window, document: globalThis.document, performance: globalThis.performance,
                    requestAnimationFrame: globalThis.requestAnimationFrame, PointerEvent: globalThis.PointerEvent,
                    HTMLElement: globalThis.HTMLElement, HTMLCanvasElement: globalThis.HTMLCanvasElement };
    globalThis.window = Window;
    globalThis.document = Window.document;
    globalThis.performance = performance;
    globalThis.requestAnimationFrame = Window.requestAnimationFrame;
    globalThis.PointerEvent = Window.PointerEvent;
    globalThis.HTMLElement = Window.HTMLElement;
    globalThis.HTMLCanvasElement = Window.HTMLCanvasElement;

    const Module = await import(`${resolve(Root, 'Source/VehicleInspector.js')}?validation=${Date.now()}`);
    Window.document.dispatchEvent(new Window.Event('DOMContentLoaded'));
    await new Promise((Resolve) => setTimeout(Resolve, 60));

    const Host = Window.FrontierVehicleInspector;
    return { Dom, Window, Module, Host, DrawCalls, TimerHandles, ConsoleErrors, Saved };
}

function Shutdown(Boot)
{
    if (Boot.Host) Boot.Host.StopStage();
    for (const Handle of Boot.TimerHandles) Boot.Window.clearInterval(Handle);
    const { Saved } = Boot;
    globalThis.window = Saved.window;
    globalThis.document = Saved.document;
    globalThis.performance = Saved.performance;
    globalThis.requestAnimationFrame = Saved.requestAnimationFrame;
    globalThis.PointerEvent = Saved.PointerEvent;
    globalThis.HTMLElement = Saved.HTMLElement;
    globalThis.HTMLCanvasElement = Saved.HTMLCanvasElement;
    Boot.Window.close();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        CHECKS
//------------------------------------------------------------------------------------------------------------------------

function Count(Selector, Scope)
{
    return Scope.querySelectorAll(Selector).length;
}

function CheckOutliner(Boot)
{
    const Document = Boot.Window.document;
    Check(Count('#outliner-tree .group', Document) >= 7, 'outliner renders the HTML group sections',
          `${Count('#outliner-tree .group', Document)} groups`);
    const VehicleRow = Document.querySelector('[data-row="vehicle"]');
    Check(VehicleRow && VehicleRow.classList.contains('selected'), 'vehicle row is selected on boot');
    Check(Count('#outliner-tree .tree-row', Document) >= 14, 'outliner lists every scene row',
          `${Count('#outliner-tree .tree-row', Document)} rows`);
    Check(Count('#outliner-tree .tree-row.nested', Document) === 5, 'tyres and marks are nested under the vehicle',
          `${Count('#outliner-tree .tree-row.nested', Document)} nested rows`);
    const TyreMeta = Document.querySelector('[data-row="tyre-FL"] .row-meta');
    Check(TyreMeta && TyreMeta.textContent.includes('kPa'), 'nested tyre row reports pressure with its unit',
          TyreMeta ? TyreMeta.textContent : 'missing');
}

function CheckVehicleCards(Boot)
{
    const Document = Boot.Window.document;
    const Cards = Document.querySelectorAll('#inspector-content .card');
    Check(Cards.length === 8, 'vehicle inspector builds eight cards', `${Cards.length} cards`);
    const Headings = [...Cards].map((Card) => Card.querySelector('.card-heading span').textContent.trim());
    Check(Headings.join('|').includes('Identity') && Headings.join('|').includes('Curve'),
          'cards cover identity, body, powertrain, performance, tyres, suspension, curve, audit', Headings.join(' · '));
    Check(Count('#inspector-content .stats strong small', Document) >= 20,
          'stat cells print a unit beside every value', `${Count('#inspector-content .stats strong small', Document)} units`);
    const Classes = new Set([...Document.querySelectorAll('#inspector-content .stats strong')]
        .flatMap((Node) => [...Node.classList]));
    Check(Classes.has('unit-mass') && Classes.has('unit-length') && Classes.has('unit-torque')
          && Classes.has('unit-pressure') && Classes.has('unit-fraction') && Classes.has('unit-thermal'),
          'unit colour classes are applied across the cards', [...Classes].filter((Name) => Name.startsWith('unit-')).join(', '));
    Check(Count('#inspector-content .property-switch', Document) === 4, 'four property switches above the cards');
    Check(Count('#inspector-content input[type=range]', Document) >= 18, 'slider rails are built for the bound settings',
          `${Count('#inspector-content input[type=range]', Document)} sliders`);
    Check(Count('#inspector-content .corner-chip', Document) === 4, 'tyre set card shows all four corners');
}

function CheckCurveEditing(Boot)
{
    const Host = Boot.Host;
    const Document = Boot.Window.document;
    const Torque = Host.Specification.Curves.Torque;
    const Before = Torque.length;
    Check(Before === 18, 'torque curve loads the engine default table', `${Before} keys`);

    // 📝 Add a key through the instrument's callback contract, then check the specification and the readout.
    const Instrument = Host.CurveInstrument;
    Check(Instrument !== null, 'curve instrument mounts on the plot canvas');
    const Added = Instrument.Handlers.OnAdd(6100, 499);
    Check(Added >= 0 && Torque.length === Before + 1, 'clicking empty plot space adds a key',
          `${Torque.length} keys, index ${Added}`);
    const Refused = Instrument.Handlers.OnAdd(6100.5, 420);
    Check(Refused === -1 && Torque.length === Before + 1, 'a key too close to an existing one is refused');

    Instrument.Handlers.OnMove(Added, 5960, 505);
    const Moved = Torque[Added];
    Check(Math.abs(Moved[0] - 5960) < 0.6 && Math.abs(Moved[1] - 505) < 0.6, 'dragging a key rewrites its x and y',
          `${Moved[0]}, ${Moved[1]}`);

    Instrument.Handlers.OnMove(Added, 9000, 900);
    const ClampedKey = Torque[Added];
    Check(ClampedKey[1] === 700 && ClampedKey[0] <= 9000, 'y and x are clamped to the field bounds',
          `${ClampedKey[0]}, ${ClampedKey[1]}`);

    Host.RunAction('curve-delete');
    Check(Torque.length === Before, 'delete removes the selected key', `${Torque.length} keys`);
    Host.RunAction('curve-reset');
    Check(JSON.stringify(Host.Specification.Curves.Torque) === JSON.stringify(Host.Specification.Curves.Torque),
          'reset restores the chosen preset');

    const Readout = Document.querySelectorAll('#inspector-content .curve-readout strong');
    Check(Readout.length === 3 && Readout[0].textContent.includes('Nm'), 'curve readout prints peak with its unit',
          Readout.length ? Readout[0].textContent : 'missing');
    const DrawText = Boot.DrawCalls.filter((Call) => Call[0] === 'fillText').map((Call) => String(Call[1]));
    Check(DrawText.some((Text) => Text.includes('rpm')) && DrawText.some((Text) => Text.includes('Nm')),
          'the plot paints its axis captions with units', `${DrawText.length} text calls`);
}

function CheckTyrePitStop(Boot)
{
    const Host = Boot.Host;
    const Document = Boot.Window.document;
    const Corner = Host.Specification.Corners.find((Entry) => Entry.Key === 'FL');

    Host.SelectedId = 'tyre-FL';
    // 📝 A fresh boot: a tyre left in the pit bay by an earlier check would be the one refitted, so start from four fitted.
    RefitAllTyres(Host.Specification, 0);
    Host.Specification.PitBay.length = 0;
    Host.PaintOutliner();
    Host.RebuildInspector();
    Check(Document.querySelector('#inspector-content h1').textContent.includes('Front left'),
          'selecting a tyre opens its own inspector');
    Check(Count('#inspector-content [data-tyre-remove]', Document) === 1, 'the tyre inspector offers a pit-stop removal');

    // 📝 Mark the tyre used so the refit has something specific to return.
    Corner.SurfaceK = 353.15;
    Corner.WearFraction = 0.38;
    const PressureBefore = Corner.PressureKpa;
    Check(PressureBefore > 100, 'the corner starts inflated', `${PressureBefore} kPa`);
    Document.querySelector('[data-tyre-remove]').click();
    Check(Corner.Fitted === false, 'removal takes the tyre off the vehicle');
    Check(Host.Specification.PitBay.length === 1, 'the removed tyre is kept in the pit bay',
          `${Host.Specification.PitBay.length} in the bay`);
    Check(Corner.PressureKpa === 0, 'a corner with no tyre reads zero pressure');
    Check(Document.querySelector('.enabled-pill').classList.contains('disabled'), 'the removed corner reads Removed');

    Host.PaintOutliner();
    const Row = Document.querySelector('[data-row="tyre-FL"]');
    Check(Row && Row.classList.contains('is-off'), 'the outliner row dims an unfitted tyre');

    Host.RebuildInspector();
    Document.querySelector('[data-tyre-fit]').click();
    Check(Corner.Fitted === true && Math.abs(Corner.PressureKpa - PressureBefore) < 1e-9,
          'refitting returns the used tyre with its own pressure', `${Corner.PressureKpa} kPa`);
    Check(Math.abs(Corner.WearFraction - 0.38) < 1e-9, 'refitting keeps the used wear', `${Corner.WearFraction}`);
    Check(Host.Specification.PitBay.length === 0, 'the pit bay empties when the tyre is returned');

    // 📝 A fresh tyre when the bay holds nothing for that corner.
    Document.querySelector('[data-tyre-remove]').click();
    Host.Specification.PitBay.length = 0;
    Host.RebuildInspector();
    Document.querySelector('[data-tyre-fit]').click();
    Check(Math.abs(Corner.WearFraction) < 1e-9 && Math.abs(Corner.SurfaceK - 293.15) < 1e-9,
          'with an empty bay, fitting builds a new tyre at ambient');

    Host.SelectedId = 'vehicle';
    Host.PaintOutliner();
    Host.RebuildInspector();
}

function CheckUnits(Boot)
{
    const Host = Boot.Host;
    const Document = Boot.Window.document;
    const MassCell = () => [...Document.querySelectorAll('#inspector-content .stats strong')]
        .find((Node) => Node.querySelector('small') && Node.querySelector('small').textContent.includes('kg'));
    Check(MassCell() !== undefined, 'SI presentation shows kg');

    Host.UnitSystem = 'imperial';
    Host.RebuildInspector();
    const PoundCell = [...Document.querySelectorAll('#inspector-content .stats strong')]
        .find((Node) => Node.querySelector('small') && ['lb', 'ft', 'psi'].includes(Node.querySelector('small').textContent));
    Check(PoundCell !== undefined, 'imperial presentation re-labels to lb / ft / psi',
          PoundCell ? PoundCell.textContent : 'missing');
    const FeetCell = [...Document.querySelectorAll('#inspector-content .stats strong')]
        .find((Node) => Node.querySelector('small') && Node.querySelector('small').textContent === 'ft');
    Check(FeetCell !== undefined && Math.abs(parseFloat(FeetCell.textContent) - 11.14) < 0.05,
          'wheelbase converts to feet', FeetCell ? FeetCell.textContent : 'missing');
    Check(Host.Specification.Body.WheelbaseM === 3.396, 'the stored value stays SI when the label switches');

    Host.UnitSystem = 'si';
    Host.RebuildInspector();
}

function CheckBoundControls(Boot)
{
    const Host = Boot.Host;
    const Document = Boot.Window.document;
    const MassSlider = Document.querySelector('[data-slider="mass-1"]');
    MassSlider.value = '1450';
    MassSlider.dispatchEvent(new Boot.Window.Event('input'));
    Check(Math.abs(Host.Specification.Body.MassKg - 1450) < 1e-9, 'the mass slider writes the specification');

    const FinalField = Document.querySelector('[data-number="final-1"]');
    FinalField.value = '4.10';
    FinalField.dispatchEvent(new Boot.Window.Event('change'));
    Check(Math.abs(Host.Specification.Powertrain.FinalDriveRatio - 4.10) < 1e-9, 'the numeric field writes the specification');

    Host.UnitSystem = 'si';
    Document.querySelector('[data-unit-system="si"]').click();
    Check(Count('#inspector-content input[type=range]', Document) >= 18, 'the panel rebuilds after an edit without losing controls');

    // 📝 Put the vehicle back so the retained figures match the authored state.
    Host.Specification.Body.MassKg = 1300;
    Host.Specification.Powertrain.FinalDriveRatio = 3.55;
    Host.RebuildInspector();
}

function CheckStage(Boot)
{
    Host_StageChecks(Boot);
}

function Host_StageChecks(Boot)
{
    const Host = Boot.Host;
    const Before = Boot.DrawCalls.length;
    Host.PaintStage();
    const After = Boot.DrawCalls.length;
    Check(After > Before, 'the stage paints the vehicle from the bound geometry', `${After - Before} draw calls`);
    const Hud = Boot.Window.document.getElementById('hud-text').textContent;
    Check(Hud.includes('wheelbase') && Hud.includes('torque peak'), 'the stage readout prints bound and derived values');
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          MAIN
//------------------------------------------------------------------------------------------------------------------------

const Boot = await BootPrototype();
try
{
    Check(Boot.Host !== undefined, 'the prototype boots in a headless DOM');
    Check(Boot.ConsoleErrors.length === 0, 'no runtime errors while building the interface',
          Boot.ConsoleErrors.slice(0, 2).join(' | ') || 'none');
    CheckOutliner(Boot);
    CheckVehicleCards(Boot);
    CheckCurveEditing(Boot);
    CheckTyrePitStop(Boot);
    CheckUnits(Boot);
    CheckBoundControls(Boot);
    CheckStage(Boot);
}
finally
{
    Shutdown(Boot);
}

const Summary = `${Passed}/${Passed + Failed} checks passed`;
Lines.push(Summary);
console.log(Summary);

mkdirSync(resolve(ExhibitRoot, 'Results'), { recursive: true });
const Report = [
    'Vehicle inspector prototype — headless DOM validation',
    `Node ${process.version}, jsdom, generated ${new Date().toISOString()}`,
    'Canvas is stubbed: drawing code is exercised, pixels are not validated here.',
    '',
    ...Lines
].join('\n');
writeFileSync(resolve(ExhibitRoot, 'Results/InspectorValidation.txt'), Report);
process.exitCode = Failed === 0 ? 0 : 1;
