import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectRegionalServerAnalytics,createRegionalServerReader,regionalServerStatus,isServerReport,formatSearchCtr} from '../src/lib/seo-manager/regional-server-analytics.mjs';
import {joinedMetrics} from '../src/lib/seo-manager/analytics-model.mjs';
import {emptyState} from '../src/lib/seo-manager/model.mjs';

const catalog = [{id:'a',path:'/service/ltori/area/mie/nabari/',fullName:'名張市',publication:'published'},{id:'b',path:'/service/ltori/area/mie/toba/',fullName:'鳥羽市',publication:'published'},{id:'c',path:'/service/ltori/area/mie/old/',fullName:'旧地域',publication:'excluded'}];
test('regional CTR distinguishes missing clicks from measured zero in display and export', () => {
  assert.equal(formatSearchCtr({clicks:null,impressions:100}), '—');
  assert.equal(formatSearchCtr({clicks:0,impressions:100}), '0.0%');
  assert.equal(formatSearchCtr({clicks:2,impressions:40}), '5.0%');
  assert.equal(formatSearchCtr({clicks:0,impressions:0}), '—');
  assert.equal(formatSearchCtr({clicks:1,impressions:null}), '—');
});
const fixture = () => ({generatedAt:'2026-09-22T08:00:00Z',projects:[{id:'regional',pages:[
  {path:'https://layr.co.jp/service/ltori/area/mie/nabari?x=1',metrics:{views:0,users:2,sessions:3,inquiries:null,clicks:7,impressions:100,position:9}},
  {path:'/service/ltori/area/mie/toba/',metrics:{views:null,users:2,sessions:null,inquiries:0,clicks:null,impressions:null,position:null}},
  {path:'/service/ltori/area/mie/old/',metrics:{views:999}}, {path:'https://external.example/service/ltori/area/mie/nabari/',metrics:{views:999}},
  {path:'/media/other/',metrics:{views:999}},
]}],sources:[{source:'ga4',status:'error',lastAttemptAt:'2026-09-22T07:00:00Z',quality:{truncated:true,sampled:true}},{source:'gsc',status:'ok',quality:{}}],periods:{ga4:{startDate:'2026-08-23',endDate:'2026-09-19',fetchedAt:'2026-09-21T07:00:00Z'},gsc:{startDate:'2026-08-22',endDate:'2026-09-18',fetchedAt:'2026-09-22T07:00:00Z'}}});

test('regional server reports join catalog identities and preserve separate source periods, null and measured zero', () => {
  const input=fixture(), before=JSON.stringify(input), state=emptyState();
  state.reports=[{id:'manual-search'}];state.analyticsReports=[{id:'manual-ga4'}];const saved=JSON.stringify(state);
  const data=projectRegionalServerAnalytics(input,catalog), ga=data.reports.find(row=>row.source==='ga4'),gsc=data.searchReport;
  assert.equal(ga.start,'2026-08-23');assert.equal(gsc.start,'2026-08-22');
  assert.deepEqual(ga.rows.map(row=>row.pageId),['a','b']);
  assert.equal(ga.rows[0].views,0);assert.equal(ga.rows[1].views,null);
  assert.equal(gsc.rows[0].clicks,7);assert.equal(gsc.rows[1].clicks,null);
  const gaRows=joinedMetrics(ga,null,catalog),searchRows=joinedMetrics(gsc,null,catalog);
  assert.equal(gaRows[0].users,2);assert.equal(gaRows[1].users,2);
  assert.equal(gaRows[0].clicks,null,'GA4 selection must not show GSC values from another period');
  assert.equal(searchRows[0].views,null,'GSC selection must not show GA4 values from another period');
  assert.equal(searchRows[0].clicks,7);
  assert.equal(Object.hasOwn(data,'totals'),false,'page users are not summed');
  assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(state),saved);
  assert.ok(data.reports.every(isServerReport));
});

test('last successful observations remain visible with failure and quality notes', () => {
  const data=projectRegionalServerAnalytics(fixture(),catalog),ga=data.reports[0];
  assert.ok(ga.notes.some(note=>note.includes('最新の自動取得に失敗')));
  assert.ok(ga.notes.some(note=>note.includes('最後に保存された成功実績')));
  assert.ok(ga.notes.some(note=>note.includes('取得上限')));
  assert.ok(ga.notes.some(note=>note.includes('サンプリング')));
  assert.equal(ga.importedAt,'2026-09-21T07:00:00Z');
});

test('a missing or invalid source period never acquires another provider period', () => {
  const payload=fixture();payload.periods.ga4=null;
  assert.deepEqual(projectRegionalServerAnalytics(payload,catalog).reports.map(row=>row.source),['gsc']);
  payload.periods.gsc.endDate='2026-99-99';
  assert.deepEqual(projectRegionalServerAnalytics(payload,catalog).reports,[]);
  assert.throws(()=>projectRegionalServerAnalytics({projects:[]},catalog),/形式/);
});

test('one overview read is shared without requesting Google access or saving data', async () => {
  let calls=0;
  const read=createRegionalServerReader({catalog,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'/api/seo/overview');assert.equal(options.method,undefined);assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    return Response.json(fixture());
  }});
  const first=read(),second=read();assert.equal(first,second);
  assert.equal((await first).reports.length,2);await read();assert.equal(calls,1);
});

test('server read failure is explicit and leaves the manual state intact and selectable', async () => {
  const state=emptyState();state.analyticsReports=[{id:'csv-1'}];const before=JSON.stringify(state);
  const read=createRegionalServerReader({catalog,fetchImpl:async()=>new Response('auth',{status:401})});
  await assert.rejects(read(),/保存済みCSVは引き続き選択できます/);
  assert.equal(JSON.stringify(state),before);
  assert.match(regionalServerStatus({loading:false,data:null,error:'取得に失敗'}),/取得に失敗/);
  const app=readFileSync(new URL('../src/lib/seo-manager/analytics-app.mjs',import.meta.url),'utf8');
  assert.match(app,/getServer\(\)\.data\?\.reports\|\|\[\]/);
  assert.match(app,/getState\(\)\.analyticsReports\|\|\[\]/);
  assert.match(app,/if\(!active\|\|isServerReport\(report\(\)\)/,'automatic records cannot use the manual delete handler');
});
