import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mediaPath, articlePath, isPublished } from '../src/lib/ltori-media.mjs';
test('draft and future articles are excluded',()=>{
 const now=new Date('2026-09-20');
 assert.equal(isPublished({data:{draft:true,date:now}},now),false);
 assert.equal(isPublished({data:{draft:false,date:new Date('2027-01-01')}},now),false);
 assert.equal(isPublished({data:{draft:false,date:now}},now),true);
});
test('generated media has article links, canonical, schema and recruitment CTAs',()=>{
 for(const id of ['recruitment-funnel','interview-followup','recruitment-line-agency']){
  const html=readFileSync(`dist${articlePath(id)}index.html`,'utf8');
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
  assert.ok(html.includes(`https://layr.co.jp${articlePath(id)}`));
  assert.ok(html.includes('BlogPosting'));
  assert.ok(html.includes('/document/ltori-service/'));
  assert.ok(html.includes('/contact/?service=ltori'));
  assert.ok(readFileSync('dist/sitemap-0.xml','utf8').includes(articlePath(id)));
  assert.ok(readFileSync(`dist${mediaPath}index.html`,'utf8').includes(articlePath(id)));
 }
});
test('CTA clicks are not reported as leads',()=>{
 const layout=readFileSync('src/layouts/LtoriMedia.astro','utf8');
 assert.ok(layout.includes('ltori_media_cta_click'));
 assert.ok(!layout.includes('generate_lead'));
});
