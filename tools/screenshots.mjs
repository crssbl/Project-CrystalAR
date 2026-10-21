// Review screenshots at 1440×900 and 390×844: hero, each story step, the gallery, the dialog.
// Usage: node tools/screenshots.mjs <base-url> <out-dir>
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) throw new Error('usage: node tools/screenshots.mjs <base-url> <out-dir>');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
};

const sizes = [
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ['mobile', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }],
];
for (const [name, options] of sizes) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror`, e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crystalar?.hero?.state === 'live', null, { timeout: 20_000 }).catch(() => {});
  await settle(page, 400);
  await shot(page, `${name}-01-hero`);

  await page.locator('#story').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__crystalar?.story && window.__crystalar.storyView, null, { timeout: 30_000 });
  const settled = await page.evaluate(async () => {
    const t = await import('./js/lib/story-timeline.js');
    return t.STEPS.map((_, i) => t.stepSettled(i));
  });
  for (let i = 0; i < settled.length; i += 1) {
    await page.evaluate((p) => window.__crystalar.story.goTo(p, { animate: false }), settled[i]);
    if (name === 'mobile') {
      await page.locator('[data-story-stage]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -64));
    }
    await page.evaluate(() => window.__crystalar.storyView?.setAutoRotate(0));
    await settle(page);
    await shot(page, `${name}-02-story-step${i + 1}`);
  }

  await page.locator('#crystals').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settle(page, 1200);
  await shot(page, `${name}-03-gallery`);

  await page.locator('.card').first().locator('.card-open').click();
  await page.waitForFunction(() => window.__crystalar.dialog?.view, null, { timeout: 20_000 });
  await page.evaluate(() => window.__crystalar.dialog.view.setAutoRotate(0));
  await settle(page);
  await shot(page, `${name}-04-dialog`);
  await page.locator('[data-dialog-replay]').click();
  await page.waitForFunction(() => (window.__crystalar.dialog.progress ?? 0) > 0.5, null, { timeout: 30_000 });
  await shot(page, `${name}-05-dialog-replay`);
  await context.close();
}
await browser.close();
