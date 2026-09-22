import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, exportPKCS8, jwtVerify} from 'jose';
import {analyticsPeriods, getAnalyticsConfiguration, managedPath, runAnalyticsSync, runInspections} from '../worker/seo-analytics.mjs';

const now = new Date('2026-09-21T01:00:00Z');
const path = '/service/ltori/area/mie/nabari/';
const article = '/service/ltori/media/interview-followup/';
const response = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
const keys = await generateKeyPair('RS256', {extractable: true});
const privateKey = await exportPKCS8(keys.privateKey);
const env = {SEO_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({type: 'service_account', client_email: 'seo@layr.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token'}), SEO_GA4_PROPERTY_ID: '123456', SEO_GSC_SITE_URL: 'sc-domain:layr.co.jp'};

function memoryStore() {
  const data = new Map();
  return {
    async get(namespace, key) {return structuredClone(data.get(`${namespace}:${key}`) ?? null);},
    async upsert(namespace, key, value) {data.set(`${namespace}:${key}`, structuredClone(value));},
    async list(namespace) {return [...data].filter(([key]) => key.startsWith(`${namespace}:`)).map(([key, value]) => ({key: key.slice(namespace.length + 1), value: structuredClone(value)}));},
    data,
  };
}
const gaRow = (dimensions, metrics) => ({dimensionValues: dimensions.map(value => ({value})), metricValues: metrics.map(value => ({value: String(value)}))});

function fakeGoogle({failGsc = false, verifyAssertion = false, inspectFailure = false} = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url, options});
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') {
      if (verifyAssertion) {
        const assertion = new URLSearchParams(options.body).get('assertion');
        const {payload} = await jwtVerify(assertion, keys.publicKey, {algorithms: ['RS256'], audience: url, issuer: 'seo@layr.iam.gserviceaccount.com', currentDate: now});
        assert.equal(payload.exp - payload.iat, 3600);
        assert.equal(payload.sub, undefined);
        assert.equal(payload.scope, 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly');
      }
      return response({access_token: 'test-access-token', expires_in: 3600});
    }
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    const body = JSON.parse(options.body);
    if (url.includes('analyticsdata')) {
      assert.equal(body.dateRanges[0].endDate <= '2026-09-18', true);
      const first = body.dimensions[0].name;
      if (first === 'pagePath') return response({rowCount: 2, rows: [gaRow([path], [30, 12]), gaRow([article], [70, 20])], totals: [gaRow(['RESERVED_TOTAL'], [100, 25])], metadata: {timeZone: 'Asia/Tokyo'}});
      if (first === 'landingPage') return response({rowCount: 3, rows: [gaRow([path, 'Organic Search'], [10]), gaRow([path, 'Direct'], [5]), gaRow([article, 'Organic Search'], [20])], totals: [gaRow(['RESERVED_TOTAL'], [35])]});
      assert.equal(body.dimensionFilter.andGroup.expressions[1].filter.inListFilter.values.includes('generate_lead'), false);
      return response({rowCount: 5, rows: [
        gaRow(['/contact/?service=ltori&source=area/mie/nabari', 'ltori_inquiry_complete'], [2]),
        gaRow(['/contact/?service=ltori&source=media/interview-followup', 'ltori_media_inquiry_complete'], [1]),
        gaRow(['/document/ltori-service/?source=media/interview-followup', 'ltori_media_document_complete'], [3]),
        gaRow([article, 'ltori_media_cta_click'], [12]),
        gaRow(['/contact/?service=general&source=area/mie/nabari', 'ltori_inquiry_complete'], [999]),
      ]});
    }
    if (url.includes('searchAnalytics')) {
      assert.equal(body.dataState, 'final');
      assert.equal(body.aggregationType, 'auto');
      if (failGsc) return new Response(JSON.stringify({error: {message: 'SECRET-IN-UPSTREAM-ERROR'}}), {status: 403});
      const row = {clicks: 5, impressions: 100, ctr: 0.05, position: 8};
      return response({rows: [{keys: body.dimensions.length === 2 ? [`https://layr.co.jp${path}`, '採用 LINE 構築'] : body.dimensions.length === 1 ? [`https://layr.co.jp${path}`] : [], ...row}]});
    }
    if (url.includes('urlInspection')) {
      assert.equal(body.siteUrl, 'sc-domain:layr.co.jp');
      if (inspectFailure) return new Response('SECRET-IN-UPSTREAM-ERROR', {status: 403});
      return response({inspectionResult: {indexStatusResult: {verdict: 'PASS', googleCanonical: body.inspectionUrl, pageFetchState: 'SUCCESSFUL'}}});
    }
    throw new Error('Unexpected URL');
  };
  return {fetchImpl, requests};
}

test('missing credentials never call Google or fabricate zero traffic', async () => {
  const store = memoryStore();
  const result = await runAnalyticsSync({}, {store, now, fetchImpl: () => {throw new Error('must not fetch');}});
  assert.deepEqual(result.statuses.map(status => status.status), ['not_configured', 'not_configured']);
  assert.equal((await store.list('analytics')).length, 0);
  assert.equal(JSON.stringify(result).includes('private_key'), false);
});

test('configuration refuses external OAuth destinations, unrelated GSC properties, measurement IDs', () => {
  const account = JSON.parse(env.SEO_GOOGLE_SERVICE_ACCOUNT);
  const config = getAnalyticsConfiguration({...env, SEO_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({...account, token_uri: 'https://attacker.example/token'}), SEO_GA4_PROPERTY_ID: 'G-12345', SEO_GSC_SITE_URL: 'sc-domain:other.example'});
  assert.equal(config.serviceAccountConfigured, false);
  assert.equal(config.ga4Configured, false);
  assert.equal(config.gscConfigured, false);
});

test('periods are equal 28-day finalized windows with no overlap', () => {
  assert.deepEqual(analyticsPeriods(now), [{period: 'current', startDate: '2026-08-22', endDate: '2026-09-18'}, {period: 'previous', startDate: '2026-07-25', endDate: '2026-08-21'}]);
});

test('Google service account uses real signed read-only JWT and separates contacts, document requests, clicks', async () => {
  const store = memoryStore(), fake = fakeGoogle({verifyAssertion: true});
  const result = await runAnalyticsSync(env, {store, now, fetchImpl: fake.fetchImpl});
  assert.ok(result.statuses.every(item => item.status === 'ok'));
  assert.equal((await store.list('analytics')).length, 4);
  const ga = await store.get('analytics', 'ga4:current');
  assert.equal(ga.propertyId, env.SEO_GA4_PROPERTY_ID, 'persist source identity rather than deriving it from future settings');
  assert.equal(ga.siteUrl, env.SEO_GSC_SITE_URL);
  assert.equal(ga.summary.users, 25, 'unique users must use API totals, not page sums');
  assert.equal(ga.summary.views, 100);
  assert.equal(ga.summary.sessions, 35);
  assert.equal(ga.summary.organicSessions, 30);
  assert.equal(ga.summary.inquiries, 3);
  assert.equal(ga.summary.documentRequests, 3);
  assert.equal(ga.summary.ctaClicks, 12);
  assert.equal(ga.pages.find(row => row.path === path).sessions, 15);
  assert.equal(ga.pages.find(row => row.path === path).documentRequests, null);
  const gsc = await store.get('analytics', 'gsc:current');
  assert.equal(gsc.siteUrl, env.SEO_GSC_SITE_URL);
  assert.equal(gsc.queries[0].query, '採用 LINE 構築');
  assert.equal(gsc.timeZone, 'America/Los_Angeles');
  assert.equal(JSON.stringify([...store.data]).includes('test-access-token'), false);
  assert.equal(JSON.stringify([...store.data]).includes('PRIVATE KEY'), false);
});

test('one failing provider preserves prior successful snapshots and never echoes upstream text', async () => {
  const store = memoryStore(), fake = fakeGoogle({failGsc: true});
  const old = {source: 'gsc', period: 'current', fetchedAt: '2026-09-20T00:00:00Z'};
  await store.upsert('analytics', 'gsc:current', old);
  await store.upsert('integrations', 'gsc', {lastSuccessAt: old.fetchedAt});
  const result = await runAnalyticsSync(env, {store, now, fetchImpl: fake.fetchImpl});
  assert.equal(result.statuses.find(row => row.source === 'ga4').status, 'ok');
  assert.equal(result.statuses.find(row => row.source === 'gsc').status, 'error');
  assert.deepEqual(await store.get('analytics', 'gsc:current'), old);
  assert.equal((await store.get('integrations', 'gsc')).lastSuccessAt, old.fetchedAt);
  assert.equal(JSON.stringify([...store.data]).includes('SECRET-IN-UPSTREAM-ERROR'), false);
});

test('server pagination follows GA4 offset and GSC startRow with a bounded cap', async () => {
  const store = memoryStore();
  const fake = fakeGoogle();
  const offsets = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('searchAnalytics')) {
      const body = JSON.parse(options.body);
      if (body.dimensions.length === 2) {
        offsets.push(body.startRow);
        return response({rows: Array.from({length: 1000}, (_, i) => ({keys: [`https://layr.co.jp${path}`, `採用 ${body.startRow + i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 3}))});
      }
    }
    return fake.fetchImpl(url, options);
  };
  await runAnalyticsSync(env, {store, now, fetchImpl});
  assert.deepEqual([...new Set(offsets)], [0, 1000, 2000, 3000]);
  assert.equal((await store.get('analytics', 'gsc:current')).quality.truncated, true);
  assert.equal((await store.get('analytics', 'gsc:current')).queries.length, 4000);
});

test('inspection rotates within daily budget and does not request indexing or inspect external URLs', async () => {
  const store = memoryStore(), fake = fakeGoogle();
  const publishedPaths = Array.from({length: 12}, (_, index) => `/service/ltori/media/article-${index}/`);
  publishedPaths.push('https://external.example/private', '/admin/');
  const first = await runInspections(env, {store, now, publishedPaths, fetchImpl: fake.fetchImpl});
  assert.equal(first.inspected, 10);
  const second = await runInspections(env, {store, now, publishedPaths, fetchImpl: fake.fetchImpl});
  assert.equal(second.status, 'quota_reached');
  assert.equal(fake.requests.filter(item => item.url.includes('urlInspection')).length, 10);
  const tomorrow = new Date('2026-09-22T01:00:00Z');
  await runInspections(env, {store, now: tomorrow, publishedPaths, fetchImpl: fake.fetchImpl});
  assert.equal((await store.list('inspections')).length, 12);
});

test('inspection failures retain the last observation, record errors, and consume only a bounded budget', async () => {
  const store = memoryStore(), fake = fakeGoogle({inspectFailure: true});
  await store.upsert('inspections', path, {path, verdict: 'PASS', inspectedAt: '2026-09-20T00:00:00Z', status: 'ok'});
  const result = await runInspections(env, {store, now, publishedPaths: [path], fetchImpl: fake.fetchImpl});
  assert.equal(result.failed, 1);
  const record = await store.get('inspections', path);
  assert.equal(record.verdict, 'PASS');
  assert.equal(record.status, 'error');
  assert.equal(JSON.stringify(record).includes('SECRET-IN-UPSTREAM-ERROR'), false);
  const retry = await runInspections(env, {store, now, publishedPaths: [path], fetchImpl: fake.fetchImpl});
  assert.equal(retry.inspected, 0);
});

test('path normalization is restricted to canonical production service URLs', () => {
  assert.equal(managedPath(`https://layr.co.jp${path}?utm_campaign=x`), path);
  assert.equal(managedPath('https://seo.layr.co.jp/service/ltori/'), null);
  assert.equal(managedPath('/service/ltori-evil/'), null);
});
