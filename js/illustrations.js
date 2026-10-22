// Small loops run only while their cards are visible; reduced motion stays static.
export function init() {
  const cards = [...document.querySelectorAll('[data-method-cycle]')];
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-running', entry.isIntersecting);
  });
  cards.forEach((card) => observer.observe(card));
}
