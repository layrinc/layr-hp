import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initServiceExplorer } from '../src/scripts/service-explorer.ts';

// A small DOM contract fixture for interaction tests; not a visual browser test.
function fixture(hash = '') {
  const element = id => ({ id, hidden: false, tabIndex: 0, attributes: {}, events: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); },
    focus() { this.focused = true; }
  });
  const tabs = [element('service-tab-0'), element('service-tab-1')];
  const panels = [element('service-panel-0'), element('service-panel-1')];
  const list = element('list');
  const media = { matches: false, addEventListener(type, callback) { this.change = callback; } };
  const events = {};
  globalThis.window = { location: { hash }, matchMedia: () => media, addEventListener: (type, fn) => { events[type] = fn; } };
  const root = { dataset: {}, querySelector: () => list,
    querySelectorAll: selector => selector === '[data-service-tab]' ? tabs : panels };
  const fire = (index, type, key) => {
    let prevented = false;
    tabs[index].events[type].forEach(fn => fn({ key, preventDefault() { prevented = true; } }));
    return prevented;
  };
  return { root, tabs, panels, list, media, events, fire };
}

test('enhancement preserves panel labels and supports direct links', () => {
  const f = fixture('#service-panel-1');
  assert.deepEqual(f.panels.map(p => p.hidden), [false, false]);
  initServiceExplorer(f.root);
  assert.deepEqual(f.panels.map(p => p.hidden), [true, false]);
  assert.deepEqual(f.tabs.map(t => t.tabIndex), [-1, 0]);
  assert.equal(f.tabs[1].attributes['aria-controls'], f.panels[1].id);
  assert.equal(f.panels[1].attributes.role, 'tabpanel');
  window.location.hash = '#service-panel-0'; f.events.hashchange();
  assert.deepEqual(f.panels.map(p => p.hidden), [false, true]);
});

test('click, arrows, Home, End and Space keep focus and selected state aligned', () => {
  const f = fixture(); initServiceExplorer(f.root);
  assert.equal(f.fire(1, 'click'), true);
  assert.equal(f.tabs[1].attributes['aria-selected'], 'true');
  f.fire(1, 'keydown', 'ArrowRight');
  assert.equal(f.tabs[0].focused, true);
  assert.deepEqual(f.panels.map(p => p.hidden), [false, true]);
  f.fire(0, 'keydown', 'End'); assert.equal(f.tabs[1].tabIndex, 0);
  f.fire(1, 'keydown', 'Home'); assert.equal(f.tabs[0].tabIndex, 0);
  f.fire(0, 'keydown', 'ArrowUp'); assert.equal(f.tabs[1].tabIndex, 0);
  assert.equal(f.fire(1, 'keydown', ' '), true);
  assert.equal(f.fire(1, 'keydown', 'Tab'), false);
});

test('orientation follows the layout and repeated setup does not duplicate handlers', () => {
  const f = fixture(); initServiceExplorer(f.root); initServiceExplorer(f.root);
  assert.equal(f.tabs[0].events.click.length, 1);
  assert.equal(f.list.attributes['aria-orientation'], 'vertical');
  f.media.matches = true; f.media.change();
  assert.equal(f.list.attributes['aria-orientation'], 'horizontal');
});
