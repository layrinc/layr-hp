import {handleKijiWorkspace} from './kiji-workspace.mjs';
import {protectedResponse,MANAGER_ORIGIN} from './seo-access.mjs';
import {ensureDatabase,createStore,HttpError,getDocuments,getDocument,getPublished,getWorkspace,saveWorkspace,saveDocument,approveDocument,pauseDocument,publicationStats,publicationSettings,activity,backup} from './seo-store.mjs';
import {validateDocument,qualityIssues,publicPath,cityCatalog} from '../src/lib/seo-manager/editorial-model.mjs';
import {getAnalyticsConfiguration} from './seo-analytics.mjs';
import {readMediaAnalytics} from './seo-media-analytics.mjs';
import {buildGrowthReport} from '../src/lib/seo-manager/growth-model.mjs';
import {saveLead} from './seo-leads.mjs';
import corporateCatalog from '../src/data/seo-corporate-catalog.json' with {type: 'json'};
import {projectWorkspace, ltoriGrowthSnapshots} from './seo-workspace.mjs';
import {canonicalWorkspacePath} from '../src/lib/seo-manager/workspace-projects.mjs';
import {regionalPreparationSummary} from './seo-regional-preparation.mjs';

const json=(value,status=200)=>protectedResponse(JSON.stringify(value),status,{'Content-Type':'application/json; charset=utf-8'});
const allowedEmail='biz.oneservice@gmail.com';
const version=value=>{if(!Number.isInteger(value)||value<0)throw new HttpError(400,'保存版を確認してください。');return value;};
function schedulerStatus(value) {
  if(!value||typeof value!=='object')return null;
  const timestamp=input=>typeof input==='string'&&Number.isFinite(Date.parse(input))?new Date(input).toISOString():null;
  const identifier=input=>/^\d{1,30}$/.test(String(input??''))?String(input):null;
  return {status:['completed','running','error'].includes(value.status)?value.status:null,lastAttemptAt:timestamp(value.lastAttemptAt),lastSuccessAt:timestamp(value.lastSuccessAt),runId:identifier(value.runId),runAttempt:identifier(value.runAttempt)};
}
async function body(request, maxBytes=20*1024*1024){if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'JSON形式で送信してください。');const raw=await request.text();if(new TextEncoder().encode(raw).length>maxBytes)throw new HttpError(413,'データが大きすぎます。');try{return JSON.parse(raw);}catch{throw new HttpError(400,'JSON形式を確認してください。');}}
const corporatePaths=new Set(corporateCatalog.map(row=>canonicalWorkspacePath(row.path)));
function corporateEdits(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'改善管理の入力内容を確認してください。');
  const edits={};
  for(const [path,edit] of Object.entries(input)) {
    if(!corporatePaths.has(path)||canonicalWorkspacePath(path)!==path||!edit||typeof edit!=='object'||Array.isArray(edit))throw new HttpError(400,'公開記事一覧にあるURLを指定してください。');
    if(!['high','normal','low'].includes(edit.priority)||!['unreviewed','research','rewrite','review','done'].includes(edit.status))throw new HttpError(400,'優先度・進行状況を確認してください。');
    for(const [key,limit] of [['keyword',200],['evidence',2000],['notes',4000]])if(typeof edit[key]!=='string'||edit[key].length>limit)throw new HttpError(400,'キーワード・根拠・メモの長さを確認してください。');
    edits[path]={priority:edit.priority,status:edit.status,keyword:edit.keyword,evidence:edit.evidence,notes:edit.notes};
  }
  return edits;
}
async function readCorporateState(db) {
  const row=await db.prepare("SELECT value,version FROM seo_kv WHERE namespace='corporate' AND key='state'").first();
  if(!row)return {revision:0,edits:{}};
  try {const saved=JSON.parse(row.value);return {revision:row.version,edits:corporateEdits(Object.fromEntries(Object.entries(saved.edits||{}).filter(([path])=>corporatePaths.has(path))))};}
  catch {throw new HttpError(503,'公式メディアの改善メモを読み出せませんでした。再読み込みしてください。');}
}
export async function handleManagerApi(request,env,identity,path,services={}) {
  try {
    if(identity.email.toLowerCase()!==allowedEmail)throw new HttpError(403,'この管理画面を編集する権限がありません。');
    if(path.startsWith('/api/seo/kiji/'))return handleKijiWorkspace(request,env);
    if(!['GET','POST','PUT'].includes(request.method))throw new HttpError(405,'この操作には対応していません。');
    if(request.method!=='GET'&&request.headers.get('Origin')!==MANAGER_ORIGIN)throw new HttpError(403,'管理画面を開き直して操作してください。');
    await ensureDatabase(env.SEO_DB);const db=env.SEO_DB,store=createStore(db),url=new URL(request.url),now=new Date();
    if(path==='/api/seo/overview') {
      if(request.method!=='GET')throw new HttpError(405,'GETで取得してください。');
      const [published,pending,snapshots,integrations,publishSchedule,maintenanceSchedule]=await Promise.all([
        db.prepare("SELECT path,json_extract(value,'$.title') AS title,json_extract(value,'$.type') AS type,published_at AS publishedAt FROM seo_published").all(),
        db.prepare("SELECT path,status FROM seo_documents WHERE status IN ('approved','scheduled')").all(),
        store.list('analytics'),store.list('integrations'),store.get('scheduler','publish'),store.get('scheduler','maintenance'),
      ]);
      return json(projectWorkspace({catalog:[...(services.staticPages||[]),...corporateCatalog,...published.results],pending:pending.results,snapshots,integrations,configuration:getAnalyticsConfiguration(env),scheduler:{publish:publishSchedule,maintenance:maintenanceSchedule},now}));
    }
    if(path==='/api/seo/corporate/state') {
      if(request.method==='GET')return json({state:await readCorporateState(db)});
      if(request.method!=='PUT')throw new HttpError(405,'PUTで保存してください。');
      const payload=await body(request,512*1024);
      if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new HttpError(400,'保存内容を確認してください。');
      const expectedRevision=version(payload.expectedRevision),edits=corporateEdits(payload.state?.edits);
      const value=JSON.stringify({edits}),updatedAt=now.toISOString();
      const statement=expectedRevision===0
        ?db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('corporate','state',?,1,?) ON CONFLICT DO NOTHING").bind(value,updatedAt)
        :db.prepare("UPDATE seo_kv SET value=?,version=version+1,updated_at=? WHERE namespace='corporate' AND key='state' AND version=?").bind(value,updatedAt,expectedRevision);
      if(!(await statement.run()).meta.changes)throw new HttpError(409,'別の端末で更新されました。再読み込みしてから保存してください。');
      return json({state:{revision:expectedRevision+1,edits}});
    }
    if(path==='/api/seo/media/analytics') {
      if(request.method!=='GET')throw new HttpError(405,'GETで取得してください。');
      // Read public article identities only, not drafts, lead records or full bodies.
      const {results:articles}=await db.prepare("SELECT path,json_extract(value,'$.title') AS title FROM seo_published WHERE json_extract(value,'$.type')='article'").all();
      const catalog=[...(services.staticPages||[]),...articles.map(row=>({...row,type:'article'}))];
      return json(await readMediaAnalytics(store,{configuration:getAnalyticsConfiguration(env),catalog,now}));
    }
    if(path==='/api/seo/state') {
      if(request.method==='GET')return json({state:await getWorkspace(db)});
      if(request.method!=='PUT')throw new HttpError(405,'PUTで保存してください。');
      const payload=await body(request);
      if(!payload.state||typeof payload.state!=='object'||Array.isArray(payload.state))throw new HttpError(400,'保存内容を確認してください。');
      return json({state:await saveWorkspace(db,payload.state,version(payload.expectedRevision),now)});
    }
    if(path==='/api/seo/dashboard'&&request.method==='GET') {
      const [documents,published,leads,snapshots,integrations,inspections,health,statistics,settings,events,publishSchedule,maintenanceSchedule]=await Promise.all([
        getDocuments(db),getPublished(db),store.list('leads'),store.list('analytics'),store.list('integrations'),store.list('inspections'),store.list('health'),publicationStats(db,now),store.get('settings','publication'),db.prepare('SELECT kind,message,created_at AS createdAt FROM seo_activity ORDER BY created_at DESC LIMIT 50').all(),store.get('scheduler','publish'),store.get('scheduler','maintenance'),
      ]);
      const flat=rows=>rows.map(row=>row.value);
      const pages=[...(services.staticPages||[]),...published.map(doc=>({path:publicPath(doc),title:doc.title,type:doc.type,publishedAt:doc.publishedAt}))];
      return json({regionalPreparation:await regionalPreparationSummary(db),settings:publicationSettings(settings),scheduler:{publish:schedulerStatus(publishSchedule),maintenance:schedulerStatus(maintenanceSchedule)},documents:documents.map(doc=>({...doc,path:publicPath(doc),issues:qualityIssues(doc)})),published,leads:flat(leads),snapshots:flat(snapshots),integrations:flat(integrations),inspections:flat(inspections),health:flat(health),activity:events.results,publicationStats:statistics,catalog:cityCatalog,configuration:getAnalyticsConfiguration(env),report:buildGrowthReport({snapshots:ltoriGrowthSnapshots(snapshots),integrations,inspections,leads,pages,now}),serverTime:now.toISOString()});
    }
    if(path==='/api/seo/publication'&&request.method==='GET') {
      const [docs,live]=await Promise.all([getDocuments(db),getPublished(db)]);const liveById=new Map(live.map(doc=>[doc.id,doc]));
      return json({pages:docs.map(doc=>{const published=liveById.get(doc.id);return published?{path:publicPath(doc),status:'published',title:typeof published.title==='string'?published.title:'',publishedAt:published.publishedAt||''}:{path:publicPath(doc),status:doc.status};})});
    }
    if(path==='/api/seo/documents'&&request.method==='POST') {
      const input=await body(request);
      if(!input||typeof input!=='object'||Array.isArray(input)||!input.document||typeof input.document!=='object'||Array.isArray(input.document))throw new HttpError(400,'原稿の入力内容を確認してください。');
      if(new TextEncoder().encode(JSON.stringify(input.document)).length>250000)throw new HttpError(413,'原稿が大きすぎます。25万バイト以内にしてください。');
      const scheduledAt=input.document.scheduledAt;
      if(scheduledAt&&!Number.isFinite(Date.parse(scheduledAt)))throw new HttpError(400,'公開予約日時を確認してください。');
      const result=validateDocument(input.document,{now,scheduledAt:scheduledAt?new Date(scheduledAt).toISOString():''});
      if(!result.valid)return json({error:'入力内容を確認してください。',issues:result.issues},400);
      if((services.staticPages||[]).some(row=>row.path===publicPath(result.document)))throw new HttpError(409,'既存の公開原稿はリポジトリで管理されています。別のURLを選んでください。');
      const document=await saveDocument(db,{...result.document,path:publicPath(result.document)},version(input.expectedVersion??0),now);
      await activity(db,'draft',`${document.title||document.slug}の下書きを保存しました。`,now);return json({document,issues:qualityIssues(document)},201);
    }
    const action=path.match(/^\/api\/seo\/documents\/(.+)\/(approve|pause)$/);
    if(action&&request.method==='POST') {
      const input=await body(request),id=action[1],doc=await getDocument(db,id);if(!doc)throw new HttpError(404,'原稿が見つかりません。');
      if(version(input.version)!==doc.version)throw new HttpError(409,'原稿が変更されています。再読み込みしてください。');
      if(action[2]==='pause'){await pauseDocument(db,id,doc.version,now);await activity(db,'pause',`${doc.title}の公開を停止しました。`,now);return json({ok:true});}
      const issues=qualityIssues(doc,{now});if(issues.some(row=>row.severity==='error'))return json({error:'公開前の確認項目を修正してください。',issues},422);
      // Identical regional copy must be reviewed, not approved en masse via city substitution.
      const all=await getDocuments(db);const fingerprint=d=>d.sections.map(s=>[...s.paragraphs,...s.steps].join('')).join('').replace(/\s/g,'').replaceAll(d.region?.cityName||'__none__','');
      if(all.some(other=>other.id!==doc.id&&fingerprint(other)===fingerprint(doc)))return json({error:'ほかの原稿と本文が一致しています。対象読者に合わせた具体的な内容を確認してください。'},422);
      const document=await approveDocument(db,doc,doc.version,identity.email,now);await activity(db,'approve',`${doc.title}を承認し、公開予約に追加しました。`,now);return json({document});
    }
    if(path==='/api/seo/settings'&&request.method==='POST') {
      const input=await body(request);if(typeof input.paused!=='boolean')throw new HttpError(400,'停止設定を確認してください。');
      const settings={...publicationSettings(input),updatedAt:now.toISOString()};await store.upsert('settings','publication',settings);await activity(db,'settings',input.paused?'自動公開を一時停止しました。':'自動公開を再開しました。',now);return json({settings});
    }
    if(path==='/api/seo/leads'&&request.method==='POST') {const input=await body(request);return json({lead:await saveLead(db,input.lead||{},version(input.expectedVersion??0),now)});}
    if(['/api/seo/sync','/api/seo/inspect'].includes(path)&&request.method==='POST') {
      const job=path.endsWith('/sync')?'analytics':'inspection';const result=await services.runJob?.(job);return json(result||{error:'処理を開始できませんでした。'},result?202:503);
    }
    if(path==='/api/seo/backup'&&request.method==='GET')return protectedResponse(JSON.stringify(await backup(db)),200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="eltori-seo-backup.json"'});
    if(path==='/api/seo/preview'&&request.method==='GET') {
      const doc=await getDocument(db,url.searchParams.get('id')||'');if(!doc)throw new HttpError(404,'原稿が見つかりません。');
      const result=await services.preview(doc);result.headers.set('Cache-Control','private, no-store');result.headers.set('X-Robots-Tag','noindex, nofollow');return result;
    }
    throw new HttpError(404,'操作が見つかりません。');
  } catch(error) {
    return json({error:error instanceof HttpError?error.message:'処理を完了できませんでした。接続状態を確認し、再読み込みしてください。'},error instanceof HttpError?error.status:500);
  }
}
