import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import regulation from '../src/data/seo-article-regulation.json' with {type: 'json'};

test('article regulation lists the flow, both destinations and a non-empty checklist', () => {
  assert.equal(regulation.flow.length, 11);
  assert.deepEqual(regulation.flow.filter(row => row.owner === '河出さん').map(row => row.step), ['構成案FB・修正指示', '初稿FB・修正指示', '最終内容確認', '公開']);
  assert.deepEqual(regulation.destinations.map(row => row.manage), ['/articles/', '/media/']);
  const items = regulation.checklist.flatMap(category => category.items);
  assert.equal(items.filter(item => typeof item.no === 'number').length, 66, 'the 66 source items stay complete');
  assert.deepEqual(items.filter(item => typeof item.no === 'number').map(item => item.no), Array.from({length: 66}, (_, index) => index + 1));
  assert.equal(regulation.hyoki.length, 66); assert.equal(regulation.bunsho.length, 21);
});

test('regulation links open only Google Drive, Sheets or the public site', () => {
  const urls = regulation.links.flatMap(group => group.items.map(item => item.url));
  assert.ok(urls.length >= 7);
  for (const url of urls) assert.match(url, /^https:\/\/(?:drive\.google\.com\/file\/d\/[\w-]+\/view|docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit|layr\.co\.jp\/)/);
  // The provided folder also holds another company's credentials and personal data: link files, never folders.
  assert.ok(urls.every(url => !url.includes('/drive/folders/')));
});

test('regulation tab sits right after the common publication tab and stays out of the sitemap', async () => {
  const nav = await readFile(new URL('../src/components/seo-manager/WorkspaceNav.astro', import.meta.url), 'utf8');
  assert.ok(nav.indexOf("id: 'growth'") < nav.indexOf("id: 'regulation'"));
  assert.match(nav, /id: 'regulation', label: '記事制作レギュレーション', href: '\/regulation\/'/);
  const html = await readFile(new URL('../dist/tools/ltori-seo/regulation/index.html', import.meta.url), 'utf8');
  assert.match(html, /noindex/); assert.equal((html.match(/<h1/g) || []).length, 1);
  const sitemap = await readFile(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(sitemap, /regulation/);
});
