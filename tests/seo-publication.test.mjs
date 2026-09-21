import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, qualityIssues, validateDocument, resolveCity, publicPath, isSafeSourceUrl, validDate, DAILY_PUBLICATION_LIMIT } from '../src/lib/seo-manager/editorial-model.mjs';
import { escapeHtml, renderEditorialBody, documentStructuredData, renderPublicationSitemap, renderPublishedCards, renderDocument } from '../worker/seo-publication.mjs';

const now = '2026-09-21T12:00:00.000Z';
function fixture(overrides = {}) {
  return normalizeDocument({ type: 'city', slug: 'mie/nabari', title: '名張市の採用LINE', description: '名張市の採用担当者向けの運用支援です。', heading: '名張市の採用LINE運用', lead: '勤務地情報から面接予約までを整理します。', intent: 'employer', sections: [
    { heading: '募集条件', paragraphs: ['勤務地と時間を確認します。'], steps: ['担当者と確認する'] },
    { heading: '応募の対応', paragraphs: ['候補者が質問できる接点を用意します。'] },
    { heading: '面接前の案内', steps: ['集合場所と連絡先を案内する'] },
  ], example: { title: '面接の案内例', body: '当日の連絡先をご案内します。' }, sources: [{ title: '名張市', url: 'https://www.city.nabari.lg.jp/', checkedAt: '2026-09-21', geographicScope: '名張市' }], ...overrides }, { now, status: 'published', publishedAt: now, review: { reviewedBy: 'editor@example.com', reviewedAt: now } });
}
test('catalog accepts city slugs/codes and rejects prefectures, towns and wards', () => {
  assert.equal(resolveCity('24208').slug, 'mie/nabari');
  assert.equal(resolveCity('mie/nabari').locality, '名張市');
  assert.equal(resolveCity('mie'), null);
  assert.equal(resolveCity('hokkaido/sapporo-chuo'), null);
  assert.equal(resolveCity('mie/meiwa'), null);
  assert.equal(publicPath({ type: 'city', slug: '../contact' }), null);
  assert.equal(publicPath({ type: 'article', slug: 'category' }), null);
  assert.equal(publicPath({ type: 'article', slug: 'interview-reminder' }), '/service/ltori/media/interview-reminder/');
  assert.equal(DAILY_PUBLICATION_LIMIT, 10);
});
test('untrusted client cannot assign review, publication state or publication dates', () => {
  const doc = normalizeDocument({ ...fixture(), status: 'published', review: { reviewedBy: 'fake' }, publishedAt: now }, { now });
  assert.equal(doc.status, 'draft');
  assert.equal(doc.review, null);
  assert.equal(doc.publishedAt, '');
});
test('draft may be incomplete, while publication requires evidence and server review', () => {
  assert.equal(validateDocument({ type: 'article', slug: 'new-article' }, { now }).valid, true);
  const result = validateDocument(fixture(), { forPublication: true, now });
  assert.equal(result.valid, false);
  assert(result.issues.some(item => item.code === 'review'));
  assert.equal(qualityIssues(fixture(), { requireReview: true, now }).filter(item => item.severity === 'error').length, 0);
});
test('quality flags missing or duplicated useful sections, scope and employer intent', () => {
  const original = fixture();
  const doc = { ...original, intent: 'jobseeker', sections: [original.sections[0], original.sections[0]], sources: [{ ...original.sources[0], geographicScope: '' }] };
  const codes = qualityIssues(doc, { now }).map(item => item.code);
  for (const code of ['intent', 'sections', 'duplicate_section', 'source_scope']) assert(codes.includes(code));
});
test('source URLs reject script protocols and credentials; dates reject rollover and future', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com/', 'https://user:pass@example.com/', 'https://localhost/', 'https://127.0.0.1/']) assert.equal(isSafeSourceUrl(url), false);
  assert.equal(isSafeSourceUrl('https://www.city.nabari.lg.jp/'), true);
  assert.equal(validDate('2026-02-30'), false);
  const doc = fixture({ sources: [{ title: '根拠', url: 'https://example.com', checkedAt: '2026-09-22', geographicScope: '全国' }] });
  assert(qualityIssues(doc, { now }).some(item => item.code === 'source_date'));
});
test('prose and source markup are escaped, unsafe URLs never become links', () => {
  const doc = fixture({ lead: '<script>alert(1)</script>', sections: [{ heading: '<img src=x onerror=alert(1)>', paragraphs: ['</div><script>steal()</script>'], steps: ['<svg/onload=alert(1)>'] }], example: { title: '"作例"', body: '<iframe src=x>' }, sources: [{ title: '<b>資料</b>', url: 'javascript:alert(1)', checkedAt: '2026-09-21', geographicScope: '<img>' }] });
  const html = renderEditorialBody(doc);
  assert(!html.includes('<script>'));
  assert(!html.includes('<iframe'));
  assert(!html.includes('href="javascript:'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('作例'));
  assert.equal(escapeHtml('"<>&\''), '&quot;&lt;&gt;&amp;&#39;');
});
test('article city links only include explicitly selected published cities; city LP has none', () => {
  const article = fixture({ type: 'article', slug: 'application-guide', relatedCitySlugs: ['mie/nabari', 'mie/toba'] });
  const html = renderEditorialBody(article, { publishedCitySlugs: ['mie/nabari'] });
  assert(html.includes('href="/service/ltori/area/mie/nabari/"'));
  assert(!html.includes('href="/service/ltori/area/mie/toba/"'));
  assert(!renderEditorialBody(fixture({ relatedCitySlugs: ['mie/toba'] }), { publishedCitySlugs: ['mie/toba'] }).includes('/service/ltori/area/'));
});
test('sitemap and cards exclude drafts, malformed paths and duplicate URLs', () => {
  const doc = fixture();
  const article = fixture({ type: 'article', slug: 'hiring-guide', title: '採用 <script>' });
  const sitemap = renderPublicationSitemap([doc, doc, { ...doc, slug: 'mie/toba', status: 'draft' }, article]);
  assert.equal((sitemap.match(/<url>/g) || []).length, 2);
  assert(!sitemap.includes('mie/toba'));
  const cards = renderPublishedCards([article, { ...article, slug: 'draft-guide', status: 'draft' }]);
  assert(cards.includes('&lt;script&gt;'));
  assert(!cards.includes('draft-guide'));
  assert.equal(documentStructuredData(doc).areaServed.name, '三重県名張市');
});
test('render fails closed for unpublished content and missing template markers', async () => {
  assert.equal((await renderDocument(new Response('anything'), { ...fixture(), status: 'draft' })).status, 404);
  assert.equal((await renderDocument(new Response('<html></html>'), fixture())).status, 503);
  assert.equal((await renderDocument(new Response('<div data-seo-editorial-slot></div>'), { ...fixture(), review: null })).status, 503);
});

test('source dates follow the Japan publication calendar at the UTC date boundary', () => {
  const doc = fixture({ sources: [{ title: '名張市', url: 'https://www.city.nabari.lg.jp/', checkedAt: '2026-09-22', geographicScope: '名張市' }] });
  assert(!qualityIssues(doc, { now: '2026-09-21T15:00:00.000Z' }).some(item => item.code === 'source_date'));
  assert(qualityIssues(doc, { now: '2026-09-21T14:59:59.000Z' }).some(item => item.code === 'source_date'));
});
