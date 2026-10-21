import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { contrastRatio, deltaE2000, deltaEHex, minDeltaE, rgbToLab, hexToRgb, rgbToOklch } from '../../js/lib/color.js';
import { UI, ELEMENT_COLORS, elementCss } from '../../js/lib/palette.js';

const jmol = JSON.parse(await readFile(new URL('../fixtures/jmol.json', import.meta.url), 'utf8'));

test('OKLCH conversion agrees with the standard sRGB red reference', () => {
  const [L, C, h] = rgbToOklch(hexToRgb('#FF0000'));
  assert.ok(Math.abs(L - 0.627955) < 1e-6);
  assert.ok(Math.abs(C - 0.257683) < 1e-6);
  assert.ok(Math.abs(h - 29.2339) < 0.0001);
});

test('muted element colours keep Jmol hues within 5 degrees and cap chroma', () => {
  assert.deepEqual(Object.keys(ELEMENT_COLORS), Object.keys(jmol));
  for (const [el, hex] of Object.entries(ELEMENT_COLORS)) {
    const [oldL, oldC, oldH] = rgbToOklch(hexToRgb(jmol[el]));
    const [L, C, h] = rgbToOklch(hexToRgb(hex));
    const hueChange = Math.abs(((h - oldH + 540) % 360) - 180);
    assert.ok(hueChange <= 5, `${el}: hue changed ${hueChange}°`);
    assert.ok(C <= 0.131, `${el}: chroma ${C}`); // 0.13 with 8-bit rounding
    if (oldC <= 0.13) assert.equal(hex, jmol[el], `${el}: keep the low-chroma colour`);
    assert.ok(C <= oldC + 0.001, `${el}: chroma must not increase`);
    if (!['S', 'Cl', 'Ca'].includes(el)) assert.ok(Math.abs(L - oldL) <= 0.002, `${el}: retain lightness`);
  }
});

test('every crystal keeps element pairs above 12, or no closer than their Jmol distance', async () => {
  const dir = new URL('../../data/crystals/', import.meta.url);
  const names = (await readdir(dir)).filter((n) => /^denovo-\d+\.json$/.test(n));
  assert.equal(names.length, 13);
  for (const name of names) {
    const trace = JSON.parse(await readFile(new URL(name, dir), 'utf8'));
    const elements = [...new Set(trace.atoms.map((a) => a.element))];
    for (let i = 0; i < elements.length; i += 1) for (let j = i + 1; j < elements.length; j += 1) {
      const [a, b] = [elements[i], elements[j]];
      const old = deltaEHex(jmol[a], jmol[b]);
      const next = deltaEHex(ELEMENT_COLORS[a], ELEMENT_COLORS[b]);
      assert.ok(next >= Math.min(12, old) - 1e-9, `${trace.id}: ${a}/${b} ${old} → ${next}`);
    }
  }
});

test('CIEDE2000 matches the Sharma, Wu & Dalal (2005) reference pairs', () => {
  // [L1, a1, b1, L2, a2, b2, ΔE00]
  const pairs = [
    [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
    [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
    [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
    [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
    [50, 0, 0, 50, -1, 2, 2.3669],
    [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
    [50, 2.5, 0, 73, 25, -18, 27.1492],
    [50, 2.5, 0, 61, -5, 29, 22.8977],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
    [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
  ];
  for (const [L1, a1, b1, L2, a2, b2, expected] of pairs) {
    const got = deltaE2000([L1, a1, b1], [L2, a2, b2]);
    assert.ok(Math.abs(got - expected) < 1e-4, `${got} vs ${expected}`);
  }
  const white = rgbToLab(hexToRgb('#FFFFFF'));
  assert.ok(Math.abs(white[0] - 100) < 1e-3);
});

async function elementsInTraces() {
  const dir = new URL('../../data/crystals/', import.meta.url);
  const names = (await readdir(dir)).filter((n) => /^denovo-\d+\.json$/.test(n));
  const elements = new Set();
  for (const name of names) {
    const trace = JSON.parse(await readFile(new URL(name, dir), 'utf8'));
    trace.atoms.forEach((a) => elements.add(a.element));
  }
  return [...elements].sort();
}

test('accent is at least ΔE00 = 20 from every element colour used by the crystals', async () => {
  const used = await elementsInTraces();
  assert.ok(used.length > 0);
  const colours = Object.fromEntries(used.map((el) => [el, ELEMENT_COLORS[el]]));
  for (const [el, hex] of Object.entries(colours)) assert.ok(hex, `no colour for ${el}`);
  const nearest = minDeltaE(UI.accent, colours);
  assert.ok(nearest.value >= 20, `accent ${UI.accent} is ΔE ${nearest.value.toFixed(1)} from ${nearest.against}`);
  // Also against the full palette of the 27 gallery elements.
  const all = minDeltaE(UI.accent, ELEMENT_COLORS);
  assert.ok(all.value >= 20, `ΔE ${all.value.toFixed(1)} vs ${all.against}`);
  assert.equal(Object.keys(ELEMENT_COLORS).length, 27);
  assert.ok(Math.abs(deltaEHex(UI.accent, ELEMENT_COLORS.Rh) - all.value) < 1e-9 || all.against !== 'Rh');
});

test('text colours meet WCAG contrast where they are used', () => {
  assert.ok(contrastRatio(UI.accent, UI.porcelain) >= 4.5, 'accent text on porcelain');
  assert.ok(contrastRatio(UI.accent, UI.paper) >= 4.5, 'accent text on cards');
  assert.ok(contrastRatio('#FFFFFF', UI.accent) >= 4.5, 'white on accent');
  assert.ok(contrastRatio(UI.accentDeep, UI.porcelain) >= 4.5);
  assert.ok(contrastRatio(UI.ink, UI.porcelain) >= 7);
  assert.ok(contrastRatio(UI.muted, UI.porcelain) >= 4.5, 'muted text');
  assert.ok(contrastRatio(UI.muted, UI.paper) >= 4.5);
  assert.ok(contrastRatio(UI.ink2, UI.porcelainDeep) >= 4.5);
  assert.ok(contrastRatio(UI.stageText, UI.stage) >= 7, 'stage text');
  assert.ok(contrastRatio(UI.stageMuted, UI.stage) >= 4.5, 'stage muted text');
  assert.ok(contrastRatio(UI.stageFaint, UI.stage) >= 4.5, 'not-yet-written tokens');
  assert.ok(contrastRatio(UI.stageFaint, UI.stage2) >= 4.5);
  assert.ok(contrastRatio(UI.accent, UI.stage) >= 3, 'accent graphics on the stage');
});

test('CSS custom properties mirror the palette module', async () => {
  const css = await readFile(new URL('../../assets/css/site.css', import.meta.url), 'utf8');
  const root = css.match(/:root\s*{([^}]*)}/)[1];
  const prop = (name) => (root.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1]?.toUpperCase();
  const map = {
    porcelain: 'porcelain', 'porcelain-deep': 'porcelainDeep', paper: 'paper', ink: 'ink', 'ink-2': 'ink2',
    muted: 'muted', faint: 'faint', rule: 'rule', accent: 'accent', 'accent-deep': 'accentDeep',
    'accent-tint': 'accentTint', stage: 'stage', 'stage-2': 'stage2', 'stage-text': 'stageText', 'stage-muted': 'stageMuted',
    'stage-faint': 'stageFaint',
  };
  for (const [cssName, key] of Object.entries(map)) assert.equal(prop(cssName), UI[key], cssName);
  const dots = css.match(/\/\* elements:begin \*\/\n([\s\S]*?)\n\/\* elements:end \*\//)?.[1];
  assert.equal(dots, elementCss(), 'element dots and captions use the renderer palette');
});
