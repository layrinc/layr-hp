import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSeoGrowthJob, SCHEDULER_ENDPOINT } from '../scripts/run-seo-growth-job.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'layrinc/layr-hp',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: 'layrinc/layr-hp/.github/workflows/seo-growth-schedule.yml@refs/heads/main',
  GITHUB_EVENT_NAME: 'schedule',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://run-actions-1-azure-eastus.actions.githubusercontent.com/idtoken?api-version=2.0&audience=old',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-request-secret',
};
const json = (body, options) => Response.json(body, options);
const done = (kind = 'publish') => ({
  status: 'completed', kind, runId: '123', runAttempt: '1',
  results: kind === 'publish'
    ? [{ kind: 'publish', status: 'completed', publishedCount: 10, day: '2026-09-22' }]
    : [{ kind: 'analytics', status: 'completed', outcome: 'not_configured' }, { kind: 'inspection', status: 'completed', outcome: 'completed' }],
});

function harness(responses, extra = {}) {
  const calls = [], logs = [], delays = [];
  return {
    calls, logs, delays,
    options: {
      env, log: message => logs.push(message), sleep: async ms => delays.push(ms),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        assert.ok(responses.length, 'unexpected network request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      }, ...extra,
    },
  };
}

test('runner uses a fixed audience and endpoint, awaits completion, and logs no credentials', async () => {
  const h = harness([json({ value: 'oidc.payload.signature' }), json({ ...done(), diagnostic: 'PRIVATE server detail' })]);
  const result = await runSeoGrowthJob('publish', h.options);
  assert.equal(result.results[0].publishedCount, 10);
  assert.equal(h.calls.length, 2);
  const oidc = new URL(h.calls[0].url);
  assert.equal(oidc.searchParams.get('audience'), SCHEDULER_ENDPOINT);
  assert.equal(oidc.searchParams.getAll('audience').length, 1);
  assert.equal(oidc.searchParams.get('api-version'), '2.0');
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer runner-request-secret');
  assert.equal(h.calls[1].url, SCHEDULER_ENDPOINT);
  assert.equal(h.calls[1].init.headers.Authorization, 'Bearer oidc.payload.signature');
  assert.equal(h.calls[1].init.method, 'POST');
  assert.equal(h.calls[1].init.body, '{"kind":"publish"}');
  for (const { init } of h.calls) {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(h.calls[0].init.signal, h.calls[1].init.signal);
  assert.doesNotMatch(h.logs.join('\n'), /runner-request-secret|oidc\.payload|PRIVATE|runId/);
});

test('main workflow dispatch can await both maintenance jobs', async () => {
  const h = harness([json({ value: 'oidc.payload.signature' }), json(done('maintenance'))], { env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' } });
  const result = await runSeoGrowthJob('maintenance', h.options);
  assert.deepEqual(result.results.map(row => row.outcome), ['not_configured', 'completed']);
});

test('invalid kinds, forks, non-main refs, other workflows and events fail before any request', async () => {
  const invalid = [
    ['delete', env],
    ['publish', { ...env, GITHUB_ACTIONS: 'false' }],
    ['publish', { ...env, GITHUB_REPOSITORY: 'attacker/layr-hp' }],
    ['publish', { ...env, GITHUB_REF: 'refs/heads/feature' }],
    ['publish', { ...env, GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace('seo-growth-schedule.yml', 'other.yml') }],
    ['publish', { ...env, GITHUB_EVENT_NAME: 'pull_request_target' }],
    ['publish', { ...env, GITHUB_EVENT_NAME: 'workflow_run' }],
  ];
  for (const [kind, invalidEnv] of invalid) {
    const h = harness([], { env: invalidEnv });
    await assert.rejects(runSeoGrowthJob(kind, h.options), /invalid_job_kind|untrusted_workflow_context/);
    assert.equal(h.calls.length, 0);
  }
});

test('OIDC bearer credentials cannot be sent to arbitrary URLs or insecure schemes', async () => {
  for (const url of ['http://actions.githubusercontent.com/token', 'https://evil.test/token', 'https://actions.githubusercontent.com.evil.test/token', 'https://user:password@actions.githubusercontent.com/token', 'https://actions.githubusercontent.com:444/token', 'not a url']) {
    const h = harness([], { env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: url } });
    await assert.rejects(runSeoGrowthJob('publish', h.options), /invalid_oidc_url/);
    assert.equal(h.calls.length, 0);
  }
  const h = harness([], { env: { ...env, ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' } });
  await assert.rejects(runSeoGrowthJob('publish', h.options), /missing_oidc_credentials/);
});

test('429 and 503 retry with a fresh OIDC token, bounded Retry-After, and at most three attempts', async () => {
  const h = harness([
    json({ value: 'oidc.first.signature' }), json({ error: 'private' }, { status: 503, headers: { 'Retry-After': '99999' } }),
    json({ value: 'oidc.second.signature' }), json({ error: 'private' }, { status: 429 }),
    json({ value: 'oidc.third.signature' }), json(done()),
  ]);
  await runSeoGrowthJob('publish', h.options);
  assert.equal(h.calls.length, 6);
  assert.deepEqual(h.delays, [30_000, 10_000]);
  assert.deepEqual(h.calls.filter(row => row.init.method === 'POST').map(row => row.init.headers.Authorization), [
    'Bearer oidc.first.signature', 'Bearer oidc.second.signature', 'Bearer oidc.third.signature',
  ]);
  const exhausted = harness(Array.from({ length: 3 }, () => [json({ value: 'oidc.payload.signature' }), json({ error: 'private' }, { status: 503 })]).flat());
  await assert.rejects(runSeoGrowthJob('publish', exhausted.options), /HTTP 503/);
  assert.equal(exhausted.calls.length, 6);
  assert.equal(exhausted.delays.length, 2);
});

test('transient OIDC issuer failure retries before sending a job request', async () => {
  const h = harness([json({ error: 'issuer unavailable' }, { status: 503 }), json({ value: 'oidc.payload.signature' }), json(done())]);
  await runSeoGrowthJob('publish', h.options);
  assert.equal(h.calls.filter(row => row.init.method === 'GET').length, 2);
  assert.equal(h.calls.filter(row => row.init.method === 'POST').length, 1);
});

test('other HTTP failures and redirects do not retry or expose server messages', async () => {
  for (const status of [301, 400, 401, 403, 409, 500]) {
    const h = harness([json({ value: 'oidc.payload.signature' }), json({ error: 'PRIVATE ::error::token' }, { status })]);
    await assert.rejects(runSeoGrowthJob('publish', h.options), error => error.message.includes(`HTTP ${status}`) && !error.message.includes('PRIVATE'));
    assert.equal(h.calls.length, 2);
    assert.equal(h.delays.length, 0);
    assert.equal(h.logs.length, 0);
  }
});

test('successful HTTP responses still fail if a job is incomplete, duplicated, or contains an error', async () => {
  const invalid = [
    { ...done(), error: 'PRIVATE' },
    { ...done(), status: 'running' },
    { ...done(), kind: 'maintenance' },
    { ...done(), results: [] },
    { ...done(), results: [{ kind: 'publish', status: 'completed', publishedCount: 11 }] },
    { ...done(), results: [{ kind: 'publish', status: 'completed', publishedCount: 2, error: 'PRIVATE' }] },
    { ...done(), results: [{ kind: 'publish', status: 'queued', publishedCount: 2 }] },
  ];
  for (const body of invalid) {
    const h = harness([json({ value: 'oidc.payload.signature' }), json(body)]);
    await assert.rejects(runSeoGrowthJob('publish', h.options), /invalid_response|job_not_completed|invalid_publish_count/);
    assert.equal(h.logs.length, 0);
  }
  const h = harness([json({ value: 'oidc.payload.signature' }), json({ ...done('maintenance'), results: [{ kind: 'analytics', status: 'completed' }, { kind: 'analytics', status: 'completed' }] })]);
  await assert.rejects(runSeoGrowthJob('maintenance', h.options), /job_not_completed/);
  for (const outcome of [undefined, 'partial', 'error', 'PRIVATE unknown']) {
    const body = done('maintenance');
    body.results[0].outcome = outcome;
    const h = harness([json({ value: 'oidc.payload.signature' }), json(body)]);
    await assert.rejects(runSeoGrowthJob('maintenance', h.options), /job_not_completed/);
  }
});

test('invalid JSON, oversized responses and invalid tokens fail without leaking response text', async () => {
  for (const response of [new Response('PRIVATE invalid JSON'), new Response('x'.repeat(65_537)), json({ value: 'PRIVATE not-a-token' })]) {
    const h = harness([response]);
    await assert.rejects(runSeoGrowthJob('publish', h.options), error => !error.message.includes('PRIVATE'));
    assert.equal(h.calls.length, 1);
    assert.equal(h.logs.length, 0);
  }
});

test('network errors are sanitized and the deadline covers a stalled response body', async () => {
  const failure = harness([new Error('PRIVATE token-bearing URL')]);
  await assert.rejects(runSeoGrowthJob('publish', failure.options), /^JobError: SEO scheduler failed: request_failed\.$/);
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(runSeoGrowthJob('publish', {
      env, timeoutMs: 10, log: () => {},
      fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(new Error('PRIVATE abort')), { once: true }); },
      })),
    }), /request_timeout/);
  } finally { clearTimeout(keepAlive); }
});

test('trusted main bootstrap waits for deployment without a token, then mints OIDC and publishes', async () => {
  const h = harness([
    json({ error: 'old deployment' }, { status: 404 }),
    json({ error: 'starting' }, { status: 503 }),
    json({ error: 'Method not allowed' }, { status: 405 }),
    json({ value: 'oidc.payload.signature' }), json(done()),
  ], { env: { ...env, GITHUB_EVENT_NAME: 'push' } });
  await runSeoGrowthJob('publish', h.options);
  assert.equal(h.calls.length, 5);
  for (const { url, init } of h.calls.slice(0, 3)) {
    assert.equal(url, SCHEDULER_ENDPOINT);
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.deepEqual(h.delays, [10_000, 10_000]);
  assert.equal(h.calls[3].init.headers.Authorization, 'Bearer runner-request-secret');
  assert.equal(h.calls[4].init.method, 'POST');
});

test('bootstrap stops after 18 probes or unexpected responses and never authenticates prematurely', async () => {
  const pushEnv = { ...env, GITHUB_EVENT_NAME: 'push' };
  const exhausted = harness(Array.from({ length: 18 }, () => json({}, { status: 404 })), { env: pushEnv });
  await assert.rejects(runSeoGrowthJob('publish', exhausted.options), /deployment_not_ready/);
  assert.equal(exhausted.calls.length, 18);
  assert.equal(exhausted.delays.length, 17);
  assert.ok(exhausted.calls.every(row => !row.init.headers.Authorization));
  for (const response of [json({}, { status: 200 }), json({}, { status: 401 }), json({}, { status: 500 }), json({ error: 'PRIVATE wrong body' }, { status: 405 })]) {
    const h = harness([response], { env: pushEnv });
    await assert.rejects(runSeoGrowthJob('publish', h.options), error => /readiness_/.test(error.message) && !error.message.includes('PRIVATE'));
    assert.equal(h.calls.length, 1);
    assert.equal(h.delays.length, 0);
  }
  const h = harness([], { env: pushEnv });
  await assert.rejects(runSeoGrowthJob('maintenance', h.options), /invalid_bootstrap_job/);
  assert.equal(h.calls.length, 0);
});

test('the scheduled workflow pins official actions and only runs trusted main events', async () => {
  const workflow = await readFile(new URL('../.github/workflows/seo-growth-schedule.yml', import.meta.url), 'utf8');
  for (const cron of ['17 0 * * *', '17 1 * * *', '17 21 * * *']) assert.ok(workflow.includes(`cron: '${cron}'`));
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /github\.repository == 'layrinc\/layr-hp'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.workflow_ref == 'layrinc\/layr-hp\/\.github\/workflows\/seo-growth-schedule\.yml@refs\/heads\/main'/);
  assert.match(workflow, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
  assert.doesNotMatch(workflow, /^\s+(pull_request|pull_request_target|workflow_run):/m);
  assert.match(workflow, /push:\s+branches:\s+- main\s+paths:\s+- \.github\/workflows\/seo-growth-schedule\.yml\s+- scripts\/run-seo-growth-job\.mjs\s+- worker\/seo-scheduler\.mjs\s+schedule:/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /group: seo-growth-jobs\s+cancel-in-progress: false/);
  assert.match(workflow, /run: node scripts\/run-seo-growth-job\.mjs "\$SEO_JOB_KIND"/);
});
