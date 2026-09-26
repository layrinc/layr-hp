// Pre-publication checklist: ticks stay in this browser only (not shared, not required).
const KEY = 'layr-regulation-checks-v1';
const boxes = [...document.querySelectorAll('[data-rg-item]')];
const read = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const write = checked => { try { localStorage.setItem(KEY, JSON.stringify([...checked])); } catch { /* private mode: keep ticks for this view only */ } };

function update() {
  const done = boxes.filter(box => box.checked).length;
  document.getElementById('rg-progress').textContent = `${done} / ${boxes.length} 項目を確認済み`;
  for (const group of document.querySelectorAll('.rg-group')) {
    const items = [...group.querySelectorAll('[data-rg-item]')], count = items.filter(box => box.checked).length;
    group.querySelector('[data-rg-count]').textContent = `${count} / ${items.length}`;
    group.classList.toggle('is-done', count === items.length);
  }
}
const saved = read();
for (const box of boxes) {
  box.checked = saved.has(box.dataset.rgItem);
  box.addEventListener('change', () => { const checked = new Set(boxes.filter(item => item.checked).map(item => item.dataset.rgItem)); write(checked); update(); });
}
document.getElementById('rg-reset').addEventListener('click', () => { for (const box of boxes) box.checked = false; write(new Set()); update(); });
update();
