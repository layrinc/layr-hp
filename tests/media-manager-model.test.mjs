import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAX_FILE,emptyMediaState,normalizeKeyword,parseVolume,volumeFromCsv,previewVolumeReport,applyVolumeReport,rankPlans,plansFromRows,mergePlans,planEdit,validatePlanEdit,canonicalArticlePath,validateMediaBackup,validateMediaAnalyticsReport,validateMediaSearchReport,joinMediaMetrics,csvString} from '../src/lib/media-manager/model.mjs';
const catalog=[{id:'one',path:'/service/ltori/media/one/',title:'公開記事'},{id:'two',path:'/service/ltori/media/two/'},{id:'about',path:'/service/ltori/media/about/'},{id:'draft',path:'/service/ltori/media/draft/',publication:'draft'}];
const plans=plansFromRows([{id:'A001',keyword:'採用 LINE 費用',title:'費用記事',status:'企画案'},{id:'A002',keyword:'採用 ツール 費用',title:'潜在記事'},{id:'A003',keyword:'採用 おすすめ 媒体',title:'媒体比較'}]);
const meta={source:'手動CSV',periodStart:'2026-08-01',periodEnd:'2026-08-31',country:'JP',language:'ja',network:'Google',matchType:'元ファイルの条件',fetchedAt:'2026-09-22T00:00:00Z'};
const reportBase={origin:'google',start:'2026-08-01',end:'2026-08-31',property:'123',site:'sc-domain:layr.co.jp',gaTimezone:'Asia/Tokyo',importedAt:'2026-09-22T00:00:00Z',notes:[]};
test('search demand keeps zero, ten, unknown and ranges semantically distinct',()=>{
  assert.deepEqual(parseVolume('0'),{status:'measured',volume:0,lower:null,upper:null,raw:'0'});
  assert.equal(parseVolume('１０').volume,10);assert.equal(parseVolume('1,000').volume,1000);
  for(const value of ['', ' ', '-', '—', '未取得','N/A'])assert.equal(parseVolume(value).status,'unknown');
  assert.deepEqual(parseVolume('10〜100'),{status:'range',volume:null,lower:10,upper:100,raw:'10〜100'});
  assert.equal(parseVolume('0-10').status,'range');
  for(const value of ['-1','1.5','1万','1e3','100~10','9007199254740992','=SUM(1,2)'])assert.throws(()=>parseVolume(value));
});
test('keyword matching normalizes width and whitespace without deleting meaningful spaces',()=>{
  assert.equal(normalizeKeyword(' 採用　ＬＩＮＥ   費用 '),'採用 line 費用');
  assert.notEqual(normalizeKeyword('採用LINE'),normalizeKeyword('採用 LINE'));
});
test('CSV preview counts matches/unknowns, handles BOM and quoted thousands without applying state',()=>{
  const before=emptyMediaState();
  const preview=volumeFromCsv('\uFEFFKeyword,Volume\r\n"採用 LINE 費用","1,000"\r\n採用 ツール 費用,10\r\n採用 おすすめ 媒体,0\r\nその他,\r\n範囲,10〜100',meta,plans);
  assert.deepEqual(preview.summary,{total:5,matched:3,unmatched:2,measured:3,zero:1,range:1,unknown:1,conflicts:0});
  assert.equal(before.volumeReports.length,0);
  const saved=applyVolumeReport(before,preview.report);assert.equal(saved.volumeReports.length,1);
  assert.equal(saved.volumeReports[0].rows[0].volume,1000);
});
test('same-key duplicate CSV rows block apply even when numeric values match',()=>{
  const result=volumeFromCsv('Keyword,Volume\n採用 LINE,10\n採用　ＬＩＮＥ,10',meta);
  assert.equal(result.conflicts.length,1);assert.throws(()=>applyVolumeReport(emptyMediaState(),result.report),/重複/);
  assert.throws(()=>volumeFromCsv('Keyword,Keyword,Volume\na,b,10',meta),/一意/);
  assert.throws(()=>volumeFromCsv('foo,bar\na,10',meta),/標準CSV/);
  assert.equal(volumeFromCsv('語,需要\na,10',{...meta,columns:{keyword:'語',volume:'需要'}}).report.rows[0].volume,10);
});
test('CSV parser supports quoted newlines as text and export neutralizes spreadsheet formulas',()=>{
  const imported=plansFromRows('ID,主キーワード案,記事タイトル案\nA001,採用,"複数行\nのタイトル"');
  assert.equal(imported[0].title,'複数行\nのタイトル');
  const csv=csvString([['keyword'],['=HYPERLINK("https://bad.test")'],[' @SUM(1)'],['-10']]);
  assert.match(csv,/'=HYPERLINK/);assert.match(csv,/' @SUM/);assert.match(csv,/'-10/);
});
test('invalid metadata and oversized input are rejected rather than silently assumed',()=>{
  assert.throws(()=>volumeFromCsv('Keyword,Volume\na,10',{...meta,source:''}),/取得元/);
  assert.throws(()=>volumeFromCsv('Keyword,Volume\na,10',{...meta,periodStart:'2026-02-30'}),/期間/);
  assert.throws(()=>volumeFromCsv('あ'.repeat(MAX_FILE/3+1),meta),/20MB/);
});
test('ranking retains ten-volume targets, sorts measured0 above unknown and uses one survey only',()=>{
  const p=plansFromRows([...plans,{id:'A004',keyword:'range',title:'範囲'},{id:'A005',keyword:'unknown',title:'不明'}]);
  const r=volumeFromCsv('Keyword,Volume\n採用 LINE 費用,0\n採用 ツール 費用,10\n採用 おすすめ 媒体,100\nrange,10~100\nunknown,',meta).report;
  assert.deepEqual(rankPlans(p,r).map(row=>row.id),['A003','A002','A001','A004','A005']);
  assert.throws(()=>rankPlans(p,[r]),/1件/);
  const saved=applyVolumeReport(applyVolumeReport(emptyMediaState(),r),{...r,country:'US'});
  assert.equal(saved.volumeReports.length,2);assert.notEqual(saved.volumeReports[0].id,saved.volumeReports[1].id);
});
test('plan re-import preserves local edits, original IDs, and appended latent ideas',()=>{
  const initial={...emptyMediaState(),plans,edits:{A001:{status:'writing',priority:'high',notes:'制作中',url:''}}};
  const next=mergePlans(initial,plansFromRows([{id:'A001',keyword:'採用 LINE 費用',title:'更新見出し'},{id:'L001',keyword:'採用管理システム 費用',title:'潜在層向け'}]));
  assert.equal(next.plans.length,4);assert.equal(next.plans[0].title,'更新見出し');assert.equal(planEdit(next,'A001').status,'writing');
  assert.equal(initial.plans[0].title,'費用記事');
  assert.throws(()=>plansFromRows([plans[0],plans[0]]),/重複/);
  assert.throws(()=>plansFromRows([{id:'__proto__',keyword:'a',title:'b'}]),/ID/);
});
test('Sheet headers retain IDs and tolerate trailing omitted empty cells',()=>{
  assert.equal(plansFromRows([['見出し前'],['ID','公開月','主キーワード案','記事タイトル案','進行状況'],['A010','2026-10','採用','記事']])[0].id,'A010');
  assert.equal(plansFromRows({articles:plans}).length,3);
});
test('Google formatted dates normalize to publication month without accepting nonexistent dates',()=>{
  for(const month of ['2026/10/01','2026-10-01','2026/10/1','2026-10'])assert.equal(plansFromRows([{...plans[0],month}])[0].month,'2026-10');
  assert.equal(plansFromRows([{...plans[0],month:'2028/2/29'}])[0].month,'2028-02');
  for(const month of ['2026/2/29','2026-02-30','2026/13/01','2026/0/01','2026/10/00'])assert.throws(()=>plansFromRows([{...plans[0],month}]),/公開月/);
});
test('validated seed preview preserves dash unknown values without a CSV escaping roundtrip',()=>{
  const report=volumeFromCsv('Keyword,Volume\n採用 LINE 費用,-\n採用 ツール 費用,0\nrange,10~100',meta).report;
  const preview=previewVolumeReport(report,plans);
  assert.equal(preview.report.rows[0].raw,'-');assert.equal(preview.summary.unknown,1);assert.equal(preview.summary.zero,1);assert.equal(preview.summary.range,1);assert.equal(preview.summary.matched,2);
});
test('exact article join rejects external, query/hash, about, category, drafts and unknown paths',()=>{
  assert.equal(canonicalArticlePath('https://layr.co.jp/service/ltori/media/one/',catalog),'/service/ltori/media/one/');
  for(const url of ['https://evil.test/service/ltori/media/one/','/service/ltori/media/one/?email=x','/service/ltori/media/one/#x','/service/ltori/media/about/','/service/ltori/media/category/guide/','/service/ltori/media/draft/','/service/ltori/media/missing/','https://user:pass@layr.co.jp/service/ltori/media/one/','/service/ltori/media/two/../one/','/service/ltori/media/%6fne/'])assert.equal(canonicalArticlePath(url,catalog),null,url);
  assert.throws(()=>validatePlanEdit({status:'published',priority:'high',url:'https://evil.test',notes:''},catalog),/公開URL/);
});
test('analytics joins only explicitly assigned article URL and preserves null for absent rows',()=>{
  const r=validateMediaAnalyticsReport({...reportBase,rows:[{pageId:'one',views:10,users:5,clicks:2,impressions:20}]},catalog);
  const result=joinMediaMetrics(plans,r,catalog,{A001:{url:'https://layr.co.jp/service/ltori/media/one/'}});
  assert.equal(result[0].metrics.views,10);assert.equal(result[0].metrics.ctr,0.1);assert.equal(result[0].metrics.inquiries,null);assert.equal(result[1].metrics.views,null);
  assert.throws(()=>joinMediaMetrics(plans,r,catalog,{}, {...reportBase,kind:'queries',rows:[]}),/クエリ別/);
  assert.throws(()=>joinMediaMetrics(plans,r,catalog,{}, {...reportBase,kind:'pages',end:'2026-09-01',rows:[]}),/同じ期間/);
});
test('duplicate analytics rows and invalid metrics cannot overcount users or fabricate conversions',()=>{
  assert.throws(()=>validateMediaAnalyticsReport({...reportBase,rows:[{pageId:'one',users:1},{pageId:'one',users:2}]},catalog),/合算/);
  for(const row of [{pageId:'one',views:-1},{pageId:'one',users:1.5},{pageId:'one',position:0},{pageId:'one',clicks:2,impressions:1}])assert.throws(()=>validateMediaAnalyticsReport({...reportBase,rows:[row]},catalog));
  const r=validateMediaSearchReport({...reportBase,kind:'queries',rows:[{pageId:'one',query:'採用 LINE',clicks:2,impressions:20,position:4,ctr:99}]},catalog);
  assert.equal(r.rows[0].ctr,0.1);assert.equal(r.rows[0].position,4);
});
test('backup whitelist rejects regional kind/version, strips secrets, validates report consistency, and resets revision',()=>{
  const state={...emptyMediaState(),plans,revision:99,token:'do-not-save',config:{secret:'do-not-save'},edits:{A001:{status:'writing',priority:'high',notes:'memo',url:'',token:'do-not-save'}}};
  state.analyticsReports=[{...reportBase,rows:[{pageId:'one',views:10,url:'/contact/?email=private@example.com',token:'secret'}],token:'secret'}];
  const restored=validateMediaBackup(JSON.stringify(state),catalog);
  assert.equal(restored.revision,0);assert.equal(restored.plans.length,3);assert.doesNotMatch(JSON.stringify(restored),/do-not-save|private@example|secret/);
  assert.throws(()=>validateMediaBackup({...state,kind:'ltori-seo'},catalog),/バックアップ/);
  assert.throws(()=>validateMediaBackup({...state,version:2},catalog),/バックアップ/);
  const v=volumeFromCsv('Keyword,Volume\na,10',meta).report;
  assert.throws(()=>validateMediaBackup({...state,volumeReports:[{...v,rows:[{...v.rows[0],volume:0}]}]},catalog),/一致/);
});
test('media modules leave existing region-specific adapter untouched',async()=>{
  const regional=await readFile(new URL('../src/lib/seo-manager/google-analytics.mjs',import.meta.url),'utf8');
  assert.match(regional,/\/service\/ltori\/area\//);assert.doesNotMatch(regional,/media-manager/);
});
test('verified Rakko seed maps all 200 planned keywords and preserves its survey provenance and intent gates',async()=>{
  const seed=JSON.parse(await readFile(new URL('../src/data/ltori-media-plan.json',import.meta.url),'utf8'));
  const sourcePlans=plansFromRows(seed),preview=previewVolumeReport(seed.volumeReports[0],sourcePlans);
  assert.equal(sourcePlans.length,200);assert.equal(sourcePlans.filter(row=>/^A\d+$/.test(row.id)).length,120);assert.equal(sourcePlans.filter(row=>/^K\d+$/.test(row.id)).length,80);
  assert.equal(preview.summary.matched,200);assert.equal(preview.summary.zero,141);assert.equal(preview.summary.measured,200);assert.equal(preview.summary.unmatched,0);
  assert.equal(preview.report.rows.filter(row=>row.volume>=10).length,59);
  assert.equal(preview.report.periodStart,'2025-09-01');assert.equal(preview.report.periodEnd,'2026-08-31');
  assert.equal(preview.report.sourceUrl,'https://rakkokeyword.com/result/searchVolume/1282358');
  assert.match(preview.report.notes.join(' '),/1282347/);
  assert.match(preview.report.matchType,/補完OFF/);assert.match(preview.report.notes.join(' '),/絶対にないことを意味しません/);
  assert.equal(rankPlans(sourcePlans,preview.report)[0].keyword,'内定辞退');
  for(const id of ['K061','K062','K063']) {
    const plan=sourcePlans.find(row=>row.id===id);assert.match(plan.gate,/各480の需要は合算しない/);assert.match(plan.material,/同一意図を統合/);
  }
  for(const id of ['K073','K074']) {
    const plan=sourcePlans.find(row=>row.id===id);assert.match(plan.gate,/企業向けの意図/);assert.match(plan.material,/1語1記事で公開せず/);
  }
});
test('unpublished/deleted articles never make saved workspace or historical backup unrecoverable',()=>{
  const historical={...emptyMediaState(),plans,edits:{A001:{status:'published',priority:'high',notes:'公開時メモ',url:'https://layr.co.jp/service/ltori/media/one/'}}};
  historical.analyticsReports=[{...reportBase,rows:[{pageId:'one',views:120,users:80}]}];
  historical.searchReports=[{...reportBase,kind:'queries',rows:[{pageId:'one',query:'採用',clicks:3,impressions:20,position:4}]}];
  for(const currentCatalog of [[],[{id:'one',path:'/service/ltori/media/one/',publication:'draft'}],[{id:'renamed',path:'/service/ltori/media/renamed/'}]]) {
    const restored=validateMediaBackup(historical,currentCatalog);
    assert.equal(restored.edits.A001.url,'https://layr.co.jp/service/ltori/media/one/');
    assert.equal(restored.analyticsReports[0].rows[0].views,120);assert.equal(restored.searchReports[0].rows[0].query,'採用');
    const visible=joinMediaMetrics(restored.plans,restored.analyticsReports[0],currentCatalog,restored.edits);
    assert.equal(visible[0].page,null);assert.equal(visible[0].metrics.views,null);
    assert.doesNotThrow(()=>validateMediaBackup(JSON.stringify(restored),currentCatalog));
    assert.throws(()=>validatePlanEdit(restored.edits.A001,currentCatalog),/公開URL/);
    assert.throws(()=>validateMediaAnalyticsReport(historical.analyticsReports[0],currentCatalog),/不明/);
  }
});
test('historical recovery still rejects unsafe URLs and page identifiers',()=>{
  const state={...emptyMediaState(),plans};
  for(const pageId of ['https://evil.test','one/../two','<script>','__proto__','about','contact','category','a'.repeat(201)]) {
    assert.throws(()=>validateMediaBackup({...state,analyticsReports:[{...reportBase,rows:[{pageId,views:10}]}]},[]),/不明/);
    assert.throws(()=>validateMediaBackup({...state,searchReports:[{...reportBase,kind:'queries',rows:[{pageId,query:'q',clicks:1,impressions:2,position:1}]}]},[]),/見つかりません/);
  }
  for(const url of ['https://evil.test/service/ltori/media/one/','/service/ltori/media/one/?email=private@example.com','/service/ltori/media/about/','/service/ltori/media/a/../one/'])assert.throws(()=>validateMediaBackup({...state,edits:{A001:{status:'published',priority:'high',notes:'',url}}},[]),/公開URL/);
});
