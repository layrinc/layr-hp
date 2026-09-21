import {GOOGLE_SCOPES,validateConnection} from '../seo-manager/google-analytics.mjs';
import {isDate} from '../seo-manager/model.mjs';
import {canonicalArticlePath,plansFromRows,validateMediaAnalyticsReport,validateMediaSearchReport} from './model.mjs';
export {GOOGLE_SCOPES,validateConnection};
export const SHEETS_SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEET_ID='1LQdDfofB6CCsgezFxs_A5A17bnBgNLzSTufVVYvpcgM';
const MEDIA_PREFIX='/service/ltori/media/';
const GA_PAGE=10000,GSC_PAGE=25000,MAX_ROWS=100000;
function checkPeriod(start,end){if(!isDate(start)||!isDate(end)||start>end)throw new Error('集計期間を正しく指定してください。');}
function checkArgs({config,token,start,end,catalog}) {
  validateConnection(config);checkPeriod(start,end);
  if(typeof token!=='string'||!token)throw new Error('Googleに接続してください。');
  if(!Array.isArray(catalog))throw new Error('公開記事一覧を読み込めませんでした。');
}
const filter=(fieldName,value,matchType='EXACT')=>({filter:{fieldName,stringFilter:{value,matchType,caseSensitive:true}}});
export function mediaGaRequest(kind,start,end) {
  checkPeriod(start,end);
  const config={views:['pagePath',['screenPageViews','totalUsers'],MEDIA_PREFIX],sessions:['landingPage',['sessions'],MEDIA_PREFIX],cta:['pagePath',['eventCount'],MEDIA_PREFIX,'ltori_media_cta_click'],inquiry:['pagePathPlusQueryString',['eventCount'],'/contact/','ltori_media_inquiry_complete'],document:['pagePathPlusQueryString',['eventCount'],'/document/ltori-service/','ltori_media_document_complete']}[kind];
  if(!config)throw new Error('取得するGA4実績の種類が正しくありません。');
  const [dimension,metrics,path,event]=config,expressions=[filter('hostName','layr.co.jp'),filter(dimension,path,'BEGINS_WITH')];
  if(event)expressions.push(filter('eventName',event));
  return {dateRanges:[{startDate:start,endDate:end}],dimensions:[{name:dimension}],metrics:metrics.map(name=>({name})),dimensionFilter:{andGroup:{expressions}},orderBys:[{dimension:{dimensionName:dimension}}],limit:String(GA_PAGE),offset:'0',keepEmptyRows:true};
}
export function mediaSearchRequest(kind,start,end,startRow=0) {
  checkPeriod(start,end);
  if(!['pages','queries'].includes(kind)||!Number.isSafeInteger(startRow)||startRow<0)throw new Error('検索実績の取得条件が正しくありません。');
  return {startDate:start,endDate:end,type:'web',dataState:'final',dimensions:kind==='queries'?['page','query']:['page'],rowLimit:GSC_PAGE,startRow,dimensionFilterGroups:[{filters:[{dimension:'page',operator:'contains',expression:`https://layr.co.jp${MEDIA_PREFIX}`}]}]};
}
function statusError(status) {
  return new Error(status===401?'Googleの接続期限が切れました。再接続してください。':status===403?'閲覧権限とAPIの有効化を確認してください（403）。':status===429?'Google APIの利用上限です。時間を置いて再取得してください。':`Google APIの取得に失敗しました（${status}）。設定と期間を確認してください。`);
}
async function request(fetcher,url,token,body,timeoutMs) {
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Google APIの取得がタイムアウトしました。再取得してください。'));},timeoutMs);});
  const operation=(async()=>{
    let response;
    try{response=await fetcher(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});}
    catch{throw new Error(controller.signal.aborted?'Google APIの取得がタイムアウトしました。再取得してください。':'Google APIへ接続できません。ネットワークを確認してください。');}
    if(!response.ok)throw statusError(response.status);
    let data;try{data=await response.json();}catch{throw new Error('Google APIの応答を読み込めませんでした。再取得してください。');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Google APIの応答形式が正しくありません。');
    return data;
  })();
  try{return await Promise.race([operation,timeout]);}finally{clearTimeout(timer);}
}
const number=value=>{
  if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))throw new Error('Google APIの実績数値が正しくありません。');
  const n=Number(value);if(value===null||value===undefined||typeof value==='boolean'||!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw new Error('Google APIの実績数値が正しくありません。');return n;
};
function rowArray(data){if(data.rows!==undefined&&!Array.isArray(data.rows))throw new Error('Google APIの行データが正しくありません。');return data.rows||[];}
function metadataNotes(metadata={}) {
  const notes=[];
  if(metadata.subjectToThresholding)notes.push('プライバシーしきい値の影響があります。');
  if(metadata.dataLossFromOtherRow)notes.push('高カーディナリティによる集約の影響があります。');
  if(metadata.samplingMetadatas?.length)notes.push('サンプリングの影響があります。');
  return notes;
}
async function gaPages(kind,args) {
  const {config,token,start,end,fetcher,timeoutMs}=args,body=mediaGaRequest(kind,start,end),rows=[],notes=new Set();let gaTimezone='',expectedCount;
  for(let offset=0;offset<MAX_ROWS;offset+=GA_PAGE) {
    const data=await request(fetcher,`https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`,token,{...body,offset:String(offset)},timeoutMs);
    const page=rowArray(data),count=number(data.rowCount??page.length);
    if(!Number.isSafeInteger(count)||count>MAX_ROWS||page.length>GA_PAGE)throw new Error('GA4の取得上限（100,000行）を超えました。期間を短くしてください。');
    if(expectedCount!==undefined&&count!==expectedCount)throw new Error('取得中にGA4の行数が変化しました。同じ期間で再取得してください。');
    expectedCount=count;
    if(data.metadata?.timeZone)gaTimezone=String(data.metadata.timeZone);
    for(const note of metadataNotes(data.metadata))notes.add(note);
    rows.push(...page);
    if(rows.length>=count)return {rows,gaTimezone,notes:[...notes]};
    if(page.length!==GA_PAGE)throw new Error('GA4の全行を取得できませんでした。再取得してください。');
  }
  throw new Error('GA4の取得上限に達しました。期間を短くしてください。');
}
async function gscPages(kind,args) {
  const {config,token,start,end,fetcher,timeoutMs}=args,rows=[];
  for(let offset=0;offset<MAX_ROWS;offset+=GSC_PAGE) {
    const data=await request(fetcher,`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.site)}/searchAnalytics/query`,token,mediaSearchRequest(kind,start,end,offset),timeoutMs),page=rowArray(data);
    if(page.length>GSC_PAGE)throw new Error('Search Consoleの応答行数が上限を超えました。');
    rows.push(...page);if(page.length<GSC_PAGE)return rows;
  }
  throw new Error('Search Consoleの取得上限（100,000行）に達しました。期間を短くしてください。');
}
// Only the validated article identifier survives attribution; raw query strings are never stored.
export function mediaSourcePageId(value,kind,catalog) {
  try {
    const url=new URL(value,'https://layr.co.jp');
    if(url.origin!=='https://layr.co.jp'||url.username||url.password)return null;
    const expected=kind==='inquiry'?'/contact/':kind==='document'?'/document/ltori-service/':null;
    if(!expected||url.pathname.replace(/\/$/,'')+'/'!==expected||url.searchParams.getAll('source').length!==1)return null;
    if(kind==='inquiry'&&(url.searchParams.getAll('service').length!==1||url.searchParams.get('service')!=='ltori'))return null;
    const source=url.searchParams.get('source');
    if(!/^media\/[a-z0-9][a-z0-9-]*$/.test(source||''))return null;
    const path=canonicalArticlePath(`/service/ltori/${source}/`,catalog);
    return path?catalog.find(page=>page.path===path)?.id||null:null;
  }catch{return null;}
}
function cleanGa(kind,data,catalog) {
  const byPath=new Map(catalog.map(page=>[page.path,page.id])),rows=new Map(),seen=new Set();
  for(const item of data.rows) {
    const raw=item.dimensionValues?.[0]?.value;
    if(typeof raw!=='string')throw new Error('GA4のページ項目が見つかりません。');
    if(seen.has(raw))throw new Error('GA4の行が重複しています。合算せず、再取得してください。');seen.add(raw);
    const id=['inquiry','document'].includes(kind)?mediaSourcePageId(raw,kind,catalog):byPath.get(canonicalArticlePath(raw,catalog));
    if(!id)continue;
    const metricValues=item.metricValues?.map(value=>number(value.value));
    if(!metricValues||metricValues.length!==(kind==='views'?2:1)||metricValues.some(value=>!Number.isSafeInteger(value)))throw new Error('GA4の指標数値が正しくありません。');
    if(kind==='views') {
      if(rows.has(id))throw new Error('同じ記事に複数のURLがあり、総ユーザー数を合算できません。URLの正規化を確認してください。');
      rows.set(id,{pageId:id,views:metricValues[0],users:metricValues[1]});
    }else {
      const field={sessions:'sessions',cta:'cta',inquiry:'inquiries',document:'documents'}[kind];
      if(!rows.has(id))rows.set(id,{pageId:id,[field]:0});
      rows.get(id)[field]+=metricValues[0];
    }
  }
  return [...rows.values()];
}
function cleanSearch(kind,rows,args) {
  const byPath=new Map(args.catalog.map(page=>[page.path,page.id])),clean=[];
  for(const row of rows) {
    if(!Array.isArray(row.keys)||row.keys.length!==(kind==='queries'?2:1))throw new Error('Search Consoleのディメンションが正しくありません。');
    const id=byPath.get(canonicalArticlePath(row.keys[0],args.catalog));if(!id)continue;
    const impressions=number(row.impressions);
    clean.push({pageId:id,...(kind==='queries'?{query:row.keys[1]}:{}),clicks:number(row.clicks),impressions,position:impressions?number(row.position):null});
  }
  return validateMediaSearchReport({kind,start:args.start,end:args.end,site:args.config.site,importedAt:new Date().toISOString(),notes:['Search Consoleは米国太平洋時間で集計され、上位行のみが返ります。すべての検索語を網羅するレポートではありません。','検索表示回数は自社ページの表示実績です。市場全体の月間検索数には換算しません。'],rows:clean},args.catalog);
}
export async function fetchMediaReport(options) {
  const args={fetcher:globalThis.fetch,timeoutMs:30000,...options};checkArgs(args);
  const kinds=['views','sessions','cta','inquiry','document'],names=['GA4閲覧','GA4流入','GA4 CTAクリック','GA4相談送信','GA4資料請求','Search Consoleページ別'];
  const requests=kinds.map(kind=>(async()=>{const result=await gaPages(kind,args);return {rows:cleanGa(kind,result,args.catalog),notes:result.notes,gaTimezone:result.gaTimezone};})());
  requests.push((async()=>{const result=cleanSearch('pages',await gscPages('pages',args),args);return {rows:result.rows,notes:result.notes};})());
  const outcomes=await Promise.allSettled(requests),rows=new Map(),notes=[];let successes=0,gaTimezone='';
  outcomes.forEach((out,index)=>{
    if(out.status==='rejected'){notes.push(`${names[index]}：${out.reason.message}`);return;}
    successes++;if(out.value.gaTimezone)gaTimezone=out.value.gaTimezone;
    notes.push(...out.value.notes.map(note=>`${names[index]}：${note}`));
    for(const row of out.value.rows)rows.set(row.pageId,{...rows.get(row.pageId),...row});
  });
  if(!successes)throw new Error(notes.join('\n'));
  notes.push('行が返らない記事・取得に失敗した指標は「—」です。未計測・反映待ち・ゼロを区別できないため0に補完しません。','総ユーザー数は記事をまたいで合計しません。GA4とSearch Consoleはタイムゾーン・集計方法が異なります。');
  return validateMediaAnalyticsReport({origin:'google',start:args.start,end:args.end,property:args.config.property,site:args.config.site,gaTimezone:gaTimezone||'プロパティの設定',importedAt:new Date().toISOString(),notes,rows:[...rows.values()]},args.catalog);
}
export async function fetchMediaSearchQueries(options) {
  const args={fetcher:globalThis.fetch,timeoutMs:30000,...options};checkArgs(args);
  return cleanSearch('queries',await gscPages('queries',args),args);
}
export async function fetchMediaPlans({token,fetcher=globalThis.fetch,timeoutMs=30000}) {
  if(typeof token!=='string'||!token)throw new Error('スプレッドシートの読み取り接続を開始してください。');
  const range=encodeURIComponent("'記事企画'!A5:AZ1000"),data=await request(fetcher,`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`,token,null,timeoutMs);
  if(!Array.isArray(data.values)||!data.values.length)throw new Error('記事企画シートに読み込める行がありません。');
  return plansFromRows(data.values);
}
