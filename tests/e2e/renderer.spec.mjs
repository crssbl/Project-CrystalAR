import { test, expect } from '@playwright/test';
import { canvasInkFraction, collectErrors } from './helpers.mjs';

test('the story stage renders La5Bi3Cl into a non-blank canvas that rotates on drag', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'drag rotation is covered on desktop');
  const errors = collectErrors(page);
  await page.goto('./');
  await page.locator('[data-story-stage]').scrollIntoViewIfNeeded();
  const canvas = page.locator('[data-story-stage] canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => (window.__crystalar?.storyView?.rendered ?? 0) > 0);
  // Show the finished crystal, then stop the slow auto-rotation so frames are comparable.
  await page.evaluate(() => window.__crystalar.story.goTo(1, { animate: false }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__crystalar.storyView.setAutoRotate(0));
  await page.waitForTimeout(200);
  const ink = await canvasInkFraction(page, canvas);
  expect(ink).toBeGreaterThan(0.02);
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  const info2 = await page.evaluate(() => {
    const v = window.__crystalar.storyView;
    return { dpr: v.renderer.getPixelRatio(), yaw: v.yaw };
  });
  expect(info2.dpr).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('on mobile the story stage paints a non-blank canvas at a pixel ratio of at most 1.5', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  const errors = collectErrors(page);
  await page.goto('./');
  await page.locator('[data-story-stage]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => (window.__crystalar?.storyView?.rendered ?? 0) > 0, null, { timeout: 20_000 });
  const dpr = await page.evaluate(() => window.__crystalar.storyView.renderer.getPixelRatio());
  expect(dpr).toBeLessThanOrEqual(1.5);
  // The finished crystal, without the slow auto-rotation, so the two captures match.
  await page.evaluate(() => window.__crystalar.story.goTo(1, { animate: false }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__crystalar.storyView.setAutoRotate(0));
  await page.locator('[data-story-stage]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const ink = await canvasInkFraction(page, page.locator('[data-story-stage] canvas'));
  expect(ink).toBeGreaterThan(0.02);
  expect(errors).toEqual([]);
});
