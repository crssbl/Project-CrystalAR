// Page bootstrap. Everything here is progressive enhancement: the page is complete without it.
import { initResultsLanding } from './lib/results-landing.js';

const root = document.documentElement;
root.classList.add('js');
// Reserve the existing scroll track before its async module/data arrives. Native
// fragment navigation then remains stable even after interaction ends calibration.
const pendingStory = document.querySelector('[data-story]');
pendingStory?.classList.add('is-loading');

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function initProgress() {
  const bar = document.querySelector('.progress span');
  if (!bar) return;
  let queued = false;
  const update = () => {
    queued = false;
    const max = root.scrollHeight - window.innerHeight;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : '0');
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}

function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || motionQuery.matches) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
}

function initTopbar() {
  const topbar = document.getElementById('topbar');
  const story = document.querySelector('[data-story]');
  const links = [...document.querySelectorAll('.nav a[href^="#"]')];
  if (!topbar || !('IntersectionObserver' in window)) return;
  if (story) {
    // The bar turns dark while the dark stage sits underneath it.
    let queued = false;
    const update = () => {
      queued = false;
      const r = story.getBoundingClientRect();
      const line = topbar.offsetHeight / 2;
      topbar.classList.toggle('is-on-stage', r.top <= line && r.bottom >= line);
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }
  const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const nav = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const link = links.find((a) => a.getAttribute('href') === `#${entry.target.id}`);
      if (link) link.classList.toggle('is-active', entry.isIntersecting);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  targets.forEach((t) => nav.observe(t));
}

function initCitation() {
  const button = document.querySelector('[data-copy-bibtex]');
  const code = document.querySelector('[data-config-text="bibtex"]');
  const status = document.querySelector('[data-copy-status]');
  if (!button || !code || !status) return;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = 'Copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Select the citation text to copy it.';
    }
  });
}

initProgress();
initReveal();
initTopbar();
initResultsLanding();
initCitation();

// Illustrations and the complete result tables do not add to the initial module graph.
const methodCards = document.querySelector('[data-method-cycle]');
if (methodCards && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    import('./illustrations.js').then((mod) => mod.init());
  });
  observer.observe(methodCards);
}
const allNumbers = document.querySelector('#paper-tables');
if (allNumbers) {
  let loaded = false;
  allNumbers.addEventListener('toggle', () => {
    if (!allNumbers.open || loaded) return;
    loaded = true;
    import('./results.js').then((mod) => mod.init()).catch((error) => {
      loaded = false; // Native details still exposes every table; allow a later retry.
      console.warn('[crystalar] result tabs unavailable:', error?.message ?? error);
    });
  });
}

// Heavier features load on demand so the first paint stays light.
const features = [
  ['[data-hero-stage]', './hero.js'],
  ['[data-story]', './story.min.js'],
  ['[data-gallery]', './gallery.min.js'],
  ['[data-figure-open]', './figure.js'],
];
for (const [selector, path] of features) {
  if (document.querySelector(selector)) {
    import(path).then((mod) => mod.init?.()).catch((error) => {
      // A missing optional feature must never break the page.
      console.warn(`[crystalar] ${path} unavailable:`, error?.message ?? error);
    }).finally(() => {
      if (selector === '[data-story]') pendingStory?.classList.remove('is-loading');
    });
  }
}
