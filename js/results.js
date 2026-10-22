// Enhance the complete static tables with keyboard-accessible tabs only when opened.
export function init() {
  const tabs = document.querySelector('[data-table-tabs]');
  if (!tabs) return;
  const buttons = [...tabs.querySelectorAll('button')];
  tabs.hidden = false;
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Paper result tables');
  function select(index, focus = false) {
    buttons.forEach((button, i) => {
      const panel = document.getElementById(button.dataset.tableTarget);
      const active = i === index;
      button.id = `tab-${button.dataset.tableTarget}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.hidden = !active;
    });
    if (focus) buttons[index].focus();
  }
  buttons.forEach((button, i) => {
    button.addEventListener('click', () => select(i));
    button.addEventListener('keydown', (event) => {
      const next = { ArrowRight: (i + 1) % buttons.length, ArrowLeft: (i + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next, true);
    });
  });
  select(0);
}
