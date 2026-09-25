import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('dist/service/school/index.html');
const script = read('src/scripts/online-school.js');
const settings = JSON.parse(read('src/data/settings.json'));

test('school LP publishes the approved canonical without preview or index restrictions', () => {
  assert.match(html, /rel="canonical" href="https:\/\/layr\.co\.jp\/service\/school\/"/);
  assert.doesNotMatch(html, /noindex|制作プレビュー|service\/online-school/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /株式会社LAYR単独の実績ではなく/);
});

test('ten distinct local ISOME LAB illustrations are each used once and both LINE CTAs use the company setting', () => {
  const images = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(images.length, 10);
  assert.equal(new Set(images).size, 10);
  for (const src of images) assert.ok(existsSync(new URL('../public' + src, import.meta.url)));
  const isomeIds = [...html.matchAll(/data-isome="(\d+)"/g)].map(match => match[1]);
  assert.equal(isomeIds.length, 10);
  assert.equal(new Set(isomeIds).size, 10);
  assert.doesNotMatch(html, /href="https?:\/\/isome-lab\.com/);
  assert.doesNotMatch(html, /service-assets\/online-school\/icons/);
  const lineLinks = [...html.matchAll(/<a[^>]*data-line-cta="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.equal(lineLinks.length, 2);
  for (const link of lineLinks) assert.ok(link.includes(settings.line_url));
  assert.ok(html.indexOf('id="line-consult"') < html.indexOf('id="contact"'));
});

test('orange is limited to emphasis while the consultation CTA remains green', () => {
  const css = read('src/styles/online-school.css');
  assert.match(css, /--orange:#ed7d16/);
  assert.match(css, /--orange-ink:#b84d00/);
  assert.match(css, /h1 em\{[^}]*color:var\(--orange-ink\)/);
  assert.match(css, /\.marker\{[^}]*var\(--orange\)/);
  assert.match(css, /\.button\{[^}]*var\(--green-ink\)/);
});

test('mail drafts fail closed without JS, are not sent automatically, and do not count as a lead', () => {
  assert.match(html, /class="button form-submit"[^>]*disabled/);
  assert.match(html, /<noscript>/);
  assert.match(html, /まだ送信されていません/);
  assert.ok(script.indexOf("form.querySelector('.form-submit').disabled=false") > script.indexOf("form.addEventListener('submit'"));
  assert.match(script, /event.preventDefault\(\)/);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon|track\('generate_lead'/);
});
