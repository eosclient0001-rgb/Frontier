/*====================================================================================================================================
                                                        RUNVALIDATION.MJS
====================================================================================================================================*/
// 🧩 Drives the actual prototype page in headless Chromium (SwiftShader WebGPU) and retains measurements and captures

// Usage:  npm install && node RunValidation.mjs [quadrature|analytic|determinism|convergence|chart|captures|interface|all]
// 📝 Phases write Results/<Phase>.json; captures write Images/*.png. The chart phase reads the JSON results.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { QuadraturePair, MeasureNetExponent, MeasureCrossPairStratification } from './QuadratureReference.mjs';
import { ConstructSoftboxLights } from '../../../Experimental/DeterministicPathTracer/Source/StudioSceneAssembly.js';
import { TracingDivision } from '../../../Experimental/DeterministicPathTracer/Source/TracingDivision.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const CodeFolder      = path.dirname(fileURLToPath(import.meta.url));
const ExhibitFolder   = path.resolve(CodeFolder, '..');
const PrototypeFolder = path.resolve(ExhibitFolder, '../../Experimental/DeterministicPathTracer');
const ResultsFolder   = path.join(ExhibitFolder, 'Results');
const ImagesFolder    = path.join(ExhibitFolder, 'Images');
const RuntimeFolder   = path.join(CodeFolder, 'ChromiumRuntime');
const PairsInUse      = 2 + 16 * 4;     // [-] - subpixel, lens, 16 depths × (light, diffuse, specular, coat)

const ContentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wgsl': 'text/plain', '.facet': 'application/octet-stream' };


//------------------------------------------------------------------------------------------------------------------------
//                                                    RUNTIME
//------------------------------------------------------------------------------------------------------------------------

// 📝 @sparticuz/chromium ships Chromium plus SwiftShader's Vulkan ICD and loader as brotli archives; unpack once.
// 📝 The packaged fonts.conf points at serverless paths; point fontconfig at the unpacked Open Sans instead.
function ConfigureFontLookup()
{
    fs.writeFileSync(path.join(RuntimeFolder, 'fonts.conf'), `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n`
        + `  <dir>${path.join(RuntimeFolder, 'fonts')}</dir>\n  <dir>/usr/share/fonts</dir>\n  <cachedir>${path.join(RuntimeFolder, 'fonts-cache')}</cachedir>\n`
        + `  <alias><family>system-ui</family><prefer><family>Open Sans</family></prefer></alias>\n`
        + `  <alias><family>sans-serif</family><prefer><family>Open Sans</family></prefer></alias>\n</fontconfig>\n`);
}

function PrepareChromiumRuntime()
{
    const Executable = path.join(RuntimeFolder, 'chromium');
    if (fs.existsSync(Executable)) { ConfigureFontLookup(); return Executable; }
    const Archives = path.join(CodeFolder, 'node_modules/@sparticuz/chromium/bin');
    fs.mkdirSync(RuntimeFolder, { recursive: true });
    for (const Name of ['swiftshader', 'al2023', 'fonts'])
    {
        const TarPath = path.join(RuntimeFolder, `${Name}.tar`);
        fs.writeFileSync(TarPath, zlib.brotliDecompressSync(fs.readFileSync(path.join(Archives, `${Name}.tar.br`))));
        execSync(`tar xf "${TarPath}" -C "${RuntimeFolder}" && rm "${TarPath}"`);
    }
    fs.writeFileSync(Executable, zlib.brotliDecompressSync(fs.readFileSync(path.join(Archives, 'chromium.br'))));
    fs.chmodSync(Executable, 0o755);
    ConfigureFontLookup();
    return Executable;
}

function StartPrototypeServer()
{
    const Server = http.createServer((Request, Response) =>
    {
        const RequestPath = decodeURIComponent(new URL(Request.url, 'http://localhost').pathname);
        const FilePath = path.join(PrototypeFolder, RequestPath === '/' ? 'index.html' : RequestPath);
        if (!FilePath.startsWith(PrototypeFolder) || !fs.existsSync(FilePath)) { Response.writeHead(404); Response.end(); return; }
        Response.writeHead(200, { 'Content-Type': ContentTypes[path.extname(FilePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(FilePath).pipe(Response);
    });
    return new Promise(Resolve => Server.listen(0, '127.0.0.1', () => Resolve(Server)));
}

async function LaunchBrowser()
{
    const Executable = PrepareChromiumRuntime();
    process.env.LD_LIBRARY_PATH = `${RuntimeFolder}:${path.join(RuntimeFolder, 'lib')}`;
    process.env.FONTCONFIG_PATH = RuntimeFolder;
    return puppeteer.launch({
        executablePath: Executable, headless: 'shell', protocolTimeout: 0,
        args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader',
               '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-features=DawnGpuWatchdog']
    });
}

async function OpenPrototype(Browser, Server, Query)
{
    const Page = await Browser.newPage();
    Page.on('console', Message => { if (Message.type() === 'error') console.log('page error:', Message.text()); });
    Page.on('pageerror', Failure => console.log('page exception:', Failure.message));
    await Page.goto(`http://127.0.0.1:${Server.address().port}/index.html?validation=1&${Query}`);
    await Page.waitForFunction(() => document.body.dataset.ready, { timeout: 0 });
    const Ready = await Page.evaluate(() => document.body.dataset.ready);
    if (Ready !== 'true') throw new Error(`Prototype failed to initialize: ${await Page.evaluate(() => document.getElementById('FailureNotice').textContent)}`);
    return Page;
}

function WriteResult(Phase, Result)
{
    fs.mkdirSync(ResultsFolder, { recursive: true });
    fs.writeFileSync(path.join(ResultsFolder, `${Phase}.json`), JSON.stringify(Result, null, 2) + '\n');
    console.log(`[${Phase}] ${JSON.stringify(Result.Summary ?? Result)}`);
}

function WritePng(Name, EncodedPng)
{
    fs.mkdirSync(ImagesFolder, { recursive: true });
    fs.writeFileSync(path.join(ImagesFolder, Name), Buffer.from(EncodedPng.split(',')[1], 'base64'));
}

// 📝 Renders powers of two up to SampleTotal in one accumulation, retrieving the mean image at each checkpoint.
async function RenderCheckpoints(Page, SampleTotal, Batch, Checkpoints, CapturePng)
{
    return Page.evaluate(async (SampleTotal, Batch, Checkpoints, CapturePng) =>
    {
        const Tracing = window.DeterministicTracing;
        const Division = Tracing.Division;
        Division.ResetAccumulation();
        const Retained = [];
        const Start = performance.now();
        while (Division.SampleCount < SampleTotal)
        {
            const Next = Checkpoints.find(Checkpoint => Checkpoint > Division.SampleCount) ?? SampleTotal;
            Division.AdvanceSamples(Math.min(Batch, Next - Division.SampleCount));
            await Division.Device.queue.onSubmittedWorkDone();
            if (Checkpoints.includes(Division.SampleCount))
            {
                const Accumulation = await Division.RetrieveAccumulation();
                const Mean = new Float32Array(Accumulation.length / 4 * 3);
                for (let Pixel = 0; Pixel < Accumulation.length / 4; Pixel++)
                {
                    for (let Channel = 0; Channel < 3; Channel++) Mean[Pixel * 3 + Channel] = Accumulation[Pixel * 4 + Channel] / Accumulation[Pixel * 4 + 3];
                }
                Retained.push({ Samples: Division.SampleCount, Seconds: (performance.now() - Start) / 1000, Mean: Array.from(Mean),
                                Png: CapturePng ? await Tracing.EncodeDisplayPng() : null });
            }
        }
        return Retained;
    }, SampleTotal, Batch, Checkpoints, CapturePng);
}

function RelativeRootMeanSquare(Image, Reference)
{
    let SquaredError = 0, SquaredReference = 0;
    for (let Index = 0; Index < Reference.length; Index++)
    {
        SquaredError += (Image[Index] - Reference[Index]) ** 2;
        SquaredReference += Reference[Index] ** 2;
    }
    return Math.sqrt(SquaredError / SquaredReference);
}

function PowersOfTwo(Maximum)
{
    const Powers = [];
    for (let Power = 1; Power <= Maximum; Power *= 2) Powers.push(Power);
    return Powers;
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    PHASES
//------------------------------------------------------------------------------------------------------------------------

// 📝 ① GPU QuadraturePair equals the host replica bit-for-bit. ② Every pair is a (0,m,2)-net at every 2^m prefix.
//    ③ Different pairs are decorrelated (binned deviation comparable to independent points, |ρ| small).
async function ValidateQuadrature(Browser, Server)
{
    const SampleTotal = 4096, PairTotal = 18;
    const Page = await OpenPrototype(Browser, Server, 'width=320&height=240');
    const Points = await Page.evaluate(async (SampleTotal, PairTotal) => Array.from(await window.DeterministicTracing.ExtractQuadrature(SampleTotal, PairTotal)), SampleTotal, PairTotal);
    await Page.close();
    let Mismatches = 0, FirstMismatch = null;
    for (let Pair = 0; Pair < PairTotal; Pair++)
    {
        for (let Sample = 0; Sample < SampleTotal; Sample++)
        {
            const Offset = (Pair * SampleTotal + Sample) * 4;
            const [X, Y] = QuadraturePair(Sample, Pair);
            if (Points[Offset] !== X || Points[Offset + 1] !== Y)
            {
                Mismatches++;
                FirstMismatch ??= { Sample, Pair, Device: [Points[Offset], Points[Offset + 1]], Host: [X, Y] };
            }
        }
    }
    const NetExponents = Array.from({ length: PairsInUse }, (_, Pair) => MeasureNetExponent(Pair, 14));
    const CrossPairs = [[0, 2], [2, 3], [2, 6], [3, 4], [5, 9], [10, 11]].map(([A, B]) => ({ Pairs: [A, B], ...MeasureCrossPairStratification(A, B, 4096) }));
    WriteResult('Quadrature', {
        Summary: { DeviceHostComparisons: SampleTotal * PairTotal * 2, Mismatches, MinimumNetExponent: Math.min(...NetExponents),
                   PairsExamined: PairsInUse, WorstCrossPairCorrelation: Math.max(...CrossPairs.map(Entry => Math.abs(Entry.Correlation))) },
        FirstMismatch, NetExponents, CrossPairs,
        Note: 'Net exponent m means every prefix of 2^1..2^m points is a (0,k,2)-net (one point per elementary box). Examined up to 14.'
    });
}

// 📝 Lambert polygon irradiance from a one-sided rectangle seen unoccluded from point P with normal +Y.
function AnalyticRectangleIrradiance(P, Light)
{
    const Corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([A, B]) =>
        [0, 1, 2].map(Axis => Light.Centre[Axis] + A * Light.EdgeU[Axis] + B * Light.EdgeV[Axis] - P[Axis]));
    const Normalize = V => { const L = Math.hypot(...V); return V.map(C => C / L); };
    let Sum = 0;
    for (let Index = 0; Index < 4; Index++)
    {
        const A = Normalize(Corners[Index]), B = Normalize(Corners[(Index + 1) % 4]);
        const Cosine = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
        const Angle = Math.acos(Cosine);
        const CrossY = A[2] * B[0] - A[0] * B[2];
        const CrossLength = Math.hypot(A[1] * B[2] - A[2] * B[1], CrossY, A[0] * B[1] - A[1] * B[0]) || 1;
        Sum += Angle * CrossY / CrossLength;
    }
    return Light.Radiance * Math.abs(Sum) / 2;
}

async function ValidateAnalyticSoftbox(Browser, Server)
{
    const Width = 160, Height = 120, SampleTotal = Number(process.env.ANALYTIC_SAMPLES || 1024);
    const Page = await OpenPrototype(Browser, Server, `width=${Width}&height=${Height}`);
    const Camera = { Yaw: 0.5, Pitch: 1.1, Distance: 10.0, Target: [0.4, 0.0, 0.6], FieldOfView: 60 };
    await Page.evaluate(Camera => window.DeterministicTracing.ApplyConfiguration({
        VehicleEnabled: false, ShowcaseEnabled: false, EnvironmentIntensity: 0, KeyIntensity: 4.0, RimIntensity: 0, FillIntensity: 0,
        FloorPreset: 'Lambert', BounceLimit: 1, LightsVisibleToCamera: false, Camera }), Camera);
    // 📝 The reference reuses the prototype's own light construction and camera vectors (pure host modules).
    const LightFloats = ConstructSoftboxLights({ KeyIntensity: 4.0, RimIntensity: 0, FillIntensity: 0 }).Packed;
    const Setup = {
        Light:   { Centre: Array.from(LightFloats.slice(0, 3)), EdgeU: Array.from(LightFloats.slice(4, 7)), EdgeV: Array.from(LightFloats.slice(8, 11)), Radiance: LightFloats[12] },
        Vectors: TracingDivision.ResolveCameraVectors(Camera, Width / Height)
    };
    const Checkpoints = PowersOfTwo(SampleTotal);
    const Retained = await RenderCheckpoints(Page, SampleTotal, 16, Checkpoints, false);
    await Page.close();

    // 📝 Reference pixel = box-filtered (16 × 16 subpixel grid) albedo/π · E over the pixel footprint on the floor.
    const { Origin, Forward, Right, Up } = Setup.Vectors;
    const Reference = new Float64Array(Width * Height * 3);
    const Grid = 16;
    for (let Row = 0; Row < Height; Row++)
    {
        for (let Column = 0; Column < Width; Column++)
        {
            let Sum = 0, Hits = 0;
            for (let Sy = 0; Sy < Grid; Sy++) for (let Sx = 0; Sx < Grid; Sx++)
            {
                const Nx = ((Column + (Sx + 0.5) / Grid) / Width) * 2 - 1, Ny = ((Row + (Sy + 0.5) / Grid) / Height) * 2 - 1;
                const D = [0, 1, 2].map(Axis => Forward[Axis] + Nx * Right[Axis] - Ny * Up[Axis]);
                const L = Math.hypot(...D);
                const T = -Origin[1] / (D[1] / L);
                if (!(T > 0)) continue;
                const P = [0, 1, 2].map(Axis => Origin[Axis] + D[Axis] / L * T);
                Sum += 0.5 / Math.PI * AnalyticRectangleIrradiance(P, Setup.Light);
                Hits++;
            }
            for (let Channel = 0; Channel < 3; Channel++) Reference[(Row * Width + Column) * 3 + Channel] = Sum / (Grid * Grid);
        }
    }
    // 📝 Light radiance is (1.00, 0.98, 0.95) × 4; the reference above uses the red channel, so scale per channel.
    const ChannelScale = [1.0, 0.98, 0.95];
    for (let Index = 0; Index < Reference.length; Index++) Reference[Index] *= ChannelScale[Index % 3];

    const Curve = Retained.map(Entry => ({ Samples: Entry.Samples, Seconds: Entry.Seconds, RelativeRms: RelativeRootMeanSquare(Entry.Mean, Reference) }));
    const Final = Retained[Retained.length - 1].Mean;
    let MaximumRelative = 0, MeanRelative = 0, MeanSigned = 0, Counted = 0, WorstPixel = null;
    for (let Index = 0; Index < Reference.length; Index++)
    {
        if (Reference[Index] < 0.02) continue;
        const Signed = (Final[Index] - Reference[Index]) / Reference[Index];
        if (Math.abs(Signed) > MaximumRelative)
        {
            MaximumRelative = Math.abs(Signed);
            WorstPixel = { Column: Math.floor(Index / 3) % Width, Row: Math.floor(Math.floor(Index / 3) / Width), Rendered: Final[Index], Reference: Reference[Index] };
        }
        MeanRelative += Math.abs(Signed); MeanSigned += Signed; Counted++;
    }
    WriteResult('AnalyticSoftbox', {
        Summary: { Width, Height, Samples: SampleTotal, RelativeRmsAtFinal: Curve[Curve.length - 1].RelativeRms,
                   MeanRelativeError: MeanRelative / Counted, MeanSignedRelativeError: MeanSigned / Counted, MaximumRelativeError: MaximumRelative,
                   PixelsCompared: Counted / 3 },
        WorstPixel,
        Light: Setup.Light, Camera, Curve,
        Note: 'Lambert 50 % floor under one 5.6 x 2.6 m softbox (radiance 4), no other geometry or environment. Reference: closed-form polygon irradiance, box-filtered per pixel.'
    });
}

async function ValidateDeterminism(Browser, Server)
{
    const Query = 'width=160&height=90&camera=Hero';
    const SampleTotal = 32;
    const Digests = [];
    const Page = await OpenPrototype(Browser, Server, Query);
    for (const Batch of [1, 4, 32])
    {
        await Page.evaluate(async (SampleTotal, Batch) => window.DeterministicTracing.RenderFromZero(SampleTotal, Batch), SampleTotal, Batch);
        Digests.push({ Instance: 'first page', Batch, Digest: await Page.evaluate(() => window.DeterministicTracing.ComputeDigest()) });
    }
    // 📝 Disturb the configuration and come back: the digest must not depend on history.
    await Page.evaluate(async () => { const T = window.DeterministicTracing; T.ApplyConfiguration({ PaintPreset: 'Racing' }); await T.RenderFromZero(4, 4); T.ApplyConfiguration({ PaintPreset: 'Authored' }); });
    await Page.evaluate(async SampleTotal => window.DeterministicTracing.RenderFromZero(SampleTotal, 8), SampleTotal);
    Digests.push({ Instance: 'first page after reconfiguration', Batch: 8, Digest: await Page.evaluate(() => window.DeterministicTracing.ComputeDigest()) });
    await Page.close();

    const SecondBrowser = await LaunchBrowser();
    const SecondPage = await OpenPrototype(SecondBrowser, Server, Query);
    await SecondPage.evaluate(async SampleTotal => window.DeterministicTracing.RenderFromZero(SampleTotal, 2), SampleTotal);
    Digests.push({ Instance: 'second browser process', Batch: 2, Digest: await SecondPage.evaluate(() => window.DeterministicTracing.ComputeDigest()) });
    await SecondBrowser.close();

    WriteResult('Determinism', {
        Summary: { Samples: SampleTotal, Runs: Digests.length, DistinctDigests: new Set(Digests.map(Entry => Entry.Digest)).size },
        Digests,
        Note: 'FNV-1a over the raw float32 accumulation (sum RGB + sample count) of the 160 x 90 Hero view.'
    });
}

async function ValidateConvergence(Browser, Server)
{
    const Width = 160, Height = 90, ReferenceSamples = 1024;
    const Page = await OpenPrototype(Browser, Server, `width=${Width}&height=${Height}&camera=Hero`);
    const Retained = await RenderCheckpoints(Page, ReferenceSamples, 16, PowersOfTwo(ReferenceSamples), false);
    await Page.close();
    const Reference = Retained[Retained.length - 1].Mean;
    const Curve = Retained.slice(0, -1).map(Entry => ({ Samples: Entry.Samples, Seconds: Entry.Seconds, RelativeRms: RelativeRootMeanSquare(Entry.Mean, Reference) }));
    WriteResult('Convergence', {
        Summary: { Width, Height, ReferenceSamples, SecondsPerSample: Retained[Retained.length - 1].Seconds / ReferenceSamples,
                   RelativeRmsAt1: Curve[0].RelativeRms, RelativeRmsAt64: Curve[6].RelativeRms, RelativeRmsAt512: Curve[Curve.length - 1].RelativeRms },
        Curve,
        Note: 'Self-referenced: error of N samples against the same deterministic sequence at 1024 samples (Hero view, full scene).'
    });
}

async function RetainCaptures(Browser, Server)
{
    const Captures = [];
    const Filmstrip = await OpenPrototype(Browser, Server, 'width=320&height=180&camera=Hero');
    const Strip = await RenderCheckpoints(Filmstrip, 64, 4, [1, 4, 16, 64], true);
    for (const Entry of Strip) { WritePng(`HeroProgression_${String(Entry.Samples).padStart(3, '0')}spp.png`, Entry.Png); Captures.push({ Name: `HeroProgression_${Entry.Samples}spp`, Seconds: Entry.Seconds }); }
    await Filmstrip.close();

    for (const [Camera, Paint, Samples] of [['Hero', 'Authored', 128], ['Spheres', 'Authored', 128], ['Rear', 'Racing', 64]])
    {
        const Page = await OpenPrototype(Browser, Server, `width=640&height=360&camera=${Camera}&paint=${Paint}`);
        const [Entry] = await RenderCheckpoints(Page, Samples, 4, [Samples], true);
        const Name = `${Camera}_${Paint}_${Samples}spp.png`;
        WritePng(Name, Entry.Png);
        Captures.push({ Name, Seconds: Entry.Seconds, Digest: await Page.evaluate(() => window.DeterministicTracing.ComputeDigest()) });
        await Page.close();
    }

    WriteResult('Captures', { Summary: { Images: Captures.length }, Captures });
}

// 📝 The interactive page (render loop running, not validation mode) at 40 % render scale after 6 samples.
async function RetainInterfaceCapture(Browser, Server)
{
    const Interface = await Browser.newPage();
    await Interface.setViewport({ width: 1440, height: 860 });
    await Interface.goto(`http://127.0.0.1:${Server.address().port}/index.html?scale=0.4&target=16&present=readback`);
    await Interface.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 0 });
    await Interface.waitForFunction(() => document.getElementById('ReadoutSamples').textContent === '16', { timeout: 0, polling: 1000 });
    await new Promise(Resolve => setTimeout(Resolve, 1500));
    fs.mkdirSync(ImagesFolder, { recursive: true });
    await Interface.screenshot({ path: path.join(ImagesFolder, 'WorkspaceInterface.png') });
    await Interface.close();
    console.log('[interface] Images/WorkspaceInterface.png');
}

// 📝 Log–log error chart rasterized by the same headless browser from an inline SVG.
async function RetainChart(Browser)
{
    const Analytic = JSON.parse(fs.readFileSync(path.join(ResultsFolder, 'AnalyticSoftbox.json'), 'utf8'));
    const Convergence = JSON.parse(fs.readFileSync(path.join(ResultsFolder, 'Convergence.json'), 'utf8'));
    const Width = 760, Height = 440, Left = 70, Right = 200, Top = 40, Bottom = 56;
    const PlotX = Samples => Left + (Math.log2(Samples) / 10) * (Width - Left - Right);
    const LogMin = -4, LogMax = 0;
    const PlotY = Error => Top + (1 - (Math.log10(Math.max(Error, 1e-4)) - LogMin) / (LogMax - LogMin)) * (Height - Top - Bottom);
    const Polyline = (Curve, Colour) => `<polyline fill="none" stroke="${Colour}" stroke-width="2.4" points="${Curve.map(Entry => `${PlotX(Entry.Samples).toFixed(1)},${PlotY(Entry.RelativeRms).toFixed(1)}`).join(' ')}"/>`
        + Curve.map(Entry => `<circle cx="${PlotX(Entry.Samples).toFixed(1)}" cy="${PlotY(Entry.RelativeRms).toFixed(1)}" r="3.2" fill="${Colour}"/>`).join('');
    const Slope = (Start, Exponent, Colour, Label) =>
    {
        const Points = [1, 1024].map(Samples => `${PlotX(Samples).toFixed(1)},${PlotY(Start * Math.pow(Samples, -Exponent)).toFixed(1)}`).join(' ');
        return `<polyline fill="none" stroke="${Colour}" stroke-dasharray="5 5" stroke-width="1.3" points="${Points}"/>`
             + `<text x="${PlotX(1024) + 8}" y="${PlotY(Start * Math.pow(1024, -Exponent)) + 4}" fill="${Colour}" font-size="12">${Label}</text>`;
    };
    const GridLines = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(Power => `<line x1="${PlotX(2 ** Power)}" x2="${PlotX(2 ** Power)}" y1="${Top}" y2="${Height - Bottom}" stroke="#262a30"/><text x="${PlotX(2 ** Power)}" y="${Height - Bottom + 18}" fill="#9aa1ab" font-size="11" text-anchor="middle">${2 ** Power}</text>`).join('')
                    + [-4, -3, -2, -1, 0].map(Exponent => `<line x1="${Left}" x2="${Width - Right}" y1="${PlotY(10 ** Exponent)}" y2="${PlotY(10 ** Exponent)}" stroke="#262a30"/><text x="${Left - 8}" y="${PlotY(10 ** Exponent) + 4}" fill="#9aa1ab" font-size="11" text-anchor="end">1e${Exponent}</text>`).join('');
    const Start = Analytic.Curve[0].RelativeRms;
    const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Width}" height="${Height}" style="background:#0f1114;font-family:system-ui,sans-serif">
        <text x="${Left}" y="24" fill="#e7e9ec" font-size="15" font-weight="600">Deterministic quadrature: relative RMS error vs samples per pixel</text>
        ${GridLines}
        ${Slope(Start, 0.5, '#6b727c', 'N^-1/2 (Monte Carlo)')}
        ${Slope(Start, 1.0, '#8a8f98', 'N^-1')}
        ${Polyline(Analytic.Curve, '#c7f03a')}
        ${Polyline(Convergence.Curve, '#5ec8ff')}
        <rect x="${Left + 14}" y="${Height - Bottom - 62}" width="12" height="3" fill="#c7f03a"/><text x="${Left + 32}" y="${Height - Bottom - 57}" fill="#e7e9ec" font-size="12">Softbox vs closed-form reference</text>
        <rect x="${Left + 14}" y="${Height - Bottom - 40}" width="12" height="3" fill="#5ec8ff"/><text x="${Left + 32}" y="${Height - Bottom - 35}" fill="#e7e9ec" font-size="12">Full Hero scene vs its own 1024 spp</text>
        <text x="${(Left + Width - Right) / 2}" y="${Height - 12}" fill="#9aa1ab" font-size="12" text-anchor="middle">samples per pixel (log2)</text>
    </svg>`;
    fs.writeFileSync(path.join(ResultsFolder, 'ConvergenceChart.svg'), Svg);
    const Page = await Browser.newPage();
    await Page.setViewport({ width: Width, height: Height });
    await Page.setContent(`<html><body style="margin:0;background:#0f1114">${Svg}</body></html>`);
    await Page.evaluate(async () => { await document.fonts.ready; await new Promise(Resolve => requestAnimationFrame(() => requestAnimationFrame(Resolve))); });
    fs.mkdirSync(ImagesFolder, { recursive: true });
    await Page.screenshot({ path: path.join(ImagesFolder, 'ConvergenceChart.png') });
    await Page.close();
    console.log('[chart] Images/ConvergenceChart.png');
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    MAIN
//------------------------------------------------------------------------------------------------------------------------

const Phase = process.argv[2] || 'all';
const Server = await StartPrototypeServer();
const Browser = await LaunchBrowser();
try
{
    const Started = Date.now();
    if (Phase === 'quadrature'  || Phase === 'all') await ValidateQuadrature(Browser, Server);
    if (Phase === 'analytic'    || Phase === 'all') await ValidateAnalyticSoftbox(Browser, Server);
    if (Phase === 'determinism' || Phase === 'all') await ValidateDeterminism(Browser, Server);
    if (Phase === 'convergence' || Phase === 'all') await ValidateConvergence(Browser, Server);
    if (Phase === 'chart'       || Phase === 'all') await RetainChart(Browser);
    if (Phase === 'captures'    || Phase === 'all') await RetainCaptures(Browser, Server);
    if (Phase === 'interface'   || Phase === 'all') await RetainInterfaceCapture(Browser, Server);
    console.log(`[${Phase}] finished in ${((Date.now() - Started) / 1000).toFixed(1)} s`);
}
finally
{
    await Browser.close();
    Server.close();
}
