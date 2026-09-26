import registry from '../src/data/ltori-city-photo-sources.json' with {type:'json'};
import {cityAreas} from '../src/lib/ltori-seo.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {normalizeCityPhotos,getSeedCityPhotos} from '../src/lib/ltori-city-photos.mjs';
import {activity} from './seo-store.mjs';
import {collectLandmarkPhotos,LANDMARK_SELECTION_VERSION} from './seo-landmark-photos.mjs';

const CITIES=new Map(cityAreas.map(city=>[city.slug,city]));
export {PHOTO_LIMITS} from './seo-landmark-photos.mjs';
const DAY=86400000;
const slugFromPath=path=>typeof path==='string'?path.match(/^\/service\/ltori\/area\/([a-z0-9-]+\/[a-z0-9-]+)\/$/)?.[1]:null;
const selectedSeed=slug=>{const seed=getSeedCityPhotos(slug);return seed?.selectionVersion===LANDMARK_SELECTION_VERSION?seed:null;};

/** Named tourist landmarks only: never fall back to generic city snapshots. */
export async function collectCityPhotos(slug,{now=new Date(),fetchImpl=fetch,sourceRegistry=registry}={}) {
  const city=CITIES.get(slug),source=sourceRegistry?.schemaVersion===1?sourceRegistry.cities?.[slug]:null;
  if(!city||!source||source.cityCode!==city.code||source.label!==city.locality||!/^Q[1-9][0-9]*$/.test(source.wikidataId))return {selectionVersion:LANDMARK_SELECTION_VERSION,status:'unavailable',reason:'city_identity_unconfirmed',photos:[]};
  return collectLandmarkPhotos(city,source,{now,fetchImpl});
}

/** A visitor performs one indexed cache read; network retrieval is job-only. */
export async function readCityPhotos(db,slug) {
  if(!CITIES.has(slug))return null;
  try {
    const row=await db.prepare("SELECT value FROM seo_kv WHERE namespace='city_photos' AND key=?").bind(slug).first();
    if(row){const parsed=JSON.parse(row.value);if(parsed?.selectionVersion===LANDMARK_SELECTION_VERSION)return normalizeCityPhotos(slug,parsed)||(parsed?.status==='unavailable'?null:selectedSeed(slug));}
  }catch{/* A photo cache fault must not take down the published service page. */}
  return selectedSeed(slug);
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
  const {results}=await db.prepare("SELECT key,version,json_extract(value,'$.selectionVersion') AS selection_version,json_extract(value,'$.status') AS status,json_extract(value,'$.retryAt') AS retry_at,json_extract(value,'$.schemaVersion') AS schema_version,json_extract(value,'$.citySlug') AS city_slug,json_array_length(value,'$.photos') AS photo_count FROM seo_kv WHERE namespace='city_photos'").all();
  const cache=new Map(results.map(row=>[row.key,row]));
  const slug=eligible.find(slug=>{const row=cache.get(slug);return !row||row.selection_version!==LANDMARK_SELECTION_VERSION||!(row.status==='ready'&&row.schema_version===1&&row.city_slug===slug&&row.photo_count>=3&&row.photo_count<=4)&&!(row.status==='unavailable'&&Date.parse(row.retry_at)>now.getTime());});
  if(!slug)return {done:true,outcome:'cached',photoCount:0};
  const result=selectedSeed(slug)||await collectCityPhotos(slug,{now,fetchImpl,sourceRegistry});
  // If an editor paused/removed a reservation while Commons was responding,
  // keep that unpublished city out of this collection run as well.
  if(!(await targets(db,now)).includes(slug))return {done:false,outcome:'state_changed',photoCount:0};
  const record=result.status==='ready'?result:{schemaVersion:1,selectionVersion:LANDMARK_SELECTION_VERSION,citySlug:slug,status:'unavailable',fetchedAt:now.toISOString(),retryAt:new Date(now.getTime()+(result.reason==='provider_unavailable'?1:7)*DAY).toISOString(),reason:result.reason,...(result.failure?{failure:result.failure}:{}),photos:[]};
  const saved=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('city_photos',?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,version=seo_kv.version+1,updated_at=excluded.updated_at WHERE seo_kv.version=?").bind(slug,JSON.stringify(record),now.toISOString(),cache.get(slug)?.version||0).run();
  if(!saved.meta.changes)return {done:false,outcome:'state_changed',photoCount:0};
  await activity(db,'city_photos',`${CITIES.get(slug).fullName}：${record.status==='ready'?`地域写真${record.photos.length}枚を保存しました。`:'地域写真を取得できず、日を空けて再確認します。'}`,now);
  const outage=result.reason==='provider_unavailable';
  return {done:outage,outcome:record.status==='ready'?'ready':outage?'provider_unavailable':'unavailable',photoCount:record.photos.length,...(outage&&result.failure?{failure:result.failure}:{})};
}
