import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeServerAnalytics,serverArticleCatalog,nextAutomaticRun,synchronizationFinished,combineAnalyticsReports,createServerAnalyticsClient} from '../src/lib/media-manager/server-analytics.mjs';

const catalog=[{id:'interview-followup',path:'/service/ltori/media/interview-followup/',title:'応募後の連絡',publication:'published'}];
const at='2026-09-22T00:00:00.000Z';
const config={serviceAccountConfigured:true,ga4Configured:true,gscConfigured:true,propertyId:'550092764',siteUrl:'sc-domain:layr.co.jp'};
const report=()=>({origin:'google',start:'2026-08-23',end:'2026-09-19',property:'550092764',site:'sc-domain:layr.co.jp',gaTimezone:'Asia/Tokyo',importedAt:'2026-09-21T21:15:00.000Z',notes:[],rows:[{pageId:'interview-followup',views:10,clicks:1,impressions:10,position:2}]});
const payload=(overrides={})=>({catalog,configuration:config,integrations:['ga4','gsc'].map(source=>({source,status:'ok',lastAttemptAt:'2026-09-21T21:15:00.000Z',lastSuccessAt:'2026-09-21T21:15:00.000Z'})),schedule:{frequency:'daily',timezone:'Asia/Tokyo',time:'06:15'},job:{status:'completed',finishedAt:'2026-09-21T21:15:05.000Z'},reports:[report()],queries:[],notes:[],serverTime:at,...overrides});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const normalize=value=>normalizeServerAnalytics(value,catalog);
const completed=()=>payload({serverTime:'2026-09-22T00:00:04.000Z',job:{status:'completed',finishedAt:'2026-09-22T00:00:03.000Z'},integrations:['ga4','gsc'].map(source=>({source,status:'ok',lastAttemptAt:at,lastSuccessAt:at}))});

function server(sequence){const requests=[];return {requests,fetcher:async(url,options)=>{requests.push({url,options});assert.ok(sequence.length,'unexpected request');const value=sequence.shift();if(value instanceof Error)throw value;return value;}};}

test('server metrics stay distinct from local history, unknown metrics remain null',()=>{
  const snapshot=normalize(payload());assert.equal(snapshot.reports[0].storage,'server');assert.match(snapshot.reports[0].id,/^server:/);
  assert.equal(snapshot.reports[0].rows[0].views,10);assert.equal(snapshot.reports[0].rows[0].sessions,null);assert.equal(snapshot.reports[0].rows[0].ctr,.1);
  const local=[{...report(),id:'manual-id'}],before=JSON.stringify(local),merged=combineAnalyticsReports(snapshot.reports,local);
  assert.equal(merged.length,2);assert.equal(merged[0].storage,'server');assert.equal(merged[1].id,'manual-id');assert.equal(JSON.stringify(local),before);
});

test('published API catalog admits dynamic articles and drops no-longer-published entries',()=>{
  const dynamic={id:'hiring-tool-cost',path:'/service/ltori/media/hiring-tool-cost/',title:'採用ツールの費用',publication:'published'};
  const snapshot=normalize(payload({catalog:[dynamic],reports:[{...report(),rows:[{pageId:dynamic.id,views:8}]}]}));
  assert.deepEqual(snapshot.catalog,[{...dynamic,slug:dynamic.id}]);assert.equal(snapshot.reports[0].rows[0].pageId,dynamic.id);
  assert.equal(serverArticleCatalog(catalog,[{...catalog[0],title:'URL title'}])[0].title,'応募後の連絡');
  assert.throws(()=>serverArticleCatalog(catalog,[{...dynamic,path:'https://outside.test/service/ltori/media/hiring-tool-cost/'}]));
  assert.throws(()=>serverArticleCatalog(catalog,[{...dynamic,publication:'draft'}]));
  assert.throws(()=>serverArticleCatalog(catalog,[dynamic,dynamic]));
});

test('schedule shows the next daily 06:15 JST, including month and year boundaries',()=>{
  const schedule=payload().schedule;
  assert.equal(nextAutomaticRun(schedule,'2026-09-21T21:14:59Z'),'2026-09-21T21:15:00.000Z');
  assert.equal(nextAutomaticRun(schedule,'2026-09-21T21:15:00Z'),'2026-09-22T21:15:00.000Z');
  assert.equal(nextAutomaticRun(schedule,'2026-12-31T22:00:00Z'),'2027-01-01T21:15:00.000Z');
  assert.equal(nextAutomaticRun(null,at),null);
});

test('completed old job, queued acceptance, and one changed source do not prove completion',()=>{
  const before=normalize(payload());assert.equal(synchronizationFinished(before,before),false);
  const running=normalize(completed());running.job.status='running';assert.equal(synchronizationFinished(before,running),false);
  const partial=normalize(payload({job:null,integrations:[{source:'ga4',status:'ok',lastAttemptAt:at,lastSuccessAt:at},{source:'gsc',status:'ok',lastAttemptAt:'2026-09-21T00:00:00Z'}]}));
  assert.equal(synchronizationFinished(before,partial),false);
  partial.integrations[1].lastAttemptAt=at;assert.equal(synchronizationFinished(before,partial),true);
  assert.equal(synchronizationFinished(before,normalize(completed())),true);
});

test('opening the screen reads the protected server endpoint without individual Google authentication',async()=>{
  const mock=server([response(payload())]),snapshots=[],phases=[];
  const client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher,onSnapshot:s=>snapshots.push(s),onStatus:s=>phases.push(s.phase)});
  await client.refresh();assert.equal(snapshots.length,1);assert.deepEqual(phases,['loading','ready']);
  const request=mock.requests[0];assert.equal(request.url,'/api/seo/media/analytics');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers,undefined);
});

test('sync sends one POST and waits for job completion rather than treating 202 as success',async()=>{
  const mock=server([response(payload()),response({status:'queued'},202),response(payload({job:{status:'running',startedAt:at}})),response(completed())]),phases=[];
  const client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher,delay:async()=>{},onStatus:s=>phases.push(s.phase)});
  await client.sync();assert.equal(mock.requests.filter(row=>row.options.method==='POST').length,1);assert.deepEqual(mock.requests.map(row=>row.url),['/api/seo/media/analytics','/api/seo/sync','/api/seo/media/analytics','/api/seo/media/analytics']);
  assert.equal(client.getSnapshot().job.status,'completed');assert.equal(phases.at(-1),'ready');
});

test('repeated sync clicks share one operation; known running jobs are not re-posted',async()=>{
  const mock=server([response(payload({job:{status:'running',startedAt:at}})),response(completed())]);
  const client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher,delay:async()=>{}});
  const first=client.sync(),second=client.sync();assert.equal(first,second);await first;assert.equal(mock.requests.some(row=>row.options.method==='POST'),false);
});

test('an unchanged job reaches an honest bounded waiting state',async()=>{
  const mock=server([response(payload()),response({status:'queued'},202),response(payload()),response(payload())]);
  const client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher,delay:async()=>{},maxPolls:2});
  await client.sync();assert.equal(client.getStatus().phase,'waiting');assert.equal(client.getSnapshot().reports[0].rows[0].views,10);assert.equal(mock.requests.length,4);
});

test('source failure after sync retains the last successful snapshot and exposes the error',async()=>{
  const result=completed();result.integrations[0]={source:'ga4',status:'error',lastAttemptAt:at,lastSuccessAt:'2026-09-21T21:15:00Z',message:'GA4の閲覧権限を確認してください。'};
  const mock=server([response(payload()),response({status:'queued'},202),response(result)]);
  const client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher,delay:async()=>{}});await client.sync();
  assert.equal(client.getStatus().phase,'attention');assert.equal(client.getSnapshot().integrations[0].status,'error');assert.equal(client.getSnapshot().reports[0].rows[0].views,10);
});

test('missing server credentials are a configuration state, not a fabricated zero or successful sync',async()=>{
  const missing=payload({configuration:{ga4Configured:false,gscConfigured:false},integrations:['ga4','gsc'].map(source=>({source,status:'not_configured'})),reports:[],job:null});
  const mock=server([response(missing)]),client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher});await client.sync();
  assert.equal(client.getStatus().phase,'attention');assert.equal(client.getSnapshot().reports.length,0);assert.equal(mock.requests.length,1);
});

test('network/API errors preserve earlier snapshots and do not mutate the local history',async()=>{
  const mock=server([response(payload()),response({error:'private internal text'},403)]),client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher});
  await client.refresh();const earlier=client.getSnapshot();await client.refresh();assert.equal(client.getSnapshot(),earlier);assert.equal(client.getStatus().phase,'error');assert.match(client.getStatus().message,/認証/);assert.doesNotMatch(client.getStatus().message,/private internal/);
});

test('invalid snapshot is rejected without allowing unrelated/private fields into reports',()=>{
  assert.throws(()=>normalize(payload({reports:[{...report(),rows:[{pageId:'unpublished-page',views:1}]}]})));
  const source=payload();source.access_token='secret';source.configuration.client_secret='secret';source.reports[0].cookie='secret';
  assert.doesNotMatch(JSON.stringify(normalize(source)),/secret|access_token|client_secret|cookie/);
});

test('closing the screen during a pending read does not update the UI',async()=>{
  let release;const responsePromise=new Promise(resolve=>{release=resolve;}),updates=[];
  const client=createServerAnalyticsClient({catalog,fetcher:async()=>responsePromise,onSnapshot:value=>updates.push(value)});
  const pending=client.refresh();await Promise.resolve();client.dispose();release(response(payload()));await pending;assert.equal(updates.length,0);
});


test('a failed latest job is surfaced even when integrations still show earlier successes',async()=>{
  const failed=payload({job:{status:'error',finishedAt:at,message:'処理を完了できませんでした。'}});
  const mock=server([response(failed)]),client=createServerAnalyticsClient({catalog,fetcher:mock.fetcher});
  await client.refresh();assert.equal(client.getStatus().phase,'attention');assert.match(client.getStatus().message,/直近の自動取得に問題/);
  assert.equal(client.getSnapshot().job.message,'処理を完了できませんでした。');assert.equal(client.getSnapshot().reports[0].rows[0].views,10);
  assert.ok(client.getSnapshot().integrations.every(source=>source.status==='ok'));
});
