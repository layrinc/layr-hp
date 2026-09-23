import {createStore, getDocuments, getPublished, japanDay, activity} from './seo-store.mjs';
import {REGIONAL_PREFECTURES, readRegionalCampaignConfig, campaignDateForCity} from './seo-regional-campaign.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {normalizeDocument, qualityIssues, publicPath} from '../src/lib/seo-manager/editorial-model.mjs';

const NAMESPACE='regional_editorial';
const STAGES=['research','draft','review'];
const shiftDay=(day,n)=>new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
const textOf=doc=>[doc.lead,...(doc.sections||[]).flatMap(s=>[s.heading,...s.paragraphs,...s.steps]),doc.example?.body].join('\n');
function fingerprint(doc) {
  let value=textOf(doc).replace(/\s+/g,'').normalize('NFKC');
  for(const name of [doc.region?.fullName,doc.region?.cityName,doc.region?.prefectureName].filter(Boolean))value=value.replaceAll(name,'');
  return value;
}
export function similarRegionalCopy(left,right) {
  const a=fingerprint(left),b=fingerprint(right);
  if(!a||!b)return false;
  const grams=value=>new Set(Array.from({length:Math.max(0,value.length-4)},(_,i)=>value.slice(i,i+5)));
  const x=grams(a),y=grams(b);let common=0;
  for(const gram of x)if(y.has(gram))common++;
  return common/Math.max(1,Math.min(x.size,y.size))>0.8;
}
async function readBoundedJson(response) {
  if(!response.ok){await response.body?.cancel();throw new Error('provider_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new Error('provider_invalid');
  const chunks=[];let length=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>128*1024){await reader.cancel();throw new Error('provider_oversize');}chunks.push(value);}}
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function callRegionalProvider(env,input) {
  if(!env.REGIONAL_EDITORIAL?.fetch)return {status:'blocked',reason:'provider_not_configured'};
  const request=new Request('https://regional.internal/step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(150000),redirect:'error'});
  return readBoundedJson(await env.REGIONAL_EDITORIAL.fetch(request));
}
export async function regionalPreparationSummary(db) {
  const store=createStore(db),[config,rows]=await Promise.all([store.get(NAMESPACE,'config'),store.list(NAMESPACE)]);
  const counts={ready:0,blocked:0,pending:0};
  const blocked=[];
  for(const {key,value} of rows) {
    if(key==='config')continue;
    if(value.status==='ready')counts.ready++;
    else if(value.status==='blocked'){counts.blocked++;blocked.push({slug:key,name:value.name,reason:value.reason});}
    else counts.pending++;
  }
  return {enabled:config?.enabled===true,...counts,blockedCities:blocked,lastRun:await store.get('jobs','prepare')};
}

/** One resumable provider call per request. The provider owns paid-call idempotence.
 * Existing drafts, paused pages and live snapshots are never overwritten here.
 */
export async function prepareRegionalStep(env,{now=new Date(),provider=callRegionalProvider}={}) {
  const db=env.SEO_DB,store=createStore(db),config=await readRegionalCampaignConfig(db);
  const setup=await store.get(NAMESPACE,'config');
  if(!config.enabled||setup?.enabled!==true)return {done:true,outcome:'disabled',blockedCount:0};
  if((await store.get('settings','publication'))?.paused)return {done:true,outcome:'paused',blockedCount:0};
  const day=japanDay(now),firstDate=config.startDate;
  if(!firstDate)return {done:true,outcome:'disabled',blockedCount:0};
  // Prepare today's and tomorrow's prefecture only; before launch prepare day one.
  // Past failures stay visible for review, rather than silently changing order.
  const targetDates=day<firstDate?[firstDate]:[day,shiftDay(day,1)];
  const targets=REGIONAL_PREFECTURES.flatMap(pref=>pref.cities).filter(city=>targetDates.includes(campaignDateForCity(config,city.slug)));
  if(!targets.length)return {done:true,outcome:'calendar_finished',blockedCount:0};
  const [documents,published,progress]=await Promise.all([getDocuments(db),getPublished(db),store.list(NAMESPACE)]);
  const live=new Set([...getPublishedAreas(now).map(area=>`/service/ltori/area/${area.slug}/`),...published.map(doc=>doc.path||publicPath(doc))]);
  const docsByPath=new Map(documents.map(doc=>[doc.path||publicPath(doc),doc]));
  const states=new Map(progress.map(row=>[row.key,row.value]));
  let candidate=null,blockedCount=0;
  for(const city of targets) {
    if(live.has(city.path))continue;
    const doc=docsByPath.get(city.path),state=states.get(city.slug);
    if(doc?.status==='scheduled'&&doc.review)continue;
    if(state?.status==='blocked'){blockedCount++;continue;}
    if(doc) {
      await store.upsert(NAMESPACE,city.slug,{...state,status:'blocked',name:city.fullName,reason:'existing_draft_requires_review',updatedAt:now.toISOString()});
      blockedCount++;continue;
    }
    if(!candidate)candidate=city;
  }
  if(!candidate)return {done:true,outcome:blockedCount?'needs_review':'prepared',blockedCount};
  const city=candidate,state=states.get(city.slug)||{stage:'research',name:city.fullName,status:'pending'};
  const stage=STAGES.includes(state.stage)?state.stage:'research';
  // Stable across workflows, recovery requests, run attempts, dates and deployments.
  const input={requestId:`municipal-20260923-v1:${city.code}:${stage}`,stage,
    city:{code:city.code,slug:city.slug,name:city.name,fullName:city.fullName,prefectureName:REGIONAL_PREFECTURES.find(p=>p.cities.some(c=>c.code===city.code)).name},
    ...(state.research?{research:state.research}:{}),...(state.draft?{draft:state.draft}:{})};
  let result;
  try {result=await provider(env,input);}
  catch {
    // Repeating this ID is safe only because the provider reserves its request
    // before charging and refuses to repeat ambiguous/in-flight paid requests.
    await store.upsert(NAMESPACE,city.slug,{...state,status:'pending',stage,reason:'provider_connection',updatedAt:now.toISOString()});
    return {done:true,outcome:'provider_unavailable',blockedCount,city:city.slug};
  }
  if(result?.status!=='completed') {
    const reason=String(result?.reason||result?.code||'provider_blocked').slice(0,100);
    if(/budget|not_configured|disabled|pending|in_progress|unknown|busy/.test(reason)) {
      await store.upsert(NAMESPACE,city.slug,{...state,status:'pending',stage,reason,updatedAt:now.toISOString()});
      return {done:true,outcome:'provider_blocked',blockedCount,city:city.slug};
    }
    await store.upsert(NAMESPACE,city.slug,{...state,status:'blocked',stage,reason,updatedAt:now.toISOString()});
    return {done:false,outcome:'needs_review',blockedCount:blockedCount+1,city:city.slug};
  }
  if(stage!=='review') {
    await store.upsert(NAMESPACE,city.slug,{...state,status:'pending',stage:STAGES[STAGES.indexOf(stage)+1],[stage]:result.result,reason:null,updatedAt:now.toISOString()});
    return {done:false,outcome:'progress',blockedCount,city:city.slug,stage};
  }
  const reviewed=result.result,scheduledOn=campaignDateForCity(config,city.slug);
  const doc=normalizeDocument({...state.draft?.document,type:'city',slug:city.slug},{now,scheduledAt:new Date(`${scheduledOn}T09:17:00+09:00`).toISOString(),status:'scheduled',review:{reviewedBy:'AI出典照合（regional-editorial-v1）',reviewedAt:now.toISOString()}});
  const errors=qualityIssues(doc,{now,requireReview:true}).filter(issue=>issue.severity==='error');
  const facts=state.research?.facts||[];
  const supported=new Set(reviewed?.supportedFactIds||[]);
  const mismatch=facts.length<3||facts.some(fact=>!supported.has(fact.id));
  const duplicate=documents.some(other=>other.type==='city'&&similarRegionalCopy(doc,other));
  if(reviewed?.approved!==true||!Array.isArray(reviewed.issues)||reviewed.issues.length||errors.length||mismatch||duplicate) {
    const reason=duplicate?'similar_content':errors.length?'document_validation':mismatch?'evidence_incomplete':'review_failed';
    await store.upsert(NAMESPACE,city.slug,{...state,status:'blocked',review:reviewed,reason,updatedAt:now.toISOString()});
    await activity(db,'regional_review',`${city.fullName}の原稿を要確認にしました。自動公開はしません。`,now);
    return {done:false,outcome:'needs_review',blockedCount:blockedCount+1,city:city.slug};
  }
  const saved={...doc,path:publicPath(doc),version:1};
  // Transactional insert-only, enabled/pause guards re-read after the AI call.
  const inserted=await db.prepare(`INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,reviewed_version,updated_at)
    SELECT ?,?,'city','scheduled',1,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM seo_published WHERE path=?)
    AND EXISTS(SELECT 1 FROM seo_kv WHERE namespace='regional_campaign' AND key='config' AND json_extract(value,'$.enabled')=1 AND json_extract(value,'$.startDate')=?)
    AND EXISTS(SELECT 1 FROM seo_kv WHERE namespace='regional_editorial' AND key='config' AND json_extract(value,'$.enabled')=1)
    AND COALESCE((SELECT json_extract(value,'$.paused') FROM seo_kv WHERE namespace='settings' AND key='publication'),0)=0
    ON CONFLICT DO NOTHING`).bind(saved.id,saved.path,JSON.stringify(saved),saved.scheduledAt,now.toISOString(),saved.path,config.startDate).run();
  if(!inserted.meta.changes)return {done:true,outcome:'state_changed',blockedCount,city:city.slug};
  await store.upsert(NAMESPACE,city.slug,{...state,status:'ready',stage:'review',review:reviewed,reason:null,documentId:saved.id,updatedAt:now.toISOString()});
  await activity(db,'regional_ready',`${city.fullName}の地域資料を調査し、AI照合を通過した原稿を公開待ちに追加しました。`,now);
  return {done:false,outcome:'ready',blockedCount,city:city.slug,stage};
}
