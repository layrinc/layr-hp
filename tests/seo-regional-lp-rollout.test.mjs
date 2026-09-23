import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import seed from '../src/data/ltori-growth-seed.json' with {type:'json'};
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {normalizeDocument,publicPath} from '../src/lib/seo-manager/editorial-model.mjs';
import {REGIONAL_LP_REVIEWER} from '../src/lib/seo-manager/regional-lp-template.mjs';
import {ensureDatabase,createStore,publishDue} from '../worker/seo-store.mjs';
import {REGIONAL_PREFECTURES,saveRegionalCampaignConfig,shiftCampaignDay,readRegionalCampaignOverview} from '../worker/seo-regional-campaign.mjs';
import {prepareRegionalStep} from '../worker/seo-regional-preparation.mjs';

function sqliteD1(t) {
  const connection=new DatabaseSync(':memory:');t.after(()=>connection.close());
  const prepared=(sql,bindings=[])=>({
    bind(...args){return prepared(sql,args);},
    execute(){const result=connection.prepare(sql).run(...bindings);return {success:true,meta:{changes:Number(result.changes)}};},
    async run(){return this.execute();},
    async first(){const row=connection.prepare(sql).get(...bindings);return row?{...row}:null;},
    async all(){return {results:connection.prepare(sql).all(...bindings).map(row=>({...row}))};},
  });
  return {prepare:sql=>prepared(sql),async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());connection.exec('COMMIT');return result;}catch(error){connection.exec('ROLLBACK');throw error;}}};
}
const startDate='2026-09-24',setupAt=new Date('2026-09-23T03:00:00Z');
const date=(day,time='09:17:00')=>new Date(`${day}T${time}+09:00`);
async function configured(t) {
  const db=sqliteD1(t);await ensureDatabase(db);
  await saveRegionalCampaignConfig(db,{enabled:true,startDate},{expectedRevision:0,now:setupAt});
  await createStore(db).upsert('regional_editorial','config',{enabled:true,mode:'lp_template'});
  return db;
}
async function prepareAll(env,now,provider) {
  const created=[];
  for(let iteration=0;iteration<100;iteration++) {
    const result=await prepareRegionalStep(env,{now,provider});
    if(result.done){assert.equal(result.outcome,'prepared');assert.equal(result.blockedCount,0);return created;}
    assert.equal(result.outcome,'ready');assert.equal(result.mode,'lp_template');assert.equal(result.paidAiRequired,false);
    created.push(result.city);
  }
  assert.fail('The two assigned prefectures should be fully prepared within 100 city steps.');
}
async function seedExistingLive(db) {
  assert.equal(seed.documents.length,10);
  const stamp='2026-09-22T00:17:00.000Z';
  for(const input of seed.documents) {
    const doc={...normalizeDocument(input,{now:stamp,status:'published',publishedAt:stamp,scheduledAt:stamp,review:{reviewedBy:'既存公開原稿の確認者',reviewedAt:stamp}}),version:3};
    const path=publicPath(doc),value=JSON.stringify(doc);
    await db.prepare("INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,reviewed_version,updated_at) VALUES(?,?,'city','published',3,?,?,3,?)").bind(doc.id,path,value,stamp,stamp).run();
    await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,3,?)').bind(doc.id,path,value,stamp).run();
    await db.prepare("INSERT INTO seo_release_events(id,day,document_id,version,run_id,created_at) VALUES(?,'2026-09-22',?,3,'previous-deployment',?)").bind(`old-${doc.id}`,doc.id,stamp).run();
  }
}
const rows=async(db,sql)=>(await db.prepare(sql).all()).results;

test('LP preparation and real SQLite publication complete all 47 prefectures with no AI, preserving the original 13 cities',{timeout:60000},async t=>{
  let externalCalls=0;
  const forbidden=()=>{externalCalls++;throw new Error('No network or paid provider is allowed in template rollout');};
  t.mock.method(globalThis,'fetch',forbidden);
  const db=await configured(t),env={SEO_DB:db,REGIONAL_EDITORIAL:{fetch:forbidden}};
  await seedExistingLive(db);
  const originalDocuments=await rows(db,'SELECT * FROM seo_documents ORDER BY id');
  const originalPublished=await rows(db,'SELECT * FROM seo_published ORDER BY id');
  const originalEvents=await rows(db,'SELECT * FROM seo_release_events ORDER BY id');
  const staticPaths=new Set(getPublishedAreas(setupAt).map(area=>`/service/ltori/area/${area.slug}/`));
  assert.equal(staticPaths.size,3);
  const initiallyLive=new Set([...staticPaths,...originalPublished.map(row=>row.path)]);
  assert.equal(initiallyLive.size,13);
  assert.equal((await readRegionalCampaignOverview(db,setupAt)).totals.live,13);

  // Preparation before launch must stage day one only; publication stays shut.
  const initialCreated=await prepareAll(env,setupAt,forbidden);
  assert.deepEqual(initialCreated,REGIONAL_PREFECTURES[0].cities.map(city=>city.slug));
  assert.equal((await publishDue(db,setupAt)).published.length,0);
  const newIds=new Set();
  let expectedLive=13;
  for(const [index,prefecture] of REGIONAL_PREFECTURES.entries()) {
    const day=shiftCampaignDay(startDate,index),prepareAt=date(day,'03:17:00');
    await prepareAll(env,prepareAt,forbidden);
    const overviewBefore=await readRegionalCampaignOverview(db,prepareAt);
    assert.equal(overviewBefore.day.dayNumber,index+1);assert.equal(overviewBefore.currentDay.slug,prefecture.slug);
    assert.equal(overviewBefore.currentDay.missing,0);
    // Only today's and tomorrow's unpublished city sets may be staged.
    const allowed=new Set(REGIONAL_PREFECTURES.slice(index,index+2).flatMap(pref=>pref.cities.map(city=>city.path)));
    const scheduled=await rows(db,"SELECT id,path,value FROM seo_documents WHERE status='scheduled'");
    assert.ok(scheduled.every(doc=>allowed.has(doc.path)),`day ${index+1}: no future-prefecture preparation`);
    for(const row of scheduled)assert.equal(JSON.parse(row.value).review.reviewedBy,REGIONAL_LP_REVIEWER);
    assert.equal((await publishDue(db,date(day,'09:16:59'))).published.length,0,`day ${index+1}: wait until 09:17`);
    const expected=prefecture.cities.filter(city=>!initiallyLive.has(city.path)).map(city=>city.id);
    // Concurrent scheduler deliveries still spend each release exactly once.
    const runs=await Promise.all([publishDue(db,date(day)),publishDue(db,date(day))]);
    const published=runs.flatMap(run=>run.published);
    assert.deepEqual(new Set(published),new Set(expected),`day ${index+1} ${prefecture.name}`);
    assert.equal(published.length,expected.length);
    for(const id of published){assert.equal(newIds.has(id),false);newIds.add(id);}
    expectedLive+=expected.length;
    const overview=await readRegionalCampaignOverview(db,date(day));
    assert.equal(overview.currentDay.live,prefecture.cities.length);
    assert.equal(overview.currentDay.remaining,0);assert.equal(overview.totals.live,expectedLive);
    const remainingQueue=await rows(db,"SELECT path FROM seo_documents WHERE status='scheduled'");
    const nextPaths=new Set((REGIONAL_PREFECTURES[index+1]?.cities||[]).filter(city=>!initiallyLive.has(city.path)).map(city=>city.path));
    assert.deepEqual(new Set(remainingQueue.map(row=>row.path)),nextPaths,`day ${index+1}: tomorrow remains scheduled`);
    assert.equal((await publishDue(db,date(day,'10:17:00'))).published.length,0);
    assert.deepEqual(await prepareAll(env,date(day,'10:18:00'),forbidden),[]);
  }

  assert.equal(newIds.size,779);assert.equal(expectedLive,792);
  const finalAt=date(shiftCampaignDay(startDate,47));
  assert.equal((await prepareRegionalStep(env,{now:finalAt,provider:forbidden})).outcome,'calendar_finished');
  assert.equal((await publishDue(db,finalAt)).published.length,0);
  const final=await readRegionalCampaignOverview(db,finalAt);
  assert.equal(final.totals.live,792);assert.equal(final.totals.remaining,0);assert.equal(final.totals.missing,0);
  assert.equal((await rows(db,'SELECT id FROM seo_documents')).length,789);
  assert.equal((await rows(db,'SELECT id FROM seo_published')).length,789);
  assert.equal((await rows(db,'SELECT id FROM seo_release_events')).length,789);
  const ids=new Set(originalDocuments.map(doc=>doc.id));
  assert.deepEqual((await rows(db,'SELECT * FROM seo_documents ORDER BY id')).filter(doc=>ids.has(doc.id)),originalDocuments);
  assert.deepEqual((await rows(db,'SELECT * FROM seo_published ORDER BY id')).filter(doc=>ids.has(doc.id)),originalPublished);
  assert.deepEqual((await rows(db,'SELECT * FROM seo_release_events ORDER BY id')).filter(row=>row.run_id==='previous-deployment'),originalEvents);
  assert.equal(externalCalls,0);
});

test('template preparation preserves paused and manual drafts and cannot insert after a configuration change',async t=>{
  const db=await configured(t),store=createStore(db),[manual,paused,firstNew]=REGIONAL_PREFECTURES[0].cities;
  const forbidden=()=>{throw new Error('A template must not call AI');};
  for(const [city,status] of [[manual,'draft'],[paused,'paused']])await db.prepare('INSERT INTO seo_documents(id,path,type,status,version,value,updated_at) VALUES(?,?,\'city\',?,7,?,?)').bind(city.id,city.path,status,JSON.stringify({id:city.id,slug:city.slug,body:'既存の人手原稿は保持する',status}),setupAt.toISOString()).run();
  const existing=await rows(db,'SELECT * FROM seo_documents ORDER BY id');
  const basePrepare=db.prepare;let switched=false;
  db.prepare=sql=>{
    const statement=basePrepare(sql);
    if(!sql.startsWith('INSERT INTO seo_documents'))return statement;
    const bind=statement.bind.bind(statement);
    statement.bind=(...args)=>{
      const bound=bind(...args),run=bound.run.bind(bound);
      bound.run=async()=>{if(!switched){switched=true;await store.upsert('regional_editorial','config',{enabled:true,mode:'ai_research'});}return run();};
      return bound;
    };
    return statement;
  };
  const result=await prepareRegionalStep({SEO_DB:db},{now:setupAt,provider:forbidden});
  assert.equal(result.outcome,'state_changed');assert.equal(result.city,firstNew.slug);
  assert.deepEqual(await rows(db,'SELECT * FROM seo_documents ORDER BY id'),existing);
  assert.equal((await store.get('regional_editorial',manual.slug)).reason,'existing_draft_requires_review');
  assert.equal((await store.get('regional_editorial',paused.slug)).reason,'existing_draft_requires_review');
  assert.equal((await rows(db,'SELECT id FROM seo_published')).length,0);
});
