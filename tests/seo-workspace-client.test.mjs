import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {buildCorporateCatalog} from '../scripts/build-seo-corporate-catalog.mjs';
import catalog from '../src/data/seo-corporate-catalog.json' with {type: 'json'};
import {canonicalWorkspacePath, workspaceProjectForPath} from '../src/lib/seo-manager/workspace-projects.mjs';
import {formatNumber} from '../src/lib/seo-manager/workspace-client.mjs';
import {corporateEdit, filterCorporateArticles, validateCorporateState} from '../src/lib/seo-manager/corporate-model.mjs';

test('workspace groups public URLs exactly once and rejects external or encoded alias paths', () => {
  assert.equal(workspaceProjectForPath('https://layr.co.jp/media/line-friends-growth/?utm_source=test'), 'corporate');
  assert.equal(workspaceProjectForPath('/service/ltori/media/interview-followup/'), 'media');
  assert.equal(workspaceProjectForPath('/service/ltori/area/mie/nabari/'), 'regional');
  for (const path of ['https://other.test/media/x/', 'https://user@layr.co.jp/media/x/', '//other.test/media/x/', '/media-other/x/', '/media%2fx/', '/media\\x/']) assert.equal(workspaceProjectForPath(path), null);
  assert.equal(canonicalWorkspacePath('/media/x'), '/media/x/');
});

test('missing values never appear as zero and sorting puts measured zero ahead of unknown', () => {
  for (const value of [null, undefined, '', '0', NaN]) assert.equal(formatNumber(value), '—');
  assert.equal(formatNumber(0), '0');
  const articles = catalog.slice(0, 3), measured = [{path: articles[1].path, metrics: {views: 0}}, {path: articles[2].path, metrics: {views: 4}}];
  const rows = filterCorporateArticles(articles, null, measured, {sort: 'views'});
  assert.deepEqual(rows.map(row => row.path), [articles[2].path, articles[1].path, articles[0].path]);
});

test('editorial notes preserve the public keyword and do not mutate the catalog', () => {
  const article = catalog[0], original = structuredClone(article), edit = {priority: 'high', status: 'rewrite', keyword: '採用 LINE 費用', evidence: '公式資料を確認', notes: '費用条件を追加'};
  const state = validateCorporateState({revision: 2, edits: {[article.path]: edit}}, catalog);
  assert.deepEqual(corporateEdit(state, article), edit);
  assert.deepEqual(article, original);
  assert.equal(filterCorporateArticles(catalog, state, [], {search: '採用 LINE', status: 'rewrite'}).length, 1);
  assert.throws(() => validateCorporateState({revision: 2, edits: {'/media/not-in-catalog/': edit}}, catalog));
  assert.throws(() => validateCorporateState({revision: -1, edits: {}}, catalog));
  assert.throws(() => validateCorporateState({revision: 2, edits: {[article.path]: {...edit, notes: 'x'.repeat(4001)}}}, catalog));
});

test('generated corporate catalog matches published markdown and every article has built public HTML', async () => {
  assert.deepEqual(await buildCorporateCatalog(new URL('../src/content/blog/', import.meta.url).pathname), catalog);
  assert.equal(new Set(catalog.map(row => row.path)).size, catalog.length);
  for (const article of catalog) assert.ok(existsSync(new URL(`../dist${article.path}index.html`, import.meta.url)), `${article.path} is not built`);
});

test('new manager screens remain out of the sitemap, have one heading and use the shared switcher', () => {
  const sitemap = readFileSync(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(sitemap, /tools\/ltori-seo|seo\.layr/);
  for (const page of ['overview', 'articles', 'strategy']) {
    const html = readFileSync(new URL(`../dist/tools/ltori-seo/${page}/index.html`, import.meta.url), 'utf8');
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
    assert.match(html, /noindex, nofollow, noarchive/);
    for (const route of ['/', '/regional/', '/media/', '/articles/', '/strategy/', '/growth/']) assert.ok(html.includes(`href="${route}"`), `${page} lacks ${route}`);
    assert.doesNotMatch(html, /googletagmanager|client_secret|PRIVATE KEY/);
  }
});
