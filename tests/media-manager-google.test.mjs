import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaGaRequest,mediaSearchRequest,fetchMediaReport,fetchMediaSearchQueries,fetchMediaPlans,mediaSourcePageId,GOOGLE_SCOPES,SHEETS_SCOPE} from '../src/lib/media-manager/google.mjs';
const catalog=[{id:'one',path:'/service/ltori/media/one/'},{id:'two',path:'/service/ltori/media/two/'}];
const args={config:{clientId:'test-client.apps.googleusercontent.com',property:'123456',site:'sc-domain:layr.co.jp'},token:'test-secret-token',start:'2026-08-01',end:'2026-08-31',catalog};
const ok=data=>({ok:true,status:200,json:async()=>data});
const gaRow=(path,...values)=>({dimensionValues:[{value:path}],metricValues:values.map(value=>({value:String(value)}))});
function gaKind(body){const metric=body.metrics[0].name,event=body.dimensionFilter.andGroup.expressions.find(e=>e.filter.fieldName==='eventName')?.filter.stringFilter.value;return event?.replace('ltori_media_','')||(metric==='screenPageViews'?'views':'sessions');}
test('Google request contracts are readonly and filter production media/event scopes only',()=>{
  assert.match(GOOGLE_SCOPES,/analytics.readonly/);assert.match(GOOGLE_SCOPES,/webmasters.readonly/);assert.match(SHEETS_SCOPE,/spreadsheets.readonly$/);
  const views=mediaGaRequest('views',args.start,args.end),request=JSON.stringify(views);
  assert.match(request,/\/service\/ltori\/media\//);assert.doesNotMatch(request,/\/area\//);assert.match(request,/hostName/);assert.match(request,/layr.co.jp/);
  assert.deepEqual(views.metrics.map(m=>m.name),['screenPageViews','totalUsers']);
  for(const [kind,event] of [['cta','ltori_media_cta_click'],['inquiry','ltori_media_inquiry_complete'],['document','ltori_media_document_complete']])assert.match(JSON.stringify(mediaGaRequest(kind,args.start,args.end)),new RegExp(event));
  assert.deepEqual(mediaSearchRequest('queries',args.start,args.end).dimensions,['page','query']);
  assert.equal(mediaSearchRequest('pages',args.start,args.end,25000).startRow,25000);
});
test('all six data sources merge exact articles; attribution strips raw URLs and personal data',async()=>{
  const calls=[];
  const report=await fetchMediaReport({...args,fetcher:async(url,init)=>{
    calls.push({url,init});assert.equal(init.headers.Authorization,'Bearer test-secret-token');const body=JSON.parse(init.body);
    if(url.includes('webmasters'))return ok({rows:[{keys:['https://layr.co.jp/service/ltori/media/one/'],clicks:4,impressions:20,position:3},{keys:['https://layr.co.jp/service/ltori/area/osaka/'],clicks:99,impressions:100,position:1}]});
    const kind=gaKind(body),rows={views:[gaRow('/service/ltori/media/one/',100,20)],sessions:[gaRow('/service/ltori/media/one/',12)],cta_click:[gaRow('/service/ltori/media/one/',8)],inquiry_complete:[gaRow('/contact/?service=ltori&source=media%2Fone&email=private@example.com',2),gaRow('/contact/?service=other&source=media%2Fone',99)],document_complete:[gaRow('/document/ltori-service/?source=media%2Fone&name=Private',3)]}[kind];
    return ok({rowCount:rows.length,rows,metadata:{timeZone:'Asia/Tokyo',subjectToThresholding:kind==='views'}});
  }});
  assert.equal(calls.length,6);assert.equal(report.rows.length,1);
  assert.deepEqual(report.rows[0],{pageId:'one',views:100,users:20,sessions:12,cta:8,inquiries:2,documents:3,clicks:4,impressions:20,position:3,ctr:0.2});
  assert.match(report.notes.join(' '),/しきい値/);assert.equal(report.gaTimezone,'Asia/Tokyo');
  assert.doesNotMatch(JSON.stringify(report),/private@example|Private|test-secret-token|source=|\/contact\//);
});
test('source attribution rejects unknown, non-media, duplicate params and wrong host/service',()=>{
  assert.equal(mediaSourcePageId('/contact/?source=media%2Fone&service=ltori','inquiry',catalog),'one');
  for(const path of ['/contact/?source=media%2Funknown&service=ltori','/contact/?source=area%2Fone&service=ltori','/contact/?source=media%2Fone&service=bad','/contact/?source=media%2Fone&source=media%2Ftwo&service=ltori','https://evil.test/contact/?source=media%2Fone&service=ltori','/contact/?source=media%2Fone%2F..%2Ftwo&service=ltori'])assert.equal(mediaSourcePageId(path,'inquiry',catalog),null);
});
test('partial failures retain usable metrics and do not turn missing values into zero',async()=>{
  const report=await fetchMediaReport({...args,fetcher:async(url,init)=>{
    const body=JSON.parse(init.body);
    if(url.includes('webmasters'))return {ok:false,status:403,json:async()=>({error:{message:'not surfaced'}})};
    const kind=gaKind(body);if(kind==='inquiry_complete')return {ok:false,status:429};
    return ok(kind==='views'?{rowCount:1,rows:[gaRow('/service/ltori/media/one/',10,5)]}:{rowCount:0,rows:[]});
  }});
  assert.equal(report.rows[0].views,10);assert.equal(report.rows[0].inquiries,null);assert.equal(report.rows[0].clicks,null);assert.equal(report.rows[0].sessions,null);
  assert.match(report.notes.join(' '),/403/);assert.match(report.notes.join(' '),/利用上限/);
});
test('all failures produce actionable sanitized errors without Google error payloads or tokens',async()=>{
  await assert.rejects(fetchMediaReport({...args,fetcher:async()=>({ok:false,status:401,json:async()=>({secret:'unsafe'})})}),error=>/再接続/.test(error.message)&&!error.message.includes('test-secret-token')&&!error.message.includes('unsafe'));
  await assert.rejects(fetchMediaSearchQueries({...args,fetcher:async()=>{throw new Error('URL with private token');}}),error=>/ネットワーク/.test(error.message)&&!error.message.includes('private'));
});
test('timeout includes hanging response JSON and cancels without recording credentials',async()=>{
  const keepAlive=setTimeout(()=>{},200);
  try{await assert.rejects(fetchMediaSearchQueries({...args,timeoutMs:10,fetcher:async()=>({ok:true,json:()=>new Promise(()=>{})})}),/タイムアウト/);}finally{clearTimeout(keepAlive);}
});
test('GA paging uses offset and stable ordering while keeping users unaggregated',async()=>{
  const offsets=[];
  const report=await fetchMediaReport({...args,fetcher:async(url,init)=>{
    const body=JSON.parse(init.body);if(url.includes('webmasters'))return ok({rows:[]});
    if(gaKind(body)!=='views')return ok({rows:[],rowCount:0});
    offsets.push(body.offset);assert.equal(body.orderBys[0].dimension.dimensionName,'pagePath');
    const rows=body.offset==='0'?[gaRow('/service/ltori/media/one/',10,5),...Array.from({length:9999},(_,i)=>gaRow(`/service/ltori/media/unknown-${i}/`,1,1))]:[gaRow('/service/ltori/media/two/',20,6)];
    return ok({rowCount:10001,rows});
  }});
  assert.deepEqual(offsets,['0','10000']);assert.equal(report.rows.find(row=>row.pageId==='one').users,5);assert.equal(report.rows.find(row=>row.pageId==='two').users,6);
});
test('duplicate canonical GA article paths discard that metric group instead of adding users',async()=>{
  const report=await fetchMediaReport({...args,fetcher:async(url,init)=>{
    if(url.includes('webmasters'))return ok({rows:[]});const kind=gaKind(JSON.parse(init.body));
    if(kind==='views')return ok({rowCount:2,rows:[gaRow('/service/ltori/media/one/',10,5),gaRow('/service/ltori/media/one',10,5)]});
    return ok(kind==='cta_click'?{rowCount:1,rows:[gaRow('/service/ltori/media/one/',3)]}:{rowCount:0,rows:[]});
  }});
  assert.equal(report.rows[0].views,null);assert.equal(report.rows[0].users,null);assert.equal(report.rows[0].cta,3);assert.match(report.notes.join(' '),/合算できません/);
});
test('GSC page-query pagination stays separate and derives CTR from original counts',async()=>{
  const offsets=[];
  const report=await fetchMediaSearchQueries({...args,fetcher:async(url,init)=>{
    const body=JSON.parse(init.body);offsets.push(body.startRow);assert.deepEqual(body.dimensions,['page','query']);assert.equal(body.dataState,'final');
    return ok({rows:body.startRow===0?[{keys:['https://layr.co.jp/service/ltori/media/one/','採用 LINE'],clicks:2,impressions:20,position:3},...Array.from({length:24999},(_,i)=>({keys:[`https://layr.co.jp/unrelated/${i}/`,'other'],clicks:0,impressions:1,position:9}))]:[{keys:['https://layr.co.jp/service/ltori/media/two/','採用 ツール'],clicks:1,impressions:10,position:8}]});
  }});
  assert.deepEqual(offsets,[0,25000]);assert.equal(report.kind,'queries');assert.equal(report.rows.length,2);assert.equal(report.rows[0].ctr,0.1);assert.match(report.notes.join(' '),/市場全体/);
});
test('GSC cap cannot be silently represented as a complete report',async()=>{
  let calls=0;
  await assert.rejects(fetchMediaSearchQueries({...args,fetcher:async()=>{calls++;return ok({rows:Array.from({length:25000},()=>({keys:['https://layr.co.jp/irrelevant/','keyword'],clicks:0,impressions:1,position:1}))});}}),/100,000行/);
  assert.equal(calls,4);
});
test('Sheets integration performs readonly fixed-range GET and does not export tokens',async()=>{
  const result=await fetchMediaPlans({token:'secret',fetcher:async(url,init)=>{
    assert.match(url,/sheets.googleapis.com\/v4\/spreadsheets\/1LQdDfofB6CCsgezFxs_A5A17bnBgNLzSTufVVYvpcgM\/values\//);assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer secret');
    return ok({values:[['ID','主キーワード案','記事タイトル案'],['A001','採用 ツール 費用','費用記事']]});
  }});
  assert.equal(result[0].id,'A001');assert.doesNotMatch(JSON.stringify(result),/secret/);
});
