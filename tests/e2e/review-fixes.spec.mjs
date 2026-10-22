import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { collectErrors, canvasInkFraction, storyScreenBounds, atomPixelWidth } from './helpers.mjs';

const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('review: the body renders IBM Plex Sans, with real Latin and Greek weight faces', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(async () => {
    const out = [];
    for (const weight of ['400', '500', '600']) {
      for (const text of ['CrystalAR', 'Δ']) {
        const loaded = await document.fonts.load(`${weight} 16px "IBM Plex Sans"`, text);
        out.push(loaded.map((font) => ({ family: font.family, weight: font.weight, status: font.status })));
      }
    }
    return out;
  });
  for (const [i, loaded] of faces.entries()) {
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every((face) => face.family.includes('IBM Plex Sans') && face.status === 'loaded' && face.weight === ['400','500','600'][Math.floor(i / 2)])).toBe(true);
  }
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.hero-dek' });
  const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(fonts.some((font) => font.isCustomFont && font.familyName === 'IBM Plex Sans' && font.glyphCount > 20)).toBe(true);
  expect(fonts.every((font) => font.isCustomFont)).toBe(true);
  await page.evaluate(async () => {
    const probe = document.createElement('span');
    probe.id = 'symbol-font-probe';
    probe.textContent = '†₃↗';
    probe.style.fontFamily = getComputedStyle(document.querySelector('.hero-dek')).fontFamily;
    document.querySelector('.hero-copy').append(probe);
    await document.fonts.load('400 16px "CrystalAR Symbols"', '†₃↗');
  });
  const symbol = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#symbol-font-probe' });
  await page.locator('#symbol-font-probe').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await session.send('CSS.getPlatformFontsForNode', { nodeId: symbol.nodeId })).fonts)
    .toEqual([expect.objectContaining({ familyName: 'CrystalAR Symbols', isCustomFont: true, glyphCount: 3 })]);
  await writeFile(testInfo.outputPath('actual-fonts.json'), JSON.stringify({ faces, body: fonts, symbols: (await session.send('CSS.getPlatformFontsForNode', { nodeId: symbol.nodeId })).fonts }, null, 2));
  await page.locator('#symbol-font-probe').evaluate((el) => el.remove());
});

for (const scenario of ['delayed-story', 'click-during-load']) {
  test(`review: results landing survives ${scenario}`, async ({ page }, testInfo) => {
    let releaseStory;
    const storyGate = new Promise((resolve) => { releaseStory = resolve; });
    let requested = false;
    await page.route('**/data/crystals/denovo-75.json', async (route) => { requested = true; await storyGate; await route.continue(); });
    try {
      await page.goto(scenario === 'click-during-load' ? './' : './#results', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => requested).toBe(true);
      if (testInfo.project.name === 'desktop') {
        // The eventual track footprint is reserved before delayed data arrives.
        expect((await page.locator('[data-story-track]').boundingBox()).height).toBeCloseTo(900 * 6.4, 0);
      }
      if (scenario === 'click-during-load') {
        if (testInfo.project.name === 'desktop') await page.locator('#topbar a[href="#results"]').click();
        else await page.evaluate(() => { location.hash = '#results'; });
      }
      releaseStory();
      await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
      await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeGreaterThan(65);
      await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(105);
      const beforeConfig = await page.locator('#results .kicker').boundingBox();
      await frames(page);
      await writeFile(testInfo.outputPath('results-landing.json'), JSON.stringify({ scenario, beforeConfig, afterConfig: await page.locator('#results .kicker').boundingBox(), mode: await page.evaluate(() => window.__crystalar.story.mode) }, null, 2));
      await expect(page.locator('#results-title')).toBeInViewport();
    } finally { releaseStory(); }
  });
}

for (const timing of ['during', 'after']) {
  test(`review: mobile keyboard focus stays visible ${timing} results landing calibration`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the narrow keyboard regression uses the mobile project');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let requested = false;
    await page.route('**/data/crystals/denovo-75.json', async (route) => { requested = true; await gate; await route.continue(); });
    const records = [];
    const visibleFocus = async (control, label) => {
      await frames(page);
      await expect(control).toBeFocused();
      const box = await control.boundingBox();
      expect(box.y, label).toBeGreaterThanOrEqual(60);
      expect(box.y + box.height, label).toBeLessThanOrEqual(844);
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, label).toBeLessThanOrEqual(390);
      records.push({ label, ...box });
    };
    try {
      await page.goto('./#results', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => requested).toBe(true);
      await expect(page.locator('#results-title')).toBeInViewport();
      if (timing === 'after') {
        release();
        await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
        await page.evaluate(() => document.fonts.ready);
        await frames(page);
      } else expect(await page.evaluate(() => !!window.__crystalar?.story?.mode)).toBe(false);
      const summary = page.locator('#paper-tables summary');
      for (let i = 0; i < 40 && !await summary.evaluate((el) => el === document.activeElement); i++) await page.keyboard.press('Tab');
      await visibleFocus(summary, 'before Enter');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tab')).toHaveCount(8);
      await visibleFocus(summary, 'after Enter');
      await page.keyboard.press('Tab');
      await visibleFocus(page.getByRole('tab').first(), 'Table 1');
      await page.keyboard.press('ArrowRight');
      await visibleFocus(page.getByRole('tab').nth(1), 'Table 2');
      // A late layout shift must not restart calibration or steal the current tab.
      release();
      await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
      await visibleFocus(page.getByRole('tab').nth(1), 'after late story layout');
      await page.keyboard.press('ArrowLeft');
      await visibleFocus(page.getByRole('tab').first(), 'back to Table 1');
      await writeFile(testInfo.outputPath(`keyboard-landing-${timing}.json`), JSON.stringify(records, null, 2));
    } finally { release(); }
  });
}

for (const interaction of ['focus', 'keyboard', 'pointer']) {
  test(`review: ${interaction} permanently stops queued results anchor maintenance`, async ({ page }, testInfo) => {
    await page.goto('./#results');
    await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
    await frames(page);
    await page.evaluate(() => {
      const target = document.getElementById('results');
      window.__landingCalls = 0;
      const original = target.scrollIntoView;
      target.scrollIntoView = function (...args) { window.__landingCalls++; return original.apply(this, args); };
      // Queue a calibration frame before the interaction to cover that race too.
      document.body.style.paddingBottom = '1px';
    });
    if (interaction === 'focus') await page.locator('#paper-tables summary').focus();
    if (interaction === 'keyboard') await page.keyboard.press('Escape');
    if (interaction === 'pointer') await page.mouse.click(testInfo.project.use.viewport.width - 2, 800);
    await frames(page);
    const before = await page.evaluate(() => window.__landingCalls);
    await page.evaluate(() => {
      window.__landingCalls = 0;
      document.body.style.paddingBottom = '2px';
      // A later hash change also must not re-arm maintenance after interaction.
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await frames(page);
    expect(await page.evaluate(() => window.__landingCalls)).toBe(0);
    // The pre-interaction resize may run before Playwright dispatches the input;
    // the assertion above isolates every frame scheduled after that input.
    expect(before).toBeLessThanOrEqual(1);
  });
}

test('review: reader scrolling and navigation away are respected during layout changes', async ({ page }, testInfo) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/data/crystals/denovo-75.json', async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('./#results', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#results-title')).toBeInViewport();
    await page.mouse.wheel(0, 650);
    await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(0);
    release();
    await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
    await frames(page);
    expect((await page.locator('#results .kicker').boundingBox()).y).not.toBeGreaterThan(65);
    if (testInfo.project.name === 'desktop') await page.locator('#topbar a[href="#paper"]').click();
    else await page.evaluate(() => { location.hash = '#paper'; });
    await expect(page).toHaveURL(/#paper$/);
    await expect(page.locator('#paper-title')).toBeInViewport();
  } finally { release(); }
});

test('review: failed results enhancement leaves all native tables readable without an uncaught error', async ({ page }) => {
  const errors = collectErrors(page, { allow: [/result tabs unavailable/], allowErrors: [/Failed to load resource/] });
  await page.route('**/js/results.js', (route) => route.abort());
  await page.goto('./#results');
  await page.locator('#paper-tables summary').click();
  await expect.poll(() => errors.allowed.some((message) => message.includes('result tabs unavailable'))).toBe(true);
  await expect(page.locator('[data-table-tabs]')).toBeHidden();
  for (const table of await page.locator('[data-paper-table]').all()) await expect(table).toBeVisible();
  expect(errors).toEqual([]);
});

test('review: row identities remain visible at the right edge of wide tables', async ({ page }) => {
  await page.goto('./#results');
  await page.locator('#paper-tables summary').click();
  for (const number of [1, 9]) {
    await page.getByRole('tab', { name: `Table ${number}`, exact: true }).click();
    const scroller = page.locator(`#table-${number} .table-scroll`);
    await scroller.scrollIntoViewIfNeeded();
    await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const heading = scroller.locator('tbody th[scope="row"]').first();
    const bounds = await heading.boundingBox();
    expect(Math.abs(bounds.x - (await scroller.boundingBox()).x)).toBeLessThan(3);
    expect(await heading.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await expect(heading).toBeInViewport();
  }
});

test('review: mobile paper summary uses full width and percentage units share the number baseline', async ({ page }, testInfo) => {
  await page.goto('./#paper');
  const summary = await page.locator('.paper-summary').boundingBox();
  if (testInfo.project.name === 'mobile') {
    expect(summary.width).toBeGreaterThan(330);
    const thumbnail = await page.locator('.paper-thumbnail').boundingBox();
    expect(thumbnail.width).toBeGreaterThanOrEqual(120);
    expect(thumbnail.width).toBeLessThanOrEqual(150);
    expect(summary.y).toBeGreaterThan(thumbnail.y + thumbnail.height);
  }
  for (const unit of await page.locator('.metric-unit').all()) {
    const metrics = await unit.evaluate((el) => {
      const u = el.getBoundingClientRect(), n = el.previousElementSibling.getBoundingClientRect();
      return { top: u.top, bottom: u.bottom, numberTop: n.top, numberBottom: n.bottom };
    });
    expect(metrics.top).toBeLessThan(metrics.numberBottom);
    expect(metrics.bottom).toBeGreaterThan(metrics.numberTop);
  }
});

test('review: the vector viewer fits, zooms, pans and restores focus', async ({ page }, testInfo) => {
  await page.goto('./#overview');
  const link = page.locator('[data-figure-open]');
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Figure 2: CrystalAR architecture' });
  await expect(dialog).toBeVisible();
  const image = dialog.locator('img');
  const viewport = dialog.locator('.figure-viewport');
  expect(Math.abs((await image.boundingBox()).width - (await viewport.boundingBox()).width)).toBeLessThan(3);
  expect((await dialog.boundingBox()).height).toBeLessThan(testInfo.project.use.viewport.height * .85 + 1);
  await dialog.getByRole('button', { name: '100%', exact: true }).click();
  expect((await image.boundingBox()).width).toBe(930);
  await dialog.getByRole('button', { name: '200%', exact: true }).click();
  expect((await image.boundingBox()).width).toBe(1860);
  await viewport.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(dialog.getByRole('link', { name: 'Download SVG' })).toHaveAttribute('download', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
  await page.goto('assets/img/architecture.svg');
  await expect(page.locator('svg')).toHaveAccessibleName('Figure 2: CrystalAR architecture');
});

test('review: the close control remains visible at the bottom of a short dialog', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./#crystals');
  await page.waitForFunction(() => !!window.__crystalar?.dialog);
  await page.locator('.card[data-id="denovo:143"] .card-open').click();
  const dialog = page.locator('#crystal-dialog');
  const scroller = dialog.locator('.xdialog-inner');
  await expect(dialog.locator('[data-dialog-relaxation]')).toBeVisible();
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const close = dialog.locator('[data-dialog-close]');
  await expect(close).toBeInViewport();
  const bounds = await close.boundingBox();
  expect(bounds.y).toBeGreaterThan(0);
  expect(bounds.y + bounds.height).toBeLessThan(740);
  await close.click();
  await expect(dialog).toBeHidden();
});

test('review: token text stays opaque while its background animates', async ({ page }) => {
  await page.goto('./#method');
  const card = page.locator('[data-method-cycle]').first();
  await expect(card).toHaveClass(/is-running/);
  const values = await card.locator('.method-token').evaluateAll((groups) => groups.map((group) => ({
    group: getComputedStyle(group).opacity, text: getComputedStyle(group.querySelector('text')).opacity,
    animation: getComputedStyle(group.querySelector('rect')).animationName,
  })));
  expect(values.every((v) => v.group === '1' && v.text === '1' && v.animation === 'write-token')).toBe(true);
});

test('review: portrait tablet keeps a square nonblank stage without changing the story mode', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('./#story');
  await page.waitForFunction(() => window.__crystalar?.story?.mode === 'scrolly');
  await page.evaluate(() => window.__crystalar.story.goTo(.99, { animate: false }));
  const stage = page.locator('.story-stage');
  const bounds = await stage.boundingBox();
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(2);
  await page.waitForFunction(() => !!window.__crystalar?.storyView?.renderer);
  expect(await canvasInkFraction(page, stage.locator('canvas'))).toBeGreaterThan(.005);
  const dimensions = await stage.locator('canvas').evaluate((canvas) => ({ w: canvas.width, h: canvas.height, css: canvas.clientWidth, dpr: devicePixelRatio }));
  expect(dimensions.w).toBe(dimensions.h);
  expect(dimensions.w / dimensions.css).toBeLessThanOrEqual(Math.min(dimensions.dpr, 2) + .05);
});

test('review: tablet camera fits the stage, all steps and rotation without clipping', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'exercise the scrolly sizes with a desktop pointer');
  await page.goto('./');
  await page.waitForFunction(() => window.__crystalar?.story?.mode === 'scrolly');
  const samples = [], occupancy = [];
  for (const [width, height] of [[768, 1024], [834, 1024], [900, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    // Sampling every 2.5% includes all six steps, refinement levels and expansion.
    for (let i = 0; i <= 40; i++) {
      const p = i / 40;
      await page.evaluate((p) => window.__crystalar.story.goTo(p, { animate: false }), p);
      await page.waitForFunction((p) => Math.abs(window.__crystalar.story.progress - p) < .005, p);
      await page.waitForFunction(() => !!window.__crystalar?.storyView?.rendered);
      const poses = (i === 40 ? [-.62, 0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] : [-.62]).map((yaw) => ({ yaw, pitch: .32 }));
      if (width <= 900 && [24, 40].includes(i)) {
        for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
          for (const pitch of [-1.25, -.6, .8, 1.25]) poses.push({ yaw, pitch });
        }
      }
      for (const { yaw, pitch } of poses) {
        await page.evaluate(({ yaw, pitch }) => {
          const view = window.__crystalar.storyView;
          view.setAutoRotate(0); view.yaw = yaw; view.pitch = pitch; view.requestRender();
        }, { yaw, pitch });
        await frames(page);
        const bounds = await storyScreenBounds(page);
        expect(bounds.left).toBeGreaterThan(-1);
        expect(bounds.right).toBeLessThan(1);
        expect(bounds.bottom).toBeGreaterThan(-1);
        expect(bounds.top).toBeLessThan(1);
        for (const label of bounds.labels) {
          expect(label.left).toBeGreaterThanOrEqual(0);
          expect(label.right).toBeLessThanOrEqual(bounds.width);
          expect(label.top).toBeGreaterThanOrEqual(0);
          expect(label.bottom).toBeLessThanOrEqual(bounds.height);
        }
        samples.push({ viewport: { width, height }, p, yaw, pitch, ...bounds });
        if (i === 40 && yaw === -.62 && pitch === .32) {
          const atomWidth = await atomPixelWidth(page, page.locator('.story-canvas'));
          occupancy.push({ width, atomWidth, fraction: atomWidth / Math.min(bounds.width, bounds.height) });
        }
      }
    }
  }
  expect(occupancy[0].atomWidth).toBeGreaterThanOrEqual(245);
  expect(occupancy[0].atomWidth).toBeLessThanOrEqual(280);
  const desktop = occupancy.at(-1).fraction;
  for (const tablet of occupancy.slice(0, -1)) expect(Math.abs(tablet.fraction - desktop)).toBeLessThan(.12);
  await writeFile(testInfo.outputPath('story-framing.json'), JSON.stringify({ occupancy, samples }, null, 2));
});

test('review: keyboard or touch scrolling ends anchor maintenance before delayed layout', async ({ page }, testInfo) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/data/crystals/denovo-75.json', async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('./#results', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(105);
    if (testInfo.project.name === 'mobile') {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 650 }] });
      for (const y of [550, 450, 350, 250, 150]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y }] });
        await frames(page);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.keyboard.press('PageDown');
    await expect.poll(async () => (await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(0);
    release();
    await page.waitForFunction(() => !!window.__crystalar?.story?.mode);
    await frames(page);
    expect((await page.locator('#results .kicker').boundingBox()).y).toBeLessThan(65);
  } finally { release(); }
});
