import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { siteConfigHtml } from '../../tools/render-gallery.mjs';
import { configVisibility, safeHttpUrl, isHrefKey, OPTIONAL_KEYS } from '../../js/lib/config.js';

const site = JSON.parse(await readFile(new URL('../../data/site.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const links = (text, key) => text.match(new RegExp(`<a [^>]*data-config-href="${key}"[^>]*>`, 'g')) ?? [];

test('optional UI is hidden while arxivUrl, bibtex and venue are null', () => {
  assert.deepEqual(OPTIONAL_KEYS, ['arxivUrl', 'bibtex', 'venue']);
  assert.deepEqual(configVisibility({ ...site, arxivUrl: null, bibtex: null, venue: null }), { arxivUrl: false, bibtex: false, venue: false });
  const unset = siteConfigHtml(html, { ...site, arxivUrl: null, bibtex: null, venue: null });
  for (const tag of unset.match(/<[^>]*data-config-requires="[^"]+"[^>]*>/g)) assert.match(tag, /\shidden(\s|>|$)/);
});

test('published config links to arXiv and its citation without a venue', () => {
  assert.equal(site.arxivUrl, 'https://arxiv.org/abs/2610.27762');
  assert.equal(site.venue, null);
  assert.deepEqual(configVisibility(site), { arxivUrl: true, bibtex: true, venue: false });
  assert.match(site.bibtex, /^@misc\{meng2026crystalar,/);
  for (const [key, value] of Object.entries({ title: site.title, year: '2026', eprint: '2610.27762', archivePrefix: 'arXiv', primaryClass: 'cs.AI', url: site.arxivUrl })) {
    assert.ok(site.bibtex.includes(`${key}${' '.repeat(14 - key.length)}= {${value}}`), key);
  }
});

test('optional UI appears once a value is configured', () => {
  assert.deepEqual(configVisibility({ ...site, arxivUrl: 'https://example.org/paper', bibtex: '@misc{x}', venue: 'Somewhere' }), { arxivUrl: true, bibtex: true, venue: true });
  assert.equal(configVisibility({ ...site, venue: '  ' }).venue, false);
  assert.deepEqual(['codeUrl', 'arxivUrl', 'bibtex', 'venue'].map(isHrefKey), [true, true, false, false]);
});

test('only absolute http(s) URLs can generate links', () => {
  for (const value of ['https://example.org/code', 'http://example.org/code']) assert.equal(safeHttpUrl(value), value);
  for (const value of ['example.org/code', '/code', '#code', 'javascript:alert(1)', 'mailto:someone@example.org', 'ftp://example.org/code', '  ', null, undefined]) assert.equal(safeHttpUrl(value), null);
});

test('null codeUrl generates two visible labels, with no href, role or tabindex', () => {
  const generated = siteConfigHtml(html, { ...site, codeUrl: null });
  assert.equal(links(generated, 'codeUrl').length, 0);
  const labels = generated.match(/<span\b[^>]*data-code-label[^>]*>Code · coming soon<\/span>/g) ?? [];
  assert.equal(labels.length, 2);
  for (const label of labels) assert.doesNotMatch(label, /href=|tabindex=|role=|\shidden/);
});

test('a valid codeUrl regenerates all three working links, including from coming-soon HTML', () => {
  const unavailable = siteConfigHtml(html, { ...site, codeUrl: null });
  for (const codeUrl of ['https://example.org/code', 'http://example.org/code']) {
    const generated = siteConfigHtml(unavailable, { ...site, codeUrl });
    assert.equal(links(generated, 'codeUrl').length, 3);
    assert.doesNotMatch(generated, /data-code-label/);
    for (const tag of links(generated, 'codeUrl')) {
      assert.ok(tag.includes(`href="${codeUrl}"`));
      assert.match(tag, /target="_blank" rel="noopener"/);
    }
    assert.equal(siteConfigHtml(generated, { ...site, codeUrl }), generated, 'regeneration is idempotent');
  }
});

test('invalid non-empty codeUrl warns once and downgrades existing links to labels', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const available = siteConfigHtml(html, { ...site, codeUrl: 'https://example.org/code' });
  for (const codeUrl of ['not a url', '/code', 'javascript:void(0)', 'ftp://example.org/code']) {
    warn.mock.resetCalls();
    const generated = siteConfigHtml(available, { ...site, codeUrl });
    assert.equal(links(generated, 'codeUrl').length, 0);
    assert.equal((generated.match(/data-code-label/g) ?? []).length, 2);
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]), [`[crystalar] ignoring site.json codeUrl: ${JSON.stringify(codeUrl)} is not an http(s) URL`]);
  }
  for (const codeUrl of [null, undefined, '', '  ']) {
    warn.mock.resetCalls(); siteConfigHtml(html, { ...site, codeUrl }); assert.equal(warn.mock.callCount(), 0);
  }
});

test('invalid optional URL is hidden and reported once per key', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const generated = siteConfigHtml(html, { ...site, arxivUrl: '#paper' });
  for (const tag of generated.match(/<[^>]*data-config-requires="arxivUrl"[^>]*>/g)) assert.match(tag, /\shidden(\s|>|$)/);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], '[crystalar] ignoring site.json arxivUrl: "#paper" is not an http(s) URL');
});

test('authors and contribution marks match the relayed arXiv v1 author block', () => {
  const expected = [
    ['Ziqiao Meng', 1, true, false, 'NY3OA7sAAAAJ'],
    ['Rongsheng Chen', 2, true, false, '-1sVvh4AAAAJ'],
    ['Zhi Zheng', 1, true, false, 'nxJ4qM4AAAAJ'],
    ['Nikita Kazeev', 1, false, false, 'vamy2okAAAAJ'],
    ['Zhenkun Wang', 2, false, true, 'r9ezy2gAAAAJ'],
    ['Andrey Ustyuzhanin', 1, false, false, 'vfQf9SIAAAAJ'],
    ['Wee Sun Lee', 1, false, true, '8PCrLgwAAAAJ'],
  ];
  assert.equal(site.authors.length, expected.length);
  site.authors.forEach((author, i) => {
    const [name, affiliation, equal, corresponding, user] = expected[i];
    assert.equal(author.name, name);
    assert.equal(author.affiliation, affiliation);
    assert.equal(Boolean(author.equal), equal);
    assert.equal(Boolean(author.corresponding), corresponding);
    assert.equal('email' in author, false);
    assert.equal(author.url, `https://scholar.google.com/citations?user=${user}&hl=en`);
  });
  assert.deepEqual(site.affiliations, ['National University of Singapore', 'Southern University of Science and Technology']);
  const bibtexAuthors = site.bibtex.match(/author\s*=\s*\{([^}]+)\}/)[1];
  assert.equal(bibtexAuthors, site.authors.map((author) => author.name).join(' and '));
});


test('static HTML mirrors authors, contribution marks and generated configuration', () => {
  for (const author of site.authors) {
    const href = author.url.replaceAll('&', '&amp;');
    const marks = `${author.affiliation}${author.equal ? '*' : ''}${author.corresponding ? '†' : ''}`;
    assert.ok(html.includes(`<a href="${href}" target="_blank" rel="noopener">${author.name}</a><sup>${marks}</sup>`), author.name);
  }
  assert.match(html, /<p class="notes">[\s\S]*?<sup>\*<\/sup>Equal contribution[\s\S]*?<sup>†<\/sup>Corresponding author/);
  assert.doesNotMatch(html, /mailto:/i);
  assert.equal(siteConfigHtml(html, site), html, 'generated config is in sync');
  for (const tag of html.match(/<[^>]*data-config-requires="[^"]+"[^>]*>/g)) {
    const key = tag.match(/data-config-requires="([^"]+)"/)[1];
    assert.equal(/\shidden(\s|>|$)/.test(tag), !configVisibility(site)[key]);
  }
});

test('the delivered bootstrap has no runtime site.json dependency', async () => {
  for (const name of ['js/main.js', 'js/main.min.js']) {
    const text = await readFile(new URL('../../' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /data\/site\.json|applyConfig/);
  }
});

test('coming-soon text has AA contrast on the hero and paper backgrounds', async () => {
  const { contrastRatio } = await import('../../js/lib/color.js');
  const { UI } = await import('../../js/lib/palette.js');
  for (const background of [UI.porcelain, UI.paper]) assert.ok(contrastRatio(UI.muted, background) >= 4.5);
});
