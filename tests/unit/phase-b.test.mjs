import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { manifoldSvg, methodSvg } from '../../js/lib/illustrations.js';

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
const html = await read('index.html');
const data = JSON.parse(await read('data/numbers.json'));
const site = JSON.parse(await read('data/site.json'));

test('Task 9: positional diagrams cover exactly ranks 0–3 with accessible SVG', () => {
  for (let rank = 0; rank <= 3; rank += 1) {
    const svg = manifoldSvg(rank);
    assert.match(svg, new RegExp(`data-rank="${rank}"`));
    assert.match(svg, /role="img" aria-label="[^"]+"/);
    assert.ok(html.includes(svg), `rank ${rank} has a static fallback`);
    assert.equal(manifoldSvg(rank), svg);
  }
  for (const rank of [-1, 4, 1.5, NaN]) assert.throws(() => manifoldSvg(rank));
});

test('Task 9: three distinct method loops are available without JavaScript', () => {
  const svgs = ['template', 'lattice', 'coordinates'].map(methodSvg);
  assert.equal(new Set(svgs).size, 3);
  for (const svg of svgs) assert.ok(html.includes(svg));
  assert.throws(() => methodSvg('unknown'));
  assert.equal((html.match(/data-method-cycle/g) ?? []).length, 3);
});

test('Task 10: vector and lazy preview have explicit dimensions and local URLs', async () => {
  assert.match(html, /href="assets\/img\/architecture\.svg" target="_blank"/);
  assert.match(html, /src="assets\/img\/architecture\.webp" width="1860" height="406" loading="lazy"[^>]*alt="Figure 2:/);
  for (const [file, limit] of [['architecture.svg', 300_000], ['architecture.webp', 80_000], ['paper-v1.webp', 60_000]]) {
    const bytes = (await stat(new URL(`../../assets/img/${file}`, import.meta.url))).size;
    assert.ok(bytes > 1000 && bytes < limit, `${file}: ${bytes}`);
  }
});

test('Task 11: the complete eight result tables retain their source coordinates', () => {
  assert.deepEqual(data.tables.map((t) => t.number), [1, 2, 3, 6, 7, 8, 9, 10]);
  assert.equal(data.paper, 'arXiv:2610.27762v1');
  for (const table of data.tables) {
    assert.ok(table.caption.startsWith(`Table ${table.number}:`));
    assert.ok(table.page > 0);
    table.rows.forEach((row, ri) => {
      assert.equal(row.values.length + 1, table.columns.length);
      row.values.forEach((value, ci) => {
        assert.ok(html.includes(`data-number="t${table.number}-r${ri}-c${ci + 1}">`), `${value} is bound`);
      });
    });
  }
  const cell = ([n, r, c]) => data.tables.find((t) => t.number === n).rows[r].values[c - 1];
  assert.deepEqual(Object.values(data.highlights).map(cell), ['13.7', '3.7', '12.4', '33M', '7B', '161', '0.28', '62.92', '25.25']);
});

test('Task 12: seven sections have consistent numbering and the paper has no placeholders', () => {
  const sectionIds = ['problem', 'overview', 'method', 'story', 'crystals', 'results', 'paper'];
  sectionIds.forEach((id, i) => {
    const section = html.slice(html.indexOf(`id="${id}"`));
    assert.match(section.match(/<p class="kicker[^>]*>(.*?)<\/p>/s)[1], new RegExp(`0${i + 1}`));
  });
  assert.doesNotMatch(html, /\bDraft\b|Abstract follows in the next phase/);
  assert.match(html, /class="paper-thumbnail"[^>]*data-config-href="arxivUrl"/);
  assert.match(html, /src="assets\/img\/paper-v1\.webp" width="429" height="555" loading="lazy"/);
});

test('Task 13: scholarly metadata, sharing and CSP describe the same publication', async () => {
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  const article = JSON.parse(json);
  assert.equal(article['@type'], 'ScholarlyArticle');
  assert.equal(article.url, 'https://crssbl.github.io/Project-CrystalAR/');
  assert.equal(article.sameAs, site.arxivUrl);
  assert.equal(article.identifier, 'arXiv:2610.27762');
  assert.deepEqual(article.author.map((a) => a.name), site.authors.map((a) => a.name));
  assert.equal(article.venue, undefined);
  assert.equal(article.publication, undefined);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replaceAll('&#39;', "'");
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(json).digest('base64')}'`));
  for (const kind of ['default', 'img', 'font', 'connect']) assert.ok(csp.includes(`${kind}-src 'self'`));
  assert.doesNotMatch(csp, /https?:|data:|unsafe-eval/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const [name, width, height] of [['og.png', 1200, 630], ['apple-touch-icon.png', 180, 180]]) {
    const png = await readFile(new URL(`../../assets/img/${name}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  }
  assert.ok((await read('sitemap.xml')).includes(`<loc>${site.canonicalUrl}</loc>`));
  assert.ok((await read('robots.txt')).includes(`Sitemap: ${site.canonicalUrl}sitemap.xml`));
});

test('Task 13: custom 404 uses only subpath-safe links and remains indexable only at home', async () => {
  const missing = await read('404.html');
  assert.match(missing, /name="robots" content="noindex"/);
  for (const [, link] of missing.matchAll(/href="([^"]+)"/g)) assert.ok(link.startsWith('/Project-CrystalAR/'));
  assert.match(missing, /href="\/Project-CrystalAR\/">Back to CrystalAR/);
});

test('Task 13: inline fonts resolve under the project subpath and hero preload matches responsive sources', async () => {
  const inline = html.match(/<style>(.*?)<\/style>/s)[1];
  assert.doesNotMatch(inline, /\.\.\/fonts\//);
  assert.match(inline, /url\(assets\/fonts\/sora-latin-600-normal\.woff2\)/);
  assert.equal(inline.replaceAll('assets/fonts/', '../fonts/'), (await read('assets/css/site.min.css')).trim(), 'home and 404 use the same styles and palette');
  const preloads = [...html.matchAll(/<link\s[^>]*as="image"[^>]*>/g)];
  assert.equal(preloads.length, 1, 'avoid preloading the full poster as well as a responsive one');
  const img = html.match(/<img class="hero-poster"[^>]+>/)[0];
  assert.equal(preloads[0][0].match(/imagesrcset="([^"]+)"/)[1], img.match(/srcset="([^"]+)"/)[1]);
  assert.equal(preloads[0][0].match(/imagesizes="([^"]+)"/)[1], img.match(/sizes="([^"]+)"/)[1]);
});

test('review: accuracy fixes retain the experiment conditions and free-coordinate distinction', () => {
  assert.match(html, /Predict structures from composition and a given space group, without retrieving a Wyckoff template\./);
  assert.match(html, /jointly refines the free coordinates through nine dyadic levels\./);
  assert.match(html, /fixed sites need no refinement, while all free coordinates are refined jointly/);
  assert.match(html, /S\.U\.N\. means stable, unique and novel; S\.S\.U\.N\. additionally requires a space group other than P1\./);
  assert.match(html, /These numbers come from arXiv v1 and cover/);
  assert.match(data.tables[2].caption, /single-hypothesis result\./);
  assert.equal(html.match(/class="paper-summary">([^<]+)/)[1].split('. ').length, 3);
});

test('review: the compact bootstrap preserves optional feature URLs and has no helper round trips', async () => {
  assert.match(html, /src="js\/main\.min\.js"/);
  const bundle = await read('js/main.min.js');
  assert.doesNotMatch(bundle, /import[^;]*lib\/(?:config|results-landing)\.js/);
  for (const name of ['hero', 'story', 'gallery', 'figure', 'results', 'illustrations']) {
    assert.ok(bundle.includes(`./${name}${['story', 'gallery'].includes(name) ? '.min' : ''}.js`), `${name} remains optional`);
  }
  assert.match(bundle, /result tabs unavailable/);
});
