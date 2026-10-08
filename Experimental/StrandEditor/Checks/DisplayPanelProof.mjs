//============================================================================================================================================
//                                                           DISPLAYPANELPROOF.MJS
//============================================================================================================================================
// 📦 Browser proof for the display panel. It drives real pointer input on the toggles and slider, compares each frame with and without the panel, and saves frames.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Output = path.resolve(Root, '..', '..', 'VisualProof', 'DisplayPanel');
const ContentFormats = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
};
const Accent = [95, 216, 255];
// 📝 Frames are rendered 2.5 s into the loop. The start transition is dark at t = 0 and its sweep is lit by then.
const FrameSeconds = 2.5;

const Lines = [];
const Failures = [];
const Images = {};
const Measurements = { Frames: {} };

// 📝 Each check adds one line to the report; any failure makes the run exit non-zero.
function Check(Name, Pass, Detail = '') {
    const Line = (Pass ? 'PASS ' : 'FAIL ') + Name + (Detail ? ' (' + Detail + ')' : '');
    Lines.push(Line);
    if (!Pass) Failures.push(Line);
}

function Near(Pixel, Target, Tolerance) {
    return Pixel.every((Value, Index) => Math.abs(Value - Target[Index]) <= Tolerance);
}

function Serve() {
    const Server = http.createServer((Request, Response) => {
        const Url = new URL(Request.url, 'http://localhost');
        const Relative = decodeURIComponent(Url.pathname === '/' ? '/index.html' : Url.pathname);
        const File = path.join(Root, Relative);
        if (!File.startsWith(Root) || !fs.existsSync(File) || fs.statSync(File).isDirectory()) {
            Response.writeHead(404);
            Response.end();
            return;
        }
        Response.writeHead(200, { 'Content-Type': ContentFormats[path.extname(File)] ?? 'application/octet-stream' });
        fs.createReadStream(File).pipe(Response);
    });
    return new Promise((Resolve) => Server.listen(0, '127.0.0.1', () => Resolve(Server)));
}

async function Launch() {
    if (fs.existsSync('/tmp/al2023/lib')) {
        process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:/tmp:${process.env.LD_LIBRARY_PATH ?? ''}`;
    }
    return puppeteer.launch({
        executablePath: process.env.CHROME_PATH || (await chromium.executablePath()),
        headless: 'shell',
        args: [...chromium.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        defaultViewport: { width: 1600, height: 1000 },
    });
}

// 📝 The boxes that hold the panel's 2D controls, in panel pixels. The overlay may change pixels only inside them.
function ControlBoxes(Layout) {
    const First = Layout.Chips[0];
    const Last = Layout.Chips[Layout.Chips.length - 1];
    return [
        { X: 40, Y: 60, W: 800, H: 180 },
        { X: First.X - 12, Y: First.Y - 12, W: Last.X + Last.Width - First.X + 24, H: First.Height + 24 },
        { X: 40, Y: 690, W: 1200, H: 96 },
    ];
}

function SaveFrame(Name, DataUrl) {
    const Bytes = Buffer.from(DataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(Output, Name), Bytes);
    Images[Name] = crypto.createHash('sha256').update(Bytes).digest('hex');
}

async function WaitActive(Page, Index) {
    try {
        await Page.waitForFunction((Target) => window.StrandEditor.PanelStatus().Active === Target, { timeout: 180000 }, Index);
        return true;
    } catch (Failure) {
        return false;
    }
}

async function Camera(Page) {
    return Page.evaluate(() => JSON.stringify(window.StrandEditor.GetScene().Camera));
}

// 📝 Decodes the bare and the overlaid frame in the page and compares every pixel. Returns counts and sampled colours only.
async function CompareFrames(Page, BareUrl, OverlaidUrl, Spots, Boxes) {
    return Page.evaluate(async (Bare, Overlaid, SpotList, BoxList) => {
        const Load = async (Url) => {
            const Picture = new Image();
            Picture.src = Url;
            await Picture.decode();
            const Scratch = document.createElement('canvas');
            Scratch.width = Picture.width;
            Scratch.height = Picture.height;
            const Context = Scratch.getContext('2d', { willReadFrequently: true });
            Context.drawImage(Picture, 0, 0);
            return { Width: Picture.width, Height: Picture.height, Data: Context.getImageData(0, 0, Picture.width, Picture.height).data };
        };
        const A = await Load(Bare);
        const B = await Load(Overlaid);
        const Width = A.Width;
        const Offset = (X, Y) => (Y * Width + X) * 4;
        const Inside = (X, Y) => BoxList.some((Box) => X >= Box.X && X < Box.X + Box.W && Y >= Box.Y && Y < Box.Y + Box.H);
        const TitleBox = BoxList[0];
        let ChangedInside = 0;
        let ChangedOutside = 0;
        let LitBare = 0;
        let TitlePixels = 0;
        for (let Y = 0; Y < A.Height; Y++) {
            for (let X = 0; X < Width; X++) {
                const I = Offset(X, Y);
                const Changed = A.Data[I] !== B.Data[I] || A.Data[I + 1] !== B.Data[I + 1] || A.Data[I + 2] !== B.Data[I + 2] || A.Data[I + 3] !== B.Data[I + 3];
                if (Changed) {
                    if (Inside(X, Y)) ChangedInside += 1;
                    else ChangedOutside += 1;
                }
                if (Math.max(A.Data[I], A.Data[I + 1], A.Data[I + 2]) > 60) LitBare += 1;
                const InTitle = X >= TitleBox.X && X < TitleBox.X + TitleBox.W && Y >= TitleBox.Y && Y < TitleBox.Y + TitleBox.H;
                if (InTitle && B.Data[I] > 235 && B.Data[I + 1] > 240 && B.Data[I + 2] > 245) TitlePixels += 1;
            }
        }
        return {
            Size: [A.Width, A.Height],
            Spots: SpotList.map(([X, Y]) => Array.from(B.Data.slice(Offset(X, Y), Offset(X, Y) + 3))),
            ChangedInside,
            ChangedOutside,
            LitBare,
            TitlePixels,
        };
    }, BareUrl, OverlaidUrl, Spots, Boxes);
}

// 📝 Checks one frame pair: the active toggle has the accent edge, an inactive one does not, the overlay changes only its own boxes, and the light is there without it.
async function CheckFrame(Page, Layout, Name, BareUrl, OverlaidUrl, Active) {
    const Chip = Layout.Chips[Active];
    const Other = Layout.Chips[(Active + 1) % Layout.Chips.length];
    const Spots = [
        [Math.round(Chip.X + Chip.Width / 2), Chip.Y],
        [Math.round(Other.X + Other.Width / 2), Other.Y],
    ];
    const Read = await CompareFrames(Page, BareUrl, OverlaidUrl, Spots, ControlBoxes(Layout));
    Measurements.Frames[Name] = {
        Active,
        Size: Read.Size,
        ActiveEdge: Read.Spots[0],
        OtherEdge: Read.Spots[1],
        ChangedInside: Read.ChangedInside,
        ChangedOutside: Read.ChangedOutside,
        LitBare: Read.LitBare,
        TitlePixels: Read.TitlePixels,
    };
    Check(Name + ' is 1280 by 800 pixels', Read.Size[0] === 1280 && Read.Size[1] === 800, Read.Size.join('x'));
    Check(Name + ' draws the active toggle in the accent colour', Near(Read.Spots[0], Accent, 6), Read.Spots[0].join(','));
    Check(Name + ' leaves an inactive toggle without the accent edge', !Near(Read.Spots[1], Accent, 40), Read.Spots[1].join(','));
    Check(Name + ' draws the controls over the frame', Read.ChangedInside > 1000, String(Read.ChangedInside) + ' changed pixels inside the controls');
    Check(Name + ' changes no pixel outside its controls', Read.ChangedOutside === 0, String(Read.ChangedOutside) + ' changed outside');
    Check(Name + ' draws the title text', Read.TitlePixels > 300, String(Read.TitlePixels) + ' bright title pixels');
    Check(Name + ' has light behind the controls', Read.LitBare > 200, String(Read.LitBare) + ' lit pixels without the panel');
    SaveFrame(Name, OverlaidUrl);
}

async function Run() {
    fs.mkdirSync(Output, { recursive: true });
    const Server = await Serve();
    const Port = Server.address().port;
    const Browser = await Launch();
    const Errors = [];
    try {
        const Page = await Browser.newPage();
        Page.on('pageerror', (Failure) => Errors.push(String(Failure.message || Failure)));
        Page.on('console', (Message) => {
            if (Message.type() === 'error') Errors.push(Message.text());
        });
        await Page.goto(`http://127.0.0.1:${Port}/index.html`, { waitUntil: 'load' });
        await Page.waitForFunction(() => window.StrandEditor && window.StrandEditor.Ready === true, { timeout: 180000 });

        const Initial = await Page.evaluate(() => window.StrandEditor.PanelStatus());
        Check('the panel view starts off', Initial.On === false);

        await Page.click('#PanelToggle');
        await Page.waitForFunction(() => window.StrandEditor.PanelStatus().On === true, { timeout: 60000 });
        const On = await Page.evaluate(() => window.StrandEditor.PanelStatus());
        Check('the Panel view button turns the panel on at 1280 by 800', On.Width === 1280 && On.Height === 800, On.Width + 'x' + On.Height);
        const Layout = await Page.evaluate(() => window.StrandEditor.PanelLayout());
        Measurements.Layout = Layout;
        const Box = await (await Page.$('#Canvas')).boundingBox();
        const ToScreen = (X, Y) => ({ X: Box.x + (X * Box.width) / Layout.Width, Y: Box.y + (Y * Box.height) / Layout.Height });
        const ChipCentre = (Index) => {
            const Cell = Layout.Chips[Index];
            return ToScreen(Cell.X + Cell.Width / 2, Cell.Y + Cell.Height / 2);
        };
        const KnobAt = (Index) => ToScreen(Layout.TrackLeft + ((Layout.TrackRight - Layout.TrackLeft) * Index) / 9, Layout.TrackY);

        // 📝 First frame: the panel as it opens, preset 1. The bare frame is the same scene rendered without the panel.
        const FirstBare = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds, false), FrameSeconds);
        const FirstFrame = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds), FrameSeconds);
        await CheckFrame(Page, Layout, 'panel-preset-01.png', FirstBare, FirstFrame, 0);

        // 📝 A real click on toggle 7 loads preset 7. The press must not orbit the camera.
        const Settled = await Page.evaluate(() => window.StrandEditor.PanelStatus().Active);
        Check('the panel opens on the current preset', Settled === 0, 'active ' + Settled);
        const SevenCentre = ChipCentre(6);
        await Page.mouse.click(SevenCentre.X, SevenCentre.Y);
        Check('a click on toggle 7 switches to preset 7', await WaitActive(Page, 6));

        const CameraBeforeDrag = await Camera(Page);
        await Page.mouse.move(SevenCentre.X, SevenCentre.Y);
        await Page.mouse.down();
        for (let Step = 1; Step <= 8; Step++) await Page.mouse.move(SevenCentre.X + Step * 12, SevenCentre.Y);
        await Page.mouse.up();
        Check('a press and drag that starts on a toggle does not orbit the camera', (await Camera(Page)) === CameraBeforeDrag);

        // 📝 A drag that starts on the light, away from the controls, still orbits the camera.
        const Open = ToScreen(300, 330);
        await Page.mouse.move(Open.X, Open.Y);
        await Page.mouse.down();
        for (let Step = 1; Step <= 8; Step++) await Page.mouse.move(Open.X + Step * 12, Open.Y);
        await Page.mouse.up();
        Check('a drag on the light still orbits the camera', (await Camera(Page)) !== CameraBeforeDrag);

        // 📝 Slider drag: grab the knob at preset 7 and drag it to preset 3.
        const Grab = KnobAt(6);
        const Drop = KnobAt(2);
        await Page.mouse.move(Grab.X, Grab.Y);
        await Page.mouse.down();
        for (let Step = 1; Step <= 12; Step++) {
            const Share = Step / 12;
            await Page.mouse.move(Grab.X + (Drop.X - Grab.X) * Share, Grab.Y + (Drop.Y - Grab.Y) * Share);
        }
        await Page.mouse.up();
        Check('dragging the slider from preset 7 to preset 3 ends on preset 3', await WaitActive(Page, 2));

        const ThirdBare = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds, false), FrameSeconds);
        const ThirdFrame = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds), FrameSeconds);
        await CheckFrame(Page, Layout, 'panel-preset-03.png', ThirdBare, ThirdFrame, 2);

        // 📝 Last toggle, then a page screenshot of the editor with the panel view on.
        const Tenth = ChipCentre(9);
        await Page.mouse.click(Tenth.X, Tenth.Y);
        Check('a click on toggle 10 switches to preset 10', await WaitActive(Page, 9));
        const LastBare = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds, false), FrameSeconds);
        const LastFrame = await Page.evaluate((Seconds) => window.StrandEditor.PngUrl(Seconds), FrameSeconds);
        await CheckFrame(Page, Layout, 'panel-preset-10.png', LastBare, LastFrame, 9);

        await Page.screenshot({ path: path.join(Output, 'panel-editor-page.png') });
        Images['panel-editor-page.png'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(Output, 'panel-editor-page.png'))).digest('hex');

        const Status = await Page.evaluate(() => window.StrandEditor.PanelStatus());
        Check('the panel view is still on at the end', Status.On === true && Status.Width === 1280);
        Check('no page errors or console errors', Errors.length === 0, Errors.slice(0, 3).join(' | '));
    } finally {
        await Browser.close();
        Server.close();
    }
}

await Run();
const Report = [
    '# Display panel browser proof',
    '',
    'Run with `npm run panel-proof` (headless Chromium, SwiftShader WebGL2). Each frame is read back from the PNG export and compared with the same frame rendered without the panel. Frames are rendered 2.5 s into the loop.',
    '',
    ...Lines,
    '',
    Failures.length ? 'RESULT: FAIL (' + Failures.length + ')' : 'RESULT: PASS (' + Lines.length + ' checks)',
    '',
];
fs.writeFileSync(path.join(Output, 'Proof.txt'), Report.join('\n'));
fs.writeFileSync(path.join(Output, 'Measurements.json'), JSON.stringify(Measurements, null, 2) + '\n');
fs.writeFileSync(path.join(Output, 'Hashes.json'), JSON.stringify(Images, null, 2) + '\n');
console.log(Report.join('\n'));
process.exitCode = Failures.length ? 1 : 0;
