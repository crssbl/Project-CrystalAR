// Pure: the generated sequence of a crystal as sidebar markup (rendered offline into
// index.html for the story, and at runtime in the gallery dialog).
import { escapeHtml, spaceGroupHtml, spaceGroupText, latticeToken, elementClass } from './format.js';
import { decisionBit, LEVELS } from './regions.js';

export { elementClass };

const bitsOf = (index9) => Array.from({ length: LEVELS }, (_, i) => decisionBit(index9, i + 1));

/** Plain-language summary for screen readers, since the bit grid is visual. */
export function sequenceSummary(trace) {
  const sites = trace.sites.map((s) => `${s.element} ${s.wyckoff}`).join(', ');
  const lattice = trace.lattice.active.map((v) => { const t = latticeToken(v.name, v.value); return `${t.label} ${t.text}`; }).join(', ');
  const coords = trace.sites.filter((s) => s.dof > 0).map((s) => s.form.params.map((p, j) => (
    `${s.element} ${s.wyckoff} ${p}: level decisions ${bitsOf(s.index9[j]).join(' ')}, final value ${s.u[j].toFixed(4)}`
  )).join('; ')).join('; ');
  return `Space group ${spaceGroupText(trace.spaceGroup.symbol)}, given. Template: ${sites}. Lattice: ${lattice}. Coordinates over nine levels: ${coords || 'none, every site is a fixed point'}.`;
}

export function tokensHtml(trace) {
  const sg = trace.spaceGroup;
  const template = trace.sites.map((s, k) => (
    `<span class="tok tok--pair" data-tok="t${k}"><span><i class="el-dot ${elementClass(s.element)}"></i>${escapeHtml(s.element)}</span><span>${escapeHtml(s.wyckoff)}</span></span>`
  )).join('');
  const lattice = trace.lattice.active.map((v, j) => {
    const t = latticeToken(v.name, v.value);
    return `<span class="tok" data-tok="l${j}">${escapeHtml(t.label)} <small>${escapeHtml(t.text)}</small></span>`;
  }).join('');
  const head = `<span class="bits-name"></span>${Array.from({ length: LEVELS }, (_, i) => `<span class="bits-level">${i + 1}</span>`).join('')}<span class="bits-value"></span>`;
  const rows = trace.sites.map((s) => {
    const name = `${escapeHtml(s.element)} ${escapeHtml(s.wyckoff)}`;
    if (s.dof === 0) return `<span class="bits-name">${name}</span><span class="bits-fixed">fixed point</span>`;
    return s.form.params.map((p, j) => {
      const cells = bitsOf(s.index9[j]).map((b, i) => `<span class="bit" data-tok="r${i + 1}">${b}</span>`).join('');
      return `<span class="bits-name">${name} · ${escapeHtml(p)}</span>${cells}<span class="bits-value">${s.u[j].toFixed(4)}</span>`;
    }).join('');
  }).join('');
  return [
    '<ol class="token-groups">',
    `<li class="tg"><span class="tg-label">Space group</span><span class="tg-body"><span class="tok tok--given" data-tok="g"><span>${spaceGroupHtml(sg.symbol)}</span><small>#${sg.number} · given</small></span></span></li>`,
    `<li class="tg"><span class="tg-label">Template</span><span class="tg-body">${template}</span></li>`,
    `<li class="tg"><span class="tg-label">Lattice</span><span class="tg-body">${lattice}</span></li>`,
    `<li class="tg"><span class="tg-label">Coordinates</span><span class="tg-body"><span class="bits" aria-hidden="true">${head}${rows}</span></span></li>`,
    '</ol>',
    `<p class="tokens-result">Symmetry expansion: ${trace.atoms.length} atoms in the cell</p>`,
    `<p class="sr-only">${escapeHtml(sequenceSummary(trace))}</p>`,
  ].join('\n');
}
