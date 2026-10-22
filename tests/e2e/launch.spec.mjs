import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { siteConfigHtml } from '../../tools/render-gallery.mjs';
import { collectErrors } from './helpers.mjs';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const site = JSON.parse(await readFile(new URL('../../data/site.json', import.meta.url), 'utf8'));
// This was main before launch; using its fixed ref keeps this regression valid afterward.
const legacy = execFileSync('git', ['show', '45bca42:data/site.json'], { encoding: 'utf8' });

async function comingSoon(page) {
  const labels = page.locator('[data-code-label]');
  await expect(labels).toHaveCount(2);
  for (const label of await labels.all()) {
    await expect(label).toHaveText('Code · coming soon');
    await expect(label).toBeVisible();
    expect(await label.evaluate((el) => ({ tag: el.tagName, tabIndex: el.tabIndex, href: el.getAttribute('href'), role: el.getAttribute('role') })))
      .toEqual({ tag: 'SPAN', tabIndex: -1, href: null, role: null });
  }
  await expect(page.locator('[data-config-href="codeUrl"]')).toHaveCount(0);
  await expect(page.locator('a[href*="github.com/crssbl/CrystalAR"]')).toHaveCount(0);
  const arxiv = page.locator('[data-config-href="arxivUrl"]');
  await expect(arxiv).toHaveCount(4);
  for (const link of await arxiv.all()) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://arxiv.org/abs/2610.27762');
  }
}

test('launch: unavailable Code is text in the hero and paper, with a single-line top bar', async ({ page }) => {
  test.skip(site.codeUrl !== null, 'the generated site now enables Code');
  const errors = collectErrors(page);
  await page.goto('./');
  await comingSoon(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.locator('#topbar').evaluate((bar) => {
    const brand = bar.querySelector('.brand').getBoundingClientRect();
    const arxiv = bar.querySelector('[data-config-href="arxivUrl"]').getBoundingClientRect();
    return { width: innerWidth, docWidth: document.documentElement.scrollWidth, brandRight: brand.right, arxivLeft: arxiv.left, arxivRight: arxiv.right, brandCenter: (brand.top+brand.bottom)/2, arxivCenter: (arxiv.top+arxiv.bottom)/2 };
  });
  expect(layout.docWidth).toBe(layout.width);
  expect(layout.brandRight).toBeLessThan(layout.arxivLeft);
  await expect(page.locator('#topbar [data-code-label]')).toHaveCount(0);
  expect(layout.arxivRight).toBeLessThanOrEqual(360);
  expect(layout.brandCenter).toBe(layout.arxivCenter);
  expect(errors).toEqual([]);
});

test('launch: a stale response from the old main cannot replace generated links', async ({ page }) => {
  test.skip(site.codeUrl !== null, 'the generated site now enables Code');
  const errors = collectErrors(page);
  let requests = 0;
  await page.route('**/data/site.json', (route) => { requests++; return route.fulfill({ body: legacy, contentType: 'application/json' }); });
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  expect(requests).toBe(0); // The app no longer depends on this cacheable path.
  await comingSoon(page);
  const served = await page.evaluate(() => fetch('data/site.json').then((r) => r.json()));
  expect(requests).toBe(1);
  expect(served).toEqual(JSON.parse(legacy));
  await comingSoon(page);
  expect(errors).toEqual([]);
});

test('launch: generating a valid codeUrl restores all links and their navigation', async ({ page, context }) => {
  const destination = 'https://example.org/code';
  const generated = siteConfigHtml(html, { ...site, codeUrl: destination });
  await page.route('**/Project-CrystalAR/', (route) => route.fulfill({ body: generated, contentType: 'text/html' }));
  await context.route(destination, (route) => route.fulfill({ body: '<h1>Code destination</h1>', contentType: 'text/html' }));
  await page.goto('./');
  await expect(page.locator('[data-code-label]')).toHaveCount(0);
  const links = page.locator('[data-config-href="codeUrl"]');
  await expect(links).toHaveCount(3);
  for (const link of await links.all()) await expect(link).toHaveAttribute('href', destination);
  const opened = context.waitForEvent('page');
  await page.locator('.actions [data-config-href="codeUrl"]').click();
  const tab = await opened;
  await expect(tab.getByRole('heading')).toHaveText('Code destination');
  await expect(tab).toHaveURL(destination);
  await tab.close();
});

test.describe('launch without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the generated coming-soon state and paper links are complete', async ({ page }) => {
    test.skip(site.codeUrl !== null, 'the generated site now enables Code');
    await page.goto('./');
    await comingSoon(page);
  });
});

test('launch: card actions wait for the gallery handler instead of losing an early activation', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/js/gallery.min.js', async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('./#crystals', { waitUntil: 'domcontentloaded' });
    const opener = page.locator('.card').first().locator('.card-open');
    await expect(opener).toBeDisabled();
    release();
    await expect(opener).toBeEnabled();
    await opener.click();
    await expect(page.locator('[data-dialog]')).toBeVisible();
    await expect(page.locator('[data-dialog-title]')).toHaveText('La5Bi3Cl');
  } finally { release(); }
});
