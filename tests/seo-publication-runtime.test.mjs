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

test('native public routing reads one body per URL and only selected related city paths', { timeout: 60000 }, async () => {
  const {ensureDatabase} = await import('../worker/seo-store.mjs');
  const now = new Date().toISOString();
  const makeDocument = (type, slug, title, relatedCitySlugs = []) => normalizeDocument({type, slug, title, heading: title, description: '採用担当者向けの応募対応ガイド', lead: '応募のあとに必要な案内を整理します。', intent: 'employer', relatedCitySlugs, sections: [
    {heading: '条件整理', paragraphs: ['募集職種と勤務時間を確認する。']}, {heading: '回答担当', paragraphs: ['候補者の質問に答える担当を決める。']}, {heading: '面接の案内', steps: ['集合場所と連絡先を伝える。']},
  ], example: {title: '案内例', body: '当日の連絡先をご案内します。'}, sources: [{title: '確認資料', url: 'https://www.city.tsu.mie.jp/', checkedAt: now.slice(0, 10), geographicScope: '津市'}]}, {now, status: 'published', publishedAt: now, review: {reviewedBy: 'editor@example.com', reviewedAt: now}});
  const city = makeDocument('city', 'mie/tsu', '津市の採用LINE');
  const article = makeDocument('article', 'hiring-guide', '応募後のLINE活用', ['mie/nabari', 'mie/tsu', 'mie/ise']);
  const unrelated = makeDocument('article', 'unrelated-guide', '別の記事');
  const template = '<html><head><title>template</title><link rel="canonical" href="https://layr.co.jp/"></head><body><div class="ltori" data-lt-source=""><h1 id="lt-hero-title" data-seo-title>template</h1><div data-seo-editorial-slot></div></div></body></html>';
  const workerSource = `import {publicFetch,getStaticPages} from './worker/seo-runtime.mjs';
    import {handleManagerApi} from './worker/seo-manager-api.mjs';
    const template=${JSON.stringify(template)};
    export default {async fetch(request,env){
      const queries=[];
      const db={prepare(sql){queries.push(sql);return env.DB.prepare(sql)},batch(statements){return env.DB.batch(statements)}};
      if(new URL(request.url).pathname==='/__test/dashboard')return handleManagerApi(new Request('https://seo.layr.co.jp/api/seo/dashboard'),{SEO_DB:db},{email:'biz.oneservice@gmail.com'},'/api/seo/dashboard',{staticPages:getStaticPages()});
      const result=await publicFetch(request,{SEO_DB:db,ASSETS:{async fetch(assetRequest){
        const path=new URL(assetRequest.url).pathname;
        if(path==='/service/ltori/'||path==='/service/ltori/article-template/')return new Response(template,{headers:{'content-type':'text/html'}});
        if(path==='/service/ltori/media/')return new Response('<section id="articles"><div class="lm-list"></div></section>');
        if(path==='/service/ltori/area/')return new Response('<ul data-seo-city-directory></ul>');
        if(path==='/service/ltori/area/mie/nabari/')return new Response('existing static page');
        return new Response('Not found',{status:404});
      }}});
      const response=new Response(result.body,{status:result.status,headers:result.headers});
      response.headers.set('X-Test-Selects',JSON.stringify(queries.filter(sql=>/^SELECT/i.test(sql)).map(sql=>sql.replace(/\\s+/g,' '))));
      return response;
    }};`;
  const bundle = await build({stdin: {contents: workerSource, resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'qa-public-fetch.mjs'}, bundle: true, write: false, format: 'esm', platform: 'browser'});
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: ['DB']}));
  const selects = response => JSON.parse(response.headers.get('X-Test-Selects'));
  try {
    const db = await mf.getD1Database('DB'); await ensureDatabase(db);
    await db.batch([city, article, unrelated].map(doc => db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind(doc.id, `/service/ltori/${doc.type === 'city' ? 'area' : 'media'}/${doc.slug}/`, JSON.stringify(doc), 1, now)));
    const cityResponse = await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/tsu/');
    assert.equal(cityResponse.status, 200);
    assert.deepEqual(selects(cityResponse), ['SELECT value,version,published_at FROM seo_published WHERE path=?']);
    assert((await cityResponse.text()).includes('津市の'));
    const articleResponse = await mf.dispatchFetch('https://layr.co.jp/service/ltori/media/hiring-guide/');
    assert.equal(articleResponse.status, 200);
    const reads = selects(articleResponse);
    assert.equal(reads.length, 2); assert.match(reads[0], /WHERE path=\?/); assert.equal(reads[1], 'SELECT path FROM seo_published WHERE path IN (?,?)');
    const html = await articleResponse.text();
    assert(html.includes('href="/service/ltori/area/mie/nabari/"'));
    assert(html.includes('href="/service/ltori/area/mie/tsu/"'));
    assert(!html.includes('href="/service/ltori/area/mie/ise/"'));
    assert(!html.includes('別の記事'));
    const head = await mf.dispatchFetch('https://layr.co.jp/service/ltori/media/hiring-guide/', {method: 'HEAD'});
    assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.match(head.headers.get('content-type'), /text\/html/);
    const alias = await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/tsu/index.html?ref=test', {redirect: 'manual'});
    assert.equal(alias.status, 301); assert.equal(alias.headers.get('Location'), 'https://layr.co.jp/service/ltori/area/mie/tsu/?ref=test'); assert.equal(selects(alias).length, 1);
    const missing = await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/ise/');
    assert.equal(missing.status, 404); assert.equal(selects(missing).length, 1);
    for (const slug of ['mie/nabari', 'mie/toba', 'wakayama/hashimoto']) {
      const source = await mf.dispatchFetch(`https://layr.co.jp/api/ltori/source?key=area/${slug}`);
      assert.equal(source.status, 200); assert.equal((await source.json()).path, `/service/ltori/area/${slug}/`);
      assert.deepEqual(selects(source), []);
    }
    const dashboard = await mf.dispatchFetch('https://seo.layr.co.jp/__test/dashboard');
    assert.equal(dashboard.status, 200);
    const metrics = await dashboard.json();
    for (const slug of ['mie/nabari', 'mie/toba', 'wakayama/hashimoto']) assert(metrics.report.pages.some(page => page.path === `/service/ltori/area/${slug}/`));
    const existing = await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/nabari/');
    assert.equal(existing.status, 200); assert.equal(await existing.text(), 'existing static page');
    for (const path of ['/sitemap-ltori-growth.xml', '/service/ltori/media/', '/service/ltori/area/']) {
      const listing = await mf.dispatchFetch(`https://layr.co.jp${path}`);
      assert.equal(listing.status, 200); assert.deepEqual(selects(listing), ['SELECT * FROM seo_published ORDER BY published_at DESC,id']);
    }
  } finally {await mf.dispose();}
});
