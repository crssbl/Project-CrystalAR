import { readFile, writeFile } from 'node:fs/promises';
import { escapeHtml as esc } from '../js/lib/format.js';
import { replaceBetween } from './render-gallery.mjs';

const data = JSON.parse(await readFile(new URL('../data/numbers.json', import.meta.url), 'utf8'));
const tables = new Map(data.tables.map((t) => [t.number, t]));
export function numberCell(reference, tag = 'span') {
  const [n, r, c] = reference;
  return `<${tag} data-number="t${n}-r${r}-c${c}">${esc(tables.get(n).rows[r].values[c - 1])}</${tag}>`;
}
const value = (key) => numberCell(data.highlights[key]);
const source = (n) => `<a class="number-source" href="https://arxiv.org/pdf/2610.27762v1#page=${tables.get(n).page}" target="_blank" rel="noopener">Table ${n}<span class="sr-only"> in the paper (opens in a new tab)</span> ↗</a>`;
const [st, sr, sc] = data.highlights.stable;
const stable = Number(tables.get(st).rows[sr].values[sc - 1]);
const bars = [['CrystalAR', 'stable'], ['PLaID++', 'plaid'], ['WyFormer-DFT', 'wyformer']].map(([name, key]) => {
  const [n, r, c] = data.highlights[key];
  const v = Number(tables.get(n).rows[r].values[c - 1]);
  return `<li><span>${name}</span><span>${value(key)}%</span><i style="--bar:${(v / stable * 100).toFixed(2)}%" aria-hidden="true"></i></li>`;
}).join('');
const cards = `<div class="number-cards">
<article class="number-card"><p class="metric-label">De novo · with pre-relaxation</p><h3><span class="metric-value">${value('stable')}<span class="metric-unit">%</span></span> <small>stable</small></h3><ul class="comparison-bars">${bars}</ul><p class="metric-note">CrystalAR has ${value('parameters')} parameters; PLaID++ is a ${value('plaidParameters')} post-trained model.</p>${source(1)}</article>
<article class="number-card"><p class="metric-label">Symmetry · MP-20</p><h3>${value('novel')}<small>novel unique templates</small></h3><p class="metric-secondary">${value('ssun')}% <span>S.S.U.N.</span></p><p class="metric-note">Explore symmetry templates and realize them as complete crystals.</p>${source(2)}</article>
<article class="number-card"><p class="metric-label">CSP · single hypothesis</p><h3><span class="metric-value">${value('mp20')}<span class="metric-unit">%</span></span> <small>MP-20 match rate</small></h3><p class="metric-secondary">${value('mpts52')}% <span>MPTS-52 match rate</span></p><p class="metric-note">Predict structures from composition and a given space group, without retrieving a Wyckoff template.</p>${source(3)}</article>
</div>`;

function tableHtml(table) {
  let group = '';
  const rows = table.rows.map((row, ri) => {
    let head = '';
    if (row.group && row.group !== group) {
      group = row.group;
      head = `<tr class="table-group"><th colspan="${table.columns.length}" scope="rowgroup">${esc(group)}</th></tr>`;
    }
    return head + `<tr><th scope="row">${esc(row.label)}</th>${row.values.map((_, ci) => numberCell([table.number, ri, ci + 1], 'td')).join('')}</tr>`;
  }).join('\n');
  return `<section class="paper-table" id="table-${table.number}" aria-labelledby="table-title-${table.number}" data-paper-table>
<h3 id="table-title-${table.number}">Table ${table.number} · ${esc(table.title)}</h3>
<p class="table-caption">${esc(table.caption)}</p>
<div class="table-scroll" role="region" aria-label="Table ${table.number}, scroll horizontally" tabindex="0"><table><caption class="sr-only">${esc(table.title)}</caption><thead><tr>${table.columns.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${source(table.number)}</section>`;
}
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
html = replaceBetween(html, 'results', cards + `
<details class="all-numbers" id="paper-tables"><summary>All numbers from the paper <span>Tables 1–3 and 6–10</span></summary>
<p class="fine">Values and captions follow arXiv v1; caption descriptions of emphasis and colors refer to the original PDF.</p>
<div class="table-tabs" data-table-tabs hidden>${data.tables.map((t) => `<button type="button" data-table-target="table-${t.number}">Table ${t.number}</button>`).join('')}</div>
${data.tables.map(tableHtml).join('\n')}</details>`);
await writeFile(new URL('../index.html', import.meta.url), html);
