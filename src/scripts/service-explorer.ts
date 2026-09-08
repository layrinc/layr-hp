/** Progressively enhance anchor links; all service content remains readable without JS. */
export function initServiceExplorer(root: HTMLElement) {
  if (root.dataset.ready) return;
  const tabs = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-service-tab]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-service-panel]'));
  if (!tabs.length || tabs.length !== panels.length) return;
  root.dataset.ready = 'true';
  const list = root.querySelector('.explorer-tabs');
  list?.setAttribute('role', 'tablist');
  const narrow = window.matchMedia('(max-width: 720px)');
  const orient = () => list?.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  orient();
  narrow.addEventListener('change', orient);
  // Both horizontal arrows and vertical arrows work, matching the responsive layout.
  const select = (index: number, focus = false) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  };
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[index].id);
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].tabIndex = 0;
    tab.addEventListener('click', event => { event.preventDefault(); select(index); });
    tab.addEventListener('keydown', event => {
      let next: number;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === ' ') next = index;
      else return;
      event.preventDefault(); select(next, true);
    });
  });
  const initial = panels.findIndex(panel => `#${panel.id}` === window.location.hash);
  select(initial >= 0 ? initial : 0);
  window.addEventListener('hashchange', () => {
    const index = panels.findIndex(panel => `#${panel.id}` === window.location.hash);
    if (index >= 0) select(index);
  });
}
