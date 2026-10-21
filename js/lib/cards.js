// Pure: gallery card model and markup (rendered offline into index.html, enhanced by JS).
import { escapeHtml, formulaHtml, spaceGroupHtml, signed, MLIPS, sortCards, ssunLabel } from './format.js';

export function cardModel(entry) {
  return {
    id: entry.id,
    slug: entry.slug,
    formula: entry.formula,
    formulaHtml: formulaHtml(entry.formula),
    sgHtml: spaceGroupHtml(entry.spaceGroup.symbol),
    sgNumber: entry.spaceGroup.number,
    hull: MLIPS.map((m) => ({ ...m, value: entry.hull[m.key], text: signed(entry.hull[m.key]), ssun: entry.ssunModels.includes(m.key) })),
    ssunCount: entry.ssunCount,
    ssunText: ssunLabel(entry.ssunCount),
    poster: entry.poster,
    cif: entry.cif,
    replay: entry.replay !== false,
  };
}

export function cardHtml(entry) {
  const c = cardModel(entry);
  const dots = [0, 1, 2].map((i) => `<i class="${i < c.ssunCount ? 'on' : ''}"></i>`).join('');
  const hull = c.hull.map((h) => (
    `<div${h.ssun ? ' class="is-ssun"' : ''}><dt>${h.name}</dt><dd>${h.text}</dd></div>`
  )).join('');
  return `<li class="card" data-id="${escapeHtml(c.id)}" data-slug="${escapeHtml(c.slug)}">
  <figure class="card-figure"><img src="${escapeHtml(c.poster)}" alt="" width="640" height="640" loading="lazy" decoding="async"></figure>
  <div class="card-body">
    <div class="card-head">
      <h3 class="card-title"><button class="card-open" type="button" aria-haspopup="dialog" data-open="${escapeHtml(c.slug)}"><span class="formula">${c.formulaHtml}</span><span class="sr-only">, open 3D view</span></button></h3>
      <span class="card-id">${escapeHtml(c.id)}</span>
    </div>
    <p class="card-sg">${c.sgHtml} <span>#${c.sgNumber}</span></p>
    <dl class="hull" aria-label="Signed distance to the MLIP reference hull, meV/atom">${hull}</dl>
    <div class="card-foot">
      <span class="ssun"><span class="ssun-dots" aria-hidden="true">${dots}</span>${escapeHtml(c.ssunText)}</span>
      <a class="card-cif" href="${escapeHtml(c.cif)}" download>CIF<span class="sr-only"> of ${escapeHtml(c.formula)}</span></a>
    </div>
  </div>
</li>`;
}

export function cardsHtml(entries) {
  return sortCards(entries).map(cardHtml).join('\n');
}
