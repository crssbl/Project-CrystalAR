// Keep the paper's permanent anchor aligned while fonts and the story change
// layout. The first reader interaction ends calibration for this document.
export function initResultsLanding() {
  const target = document.getElementById('results');
  if (!target) return;
  let active = false;
  let queued = false;
  let interacted = false;
  const align = () => {
    queued = false;
    // Check again in the queued frame: focus may have changed since resize.
    if (active && !interacted && location.hash === '#results'
        && (!document.activeElement || document.activeElement === document.body)) {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  };
  const queue = () => {
    if (active && !queued) { queued = true; requestAnimationFrame(align); }
  };
  const arm = () => {
    active = !interacted && location.hash === '#results';
    if (active) queue();
  };
  const stop = () => { interacted = true; active = false; };
  for (const type of ['focusin', 'keydown', 'pointerdown', 'touchstart', 'wheel']) {
    document.addEventListener(type, stop, { capture: true, passive: true });
  }
  addEventListener('hashchange', arm);
  if ('ResizeObserver' in window) new ResizeObserver(queue).observe(document.body);
  document.fonts.ready.then(queue);
  arm();
}
