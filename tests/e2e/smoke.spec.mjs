import { readFile } from 'node:fs/promises';
import { siteConfigHtml } from '../../tools/render-gallery.mjs';
import { test, expect } from '@playwright/test';
import { painted, collectErrors, scrollThrough } from './helpers.mjs';

const AUTHORS = [
  'Ziqiao Meng', 'Rongsheng Chen', 'Zhi Zheng', 'Nikita Kazeev',
  'Zhenkun Wang', 'Andrey Ustyuzhanin', 'Wee Sun Lee',
];

test('page loads without console errors and shows the hero', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('h1')).toContainText('CrystalAR');
  await expect(page.locator('.hero-sub')).toHaveText('Autoregressive Modeling for Symmetric Crystal Generation');
  await expect(page.locator('.author-list li a')).toHaveText(AUTHORS);
  await expect(page.locator('.affil')).toContainText('National University of Singapore');
  await expect(page.locator('.affil')).toContainText('Southern University of Science and Technology');
  await expect(page.locator('.actions a.btn--primary')).toHaveAttribute('href', 'https://arxiv.org/abs/2610.27762');
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [
    '600 32px Sora', '400 16px "IBM Plex Sans"', '400 13px "IBM Plex Mono"',
  ].map((f) => document.fonts.check(f)));
  expect(fonts).toEqual([true, true, true]);
  await scrollThrough(page);
  await painted(page);
  expect(errors).toEqual([]);
});

test('the corresponding-author daggers and their note match the author block', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('.author-list li a')).toHaveText(AUTHORS);
  await expect(page.locator('.author-list li sup')).toHaveText(['1*', '2*', '1*', '1', '2†', '1', '1†']);
  await expect(page.locator('.notes span')).toHaveText(['*Equal contribution', '†Corresponding author']);
  await expect(page.locator('.notes')).toBeVisible();
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the permanent results section is reached from the top bar or the mobile deep link', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const link = page.locator('#topbar .nav a[href="#results"]');
  if (testInfo.project.name === 'desktop') {
    await expect(link).toBeVisible();
    await link.click();
  } else {
    await expect(link).toBeHidden(); // the section navigation is hidden on narrow screens
    await page.goto('./#results');
  }
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('[id="results"]')).toHaveCount(1);
  await expect(page.locator('section#results .kicker')).toHaveText('06Benchmarks');
  await expect(page.locator('#results-title')).toBeInViewport();
  expect(errors).toEqual([]);
});

test('optional paper links stay hidden while their config is null', async ({ page }) => {
  const errors = collectErrors(page);
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const site = JSON.parse(await readFile(new URL('../../data/site.json', import.meta.url), 'utf8'));
  const generated = siteConfigHtml(html, { ...site, arxivUrl: null, bibtex: null, venue: null });
  await page.route('**/Project-CrystalAR/', (route) => route.fulfill({ body: generated, contentType: 'text/html' }));
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  const optional = page.locator('[data-config-requires]');
  expect(await optional.count()).toBeGreaterThan(0);
  for (const el of await optional.all()) await expect(el).toBeHidden();
  expect(errors).toEqual([]);
});

test('the top bar turns dark only over the dark stage', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const bar = page.locator('#topbar');
  await expect(bar).not.toHaveClass(/is-on-stage/);
  await page.locator('.story-head').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(bar).toHaveClass(/is-on-stage/);
  await page.locator('.gallery').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(bar).not.toHaveClass(/is-on-stage/);
  expect(errors).toEqual([]);
});

test('all page links and assets are relative to the subpath', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const urls = await page.evaluate(() => [...document.querySelectorAll('[href],[src]')]
    .map((el) => el.getAttribute('href') ?? el.getAttribute('src')));
  for (const url of urls) {
    expect(url.startsWith('/'), url).toBe(false);
  }
  expect(errors).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('hero, authors, story text and section headings are readable', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.hero-dek')).toBeVisible();
    await expect(page.locator('.author-list li')).toHaveCount(7);
    await expect(page.locator('.hero-poster')).toBeVisible();
    for (const id of ['problem', 'overview', 'method', 'story', 'crystals', 'results', 'paper']) {
      await expect(page.locator(`#${id} h2`)).toBeVisible();
    }
    await expect(page.locator('.story-step')).toHaveCount(6);
    for (const step of await page.locator('.story-step').all()) await expect(step).toBeVisible();
    for (const link of await page.locator('[data-config-href="arxivUrl"]').all()) {
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', 'https://arxiv.org/abs/2610.27762');
    }
    await expect(page.locator('.bibtex')).toContainText('@misc{meng2026crystalar,');
    await expect(page.locator('[data-copy-bibtex]')).toBeHidden();
    await expect(page.locator('[data-config-requires="venue"]')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
