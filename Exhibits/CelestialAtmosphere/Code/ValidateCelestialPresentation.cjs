/*============================================================================================================================================
                                                      VALIDATECELESTIALPRESENTATION.CJS
============================================================================================================================================*/
// 🧩 Exercise every retained capture, both atmospheric viewpoints, diagnostic labels, mobile layout and integrity failures in Chromium.

const Fs = require('node:fs');
const Path = require('node:path');
const Assert = require('node:assert/strict');
const {chromium: Chromium} = require('playwright-core');

async function Execute()
{
    const Base = process.argv[2] || 'http://127.0.0.1:4176';
    const Destination = Path.resolve(__dirname, '..');
    const Browser = await Chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE,
        headless: true, args: ['--no-sandbox','--disable-dev-shm-usage']});
    const Page = await Browser.newPage({viewport: {width: 1440, height: 1080}, deviceScaleFactor: 1});
    const Errors = [];
    Page.on('pageerror', Failure => Errors.push(Failure.message));
    const Seen = new Set();
    async function Ready(Slug)
    {
        await Page.waitForFunction(Expected => {
            const Picture = document.getElementById('Capture');
            return Picture.dataset.slug === Expected && !Picture.hidden && Picture.complete && Picture.naturalWidth === 480;
        }, Slug);
        Assert.equal(await Page.locator('#Failure').isVisible(), false);
        Assert.equal(await Page.locator('#Capture').evaluate(Picture => Picture.naturalHeight), 270);
        Assert.match(await Page.locator('#Status').innerText(), /32 verified/);
        Seen.add(Slug);
    }
    try
    {
        await Page.goto(Base, {waitUntil: 'networkidle'});
        await Ready('SurfaceSunrise');
        for (const View of ['Surface','Orbit'])
        {
            await Page.locator(`[data-view="${View}"]`).click();
            for (const Moment of ['BeforeSunrise','Sunrise','Dawn','Zenith','Sunset','Dusk'])
            {
                await Page.locator('#Scene').selectOption(View + Moment);
                await Ready(View + Moment);
                if (Moment === 'Zenith') Assert.match(await Page.locator('#Warning').innerText(), /subsolar-site/);
            }
        }
        for (const Category of ['Moon','Sun','Optics','Night'])
        {
            await Page.locator(`[data-category="${Category}"]`).click();
            const Options = await Page.locator('#Scene option').evaluateAll(Entries => Entries.map(Entry => Entry.value));
            for (const Slug of Options)
            {
                await Page.locator('#Scene').selectOption(Slug); await Ready(Slug);
                if (Slug === 'MoonExosphereAmplified') Assert.match(await Page.locator('#Warning').innerText(), /NOT a physical-density/);
                if (Slug === 'MoonExospherePhysical') Assert.match(await Page.locator('#Warning').innerText(), /effectively invisible/);
                if (Category === 'Night')
                {
                    Assert.match(await Page.locator('#Warning').innerText(), Slug === 'MeasuredCatalogueSpace' ? /MEASURED-ONLY/ : /15,200 AUTHORED/);
                }
                if (Category === 'Optics')
                {
                    await Page.locator('#Isolate').check();
                    await Page.waitForFunction(() => document.getElementById('Plane').textContent.includes('ISOLATED') && !document.getElementById('Capture').hidden);
                    await Page.locator('#Isolate').uncheck(); await Ready(Slug);
                }
            }
        }
        Assert.equal(Seen.size, 32);
        await Page.locator('[data-category="Moon"]').click(); await Ready('MoonFull');
        await Page.locator('#Next').click(); await Ready('MoonQuarter');
        await Page.locator('#Previous').click(); await Ready('MoonFull');
        await Page.locator('h1').click(); await Page.keyboard.press('ArrowRight'); await Ready('MoonQuarter');
        await Page.locator('[data-slug="MoonFull"]').click(); await Ready('MoonFull');
        const Links = await Page.locator('footer a').evaluateAll(Entries => Entries.map(Entry => Entry.href));
        for (const Link of Links)
        {
            const Response = await Page.request.get(Link);
            Assert.equal(Response.ok(), true, `Broken viewer link ${Link}`);
        }
        await Page.locator('[data-category="Night"]').click(); await Ready('CatalogueGalaxySpace');
        Assert.match(await Page.locator('.Metric').last().innerText(), /HIPPARCOS VALIDATION/);
        await Page.screenshot({path: Path.join(Destination, 'Images/CelestialViewer.png'), fullPage: true});
        await Page.locator('[data-category="Moon"]').click(); await Ready('MoonFull');
        await Page.setViewportSize({width: 390, height: 844});
        await Page.emulateMedia({reducedMotion: 'reduce'});
        await Page.locator('#Scene').selectOption('MoonExosphereAmplified'); await Ready('MoonExosphereAmplified');
        Assert.equal(await Page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const Missing = await Browser.newPage();
        await Missing.route('**/Captures.json', Route => Route.fulfill({status: 404, body: 'Missing capture list'}));
        await Missing.goto(Base); await Missing.waitForSelector('#Failure:visible');
        Assert.equal(await Missing.locator('#Capture').isVisible(), false); await Missing.close();
        const Changed = await Browser.newPage();
        await Changed.route('**/Images/SurfaceSunrise.png', Route => Route.fulfill({status: 200, contentType: 'image/png', body: Buffer.from('Not the native capture')}));
        await Changed.goto(Base); await Changed.waitForSelector('#Failure:visible');
        Assert.match(await Changed.locator('#Failure').innerText(), /identity mismatch/);
        Assert.equal(await Changed.locator('#Capture').isVisible(), false); await Changed.close();
        Assert.deepEqual(Errors, []);
        const Report = {passed: true, native_views: Seen.size, isolated_lens_views: 8, viewpoints: 2,
            diagnostic_labels: true, keyboard_and_thumbnails: true, mobile: [390,844], reduced_motion: true,
            live_links: Links.length, missing_capture_rejected: true, changed_image_rejected: true,
            browser: await Browser.version(), renderer_scope: 'Retained native captures, not browser-generated skies'};
        Fs.writeFileSync(Path.join(Destination, 'Results/CelestialBrowser.json'), JSON.stringify(Report, null, 2) + '\n');
        console.log(JSON.stringify(Report, null, 2));
    }
    finally {await Browser.close();}
}
Execute().catch(Failure => {console.error(Failure); process.exitCode = 1;});
