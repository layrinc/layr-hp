import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureDatabase,saveDocument,approveDocument,getDocument,getPublished,publishDue,publicationStats,createStore} from '../worker/seo-store.mjs';
import {REGIONAL_PREFECTURES,normalizeRegionalCampaignConfig,readRegionalCampaignConfig,saveRegionalCampaignConfig,regionalCampaignDay,campaignDateForCity,readRegionalCampaignOverview} from '../worker/seo-regional-campaign.mjs';

function sqliteD1(t) {
  const connection=new DatabaseSync(':memory:');t.after(()=>connection.close());
  const prepared=(sql,bindings=[])=>({
    bind(...args){return prepared(sql,args);},
    execute(){const result=connection.prepare(sql).run(...bindings);return {success:true,meta:{changes:Number(result.changes)}};},
    async run(){return this.execute();},
    async first(){const row=connection.prepare(sql).get(...bindings);return row?{...row}:null;},
    async all(){return {results:connection.prepare(sql).all(...bindings).map(row=>({...row}))};},
  });
  return {prepare:sql=>prepared(sql),async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());connection.exec('COMMIT');return results;}catch(error){connection.exec('ROLLBACK');throw error;}}};
}
const startDate='2026-09-24',now=new Date('2026-09-24T00:17:00Z');
async function configured(t,config={enabled:true,startDate}) {
  const db=sqliteD1(t);await ensureDatabase(db);await saveRegionalCampaignConfig(db,config,{expectedRevision:0,now});return db;
}
async function cityDraft(db,city,{reviewed=true,scheduledAt='2026-09-24T00:17:00Z',...overrides}={}) {
  const doc=await saveDocument(db,{...city,type:'city',scheduledAt,...overrides},0,now);
  return reviewed?approveDocument(db,doc,doc.version,'verified reviewer',now):doc;
}

test('the master has exactly 47 ordered prefectures and 792 unique cities, excluding towns, villages and wards',()=>{
  assert.deepEqual(REGIONAL_PREFECTURES.map(pref=>pref.code),Array.from({length:47},(_,index)=>String(index+1).padStart(2,'0')));
  assert.equal(REGIONAL_PREFECTURES[0].slug,'hokkaido');assert.equal(REGIONAL_PREFECTURES.at(-1).slug,'okinawa');
  const cities=REGIONAL_PREFECTURES.flatMap(pref=>pref.cities);
  assert.equal(cities.length,792);assert.equal(new Set(cities.map(city=>city.id)).size,792);
  assert.ok(cities.every(city=>city.name.endsWith('市')));
  assert.ok(REGIONAL_PREFECTURES.every(pref=>pref.cities.every((city,index)=>index===0||city.code>pref.cities[index-1].code)));
  const config={enabled:true,startDate};
  assert.equal(campaignDateForCity(config,'hokkaido/sapporo'),startDate);
  assert.equal(campaignDateForCity(config,'aomori/aomori'),'2026-09-25');
  assert.equal(campaignDateForCity(config,'okinawa/naha'),'2026-11-09');
  for(const slug of ['hokkaido/sapporo-chuo','mie/meiwa','aomori','unknown'])assert.equal(campaignDateForCity(config,slug),null);
});

test('47-day calendar uses Japan days, enforces 09:17 and ends without wraparound or catch-up',()=>{
  const config={enabled:true,startDate};
  assert.equal(regionalCampaignDay(config,new Date('2026-09-23T14:59:59Z')).status,'upcoming');
  const midnight=regionalCampaignDay(config,new Date('2026-09-23T15:00:00Z'));
  assert.equal(midnight.dayNumber,1);assert.equal(midnight.prefecture.slug,'hokkaido');assert.equal(midnight.readyToPublish,false);
  assert.equal(regionalCampaignDay(config,new Date('2026-09-24T00:16:59Z')).readyToPublish,false);
  assert.equal(regionalCampaignDay(config,now).readyToPublish,true);
  assert.equal(regionalCampaignDay(config,new Date('2026-09-24T15:00:00Z')).prefecture.slug,'aomori');
  const final=regionalCampaignDay(config,new Date('2026-11-09T00:17:00Z'));
  assert.equal(final.dayNumber,47);assert.equal(final.prefecture.slug,'okinawa');
  assert.equal(regionalCampaignDay(config,new Date('2026-11-09T15:00:00Z')).status,'completed');
  assert.equal(regionalCampaignDay({enabled:false,startDate},now).readyToPublish,false);
});

test('configuration is strict, default disabled, revision checked and corruption fails closed',async t=>{
  const db=sqliteD1(t);await ensureDatabase(db);
  assert.equal((await readRegionalCampaignConfig(db)).enabled,false);
  for(const input of [null,[],{enabled:'true',startDate},{enabled:true},{enabled:true,startDate:'2026-02-30'},{enabled:false,startDate:'bad'}])assert.throws(()=>normalizeRegionalCampaignConfig(input),error=>error.status===400);
  const writes=await Promise.allSettled([saveRegionalCampaignConfig(db,{enabled:true,startDate},{expectedRevision:0,now}),saveRegionalCampaignConfig(db,{enabled:false,startDate},{expectedRevision:0,now})]);
  assert.equal(writes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(writes.find(result=>result.status==='rejected').reason.status,409);
  await db.prepare("UPDATE seo_kv SET value='invalid-json' WHERE namespace='regional_campaign'").run();
  const config=await readRegionalCampaignConfig(db);assert.equal(config.enabled,false);assert.equal(config.valid,false);
  await cityDraft(db,REGIONAL_PREFECTURES[0].cities[0]);
  assert.equal((await publishDue(db,now)).published.length,0);
  assert.equal((await db.prepare("SELECT value FROM seo_kv WHERE namespace='regional_campaign'").first()).value,'invalid-json');
});

test('disabled or missing campaign never falls back to the old daily 20 while note publication continues',async t=>{
  const db=sqliteD1(t);await ensureDatabase(db);
  await cityDraft(db,REGIONAL_PREFECTURES[0].cities[0]);
  const note=await saveDocument(db,{id:'article:example',path:'/service/ltori/media/example/',type:'article',scheduledAt:now.toISOString()},0,now);
  await approveDocument(db,note,note.version,'reviewer',now);
  assert.deepEqual((await publishDue(db,now)).published,['article:example']);
  await saveRegionalCampaignConfig(db,{enabled:false,startDate},{expectedRevision:0,now});
  assert.equal((await publishDue(db,now)).published.length,0);
});

test('only the assigned prefecture canonical cities publish; gaps and overdue cities remain explicit',async t=>{
  const db=await configured(t),hokkaido=REGIONAL_PREFECTURES[0],aomori=REGIONAL_PREFECTURES[1];
  for(const city of hokkaido.cities.slice(0,25))await cityDraft(db,city);
  await cityDraft(db,hokkaido.cities[25],{reviewed:false});
  await cityDraft(db,hokkaido.cities[26],{scheduledAt:'2026-09-25T00:17:00Z'});
  for(const city of aomori.cities.slice(0,2))await cityDraft(db,city);
  await cityDraft(db,{id:'city:hokkaido/sapporo-chuo',path:'/service/ltori/area/hokkaido/sapporo-chuo/'});
  await cityDraft(db,{id:'city:hokkaido/matsumae',path:'/service/ltori/area/hokkaido/matsumae/'});
  await cityDraft(db,{id:'city:made-up',path:hokkaido.cities[30].path});
  assert.equal((await publishDue(db,new Date('2026-09-24T00:16:59Z'))).published.length,0);
  const runs=await Promise.all([publishDue(db,now),publishDue(db,now),publishDue(db,now)]);
  assert.deepEqual(new Set(runs.flatMap(run=>run.published)),new Set(hokkaido.cities.slice(0,25).map(city=>city.id)));
  const overview=await readRegionalCampaignOverview(db,now);
  assert.deepEqual({total:overview.currentDay.total,live:overview.currentDay.live,ready:overview.currentDay.ready,missing:overview.currentDay.missing,dueReady:overview.currentDay.dueReady},{total:35,live:25,ready:1,missing:9,dueReady:0});
  assert.equal((await publishDue(db,new Date('2026-09-25T00:17:00Z'))).published.length,2);
  assert.equal((await getDocument(db,hokkaido.cities[26].id)).status,'scheduled');
  const later=await readRegionalCampaignOverview(db,new Date('2026-09-25T00:17:00Z'));
  assert.equal(later.prefectures[0].overdue,true);assert.equal(later.prefectures[0].remaining,10);
});

test('a concurrent campaign pause/date change invalidates the preselected prefecture inside the transaction',async t=>{
  const db=await configured(t);await cityDraft(db,REGIONAL_PREFECTURES[0].cities[0]);
  let intercepted=false;
  const racing={...db,async batch(statements){if(!intercepted){intercepted=true;await saveRegionalCampaignConfig(db,{enabled:false,startDate:'2026-09-25'},{expectedRevision:1,now});}return db.batch(statements);}};
  const result=await publishDue(racing,now);
  assert.equal(result.published.length,0);assert.equal((await getPublished(db)).length,0);
});

test('reservation timestamps with UTC, milliseconds and Japan offsets compare by time rather than text',async t=>{
  const db=await configured(t),cities=REGIONAL_PREFECTURES[0].cities;
  for(const [index,scheduledAt] of ['2026-09-24T00:17:00Z','2026-09-24T00:17:00.000Z','2026-09-24T09:17:00+09:00','2026-09-24T09:17:01+09:00'].entries())await cityDraft(db,cities[index],{scheduledAt});
  const before=await readRegionalCampaignOverview(db,now);assert.equal(before.currentDay.dueReady,3);
  assert.deepEqual(new Set((await publishDue(db,now)).published),new Set(cities.slice(0,3).map(city=>city.id)));
  assert.equal((await getDocument(db,cities[3].id)).status,'scheduled');
});

test('static and dynamic live cities reconcile once and are skipped; old publications and backups stay intact',async t=>{
  const db=await configured(t);
  const initial=await readRegionalCampaignOverview(db,now);
  assert.equal(initial.totals.live,3);assert.equal(initial.totals.total,792);
  const mie=REGIONAL_PREFECTURES.find(pref=>pref.slug==='mie');
  const dynamic=mie.cities.filter(city=>!['mie/nabari','mie/toba'].includes(city.slug)).slice(0,10);
  for(const city of dynamic)await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,1,?)').bind(city.id,city.path,JSON.stringify({...city,type:'city'}),'2026-09-22T00:17:00Z').run();
  // A duplicated static snapshot must not inflate live counts.
  const staticCity=mie.cities.find(city=>city.slug==='mie/nabari');
  await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,1,?)').bind(staticCity.id,staticCity.path,JSON.stringify({...staticCity,type:'city'}),'2026-09-18T00:17:00Z').run();
  let overview=await readRegionalCampaignOverview(db,now);assert.equal(overview.totals.live,13);
  const mieDay=new Date(campaignDateForCity({startDate},dynamic[0].slug)+'T09:17:00+09:00');
  // Static pages are never replaced by the campaign, even if a matching draft appears.
  await cityDraft(db,staticCity);
  assert.equal((await publishDue(db,mieDay)).published.length,0);
  const counts=await db.prepare('SELECT COUNT(*) AS n FROM seo_published').first();assert.equal(counts.n,11);
  overview=await readRegionalCampaignOverview(db,mieDay);assert.equal(overview.currentDay.live,12);
});

test('all 47 days publish exactly their own city set and no city is repeated on day 48',async t=>{
  const db=await configured(t);
  for(const pref of REGIONAL_PREFECTURES)for(const city of pref.cities) {
    if(['mie/nabari','mie/toba','wakayama/hashimoto'].includes(city.slug))continue;
    await cityDraft(db,city);
  }
  for(const [index,pref] of REGIONAL_PREFECTURES.entries()) {
    const date=campaignDateForCity({startDate},pref.cities[0].slug);
    const result=await publishDue(db,new Date(date+'T09:17:00+09:00'));
    const expected=pref.cities.filter(city=>!['mie/nabari','mie/toba','wakayama/hashimoto'].includes(city.slug)).map(city=>city.id);
    assert.deepEqual(new Set(result.published),new Set(expected),`day ${index+1} ${pref.name}`);
    assert.equal((await publishDue(db,new Date(date+'T10:17:00+09:00'))).published.length,0);
  }
  const end=new Date('2026-11-10T00:17:00Z');
  assert.equal((await publishDue(db,end)).published.length,0);
  const stats=await publicationStats(db,end);
  assert.equal(stats.byScope.regional.campaign.totals.live,792);
  assert.equal(stats.byScope.regional.campaign.totals.remaining,0);
  assert.equal((await getPublished(db)).length,789);
});
