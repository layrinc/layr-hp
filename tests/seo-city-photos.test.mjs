import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {collectCityPhotos,runCityPhotosStep,readCityPhotos,PHOTO_LIMITS} from '../worker/seo-city-photos.mjs';
import {ensureDatabase,createStore} from '../worker/seo-store.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';
import {runJob} from '../worker/seo-runtime.mjs';
import {acquireJob,releaseJob} from '../worker/seo-health.mjs';

const now=new Date('2026-09-23T01:00:00Z'),slug='mie/tsu';
const sourceRegistry={schemaVersion:1,cities:{[slug]:{cityCode:'24201',wikidataId:'Q203027',label:'津市',commonsCategory:'Tsu, Mie'}}};
const file=id=>({pageid:id,ns:6,title:`File:Tsu city landscape ${id}.jpg`,type:'file'});
function info(id,changes={}) {
  return {pageid:id,ns:6,title:file(id).title,imageinfo:[{mime:'image/jpeg',thumburl:`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tsu_${id}.jpg/960px-Tsu_${id}.jpg?utm_source=commons`,descriptionurl:`https://commons.wikimedia.org/wiki/File:Tsu_${id}.jpg?utm_campaign=test`,thumbwidth:960,thumbheight:640,extmetadata:{ObjectName:{value:`Tsu city landscape ${id}`},Artist:{value:'<a href="https://example.com">City &amp; Photographer</a>'},Copyrighted:{value:'True'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},...changes}}]};
}
function provider({members=[1,2,3,4].map(file),details=id=>info(id),categories={}}={}) {
  const calls=[];
  return {calls,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});
    const parsed=new URL(url);assert.equal(parsed.origin+parsed.pathname,'https://commons.wikimedia.org/w/api.php');assert.equal(parsed.searchParams.get('maxlag'),'5');assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,undefined);
    if(parsed.searchParams.has('cmtitle'))return Response.json({query:{categorymembers:categories[parsed.searchParams.get('cmtitle')]||members}});
    assert.equal(parsed.searchParams.get('iiurlwidth'),'960');return Response.json({query:{pages:[details(Number(parsed.searchParams.get('pageids')))]}});
  }};
}
function sqliteD1(t) {
  const conn=new DatabaseSync(':memory:');t.after(()=>conn.close());
  const prepared=(sql,args=[])=>({bind(...bindings){return prepared(sql,bindings);},execute(){const result=conn.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};},async run(){return this.execute();},async all(){return {results:conn.prepare(sql).all(...args).map(row=>({...row}))};},async first(){const row=conn.prepare(sql).get(...args);return row?{...row}:null;}});
  return {prepare:sql=>prepared(sql),async batch(statements){conn.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());conn.exec('COMMIT');return results;}catch(error){conn.exec('ROLLBACK');throw error;}}};
}
async function setup(t) {
  const db=sqliteD1(t);await ensureDatabase(db);
  for(const city of getPublishedAreas(now))await createStore(db).upsert('city_photos',city.slug,{schemaVersion:1,citySlug:city.slug,status:'unavailable',photos:[],retryAt:'2027-01-01T00:00:00Z'});
  return db;
}
async function scheduled(db,target=slug,status='scheduled',reviewed=1) {
  await db.prepare('INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,reviewed_version,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(`city-${target}`,`/service/ltori/area/${target}/`,'city',status,1,JSON.stringify({type:'city',slug:target}),'2026-09-24T00:17:00Z',reviewed,now.toISOString()).run();
}

test('free Commons collection records four landscape photos, canonical licenses and category provenance',async()=>{
  const p=provider(),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});
  assert.equal(record.status,'ready');assert.equal(record.photos.length,4);assert.equal(p.calls.length,5);
  assert.equal(record.photos[0].caption,'津市の風景 1');assert.equal(record.photos[0].alt,'三重県津市の風景写真 1');assert.equal(record.photos[0].title,'Tsu city landscape 1');
  assert.equal(record.photos[0].author,'City & Photographer');assert.equal(record.photos[0].width,960);assert.doesNotMatch(record.photos[0].url,/utm|\?/);assert.doesNotMatch(record.photos[0].sourceUrl,/utm|\?/);
  assert.deepEqual(record.sourceEvidence[0],{id:file(1).title,categoryPath:['Category:Tsu, Mie'],pageId:1});
  assert.deepEqual(record.requests,{categoryCalls:1,detailCalls:4});
});

test('only city-bound categories are explored, at bounded depth and without continuation requests',async()=>{
  const categories={'Category:Tsu, Mie':[{pageid:90,ns:14,title:'Category:Landscapes of Tsu, Mie'},{pageid:91,ns:14,title:'Category:Japan'},{pageid:92,ns:14,title:'Category:People of Tsu'}],'Category:Landscapes of Tsu, Mie':[...Array.from({length:10},(_,n)=>file(n+1)),{pageid:93,ns:14,title:'Category:Parks in Tsu, Mie'}],'Category:Parks in Tsu, Mie':[{pageid:94,ns:14,title:'Category:Streets in Tsu, Mie'}]};
  const p=provider({categories}),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});
  assert.equal(record.status,'ready');assert.equal(record.requests.categoryCalls,3);assert.ok(p.calls.length<=13);
  assert.ok(record.sourceEvidence.every(row=>row.categoryPath.join('/')==='Category:Tsu, Mie/Category:Landscapes of Tsu, Mie'));
  assert.ok(p.calls.every(call=>!/[?&](?:cmcontinue|continue)=/.test(call.url)));assert.ok(!p.calls.some(call=>new URL(call.url).searchParams.get('cmtitle')==='Category:Japan'));
});

test('no source, mismatched municipality or non-city causes zero external calls',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not fetch');};
  for(const [city,input] of [[slug,{schemaVersion:1,cities:{}}],['mie',sourceRegistry],[slug,{schemaVersion:1,cities:{[slug]:{...sourceRegistry.cities[slug],cityCode:'99999'}}}]])assert.equal((await collectCityPhotos(city,{now,sourceRegistry:input,fetchImpl})).reason,'no_city_category');
  assert.equal(calls,0);
});

test('unsafe licenses, source/image URLs, attribution, portrait/vertical and unknown copyright are not substituted',async()=>{
  for(const change of [
    row=>{row.imageinfo[0].extmetadata.LicenseShortName.value='All rights reserved';},
    row=>{row.imageinfo[0].extmetadata.LicenseShortName.value='CC BY-NC 4.0';},
    row=>{row.imageinfo[0].extmetadata.LicenseUrl.value='https://example.com/';},
    row=>{row.imageinfo[0].thumburl='https://attacker.test/a.jpg';},
    row=>{row.imageinfo[0].descriptionurl='https://commons.wikimedia.org.evil.test/wiki/File:a.jpg';},
    row=>{row.imageinfo[0].extmetadata.Artist.value='x'.repeat(501);},
    row=>{row.imageinfo[0].extmetadata.Copyrighted.value='Unknown';},
    row=>{row.imageinfo[0].extmetadata.ObjectName.value='Portrait of a person';},
    row=>{row.imageinfo[0].thumbheight=1200;},
  ]) {
    const p=provider({details:id=>{const row=info(id);change(row);return row;}}),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});
    assert.equal(record.status,'unavailable');assert.equal(record.reason,'insufficient_photos');assert.equal(record.photos.length,0);
  }
});

test('explicit attribution is retained, PD metadata needs no invented photographer or license',async()=>{
  const p=provider({details:id=>info(id,{Attribution:{value:'<b>Required credit</b> &amp; author'},Copyrighted:{value:'False'},LicenseShortName:{value:'Public domain'},LicenseUrl:{value:''}})});
  const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.status,'ready');assert.equal(record.photos[0].author,'Required credit & author');assert.equal(record.photos[0].license,'PD');assert.equal(record.photos[0].licenseUrl,'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('municipality/person names containing 川 or 山 are not landscape evidence, nor are models or events',async()=>{
  for(const title of ['旭川 柴田望 山田亮太 朗読会','旭川 柴田望 山田亮太','LEGOLAND model of Tsu park','A girl playing in Tsu park','Tsu historic cityscape demolished','Tsu parking area']) {
    const p=provider({details:id=>info(id,{ObjectName:{value:title}})});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).reason,'insufficient_photos');
  }
});

test('redirects, oversize bodies, API errors and thrown provider details are bounded and sanitized',async()=>{
  for(const fetchImpl of [async()=>new Response('secret',{status:302,headers:{Location:'https://attacker.test/'}}),async()=>new Response('x'.repeat(PHOTO_LIMITS.responseBytes+1)),async()=>Response.json({error:{info:'PRIVATE API ERROR'}}),async()=>{throw new Error('PRIVATE TOKEN');}]) {
    const result=await collectCityPhotos(slug,{now,sourceRegistry,fetchImpl});assert.equal(result.reason,'provider_unavailable');assert.equal(result.requests.categoryCalls,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|secret|attacker/);
  }
});

test('candidate inspection never exceeds eight files or five category calls',async()=>{
  const members=[...Array.from({length:50},(_,index)=>file(index+1)),...Array.from({length:10},(_,index)=>({pageid:100+index,ns:14,title:`Category:Tsu city parks ${index}`}))];
  const p=provider({members,details:id=>info(id,{LicenseShortName:{value:'Unknown'}})});const result=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(result.requests.categoryCalls,5);assert.equal(result.requests.detailCalls,8);assert.equal(p.calls.length,13);
});

test('one step saves one reserved city and subsequent runs are cached; no documents are modified',async t=>{
  const db=await setup(t);await scheduled(db);const p=provider();const before=await db.prepare('SELECT * FROM seo_documents').all();
  const result=await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p});assert.deepEqual(result,{done:false,outcome:'ready',photoCount:4});assert.equal((await readCityPhotos(db,slug)).photos.length,4);
  assert.equal((await createStore(db).get('city_photos',slug)).sourceEvidence.length,4);
  assert.deepEqual(await db.prepare('SELECT * FROM seo_documents').all(),before);
  assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p})).outcome,'cached');assert.equal(p.calls.length,5);
});

test('draft, paused, unreviewed, article and unknown cached paths never trigger acquisition',async t=>{
  const db=await setup(t);await scheduled(db,slug,'draft');await scheduled(db,'mie/ise','paused');await scheduled(db,'mie/yokkaichi','scheduled',null);
  await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('article','/service/ltori/media/example/',JSON.stringify({type:'article'}),1,now.toISOString()).run();
  let calls=0;assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl:async()=>{calls++;}})).outcome,'cached');assert.equal(calls,0);
});

test('public city is eligible even when its editable draft is paused',async t=>{
  const db=await setup(t);await scheduled(db,slug,'paused');await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('live',`/service/ltori/area/${slug}/`,JSON.stringify({type:'city'}),1,now.toISOString()).run();
  const p=provider();assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p})).outcome,'ready');assert.equal(p.calls.length,5);
});

test('failure caches one day for provider errors and seven days for missing photos',async t=>{
  for(const network of [true,false]) {
    const db=await setup(t);await scheduled(db);let calls=0;
    const fetchImpl=async()=>{calls++;if(network)throw new Error('PRIVATE');return Response.json({query:{categorymembers:[]}});};
    const first=await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl});const saved=await createStore(db).get('city_photos',slug);
    assert.equal(first.done,network);assert.equal(saved.retryAt,new Date(now.getTime()+(network?1:7)*86400000).toISOString());assert.doesNotMatch(JSON.stringify(saved),/PRIVATE/);
    assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl})).outcome,'cached');assert.equal(calls,1);
    await runCityPhotosStep({SEO_DB:db},{now:new Date(Date.parse(saved.retryAt)+1),sourceRegistry,fetchImpl});assert.equal(calls,2);
  }
});

test('pausing a reserved city during collection discards the result; a competing cache save wins',async t=>{
  for(const race of ['pause','cache']) {
    const db=await setup(t);await scheduled(db);const p=provider();let done=false;
    const fetchImpl=async(...args)=>{if(!done){done=true;if(race==='pause')await db.prepare("UPDATE seo_documents SET status='paused' WHERE type='city'").run();else await createStore(db).upsert('city_photos',slug,{status:'unavailable',retryAt:'2027-01-01T00:00:00Z',photos:[]});}return p.fetchImpl(...args);};
    assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl})).outcome,'state_changed');
    assert.equal((await createStore(db).get('city_photos',slug))?.status,race==='pause'?undefined:'unavailable');
  }
});

test('malformed ready cache is repairable while seeds avoid all external requests',async t=>{
  const db=await setup(t);await scheduled(db);await createStore(db).upsert('city_photos',slug,{schemaVersion:1,citySlug:slug,status:'ready',photos:[]});
  assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...provider()})).outcome,'ready');
  await db.prepare("DELETE FROM seo_kv WHERE namespace='city_photos' AND key='mie/nabari'").run();let calls=0;
  assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl:async()=>{calls++;throw Error();}})).outcome,'ready');assert.equal(calls,0);assert.deepEqual(await readCityPhotos(db,'mie/nabari'),getSeedCityPhotos('mie/nabari'));
});

test('read cache is one indexed lookup, has no network and gracefully retains seed on database failure',async()=>{
  const queries=[],db={prepare(sql){queries.push(sql);return {bind(key){assert.equal(key,'mie/nabari');return {async first(){throw Error('temporary DB fault');}};}};}};
  assert.deepEqual(await readCityPhotos(db,'mie/nabari'),getSeedCityPhotos('mie/nabari'));assert.equal(queries.length,1);assert.match(queries[0],/namespace='city_photos' AND key=\?/);
  assert.equal(await readCityPhotos(db,'mie'),null);assert.equal(queries.length,1);
});

test('photo collector contains no paid provider, credential or arbitrary endpoint dependency',async()=>{
  const source=await readFile(new URL('../worker/seo-city-photos.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/anthropic|openai|AI_GATEWAY|REGIONAL_EDITORIAL|Authorization|api[_-]key|kiji_/i);
});

test('photo jobs use their own lock and preserve publication and note policy state',async t=>{
  const db=await setup(t),store=createStore(db);await store.upsert('publication','settings',{paused:false,custom:'keep'});await store.upsert('regional_editorial','config',{mode:'lp_template',enabled:true});
  const publication=await acquireJob(db,'publish',now),photos=await acquireJob(db,'photos',now);
  assert.equal((await runJob({SEO_DB:db},'photos',{now})).status,'running');await releaseJob(db,'photos',photos);
  const result=await runJob({SEO_DB:db},'photos',{now});assert.equal(result.status,'completed');assert.equal(result.result.outcome,'cached');
  assert.ok(await store.get('locks','publish'));assert.equal(await store.get('locks','photos'),null);assert.deepEqual(await store.get('publication','settings'),{paused:false,custom:'keep'});assert.deepEqual(await store.get('regional_editorial','config'),{mode:'lp_template',enabled:true});await releaseJob(db,'publish',publication);
});
