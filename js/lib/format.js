// Pure formatting helpers shared by the page, the offline markup tool and the tests.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** CSS class of an element's colour dot: 'La' → 'el-La'. */
export function elementClass(element) {
  return `el-${String(element).replace(/[^A-Za-z]/g, '')}`;
}

/** 'La5Bi3Cl' → 'La<sub>5</sub>Bi<sub>3</sub>Cl' */
export function formulaHtml(formula) {
  return escapeHtml(formula).replace(/(\d+(?:\.\d+)?)/g, '<sub>$1</sub>');
}

/**
 * Hermann–Mauguin symbol as HTML: screw axes '6_3' → 6<sub>3</sub>, rotoinversions '-3' → 3̄
 * (drawn with a CSS overline).
 */
export function spaceGroupHtml(symbol) {
  return escapeHtml(symbol)
    .replace(/(\d)_(\d)/g, '$1<sub>$2</sub>')
    .replace(/-(\d)/g, '<span class="bar">$1</span>');
}

/** Plain-text space group for labels and alt text: 'P6_3/mcm' → 'P6₃/mcm', '-3' → '-3'. */
export function spaceGroupText(symbol) {
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆' };
  return String(symbol).replace(/_(\d)/g, (_, d) => SUB[d] ?? d);
}

/** Signed value with a real minus sign and fixed decimals: −54.5, +4.3, 0.0 */
export function signed(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toFixed(digits)}`;
}

/** Compact fixed number: 562.68 → '562.7', 0.68981 → '0.690'. */
export function fixed(value, digits) {
  return Number(value).toFixed(digits);
}

export const MLIPS = Object.freeze([
  { key: 'orb', name: 'Orb' },
  { key: 'mace', name: 'MACE' },
  { key: 'uma', name: 'UMA' },
]);

export const meanHull = (entry) => MLIPS.reduce((s, m) => s + entry.hull[m.key], 0) / MLIPS.length;

/**
 * Gallery order: the story crystal first; then by how many MLIPs judge the crystal S.S.U.N.
 * (descending), then by the mean of the three signed hull distances (ascending).
 */
export function sortCards(entries, pinnedId = 'denovo:75') {
  const idNum = (id) => Number(String(id).split(':')[1] ?? 0);
  return [...entries].sort((a, b) => {
    if (a.id === pinnedId) return -1;
    if (b.id === pinnedId) return 1;
    if (b.ssunCount !== a.ssunCount) return b.ssunCount - a.ssunCount;
    const d = meanHull(a) - meanHull(b);
    if (Math.abs(d) > 1e-12) return d;
    return idNum(a.id) - idNum(b.id);
  });
}

export const ssunLabel = (count) => `S.S.U.N. by ${count} of 3 MLIPs`;

/** Lattice variable label and value for the token sidebar. */
export function latticeToken(name, value) {
  const LABEL = { V: 'V', 'b/a': 'b/a', 'c/a': 'c/a', alpha: 'α', beta: 'β', gamma: 'γ' };
  const text = name === 'V' ? `${fixed(value, 1)} Å³` : ['alpha', 'beta', 'gamma'].includes(name) ? `${fixed(value, 2)}°` : fixed(value, 3);
  return { label: LABEL[name] ?? name, text };
}
