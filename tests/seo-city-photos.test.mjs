import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {collectCityPhotos,runCityPhotosStep,readCityPhotos,PHOTO_LIMITS} from '../worker/seo-city-photos.mjs';
import {extractLandmarkCandidates,landmarkMatchesCity,LANDMARK_SELECTION_VERSION} from '../worker/seo-landmark-photos.mjs';
import {ensureDatabase,createStore} from '../worker/seo-store.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';
import {runJob} from '../worker/seo-runtime.mjs';
import {acquireJob,releaseJob} from '../worker/seo-health.mjs';

const now=new Date('2026-09-23T01:00:00Z'),slug='mie/tsu',version=LANDMARK_SELECTION_VERSION;
const sourceRegistry={schemaVersion:1,cities:{[slug]:{cityCode:'24201',wikidataId:'Q203027',label:'津市'}}};
const city={locality:'津市',prefectureName:'三重県'};
const names=['津城','津観音','北畠神社','蓮光院初馬寺'];
const wikitext='== 地理 ==\n* [[一般市街]]\n== 観光 ==\n'+names.map(name=>'* [['+name+']]').join('\n')+'\n=== 祭り ===\n* [[祭りの人物]]\n== 交通 ==\n* [[津駅]]';
const original=id=>'https://upload.wikimedia.org/wikipedia/commons/a/aa/Landmark_'+id+'.jpg';
function landmark(title,id) {
  return {pageid:id,ns:0,title,pageprops:{wikibase_item:'Q'+(90000+id)},extract:title+'は、三重県津市にある歴史的建造物である。',pageimage:'Landmark_'+id+'.jpg',original:{source:original(id)+'?utm_source=wiki',width:3200,height:2133}};
}
function imageInfo(id) {
  return {pageid:1000+id,ns:6,title:'File:Landmark '+id+'.jpg',imageinfo:[{mime:'image/jpeg',url:original(id),width:3200,height:2133,thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Landmark_'+id+'.jpg/1280px-Landmark_'+id+'.jpg?utm_source=commons',descriptionurl:'https://commons.wikimedia.org/wiki/File:Landmark_'+id+'.jpg?utm_campaign=test',thumbwidth:1280,thumbheight:853,extmetadata:{ObjectName:{value:'Original photograph '+id},ImageDescription:{value:'Landmark exterior'},Artist:{value:'<a href="https://example.com">City &amp; Photographer</a>'},Copyrighted:{value:'True'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]};
}
function provider({text=wikitext,cityId='Q203027',entityId='Q203027',editPage=()=>{},editImage=()=>{},pageNames=names,fallbacks=false,editEntity=()=>{},editCategory=()=>{}}={}) {
 const calls=[];
 return {calls,fetchImpl:async(url,options)=>{
  const u=new URL(url);calls.push({url:String(url),options});assert.ok(['www.wikidata.org','ja.wikipedia.org','commons.wikimedia.org'].includes(u.hostname));assert.equal(u.pathname,'/w/api.php');assert.equal(u.searchParams.get('maxlag'),'5');assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,undefined);
  const warnings={deprecation:{'*':'Informational notice'}};
  if(u.hostname==='www.wikidata.org'&&u.searchParams.get('props').includes('claims')){
   const entities={};if(fallbacks)for(const id of u.searchParams.get('ids').split('|')){const number=Number(id.slice(1))-90000,item={id,labels:{en:{value:'Landmark '+number}},sitelinks:{jawiki:{title:pageNames[number-1]}},claims:{P373:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'Landmark '+number}}}]}};editEntity(item);entities[id]=item;}return Response.json({entities});
  }
  if(u.hostname==='www.wikidata.org')return Response.json({entities:{Q203027:{id:entityId,sitelinks:{jawiki:{title:'津市'}}}},warnings});
  if(u.hostname==='ja.wikipedia.org'&&u.searchParams.has('rvprop'))return Response.json({query:{pages:[{pageid:100,ns:0,title:'津市',pageprops:{wikibase_item:cityId},revisions:[{slots:{main:{content:text}}}]}]},warnings});
  if(u.hostname==='ja.wikipedia.org'){
   const requested=u.searchParams.get('titles').split('|');assert.ok(requested.length<=12);assert.ok(u.searchParams.get('prop').split('|').includes('pageviews'));assert.equal(u.searchParams.get('pvipdays'),'30');
   return Response.json({query:{pages:requested.map(title=>{const page=landmark(title,pageNames.indexOf(title)+1);editPage(page);return page;})},warnings});
  }
  if(u.searchParams.get('list')==='categorymembers'){const id=Number(u.searchParams.get('cmtitle').match(/Landmark (\d+)/)?.[1]),members=[{ns:6,pageid:1000+id,title:'File:Landmark '+id+'.jpg'}];editCategory(members);return Response.json({query:{categorymembers:members}});}
  assert.equal(u.searchParams.get('iiurlwidth'),'1280');const id=Number(u.searchParams.get('titles').match(/Landmark (\d+)\.jpg/)?.[1]);const info=imageInfo(id);if(fallbacks)info.imageinfo[0].extmetadata.ImageDescription.value='Landmark '+id+' exterior';editImage(info);return Response.json({query:{pages:[info]},warnings});
 }};
}
function sqliteD1(t) {
 const conn=new DatabaseSync(':memory:');t.after(()=>conn.close());
 const prepared=(sql,args=[])=>({bind(...bindings){return prepared(sql,bindings);},execute(){const r=conn.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async run(){return this.execute();},async all(){return {results:conn.prepare(sql).all(...args).map(row=>({...row}))};},async first(){const row=conn.prepare(sql).get(...args);return row?{...row}:null;}});
 return {prepare:sql=>prepared(sql),async batch(rows){conn.exec('BEGIN');try{const result=rows.map(row=>row.execute());conn.exec('COMMIT');return result;}catch(error){conn.exec('ROLLBACK');throw error;}}};
}
async function setup(t) {
 const db=sqliteD1(t);await ensureDatabase(db);
 for(const area of getPublishedAreas(now))await createStore(db).upsert('city_photos',area.slug,{schemaVersion:1,selectionVersion:version,citySlug:area.slug,status:'unavailable',photos:[],retryAt:'2027-01-01T00:00:00Z'});
 return db;
}
async function scheduled(db,target=slug,status='scheduled',reviewed=1) {
 await db.prepare('INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,reviewed_version,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('city-'+target,'/service/ltori/area/'+target+'/','city',status,1,JSON.stringify({type:'city',slug:target}),'2026-09-24T00:17:00Z',reviewed,now.toISOString()).run();
}

test('tourism headings yield named places, not generic city, transport, festivals or people links',()=>{
 const found=extractLandmarkCandidates(wikitext);assert.deepEqual(found.map(row=>row.title),names);
 const extra='== 観光 ==\n* [[国宝]]：[[津城]]\n* [[日本の名所一覧]]\n=== 歴史的建造物 ===\n* [[旧館]]\n== 歴史 ==\n* [[人物]]';
 assert.deepEqual(extractLandmarkCandidates(extra).map(row=>row.title),['津城','旧館']);
 assert.deepEqual(extractLandmarkCandidates('一般記事 [[津城]]'),[]);assert.deepEqual(extractLandmarkCandidates('x'.repeat(500001)),[]);
});
test('combined tourism/festival parent headings keep named sights but skip festival-only children',()=>{
 const text='== 名所・旧跡・観光スポット・祭事・催事 ==\n* [[盛美園]]\n* [[平川ねぷた]]祭り（[[8月2日]]）\n=== 祭事・催事 ===\n* [[三沢まつり]]\n=== 観光スポット・名所・旧跡 ===\n* [[三沢市寺山修司記念館]]\n* [[青森県立三沢航空科学館]]';
 assert.deepEqual(extractLandmarkCandidates(text).map(row=>row.title),['盛美園','三沢市寺山修司記念館','青森県立三沢航空科学館']);
});
test('prefecture and exact city must match, never 津市 as a substring of 大津市',()=>{
 assert.equal(landmarkMatchesCity('三重県津市白山町にある城。',city),true);assert.equal(landmarkMatchesCity('三重県の津市にある城。',city),true);
 for(const lead of ['滋賀県大津市にある城。三重県からも訪れる。','三重県松阪市にある寺院。','津市の神社。','三重県の旧地名。大津市にある城。'])assert.equal(landmarkMatchesCity(lead,city),false,lead);
});
test('municipality match is the opening location, not neighbouring-city direction or a later comparison',async()=>{
 const furano={locality:'富良野市',prefectureName:'北海道'};
 for(const lead of [
  '北海道空知郡上富良野町にある公園である。富良野市の北側に位置する。',
  '北海道上富良野町にある公園である。北海道富良野市に隣接する。',
  '北海道富良野市の北側にある公園である。',
  '北海道富良野市から北へ30kmに位置する公園である。',
  '北海道富良野市に隣接する公園である。',
  '公園は北海道富良野市の北約20kmにある公園である。',
  '公園は北海道富良野市の北西およそ二十キロに位置する公園である。',
  '公園は北海道富良野市に近い上富良野町にある公園である。',
  '公園は北海道富良野市と接している上富良野町にある公園である。',
  '公園は北海道富良野市に接する上富良野町にある公園である。',
  '北海道富良野市の観光施設として紹介されるが、北海道上富良野町にある公園。',
 ])assert.equal(landmarkMatchesCity(lead,furano),false,lead);
 assert.equal(landmarkMatchesCity('公園は、日本の自然公園である。北海道富良野市に位置する。',furano),true);
 assert.equal(landmarkMatchesCity('公園は北海道富良野市の市街地西端に位置する。',furano),true);
 assert.equal(landmarkMatchesCity('神社は北海道富良野市北3条西1丁目6番地にある。',furano),true);
 assert.equal(landmarkMatchesCity('水族館は北海道富良野市に本拠地を置く施設。',furano),true);
 assert.equal(landmarkMatchesCity('湖全体が北海道富良野市に属する。',furano),true);
 assert.equal(landmarkMatchesCity('湖全体が北海道富良野市に属し、自然公園に指定されている。',furano),true);
 assert.equal(landmarkMatchesCity('神社は北海道富良野市北三条西一丁目にある。',furano),true);
 assert.equal(landmarkMatchesCity('神社は北海道富良野市北20番地にある。',furano),true);
 const outside=['神社は三重県松阪市にある寺院である。三重県津市の北側に位置する。','公園は三重県松阪市にある公園である。津市に隣接している。','名所は三重県津市の北側にある歴史的建造物である。'];
 const p=provider({pageNames:names.slice(0,3),text:'== 観光 ==\n'+names.slice(0,3).map(title=>'* [['+title+']]').join('\n'),editPage:page=>{page.extract=outside[page.pageid-1];}});
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.status,'unavailable');assert.equal(record.requests.detailCalls,0);assert.equal(record.requests.landmarkCalls,0);assert.equal(record.requests.candidateCalls,1);
});
test('same-sentence nearby-city and outside-distance descriptions cannot produce a photo set',async()=>{
 const leads=['神社は三重県津市に近い松阪市にある寺院である。','公園は三重県津市と接している松阪市にある公園である。','名所は三重県津市の北約20kmにある歴史的建造物である。'];
 const p=provider({pageNames:names.slice(0,3),text:'== 観光 ==\n'+names.slice(0,3).map(title=>'* [['+title+']]').join('\n'),editPage:page=>{page.extract=leads[page.pageid-1];}});
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.reason,'insufficient_landmark_photos');assert.equal(record.requests.candidateCalls,1);assert.equal(record.requests.detailCalls,0);assert.equal(record.requests.landmarkCalls,0);
});
test('canals, capes, wetlands, tourism farms and wineries require a city-local opening definition',async()=>{
 for(const kind of ['運河','岬','湿原','観光農園','ワイナリー']) {
  const p=provider({editPage:page=>{page.extract=page.title+'は三重県津市にある'+kind+'である。';}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'ready',kind);
 }
});
test('clearly closed visitor facilities are excluded while former banks and castle heritage remain',async()=>{
 for(const lead of ['水族館は三重県津市にあった水族館である。2021年に閉館した。','施設は三重県津市にある遊園地である。2020年に閉園した。','施設は三重県津市にある観光施設である。2021年に営業を終了した。','施設は三重県津市にある水族館である。2021年まで営業していた。']) {
  const p=provider({editPage:page=>{page.extract=lead;}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'unavailable');assert.equal(p.calls.length,3);
 }
 for(const lead of ['旧銀行は三重県津市にある歴史的建造物である。以前は銀行であった。','城は三重県津市にある城跡である。藩主の居城であった。'])assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...provider({editPage:page=>{page.extract=lead;}})})).status,'ready');
});
test('free APIs return four distinct named high-resolution landmarks with original titles and provenance',async()=>{
 const p=provider(),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});
 assert.equal(record.status,'ready');assert.equal(record.selectionVersion,version);assert.equal(record.photos.length,4);assert.equal(p.calls.length,7);
 assert.deepEqual(record.photos.map(photo=>photo.caption),names);assert.equal(record.photos[0].title,'Original photograph 1');assert.equal(record.photos[0].alt,'三重県津市の観光名所・津城');assert.equal(record.photos[0].width,1280);assert.equal(record.photos[0].author,'City & Photographer');assert.doesNotMatch(record.photos[0].url,/\?/);
 assert.equal(record.sourceEvidence[0].cityWikidataId,'Q203027');assert.equal(record.sourceEvidence[0].landmark,'津城');assert.equal(record.sourceEvidence[0].originalWidth,3200);assert.equal(record.sourceEvidence[0].originalHeight,2133);assert.match(record.sourceEvidence[0].cityArticleUrl,/ja\.wikipedia\.org/);
 assert.deepEqual(record.requests,{wikidataCalls:1,cityCalls:1,candidateCalls:1,landmarkCalls:0,categoryCalls:0,detailCalls:4});
});
test('municipality identity, verified Wikidata city article and tourism section are required',async()=>{
 let calls=0;assert.equal((await collectCityPhotos('mie',{now,sourceRegistry,fetchImpl:async()=>{calls++;}})).reason,'city_identity_unconfirmed');assert.equal(calls,0);
 assert.equal((await collectCityPhotos(slug,{now,sourceRegistry:{schemaVersion:1,cities:{}},fetchImpl:async()=>{calls++;}})).reason,'city_identity_unconfirmed');assert.equal(calls,0);
 for(const options of [{cityId:'Q999'},{entityId:'Q999'}]){const p=provider(options);assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).reason,'city_identity_unconfirmed');assert.ok(p.calls.length<=2);}
 const p=provider({text:'== 交通 ==\n* [[津駅]]'});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).reason,'no_named_landmarks');assert.equal(p.calls.length,2);
});
test('wrong city, people, companies, generic lists and disambiguation never reach Commons',async()=>{
 for(const editPage of [
  page=>{page.extract='この城は、三重県大津市にある歴史的建造物。';},
  page=>{page.extract='三重県津市の出身の政治家で、城の研究者。';},
  page=>{page.extract='三重県津市にある寺院を管理する株式会社。';},
  page=>{page.extract='三重県津市の観光施設の一覧。';},
  page=>{page.pageprops.disambiguation='';},
  page=>{page.ns=1;},page=>{page.original.source='https://attacker.test/photo.jpg';},
 ]){const p=provider({editPage});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).reason,'insufficient_landmark_photos');assert.ok(p.calls.every(call=>new URL(call.url).hostname!=='commons.wikimedia.org'));}
});
test('district, settlement and generic area definitions are rejected without rejecting landmark addresses',async()=>{
 for(const definition of ['小栗山は、三重県津市の大字である。','村は、三重県津市にある山間の集落。','名所は、三重県津市の神社周辺の地区である。','城は、三重県津市の地名。','山町は、三重県津市にある山あいの町である。']){
  const p=provider({editPage:page=>{page.extract=definition;}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'unavailable');assert.equal(p.calls.length,3);
 }
 const p=provider({editPage:page=>{page.extract=page.title+'は、三重県津市の小栗山地区にある神社である。';}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'ready');
});
test('sports, conference and current administrative facilities are not tourist landmarks',async()=>{
 for(const type of ['陸上競技場','グラウンド','体育館','スポーツセンター','会議場','行政施設','市役所']){
  const p=provider({editPage:page=>{page.extract=page.title+'は、三重県津市の公園内にある'+type+'である。';}});const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.status,'unavailable',type);assert.equal(p.calls.length,3);
 }
});
test('scenic landmarks precede bare ruins; observed pageviews sort within type and missing remains unknown',async()=>{
 const pageNames=['古代遺跡','小公園','著名公園','知られた庭園','不明の寺院'],text='== 観光 ==\n'+pageNames.map(name=>'* [['+name+']]').join('\n');
 const p=provider({pageNames,text,editPage:page=>{
  page.extract=page.title+'は、三重県津市にある'+(page.pageid===1?'遺跡':page.pageid===5?'寺院':'公園')+'である。';
  if(page.pageid<5)page.pageviews={'2026-09-01':page.pageid===1?99999:page.pageid===2?10:page.pageid===3?100:50,'2026-09-02':null};
 }});
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.deepEqual(record.photos.map(row=>row.caption),['著名公園','知られた庭園','不明の寺院','小公園']);assert.deepEqual(record.sourceEvidence[0].interest,{views:100,observedDays:1});assert.equal(record.sourceEvidence[2].interest,null);
});
test('small or portrait originals are rejected before details, and Commons must corroborate dimensions and exact image',async()=>{
 for(const editPage of [page=>{page.original.width=1599;},page=>{page.original.height=899;},page=>{page.original.width=2000;page.original.height=3000;}]){const p=provider({editPage});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'unavailable');assert.equal(p.calls.length,4);}
 for(const editImage of [page=>{page.imageinfo[0].width=1599;},page=>{page.imageinfo[0].height=899;},page=>{page.imageinfo[0].thumbwidth=960;},page=>{page.imageinfo[0].url=original(999);},page=>{page.title='File:Unrelated.jpg';}])assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...provider({editImage})})).reason,'insufficient_landmark_photos');
});
test('small or missing representative image uses the exact landmark Qid/P373 category with name and description evidence',async()=>{
 for(const editPage of [page=>{page.original.width=800;},page=>{delete page.original;delete page.pageimage;}]){
  const p=provider({fallbacks:true,editPage}),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.status,'ready');assert.deepEqual(record.photos.map(photo=>photo.caption),names);assert.equal(record.requests.landmarkCalls,1);assert.equal(record.requests.categoryCalls,4);assert.equal(record.requests.detailCalls,4);assert.equal(p.calls.length,12);assert.equal(record.sourceEvidence[0].commonsCategory,'Landmark 1');assert.equal(record.sourceEvidence[0].imageSelection,'landmark_category');
  const lookup=new URL(p.calls.find(call=>new URL(call.url).searchParams.get('props')?.includes('claims')).url);assert.equal(lookup.searchParams.get('ids'),'Q90001|Q90002|Q90003|Q90004');
 }
});
test('fallback rejects wrong landmark identity, ambiguous categories, unrelated names, other places and forbidden photos',async()=>{
 for(const options of [
  {editEntity:item=>{item.id='Q999';}},
  {editEntity:item=>{item.sitelinks.jawiki.title='別の名所';}},
  {editEntity:item=>{item.claims.P373.push({rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'Another category'}}});}},
  {editCategory:members=>{members[0].title='File:Unrelated place.jpg';}},
  {editCategory:members=>{members[0].title='File:Landmark 1 model.jpg';}},
  {editImage:file=>{file.imageinfo[0].extmetadata.ImageDescription.value='A different castle in another city';}},
  {editImage:file=>{file.imageinfo[0].extmetadata.ImageDescription.value='Landmark 1 LEGOLAND miniature';}},
  {editImage:file=>{file.imageinfo[0].extmetadata.ImageDescription.value='A city view from Landmark 1';}},
  {editImage:file=>{file.pageid=888;}},
  {editImage:file=>{file.imageinfo[0].width=1200;}},
  {editImage:file=>{file.imageinfo[0].extmetadata.LicenseShortName.value='Copyright';}},
 ]){const p=provider({fallbacks:true,editPage:page=>{page.original.width=800;},...options}),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.status,'unavailable');assert.ok(p.calls.length<=PHOTO_LIMITS.apiCalls);}
 const p=provider({fallbacks:true,editPage:page=>{page.original.width=800;page.extract=page.title+'は三重県松阪市の公園である。';}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'unavailable');assert.equal(p.calls.length,3);
});
test('fallback and primary details share the total request cap without losing a valid partial set',async()=>{
 const pageNames=Array.from({length:60},(_,i)=>'名所'+(i+1)),text='== 観光 ==\n'+pageNames.map(name=>'* [['+name+']]').join('\n');
 const p=provider({fallbacks:true,pageNames,text,editPage:page=>{page.original.width=800;},editImage:file=>{if(file.pageid===1001)file.imageinfo[0].extmetadata.LicenseShortName.value='Copyright';}}),record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.ok(p.calls.length<=16);assert.ok(record.requests.detailCalls<=8);assert.equal(record.status,'ready');assert.equal(record.photos.length,3);
});
test('license, attribution, URLs and unwanted image subjects fail closed; historic castle exteriors remain eligible',async()=>{
 for(const editImage of [
  page=>{page.imageinfo[0].extmetadata.LicenseShortName.value='CC BY-NC 4.0';},
  page=>{page.imageinfo[0].extmetadata.LicenseUrl.value='https://example.com/';},
  page=>{page.imageinfo[0].thumburl='https://attacker.test/a.jpg';},
  page=>{page.imageinfo[0].descriptionurl='https://commons.wikimedia.org.evil.test/wiki/File:a.jpg';},
  page=>{page.imageinfo[0].extmetadata.Artist.value='x'.repeat(501);},
  page=>{page.imageinfo[0].extmetadata.Copyrighted.value='Unknown';},
  page=>{page.imageinfo[0].extmetadata.ImageDescription.value='Interior of a historic castle';},
  page=>{page.imageinfo[0].extmetadata.ImageDescription.value='Historic castle signboard';},
  page=>{page.imageinfo[0].extmetadata.ImageDescription.value='LEGOLAND model of the castle';},
 ])assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...provider({editImage})})).reason,'insufficient_landmark_photos');
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...provider({editImage:page=>{page.imageinfo[0].extmetadata.ImageDescription.value='Historic castle exterior';}})});assert.equal(record.status,'ready');
});
test('aerial imagery and shrine souvenirs are excluded from primary and fallback photos',async()=>{
 for(const description of ['Aerial photograph of Landmark 1','Airphoto of Landmark 1','Orthophoto of Landmark 1','Landmark 1 航空写真','Landmark 1 空中写真 国土地理院','Landmark 1 amulet','Landmark 1 charm','Landmark 1 souvenir','Landmark 1 お守り','Landmark 1 御守','Landmark 1 破魔矢','Landmark 1 絵馬','Landmark 1 御朱印','Landmark 1 おみくじ']) {
  for(const fallback of [false,true]){const p=provider({fallbacks:fallback,editPage:page=>{if(fallback)page.original.width=800;},editImage:file=>{file.imageinfo[0].extmetadata.ImageDescription.value=description;}});assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...p})).status,'unavailable',description);}
 }
});
test('reviewer-excluded File ids are never fetched or selected, and other landmarks still complete a set',async()=>{
 const registry={schemaVersion:1,cities:{[slug]:{...sourceRegistry.cities[slug],excludedPhotoIds:['File:Landmark_1.jpg']}}};
 for(const fallback of [false,true]){
  const p=provider({fallbacks:fallback,editPage:page=>{if(fallback)page.original.width=800;}}),record=await collectCityPhotos(slug,{now,sourceRegistry:registry,...p});assert.equal(record.status,'ready');assert.deepEqual(record.photos.map(photo=>photo.caption),names.slice(1));assert.ok(p.calls.every(call=>new URL(call.url).searchParams.get('titles')!=='File:Landmark 1.jpg'));
 }
});
test('required attribution and explicit public-domain declaration are retained',async()=>{
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...provider({editImage:page=>Object.assign(page.imageinfo[0].extmetadata,{Attribution:{value:'<b>Required credit</b> &amp; author'},Copyrighted:{value:'False'},LicenseShortName:{value:'Public domain'},LicenseUrl:{value:''}})})});
 assert.equal(record.status,'ready');assert.equal(record.photos[0].author,'Required credit & author');assert.equal(record.photos[0].license,'PD');assert.equal(record.photos[0].licenseUrl,'https://creativecommons.org/publicdomain/mark/1.0/');
});
test('same place and same image are never repeated to reach the minimum of three',async()=>{
 for(const editPage of [page=>{page.pageprops.wikibase_item='Q99999';},page=>{page.pageimage='Landmark_1.jpg';page.original.source=original(1);}]){const record=await collectCityPhotos(slug,{now,sourceRegistry,...provider({editPage})});assert.equal(record.reason,'insufficient_landmark_photos');assert.equal(record.photos.length,0);}
});
test('redirects, oversize, API errors and thrown messages are bounded and sanitized, warnings are accepted',async()=>{
 for(const fetchImpl of [async()=>new Response('SECRET',{status:302,headers:{Location:'https://attacker.test/'}}),async()=>new Response('x'.repeat(PHOTO_LIMITS.responseBytes+1)),async()=>Response.json({error:{info:'PRIVATE API'}}),async()=>{throw Error('PRIVATE TOKEN');}]){const record=await collectCityPhotos(slug,{now,sourceRegistry,fetchImpl});assert.equal(record.reason,'provider_unavailable');assert.equal(record.requests.wikidataCalls,1);assert.doesNotMatch(JSON.stringify(record),/PRIVATE|SECRET|attacker/);}
 assert.equal((await collectCityPhotos(slug,{now,sourceRegistry,...provider()})).status,'ready');
});
test('one city is bounded to 48 landmark pages, four batches, eight file checks and sixteen API requests',async()=>{
 const pageNames=Array.from({length:60},(_,index)=>'名所'+(index+1)),text='== 名所 ==\n'+pageNames.map(name=>'* [['+name+']]').join('\n');
 const p=provider({pageNames,text,editImage:page=>{page.imageinfo[0].extmetadata.LicenseShortName.value='Unknown';}});
 const record=await collectCityPhotos(slug,{now,sourceRegistry,...p});assert.equal(record.requests.candidateCalls,4);assert.equal(record.requests.detailCalls,8);assert.equal(p.calls.length,14);
 const titles=p.calls.filter(call=>new URL(call.url).searchParams.has('exintro')).flatMap(call=>new URL(call.url).searchParams.get('titles').split('|'));assert.equal(titles.length,48);
});
test('one step saves one reserved city with current selection version and leaves publication documents untouched',async t=>{
 const db=await setup(t);await scheduled(db);const before=await db.prepare('SELECT * FROM seo_documents').all(),p=provider();
 assert.deepEqual(await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p}),{done:false,outcome:'ready',photoCount:4});assert.equal((await readCityPhotos(db,slug)).photos.length,4);assert.equal((await createStore(db).get('city_photos',slug)).sourceEvidence.length,4);assert.deepEqual(await db.prepare('SELECT * FROM seo_documents').all(),before);
 assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p})).outcome,'cached');assert.equal(p.calls.length,7);
});
test('old ready and old unavailable caches are hidden and refreshed once, regardless of old retry date',async t=>{
 for(const status of ['ready','unavailable']){
  const db=await setup(t);await scheduled(db);const old=await collectCityPhotos(slug,{now,sourceRegistry,...provider()});delete old.selectionVersion;Object.assign(old,{status,retryAt:'2027-01-01T00:00:00Z'});
  await createStore(db).upsert('city_photos',slug,old);assert.equal(await readCityPhotos(db,slug),null);
  const p=provider();assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p})).outcome,'ready');assert.equal((await createStore(db).get('city_photos',slug)).selectionVersion,version);assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...p})).outcome,'cached');assert.equal(p.calls.length,7);
 }
});
test('only published or approved reserved city paths are eligible, not paused/draft/unreviewed articles',async t=>{
 const db=await setup(t);await scheduled(db,slug,'draft');await scheduled(db,'mie/ise','paused');await scheduled(db,'mie/yokkaichi','scheduled',null);
 await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('article','/service/ltori/media/example/',JSON.stringify({type:'article'}),1,now.toISOString()).run();
 let calls=0;assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl:async()=>{calls++;}})).outcome,'cached');assert.equal(calls,0);
 await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('live','/service/ltori/area/'+slug+'/',JSON.stringify({type:'city'}),1,now.toISOString()).run();assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,...provider()})).outcome,'ready');
});
test('current-version failure retries after one day for network issues or seven days for insufficient landmarks',async t=>{
 for(const network of [true,false]){
  const db=await setup(t);await scheduled(db);const p=provider({text:'== 交通 ==\n* [[津駅]]'});let calls=0;const fetchImpl=async(...args)=>{calls++;if(network)throw Error('PRIVATE');return p.fetchImpl(...args);};
  const first=await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl}),saved=await createStore(db).get('city_photos',slug);assert.equal(first.done,network);assert.equal(saved.selectionVersion,version);assert.equal(saved.retryAt,new Date(now.getTime()+(network?1:7)*86400000).toISOString());const after=calls;
  assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl})).outcome,'cached');assert.equal(calls,after);await runCityPhotosStep({SEO_DB:db},{now:new Date(Date.parse(saved.retryAt)+1),sourceRegistry,fetchImpl});assert.equal(calls,after*2);
 }
});
test('pause during retrieval and competing cache writes win over an in-flight result',async t=>{
 for(const race of ['pause','cache']){const db=await setup(t);await scheduled(db);const p=provider();let changed=false;const fetchImpl=async(...args)=>{if(!changed){changed=true;if(race==='pause')await db.prepare("UPDATE seo_documents SET status='paused' WHERE type='city'").run();else await createStore(db).upsert('city_photos',slug,{status:'unavailable',selectionVersion:version,retryAt:'2027-01-01T00:00:00Z',photos:[]});}return p.fetchImpl(...args);};
 assert.equal((await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl})).outcome,'state_changed');assert.equal((await createStore(db).get('city_photos',slug))?.status,race==='pause'?undefined:'unavailable');}
});
test('cache reading is one indexed lookup, uses only approved seeds and never fetches a provider',async()=>{
 const queries=[],db={prepare(sql){queries.push(sql);return {bind(){return {async first(){throw Error('cache fault');}};}};}};
 const seed=getSeedCityPhotos('mie/nabari');assert.deepEqual(await readCityPhotos(db,'mie/nabari'),seed?.selectionVersion===version?seed:null);assert.equal(queries.length,1);assert.match(queries[0],/namespace='city_photos' AND key=\?/);
 assert.equal(await readCityPhotos(db,'mie'),null);assert.equal(queries.length,1);
});
test('photo job locks remain independent and do not change publication/note policy',async t=>{
 const db=await setup(t),store=createStore(db);await store.upsert('publication','settings',{paused:false,custom:'keep'});const publication=await acquireJob(db,'publish',now),photos=await acquireJob(db,'photos',now);
 assert.equal((await runJob({SEO_DB:db},'photos',{now})).status,'running');await releaseJob(db,'photos',photos);assert.equal((await runJob({SEO_DB:db},'photos',{now})).result.outcome,'cached');assert.ok(await store.get('locks','publish'));assert.equal(await store.get('locks','photos'),null);assert.deepEqual(await store.get('publication','settings'),{paused:false,custom:'keep'});await releaseJob(db,'publish',publication);
});
test('photo providers contain no paid API, credentials or arbitrary endpoint dependency',async()=>{
 for(const name of ['seo-city-photos','seo-landmark-photos']){const source=await readFile(new URL('../worker/'+name+'.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/anthropic|openai|AI_GATEWAY|REGIONAL_EDITORIAL|Authorization|api[_-]key|kiji_/i);}
});

test('provider outages are classified by fixed stage and kind without response text',async()=>{
 const cases=[
  [async()=>new Response('SECRET',{status:302,headers:{Location:'https://attacker.test/'}}),{stage:'wikidata_city',kind:'redirect'}],
  [async()=>new Response('SECRET',{status:503}),{stage:'wikidata_city',kind:'http',status:503}],
  [async()=>new Response('x'.repeat(PHOTO_LIMITS.responseBytes+1)),{stage:'wikidata_city',kind:'too_large'}],
  [async()=>new Response('<html>SECRET</html>'),{stage:'wikidata_city',kind:'invalid_json'}],
  [async()=>Response.json({error:{code:'maxlag',info:'PRIVATE API'}}),{stage:'wikidata_city',kind:'api_error',code:'maxlag'}],
  [async()=>Response.json({error:{code:'<script>',info:'PRIVATE API'}}),{stage:'wikidata_city',kind:'api_error'}],
  [async()=>{throw Error('PRIVATE TOKEN');},{stage:'wikidata_city',kind:'network'}],
 ];
 for(const [fetchImpl,failure] of cases){const record=await collectCityPhotos(slug,{now,sourceRegistry,fetchImpl});assert.equal(record.reason,'provider_unavailable');assert.deepEqual(record.failure,failure);assert.doesNotMatch(JSON.stringify(record),/PRIVATE|SECRET|attacker|script/);}
 const p=provider();let wiki=0;const later=await collectCityPhotos(slug,{now,sourceRegistry,fetchImpl:async(url,options)=>{if(new URL(url).hostname==='ja.wikipedia.org'&&++wiki===2)return new Response('busy',{status:429});return p.fetchImpl(url,options);}});
 assert.deepEqual(later.failure,{stage:'wikipedia_landmarks',kind:'http',status:429});
});

test('a provider outage saves its classification and never hides already ready cities',async t=>{
 const db=await setup(t),store=createStore(db),readySlug='mie/ise';await scheduled(db);await scheduled(db,readySlug);
 const ready=await collectCityPhotos(slug,{now,sourceRegistry,...provider()});await store.upsert('city_photos',readySlug,{...ready,citySlug:readySlug,photos:ready.photos});
 const before=await store.get('city_photos',readySlug);
 const result=await runCityPhotosStep({SEO_DB:db},{now,sourceRegistry,fetchImpl:async()=>{throw Error('PRIVATE');}});
 assert.deepEqual(result,{done:true,outcome:'provider_unavailable',photoCount:0,failure:{stage:'wikidata_city',kind:'network'}});
 assert.deepEqual((await store.get('city_photos',slug)).failure,{stage:'wikidata_city',kind:'network'});
 assert.deepEqual(await store.get('city_photos',readySlug),before);
});
