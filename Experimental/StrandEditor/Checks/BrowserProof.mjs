//============================================================================================================================================
//                                                              BROWSERPROOF.MJS                                                              
//============================================================================================================================================
// 📦 Headless Chromium proof: renders every starter scene, checks black backgrounds, loop seams, pulses, trails on their paths, fibre width in pixels, text and brightness headroom, and saves the frames.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { BuildPreset, PresetList } from '../Source/Presets.js';
import { CreateLayer, CreateScene } from '../Source/SceneStructure.js';

const Here = path.dirname(fileURLToPath(import.meta.url));
const Root = path.resolve(Here, '..');
const Repo = path.resolve(Root, '..', '..');
const Output = path.resolve(process.argv[2] ?? path.join(Repo, 'VisualProof', 'StrandEditor'));

// 📝 Thresholds are mean absolute differences on the 0..255 byte scale between frames one sixtieth of a second apart.
//    Background and path limits are measured on frames with every other layer hidden, so they read the object alone.
const Limits = {
    ExactWrap: 0.05, ContinuityRatio: 1.5, StepCeiling: 30, MotionStep: 0.5, TextStep: 0.05,
    MinimumLuma: 0.01, LumaCeiling: 0.7, DimHeadroom: 1.5, BackgroundPeakCeiling: 0,
    LumaSwingMinimum: 0.002, PathFractionMinimum: 0.9, PathPixelsMinimum: 500,
    FibreWidthSlack: 0.1, FibreWidthOffset: 0.05, FibreDistanceSpread: 0.05,
};
const MimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
};

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
        Response.writeHead(200, { 'Content-Type': MimeTypes[path.extname(File)] ?? 'application/octet-stream' });
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
        defaultViewport: { width: 1600, height: 900 },
    });
}

function Digest(Bytes) {
    return crypto.createHash('sha256').update(Bytes).digest('hex');
}

function Check(Lines, Failures, Condition, Message) {
    Lines.push((Condition ? 'PASS  ' : 'FAIL  ') + Message);
    if (!Condition) Failures.push(Message);
}

// 📝 One straight fibre on black, at full baseline with no halo, glow or taper, so the frame shows the core profile alone.
function FibreScene(Thickness, Distance, Width, Height) {
    return CreateScene({
        Name: 'Single fibre probe',
        Width,
        Height,
        Background: { Inner: '#000000', Outer: '#000000', Vignette: 0, Grain: 0 },
        Post: { Exposure: 1, Glow: 0, GlowSpread: 0.5, Saturation: 1, Brightness: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance, Fov: 34 },
        Layers: [CreateLayer('Strands', {
            Shape: 'Bezier', Strands: 1, Segments: 128, Spread: 0, Length: 6, Direction: [1, 0, 0],
            Position: [-3, 0, 0], Rotation: [0, 0, 0], Amplitude: 0, Frequency: 1, Ruffle: 0,
            Thickness, Taper: 0, Intensity: 2, Halo: 0, Baseline: 1, PulseRate: 0, Sparks: 0,
            ColourStart: '#ffffff', ColourEnd: '#ffffff', ColourAccent: '#ffffff', AccentMix: 0,
        })],
    });
}

// 📝 The composite maps light X to Filmic(X) and then to the 1/2.2 power. This inverts the Filmic curve (a quadratic),
//    so the proof reads linear light and not the display values.
function InvertFilmic(Target) {
    const Y = Math.min(Math.max(Target, 1e-6), 0.9999);
    const A = 2.43 * Y - 2.51;
    const B = 0.59 * Y - 0.03;
    const C = 0.14 * Y;
    const Root = Math.sqrt(B * B - 4 * A * C);
    const Positive = [(-B + Root) / (2 * A), (-B - Root) / (2 * A)].filter((X) => X > 0);
    return Positive.length ? Math.max(...Positive) : 0;
}

// 📝 Full width at half maximum, in pixels. A Gaussian through the brightest sample and its two neighbours has an exact
//    log-parabola, whatever the sub-pixel position of the centre line, so three samples give the width.
function FibreWidthPixels(Luma) {
    const Linear = Luma.map((Reading) => InvertFilmic(Math.pow(Math.min(Reading, 254.5) / 255, 2.2)));
    let Peak = 1;
    for (let Row = 1; Row < Linear.length - 1; Row++) if (Linear[Row] > Linear[Peak]) Peak = Row;
    const Log = (Row) => Math.log(Math.max(Linear[Row], 1e-12));
    const Curvature = Log(Peak - 1) - 2 * Log(Peak) + Log(Peak + 1);
    const Sigma = Math.sqrt(-1 / Curvature);
    return 2 * Math.sqrt(2 * Math.log(2)) * Sigma;
}

async function Main() {
    fs.mkdirSync(Output, { recursive: true });
    const Server = await Serve();
    const Port = Server.address().port;
    const Browser = await Launch();
    const Lines = [];
    const Failures = [];
    const Diagnostics = [];
    const Measurements = [];
    const Images = [];
    try {
        const Page = await Browser.newPage();
        Page.setDefaultTimeout(900000);
        Page.on('console', (Message) => {
            if (Message.type() === 'error' || Message.type() === 'warning') Diagnostics.push(Message.text());
        });
        Page.on('pageerror', (Failure) => Diagnostics.push(String(Failure)));
        await Page.goto(`http://127.0.0.1:${Port}/index.html`, { waitUntil: 'load' });
        await Page.waitForFunction(() => Boolean(window.StrandEditor && window.StrandEditor.Ready), { timeout: 120000 });

        const Labels = await Page.evaluate(() => window.StrandEditor.PresetLabels);
        Check(Lines, Failures, Labels.length === 9 && PresetList.length === 9,
            'nine starter scenes are offered: ' + Labels.join(', '));

        for (let Index = 0; Index < Labels.length; Index++) {
            const Result = await Page.evaluate((Position) => window.StrandEditor.Measure(Position), Index);
            const Slug = Result.Label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const Bytes = Buffer.from(Result.DataUrl.split(',')[1], 'base64');
            fs.writeFileSync(path.join(Output, Slug + '.png'), Bytes);
            Images.push({ File: Slug + '.png', Sha256: Digest(Bytes), Bytes: Bytes.length });
            const Scene = BuildPreset(Index);
            const Pulsing = Scene.Layers.some((Layer) => Layer.Mechanism === 'Strands' && Layer.PulseRate > 0);
            const Trailing = Scene.Layers.some((Layer) => Layer.Shape === 'Trail');
            let Path = null;
            if (Trailing) {
                Path = await Page.evaluate((Position) => window.StrandEditor.PathCoverage(Position), Index);
            }
            Measurements.push({
                Label: Result.Label, Width: Result.Width, Height: Result.Height, MeanLuma: Result.Summary.MeanLuma,
                BrightestChannel: Result.Summary.BrightestChannel, BrightShare: Result.Summary.BrightShare,
                ForwardStep: Result.ForwardStep, WrapStep: Result.WrapStep, MidDifference: Result.MidDifference,
                TextEffect: Result.TextEffect, DimmedPeak: Result.DimmedPeak, HasText: Result.HasText,
                ExactWrap: Result.ExactWrap, BackgroundPeak: Result.BackgroundPeak, LumaSwing: Result.LumaSwing,
                Pulsing, Trailing, PathFraction: Path ? Path.Fraction : null, PathLit: Path ? Path.Lit : null,
                PathMeanDistance: Path ? Path.MeanDistance : null,
                Vertices: Result.Cost.Vertices, Dust: Result.Cost.Dust,
            });
            const Name = Result.Label;
            const Luma = Result.Summary.MeanLuma;
            Check(Lines, Failures, Result.Errors.length === 0, Name + ': editor reports no errors');
            Check(Lines, Failures, Luma >= Limits.MinimumLuma && Luma <= Limits.LumaCeiling,
                Name + ': mean luma ' + Luma.toFixed(3) + ' inside [' + Limits.MinimumLuma + ', ' + Limits.LumaCeiling + ']');
            Check(Lines, Failures, Result.BackgroundPeak <= Limits.BackgroundPeakCeiling,
                Name + ': with every layer hidden the frame is black (peak ' + Result.BackgroundPeak + ' of 255)');
            Check(Lines, Failures, Result.ExactWrap <= Limits.ExactWrap,
                Name + ': the frame at the loop length equals frame 0 (difference ' + Result.ExactWrap.toFixed(3) + ')');
            Check(Lines, Failures, Result.WrapStep <= Limits.ContinuityRatio * Math.max(Result.ForwardStep, 0.5),
                Name + ': the wrap is no more abrupt than ordinary motion (across the wrap '
                + Result.WrapStep.toFixed(2) + ', forward ' + Result.ForwardStep.toFixed(2) + ')');
            Check(Lines, Failures, Result.ForwardStep <= Limits.StepCeiling,
                Name + ': no teleporting, one-frame step ' + Result.ForwardStep.toFixed(2) + ' (limit ' + Limits.StepCeiling + ')');
            Check(Lines, Failures, Result.MidDifference >= Limits.MotionStep,
                Name + ': motion present, half-loop difference ' + Result.MidDifference.toFixed(2) + ' (minimum ' + Limits.MotionStep + ')');
            if (Pulsing) {
                Check(Lines, Failures, Result.LumaSwing >= Limits.LumaSwingMinimum,
                    Name + ': pulses are visible, mean luma swings ' + Result.LumaSwing.toFixed(4) + ' over one loop (minimum ' + Limits.LumaSwingMinimum + ')');
            }
            if (Path) {
                Check(Lines, Failures, Path.Fraction >= Limits.PathFractionMinimum && Path.Lit >= Limits.PathPixelsMinimum,
                    Name + ': ' + (Path.Fraction * 100).toFixed(1) + '% of ' + Path.Lit.toLocaleString('en-US')
                    + ' bright trail pixels lie within ' + Path.Tolerance + ' px of the projected path (mean ' + Path.MeanDistance.toFixed(1) + ' px)');
            }
            if (Result.HasText) {
                Check(Lines, Failures, Result.TextEffect > Limits.TextStep,
                    Name + ': text layer draws, mean change ' + Result.TextEffect.toFixed(2) + ' when hidden');
            }
            Check(Lines, Failures, Result.DimmedPeak <= 0.5 * 255 + Limits.DimHeadroom,
                Name + ': output brightness 0.5 caps the frame at ' + Result.DimmedPeak + ' of 255');
            Check(Lines, Failures, !Result.Cost.OverBudget,
                Name + ': ' + Result.Cost.Vertices.toLocaleString('en-US') + ' strand vertices and ' + Result.Cost.Dust + ' dust inside the budget');
        }

        // 📝 Thin fibres, measured. One straight fibre must read Thickness scaled by frame height (1.6 px at 1080 p is
        //    1.07 px at 720 p), must not widen with distance, and must read 1.6 px at 1080 p. Each width is read from pixels.
        const FibreCases = [
            { Thickness: 1.6, Distance: 6, Width: 1280, Height: 720 },
            { Thickness: 1.6, Distance: 24, Width: 1280, Height: 720 },
            { Thickness: 1.6, Distance: 12, Width: 1920, Height: 1080 },
        ];
        const FibreWidths = [];
        for (const Case of FibreCases) {
            const Column = await Page.evaluate((Scene) => window.StrandEditor.MeasureFibreColumn(Scene),
                FibreScene(Case.Thickness, Case.Distance, Case.Width, Case.Height));
            const Expected = Math.max(0.8, Case.Thickness * Case.Height / 1080);
            const Measured = FibreWidthPixels(Column.Luma);
            FibreWidths.push(Measured);
            Measurements.push({
                Label: 'Single fibre probe', Width: Column.Width, Height: Column.Height, Thickness: Case.Thickness,
                Distance: Case.Distance, FibreWidth: Measured, ExpectedWidth: Expected,
            });
            Check(Lines, Failures, Math.abs(Measured - Expected) <= Limits.FibreWidthSlack * Expected + Limits.FibreWidthOffset,
                'a single fibre at ' + Case.Width + 'x' + Case.Height + ' and ' + Case.Distance + ' m reads ' + Measured.toFixed(2)
                + ' px wide (Thickness ' + Case.Thickness + ' gives ' + Expected.toFixed(2) + ' px)');
        }
        Check(Lines, Failures, Math.abs(FibreWidths[0] - FibreWidths[1]) <= Limits.FibreDistanceSpread,
            'the fibre keeps its pixel width from near and far (6 m ' + FibreWidths[0].toFixed(2) + ' px, 24 m '
            + FibreWidths[1].toFixed(2) + ' px)');

        const Distinct = new Set(Images.map((Image) => Image.Sha256));
        Check(Lines, Failures, Distinct.size === Images.length, 'every starter scene renders a different frame');
        Check(Lines, Failures, Diagnostics.length === 0, 'the browser console reports no errors or warnings (' + Diagnostics.length + ')');
        for (const Message of Diagnostics.slice(0, 8)) Lines.push('      console: ' + Message.slice(0, 300));
    } finally {
        await Browser.close();
        Server.close();
    }

    const Header = [
        'StrandEditor browser proof',
        'Generated: ' + new Date().toISOString(),
        'Engine: headless Chromium with WebGL2 through SwiftShader (no GPU); WebGPU is not exposed by this build.',
        'Limits: ' + JSON.stringify(Limits),
        '',
    ];
    fs.writeFileSync(path.join(Output, 'Proof.txt'), Header.concat(Lines, ['', Failures.length ? 'RESULT: FAIL (' + Failures.length + ')' : 'RESULT: PASS (' + Lines.length + ' checks)', '']).join('\n'));
    fs.writeFileSync(path.join(Output, 'Measurements.json'), JSON.stringify(Measurements, null, 2) + '\n');
    fs.writeFileSync(path.join(Output, 'Hashes.json'), JSON.stringify(Images, null, 2) + '\n');
    console.log(Lines.join('\n'));
    if (Failures.length) {
        console.error('Browser proof failed:\n' + Failures.join('\n'));
        process.exitCode = 1;
    }
}

Main().catch((Failure) => {
    console.error(Failure);
    process.exitCode = 1;
});
