import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleManagerApi} from '../worker/seo-manager-api.mjs';
import {getDocuments, getPublished, publishDue, ensureDatabase, createStore} from '../worker/seo-store.mjs';
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

test('municipal routes are accepted while prefectures and protected repository URLs remain rejected', async t => {
  const db = sqliteD1(t);
  for (const slug of ['mie', '../contact']) {
    assert.equal((await call(db, '/api/seo/documents', {document: document({slug})})).status, 400, slug);
  }
  for(const slug of ['mie/meiwa','hokkaido/sapporo-chuo']) {
    const created=await call(db,'/api/seo/documents',{document:document({slug})});
    assert.equal(created.status,201,slug);
    const saved=(await created.json()).document;
    assert.equal(saved.path,`/service/ltori/area/${slug}/`);
    assert.equal(saved.status,'draft');
  }
  const protectedResponse = await call(db, '/api/seo/documents', {document: document()}, {}, {staticPages: [{path: '/service/ltori/area/mie/nabari/'}]});
  assert.equal(protectedResponse.status, 409);
  assert.equal((await getDocuments(db)).length, 2);
});

test('approval uses verified identity and draft edits preserve the previous public snapshot', async t => {
  const db = sqliteD1(t);
  const create = await call(db, '/api/seo/documents', {document: document({type:'article',slug:'snapshot-test',review: {reviewedBy: 'forged'}})});
  const draft = (await create.json()).document;
  const response = await call(db, `/api/seo/documents/${draft.id}/approve`, {version: draft.version});
  assert.equal(response.status, 200);
  const approved = (await response.json()).document;
  assert.equal(approved.review.reviewedBy, identity.email);
  assert.equal(approved.status, 'scheduled');
  await publishDue(db, new Date(Date.now() + 100));
  const live = (await getPublished(db))[0]; assert.equal(live.title, draft.title);
  const edited = await call(db, '/api/seo/documents', {document: document({type:'article',slug:'snapshot-test',title: '名張市の採用LINE・下書きで変更'}), expectedVersion: approved.version});
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
  const settings = await call(db, '/api/seo/settings', {paused: false, dailyLimit: 999, limits:{regional:{daily:999},media:{monthly:999}}});
  const configured=(await settings.json()).settings;
  assert.equal(configured.dailyLimit, null);
  assert.deepEqual(configured.limits,{regional:{daily:null,mode:'prefecture_campaign',prefectures:47},media:{monthly:10,daily:1,minimumIntervalDays:3}});
  const dashboard=await (await call(db, '/api/seo/dashboard')).json();
  assert.deepEqual(dashboard.settings,configuredWithoutDate(configured));
  assert.equal(dashboard.publicationStats.byScope.regional.dailyLimit,null);
  assert.equal(dashboard.publicationStats.byScope.media.monthlyLimit,10);
});

function configuredWithoutDate({updatedAt,...settings}) {return settings;}

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

test('the media analytics endpoint reads only report/status data and is read-only and owner-protected', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  const store = createStore(db), article = '/service/ltori/media/interview-followup/';
  const env = {SEO_DB: db, SEO_GA4_PROPERTY_ID: '123', SEO_GSC_SITE_URL: 'sc-domain:layr.co.jp'};
  await store.upsert('analytics', 'ga4:current', {source: 'ga4', period: 'current', propertyId: '123', siteUrl: env.SEO_GSC_SITE_URL,
    startDate: '2026-08-22', endDate: '2026-09-18', fetchedAt: '2026-09-21T21:15:00Z', timeZone: 'Asia/Tokyo',
    pages: [{path: article, views: 17, users: 10, sessions: 11, inquiries: 1, ctaClicks: 5, documentRequests: 2}, {path: '/service/ltori/area/mie/nabari/', views: 999}], queries: [], quality: {notes: []}});
  await store.upsert('integrations', 'ga4', {source: 'ga4', status: 'ok', lastAttemptAt: '2026-09-21T21:15:00Z', lastSuccessAt: '2026-09-21T21:15:00Z'});
  await store.upsert('integrations', 'inspection', {source: 'inspection', status: 'ok', unrelatedField: 'must-not-return'});
  await store.upsert('jobs', 'analytics', {status: 'completed', finishedAt: '2026-09-21T21:16:00Z', result: {internal: 'must-not-return'}});
  await store.upsert('scheduler', 'maintenance', {status: 'error', lastAttemptAt: '2026-09-21T21:17:00Z', lastSuccessAt: '2026-09-20T21:18:00Z', runId: '1234567', runAttempt: '2', token: 'must-not-return'});
  await store.upsert('scheduler', 'publish', {status: 'completed', runId: '7654321', privateField: 'must-not-return'});
  await store.upsert('leads', 'private-lead', {email: 'private-lead@example.test'});
  const path = '/api/seo/media/analytics', services = {staticPages: [{path: article, type: 'article'}, {path: '/service/ltori/area/mie/nabari/', type: 'city'}]};
  const response = await handleManagerApi(request(path), env, identity, path, services);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  const result = await response.json();
  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.reports[0].rows.map(row => row.pageId), ['interview-followup']);
  assert.equal(result.reports[0].rows[0].cta, 5);
  assert.equal(result.job.status, 'completed');
  assert.deepEqual(result.scheduler, {status: 'error', lastAttemptAt: '2026-09-21T21:17:00.000Z', lastSuccessAt: '2026-09-20T21:18:00.000Z', runId: '1234567', runAttempt: '2'});
  assert.equal(result.schedule.provider, 'github-actions');
  assert.equal(result.schedule.time, '06:17');
  assert.equal(result.integrations.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-lead|must-not-return|nabari|private_key|access_token/);
  assert.equal((await handleManagerApi(request(path, {}), env, identity, path, services)).status, 405);
  assert.equal((await handleManagerApi(request(path), env, {email: 'other@example.test'}, path, services)).status, 403);
});

test('media analytics includes live dynamic articles and removes them after withdrawal without exposing drafts', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  const store = createStore(db), path = '/api/seo/media/analytics';
  const livePath = '/service/ltori/media/live-extra/', draftPath = '/service/ltori/media/draft-extra/';
  const env = {SEO_DB: db, SEO_GA4_PROPERTY_ID: '123', SEO_GSC_SITE_URL: 'sc-domain:layr.co.jp'};
  await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('live-extra', livePath, JSON.stringify({type: 'article', title: '公開済みの記事', body: 'BODY-MUST-NOT-LEAK'}), 1, '2026-09-20T00:00:00Z').run();
  await call(db, '/api/seo/documents', {document: {type: 'article', slug: 'draft-extra', title: 'まだ非公開の記事'}});
  await store.upsert('analytics', 'ga4:current', {source: 'ga4', period: 'current', propertyId: '123', siteUrl: env.SEO_GSC_SITE_URL,
    startDate: '2026-08-22', endDate: '2026-09-18', fetchedAt: '2026-09-21T21:15:00Z', timeZone: 'Asia/Tokyo',
    pages: [{path: livePath, views: 7}, {path: draftPath, views: 99}], queries: [], quality: {notes: []}});
  const result = await (await handleManagerApi(request(path), env, identity, path)).json();
  assert.deepEqual(result.catalog, [{id: 'live-extra', path: livePath, title: '公開済みの記事', publication: 'published'}]);
  assert.deepEqual(result.reports[0].rows.map(row => row.pageId), ['live-extra']);
  assert.doesNotMatch(JSON.stringify(result), /BODY-MUST-NOT-LEAK|draft-extra|まだ非公開/);
  await db.prepare('DELETE FROM seo_published WHERE id=?').bind('live-extra').run();
  const withdrawn = await (await handleManagerApi(request(path), env, identity, path)).json();
  assert.deepEqual(withdrawn.catalog, []);
  assert.deepEqual(withdrawn.reports[0].rows, []);
});

test('workspace overview joins exact public catalogs without exposing stored documents or leads', async t => {
  const db = sqliteD1(t); await ensureDatabase(db);
  const store = createStore(db), path = '/api/seo/overview', article = '/service/ltori/media/extra-live/';
  const env = {SEO_DB: db, SEO_GA4_PROPERTY_ID: '123', SEO_GSC_SITE_URL: 'sc-domain:layr.co.jp'};
  await db.prepare('INSERT INTO seo_published(id,path,value,version,published_at) VALUES(?,?,?,?,?)').bind('extra-live', article, JSON.stringify({type: 'article', title: '公開済み', body: 'SECRET BODY'}), 1, '2026-09-20T00:00:00Z').run();
  await store.upsert('leads', 'private', {email: 'PRIVATE-LEAD'});
  for (const status of ['draft', 'paused', 'approved', 'scheduled']) await db.prepare('INSERT INTO seo_documents(id,path,type,status,version,value,updated_at) VALUES(?,?,?,?,?,?,?)').bind(`waiting-${status}`, `/service/ltori/media/waiting-${status}/`, 'article', status, 1, JSON.stringify({type: 'article', body: 'SECRET DRAFT'}), '2026-09-22T00:00:00Z').run();
  await store.upsert('analytics', 'ga4:current', {source: 'ga4', period: 'current', propertyId: '123', siteUrl: env.SEO_GSC_SITE_URL, startDate: '2026-08-23', endDate: '2026-09-19', fetchedAt: '2026-09-22T00:00:00Z', pages: [{path: article, views: 0}], coverage: {version: 2}, private_key: 'PRIVATE KEY'});
  const result = await (await handleManagerApi(request(path), env, identity, path, {staticPages: [{path: '/service/ltori/area/mie/nabari/', title: '名張', type: 'city'}]})).json();
  assert.equal(result.projects.length, 3);
  assert.equal(result.projects.find(row => row.id === 'media').publishedCount, 1);
  assert.equal(result.projects.find(row => row.id === 'media').pendingCount, 2, 'only approved and scheduled server records are publication waiting');
  assert.equal(result.projects.find(row => row.id === 'media').metrics.views, 0);
  assert.ok(result.projects.find(row => row.id === 'corporate').publishedCount > 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|private_key/);
  assert.equal((await handleManagerApi(request(path, {}), env, identity, path)).status, 405);
  assert.equal((await handleManagerApi(request(path), env, {email: 'other@example.test'}, path)).status, 403);
});

test('corporate editorial state is isolated, owner-only, catalog-allowlisted and revision checked', async t => {
  const db = sqliteD1(t), path = '/api/seo/corporate/state';
  const {default: catalog} = await import('../src/data/seo-corporate-catalog.json', {with: {type: 'json'}});
  const article = catalog[0].path;
  assert.deepEqual(await (await call(db, path)).json(), {state: {revision: 0, edits: {}}});
  const edits = {[article]: {priority: 'high', status: 'research', keyword: '採用 LINE', evidence: '一次資料を確認する', notes: '次回見直す'}};
  const first = await call(db, path, {state: {edits}, expectedRevision: 0}, {method: 'PUT'});
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {state: {revision: 1, edits}});
  assert.equal((await call(db, path, {state: {edits}, expectedRevision: 0}, {method: 'PUT'})).status, 409);
  assert.deepEqual(await (await call(db, '/api/seo/state')).json(), {state: null});
  const state = await (await call(db, path)).json(); assert.equal(state.state.edits[article].notes, '次回見直す');
  for (const badEdits of [{'/media/not-in-catalog/': edits[article]}, {[article]: {...edits[article], status: 'published'}}, {[article]: {...edits[article], keyword: 'x'.repeat(201)}}, {[article]: {...edits[article], evidence: 'x'.repeat(2001)}}, {[article]: {...edits[article], notes: 'x'.repeat(4001)}}, null]) {
    assert.equal((await call(db, path, {state: {edits: badEdits}, expectedRevision: 1}, {method: 'PUT'})).status, 400);
  }
  assert.equal((await call(db, path, {state: {edits}, expectedRevision: 1}, {method: 'PUT', requestOrigin: 'https://evil.example'})).status, 403);
  assert.equal((await call(db, path, {state: {edits}, expectedRevision: 1})).status, 405);
  assert.equal((await call(db, path, {padding: 'x'.repeat(512 * 1024), state: {edits}, expectedRevision: 1}, {method: 'PUT'})).status, 413);
  assert.equal((await handleManagerApi(request(path), {SEO_DB: db}, {email: 'other@example.test'}, path)).status, 403);
  assert.equal((await call(db, path, {state: {edits}, expectedRevision: 1}, {method: 'PUT'})).status, 200);
  assert.deepEqual(await getPublished(db), []);
  assert.deepEqual(await getDocuments(db), []);
});
