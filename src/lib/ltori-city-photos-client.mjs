/** Enhance a native scroll area; photos and credits remain usable without JavaScript. */
export function initCityPhotos(root, environment = globalThis) {
  if (!root || root.dataset.cityPhotosReady === 'true') return null;
  const viewport = root.querySelector('[data-city-photo-viewport]');
  const controls = root.querySelector('[data-city-photo-controls]');
  const previous = root.querySelector('[data-city-photo-prev]'), next = root.querySelector('[data-city-photo-next]'), pause = root.querySelector('[data-city-photo-pause]');
  const slides = Array.from(root.querySelectorAll('.lt-city-photo'));
  if (!viewport || !controls || !previous || !next || !pause || slides.length < 3) return null;
  root.dataset.cityPhotosReady = 'true'; controls.hidden = false;
  const reduced = environment.matchMedia('(prefers-reduced-motion: reduce)');
  const document = root.ownerDocument;
  let manual = false, focused = root.contains(document.activeElement), hovered = false, timer = null;
  const offsets = () => {const visible = slides.filter(slide => !slide.hidden); return visible.map(slide => slide.offsetLeft - visible[0].offsetLeft);};
  const maxScroll = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  function update() {
    if (timer !== null) environment.clearTimeout(timer);
    timer = null;
    const stopped = manual || reduced.matches || focused || hovered || document.hidden;
    const scrollable = maxScroll() > 2;
    previous.disabled = !scrollable; next.disabled = !scrollable;
    pause.disabled = reduced.matches || !scrollable;
    pause.setAttribute('aria-pressed', String(manual || reduced.matches));
    pause.textContent = !scrollable ? '写真を一覧表示中' : reduced.matches ? '動きを抑える設定中' : manual ? '自動送りを再開する' : '自動送りを止める';
    if (!stopped && scrollable) timer = environment.setTimeout(() => {timer = null; move(1, false);}, 5000);
  }
  function move(direction, user = true) {
    if (user) manual = true;
    const positions = offsets().map(offset => Math.min(offset, maxScroll()));
    const current = viewport.scrollLeft;
    const position = direction > 0 ? positions.find(offset => offset > current + 4) ?? 0 : positions.findLast(offset => offset < current - 4) ?? maxScroll();
    viewport.scrollTo({left: position, behavior: reduced.matches ? 'instant' : 'smooth'});
    update();
  }
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  pause.addEventListener('click', () => {manual = !manual; update();});
  const stopForInput = () => {manual = true; update();};
  viewport.addEventListener('pointerdown', stopForInput, {passive: true});
  viewport.addEventListener('wheel', stopForInput, {passive: true});
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1);}
    else if (event.key === 'Home' || event.key === 'End') {event.preventDefault(); manual = true; viewport.scrollTo({left: event.key === 'Home' ? 0 : maxScroll(), behavior: 'instant'}); update();}
  });
  root.addEventListener('focusin', () => {focused = true; update();});
  root.addEventListener('focusout', event => {focused = root.contains(event.relatedTarget); update();});
  root.addEventListener('mouseenter', () => {hovered = true; update();});
  root.addEventListener('mouseleave', () => {hovered = false; update();});
  reduced.addEventListener('change', () => {if (reduced.matches) manual = true; update();});
  document.addEventListener('visibilitychange', update);
  environment.addEventListener('resize', update);
  // Cached or delayed image failures cannot leave broken placeholders or a
  // two-photo strip presented as a verified set of three photographs.
  const failed = image => {image.closest('.lt-city-photo').hidden = true; if (slides.filter(slide => !slide.hidden).length < 3) {root.hidden = true; manual = true;} update();};
  root.querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => failed(image), {once: true});
    if (image.complete && image.naturalWidth === 0) failed(image);
  });
  update();
  return {stop: stopForInput};
}

export function initCityPhotoStrips(document = globalThis.document, environment = globalThis) {
  document?.querySelectorAll('[data-city-photos]').forEach(root => initCityPhotos(root, environment));
}
