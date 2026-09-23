import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from 'jose';
import worker from '../worker/index.mjs';
import {SCHEDULER_URL, verifySchedulerToken, handleSchedulerRequest} from '../worker/seo-scheduler.mjs';
import {ensureDatabase, createStore} from '../worker/seo-store.mjs';

const issuer = 'https://token.actions.githubusercontent.com';
const workflow = 'layrinc/layr-hp/.github/workflows/seo-growth-schedule.yml@refs/heads/main';
const {publicKey, privateKey} = await generateKeyPair('RS256');
const keys = createLocalJWKSet({keys: [{...await exportJWK(publicKey), kid: 'scheduler-test', alg: 'RS256'}]});

async function token(changes = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer, aud: SCHEDULER_URL, iat: now, nbf: now, exp: now + 300,
    sub: 'repo:layrinc/layr-hp:ref:refs/heads/main',
    repository: 'layrinc/layr-hp', repository_id: '1358719278',
    repository_owner: 'layrinc', repository_owner_id: '289750214',
    ref: 'refs/heads/main', workflow_ref: workflow, event_name: 'schedule',
    run_id: '35678415299', run_attempt: '1', ...changes,
  }).setProtectedHeader({alg: 'RS256', kid: 'scheduler-test'}).sign(signingKey);
}

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
  return {prepare: sql => prepared(sql), async batch(statements) {
    connection.exec('BEGIN IMMEDIATE');
    try {const result = statements.map(statement => statement.execute()); connection.exec('COMMIT'); return result;}
    catch (error) {connection.exec('ROLLBACK'); throw error;}
  }};
}

function request({url = SCHEDULER_URL, method = 'POST', jwt = 'verified-in-test', body = {kind: 'publish'}, contentType = 'application/json', rawBody, headers = {}} = {}) {
  return new Request(url, {
    method,
    headers: {'Content-Type': contentType, ...(jwt ? {Authorization: `Bearer ${jwt}`} : {}), ...headers},
    ...(['GET', 'HEAD'].includes(method) ? {} : {body: rawBody ?? JSON.stringify(body)}),
  });
}

const identity = {runId: '35678415299', runAttempt: '1'};
const verified = async () => identity;
const initialize = async env => ensureDatabase(env.SEO_DB);
const completed = async () => ({status: 'completed', result: {day: '2026-09-22', dailyLimit: 10, published: ['reviewed-document']}});

test('GitHub OIDC accepts the exact main workflow and both allowed trigger events', async () => {
  for (const event_name of ['schedule', 'workflow_dispatch', 'push']) {
    assert.deepEqual(await verifySchedulerToken(await token({event_name}), keys), identity);
  }
  assert.deepEqual(await verifySchedulerToken(await token({sub: 'repo:layrinc@289750214/layr-hp@1358719278:ref:refs/heads/main'}), keys), identity);
});

test('GitHub OIDC rejects forged signatures, wrong issuer/audience, missing and expired timestamps', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifySchedulerToken(await token({}, other.privateKey), keys));
  for (const changes of [
    {iss: 'https://example.test'}, {aud: 'https://seo.layr.co.jp'},
    {aud: undefined}, {iss: undefined}, {iat: undefined}, {exp: undefined},
    {exp: 1}, {iat: 1}, {iat: Math.floor(Date.now() / 1000) + 3600},
    {nbf: Math.floor(Date.now() / 1000) + 3600}, {iat: Math.floor(Date.now() / 1000) - 700},
  ]) await assert.rejects(verifySchedulerToken(await token(changes), keys), undefined, JSON.stringify(changes));
  await assert.rejects(verifySchedulerToken('eyJhbGciOiJub25lIn0.e30.', keys));
});

test('repository names alone cannot authorize a transferred, recreated, fork or unrelated workflow', async () => {
  for (const changes of [
    {repository: 'attacker/layr-hp'}, {repository_id: '999'}, {repository_id: undefined},
    {repository_owner_id: '999'}, {repository_owner_id: undefined},
    {ref: 'refs/heads/feature'}, {ref: 'refs/tags/main'},
    {workflow_ref: 'layrinc/layr-hp/.github/workflows/another.yml@refs/heads/main'},
    {workflow_ref: workflow.replace('@refs/heads/main', '@refs/heads/feature')},
    {workflow_ref: undefined}, {event_name: 'pull_request'}, {event_name: 'pull_request_target'},
    {sub: 'repo:layrinc/layr-hp:pull_request'}, {sub: 'repo:layrinc/layr-hp:environment:production'},
    {sub: 'repo:attacker/layr-hp:ref:refs/heads/main'}, {sub: undefined},
    {sub: 'repo:layrinc@289750214/layr-hp@999:ref:refs/heads/main'},
    {sub: 'repo:layrinc@999/layr-hp@1358719278:ref:refs/heads/main'},
    {run_id: undefined}, {run_id: '../run'}, {run_attempt: '0'}, {run_attempt: undefined},
  ]) await assert.rejects(verifySchedulerToken(await token(changes), keys), undefined, JSON.stringify(changes));
});

test('ordinary public paths are left to the existing site handler without auth or database access', async () => {
  let touched = false;
  const response = await handleSchedulerRequest(request({url: 'https://layr.co.jp/service/ltori/'}), {}, {
    verify: async () => {touched = true; throw new Error('Unexpected auth');},
    initialize: async () => {touched = true;}, execute: async () => {touched = true;},
  });
  assert.equal(response, null);
  assert.equal(touched, false);
});

test('scheduler host, transport, query and method gates reject before database initialization', async () => {
  let touched = false;
  const env = {SEO_DB: {prepare() {touched = true; throw new Error('Unexpected database access');}}};
  const services = {verify: verified, initialize: async () => {touched = true;}, execute: async () => {touched = true;}};
  for (const url of [SCHEDULER_URL.replace('https:', 'http:'), SCHEDULER_URL.replace('layr.co.jp', 'seo.layr.co.jp'), SCHEDULER_URL.replace('layr.co.jp', 'layr-hp.biz-oneservice.workers.dev'), `${SCHEDULER_URL}?kind=publish`]) {
    const response = await handleSchedulerRequest(request({url}), env, services);
    assert.ok(response && response.status >= 400, url);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
    assert.equal((await handleSchedulerRequest(request({method}), env, services)).status, 405);
  }
  for (const Origin of ['https://layr.co.jp', 'https://seo.layr.co.jp', 'https://attacker.test', 'null']) {
    assert.equal((await handleSchedulerRequest(request({headers: {Origin}}), env, services)).status, 403);
  }
  assert.equal(touched, false);
});

test('missing or invalid bearer credentials fail closed without initializing or executing any job', async () => {
  let touched = false;
  const services = {verify: async () => {throw new Error('secret signature detail');}, initialize: async () => {touched = true;}, execute: async () => {touched = true;}};
  for (const headers of [{}, {Authorization: 'Bearer bad'}, {Authorization: 'Basic bad'}, {'Cf-Access-Authenticated-User-Email': 'biz.oneservice@gmail.com'}, {Cookie: 'CF_Authorization=fake'}]) {
    const response = await handleSchedulerRequest(request({jwt: null, headers}), {}, services);
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /secret signature detail/);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  }
  assert.equal(touched, false);
});

test('only a small JSON object with publish or maintenance is accepted before initialization', async () => {
  let touched = false;
  const services = {verify: verified, initialize: async () => {touched = true;}, execute: async () => {touched = true;}};
  for (const body of [null, [], {}, {kind: 'analytics'}, {kind: 'inspection'}, {kind: 'delete'}, {kind: ['publish']}]) {
    assert.equal((await handleSchedulerRequest(request({body}), {}, services)).status, 400);
  }
  assert.equal((await handleSchedulerRequest(request({rawBody: '{invalid'}), {}, services)).status, 400);
  assert.equal((await handleSchedulerRequest(request({contentType: 'text/plain'}), {}, services)).status, 415);
  assert.equal((await handleSchedulerRequest(request({body: {kind: 'publish', padding: '字'.repeat(400)}}), {}, services)).status, 413);
  assert.equal(touched, false);
});

test('a completed publication retry returns success without rerunning the job or exposing private results', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  let executions = 0;
  const execute = async () => {executions++; return {status: 'completed', result: {day: '2026-09-22', dailyLimit: 10, published: ['reviewed-document'], source: 'PRIVATE_SOURCE_CONTENT', token: 'SECRET_TOKEN'}};};
  const services = {verify: verified, initialize, execute};
  const first = await handleSchedulerRequest(request(), env, services);
  assert.equal(first.status, 200);
  assert.doesNotMatch(await first.text(), /PRIVATE_SOURCE_CONTENT|SECRET_TOKEN/);
  const again = await handleSchedulerRequest(request(), env, services);
  assert.equal(again.status, 200);
  assert.equal(executions, 1);
  const rows = await createStore(env.SEO_DB).list('scheduler_runs');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, `${identity.runId}:${identity.runAttempt}:publish`);
});

test('concurrent delivery receives 409 while the accepted HTTP request awaits job completion', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  let release, started, executions = 0, settled = false;
  const entered = new Promise(resolve => {started = resolve;});
  const barrier = new Promise(resolve => {release = resolve;});
  const services = {verify: verified, initialize, execute: async () => {executions++; started(); await barrier; return completed();}};
  const first = handleSchedulerRequest(request(), env, services).then(response => {settled = true; return response;});
  await entered;
  assert.equal(settled, false);
  const overlapping = await handleSchedulerRequest(request(), env, services);
  assert.equal(overlapping.status, 409);
  assert.equal(executions, 1);
  release();
  assert.equal((await first).status, 200);
});

test('a failed job returns a sanitized 503 and the same delivery can be retried', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  let executions = 0;
  const services = {verify: verified, initialize, execute: async () => {executions++; if (executions === 1) throw new Error('SECRET_DB_CONNECTION'); return completed();}};
  const failure = await handleSchedulerRequest(request(), env, services);
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /SECRET_DB_CONNECTION/);
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 200);
  assert.equal(executions, 2);
});

test('an already running underlying job is not recorded as a completed scheduler delivery', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  let executions = 0;
  const services = {verify: verified, initialize, execute: async () => ++executions === 1 ? {status: 'running'} : completed()};
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 503);
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 200);
  assert.equal(executions, 2);
});

test('maintenance invokes both server jobs and has a separate idempotency key from publication', async t => {
  const env = {SEO_DB: sqliteD1(t)}, executed = [];
  const services = {verify: verified, initialize, execute: async (_env, kind) => {executed.push(kind); return completed();}};
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 200);
  assert.equal((await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, services)).status, 200);
  assert.deepEqual(executed, ['publish', 'analytics', 'inspection']);
  assert.equal((await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, services)).status, 200);
  assert.equal(executed.length, 3);
  assert.deepEqual((await createStore(env.SEO_DB).list('scheduler_runs')).map(row => row.key).sort(), [`${identity.runId}:1:maintenance`, `${identity.runId}:1:publish`]);
});

test('partial maintenance failure is retryable and is never cached as completed', async t => {
  const env = {SEO_DB: sqliteD1(t)}, executed = [];
  let firstInspection = true;
  const services = {verify: verified, initialize, execute: async (_env, kind) => {
    executed.push(kind);
    if (kind === 'inspection' && firstInspection) {firstInspection = false; throw new Error('PRIVATE_INSPECTION_DETAIL');}
    return completed();
  }};
  const failure = await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, services);
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /PRIVATE_INSPECTION_DETAIL/);
  assert.equal((await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, services)).status, 200);
  assert.deepEqual(executed, ['analytics', 'inspection', 'analytics', 'inspection']);
});

test('maintenance reports absent Google configuration without inventing a successful data sync', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  const execute = async (_env, kind) => ({status: 'completed', result: kind === 'analytics' ? {statuses: [{status: 'not_configured'}, {status: 'not_configured'}]} : {status: 'not_configured', inspected: 0}});
  const response = await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, {verify: verified, initialize, execute});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.results.map(result => result.outcome), ['not_configured', 'not_configured']);
});

test('nonthrowing analytics error and partial inspection results fail the scheduler run for retry', async t => {
  for (const failedKind of ['analytics', 'inspection']) {
    const env = {SEO_DB: sqliteD1(t)};
    const execute = async (_env, kind) => ({status: 'completed', result: kind === 'analytics'
      ? {statuses: [{status: kind === failedKind ? 'error' : 'ok', detail: 'PRIVATE_GOOGLE_RESPONSE'}]}
      : {status: kind === failedKind ? 'partial' : 'ok', detail: 'PRIVATE_GOOGLE_RESPONSE'}});
    const response = await handleSchedulerRequest(request({body: {kind: 'maintenance'}}), env, {verify: verified, initialize, execute});
    assert.equal(response.status, 503, failedKind);
    assert.doesNotMatch(await response.text(), /PRIVATE_GOOGLE_RESPONSE/);
    const row = await createStore(env.SEO_DB).get('scheduler_runs', `${identity.runId}:1:maintenance`);
    assert.equal(row.status, 'error');
  }
});

test('GitHub reruns use their verified attempt and reject client supplied run identities', async t => {
  const env = {SEO_DB: sqliteD1(t)};
  let attempt = '1', executions = 0;
  const services = {verify: async () => ({...identity, runAttempt: attempt}), initialize, execute: async () => {executions++; return completed();}};
  assert.equal((await handleSchedulerRequest(request({body: {kind: 'publish', runId: 'attacker', runAttempt: '999'}}), env, services)).status, 400);
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 200);
  attempt = '2';
  assert.equal((await handleSchedulerRequest(request(), env, services)).status, 200);
  assert.equal(executions, 2);
  assert.deepEqual((await createStore(env.SEO_DB).list('scheduler_runs')).map(row => row.key).sort(), [`${identity.runId}:1:publish`, `${identity.runId}:2:publish`]);
});

test('the production Worker routes anonymous scheduler requests before assets and database access', async () => {
  let touched = false;
  const env = {
    SEO_DB: {prepare() {touched = true; throw new Error('Unexpected DB');}},
    ASSETS: {fetch: async () => {touched = true; return new Response('asset');}},
  };
  const response = await worker.fetch(request({jwt: null}), env, {waitUntil() {touched = true;}});
  assert.equal(response.status, 401);
  assert.equal(touched, false);
});

test('preparation only accepts a bounded step and replays it without returning draft content',async t=>{
  const env={SEO_DB:sqliteD1(t)};let calls=0;
  const execute=async()=>{calls++;return {status:'completed',result:{done:false,outcome:'progress',blockedCount:0,privateDraft:'SECRET ARTICLE'}};};
  const services={verify:verified,initialize,execute};
  const req=step=>request({body:{kind:'prepare',step}});
  for(const body of [{kind:'prepare'},{kind:'prepare',step:-1},{kind:'prepare',step:240},{kind:'prepare',step:0,prompt:'custom'}])assert.equal((await handleSchedulerRequest(request({body}),env,services)).status,400);
  const first=await handleSchedulerRequest(req(0),env,services);assert.equal(first.status,200);assert.doesNotMatch(await first.clone().text(),/SECRET|privateDraft/);
  await handleSchedulerRequest(req(0),env,services);assert.equal(calls,1);
  await handleSchedulerRequest(req(1),env,services);assert.equal(calls,2);
});
