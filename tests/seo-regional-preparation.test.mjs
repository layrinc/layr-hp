import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureDatabase,createStore,getDocuments,saveDocument} from '../worker/seo-store.mjs';
import {prepareRegionalStep,similarRegionalCopy,regionalPreparationSummary,callRegionalProvider} from '../worker/seo-regional-preparation.mjs';
import {REGIONAL_PREFECTURES} from '../worker/seo-regional-campaign.mjs';

function sqliteD1(t) {
  const connection = new DatabaseSync(':memory:');
  t.after(() => connection.close());
  const prepared = (sql, bindings = []) => ({
    bind(...args) {return prepared(sql, args);},
    execute() {for(const value of bindings)if(typeof value==='string'&&new TextEncoder().encode(value).length>2*1024*1024)throw new Error('D1 cell size limit'); const result = connection.prepare(sql).run(...bindings); return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};},
    async run() {return this.execute();},
    async first(column) {const row = connection.prepare(sql).get(...bindings); return row ? column ? row[column] : {...row} : null;},
    async all() {return {success: true, results: connection.prepare(sql).all(...bindings).map(row => ({...row}))};},
  });
  return {
    prepare: sql => prepared(sql),
    async batch(statements) {connection.exec('BEGIN IMMEDIATE'); try {const results = statements.map(statement => statement.execute()); connection.exec('COMMIT'); return results;} catch (error) {connection.exec('ROLLBACK'); throw error;}},
  };
}


const now=new Date('2026-09-23T03:00:00Z');
const research={sources:[{id:'s1',title:'市の産業計画',url:'https://www.city.sapporo.jp/industry/',checkedAt:'2026-09-23',geographicScope:'札幌市',excerpt:'テスト資料'},{id:'s2',title:'市の雇用計画',url:'https://www.city.sapporo.jp/work/',checkedAt:'2026-09-23',geographicScope:'札幌市',excerpt:'テスト資料'}],facts:[{id:'f1',text:'事実1',sourceIds:['s1']},{id:'f2',text:'事実2',sourceIds:['s2']},{id:'f3',text:'事実3',sourceIds:['s1']}]};
const city=REGIONAL_PREFECTURES[0].cities[0];
const draft={document:{type:'city',slug:city.slug,title:`${city.name}の採用LINE`,description:'応募後の連絡を整える',heading:`${city.name}の採用支援`,lead:'候補者に必要な情報を届ける具体的な採用フロー。',intent:'employer',sections:[{heading:'市の雇用資料を読む',paragraphs:['地域の資料を確認するための具体的な説明。'],steps:[]},{heading:'候補者へ情報を届ける',paragraphs:['業務内容を応募前に確認できる配信を設計する。'],steps:[]},{heading:'面談予約を整える',paragraphs:['担当者が面談日程の調整を進められる手順。'],steps:['応募受付後に希望日時を確認する。']}],example:{label:'作例',title:'架空企業の受付例',body:'ご応募ありがとうございます。ご希望の日時をお知らせください。'},sources:research.sources,relatedCitySlugs:[]},claims:[]};
const review={approved:true,issues:[],supportedFactIds:['f1','f2','f3']};
async function setup(t){const db=sqliteD1(t);await ensureDatabase(db);const store=createStore(db);await store.upsert('regional_campaign','config',{enabled:true,startDate:'2026-09-24'});await store.upsert('regional_editorial','config',{enabled:true});return {db,store,env:{SEO_DB:db}};}
const provider=async(_env,input)=>({status:'completed',stage:input.stage,result:{research,draft,review}[input.stage]});

test('three independently checked stages create one AI-reviewed scheduled city, never immediately publish',async t=>{
 const {db,env,store}=await setup(t);const calls=[];
 for(let i=0;i<3;i++)await prepareRegionalStep(env,{now,provider:async(e,input)=>{calls.push(input);return provider(e,input);}});
 assert.deepEqual(calls.map(c=>c.stage),['research','draft','review']);
 assert.equal(new Set(calls.map(c=>c.city.code)).size,1);
 const docs=await getDocuments(db);assert.equal(docs.length,1);assert.equal(docs[0].status,'scheduled');assert.match(docs[0].review.reviewedBy,/AI/);assert.equal(docs[0].scheduledAt,'2026-09-24T00:17:00.000Z');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM seo_published').first()).n,0);
 assert.equal((await store.get('regional_editorial',city.slug)).status,'ready');
});

test('disabled, paused and finished campaigns cannot call the provider',async t=>{
 const {env,store}=await setup(t);let calls=0;const p=async()=>{calls++;throw Error('must not run');};
 await store.upsert('regional_editorial','config',{enabled:false});await prepareRegionalStep(env,{now,provider:p});
 await store.upsert('regional_editorial','config',{enabled:true});await store.upsert('settings','publication',{paused:true});await prepareRegionalStep(env,{now,provider:p});
 await store.upsert('settings','publication',{paused:false});await prepareRegionalStep(env,{now:new Date('2027-01-01T00:00:00Z'),provider:p});assert.equal(calls,0);
});

test('existing human drafts are preserved and held; the next city is researched',async t=>{
 const {db,env,store}=await setup(t);await saveDocument(db,{...draft.document,id:city.id,path:city.path},0,now);
 let selected;await prepareRegionalStep(env,{now,provider:async(e,input)=>{selected=input.city;return provider(e,input);}});
 assert.notEqual(selected.code,city.code);assert.equal((await store.get('regional_editorial',city.slug)).reason,'existing_draft_requires_review');assert.equal((await getDocuments(db))[0].version,1);
});

test('provider budget failure remains resumable with exactly the same request identity',async t=>{
 const {env,store}=await setup(t);const ids=[];const p=async(e,input)=>{ids.push(input.requestId);return {status:'blocked',reason:'budget_exhausted'};};
 for(let i=0;i<2;i++){const result=await prepareRegionalStep(env,{now,provider:p});assert.equal(result.done,true);assert.equal(result.outcome,'provider_blocked');}
 assert.equal(ids[0],ids[1]);assert.equal((await store.get('regional_editorial',city.slug)).status,'pending');
});

test('failed independent review or missing evidence prevents automatic approval',async t=>{
 const {db,env,store}=await setup(t);await store.upsert('regional_editorial',city.slug,{stage:'review',status:'pending',research,draft});
 const result=await prepareRegionalStep(env,{now,provider:async()=>({status:'completed',result:{approved:true,issues:[],supportedFactIds:['f1']}})});
 assert.equal(result.outcome,'needs_review');assert.equal((await getDocuments(db)).length,0);assert.equal((await regionalPreparationSummary(db)).blocked,1);
});

test('pausing while AI is working prevents its final database insert',async t=>{
 const {db,env,store}=await setup(t);await store.upsert('regional_editorial',city.slug,{stage:'review',status:'pending',research,draft});
 const result=await prepareRegionalStep(env,{now,provider:async()=>{await store.upsert('settings','publication',{paused:true});return {status:'completed',result:review};}});
 assert.equal(result.outcome,'state_changed');assert.equal((await getDocuments(db)).length,0);
});

test('city-name replacement is caught by regional similarity detection',()=>{
 const a={...draft.document,region:{cityName:'札幌市'}},b={...draft.document,region:{cityName:'函館市'}};assert.equal(similarRegionalCopy(a,b),true);
});

test('provider uses only the private binding and bounded responses',async()=>{
 assert.equal((await callRegionalProvider({},{})).reason,'provider_not_configured');
 let request;const response=await callRegionalProvider({REGIONAL_EDITORIAL:{fetch:async r=>{request=r;return Response.json({status:'completed'});}}},{stage:'research'});
 assert.equal(request.url,'https://regional.internal/step');assert.equal(request.redirect,'error');assert.equal(response.status,'completed');
 await assert.rejects(callRegionalProvider({REGIONAL_EDITORIAL:{fetch:async()=>new Response('x'.repeat(129*1024))}},{}));
});

test('changing campaign dates while AI works prevents stale scheduling',async t=>{
 const {db,env,store}=await setup(t);await store.upsert('regional_editorial',city.slug,{stage:'review',status:'pending',research,draft});
 const result=await prepareRegionalStep(env,{now,provider:async()=>{await store.upsert('regional_campaign','config',{enabled:true,startDate:'2026-10-01'});return {status:'completed',result:review};}});
 assert.equal(result.outcome,'state_changed');assert.equal((await getDocuments(db)).length,0);
});

test('a human draft created during the AI call wins without overwrite or automatic approval',async t=>{
 const {db,env,store}=await setup(t);await store.upsert('regional_editorial',city.slug,{stage:'review',status:'pending',research,draft});
 const result=await prepareRegionalStep(env,{now,provider:async()=>{await saveDocument(db,{...draft.document,id:city.id,path:city.path,title:'人が作成した下書き'},0,now);return {status:'completed',result:review};}});
 assert.equal(result.outcome,'state_changed');const saved=(await getDocuments(db))[0];assert.equal(saved.title,'人が作成した下書き');assert.equal(saved.status,'draft');assert.equal(saved.review,null);
});
