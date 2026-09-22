import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalAreas,cityAreas,eligibleAreas} from '../src/lib/ltori-seo.mjs';
import {publishedAreas,publicationFor,validateReleases,cityEditorial} from '../src/lib/ltori-publication.mjs';
import policy from '../src/data/ltori-publication.json' with {type:'json'};
import {catalogFromAreas,emptyState,validateBackup,createReport} from '../src/lib/seo-manager/model.mjs';
import {analyticsFromCsv,putAnalyticsReport,joinedMetrics,inquiryPageId} from '../src/lib/seo-manager/analytics-model.mjs';
import {fetchGoogleReport,gaRequest,validateConnection,GOOGLE_SCOPES} from '../src/lib/seo-manager/google-analytics.mjs';

const catalog=catalogFromAreas(regionalAreas).map((p,i)=>({...p,publication:publicationFor(regionalAreas[i])}));
const meta={start:'2026-09-18',end:'2026-09-30',property:'123456'},path='/service/ltori/area/mie/nabari/';
const config={clientId:'test-client.apps.googleusercontent.com',property:'123456',site:'sc-domain:layr.co.jp'};
const csv='Path,Views,TotalUsers,Sessions,Inquiries\n'+path+',10,8,6,0';

test('scope is 792 cities and 47 prefectures; only three reviewed pages release, towns/villages/wards remain excluded',()=>{
  assert.equal(cityAreas.length,792);assert.equal(eligibleAreas.length,839);assert.equal(publishedAreas.length,3);
  assert.deepEqual(publishedAreas.map(a=>a.slug).sort(),['mie/nabari','mie/toba','wakayama/hashimoto']);
  for(const area of regionalAreas.filter(a=>a.kind!=='prefecture'&&!a.locality.endsWith('市')))assert.equal(publicationFor(area),'excluded');
  const invalid=structuredClone(policy);invalid.releases[0].slug='unknown/no-town';assert.throws(()=>validateReleases(invalid,regionalAreas,cityEditorial));
  assert.throws(()=>validateReleases({...policy,releases:[...policy.releases,policy.releases[0]]},regionalAreas,cityEditorial),/duplicate/);
  const extra=eligibleAreas.filter(a=>!cityEditorial[a.slug]).slice(0,8);
  const extraCopy=Object.fromEntries(extra.map(a=>[a.slug,cityEditorial['mie/nabari']]));
  const extraReleases=extra.map(a=>({...policy.releases[0],slug:a.slug}));
  assert.equal(validateReleases({...policy,releases:[...policy.releases,...extraReleases.slice(0,7)]},regionalAreas,{...cityEditorial,...extraCopy}).length,10);
  assert.throws(()=>validateReleases({...policy,releases:[...policy.releases,...extraReleases]},regionalAreas,{...cityEditorial,...extraCopy}),/Daily/);
  assert.throws(()=>validateReleases(policy,regionalAreas,{}),/Editorial/);
});
test('GA CSV preserves missing versus zero, drops foreign URLs, rejects duplicated users and generic events',()=>{
  const r=analyticsFromCsv(csv+'\nhttps://example.com'+path+',9,8,7,6',meta,catalog);
  assert.equal(r.rows.length,1);assert.equal(r.rows[0].inquiries,0);assert.equal(r.rows[0].clicks,null);
  assert.throws(()=>analyticsFromCsv(csv+'\n'+path+'?utm_source=test,2,2,2,2',meta,catalog),/複数行/);
  assert.throws(()=>analyticsFromCsv('Path,Event count\n'+path+',100',meta,catalog));
  const native=analyticsFromCsv('# GA4 exploration\nページパスとスクリーンクラス,表示回数,総ユーザー数\n'+path+',5,4',meta,catalog);
  assert.equal(native.rows[0].inquiries,null);assert.equal(native.rows[0].users,4);
});
test('backups retain old excluded-region work plus analytics; no tokens are serialized, matching snapshots replace',()=>{
  const old=emptyState();delete old.analyticsReports;
  assert.deepEqual(validateBackup(old,catalog).analyticsReports,[]);
  const report=analyticsFromCsv(csv,meta,catalog);
  const state=putAnalyticsReport(putAnalyticsReport(emptyState(),report),report);
  assert.equal(state.analyticsReports.length,1);assert.deepEqual(validateBackup(state,catalog).analyticsReports,state.analyticsReports);
  const bad=structuredClone(state);bad.analyticsReports[0].rows[0].users=-1;assert.throws(()=>validateBackup(bad,catalog));
  const injected=structuredClone(state);injected.analyticsReports[0].access_token='secret';assert.ok(!JSON.stringify(validateBackup(injected,catalog)).includes('secret'));
});
test('same-period joins keep GSC and GA4 distinct; different periods cannot combine',()=>{
  const report=analyticsFromCsv(csv,meta,catalog);
  const gsc=createReport('Page,Clicks,Impressions,Position\nhttps://layr.co.jp'+path+',3,20,8',{...meta,searchType:'web',scopePageId:'',filter:'全体'},catalog).report;
  const rows=joinedMetrics(report,gsc,catalog), nabari=rows.find(r=>r.page.id==='24208');
  assert.equal(rows.length,3);assert.equal(nabari.clicks,3);assert.equal(nabari.sessions,6);assert.equal(nabari.users,8);
  assert.equal(rows.find(r=>r.page.id==='24211').views,null);
  assert.throws(()=>joinedMetrics(report,{...gsc,end:'2026-10-01'},catalog));
});
test('inquiry attribution only accepts successful-event contact source URLs, not arbitrary pages or service clicks',()=>{
  assert.equal(inquiryPageId('/contact/?service=ltori&source=area%2Fmie%2Fnabari',catalog),'24208');
  for(const input of [path,'/contact/?service=general&source=area/mie/nabari','https://evil.example/contact/?service=ltori&source=area/mie/nabari','/contact/?service=ltori&source=area/unknown'])assert.equal(inquiryPageId(input,catalog),null);
  const body=JSON.stringify(gaRequest('inquiries',meta.start,meta.end));assert.match(body,/ltori_inquiry_complete/);assert.ok(!body.includes('generate_lead'));
  assert.equal(gaRequest('landings',meta.start,meta.end).dimensions[0].name,'landingPage');
  assert.ok(GOOGLE_SCOPES.split(' ').every(s=>s.endsWith('.readonly')));
  assert.throws(()=>validateConnection({...config,property:'G-1234'}));
});
test('Google API keeps real metrics and partial errors; absent rows stay missing, credentials never enter the stored report',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});assert.equal(options.headers.Authorization,'Bearer test-memory-token');
    if(url.includes('webmasters'))return {ok:true,json:async()=>({rows:[{keys:['https://layr.co.jp'+path],clicks:3,impressions:20,position:8}]})};
    if(body.dimensions[0].name==='landingPage')return {ok:false,status:403,json:async()=>({error:{message:'must not leak server error'}})};
    if(body.metrics[0].name==='eventCount')return {ok:true,json:async()=>({rows:[{dimensionValues:[{value:'/contact/?service=ltori&source=area%2Fmie%2Fnabari'}],metricValues:[{value:'2'}]}]})};
    return {ok:true,json:async()=>({metadata:{timeZone:'Asia/Tokyo',subjectToThresholding:true},rowCount:1,rows:[{dimensionValues:[{value:path}],metricValues:[{value:'10'},{value:'8'}]}]})};
  };
  const report=await fetchGoogleReport({config,token:'test-memory-token',...meta,catalog,fetcher});
  assert.equal(calls.length,4);assert.equal(report.rows[0].views,10);assert.equal(report.rows[0].inquiries,2);assert.equal(report.rows[0].sessions,null);
  assert.ok(report.notes.some(n=>n.includes('403')));assert.ok(report.notes.some(n=>n.includes('しきい値')));
  assert.equal(report.gaTimezone,'Asia/Tokyo');assert.ok(!JSON.stringify(report).includes('test-memory-token'));
});
test('all failed Google requests reject; successful empty queries never invent zero traffic',async()=>{
  const fail=async()=>({ok:false,status:401,json:async()=>({})});
  await assert.rejects(()=>fetchGoogleReport({config,token:'expired',...meta,catalog,fetcher:fail}),/期限/);
  const empty=async()=>({ok:true,json:async()=>({rows:[]})});
  const report=await fetchGoogleReport({config,token:'token',...meta,catalog,fetcher:empty});
  assert.deepEqual(report.rows,[]);assert.equal(joinedMetrics(report,null,catalog)[0].views,null);
});
