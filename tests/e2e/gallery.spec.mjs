import { test, expect } from '@playwright/test';
import { collectErrors, canvasInkFraction } from './helpers.mjs';

const ORDER = ['denovo:75', 'denovo:1798', 'denovo:2219', 'denovo:1431', 'denovo:2006', 'denovo:570', 'denovo:143',
  'denovo:53', 'denovo:2435', 'denovo:766', 'denovo:2002', 'denovo:1559', 'denovo:1190'];

test('the relaxation note appears only in its candidate dialog and clears for the next crystal', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const card = page.locator('.card[data-id="denovo:143"]');
  await expect(card).not.toContainText('relaxation raises');
  await card.locator('.card-open').click();
  const note = page.locator('[data-dialog-relaxation]');
  await expect(note).toBeVisible();
  await expect(note).toHaveText('With each of the three MLIPs, relaxation raises the symmetry of this structure from Amm2 (No. 38) to P6₃/mcm (No. 193).');
  await page.keyboard.press('Escape');
  await page.locator('.card').first().locator('.card-open').click();
  await expect(note).toBeHidden();
  await expect(note).toHaveText('');
  expect(errors).toEqual([]);
});

test('thirteen cards in gallery order with poster, formula, space group, hull distances and MLIP count', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(13);
  expect(await cards.evaluateAll((els) => els.map((el) => el.dataset.id))).toEqual(ORDER);
  await page.locator('#crystals').scrollIntoViewIfNeeded();
  for (const card of await cards.all()) {
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('img')).toHaveJSProperty('complete', true);
    expect(await card.locator('img').evaluate((img) => img.naturalWidth)).toBe(640);
    await expect(card.locator('.hull dd')).toHaveCount(3);
    await expect(card.locator('.ssun')).toContainText(/S\.S\.U\.N\. by [123] of 3 MLIPs/);
  }
  await expect(cards.first().locator('.card-title')).toHaveText(/La5Bi3Cl/);
  await expect(cards.first().locator('.hull dd')).toHaveText(['−54.5', '−28.8', '−47.7']);
  await expect(page.locator('.gallery-note')).toContainText('no DFT or experimental validation');
  expect(errors).toEqual([]);
});

test('keyboard: open a card, Tab stays inside the dialog, Esc closes and focus returns', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const opener = page.locator('.card').nth(1).locator('.card-open');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('[data-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-dialog-title]')).toHaveText('EuP');
  await expect(dialog.locator('[data-dialog-close]')).toBeFocused();
  await page.waitForFunction(() => window.__crystalar.dialog.view, null, { timeout: 15_000 });
  for (let k = 0; k < 9; k += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('[data-dialog]').contains(document.activeElement))).toBe(true);
  }
  for (let k = 0; k < 5; k += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.querySelector('[data-dialog]').contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.waitForFunction(() => window.__crystalar.dialog.view === null && window.__crystalar.dialog.open === null);
  expect(await page.locator('[data-dialog-stage] canvas').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('the dialog shows a rotatable 3D crystal and replays its generation to the end', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.locator('.card').first().locator('.card-open').click();
  await page.waitForFunction(() => window.__crystalar.dialog.view, null, { timeout: 15_000 });
  const canvas = page.locator('[data-dialog-stage] canvas');
  await expect(canvas).toBeVisible();
  await page.evaluate(() => window.__crystalar.dialog.view.setAutoRotate(0));
  await page.waitForTimeout(200);
  expect(await canvasInkFraction(page, canvas)).toBeGreaterThan(0.03);
  const yaw0 = await page.evaluate(() => window.__crystalar.dialog.view.yaw);
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__crystalar.dialog.view.yaw)).not.toBe(yaw0);

  await page.locator('[data-dialog-replay]').click();
  await expect(page.locator('[data-dialog-replay]')).toHaveText('Replaying…');
  await expect(page.locator('[data-dialog-phase]')).toContainText('Level', { timeout: 15_000 });
  await page.waitForFunction(() => window.__crystalar.dialog.progress === 1 && !window.__crystalar.dialog.replaying, null, { timeout: 30_000 });
  await expect(page.locator('[data-dialog-phase]')).toContainText('6/6 The crystal');
  await expect(page.locator('[data-dialog-phase]')).toContainText('18 atoms in the cell');
  await expect(page.locator('[data-dialog-replay]')).toHaveText('Replay generation');
  expect(errors).toEqual([]);
});

test('Download CIF serves the generated structure', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.locator('.card').nth(12).locator('.card-open').click();
  const link = page.locator('[data-dialog-cif]');
  await expect(link).toHaveAttribute('href', 'assets/cif/denovo-1190.cif');
  await expect(link).toHaveAttribute('download', 'denovo-1190.cif');
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe('denovo-1190.cif');
  const response = await page.request.get('assets/cif/denovo-1190.cif');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain('# CrystalAR generated structure, sample denovo:1190');
  expect(text).toContain('data_LiVRhO4');
  expect(errors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('replay walks the six steps discretely and ends on the crystal', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.locator('.card').nth(2).locator('.card-open').click();
    await page.waitForFunction(() => window.__crystalar.dialog.view, null, { timeout: 15_000 });
    await page.locator('[data-dialog-replay]').click();
    await page.waitForFunction(() => window.__crystalar.dialog.progress === 1 && !window.__crystalar.dialog.replaying, null, { timeout: 20_000 });
    await expect(page.locator('[data-dialog-phase]')).toContainText('6/6 The crystal');
    expect(errors).toEqual([]);
  });
});

test('mobile layout: two columns, no horizontal overflow, the dialog fits the screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  const errors = collectErrors(page);
  await page.goto('./');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const boxes = await page.locator('.card').evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect().top));
  expect(Math.abs(boxes[0] - boxes[1])).toBeLessThan(1);
  await page.locator('.card').first().locator('.card-open').click();
  await expect(page.locator('[data-dialog]')).toBeVisible();
  const box = await page.locator('[data-dialog]').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
  await expect(page.locator('[data-dialog-replay]')).toBeVisible();
  expect(errors).toEqual([]);
});
