import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureDatabase, createStore, saveWorkspace, getWorkspace, saveDocument, approveDocument, pauseDocument, getDocument, getDocuments, getPublished, publishDue, publicationStats, backup} from '../worker/seo-store.mjs';
import {REGIONAL_PREFECTURES,saveRegionalCampaignConfig} from '../worker/seo-regional-campaign.mjs';

// Exercise the actual SQLite statements against real constraints and atomic
// transactions, rather than accepting SQL strings in a behaviorless fake.
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

const beforeMidnight = new Date('2026-09-21T14:59:59.000Z');
const afterMidnight = new Date('2026-09-21T15:00:00.000Z');
function document(index, overrides = {}) {
  const city=REGIONAL_PREFECTURES[0].cities[index];
  return {id:city.id, type: 'city', path:city.path, title:city.name, body: `Reviewed useful original content ${index}`, scheduledAt: '2026-09-21T01:00:00.000Z', ...overrides};
}
const cityId=index=>REGIONAL_PREFECTURES[0].cities[index].id;
async function enableCampaign(db) {if(!await db.prepare("SELECT value FROM seo_kv WHERE namespace='regional_campaign' AND key='config'").first())await saveRegionalCampaignConfig(db,{enabled:true,startDate:'2026-09-21'},{expectedRevision:0,now:beforeMidnight});}
async function enqueue(db, count, {start = 0, scheduledAt} = {}) {
  await enableCampaign(db);
  for (let i = start; i < start + count; i++) {
    const saved = await saveDocument(db, document(i, scheduledAt ? {scheduledAt} : {}), 0, beforeMidnight);
    await approveDocument(db, saved, saved.version, 'owner@example.test', beforeMidnight);
  }
}
async function enqueueArticles(db,count,{scheduledAt='2026-09-01T00:00:00.000Z',start=0}={}) {
  for(let index=start;index<start+count;index++) {
    const id=`article-${String(index).padStart(3,'0')}`;
    const saved=await saveDocument(db,document(index,{id,type:'article',path:`/service/ltori/media/${id}/`,scheduledAt}),0,beforeMidnight);
    await approveDocument(db,saved,saved.version,'owner@example.test',beforeMidnight);
  }
}

test('all approved cities for the assigned prefecture publish once, including overlapping deliveries', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 26);
  const runs = await Promise.all([publishDue(db, beforeMidnight), publishDue(db, beforeMidnight), publishDue(db, beforeMidnight)]);
  assert.equal(runs.reduce((sum, run) => sum + run.published.length, 0), 26);
  assert.equal((await getPublished(db)).length, 26);
  const stats = await publicationStats(db, beforeMidnight);
  assert.equal(stats.byScope.regional.campaign.day.prefecture.slug,'hokkaido');
  assert.equal(stats.byScope.regional.queued,0);
  assert.equal(stats.day, '2026-09-21');
  assert.equal(stats.todayPublished, 26);
  assert.equal(stats.queued, 0);
  assert.equal(stats.dailyLimit, null);
  assert.equal(stats.releaseCountToday, 26);
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 0);
  const exported = await backup(db);
  assert.equal(exported.tables.seo_release_events.length, 26);
  assert.equal(new Set(exported.tables.seo_release_events.map(row => `${row.document_id}:${row.version}`)).size, 26);
});

test('prefecture assignment changes at Japan midnight but publication waits until 09:17', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 3);
  for(const city of REGIONAL_PREFECTURES[1].cities.slice(0,2)) {
    const draft=await saveDocument(db,document(0,{id:city.id,path:city.path}),0,beforeMidnight);
    await approveDocument(db,draft,draft.version,'owner@example.test',beforeMidnight);
  }
  await publishDue(db, beforeMidnight);
  const next = await publishDue(db, afterMidnight);
  assert.equal(next.day, '2026-09-22');
  assert.equal(next.published.length, 0);
  assert.equal(next.byScope.regional.campaignDay.prefecture,'aomori');
  const morning=new Date('2026-09-22T00:17:00Z');
  assert.equal((await publishDue(db,morning)).published.length,2);
  assert.equal((await getPublished(db)).length,5);
  assert.equal((await publicationStats(db,morning)).todayPublished,2);
});

test('regional and note quotas are independent and repeated deliveries cannot publish two new articles', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);
  await enqueue(db,22);await enqueueArticles(db,4);
  const runs=await Promise.all([publishDue(db,beforeMidnight),publishDue(db,beforeMidnight),publishDue(db,beforeMidnight)]);
  assert.equal(runs.flatMap(run=>run.byScope.regional.published).length,22);
  assert.equal(runs.flatMap(run=>run.byScope.media.published).length,1);
  assert.equal((await getPublished(db)).length,23);
  const stats=await publicationStats(db,beforeMidnight);
  assert.equal(stats.byScope.regional.todayPublished,22);
  assert.equal(stats.byScope.regional.queued,0);
  assert.equal(stats.byScope.media.monthPublished,1);
  assert.equal(stats.byScope.media.todayPublished,1);
  assert.equal(stats.byScope.media.queued,3);
  assert.equal(stats.byScope.media.dueReady,3);
  assert.equal(stats.byScope.media.nextEligibleAt,'2026-09-24T09:17:00+09:00');
  assert.equal(stats.releaseCountToday,23);
});

test('note articles wait three Japan calendar days even when overdue reservations are queued', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueueArticles(db,3);
  assert.equal((await publishDue(db,beforeMidnight)).published.length,1);
  assert.equal((await publishDue(db,new Date('2026-09-23T14:59:59Z'))).published.length,0);
  const released=await publishDue(db,new Date('2026-09-23T15:00:00Z'));
  assert.equal(released.day,'2026-09-24');
  assert.equal(released.published.length,1);
  assert.equal((await publishDue(db,new Date('2026-09-23T15:00:00Z'))).published.length,0);
});

test('ten new note articles consume the monthly budget and it resets at Japan month boundary', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueueArticles(db,12);
  for(let day=1;day<=28;day+=3) {
    const now=new Date(`2026-10-${String(day).padStart(2,'0')}T00:17:00Z`);
    assert.equal((await publishDue(db,now)).published.length,1);
  }
  // October 31 is three days after the tenth article, so the monthly ceiling
  // must block this release independently of the minimum spacing rule.
  const monthEnd=new Date('2026-10-31T14:59:59Z');
  assert.equal((await publishDue(db,monthEnd)).published.length,0);
  const stats=await publicationStats(db,monthEnd);
  assert.equal(stats.byScope.media.monthPublished,10);
  assert.equal(stats.byScope.media.nextEligibleAt,'2026-11-01T09:17:00+09:00');
  const nextMonthStart=new Date('2026-10-31T15:00:00Z');
  assert.equal((await publishDue(db,nextMonthStart)).published.length,1);
  assert.equal((await publicationStats(db,nextMonthStart)).byScope.media.monthPublished,1);
  assert.equal((await getPublished(db)).length,11);
});

test('note cadence carries across month boundaries instead of releasing on consecutive days', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueueArticles(db,2);
  await publishDue(db,new Date('2026-09-30T00:17:00Z'));
  const octoberFirst=new Date('2026-09-30T15:00:00Z');
  assert.equal((await publishDue(db,octoberFirst)).published.length,0);
  const stats=await publicationStats(db,octoberFirst);
  assert.equal(stats.byScope.media.monthPublished,0);
  assert.equal(stats.byScope.media.nextEligibleAt,'2026-10-03T09:17:00+09:00');
  assert.equal((await publishDue(db,new Date('2026-10-02T15:00:00Z'))).published.length,1);
});

test('reviewed live-city corrections remain available without restarting the campaign', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueue(db,21);
  await publishDue(db,beforeMidnight);
  const live=await getDocument(db,cityId(0));
  const draft=await saveDocument(db,{...live,body:'Reviewed correction'},live.version,beforeMidnight);
  await approveDocument(db,draft,draft.version,'owner@example.test',beforeMidnight);
  await saveRegionalCampaignConfig(db,{enabled:false,startDate:'2026-09-21'},{expectedRevision:1,now:beforeMidnight});
  assert.deepEqual((await publishDue(db,beforeMidnight)).published,[cityId(0)]);
  const stats=await publicationStats(db,beforeMidnight);
  assert.equal(stats.byScope.regional.todayPublished,21);
  assert.equal(stats.releaseCountToday,22);
  assert.equal((await getDocument(db,cityId(20))).status,'published');
});

test('article corrections preserve first-publication history, monthly quota and new-article spacing', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueueArticles(db,2);
  await publishDue(db,beforeMidnight);
  const live=await getDocument(db,'article-000');
  const draft=await saveDocument(db,{...live,body:'Corrected fact with review'},live.version,beforeMidnight);
  await approveDocument(db,draft,draft.version,'owner@example.test',beforeMidnight);
  assert.deepEqual((await publishDue(db,beforeMidnight)).published,['article-000']);
  let stats=await publicationStats(db,beforeMidnight);
  assert.equal(stats.byScope.media.monthPublished,1);
  assert.equal(stats.byScope.media.nextEligibleAt,'2026-09-24T09:17:00+09:00');
  const october=new Date('2026-10-01T00:17:00Z');
  const current=await getDocument(db,'article-000');
  const octoberDraft=await saveDocument(db,{...current,body:'Next month correction'},current.version,october);
  await approveDocument(db,octoberDraft,octoberDraft.version,'owner@example.test',october);
  const released=await publishDue(db,october);
  assert.deepEqual(new Set(released.published),new Set(['article-000','article-001']));
  stats=await publicationStats(db,october);
  assert.equal(stats.byScope.media.monthPublished,1);
  assert.equal(stats.byScope.media.todayPublished,1);
  assert.equal(stats.releaseCountToday,2);
});

test('legacy release events are preserved and still consume the note monthly quota', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);await enqueue(db,26);await enqueueArticles(db,12);
  const historical=[];
  const previousCityIds=new Set(REGIONAL_PREFECTURES[0].cities.slice(0,10).map(city=>city.id));
  for(const doc of (await getDocuments(db)).filter(doc=>doc.type==='city'?previousCityIds.has(doc.id):Number(doc.id.slice(8))<10)) {
    const id=`legacy:${doc.id}`;historical.push(id);
    const releasedDay=doc.type==='city'?'2026-09-21':'2026-09-01';
    await db.prepare('INSERT INTO seo_release_events(id,day,document_id,version,run_id,created_at) VALUES(?,?,?,?,?,?)').bind(id,releasedDay,doc.id,doc.version,'legacy-shared-ten',`${releasedDay}T00:17:00Z`).run();
    await db.prepare("UPDATE seo_documents SET status='published',value=json_set(value,'$.status','published') WHERE id=?").bind(doc.id).run();
  }
  const released=await publishDue(db,beforeMidnight);
  assert.equal(released.byScope.regional.published.length,16);
  assert.equal(released.byScope.media.published.length,0);
  const stats=await publicationStats(db,beforeMidnight);
  assert.equal(stats.byScope.regional.todayPublished,26);
  assert.equal(stats.byScope.media.monthPublished,10);
  const retained=(await backup(db)).tables.seo_release_events.filter(row=>row.run_id==='legacy-shared-ten');
  assert.deepEqual(new Set(retained.map(row=>row.id)),new Set(historical));
});

test('due-ready counts exclude future reservations and unreviewed edits for each scope', async t => {
  const db=sqliteD1(t);await ensureDatabase(db);
  await enqueue(db,2);await enqueue(db,1,{start:2,scheduledAt:'2026-09-22T09:00:00Z'});
  await enqueueArticles(db,2);await enqueueArticles(db,1,{start:2,scheduledAt:'2026-09-22T09:00:00Z'});
  const article=await getDocument(db,'article-001');await saveDocument(db,article,article.version,beforeMidnight);
  const stats=await publicationStats(db,beforeMidnight);
  assert.equal(stats.byScope.regional.queued,3);assert.equal(stats.byScope.regional.dueReady,2);
  assert.equal(stats.byScope.media.queued,2);assert.equal(stats.byScope.media.dueReady,1);
});

test('global pause retains approved queue without consuming the publication budget', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 3);
  await enqueueArticles(db,3);
  const store = createStore(db);
  await store.upsert('settings', 'publication', {paused: true});
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 0);
  assert.equal((await publicationStats(db, beforeMidnight)).queued, 6);
  assert.equal((await publicationStats(db, beforeMidnight)).byScope.media.monthPublished,0);
  assert.equal((await getPublished(db)).length, 0);
  await store.upsert('settings', 'publication', {paused: false});
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 4);
});

test('unreviewed drafts, future reservations, and individually paused pages never leak into publication', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enableCampaign(db);
  await saveDocument(db, document(1), 0, beforeMidnight);
  const future = await saveDocument(db, document(2, {scheduledAt: '2026-09-22T09:00:00.000Z'}), 0, beforeMidnight);
  await approveDocument(db, future, 1, 'owner@example.test', beforeMidnight);
  const paused = await saveDocument(db, document(3), 0, beforeMidnight);
  const pausedApproval = await approveDocument(db, paused, paused.version, 'owner@example.test', beforeMidnight);
  await pauseDocument(db, paused.id, pausedApproval.version, beforeMidnight);
  assert.deepEqual((await publishDue(db, beforeMidnight)).published, []);
  assert.deepEqual(await getPublished(db), []);
});

test('editing an approved draft revokes review; old approval and old edits conflict', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enableCampaign(db);
  const original = await saveDocument(db, document(1), 0, beforeMidnight);
  const approved = await approveDocument(db, original, original.version, 'owner@example.test', beforeMidnight);
  const edited = await saveDocument(db, {...approved, body: 'New text awaiting review'}, approved.version, beforeMidnight);
  assert.equal(edited.status, 'draft');
  assert.equal(edited.review, null);
  assert.equal(edited.version, approved.version + 1);
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 0);
  await assert.rejects(() => approveDocument(db, original, 1, 'owner@example.test', beforeMidnight), error => error.status === 409);
  await assert.rejects(() => saveDocument(db, original, 1, beforeMidnight), error => error.status === 409);
  await approveDocument(db, edited, edited.version, 'owner@example.test', beforeMidnight);
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 1);
});

test('editing a live page leaves the approved live snapshot intact until reviewed replacement is released', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 1);
  await publishDue(db, beforeMidnight);
  const originalLive = (await getPublished(db))[0];
  const draft = await saveDocument(db, {...originalLive, title: 'Unapproved replacement', body: 'Work in progress'}, originalLive.version, beforeMidnight);
  assert.equal((await getDocument(db, draft.id)).status, 'draft');
  assert.equal((await getPublished(db))[0].title, originalLive.title);
  assert.equal((await getPublished(db))[0].version, originalLive.version);
  await publishDue(db, beforeMidnight);
  assert.equal((await getPublished(db))[0].version, originalLive.version);
  const reviewed = await approveDocument(db, draft, draft.version, 'owner@example.test', beforeMidnight);
  await publishDue(db, beforeMidnight);
  assert.equal((await getPublished(db))[0].version, reviewed.version);
  assert.equal((await getPublished(db))[0].title, 'Unapproved replacement');
  assert.equal((await publicationStats(db, beforeMidnight)).todayPublished, 1);
  assert.equal((await publicationStats(db, beforeMidnight)).releaseCountToday, 2);
});

test('pausing a live page withdraws the public snapshot but preserves an editable original', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 1);
  await publishDue(db, beforeMidnight);
  const live = (await getPublished(db))[0];
  await pauseDocument(db, live.id, live.version, beforeMidnight);
  assert.equal((await getPublished(db)).length, 0);
  assert.equal((await getDocuments(db))[0].status, 'paused');
  assert.match((await getDocument(db,cityId(0))).body,/Reviewed/);
  assert.equal((await publishDue(db, beforeMidnight)).published.length, 0);
});

test('a withdrawn page can be reviewed again and resumed without editing its content', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 1);
  await publishDue(db, beforeMidnight);
  const first = (await getPublished(db))[0];
  await pauseDocument(db, first.id, first.version, beforeMidnight);
  const withdrawn = await getDocument(db, first.id);
  const reviewed = await approveDocument(db, withdrawn, withdrawn.version, 'owner@example.test', beforeMidnight);
  const resumed = await publishDue(db, beforeMidnight);
  assert.deepEqual(resumed.published, [first.id]);
  const live = (await getPublished(db))[0];
  assert.equal(live.body, first.body);
  assert.equal(live.version, reviewed.version);
  assert.equal(live.status, 'published');
});

test('CAS workspace and document writes allow one winner and preserve that winner', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await saveWorkspace(db, {label: 'initial'}, 0, beforeMidnight);
  const saves = await Promise.allSettled([saveWorkspace(db, {label: 'first'}, 1, beforeMidnight), saveWorkspace(db, {label: 'second'}, 1, beforeMidnight)]);
  assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(saves.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await getWorkspace(db)).label, saves.find(result => result.status === 'fulfilled').value.label);
  assert.equal((await getWorkspace(db)).revision, 2);
  await saveDocument(db, document(7), 0, beforeMidnight);
  const edits = await Promise.allSettled([saveDocument(db, document(7, {title: 'A'}), 1, beforeMidnight), saveDocument(db, document(7, {title: 'B'}), 1, beforeMidnight)]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(edits.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await getDocument(db,cityId(7))).version,2);
});

test('publication transaction rolls back quota and status if the public snapshot insert fails', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await enqueue(db, 1);
  await db.prepare("CREATE TRIGGER fail_publication BEFORE INSERT ON seo_published BEGIN SELECT RAISE(ABORT,'fixture publication failed'); END").run();
  await assert.rejects(() => publishDue(db, beforeMidnight),/fixture publication failed/);
  assert.equal((await publicationStats(db, beforeMidnight)).todayPublished, 0);
  assert.equal((await getDocument(db,cityId(0))).status,'scheduled');
});

test('legacy inline workspace state remains readable and upgrades without losing its revision', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  const original = {version: 1, keywords: [{query: '名張市 採用LINE'}], reports: []};
  await db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('workspace','state',?,7,?)").bind(JSON.stringify(original), beforeMidnight.toISOString()).run();
  assert.deepEqual(await getWorkspace(db), {...original, revision: 7, updatedAt: beforeMidnight.toISOString()});
  const updated = {...original, keywords: [...original.keywords, {query: '橋本市 採用LINE'}]};
  await saveWorkspace(db, updated, 7, afterMidnight);
  assert.deepEqual(await getWorkspace(db), {...updated, revision: 8, updatedAt: afterMidnight.toISOString()});
});

test('a workspace above 3MB round-trips Japanese, emoji, escapes and CSV in D1-safe chunks', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  // Place a surrogate pair directly across the otherwise fixed chunk boundary.
  const prefix = '日'.repeat(500000 - '{"csv":"'.length - 1);
  const value = {csv: `${prefix}😀${'語'.repeat(510000)}\n"quoted",\\escaped`, reports: [{source: 'Google', missing: null}]};
  assert.ok(new TextEncoder().encode(JSON.stringify(value)).length > 3000000);
  await saveWorkspace(db, value, 0, beforeMidnight);
  assert.deepEqual(await getWorkspace(db), {...value, revision: 1, updatedAt: beforeMidnight.toISOString()});
  const exported = await backup(db);
  const parts = exported.tables.seo_kv.filter(row => row.namespace === 'workspace_parts');
  assert.ok(parts.length > 1);
  assert.ok(parts.every(row => new TextEncoder().encode(row.value).length < 2*1024*1024));
  assert.ok(parts.every(row => typeof JSON.parse(row.value) === 'string'));
});

test('simultaneous large workspace writes preserve the winner and leave no losing or obsolete chunks', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await saveWorkspace(db, {payload: '旧'.repeat(1000000)}, 0, beforeMidnight);
  const first = {label: 'first', payload: '一'.repeat(1000000)};
  const second = {label: 'second', payload: '二'.repeat(1000000)};
  const attempts = await Promise.allSettled([saveWorkspace(db, first, 1, afterMidnight), saveWorkspace(db, second, 1, afterMidnight)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  const winner = attempts.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(await getWorkspace(db), winner);
  const exported = await backup(db);
  const metadata = JSON.parse(exported.tables.seo_kv.find(row => row.namespace === 'workspace' && row.key === 'state').value).__seoWorkspaceStorage;
  const parts = exported.tables.seo_kv.filter(row => row.namespace === 'workspace_parts');
  assert.equal(parts.length, metadata.parts);
  assert.ok(parts.every(row => row.key.startsWith(`${metadata.token}:`)));
});

test('failure after chunk metadata and first part writes rolls back the complete workspace transaction', async t => {
  const base = sqliteD1(t);
  await ensureDatabase(base);
  const original = {payload: '元'.repeat(1000000)};
  await saveWorkspace(base, original, 0, beforeMidnight);
  const previous = await backup(base);
  const failing = {...base, batch(statements) {return base.batch([...statements.slice(0, 2), base.prepare('INSERT INTO nonexistent_table(value) VALUES(1)'), ...statements.slice(2)]);}};
  await assert.rejects(() => saveWorkspace(failing, {payload: '新'.repeat(1000000)}, 1, afterMidnight), /no such table/);
  assert.deepEqual(await getWorkspace(base), {...original, revision: 1, updatedAt: beforeMidnight.toISOString()});
  assert.deepEqual((await backup(base)).tables.seo_kv, previous.tables.seo_kv);
});

test('incomplete chunk storage raises a recoverable error instead of returning an empty workspace', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  await saveWorkspace(db, {payload: 'x'.repeat(600000)}, 0, beforeMidnight);
  await db.prepare("DELETE FROM seo_kv WHERE namespace='workspace_parts' AND key=(SELECT MIN(key) FROM seo_kv WHERE namespace='workspace_parts')").run();
  await assert.rejects(() => getWorkspace(db), error => error.status === 503);
});

test('workspace rejects invalid objects and values above the existing 20MiB ceiling before writing', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  for(const value of [null, [], 'text'])await assert.rejects(() => saveWorkspace(db, value, 0, beforeMidnight), error => error.status === 400);
  await assert.rejects(() => saveWorkspace(db, {payload: 'x'.repeat(20*1024*1024)}, 0, beforeMidnight), error => error.status === 413);
  assert.equal(await getWorkspace(db), null);
});
