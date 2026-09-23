import registry from '../src/data/ltori-city-photo-sources.json' with {type:'json'};
import {cityAreas} from '../src/lib/ltori-seo.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {normalizeCityPhoto,normalizeCityPhotos,getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';
import {activity} from './seo-store.mjs';

const CITIES=new Map(cityAreas.map(city=>[city.slug,city]));
const API='https://commons.wikimedia.org/w/api.php';
export const PHOTO_LIMITS=Object.freeze({categoryCalls:5,detailCalls:8,depth:2,responseBytes:1048576,requestMs:8000,totalMs:100000});
const DAY=86400000;
const excluded=/(?:\b(?:logo|flag|maps?|diagram|coat of arms|portrait|people|persons?|politicians?|actors?|musicians?|girls?|boys?|women|woman|men|man|children|daughter|son|family|dancing|concerts?|performances?|events?|food|meals?|receipt|posters?|documents?|paintings?|drawings?|illustrations?|vehicles?|trains?|buses|cars|aircraft|airfields?|satellite|ships|pets|animals|birds?|cats?|dogs?|insects|flowers|mushrooms|fossils|specimens|statues|sculptures|stamps|coins|postcards|screenshots|interior|indoor|night|sunset|sunrise|panorama stitching|legoland|models?|miniatures?|replicas?|historic|historical|demolished|parking|carpark|unidentified|montage)\b|地図|旗|紋章|人物|肖像|料理|領収|車両|電車|室内|館内|夜景|模型|ミニチュア|駐車場|解体|跡地|朗読|贈呈|受賞|歌唱|演奏|猫|野鳥)/i;
const scenic=/(?:\b(?:landscapes?|cityscapes?|skylines?|views?|streets?|parks?|rivers?|bridges?|castles?|temples?|shrines?|mountains?|lakes?|coasts?|beaches|gardens?|buildings?|downtown|exterior|panorama|panoramics?)\b|風景|景色|街並|公園|河川|河畔|大橋|吊橋|城跡|寺院|神社|山並|山麓|湖畔|海岸|庭園|外観|市街|展望)/i;
function scenicScore(value) {
  if(/landscapes?|cityscapes?|skylines?|街並|風景|景色|市街/i.test(value))return 100;
  if(/views?|panoram|展望/i.test(value))return 80;
  if(/parks?|rivers?|coasts?|mountains?|gardens?|公園|河川|海岸|庭園/i.test(value))return 60;
  if(scenic.test(value))return 30;
  if(/nature|geography|tourism|architecture/i.test(value))return 10;
  return 0;
}
const slugFromPath=path=>typeof path==='string'?path.match(/^\/service\/ltori\/area\/([a-z0-9-]+\/[a-z0-9-]+)\/$/)?.[1]:null;
function plain(value,max=300) {
  if(typeof value!=='string')return '';
  const result=value.replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi,entity=>{
    const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
    if(named[entity.toLowerCase()])return named[entity.toLowerCase()];
    const code=parseInt(entity.slice(entity[2]?.toLowerCase()==='x'?3:2,-1),entity[2]?.toLowerCase()==='x'?16:10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';
  }).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  return result.length<=max?result:'';
}
function cleanCommonsUrl(value,hosts,prefix) {
  if(typeof value!=='string'||value.length>2048||/[\\\s]/.test(value))return null;
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||!hosts.includes(url.hostname)||!value.startsWith(`https://${url.hostname}/`)||url.username||url.password||url.port||!decodeURIComponent(url.pathname).startsWith(prefix))return null;
    url.search='';url.hash='';return url.href;
  }catch{return null;}
}
function licenseOf(metadata) {
  const name=plain(metadata.LicenseShortName?.value,80).replace(/\s+/g,' ').toUpperCase();
  let license,licenseUrl;
  const match=name.match(/^CC BY(-SA)? (1\.0|2\.0|2\.5|3\.0|4\.0)$/);
  if(match){license=`CC BY${match[1]||''} ${match[2]}`;licenseUrl=`https://creativecommons.org/licenses/by${match[1]?'-sa':''}/${match[2]}/`;}
  else if(name==='CC0'){license='CC0';licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/';}
  else if(name==='PUBLIC DOMAIN'||name==='PD'){license='PD';licenseUrl='https://creativecommons.org/publicdomain/mark/1.0/';}
  else return null;
  const supplied=plain(metadata.LicenseUrl?.value,300).replace(/^http:/,'https:').replace(/\/$/,'');
  // Public-domain metadata occasionally omits a link. Its explicit PD tag is
  // preserved and linked to the public-domain mark; never infer a missing license.
  if(supplied&&supplied!==licenseUrl.replace(/\/$/,''))return null;
  if(!supplied&&license!=='PD')return null;
  return {license,licenseUrl};
}
function registryCity(slug,sourceRegistry) {
  const city=CITIES.get(slug),source=sourceRegistry?.schemaVersion===1?sourceRegistry.cities?.[slug]:null;
  if(!city||!source||source.cityCode!==city.code||source.label!==city.locality||!/^Q[1-9][0-9]*$/.test(source.wikidataId)
    ||typeof source.commonsCategory!=='string'||!source.commonsCategory.trim()||source.commonsCategory.length>240||/[\u0000-\u001f|#]/.test(source.commonsCategory))return null;
  return {city,source,root:`Category:${source.commonsCategory.trim()}`};
}
function localChild(title,context) {
  if(!title.startsWith('Category:')||excluded.test(title))return false;
  // Descendants must retain the city's identifying label, not merely belong to
  // a broad intermediary category (e.g. Japan or a neighbouring municipality).
  const rootLabel=context.source.commonsCategory.split(',')[0].replace(/\([^)]*\)/g,'').replace(/\b(?:city|municipality)\b/gi,'').trim();
  const rootPattern=rootLabel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return (rootLabel.length>=3&&new RegExp(`(?:^|[^a-z])${rootPattern}(?:$|[^a-z])`,'i').test(title))||title.includes(context.city.locality);
}
async function boundedJson(response) {
  if(!response.ok||Number(response.headers.get('Content-Length')||0)>PHOTO_LIMITS.responseBytes){await response.body?.cancel();throw new Error('provider_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new Error('provider_unavailable');
  const parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>PHOTO_LIMITS.responseBytes){await reader.cancel();throw new Error('provider_unavailable');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||body.error||body.warnings)throw new Error('provider_unavailable');return body;
}

/** One city, anonymous Commons requests only. No AI, arbitrary URLs or retries. */
export async function collectCityPhotos(slug,{now=new Date(),fetchImpl=fetch,sourceRegistry=registry}={}) {
  const context=registryCity(slug,sourceRegistry);
  if(!context)return {status:'unavailable',reason:'no_city_category',photos:[]};
  const deadline=Date.now()+PHOTO_LIMITS.totalMs;let calls=0,categoryCalls=0,detailCalls=0;
  async function query(parameters) {
    if(++calls>PHOTO_LIMITS.categoryCalls+PHOTO_LIMITS.detailCalls||Date.now()>=deadline)throw new Error('provider_unavailable');
    const url=new URL(API);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',...parameters}).toString();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(PHOTO_LIMITS.requestMs,deadline-Date.now()));
    // Workers support manual redirects; 3xx is rejected by boundedJson without
    // following it, keeping all requests on this one anonymous API origin.
    try{return await boundedJson(await fetchImpl(url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'LAYR-CityPhotos/1.0 (https://layr.co.jp/)'}}));}
    finally{clearTimeout(timer);}
  }
  const queue=[{title:context.root,path:[context.root],depth:0}],seen=new Set(),files=new Map();
  try {
    while(queue.length&&categoryCalls<PHOTO_LIMITS.categoryCalls) {
      const current=queue.shift();if(seen.has(current.title))continue;seen.add(current.title);categoryCalls++;
      const body=await query({list:'categorymembers',cmtitle:current.title,cmtype:'file|subcat',cmnamespace:'6|14',cmprop:'ids|title|type',cmlimit:'100'});
      if(!Array.isArray(body.query?.categorymembers))throw new Error('provider_unavailable');
      const children=[];
      for(const member of body.query.categorymembers.slice(0,100)) {
        if(!Number.isSafeInteger(member.pageid)||member.pageid<=0||typeof member.title!=='string'||member.title.length>500)continue;
        if(member.ns===6&&/^File:.+\.(?:jpe?g|png|webp)$/i.test(member.title)&&!excluded.test(member.title)&&!files.has(member.pageid))files.set(member.pageid,{id:member.pageid,title:member.title,path:current.path,score:scenicScore(member.title)*2+scenicScore(current.title)});
        if(member.ns===14&&current.depth<PHOTO_LIMITS.depth&&localChild(member.title,context)&&!seen.has(member.title))children.push({title:member.title,path:[...current.path,member.title],depth:current.depth+1});
      }
      queue.push(...children);
      queue.sort((a,b)=>scenicScore(b.title)-scenicScore(a.title)||a.depth-b.depth||a.title.localeCompare(b.title));
    }
    const photos=[],sourceEvidence=[],subjects=new Set();
    const candidates=[...files.values()].sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,PHOTO_LIMITS.detailCalls);
    for(const candidate of candidates) {
      detailCalls++;
      const body=await query({prop:'imageinfo',pageids:String(candidate.id),iiprop:'url|size|mime|extmetadata',iilimit:'1',iiurlwidth:'960',iiextmetadatalanguage:'en',iiextmetadatafilter:'Artist|Attribution|Copyrighted|LicenseShortName|LicenseUrl|ObjectName|ImageDescription'});
      const page=body.query?.pages?.find(row=>row.pageid===candidate.id&&row.ns===6&&row.title===candidate.title),info=page?.imageinfo?.[0],metadata=info?.extmetadata||{};
      if(!info||!['image/jpeg','image/png','image/webp'].includes(info.mime))continue;
      const width=info.thumbwidth,height=info.thumbheight,ratio=width/height;
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<640||height<240||ratio<1.2||ratio>3.2)continue;
      const title=plain(metadata.ObjectName?.value||candidate.title.replace(/^File:|\.[^.]+$/g,'')),description=plain(metadata.ImageDescription?.value,2000),artist=plain(metadata.Artist?.value,500),author=metadata.Attribution?.value?plain(metadata.Attribution.value,500):artist,license=licenseOf(metadata);
      const copyrighted=plain(metadata.Copyrighted?.value,20).toLowerCase();
      if(!title||!artist||!author||/^(?:unknown|anonymous|不明)$/i.test(artist)||/^(?:unknown|anonymous|不明)$/i.test(author)||!license||!['true','false'].includes(copyrighted)||(metadata.ImageDescription?.value&&!description)||excluded.test(`${title} ${description}`)||!scenic.test(`${title} ${description} ${candidate.path.join(' ')}`))continue;
      if((license.license==='PD'&&copyrighted!=='false')||(/^CC BY/.test(license.license)&&copyrighted!=='true'))continue;
      const photo=normalizeCityPhoto({id:candidate.title,title,caption:`${context.city.locality}の風景 ${photos.length+1}`,alt:`${context.city.fullName}の風景写真 ${photos.length+1}`,url:cleanCommonsUrl(info.thumburl,['upload.wikimedia.org','thumb.wikimedia.org'],'/wikipedia/commons/'),sourceUrl:cleanCommonsUrl(info.descriptionurl,['commons.wikimedia.org'],'/wiki/File:'),author,...license,width,height});
      if(!photo)continue;
      if(photos.some(existing=>existing.url===photo.url))continue;
      const subject=title.toLowerCase().replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/g,'').replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\(\d{8,}\)/g,'').replace(/\s+/g,' ').trim();
      if(subjects.has(subject))continue;subjects.add(subject);
      photos.push(photo);sourceEvidence.push({id:candidate.title,categoryPath:candidate.path,pageId:candidate.id});
      if(photos.length===4)break;
    }
    const record=normalizeCityPhotos(slug,{schemaVersion:1,citySlug:slug,status:'ready',fetchedAt:now.toISOString(),photos});
    return record?{...record,sourceEvidence,source:{wikidataId:context.source.wikidataId,commonsCategory:context.source.commonsCategory},requests:{categoryCalls,detailCalls}}
      :{status:'unavailable',reason:'insufficient_photos',photos:[],requests:{categoryCalls,detailCalls}};
  }catch{return {status:'unavailable',reason:'provider_unavailable',photos:[],requests:{categoryCalls,detailCalls}};}
}

/** A visitor performs one indexed cache read; network retrieval is job-only. */
export async function readCityPhotos(db,slug) {
  if(!CITIES.has(slug))return null;
  try {
    const row=await db.prepare("SELECT value FROM seo_kv WHERE namespace='city_photos' AND key=?").bind(slug).first();
    if(row){const parsed=JSON.parse(row.value);return normalizeCityPhotos(slug,parsed)||(parsed?.status==='unavailable'?null:getSeedCityPhotos(slug));}
  }catch{/* A photo cache fault must not take down the published service page. */}
  return getSeedCityPhotos(slug);
}
async function targets(db,now) {
  const staticCities=getPublishedAreas(now).filter(city=>CITIES.has(city.slug));
  const {results:live}=await db.prepare("SELECT path FROM seo_published WHERE json_extract(value,'$.type')='city'").all();
  const {results:scheduled}=await db.prepare("SELECT path FROM seo_documents WHERE type='city' AND status='scheduled' AND reviewed_version=version").all();
  const published=new Set([...staticCities.map(city=>city.slug),...live.map(row=>slugFromPath(row.path))]);
  return [...new Set([...published,...scheduled.map(row=>slugFromPath(row.path))])].filter(slug=>CITIES.has(slug)).sort((a,b)=>Number(published.has(b))-Number(published.has(a))||CITIES.get(a).code.localeCompare(CITIES.get(b).code));
}
export async function runCityPhotosStep(env,{now=new Date(),fetchImpl=fetch,sourceRegistry=registry}={}) {
  const db=env.SEO_DB,eligible=await targets(db,now);
  if(!eligible.length)return {done:true,outcome:'no_targets',photoCount:0};
  const {results}=await db.prepare("SELECT key,version,json_extract(value,'$.status') AS status,json_extract(value,'$.retryAt') AS retry_at,json_extract(value,'$.schemaVersion') AS schema_version,json_extract(value,'$.citySlug') AS city_slug,json_array_length(value,'$.photos') AS photo_count FROM seo_kv WHERE namespace='city_photos'").all();
  const cache=new Map(results.map(row=>[row.key,row]));
  const slug=eligible.find(slug=>{const row=cache.get(slug);return !row||!(row.status==='ready'&&row.schema_version===1&&row.city_slug===slug&&row.photo_count>=3&&row.photo_count<=4)&&!(row.status==='unavailable'&&Date.parse(row.retry_at)>now.getTime());});
  if(!slug)return {done:true,outcome:'cached',photoCount:0};
  const result=getSeedCityPhotos(slug)||await collectCityPhotos(slug,{now,fetchImpl,sourceRegistry});
  // If an editor paused/removed a reservation while Commons was responding,
  // keep that unpublished city out of this collection run as well.
  if(!(await targets(db,now)).includes(slug))return {done:false,outcome:'state_changed',photoCount:0};
  const record=result.status==='ready'?result:{schemaVersion:1,citySlug:slug,status:'unavailable',fetchedAt:now.toISOString(),retryAt:new Date(now.getTime()+(result.reason==='provider_unavailable'?1:7)*DAY).toISOString(),reason:result.reason,photos:[]};
  const saved=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('city_photos',?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,version=seo_kv.version+1,updated_at=excluded.updated_at WHERE seo_kv.version=?").bind(slug,JSON.stringify(record),now.toISOString(),cache.get(slug)?.version||0).run();
  if(!saved.meta.changes)return {done:false,outcome:'state_changed',photoCount:0};
  await activity(db,'city_photos',`${CITIES.get(slug).fullName}：${record.status==='ready'?`地域写真${record.photos.length}枚を保存しました。`:'地域写真を取得できず、日を空けて再確認します。'}`,now);
  return {done:result.reason==='provider_unavailable',outcome:record.status==='ready'?'ready':result.reason==='provider_unavailable'?'provider_unavailable':'unavailable',photoCount:record.photos.length};
}
