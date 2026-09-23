import test from 'node:test';
import assert from 'node:assert/strict';
import {initCityPhotos, initCityPhotoStrips} from '../src/lib/ltori-city-photos-client.mjs';

class Element {
  constructor() {this.events = new Map(); this.attributes = {}; this.dataset = {}; this.hidden = false;}
  addEventListener(name, fn) {this.events.set(name, [...(this.events.get(name) || []), fn]);}
  emit(name, fields = {}) {const event = {target: this, preventDefault() {this.prevented = true;}, ...fields}; for (const fn of this.events.get(name) || []) fn(event); return event;}
  setAttribute(name, value) {this.attributes[name] = value;}
}
function setup({reducedMotion = false, count = 4, width = 360} = {}) {
  const document = new Element(), root = new Element(), viewport = new Element(), controls = new Element(), previous = new Element(), next = new Element(), pause = new Element(), reduced = new Element();
  document.activeElement = null; document.hidden = false; root.ownerDocument = document; controls.hidden = true;
  const slides = Array.from({length: count}, (_, i) => Object.assign(new Element(), {offsetLeft: i * 382}));
  const images = slides.map(slide => Object.assign(new Element(), {complete: false, naturalWidth: 0, closest: () => slide}));
  const selectors = {'[data-city-photo-viewport]': viewport, '[data-city-photo-controls]': controls, '[data-city-photo-prev]': previous, '[data-city-photo-next]': next, '[data-city-photo-pause]': pause};
  root.querySelector = selector => selectors[selector]; root.querySelectorAll = selector => selector === '.lt-city-photo' ? slides : selector === 'img' ? images : [];
  root.contains = item => [root, viewport, controls, previous, next, pause].includes(item);
  document.querySelectorAll = () => [root];
  Object.assign(viewport, {scrollLeft: 0, clientWidth: width, scrollWidth: count * 382 - 22, moves: [], scrollTo(options) {this.scrollLeft = options.left; this.moves.push(options);}});
  reduced.matches = reducedMotion;
  let id = 0; const timers = new Map(), environment = new Element();
  environment.matchMedia = query => {assert.equal(query, '(prefers-reduced-motion: reduce)'); return reduced;};
  environment.setTimeout = (callback, ms) => {assert.equal(ms, 5000); timers.set(++id, callback); return id;};
  environment.clearTimeout = timer => timers.delete(timer);
  const tick = () => {assert.equal(timers.size, 1); const [timer, callback] = timers.entries().next().value; timers.delete(timer); callback();};
  initCityPhotoStrips(document, environment);
  return {document, root, viewport, controls, previous, next, pause, reduced, environment, timers, tick, images};
}

test('autoplay advances visible photographs, loops, and does not install duplicate handlers', () => {
  const f = setup();
  assert.equal(f.controls.hidden, false); assert.equal(f.timers.size, 1);
  f.tick(); assert.deepEqual(f.viewport.moves[0], {left: 382, behavior: 'smooth'});
  f.tick(); f.tick(); f.tick(); assert.equal(f.viewport.scrollLeft, 0);
  assert.equal(initCityPhotos(f.root, f.environment), null);
  assert.equal(f.next.events.get('click').length, 1); assert.equal(f.timers.size, 1);
});

test('focus, hover, and background tabs suspend autoplay; pause remains stopped after focus leaves', () => {
  const f = setup();
  f.root.emit('focusin', {target: f.pause}); assert.equal(f.timers.size, 0);
  f.pause.emit('click'); assert.equal(f.pause.attributes['aria-pressed'], 'true');
  f.root.emit('focusout', {relatedTarget: null}); assert.equal(f.timers.size, 0);
  f.pause.emit('click'); assert.equal(f.timers.size, 1);
  f.root.emit('mouseenter'); assert.equal(f.timers.size, 0);
  f.root.emit('mouseleave'); assert.equal(f.timers.size, 1);
  f.document.hidden = true; f.document.emit('visibilitychange'); assert.equal(f.timers.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); assert.equal(f.timers.size, 1);
});

test('manual arrows, swipe, wheel and keyboard stop automatic motion until explicitly resumed', () => {
  const f = setup();
  f.next.emit('click'); assert.equal(f.viewport.scrollLeft, 382); assert.equal(f.timers.size, 0);
  f.previous.emit('click'); assert.equal(f.viewport.scrollLeft, 0);
  f.pause.emit('click'); assert.equal(f.timers.size, 1);
  f.viewport.emit('pointerdown'); assert.equal(f.timers.size, 0);
  f.pause.emit('click'); f.viewport.emit('wheel'); assert.equal(f.timers.size, 0);
  const right = f.viewport.emit('keydown', {key: 'ArrowRight'}); assert.equal(right.prevented, true); assert.equal(f.viewport.scrollLeft, 382);
  f.viewport.emit('keydown', {key: 'End'}); assert.equal(f.viewport.scrollLeft, 1146);
  f.viewport.emit('keydown', {key: 'Home'}); assert.equal(f.viewport.scrollLeft, 0);
  assert.equal(f.viewport.emit('keydown', {key: 'Tab'}).prevented, undefined);
});

test('reduced motion disables autoplay and smooth movement, including changes after initial load', () => {
  const f = setup({reducedMotion: true});
  assert.equal(f.timers.size, 0); assert.equal(f.pause.disabled, true);
  f.next.emit('click'); assert.equal(f.viewport.moves[0].behavior, 'instant');
  f.reduced.matches = false; f.reduced.emit('change'); assert.equal(f.timers.size, 0, 'Manual navigation must stay paused');
  f.pause.emit('click'); assert.equal(f.timers.size, 1);
  f.reduced.matches = true; f.reduced.emit('change'); assert.equal(f.timers.size, 0);
});

test('a strip that fits does not rotate and failed images cannot leave a misleading incomplete set', () => {
  const fitting = setup({width: 1600});
  assert.equal(fitting.timers.size, 0); assert.equal(fitting.next.disabled, true); assert.equal(fitting.pause.textContent, '写真を一覧表示中');
  fitting.viewport.clientWidth = 360; fitting.environment.emit('resize'); assert.equal(fitting.timers.size, 1);
  const f = setup();
  f.images[0].emit('error'); assert.equal(f.root.hidden, false);
  f.images[1].emit('error'); assert.equal(f.root.hidden, true); assert.equal(f.timers.size, 0);
});
