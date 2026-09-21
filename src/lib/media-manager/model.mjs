import {parseCsv, csvString, isDate} from '../seo-manager/model.mjs';
export {parseCsv, csvString};
export const VERSION = 1;
export const MAX_FILE = 20 * 1024 * 1024;
export const STATUS = {idea:'企画案',research:'調査中',writing:'執筆中',review:'確認中',published:'公開済み',hold:'保留'};
export const PRIORITY = {high:'高',normal:'通常',low:'低'};
export const METRICS = ['views','users','sessions','cta','inquiries','documents','clicks','impressions','ctr','position'];
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw new Error(message);};
const str = (value,max=5000) => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : fail('文字列の形式または長さが正しくありません。');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const isoTime = value => typeof value === 'string' && value.length < 50 && Number.isFinite(Date.parse(value)) ? value : fail('取得日時が正しくありません。');
const period = (start,end) => isDate(start) && isDate(end) && start <= end ? {start,end} : fail('集計期間を正しく指定してください。');
export const normalizeKeyword = value => String(value).normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
export function checkStateSize(state) {
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_FILE - 2048) fail('保存データが20MBの上限に達しました。バックアップを保存してから実績を整理してください。');
}
export function emptyMediaState() {
  return {kind:'ltori-media',version:VERSION,revision:0,updatedAt:null,plans:[],edits:{},volumeReports:[],analyticsReports:[],searchReports:[]};
}
const PLAN_HEADERS = {id:['ID','id'],month:['公開月','month'],priority:['優先度','priority'],segment:['分類','segment'],keyword:['主キーワード案','キーワード','keyword'],title:['記事タイトル案','タイトル','title'],need:['需要段階','need'],category:['カテゴリー','category'],intent:['解決する問い','intent'],material:['独自素材・構成','material'],next:['関連記事ID','next'],cta:['読後の導線','cta'],relatedKeywords:['関連キーワード案','relatedKeywords'],evidence:['確認先ID','evidence'],gate:['公開前の条件','gate'],status:['進行状況','status']};
function planMonth(value) {
  if(!value || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))return value;
  const slash=value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/),date=slash?`${slash[1]}-${slash[2].padStart(2,'0')}-${slash[3].padStart(2,'0')}`:value;
  if(isDate(date))return date.slice(0,7);
  fail('公開月はYYYY-MMまたは実在する日付（YYYY/MM/DD）で指定してください。');
}
function validatePlans(rows) {
  if (!Array.isArray(rows) || rows.length > 20000) fail('記事企画は20,000件以内で指定してください。');
  const seen = new Set();
  return rows.map(row=>{
    if (!plain(row) || !validId(row.id) || seen.has(row.id)) fail('記事IDが不正または重複しています。');
    seen.add(row.id);
    const clean = {};
    for (const key of Object.keys(PLAN_HEADERS)) clean[key] = str(row[key] ?? '',key === 'id' ? 80 : 5000).trim();
    if (!clean.keyword || clean.keyword.length > 200 || /[\r\n]/u.test(clean.keyword) || !clean.title || clean.title.length > 1000) fail('主キーワード（200文字以内・1行）と記事タイトルが必要です。');
    clean.month=planMonth(clean.month);
    return clean;
  });
}
export function plansFromRows(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_FILE) fail('ファイルは20MB以内で指定してください。');
    input = parseCsv(input);
  }
  if (plain(input)) input = input.articles;
  if (!Array.isArray(input)) fail('記事企画のCSVまたはJSONを指定してください。');
  if (!input.length || !Array.isArray(input[0])) return validatePlans(input);
  // Google values.get may return trailing empty cells omitted; header-based access handles them.
  const headerIndex = input.findIndex(row=>Array.isArray(row) && row.some(cell=>['ID','id'].includes(String(cell))) && row.some(cell=>PLAN_HEADERS.keyword.includes(String(cell))));
  if (headerIndex < 0) fail('記事企画のID・主キーワード案・記事タイトル案の見出しが必要です。');
  const header = input[headerIndex], columns = {};
  for (const [key,aliases] of Object.entries(PLAN_HEADERS)) {
    const hits = header.map((cell,i)=>aliases.includes(String(cell).trim())?i:-1).filter(i=>i>=0);
    if (hits.length > 1) fail(`記事企画の${key}列が重複しています。`);
    columns[key] = hits[0] ?? -1;
  }
  if (['id','keyword','title'].some(key=>columns[key] < 0)) fail('ID・主キーワード案・記事タイトル案の列が必要です。');
  return validatePlans(input.slice(headerIndex+1).filter(row=>row.some(cell=>String(cell).trim())).map(row=>Object.fromEntries(Object.keys(PLAN_HEADERS).map(key=>[key,columns[key]<0?'':String(row[columns[key]]??'')]))));
}
export function mergePlans(state,plans) {
  const incoming = validatePlans(plans), byId = new Map(state.plans.map(row=>[row.id,row]));
  for (const row of incoming) byId.set(row.id,row);
  const next = {...state,plans:[...byId.values()]}; checkStateSize(next); return next;
}
export function planEdit(state,id) {
  const plan = state.plans.find(row=>row.id===id);
  const status = Object.entries(STATUS).find(([,label])=>label===plan?.status)?.[0] || 'idea';
  return {status,priority:'normal',notes:'',url:'',...(state.edits[id] || {})};
}
function safeArticlePath(value) {
  try {
    if (typeof value !== 'string' || !value || /[\s\\]/u.test(value)) return null;
    // Reject dot-segments, extra slashes and encoded aliases before URL normalizes them.
    if (!/^(?:https:\/\/layr\.co\.jp)?\/service\/ltori\/media\/[a-z0-9][a-z0-9-]*\/?$/.test(value)) return null;
    const url = new URL(value,'https://layr.co.jp');
    if (url.origin !== 'https://layr.co.jp' || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/,'')+'/';
    if (!/^\/service\/ltori\/media\/[a-z0-9][a-z0-9-]*\/$/.test(path) || /\/(?:about|contact|category)\/$/.test(path)) return null;
    return path;
  } catch {return null;}
}
export function canonicalArticlePath(value,catalog) {
  const path=safeArticlePath(value);
  return path && catalog.some(page=>page.path===path && (!page.publication || page.publication==='published')) ? path : null;
}
export function validatePlanEdit(value,catalog,{allowHistorical=false}={}) {
  if (!plain(value) || !Object.hasOwn(STATUS,value.status) || !Object.hasOwn(PRIORITY,value.priority)) fail('制作状態または優先度が正しくありません。');
  const url = str(value.url ?? '',1000).trim();
  const path = url ? (allowHistorical?safeArticlePath(url):canonicalArticlePath(url,catalog)) : '';
  if (url && !path) fail('公開URLには公開済み記事一覧にある本番URLを指定してください。');
  return {status:value.status,priority:value.priority,notes:str(value.notes ?? '',5000),url:path ? `https://layr.co.jp${path}` : ''};
}
export function parseVolume(value) {
  const raw = str(String(value ?? ''),200).trim(), normalized = raw.normalize('NFKC').replaceAll(',','');
  const base = {volume:null,lower:null,upper:null,raw};
  if (!normalized || /^(?:[-—–―]|n\/a|na|null|未取得|未測定|不明)$/i.test(normalized)) return {...base,status:'unknown'};
  if (/^\d+$/.test(normalized)) {
    const volume = Number(normalized);
    if (!integer(volume)) fail('月間検索数は0以上の安全な整数で指定してください。');
    return {...base,status:'measured',volume};
  }
  const range = normalized.match(/^(\d+)\s*(?:〜|~|～|–|—|-)\s*(\d+)$/u);
  if (range) {
    const lower = Number(range[1]),upper = Number(range[2]);
    if (!integer(lower) || !integer(upper) || lower > upper) fail('検索数の範囲が正しくありません。');
    return {...base,status:'range',lower,upper};
  }
  fail('検索数は整数・範囲（10〜100）・空欄で指定してください。負数や推定値には変換しません。');
}
const volumeConditionKeys = ['source','country','language','network','matchType'];
export const volumeIdentity = report => JSON.stringify([...volumeConditionKeys.map(key=>report[key]),report.periodStart,report.periodEnd,report.fetchedAt]);
function volumeMeta(meta) {
  if (!plain(meta)) fail('検索数の調査条件が必要です。');
  period(meta.periodStart,meta.periodEnd);
  const clean = {periodStart:meta.periodStart,periodEnd:meta.periodEnd,fetchedAt:isoTime(meta.fetchedAt ?? new Date().toISOString())};
  for (const key of volumeConditionKeys) {clean[key]=str(meta[key],200).trim();if(!clean[key])fail('取得元・地域・言語・検索網・マッチ種別を指定してください。');}
  if(meta.sourceUrl!==undefined) {
    const value=str(meta.sourceUrl,1000);let url;
    try{url=new URL(value);}catch{fail('取得元のURLが正しくありません。');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('取得元URLはクエリや認証情報を含まないHTTPS URLにしてください。');
    clean.sourceUrl=url.href;
  }
  if(meta.notes!==undefined) {
    if(!Array.isArray(meta.notes)||meta.notes.length>20)fail('検索数の注記が正しくありません。');
    clean.notes=meta.notes.map(note=>str(note,1000));
  }
  return clean;
}
function validateVolumeReport(input) {
  if (!plain(input) || !Array.isArray(input.rows) || !input.rows.length || input.rows.length>20000 || (input.conflicts && (!Array.isArray(input.conflicts) || input.conflicts.length))) fail('重複・競合を解消した検索数レポートを指定してください。');
  const report = {...volumeMeta(input),rows:[]}, seen=new Set();
  for (const row of input.rows) {
    if (!plain(row)) fail('検索数の行が正しくありません。');
    const keyword = str(row.keyword,200).trim(), key=normalizeKeyword(keyword), parsed=parseVolume(row.raw);
    if (!key || /[\r\n]/u.test(keyword) || seen.has(key)) fail('検索キーワードが空または重複しています。');
    for (const field of ['status','volume','lower','upper']) if (row[field]!==parsed[field]) fail('検索数の状態と元データが一致しません。');
    seen.add(key);report.rows.push({keyword,...parsed});
  }
  report.id=volumeIdentity(report);return report;
}
export function volumeFromCsv(text,meta,plans=[]) {
  if (typeof text!=='string' || new TextEncoder().encode(text).byteLength>MAX_FILE) fail('CSVは20MB以内で指定してください。');
  const rows=parseCsv(text), norm=value=>normalizeKeyword(value).replaceAll(' ',''), header=rows[0].map(norm);
  const aliases={keyword:['keyword','keywords','キーワード','主キーワード案'],volume:['volume','searchvolume','avg.monthlysearches','averagemonthlysearches','月間検索数','月間検索ボリューム','検索ボリューム','月間平均検索ボリューム']};
  const columns={};
  for(const key of ['keyword','volume']) {
    const names=meta?.columns?.[key] ? [norm(meta.columns[key])] : aliases[key].map(norm);
    const hits=header.map((value,i)=>names.includes(value)?i:-1).filter(i=>i>=0);
    if(hits.length!==1)fail('キーワードと月間検索数の列を一意に指定してください。標準CSVはKeyword,Volumeです。');
    columns[key]=hits[0];
  }
  const report={...volumeMeta(meta),rows:[],conflicts:[]}, unmatched=[], conflicts=report.conflicts, known=new Set(plans.map(plan=>normalizeKeyword(plan.keyword))), seen=new Set();
  const summary={total:rows.length-1,matched:0,unmatched:0,measured:0,zero:0,range:0,unknown:0,conflicts:0};
  for(let i=1;i<rows.length;i++) {
    const keyword=str(rows[i][columns.keyword],200).trim(), key=normalizeKeyword(keyword);
    if(!key || /[\r\n]/u.test(keyword))fail(`${i+1}行目のキーワードが空または複数行です。`);
    const row={keyword,...parseVolume(rows[i][columns.volume])};
    if(seen.has(key)){conflicts.push({line:i+1,keyword,reason:'正規化したキーワードが重複しています。'});continue;}
    seen.add(key);report.rows.push(row);summary[row.status]++;
    if(row.status==='measured'&&row.volume===0)summary.zero++;
    if(known.has(key))summary.matched++;else unmatched.push({line:i+1,keyword});
  }
  summary.unmatched=unmatched.length;summary.conflicts=conflicts.length;report.id=volumeIdentity(report);
  return {report,unmatched,conflicts,summary};
}
// Internal previews use validated values directly; CSV exports intentionally escape
// leading '-'/'=' and must not be round-tripped as raw measurement data.
export function previewVolumeReport(input,plans=[]) {
  const report=validateVolumeReport(input),known=new Set(plans.map(plan=>normalizeKeyword(plan.keyword))),unmatched=[];
  const summary={total:report.rows.length,matched:0,unmatched:0,measured:0,zero:0,range:0,unknown:0,conflicts:0};
  report.rows.forEach((row,index)=>{
    summary[row.status]++;if(row.status==='measured'&&row.volume===0)summary.zero++;
    if(known.has(normalizeKeyword(row.keyword)))summary.matched++;else unmatched.push({line:index+2,keyword:row.keyword});
  });
  summary.unmatched=unmatched.length;return {report,unmatched,conflicts:[],summary};
}
function putReport(state,key,report) {
  const reports=state[key].filter(row=>row.id!==report.id);
  if(reports.length>=60 || reports.reduce((sum,row)=>sum+row.rows.length,0)+report.rows.length>100000)fail('実績の保存上限（60レポート・100,000行）に達しました。');
  const next={...state,[key]:[report,...reports]};checkStateSize(next);return next;
}
export function applyVolumeReport(state,report) {return putReport(state,'volumeReports',validateVolumeReport(report));}
export function rankPlans(plans,report=null,edits={},sort='volume') {
  if(Array.isArray(report))fail('同じ調査条件のレポートを1件選んでください。');
  const lookup=new Map((report?.rows||[]).map(row=>[normalizeKeyword(row.keyword),row]));
  const rows=plans.map(plan=>({...plan,edit:planEdit({plans,edits},plan.id),volume:lookup.get(normalizeKeyword(plan.keyword))||null}));
  return rows.sort((a,b)=>{
    if(sort==='volume') {
      const order=row=>row.volume?.status==='measured'?0:row.volume?.status==='range'?1:2;
      if(order(a)!==order(b))return order(a)-order(b);
      if(order(a)===0 && a.volume.volume!==b.volume.volume)return b.volume.volume-a.volume.volume;
    }
    return a.id.localeCompare(b.id,'en',{numeric:true});
  });
}
const analyticsIdentity = row => JSON.stringify([row.origin,row.start,row.end,row.property,row.site]);
const searchIdentity = row => JSON.stringify([row.kind,row.start,row.end,row.site]);
function reportMeta(input) {
  if(!plain(input))fail('実績の形式が正しくありません。');
  const out={...period(input.start,input.end),site:str(input.site,300),importedAt:isoTime(input.importedAt)};
  if(!['sc-domain:layr.co.jp','https://layr.co.jp/'].includes(out.site))fail('実績の対象サイトが異なります。');
  if(!Array.isArray(input.notes) || input.notes.length>50)fail('実績の注記が正しくありません。');
  out.notes=input.notes.map(note=>str(note,1000));return out;
}
function metric(value,key) {
  if(value===null || value===undefined)return null;
  if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>Number.MAX_SAFE_INTEGER || (!['position','ctr'].includes(key)&&!integer(value)) || (key==='position'&&value<1) || (key==='ctr'&&value>1)) fail('アクセス実績の数値が正しくありません。');
  return value;
}
function cleanMetrics(row,keys) {
  const clean=Object.fromEntries(keys.filter(key=>key!=='ctr').map(key=>[key,metric(row[key],key)]));
  if(keys.includes('ctr')) clean.ctr=clean.impressions>0 && clean.clicks!==null ? clean.clicks/clean.impressions : null;
  if(clean.impressions!==null && clean.clicks!==null && clean.clicks>clean.impressions)fail('検索クリック数が表示回数を超えています。');
  return clean;
}
const articleIds = catalog => new Set(catalog.filter(page=>canonicalArticlePath(page.path,catalog)).map(page=>page.id));
const safeHistoricalId = value => typeof value==='string' && value.length<=200 && /^[a-z0-9][a-z0-9-]*$/.test(value) && !['about','contact','category','constructor','prototype'].includes(value);
export function validateMediaAnalyticsReport(input,catalog,{allowHistorical=false}={}) {
  const out=reportMeta(input);
  if(!['google','csv'].includes(input.origin) || !Array.isArray(input.rows) || input.rows.length>20000)fail('記事アクセス実績の形式が正しくありません。');
  Object.assign(out,{origin:input.origin,property:str(input.property,100),gaTimezone:str(input.gaTimezone,100)});
  if(out.origin==='google'&&!/^\d+$/.test(out.property))fail('GA4実績のプロパティIDが正しくありません。');
  const ids=articleIds(catalog),seen=new Set();
  out.rows=input.rows.map(row=>{
    if(!plain(row) || (!ids.has(row.pageId)&&!(allowHistorical&&safeHistoricalId(row.pageId))) || seen.has(row.pageId))fail('アクセス実績の記事が不明または重複しています。総ユーザー数は合算できません。');
    seen.add(row.pageId);return {pageId:row.pageId,...cleanMetrics(row,METRICS)};
  });
  out.id=analyticsIdentity(out);return out;
}
export function validateMediaSearchReport(input,catalog,{allowHistorical=false}={}) {
  const out={...reportMeta(input),kind:input.kind};
  if(!['pages','queries'].includes(out.kind) || !Array.isArray(input.rows) || input.rows.length>100000)fail('検索実績の形式が正しくありません。');
  const ids=articleIds(catalog),seen=new Set();
  out.rows=input.rows.map(row=>{
    if(!plain(row) || (!ids.has(row.pageId)&&!(allowHistorical&&safeHistoricalId(row.pageId))))fail('検索実績の記事が見つかりません。');
    const query=out.kind==='queries'?str(row.query,2000):'',key=JSON.stringify([row.pageId,query]);
    if((out.kind==='queries'&&!query.trim()) || seen.has(key))fail('検索クエリが空または行が重複しています。');
    seen.add(key);return {pageId:row.pageId,...(out.kind==='queries'?{query}:{}),...cleanMetrics(row,['clicks','impressions','ctr','position'])};
  });
  out.id=searchIdentity(out);return out;
}
export function applyAnalyticsReport(state,report,catalog,options) {return putReport(state,'analyticsReports',validateMediaAnalyticsReport(report,catalog,options));}
export function applySearchReport(state,report,catalog,options) {return putReport(state,'searchReports',validateMediaSearchReport(report,catalog,options));}
export function joinMediaMetrics(plans,report,catalog,edits={},searchReport=null) {
  if(searchReport && (searchReport.kind!=='pages' || searchReport.start!==report?.start || searchReport.end!==report?.end))fail('同じ期間のページ別検索実績を選んでください。クエリ別の実績は合算しません。');
  const byPath=new Map(catalog.map(page=>[page.path,page])), ga=new Map((report?.rows||[]).map(row=>[row.pageId,row])), search=new Map((searchReport?.rows||[]).map(row=>[row.pageId,row]));
  return plans.map(plan=>{
    const path=canonicalArticlePath(edits[plan.id]?.url,catalog), page=path?byPath.get(path):null;
    const metrics=Object.fromEntries(METRICS.map(key=>[key,ga.get(page?.id)?.[key]??null]));
    if(searchReport)for(const key of ['clicks','impressions','ctr','position'])metrics[key]=search.get(page?.id)?.[key]??null;
    return {...plan,page,metrics};
  });
}
export function validateMediaBackup(input,catalog) {
  if(typeof input==='string') {
    if(new TextEncoder().encode(input).byteLength>MAX_FILE)fail('バックアップは20MB以内で指定してください。');
    try{input=JSON.parse(input);}catch{fail('JSONバックアップを読み込めません。');}
  }
  checkStateSize(input);
  if(!plain(input) || input.kind!=='ltori-media' || input.version!==VERSION || !plain(input.edits))fail('エルトリメディア管理のバージョン1のバックアップを指定してください。');
  let state={...emptyMediaState(),plans:validatePlans(input.plans)};
  const ids=new Set(state.plans.map(plan=>plan.id));
  // Publication can change after a report was saved. Keep safe historical references
  // recoverable while current edits, fetches and visible joins still use today's catalog.
  for(const [id,edit] of Object.entries(input.edits)){if(!ids.has(id))fail('企画にない編集データが含まれています。');state.edits[id]=validatePlanEdit(edit,catalog,{allowHistorical:true});}
  for(const [key,apply] of [['volumeReports',applyVolumeReport],['analyticsReports',applyAnalyticsReport],['searchReports',applySearchReport]]) {
    if(!Array.isArray(input[key]) || input[key].length>60)fail('バックアップの実績一覧が正しくありません。');
    const seen=new Set();
    for(const report of [...input[key]].reverse()) {
      state=apply(state,report,catalog,{allowHistorical:true});const id=state[key][0].id;
      if(seen.has(id))fail('同じ条件の実績が重複しています。');seen.add(id);
    }
  }
  state.updatedAt=input.updatedAt===null?null:isoTime(input.updatedAt);checkStateSize(state);return state;
}
