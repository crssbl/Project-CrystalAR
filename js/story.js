// The generation story of La5Bi3Cl on the dark stage.
// Desktop: the stage is pinned and scroll drives the timeline. Below 768px, or with reduced
// motion: step cards with buttons. Without WebGL: pre-rendered stills. Without JS: poster + text.
import { createCrystalView } from './render/crystal-view.min.js';
import { hasWebGL2 } from './render/three-loader.js';
import { sceneAt } from './lib/scene-state.js';
import { STEPS, stepSettled, progressToState } from './lib/story-timeline.js';
import { readoutHtml, keyFrames, stepFrame, stillCaptionHtml } from './lib/story-text.js';
import { VIEWS } from './lib/views.js';

const TRACE_URL = 'data/crystals/denovo-75.json';
const stillUrl = (index) => `assets/img/story/step-${index + 1}.webp`;

export async function init() {
  const root = document.querySelector('[data-story]');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const track = $('[data-story-track]');
  const stage = $('[data-story-stage]');
  const still = $('[data-story-still]');
  const steps = [...root.querySelectorAll('.story-step')];
  const controls = $('[data-story-controls]');
  const scrubber = $('[data-story-scrubber]');
  const prevBtn = $('[data-story-prev]');
  const nextBtn = $('[data-story-next]');
  const live = $('[data-story-live]');
  const readout = $('[data-story-readout]');
  const caption = $('[data-story-caption]');
  const tokenEls = [...root.querySelectorAll('[data-tok]')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wide = window.matchMedia('(min-width: 768px)');
  const compact = window.matchMedia('(max-width: 900px)');

  const trace = await (await fetch(TRACE_URL)).json();
  const frames = keyFrames(trace);
  const api = { progress: 0, mode: null, frames, view: null, step: -1 };
  window.__crystalar = Object.assign(window.__crystalar ?? {}, { story: api });

  // step indicator
  const dots = document.createElement('ol');
  dots.className = 'step-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.innerHTML = STEPS.map(() => '<li></li>').join('');
  $('.story-steps').before(dots);
  controls.hidden = false;
  root.classList.add('is-enhanced');

  let view = null;
  let animation = null;
  // WebGL support is probed only when the stage comes near (context creation is costly).
  let gl = 'WebGL2RenderingContext' in window ? null : false;

  // The alt texts of the stills are only needed without 3D, so they load with the first still;
  // until they arrive, a still has an empty alt rather than one that describes another step.
  let stillAlt = null;
  let stillAltLoad = null;
  function loadStillAlt() {
    stillAltLoad ??= import('./lib/still-alt.js').then(({ stillAltText }) => {
      stillAlt = stillAltText;
      api.step = -1; // rewrite the current still with its alt
      render(api.progress);
    }).catch((error) => console.warn('[crystalar] still alt text unavailable:', error?.message ?? error));
  }
  if (gl === false) {
    root.classList.add('is-nogl');
    loadStillAlt();
  }

  // The pre-rendered stills take over from the 3D stage: without WebGL2, when the renderer
  // fails to start after a successful probe, or when the WebGL context is lost. A restored
  // context does not bring the 3D view back; the stills stay.
  function useStills() {
    gl = false;
    view?.dispose();
    view = null;
    api.view = null;
    if (window.__crystalar.storyView) window.__crystalar.storyView = null;
    stage.classList.remove('is-live');
    root.classList.add('is-nogl');
    still?.removeAttribute('hidden');
    loadStillAlt();
    api.step = -1; // force the still of the current step
    render(api.progress);
  }

  function render(p) {
    api.progress = p;
    const frame = sceneAt(trace, p);
    const index = frame.state.index;
    if (view) view.setDisplay(frame.display);
    else if (gl === false && still && api.step !== index) {
      still.src = stillUrl(index);
      // The image's accessible name describes this step's still, not the finished crystal.
      still.alt = stillAlt ? stillAlt(trace, index) : '';
      // The stills carry no site labels; the caption line lists the sites instead.
      if (caption) {
        caption.innerHTML = stillCaptionHtml(trace, index);
        caption.hidden = !caption.innerHTML;
      }
    }
    readout.innerHTML = readoutHtml(frame.readout, trace);
    for (const el of tokenEls) {
      const s = frame.tokens[el.dataset.tok] ?? 'done';
      el.classList.toggle('is-active', s === 'active');
      el.classList.toggle('is-future', s === 'future');
    }
    if (index !== api.step) {
      steps.forEach((el, i) => el.classList.toggle('is-on', i === index));
      [...dots.children].forEach((el, i) => {
        el.classList.toggle('is-on', i === index);
        el.classList.toggle('is-done', i < index);
      });
      const step = steps[index];
      if (api.step !== -1 && live && step) {
        const title = step.querySelector('h3')?.lastChild?.textContent?.trim() ?? STEPS[index].title;
        const sentence = step.querySelector('p')?.textContent?.trim() ?? '';
        live.textContent = `Step ${index + 1} of ${STEPS.length}: ${title}. ${sentence}`;
      }
      api.step = index;
      if (view) view.setAutoRotate(STEPS[index].id === 'complete' && !reduced.matches ? 0.14 : 0);
    }
    scrubber.value = String(Math.round(p * 1000));
    scrubber.setAttribute('aria-valuetext', `Step ${index + 1} of ${STEPS.length}: ${STEPS[index].title}`);
    prevBtn.disabled = index === 0;
    nextBtn.disabled = p >= 1 - 1e-4;
  }

  // ---------------------------------------------------------------- scroll mode
  const barHeight = () => document.getElementById('topbar')?.offsetHeight ?? 0;
  function scrollProgress() {
    const rect = track.getBoundingClientRect();
    const span = rect.height - (window.innerHeight - barHeight());
    return span > 0 ? Math.min(1, Math.max(0, (barHeight() - rect.top) / span)) : 0;
  }
  function scrollToProgress(p, smooth) {
    const rect = track.getBoundingClientRect();
    const span = rect.height - (window.innerHeight - barHeight());
    const top = window.scrollY + rect.top - barHeight() + p * span;
    window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }
  let queued = false;
  const onScroll = () => {
    if (api.mode !== 'scrolly' || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(scrollProgress()); });
  };

  // ---------------------------------------------------------------- step mode
  function goTo(p, { animate = !reduced.matches } = {}) {
    if (api.mode === 'scrolly') { scrollToProgress(p, false); return; }
    cancelAnimationFrame(animation);
    const from = api.progress;
    if (!animate || Math.abs(p - from) < 1e-6) { render(p); return; }
    const duration = Math.min(2600, 500 + Math.abs(p - from) * 9000);
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      render(from + (p - from) * k);
      if (k < 1) animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  }
  api.goTo = goTo;

  // Step buttons move one whole step: to the settled state of the next or previous step.
  function stepTarget(direction) {
    const current = progressToState(api.progress).index;
    if (direction > 0) return current >= STEPS.length - 1 ? 1 : stepSettled(current + 1);
    return current <= 0 ? 0 : stepSettled(current - 1);
  }
  prevBtn.addEventListener('click', () => goTo(stepTarget(-1), { animate: api.mode !== 'scrolly' && !reduced.matches }));
  nextBtn.addEventListener('click', () => goTo(stepTarget(1), { animate: api.mode !== 'scrolly' && !reduced.matches }));
  scrubber.addEventListener('input', () => {
    const p = Number(scrubber.value) / 1000;
    if (api.mode === 'scrolly') scrollToProgress(p, false);
    else { cancelAnimationFrame(animation); render(p); }
  });
  let lastKeyTarget = -1;
  scrubber.addEventListener('keydown', (e) => {
    const map = { ArrowRight: 1, ArrowUp: 1, PageDown: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: -1 };
    let target = null;
    // Scroll positions are whole pixels, so after a jump the progress can land a hair short
    // of its key frame; continue from the frame itself in that case.
    const base = Math.abs(api.progress - lastKeyTarget) < 0.004 ? lastKeyTarget : api.progress;
    if (e.key in map) target = stepFrame(frames, base, map[e.key]);
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = 1;
    if (target === null) return;
    e.preventDefault();
    lastKeyTarget = target;
    goTo(target, { animate: false });
  });

  function applyMode() {
    const mode = wide.matches && !reduced.matches ? 'scrolly' : 'stepper';
    api.mode = mode;
    root.classList.toggle('is-scrolly', mode === 'scrolly');
    root.classList.toggle('is-stepper', mode === 'stepper');
    // Step cards open on the first step fully shown; the scroll story follows the page.
    if (mode === 'stepper' && api.progress === 0) api.progress = stepSettled(0);
    render(mode === 'scrolly' ? scrollProgress() : api.progress);
  }
  wide.addEventListener('change', applyMode);
  reduced.addEventListener('change', applyMode);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  applyMode();

  // ---------------------------------------------------------------- 3D, loaded near the viewport
  if (gl === false) return;
  const io = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    gl = hasWebGL2();
    if (!gl) {
      useStills();
      return;
    }
    try {
      view = await createCrystalView(stage, {
        ...VIEWS.story,
        // The square tablet stage needs a fit to its actual aspect and current pose.
        // Wide stages and step cards retain their rotation-safe camera.
        fit: () => wide.matches && compact.matches && !reduced.matches ? 'view' : 'rotation',
        // Keep the bottom readout clear without reducing the crystal's size.
        offsetY: () => wide.matches && compact.matches && !reduced.matches ? (readout.offsetHeight + 28) / 2 : 0,
        label: 'La5Bi3Cl being generated', canvasClass: 'crystal-canvas story-canvas',
      });
      if (!view) {
        useStills();
        return;
      }
      api.view = view;
      window.__crystalar.storyView = view;
      view.onContextLost = () => {
        console.warn('[crystalar] story 3D context lost, showing stills');
        useStills();
      };
      view.setTrace(trace);
      still?.setAttribute('hidden', '');
      stage.classList.add('is-live');
      api.step = -1;
      render(api.progress);
    } catch (error) {
      console.warn('[crystalar] story 3D unavailable:', error?.message ?? error);
      useStills();
    }
  }, { rootMargin: '600px 0px' });
  io.observe(stage);
}
