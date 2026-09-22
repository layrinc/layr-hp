import {validateMediaAnalyticsReport,validateMediaSearchReport,canonicalArticlePath} from './model.mjs';
const ENDPOINT='/api/seo/media/analytics';
const SOURCES=['ga4','gsc'];
const text=value=>typeof value==='string'?value.slice(0,2000):'';
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const list=value=>Array.isArray(value)?value:[];

export function serverArticleCatalog(localCatalog,incoming){
  if(incoming===undefined)return localCatalog;
  if(!Array.isArray(incoming)||incoming.length>20000)throw new Error('公開記事一覧の形式を確認できませんでした。');
  const localByPath=new Map(localCatalog.map(row=>[row.path,row])),seen=new Set();
  return incoming.map(row=>{
    if(!row||typeof row!=='object'||row.publication!=='published'||!canonicalArticlePath(row.path,[row]))throw new Error('公開記事一覧に不正なURLが含まれています。');
    const slug=row.path.split('/').filter(Boolean).at(-1);
    if(row.id!==slug||seen.has(slug))throw new Error('公開記事一覧のIDが不正または重複しています。');
    seen.add(slug);return {id:slug,slug,path:row.path,title:localByPath.get(row.path)?.title||text(row.title)||slug,publication:'published'};
  });
}

export function normalizeServerAnalytics(input,catalog){
  if(!input||typeof input!=='object'||!date(input.serverTime)||!Array.isArray(input.reports)||!Array.isArray(input.queries))throw new Error('自動取得データの形式を確認できませんでした。再読み込みしてください。');
  const publishedCatalog=serverArticleCatalog(catalog,input.catalog);
  const configuration=input.configuration||{},integrations=SOURCES.map(source=>{
    const row=list(input.integrations).find(item=>item?.source===source)||{};
    return {source,status:['ok','error','not_configured'].includes(row.status)?row.status:'unknown',lastAttemptAt:date(row.lastAttemptAt),lastSuccessAt:date(row.lastSuccessAt),message:text(row.message),code:text(row.code)};
  });
  const reports=input.reports.map(row=>({...validateMediaAnalyticsReport(row,publishedCatalog),storage:'server'})).map(row=>({...row,id:`server:${row.id}`}));
  const queries=input.queries.map(row=>({...validateMediaSearchReport(row,publishedCatalog),storage:'server'})).map(row=>({...row,id:`server:${row.id}`}));
  if(queries.some(row=>row.kind!=='queries'))throw new Error('検索クエリの取得形式を確認できませんでした。');
  const schedule=input.schedule?.provider==='github-actions'&&input.schedule?.frequency==='daily'&&input.schedule?.timezone==='Asia/Tokyo'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(input.schedule?.time||'')?{provider:'github-actions',frequency:'daily',timezone:'Asia/Tokyo',time:input.schedule.time,nextRunAt:date(input.schedule.nextRunAt)}:null;
  const scheduler=input.scheduler&&typeof input.scheduler==='object'?{status:['running','completed','error'].includes(input.scheduler.status)?input.scheduler.status:null,lastAttemptAt:date(input.scheduler.lastAttemptAt),lastSuccessAt:date(input.scheduler.lastSuccessAt)}:null;
  const job=input.job&&['running','completed','error'].includes(input.job.status)?{status:input.job.status,startedAt:date(input.job.startedAt),finishedAt:date(input.job.finishedAt),message:text(input.job.message)}:null;
  return {catalog:publishedCatalog,configuration:{ga4Configured:configuration.ga4Configured===true,gscConfigured:configuration.gscConfigured===true,serviceAccountConfigured:configuration.serviceAccountConfigured===true},integrations,reports,queries,schedule,scheduler,job,notes:list(input.notes).map(text).filter(Boolean),serverTime:input.serverTime};
}

export function nextAutomaticRun(schedule,reference){
  if(!schedule||schedule.provider!=='github-actions'||schedule.frequency!=='daily'||schedule.timezone!=='Asia/Tokyo'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time||''))return null;
  const now=new Date(reference);if(!Number.isFinite(now.getTime()))return null;
  const [hour,minute]=schedule.time.split(':').map(Number),jst=new Date(now.getTime()+9*60*60*1000),next=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate(),hour-9,minute));
  if(next.getTime()<=now.getTime())next.setUTCDate(next.getUTCDate()+1);
  return next.toISOString();
}

export function synchronizationFinished(before,after){
  if(after.job?.status==='running')return false;
  if(after.job?.finishedAt&&after.job.finishedAt!==before.job?.finishedAt&&Date.parse(after.job.finishedAt)>=Date.parse(before.serverTime))return true;
  const expected=SOURCES.filter(source=>before.configuration[`${source}Configured`]);
  return expected.length>0&&expected.every(source=>{
    const previous=before.integrations.find(row=>row.source===source),current=after.integrations.find(row=>row.source===source);
    return current?.lastAttemptAt&&current.lastAttemptAt!==previous?.lastAttemptAt&&Date.parse(current.lastAttemptAt)>=Date.parse(before.serverTime);
  });
}

export function combineAnalyticsReports(serverReports=[],localReports=[]){
  // Local history is intentionally retained, even when its period matches the server.
  return [...serverReports.slice().sort((a,b)=>b.end.localeCompare(a.end)||b.importedAt.localeCompare(a.importedAt)),...localReports];
}

function defaultDelay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
export function createServerAnalyticsClient({catalog,fetcher=fetch,delay=defaultDelay,onSnapshot=()=>{},onStatus=()=>{},pollInterval=2500,maxPolls=40,timeoutMs=15000}={}){
  let snapshot=null,pending=null,disposed=false,status={phase:'idle',message:''};
  const emit=(phase,message)=>{status={phase,message};if(!disposed)onStatus(status);};
  async function request(path,method='GET'){
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('サーバーの応答を確認できませんでした。再読み込みしてください。'));},timeoutMs);});
    const operation=(async()=>{
      let response;try{response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});}catch{throw new Error('サーバーへ接続できませんでした。通信状態を確認してください。');}
      if(!response.ok)throw new Error(response.status===401||response.status===403?'認証の有効期限または閲覧権限を確認できません。画面を再読み込みしてログインしてください。':response.status===409?'別の同期が進行しています。保存済み実績を再読み込みしてください。':`自動取得の状態を確認できませんでした（${response.status}）。`);
      try{return await response.json();}catch{throw new Error('サーバーの応答を読み込めませんでした。');}
    })();
    try{return await Promise.race([operation,timeout]);}finally{clearTimeout(timer);}
  }
  async function read(){
    const next=normalizeServerAnalytics(await request(ENDPOINT),catalog);
    if(!disposed){snapshot=next;onSnapshot(next);}
    return next;
  }
  async function waitForCompletion(before){
    emit('syncing','サーバーで同期中です。取得結果が保存されるまで確認しています。');
    for(let attempt=0;attempt<maxPolls&&!disposed;attempt++){
      await delay(pollInterval);if(disposed)return snapshot;
      const latest=await read();
      if(synchronizationFinished(before,latest)){
        const failed=latest.job?.status==='error'||latest.integrations.some(row=>row.status==='error'||row.status==='not_configured');
        emit(failed?'attention':'ready',failed?'同期が終了しました。一部の取得に問題があります。ソース別の状態を確認してください。':'サーバーの同期終了を確認し、最新の実績を表示しました。');return latest;
      }
    }
    if(!disposed)emit('waiting','同期の終了はまだ確認できていません。保存済みの実績を表示しています。少し待って「状態を再読み込み」で確認してください。');
    return snapshot;
  }
  function execute(action){
    if(pending)return pending;
    const operation=Promise.resolve().then(action).catch(error=>{emit('error',error.message);return snapshot;}).finally(()=>{if(pending===operation)pending=null;});
    pending=operation;return operation;
  }
  return {
    refresh(){return execute(async()=>{emit('loading','サーバーに保存された実績を読み込んでいます。');const latest=await read();if(latest.job?.status==='running')return waitForCompletion(latest);const failed=latest.job?.status==='error'||latest.scheduler?.status==='error'||latest.integrations.some(row=>row.status==='error');emit(failed?'attention':'ready',failed?'直近の自動取得に問題があります。最後に取得できた実績を表示しています。':'サーバーに保存された実績を表示しています。');return latest;});},
    sync(){return execute(async()=>{
      emit('loading','同期状態を確認しています。');const before=await read();if(before.job?.status==='running')return waitForCompletion(before);
      if(!before.configuration.ga4Configured&&!before.configuration.gscConfigured){emit('attention','サーバー連携の設定準備中です。設定完了後に同期できます。');return before;}
      emit('syncing','サーバーに同期を依頼しています。');const response=await request('/api/seo/sync','POST');if(!response||response.status!=='queued')throw new Error('同期の開始を確認できませんでした。状態を再読み込みしてください。');
      return waitForCompletion(before);
    });},
    getSnapshot:()=>snapshot,getStatus:()=>status,isBusy:()=>Boolean(pending),dispose(){disposed=true;},
  };
}
