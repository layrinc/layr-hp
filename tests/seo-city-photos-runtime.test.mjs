import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ensureDatabase,createStore} from '../worker/seo-store.mjs';
import {createRegionalLpDocument,REGIONAL_LP_REVIEWER} from '../src/lib/seo-manager/regional-lp-template.mjs';
import {getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';

const now=new Date('2026-09-23T01:00:00Z');
const record=slug=>({...getSeedCityPhotos('mie/nabari'),citySlug:slug,photos:getSeedCityPhotos('mie/nabari').photos.map((photo,index)=>({...photo,title:`景観 ${index} <img src=x onerror=alert(1)>`,alt:'風景 <script>unsafe</script>',author:'氏名 <script>unsafe</script>'}))});

test('native public city pages render one cached photo record; drafts, articles and HEAD never reveal it', {timeout:60000},async()=>{
  const template='<html><head><title>template</title><link rel="canonical" href="https://layr.co.jp/service/ltori/"></head><body><div class="ltori" data-lt-source=""><h1 id="lt-hero-title">template</h1><div data-city-photos-slot>old seed</div><div data-seo-editorial-slot></div></div></body></html>';
  const bundle=await build({stdin:{contents:`import {publicFetch} from './worker/seo-runtime.mjs';
    export default {async fetch(request,env){const queries=[];const db={prepare(sql){queries.push(sql);return env.DB.prepare(sql)},batch(rows){return env.DB.batch(rows)}};
    const result=await publicFetch(request,{SEO_DB:db,ASSETS:{async fetch(req){const path=new URL(req.url).pathname;if(['/service/ltori/','/service/ltori/area/mie/nabari/','/service/ltori/area/mie/toba/'].includes(path))return new Response(${JSON.stringify(template)},{headers:{'content-type':'text/html',etag:'static-old'}});if(path==='/service/ltori/media/interview-followup/')return new Response('published article');return new Response('not found',{status:404});}}});
    const response=new Response(result.body,{status:result.status,headers:result.headers});response.headers.set('X-Photo-Reads',String(queries.filter(sql=>sql.includes("namespace='city_photos'")).length));return response;}};`,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'photo-runtime.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:['DB']}));
  try {
    const db=await mf.getD1Database('DB');await ensureDatabase(db);const store=createStore(db);
    const doc={...createRegionalLpDocument('mie/tsu',{now}),status:'published',publishedAt:now.toISOString(),review:{reviewedBy:REGIONAL_LP_REVIEWER,reviewedAt:now.toISOString()}};
    await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind(doc.id,'/service/ltori/area/mie/tsu/',JSON.stringify(doc),1,now.toISOString()).run();
    for(const slug of ['mie/tsu','mie/nabari','mie/ise'])await store.upsert('city_photos',slug,record(slug));
    for(const slug of ['mie/tsu','mie/nabari']) {
      const response=await mf.dispatchFetch(`https://layr.co.jp/service/ltori/area/${slug}/`);assert.equal(response.status,200);assert.equal(response.headers.get('X-Photo-Reads'),'1');assert.equal(response.headers.get('etag'),null);const html=await response.text();
      assert.equal((html.match(/<section class="lt-city-photos"/g)||[]).length,1);assert.equal((html.match(/loading="lazy"/g)||[]).length,4);assert.match(html,/写真クレジット/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<script>unsafe|<img src=x|old seed/);
      const head=await mf.dispatchFetch(`https://layr.co.jp/service/ltori/area/${slug}/`,{method:'HEAD'});assert.equal(head.headers.get('X-Photo-Reads'),'0');assert.equal(await head.text(),'');
    }
    const unpublished=await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/ise/');assert.equal(unpublished.status,404);assert.equal(unpublished.headers.get('X-Photo-Reads'),'0');assert.doesNotMatch(await unpublished.text(),/lt-city-photos/);
    const article=await mf.dispatchFetch('https://layr.co.jp/service/ltori/media/interview-followup/');assert.equal(article.headers.get('X-Photo-Reads'),'0');assert.equal(await article.text(),'published article');
    await store.upsert('city_photos','mie/nabari',{schemaVersion:1,citySlug:'mie/nabari',status:'unavailable',photos:[]});
    assert.doesNotMatch(await (await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/nabari/')).text(),/lt-city-photos|old seed/);
    await db.prepare("DELETE FROM seo_kv WHERE namespace='city_photos' AND key='mie/nabari'").run();
    assert.equal((await (await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/nabari/')).text()).match(/loading="lazy"/g).length,4);
    const noPhotos=await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/toba/');assert.doesNotMatch(await noPhotos.text(),/lt-city-photos|old seed/);
  }finally{await mf.dispose();}
});

test('native Commons fetch supports manual redirect mode and never follows provider redirects', {timeout:60000},async()=>{
  const bundle=await build({stdin:{contents:`import {collectCityPhotos} from './worker/seo-city-photos.mjs';export default {async fetch(){return Response.json(await collectCityPhotos('mie/tsu',{sourceRegistry:{schemaVersion:1,cities:{'mie/tsu':{cityCode:'24201',wikidataId:'Q203027',label:'津市',commonsCategory:'Tsu, Mie'}}}}));}};`,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'photo-native-fetch.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  for(const redirect of [false,true]) {
    const calls=[];const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async request=>{calls.push({url:request.url,authorization:request.headers.has('Authorization')});return redirect?new Response('PRIVATE REDIRECT',{status:302,headers:{Location:'https://must-not-follow.invalid/image'}}):Response.json({query:{categorymembers:[]}});}}));
    try {
      const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);const record=await response.json();assert.equal(record.reason,redirect?'provider_unavailable':'insufficient_photos');assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).hostname,'commons.wikimedia.org');assert.equal(calls[0].authorization,false);assert.doesNotMatch(JSON.stringify(record),/PRIVATE|must-not-follow/);
    }finally{await mf.dispose();}
  }
});
