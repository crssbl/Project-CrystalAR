// Pure: from a crystal trace and a story progress value to a declarative display for
// CrystalView, plus the readout and token states shown next to it. Fractional coordinates.
import { latticeAt, periodicImages, expandOrbit, volume } from './crystal-math.js';
import { regionAt, regionPieces, regionLengthsA, LEVELS } from './regions.js';
import { progressToState, refineLevelAt, templateAppearance, templateActiveSite, ease } from './story-timeline.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpVec = (a, b, t) => a.map((x, i) => lerp(x, b[i], t));

// A general point whose orbit shows the space group's symmetry operations in step 1.
export const PROBE_POINT = [0.31, 0.08, 0.16];

/** Every atom with its periodic images inside the closed unit cell. */
export function atomsWithImages(trace, scale = 1) {
  const out = [];
  for (const atom of trace.atoms) {
    for (const frac of periodicImages(atom.frac)) out.push({ element: atom.element, frac, scale });
  }
  return out;
}

const emptyDisplay = (matrix) => ({ matrix, cell: true, cellOpacity: 1, atoms: [], lines: [], polys: [], dots: [], labels: [], dotOpacity: 0.9 });

/** The finished crystal in its real cell. */
export function finalDisplay(trace) {
  return { ...emptyDisplay(trace.lattice.matrix), atoms: atomsWithImages(trace) };
}

export const siteLabel = (site) => `${site.element} ${site.wyckoff}`.trim();

/** Lattice variables of the current cell, in the paper's (V, b/a, c/a, α, β, γ). */
export function latticeValues(matrix) {
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const ang = (u, v) => (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v))))) * 180) / Math.PI;
  const [a, b, c] = matrix;
  return { V: volume(matrix), 'b/a': len(b) / len(a), 'c/a': len(c) / len(a), alpha: ang(b, c), beta: ang(a, c), gamma: ang(a, b) };
}

/** Where a site's label sits before its position is known: on its manifold, off-centre. */
export function manifoldAnchor(site) {
  if (site.dof === 0) return site.representative;
  const region = regionAt(site, 0);
  if (site.dof === 1) {
    const [a, b] = region.corners;
    return a.map((x, i) => x + (b[i] - x) * 0.85).map((x) => x - Math.floor(x));
  }
  return region.center;
}

function addManifold(display, site, opacity) {
  if (site.dof === 0 || opacity <= 0) return;
  const region = regionAt(site, 0);
  if (site.dof === 1) {
    for (const [from, to] of regionPieces(region)) display.lines.push({ from, to, role: 'manifold', opacity });
  } else if (site.dof === 2) {
    for (const corners of regionPieces(region)) display.polys.push({ corners, opacity: 0.16 * opacity });
  } else {
    display.polys.push({ corners: region.corners, box: true, opacity: 0.07 * opacity });
  }
}

function addRegion(display, site, level, blend) {
  const cur = regionAt(site, level);
  const prev = regionAt(site, Math.max(0, level - 1));
  const sameShift = prev.shift.every((s, i) => s === cur.shift[i]);
  const corners = sameShift ? cur.corners.map((c, k) => lerpVec(prev.corners[k], c, blend)) : cur.corners;
  const center = sameShift ? lerpVec(prev.center, cur.center, blend) : cur.center;
  const region = { ...cur, corners };
  if (site.dof === 1) {
    for (const [from, to] of regionPieces(region)) display.lines.push({ from, to, role: 'region' });
  } else if (site.dof === 2) {
    for (const poly of regionPieces(region)) display.polys.push({ corners: poly, opacity: 0.5 });
  } else {
    display.polys.push({ corners, box: true, opacity: 0.32 });
  }
  return center;
}

/** Token states for the sequence sidebar: id → 'done' | 'active' | 'future'. */
export function tokenStates(trace, state) {
  const out = { g: 'future' };
  const n = trace.sites.length;
  const nLat = trace.lattice.active.length;
  const set = (id, s) => { out[id] = s; };
  const order = ['group', 'template', 'lattice', 'refine', 'expand', 'complete'];
  const phase = order.indexOf(state.id);
  set('g', phase === 0 ? 'active' : 'done');
  const activeSite = phase === 1 ? templateActiveSite(state.t, n) : phase > 1 ? n : -1;
  for (let k = 0; k < n; k += 1) set(`t${k}`, k < activeSite ? 'done' : k === activeSite && phase === 1 ? 'active' : phase > 1 ? 'done' : 'future');
  const activeLat = phase === 2 ? Math.min(nLat - 1, Math.floor(state.t * nLat)) : phase > 2 ? nLat : -1;
  for (let j = 0; j < nLat; j += 1) set(`l${j}`, j < activeLat ? 'done' : j === activeLat && phase === 2 ? 'active' : phase > 2 ? 'done' : 'future');
  const level = phase === 3 ? refineLevelAt(state.t).level : phase > 3 ? LEVELS + 1 : 0;
  for (let l = 1; l <= LEVELS; l += 1) set(`r${l}`, l < level ? 'done' : l === level && phase === 3 ? 'active' : phase > 3 ? 'done' : 'future');
  return out;
}

/**
 * Story frame at progress p: { state, display, readout, tokens }.
 * `options.labels` adds site labels (the dark stage); the hero passes false.
 */
export function sceneAt(trace, p, options = {}) {
  const labels = options.labels !== false;
  const state = progressToState(p);
  const { id, t } = state;
  const L = trace.lattice;
  // The cell is fully written by 82% of the lattice step, then holds so the values can be read.
  const latT = id === 'group' || id === 'template' ? 0 : id === 'lattice' ? ease.inOut(clamp01(t / 0.82)) : 1;
  const matrix = latticeAt(L, latT);
  const display = emptyDisplay(matrix);
  const sites = trace.sites;
  const readout = { id, step: state.index };
  const label = (site, frac, opacity = 1) => labels && display.labels.push({ text: siteLabel(site), frac, opacity });

  if (id === 'group') {
    display.cellOpacity = 0.35 + 0.65 * ease.out(clamp01(t / 0.2));
    const orbit = expandOrbit(trace.spaceGroup.generalPosition, PROBE_POINT);
    orbit.forEach((frac, k) => {
      const a = ease.out(clamp01((t - 0.18 - (0.6 * k) / orbit.length) / 0.12));
      if (a > 0) display.dots.push({ frac, radius: 0.012 * a });
    });
    Object.assign(readout, { symbol: trace.spaceGroup.symbol, number: trace.spaceGroup.number, operations: trace.spaceGroup.operations, shown: display.dots.length });
  } else if (id === 'template' || id === 'lattice') {
    const appear = id === 'template' ? templateAppearance(t, sites.length) : sites.map(() => 1);
    if (id === 'template' && t < 0.12) {
      display.dotOpacity = 0.9 * (1 - t / 0.12);
      expandOrbit(trace.spaceGroup.generalPosition, PROBE_POINT).forEach((frac) => display.dots.push({ frac, radius: 0.012 }));
    }
    const active = id === 'template' ? templateActiveSite(t, sites.length) : -1;
    sites.forEach((site, k) => {
      const a = appear[k];
      if (a <= 0) return;
      if (site.dof === 0) display.atoms.push({ element: site.element, frac: site.representative, scale: a });
      else addManifold(display, site, a);
      // Fixed sites keep their label; a free site is labelled while it is being written.
      if (id === 'template' && (site.dof === 0 || k === active)) label(site, manifoldAnchor(site), a);
    });
    if (id === 'template') {
      const k = templateActiveSite(t, sites.length);
      Object.assign(readout, { site: k, siteLabel: k >= 0 ? siteLabel(sites[k]) : null, form: k >= 0 ? sites[k].form.text : null, dof: k >= 0 ? sites[k].dof : null });
    } else {
      const values = latticeValues(matrix);
      Object.assign(readout, { family: L.family, active: L.active.map((v) => ({ name: v.name, unit: v.unit, value: values[v.name], final: v.value })) });
    }
  } else if (id === 'refine') {
    const { level, blend } = refineLevelAt(t);
    sites.forEach((site) => {
      if (site.dof === 0) {
        display.atoms.push({ element: site.element, frac: site.representative, scale: 1 });
        return;
      }
      addManifold(display, site, 0.7);
      const center = addRegion(display, site, level, blend);
      display.atoms.push({ element: site.element, frac: center, scale: 0.78 });
      label(site, center);
    });
    const stats = trace.search?.levels?.[level - 1] ?? null;
    const free = sites.filter((s) => s.dof > 0);
    const widths = free.flatMap((s) => regionLengthsA(s, level));
    Object.assign(readout, {
      level, levels: LEVELS, denominator: 2 ** level,
      widthA: widths.length ? Math.max(...widths) : 0,
      jointCandidates: stats?.jointCandidates ?? null, keptInBeam: stats?.keptInBeam ?? null,
    });
  } else if (id === 'expand') {
    let shown = 0;
    sites.forEach((site) => {
      site.atoms.forEach((atomIndex, j) => {
        const a = j === 0 ? 1 : ease.out(clamp01((t - 0.08 - (0.5 * j) / site.multiplicity) / 0.28));
        if (a <= 0) return;
        shown += 1;
        display.atoms.push({ element: site.element, frac: trace.atoms[atomIndex].frac, scale: a });
      });
    });
    const imagesIn = ease.out(clamp01((t - 0.72) / 0.22));
    if (imagesIn > 0) {
      for (const atom of trace.atoms) {
        periodicImages(atom.frac).slice(1).forEach((frac) => display.atoms.push({ element: atom.element, frac, scale: imagesIn }));
      }
    }
    Object.assign(readout, { multiplicities: sites.map((s) => s.multiplicity), total: trace.atoms.length, shown });
  } else {
    display.atoms = atomsWithImages(trace);
    Object.assign(readout, { total: trace.atoms.length, formula: trace.formula });
  }
  return { state, display, readout, tokens: tokenStates(trace, state) };
}
