import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { normalizeDocument } from '../src/lib/seo-manager/editorial-model.mjs';

// Exercise native HTMLRewriter: fake selectors cannot catch escaping or streaming bugs.
test('native renderer keeps reviewed city/article metadata, escaped content and attribution consistent', { timeout: 60000 }, async () => {
  const now = new Date().toISOString();
  const template = '<html><head><title>old</title><meta name="description" content="old"><meta property="og:title" content="old"><link rel="canonical" href="https://layr.co.jp/service/ltori/"><script type="application/ld+json">{"old":true}</script></head><body><div class="ltori" data-lt-source=""><h1 id="lt-hero-title">old</h1><p class="lt-hero-kicker">old</p><p class="lt-hero-description">old</p><div data-seo-editorial-slot></div><a href="/service/ltori/area/">全国一覧</a><a href="/contact/?service=ltori&amp;plan=basic">相談</a><a href="/service/ltori/diagnosis/">診断</a></div></body></html>';
  const document = normalizeDocument({
    type: 'city', slug: 'mie/nabari', title: '名張市の採用LINE <script>x</script>', heading: '名張市の採用LINE構築・運用支援', description: '採用案内 " onclick="alert(1)', lead: '勤務地から予約までを整理します。', intent: 'employer',
    sections: [{ heading: '募集条件', paragraphs: ['勤務地と時間を確認する。'] }, { heading: '応募対応', paragraphs: ['<img src=x onerror=alert(1)>'] }, { heading: '面接予約', steps: ['場所と連絡先を案内する。'] }],
    example: { title: '配信の作例', body: '<iframe src=x>' }, sources: [{ title: '名張市', url: 'https://www.city.nabari.lg.jp/', checkedAt: now.slice(0, 10), geographicScope: '名張市' }],
  }, { now, status: 'published', publishedAt: now, review: { reviewedBy: 'private-editor@example.com', reviewedAt: now } });
  const bundle = await build({ stdin: { contents: 'import {renderDocument} from "./worker/seo-publication.mjs";export default {async fetch(request){const {template,document,options}=await request.json();return renderDocument(new Response(template,{headers:{"content-type":"text/html","etag":"old"}}),document,options)}}', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'qa-render.mjs' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01' }));
  const render = (doc = document, options = {}, asset = template) => mf.dispatchFetch('http://localhost', { method: 'POST', body: JSON.stringify({ template: asset, document: doc, options }) });
  try {
    const response = await render();
    const html = await response.text();
    assert.equal(response.status, 200);
    assert(html.includes('<title>名張市の採用LINE &lt;script&gt;x&lt;/script&gt;</title>'));
    assert(html.includes('content="採用案内 &quot; onclick=&quot;alert(1)"'));
    assert(html.includes('<span class="lt-area-name">名張市の</span><span class="lt-area-service"><span>採用LINE</span><br><mark>構築・運用支援</mark></span>'));
    assert(!html.includes('<iframe src=x>'));
    assert(!html.includes('<img src=x onerror'));
    assert(html.includes('&lt;iframe src=x&gt;'));
    assert(html.includes('href="https://layr.co.jp/service/ltori/area/mie/nabari/"'));
    assert(html.includes('source=area%2Fmie%2Fnabari'));
    assert(html.includes('/service/ltori/diagnosis/?source=area%2Fmie%2Fnabari'));
    assert(!html.includes('>全国一覧<'));
    assert(!html.includes('"old":true'));
    assert(!html.includes('private-editor@example.com'));
    assert.equal(response.headers.get('etag'), null);
    assert.equal((await render({ ...document, status: 'draft' })).status, 404);
    const preview = await render({ ...document, status: 'draft', review: null }, { preview: true });
    assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.equal((await render(document, {}, '<html>wrong template</html>')).status, 503);
    const article = { ...document, type: 'article', slug: 'interview-reminder', title: '面接前の案内', heading: '面接前の案内' };
    const articleTemplate = '<html><head><title>template</title><link rel="canonical" href="https://layr.co.jp/service/ltori/article-template/"></head><body><div data-lm-source="runtime"><h1 data-seo-title>template</h1><p data-seo-lead></p><time data-seo-published-at></time><div data-seo-editorial-slot></div><a href="/contact/?service=ltori">相談</a></div></body></html>';
    const articleHtml = await (await render(article, {}, articleTemplate)).text();
    assert(articleHtml.includes('href="https://layr.co.jp/service/ltori/media/interview-reminder/"'));
    assert(articleHtml.includes('data-lm-source="media/interview-reminder"'));
    assert(articleHtml.includes('"@type":"BlogPosting"'));
    assert(!articleHtml.includes('article-template'));
  } finally { await mf.dispose(); }
});
