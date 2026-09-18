import {validateAnalyticsReport} from './analytics-model.mjs';
export const VERSION = 1;
export const PATTERNS = ['採用LINE', '採用LINE 構築', '採用LINE 運用代行', 'LINE 採用支援', 'Lステップ 採用'];
export const STATUS = {unreviewed:'未確認', monitoring:'計測中', improving:'改善中', done:'対応済み'};
export const PRIORITY = {high:'高', normal:'通常', low:'低'};
export const INDEX = {unknown:'未確認', indexed:'登録済み', excluded:'未登録', unpublished:'未公開'};
export const MAX_FILE = 20 * 1024 * 1024;
export function checkStateSize(state) {
  if(new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_FILE - 2048) throw new Error('保存データが20MBの上限に達しました。バックアップ後、不要な検索実績を削除してください。');
}
export const normalizeQuery = value => String(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const str = (value, max=5000) => typeof value === 'string' && value.length <= max ? value : fail('文字列の形式または長さが正しくありません。');
export const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function catalogFromAreas(areas) {
  return areas.map(area => ({id:area.code || `pref-${area.slug}`, name:area.name, fullName:area.fullName, prefecture:area.prefectureSlug, prefectureName:area.prefectureName, kind:area.kind, path:`/service/ltori/area/${area.slug}/`}));
}
export function emptyState() { return {version:VERSION, revision:0, updatedAt:null, pages:{}, customKeywords:[], pausedKeywords:[], reports:[], analyticsReports:[]}; }
export function pageEdit(state, id) { return {status:'unreviewed', priority:'normal', indexStatus:'unknown', owner:'', dueDate:'', nextAction:'', notes:'', ...(state.pages[id] || {})}; }
export function keywordsFor(catalog, state) {
  return [...catalog.flatMap(page => PATTERNS.map((term, i) => ({id:`${page.id}:${i}`, pageId:page.id, query:`${page.fullName} ${term}`, custom:false}))), ...state.customKeywords.map(row=>({...row,custom:true}))];
}
export function validateEdit(value) {
  if (!plain(value) || !Object.hasOwn(STATUS,value.status) || !Object.hasOwn(PRIORITY,value.priority) || !Object.hasOwn(INDEX,value.indexStatus)) fail('対応状況の形式が正しくありません。');
  const edit = {status:value.status,priority:value.priority,indexStatus:value.indexStatus,owner:str(value.owner,100),dueDate:str(value.dueDate,10),nextAction:str(value.nextAction,300),notes:str(value.notes,5000)};
  if (edit.dueDate && !isDate(edit.dueDate)) fail('期限の日付が正しくありません。');
  return edit;
}
export function addKeyword(state, catalog, pageId, query, id) {
  query = str(query,200).trim();
  if (!query || /[\u0000-\u001f]/u.test(query)) fail('キーワードは1行、200文字以内で入力してください。');
  if (!catalog.some(page=>page.id===pageId)) fail('対象ページが見つかりません。');
  if (keywordsFor(catalog,state).some(row=>row.pageId===pageId && normalizeQuery(row.query)===normalizeQuery(query))) fail('このページには同じキーワードが登録されています。');
  return {...state,customKeywords:[...state.customKeywords,{id:`custom-${id}`,pageId,query}]};
}
export function parseCsv(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE) fail('CSVは20MB以内で指定してください。');
  const input = text.replace(/^\uFEFF/,'');
  if (input.includes('\uFFFD') || input.includes('\0')) fail('文字コードをUTF-8にして保存してください。');
  const rows=[]; let row=[], cell='', quoted=false, closed=false;
  for (let i=0; i<input.length; i++) {
    const c=input[i];
    if (quoted) { if (c==='"') { if (input[i+1]==='"') {cell+='"';i++;} else {quoted=false;closed=true;} } else cell+=c; continue; }
    if (closed && ![',','\n','\r'].includes(c)) fail('引用符の後に不正な文字があります。');
    if (c==='"') { if (cell) fail('CSVの引用符が正しくありません。'); quoted=true; }
    else if (c===',') {row.push(cell);cell='';closed=false;}
    else if (c==='\n'||c==='\r') { if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';closed=false; }
    else cell+=c;
  }
  if(quoted)fail('CSVの引用符が閉じられていません。');
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);
  if(rows.length<2 || rows.length>20001)fail('CSVには見出しと1〜20,000行のデータが必要です。');
  if(rows.some(row=>row.length!==rows[0].length))fail('CSVの列数が行によって異なります。');
  return rows;
}
const HEADERS = {page:['page','pages','toppages','ページ','上位のページ'], query:['query','queries','topqueries','クエリ','上位のクエリ'], clicks:['clicks','クリック数'], impressions:['impressions','表示回数','インプレッション数'], position:['position','averageposition','掲載順位','平均掲載順位']};
function columns(header) {
  const out={};
  for (const [key, names] of Object.entries(HEADERS)) {
    const matches=header.map((v,i)=>names.includes(normalizeQuery(v))?i:-1).filter(i=>i>=0);
    if(matches.length>1)fail('比較形式のCSVには対応していません。単一期間でエクスポートしてください。');
    out[key]=matches[0] ?? -1;
  }
  if(out.clicks<0 || out.impressions<0 || out.position<0 || (out.page<0 && out.query<0)) fail('「ページ」または「クエリ」と、クリック数・表示回数・掲載順位の列が必要です。');
  if(out.page>=0 && out.query>=0)fail('ページ別・クエリ別CSVをそれぞれ取り込んでください。複合ディメンションは対象外です。');
  return out;
}
export function canonicalPath(value) {
  try {
    const url = new URL(value, 'https://layr.co.jp');
    if(url.origin!=='https://layr.co.jp' || url.username || url.password) return null;
    return url.pathname.replace(/\/+$/,'')+'/';
  } catch {return null;}
}
function number(value, line, label, integer=false) {
  const text=String(value).trim().replace(/,/g,'');
  if(!/^\d+(?:\.\d+)?$/.test(text))fail(`${line}行目の${label}が数値ではありません。`);
  const n=Number(text);
  if(!Number.isFinite(n)||n>Number.MAX_SAFE_INTEGER||(integer&&!Number.isInteger(n)))fail(`${line}行目の${label}が正しくありません。`);
  return n;
}
export function validateReportMeta(meta,catalog) {
  if(!isDate(meta.start)||!isDate(meta.end)||meta.start>meta.end)fail('集計期間を正しく指定してください。');
  if(!['web','image','video','news'].includes(meta.searchType))fail('検索タイプを選択してください。');
  const scopePageId=meta.scopePageId||'';
  if(scopePageId&&!catalog.some(page=>page.id===scopePageId))fail('絞り込みページが見つかりません。');
  const filter=str(meta.filter,200).trim();
  if(!filter)fail('国・デバイスなどの検索条件を記入してください。');
  return {start:meta.start,end:meta.end,searchType:meta.searchType,filter,scopePageId};
}
export const reportIdentity = report => JSON.stringify([report.kind,report.start,report.end,report.searchType,report.filter,report.scopePageId]);
export function createReport(text, meta, catalog) {
  const rows=parseCsv(text), c=columns(rows[0]), kind=c.page>=0?'pages':'queries';
  const clean=validateReportMeta(meta,catalog);
  if(kind==='pages' && clean.scopePageId)fail('ページ別CSVではページ絞り込みを「サイト全体」にしてください。');
  const byPath=new Map(catalog.map(page=>[page.path,page.id])), accepted=[], rejected=[], seen=new Set();
  for(let i=1;i<rows.length;i++) {
    const row=rows[i], clicks=number(row[c.clicks],i+1,'クリック数',true), impressions=number(row[c.impressions],i+1,'表示回数',true);
    const position=number(row[c.position],i+1,'掲載順位');
    if(impressions>0 && position<1)fail(`${i+1}行目の掲載順位は1以上である必要があります。`);
    const source=str(row[kind==='pages'?c.page:c.query],2000).trim();
    const pageId=kind==='pages'?byPath.get(canonicalPath(source)):clean.scopePageId;
    if(kind==='pages'&&!pageId) {rejected.push({line:i+1,value:source,reason:'地域LP台帳のURLではありません'});continue;}
    if(kind==='queries'&&(!source||source.length>200)) {rejected.push({line:i+1,value:source,reason:'クエリが空または200文字を超えています'});continue;}
    const key=kind==='pages'?pageId:normalizeQuery(source);
    if(seen.has(key))fail(`${i+1}行目が重複しています。単一期間・単一条件のCSVを指定してください。`);
    seen.add(key); accepted.push({pageId:pageId||'', query:kind==='queries'?source:'',clicks,impressions,position:impressions?position:null});
  }
  if(!accepted.length)fail('取り込める行がありません。地域LPの本番URLまたはクエリ別CSVを確認してください。');
  const report={...clean,kind,rows:accepted,fileName:str(meta.fileName||'手動CSV',200),importedAt:new Date().toISOString()};
  report.id=reportIdentity(report);
  return {report,rejected,total:rows.length-1};
}
export function putReport(state, report) {
  const reports=state.reports.filter(row=>row.id!==report.id);
  if(reports.length>=60 || reports.reduce((sum,r)=>sum+r.rows.length,0)+report.rows.length>100000)fail('保存上限（60実績・100,000行）に達しました。バックアップ後に古い実績を削除してください。');
  return {...state,reports:[report,...reports]};
}
export function reportSummary(report) {
  if(!report)return null;
  const totals=report.rows.reduce((a,row)=>({clicks:a.clicks+row.clicks,impressions:a.impressions+row.impressions}),{clicks:0,impressions:0});
  return {...totals,ctr:totals.impressions?totals.clicks/totals.impressions:null,count:report.rows.length};
}
export function metricLookup(report) {return new Map((report?.rows||[]).map(row=>[report.kind==='pages'?row.pageId:normalizeQuery(row.query),row]));}
export function queryMetric(keyword,report,lookup) {return report && (!report.scopePageId||report.scopePageId===keyword.pageId)?lookup.get(normalizeQuery(keyword.query)):undefined;}
export function csvString(rows) {
  const safe=value=>{let s=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n');
}
export function validateBackup(input,catalog) {
  if(!plain(input)||input.version!==VERSION||!plain(input.pages)||!Array.isArray(input.customKeywords)||!Array.isArray(input.reports))fail('このツールのバージョン1のJSONバックアップを指定してください。');
  const validIds=new Set(catalog.map(page=>page.id)), state=emptyState();
  for(const [id,edit] of Object.entries(input.pages)){if(!validIds.has(id))fail(`台帳にない地域が含まれます: ${id}`);state.pages[id]=validateEdit(edit);}
  if(input.customKeywords.length>20000)fail('追加キーワードが上限を超えています。');
  const seen=new Set(keywordsFor(catalog,state).map(row=>`${row.pageId}|${normalizeQuery(row.query)}`)), ids=new Set();
  for(const row of input.customKeywords) {
    if(!plain(row)||!validIds.has(row.pageId)||!/^custom-[a-zA-Z0-9-]{1,80}$/.test(row.id)||ids.has(row.id))fail('追加キーワードの形式が正しくありません。');
    const query=str(row.query,200).trim(),key=`${row.pageId}|${normalizeQuery(query)}`;
    if(!query||seen.has(key)||/[\u0000-\u001f]/u.test(query))fail('追加キーワードが空または重複しています。');
    seen.add(key);ids.add(row.id);state.customKeywords.push({id:row.id,pageId:row.pageId,query});
  }
  const allKeywordIds=new Set(keywordsFor(catalog,state).map(row=>row.id));
  const paused=input.pausedKeywords||[];
  if(!Array.isArray(paused)||new Set(paused).size!==paused.length||paused.some(id=>!allKeywordIds.has(id)))fail('保留キーワードの形式が正しくありません。');
  state.pausedKeywords=[...paused];
  const reportIds=new Set();
  for(const r of input.reports) {
    if(!plain(r)||!['pages','queries'].includes(r.kind)||!Array.isArray(r.rows)||!r.rows.length||r.rows.length>20000)fail('検索実績の形式が正しくありません。');
    const report={...validateReportMeta(r,catalog),kind:r.kind,fileName:str(r.fileName,200),importedAt:str(r.importedAt,50),rows:[]};
    if(!Number.isFinite(Date.parse(report.importedAt))||(report.kind==='pages'&&report.scopePageId))fail('検索実績の条件が正しくありません。');
    report.id=reportIdentity(report);
    if(reportIds.has(report.id))fail('実績が重複しています。');reportIds.add(report.id);
    const rowIds=new Set();
    for(const row of r.rows) {
      if(!plain(row)||typeof row.pageId!=='string'||typeof row.query!=='string')fail('検索実績の行形式が正しくありません。');
      const pageId=row.pageId, query=str(row.query,200);
      if((r.kind==='pages'&&(!validIds.has(pageId)||query))||(r.kind==='queries'&&(!query||pageId!==report.scopePageId)))fail('実績と対象ページが一致しません。');
      for(const field of ['clicks','impressions']) if(typeof row[field]!=='number'||!Number.isSafeInteger(row[field])||row[field]<0)fail('実績の数値が正しくありません。');
      if(row.impressions>0?(typeof row.position!=='number'||!Number.isFinite(row.position)||row.position<1||row.position>Number.MAX_SAFE_INTEGER):row.position!==null)fail('掲載順位が正しくありません。');
      const key=r.kind==='pages'?pageId:normalizeQuery(query);if(rowIds.has(key))fail('実績行が重複しています。');rowIds.add(key);
      report.rows.push({pageId,query,clicks:row.clicks,impressions:row.impressions,position:row.position});
    }
    state.reports.push(report);
  }
  if(state.reports.length>60||state.reports.reduce((sum,r)=>sum+r.rows.length,0)>100000)fail('検索実績の保存上限を超えています。');
  if (input.analyticsReports !== undefined && !Array.isArray(input.analyticsReports)) fail('アクセス実績の形式が正しくありません。');
  state.analyticsReports = (input.analyticsReports || []).map(r=>validateAnalyticsReport(r,catalog));
  if (state.analyticsReports.length>60 || state.analyticsReports.reduce((n,r)=>n+r.rows.length,0)>100000 || new Set(state.analyticsReports.map(r=>r.id)).size!==state.analyticsReports.length) fail('アクセス実績が重複または保存上限を超えています。');
  state.updatedAt=typeof input.updatedAt==='string'?input.updatedAt:null;
  state.revision=Number.isSafeInteger(input.revision)&&input.revision>=0?input.revision:0;
  return state;
}
