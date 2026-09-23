import {normalizeCityPhoto,normalizeCityPhotos} from '../src/lib/ltori-city-photos.mjs';

export const LANDMARK_SELECTION_VERSION='landmarks-v2';
export const PHOTO_LIMITS=Object.freeze({candidatePages:48,candidateBatch:12,fallbackLandmarks:8,categoryFiles:20,detailCalls:8,apiCalls:16,responseBytes:1048576,requestMs:8000,totalMs:100000,originalWidth:1600,originalHeight:900,thumbnailWidth:1280});
const APIS=Object.freeze({wikidata:'https://www.wikidata.org/w/api.php',japanese:'https://ja.wikipedia.org/w/api.php',commons:'https://commons.wikimedia.org/w/api.php'});
const positiveSection=/名所|観光|旧跡|文化財|景勝/;
const negativeSection=/祭|イベント|催事|人物|出身|交通|スポーツ|名産|特産|食文化|芸能|^(?:歴史|沿革)$/;
const genericTitle=/^(?:国宝|重要文化財|史跡|名勝|登録有形文化財|重要有形民俗文化財|天然記念物|文化財|観光|観光地|宗派|日本三大観音|浄土真宗|真宗高田派|日本さくら名所100選|続?日本100名城|重要伝統的建造物群保存地区)$/;
const disallowedImage=/(?:\b(?:logo|flag|maps?|diagram|coat of arms|portrait|people|persons?|politicians?|actors?|musicians?|girls?|boys?|women|woman|men|children|dancing|concerts?|performances?|food|meals?|receipt|posters?|documents?|paintings?|drawings?|illustrations?|vehicles?|trains?|buses|cars|aircraft|pets|animals|insects|specimens|stamps|coins|postcards|screenshots|interior|indoor|signs?|signage|signboards?|legoland|models?|miniatures?|replicas?|demolished|parking|carpark|montage|statues?|sculptures?|aerial photographs?|airphotos?|orthophotos?|amulets?|charms?|souvenirs?)\b|地図|旗|紋章|人物|肖像|料理|領収|車両|電車|室内|館内|案内板|説明板|看板|石碑|模型|ミニチュア|駐車場|解体|朗読|贈呈|受賞|演奏|航空写真|空中写真|国土地理院|お守り|御守|破魔矢|絵馬|御朱印|おみくじ)/i;
const landmarkType=/寺院|神社|教会|聖堂|城郭|日本の城|城跡|公園|庭園|橋梁|吊橋|大橋|滝|渓谷|峡谷|海岸|砂丘|湖|山|博物館|美術館|歴史的建造物|建築物|洋館|倉庫|灯台|遺跡|史跡|古墳|展望台|タワー|町並み|街並み|温泉|観光施設|動物園|水族館|植物園|旧跡|景勝地|運河|岬|湿原|観光農園|ワイナリー/;
const nonTourismFacility=/スポーツ施設|体育館|競技場|運動場|グラウンド|スポーツセンター|運動公園|野球場|球技場|競輪場|会議場|会議施設|行政施設|市役所|区役所|町役場|村役場/;
const nonPlace=/政治家|実業家|小説家|作家|俳優|女優|アイドル|歌手|声優|宗派|宗教団体|企業|株式会社|鉄道路線|鉄道駅|バス路線|国道|県道|市道|一覧|総称/;
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const wikiUrl=title=>`https://ja.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ','_'))}`;

function plain(value,max=300) {
  if(typeof value!=='string')return '';
  const result=value.replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi,entity=>{
    const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
    if(named[entity.toLowerCase()])return named[entity.toLowerCase()];
    const hex=entity[2]?.toLowerCase()==='x',code=parseInt(entity.slice(hex?3:2,-1),hex?16:10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';
  }).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  return result.length<=max?result:'';
}
function safeTitle(value,max=200) {
  return typeof value==='string'&&value.trim()&&value.length<=max&&!/[|#<>\u0000-\u001f\u007f]/.test(value)?value.trim():null;
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
  const name=plain(metadata.LicenseShortName?.value,80).toUpperCase(),match=name.match(/^CC BY(-SA)? (1\.0|2\.0|2\.5|3\.0|4\.0)$/);
  let license,licenseUrl;
  if(match){license=`CC BY${match[1]||''} ${match[2]}`;licenseUrl=`https://creativecommons.org/licenses/by${match[1]?'-sa':''}/${match[2]}/`;}
  else if(name==='CC0'){license='CC0';licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/';}
  else if(name==='PUBLIC DOMAIN'||name==='PD'){license='PD';licenseUrl='https://creativecommons.org/publicdomain/mark/1.0/';}
  else return null;
  const supplied=plain(metadata.LicenseUrl?.value,300).replace(/^http:/,'https:').replace(/\/$/,'');
  if(supplied&&supplied!==licenseUrl.replace(/\/$/,'')||!supplied&&license!=='PD')return null;
  return {license,licenseUrl};
}

/** Read article links only under tourism headings, never general city links. */
export function extractLandmarkCandidates(wikitext) {
  if(typeof wikitext!=='string'||wikitext.length>500000)return [];
  const stack=[],found=new Map();let order=0;
  for(const line of wikitext.replace(/<!--[\s\S]*?-->/g,'').split('\n')) {
    const heading=line.match(/^(={2,6})\s*(.+?)\s*\1\s*$/);
    if(heading){const level=heading[1].length;while(stack.length&&stack.at(-1).level>=level)stack.pop();stack.push({level,title:plain(heading[2],100)});continue;}
    const section=stack.findLast(item=>positiveSection.test(item.title));
    if(!section||stack.some(item=>negativeSection.test(item.title)&&!positiveSection.test(item.title)))continue;
    for(const match of line.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
      const title=safeTitle(match[1]);
      if(title&&/祭り?$|まつり$|ねぷた$/.test(title))break;
      if(!title||/[:：]/.test(title)||genericTitle.test(title)||/一覧$|百選|100選|三大|^日本の|^\d+(?:年|月|日)/.test(title))continue;
      if(!found.has(title))found.set(title,{title,section:stack.map(item=>item.title).join(' / '),score:stack.some(item=>/名所|観光|景勝/.test(item.title))?2:1,order:order++});
      break; // Each list item introduces one place; descriptive links are not candidates.
    }
    if(found.size>=160)break;
  }
  return [...found.values()].sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,PHOTO_LIMITS.candidatePages);
}

export function landmarkMatchesCity(lead,city) {
  if(typeof lead!=='string'||lead.length>12000||!city?.prefectureName||!city?.locality)return false;
  const sentences=lead.split('。').slice(0,2).map(value=>value.trim());
  const address=new RegExp(`${escapePattern(city.prefectureName)}(?:の)?${escapePattern(city.locality)}`);
  const located=/(?:に(?:ある|あった|位置|所在|立地|鎮座|存在|建て|設け|建立|本拠地を置く|属し|属する)|で運営する|を所在地)/;
  const otherLocation=/[都道府県市町村区][^、,。]{0,35}(?:に(?:ある|あった|位置|所在|立地|鎮座)|を所在地)/;
  for(let i=0;i<sentences.length;i++) {
    const sentence=sentences[i],match=address.exec(sentence);
    // A later comparison with a neighbour never overrides the first stated
    // location. A second sentence is considered only if the first has none.
    if(i===1&&otherLocation.test(sentences[0]))return false;
    if(!match)continue;
    if(otherLocation.test(sentence.slice(0,match.index)))return false;
    const tail=sentence.slice(match.index+match[0].length);
    if(/^(?:の)?(?:[東西南北]{1,2}(?:側|方)?(?:に|へ|から)|[東西南北]{1,2}側|周辺|近く|付近|外側|郊外)|^(?:から|に隣接|に近接|と隣接|との境)/.test(tail))return false;
    // Distance units distinguish an outside-city bearing from addresses such
    // as 北3条・北三条; a numeral after 北 alone is not an exclusion.
    if(/^(?:の)?[東西南北]{1,2}(?:側|方|方向)?(?:へ|に)?\s*(?:約|およそ|凡そ)?\s*[0-9０-９一二三四五六七八九十百千.,．]+\s*(?:km|㎞|キロ(?:メートル)?|m|ｍ|メートル|里)/i.test(tail))return false;
    const clause=tail.split(/[、,;；]/)[0].slice(0,80),predicate=located.exec(clause);
    if(predicate){const local=clause.slice(0,predicate.index);if(!/から|隣接|に近(?:接|い|く)|接(?:する|して|した)|近隣|近郊|付近|周辺|対岸|境界|との|として|とされ|知られ|を望む|を見渡す/.test(local)&&!local.includes(city.prefectureName))return true;}
    // A direct nominal definition also states a location, e.g. 「津市の神社」.
    if(new RegExp(`^(?:内)?の(?:${landmarkType.source})(?:である|です|であり|で、|$)`).test(tail))return true;
  }
  return false;
}

function definitionOf(page) {
  const first=page.extract?.split('。')[0]||'';
  // Classify the subject's defining predicate, not a mountain in its name or
  // a district used in the address of an actual shrine or park.
  return first.match(/(?:とは|は)[、,\s]*(.+)/)?.[1]||first;
}
function districtDefinition(definition) {
  return /(?:大字|町丁|地名|市|町|村|都市|自治体|行政区|地区|集落)(?:である|です|であり|で、|の一つ|のひとつ|にあたる|に当たる|を指す|をいう|を言う)?$/.test(definition)
    ||/(?:大字|町丁|地名|集落)(?:であり|で、)/.test(definition);
}
function landmarkPriority(page) {
  const definition=definitionOf(page);
  // Named scenic parks and buildings precede bare archaeological grounds.
  return /城郭|日本の城|公園|庭園|寺院|神社|教会|聖堂|橋梁|吊橋|大橋|滝|渓谷|峡谷|海岸|砂丘|湖|山地|山岳|火山|博物館|美術館|建造物|建築物|洋館|倉庫|灯台|展望台|タワー|町並み|街並み|温泉|動物園|水族館|植物園|景勝地|運河|岬|湿原|観光農園|ワイナリー/.test(definition)?2:1;
}
function recentInterest(pageviews) {
  if(!pageviews||typeof pageviews!=='object'||Array.isArray(pageviews))return null;
  const days=Object.entries(pageviews).filter(([day,value])=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isSafeInteger(value)&&value>=0).sort(([a],[b])=>b.localeCompare(a)).slice(0,30);
  return days.length?{views:days.reduce((sum,[,value])=>sum+value,0),observedDays:days.length}:null;
}
function landmarkKind(page) {
  const definition=definitionOf(page);
  if(/寺院|神社|教会|聖堂/.test(definition))return 'religious';
  if(/公園|庭園|滝|渓谷|峡谷|海岸|砂丘|湖|山地|山岳|火山|温泉|景勝地|運河|岬|湿原|観光農園|ワイナリー/.test(definition))return 'scenic';
  return landmarkPriority(page)===1?'archaeology':'architecture';
}
function closedVisitorFacility(lead) {
  const opening=lead.split('。').slice(0,2).join('。');
  return /水族館|遊園地|動物園|テーマパーク|博物館|美術館|観光施設|商業施設|宿泊施設|ホテル|旅館|ワイナリー|観光農園/.test(opening)
    &&/閉館|閉園|営業(?:を)?終了|営業終了|閉業|廃業|廃止された|営業していた|まで営業|閉鎖した|closed permanently|permanently closed/i.test(opening);
}
function eligibleLandmark(page,city) {
  if(!page||page.ns!==0||!Number.isSafeInteger(page.pageid)||page.pageid<=0||page.missing||page.pageprops?.disambiguation!==undefined||!safeTitle(page.title))return false;
  const lead=page.extract,definition=definitionOf(page);
  if(!landmarkMatchesCity(lead,city)||!landmarkType.test(definition)||nonPlace.test(definition)||nonTourismFacility.test(`${page.title} ${definition}`)||districtDefinition(definition)||closedVisitorFacility(lead))return false;
  return true;
}
function eligiblePrimaryImage(page) {
  const image=page.original,ratio=image?.width/image?.height;
  return safeTitle(page.pageimage,300)&&/\.(?:jpe?g|png|webp)$/i.test(page.pageimage)&&!disallowedImage.test(page.pageimage)
    &&Number.isSafeInteger(image?.width)&&Number.isSafeInteger(image?.height)&&image.width>=PHOTO_LIMITS.originalWidth&&image.height>=PHOTO_LIMITS.originalHeight&&ratio>=1.25&&ratio<=2.4
    &&Boolean(cleanCommonsUrl(image.source,['upload.wikimedia.org','thumb.wikimedia.org'],'/wikipedia/commons/'));
}

async function boundedJson(response) {
  if(!response.ok||Number(response.headers.get('Content-Length')||0)>PHOTO_LIMITS.responseBytes){await response.body?.cancel();throw new Error('provider_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new Error('provider_unavailable');
  const parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>PHOTO_LIMITS.responseBytes){await reader.cancel();throw new Error('provider_unavailable');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  // Normal API deprecation warnings are informational. API errors fail closed.
  if(!body||typeof body!=='object'||Array.isArray(body)||body.error)throw new Error('provider_unavailable');return body;
}

export async function collectLandmarkPhotos(city,source,{now=new Date(),fetchImpl=fetch}={}) {
  const requests={wikidataCalls:0,cityCalls:0,candidateCalls:0,landmarkCalls:0,categoryCalls:0,detailCalls:0},deadline=Date.now()+PHOTO_LIMITS.totalMs;
  let calls=0;
  const fileId=value=>typeof value==='string'?value.normalize('NFC').replaceAll('_',' ').trim():'';
  const excludedPhotoIds=new Set((Array.isArray(source.excludedPhotoIds)?source.excludedPhotoIds:[]).filter(value=>safeTitle(value,300)&&value.startsWith('File:')).map(fileId));
  const unavailable=reason=>({selectionVersion:LANDMARK_SELECTION_VERSION,status:'unavailable',reason,photos:[],requests});
  async function query(api,parameters,kind) {
    if(++calls>PHOTO_LIMITS.apiCalls||Date.now()>=deadline)throw new Error('provider_unavailable');requests[kind]++;
    const url=new URL(APIS[api]);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',...parameters}).toString();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(PHOTO_LIMITS.requestMs,deadline-Date.now()));
    try{return await boundedJson(await fetchImpl(url,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'LAYR-CityPhotos/2.0 (https://layr.co.jp/)'}}));}finally{clearTimeout(timer);}
  }
  try {
    const entities=await query('wikidata',{action:'wbgetentities',ids:source.wikidataId,props:'sitelinks',sitefilter:'jawiki'},'wikidataCalls');
    const entity=entities.entities?.[source.wikidataId],title=safeTitle(entity?.sitelinks?.jawiki?.title);
    if(entity?.id!==source.wikidataId||!title||entity.missing)return unavailable('city_identity_unconfirmed');
    const body=await query('japanese',{titles:title,prop:'revisions|pageprops',ppprop:'wikibase_item',rvprop:'content',rvslots:'main',rvlimit:'1',redirects:'1'},'cityCalls');
    const page=body.query?.pages?.[0];
    if(body.query?.pages?.length!==1||page?.ns!==0||page?.pageprops?.wikibase_item!==source.wikidataId||!Number.isSafeInteger(page.pageid)||page.pageid<=0)return unavailable('city_identity_unconfirmed');
    const candidates=extractLandmarkCandidates(page.revisions?.[0]?.slots?.main?.content);
    if(!candidates.length)return unavailable('no_named_landmarks');
    const pages=[],candidateMap=new Map(candidates.map(row=>[row.title,row]));
    for(let offset=0;offset<candidates.length;offset+=PHOTO_LIMITS.candidateBatch) {
      const batch=candidates.slice(offset,offset+PHOTO_LIMITS.candidateBatch),titles=batch.map(row=>row.title),response=await query('japanese',{titles:titles.join('|'),prop:'extracts|pageimages|pageprops|pageviews',pvipdays:'30',ppprop:'wikibase_item|disambiguation',exintro:'1',explaintext:'1',exlimit:String(PHOTO_LIMITS.candidateBatch),piprop:'name|original',pilimit:String(PHOTO_LIMITS.candidateBatch),redirects:'1'},'candidateCalls');
      if(!Array.isArray(response.query?.pages))throw new Error('provider_unavailable');
      const aliases=new Map(titles.map(name=>[name,candidateMap.get(name)]));
      for(const link of [...(response.query.normalized||[]),...(response.query.redirects||[])])if(aliases.has(link.from)&&safeTitle(link.to))aliases.set(link.to,aliases.get(link.from));
      for(const landmark of response.query.pages)if(aliases.has(landmark.title)&&eligibleLandmark(landmark,city))pages.push({...landmark,evidence:aliases.get(landmark.title),interest:recentInterest(landmark.pageviews)});
    }
    pages.sort((a,b)=>landmarkPriority(b)-landmarkPriority(a)||Number(Boolean(b.interest))-Number(Boolean(a.interest))||(b.interest?.views||0)-(a.interest?.views||0)||a.evidence.order-b.evidence.order);
    const photos=[],sourceEvidence=[],places=new Set(),files=new Set(),kinds=new Map();
    let fallbackCategories=null;
    const compact=value=>value.normalize('NFKC').toLowerCase().replace(/[\s_()（）,.'’"「」・:：-]/g,'');
    const matchesName=(value,names)=>names.some(name=>compact(value).includes(compact(name)));
    async function categories() {
      if(fallbackCategories)return fallbackCategories;
      fallbackCategories=new Map();
      const fallbackPages=pages.filter(row=>!eligiblePrimaryImage(row)&&/^Q[1-9][0-9]*$/.test(row.pageprops?.wikibase_item)).slice(0,PHOTO_LIMITS.fallbackLandmarks);
      const ids=[...new Set(fallbackPages.map(row=>row.pageprops.wikibase_item))];
      if(!ids.length||calls+2>=PHOTO_LIMITS.apiCalls)return fallbackCategories;
      const result=await query('wikidata',{action:'wbgetentities',ids:ids.join('|'),props:'claims|labels|sitelinks',languages:'ja|en',sitefilter:'jawiki'},'landmarkCalls');
      for(const landmark of fallbackPages) {
        const id=landmark.pageprops.wikibase_item,item=result.entities?.[id];
        if(item?.id!==id||item.missing||item.sitelinks?.jawiki?.title!==landmark.title)continue;
        const statements=(item.claims?.P373||[]).filter(row=>row.rank!=='deprecated'&&row.mainsnak?.snaktype==='value');
        const preferred=statements.filter(row=>row.rank==='preferred'),values=[...new Set((preferred.length?preferred:statements).map(row=>safeTitle(row.mainsnak?.datavalue?.value)).filter(Boolean))];
        if(values.length!==1||/[:：]/.test(values[0]))continue;
        const names=[landmark.title,item.labels?.ja?.value,item.labels?.en?.value].filter(name=>safeTitle(name)&&compact(name).length>=2);
        fallbackCategories.set(id,{category:values[0],names});
      }
      return fallbackCategories;
    }
    async function fileCandidates(landmark) {
      if(eligiblePrimaryImage(landmark))return [{title:`File:${landmark.pageimage.replaceAll('_',' ')}`,fallback:null}];
      const fallback=(await categories()).get(landmark.pageprops?.wikibase_item);
      if(!fallback||calls+1>=PHOTO_LIMITS.apiCalls)return [];
      const result=await query('commons',{list:'categorymembers',cmtitle:`Category:${fallback.category}`,cmtype:'file',cmnamespace:'6',cmlimit:String(PHOTO_LIMITS.categoryFiles)},'categoryCalls');
      if(!Array.isArray(result.query?.categorymembers))throw new Error('provider_unavailable');
      return result.query.categorymembers.slice(0,PHOTO_LIMITS.categoryFiles).filter(file=>file.ns===6&&Number.isSafeInteger(file.pageid)&&file.pageid>0&&safeTitle(file.title,300)&&/^File:.+\.(?:jpe?g|png|webp)$/i.test(file.title)&&!disallowedImage.test(file.title)&&matchesName(file.title,fallback.names)).slice(0,2).map(file=>({title:file.title,fallback:{...fallback,pageId:file.pageid}}));
    }
    async function fetchPhoto(landmark,fileTitle,fallback) {
      if(excludedPhotoIds.has(fileId(fileTitle))||files.has(fileTitle)||requests.detailCalls>=PHOTO_LIMITS.detailCalls||calls>=PHOTO_LIMITS.apiCalls)return null;
      const response=await query('commons',{titles:fileTitle,prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iilimit:'1',iiurlwidth:String(PHOTO_LIMITS.thumbnailWidth),iiextmetadatalanguage:'en',iiextmetadatafilter:'Artist|Attribution|Copyrighted|LicenseShortName|LicenseUrl|ObjectName|ImageDescription'},'detailCalls');
      const file=response.query?.pages?.find(row=>row.ns===6&&row.title===fileTitle),info=file?.imageinfo?.[0],metadata=info?.extmetadata||{};
      const originalUrl=cleanCommonsUrl(info?.url,['upload.wikimedia.org','thumb.wikimedia.org'],'/wikipedia/commons/'),expectedUrl=fallback?originalUrl:cleanCommonsUrl(landmark.original.source,['upload.wikimedia.org','thumb.wikimedia.org'],'/wikipedia/commons/');
      if(!Number.isSafeInteger(file?.pageid)||file.pageid<=0||!info||!originalUrl||!['image/jpeg','image/png','image/webp'].includes(info.mime)||originalUrl!==expectedUrl)return null;
      const ratio=info.width/info.height,width=info.thumbwidth,height=info.thumbheight;
      if(!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width<PHOTO_LIMITS.originalWidth||info.height<PHOTO_LIMITS.originalHeight||ratio<1.25||ratio>2.4||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<PHOTO_LIMITS.thumbnailWidth||height<533)return null;
      const originalTitle=plain(metadata.ObjectName?.value||fileTitle.replace(/^File:|\.[^.]+$/g,'')),description=plain(metadata.ImageDescription?.value,3000),artist=plain(metadata.Artist?.value,500),author=metadata.Attribution?.value?plain(metadata.Attribution.value,500):artist,license=licenseOf(metadata),copyrighted=plain(metadata.Copyrighted?.value,20).toLowerCase();
      if(!originalTitle||!artist||!author||/^(?:unknown|anonymous|不明)$/i.test(artist)||/^(?:unknown|anonymous|不明)$/i.test(author)||!license||!['true','false'].includes(copyrighted)||(metadata.ImageDescription?.value&&!description)||disallowedImage.test(`${fileTitle} ${originalTitle} ${description}`))return null;
      if(license.license==='PD'&&copyrighted!=='false'||/^CC BY/.test(license.license)&&copyrighted!=='true')return null;
      const photo=normalizeCityPhoto({id:fileTitle,title:originalTitle,caption:landmark.title,alt:`${city.fullName}の観光名所・${landmark.title}`,url:cleanCommonsUrl(info.thumburl,['upload.wikimedia.org','thumb.wikimedia.org'],'/wikipedia/commons/'),sourceUrl:cleanCommonsUrl(info.descriptionurl,['commons.wikimedia.org'],'/wiki/File:'),author,...license,width,height});
      if(!photo||photos.some(existing=>existing.url===photo.url))return null;
      if(fallback&&(!matchesName(description,fallback.names)||/\b(?:view|seen|taken) from\b|から(?:見た|撮影)/i.test(description)))return null;
      return {photo,file,info,originalUrl};
    }
    const remaining=[...pages];
    while(remaining.length&&photos.length<4&&requests.detailCalls<PHOTO_LIMITS.detailCalls&&calls<PHOTO_LIMITS.apiCalls) {
      let index=0;
      // Prefer variety after two photos of the same type, without promoting
      // lower-priority archaeological grounds ahead of scenic landmarks.
      if((kinds.get(landmarkKind(remaining[0]))||0)>=2){const other=remaining.findIndex(row=>landmarkPriority(row)>=landmarkPriority(remaining[0])&&(kinds.get(landmarkKind(row))||0)<2);if(other>=0)index=other;}
      const landmark=remaining.splice(index,1)[0],placeKey=landmark.pageprops?.wikibase_item||String(landmark.pageid);
      if(places.has(placeKey))continue;
      for(const candidate of await fileCandidates(landmark)) {
        const checked=await fetchPhoto(landmark,candidate.title,candidate.fallback);if(!checked)continue;
        const {photo,file,info,originalUrl}=checked;
        if(candidate.fallback&&file.pageid!==candidate.fallback.pageId)continue;
        photos.push(photo);places.add(placeKey);files.add(candidate.title);kinds.set(landmarkKind(landmark),(kinds.get(landmarkKind(landmark))||0)+1);
        sourceEvidence.push({id:candidate.title,pageId:file.pageid,landmark:landmark.title,landmarkPageId:landmark.pageid,landmarkWikidataId:landmark.pageprops?.wikibase_item||null,landmarkUrl:wikiUrl(landmark.title),cityArticleUrl:wikiUrl(page.title),cityWikidataId:source.wikidataId,section:landmark.evidence.section,interest:landmark.interest,locationExcerpt:landmark.extract.slice(0,600),originalImageUrl:originalUrl,originalWidth:info.width,originalHeight:info.height,...(candidate.fallback?{imageSelection:'landmark_category',commonsCategory:candidate.fallback.category}:{imageSelection:'article_image'})});
        break;
      }
    }
    const record=normalizeCityPhotos(city.slug,{schemaVersion:1,selectionVersion:LANDMARK_SELECTION_VERSION,citySlug:city.slug,status:'ready',fetchedAt:now.toISOString(),photos});
    return record?{...record,selectionVersion:LANDMARK_SELECTION_VERSION,sourceEvidence,source:{wikidataId:source.wikidataId,cityArticleUrl:wikiUrl(page.title)},requests}:unavailable('insufficient_landmark_photos');
  }catch{return unavailable('provider_unavailable');}
}
