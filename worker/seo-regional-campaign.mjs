import {cityAreas,prefectureAreas,areaPath} from '../src/lib/ltori-seo.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';

export const REGIONAL_CAMPAIGN_NAMESPACE='regional_campaign';
export const REGIONAL_CAMPAIGN_KEY='config';
const dayMs=86400000;
const japanDay=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(now);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export const shiftCampaignDay=(day,offset)=>new Date(Date.parse(`${day}T00:00:00Z`)+offset*dayMs).toISOString().slice(0,10);
export class CampaignError extends Error {constructor(status,message){super(message);this.status=status;}}

// Prefecture JIS codes, not English slugs or content timestamps, define the
// fixed Hokkaido -> Okinawa calendar. Each master city appears exactly once.
export const REGIONAL_PREFECTURES=Object.freeze(prefectureAreas.map(prefecture=>{
  const cities=cityAreas.filter(city=>city.prefectureSlug===prefecture.slug).sort((a,b)=>a.code.localeCompare(b.code)).map(city=>Object.freeze({code:city.code,slug:city.slug,name:city.locality,fullName:city.fullName,id:`city:${city.slug}`,path:areaPath(city)}));
  return Object.freeze({code:cities[0].code.slice(0,2),slug:prefecture.slug,name:prefecture.name,cities:Object.freeze(cities)});
}).sort((a,b)=>a.code.localeCompare(b.code)));
const cityBySlug=new Map(REGIONAL_PREFECTURES.flatMap((prefecture,index)=>prefecture.cities.map(city=>[city.slug,{...city,prefectureIndex:index}])));

export function normalizeRegionalCampaignConfig(input={enabled:false,startDate:null}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.enabled!=='boolean')throw new CampaignError(400,'全国市の公開設定を確認してください。');
  const startDate=input.startDate??null;
  if(startDate!==null&&!validDate(startDate))throw new CampaignError(400,'開始日は YYYY-MM-DD 形式の実在する日付で指定してください。');
  if(input.enabled&&!startDate)throw new CampaignError(400,'公開を開始するには開始日が必要です。');
  return {enabled:input.enabled,startDate};
}
export async function readRegionalCampaignSnapshot(db) {
  const row=await db.prepare("SELECT value,version,updated_at FROM seo_kv WHERE namespace='regional_campaign' AND key='config'").first();
  if(!row)return {raw:null,revision:0,config:{enabled:false,startDate:null,revision:0,updatedAt:null,valid:true}};
  try {
    const normalized=normalizeRegionalCampaignConfig(JSON.parse(row.value));
    return {raw:row.value,revision:row.version,config:{...normalized,revision:row.version,updatedAt:row.updated_at,valid:true}};
  } catch {
    // Corrupt configuration must stop regional publication without stopping
    // the independently configured note publication or discarding saved data.
    return {raw:row.value,revision:row.version,config:{enabled:false,startDate:null,revision:row.version,updatedAt:row.updated_at,valid:false,error:'全国市の公開設定を読み取れません。設定を確認してください。'}};
  }
}
export async function readRegionalCampaignConfig(db) {return (await readRegionalCampaignSnapshot(db)).config;}
export async function saveRegionalCampaignConfig(db,input,{expectedRevision,now=new Date()}={}) {
  const config=normalizeRegionalCampaignConfig(input);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new CampaignError(400,'設定の保存版を確認してください。');
  const value=JSON.stringify(config),updatedAt=now.toISOString();
  const statement=expectedRevision===0
    ?db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('regional_campaign','config',?,1,?) ON CONFLICT DO NOTHING").bind(value,updatedAt)
    :db.prepare("UPDATE seo_kv SET value=?,version=version+1,updated_at=? WHERE namespace='regional_campaign' AND key='config' AND version=?").bind(value,updatedAt,expectedRevision);
  const result=await statement.run();
  if(!result.meta.changes)throw new CampaignError(409,'全国市の公開設定が別の画面で更新されています。再読み込みしてください。');
  return {...config,revision:expectedRevision+1,updatedAt,valid:true};
}
export function regionalCampaignDay(config,now=new Date()) {
  const day=japanDay(now),startDate=validDate(config?.startDate)?config.startDate:null;
  const offset=startDate?Math.floor((Date.parse(`${day}T00:00:00Z`)-Date.parse(`${startDate}T00:00:00Z`))/dayMs):null;
  const dayNumber=offset!==null&&offset>=0&&offset<47?offset+1:null;
  const status=!config?.enabled||!startDate?'disabled':offset<0?'upcoming':offset>46?'completed':'active';
  const prefecture=status==='active'?REGIONAL_PREFECTURES[offset]:null;
  const publishAt=prefecture?`${day}T09:17:00+09:00`:null;
  return {status,day,startDate,endDate:startDate?shiftCampaignDay(startDate,46):null,dayNumber:status==='active'?dayNumber:null,
    prefecture,publishAt,readyToPublish:!!publishAt&&now.getTime()>=Date.parse(publishAt)};
}
export function campaignDateForCity(config,slug) {
  const city=cityBySlug.get(slug);
  return city&&validDate(config?.startDate)?shiftCampaignDay(config.startDate,city.prefectureIndex):null;
}
export function staticPublishedCityPaths(now=new Date()) {
  return getPublishedAreas(now).filter(area=>cityBySlug.has(area.slug)).map(areaPath);
}
export async function readRegionalCampaignOverview(db,now=new Date()) {
  const [config,documents,published]=await Promise.all([
    readRegionalCampaignConfig(db),
    db.prepare("SELECT id,path,status,version,reviewed_version,scheduled_at FROM seo_documents WHERE type='city'").all(),
    db.prepare('SELECT id,path FROM seo_published').all(),
  ]);
  const day=regionalCampaignDay(config,now),docs=new Map(documents.results.map(doc=>[doc.id,doc]));
  const live=new Set([...staticPublishedCityPaths(now),...published.results.map(doc=>doc.path)]);
  const prefectures=REGIONAL_PREFECTURES.map((prefecture,index)=>{
    const plannedOn=config.startDate?shiftCampaignDay(config.startDate,index):null;
    let liveCount=0,ready=0,dueReady=0;
    for(const city of prefecture.cities) {
      if(live.has(city.path)){liveCount++;continue;}
      const doc=docs.get(city.id);
      if(doc?.path===city.path&&doc.status==='scheduled'&&doc.reviewed_version===doc.version) {
        ready++;if(doc.scheduled_at&&Date.parse(doc.scheduled_at)<=now.getTime())dueReady++;
      }
    }
    const total=prefecture.cities.length,remaining=total-liveCount;
    return {code:prefecture.code,slug:prefecture.slug,name:prefecture.name,dayNumber:index+1,plannedOn,total,live:liveCount,ready,dueReady,missing:remaining-ready,remaining,
      overdue:!!plannedOn&&plannedOn<day.day&&remaining>0};
  });
  const totals=prefectures.reduce((sum,prefecture)=>{for(const key of ['total','live','ready','dueReady','missing','remaining'])sum[key]+=prefecture[key];return sum;},{total:0,live:0,ready:0,dueReady:0,missing:0,remaining:0});
  return {config,day:{...day,prefecture:day.prefecture?{code:day.prefecture.code,slug:day.prefecture.slug,name:day.prefecture.name}:null},totals,prefectures,
    currentDay:prefectures.find(prefecture=>prefecture.slug===day.prefecture?.slug)||null};
}
