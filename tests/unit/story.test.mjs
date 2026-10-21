import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STEPS, progressToState, stepStart, stepSettled, stepIndexAt, refineLevelAt, templateAppearance,
  templateActiveSite, heroProgressAt, HERO_LOOP, totalWeight,
} from '../../js/lib/story-timeline.js';
import { sceneAt, tokenStates, latticeValues, finalDisplay, PROBE_POINT } from '../../js/lib/scene-state.js';
import { readoutHtml, keyFrames, stepFrame } from '../../js/lib/story-text.js';
import { tokensHtml, sequenceSummary } from '../../js/lib/tokens.js';

const trace = JSON.parse(await readFile(new URL('../../data/crystals/denovo-75.json', import.meta.url), 'utf8'));
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const refineP = (level, frac = 0.9) => {
  const s = stepStart(3);
  return s + (stepStart(4) - s) * ((level - 1 + frac) / 9);
};

test('six steps in story order', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['group', 'template', 'lattice', 'refine', 'expand', 'complete']);
  close(stepStart(0), 0);
  close(stepStart(STEPS.length), 1);
  assert.ok(totalWeight() > 0);
});

test('progress maps monotonically onto steps, with clamping', () => {
  let last = 0;
  for (let i = 0; i <= 1000; i += 1) {
    const s = progressToState(i / 1000);
    assert.ok(s.index >= last);
    assert.ok(s.t >= 0 && s.t <= 1);
    last = s.index;
  }
  assert.equal(progressToState(-1).index, 0);
  assert.equal(progressToState(2).id, 'complete');
  assert.equal(progressToState(NaN).index, 0);
  for (let i = 0; i < STEPS.length; i += 1) {
    assert.equal(stepIndexAt(stepStart(i) + 1e-9), i);
    assert.equal(stepIndexAt(stepSettled(i)), i);
  }
  assert.equal(progressToState(1).t, 1);
});

test('refinement levels 1…9 each get a slot and a hold', () => {
  assert.equal(refineLevelAt(0).level, 1);
  assert.equal(refineLevelAt(1).level, 9);
  for (let level = 1; level <= 9; level += 1) {
    const r = refineLevelAt((level - 0.1) / 9);
    assert.equal(r.level, level);
    close(r.blend, 1); // held
  }
});

test('template sites appear one after another', () => {
  const n = trace.sites.length;
  assert.deepEqual(templateAppearance(0, n), [0, 0, 0, 0]);
  assert.deepEqual(templateAppearance(1, n).map((a) => a === 1), [true, true, true, true]);
  assert.equal(templateActiveSite(0, n), -1);
  assert.equal(templateActiveSite(1, n), n - 1);
});

test('step 1 shows the 24-operation orbit of a general point in a neutral cell', () => {
  const f = sceneAt(trace, stepSettled(0));
  assert.equal(f.state.id, 'group');
  assert.equal(f.display.dots.length, 24);
  assert.equal(f.display.atoms.length, 0);
  assert.equal(f.readout.operations, 24);
  assert.ok(PROBE_POINT.length === 3);
  const v = latticeValues(f.display.matrix);
  close(v['c/a'], 1, 1e-9);
});

test('template step: fixed sites as atoms, line sites as their full lines', () => {
  const f = sceneAt(trace, stepSettled(1));
  assert.equal(f.state.id, 'template');
  assert.deepEqual(f.display.atoms.map((a) => a.element), ['Cl', 'La']);
  const manifolds = f.display.lines.filter((l) => l.role === 'manifold');
  assert.equal(manifolds.length, 2);
  for (const l of manifolds) {
    close(l.to[0] - l.from[0], 1);
    close(l.from[2], 0.25);
  }
  // Fixed sites stay labelled; the free site being written is labelled on its line.
  assert.deepEqual(f.display.labels.map((l) => l.text), ['Cl 2b', 'La 4d', 'Bi 6g']);
});

test('lattice step ends on V and c/a of the stored cell', () => {
  const f = sceneAt(trace, stepSettled(2));
  const v = latticeValues(sceneAt(trace, stepStart(3) + 1e-6).display.matrix);
  close(v.V, trace.lattice.volume, 1e-6);
  close(v['c/a'], trace.lattice.active[1].value, 1e-9);
  assert.deepEqual(f.readout.active.map((a) => a.name), ['V', 'c/a']);
});

test('refinement geometry snapshots at levels 1, 5 and 9', () => {
  const expectations = { 1: [[0, 0.5], [0.5, 1]], 5: [[0.25, 0.28125], [0.59375, 0.625]], 9: [[138 / 512, 139 / 512], [314 / 512, 315 / 512]] };
  for (const [level, spans] of Object.entries(expectations)) {
    const f = sceneAt(trace, refineP(Number(level)));
    assert.equal(f.readout.level, Number(level));
    const regions = f.display.lines.filter((l) => l.role === 'region');
    assert.equal(regions.length, 2);
    regions.forEach((r, k) => {
      close(r.from[0], spans[k][0]);
      close(r.to[0], spans[k][1]);
      close(r.from[2], 0.25);
    });
    close(f.readout.widthA, trace.lattice.a / 2 ** Number(level), 1e-9);
    const stats = trace.search.levels[Number(level) - 1];
    assert.equal(f.readout.jointCandidates, stats.jointCandidates);
    assert.equal(f.readout.keptInBeam, stats.keptInBeam);
    const free = f.display.atoms.filter((a) => a.scale < 1);
    assert.equal(free.length, 2);
  }
  const last = sceneAt(trace, refineP(9));
  const atoms = last.display.atoms.filter((a) => a.scale < 1);
  close(atoms[0].frac[0], 0.2705078125);
  close(atoms[1].frac[0], 0.6142578125);
});

test('expansion grows every orbit to 18 atoms, then the finished cell with images', () => {
  const f = sceneAt(trace, stepSettled(4));
  assert.equal(f.readout.total, 18);
  assert.deepEqual(f.readout.multiplicities, [2, 4, 6, 6]);
  const end = sceneAt(trace, 1);
  assert.equal(end.state.id, 'complete');
  assert.deepEqual(end.display.atoms.length, finalDisplay(trace).atoms.length);
  assert.ok(end.display.atoms.length > 18);
});

test('token states follow the story', () => {
  const at = (p) => tokenStates(trace, progressToState(p));
  assert.equal(at(0).g, 'active');
  assert.equal(at(0).t0, 'future');
  const tmpl = at(stepSettled(1));
  assert.equal(tmpl.g, 'done');
  assert.equal(tmpl.t3, 'active');
  assert.equal(tmpl.l0, 'future');
  const lvl5 = at(refineP(5));
  assert.equal(lvl5.r4, 'done');
  assert.equal(lvl5.r5, 'active');
  assert.equal(lvl5.r6, 'future');
  const done = at(1);
  assert.ok(Object.values(done).every((s) => s === 'done'));
});

test('readout wording uses the stored beam statistics', () => {
  const html = readoutHtml(sceneAt(trace, refineP(2)).readout, trace);
  assert.match(html, /Level <b>2<\/b> \/ 9/);
  assert.match(html, /16 joint candidates scored · 4 kept in beam/);
  assert.match(readoutHtml(sceneAt(trace, stepSettled(4)).readout, trace), /2 \+ 4 \+ 6 \+ 6 = <b>18 atoms<\/b>/);
  assert.match(readoutHtml(sceneAt(trace, stepSettled(0)).readout, trace), /24 symmetry operations/);
});

test('key frames walk every step, site and level; arrow keys step through them', () => {
  const frames = keyFrames(trace);
  assert.ok(frames.length >= 6 + 4 + 9 - 3);
  for (let i = 1; i < frames.length; i += 1) assert.ok(frames[i] > frames[i - 1]);
  let p = 0;
  const seen = new Set();
  for (let k = 0; k < frames.length; k += 1) {
    p = stepFrame(frames, p, 1);
    seen.add(progressToState(p).id);
    const s = sceneAt(trace, p);
    if (s.state.id === 'refine') seen.add(`level${s.readout.level}`);
  }
  assert.equal(p, 1);
  for (const id of ['template', 'lattice', 'refine', 'expand', 'complete']) assert.ok(seen.has(id), id);
  for (let l = 1; l <= 9; l += 1) assert.ok(seen.has(`level${l}`), `level ${l}`);
  assert.equal(stepFrame(frames, 1, -1) < 1, true);
});

test('hero loop is a condensed pass that starts and ends on the finished crystal', () => {
  close(heroProgressAt(0), 1);
  close(heroProgressAt(HERO_LOOP.seconds - 0.01), 1);
  const ids = new Set();
  for (let s = 0; s < HERO_LOOP.seconds; s += 0.1) ids.add(progressToState(heroProgressAt(s)).id);
  for (const id of ['template', 'lattice', 'refine', 'expand', 'complete']) assert.ok(ids.has(id), id);
});

test('token sidebar markup lists the real sequence of La5Bi3Cl', async () => {
  const html = tokensHtml(trace);
  for (const t of ['data-tok="g"', 'data-tok="t3"', 'data-tok="l1"', 'data-tok="r9"']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('P6<sub>3</sub>/mcm'));
  assert.ok(html.includes('562.7 Å³'));
  assert.ok(html.includes('0.690'));
  assert.match(sequenceSummary(trace), /La 6g x: level decisions 0 1 0 0 0 1 0 1 0, final value 0\.2705/);
  const page = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(page.includes(html), 'index.html carries the generated token markup (run npm run gallery)');
});

test('story copy in index.html matches the trace numbers', async () => {
  const page = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const v = trace.lattice.active.find((a) => a.name === 'V').value.toFixed(1);
  const ca = trace.lattice.active.find((a) => a.name === 'c/a').value.toFixed(3);
  assert.ok(page.includes(`V = ${v} Å<sup>3</sup> and c/a = ${ca}`));
  assert.ok(page.includes(`${trace.spaceGroup.operations} symmetry operations`));
  const mult = trace.sites.map((s) => s.multiplicity).join(' + ');
  assert.ok(page.includes(`${mult} = ${trace.atoms.length} atoms`));
  const w9 = (trace.lattice.a / 512).toFixed(2);
  assert.ok(page.includes(`about ${w9} Å`));
  for (const s of trace.sites) assert.ok(page.includes(`${s.element} ${s.wyckoff}`));
});
