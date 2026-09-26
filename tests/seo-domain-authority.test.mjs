import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateMeasurement, normalizeAuthority, summarizeAuthority} from '../src/lib/seo-manager/domain-authority-model.mjs';
import {readDomainAuthority, addMeasurement, refreshDomainAuthority} from '../worker/seo-domain-authority.mjs';
import {ensureDatabase, createStore} from '../worker/seo-store.mjs';
import {handleManagerApi} from '../worker/seo-manager-api.mjs';

function sqliteD1(t) {
  const connection = new DatabaseSync(':memory:'); t.after(() => connection.close());
  const prepared = (sql, bindings = []) => ({
    bind(...args) {return prepared(sql, args);},
    execute() {const result = connection.prepare(sql).run(...bindings); return {success: true, meta: {changes: Number(result.changes)}};},
    async run() {return this.execute();},
    async first() {const row = connection.prepare(sql).get(...bindings); return row ? {...row} : null;},
    async all() {return {success: true, results: connection.prepare(sql).all(...bindings).map(row => ({...row}))};},
  });
  return {prepare: sql => prepared(sql), async batch(statements) {return statements.map(statement => statement.execute());}};
}
const now = new Date('2026-09-26T03:00:00Z');

test('measurements keep each source on its own scale and reject hand-entered Open PageRank', () => {
  assert.equal(validateMeasurement({source: 'ahrefs_dr', value: 12.345, measuredAt: '2026-09-26'}).value, 12.35);
  for (const bad of [{source: 'ahrefs_dr', value: 101, measuredAt: '2026-09-26'}, {source: 'moz_da', value: -1, measuredAt: '2026-09-26'}, {source: 'ahrefs_dr', value: 10, measuredAt: '26/09/2026'}, {source: 'open_pagerank', value: 3, measuredAt: '2026-09-26'}, {source: 'unknown', value: 3, measuredAt: '2026-09-26'}]) assert.throws(() => validateMeasurement(bad));
  const state = normalizeAuthority({history: [{source: 'ahrefs_dr', value: 3, measuredAt: '2026-08-26'}, {source: 'moz_da', value: 9, measuredAt: '2026-09-01'}, {source: 'ahrefs_dr', value: 5, measuredAt: '2026-09-26'}, {source: 'ahrefs_dr', value: 'x', measuredAt: 'bad'}]});
  const summary = summarizeAuthority(state);
  assert.deepEqual(summary.find(row => row.source === 'ahrefs_dr').change, 2);
  assert.equal(summary.find(row => row.source === 'moz_da').change, null, 'a single value has no change');
  assert.equal(summary.find(row => row.source === 'open_pagerank').latest, null);
});

test('manual entries use optimistic locking and replace the same source and date', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  const first = await addMeasurement(db, {source: 'ahrefs_dr', value: 3, measuredAt: '2026-09-26'}, 0, now);
  assert.equal(first.revision, 1);
  assert.equal(await addMeasurement(db, {source: 'ahrefs_dr', value: 4, measuredAt: '2026-09-26'}, 0, now), null, 'stale revision');
  const second = await addMeasurement(db, {source: 'ahrefs_dr', value: 4, measuredAt: '2026-09-26'}, 1, now);
  assert.deepEqual(second.history.map(row => row.value), [4]);
});

test('Open PageRank is fetched weekly with the key only, and failures keep a fixed code', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  let calls = 0;
  assert.equal((await refreshDomainAuthority({SEO_DB: db}, {now, fetchImpl: async () => { calls++; }})).outcome, 'not_configured');
  const revision = (await readDomainAuthority(db)).revision;
  await refreshDomainAuthority({SEO_DB: db}, {now, fetchImpl: async () => { calls++; }});
  assert.equal((await readDomainAuthority(db)).revision, revision, 'no daily writes while unconfigured'); assert.equal(calls, 0);
  const requests = [];
  const ok = async (url, init) => { requests.push({url, init}); return Response.json({results: [{domain: 'layr.co.jp', found: true, open_page_rank: 2.41, referring_domains: 18, as_of: '2026-09-01'}]}); };
  assert.equal((await refreshDomainAuthority({SEO_DB: db, OPEN_PAGERANK_API_KEY: 'opr_test'}, {now, fetchImpl: ok})).outcome, 'ok');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer opr_test'); assert.deepEqual(JSON.parse(requests[0].init.body), {domains: ['layr.co.jp']});
  const saved = await readDomainAuthority(db);
  assert.deepEqual(saved.history.map(row => [row.source, row.value, row.referringDomains, row.automatic]), [['open_pagerank', 2.41, 18, true]]);
  assert.doesNotMatch(JSON.stringify(saved), /opr_test/);
  assert.equal((await refreshDomainAuthority({SEO_DB: db, OPEN_PAGERANK_API_KEY: 'opr_test'}, {now: new Date(now.getTime() + 86400000), fetchImpl: ok})).outcome, 'cached');
  const later = new Date(now.getTime() + 8 * 86400000);
  assert.equal((await refreshDomainAuthority({SEO_DB: db, OPEN_PAGERANK_API_KEY: 'bad'}, {now: later, fetchImpl: async () => new Response('SECRET', {status: 401})})).outcome, 'error');
  const failed = await readDomainAuthority(db);
  assert.equal(failed.automation.code, 'unauthorized'); assert.equal(failed.history.length, 1, 'a failure keeps earlier values');
  assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
});

test('the overview API returns authority, backlinks gained and accepts only valid manual entries', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  await createStore(db).upsert('backlinks', 'state', {entries: {s001: {status: 'live'}, s002: {status: 'applied'}}});
  await createStore(db).upsert('outreach', 'state', {entries: {o001: {status: 'live'}}});
  const origin = 'https://seo.layr.co.jp', path = '/api/seo/domain-authority';
  const call = (body, init = {}) => handleManagerApi(new Request(`${origin}${path}`, {method: body ? 'POST' : 'GET', headers: {Origin: init.origin || origin, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}), {SEO_DB: db}, {email: init.email || 'biz.oneservice@gmail.com'}, path);
  const initial = await (await call()).json();
  assert.equal(initial.configured, false); assert.deepEqual(initial.backlinks, {applications: 1, outreach: 1}); assert.equal(initial.state.revision, 0);
  assert.equal((await call({expectedRevision: 0, measurement: {source: 'ahrefs_dr', value: 7, measuredAt: '2026-09-26'}})).status, 200);
  assert.equal((await call({expectedRevision: 0, measurement: {source: 'ahrefs_dr', value: 8, measuredAt: '2026-09-27'}})).status, 409);
  assert.equal((await call({expectedRevision: 1, measurement: {source: 'open_pagerank', value: 3, measuredAt: '2026-09-27'}})).status, 400);
  assert.equal((await call({expectedRevision: 1, measurement: {source: 'ahrefs_dr', value: 8, measuredAt: '2026-09-27'}}, {origin: 'https://evil.example'})).status, 403);
  assert.equal((await call(undefined, {email: 'other@example.test'})).status, 403);
  assert.equal((await (await call()).json()).state.history[0].value, 7);
});
