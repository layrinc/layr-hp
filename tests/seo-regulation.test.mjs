import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import regulation from '../src/data/seo-article-regulation.json' with {type: 'json'};

test('article regulation lists the flow, both destinations and a non-empty checklist', () => {
  assert.equal(regulation.flow.length, 9);
  assert.deepEqual(regulation.flow.filter(row => row.owner === '河出さん').map(row => row.step), ['構成案の確認', '最終確認・公開']);
  assert.deepEqual(regulation.destinations.map(row => row.manage), ['/articles/', '/media/']);
  assert.ok(regulation.checklist.length >= 8 && regulation.checklist.every(category => category.items.length > 0));
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
