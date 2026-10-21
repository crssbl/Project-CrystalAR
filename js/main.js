// Page bootstrap. Everything here is progressive enhancement: the page is complete without it.
import { applyConfig } from './lib/config.js';

const root = document.documentElement;
root.classList.add('js');

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

async function initConfig() {
  try {
    const response = await fetch('data/site.json', { cache: 'no-cache' });
    if (!response.ok) return;
    applyConfig(document, await response.json());
  } catch {
    // Static defaults in the HTML already match the config; nothing to do.
  }
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
initConfig();
initCitation();

// Heavier features load on demand so the first paint stays light.
const features = [
  ['[data-hero-stage]', './hero.js'],
  ['[data-story]', './story.js'],
  ['[data-gallery]', './gallery.js'],
];
for (const [selector, path] of features) {
  if (document.querySelector(selector)) {
    import(path).then((mod) => mod.init?.()).catch((error) => {
      // A missing optional feature must never break the page.
      console.warn(`[crystalar] ${path} unavailable:`, error?.message ?? error);
    });
  }
}
