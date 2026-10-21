// Pure crystallography helpers shared by the renderer, the story engine and the tests.
// Lattice matrices follow pymatgen: rows are the lattice vectors a, b, c in Å.

export const EPS = 1e-6;

export function wrap01(x, tol = 1e-9) {
  let v = x - Math.floor(x);
  if (v >= 1 - tol) v = 0;
  return v;
}

export const wrapVec = (p) => p.map((x) => wrap01(x));

/** Smallest periodic difference between two fractional vectors (componentwise). */
export function periodicDelta(a, b) {
  return a.map((x, i) => {
    const d = x - b[i];
    return d - Math.round(d);
  });
}

export function periodicClose(a, b, tol = EPS) {
  return periodicDelta(a, b).every((d) => Math.abs(d) <= tol);
}

/** Fractional → Cartesian (Å): f0·a + f1·b + f2·c. */
export function fracToCart(frac, matrix) {
  return [0, 1, 2].map((k) => frac[0] * matrix[0][k] + frac[1] * matrix[1][k] + frac[2] * matrix[2][k]);
}

/** Apply a 3×4 affine operation [R | t] to a fractional point. */
export function applyAffine(op, p) {
  return [0, 1, 2].map((i) => op[i][0] * p[0] + op[i][1] * p[1] + op[i][2] * p[2] + op[i][3]);
}

/** Unique wrapped images of `point` under `ops` (a Wyckoff orbit). */
export function expandOrbit(ops, point, tol = EPS) {
  const out = [];
  for (const op of ops) {
    const q = wrapVec(applyAffine(op, point));
    if (!out.some((r) => periodicClose(r, q, tol))) out.push(q);
  }
  return out;
}

/**
 * Display images of an atom inside the closed unit cell [0, 1]^3: coordinates at 0 are
 * repeated at 1 so that atoms on faces, edges and corners appear on every side.
 */
export function periodicImages(frac, tol = 1e-4) {
  const base = wrapVec(frac);
  const choices = base.map((x) => (x < tol ? [x, x + 1] : x > 1 - tol ? [x - 1, x] : [x]));
  const out = [];
  for (const x of choices[0]) for (const y of choices[1]) for (const z of choices[2]) out.push([x, y, z]);
  return out;
}

/** The 12 edges of the unit cell as pairs of fractional corners. */
export function cellEdgesFrac() {
  const edges = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    for (const su of [0, 1]) {
      for (const sv of [0, 1]) {
        const p = [0, 0, 0];
        p[u] = su;
        p[v] = sv;
        const q = [...p];
        q[axis] = 1;
        edges.push([p, q]);
      }
    }
  }
  return edges;
}

export function cellCenterCart(matrix) {
  return fracToCart([0.5, 0.5, 0.5], matrix);
}

export function volume(matrix) {
  const [a, b, c] = matrix;
  return Math.abs(
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]),
  );
}

export function vecLength(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Radius of the sphere around the cell centre that contains every cell corner. */
export function cellBoundingRadius(matrix) {
  const centre = cellCenterCart(matrix);
  let r = 0;
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
    const p = fracToCart([x, y, z], matrix);
    r = Math.max(r, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]));
  }
  return r;
}

/** Lattice matrix from cell parameters with a along x and b in the xy plane (the generator's convention). */
export function latticeFromParameters(a, b, c, alphaDeg, betaDeg, gammaDeg) {
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(alphaDeg * rad), Math.cos(betaDeg * rad), Math.cos(gammaDeg * rad)];
  const sg = Math.sin(gammaDeg * rad);
  const cy = (ca - cb * cg) / sg;
  const cz = Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy));
  return [
    [a, 0, 0],
    [b * cg, b * sg, 0],
    [c * cb, c * cy, c * cz],
  ];
}

/** Volume of a cell with unit edges and the given angles. */
export function unitCellVolume(alphaDeg, betaDeg, gammaDeg) {
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(alphaDeg * rad), Math.cos(betaDeg * rad), Math.cos(gammaDeg * rad)];
  return Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
}

// Angles that a crystal family fixes, so the "unwritten" cell already respects them.
const FIXED_ANGLES = {
  triclinic: [90, 90, 90],
  monoclinic: [90, 90, 90],
  orthorhombic: [90, 90, 90],
  tetragonal: [90, 90, 90],
  hexagonal: [90, 90, 120],
  cubic: [90, 90, 90],
};

export const NOMINAL_VOLUME_FRACTION = 0.55;

/**
 * The cell while the lattice is being written: t = 0 is a neutral cell of the right family
 * (equal edges, 55% of the final volume); t = 1 is exactly the stored lattice. In between,
 * log V, log(b/a), log(c/a) and the free angles are interpolated.
 */
export function latticeAt(lattice, t) {
  const s = Math.min(1, Math.max(0, t));
  const [a0, b0, g0] = FIXED_ANGLES[lattice.family] ?? [90, 90, 90];
  const angle = (from, to) => from + (to - from) * s;
  const alpha = angle(a0, lattice.alpha);
  const beta = angle(b0, lattice.beta);
  const gamma = angle(g0, lattice.gamma);
  const logV = Math.log(lattice.volume * NOMINAL_VOLUME_FRACTION) * (1 - s) + Math.log(lattice.volume) * s;
  const rb = Math.exp(Math.log(lattice.b / lattice.a) * s);
  const rc = Math.exp(Math.log(lattice.c / lattice.a) * s);
  const a = Math.cbrt(Math.exp(logV) / (rb * rc * unitCellVolume(alpha, beta, gamma)));
  const m = latticeFromParameters(a, rb * a, rc * a, alpha, beta, gamma);
  // Blend in the residual so that t = 1 reproduces the stored matrix exactly.
  const end = latticeFromParameters(lattice.a, lattice.b, lattice.c, lattice.alpha, lattice.beta, lattice.gamma);
  return m.map((row, i) => row.map((v, k) => v + (lattice.matrix[i][k] - end[i][k]) * s));
}
