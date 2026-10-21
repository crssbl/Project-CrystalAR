// The story without WebGL: one pre-rendered still per step, plus a caption line with the sites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { STEPS, stepSettled, stillProgress, progressToState, EXPAND_STILL_T } from '../../js/lib/story-timeline.js';
import { sceneAt, finalDisplay } from '../../js/lib/scene-state.js';
import { stillCaptionHtml } from '../../js/lib/story-text.js';

const trace = JSON.parse(await readFile(new URL('../../data/crystals/denovo-75.json', import.meta.url), 'utf8'));
const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

test('adjacent story stills are not byte-identical', async () => {
  const files = await Promise.all(STEPS.map((_, i) => readFile(new URL(`../../assets/img/story/step-${i + 1}.webp`, import.meta.url))));
  for (const file of files) {
    assert.equal(file.toString('ascii', 0, 4), 'RIFF');
    assert.equal(file.toString('ascii', 8, 12), 'WEBP');
  }
  const hashes = files.map((file) => createHash('sha256').update(file).digest('hex'));
  for (let i = 1; i < hashes.length; i += 1) {
    assert.notEqual(hashes[i], hashes[i - 1], `step-${i}.webp and step-${i + 1}.webp are the same image`);
  }
});

test('the expansion still is caught mid-way: every orbit copy in, no periodic image yet', () => {
  const index = stepIndex('expand');
  const p = stillProgress(index);
  const state = progressToState(p);
  assert.equal(state.id, 'expand');
  assert.ok(Math.abs(state.t - EXPAND_STILL_T) < 1e-9);
  assert.ok(state.t >= 0.45 && state.t <= 0.6, `t = ${state.t} is not about half-way`);
  const { display } = sceneAt(trace, p, { labels: false });
  // The 18 atoms of the cell are all there and some are still growing; the images on faces,
  // edges and corners, which the finished crystal adds, are not.
  assert.equal(display.atoms.length, trace.atoms.length);
  assert.ok(display.atoms.every((a) => a.scale >= 0.4), 'every copy is visible');
  assert.ok(display.atoms.some((a) => a.scale < 1), 'copies are still growing');
  assert.ok(finalDisplay(trace).atoms.length > display.atoms.length);
  // Every other still pictures the settled state of its step.
  STEPS.forEach((_, i) => {
    if (i !== index) assert.equal(stillProgress(i), stepSettled(i));
  });
});

test('the caption under a still lists the sites that the live stage labels', () => {
  const sites = (html) => [...html.matchAll(/<\/i>([^<]+)<\/span>/g)].map((m) => m[1]);
  const template = stillCaptionHtml(trace, stepIndex('template'));
  assert.deepEqual(sites(template), ['Cl 2b', 'La 4d', 'La 6g', 'Bi 6g']);
  assert.match(template, /class="el-dot el-Cl"/);
  const refine = stillCaptionHtml(trace, stepIndex('refine'));
  assert.deepEqual(sites(refine), ['La 6g', 'Bi 6g']);
  // Exactly the labels of the live refinement stage.
  const live = sceneAt(trace, stepSettled(stepIndex('refine'))).display.labels.map((l) => l.text);
  assert.deepEqual(sites(refine), live);
  for (const id of ['group', 'lattice', 'expand', 'complete']) assert.equal(stillCaptionHtml(trace, stepIndex(id)), '', id);
});
