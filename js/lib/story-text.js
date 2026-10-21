// Pure: readout lines and keyboard key frames for the story, the hero and the replay.
import { escapeHtml, formulaHtml, spaceGroupHtml, latticeToken, fixed, elementClass } from './format.js';
import { STEPS, stepStart, stepSettled, LEVELS } from './story-timeline.js';

const KIND = ['fixed point', 'line, 1 free parameter', 'plane, 2 free parameters', 'volume, 3 free parameters'];

/** One-line HTML readout for a scene frame (see scene-state.js sceneAt). */
export function readoutHtml(readout, trace) {
  switch (readout.id) {
    case 'group':
      return `<b>${spaceGroupHtml(readout.symbol)}</b> · No. ${readout.number} · ${readout.operations} symmetry operations`;
    case 'template':
      if (readout.site < 0) return `<b>${spaceGroupHtml(trace.spaceGroup.symbol)}</b> · ${trace.sites.length} sites to write`;
      return `<b>${escapeHtml(readout.siteLabel)}</b> · ${escapeHtml(readout.form)} · ${KIND[readout.dof]}`;
    case 'lattice':
      return readout.active.map((v) => {
        const t = latticeToken(v.name, v.value);
        return `${escapeHtml(t.label)} = <b>${escapeHtml(t.text)}</b>`;
      }).join(' · ') + ` · ${escapeHtml(readout.family)} cell`;
    case 'refine': {
      const stats = readout.jointCandidates === null ? ''
        : ` · ${readout.jointCandidates} joint candidates scored · ${readout.keptInBeam} kept in beam`;
      return `Level <b>${readout.level}</b> / ${readout.levels} · region 1/${readout.denominator} ≈ <b>${fixed(readout.widthA, readout.widthA < 0.1 ? 3 : 2)} Å</b>${stats}`;
    }
    case 'expand':
      return `${readout.multiplicities.join(' + ')} = <b>${readout.total} atoms</b>`;
    default:
      return `<b>${formulaHtml(readout.formula)}</b> · ${readout.total} atoms in the cell`;
  }
}

/**
 * Caption line under a pre-rendered still (the stage without WebGL). The live stage labels the
 * sites in the template and refinement steps; at still size those labels are too small and
 * crowded, so the caption lists the sites instead, each with its element colour: all template
 * sites in the template step, the refined (free) sites in the refinement step. '' otherwise.
 */
export function stillCaptionHtml(trace, index, steps = STEPS) {
  const id = steps[index]?.id;
  const sites = id === 'template' ? trace.sites : id === 'refine' ? trace.sites.filter((s) => s.dof > 0) : [];
  return sites.map((s) => (
    `<span class="story-caption-site"><i class="el-dot ${elementClass(s.element)}"></i>${escapeHtml(s.element)} ${escapeHtml(s.wyckoff)}</span>`
  )).join('');
}

/**
 * Key frames for keyboard and step buttons: the settled state of every step, of every
 * template site and of every refinement level. Sorted progress values in [0, 1].
 */
export function keyFrames(trace, steps = STEPS) {
  const frames = new Set([0]);
  steps.forEach((step, i) => {
    const start = stepStart(i, steps);
    const end = stepStart(i + 1, steps);
    if (step.id === 'template') {
      const n = trace.sites.length;
      const slot = 0.86 / Math.max(1, n);
      for (let k = 0; k < n; k += 1) frames.add(start + (end - start) * Math.min(0.96, 0.06 + k * slot + slot * 0.85));
    } else if (step.id === 'refine') {
      for (let level = 1; level <= LEVELS; level += 1) frames.add(start + (end - start) * ((level - 0.2) / LEVELS));
    } else {
      frames.add(stepSettled(i, steps));
    }
  });
  return [...frames].map((p) => Math.min(1, Math.max(0, p))).sort((a, b) => a - b);
}

/** Next / previous key frame from a progress value. */
export function stepFrame(frames, p, direction) {
  const eps = 1e-6;
  if (direction > 0) return frames.find((f) => f > p + eps) ?? frames[frames.length - 1];
  return [...frames].reverse().find((f) => f < p - eps) ?? frames[0];
}
