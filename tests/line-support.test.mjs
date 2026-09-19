import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const home = JSON.parse(read('src/data/page-home.json'));
const cards = home.blocks.find(block => block.id === 'b-dekiru').p.items;
const faqs = home.blocks.find(block => block.id === 'b-faq').p.items;
const categories = ['料金・契約', '相談・構築', '配信・運用'];

test('Six support cards have unique Canva screenshots and nonempty descriptions', () => {
  assert.equal(cards.length, 6);
  assert.deepEqual(cards.map(card => card.screen), ['build', 'reply', 'manage', 'analyze', 'improve', 'update']);
  for (const card of cards) for (const key of ['title', 'benefit', 'desc']) assert.ok(card[key]?.trim());
  assert.equal(new Set(cards.map(card => card.image.src)).size, cards.length);
  for (const { image } of cards) {
    assert.match(image.src, /^\/images\/line-support\/canva-[a-z]+\.png$/);
    assert.ok(image.alt.trim());
    assert.ok(image.caption.trim());
    const png = readFileSync(new URL(`../public${image.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), image.width);
    assert.equal(png.readUInt32BE(20), image.height);
  }
});

test('FAQ categories contain every question exactly once', () => {
  assert.equal(faqs.length, 8);
  assert.equal(new Set(faqs.map(faq => faq.q)).size, faqs.length);
  assert.deepEqual(categories.map(category => faqs.filter(faq => faq.category === category).length), [2, 4, 2]);
});

for (const route of ['index.html', 'service/line/index.html']) {
  test(`${route}: all cards, FAQ answers, and structured data are rendered consistently`, () => {
    const html = read(`dist/${route}`);
    assert.equal((html.match(/class="line-support-card"/g) || []).length, 6);
    const images = [...html.matchAll(/<img\b[^>]*class="support-capture"[^>]*>/g)];
    assert.equal(images.length, 6);
    for (const [index, [markup]] of images.entries()) {
      assert.ok(markup.includes(`src="${cards[index].image.src}"`));
      assert.ok(markup.includes(`alt="${cards[index].image.alt}"`));
      assert.match(markup, /loading="lazy"/);
      assert.match(markup, /decoding="async"/);
    }
    const cardMarkup = [...html.matchAll(/<details class="line-support-card">([\s\S]*?)<\/details>/g)];
    for (const [index, [, markup]] of cardMarkup.entries()) {
      assert.ok(markup.includes(`<h3 class="line-support-label">${cards[index].title}</h3>`));
      assert.ok(markup.includes(cards[index].desc));
      assert.ok(!markup.includes(cards[index].benefit));
      assert.match(markup, /詳しく見る/);
    }
    assert.doesNotMatch(html, /line-support-zoom|掲載画像を拡大/);
    assert.doesNotMatch(html, /class="support-device/);
    assert.doesNotMatch(html, /support-capture-caption/);
    assert.doesNotMatch(html, /資料掲載例｜/);
    assert.match(html, /class="line-support-grid"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="LINE支援内容のカード一覧"/);
    assert.match(html, /class="line-support-swipe-hint"/);
    assert.equal((html.match(/class="category-faq-item"/g) || []).length, faqs.length);
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
    const data = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .flatMap(match => JSON.parse(match[1]));
    const faqData = data.find(item => item['@type'] === 'FAQPage');
    assert.ok(faqData);
    assert.deepEqual(faqData.mainEntity.map(item => [item.name, item.acceptedAnswer.text]), faqs.map(item => [item.q, item.a]));
  });

  test(`${route}: no-JS markup exposes all FAQ panels and native disclosures`, () => {
    const html = read(`dist/${route}`);
    const panels = [...html.matchAll(/<div\b[^>]*class="category-faq-panel"[^>]*>/g)];
    assert.equal(panels.length, 3);
    for (const [markup] of panels) assert.doesNotMatch(markup, /\bhidden\b/);
    assert.match(html, /class="category-faq-tabs"[^>]*\bhidden\b/);
    assert.equal((html.match(/<details class="category-faq-item">/g) || []).length, faqs.length);
  });
}

test('New CSS references only tokens supplied by the site or its local component', () => {
  const css = read('src/styles/line-support.css');
  const source = `${read('src/styles/style.css')}\n${css}`;
  const definitions = new Set([...source.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const references = [...css.matchAll(/var\((--[\w-]+)\s*([,)])/g)];
  for (const [, name, delimiter] of references) assert.ok(delimiter === ',' || definitions.has(name), `Undefined token: ${name}`);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
});

test('Only the smartphone layout uses native horizontal scrolling and scroll snap', () => {
  const css = read('src/styles/line-support.css');
  const mobile = css.slice(css.indexOf('@media(max-width:600px)'));
  assert.match(mobile, /grid-auto-flow:column/);
  assert.match(mobile, /grid-auto-columns:90%/);
  assert.match(mobile, /overflow-x:auto/);
  assert.match(mobile, /scroll-snap-type:x mandatory/);
  assert.match(mobile, /scroll-snap-align:start/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1000px\)\{\.line-support-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.doesNotMatch(css, /touch-action:pan-x/);
});
