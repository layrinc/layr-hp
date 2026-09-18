import {canonicalPath, parseCsv, isDate, normalizeQuery} from './model.mjs';

export const METRICS = ['views','users','sessions','inquiries','clicks','impressions','position'];
const fail = message => {throw new Error(message);};
export function validatePeriod(start, end) {
  if (!isDate(start) || !isDate(end) || start > end) fail('集計期間を正しく指定してください。');
  return {start, end};
}
export const analyticsIdentity = r => JSON.stringify([r.start,r.end,r.property,r.site,r.origin]);
export function validateAnalyticsReport(input, catalog) {
  if (!input || !['google','csv'].includes(input.origin) || !Array.isArray(input.rows) || input.rows.length > 20000) fail('アクセス実績の形式が正しくありません。');
  const out = {...validatePeriod(input.start,input.end), origin:input.origin};
  for (const key of ['property','site','importedAt','gaTimezone']) {
    if (typeof input[key] !== 'string' || input[key].length > 300) fail('アクセス実績の設定が正しくありません。');
    out[key] = input[key];
  }
  if (!Number.isFinite(Date.parse(out.importedAt))) fail('取得日時が正しくありません。');
  if (!Array.isArray(input.notes) || input.notes.length > 20 || input.notes.some(n=>typeof n !== 'string' || n.length>1000)) fail('実績注記の形式が正しくありません。');
  out.notes = [...input.notes];
  const ids = new Set(catalog.map(p=>p.id)), seen = new Set();
  out.rows = input.rows.map(row=>{
    if (!ids.has(row.pageId) || seen.has(row.pageId)) fail('アクセス実績の地域が重複または不明です。');
    seen.add(row.pageId);
    const clean = {pageId:row.pageId};
    for (const key of METRICS) {
      const value = row[key] ?? null;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (key !== 'position' && !Number.isSafeInteger(value)))) fail('アクセス実績の数値が正しくありません。');
      if (key === 'position' && value !== null && value < 1) fail('平均掲載順位は1以上で指定してください。');
      clean[key] = value;
    }
    return clean;
  });
  out.id = analyticsIdentity(out);
  return out;
}
export function putAnalyticsReport(state, report) {
  const reports = (state.analyticsReports || []).filter(r=>r.id!==report.id);
  if (reports.length >= 60 || reports.reduce((s,r)=>s+r.rows.length,0)+report.rows.length>100000) fail('アクセス実績の保存上限に達しました。古い実績をバックアップしてから削除してください。');
  return {...state, analyticsReports:[report,...reports]};
}
export function inquiryPageId(value, catalog) {
  try {
    const url = new URL(value, 'https://layr.co.jp');
    if (url.origin !== 'https://layr.co.jp' || url.pathname.replace(/\/$/,'') !== '/contact' || url.searchParams.get('service') !== 'ltori') return null;
    const source = url.searchParams.get('source');
    return catalog.find(p=>p.path === `/service/ltori/${source}/`)?.id || null;
  } catch {return null;}
}
const headers = {
  path:['path','pagepath','pagepathandscreenclass','ページパス','ページパスとスクリーンクラス','ページパスとスクリーンクラス名'],
  views:['views','screenpageviews','表示回数','pv'], users:['totalusers','総ユーザー数'],
  sessions:['sessions','セッション','流入セッション'], inquiries:['inquiries','問い合わせ完了数'],
};
export function analyticsFromCsv(input, meta, catalog) {
  // GA4 exports can contain comment lines before the actual header.
  const source = input.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>!line.startsWith('#')).join('\n');
  const rows = parseCsv(source), columns = {};
  for (const [key,names] of Object.entries(headers)) {
    const hits = rows[0].map((h,i)=>names.includes(normalizeQuery(h))?i:-1).filter(i=>i>=0);
    if (hits.length>1) fail('同じ指標の列が複数あります。比較を解除してください。');
    columns[key] = hits[0] ?? -1;
  }
  if (columns.path<0 || Object.entries(columns).filter(([k,v])=>k!=='path'&&v>=0).length===0) fail('ページパスと、PV・総ユーザー数・流入セッション・問い合わせ完了数のいずれかの列が必要です。');
  const byPath = new Map(catalog.map(p=>[p.path,p.id])), accepted = [], seen = new Set();
  let excluded = 0;
  for (const row of rows.slice(1)) {
    const pageId = byPath.get(canonicalPath(row[columns.path]));
    if (!pageId) {excluded++; continue;}
    if (seen.has(pageId)) fail('同じ地域に複数行があります。日付・端末・クエリ文字列の内訳を外して再出力してください。総ユーザー数は行を足せません。');
    seen.add(pageId);
    const item = {pageId};
    for (const key of ['views','users','sessions','inquiries']) {
      const raw = columns[key]<0?'':row[columns[key]].trim().replaceAll(',','');
      if (raw && !/^\d+$/.test(raw)) fail(`${key} は0以上の整数か空欄で指定してください。`);
      item[key] = raw===''?null:Number(raw);
    }
    accepted.push(item);
  }
  if (!accepted.length) fail('対象の地域LPがありません。本番のページパスを確認してください。');
  return validateAnalyticsReport({...meta,origin:'csv',property:meta.property||'CSV',site:'https://layr.co.jp/',gaTimezone:meta.gaTimezone||'CSVの集計設定',importedAt:new Date().toISOString(),notes:[`CSV取り込み。対象外 ${excluded} 行。問い合わせ列は専用イベントの送信完了数を指定してください。`],rows:accepted},catalog);
}
export function joinedMetrics(report, gscReport, catalog) {
  if (gscReport && (gscReport.kind!=='pages' || gscReport.start!==report?.start || gscReport.end!==report?.end)) fail('同じ期間のページ別検索実績を選んでください。');
  const ga = new Map((report?.rows||[]).map(r=>[r.pageId,r]));
  const gsc = new Map((gscReport?.rows||[]).map(r=>[r.pageId,r]));
  return catalog.filter(p=>p.publication==='published').map(page=>{
    const search = gsc.get(page.id);
    return {page,...Object.fromEntries(METRICS.map(k=>[k,ga.get(page.id)?.[k]??null])),...(gscReport?{clicks:search?.clicks??null,impressions:search?.impressions??null,position:search?.position??null}:{})};
  });
}
