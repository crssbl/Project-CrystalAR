import { test, expect } from '@playwright/test';
import { painted, collectErrors, canvasInkFraction, withoutWebGL, expectStillsForEveryStep } from './helpers.mjs';

const TITLES = ['Given a space group', 'Wyckoff template', 'Lattice', 'Coarse to fine', 'Symmetry expansion', 'The crystal'];

async function openStory(page) {
  await page.goto('./');
  await page.locator('#story').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__crystalar?.story?.mode);
}

async function settled(page, index) {
  return page.evaluate(async (i) => (await import('./js/lib/story-timeline.js')).stepSettled(i), index);
}

test.describe('desktop: pinned, scroll-driven story', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('each step is reached by scrolling while the stage stays pinned', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator('.story')).toHaveClass(/is-scrolly/);
    await page.waitForFunction(() => window.__crystalar.storyView);
    const tops = [];
    for (let i = 0; i < TITLES.length; i += 1) {
      const p = await settled(page, i);
      await page.evaluate((v) => window.__crystalar.story.goTo(v), p);
      const on = page.locator('.story-step.is-on');
      await expect(on).toHaveCount(1);
      await expect(on).toHaveAttribute('data-step', String(i));
      await expect(on.locator('h3')).toContainText(TITLES[i]);
      tops.push(await page.locator('[data-story-stage]').evaluate((el) => Math.round(el.getBoundingClientRect().top)));
      if (i > 0) await expect(page.locator('[data-story-live]')).toContainText(`Step ${i + 1} of 6: ${TITLES[i]}`);
    }
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
    const ink = await canvasInkFraction(page, page.locator('[data-story-stage] canvas'));
    expect(ink).toBeGreaterThan(0.02);
    expect(errors).toEqual([]);
  });

  test('scrubber keys walk the template sites, all nine levels and the finished crystal', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    const scrubber = page.locator('[data-story-scrubber]');
    await expect(scrubber).toBeVisible();
    await scrubber.focus();
    await page.keyboard.press('Home');
    await painted(page);
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', '0');
    const readouts = [];
    for (let k = 0; k < 30; k += 1) {
      await page.keyboard.press('ArrowRight');
      await painted(page);
      readouts.push(await page.locator('[data-story-readout]').innerText());
    }
    const text = readouts.join('\n');
    for (const site of ['Cl 2b', 'La 4d', 'La 6g', 'Bi 6g']) expect(text).toContain(site);
    expect(text).toContain('V = 562.7 Å³');
    for (let level = 1; level <= 9; level += 1) expect(text).toContain(`Level ${level} / 9`);
    expect(text).toContain('16 joint candidates scored · 4 kept in beam');
    expect(text).toContain('2 + 4 + 6 + 6 = 18 atoms');
    expect(readouts.at(-1)).toContain('18 atoms in the cell');
    await expect(scrubber).toHaveAttribute('aria-valuetext', 'Step 6 of 6: The crystal');
    await page.keyboard.press('Home');
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', '0');
    expect(errors).toEqual([]);
  });

  test('dragging the scrubber shows the matching step and tokens', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await page.locator('[data-story-scrubber]').fill('560');
    await painted(page);
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', '3');
    await expect(page.locator('[data-story-readout]')).toContainText('Level');
    await expect(page.locator('.bit.is-active').first()).toBeVisible();
    await expect(page.locator('.tok.is-active')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('narrow screens: tap-through step cards', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('next and previous walk all six steps; the stage is not pinned', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator('.story')).toHaveClass(/is-stepper/);
    const position = await page.locator('[data-story-pin]').evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe('sticky');
    const next = page.locator('[data-story-next]');
    await expect(next).toBeVisible();
    for (let i = 1; i < TITLES.length; i += 1) {
      await next.click();
      await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', String(i), { timeout: 6000 });
      await expect(page.locator('.story-step.is-on h3')).toContainText(TITLES[i]);
    }
    await page.waitForFunction(() => window.__crystalar.story.progress === 1, null, { timeout: 6000 });
    await expect(next).toBeDisabled();
    await page.locator('[data-story-prev]').click();
    await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', '4', { timeout: 6000 });
    const stage = await page.locator('[data-story-stage]').boundingBox();
    expect(stage.width).toBeGreaterThan(300);
    expect(errors).toEqual([]);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('steps are discrete: buttons jump straight to each settled state', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator('.story')).toHaveClass(/is-stepper/);
    await expect(page.locator('.story')).not.toHaveClass(/is-scrolly/);
    for (let i = 1; i < TITLES.length; i += 1) {
      await page.locator('[data-story-next]').click();
      const p = await page.evaluate(() => window.__crystalar.story.progress);
      const target = i === TITLES.length - 1 ? 1 : await settled(page, i);
      expect(Math.abs(p - target)).toBeLessThan(1e-9);
      await expect(page.locator('.story-step.is-on')).toHaveAttribute('data-step', String(i));
    }
    expect(errors).toEqual([]);
  });
});

test.describe('without WebGL', () => {
  test.beforeEach(async ({ page }) => { await withoutWebGL(page); });

  test('the stage shows a pre-rendered still for every step, with its own alt text and the sites listed under it', async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator('.story')).toHaveClass(/is-nogl/);
    await expect(page.locator('[data-story-stage] canvas')).toHaveCount(0);
    await expectStillsForEveryStep(page);
    expect(errors).toEqual([]);
  });
});
