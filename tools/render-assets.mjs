// Renders posters, story stills and the sharing image through tools/poster.html in headless
// Chromium (WebGL via SwiftShader), and writes them into the repository.
// Usage: node tools/render-assets.mjs <base-url-of-the-served-site> [--og-out <file>] [--only <key>...]
//   e.g. node tools/render-assets.mjs http://127.0.0.1:8790/Project-CrystalAR/ --og-out ../og-draft.png
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const base = args[0];
if (!base) throw new Error('pass the base URL of the served site');
const ogOut = args.includes('--og-out') ? args[args.indexOf('--og-out') + 1] : null;
const only = args.includes('--only') ? args.slice(args.indexOf('--only') + 1) : null;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
await page.goto(new URL('tools/poster.html', base).href, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__poster?.items?.length > 0);
const items = await page.evaluate(() => window.__poster.items);
for (const item of items) {
  if (only && !only.includes(item.key)) continue;
  if (item.key === 'og') {
    if (!ogOut) continue;
    await page.evaluate((key) => window.__poster.renderItem(key), item.key);
    const box = await page.locator('[data-frame]').boundingBox();
    await page.screenshot({ path: ogOut, clip: { x: Math.round(box.x), y: Math.round(box.y), width: 1200, height: 630 } });
    console.log(`og → ${ogOut}`);
    continue;
  }
  const dataUrl = await page.evaluate((key) => window.__poster.renderItem(key), item.key);
  const [, b64] = dataUrl.split(',');
  const out = path.join(root, item.file);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(b64, 'base64'));
  console.log(`${item.key} → ${item.file} (${Math.round(b64.length * 0.75 / 1024)} KB)`);
}
await browser.close();
