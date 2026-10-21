// Pure timeline of the generation story: one progress value p ∈ [0, 1] → step and local time.
// The same timeline drives the scroll story, the scrubber, the hero loop and the gallery replay.

export const STEPS = Object.freeze([
  { id: 'group', title: 'Given a space group', weight: 1 },
  { id: 'template', title: 'Wyckoff template', weight: 1.6 },
  { id: 'lattice', title: 'Lattice', weight: 1 },
  { id: 'refine', title: 'Coarse to fine', weight: 3.4 },
  { id: 'expand', title: 'Symmetry expansion', weight: 1.2 },
  { id: 'complete', title: 'The crystal', weight: 1 },
]);

export const LEVELS = 9;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
};

export function totalWeight(steps = STEPS) {
  return steps.reduce((s, step) => s + step.weight, 0);
}

/** Progress at which step `index` starts (index = steps.length gives 1). */
export function stepStart(index, steps = STEPS) {
  const total = totalWeight(steps);
  let acc = 0;
  for (let i = 0; i < Math.min(index, steps.length); i += 1) acc += steps[i].weight;
  return acc / total;
}

/** Progress where step `index` is fully played (its settled state), used by step buttons. */
export function stepSettled(index, steps = STEPS) {
  const start = stepStart(index, steps);
  const end = stepStart(index + 1, steps);
  return index >= steps.length - 1 ? 1 : start + (end - start) * 0.96;
}

/** Local time of the symmetry-expansion still: mid-way, see stillProgress. */
export const EXPAND_STILL_T = 0.55;

/**
 * Progress pictured by the pre-rendered still of step `index` (the stage without WebGL): the
 * settled state, except symmetry expansion, which is caught mid-way (t ≈ 0.5): the copies of
 * every representative are in and still growing, and the periodic images (from t = 0.72) are
 * not. Settled, it would look exactly like the finished crystal. At t = 0.5 exactly the last
 * copies are 3 % specks, hence 0.55, where every copy is at least half size.
 */
export function stillProgress(index, steps = STEPS) {
  if (steps[index]?.id !== 'expand') return stepSettled(index, steps);
  const start = stepStart(index, steps);
  return start + (stepStart(index + 1, steps) - start) * EXPAND_STILL_T;
}

/** p → { index, id, t } with t the local time inside the step (0 … 1). */
export function progressToState(p, steps = STEPS) {
  const x = clamp01(Number.isFinite(p) ? p : 0);
  if (x >= 1 - 1e-12) return { index: steps.length - 1, id: steps[steps.length - 1].id, t: 1, p: 1 };
  const total = totalWeight(steps);
  let acc = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const w = steps[i].weight / total;
    if (x < acc + w || i === steps.length - 1) {
      return { index: i, id: steps[i].id, t: clamp01((x - acc) / w), p: x };
    }
    acc += w;
  }
  return { index: steps.length - 1, id: steps[steps.length - 1].id, t: 1, p: x };
}

/** Discrete step index for a progress value (what the step list and aria-live announce). */
export const stepIndexAt = (p, steps = STEPS) => progressToState(p, steps).index;

/**
 * Refinement level inside the 'refine' step. Each level gets an equal slot: the first 45%
 * animates from the previous level, the rest holds so the numbers can be read.
 */
export function refineLevelAt(t, levels = LEVELS) {
  const x = clamp01(t) * levels;
  const level = Math.min(levels, Math.floor(x) + 1);
  const within = clamp01(x - (level - 1));
  return { level, within, blend: ease.inOut(clamp01(within / 0.45)) };
}

/** Appearance (0 … 1) of each of `n` template sites during the 'template' step. */
export function templateAppearance(t, n) {
  const slot = 0.86 / Math.max(1, n);
  return Array.from({ length: n }, (_, k) => ease.out(clamp01((t - 0.06 - k * slot) / (slot * 0.8))));
}

/** Index of the template site being written at local time t (−1 before the first). */
export function templateActiveSite(t, n) {
  const appear = templateAppearance(t, n);
  let active = -1;
  appear.forEach((a, k) => { if (a > 0) active = k; });
  return active;
}

/** The hero loop: a condensed pass over the same timeline, as a function of seconds. */
export const HERO_LOOP = Object.freeze({
  seconds: 16,
  // [loop time, story progress] keyframes; holds where p stays constant.
  keys: [[0, 1], [2.2, 1], [2.25, stepStart(1)], [4.4, stepSettled(1)], [5.6, stepSettled(2)],
    [10.4, stepSettled(3)], [12.2, stepSettled(4)], [12.6, 1], [16, 1]],
});

export function heroProgressAt(seconds, loop = HERO_LOOP) {
  const s = ((seconds % loop.seconds) + loop.seconds) % loop.seconds;
  const keys = loop.keys;
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const [t0, p0] = keys[i];
    const [t1, p1] = keys[i + 1];
    if (s >= t0 && s <= t1) return t1 === t0 ? p1 : p0 + (p1 - p0) * ((s - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}
