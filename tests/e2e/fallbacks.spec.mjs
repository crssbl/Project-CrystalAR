// Fallback paths: no WebGL, a renderer that fails after a successful probe, a lost WebGL
// context, and data files that do not load. Each test allows exactly the console.warn of the
// fallback it provokes, and checks that the warning was logged.
import { test, expect } from '@playwright/test';
import { collectErrors, withoutWebGL, withFailingRenderer, loseContext, expectStillsForEveryStep } from './helpers.mjs';

const ROTATE_HINT = 'Drag the crystal to rotate it, or use the arrow keys when it has focus.';
const NOTE_NOGL = 'This browser cannot show the 3D view, so a still image is shown.';
const NOTE_FAILED = 'The 3D view could not be loaded, so a still image is shown.';
const isThree = (url) => /vendor\/three\//.test(url);
const startHero = (page) => page.evaluate(() => window.dispatchEvent(new Event('scroll')));

async function openCard(page, index) {
  const opener = page.locator('.card').nth(index).locator('.card-open');
  await opener.click();
  await expect(page.locator('[data-dialog]')).toBeVisible();
  return opener;
}

async function expectStillDialog(page, note) {
  const dialog = page.locator('[data-dialog]');
  const poster = dialog.locator('[data-dialog-poster]');
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.locator('[data-dialog-stage] canvas')).toHaveCount(0);
  await expect(dialog.locator('[data-dialog-replay]')).toBeDisabled();
  await expect(dialog.locator('[data-dialog-replay]')).toHaveText('Replay unavailable');
  await expect(dialog.locator('[data-dialog-note]')).toHaveText(note);
}

test.describe('without WebGL', () => {
  test.beforeEach(async ({ page }) => { await withoutWebGL(page); });

  test('the dialog shows the poster, turns replay off and drops the rotate hint', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    const opener = await openCard(page, 1);
    const dialog = page.locator('[data-dialog]');
    await expect(dialog.locator('[data-dialog-title]')).toHaveText('EuP');
    await expectStillDialog(page, NOTE_NOGL);
    await expect(dialog.locator('[data-dialog-poster]')).toHaveAttribute('src', 'assets/img/posters/denovo-1798.webp');
    await expect(dialog.locator('[data-dialog-cif]')).toHaveAttribute('href', 'assets/cif/denovo-1798.cif');
    // Keyboard flow is unchanged: Tab stays inside, Esc closes, focus returns to the card.
    await expect(dialog.locator('[data-dialog-close]')).toBeFocused();
    for (let k = 0; k < 6; k += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('[data-dialog]').contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    // The next crystal starts from the same state.
    await openCard(page, 0);
    await expect(dialog.locator('[data-dialog-title]')).toHaveText('La5Bi3Cl');
    await expectStillDialog(page, NOTE_NOGL);
    expect(await page.evaluate(() => window.__crystalar.dialog.still)).toBe('nogl');
    expect(errors).toEqual([]);
  });

  test('the hero stays the poster and never loads three.js', async ({ page }) => {
    const errors = collectErrors(page);
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('./');
    await startHero(page);
    await page.waitForFunction(() => window.__crystalar?.hero?.state === 'no-webgl', null, { timeout: 15_000 });
    await expect(page.locator('[data-hero-stage] canvas')).toHaveCount(0);
    await expect(page.locator('[data-hero-stage]')).not.toHaveClass(/is-live/);
    await expect(page.locator('.hero-poster')).toBeVisible();
    expect(requests.filter(isThree)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('renderer construction fails after a successful WebGL probe', () => {
  test.beforeEach(async ({ page }) => { await withFailingRenderer(page); });
  // three.js logs the failed context creation itself before it throws.
  const threeError = /THREE\.WebGLRenderer: .*Error creating WebGL context/;

  test('the story falls back to the stills of each step', async ({ page }) => {
    const errors = collectErrors(page, {
      allow: [/\[crystalar\] story 3D unavailable/, /\[crystalar\] hero loop unavailable/], allowErrors: [threeError],
    });
    await page.goto('./');
    await page.locator('#story').scrollIntoViewIfNeeded();
    await expect(page.locator('.story')).toHaveClass(/is-nogl/, { timeout: 15_000 });
    await expect(page.locator('[data-story-stage] canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__crystalar.storyView ?? null)).toBeNull();
    await expectStillsForEveryStep(page);
    expect(errors).toEqual([]);
    expect(errors.allowed.some((w) => /story 3D unavailable/.test(w))).toBe(true);
  });

  test('the hero keeps its poster and the dialog its still', async ({ page }) => {
    // Passing the story on the way to the gallery makes its stage fail the same way.
    const errors = collectErrors(page, {
      allow: [/\[crystalar\] hero loop unavailable/, /\[crystalar\] 3D view unavailable/, /\[crystalar\] story 3D unavailable/],
      allowErrors: [threeError],
    });
    await page.goto('./');
    await startHero(page);
    await expect.poll(() => errors.allowed.some((w) => /hero loop unavailable/.test(w)), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.hero-poster')).toBeVisible();
    await expect(page.locator('[data-hero-stage]')).not.toHaveClass(/is-live/);
    await expect(page.locator('[data-hero-stage] canvas')).toHaveCount(0);
    await openCard(page, 2);
    await expectStillDialog(page, NOTE_FAILED);
    expect(await page.evaluate(() => window.__crystalar.hero.state)).toBe('failed');
    expect(errors).toEqual([]);
    expect(errors.allowed.some((w) => /hero loop unavailable/.test(w))).toBe(true);
    expect(errors.allowed.some((w) => /3D view unavailable/.test(w))).toBe(true);
  });
});

test.describe('WebGL context loss', () => {
  test('the story stage falls back to the stills and keeps them after a restore', async ({ page }) => {
    const errors = collectErrors(page, { allow: [/\[crystalar\] story 3D context lost/] });
    await page.goto('./');
    await page.locator('[data-story-stage]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => (window.__crystalar?.storyView?.rendered ?? 0) > 0, null, { timeout: 20_000 });
    const p = await page.evaluate(async () => (await import('./js/lib/story-timeline.js')).stepSettled(3));
    await page.evaluate((v) => window.__crystalar.story.goTo(v, { animate: false }), p);
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', '3');
    await loseContext(page, 'storyView');
    await expect(page.locator('.story')).toHaveClass(/is-nogl/);
    await expect(page.locator('[data-story-stage] canvas')).toHaveCount(0);
    const still = page.locator('[data-story-still]');
    await expect(still).toBeVisible();
    await expect(still).toHaveAttribute('src', 'assets/img/story/step-4.webp');
    await expect(page.locator('[data-story-caption] .story-caption-site')).toHaveText(['La 6g', 'Bi 6g']);
    await page.evaluate(() => window.__lostContext.restoreContext());
    await page.waitForTimeout(300);
    await expect(still).toBeVisible();
    await expect(page.locator('[data-story-stage] canvas')).toHaveCount(0);
    await expectStillsForEveryStep(page);
    expect(errors).toEqual([]);
    expect(errors.allowed).toHaveLength(1);
  });

  test('the dialog shows the poster again and turns replay off', async ({ page }) => {
    const errors = collectErrors(page, { allow: [/\[crystalar\] dialog 3D context lost/] });
    await page.goto('./');
    await openCard(page, 0);
    await page.waitForFunction(() => window.__crystalar.dialog.view, null, { timeout: 15_000 });
    await expect(page.locator('[data-dialog-poster]')).toBeHidden();
    await expect(page.locator('[data-dialog-note]')).toHaveText(ROTATE_HINT);
    await loseContext(page, 'dialog.view');
    await expectStillDialog(page, NOTE_FAILED);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dialog]')).toBeHidden();
    expect(errors).toEqual([]);
    expect(errors.allowed).toHaveLength(1);
  });

  test('the hero shows its poster again', async ({ page }) => {
    const errors = collectErrors(page, { allow: [/\[crystalar\] hero 3D context lost/] });
    await page.goto('./');
    await startHero(page);
    await page.waitForFunction(() => window.__crystalar?.hero?.state === 'live', null, { timeout: 20_000 });
    await loseContext(page, 'heroView');
    await expect(page.locator('[data-hero-stage]')).not.toHaveClass(/is-live/);
    await expect(page.locator('[data-hero-stage] canvas')).toHaveCount(0);
    await expect(page.locator('.hero-poster')).toBeVisible();
    expect(await page.evaluate(() => window.__crystalar.hero.state)).toBe('poster');
    await expect(page.locator('[data-hero-phase]')).toHaveText('generated by CrystalAR');
    expect(errors).toEqual([]);
    expect(errors.allowed).toHaveLength(1);
  });
});

test.describe('data that does not load', () => {
  // The browser reports the provoked 404 itself.
  const notFound = /Failed to load resource: the server responded with a status of 404/;

  test('a failed crystal index shows a message on the card, and the next click retries', async ({ page }) => {
    const errors = collectErrors(page, {
      allow: [/\[crystalar\] crystal data unavailable/], allowErrors: [notFound], allowHttp: [/data\/crystals\/index\.json/],
    });
    let failures = 0;
    await page.route('**/data/crystals/index.json', (route) => {
      if (failures === 0) {
        failures += 1;
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      }
      return route.continue();
    });
    await page.goto('./');
    const card = page.locator('.card').first();
    await card.locator('.card-open').click();
    const status = card.locator('[data-card-status]');
    await expect(status).toHaveText('The crystal data could not be loaded. Please try again.');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('role', 'status');
    await expect(page.locator('[data-dialog]')).toBeHidden();
    expect(failures).toBe(1);
    // Nothing failed was cached: the second click loads the index and opens the dialog.
    await card.locator('.card-open').click();
    await expect(page.locator('[data-dialog]')).toBeVisible();
    await expect(page.locator('[data-dialog-title]')).toHaveText('La5Bi3Cl');
    await expect(status).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(errors.allowed.filter((w) => /crystal data unavailable/.test(w))).toHaveLength(1);
  });

  test('a failed trace keeps the dialog usable with its poster and a message', async ({ page }) => {
    const errors = collectErrors(page, {
      allow: [/\[crystalar\] 3D view unavailable/], allowErrors: [notFound], allowHttp: [/data\/crystals\/denovo-1798\.json/],
    });
    await page.route('**/data/crystals/denovo-1798.json', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
    await page.goto('./');
    await openCard(page, 1);
    const dialog = page.locator('[data-dialog]');
    await expect(dialog.locator('[data-dialog-title]')).toHaveText('EuP');
    await expectStillDialog(page, NOTE_FAILED);
    await expect(dialog.locator('[data-dialog-hull] dd')).toHaveCount(3);
    await expect(dialog.locator('[data-dialog-cif]')).toHaveAttribute('href', 'assets/cif/denovo-1798.cif');
    await page.keyboard.press('Escape');
    // Other crystals are not affected.
    await openCard(page, 0);
    await page.waitForFunction(() => window.__crystalar.dialog.view, null, { timeout: 15_000 });
    await expect(dialog.locator('[data-dialog-replay]')).toBeEnabled();
    await expect(dialog.locator('[data-dialog-note]')).toHaveText(ROTATE_HINT);
    expect(errors).toEqual([]);
    expect(errors.allowed.filter((w) => /3D view unavailable/.test(w))).toHaveLength(1);
  });
});
