// Capture review artefacts outside the published repository, under its real subpath.
// Usage: node tools/screenshots-phase-b.mjs <base-url> <unpublished-output-directory>
import { chromium } from '@playwright/test';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [base, destination] = process.argv.slice(2);
if (!base || !destination) throw new Error('pass a base URL and unpublished output directory');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = path.resolve(destination);
if (out === root || out.startsWith(root + path.sep)) throw new Error('screenshots must stay outside the published repository');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const records = [];
try {
  for (const [device, width, height, scale] of [['desktop', 1440, 900, 1], ['mobile', 390, 844, 2]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const capture = async (name, locator = null) => {
      const file = `${device}-${name}.png`;
      if (locator) await locator.screenshot({ path: path.join(out, file) });
      else await page.screenshot({ path: path.join(out, file) });
      records.push({ file, viewport: { width, height }, deviceScaleFactor: scale, url: page.url() });
    };
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await capture('hero');
    for (const id of ['problem', 'overview', 'method', 'results', 'paper']) {
      await page.evaluate((id) => {
        const section = document.getElementById(id);
        scrollTo(0, scrollY + section.getBoundingClientRect().top - 80);
      }, id);
      if (id === 'overview' || id === 'paper') {
        await page.locator(`#${id} img`).evaluate((img) => img.decode());
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await capture(id);
      const section = page.locator(`#${id}`);
      if ((await section.boundingBox()).height > height - 80) await capture(`${id}-full`, section);
    }
    await page.goto(new URL('#results', base).href, { waitUntil: 'networkidle' });
    await capture('results-landing');
    await page.locator('#paper-tables summary').click();
    await page.getByRole('tab').first().waitFor();
    for (const number of [1, 9, 10]) {
      await page.getByRole('tab', { name: `Table ${number}`, exact: true }).click();
      await page.locator(`#table-${number}`).evaluate((el) => scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
      await capture(`table-${number}`);
      if (number === 1 || number === 9) {
        await page.locator(`#table-${number} .table-scroll`).evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await capture(`table-${number}-end`);
      }
    }
    await page.goto(new URL('#overview', base).href, { waitUntil: 'networkidle' });
    await page.locator('[data-figure-open]').click();
    await page.locator('[data-figure-dialog][open]').waitFor();
    await capture('figure-fit');
    for (const zoom of ['1', '2']) {
      await page.locator(`[data-figure-zoom="${zoom}"]`).click();
      await capture(`figure-${Number(zoom) * 100}pct`);
    }
    await page.locator('.figure-viewport').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await capture('figure-200pct-end');
    await page.keyboard.press('Escape');
    await page.goto(new URL('#crystals', base).href, { waitUntil: 'networkidle' });
    await page.locator('.card[data-id="denovo:143"] .card-open').click();
    await page.locator('#crystal-dialog[open]').waitFor();
    await page.locator('.xdialog-inner').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await capture('dialog-with-note-bottom');
    await page.keyboard.press('Escape');
    await page.goto(new URL('missing/deep/page', base).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await capture('404');
    await page.goto(new URL('assets/img/og.png', base).href, { waitUntil: 'networkidle' });
    await page.locator('img').evaluate((img) => img.decode());
    await capture('og');
    await context.close();
  }
  // Additional review viewports: short phones and the scrolly portrait tablet.
  for (const [device, width, height] of [['short-mobile',360,740], ['tablet',768,1024]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const capture = async (name) => {
      const file = `${device}-${name}.png`;
      await page.screenshot({ path: path.join(out, file) });
      records.push({ file, viewport: { width, height }, deviceScaleFactor: 1, url: page.url() });
    };
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (device === 'tablet') {
      await page.waitForFunction(() => window.__crystalar?.story?.mode === 'scrolly');
      for (const [name, step] of [['story-refine',3], ['story-complete',5]]) {
        const progress = await page.evaluate(async (i) => (await import('./js/lib/story-timeline.js')).stepSettled(i), step);
        await page.evaluate((p) => window.__crystalar.story.goTo(p, { animate: false }), progress);
        await page.waitForFunction((p) => Math.abs(window.__crystalar.story.progress - p) < .001, progress);
        await page.waitForFunction((i) => window.__crystalar.story.step === i && !!window.__crystalar?.storyView?.rendered, step);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.story-step.is-on')).opacity === '1');
        await page.evaluate(() => window.__crystalar.storyView.setAutoRotate(0));
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await capture(name);
      }
    } else {
      await page.locator('.card[data-id="denovo:143"] .card-open').click();
      await page.locator('[data-dialog-relaxation]').waitFor();
      await page.locator('.xdialog-inner').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await capture('dialog-with-note-bottom');
      await page.keyboard.press('Escape');
      await page.locator('#paper').evaluate((el) => scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
      await capture('paper');
      await page.locator('#paper-tables summary').click();
      for (const n of [1,9]) {
        await page.getByRole('tab', { name: `Table ${n}`, exact: true }).click();
        await page.locator(`#table-${n}`).evaluate((el) => scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
        await page.locator(`#table-${n} .table-scroll`).evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await capture(`table-${n}-end`);
      }
    }
    await context.close();
  }
  await copyFile(new URL('../assets/img/og.png', import.meta.url), path.join(out, 'og-1200x630.png'));
  await writeFile(path.join(out, 'index.json'), JSON.stringify(records, null, 2) + '\n');
  console.log(`${records.length} viewport/section captures plus the original sharing image`);
} finally {
  await browser.close();
}
