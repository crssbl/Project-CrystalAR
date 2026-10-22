// Native modal focus handling with explicit zoom and a standalone SVG fallback.
export function init() {
  const link = document.querySelector('[data-figure-open]');
  const dialog = document.querySelector('[data-figure-dialog]');
  if (!link || !dialog?.showModal) return;
  const viewport = dialog.querySelector('.figure-viewport');
  const image = viewport.querySelector('img');
  const buttons = [...dialog.querySelectorAll('[data-figure-zoom]')];
  let zoom = 'fit';
  const resize = () => {
    image.style.width = `${zoom === 'fit' ? viewport.clientWidth : 930 * Number(zoom)}px`;
  };
  link.addEventListener('click', (event) => {
    event.preventDefault();
    dialog.showModal();
    zoom = 'fit';
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.figureZoom === zoom)));
    resize();
    viewport.scrollTo(0, 0);
    buttons[0].focus();
  });
  buttons.forEach((button) => button.addEventListener('click', () => {
    zoom = button.dataset.figureZoom;
    buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    resize();
  }));
  dialog.querySelector('[data-figure-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => link.focus());
  new ResizeObserver(resize).observe(viewport);
}
