import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {regionalAreas} from '../src/lib/ltori-seo.mjs';
import {MAX_FILE,checkStateSize,catalogFromAreas,keywordsFor,emptyState,addKeyword,normalizeQuery,parseCsv,createReport,putReport,reportSummary,metricLookup,queryMetric,csvString,validateBackup,isDate,canonicalPath} from '../src/lib/seo-manager/model.mjs';
const catalog=catalogFromAreas(regionalAreas), nabari=catalog.find(p=>p.id==='24208'), hashimoto=catalog.find(p=>p.id==='30203');
const meta={start:'2026-09-01',end:'2026-09-17',filter:'全デバイス・全ての国・追加フィルタなし',searchType:'web',scopePageId:'',fileName:'pages.csv'};
const pageCsv='上位のページ,クリック数,表示回数,CTR,掲載順位\nhttps://layr.co.jp/service/ltori/area/mie/nabari/,12,120,10%,8.4\nhttps://layr.co.jp/service/ltori/area/wakayama/hashimoto/,0,0,0%,0\nhttps://layr.co.jp/service/line/,40,400,10%,3\n';

test('one catalog covers all regional LPs and builds distinct keyword candidates without claiming measurements',()=>{
  const keys=keywordsFor(catalog,emptyState());assert.equal(catalog.length,1965);assert.equal(keys.length,9825);assert.equal(new Set(keys.map(k=>k.id)).size,9825);
  assert.equal(new Set(keys.map(k=>normalizeQuery(k.query))).size,9825);
  assert.equal(nabari.path,'/service/ltori/area/mie/nabari/');assert.ok(keys.every(k=>!Object.hasOwn(k,'position')));
  assert.equal(isDate('2026-02-30'),false);assert.equal(isDate('2024-02-29'),true);
});

test('CSV parses BOM, CRLF, commas, escaped quotes and multiline fields without executing input',()=>{
  assert.deepEqual(parseCsv('\uFEFFQuery,Clicks,Impressions,Position\r\n"名張市, \"\"LINE\"\"\n採用",0,10,15.5\r\n'),[['Query','Clicks','Impressions','Position'],['名張市, "LINE"\n採用','0','10','15.5']]);
  assert.throws(()=>parseCsv('a,b\n"not closed,0'),/引用符/);
  assert.throws(()=>parseCsv('a,b\n"x" y,0'),/不正/);
  assert.throws(()=>parseCsv('a,b\n1,2,3'),/列数/);
  const exported=csvString([['メモ'],['=HYPERLINK("https://example.com")'],['\t+cmd'],['plain']]);assert.ok(exported.includes("'=HYPERLINK"));assert.ok(exported.includes("'\t+cmd"));
});

test('page import matches canonical production paths and reports exclusions, zero is distinct from unmeasured',()=>{
  const {report,rejected,total}=createReport(pageCsv,meta,catalog);assert.equal(total,3);assert.equal(rejected.length,1);assert.equal(report.rows.length,2);
  assert.equal(report.rows[0].pageId,nabari.id);assert.equal(report.rows[0].position,8.4);assert.equal(report.rows[1].clicks,0);assert.equal(report.rows[1].position,null);
  assert.deepEqual(reportSummary(report),{clicks:12,impressions:120,ctr:.1,count:2});
  assert.equal(metricLookup(report).get('12345'),undefined);
  assert.equal(canonicalPath('https://layr.co.jp/service/ltori/area/mie/nabari?utm_source=x#faq'),nabari.path);
  assert.equal(canonicalPath('https://layr.co.jp.evil.example/service/ltori/area/mie/nabari/'),null);
  assert.equal(canonicalPath('javascript:alert(1)'),null);
  assert.equal(canonicalPath('https://layr.co.jp@evil.example/service/ltori/area/mie/nabari/'),null);
});

test('reimport replaces a matching snapshot but does not combine periods or filters',()=>{
  const r=createReport(pageCsv,meta,catalog).report;let state=putReport(emptyState(),r);state=putReport(state,r);assert.equal(state.reports.length,1);assert.equal(reportSummary(state.reports[0]).clicks,12);
  state=putReport(state,createReport(pageCsv,{...meta,end:'2026-09-18'},catalog).report);assert.equal(state.reports.length,2);
  state=putReport(state,createReport(pageCsv,{...meta,filter:'モバイル・日本'},catalog).report);assert.equal(state.reports.length,3);
  assert.equal(Object.keys(state.pages).length,0,'impressions do not auto-mark pages indexed');
});

test('site-wide query metrics stay separate from page-specific metrics',()=>{
  const keyword=keywordsFor(catalog,emptyState()).find(k=>k.pageId===nabari.id), csv=`Top queries,Clicks,Impressions,Position\n${keyword.query},8,100,10\n`;
  const site=createReport(csv,meta,catalog).report;assert.equal(site.kind,'queries');assert.equal(site.scopePageId,'');assert.equal(queryMetric(keyword,site,metricLookup(site)).clicks,8);
  const filtered=createReport(csv,{...meta,scopePageId:hashimoto.id},catalog).report;assert.equal(queryMetric(keyword,filtered,metricLookup(filtered)),undefined);
  assert.notEqual(site.id,filtered.id);
});

test('invalid metrics, dates, duplicate records and mixed dimensions do not partially import',()=>{
  assert.throws(()=>createReport(pageCsv.replace('12,120','-1,120'),meta,catalog),/クリック/);
  assert.throws(()=>createReport(pageCsv.replace('120,10%,8.4','120,10%,0'),meta,catalog),/掲載順位/);
  assert.throws(()=>createReport(pageCsv,{...meta,start:'2026-02-30'},catalog),/期間/);
  assert.throws(()=>createReport(pageCsv,{...meta,scopePageId:nabari.id},catalog),/サイト全体/);
  assert.throws(()=>createReport('Page,Query,Clicks,Impressions,Position\nx,y,1,2,3',meta,catalog),/複合/);
  assert.throws(()=>createReport('Query,Clicks,Clicks,Impressions,Position\nx,1,2,3,4',meta,catalog),/比較/);
  assert.throws(()=>createReport('Query,Clicks,Impressions,Position\n採用 LINE,1,2,3\n採用ＬＩＮＥ,1,2,3',meta,catalog),/重複/);
});

test('custom keyword and backup round trip keep page edits, pauses, notes, scopes and unknown data guarded',()=>{
  let state=addKeyword(emptyState(),catalog,nabari.id,'名張市 LINE採用','test-1');assert.equal(state.customKeywords.length,1);
  assert.throws(()=>addKeyword(state,catalog,nabari.id,'名張市 ＬＩＮＥ採用','test-2'),/同じ/);
  state.pages[nabari.id]={status:'improving',priority:'high',indexStatus:'unknown',owner:'担当',dueDate:'2026-09-30',nextAction:'FAQを確認',notes:'<img src=x onerror=alert(1)>\n改行'};
  state.pausedKeywords=[`${nabari.id}:0`,'custom-test-1'];state=putReport(state,createReport(pageCsv,meta,catalog).report);
  const restored=validateBackup(JSON.parse(JSON.stringify(state)),catalog);assert.deepEqual(restored,state);
  assert.throws(()=>validateBackup({...state,version:2},catalog),/バージョン/);
  assert.throws(()=>validateBackup({...state,pages:{'__proto__':null,'wrong':state.pages[nabari.id]}},catalog),/地域/);
  assert.throws(()=>validateBackup({...state,pausedKeywords:['invalid']},catalog),/保留/);
  assert.throws(()=>validateBackup({...state,customKeywords:[...state.customKeywords,...state.customKeywords]},catalog),/形式/);
  const bad=structuredClone(state);bad.reports[0].rows[0].clicks=-1;assert.throws(()=>validateBackup(bad,catalog),/数値/);
});

test('management shell is noindex, excluded from sitemap, and contains no private operational data or analytics',()=>{
  const html=readFileSync(new URL('../dist/tools/ltori-seo/index.html',import.meta.url),'utf8');
  const sitemap=readFileSync(new URL('../dist/sitemap-0.xml',import.meta.url),'utf8');
  assert.ok(html.includes('content="noindex, nofollow, noarchive"'));assert.ok(!sitemap.includes('/tools/ltori-seo'));assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.ok(!html.includes('googletagmanager'));assert.ok(!html.includes('gtag('));
  const data=JSON.parse(html.match(/<script[^>]+id="kw-catalog"[^>]*>(.*?)<\/script>/s)[1]);assert.equal(data.length,catalog.length);assert.ok(data.every(row=>!Object.hasOwn(row,'notes')));
});

test('saved workspace size stays within the restorable backup file budget',()=>{
  assert.doesNotThrow(()=>checkStateSize(emptyState()));
  assert.throws(()=>checkStateSize({notes:'a'.repeat(MAX_FILE)}),/20MB/);
});
