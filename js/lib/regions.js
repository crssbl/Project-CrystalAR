// Coarse-to-fine regions of Wyckoff sites, as in the paper's main text.
// A site with d free parameters u ∈ [0, 1)^d lies at f = B·u + b (mod 1). At level ℓ each
// parameter's region is [⌊u·2^ℓ⌋/2^ℓ, (⌊u·2^ℓ⌋ + 1)/2^ℓ); its image under the Wyckoff map is a
// point (d = 0), a segment (d = 1), a parallelogram patch (d = 2) or a box (d = 3).
// Level 0 is the whole Wyckoff manifold. Fixed sites (d = 0) have no refinement.

export const LEVELS = 9;
export const KINDS = ['point', 'line', 'plane', 'volume'];

export const siteKind = (dof) => KINDS[dof];

/** Index of the level-ℓ region that contains the level-9 cell `index9` (exact integer maths). */
export function levelIndex(index9, level) {
  if (level < 0 || level > LEVELS) throw new RangeError(`level ${level}`);
  return Math.floor(index9 / 2 ** (LEVELS - level));
}

/** [lo, hi) of the level-ℓ region of one free parameter. */
export function intervalAt(index9, level) {
  const k = levelIndex(index9, level);
  const w = 2 ** -level;
  return [k * w, (k + 1) * w];
}

/** Same, from a parameter value; for u = (index9 + 1/2)/512 both agree. */
export function intervalOfU(u, level) {
  const k = Math.floor(u * 2 ** level + 1e-12);
  const w = 2 ** -level;
  return [k * w, (k + 1) * w];
}

/** The refinement decision of a parameter at level ℓ ≥ 1: 0 = lower half, 1 = upper half. */
export function decisionBit(index9, level) {
  return levelIndex(index9, level) % 2;
}

/** Joint child index of a site at level ℓ: one bit per free parameter (2^d choices). */
export function childIndex(index9s, level) {
  return index9s.reduce((acc, idx) => acc * 2 + decisionBit(idx, level), 0);
}

/** f = B·u + b without wrapping. B is 3 × d (rows x, y, z). */
export function mapForm(form, u) {
  return [0, 1, 2].map((i) => form.b[i] + u.reduce((s, uj, j) => s + form.B[i][j] * uj, 0));
}

function cornerParams(lows, highs) {
  const d = lows.length;
  const out = [];
  for (let mask = 0; mask < 2 ** d; mask += 1) {
    out.push(lows.map((lo, j) => ((mask >> j) & 1 ? highs[j] : lo)));
  }
  return out;
}

/** Corner-index pairs that outline a region of dimension d. */
export function regionEdges(d) {
  if (d === 0) return [];
  const edges = [];
  for (let a = 0; a < 2 ** d; a += 1) {
    for (let j = 0; j < d; j += 1) {
      const b = a | (1 << j);
      if (b !== a) edges.push([a, b]);
    }
  }
  return edges;
}

/**
 * Region of `site` at `level` (0 … 9). Returns fractional corners shifted by an integer
 * vector so that the region centre lies in [0, 1)^3.
 */
export function regionAt(site, level) {
  const d = site.dof;
  const kind = siteKind(d);
  if (d === 0) {
    const p = site.form.b.map((x) => x - Math.floor(x));
    return { kind, dim: 0, level, width: 0, lows: [], highs: [], corners: [p], center: p, shift: [0, 0, 0], edges: [] };
  }
  const lows = [];
  const highs = [];
  site.index9.forEach((idx) => {
    const [lo, hi] = level === 0 ? [0, 1] : intervalAt(idx, level);
    lows.push(lo);
    highs.push(hi);
  });
  const mid = lows.map((lo, j) => (lo + highs[j]) / 2);
  const centerRaw = mapForm(site.form, mid);
  const shift = centerRaw.map((x) => -Math.floor(x + 1e-12));
  const move = (p) => p.map((x, i) => x + shift[i]);
  const corners = cornerParams(lows, highs).map((u) => move(mapForm(site.form, u)));
  return {
    kind, dim: d, level, width: 2 ** -level, lows, highs, corners,
    center: move(centerRaw), shift, edges: regionEdges(d),
  };
}

/** Cartesian edge lengths (Å) of a region: |B_j| in Å times the region width, per parameter. */
export function regionLengthsA(site, level) {
  return (site.paramLengthsA ?? []).map((len) => len * 2 ** -level);
}

const inCell = (p, tol = 1e-9) => p.every((x) => x >= -tol && x <= 1 + tol);

/**
 * Split a fractional segment into pieces that each lie in the closed unit cell, translating
 * every piece back into the cell (periodic wrapping). Exact for straight segments.
 */
export function wrapSegment(p0, p1) {
  const ts = [0, 1];
  for (let i = 0; i < 3; i += 1) {
    const a = p0[i];
    const b = p1[i];
    if (a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k += 1) {
      const t = (k - a) / (b - a);
      if (t > 1e-12 && t < 1 - 1e-12) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const at = (t) => p0.map((x, i) => x + (p1[i] - x) * t);
  const pieces = [];
  for (let k = 0; k + 1 < ts.length; k += 1) {
    if (ts[k + 1] - ts[k] < 1e-12) continue;
    const q0 = at(ts[k]);
    const q1 = at(ts[k + 1]);
    const mid = q0.map((x, i) => (x + q1[i]) / 2);
    const s = mid.map((x) => -Math.floor(x));
    pieces.push([q0.map((x, i) => x + s[i]), q1.map((x, i) => x + s[i])]);
  }
  return pieces;
}

function clipPolygon(poly, axis, keepAbove, bound) {
  const out = [];
  const inside = (p) => (keepAbove ? p[axis] >= bound - 1e-12 : p[axis] <= bound + 1e-12);
  for (let i = 0; i < poly.length; i += 1) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const t = (bound - prev[axis]) / (cur[axis] - prev[axis]);
      out.push(prev.map((x, k) => x + (cur[k] - x) * t));
    }
    if (curIn) out.push(cur);
  }
  return out;
}

/**
 * Pieces of a planar convex polygon (fractional corners, in order) inside the unit cell,
 * over all periodic translates: the exact wrapped image of a plane-site region.
 */
export function wrapPolygon(poly) {
  const mins = [0, 1, 2].map((i) => Math.min(...poly.map((p) => p[i])));
  const maxs = [0, 1, 2].map((i) => Math.max(...poly.map((p) => p[i])));
  const ranges = [0, 1, 2].map((i) => {
    const out = [];
    for (let k = Math.floor(mins[i] + 1e-12); k <= Math.ceil(maxs[i] - 1e-12) - 1; k += 1) out.push(-k);
    return out.length ? out : [0];
  });
  const pieces = [];
  for (const sx of ranges[0]) for (const sy of ranges[1]) for (const sz of ranges[2]) {
    let piece = poly.map((p) => [p[0] + sx, p[1] + sy, p[2] + sz]);
    for (let axis = 0; axis < 3 && piece.length; axis += 1) {
      piece = clipPolygon(piece, axis, true, 0);
      if (piece.length) piece = clipPolygon(piece, axis, false, 1);
    }
    if (piece.length >= 3) pieces.push(piece);
  }
  return pieces;
}

/** Display geometry of a region: wrapped segments for lines, wrapped polygons for planes. */
export function regionPieces(region) {
  if (region.dim === 1) return wrapSegment(region.corners[0], region.corners[1]);
  if (region.dim === 2) {
    const [c00, c10, c01, c11] = region.corners;
    const poly = [c00, c10, c11, c01];
    return poly.every((p) => inCell(p)) ? [poly] : wrapPolygon(poly);
  }
  return [region.corners];
}
