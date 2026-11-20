import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const Require = createRequire(resolve(process.argv[2] || '_ClaudeScratch/tmp/EditorBrowser/package.json'));
const Chromium = Require('@sparticuz/chromium');
const { chromium } = Require('playwright-core');
const Browser = await chromium.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(Arg => Arg !== '--single-process') });

async function Verify(Port, Name, Interact) {
  const Page = await Browser.newPage({ viewport: { width: 1440, height: 900 } });
  Page.setDefaultTimeout(5000);
  const Origin = `http://127.0.0.1:${Port}`;
  const Errors = [];
  const ExternalFailures = new Set();
  Page.on('pageerror', Error => Errors.push(Error.message));
  Page.on('response', Reply => {
    if (Reply.status() >= 400 && Reply.url().startsWith(Origin) && !Reply.url().startsWith(`${Origin}/api/construct`)) {
      Errors.push(`${Reply.status()} ${Reply.url()}`);
    }
  });
  Page.on('requestfailed', Request => {
    const Address = new URL(Request.url());
    if (Address.protocol.startsWith('http') && Address.origin !== Origin) ExternalFailures.add(Address.hostname);
  });
  try {
    assert.equal((await Page.goto(Origin)).status(), 200);
    await Page.evaluate(() => document.fonts.ready);
    await Interact(Page);
    await Page.screenshot({ path: new URL(`${Name}.png`, import.meta.url).pathname });
    assert.deepEqual(Errors, []);
    console.log(`${Name}: verified in Chromium ${Browser.version()}. External failures: ${[...ExternalFailures].join(', ') || 'none'}.`);
  } finally {
    await Page.close();
  }
}

try {
  await Verify(8092, 'ProjectZero', async Page => {
    const Search = Page.getByRole('textbox', { name: 'Search outliner', exact: true });
    await Search.fill('Moons');
    await Page.locator('.row-name').getByText('Moons', { exact: true }).click();
    await Page.locator('.inspector-scroll [data-panel]').waitFor();
    const Close = Page.getByRole('button', { name: 'Close Inspector tab', exact: true });
    await Close.click();
    await Page.locator('.inspector-scroll').waitFor({ state: 'detached' });
    await Page.getByRole('button', { name: 'Add editor tab or construct' }).click();
    await Page.getByRole('menu').getByRole('button', { name: 'Inspector', exact: true }).click();
    await Page.locator('.inspector-scroll [data-panel]').waitFor();
    await Search.fill('');
  });
  await Verify(5173, 'Frontier', async Page => {
    const Search = Page.getByPlaceholder('Find an object...');
    await Search.fill('Moon');
    await Page.locator('.object-button').getByText('Moon', { exact: true }).first().click();
    await Page.getByRole('heading', { name: 'Moon', exact: true }).waitFor();
    await Page.getByRole('button', { name: 'Open Construct' }).click();
    const Construct = Page.getByRole('dialog', { name: 'Construct', exact: true });
    await Construct.waitFor();
    await Page.keyboard.press('Escape');
    await Construct.waitFor({ state: 'detached' });
    await Search.fill('');
  });
} finally {
  await Browser.close();
}
