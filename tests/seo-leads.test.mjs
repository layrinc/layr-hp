import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {contactRelay, normalizeLead, saveLead} from '../worker/seo-leads.mjs';
import {ensureDatabase, createStore, backup} from '../worker/seo-store.mjs';

function sqliteD1(t) {
  const connection = new DatabaseSync(':memory:');
  t.after(() => connection.close());
  const prepared = (sql, bindings = []) => ({
    bind(...args) {return prepared(sql, args);},
    execute() {const result = connection.prepare(sql).run(...bindings); return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};},
    async run() {return this.execute();},
    async first(column) {const row = connection.prepare(sql).get(...bindings); return row ? column ? row[column] : {...row} : null;},
    async all() {return {success: true, results: connection.prepare(sql).all(...bindings).map(row => ({...row}))};},
  });
  return {prepare: sql => prepared(sql), async batch(statements) {connection.exec('BEGIN IMMEDIATE'); try {const results = statements.map(statement => statement.execute()); connection.exec('COMMIT'); return results;} catch (error) {connection.exec('ROLLBACK'); throw error;}}};
}

const now = new Date('2026-09-21T01:00:00Z');
const path = '/service/ltori/area/mie/nabari/';
const defaultId = '12345678-1234-1234-1234-123456789abc';
function formRequest({id = defaultId, origin = 'https://layr.co.jp', source = 'area/mie/nabari', fields = {}, method = 'POST'} = {}) {
  const body = new URLSearchParams({'お名前': '申込テスト氏名', '会社名': 'テスト株式会社', 'メールアドレス': 'private-person@example.test', 'お問い合わせ内容': '機密相談本文です', '_ltori_submission_id': id, '_ltori_source': source, ...fields});
  return new Request('https://layr.co.jp/api/ltori/contact', {method, headers: {Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.123'}, ...(method === 'POST' ? {body} : {})});
}
const resolveSource = async source => source === 'area/mie/nabari' ? {path, label: '三重県名張市の採用LINE'} : null;
const accepted = () => new Response(JSON.stringify({success: true}), {headers: {'Content-Type': 'application/json'}});

test('accepted contact is forwarded once and stored as one anonymous inquiry without personal data', async t => {
  const db = sqliteD1(t);
  let sends = 0;
  const fetchImpl = async (url, options) => {
    sends++;
    assert.match(url, /^https:\/\/formsubmit\.co\/ajax\//);
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('メールアドレス'), 'private-person@example.test');
    assert.equal(options.body.get('ご覧になったページ'), '三重県名張市の採用LINE');
    assert.equal(options.body.get('受付ID'), defaultId);
    return accepted();
  };
  const first = await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now});
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {success: true, leadId: defaultId});
  const retry = await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now});
  assert.equal(retry.status, 200);
  assert.equal(sends, 1);
  const store = createStore(db);
  const leads = await store.list('leads');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].value.stage, 'inquiry');
  assert.equal(leads[0].value.sourcePath, path);
  const dump = JSON.stringify(await backup(db));
  for (const personal of ['申込テスト氏名', 'テスト株式会社', 'private-person@example.test', '機密相談本文', '192.0.2.123']) assert.equal(dump.includes(personal), false);
});

test('rejected and timed-out upstream responses never create a lead or allow an unsafe duplicate retry', async t => {
  for (const failure of ['rejected', 'timeout', 'malformed']) {
    await t.test(failure, async t => {
      const db = sqliteD1(t);
      let sends = 0;
      const fetchImpl = async () => {
        sends++;
        if (failure === 'timeout') throw new DOMException('timeout', 'TimeoutError');
        return failure === 'rejected' ? new Response(JSON.stringify({success: false}), {status: 200}) : new Response('<not-json>', {status: 200});
      };
      const result = await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now});
      assert.equal(result.status, 502);
      assert.equal((await createStore(db).list('leads')).length, 0);
      assert.equal((await createStore(db).get('submissions', defaultId)).status, 'unconfirmed');
      assert.equal((await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 409);
      assert.equal(sends, 1);
    });
  }
});

test('simultaneous delivery of the same submission ID reserves one outbound message and one lead', async t => {
  const db = sqliteD1(t);
  let sends = 0;
  const fetchImpl = async () => {sends++; await Promise.resolve(); return accepted();};
  const results = await Promise.all([contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now}), contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now})]);
  assert.equal(sends, 1);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.equal((await createStore(db).list('leads')).length, 1);
});

test('accepted delivery remains successful if analytics persistence fails, preventing another outbound message', async t => {
  const base = sqliteD1(t);
  let failPersistence = false, sends = 0;
  const db = {...base, async batch(statements) {if (failPersistence) throw new Error('D1 unavailable after upstream accepted'); return base.batch(statements);}};
  const fetchImpl = async () => {sends++; failPersistence = true; return accepted();};
  const result = await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now});
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.success, true);
  assert.equal(body.recorded, false);
  assert.equal((await createStore(db).list('leads')).length, 0);
  failPersistence = false;
  const retry = await contactRelay(formRequest(), {SEO_DB: db}, resolveSource, {fetchImpl, now});
  assert.ok([200, 409].includes(retry.status));
  assert.equal(sends, 1);
});

test('non-production origins, malformed form fields, and honeypot never reach the delivery service', async t => {
  const db = sqliteD1(t);
  let sends = 0;
  const fetchImpl = async () => {sends++; return accepted();};
  for (const request of [formRequest({origin: 'https://attacker.example'}), formRequest({origin: 'https://layr.co.jp.evil.example'}), formRequest({origin: ''})]) assert.equal((await contactRelay(request, {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 403);
  assert.equal((await contactRelay(formRequest({fields: {'メールアドレス': 'invalid'}}), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 400);
  assert.equal((await contactRelay(formRequest({fields: {'お名前': ''}}), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 400);
  assert.equal((await contactRelay(formRequest({fields: {_honey: 'bot'}}), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 400);
  assert.equal((await contactRelay(formRequest({method: 'GET'}), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 405);
  assert.equal(sends, 0);
});

test('an unknown supplied source cannot become a forged regional attribution', async t => {
  const db = sqliteD1(t);
  let sourceSeen;
  const resolver = async source => {sourceSeen = source; return null;};
  const result = await contactRelay(formRequest({source: 'area/mie/invented-city'}), {SEO_DB: db}, resolver, {fetchImpl: async (_url, options) => {assert.equal(options.body.has('ご覧になったページ'), false); return accepted();}, now});
  assert.equal(result.status, 200);
  assert.equal(sourceSeen, 'area/mie/invented-city');
  assert.equal((await createStore(db).get('leads', defaultId)).sourcePath, '');
});

test('per-hour contact limit prevents the eleventh outbound message from the same source IP', async t => {
  const db = sqliteD1(t);
  let sends = 0;
  const fetchImpl = async () => {sends++; return accepted();};
  for (let i = 0; i < 10; i++) {
    const id = `12345678-1234-1234-1234-${String(i).padStart(12, '0')}`;
    assert.equal((await contactRelay(formRequest({id}), {SEO_DB: db}, resolveSource, {fetchImpl, now})).status, 200);
  }
  const result = await contactRelay(formRequest({id: '12345678-1234-1234-1234-999999999999'}), {SEO_DB: db}, resolveSource, {fetchImpl, now});
  assert.equal(result.status, 429);
  assert.equal(sends, 10);
});

test('manual lead editing strips extra personal fields and rejects stale simultaneous updates', async t => {
  const db = sqliteD1(t);
  await ensureDatabase(db);
  const lead = await saveLead(db, {id: defaultId, sourcePath: path, stage: 'inquiry', name: '個人名', email: 'private@example.test'}, 0, now);
  assert.equal(Object.hasOwn(lead, 'name'), false);
  assert.equal(Object.hasOwn(lead, 'email'), false);
  const updates = await Promise.allSettled([saveLead(db, {...lead, stage: 'qualified'}, 1, now), saveLead(db, {...lead, stage: 'meeting'}, 1, now)]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(updates.find(result => result.status === 'rejected').reason.status, 409);
  const stored = await createStore(db).get('leads', defaultId);
  assert.equal(stored.stage, updates.find(result => result.status === 'fulfilled').value.stage);
  assert.equal(stored.version, 2);
});

test('lead validation rejects external URLs, unsupported stages, personal references, and invalid money', () => {
  const base = {id: defaultId, sourcePath: path, stage: 'won'};
  for (const change of [{sourcePath: 'https://attacker.example/'}, {stage: 'fake'}, {reference: 'private@example.test'}, {revenueYen: -1}, {grossProfitYen: 1.5}]) assert.throws(() => normalizeLead({...base, ...change}, now), error => error.status === 400);
  assert.equal(normalizeLead({...base, revenueYen: ''}, now).revenueYen, null);
});
