import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteConfigHtml } from '../../tools/render-gallery.mjs';
import { readFile } from 'node:fs/promises';
import { configVisibility, safeHttpUrl, applyConfig, isHrefKey, OPTIONAL_KEYS } from '../../js/lib/config.js';

const site = JSON.parse(await readFile(new URL('../../data/site.json', import.meta.url), 'utf8'));

// A minimal stand-in for the DOM: elements with attributes, and a root that finds them by the
// attribute selectors applyConfig uses ('[data-config-href]', …).
const fakeElement = (attrs) => ({
  attrs: { ...attrs },
  hidden: 'hidden' in attrs,
  textContent: '',
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
  setAttribute(name, value) { this.attrs[name] = String(value); },
});
const fakeRoot = (all) => ({
  querySelectorAll(selector) {
    const name = selector.slice(1, -1);
    return all.filter((e) => e.getAttribute(name) !== null);
  },
});

// The three bindings index.html uses for an optional link: an element that is both shown and
// pointed by the key (header pill, hero button), a wrapper that is only shown (the <li> in the
// paper section), and a link that is only pointed.
function fakePage(key, fallback) {
  const both = fakeElement({ 'data-config-requires': key, 'data-config-href': key, href: fallback, hidden: '' });
  const wrapper = fakeElement({ 'data-config-requires': key, hidden: '' });
  const link = fakeElement({ 'data-config-href': key, href: fallback });
  return { both, wrapper, link, ...fakeRoot([both, wrapper, link]) };
}

// A Code link as in index.html: pointed by codeUrl, never hidden by it, with a static href.
const CODE_HREF = 'https://github.com/crssbl/CrystalAR';
const codeLink = () => fakeElement({ 'data-config-href': 'codeUrl', href: CODE_HREF });

test('optional UI is hidden while arxivUrl, bibtex and venue are null', () => {
  assert.deepEqual(OPTIONAL_KEYS, ['arxivUrl', 'bibtex', 'venue']);
  const unset = { ...site, arxivUrl: null, bibtex: null, venue: null };
  assert.deepEqual(configVisibility(unset), { arxivUrl: false, bibtex: false, venue: false });
});

test('published config links to arXiv and contains its citation without a venue', () => {
  assert.equal(site.arxivUrl, 'https://arxiv.org/abs/2610.27762');
  assert.equal(site.venue, null);
  assert.deepEqual(configVisibility(site), { arxivUrl: true, bibtex: true, venue: false });
  assert.match(site.bibtex, /^@misc\{meng2026crystalar,/);
  for (const [key, value] of Object.entries({ title: site.title, year: '2026', eprint: '2610.27762',
    archivePrefix: 'arXiv', primaryClass: 'cs.AI', url: site.arxivUrl })) {
    assert.ok(site.bibtex.includes(`${key}${' '.repeat(14 - key.length)}= {${value}}`), key);
  }
});

test('optional UI appears once a value is configured', () => {
  const filled = { ...site, arxivUrl: 'https://arxiv.org/abs/0000.00000', bibtex: '@article{x}', venue: 'Somewhere' };
  assert.deepEqual(configVisibility(filled), { arxivUrl: true, bibtex: true, venue: true });
  assert.deepEqual(configVisibility({ ...site, venue: '  ' }).venue, false);
});

test('only http(s) links are accepted from the config', () => {
  assert.equal(safeHttpUrl('https://github.com/crssbl/CrystalAR'), 'https://github.com/crssbl/CrystalAR');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl('not a url'), null);
});

test('a link is shown only with a usable http(s) URL, and then points to it', (t) => {
  t.mock.method(console, 'warn', () => {}); // the rejected values are reported; see below
  const cases = [
    ['https://arxiv.org/abs/2501.00001', true],
    ['http://example.org/paper', true],
    ['arxiv.org/abs/2501.00001', false], // protocol missing
    ['/abs/2501.00001', false], // relative path
    ['#paper', false],
    ['javascript:alert(1)', false],
    ['mailto:someone@example.org', false],
    ['   ', false],
    [null, false],
    [undefined, false],
  ];
  for (const [value, ok] of cases) {
    const label = JSON.stringify(value) ?? 'undefined';
    const page = fakePage('arxivUrl', '#paper');
    const visible = applyConfig(page, { ...site, arxivUrl: value });
    assert.equal(visible.arxivUrl, ok, label);
    assert.equal(page.both.hidden, !ok, label);
    assert.equal(page.wrapper.hidden, !ok, label);
    const expected = ok ? safeHttpUrl(value) : '#paper';
    assert.equal(page.both.getAttribute('href'), expected, label);
    assert.equal(page.link.getAttribute('href'), expected, label);
    // Never a visible link that points anywhere but the configured http(s) URL.
    if (!page.both.hidden) assert.match(page.both.getAttribute('href'), /^https?:\/\//, label);
  }
});

test('a link value that is set but not an http(s) URL is reported once per key, with its value', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const messages = () => warn.mock.calls.map((call) => call.arguments.join(' '));
  // The committed config, unset values and usable URLs say nothing.
  const clean = fakePage('arxivUrl', '#paper');
  applyConfig(fakeRoot([clean.both, clean.wrapper, clean.link, codeLink()]), site);
  for (const value of [null, undefined, '', '   ', 'https://arxiv.org/abs/2501.00001']) {
    applyConfig(fakePage('arxivUrl', '#paper'), { ...site, arxivUrl: value });
  }
  assert.deepEqual(messages(), []);
  // Three elements bind arxivUrl; a value without its scheme is still reported once, by key and value.
  const page = fakePage('arxivUrl', '#paper');
  applyConfig(page, { ...site, arxivUrl: 'arxiv.org/abs/2501.00001' });
  assert.deepEqual(messages(), ['[crystalar] ignoring site.json arxivUrl: "arxiv.org/abs/2501.00001" is not an http(s) URL']);
  assert.equal(page.both.hidden, true);
  // One warning per rejected key, for every key ending in Url; text values are not links.
  warn.mock.resetCalls();
  applyConfig(fakePage('arxivUrl', '#paper'), {
    ...site, arxivUrl: '#paper', codeUrl: 'javascript:void(0)', slidesUrl: '/slides.pdf', bibtex: '@misc{x}', venue: 'Somewhere',
  });
  assert.deepEqual(messages().sort(), [
    '[crystalar] ignoring site.json arxivUrl: "#paper" is not an http(s) URL',
    '[crystalar] ignoring site.json codeUrl: "javascript:void(0)" is not an http(s) URL',
    '[crystalar] ignoring site.json slidesUrl: "/slides.pdf" is not an http(s) URL',
  ]);
});

test('the Code links always show: codeUrl only re-points them; bibtex and venue only need a non-empty value', (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.deepEqual(['codeUrl', 'arxivUrl', 'bibtex', 'venue'].map(isHrefKey), [true, true, false, false]);
  // codeUrl is not an optional key: nothing about the Code links is hidden or shown by it.
  for (const codeUrl of [site.codeUrl, 'github.com/crssbl/CrystalAR', 'javascript:void(0)', null]) {
    assert.equal('codeUrl' in configVisibility({ ...site, codeUrl }), false, String(codeUrl));
  }
  // A usable codeUrl re-points the Code links.
  const moved = codeLink();
  applyConfig(fakeRoot([moved]), { ...site, codeUrl: 'https://example.org/code' });
  assert.equal(moved.getAttribute('href'), 'https://example.org/code');
  assert.equal(moved.hidden, false);
  // A broken or missing codeUrl keeps the working static href from the HTML, still shown.
  for (const codeUrl of ['not a url', 'github.com/crssbl/CrystalAR', 'javascript:void(0)', '', null]) {
    const link = codeLink();
    applyConfig(fakeRoot([link]), { ...site, codeUrl });
    assert.equal(link.getAttribute('href'), CODE_HREF, String(codeUrl));
    assert.equal(link.hidden, false, String(codeUrl));
  }
  // Text values are not URLs and are not judged as links.
  const text = configVisibility({ ...site, arxivUrl: null, bibtex: '@article{crystalar, title={CrystalAR}}', venue: 'Somewhere' });
  assert.equal(text.bibtex, true);
  assert.equal(text.venue, true);
  assert.equal(text.arxivUrl, false);
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
  assert.equal(site.codeUrl, 'https://github.com/crssbl/CrystalAR');
  const bibtexAuthors = site.bibtex.match(/author\s*=\s*\{([^}]+)\}/)[1];
  assert.equal(bibtexAuthors, site.authors.map((author) => author.name).join(' and '));
});

test('the static HTML carries the same authors and links as site.json', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const author of site.authors) {
    const href = author.url.replaceAll('&', '&amp;');
    assert.ok(html.includes(`<a href="${href}" target="_blank" rel="noopener">${author.name}</a>`), author.name);
    const marks = `${author.affiliation}${author.equal ? '*' : ''}${author.corresponding ? '†' : ''}`;
    assert.ok(html.includes(`${author.name}</a><sup>${marks}</sup>`), `${author.name}: ${marks}`);
  }
  assert.match(html, /<p class="notes">[\s\S]*?<sup>\*<\/sup>Equal contribution[\s\S]*?<sup>†<\/sup>Corresponding author[\s\S]*?<\/p>/);
  assert.doesNotMatch(html, /mailto:/i);
  // The static state mirrors the actual config for readers without JS.
  const optional = html.match(/<[^>]*data-config-requires="[^"]+"[^>]*>/g) ?? [];
  assert.ok(optional.length >= 4);
  for (const tag of optional) {
    const key = tag.match(/data-config-requires="([^"]+)"/)[1];
    assert.equal(/\shidden(\s|>|$)/.test(tag), !configVisibility(site)[key], tag);
  }
  assert.equal(siteConfigHtml(html, site), html, 'generated config is in sync');
  const unset = siteConfigHtml(html, { ...site, arxivUrl: null, bibtex: null, venue: null });
  for (const tag of unset.match(/<[^>]*data-config-requires="[^"]+"[^>]*>/g)) {
    assert.match(tag, /\shidden(\s|>|$)/, tag);
  }
  assert.ok(!html.includes('data-config-requires="codeUrl"'), 'the Code links are never hidden by the config');
  // The three Code links always show, with the repository as their static fallback href.
  const code = html.match(/<a [^>]*data-config-href="codeUrl"[^>]*>/g) ?? [];
  assert.equal(code.length, 3);
  for (const tag of code) {
    assert.ok(tag.includes(`href="${CODE_HREF}"`), tag);
    assert.doesNotMatch(tag, /\shidden(\s|>|$)/, tag);
  }
  assert.equal(site.codeUrl, CODE_HREF);
});
