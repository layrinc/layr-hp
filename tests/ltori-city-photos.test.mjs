import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {areasBySlug} from '../src/lib/ltori-seo.mjs';
import {normalizeCityPhoto, normalizeCityPhotos, renderCityPhotos, getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';

const citySlug = 'hokkaido/sapporo';
const area = areasBySlug.get(citySlug);
function photo(index, overrides = {}) {
  return {
    id: `photo-${index}`, title: `札幌の街並み ${index}`, alt: `札幌市の街並みを写した写真 ${index}`,
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Sapporo-${index}.jpg`,
    sourceUrl: `https://commons.wikimedia.org/wiki/File:Sapporo-${index}.jpg`,
    author: `写真作者 ${index}`, license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', width: 1600, height: 900,
    ...overrides,
  };
}
const record = (photos = [photo(1), photo(2), photo(3)], overrides = {}) => ({schemaVersion: 1, citySlug, status: 'ready', fetchedAt: '2026-09-23T01:00:00Z', photos, ...overrides});
function nodes(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => nodes(child, predicate))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

test('one candidate uses the same gate as the complete set, including official thumbnail URLs', () => {
  const candidate = photo(3, {url: photo(3).url.replace('upload.wikimedia.org', 'thumb.wikimedia.org'), ignoredField: 'not retained'});
  assert.deepEqual(normalizeCityPhoto(candidate), normalizeCityPhotos(citySlug, record([photo(1), photo(2), candidate])).photos[2]);
  assert.equal(normalizeCityPhoto(candidate).ignoredField, undefined);
  assert.equal(normalizeCityPhoto({...candidate, url: 'https://thumb.wikimedia.org.evil.test/wikipedia/commons/test.jpg'}), null);
  assert.equal(normalizeCityPhoto({...candidate, license: 'CC BY-NC 4.0'}), null);
});

test('optional Japanese captions change only the photo label and retain the original title in credits', () => {
  const caption = '札幌市の街並み <冬景色> & 公園';
  const originalTitle = 'Sapporo City Skyline Original Photograph';
  const candidate = photo(1, {title: originalTitle, caption});
  assert.equal(normalizeCityPhoto(candidate).caption, caption);
  assert.deepEqual(normalizeCityPhoto(normalizeCityPhoto(candidate)), normalizeCityPhoto(candidate));
  const dom = parseFragment(renderCityPhotos(area, record([candidate, photo(2), photo(3)])));
  assert.deepEqual(nodes(dom, node => node.tagName === 'figcaption').map(text), [caption, photo(2).title, photo(3).title]);
  assert.ok(nodes(dom, node => node.tagName === 'a').some(node => text(node) === originalTitle));
  assert.equal(nodes(dom, node => !['section', 'div', 'p', 'h2', 'button', 'ul', 'li', 'figure', 'img', 'figcaption', 'details', 'summary', 'a'].includes(node.tagName) && node.tagName !== undefined).length, 0);
  for (const value of ['', '  ', '行\n区切り', null, 123, 'あ'.repeat(101)]) assert.equal(normalizeCityPhoto(photo(1, {caption: value})), null);
  assert.equal(normalizeCityPhoto(photo(1, {caption: 'あ'.repeat(100)})).caption.length, 100);
  // A title without a separate caption remains backward-compatible and can be
  // normalized repeatedly even when the original filename exceeds 100 chars.
  const legacy = photo(1, {title: 'A'.repeat(150)});
  assert.deepEqual(normalizeCityPhoto(normalizeCityPhoto(legacy)), normalizeCityPhoto(legacy));
  const legacyDom = parseFragment(renderCityPhotos(area, record([legacy, photo(2), photo(3)])));
  assert.equal(text(nodes(legacyDom, node => node.tagName === 'figcaption')[0]), legacy.title);
});

test('ready records keep three or four unique valid photos without mutating the source', () => {
  const input = record([photo(1), photo(1), photo(2), photo(20, {url: photo(2).url}), photo(3), photo(4), photo(5)]);
  const before = structuredClone(input);
  const normalized = normalizeCityPhotos(citySlug, input);
  assert.ok(normalized);
  assert.deepEqual(normalized.photos.map(item => item.id), ['photo-1', 'photo-2', 'photo-3', 'photo-4']);
  assert.deepEqual(input, before);
  assert.equal(normalizeCityPhotos(citySlug, record([photo(1), photo(1), photo(2)])), null);
  assert.equal(normalizeCityPhotos(citySlug, record([photo(1), photo(2)])), null);
  assert.equal(normalizeCityPhotos(citySlug, record()).photos.length, 3);
});

test('unknown cities, wrong record identity and unready records cannot render a photo strip', () => {
  for (const overrides of [{schemaVersion: 2}, {citySlug: 'okinawa/naha'}, {status: 'pending'}, {status: 'failed'}, {fetchedAt: 'not-a-date'}, {photos: null}]) {
    assert.equal(normalizeCityPhotos(citySlug, record(undefined, overrides)), null, JSON.stringify(overrides));
    assert.equal(renderCityPhotos(area, record(undefined, overrides)), '');
  }
  for (const input of [null, undefined, {}, [], 'ready']) {
    assert.equal(normalizeCityPhotos(citySlug, input), null);
    assert.equal(renderCityPhotos(area, input), '');
  }
  assert.equal(normalizeCityPhotos('hokkaido/nonexistent-city', record(undefined, {citySlug: 'hokkaido/nonexistent-city'})), null);
  assert.equal(normalizeCityPhotos('hokkaido', record(undefined, {citySlug: 'hokkaido'})), null, 'prefecture is not a city');
  assert.equal(getSeedCityPhotos('hokkaido/nonexistent-city'), null);
});

test('only canonical supported Creative Commons licenses with matching license URLs qualify', () => {
  const allowed = [
    ['CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
    ['PD', 'https://creativecommons.org/publicdomain/mark/1.0/'],
    ...['1.0', '2.0', '2.5', '3.0', '4.0'].flatMap(version => [
      [`CC BY ${version}`, `https://creativecommons.org/licenses/by/${version}/`],
      [`CC BY-SA ${version}`, `https://creativecommons.org/licenses/by-sa/${version}/`],
    ]),
  ];
  for (const [license, licenseUrl] of allowed) {
    const normalized = normalizeCityPhotos(citySlug, record([photo(1), photo(2), photo(3, {license, licenseUrl})]));
    assert.ok(normalized, license);
    assert.equal(normalized.photos[2].license, license);
    assert.equal(normalized.photos[2].licenseUrl, licenseUrl);
  }
  for (const override of [
    {license: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/'},
    {license: 'CC BY-ND 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/'},
    {license: 'CC BY-SA 5.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/5.0/'},
    {license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'},
    {license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'},
    {license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/'},
    {license: 'PD', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'},
    {license: 'All rights reserved'},
  ]) assert.equal(normalizeCityPhotos(citySlug, record([photo(1), photo(2), photo(3, override)])), null, JSON.stringify(override));
});

test('image, source and license URLs reject external destinations and URL parser aliases', () => {
  const badByField = {
    url: [
      'http://upload.wikimedia.org/wikipedia/commons/a/ab/photo.jpg',
      'https://upload.wikimedia.org.evil.example/wikipedia/commons/a/ab/photo.jpg',
      'https://evil.example/wikipedia/commons/a/ab/photo.jpg',
      'https://upload.wikimedia.org/wikipedia/en/a/ab/photo.jpg',
      'https://upload.wikimedia.org/wikipedia/commons.evil/a/ab/photo.jpg',
      'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>',
    ],
    sourceUrl: [
      'http://commons.wikimedia.org/wiki/File:photo.jpg',
      'https://commons.wikimedia.org.evil.example/wiki/File:photo.jpg',
      'https://commons.wikimedia.org/wiki/Category:Sapporo',
      'https://commons.wikimedia.org/w/index.php?title=File:photo.jpg',
      'javascript:alert(1)',
    ],
    licenseUrl: [
      'http://creativecommons.org/licenses/by-sa/4.0/',
      'https://creativecommons.org.evil.example/licenses/by-sa/4.0/',
      'https://creativecommons.org/licenses/by-sa/4.0/extra/',
      'javascript:alert(1)',
    ],
  };
  for (const [field, badUrls] of Object.entries(badByField)) {
    const good = photo(3)[field];
    badUrls.push(`${good}?tracking=1`, `${good}#fragment`, good.replace('https://', 'https://user:password@'), good.replace(/(https:\/\/[^/]+)/, '$1:8443'), good.replace(/(https:\/\/[^/]+)/, '$1:443'));
    for (const value of badUrls) {
      assert.equal(normalizeCityPhotos(citySlug, record([photo(1), photo(2), photo(3, {[field]: value})])), null, `${field}: ${value}`);
    }
  }
  const filtered = normalizeCityPhotos(citySlug, record([photo(9, {url: 'https://evil.example/image.jpg'}), photo(1), photo(2), photo(3)]));
  assert.deepEqual(filtered.photos.map(item => item.id), ['photo-1', 'photo-2', 'photo-3']);
});

test('dimension bounds reject malformed photos and never turn partial preparation into a ready strip', () => {
  for (const field of ['width', 'height']) {
    for (const value of [0, -1, 1.5, '1600', null, undefined, NaN, Infinity, 100001, Number.MAX_SAFE_INTEGER + 1]) {
      const partial = record([photo(1), photo(2), photo(3, {[field]: value})]);
      assert.equal(normalizeCityPhotos(citySlug, partial), null, `${field}: ${String(value)}`);
      assert.equal(renderCityPhotos(area, partial), '');
    }
  }
  const valid = normalizeCityPhotos(citySlug, record([photo(1), photo(2), photo(3, {width: 1, height: 100000})]));
  assert.equal(valid.photos[2].width, 1);
  assert.equal(valid.photos[2].height, 100000);
});

test('rendered photos preserve escaped labels, lazy dimensions and attribution without active injected markup', () => {
  const injected = '札幌 " onerror="alert(1)"><script>unsafe()</script><img src=x onerror=alert(1)> & 夜景';
  const photos = [photo(1, {title: injected, alt: injected, author: injected}), photo(2), photo(3)];
  const html = renderCityPhotos({...area, name: injected, fullName: injected}, record(photos));
  assert.ok(html);
  const dom = parseFragment(html);
  assert.equal(nodes(dom, node => ['script', 'iframe', 'svg', 'object'].includes(node.tagName)).length, 0);
  assert.equal(nodes(dom, node => (node.attrs || []).some(attribute => /^on/i.test(attribute.name))).length, 0);
  const images = nodes(dom, node => node.tagName === 'img');
  assert.equal(images.length, 3);
  assert.equal(attr(images[0], 'alt'), injected);
  for (const [index, img] of images.entries()) {
    assert.equal(attr(img, 'src'), photos[index].url);
    assert.equal(attr(img, 'loading'), 'lazy');
    assert.equal(attr(img, 'width'), String(photos[index].width));
    assert.equal(attr(img, 'height'), String(photos[index].height));
  }
  const links = nodes(dom, node => node.tagName === 'a');
  for (const image of photos) {
    assert.ok(links.some(anchor => attr(anchor, 'href') === image.sourceUrl), 'Commons source link is retained');
    assert.ok(links.some(anchor => attr(anchor, 'href') === image.licenseUrl), 'license link is retained');
    assert.ok(text(dom).includes(image.author), 'author credit is readable text');
    assert.ok(text(dom).includes(image.license), 'license label is readable text');
  }
  assert.ok(html.includes('&lt;script&gt;'));
});
