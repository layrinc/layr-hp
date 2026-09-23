import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ensureDatabase,createStore} from '../worker/seo-store.mjs';
import {createRegionalLpDocument,REGIONAL_LP_REVIEWER} from '../src/lib/seo-manager/regional-lp-template.mjs';
import {getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';

const now=new Date('2026-09-23T01:00:00Z'),version='landmarks-v2';
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
      assert.equal((html.match(/<section class="lt-city-photos"/g)||[]).length,1);assert.equal((html.match(/loading="lazy"/g)||[]).length,record(slug).photos.length);assert.match(html,/写真クレジット/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<script>unsafe|<img src=x|old seed/);
      const head=await mf.dispatchFetch(`https://layr.co.jp/service/ltori/area/${slug}/`,{method:'HEAD'});assert.equal(head.headers.get('X-Photo-Reads'),'0');assert.equal(await head.text(),'');
    }
    const unpublished=await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/ise/');assert.equal(unpublished.status,404);assert.equal(unpublished.headers.get('X-Photo-Reads'),'0');assert.doesNotMatch(await unpublished.text(),/lt-city-photos/);
    const article=await mf.dispatchFetch('https://layr.co.jp/service/ltori/media/interview-followup/');assert.equal(article.headers.get('X-Photo-Reads'),'0');assert.equal(await article.text(),'published article');
    await store.upsert('city_photos','mie/nabari',{schemaVersion:1,selectionVersion:version,citySlug:'mie/nabari',status:'unavailable',photos:[]});
    assert.doesNotMatch(await (await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/nabari/')).text(),/lt-city-photos|old seed/);
    await db.prepare("DELETE FROM seo_kv WHERE namespace='city_photos' AND key='mie/nabari'").run();
    assert.equal((await (await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/nabari/')).text()).match(/loading="lazy"/g).length,getSeedCityPhotos('mie/nabari').photos.length);
    const noPhotos=await mf.dispatchFetch('https://layr.co.jp/service/ltori/area/mie/toba/');assert.doesNotMatch(await noPhotos.text(),/lt-city-photos|old seed/);
  }finally{await mf.dispose();}
});

test('native Wikimedia fetch supports manual mode at all three providers without following redirects', {timeout:60000},async()=>{
  const bundle=await build({stdin:{contents:`import {collectCityPhotos} from './worker/seo-city-photos.mjs';export default {async fetch(){return Response.json(await collectCityPhotos('mie/tsu',{sourceRegistry:{schemaVersion:1,cities:{'mie/tsu':{cityCode:'24201',wikidataId:'Q203027',label:'津市'}}}}));}};`,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'photo-native-fetch.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  for(const scenario of ['primary','fallback','www.wikidata.org','ja.wikipedia.org','commons.wikimedia.org']) {
    const fallback=scenario==='fallback',redirectHost=scenario.includes('.')?scenario:null;
    const calls=[];const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async request=>{
      calls.push({url:request.url,authorization:request.headers.has('Authorization')});const url=new URL(request.url);
      if(url.hostname===redirectHost)return new Response('PRIVATE REDIRECT',{status:302,headers:{Location:'https://must-not-follow.invalid/image'}});
      if(url.hostname==='www.wikidata.org'&&url.searchParams.get('props').includes('claims'))return Response.json({entities:Object.fromEntries(['津城','津観音','北畠神社'].map((title,i)=>['Q'+(100+i),{id:'Q'+(100+i),sitelinks:{jawiki:{title}},labels:{en:{value:'Landmark'+i}},claims:{P373:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'Landmark'+i}}}]}}]))});
      if(url.hostname==='www.wikidata.org')return Response.json({entities:{Q203027:{id:'Q203027',sitelinks:{jawiki:{title:'津市'}}}}});
      if(url.hostname==='ja.wikipedia.org'&&url.searchParams.has('rvprop'))return Response.json({query:{pages:[{pageid:1,ns:0,title:'津市',pageprops:{wikibase_item:'Q203027'},revisions:[{slots:{main:{content:'== 観光 ==\n* [[津城]]\n* [[津観音]]\n* [[北畠神社]]'}}}]}]}});
      if(url.hostname==='ja.wikipedia.org')return Response.json({query:{pages:['津城','津観音','北畠神社'].map((title,i)=>({pageid:i+10,ns:0,title,pageprops:{wikibase_item:'Q'+(100+i)},extract:title+'は三重県津市にある歴史的建造物である。',pageimage:'Landmark'+i+'.jpg',original:{width:fallback?800:3200,height:2133,source:'https://upload.wikimedia.org/wikipedia/commons/a/aa/Landmark'+i+'.jpg'}}))}});
      assert.equal(url.hostname,'commons.wikimedia.org');if(url.searchParams.get('list')==='categorymembers')return Response.json({query:{categorymembers:[{ns:6,pageid:500,title:'File:'+url.searchParams.get('cmtitle').slice(9)+'.jpg'}]}});const title=url.searchParams.get('titles'),file=title.slice(5);
      return Response.json({query:{pages:[{pageid:500,ns:6,title,imageinfo:[{mime:'image/jpeg',width:3200,height:2133,url:'https://upload.wikimedia.org/wikipedia/commons/a/aa/'+file,thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/'+file+'/1280px-'+file,thumbwidth:1280,thumbheight:853,descriptionurl:'https://commons.wikimedia.org/wiki/'+title,extmetadata:{ObjectName:{value:'Historic exterior'},ImageDescription:{value:file+' exterior'},Artist:{value:'Photographer'},Copyrighted:{value:'True'},LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'}}}]}]}});
    }}));
    try {
      const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);const record=await response.json();
      assert.equal(record.status,redirectHost?'unavailable':'ready');if(redirectHost)assert.equal(record.reason,'provider_unavailable');else assert.equal(record.photos.length,3);
      assert.equal(calls.length,redirectHost===null?(fallback?10:6):redirectHost==='www.wikidata.org'?1:redirectHost==='ja.wikipedia.org'?2:4);
      assert.ok(calls.every(call=>call.authorization===false&&['www.wikidata.org','ja.wikipedia.org','commons.wikimedia.org'].includes(new URL(call.url).hostname)));assert.doesNotMatch(JSON.stringify(record),/PRIVATE|must-not-follow/);
    }finally{await mf.dispose();}
  }
});
