// The orbit mark: one solid accent site and its two images under a 3-fold rotation.
// No quartered or nested squares, cubes or tree grids in the wordmark, favicon or OG card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
const html = await read('index.html');
const favicon = await read('assets/img/favicon.svg');
const poster = await read('tools/poster.js');
const css = await read('assets/css/site.css');

const circles = (svg) => [...svg.matchAll(/<circle\b([^>]*)\/?>/g)].map((m) => {
  const attr = (name) => (m[1].match(new RegExp(`\\b${name}="([^"]+)"`)) || [])[1];
  return { cx: Number(attr('cx')), cy: Number(attr('cy')), r: Number(attr('r')), fill: attr('fill'), stroke: attr('stroke'), style: attr('style') ?? '' };
});

function assertOrbit(dots, label) {
  assert.equal(dots.length, 3, `${label}: three dots`);
  const cx = dots.reduce((s, d) => s + d.cx, 0) / 3;
  const cy = dots.reduce((s, d) => s + d.cy, 0) / 3;
  const radius = dots.map((d) => Math.hypot(d.cx - cx, d.cy - cy));
  for (const r of radius) assert.ok(Math.abs(r - radius[0]) < 0.02, `${label}: equal distance to the centre`);
  const angles = dots.map((d) => Math.atan2(d.cy - cy, d.cx - cx)).sort((a, b) => a - b);
  const gaps = [angles[1] - angles[0], angles[2] - angles[1], 2 * Math.PI + angles[0] - angles[2]];
  for (const g of gaps) assert.ok(Math.abs(g - (2 * Math.PI) / 3) < 0.01, `${label}: 120° apart`);
}

test('the #glyph symbol is the orbit mark', () => {
  const symbol = html.match(/<symbol id="glyph"[\s\S]*?<\/symbol>/)[0];
  const dots = circles(symbol);
  assertOrbit(dots, 'glyph');
  const solid = dots.filter((d) => /var\(--mark-site/.test(d.style));
  const outline = dots.filter((d) => d.fill === 'none' && d.stroke === 'currentColor');
  assert.equal(solid.length, 1);
  assert.equal(outline.length, 2);
  assert.doesNotMatch(symbol, /<(rect|path|polygon|line)\b/);
  assert.match(css, /--mark-site:\s*var\(--accent\)/);
  // header, hero and footer all use it
  assert.equal((html.match(/<use href="#glyph">/g) || []).length, 3);
});

test('the favicon is the same orbit mark on a round porcelain tile', () => {
  const dots = circles(favicon);
  const background = dots.find((d) => d.r === 12);
  assert.ok(background, 'round background');
  const marks = dots.filter((d) => d !== background);
  assertOrbit(marks, 'favicon');
  assert.equal(marks.filter((d) => d.fill === '#00753F').length, 1);
  assert.equal(marks.filter((d) => d.fill === 'none' && d.stroke === '#111821').length, 2);
  assert.doesNotMatch(favicon, /<(rect|path|polygon|line)\b/);
});

test('the OG card uses the same mark as the page', () => {
  const ogDots = circles(poster.match(/const ORBIT_MARK = ([\s\S]*?);\n/)[1].replace(/'\s*\+\s*'/g, ''));
  const pageDots = circles(html.match(/<symbol id="glyph"[\s\S]*?<\/symbol>/)[0]);
  assert.deepEqual(ogDots.map(({ cx, cy, r }) => [cx, cy, r]), pageDots.map(({ cx, cy, r }) => [cx, cy, r]));
});

test('no quartered-square or grid motif remains', () => {
  for (const [name, text] of [['index.html', html], ['favicon.svg', favicon], ['tools/poster.js', poster], ['site.css', css]]) {
    assert.doesNotMatch(text, /h21v21|glyph-cell|quarter|octree grid|quadtree/i, name);
  }
});
