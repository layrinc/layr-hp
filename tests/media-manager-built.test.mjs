import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('article plan is present only in protected HTML, not public client bundles', () => {
  const html = read('dist/tools/ltori-seo/media/index.html');
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
  const seed = JSON.parse(html.match(/<script[^>]*id="mm-seed"[^>]*>([\s\S]*?)<\/script>/)?.[1] || 'null');
  const source = JSON.parse(read('src/data/ltori-media-plan.json'));
  assert.equal(seed.articles.length, source.articles.length);
  assert.ok(seed.articles.length >= 180);
  assert.equal(new Set(seed.articles.map(row => row.id)).size, seed.articles.length);
  assert.equal(seed.articles.filter(row => /^A\d/.test(row.id)).length, 120);
  const markers = seed.articles.map(row => row.title).filter(title => title?.length > 15);
  assert.ok(markers.length > 100);
  const walk = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
  for (const path of walk(new URL('../dist/_astro/', import.meta.url).pathname)) {
    if (!/\.(?:js|json|map)$/.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    assert.equal(markers.some(title => text.includes(title)), false, `Private article plan leaked to ${path}`);
  }
  assert.doesNotMatch(read('dist/sitemap-0.xml'), /tools\/ltori-seo|seo\.layr/);
});

test('media manager uses session bootstrap and contains no tracking or browser secrets', () => {
  const page = read('src/pages/tools/ltori-seo/media.astro');
  assert.match(page, /if \(await startAccessSession\(\)\)/);
  assert.doesNotMatch(page, /googletagmanager|gtag\(|client_secret|access_token/);
  assert.match(read('src/lib/media-manager/storage.mjs'), /layr-ltori-media-v1/);
  assert.match(read('src/pages/tools/ltori-seo/index.astro'), /href="\/media\/"/);
});
