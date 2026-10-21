// Gallery: each card opens an accessible dialog (focus trap, Esc closes, focus returns) with
// a rotatable 3D view, "Replay generation" through the same story engine, and the CIF file.
// Without WebGL, or when the 3D data cannot load, the dialog keeps the poster and says so; when
// the crystal list itself cannot load, the card says so and the next click tries again.
import { formulaHtml, spaceGroupHtml, MLIPS, signed, ssunLabel, escapeHtml } from './lib/format.js';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
// Static lines that replace the rotate hint when the dialog has no 3D view.
const STILL_NOTE = {
  nogl: 'This browser cannot show the 3D view, so a still image is shown.',
  failed: 'The 3D view could not be loaded, so a still image is shown.',
};
const CARD_ERROR = 'The crystal data could not be loaded. Please try again.';

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export function init() {
  const gallery = document.querySelector('[data-gallery]');
  const dialog = document.querySelector('[data-dialog]');
  if (!gallery || !dialog || typeof dialog.showModal !== 'function') return;
  const $ = (sel) => dialog.querySelector(sel);
  const stage = $('[data-dialog-stage]');
  const poster = $('[data-dialog-poster]');
  const phase = $('[data-dialog-phase]');
  const replayBtn = $('[data-dialog-replay]');
  const closeBtn = $('[data-dialog-close]');
  const cif = $('[data-dialog-cif]');
  const note = $('[data-dialog-note]');
  const rotateHint = note.textContent;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const api = { open: null, progress: null, replaying: false, still: null };
  window.__crystalar = Object.assign(window.__crystalar ?? {}, { dialog: api });

  // A failed request is not cached, so the next click tries again.
  let indexPromise = null;
  const index = () => (indexPromise ??= getJson('data/crystals/index.json').catch((error) => {
    indexPromise = null;
    throw error;
  }));
  let view = null;
  let opener = null;
  let stopReplay = null;
  let session = 0;

  // An inline line on the card (role="status"), or none when `text` is null.
  function cardMessage(card, text) {
    if (!card) return;
    let el = card.querySelector('[data-card-status]');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('p');
      el.className = 'card-status';
      el.setAttribute('role', 'status');
      el.dataset.cardStatus = '';
      (card.querySelector('.card-body') ?? card).append(el);
      // Live regions announce changes, so the text goes in once the empty region is in place.
      requestAnimationFrame(() => { el.textContent = text; });
      return;
    }
    el.textContent = text;
  }

  async function open(slug, from) {
    const mine = ++session;
    opener = from;
    const { crystals } = await index();
    if (mine !== session) return;
    const entry = crystals.find((c) => c.slug === slug);
    if (!entry) throw new Error(`${slug} is not in data/crystals/index.json`);
    cardMessage(from?.closest('.card'), null);
    api.open = entry.id;
    api.still = null;
    $('[data-dialog-id]').textContent = entry.id;
    $('[data-dialog-title]').innerHTML = formulaHtml(entry.formula);
    $('[data-dialog-sg]').innerHTML = `${spaceGroupHtml(entry.spaceGroup.symbol)} · No. ${entry.spaceGroup.number} · ${entry.nAtoms} atoms in the cell`;
    $('[data-dialog-hull]').innerHTML = MLIPS.map((m) => (
      `<div${entry.ssunModels.includes(m.key) ? ' class="is-ssun"' : ''}><dt>${m.name}</dt><dd>${signed(entry.hull[m.key])}</dd></div>`
    )).join('');
    $('[data-dialog-ssun]').innerHTML = `${escapeHtml(ssunLabel(entry.ssunCount))} · signed distance to the reference hull, meV/atom`;
    $('[data-dialog-template]').textContent = `Template: ${entry.template.join(' · ')}`;
    const relaxation = $('[data-dialog-relaxation]');
    relaxation.textContent = entry.relaxationNote ?? '';
    relaxation.hidden = !entry.relaxationNote;
    cif.href = entry.cif;
    cif.setAttribute('download', `${entry.slug}.cif`);
    poster.src = entry.poster;
    poster.alt = `${entry.formula} unit cell`;
    poster.hidden = false;
    phase.textContent = '';
    note.textContent = rotateHint;
    replayBtn.disabled = entry.replay === false;
    replayBtn.textContent = entry.replay === false ? 'Replay unavailable' : 'Replay generation';
    dialog.showModal();
    closeBtn.focus();
    attach3d(entry, mine);
  }

  // No 3D in the dialog: the poster stays, replay is off, and the hint no longer talks about
  // rotating. `reason` is 'nogl' (no WebGL2) or 'failed' (data, renderer or context lost).
  function stillOnly(reason) {
    stopReplay?.();
    view?.dispose();
    view = null;
    api.view = null;
    api.trace = null;
    api.still = reason;
    poster.hidden = false;
    phase.textContent = '';
    if (document.activeElement === replayBtn) closeBtn.focus();
    replayBtn.disabled = true;
    replayBtn.textContent = 'Replay unavailable';
    note.textContent = STILL_NOTE[reason] ?? STILL_NOTE.failed;
  }

  async function attach3d(entry, mine) {
    const current = () => mine === session && dialog.open;
    try {
      const [{ createCrystalView }, { hasWebGL2 }, { finalDisplay }, { VIEWS }] = await Promise.all([
        import('./render/crystal-view.js'), import('./render/three-loader.js'),
        import('./lib/scene-state.js'), import('./lib/views.js'),
      ]);
      if (!current()) return;
      if (!hasWebGL2()) { stillOnly('nogl'); return; }
      const trace = await getJson(entry.trace);
      if (!current()) return;
      const created = await createCrystalView(stage, { ...VIEWS.dialog, label: `${entry.formula} unit cell`, canvasClass: 'crystal-canvas xdialog-canvas' });
      if (!current()) { created?.dispose(); return; }
      if (!created) { stillOnly('nogl'); return; }
      view = created;
      view.onContextLost = () => {
        console.warn('[crystalar] dialog 3D context lost, showing the poster');
        stillOnly('failed');
      };
      view.setTrace(trace);
      view.setDisplay(finalDisplay(trace));
      view.onInteract = () => view.setAutoRotate(0);
      if (!reduced.matches) view.setAutoRotate(0.18);
      api.trace = trace;
      api.view = view;
      poster.hidden = true;
    } catch (error) {
      console.warn('[crystalar] 3D view unavailable:', error?.message ?? error);
      if (current()) stillOnly('failed');
    }
  }

  async function replay() {
    if (!view || !api.trace || replayBtn.disabled) return;
    stopReplay?.();
    const [{ sceneAt }, timeline, { readoutHtml }] = await Promise.all([
      import('./lib/scene-state.js'), import('./lib/story-timeline.js'), import('./lib/story-text.js'),
    ]);
    if (!view || !api.trace) return;
    const trace = api.trace;
    const { STEPS, stepSettled } = timeline;
    const show = (p) => {
      const frame = sceneAt(trace, p);
      view.setDisplay(frame.display);
      const step = STEPS[frame.state.index];
      phase.innerHTML = `<b>${frame.state.index + 1}/${STEPS.length} ${escapeHtml(step.title)}</b> · ${readoutHtml(frame.readout, trace)}`;
      api.progress = p;
    };
    api.replaying = true;
    replayBtn.textContent = 'Replaying…';
    view.setAutoRotate(0);
    const finish = () => {
      api.replaying = false;
      replayBtn.textContent = 'Replay generation';
      stopReplay = null;
    };
    if (reduced.matches) {
      // Discrete steps, no tweening.
      const stops = STEPS.map((_, i) => stepSettled(i));
      let i = 0;
      show(stops[0]);
      const timer = window.setInterval(() => {
        i += 1;
        if (i >= stops.length) { window.clearInterval(timer); finish(); return; }
        show(stops[i]);
      }, 1100);
      stopReplay = () => { window.clearInterval(timer); finish(); };
      return;
    }
    const seconds = 10;
    let t = 0;
    const remove = view.addTicker((dt) => {
      t += dt;
      const p = Math.min(1, t / seconds);
      show(p);
      if (p >= 1) { remove(); finish(); return false; }
      return true;
    });
    stopReplay = () => { remove(); finish(); };
  }

  function close() {
    session += 1;
    stopReplay?.();
    view?.dispose();
    view = null;
    api.view = null;
    api.trace = null;
    api.open = null;
    api.progress = null;
    api.still = null;
    poster.hidden = false;
  }

  gallery.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    open(btn.dataset.open, btn).catch((error) => {
      console.warn('[crystalar] crystal data unavailable:', error?.message ?? error);
      cardMessage(btn.closest('.card'), CARD_ERROR);
    });
  });
  replayBtn.addEventListener('click', replay);
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    close();
    opener?.focus();
  });
  // Keep Tab inside the dialog (wrap at both ends).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
