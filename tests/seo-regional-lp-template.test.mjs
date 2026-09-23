import test from 'node:test';
import assert from 'node:assert/strict';
import {cityAreas,municipalityAreas,areaPath} from '../src/lib/ltori-seo.mjs';
import {localPlacesFor,townSource} from '../src/lib/ltori-local-content.mjs';
import geography from '../src/data/ltori-municipalities.json' with {type:'json'};
import {qualityIssues} from '../src/lib/seo-manager/editorial-model.mjs';
import {createRegionalLpDocument,validateRegionalLpDocument,REGIONAL_LP_TEMPLATE_VERSION,REGIONAL_LP_REVIEWER} from '../src/lib/seo-manager/regional-lp-template.mjs';

const now=new Date('2026-09-23T02:00:00Z'),scheduledAt='2026-09-24T09:17:00+09:00';
const create=slug=>createRegionalLpDocument(slug,{now,scheduledAt});
const approve=doc=>({...doc,status:'scheduled',version:1,path:areaPath(cityAreas.find(city=>city.slug===doc.slug)),review:{reviewedBy:REGIONAL_LP_REVIEWER,reviewedAt:now.toISOString()}});

test('all 792 city LPs pass the existing quality gate without a network or paid model call',t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('LP generation must not access a network');});
  assert.equal(cityAreas.length,792);
  for(const city of cityAreas) {
    const doc=create(city.slug);
    assert.equal(doc.status,'draft');assert.equal(doc.review,null);
    assert.equal(doc.id,`city:${city.slug}`);assert.equal(doc.region.cityId,city.code);
    assert.equal(doc.regionalLp.cityCode,city.code);assert.equal(doc.regionalLp.templateVersion,REGIONAL_LP_TEMPLATE_VERSION);
    assert.ok(doc.title.includes(city.fullName));assert.ok(doc.heading.includes(city.fullName));
    assert.ok(doc.sections.every(section=>section.heading.includes(city.locality)));
    assert.deepEqual(validateRegionalLpDocument(doc,{now}),[],city.slug);
    const scheduled=approve(doc);
    assert.deepEqual(validateRegionalLpDocument(scheduled,{now}),[],city.slug);
    assert.deepEqual(qualityIssues(scheduled,{now,requireReview:true}).filter(issue=>issue.severity==='error'),[],city.slug);
  }
});

test('only exact city slugs are accepted, never wards, towns, prefectures or code aliases',()=>{
  for(const slug of ['hokkaido','01100','../contact',null,{},...municipalityAreas.filter(area=>!area.locality.endsWith('市')).map(area=>area.slug)])assert.throws(()=>create(slug),RangeError);
});

test('local copy uses actual ward/place labels and source snapshot dates, not a fabricated new research date',()=>{
  for(const slug of ['hokkaido/sapporo','mie/nabari','okinawa/naha']) {
    const city=cityAreas.find(area=>area.slug===slug),doc=create(slug);
    for(const place of localPlacesFor(city))assert.ok(doc.sections[0].paragraphs.join('').includes(place));
    assert.equal(doc.sources[0].url,geography.metadata.sourceUrl);assert.equal(doc.sources[0].checkedAt,'2026-09-17');
    assert.equal(doc.sources[1].url,townSource.sourceUrl);assert.equal(doc.sources[1].checkedAt,'2026-09-18');
    assert.match(doc.sources[0].geographicScope,/雇用状況やサービスの効果を示す資料ではありません/);
    assert.match(doc.sources[1].geographicScope,/公称町名や重点対応地域を示すものではありません/);
    assert.equal(doc.example.label,'作例');assert.equal(doc.relatedCitySlugs.length,0);
  }
  assert.match(create('hokkaido/sapporo').sections[0].paragraphs[0],/市内の区/);
  assert.match(create('mie/nabari').sections[0].paragraphs[0],/郵便番号データにある町域表記/);
});

test('content, geography and provenance edits cannot borrow the template approval',()=>{
  const mutations=[
    doc=>{doc.title+=' 導入実績100社';},doc=>{doc.description+=' 採用率99%';},doc=>{doc.heading='別の見出し';},doc=>{doc.lead+=' 市内の雇用は増加しています';},
    doc=>{doc.sections[0].paragraphs[0]='改変本文';},doc=>{doc.example.body='架空の実績';},doc=>{doc.sources[0].checkedAt='2026-09-23';},doc=>{doc.sources[0].url='https://example.com/';},
    doc=>{doc.region.cityId='99999';},doc=>{doc.region.prefectureName='東京都';},doc=>{doc.regionalLp.cityCode='99999';},doc=>{doc.regionalLp.coverageSourceSha256='forged';},
    doc=>{delete doc.regionalLp;},doc=>{doc.id='city:hokkaido/sapporo';},doc=>{doc.type='article';},doc=>{doc.slug='hokkaido/sapporo';},doc=>{doc.relatedCitySlugs=['mie/toba'];},doc=>{doc.path='/service/ltori/area/mie/toba/';},
  ];
  for(const mutate of mutations){const doc=approve(create('mie/nabari'));mutate(doc);assert.ok(validateRegionalLpDocument(doc,{now}).length,mutate.toString());}
});

test('lifecycle changes preserve exact content validation while approval identity and time remain mandatory',()=>{
  const doc=approve(create('mie/nabari'));
  assert.deepEqual(validateRegionalLpDocument({...doc,status:'published',version:3,updatedAt:'2026-09-24T00:18:00Z',publishedAt:'2026-09-24T00:17:00Z'},{now:new Date('2026-09-24T01:00:00Z')}),[]);
  for(const review of [null,{reviewedBy:'AI検査',reviewedAt:now.toISOString()},{reviewedBy:REGIONAL_LP_REVIEWER,reviewedAt:'invalid'},{reviewedBy:REGIONAL_LP_REVIEWER,reviewedAt:'2026-09-24T00:00:00Z'}])assert.ok(validateRegionalLpDocument({...doc,review},{now}).some(issue=>issue.code==='regional_lp_review'));
  assert.ok(validateRegionalLpDocument({...doc,scheduledAt:''},{now}).length);
  assert.ok(validateRegionalLpDocument(doc,{now:new Date('2026-09-16T12:00:00Z')}).some(issue=>issue.code==='source_date'));
});

test('generation is deterministic and output mutations cannot modify the shared master or a later draft',()=>{
  const first=create('mie/nabari'),second=create('mie/nabari');assert.deepEqual(first,second);
  assert.equal(first.scheduledAt,'2026-09-24T00:17:00.000Z');assert.equal(first.updatedAt,now.toISOString());
  first.sections[0].paragraphs[0]='modified';first.regionalLp.cityCode='changed';first.sources[0].title='changed';
  assert.deepEqual(create('mie/nabari'),second);
  const reordered=Object.fromEntries(Object.entries(second).reverse());reordered.region=Object.fromEntries(Object.entries(second.region).reverse());assert.deepEqual(validateRegionalLpDocument(reordered,{now}),[]);
});

test('malformed drafts and dates fail closed instead of passing template approval',()=>{
  for(const value of [null,[],{},'text',{slug:'mie/nabari',sections:[null],sources:[null]}, {...create('mie/nabari'),scheduledAt:'invalid'}])assert.ok(validateRegionalLpDocument(value,{now}).length);
  assert.throws(()=>createRegionalLpDocument('mie/nabari',{now:'invalid',scheduledAt}),RangeError);
  assert.throws(()=>createRegionalLpDocument('mie/nabari',{now,scheduledAt:'invalid'}),RangeError);
});
