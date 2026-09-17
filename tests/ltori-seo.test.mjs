import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {publishedGuides,selectPublishedGuides,prefectureGroups,guidePath,consultationHref} from '../src/lib/ltori-seo.mjs';

test('47 unique prefectures and city manuscripts agree with the municipal code master',()=>{
  const prefectures=prefectureGroups.flatMap(g=>g.prefectures);
  assert.equal(prefectures.length,47);assert.equal(new Set(prefectures.map(([s])=>s)).size,47);
  const master=JSON.parse(readFileSync(new URL('../src/data/ltori-municipalities.json',import.meta.url)));
  assert.equal(new Set(master.areas.map(a=>a.jisCode)).size,master.areas.length);
  assert.equal(new Set(master.areas.map(a=>a.prefectureCode)).size,47);
  for(const g of publishedGuides.filter(g=>g.municipalityCode)){
    const a=master.areas.find(a=>a.jisCode===g.municipalityCode);assert.ok(a);assert.equal(a.name,g.label);assert.equal(a.prefecture,g.prefecture);
  }
});
test('drafts cannot produce routes and incomplete or orphan published records fail closed',()=>{
  assert.deepEqual(selectPublishedGuides([{status:'draft',slug:'not-a-page'}]),[]);
  const source=structuredClone(publishedGuides.find(g=>g.slug==='wakayama'));
  assert.throws(()=>selectPublishedGuides([source,source]),/Duplicate/);
  assert.throws(()=>selectPublishedGuides([{...source,sources:[]}]),/source/);
  assert.throws(()=>selectPublishedGuides([{...source,slug:'../escape'}]),/Invalid/);
  const city=structuredClone(publishedGuides.find(g=>g.slug==='wakayama/hashimoto'));
  assert.throws(()=>selectPublishedGuides([city]),/parent/);
});
test('built pages have self canonical, one h1/main, real internal links and sitemap coverage',()=>{
  const root=new URL('../dist/',import.meta.url);
  const sitemap=readFileSync(new URL('sitemap-0.xml',root),'utf8');
  const paths=['/service/ltori/area/',...publishedGuides.map(guidePath)];
  const titles=new Set();
  for(const path of paths){
    const html=readFileSync(new URL(path.slice(1)+'index.html',root),'utf8');
    assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,path);
    assert.equal((html.match(/<main(?:\s|>)/g)||[]).length,1,path);
    assert.ok(html.includes(`rel="canonical" href="https://layr.co.jp${path}"`),path+' canonical');
    assert.ok(sitemap.includes(`https://layr.co.jp${path}`),path+' sitemap');
    assert.ok(!html.includes('content="noindex'),path);
    const title=html.match(/<title>(.*?)<\/title>/)[1];assert.ok(!titles.has(title));titles.add(title);
    const jsonLd=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);assert.ok(jsonLd);assert.ok(!JSON.stringify(JSON.parse(jsonLd[1])).includes('LocalBusiness'));
    for(const [,href]of html.matchAll(/href="(\/[^"#?]*)(?:[^" ]*)"/g)){
      if(href.startsWith('//'))continue;
      const file=new URL(href.slice(1)+(href.endsWith('/')?'index.html':''),root);
      assert.ok(existsSync(file),`${path} broken internal link ${href}`);
    }
  }
  assert.ok(!existsSync(new URL('service/ltori/area/tokyo/index.html',root)),'unwritten Tokyo page must not exist');
  assert.ok(!sitemap.includes('/service/ltori/area/tokyo/'));
});
test('consultation links carry only service and a stable guide key',()=>{
  const url=new URL(consultationHref('area/mie/nabari'),'https://layr.co.jp');
  assert.equal(url.searchParams.get('service'),'ltori');assert.equal(url.searchParams.get('source'),'area/mie/nabari');
  assert.equal(url.pathname,'/contact/');
});
