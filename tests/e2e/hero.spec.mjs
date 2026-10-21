import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.mjs';

const isThree = (url) => /vendor\/three\//.test(url);
const is3d = (url) => isThree(url) || /js\/render\//.test(url);

async function observePaint(page) {
  await page.addInitScript(() => {
    window.__paint = { lcp: [], cls: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__paint.lcp.push({ tag: e.element?.tagName, cls: e.element?.className ?? '', size: e.size, time: e.startTime });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__paint.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

test('the static poster is the LCP element and the layout does not shift', async ({ page }) => {
  const errors = collectErrors(page);
  await observePaint(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const paint = await page.evaluate(() => window.__paint);
  const last = paint.lcp.at(-1);
  expect(last.tag).toBe('IMG');
  expect(last.cls).toContain('hero-poster');
  expect(paint.cls).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the poster is shown before (and without) any script', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    const poster = page.locator('.hero-poster');
    await expect(poster).toBeVisible();
    expect(await poster.evaluate((img) => img.complete && img.naturalWidth)).toBe(1200);
    expect(errors).toEqual([]);
  });
});

test('three.js loads on idle, the loop plays, and pauses off-screen or in a hidden tab', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__crystalar?.hero?.state === 'live', null, { timeout: 20_000 });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const three = performance.getEntriesByType('resource').find((r) => /vendor\/three\/three\.min\.js/.test(r.name));
    return { dcl: nav.domContentLoadedEventEnd, three: three?.startTime ?? null };
  });
  expect(timing.three).not.toBeNull();
  expect(timing.three).toBeGreaterThan(timing.dcl);
  const frames = () => page.evaluate(() => window.__crystalar.heroView.rendered);
  const f0 = await frames();
  await page.waitForTimeout(700);
  const f1 = await frames();
  expect(f1).toBeGreaterThan(f0 + 5);
  const p1 = await page.evaluate(() => window.__crystalar.hero.progress);
  expect(p1).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const f2 = await frames();
  await page.waitForTimeout(700);
  expect(await frames()).toBeLessThanOrEqual(f2 + 1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const f3 = await frames();
  await page.waitForTimeout(500);
  expect(await frames()).toBeGreaterThan(f3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const f4 = await frames();
  await page.waitForTimeout(700);
  expect(await frames()).toBeLessThanOrEqual(f4 + 1);
  expect(errors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the hero stays a still poster and never loads 3D', async ({ page }) => {
    const errors = collectErrors(page);
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    expect(requests.filter(isThree)).toEqual([]);
    expect(await page.evaluate(() => window.__crystalar?.hero?.state)).toBe('reduced-motion');
    await expect(page.locator('[data-hero-stage] canvas')).toHaveCount(0);
    await expect(page.locator('.hero-poster')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('first-screen transfer without 3D stays under 500 KB', async ({ page }) => {
  const errors = collectErrors(page);
  const sizes = new Map();
  page.on('response', async (response) => {
    const url = response.url();
    if (is3d(url)) return;
    try { sizes.set(url, (await response.body()).length); } catch { /* redirects and aborted requests have no body */ }
  });
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  test.info().annotations.push({ type: 'hero-transfer-bytes', description: String(total) });
  console.log(`hero transfer without 3D: ${(total / 1024).toFixed(1)} KB over ${sizes.size} requests`);
  expect(total).toBeLessThan(500 * 1024);
  expect(errors).toEqual([]);
});
