import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {parse, parseFragment} from 'parse5';
import {normalizeDocument, resolveCity} from '../src/lib/seo-manager/editorial-model.mjs';
import {cityAreas} from '../src/lib/ltori-seo.mjs';
import {industries, regionalFaqsFor} from '../src/lib/ltori-local-content.mjs';
import service from '../src/data/service-ltori.json' with {type: 'json'};
import {renderRegionalIndustries, renderRegionalCoverage, renderRegionalProvider, regionalLandingFaqs, renderRegionalFaqList} from '../worker/seo-regional-lp-sections.mjs';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const all = (node, predicate) => [node, ...(node.childNodes || []).flatMap(child => all(child, () => true))].filter(predicate);
const byId = (node, id) => all(node, element => attr(element, 'id') === id)[0];
const text = node => node ? node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('') : '';
const compact = value => value.replace(/\s+/g, '');
const shape = node => node.nodeName === '#comment' ? null : node.nodeName === '#text'
  ? compact(node.value) || null
  : [node.tagName || node.nodeName, (node.attrs || []).map(({name, value}) => [name, value]).sort(([a], [b]) => a.localeCompare(b)), (node.childNodes || []).map(shape).filter(Boolean)];
function fixture(slug) {
  const area = resolveCity(slug), now = new Date().toISOString();
  return normalizeDocument({type: 'city', slug, title: `${area.fullName}の採用LINE構築・運用支援`, heading: `${area.fullName}の採用LINE構築・運用支援`, description: `${area.fullName}の企業向け採用LINE支援。`, lead: '勤務地・職種に応じた案内を整理します。', intent: 'employer',
    sections: [{heading: '募集条件を整える', paragraphs: ['勤務地と勤務時間を確認します。']}, {heading: '応募前に情報を届ける', paragraphs: ['職場の様子を企業の素材で伝えます。']}, {heading: '面談への案内', paragraphs: ['面談日時と連絡先を案内します。']}],
    example: {title: '配信の作例', body: '希望職種をお知らせください。'}, sources: [{title: '全国の公的情報', url: 'https://www.mhlw.go.jp/', checkedAt: now.slice(0, 10), geographicScope: '全国'}],
  }, {now, status: 'published', publishedAt: now, review: {reviewedAt: now, reviewedBy: 'fixture@example.test'}});
}

test('all 792 cities have regional sections and the shared 3 + 6 FAQ items without invented office claims', () => {
  assert.equal(cityAreas.length, 792);
  for (const city of cityAreas) {
    const faqs = regionalLandingFaqs(city);
    assert.deepEqual(faqs, [...regionalFaqsFor(city), ...service.faqs], city.slug);
    assert.equal(faqs.length, 9);
    assert.ok(faqs[0].q.includes(city.fullName));
    const provider = renderRegionalProvider(city);
    assert.ok(provider.includes(`${city.fullName}の<br>`));
    assert.ok(provider.includes('ご相談・打ち合わせはオンラインで対応します。'));
    const coverage = parseFragment(renderRegionalCoverage(city));
    assert.ok(text(byId(coverage, 'local-area-title')).includes(`${city.fullName}全域`));
    assert.equal(all(coverage, node => node.tagName === 'a' && attr(node, 'href') === '/service/ltori/area/').length, 0);
  }
});

test('regional helper text cannot introduce HTML, event attributes or unsafe URL values', () => {
  const city = {...resolveCity('hokkaido/sapporo'), name: '<img src=x onerror=alert(1)>', fullName: '</h2><script>unsafe()</script>'};
  const html = renderRegionalIndustries(city) + renderRegionalCoverage(city) + renderRegionalProvider(city) + renderRegionalFaqList([{q: '<svg onload=alert(1)>', a: '<iframe src=x>'}]);
  const dom = parseFragment(html);
  assert.equal(all(dom, node => ['script', 'iframe', 'svg'].includes(node.tagName)).length, 0);
  assert.equal(all(dom, node => (node.attrs || []).some(attribute => /^on/i.test(attribute.name))).length, 0);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  for (const anchor of all(dom, node => node.tagName === 'a')) assert.doesNotMatch(attr(anchor, 'href'), /[<>"']/);
});

test('built service template produces city LP sections identical to the existing static LP', {timeout: 60000}, async t => {
  const template = file('dist/service/ltori/index.html');
  for (const marker of ['industries', 'coverage', 'provider']) assert.ok(template.includes(`data-seo-regional-${marker}-slot`), `Run npm run build to include ${marker} slot`);
  const staticLp = parse(file('dist/service/ltori/area/mie/nabari/index.html'));
  const baseDom = parse(template);
  assert.equal(all(baseDom, node => attr(node, 'id') === 'local-industries').length, 0, 'Service LP must not gain visible regional content');
  assert.equal(all(baseDom, node => hasClass(node, 'lt-faq-list'))[0].childNodes.filter(node => node.tagName === 'details').length, service.faqs.length);
  const bundle = await build({stdin: {contents: 'import {renderDocument} from "./worker/seo-publication.mjs";export default {async fetch(request){const {template,document}=await request.json();return renderDocument(new Response(template,{headers:{"content-type":"text/html"}}),document)}}', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'regional-lp-render-fixture.mjs'}, bundle: true, write: false, format: 'esm', platform: 'browser'});
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', outboundService: () => new Response('External requests are disabled in this test', {status: 500})}));
  const render = async document => {
    const response = await mf.dispatchFetch('http://localhost/__fixture', {method: 'POST', body: JSON.stringify({template, document})});
    assert.equal(response.status, 200); return {html: await response.text(), headers: response.headers};
  };
  try {
    await t.test('industry, local coverage, provider and FAQ match the published static structure and content', async () => {
      const {html} = await render(fixture('mie/nabari')), dom = parse(html);
      for (const id of ['local-industries', 'area', 'local-provider', 'faq']) {
        assert.deepEqual(shape(byId(dom, id)), shape(byId(staticLp, id)), `${id} differs from static LP`);
        assert.equal(all(dom, node => attr(node, 'id') === id).length, 1, `${id} duplicated`);
      }
      const ids = all(dom, node => node.tagName === 'section').map(node => attr(node, 'id')).filter(Boolean);
      for (const [before, after] of [['service', 'local-industries'], ['local-industries', 'area'], ['area', 'plan'], ['flow', 'faq'], ['faq', 'local-provider'], ['local-provider', 'contact']]) assert.ok(ids.indexOf(before) < ids.indexOf(after), `${before} must precede ${after}`);
      assert.equal(all(dom, node => hasClass(node, 'lt-local-industry')).length, industries.length);
      assert.equal(all(dom, node => node.tagName === 'h1').length, 1);
    });
    await t.test('different real cities replace every CTA, hero, FAQ and structured-data identity', async () => {
      for (const slug of ['hokkaido/sapporo', 'okinawa/naha']) {
        const city = resolveCity(slug), doc = fixture(slug), {html} = await render(doc), dom = parse(html);
        assert.equal(all(dom, node => hasClass(node, 'lt-consult-kicker')).length, 2);
        for (const kicker of all(dom, node => hasClass(node, 'lt-consult-kicker'))) assert.equal(text(kicker), `${city.fullName}の採用担当者さまへ`);
        const heroKicker = all(dom, node => hasClass(node, 'lt-hero-kicker'))[0];
        assert.equal(all(heroKicker, node => node.tagName === 'span').length, 1);
        assert.ok(text(heroKicker).includes(city.fullName));
        assert.equal(all(all(dom, node => hasClass(node, 'lt-hero-description'))[0], node => node.tagName === 'br').length, 1);
        assert.ok(text(byId(dom, 'local-industries-title')).startsWith(city.name));
        assert.ok(text(byId(dom, 'local-provider-title')).startsWith(city.fullName));
        assert.doesNotMatch(text(byId(dom, 'ltori-content')), /三重県|名張市|まずは、お気軽に。/);
        const trackedLinks = all(dom, node => node.tagName === 'a' && (attr(node, 'data-lt-cta') !== undefined || attr(node, 'data-lt-diagnosis') !== undefined));
        assert.ok(trackedLinks.length >= 7);
        for (const anchor of trackedLinks) assert.equal(new URL(attr(anchor, 'href'), 'https://layr.co.jp').searchParams.get('source'), `area/${slug}`);
        for (const [index, plan] of service.plans.entries()) {
          const anchor = trackedLinks.find(node => attr(node, 'data-lt-cta') === `plan-${index}`);
          assert.ok(anchor, `${plan.name} CTA is present`);
          const url = new URL(attr(anchor, 'href'), 'https://layr.co.jp');
          assert.deepEqual([...url.searchParams], [['service', 'ltori'], ['plan', plan.name], ['source', `area/${slug}`]], `${plan.name} CTA retains its real parameter names and value`);
        }
        assert.equal(all(dom, node => node.tagName === 'a' && attr(node, 'href') === '/service/ltori/area/').length, 0);
        const jsonLd = all(dom, node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json').flatMap(node => JSON.parse(text(node)));
        const faqSchema = jsonLd.filter(value => value['@type'] === 'FAQPage'); assert.equal(faqSchema.length, 1);
        const details = all(byId(dom, 'faq'), node => node.tagName === 'details'); assert.equal(details.length, 9);
        assert.deepEqual(details.map(detail => ({q: text(all(detail, node => node.tagName === 'summary')[0].childNodes.filter(node => node.tagName === 'span')[1]), a: text(all(detail, node => node.tagName === 'p')[0])})), faqSchema[0].mainEntity.map(faq => ({q: faq.name, a: faq.acceptedAnswer.text})));
        assert.equal(jsonLd.find(value => value['@type'] === 'Service').areaServed.name, city.fullName);
        assert.equal(jsonLd.find(value => value['@type'] === 'Service').url, `https://layr.co.jp/service/ltori/area/${slug}/`);
        assert.doesNotMatch(html, /fixture@example\.test/);
      }
    });
    await t.test('HTML-encoded CTA separators are decoded once while values and fragments are preserved', async () => {
      for (const separator of ['&amp;', '&AMP;', '&#38;', '&#x26;', '&']) {
        const href = `/contact/?service=ltori${separator}plan=${encodeURIComponent('ライト; &相談')}${separator}campaign=q%26a${separator}source=previous#plans`;
        const asset = `<html><head></head><body><div data-seo-editorial-slot></div><a id="cta" href="${href}">相談</a><a id="external" href="https://example.test/contact/?service=ltori${separator}plan=other">外部</a></body></html>`;
        const response = await mf.dispatchFetch('http://localhost/__fixture', {method: 'POST', body: JSON.stringify({template: asset, document: fixture('hokkaido/sapporo')})});
        assert.equal(response.status, 200);
        const dom = parse(await response.text()), url = new URL(attr(byId(dom, 'cta'), 'href'), 'https://layr.co.jp');
        assert.deepEqual([...url.searchParams], [['service', 'ltori'], ['plan', 'ライト; &相談'], ['campaign', 'q&a'], ['source', 'area/hokkaido/sapporo']], separator);
        assert.equal(url.hash, '#plans');
        assert.equal(attr(byId(dom, 'external'), 'href'), 'https://example.test/contact/?service=ltori&plan=other');
      }
      const asset = '<html><head></head><body><div data-seo-editorial-slot></div><a id="cta" href="/contact/?service=ltori&amp;amp;plan=literal">相談</a></body></html>';
      const response = await mf.dispatchFetch('http://localhost/__fixture', {method: 'POST', body: JSON.stringify({template: asset, document: fixture('hokkaido/sapporo')})});
      const url = new URL(attr(byId(parse(await response.text()), 'cta'), 'href'), 'https://layr.co.jp');
      assert.equal(url.searchParams.get('plan'), null, 'Double-encoded input must not become a plan parameter');
      assert.equal(url.searchParams.get('amp;plan'), 'literal');
    });
    await t.test('article rendering remains article-only without injecting service FAQ or regional sections', async () => {
      const doc = {...fixture('mie/nabari'), type: 'article', slug: 'city-free-article', title: '採用の案内', heading: '採用の案内'};
      const articleTemplate = file('dist/service/ltori/article-template/index.html');
      const response = await mf.dispatchFetch('http://localhost/__fixture', {method: 'POST', body: JSON.stringify({template: articleTemplate, document: doc})});
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /"@type":"BlogPosting"/);
      assert.doesNotMatch(html, /"@type":"FAQPage"|id="local-industries"|id="local-provider"/);
    });
  } finally {await mf.dispose();}
});
