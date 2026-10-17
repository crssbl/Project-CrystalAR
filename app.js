import { mountMethod } from './modules/method.js';
import { createCrystalViewer } from './modules/viewer.js';

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formulaHTML = (formula) => escapeHTML(formula).replace(/(\d+(?:\.\d+)?)/g, '<sub>$1</sub>');
const groupLabel = (symbol) => symbol.replace(/_(\d)/g, (_, d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
const fetchJSON = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response.json();
};

function renderIdentity(site) {
  document.title = site.title;
  const narrative = {
    heroDescription:'.hero-description', methodTitle:'#method-heading', methodIntro:'#method .section-intro',
    crystalsTitle:'#crystals-heading', crystalsIntro:'#crystals .section-intro', resultsTitle:'#results-heading',
    resultsIntro:'#results .section-intro', citationTitle:'.citation-inner h2', citationIntro:'.citation-inner > div > p:not(.eyebrow)'
  };
  Object.entries(narrative).forEach(([key,selector]) => {
    if (site.copy?.[key]) $(selector).innerHTML = escapeHTML(site.copy[key]).replace(/\n/g,'<br>');
  });
  document.querySelectorAll('a[data-paper-link]').forEach(a => { a.href = site.paperPath; });
  document.querySelectorAll('a[href="https://github.com/crssbl/CrystalAR"]').forEach(a => { a.href = site.codeUrl; });
  $('#authors').innerHTML = site.authors.map((a) => `<a href="${escapeHTML(a.url)}" target="_blank" rel="noopener">${escapeHTML(a.name)}<sup>${a.affiliation}${a.equal ? '*' : ''}</sup></a>`).join('');
  $('#affiliations').innerHTML = site.affiliations.map((name, i) => `<span><sup>${i + 1}</sup>${escapeHTML(name)}</span>`).join('');
  $('#code-link').href = site.codeUrl;
  const bibtex = `@misc{crystalar,\n  title = {${site.title}},\n  author = {Meng, Ziqiao and Chen, Rongsheng and Zheng, Zhi\n    and Kazeev, Nikita and Wang, Zhenkun\n    and Ustyuzhanin, Andrey E and Lee, Wee Sun},\n  howpublished = {Manuscript}\n}`;
  $('#bibtex').textContent = bibtex;
  $('#copy-citation').addEventListener('click', async () => {
    const copied = await copyText(bibtex);
    $('#citation-status').textContent = copied ? 'Citation copied.' : 'Select the citation above to copy.';
    $('#copy-citation').firstChild.textContent = copied ? 'Copied ' : 'Copy citation ';
    setTimeout(() => { $('#citation-status').textContent = ''; $('#copy-citation').firstChild.textContent = 'Copy citation '; }, 3000);
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const field = document.createElement('textarea');
    field.value = text; field.setAttribute('readonly',''); field.style.cssText = 'position:fixed;left:-9999px;';
    document.body.append(field); field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Manual selection remains available. */ }
    field.remove(); return copied;
  }
}

function table(headers, rows, ours = []) {
  return `<table class="data-table"><thead><tr>${headers.map((h) => `<th scope="col">${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, i) => `<tr${ours[i] ? ' class="ours"' : ''}>${row.map((cell, j) => j === 0 ? `<th scope="row">${escapeHTML(cell)}</th>` : `<td>${escapeHTML(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderSymmetry(metrics) {
  const width = 660, height = 355;
  const plot = { left: 55, top: 20, right: 30, bottom: 57 };
  const x = (value) => plot.left + value / 420 * (width - plot.left - plot.right);
  const y = (value) => height - plot.bottom - value / 0.36 * (height - plot.top - plot.bottom);
  const labels = {
    'DiffCSP':[-8,19,'end'], 'DiffCSP++':[9,-10,'start'],
    'WyFormer':[-7,-12,'end'], 'SGEquiDiff':[-7,-12,'end'],
    'SymmCD':[9,18,'start'], 'CrystalFormer':[9,-10,'start'],
    'CrystalAR (SV)':[11,-10,'start'], 'CrystalAR':[-11,-12,'end']
  };
  const svg = [`<svg class="symmetry-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="symmetry-svg-title symmetry-svg-desc"><title id="symmetry-svg-title">Template exploration and symmetric material discovery</title><desc id="symmetry-svg-desc">Novel unique templates on the horizontal axis and S.S.U.N. rate in percent on the vertical axis. CrystalAR has 161 templates and 0.28 percent S.S.U.N.; its flexible-size variant has 268 templates and 0.19 percent. Exact data follows this chart.</desc>`];
  [0,0.1,0.2,0.3].forEach((n) => svg.push(`<line class="grid-line" x1="${plot.left}" x2="${width-plot.right}" y1="${y(n)}" y2="${y(n)}"/><text x="${plot.left-13}" y="${y(n)+4}" text-anchor="end">${n.toFixed(1)}</text>`));
  [0,100,200,300,400].forEach((n) => svg.push(`<text x="${x(n)}" y="${height-plot.bottom+23}" text-anchor="middle">${n}</text>`));
  svg.push(`<line x1="${plot.left}" x2="${width-plot.right}" y1="${y(0)}" y2="${y(0)}" stroke="#9eafa4"/><text class="axis-title" x="${(width+plot.left-plot.right)/2}" y="${height-7}" text-anchor="middle">Novel unique templates →</text><text class="axis-title" transform="translate(13 ${height/2-12}) rotate(-90)" text-anchor="middle">S.S.U.N. (%) ↑</text>`);
  metrics.forEach((m) => {
    const [dx,dy,anchor] = labels[m.model];
    const color = m.ours ? '#057f7a' : m.variant ? '#91aa62' : '#91a69b';
    const label = `${m.model}: ${m.templates} novel unique templates; ${m.ssun.toFixed(2)}% S.S.U.N.`;
    svg.push(`<g class="chart-point" tabindex="0" role="img" aria-label="${escapeHTML(label)}"><title>${escapeHTML(label)}</title>`);
    svg.push(`<circle cx="${x(m.templates)}" cy="${y(m.ssun)}" r="${m.ours ? 6 : 4.5}" fill="${color}"/><text class="point-label ${m.ours ? 'ours-label' : ''}" x="${x(m.templates)+dx}" y="${y(m.ssun)+dy}" text-anchor="${anchor}">${escapeHTML(m.model)}</text></g>`);
  });
  svg.push('</svg>');
  $('#symmetry-chart').innerHTML = svg.join('');
  $('#symmetry-table').innerHTML = table(['Model','Novel unique templates','S.S.U.N. (%)'], metrics.map((m) => [m.model === 'WyFormer' ? 'WyFormer + DiffCSP++' : m.model,m.templates,m.ssun.toFixed(2)]),metrics.map((m) => m.ours));
}

function renderQuality(quality, setting) {
  const rows = quality[setting];
  const stableMax = setting === 'with' ? 16 : 8;
  const sunMax = setting === 'with' ? 1.2 : 0.4;
  $('#quality-chart').innerHTML = `<div class="bar-chart" role="img" aria-label="Selected baseline comparison: stability and stable, unique, novel rates. Exact values follow below."><div class="bar-head"><span>MODEL</span><span>STABLE (%)<small>0–${stableMax}</small></span><span>S.U.N. (%)<small>0–${sunMax}</small></span></div>${rows.map((r) => `<div class="bar-row${r.ours ? ' ours' : ''}"><span class="bar-model">${escapeHTML(r.model)}</span><div class="bar-track"><i style="width:${r.stable/stableMax*100}%"></i><b>${r.stable.toFixed(1)}</b></div><div class="bar-track sun"><i style="width:${r.sun/sunMax*100}%"></i><b>${r.sun.toFixed(1)}</b></div></div>`).join('')}<p class="chart-scale">Separate scales for stability and S.U.N. · Higher is better.</p></div>`;
  $('#quality-table').innerHTML = table(['Model','Stable (%)','S.U.N. (%)','S.U.N. count'], rows.map((r) => [r.model,r.stable.toFixed(1),r.sun.toFixed(1),r.sunCount]), rows.map((r) => r.ours));
  const ours = rows.find((r) => r.ours);
  $('#quality-stat').innerHTML = `${ours.stable.toFixed(1)}<span>%</span>`;
  $('#quality-stat-label').textContent = `Stable · ${setting === 'with' ? 'with' : 'without'} pre-relaxation`;
}

function renderCSP(allRows, dataset) {
  const rows = allRows.filter((r) => r[dataset].one !== null || r[dataset].twenty !== null);
  const value = (n) => n == null ? '—' : n.toFixed(2);
  $('#csp-chart').innerHTML = `<div class="csp-chart-legend"><span><i></i>One candidate</span><span><i></i>20 candidates</span></div><div role="img" aria-label="${dataset === 'mp20' ? 'MP-20' : 'MPTS-52'} match rate by number of candidates. Exact values and RMSE follow below.">${rows.map((r) => `<div class="csp-row${r.ours ? ' ours' : ''}"><span class="bar-model">${escapeHTML(r.model)}</span><div class="csp-bars">${['one','twenty'].map((n) => `<div class="csp-track ${n}"><i style="width:${r[dataset][n] ?? 0}%"></i><b>${value(r[dataset][n])}</b></div>`).join('')}</div></div>`).join('')}<p class="chart-scale">Common 0–100% match-rate scale · Higher is better.</p></div>`;
  $('#csp-table').innerHTML = table(['Model','MR, 1 (%)','MR, 20 (%)','RMSE, 1','RMSE, 20'],rows.map((r) => [r.model,value(r[dataset].one),value(r[dataset].twenty),r[dataset].rmseOne?.toFixed(4) ?? '—',r[dataset].rmseTwenty?.toFixed(4) ?? '—']),rows.map((r) => r.ours));
  const ours = rows.find((r) => r.ours)[dataset];
  $('#csp-stat').innerHTML = `${ours.one.toFixed(2)}<span>%</span>`;
  $('#csp-stat-label').textContent = `${dataset === 'mp20' ? 'MP-20' : 'MPTS-52'} match rate · one candidate`;
}

function mountResults(metrics) {
  renderSymmetry(metrics.symmetry);
  renderQuality(metrics.quality, 'without');
  renderCSP(metrics.csp, 'mpts52');
  const tabs = [...document.querySelectorAll('.result-tabs [role=tab]')];
  function selectTab(tab, focus = false) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected)); t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = tabs[(i+1)%tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(i+tabs.length-1)%tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs.at(-1);
      if (next) { event.preventDefault(); selectTab(next, true); }
    });
  });
  document.querySelectorAll('[name=relaxation]').forEach((el) => el.addEventListener('change', () => renderQuality(metrics.quality, el.value)));
  document.querySelectorAll('[name=csp-dataset]').forEach((el) => el.addEventListener('change', () => renderCSP(metrics.csp, el.value)));
}

async function mountCrystals() {
  const index = await fetchJSON('data/index.json');
  const samples = index.samples;
  if (!Array.isArray(samples) || !samples.length) throw new Error('No crystal samples are available.');
  const cache = new Map();
  const getStructure = (sample) => {
    if (!cache.has(sample.id)) cache.set(sample.id, fetchJSON(sample.structurePath).catch((error) => { cache.delete(sample.id); throw error; }));
    return cache.get(sample.id);
  };
  $('#sample-list').innerHTML = samples.map((s, i) => `<button class="sample-button" type="button" data-sample="${escapeHTML(s.id)}" aria-pressed="false" aria-label="Explore ${escapeHTML(s.formula)}, space group ${s.spaceGroup.number}"><span class="sample-order">${String(i+1).padStart(2,'0')}</span><img src="${escapeHTML(s.thumbnailPath)}" alt="" width="100" height="70" loading="lazy"><span class="sample-label">${formulaHTML(s.formula)}</span></button>`).join('');
  const viewer = await createCrystalViewer($('#crystal-viewer'), {interactive:true});
  let representation = 'ball-and-stick';
  viewer.setRepresentation(representation);
  viewer.setTheme('dark');
  const syncViewerControls = () => {
    const fallback = $('#crystal-viewer').dataset.viewerState === 'fallback';
    document.querySelectorAll('.representation-controls button, .studio-switch button, .viewer-options input, .display-settings input, .display-settings select, .stage-actions button').forEach(control => { control.disabled = fallback; });
    $('#bond-scale').disabled = fallback || !['ball-and-stick','sticks'].includes(representation);
    $('#atom-scale').disabled = fallback || representation === 'sticks';
    $('.interaction-hint').textContent = fallback
      ? 'Static image · 3D view unavailable in this browser'
      : 'Drag to rotate · Scroll or pinch to zoom';
    $('#contact-note').textContent = ['ball-and-stick','sticks'].includes(representation)
      ? 'Sticks show geometric near-neighbor contacts.'
      : 'Sphere sizes are illustrative; coordinates are unchanged.';
  };
  new MutationObserver(syncViewerControls).observe($('#crystal-viewer'), {attributes:true,attributeFilter:['data-viewer-state']});
  let currentSample;
  let selectionVersion = 0;
  async function selectSample(sample, updateUrl = true) {
    const version = ++selectionVersion;
    $('#crystal-status').textContent = `Loading ${sample.formula}.`;
    $('#crystal-viewer').setAttribute('aria-busy','true');
    try {
      const structure = await getStructure(sample);
      if (version !== selectionVersion) return;
      currentSample = sample;
      document.querySelectorAll('.sample-button').forEach((b) => b.setAttribute('aria-pressed',String(b.dataset.sample === sample.id)));
      $('#sample-formula').innerHTML = formulaHTML(sample.formula);
      $('#sample-sg').textContent = groupLabel(sample.spaceGroup.symbol);
      $('#sample-sg-number').textContent = `${sample.spaceGroup.number}`;
      $('#sample-atoms').textContent = `${sample.atomCount}`;
      $('#sample-template').textContent = sample.template || 'See the saved structure';
      $('#case-id').textContent = sample.id;
      const elements = [...new Map(structure.atoms.map((a) => [a.element,a])).values()];
      $('#element-legend').innerHTML = elements.map((a) => `<span class="element-key"><i style="background:${/^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : '#8ca99c'}"></i>${escapeHTML(a.element)}</span>`).join('');
      $('#download-cif').href = sample.cifPath;
      $('#download-cif').download = `${sample.slug}.cif`;
      await viewer.load(sample, structure);
      syncViewerControls();
      viewer.setCell($('#show-cell').checked);
      viewer.setPeriodic($('#show-periodic').checked);
      $('#crystal-viewer').setAttribute('aria-label', `${sample.formula}, ${sample.atomCount} atoms in the source cell, space group ${sample.spaceGroup.number}. Use arrow keys to rotate, plus and minus to zoom, zero to reset.`);
      $('#crystal-status').textContent = `${sample.formula} loaded. Space group ${sample.spaceGroup.number}; ${sample.atomCount} atoms in the source cell.`;
      if (updateUrl) {
        const url = new URL(location.href); url.searchParams.set('crystal',sample.slug);
        history.replaceState(null,'',url);
      }
    } catch (error) {
      $('#crystal-status').textContent = 'This structure could not be loaded. Please choose another sample or reload the page.';
      console.error(error);
    } finally { if (version === selectionVersion) $('#crystal-viewer').setAttribute('aria-busy','false'); }
  }
  $('#sample-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sample]');
    if (button) selectSample(samples.find((s) => s.id === button.dataset.sample));
  });
  $('#reset-camera').addEventListener('click', () => viewer.reset());
  $('#show-cell').addEventListener('change', (event) => viewer.setCell(event.target.checked));
  $('#show-periodic').addEventListener('change', (event) => viewer.setPeriodic(event.target.checked));
  $('#auto-rotate').addEventListener('change', (event) => viewer.setAutoRotate(event.target.checked));
  document.querySelectorAll('[data-representation]').forEach(button => button.addEventListener('click', () => {
    representation = button.dataset.representation;
    viewer.setRepresentation(representation);
    document.querySelectorAll('[data-representation]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    syncViewerControls();
    $('#crystal-status').textContent = `${button.textContent.trim()} representation selected.`;
  }));
  document.querySelectorAll('.studio-switch [data-viewer-theme]').forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.viewerTheme;
    viewer.setTheme(theme);
    $('.explorer-stage').dataset.theme = theme;
    document.querySelectorAll('.studio-switch [data-viewer-theme]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  $('#atom-scale').addEventListener('input', event => {
    const scale = Number(event.target.value);
    viewer.setAtomScale(scale);
    $('#atom-scale-value').textContent = `${scale.toFixed(2)}×`;
  });
  $('#bond-scale').addEventListener('input', event => {
    const scale = Number(event.target.value);
    viewer.setBondScale(scale);
    $('#bond-scale-value').textContent = `${scale.toFixed(2)}×`;
  });
  $('#viewer-projection').addEventListener('change', event => viewer.setProjection(event.target.value));
  $('#export-crystal').addEventListener('click', async () => {
    if (!currentSample) return;
    try {
      const image = await viewer.exportImage();
      if (!image) throw new Error('No rendered image available.');
      const blob = await (await fetch(image)).blob();
      const imageUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = imageUrl; link.download = `${currentSample.slug}-${representation}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(imageUrl), 30000);
      $('#crystal-status').textContent = 'Crystal image saved as PNG.';
    } catch (error) {
      $('#crystal-status').textContent = 'Image export is unavailable in this browser. You can still download the CIF.';
      console.warn('Crystal image export unavailable',error);
    }
  });
  $('#copy-crystal').addEventListener('click', async () => {
    if (!currentSample) return;
    const url = new URL(location.href); url.searchParams.set('crystal',currentSample.slug); url.hash = 'crystals';
    const success = await copyText(url.href);
    $('#copy-crystal').textContent = success ? 'Link copied ✓' : 'Copy this page’s address from your browser';
    setTimeout(() => { $('#copy-crystal').textContent = 'Copy link to this crystal ↗'; }, 3000);
  });
  const requested = new URLSearchParams(location.search).get('crystal');
  await selectSample(samples.find((s) => s.slug === requested) || samples[0], false);
  try {
    const heroSample = samples[0];
    const structure = await getStructure(heroSample);
    const hero = await createCrystalViewer($('#hero-viewer'), {interactive:false,compact:true});
    await hero.load(heroSample, structure); hero.setCell(true); hero.setPeriodic(true); hero.setAutoRotate(true);
    $('#hero-formula').innerHTML = formulaHTML(heroSample.formula);
    $('#hero-spacegroup').textContent = `${groupLabel(heroSample.spaceGroup.symbol)} · SG ${heroSample.spaceGroup.number}`;
  } catch (error) { console.warn('Hero viewer unavailable',error); }
}

async function boot() {
  try {
    const site = await fetchJSON('data/site.json');
    renderIdentity(site); mountResults(site.metrics);
    mountMethod($('#method-demo'));
  } catch (error) {
    console.error(error);
    $('#method-demo').innerHTML = '<p class="load-error">Some page content could not be loaded. Start the included local preview server, then reload this page. The paper and code links remain available.</p>';
  }
  try { await mountCrystals(); }
  catch (error) {
    console.error(error);
    $('#crystal-viewer').innerHTML = '<p class="load-error">The crystal collection could not be loaded. Please reload the page using the included local preview server.</p>';
    $('#hero-viewer').innerHTML = '<img class="viewer-fallback" src="assets/crystals/denovo-75.png" alt="Generated La5Bi3Cl crystal">';
  }
}
boot();
