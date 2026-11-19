// ===========================================================================================================================================
//                                                        VALIDATECLOUDVIEWER.CJS
// ===========================================================================================================================================
// 🧩 Exercise retained-image selection, timelapse controls, mobile layout and rejected capture identities in actual Chromium.

const Fs = require("node:fs");
const Path = require("node:path");
const Assert = require("node:assert/strict");
const Http = require("node:http");
const { createHash: CreateHash } = require("node:crypto");
const Arguments = {};
for (let Index = 2; Index < process.argv.length; Index += 2)
    Arguments[process.argv[Index].replace(/^--/, "")] = process.argv[Index + 1];
const { chromium: Chromium } = require(Path.resolve(Arguments.playwright || "_ClaudeScratch/tmp/EvidenceBrowser/node_modules/playwright-core"));
const Directory = Path.resolve(__dirname, "..");
const Url = Arguments.url || "http://127.0.0.1:4177/";
const Destination = Path.resolve(Arguments.out || Path.join(Directory, "Results/ViewerValidation.json"));
const Captures = JSON.parse(Fs.readFileSync(Path.join(Directory, "Results/Captures.json")));
const ByName = new Map(Captures.captures.map(Capture => [Capture.view.Name, Capture]));
const Report = { source_sha256: Captures.source_sha256, tests_passed: false, browser: "", selections: [],
    keyboard: false, playback: false, reduced_motion_event_pause: false, synthetic_visibility_event_pause: false,
    mobile: false, links: [], rejected_inputs: [], cache_revisions: [], page_errors: [], production_accepted: false };


// ------------------------------------------------------------------------------------------------------------------------
//                                                         IMAGE AND ERROR GATES
// ------------------------------------------------------------------------------------------------------------------------

async function AwaitCapture(Page, Name)
{
    await Page.waitForFunction(Name => {
        const Selected = document.querySelector('#Selection button[aria-pressed="true"]');
        const Picture = document.querySelector("#CloudPicture");
        const Feedback = document.querySelector("#Feedback");
        return (Selected?.dataset.capture === Name && !Picture.hidden && Picture.complete && Picture.naturalWidth > 0) ||
            (!Feedback.hidden && /missing|mismatch|Unexpected|Mixed/.test(Feedback.textContent));
    }, Name);
    Assert.equal(await Page.locator("#Feedback").isVisible(), false, await Page.locator("#Feedback").innerText());
    const Extent = await Page.locator("#CloudPicture").evaluate(async Picture => {
        await Picture.decode();
        return [Picture.naturalWidth, Picture.naturalHeight];
    });
    Assert.deepEqual(Extent, [ByName.get(Name).width, ByName.get(Name).height]);
    Assert.match(await Page.locator("#CaptureSettings").innerText(), /native .* view .* solar steps .* Slang C\+\+/);
}

async function ValidateRejection(Browser, Name, Pattern, Substitute, Expected, CaptureName = "Cumulus")
{
    const Context = await Browser.newContext();
    const Page = await Context.newPage();
    Page.on("pageerror", Error => Report.page_errors.push(String(Error)));
    await Page.route(Pattern, Substitute);
    await Page.goto(Url);
    if (CaptureName !== "Cumulus")
    {
        await AwaitCapture(Page, "Cumulus");
        await Page.locator(`[data-capture="${CaptureName}"]`).click();
    }
    await Page.locator("#Feedback").filter({ hasText: Expected }).waitFor();
    Assert.equal(await Page.locator("#CloudPicture").isVisible(), false);
    Assert.equal(await Page.locator("#CaptureTitle").innerText(), CaptureName);
    Assert.equal(await Page.locator("#CaptureSettings").innerText(), "");
    Report.rejected_inputs.push(Name);
    await Context.close();
}


// ------------------------------------------------------------------------------------------------------------------------
//                                                   WARM CACHE REVISION REGRESSIONS
// ------------------------------------------------------------------------------------------------------------------------

async function PrepareCaptureInspection(Page)
{
    await Page.addInitScript(() => {
        // 📝 Inspect the exact displayed Blob without fetching blob: through the document's restrictive connect-src policy.
        const Blobs = new Map();
        window.CloudCaptureBlobs = Blobs;
        const Construct = URL.createObjectURL.bind(URL);
        const Reclaim = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = Blob => { const Address = Construct(Blob); Blobs.set(Address, Blob); return Address; };
        URL.revokeObjectURL = Address => { Blobs.delete(Address); Reclaim(Address); };
    });
}

async function QueryDisplayedDigest(Page)
{
    return Page.locator("#CloudPicture").evaluate(async Picture => {
        const Bytes = await window.CloudCaptureBlobs.get(Picture.src).arrayBuffer();
        const Digest = await crypto.subtle.digest("SHA-256", Bytes);
        return Array.from(new Uint8Array(Digest), Byte => Byte.toString(16).padStart(2, "0")).join("");
    });
}

async function ValidateCacheRevisions(Browser)
{
    const Names = ["Cumulonimbus", "Cirrocumulus", "CycloneOrbit", "CycloneEye", "CycloneLimb"];
    const Earlier = structuredClone(Captures);
    Earlier.source_sha256 = CreateHash("sha256").update("synthetic earlier cache revision").digest("hex");
    const EarlierPng = new Map(Names.map(Name => [Name, Buffer.concat([
        Fs.readFileSync(Path.join(Directory, "Images", Name + ".png")), Buffer.from("earlier cache revision")])]));
    for (const Capture of Earlier.captures)
    {
        Capture.source_sha256 = Earlier.source_sha256;
        if (EarlierPng.has(Capture.view.Name))
            Capture.png_sha256 = CreateHash("sha256").update(EarlierPng.get(Capture.view.Name)).digest("hex");
    }
    for (const Scenario of ["stale PNG cache", "stale manifest cache", "already-open revision"])
    {
        let Revision = 0;
        const Requests = [];
        const Outcome = { scenario: Scenario, fixture: "synthetic prior bytes, real HTTP cache; Blob inspection only, no request routing", captures: [] };
        Report.cache_revisions.push(Outcome);
        const Server = Http.createServer((Request, Response) => {
            const Address = new URL(Request.url, "http://127.0.0.1");
            Requests.push({ path: Address.pathname, query: Address.search, revision: Revision });
            const Relative = Address.pathname === "/" ? "index.html" : Address.pathname.slice(1);
            let Bytes;
            if (Relative === "__cache_fixture__") Bytes = Buffer.from("<!doctype html><title>Cloud cache fixture</title>");
            else if (Relative === "Results/Captures.json" && Revision === 0 && Scenario !== "stale PNG cache")
                Bytes = Buffer.from(JSON.stringify(Earlier));
            else if (Revision === 0 && EarlierPng.has(Path.basename(Relative, ".png")) && Relative.startsWith("Images/"))
                Bytes = EarlierPng.get(Path.basename(Relative, ".png"));
            else
            {
                const Resolved = Path.resolve(Directory, Relative);
                if (!Resolved.startsWith(Directory + Path.sep) || !Fs.existsSync(Resolved) || !Fs.statSync(Resolved).isFile())
                {
                    Response.writeHead(404); Response.end(); return;
                }
                Bytes = Fs.readFileSync(Resolved);
            }
            const Mime = { ".html": "text/html", ".png": "image/png", ".json": "application/json" }[Path.extname(Relative)] || "text/html";
            Response.writeHead(200, { "Content-Type": Mime, "Content-Length": Bytes.length,
                "Cache-Control": Revision === 0 ? "public, max-age=3600" : "no-store" });
            Response.end(Bytes);
        });
        await new Promise(Resolve => Server.listen(0, "0.0.0.0", Resolve));
        const Origin = `http://127.0.0.1:${Server.address().port}/`;
        const Context = await Browser.newContext();
        const Page = await Context.newPage();
        await PrepareCaptureInspection(Page);
        Page.on("pageerror", Error => Report.page_errors.push(String(Error)));
        try
        {
            await Page.goto(Origin + "__cache_fixture__");
            if (Scenario !== "already-open revision")
            {
                const Paths = Scenario === "stale PNG cache" ? Names.map(Name => "Images/" + Name + ".png") : ["Results/Captures.json"];
                for (let Repetition = 0; Repetition < 2; ++Repetition)
                    await Page.evaluate(async Paths => {
                        for (const Address of Paths) await (await fetch(Address)).arrayBuffer();
                    }, Paths);
                Assert.equal(Requests.filter(Request => Paths.includes(Request.path.slice(1))).length, Paths.length,
                    "warm requests must actually hit the browser HTTP cache");
                Outcome.primed_http_cache_entries = Paths.length;
            }
            else
            {
                await Page.goto(Origin);
                await AwaitCapture(Page, "Cumulus");
                await Page.locator('[data-capture="Cumulonimbus"]').click();
                await AwaitCapture(Page, "Cumulonimbus");
                const Digest = await QueryDisplayedDigest(Page);
                Assert.equal(Digest, Earlier.captures.find(Capture => Capture.view.Name === "Cumulonimbus").png_sha256);
                Outcome.earlier_blob_authenticated = true;
            }
            Revision = 1;
            if (Scenario !== "already-open revision")
            {
                await Page.goto(Origin);
                await AwaitCapture(Page, "Cumulus");
            }
            for (const Name of Names)
            {
                await Page.locator(`[data-mode="${Name === "Cumulonimbus" || Name === "Cirrocumulus" ? "formations" : "orbit"}"]`).click();
                await Page.locator(`[data-capture="${Name}"]`).click();
                await AwaitCapture(Page, Name);
                Assert.equal(await QueryDisplayedDigest(Page), ByName.get(Name).png_sha256, Name + " current PNG, not a cached revision");
                Assert.match(await Page.locator("#CaptureSettings").innerText(), new RegExp(Captures.source_sha256.slice(0, 12)));
                Outcome.captures.push(Name);
            }
            Outcome.tests_passed = true;
        }
        catch (Failure)
        {
            Outcome.tests_passed = false;
            Outcome.failure = Failure.message;
            if (Arguments["cache-only"] === "true" && Arguments.screenshot)
                await Page.screenshot({ path: Path.resolve(Arguments.screenshot), type: "jpeg", quality: 32, fullPage: true });
            throw Failure;
        }
        finally
        {
            await Context.close();
            await new Promise(Resolve => Server.close(Resolve));
        }
    }
}


// ------------------------------------------------------------------------------------------------------------------------
//                                                     ACTUAL BROWSER INTERACTIONS
// ------------------------------------------------------------------------------------------------------------------------

async function Main()
{
    const Browser = await Chromium.launch({
        executablePath: Path.resolve(Arguments.executable || "_ClaudeScratch/tmp/EvidenceBrowser/chromium"),
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"]
    });
    try
    {
        Report.browser = Browser.version();
        await ValidateCacheRevisions(Browser);
        if (Arguments["cache-only"] === "true") { Report.tests_passed = true; return; }
        const Context = await Browser.newContext({ viewport: { width: 1200, height: 960 } });
        const Page = await Context.newPage();
        await PrepareCaptureInspection(Page);
        Page.on("pageerror", Error => Report.page_errors.push(String(Error)));
        await Page.goto(Url);
        await AwaitCapture(Page, "Cumulus");
        for (const Mode of ["sky", "orbit", "formations", "wind"])
        {
            await Page.locator(`[data-mode="${Mode}"]`).click();
            const Names = await Page.locator("#Selection button").evaluateAll(Buttons => Buttons.map(Button => Button.dataset.capture));
            for (const Name of Names)
            {
                await Page.locator(`[data-capture="${Name}"]`).click();
                await AwaitCapture(Page, Name);
                Assert.equal(await QueryDisplayedDigest(Page), ByName.get(Name).png_sha256);
                Report.selections.push({ category: Mode, capture: Name });
            }
        }
        Assert.equal(new Set(Report.selections.map(Selection => Selection.capture)).size, 22);
        await Page.locator('[data-mode="orbit"]').focus();
        await Page.keyboard.press("Enter");
        await AwaitCapture(Page, "CycloneOrbit");
        await Page.locator('[data-mode="wind"]').click();
        await Page.locator("#WindTime").focus();
        await Page.keyboard.press("End");
        await AwaitCapture(Page, "Wind150");
        await Page.keyboard.press("ArrowLeft");
        await AwaitCapture(Page, "Wind120");
        Report.keyboard = true;
        await Page.locator("#Playback").click();
        await Page.waitForFunction(() => document.querySelector('#Selection button[aria-pressed="true"]')?.dataset.capture !== "Wind120");
        await Page.locator("#Playback").click();
        const Paused = await Page.locator("#CaptureTitle").innerText();
        await Page.waitForTimeout(800);
        Assert.equal(await Page.locator("#CaptureTitle").innerText(), Paused);
        Report.playback = true;
        await Page.locator("#Playback").click();
        await Page.emulateMedia({ reducedMotion: "reduce" });
        await Page.waitForFunction(() => document.querySelector("#Playback").textContent === "Play");
        Report.reduced_motion_event_pause = true;
        await Page.locator("#Playback").click();
        await Page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
            document.dispatchEvent(new Event("visibilitychange"));
            delete document.hidden;
        });
        Assert.equal(await Page.locator("#Playback").innerText(), "Play");
        Report.synthetic_visibility_event_pause = true;
        await Page.locator('[data-mode="sky"]').click();
        await Page.locator('[data-capture="Cumulonimbus"]').click();
        await AwaitCapture(Page, "Cumulonimbus");
        await Page.screenshot({ path: Path.resolve(Arguments.screenshot || "_ClaudeScratch/tmp/CloudViewerDesktop.jpg"),
            type: "jpeg", quality: 32, fullPage: true });
        const Links = await Page.locator("footer a").evaluateAll(Links => Links.map(Link => Link.getAttribute("href")));
        for (const Link of Links)
        {
            const Response = await Context.request.get(new URL(Link, Url).href);
            Assert.equal(Response.status(), 200, Link);
            Report.links.push(Link);
        }
        const HostResponse = await Context.request.get(Url, { headers: { Host: "4177-preview.e2b.app" } });
        Assert.equal(HostResponse.status(), 200);
        Report.preview_host_accepted = true;
        for (const Relative of ["", "Results/Captures.json", "Images/Cumulonimbus.png"])
        {
            const Response = await Context.request.get(new URL(Relative, Url).href,
                { headers: { "If-Modified-Since": "Sun, 01 Jan 2040 00:00:00 GMT", "If-None-Match": '"stale"' } });
            Assert.equal(Response.status(), 200, "stale validators must not reuse earlier gallery bytes");
            Assert.equal(Response.headers()["cache-control"], "no-store");
        }
        Report.preview_cache_policy_verified = true;
        await Page.setViewportSize({ width: 390, height: 844 });
        Assert.equal(await Page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await Page.locator('[data-mode="orbit"]').click();
        await AwaitCapture(Page, "CycloneOrbit");
        await Page.screenshot({ path: Path.resolve("_ClaudeScratch/tmp/CloudViewerMobile.jpg"),
            type: "jpeg", quality: 75, fullPage: true });
        Report.mobile = true;
        await Context.close();
        await ValidateRejection(Browser, "missing capture", "**/Images/Cumulus.png*",
            Route => Route.fulfill({ status: 404, body: "missing" }), "Capture file missing");
        await ValidateRejection(Browser, "altered PNG byte", "**/Images/Cumulonimbus.png*", async Route => {
            const Response = await Route.fetch();
            const Bytes = Buffer.from(await Response.body());
            Bytes[Bytes.length - 1] ^= 1;
            await Route.fulfill({ response: Response, body: Bytes });
        }, "Capture identity mismatch", "Cumulonimbus");
        await ValidateRejection(Browser, "missing manifest", "**/Results/Captures.json",
            Route => Route.fulfill({ status: 404, body: "missing" }), "Capture manifest missing");
        await ValidateRejection(Browser, "mixed numerical source identities", "**/Results/Captures.json", Route => {
            const Manifest = structuredClone(Captures);
            Manifest.captures[0].source_sha256 = "0".repeat(64);
            return Route.fulfill({ json: Manifest });
        }, "Mixed source identities");
        await ValidateRejection(Browser, "false acceptance claim", "**/Results/Captures.json", Route => {
            const Manifest = structuredClone(Captures);
            Manifest.production_accepted = true;
            return Route.fulfill({ json: Manifest });
        }, "Unexpected acceptance claims");
        Assert.deepEqual(Report.page_errors, []);
        Report.category_capture_choices = Report.selections.length;
        Report.distinct_capture_images = new Set(Report.selections.map(Selection => Selection.capture)).size;
        Report.tests_passed = true;
    }
    finally
    {
        Fs.writeFileSync(Destination, JSON.stringify(Report, null, 2) + "\n");
        await Browser.close();
    }
    console.log(JSON.stringify(Report, null, 2));
}

Main().catch(Failure => { console.error(Failure); process.exitCode = 1; });
