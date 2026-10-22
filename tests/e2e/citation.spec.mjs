import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.mjs';

test('the arXiv buttons, BibTeX block and copy button use the published config', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const site = await (await page.request.get('data/site.json')).json();
  const links = page.locator('[data-config-href="arxivUrl"]');
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', site.arxivUrl);
  }
  await page.locator('.actions a[data-config-requires="bibtex"]').click();
  const code = page.locator('.bibtex code');
  await expect(code).toBeVisible();
  await expect(code).toHaveText(site.bibtex);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = page.locator('[data-copy-bibtex]');
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.locator('[data-copy-status]')).toHaveText('Copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(site.bibtex);
  await expect(page.locator('[data-config-requires="venue"]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('if clipboard access is denied the citation is selected for manual copying', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } });
  });
  await page.goto('./');
  await page.locator('.actions a[data-config-requires="bibtex"]').click();
  await page.locator('[data-copy-bibtex]').click();
  await expect(page.locator('[data-copy-status]')).toHaveText('Select the citation text to copy it.');
  const selected = await page.evaluate(() => window.getSelection().toString());
  expect(selected).toBe(await page.locator('.bibtex code').textContent());
  expect(errors).toEqual([]);
});
