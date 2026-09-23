import { pathToFileURL } from 'node:url';

export const SCHEDULER_ENDPOINT = 'https://layr.co.jp/api/seo-scheduler/run';
const WORKFLOW_REF = 'layrinc/layr-hp/.github/workflows/seo-growth-schedule.yml@refs/heads/main';
const MAX_ATTEMPTS = 3;
const MAX_BODY_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = { publish: 120_000, maintenance: 480_000, prepare: 180_000, photos: 150_000 };
const OUTCOMES = new Set(['completed', 'not_configured']);

class JobError extends Error {
  constructor(code, { status, retryAfterMs } = {}) {
    super(`SEO scheduler failed: ${code}${status ? ` (HTTP ${status})` : ''}.`);
    this.name = 'JobError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function requestUrl(env, kind) {
  if (!['publish', 'maintenance', 'prepare', 'photos'].includes(kind)) throw new JobError('invalid_job_kind');
  if (env.GITHUB_EVENT_NAME === 'push' && kind !== 'publish') throw new JobError('invalid_bootstrap_job');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'layrinc/layr-hp'
      || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
      || !['schedule', 'workflow_dispatch', 'push'].includes(env.GITHUB_EVENT_NAME)) {
    throw new JobError('untrusted_workflow_context');
  }
  if (typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== 'string'
      || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.trim()
      || /[\r\n]/.test(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) throw new JobError('missing_oidc_credentials');
  let url;
  try { url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); }
  catch { throw new JobError('invalid_oidc_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'actions.githubusercontent.com' || url.hostname.endsWith('.actions.githubusercontent.com'))) {
    throw new JobError('invalid_oidc_url');
  }
  url.searchParams.set('audience', SCHEDULER_ENDPOINT);
  return url;
}

function retryDelay(response, attempt) {
  const header = response.headers.get('retry-after');
  const seconds = header && /^\d+$/.test(header) ? Number(header) : NaN;
  const dateDelay = header ? Date.parse(header) - Date.now() : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : dateDelay;
  return Number.isFinite(delay) ? Math.max(1_000, Math.min(30_000, delay)) : attempt * 5_000;
}

async function responseJson(response, stage, attempt) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new JobError(`${stage}_http_error`, {
      status: response.status, retryAfterMs: retryDelay(response, attempt),
    });
  }
  return readJson(response, stage);
}

async function readJson(response, stage, { allowError = false } = {}) {
  // Read under the request's abort signal and cap the response before parsing.
  // Neither provider response bodies nor error messages are ever logged.
  const reader = response.body?.getReader();
  if (!reader) throw new JobError(`${stage}_invalid_response`);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new JobError(`${stage}_response_too_large`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new JobError(`${stage}_invalid_response`); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || (!allowError && Object.hasOwn(body, 'error'))) {
    throw new JobError(`${stage}_invalid_response`);
  }
  return body;
}

async function waitForDeployment({ fetchImpl, sleep, log }) {
  // A main-branch merge can start Actions before Cloudflare finishes deploying.
  // Probe without credentials; mint the OIDC token only when this route is ready.
  for (let attempt = 1; attempt <= 18; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const response = await fetchImpl(SCHEDULER_ENDPOINT, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.status === 405) {
        const body = await readJson(response, 'readiness', { allowError: true });
        if (body.error !== 'Method not allowed') throw new JobError('readiness_invalid_response');
        log('SEO scheduler deployment is ready.');
        return;
      }
      await response.body?.cancel().catch(() => {});
      if (![404, 503].includes(response.status)) throw new JobError('readiness_http_error', { status: response.status });
      if (attempt === 18) throw new JobError('deployment_not_ready', { status: response.status });
    } catch (error) {
      throw error instanceof JobError ? error : new JobError(controller.signal.aborted ? 'readiness_timeout' : 'readiness_request_failed');
    } finally { clearTimeout(timer); }
    log(`SEO scheduler waiting for deployment: attempt ${attempt + 1}/18.`);
    await sleep(10_000);
  }
}

function completedSummary(body, kind) {
  const expected = ['publish','prepare','photos'].includes(kind)?[kind]:['analytics', 'inspection'];
  if (body.status !== 'completed' || body.kind !== kind || !Array.isArray(body.results)
      || body.results.length !== expected.length) throw new JobError('job_not_completed');
  const results = [];
  for (const jobKind of expected) {
    const matches = body.results.filter(row => row && row.kind === jobKind);
    if (matches.length !== 1 || matches[0].status !== 'completed' || Object.hasOwn(matches[0], 'error')) {
      throw new JobError('job_not_completed');
    }
    const row = matches[0];
    const result = { kind: jobKind, status: 'completed' };
    if (jobKind === 'publish') {
      // Quotas are enforced transactionally by the server per scope. The count
      // also includes approved corrections, so it has no shared daily ceiling.
      if (!Number.isSafeInteger(row.publishedCount) || row.publishedCount < 0) {
        throw new JobError('invalid_publish_count');
      }
      result.publishedCount = row.publishedCount;
    }
    if(jobKind==='prepare') {
      if(typeof row.done!=='boolean'||!['disabled','paused','calendar_finished','needs_review','prepared','provider_unavailable','provider_blocked','progress','ready','state_changed'].includes(row.outcome)||!Number.isSafeInteger(row.blockedCount)||row.blockedCount<0)throw new JobError('invalid_preparation_result');
      Object.assign(result,{done:row.done,outcome:row.outcome,blockedCount:row.blockedCount});
    }
    if(jobKind==='photos') {
      if(typeof row.done!=='boolean'||!['no_targets','cached','ready','unavailable','provider_unavailable','state_changed'].includes(row.outcome)||!Number.isSafeInteger(row.photoCount)||row.photoCount<0||row.photoCount>4)throw new JobError('invalid_photo_result');
      Object.assign(result,{done:row.done,outcome:row.outcome,photoCount:row.photoCount});
    }
    if (!['publish','prepare','photos'].includes(jobKind)) {
      if (!OUTCOMES.has(row.outcome)) throw new JobError('job_not_completed');
      result.outcome = row.outcome;
    }
    results.push(result);
  }
  return { kind, status: 'completed', results };
}

/** No static API secret is needed: each attempt requests a fresh GitHub OIDC token. */
export async function runSeoGrowthJob(kind, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = message => console.log(message),
  timeoutMs = REQUEST_TIMEOUT_MS[kind],
  step = 0,
} = {}) {
  const oidcUrl = requestUrl(env, kind);
  if(['prepare','photos'].includes(kind)&&(!Number.isInteger(step)||step<0||step>=240))throw new JobError('invalid_preparation_step');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > REQUEST_TIMEOUT_MS[kind]) {
    throw new JobError('invalid_request_timeout');
  }
  if (env.GITHUB_EVENT_NAME === 'push') await waitForDeployment({ fetchImpl, sleep, log });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let retry;
    try {
      const tokenResponse = await fetchImpl(oidcUrl, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`, Accept: 'application/json' },
      });
      const token = await responseJson(tokenResponse, 'oidc', attempt);
      if (typeof token.value !== 'string' || token.value.length > 16_384
          || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.value)) {
        throw new JobError('oidc_invalid_token');
      }
      const jobResponse = await fetchImpl(SCHEDULER_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(['prepare','photos'].includes(kind)?{kind,step}:{kind}),
      });
      const result = completedSummary(await responseJson(jobResponse, 'job', attempt), kind);
      log(`SEO scheduler completed: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      const safeError = error instanceof JobError ? error : new JobError(controller.signal.aborted ? 'request_timeout' : 'request_failed');
      if (![429, 503].includes(safeError.status) || attempt === MAX_ATTEMPTS) throw safeError;
      retry = safeError;
    } finally { clearTimeout(timer); }
    log(`SEO scheduler retry: HTTP ${retry.status}; attempt ${attempt + 1}/${MAX_ATTEMPTS}.`);
    await sleep(retry.retryAfterMs);
  }
}

export async function runRegionalPreparation(options={}) {
  for(let step=0;step<240;step++) {
    const response=await runSeoGrowthJob('prepare',{...options,step});
    const result=response.results[0];
    if(result.done) {
      if(['needs_review','provider_unavailable','provider_blocked','state_changed'].includes(result.outcome))throw new JobError('regional_preparation_requires_attention');
      return response;
    }
  }
  throw new JobError('regional_preparation_step_limit');
}

export async function runCityPhotoCollection(options={}) {
  for(let step=0;step<240;step++) {
    const response=await runSeoGrowthJob('photos',{...options,step});
    const result=response.results[0];
    if(result.done) {
      if(result.outcome==='provider_unavailable')throw new JobError('city_photo_provider_unavailable');
      return response;
    }
  }
  throw new JobError('city_photo_step_limit');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  (process.argv[2]==='prepare'?runRegionalPreparation():process.argv[2]==='photos'?runCityPhotoCollection():runSeoGrowthJob(process.argv[2])).catch(error => {
    console.error(error instanceof JobError ? error.message : 'SEO scheduler failed: unexpected_error.');
    process.exitCode = 1;
  });
}
