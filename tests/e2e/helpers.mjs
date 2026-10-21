// Shared helpers for the end-to-end tests.
import { expect } from '@playwright/test';

const STORY_STEPS = 6;
// The sites that the caption under each still lists, in place of the live stage's labels.
const STILL_CAPTIONS = [null, ['Cl 2b', 'La 4d', 'La 6g', 'Bi 6g'], null, ['La 6g', 'Bi 6g'], null, null];
// The alt text of each still: what that step's picture shows.
const STILL_ALTS = [
  'Space group P6₃/mcm (No. 193): an empty cell, with dots where its 24 symmetry operations send one general point.',
  'The Wyckoff template: Cl 2b and La 4d as atoms at fixed points, and the line (x, 0, 1/4) that holds La 6g and Bi 6g.',
  'The hexagonal cell, V = 562.7 Å³ and c/a = 0.690, around the template sites.',
  'Level 9 of 9: La 6g and Bi 6g placed on the line (x, 0, 1/4), each in a region of width 1/512, about 0.019 Å.',
  'Symmetry expansion half-way: the copies of each site spread across its orbit, 2 + 4 + 6 + 6 = 18 atoms, some still growing.',
  'The finished La5Bi3Cl unit cell: 18 atoms of La, Bi and Cl in a hexagonal cell.',
];

/**
 * Story without 3D: walks the six steps and checks that each shows its own pre-rendered still,
 * with an alt text that describes that still, and, where the live stage would label sites, a
 * caption line listing them.
 */
export async function expectStillsForEveryStep(page) {
  const still = page.locator('[data-story-still]');
  const caption = page.locator('[data-story-caption]');
  const alts = [];
  for (let i = 0; i < STORY_STEPS; i += 1) {
    const p = await page.evaluate(async (k) => (await import('./js/lib/story-timeline.js')).stepSettled(k), i);
    await page.evaluate((v) => window.__crystalar.story.goTo(v, { animate: false }), p);
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', String(i));
    await expect(still).toHaveAttribute('src', `assets/img/story/step-${i + 1}.webp`);
    await expect(still).toHaveAttribute('alt', STILL_ALTS[i]);
    alts.push(await still.getAttribute('alt'));
    if (i > 0) expect(alts[i], `the alt text of step ${i + 1} is new`).not.toBe(alts[i - 1]);
    await expect(still).toBeVisible();
    await expect.poll(() => still.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    if (STILL_CAPTIONS[i]) {
      await expect(caption).toBeVisible();
      await expect(caption.locator('.story-caption-site')).toHaveText(STILL_CAPTIONS[i]);
    } else {
      await expect(caption).toBeHidden();
    }
  }
}

/**
 * Collects console errors, console warnings, uncaught exceptions and failed same-origin
 * requests. Every fallback branch of the site logs a console.warn, so a warning fails the test
 * unless it matches `allow`: the fallbacks that the test provokes on purpose. Allowed warnings
 * are kept in `errors.allowed` (not enumerable, so `toEqual([])` ignores it) to check that the
 * fallback did run. `allowErrors` does the same for console errors that a provoked failure
 * makes a library log (three.js reports a failed context creation with console.error), and
 * `allowHttp` lists same-origin URLs that the test answers with an error status.
 */
export function collectErrors(page, { allow = [], allowErrors = [], allowHttp = [] } = {}) {
  const errors = [];
  Object.defineProperty(errors, 'allowed', { value: [], enumerable: false });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      const text = msg.text();
      if (allowErrors.some((pattern) => pattern.test(text))) errors.allowed.push(text);
      else errors.push(`console: ${text}`);
    } else if (type === 'warning') {
      const text = msg.text();
      if (allow.some((pattern) => pattern.test(text))) errors.allowed.push(text);
      else errors.push(`warning: ${text}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (response) => {
    const url = response.url();
    if (url.startsWith('http://127.0.0.1') && response.status() >= 400 && !allowHttp.some((pattern) => pattern.test(url))) {
      errors.push(`http ${response.status()}: ${url}`);
    }
  });
  return errors;
}

/** Makes every WebGL context request fail, as in a browser without WebGL. */
export async function withoutWebGL(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      if (/webgl/i.test(type)) return null;
      return original.call(this, type, ...rest);
    };
  });
}

/**
 * The capability probe gets a WebGL2 context, every context after it fails: the renderer
 * constructor then throws, as when context creation fails on a busy or blocklisted GPU.
 */
export async function withFailingRenderer(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let probed = false;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      if (/webgl/i.test(type)) {
        if (probed) return null;
        probed = true;
      }
      return original.call(this, type, ...rest);
    };
  });
}

/** Loses the WebGL context of a view exposed on window.__crystalar (e.g. 'storyView'). */
export async function loseContext(page, viewPath) {
  await page.evaluate((path) => {
    const view = path.split('.').reduce((o, k) => o?.[k], window.__crystalar);
    const ext = view.renderer.getContext().getExtension('WEBGL_lose_context');
    window.__lostContext = ext;
    ext.loseContext();
  }, viewPath);
}

/** Scrolls through the whole page in steps so lazy content and observers fire. */
export async function scrollThrough(page, { step = 700, pause = 60 } = {}) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(pause);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Fraction of the canvas area that the canvas itself paints: the region is captured with the
 * canvas shown and hidden, and the differing pixels are counted. A blank canvas returns 0.
 */
export async function canvasInkFraction(page, locator) {
  const box = await locator.boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  const shown = await page.screenshot({ clip });
  await locator.evaluate((el) => { el.style.visibility = 'hidden'; });
  const hidden = await page.screenshot({ clip });
  await locator.evaluate((el) => { el.style.visibility = ''; });
  return page.evaluate(async ([a, b]) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const [da, db] = await Promise.all([load(a), load(b)]);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) diff += 1;
    }
    return diff / (da.length / 4);
  }, [shown.toString('base64'), hidden.toString('base64')]);
}
