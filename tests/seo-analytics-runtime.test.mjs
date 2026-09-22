import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {generateKeyPair, exportPKCS8} from 'jose';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

// Test-only key, generated in memory. Every outbound request is intercepted by
// the local fixture; these tests cannot call Google or use production secrets.
const {privateKey} = await generateKeyPair('RS256', {extractable: true});
const bindings = {
  SEO_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({type: 'service_account', client_email: 'fixture@local-test.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey), token_uri: 'https://oauth2.googleapis.com/token'}),
  SEO_GA4_PROPERTY_ID: '123456', SEO_GSC_SITE_URL: 'sc-domain:layr.co.jp',
};
const bundle = await build({
  stdin: {resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'seo-analytics-native-fixture.mjs', contents: `
    import {runAnalyticsSync} from './worker/seo-analytics.mjs';
    export default {async fetch(_request, env) {
      const values = new Map();
      const store = {
        async get(namespace,key) {return values.get(namespace+':'+key) ?? null;},
        async upsert(namespace,key,value) {values.set(namespace+':'+key,value);},
        async list(namespace) {return [...values].filter(([key])=>key.startsWith(namespace+':')).map(([key,value])=>({key,value}));},
      };
      const result = await runAnalyticsSync(env,{store,now:new Date('2026-09-22T01:00:00Z')});
      return Response.json({statuses:result.statuses.map(({source,status,code})=>({source,status,code})),
        snapshots:(await store.list('analytics')).map(({value})=>({source:value.source,startDate:value.startDate,endDate:value.endDate,pageRows:value.pages.length,queryRows:value.queries.length}))});
    }};`,
  }, bundle: true, write: false, format: 'esm', platform: 'browser',
});

async function nativeSync({redirectToken = false, redirectReports = false} = {}) {
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', bindings,
    outboundService: async request => {
      // Record only endpoints and credential presence, never header/body values.
      calls.push({url: request.url, hasAuthorization: request.headers.has('Authorization')});
      if (request.url === 'https://oauth2.googleapis.com/token') {
        if (redirectToken) return new Response('ignored redirect body', {status: 302, headers: {Location: 'https://must-not-follow.invalid/assertion'}});
        return Response.json({access_token: 'synthetic-runtime-token', expires_in: 3600});
      }
      if (request.url.startsWith('https://analyticsdata.googleapis.com/') || request.url.startsWith('https://www.googleapis.com/webmasters/')) {
        if (redirectReports) return new Response('ignored redirect body', {status: 307, headers: {Location: 'https://must-not-follow.invalid/bearer'}});
        return Response.json({rows: [], rowCount: 0});
      }
      return new Response('unexpected local fixture destination', {status: 503});
    },
  }));
  try {
    const response = await mf.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200);
    return {result: await response.json(), calls};
  } finally {await mf.dispose();}
}

test('production workerd compatibility executes signed OAuth and both read-only reports through native fetch', {timeout: 60000}, async () => {
  const {result, calls} = await nativeSync();
  assert.deepEqual(result.statuses.map(({source, status}) => ({source, status})), [{source: 'ga4', status: 'ok'}, {source: 'gsc', status: 'ok'}]);
  assert.equal(result.snapshots.length, 4);
  assert.ok(result.snapshots.every(row => row.pageRows === 0 && row.queryRows === 0));
  assert.equal(calls.filter(row => row.url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.equal(calls.filter(row => row.url.startsWith('https://analyticsdata.googleapis.com/')).length, 6);
  assert.equal(calls.filter(row => row.url.startsWith('https://www.googleapis.com/webmasters/')).length, 6);
  assert.ok(calls.filter(row => row.url !== 'https://oauth2.googleapis.com/token').every(row => row.hasAuthorization));
});

test('native OAuth redirects fail closed without forwarding the signed assertion', {timeout: 60000}, async () => {
  const {result, calls} = await nativeSync({redirectToken: true});
  assert.deepEqual(calls.map(row => row.url), ['https://oauth2.googleapis.com/token']);
  assert.ok(result.statuses.every(row => row.status === 'error' && row.code === 'GOOGLE_RESPONSE'));
  assert.deepEqual(result.snapshots, []);
});

test('native reporting redirects fail closed without forwarding a bearer token', {timeout: 60000}, async () => {
  const {result, calls} = await nativeSync({redirectReports: true});
  assert.ok(calls.some(row => row.hasAuthorization), 'the test must reach authenticated reporting requests');
  assert.ok(calls.every(row => new URL(row.url).hostname.endsWith('.googleapis.com')));
  assert.ok(result.statuses.every(row => row.status === 'error' && row.code === 'GOOGLE_RESPONSE'));
  assert.deepEqual(result.snapshots, []);
});
