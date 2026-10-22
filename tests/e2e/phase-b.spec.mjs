import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { collectErrors } from './helpers.mjs';

test('Task 9: positional diagrams and visible method loops respect reduced motion', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./#problem');
  await expect(page.locator('.manifold-card p')).toHaveText(['0 free parameters', '1 free parameter', '2 free parameters', '3 free parameters']);
  for (const svg of await page.locator('.manifold-card svg').all()) await expect(svg).toHaveAccessibleName(/free coordinate/);
  await page.locator('#method-title').scrollIntoViewIfNeeded();
  for (const card of await page.locator('.method-card').all()) {
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/is-running/);
  }
  await page.locator('#paper-title').scrollIntoViewIfNeeded();
  await expect(page.locator('.method-card.is-running')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.locator('#method-title').scrollIntoViewIfNeeded();
  await expect(page.locator('.method-card.is-running')).toHaveCount(0);
  const names = await page.locator('.method-card svg *').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(names.every((name) => name === 'none')).toBe(true);
  expect(errors).toEqual([]);
});

test('Task 10: the lazy architecture has a full vector and pans horizontally on mobile', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('./#overview');
  const image = page.locator('.architecture img');
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('loading', 'lazy');
  await expect(image).toHaveAttribute('alt', /Figure 2: one decoder-only Transformer/);
  await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBe(1860);
  const pan = page.locator('.figure-pan');
  if (testInfo.project.name === 'mobile') {
    expect(await pan.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await pan.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => pan.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  }
  const response = await page.request.get('assets/img/architecture.svg');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<svg');
  await expect(page.locator('.architecture a')).toHaveAttribute('target', '_blank');
  expect(errors).toEqual([]);
});

test('Task 11: permanent results landing and all eight table tabs work with the keyboard', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./#results');
  await expect(page.locator('#results-title')).toBeInViewport();
  await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(105);
  await expect(page.locator('.number-card')).toHaveCount(3);
  await expect(page.locator('.number-card').nth(0)).toContainText('13.7% stable');
  await expect(page.locator('.number-card').nth(0)).toContainText('33M parameters; PLaID++ is a 7B post-trained model');
  await expect(page.locator('.number-card').nth(1)).toContainText('161novel unique templates');
  await expect(page.locator('.number-card').nth(2)).toContainText('25.25%');
  for (const number of await page.locator('.metric-secondary [data-number]').all()) {
    const styles = await number.evaluate((el) => ({
      display: getComputedStyle(el).display,
      numberSize: getComputedStyle(el).fontSize,
      metricSize: getComputedStyle(el.parentElement).fontSize,
    }));
    expect(styles.display).toBe('inline');
    expect(styles.numberSize).toBe(styles.metricSize);
  }
  await page.locator('#paper-tables summary').click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(8);
  await tabs.first().focus();
  const counts = [14, 8, 13, 5, 8, 4, 12, 4];
  for (let i = 0; i < 8; i += 1) {
    await expect(tabs.nth(i)).toBeFocused();
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('tbody tr:not(.table-group)')).toHaveCount(counts[i]);
    await page.keyboard.press('ArrowRight');
  }
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.first()).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Task 12: the paper thumbnail, abstract summary and hero actions are complete', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./#paper');
  const thumbnail = page.locator('.paper-thumbnail img');
  await expect.poll(() => thumbnail.evaluate((img) => img.naturalWidth)).toBe(429);
  await expect(thumbnail).toHaveAttribute('height', '555');
  await expect(page.locator('.paper-thumbnail')).toHaveAttribute('href', 'https://arxiv.org/abs/2610.27762');
  await expect(page.locator('.paper-summary')).toContainText('one autoregressive sequence');
  const buttons = page.locator('.actions .btn');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(0)).toHaveClass(/btn--primary/);
  await expect(buttons.nth(0)).toContainText('Paper');
  await expect(buttons.nth(1)).toContainText('Code');
  await expect(buttons.nth(2)).toHaveAttribute('href', '#cite');
  expect(errors).toEqual([]);
});

test('Task 11: a direct paper permalink settles after delayed story initialization', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  let release;
  let requested = false;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/data/crystals/denovo-75.json', async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto('./#results', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(true);
    release();
    await expect.poll(() => page.evaluate(() => window.__crystalar?.story?.mode))
      .toBe(testInfo.project.name === 'desktop' ? 'scrolly' : 'stepper');
    await expect(page.locator('#results-title')).toBeInViewport();
    await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(105);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

async function axe(page, testInfo, label) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ url: '/Project-CrystalAR/node_modules/axe-core/axe.min.js' });
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }));
  await writeFile(testInfo.outputPath(`axe-${label}.json`), JSON.stringify(result, null, 2));
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)), label).toEqual([]);
}

test('Task 13: axe finds no serious or critical issues on the page and all result tables', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#results');
  await axe(page, testInfo, 'page');
  await page.locator('#paper-tables summary').click();
  await expect(page.getByRole('tab')).toHaveCount(8);
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    await axe(page, testInfo, (await tab.textContent()).replaceAll(' ', '-'));
  }
  expect(errors).toEqual([]);
});

test('Task 13: axe also checks an open crystal dialog', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#crystals');
  await page.locator('.card-open').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await axe(page, testInfo, 'dialog');
  expect(errors).toEqual([]);
});

test('Task 13: a deep custom 404 keeps its assets and home link under the project subpath', async ({ page }, testInfo) => {
  await page.goto('./not/a/real/page');
  const response = await page.reload();
  expect(response.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('This page is missing.');
  const home = page.getByRole('link', { name: 'Back to CrystalAR' });
  await expect(home).toHaveAttribute('href', '/Project-CrystalAR/');
  expect(await page.locator('.btn').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  for (const url of ['assets/css/site.css', 'assets/img/favicon.svg']) expect((await page.request.get(url)).status()).toBe(200);
  await axe(page, testInfo, '404');
  await home.click();
  await expect(page.locator('.hero-sub')).toBeVisible();
});

test('Task 13: the published poster tool can export responsive images under its CSP', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('tools/poster.html');
  await page.waitForFunction(() => window.__poster?.items?.length > 0);
  const result = await page.evaluate(async () => {
    const url = await window.__poster.renderItem('hero:600');
    const bytes = Uint8Array.from(atob(url.split(',')[1]), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
    return { webp: url.startsWith('data:image/webp;base64,'), width: bitmap.width };
  });
  expect(result.webp).toBe(true);
  expect(result.width).toBe(600);
  expect(errors).toEqual([]);
});

test.describe('native tables without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('Task 11: all table values remain available through native details', async ({ page }) => {
    await page.goto('./#results');
    await page.locator('#paper-tables summary').click();
    await expect(page.locator('[data-paper-table]')).toHaveCount(8);
    for (const panel of await page.locator('[data-paper-table]').all()) await expect(panel).toBeVisible();
    await expect(page.locator('[data-table-tabs]')).toBeHidden();
  });
});

test('review: axe also checks the architecture viewer at 200 percent zoom', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('./#overview');
  await page.locator('[data-figure-open]').click();
  await page.locator('[data-figure-zoom="2"]').click();
  await axe(page, testInfo, 'figure-viewer');
  expect(errors).toEqual([]);
});
