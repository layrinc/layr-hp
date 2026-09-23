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

async function setupLp(t) {
 const value=await setup(t);await value.store.upsert('regional_editorial','config',{enabled:true,mode:'lp_template'});return value;
}
const noPaidProvider=async()=>{throw new Error('LP mode must not call a paid provider');};
function beforeScheduledInsert(db,callback) {
 const original=db.prepare.bind(db);let called=false;
 db.prepare=sql=>{
  const statement=original(sql);if(!sql.startsWith('INSERT INTO seo_documents')||!sql.includes("SELECT ?,?,'city','scheduled'"))return statement;
  const wrap=current=>({...current,bind(...args){return wrap(current.bind(...args));},async run(){if(!called){called=true;await callback();}return current.run();}});
  return wrap(statement);
 };
}

test('LP mode creates one master-validated scheduled city per call with no provider, token or AI claim',async t=>{
 const {db,env}=await setupLp(t);let calls=0;const p=async()=>{calls++;throw Error('must not run');};
 const first=await prepareRegionalStep(env,{now,provider:p});assert.equal(first.outcome,'ready');assert.equal(first.stage,'template');assert.equal(first.mode,'lp_template');assert.equal(first.paidAiRequired,false);
 let docs=await getDocuments(db);assert.equal(docs.length,1);assert.equal(docs[0].id,city.id);assert.equal(docs[0].path,city.path);assert.equal(docs[0].status,'scheduled');assert.equal(docs[0].scheduledAt,'2026-09-24T00:17:00.000Z');assert.equal(docs[0].review.reviewedBy,'既存LPテンプレート・地域マスター検査');assert.equal(docs[0].regionalLp.cityCode,city.code);
 assert.deepEqual(await db.prepare('SELECT version,reviewed_version FROM seo_documents').first(),{version:1,reviewed_version:1});
 const second=await prepareRegionalStep(env,{now,provider:p});assert.equal(second.outcome,'ready');assert.notEqual(second.city,first.city);docs=await getDocuments(db);assert.equal(docs.length,2);assert.equal(calls,0);
 const summary=await regionalPreparationSummary(db);assert.equal(summary.mode,'lp_template');assert.equal(summary.paidAiRequired,false);assert.equal(summary.ready,2);assert.equal(summary.reviewer,'既存LPテンプレート・地域マスター検査');
 const messages=(await db.prepare('SELECT message FROM seo_activity').all()).results.map(row=>row.message);assert.ok(messages.every(text=>!/AI|調査/.test(text)));assert.equal((await db.prepare('SELECT COUNT(*) n FROM seo_published').first()).n,0);
});

test('LP mode reads only target document metadata and published paths, never every article body',async t=>{
 const {db,env}=await setupLp(t),queries=[],original=db.prepare.bind(db);db.prepare=sql=>{queries.push(sql);return original(sql);};
 const result=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(result.outcome,'ready');
 assert.ok(queries.some(sql=>sql.includes('SELECT id,path,status,version,reviewed_version FROM seo_documents WHERE path IN')));
 assert.ok(queries.some(sql=>sql.includes('SELECT path FROM seo_published WHERE path IN')));
 assert.equal(queries.some(sql=>/SELECT \* FROM seo_(documents|published)/.test(sql)),false);
});

test('LP preparation before launch is confined to the first prefecture and is idempotent when all its cities are ready',async t=>{
 const {db,env}=await setupLp(t);const expected=REGIONAL_PREFECTURES[0].cities;
 for(const target of expected){const result=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(result.outcome,'ready');assert.equal(result.city,target.slug);}
 for(let i=0;i<2;i++)assert.equal((await prepareRegionalStep(env,{now,provider:noPaidProvider})).outcome,'prepared');
 const docs=await getDocuments(db);assert.equal(docs.length,expected.length);assert.deepEqual(new Set(docs.map(doc=>doc.slug)),new Set(expected.map(target=>target.slug)));assert.ok(docs.every(doc=>doc.version===1));
});

test('LP mode during the campaign prepares only today and tomorrow, with no late-prefecture catch-up',async t=>{
 const {db,env}=await setupLp(t),dayTwo=new Date('2026-09-25T03:00:00Z'),expected=[...REGIONAL_PREFECTURES[1].cities,...REGIONAL_PREFECTURES[2].cities];
 for(const target of expected){const result=await prepareRegionalStep(env,{now:dayTwo,provider:noPaidProvider});assert.equal(result.outcome,'ready');assert.equal(result.city,target.slug);}
 assert.equal((await prepareRegionalStep(env,{now:dayTwo,provider:noPaidProvider})).outcome,'prepared');assert.equal((await getDocuments(db)).length,expected.length);
});

test('LP mode retains human drafts, paused documents and live pages while superseding unused AI progress',async t=>{
 const {db,env,store}=await setupLp(t),next=REGIONAL_PREFECTURES[0].cities[1];
 await saveDocument(db,{...draft.document,id:city.id,path:city.path,title:'担当者が編集した原稿'},0,now);
 await db.prepare("INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,1,?)").bind(next.id,next.path,JSON.stringify({id:next.id,path:next.path,type:'city',slug:next.slug,title:'公開済みの原稿'}),now.toISOString()).run();
 const third=REGIONAL_PREFECTURES[0].cities[2];await store.upsert('regional_editorial',third.slug,{status:'blocked',stage:'research',reason:'source_quality',research:{audit:'retained'}});
 const result=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(result.city,third.slug);assert.equal(result.outcome,'ready');
 assert.equal((await store.get('regional_editorial',city.slug)).reason,'existing_draft_requires_review');assert.equal((await getDocuments(db)).find(doc=>doc.id===city.id).title,'担当者が編集した原稿');assert.deepEqual((await store.get('regional_editorial',third.slug)).research,{audit:'retained'});
 const fourth=REGIONAL_PREFECTURES[0].cities[3];await saveDocument(db,{...draft.document,id:fourth.id,path:fourth.path,slug:fourth.slug},0,now);await db.prepare("UPDATE seo_documents SET status='paused',value=json_set(value,'$.status','paused') WHERE id=?").bind(fourth.id).run();
 const following=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.notEqual(following.city,fourth.slug);assert.equal((await getDocuments(db)).find(doc=>doc.id===fourth.id).status,'paused');
});

test('LP insert rechecks pause, campaign date, preparation mode and enablement atomically',async t=>{
 for(const change of ['pause','date','date-restore','mode','mode-restore','editorial-disabled','campaign-disabled']){
  const {db,env,store}=await setupLp(t);
  beforeScheduledInsert(db,async()=>{
   if(change==='pause')await store.upsert('settings','publication',{paused:true});
   if(change.startsWith('date')){await store.upsert('regional_campaign','config',{enabled:true,startDate:'2026-10-01'});if(change==='date-restore')await store.upsert('regional_campaign','config',{enabled:true,startDate:'2026-09-24'});}
   if(change.startsWith('mode')){await store.upsert('regional_editorial','config',{enabled:true,mode:'ai_research'});if(change==='mode-restore')await store.upsert('regional_editorial','config',{enabled:true,mode:'lp_template'});}
   if(change==='editorial-disabled')await store.upsert('regional_editorial','config',{enabled:false,mode:'lp_template'});
   if(change==='campaign-disabled')await store.upsert('regional_campaign','config',{enabled:false,startDate:'2026-09-24'});
  });
  const result=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(result.outcome,'state_changed',change);assert.equal((await getDocuments(db)).length,0,change);assert.equal(await store.get('regional_editorial',city.slug),null,change);
 }
});

test('concurrent LP preparation produces one version and respects a human or live page arriving before insert',async t=>{
 const {db,env}=await setupLp(t);const results=await Promise.all([prepareRegionalStep(env,{now,provider:noPaidProvider}),prepareRegionalStep(env,{now,provider:noPaidProvider})]);
 assert.equal(results.filter(result=>result.outcome==='ready').length,1);assert.equal(results.filter(result=>result.outcome==='state_changed').length,1);assert.equal((await getDocuments(db)).length,1);
 for(const kind of ['draft','published']){
  const {db,env}=await setupLp(t);
  beforeScheduledInsert(db,async()=>{if(kind==='draft')await saveDocument(db,{...draft.document,id:city.id,path:city.path,title:'並行編集を保持'},0,now);else await db.prepare("INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,1,?)").bind(city.id,city.path,JSON.stringify({id:city.id,path:city.path,title:'既存公開'}),now.toISOString()).run();});
  const result=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(result.outcome,'state_changed');const docs=await getDocuments(db);assert.equal(docs.length,kind==='draft'?1:0);if(kind==='draft'){assert.equal(docs[0].title,'並行編集を保持');assert.equal(docs[0].review,null);assert.equal(docs[0].status,'draft');}
 }
});

test('switching to LP mode while an AI stage is working cannot save or schedule its result',async t=>{
 for(const stage of ['research','review']){
  const {db,env,store}=await setup(t);if(stage==='review')await store.upsert('regional_editorial',city.slug,{stage:'review',status:'pending',research,draft});
  const before=await store.get('regional_editorial',city.slug);
  const result=await prepareRegionalStep(env,{now,provider:async()=>{await store.upsert('regional_editorial','config',{enabled:true,mode:'lp_template'});return {status:'completed',result:stage==='research'?research:review};}});
  assert.equal(result.outcome,'state_changed');assert.equal((await getDocuments(db)).length,0);assert.deepEqual(await store.get('regional_editorial',city.slug),before);
  const lp=await prepareRegionalStep(env,{now,provider:noPaidProvider});assert.equal(lp.outcome,'ready');assert.equal(lp.mode,'lp_template');
 }
});

test('LP mode disabled, paused or past its calendar never prepares or invokes paid AI',async t=>{
 const {db,env,store}=await setupLp(t);
 await store.upsert('regional_editorial','config',{enabled:false,mode:'lp_template'});assert.equal((await prepareRegionalStep(env,{now,provider:noPaidProvider})).outcome,'disabled');
 await store.upsert('regional_editorial','config',{enabled:true,mode:'lp_template'});await store.upsert('settings','publication',{paused:true});assert.equal((await prepareRegionalStep(env,{now,provider:noPaidProvider})).outcome,'paused');
 await store.upsert('settings','publication',{paused:false});assert.equal((await prepareRegionalStep(env,{now:new Date('2027-01-01T00:00:00Z'),provider:noPaidProvider})).outcome,'calendar_finished');assert.equal((await getDocuments(db)).length,0);
});
