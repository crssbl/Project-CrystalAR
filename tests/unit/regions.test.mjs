import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEVELS, siteKind, levelIndex, intervalAt, intervalOfU, decisionBit, childIndex, mapForm,
  regionAt, regionEdges, regionLengthsA, wrapSegment, wrapPolygon, regionPieces,
} from '../../js/lib/regions.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const closeVec = (a, b, tol = 1e-12) => a.forEach((x, i) => close(x, b[i], tol));

const centre = (index9) => (index9 + 0.5) / 2 ** LEVELS;
const site = (B, b, index9, lengths) => ({
  dof: index9.length, form: { B, b }, index9, u: index9.map(centre), paramLengthsA: lengths,
});

const POINT = site([[], [], []], [1 / 3, 2 / 3, 0], []);
const LINE = site([[1], [0], [0]], [0, 0, 0.25], [138], [9.8]); // La 6g of La5Bi3Cl
const COUPLED_LINE = site([[1], [2], [0]], [0, 0, 0.25], [200], [8]); // (x, 2x, 1/4)
const PLANE = site([[1, 0], [2, 0], [0, 1]], [0, 0, 0], [153, 358], [8, 5]); // (x, 2x, z)
const VOLUME = site([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], [51, 307, 460], [4, 5, 6]);

test('kinds by number of free parameters', () => {
  assert.deepEqual([0, 1, 2, 3].map(siteKind), ['point', 'line', 'plane', 'volume']);
});

test('level intervals nest and halve, and contain the level-9 centre', () => {
  for (const index9 of [0, 1, 138, 314, 511]) {
    let prev = [0, 1];
    for (let level = 1; level <= LEVELS; level += 1) {
      const [lo, hi] = intervalAt(index9, level);
      close(hi - lo, (prev[1] - prev[0]) / 2);
      assert.ok(lo >= prev[0] && hi <= prev[1]);
      const u = centre(index9);
      assert.ok(lo <= u && u < hi);
      assert.deepEqual(intervalOfU(u, level), [lo, hi]);
      assert.equal(levelIndex(index9, level), Math.floor(u * 2 ** level));
      prev = [lo, hi];
    }
  }
});

test('decision bits are the binary digits of the level-9 index', () => {
  // 138 = 0b010001010
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => decisionBit(138, l)), [0, 1, 0, 0, 0, 1, 0, 1, 0]);
  assert.equal(childIndex([1, 0], 9), 2);
  assert.equal(childIndex([138, 314], 1), 0b01);
});

test('point site: one fixed point, no refinement', () => {
  const r = regionAt(POINT, 5);
  assert.equal(r.kind, 'point');
  assert.equal(r.width, 0);
  closeVec(r.corners[0], [1 / 3, 2 / 3, 0]);
  assert.deepEqual(regionEdges(0), []);
});

test('line site (x, 0, 1/4): level 1, 5 and 9 snapshots', () => {
  const r1 = regionAt(LINE, 1);
  closeVec(r1.corners[0], [0, 0, 0.25]);
  closeVec(r1.corners[1], [0.5, 0, 0.25]);
  const r5 = regionAt(LINE, 5);
  closeVec(r5.corners[0], [0.25, 0, 0.25]);
  closeVec(r5.corners[1], [0.28125, 0, 0.25]);
  const r9 = regionAt(LINE, 9);
  closeVec(r9.corners[0], [138 / 512, 0, 0.25]);
  closeVec(r9.corners[1], [139 / 512, 0, 0.25]);
  closeVec(r9.center, [0.2705078125, 0, 0.25]);
  close(regionLengthsA(LINE, 9)[0], 9.8 / 512);
  const m = regionAt(LINE, 0);
  closeVec(m.corners[1], [1, 0, 0.25]);
});

test('coupled line (x, 2x, 1/4): corners stay on the manifold and wrap into the cell', () => {
  for (let level = 0; level <= LEVELS; level += 1) {
    const r = regionAt(COUPLED_LINE, level);
    for (const p of r.corners) {
      const x = p[0];
      const dy = p[1] - 2 * x;
      close(dy - Math.round(dy), 0, 1e-12);
      close(p[2], 0.25);
    }
    close(r.width, 2 ** -level);
  }
  // The full manifold crosses y = 1 once: two pieces, both inside the closed cell.
  const pieces = regionPieces(regionAt(COUPLED_LINE, 0));
  assert.equal(pieces.length, 2);
  for (const [a, b] of pieces) for (const p of [a, b]) p.forEach((x) => assert.ok(x >= -1e-9 && x <= 1 + 1e-9));
  closeVec(pieces[0][0], [0, 0, 0.25]);
  closeVec(pieces[0][1], [0.5, 1, 0.25]);
  closeVec(pieces[1][0], [0.5, 0, 0.25]);
  closeVec(pieces[1][1], [1, 1, 0.25]);
});

test('coupled plane (x, 2x, z): parallelogram patch, area halves twice per level', () => {
  let prevArea = null;
  for (let level = 1; level <= LEVELS; level += 1) {
    const r = regionAt(PLANE, level);
    assert.equal(r.kind, 'plane');
    assert.equal(r.corners.length, 4);
    const [c00, c10, c01] = r.corners;
    const e1 = c10.map((x, i) => x - c00[i]);
    const e2 = c01.map((x, i) => x - c00[i]);
    closeVec(e1, [r.width, 2 * r.width, 0]);
    closeVec(e2, [0, 0, r.width]);
    const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    if (prevArea !== null) close(area, prevArea / 4);
    prevArea = area;
    r.center.forEach((x) => assert.ok(x >= 0 && x < 1));
  }
  // The level-0 manifold leaves the cell in y and is wrapped into two pieces.
  const pieces = regionPieces(regionAt(PLANE, 0));
  assert.equal(pieces.length, 2);
  for (const poly of pieces) for (const p of poly) p.forEach((x) => assert.ok(x >= -1e-9 && x <= 1 + 1e-9));
});

test('volume site (x, y, z): box with 8 corners and 12 edges', () => {
  const r = regionAt(VOLUME, 2);
  assert.equal(r.kind, 'volume');
  assert.equal(r.corners.length, 8);
  assert.equal(r.edges.length, 12);
  closeVec(r.corners[0], [0, 0.5, 0.75]);
  closeVec(r.corners[7], [0.25, 0.75, 1]);
  const lengths = regionLengthsA(VOLUME, 2);
  closeVec(lengths, [1, 1.25, 1.5]);
});

test('wrapSegment and wrapPolygon keep geometry inside the cell', () => {
  assert.deepEqual(wrapSegment([0.2, 0.5, 0.5], [0.6, 0.5, 0.5]).length, 1);
  const pieces = wrapSegment([0.8, 0.5, 0.5], [1.3, 0.5, 0.5]);
  assert.equal(pieces.length, 2);
  closeVec(pieces[1][0], [0, 0.5, 0.5]);
  closeVec(pieces[1][1], [0.3, 0.5, 0.5]);
  const poly = wrapPolygon([[0.9, 0.1, 0.5], [1.2, 0.1, 0.5], [1.2, 0.4, 0.5], [0.9, 0.4, 0.5]]);
  assert.equal(poly.length, 2);
});

test('the exported La5Bi3Cl trace refines its two line sites over nine levels', async () => {
  const trace = JSON.parse(await readFile(new URL('../../data/crystals/denovo-75.json', import.meta.url), 'utf8'));
  const free = trace.sites.filter((s) => s.dof > 0);
  assert.deepEqual(free.map((s) => `${s.element} ${s.wyckoff}`), ['La 6g', 'Bi 6g']);
  for (const s of free) {
    const r9 = regionAt(s, 9);
    closeVec(r9.center, s.representative, 1e-6);
    closeVec(mapForm(s.form, s.u).map((x) => x - Math.floor(x)), s.representative, 1e-6);
  }
});
