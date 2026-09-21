import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mediaPath, articlePath, mediaInfo, topicGuides, categoryPath, isPublished, newestFirst } from '../src/lib/ltori-media.mjs';
test('draft and future articles are excluded',()=>{
 const now=new Date('2026-09-20');
 assert.equal(isPublished({data:{draft:true,date:now}},now),false);
 assert.equal(isPublished({data:{draft:false,date:new Date('2027-01-01')}},now),false);
 assert.equal(isPublished({data:{draft:false,date:now}},now),true);
});
test('generated articles retain canonical, schema, source and discoverable links',()=>{
 for(const id of ['recruitment-funnel','interview-followup','recruitment-line-agency']){
  const html=readFileSync(`dist${articlePath(id)}index.html`,'utf8');
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
  assert.ok(html.includes(`https://layr.co.jp${articlePath(id)}`));
  assert.ok(html.includes('BlogPosting'));
  assert.ok(html.includes(`data-lm-source="media/${id}"`));
  assert.ok(html.includes('この記事の目次'));
  assert.ok(readFileSync('dist/sitemap-0.xml','utf8').includes(articlePath(id)));
  assert.ok(readFileSync(`dist${mediaPath}index.html`,'utf8').includes(articlePath(id)));
 }
});
test('media index has its own source instead of borrowing an article',()=>{
 const html=readFileSync(`dist${mediaPath}index.html`,'utf8');
 assert.ok(html.includes('data-lm-source="media"'));
 assert.ok(!html.includes('source=media%2Fundefined'));
});
test('media uses its own editorial footer while corporate pages retain theirs',()=>{
 for(const path of [mediaPath, mediaInfo.aboutPath, ...topicGuides.map(guide=>categoryPath(guide.slug)), ...['recruitment-funnel','interview-followup','recruitment-line-agency'].map(articlePath)]){
  const html=readFileSync(`dist${path}index.html`,'utf8');
  assert.equal((html.match(/<footer\b/g)||[]).length,1);
  assert.ok(!html.includes('class="footer"'));
  assert.ok(!html.includes('採用LINEを無料相談'));
  assert.ok(!html.includes('自社の採用導線を、一緒に整理しませんか。'));
  const footer=html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0];
  for(const label of ['運営会社','プライバシーポリシー','サービスサイトを見てみる']) assert.ok(footer.includes(label));
  assert.ok(!footer.includes('広告運用代行'));
 }
 for(const path of ['/','/service/ltori/','/privacy/']) assert.ok(readFileSync(`dist${path}index.html`,'utf8').includes('class="footer"'));
});
test('category pages only list their own articles, have active navigation and are discoverable',()=>{
 const sitemap=readFileSync('dist/sitemap-0.xml','utf8');
 for(const guide of topicGuides){
  const path=categoryPath(guide.slug), html=readFileSync(`dist${path}index.html`,'utf8');
  assert.ok(html.includes(`rel="canonical" href="https://layr.co.jp${path}"`));
  assert.ok(html.includes(`href="${path}" aria-current="page"`));
  assert.ok(sitemap.includes(`<loc>https://layr.co.jp${path}</loc>`));
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
  const cards=[...html.matchAll(/<article\b[^>]*data-category="([^"]+)"/g)];
  assert.ok(cards.length>0);
  assert.ok(cards.every(([,category])=>category===guide.category));
  assert.ok(html.includes('data-lm-source="media"'));
  assert.ok(!html.includes(`data-lm-source="media/${guide.slug}"`));
 }
});
test('about page identifies the publication and its operator without replacing the service name',()=>{
 const html=readFileSync(`dist${mediaInfo.aboutPath}index.html`,'utf8');
 for(const text of ['エルトリ採用ノート','編集方針','株式会社LAYR','id="operator"','AboutPage']) assert.ok(html.includes(text));
 assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
 assert.ok(html.includes(`rel="canonical" href="https://layr.co.jp${mediaInfo.aboutPath}"`));
 assert.equal(JSON.parse(readFileSync('src/data/service-ltori.json','utf8')).name,'エルトリ');
});
test('new articles sort by publication date, with stable ordering for matching dates',()=>{
 const make=(id,date)=>({id,data:{date:new Date(date)}});
 const sorted=[make('a','2026-09-20'),make('c','2026-09-21'),make('b','2026-09-20')].sort(newestFirst);
 assert.deepEqual(sorted.map(p=>p.id),['c','a','b']);
});
test('index renders all articles without JavaScript and has the media canonical URL',()=>{
 const html=readFileSync(`dist${mediaPath}index.html`,'utf8');
 const entries=[...html.matchAll(/<article\b[^>]*data-lm-article[^>]*>/g)];
 assert.ok(entries.length>=3);
 assert.ok(entries.every(([tag])=>!tag.includes('hidden')));
 assert.ok(html.includes(`rel="canonical" href="https://layr.co.jp${mediaPath}"`));
 assert.ok(html.includes('id="articles"')&&html.includes(`href="${mediaInfo.aboutPath}"`));
 const data=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 const collection=data.find(item=>item['@type']==='CollectionPage');
 assert.equal(collection.mainEntity.numberOfItems,entries.length);
 assert.equal(collection.mainEntity.itemListElement.length,entries.length);
});
test('CTA clicks are not reported as leads',()=>{
 const layout=readFileSync('src/layouts/LtoriMedia.astro','utf8');
 assert.ok(layout.includes('ltori_media_cta_click'));
 assert.ok(!layout.includes('generate_lead'));
});
