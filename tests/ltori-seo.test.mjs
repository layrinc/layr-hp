import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {regionalAreas, municipalityAreas, prefectureAreas, createMunicipalityAreas, areaPath, areaKey, consultationHref, sourceLabels} from '../src/lib/ltori-seo.mjs';
import {publishedAreas,publicationFor,cityEditorial} from '../src/lib/ltori-publication.mjs';
import master from '../src/data/ltori-area-routes.json' with {type:'json'};
import service from '../src/data/service-ltori.json' with {type:'json'};
import {localCoverageFor, industries, townSource} from '../src/lib/ltori-local-content.mjs';
const root = new URL('../dist/', import.meta.url);
const readPage = path => readFileSync(new URL(path.slice(1) + 'index.html', root), 'utf8');
const decode = value => value.replaceAll('&amp;', '&');

test('all 47 prefectures and all reviewed municipality records create unique stable routes', () => {
  assert.equal(prefectureAreas.length, 47);
  assert.equal(municipalityAreas.length, master.areas.length);
  assert.ok(municipalityAreas.length > 1800);
  assert.equal(new Set(regionalAreas.map(areaPath)).size, regionalAreas.length);
  assert.equal(new Set(municipalityAreas.map(a => a.code)).size, municipalityAreas.length);
  assert.equal(new Set(municipalityAreas.map(a => a.prefectureSlug)).size, 47);
  assert.equal(municipalityAreas.find(a => a.code === '24208').slug, 'mie/nabari');
  assert.equal(municipalityAreas.find(a => a.code === '30203').slug, 'wakayama/hashimoto');
  assert.ok(municipalityAreas.some(a => a.code === '04216'));
  assert.ok(!municipalityAreas.some(a => a.code === '04423'));
  const record = master.areas[0];
  assert.throws(() => createMunicipalityAreas([record, record]), /Duplicate/);
  assert.throws(() => createMunicipalityAreas([{...record, prefecture:'unknown'}]), /Unknown/);
  assert.throws(() => createMunicipalityAreas([{...record, slug:'..\/escape'}]), /Invalid/);
});

test('every regional LP has its own canonical, metadata, h1, schema, sitemap and trackable CTAs', () => {
  const sitemap = readFileSync(new URL('sitemap-0.xml', root), 'utf8');
  const titles = new Set(), descriptions = new Set(), checkedLinks = new Set();
  const base = readPage('/service/ltori/');
  assert.ok(base.includes('href="/service/ltori/area/"'), 'generic service LP still links to the area directory');
  const baseSections = [...base.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
  for (const area of publishedAreas) {
    const path = areaPath(area), html = readPage(path);
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, path);
    assert.equal((html.match(/<main(?:\s|>)/g) || []).length, 1, path);
    assert.ok(html.includes(`rel="canonical" href="https://layr.co.jp${path}"`), path + ' canonical');
    assert.ok(sitemap.includes(`<loc>https://layr.co.jp${path}</loc>`), path + ' sitemap');
    assert.ok(!html.includes('content="noindex'), path);
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(title.includes(area.fullName) && !titles.has(title), path + ' unique title');
    assert.ok(description.includes(area.fullName) && !descriptions.has(description), path + ' unique description');
    titles.add(title); descriptions.add(description);
    assert.ok(html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)[1].includes(area.fullName), path + ' h1');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.ok(!JSON.stringify(data).includes('LocalBusiness'), path + ' no fictitious local branch');
    const svc = data.find(d => d['@type'] === 'Service');
    assert.equal(svc.url, 'https://layr.co.jp' + path); assert.equal(svc.areaServed.name, area.fullName);
    const faq = data.find(d => d['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, service.faqs.length + 3);
    for (const q of faq.mainEntity) { assert.ok(html.includes(q.name)); assert.ok(html.includes(q.acceptedAnswer.text)); }
    assert.ok(!data.some(d => d['@type'] === 'BreadcrumbList'), path + ' removed regional breadcrumb schema');
    assert.ok(!html.includes('lt-area-breadcrumb'), path + ' removed breadcrumb row');
    assert.ok(!html.includes('都道府県・市区町村一覧'), path + ' removed nationwide breadcrumb label');
    assert.ok(!html.includes('href="/service/ltori/area/"'), path + ' no nationwide links in final CTA or footer');
    for (const id of baseSections) assert.ok(html.includes(`id="${id}"`), path + ' existing LP section ' + id);
    for (const [,tag] of html.matchAll(/(<a\b[^>]*data-lt-cta[^>]*>)/g)) {
      const url = new URL(decode(tag.match(/href="([^"]*)"/)[1]), 'https://layr.co.jp');
      assert.equal(url.pathname, '/contact/'); assert.equal(url.searchParams.get('source'), areaKey(area));
    }
    for (const [,href] of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[^" ]*)"/g)) {
      if (href.startsWith('//') || checkedLinks.has(href)) continue;
      checkedLinks.add(href);
      assert.ok(existsSync(new URL(href.slice(1) + (href.endsWith('/') ? 'index.html' : ''), root)), `${path} broken link ${href}`);
    }
  }
  assert.ok(!existsSync(new URL('service/ltori/area/tokyo/index.html', root)), 'draft prefecture is not deployed');
  assert.ok(!existsSync(new URL('service/ltori/industry/manufacturing/index.html', root)), 'superseded unshipped guide removed');
});

test('directory and sitemap contain only reviewed published pages; no stale drafts are deployable', () => {
  const directory = readPage('/service/ltori/area/');
  const sitemap = readFileSync(new URL('sitemap-0.xml', root), 'utf8');
  for (const area of regionalAreas) {
    const live=publicationFor(area)==='published';
    assert.equal(directory.includes(`href="${areaPath(area)}"`),live,areaPath(area));
    assert.equal(sitemap.includes(`<loc>https://layr.co.jp${areaPath(area)}</loc>`),live,areaPath(area));
    assert.equal(existsSync(new URL(areaPath(area).slice(1)+'index.html',root)),live,areaPath(area));
  }
});

test('the contact form recognizes every route without accepting arbitrary source text', () => {
  const contact = readPage('/contact/');
  for (const area of publishedAreas) {
    const url = new URL(consultationHref(areaKey(area)), 'https://layr.co.jp');
    assert.equal(url.searchParams.get('service'), 'ltori');
    assert.equal(sourceLabels[url.searchParams.get('source')], `${area.fullName}の採用LINE`);
    assert.ok(contact.includes(JSON.stringify(areaKey(area))));
  }
  assert.equal(sourceLabels['area/unknown/untrusted'], undefined);
  assert.ok(contact.includes('Object.prototype.hasOwnProperty.call'));
});


test('all regional LPs contain local hiring, industry examples, named coverage and a provider introduction', () => {
  for (const area of publishedAreas) {
    const path = areaPath(area), html = readPage(path), coverage = localCoverageFor(area);
    assert.ok(html.includes(cityEditorial[area.slug].title));
    assert.ok(html.includes(cityEditorial[area.slug].message));
    for (const id of ['local-guide', 'local-industries', 'area', 'local-provider']) {
      assert.ok(html.includes(`id="${id}"`), path + ' missing local section ' + id);
    }
    for (const industry of industries) {
      assert.ok(html.includes(`id="local-industry-${industry.id}"`));
      assert.ok(html.includes(`href="#local-industry-${industry.id}"`));
      for (const label of industry.examples) assert.ok(html.includes(label));
    }
    if (coverage.kind === 'towns') {
      assert.ok(coverage.labels.length > 0 && coverage.labels.length <= 16);
      for (const place of coverage.labels) assert.ok(html.includes(`<li>${place}</li>`), path + ' missing named town ' + place);
      assert.ok(html.includes(townSource.sourceUrl), path + ' source');
    }
    if (coverage.kind === 'wards') {
      for (const child of coverage.children) assert.ok(html.includes(`href="${areaPath(child)}"`));
    }
    assert.ok(!html.includes('ほかの対応地域'), path + ' removed sibling links');
    assert.ok(!html.includes('class="lt-area-back"'), path + ' removed trailing directory links');
    assert.ok(!html.includes('準備中'), path + ' no empty reference placeholders');
  }
  const base = readPage('/service/ltori/');
  assert.ok(!base.includes('id="local-guide"'), 'generic service LP retains its original content');
  const nabari = readPage('/service/ltori/area/mie/nabari/');
  const hashimoto = readPage('/service/ltori/area/wakayama/hashimoto/');
  assert.ok(nabari.includes('桔梗が丘１番町') && nabari.includes('蔵持町原出'));
  assert.ok(hashimoto.includes('東家') && hashimoto.includes('御幸辻'));
});
