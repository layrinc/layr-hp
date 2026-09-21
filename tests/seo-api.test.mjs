import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleManagerApi} from '../worker/seo-manager-api.mjs';
import {getDocuments, getPublished, publishDue} from '../worker/seo-store.mjs';
import {publicFetch} from '../worker/seo-runtime.mjs';

function sqliteD1(t) {
  const connection = new DatabaseSync(':memory:'); t.after(() => connection.close());
  const prepared = (sql, bindings = []) => ({
    bind(...args) {return prepared(sql, args);},
    execute() {const result = connection.prepare(sql).run(...bindings); return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};},
    async run() {return this.execute();},
    async first(column) {const row = connection.prepare(sql).get(...bindings); return row ? column ? row[column] : {...row} : null;},
    async all() {return {success: true, results: connection.prepare(sql).all(...bindings).map(row => ({...row}))};},
  });
  return {prepare: sql => prepared(sql), async batch(statements) {connection.exec('BEGIN IMMEDIATE'); try {const results = statements.map(statement => statement.execute()); connection.exec('COMMIT'); return results;} catch (error) {connection.exec('ROLLBACK'); throw error;}}};
}
const identity = {email: 'biz.oneservice@gmail.com'};
const origin = 'https://seo.layr.co.jp';
function request(path, body, {method = body === undefined ? 'GET' : 'POST', requestOrigin = origin, contentType = 'application/json'} = {}) {
  return new Request(`${origin}${path}`, {method, headers: {Origin: requestOrigin, 'Content-Type': contentType}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
}
async function call(db, path, body, options = {}, services = {}) {
  return handleManagerApi(request(path, body, options), {SEO_DB: db}, identity, path.split('?')[0], services);
}
function document(overrides = {}) {
  return {type: 'city', slug: 'mie/nabari', title: '名張市の採用LINE構築', heading: '名張市の採用LINE運用', description: '名張市の企業の応募対応を整理します。', lead: '応募の後に必要な情報を候補者に伝える運用です。', intent: 'employer', sections: [
    {heading: '募集条件の整理', paragraphs: ['採用担当者が職種と勤務時間を確認します。']},
    {heading: '応募への回答', paragraphs: ['候補者の質問に答える担当と時間を決めます。']},
    {heading: '面接の案内', steps: ['面接の集合場所と連絡先を伝える。']},
  ], example: {title: '面接前の案内例', body: '当日は案内した場所にお越しください。'}, sources: [{title: '名張市の公式情報', url: 'https://www.city.nabari.lg.jp/', checkedAt: new Date().toISOString().slice(0, 10), geographicScope: '名張市'}], ...overrides};
}

test('owner, same-origin writes, and supported methods are checked before database work', async () => {
  let touched = false;
  const env = {SEO_DB: {prepare() {touched = true; throw new Error('Should not touch DB');}}};
  const wrongOwner = await handleManagerApi(request('/api/seo/dashboard'), env, {email: 'other@example.com'}, '/api/seo/dashboard');
  assert.equal(wrongOwner.status, 403);
  for (const requestOrigin of ['https://evil.example', 'null', 'https://layr.co.jp', '']) {
    const response = await handleManagerApi(request('/api/seo/settings', {paused: true}, {requestOrigin}), env, identity, '/api/seo/settings');
    assert.equal(response.status, 403);
  }
  const method = await handleManagerApi(request('/api/seo/settings', undefined, {method: 'DELETE'}), env, identity, '/api/seo/settings');
  assert.equal(method.status, 405);
  assert.equal(touched, false);
  assert.match(wrongOwner.headers.get('Cache-Control'), /no-store/);
  assert.match(wrongOwner.headers.get('X-Robots-Tag'), /noindex/);
});

test('draft saving ignores client approval and incomplete drafts cannot be approved', async t => {
  const db = sqliteD1(t);
  const response = await call(db, '/api/seo/documents', {document: {type: 'article', slug: 'draft-guide', status: 'published', review: {reviewedBy: 'forged'}, publishedAt: new Date().toISOString()}});
  assert.equal(response.status, 201);
  const saved = (await response.json()).document;
  assert.equal(saved.status, 'draft'); assert.equal(saved.review, null); assert.equal(saved.publishedAt, null);
  const approval = await call(db, `/api/seo/documents/${saved.id}/approve`, {version: saved.version});
  assert.equal(approval.status, 422);
  assert.equal((await getDocuments(db))[0].status, 'draft');
  assert.deepEqual(await getPublished(db), []);
});

test('city restrictions and protected repository URLs apply at the API boundary', async t => {
  const db = sqliteD1(t);
  for (const slug of ['mie', 'mie/meiwa', 'hokkaido/sapporo-chuo', '../contact']) {
    assert.equal((await call(db, '/api/seo/documents', {document: document({slug})})).status, 400, slug);
  }
  const protectedResponse = await call(db, '/api/seo/documents', {document: document()}, {}, {staticPages: [{path: '/service/ltori/area/mie/nabari/'}]});
  assert.equal(protectedResponse.status, 409);
  assert.equal((await getDocuments(db)).length, 0);
});

test('approval uses verified identity and draft edits preserve the previous public snapshot', async t => {
  const db = sqliteD1(t);
  const create = await call(db, '/api/seo/documents', {document: document({review: {reviewedBy: 'forged'}})});
  const draft = (await create.json()).document;
  const response = await call(db, `/api/seo/documents/${draft.id}/approve`, {version: draft.version});
  assert.equal(response.status, 200);
  const approved = (await response.json()).document;
  assert.equal(approved.review.reviewedBy, identity.email);
  assert.equal(approved.status, 'scheduled');
  await publishDue(db, new Date(Date.now() + 100));
  const live = (await getPublished(db))[0]; assert.equal(live.title, draft.title);
  const edited = await call(db, '/api/seo/documents', {document: document({title: '名張市の採用LINE・下書きで変更'}), expectedVersion: approved.version});
  assert.equal(edited.status, 201);
  const updated = (await edited.json()).document;
  assert.equal(updated.review, null); assert.equal(updated.status, 'draft');
  assert.equal((await getPublished(db))[0].title, live.title);
  assert.equal((await call(db, '/api/seo/documents', {document: document(), expectedVersion: approved.version})).status, 409);
  assert.equal((await call(db, `/api/seo/documents/${draft.id}/approve`, {version: approved.version})).status, 409);
});

test('the API blocks identical body approvals and never trusts a client-defined daily limit', async t => {
  const db = sqliteD1(t);
  const first = (await (await call(db, '/api/seo/documents', {document: document()})).json()).document;
  assert.equal((await call(db, `/api/seo/documents/${first.id}/approve`, {version: first.version})).status, 200);
  const second = (await (await call(db, '/api/seo/documents', {document: document({slug: 'mie/toba', title: '鳥羽市の採用LINE', heading: '鳥羽市の採用LINE運用'})})).json()).document;
  assert.equal((await call(db, `/api/seo/documents/${second.id}/approve`, {version: second.version})).status, 422);
  const settings = await call(db, '/api/seo/settings', {paused: false, dailyLimit: 999});
  assert.equal((await settings.json()).settings.dailyLimit, 10);
});

test('workspace updates use revision checks and backups remain private', async t => {
  const db = sqliteD1(t);
  const initial = await call(db, '/api/seo/state', {state: {rows: [{id: 'test'}]}, expectedRevision: 0}, {method: 'PUT'});
  assert.equal(initial.status, 200); const state = (await initial.json()).state;
  assert.equal(state.revision, 1);
  assert.equal((await call(db, '/api/seo/state', {state: {rows: []}, expectedRevision: 0}, {method: 'PUT'})).status, 409);
  const saved = await (await call(db, '/api/seo/state')).json(); assert.equal(saved.state.rows.length, 1);
  const backup = await call(db, '/api/seo/backup');
  assert.equal(backup.status, 200); assert.match(backup.headers.get('Cache-Control'), /no-store/); assert.match(backup.headers.get('Content-Disposition'), /attachment/);
});

test('manager preview is private and not indexable; public template and manager API aliases never reach assets', async t => {
  const db = sqliteD1(t);
  const saved = (await (await call(db, '/api/seo/documents', {document: document()})).json()).document;
  const preview = await call(db, `/api/seo/preview?id=${encodeURIComponent(saved.id)}`, undefined, {}, {preview: async () => new Response('preview')});
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('Cache-Control'), 'private, no-store'); assert.match(preview.headers.get('X-Robots-Tag'), /noindex/);
  let assetRequests = 0;
  const env = {ASSETS: {fetch: async () => {assetRequests++; return new Response('asset');}}};
  for (const path of ['/service/ltori/article-template/', '/service/ltori/article-template/index.html', '/service/ltori/article-template.html', '/service/ltori/%61rticle-template/', '/service//ltori/article-template/', '/api/seo/backup', '/api%2fseo%2fbackup', '/API/SEO/backup']) {
    const response = await publicFetch(new Request(`https://layr.co.jp${path}`), env);
    assert([403, 404].includes(response.status), path);
  }
  assert.equal(assetRequests, 0);
});

test('JSON content type and invalid JSON are rejected without changing stored documents', async t => {
  const db = sqliteD1(t);
  assert.equal((await call(db, '/api/seo/documents', {document: document()}, {contentType: 'text/plain'})).status, 415);
  const malformed = await handleManagerApi(new Request(`${origin}/api/seo/documents`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: '{invalid'}), {SEO_DB: db}, identity, '/api/seo/documents');
  assert.equal(malformed.status, 400);
  assert.equal((await getDocuments(db)).length, 0);
});

test('null and non-object document payloads return a validation error without writes', async t => {
  const db = sqliteD1(t);
  for (const payload of [null, [], {document:null}, {document:[]}, {document:'invalid'}]) {
    assert.equal((await call(db, '/api/seo/documents', payload)).status, 400);
  }
  assert.equal((await getDocuments(db)).length, 0);
});
