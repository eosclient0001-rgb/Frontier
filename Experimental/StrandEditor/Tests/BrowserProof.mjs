//============================================================================================================================================
//                                                              BROWSERPROOF.MJS
//============================================================================================================================================
// 📦 Headless Chromium proof: renders every starter scene, checks loop seams, motion, text and brightness headroom, and saves the frames.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const Here = path.dirname(fileURLToPath(import.meta.url));
const Root = path.resolve(Here, '..');
const Repo = path.resolve(Root, '..', '..');
const Output = path.resolve(process.argv[2] ?? path.join(Repo, 'VisualProof', 'StrandEditor'));

// 📝 Thresholds are mean absolute differences on the 0..255 byte scale between frames one sixtieth of a second apart.
const Limits = {
    ExactWrap: 0.05, ContinuityRatio: 1.5, MaximumStep: 30, MotionStep: 0.5, TextStep: 0.05,
    MinimumLuma: 0.01, MaximumLuma: 0.7, DimHeadroom: 1.5,
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
        Check(Lines, Failures, Labels.length === 5, 'five starter scenes are offered: ' + Labels.join(', '));

        for (let Index = 0; Index < Labels.length; Index++) {
            const Result = await Page.evaluate((Position) => window.StrandEditor.Measure(Position), Index);
            const Slug = Result.Label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const Bytes = Buffer.from(Result.DataUrl.split(',')[1], 'base64');
            fs.writeFileSync(path.join(Output, Slug + '.png'), Bytes);
            Images.push({ File: Slug + '.png', Sha256: Digest(Bytes), Bytes: Bytes.length });
            Measurements.push({
                Label: Result.Label, Width: Result.Width, Height: Result.Height, MeanLuma: Result.Summary.MeanLuma,
                MaxChannel: Result.Summary.MaxChannel, BrightShare: Result.Summary.BrightShare,
                ForwardStep: Result.ForwardStep, WrapStep: Result.WrapStep, MidDifference: Result.MidDifference,
                TextEffect: Result.TextEffect, DimmedMax: Result.DimmedMax, HasText: Result.HasText,
                ExactWrap: Result.ExactWrap,
                Vertices: Result.Cost.Vertices, Dust: Result.Cost.Dust,
            });
            const Name = Result.Label;
            const Luma = Result.Summary.MeanLuma;
            Check(Lines, Failures, Result.Errors.length === 0, Name + ': editor reports no errors');
            Check(Lines, Failures, Luma >= Limits.MinimumLuma && Luma <= Limits.MaximumLuma,
                Name + ': mean luma ' + Luma.toFixed(3) + ' inside [' + Limits.MinimumLuma + ', ' + Limits.MaximumLuma + ']');
            Check(Lines, Failures, Result.ExactWrap <= Limits.ExactWrap,
                Name + ': the frame at the loop length equals frame 0 (difference ' + Result.ExactWrap.toFixed(3) + ')');
            Check(Lines, Failures, Result.WrapStep <= Limits.ContinuityRatio * Math.max(Result.ForwardStep, 0.5),
                Name + ': the wrap is no more abrupt than ordinary motion (across the wrap '
                + Result.WrapStep.toFixed(2) + ', forward ' + Result.ForwardStep.toFixed(2) + ')');
            Check(Lines, Failures, Result.ForwardStep <= Limits.MaximumStep,
                Name + ': no teleporting, one-frame step ' + Result.ForwardStep.toFixed(2) + ' (limit ' + Limits.MaximumStep + ')');
            Check(Lines, Failures, Result.MidDifference >= Limits.MotionStep,
                Name + ': motion present, half-loop difference ' + Result.MidDifference.toFixed(2) + ' (minimum ' + Limits.MotionStep + ')');
            if (Result.HasText) {
                Check(Lines, Failures, Result.TextEffect > Limits.TextStep,
                    Name + ': text layer draws, mean change ' + Result.TextEffect.toFixed(2) + ' when hidden');
            }
            Check(Lines, Failures, Result.DimmedMax <= 0.5 * 255 + Limits.DimHeadroom,
                Name + ': output brightness 0.5 caps the frame at ' + Result.DimmedMax + ' of 255');
            Check(Lines, Failures, !Result.Cost.OverBudget,
                Name + ': ' + Result.Cost.Vertices.toLocaleString('en-US') + ' strand vertices and ' + Result.Cost.Dust + ' dust inside the budget');
        }

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
