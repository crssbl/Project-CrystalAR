import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  wrap01, periodicClose, fracToCart, applyAffine, expandOrbit, periodicImages, cellEdgesFrac,
  volume, cellBoundingRadius, latticeFromParameters, latticeAt, NOMINAL_VOLUME_FRACTION,
} from '../../js/lib/crystal-math.js';
import { elementColor, ELEMENT_COLORS, FALLBACK_ELEMENT_COLOR, atomDisplayRadius } from '../../js/lib/palette.js';

const trace = JSON.parse(await readFile(new URL('../../data/crystals/denovo-75.json', import.meta.url), 'utf8'));
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('wrap01 maps into [0, 1)', () => {
  assert.equal(wrap01(1), 0);
  assert.equal(wrap01(-0.25), 0.75);
  close(wrap01(2.5), 0.5);
  assert.ok(periodicClose([0.999999999, 0, 0], [0, 0, 0]));
});

test('fractional to Cartesian uses lattice rows', () => {
  const m = trace.lattice.matrix;
  const p = fracToCart([0.2705078125, 0, 0.25], m);
  close(p[0], 0.2705078125 * m[0][0] + 0.25 * m[2][0]);
  close(p[2], 0.25 * m[2][2]);
  close(volume(m), trace.lattice.volume, 1e-6);
});

test('orbit expansion reproduces every stored atom of La5Bi3Cl', () => {
  const expanded = [];
  for (const s of trace.sites) {
    const orbit = expandOrbit(s.orbit, s.representative);
    assert.equal(orbit.length, s.multiplicity);
    for (const p of orbit) expanded.push([s.element, p]);
  }
  assert.equal(expanded.length, trace.atoms.length);
  for (const atom of trace.atoms) {
    assert.ok(expanded.some(([el, p]) => el === atom.element && periodicClose(p, atom.frac, 1e-6)), JSON.stringify(atom));
  }
  assert.deepEqual(applyAffine([[1, 0, 0, 0.5], [0, 1, 0, 0], [0, 0, 1, 0]], [0.25, 0, 0]), [0.75, 0, 0]);
});

test('periodic images fill faces, edges and corners of the closed cell', () => {
  assert.equal(periodicImages([0, 0, 0]).length, 8);
  assert.equal(periodicImages([0, 0, 0.5]).length, 4);
  assert.equal(periodicImages([0.5, 0, 0.5]).length, 2);
  assert.equal(periodicImages([0.2705, 0.4, 0.25]).length, 1);
  assert.equal(cellEdgesFrac().length, 12);
});

test('cell construction and the lattice morph end on the stored matrix', () => {
  const hex = latticeFromParameters(2, 2, 3, 90, 90, 120);
  close(volume(hex), 2 * 2 * 3 * Math.sin((120 * Math.PI) / 180));
  const L = trace.lattice;
  const end = latticeAt(L, 1);
  end.forEach((row, i) => row.forEach((v, k) => close(v, L.matrix[i][k], 1e-9)));
  const start = latticeAt(L, 0);
  close(volume(start), L.volume * NOMINAL_VOLUME_FRACTION, 1e-6);
  const len = (v) => Math.hypot(...v);
  close(len(start[2]) / len(start[0]), 1, 1e-9); // c/a starts at 1
  const mid = latticeAt(L, 0.5);
  assert.ok(volume(mid) > volume(start) && volume(mid) < volume(end));
  assert.ok(cellBoundingRadius(L.matrix) > 5);
});

test('every element of the exported crystals has a colour; unknowns fall back', () => {
  for (const atom of trace.atoms) assert.ok(ELEMENT_COLORS[atom.element], atom.element);
  assert.equal(elementColor('La'), '#70D4FF');
  assert.equal(elementColor('Xx'), FALLBACK_ELEMENT_COLOR);
  assert.ok(atomDisplayRadius('La') > atomDisplayRadius('Cl'));
});
