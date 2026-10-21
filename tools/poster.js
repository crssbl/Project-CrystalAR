// Poster export page: renders every static image of the site with the site's own renderer.
import { createCrystalView } from '../js/render/crystal-view.js';
import { finalDisplay, sceneAt } from '../js/lib/scene-state.js';
import { stillProgress, STEPS } from '../js/lib/story-timeline.js';
import { VIEWS, POSTER_SIZES, STILL_SIZE } from '../js/lib/views.js';

// Same orbit mark as the #glyph symbol in index.html (kept in sync by tests/unit/mark.test.mjs).
const ORBIT_MARK = '<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.45" r="3.55" fill="#00753F"/>'
  + '<circle cx="5.59" cy="17.55" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/>'
  + '<circle cx="18.41" cy="17.55" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
const frame = document.querySelector('[data-frame]');
const select = document.querySelector('[data-item]');
const download = document.querySelector('[data-download]');
const traces = new Map();

async function trace(slug) {
  if (!traces.has(slug)) traces.set(slug, await (await fetch(`../data/crystals/${slug}.json`)).json());
  return traces.get(slug);
}

async function itemList() {
  const items = [{ key: 'hero', file: 'assets/img/posters/denovo-75-hero.webp' }];
  STEPS.forEach((_, i) => items.push({ key: `still:${i + 1}`, file: `assets/img/story/step-${i + 1}.webp` }));
  let slugs = ['denovo-75'];
  try {
    const index = await (await fetch('../data/crystals/index.json')).json();
    slugs = index.crystals.map((c) => c.slug);
  } catch { /* only the story crystal is exported yet */ }
  slugs.forEach((slug) => items.push({ key: `poster:${slug}`, file: `assets/img/posters/${slug}.webp` }));
  items.push({ key: 'og', file: 'og-draft.png', screenshot: true });
  return items;
}

function sizeFrame(width, height, stage) {
  frame.innerHTML = '';
  frame.className = `poster-frame${stage ? ' is-stage' : ''}`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
}

async function renderView(slug, width, height, preset, display) {
  const t = await trace(slug);
  sizeFrame(width, height, preset.theme === 'stage');
  const view = await createCrystalView(frame, {
    ...preset, interactive: false, preserveDrawingBuffer: true, pixelRatio: 1, overlay: false,
  });
  if (!view) throw new Error('WebGL2 unavailable');
  view.setTrace(t);
  view.setDisplay(display(t));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dataUrl = view.snapshot('image/webp', 0.9);
  view.dispose();
  return dataUrl;
}

async function renderOg() {
  sizeFrame(1200, 630, false);
  frame.innerHTML = `<div class="og-card">
    <div class="og-copy">
      <span class="wm">${ORBIT_MARK}CrystalAR</span>
      <p class="og-sub">Autoregressive Modeling for Symmetric Crystal Generation</p>
      <p class="og-dek">Given a space group, one model writes the Wyckoff template, the lattice and the coordinates, coarse to fine.</p>
    </div>
    <div class="og-art" data-og-art></div>
  </div>`;
  const art = frame.querySelector('[data-og-art]');
  const t = await trace('denovo-75');
  const view = await createCrystalView(art, { theme: 'light', interactive: false, preserveDrawingBuffer: true, pixelRatio: 2, ...VIEWS.hero, overlay: false });
  view.setTrace(t);
  view.setDisplay(finalDisplay(t));
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  view.snapshot();
  return null; // captured as a screenshot of the frame by the export script
}

export async function renderItem(key) {
  if (key === 'hero') {
    const s = POSTER_SIZES.hero;
    return renderView('denovo-75', s, s, VIEWS.hero, finalDisplay);
  }
  if (key.startsWith('poster:')) {
    const s = POSTER_SIZES.card;
    return renderView(key.slice(7), s, s, VIEWS.card, finalDisplay);
  }
  if (key.startsWith('still:')) {
    // Site labels are not drawn into the stills: at still size they are too small and crowded,
    // so the page lists the sites in a caption line under the still (story-text.js).
    const step = Number(key.slice(6)) - 1;
    return renderView('denovo-75', STILL_SIZE.width, STILL_SIZE.height, VIEWS.story,
      (t) => sceneAt(t, stillProgress(step), { labels: false }).display);
  }
  if (key === 'og') return renderOg();
  throw new Error(`unknown item ${key}`);
}

const items = await itemList();
select.innerHTML = items.map((it) => `<option value="${it.key}">${it.key} → ${it.file}</option>`).join('');
document.querySelector('[data-render]').addEventListener('click', async () => {
  const item = items.find((it) => it.key === select.value);
  const url = await renderItem(item.key);
  if (url) {
    download.href = url;
    download.download = item.file.split('/').pop();
  }
});
window.__poster = { items, renderItem };
