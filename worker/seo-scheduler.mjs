import {createRemoteJWKSet, jwtVerify} from 'jose';
import {createStore} from './seo-store.mjs';
import {initializeGrowth} from './seo-bootstrap.mjs';
import {runJob} from './seo-runtime.mjs';
import {jobAttention,jobFinished,photoProviderFailure} from '../src/lib/seo-job-outcome.mjs';

export const SCHEDULER_URL = 'https://layr.co.jp/api/seo-scheduler/run';
const ISSUER = 'https://token.actions.githubusercontent.com';
const REPOSITORY = 'layrinc/layr-hp';
const WORKFLOW = `${REPOSITORY}/.github/workflows/seo-growth-schedule.yml@refs/heads/main`;
const SUBJECTS = new Set([
  `repo:${REPOSITORY}:ref:refs/heads/main`,
  'repo:layrinc@289750214/layr-hp@1358719278:ref:refs/heads/main',
]);
let githubKeys;

export async function verifySchedulerToken(token, keys) {
  if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('Invalid identity');
  if (!keys) githubKeys ??= createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`), {timeoutDuration:5000});
  const {payload} = await jwtVerify(token, keys || githubKeys, {
    issuer:ISSUER, audience:SCHEDULER_URL, algorithms:['RS256'], clockTolerance:5, maxTokenAge:'10m',
    requiredClaims:['exp','iat','sub','repository','repository_id','repository_owner_id','ref','workflow_ref','event_name','run_id','run_attempt'],
  });
  if (payload.repository !== REPOSITORY || payload.repository_id !== '1358719278'
    || payload.repository_owner_id !== '289750214' || payload.ref !== 'refs/heads/main'
    || payload.workflow_ref !== WORKFLOW || !SUBJECTS.has(payload.sub)
    || !['schedule','workflow_dispatch','push'].includes(payload.event_name)
    || !/^[1-9][0-9]{0,19}$/.test(payload.run_id) || typeof payload.run_id !== 'string'
    || !/^[1-9][0-9]{0,8}$/.test(payload.run_attempt) || typeof payload.run_attempt !== 'string'
    || payload.iat > Date.now()/1000 + 5) throw new Error('Untrusted workflow');
  return {runId:payload.run_id, runAttempt:payload.run_attempt};
}

function response(value, status=200) {
  return new Response(JSON.stringify(value), {status, headers:{
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Robots-Tag':'noindex, nofollow', 'X-Content-Type-Options':'nosniff',
    ...(status === 405 ? {Allow:'POST'} : {}), ...(status === 503 ? {'Retry-After':'10'} : {}),
  }});
}

function summarize(kind, job) {
  if (job?.status !== 'completed') throw new Error('Job not complete');
  const result = job.result || {};
  if (kind === 'publish') return {kind, status:'completed', publishedCount:Array.isArray(result.published) ? result.published.length : 0, day:result.day};
  if(kind==='prepare')return {kind,status:'completed',done:result.done===true,outcome:result.outcome,blockedCount:result.blockedCount||0};
  if(kind==='photos'){const failure=photoProviderFailure(result.failure);return {kind,status:'completed',done:result.done===true,outcome:result.outcome,photoCount:result.photoCount||0,...(failure?{failure}:{})};}
  const states = kind === 'analytics' ? (result.statuses || []).map(row=>row.status) : [result.status];
  if (states.some(status=>status === 'error' || status === 'partial')) throw new Error('Integration failed');
  return {kind, status:'completed', outcome:states.length && states.every(status=>status === 'not_configured') ? 'not_configured' : 'completed'};
}

// A separate machine identity grants fixed jobs, never arbitrary documents,
// prompts or an Access session. Preparation has a separately budgeted provider.
export async function handleSchedulerRequest(request, env, {verify=verifySchedulerToken, initialize=initializeGrowth, execute=runJob}={}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/seo-scheduler/run') return null;
  if (request.url !== SCHEDULER_URL) return response({error:'Not found'},404);
  if (request.method !== 'POST') return response({error:'Method not allowed'},405);
  if (request.headers.has('Origin')) return response({error:'Browser requests are not accepted'},403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response({error:'JSON required'},415);
  let identity;
  try { identity = await verify(request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]); }
  catch { return response({error:'Workflow authentication failed'},401); }
  if (Number(request.headers.get('Content-Length') || 0) > 1024) return response({error:'Request too large'},413);
  let input;
  try {
    // Keep the actual streamed body bounded even without Content-Length.
    const reader = request.body?.getReader(); let size=0; const parts=[];
    if (!reader) return response({error:'Invalid job'},400);
    for (;;) {const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>1024){await reader.cancel();return response({error:'Request too large'},413);}parts.push(value);}
    const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
    input=JSON.parse(new TextDecoder().decode(body));
  } catch {return response({error:'Invalid JSON'},400);}
  const stepped=['prepare','photos'].includes(input?.kind);
  if (!input || Array.isArray(input) || !['publish','maintenance','prepare','photos'].includes(input.kind)
    || (stepped ? Object.keys(input).sort().join(',')!=='kind,step'||!Number.isInteger(input.step)||input.step<0||input.step>=240 : Object.keys(input).length!==1)) return response({error:'Invalid job'},400);

  const {kind}=input, {runId,runAttempt}=identity, key=`${runId}:${runAttempt}:${kind}${stepped?`:${input.step}`:""}`;
  const startedAt=new Date().toISOString(); let store, claimed=false;
  try {
    await initialize(env);
    const db=env.SEO_DB;store=createStore(db);
    const previous=await store.get('scheduler_runs',key);
    if (previous?.status === 'completed') return response(previous.response);
    const claim=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('scheduler_runs',?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(seo_kv.value,'$.status')='error'")
      .bind(key,JSON.stringify({status:'running',startedAt}),startedAt).run();
    if (!claim.meta.changes) return response({error:'This workflow run is already in progress'},409);
    claimed=true;
    const state=await store.get('scheduler',kind);
    await store.upsert('scheduler',kind,{status:'running',lastAttemptAt:startedAt,lastSuccessAt:state?.lastSuccessAt || null,runId,runAttempt});
    // Wait for real completion while the caller remains connected. Do not return
    // 202 before long analytics/inspection work has finished.
    // One failed Google integration must not skip independent page health checks.
    const jobs=['publish','prepare','photos'].includes(kind)?[kind]:['analytics','inspection'];
    const outcomes=await Promise.allSettled(jobs.map(async job=>summarize(job,await execute(env,job))));
    if(outcomes.some(outcome=>outcome.status !== 'fulfilled'))throw new Error('Job incomplete');
    const results=outcomes.map(outcome=>outcome.value);
    const result={status:'completed',kind,runId,runAttempt,results};
    await store.upsert('scheduler_runs',key,{status:'completed',response:result});
    // The delivery is recorded as completed so a retried step replays it, but the
    // job state only records success when the whole job finished without an
    // outcome that needs attention (for example a photo provider outage).
    const attention=results.map(row=>jobAttention(row.kind,row)).find(Boolean),finished=results.every(row=>jobFinished(row.kind,row));
    const previousSuccess=state?.lastSuccessAt||null;
    await store.upsert('scheduler',kind,attention?{status:'attention',outcome:attention,lastAttemptAt:startedAt,lastSuccessAt:previousSuccess,runId,runAttempt}
      :finished?{status:'completed',lastAttemptAt:startedAt,lastSuccessAt:new Date().toISOString(),runId,runAttempt}
      :{status:'running',lastAttemptAt:startedAt,lastSuccessAt:previousSuccess,runId,runAttempt});
    await db.prepare("DELETE FROM seo_kv WHERE namespace='scheduler_runs' AND updated_at<?").bind(new Date(Date.now()-30*86400000).toISOString()).run();
    return response(result);
  } catch {
    if (store && claimed) {
      try {
        const previous=await store.get('scheduler_runs',key);
        // A completed publication is not invalidated by a later bookkeeping error.
        if (previous?.status !== 'completed') await store.upsert('scheduler_runs',key,{status:'error'});
        const state=await store.get('scheduler',kind);
        await store.upsert('scheduler',kind,{status:'error',lastAttemptAt:startedAt,lastSuccessAt:state?.lastSuccessAt || null,runId,runAttempt});
      } catch { /* Fail closed without exposing database or token details. */ }
    }
    return response({error:'Job did not finish; review the authenticated management history'},503);
  }
}
