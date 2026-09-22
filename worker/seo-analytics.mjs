import {importPKCS8, SignJWT} from 'jose';

// Server-only. Never return Google credentials or access tokens to the browser.
// API contracts: developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
// developers.google.com/webmaster-tools/v1/searchanalytics/query
// developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
const ORIGIN = 'https://layr.co.jp';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly';
const DAY = 86400000;
const GOOGLE_TIMEOUT = 20000;
const LIMIT = 1000;
const MAX_REPORT_PAGES = 4;
const INSPECTION_LIMIT = 10;
const EVENTS = ['ltori_inquiry_complete', 'ltori_media_inquiry_complete', 'ltori_media_document_complete', 'ltori_media_cta_click'];
const METRIC_NAMES = ['views', 'users', 'sessions', 'organicSessions', 'inquiries', 'documentRequests', 'ctaClicks', 'clicks', 'impressions', 'ctr', 'position'];
const blankMetrics = () => Object.fromEntries(METRIC_NAMES.map(name => [name, null]));
const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const stringFilter = (fieldName, value, matchType = 'EXACT') => ({filter: {fieldName, stringFilter: {value, matchType, caseSensitive: true}}});

export function managedPath(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN || !/^\/service\/ltori(?:\/|$)/.test(url.pathname)) return null;
    return `${url.pathname.replace(/\/+$/, '')}/`;
  } catch { return null; }
}

function credentials(env) {
  try {
    const value = JSON.parse(env.SEO_GOOGLE_SERVICE_ACCOUNT || 'null');
    if (!value || value.type !== 'service_account' || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(value.client_email || '') || !/^-----BEGIN PRIVATE KEY-----/.test(value.private_key || '')) return null;
    // A JSON token_uri must not redirect the secret assertion to another server.
    if (value.token_uri && value.token_uri !== TOKEN_URL) return null;
    return value;
  } catch { return null; }
}

export function getAnalyticsConfiguration(env = {}) {
  const serviceAccountConfigured = Boolean(credentials(env));
  const propertyId = /^\d+$/.test(String(env.SEO_GA4_PROPERTY_ID || '')) ? String(env.SEO_GA4_PROPERTY_ID) : null;
  const siteUrl = ['sc-domain:layr.co.jp', `${ORIGIN}/`].includes(env.SEO_GSC_SITE_URL) ? env.SEO_GSC_SITE_URL : null;
  return {serviceAccountConfigured, propertyId, siteUrl, ga4Configured: serviceAccountConfigured && Boolean(propertyId), gscConfigured: serviceAccountConfigured && Boolean(siteUrl)};
}

export function analyticsPeriods(now = new Date()) {
  const input = new Date(now);
  if (!Number.isFinite(input.getTime())) throw new Error('INVALID_DATE');
  // Both services use the same dates, ending three days ago; GA4's timezone and
  // Search Console's Pacific timezone still differ and are disclosed in the UI.
  const end = Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()) - 3 * DAY;
  const iso = value => new Date(value).toISOString().slice(0, 10);
  return [{period: 'current', startDate: iso(end - 27 * DAY), endDate: iso(end)}, {period: 'previous', startDate: iso(end - 55 * DAY), endDate: iso(end - 28 * DAY)}];
}

class GoogleRequestError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function safeError(error) {
  const code = error instanceof GoogleRequestError ? error.code : 'SYNC_FAILED';
  const messages = {GOOGLE_AUTH: 'Googleの認証設定を確認してください。', GOOGLE_PERMISSION: 'APIの有効化とサービスアカウントの閲覧権限を確認してください。', GOOGLE_QUOTA: 'Google APIの利用上限です。次回の同期で再試行します。', GOOGLE_TIMEOUT: 'Google APIへの接続がタイムアウトしました。', GOOGLE_RESPONSE: 'Google APIから有効な応答を取得できませんでした。', SYNC_FAILED: '同期できませんでした。設定と接続状況を確認してください。'};
  return {code, message: messages[code] || messages.SYNC_FAILED};
}

async function requestJson(fetchImpl, url, options) {
  let response;
  try {
    // workerd supports only follow/manual. Reject redirects ourselves so neither
    // a signed assertion nor a bearer token can be forwarded to another origin.
    response = await fetchImpl(url, {...options, redirect: 'manual', signal: AbortSignal.timeout(GOOGLE_TIMEOUT)});
  } catch (error) {
    throw new GoogleRequestError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'GOOGLE_TIMEOUT' : 'GOOGLE_RESPONSE');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleRequestError(response.status === 401 ? 'GOOGLE_AUTH' : response.status === 403 ? 'GOOGLE_PERMISSION' : response.status === 429 ? 'GOOGLE_QUOTA' : 'GOOGLE_RESPONSE');
  }
  try { return await response.json(); } catch { throw new GoogleRequestError('GOOGLE_RESPONSE'); }
}

async function accessToken(env, fetchImpl, now) {
  const account = credentials(env);
  if (!account) throw new GoogleRequestError('GOOGLE_AUTH');
  const issuedAt = Math.floor(new Date(now).getTime() / 1000);
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({scope: SCOPES}).setProtectedHeader({alg: 'RS256', typ: 'JWT'})
    .setIssuer(account.client_email).setAudience(TOKEN_URL).setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600).sign(key);
  const response = await requestJson(fetchImpl, TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}).toString()});
  if (typeof response.access_token !== 'string' || !response.access_token) throw new GoogleRequestError('GOOGLE_AUTH');
  return response.access_token;
}

const post = (fetchImpl, url, token, body) => requestJson(fetchImpl, url, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});

function gaFilter(fieldName) {
  return {andGroup: {expressions: [stringFilter('hostName', 'layr.co.jp'), stringFilter(fieldName, '^/service/ltori(/.*)?$', 'FULL_REGEXP')]}};
}

async function gaReport({fetchImpl, token, propertyId, period, kind}) {
  const traffic = kind === 'traffic', landings = kind === 'landings';
  const dimensions = traffic ? ['pagePath'] : landings ? ['landingPage', 'sessionDefaultChannelGroup'] : ['pagePathPlusQueryString', 'eventName'];
  const metrics = traffic ? ['screenPageViews', 'totalUsers'] : landings ? ['sessions'] : ['eventCount'];
  const dimensionFilter = traffic ? gaFilter('pagePath') : landings ? gaFilter('landingPage') : {andGroup: {expressions: [stringFilter('hostName', 'layr.co.jp'), {filter: {fieldName: 'eventName', inListFilter: {values: EVENTS, caseSensitive: true}}}]}};
  const result = {rows: [], totals: null, metadata: {}, truncated: false};
  for (let index = 0; index < MAX_REPORT_PAGES; index++) {
    const data = await post(fetchImpl, `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, token, {
      dateRanges: [{startDate: period.startDate, endDate: period.endDate}], dimensions: dimensions.map(name => ({name})), metrics: metrics.map(name => ({name})), dimensionFilter,
      limit: String(LIMIT), offset: String(index * LIMIT), metricAggregations: ['TOTAL'], returnPropertyQuota: true,
      orderBys: dimensions.map(dimensionName => ({dimension: {dimensionName}, desc: false})),
    });
    if (data.rows !== undefined && !Array.isArray(data.rows)) throw new GoogleRequestError('GOOGLE_RESPONSE');
    result.rows.push(...(data.rows || []));
    result.metadata = {...result.metadata, ...data.metadata};
    if (data.totals?.[0]) result.totals = data.totals[0];
    const count = Number(data.rowCount);
    if ((data.rows || []).length < LIMIT || (Number.isFinite(count) && result.rows.length >= count)) return result;
    result.truncated = index === MAX_REPORT_PAGES - 1;
  }
  return result;
}

function eventSource(rawPath, eventName) {
  try {
    const url = new URL(rawPath, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    if (eventName === 'ltori_media_cta_click') return managedPath(url.pathname);
    if (eventName === 'ltori_media_document_complete') {
      if (url.pathname.replace(/\/$/, '') !== '/document/ltori-service') return null;
    } else if (url.pathname.replace(/\/$/, '') !== '/contact' || url.searchParams.get('service') !== 'ltori') return null;
    const source = url.searchParams.get('source');
    const expected = eventName === 'ltori_inquiry_complete' ? /^area\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/ : /^media(?:\/[a-z0-9-]+)?$/;
    if (!source || !expected.test(source)) return null;
    return managedPath(`/service/ltori/${source}/`);
  } catch { return null; }
}

async function fetchGa4(context) {
  const [traffic, landings, events] = await Promise.all(['traffic', 'landings', 'events'].map(kind => gaReport({...context, kind})));
  const pages = new Map();
  const get = path => {if (!pages.has(path)) pages.set(path, {path, ...blankMetrics()}); return pages.get(path);};
  for (const entry of traffic.rows) {
    const path = managedPath(entry.dimensionValues?.[0]?.value);
    if (!path) continue;
    const row = get(path);
    // Different slash variants can duplicate a user; do not sum distinct users.
    if (row.views !== null) {row.views += numberOrNull(entry.metricValues?.[0]?.value) || 0; row.users = null; row.userCountAmbiguous = true;}
    else {row.views = numberOrNull(entry.metricValues?.[0]?.value); row.users = numberOrNull(entry.metricValues?.[1]?.value);}
  }
  for (const entry of landings.rows) {
    const path = managedPath(entry.dimensionValues?.[0]?.value);
    if (!path) continue;
    const count = numberOrNull(entry.metricValues?.[0]?.value);
    if (count === null) continue;
    const row = get(path);
    row.sessions = (row.sessions ?? 0) + count;
    if (entry.dimensionValues?.[1]?.value === 'Organic Search') row.organicSessions = (row.organicSessions ?? 0) + count;
  }
  for (const entry of events.rows) {
    const name = entry.dimensionValues?.[1]?.value;
    const path = eventSource(entry.dimensionValues?.[0]?.value, name);
    if (!path) continue;
    const count = numberOrNull(entry.metricValues?.[0]?.value);
    if (count === null) continue;
    const metric = name === 'ltori_media_cta_click' ? 'ctaClicks' : name === 'ltori_media_document_complete' ? 'documentRequests' : 'inquiries';
    const row = get(path);
    row[metric] = (row[metric] ?? 0) + count;
  }
  const list = [...pages.values()];
  const sumObserved = name => {const values = list.map(row => row[name]).filter(value => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) : null;};
  const reports = [traffic, landings, events];
  const quality = {truncated: reports.some(report => report.truncated), thresholded: reports.some(report => report.metadata.subjectToThresholding || report.metadata.dataLossFromOtherRow), sampled: reports.some(report => report.metadata.samplingMetadatas?.length), notes: [
    '表示がない指標は未計測・反映待ち・ゼロを区別できないため空欄です。',
    'セッションは入口ページ別。問い合わせはフォームのsourceで紹介元に帰属します。両者の帰属基準は異なります。',
    'LINE・資料リンクのクリック、相談受付、資料請求は別集計です。サイト共通generate_leadは重複加算しません。',
  ]};
  const summary = {...blankMetrics(), views: numberOrNull(traffic.totals?.metricValues?.[0]?.value), users: numberOrNull(traffic.totals?.metricValues?.[1]?.value), sessions: numberOrNull(landings.totals?.metricValues?.[0]?.value), organicSessions: landings.truncated ? null : sumObserved('organicSessions'), inquiries: events.truncated ? null : sumObserved('inquiries'), documentRequests: events.truncated ? null : sumObserved('documentRequests'), ctaClicks: events.truncated ? null : sumObserved('ctaClicks')};
  return {pages: list, queries: [], summary, quality, timeZone: traffic.metadata.timeZone || 'GA4プロパティのタイムゾーン'};
}

async function gscReport(context, dimensions) {
  const rows = [];
  let truncated = false;
  for (let page = 0; page < MAX_REPORT_PAGES; page++) {
    const data = await post(context.fetchImpl, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(context.siteUrl)}/searchAnalytics/query`, context.token, {
      startDate: context.period.startDate, endDate: context.period.endDate, dimensions, type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: LIMIT, startRow: page * LIMIT,
      dimensionFilterGroups: [{groupType: 'and', filters: [{dimension: 'page', operator: 'includingRegex', expression: '^https://layr\\.co\\.jp/service/ltori(/|$)'}]}],
    });
    if (data.rows !== undefined && !Array.isArray(data.rows)) throw new GoogleRequestError('GOOGLE_RESPONSE');
    rows.push(...(data.rows || []));
    if ((data.rows || []).length < LIMIT) break;
    truncated = page === MAX_REPORT_PAGES - 1;
  }
  return {rows, truncated};
}

const searchMetrics = row => ({clicks: numberOrNull(row?.clicks), impressions: numberOrNull(row?.impressions), ctr: numberOrNull(row?.ctr), position: Number(row?.impressions) > 0 ? numberOrNull(row?.position) : null});

async function fetchGsc(context) {
  const [pageReport, queryReport, totals] = await Promise.all([gscReport(context, ['page']), gscReport(context, ['page', 'query']), gscReport(context, [])]);
  const pages = pageReport.rows.map(row => ({path: managedPath(row.keys?.[0]), ...blankMetrics(), ...searchMetrics(row)})).filter(row => row.path);
  const queries = queryReport.rows.map(row => ({path: managedPath(row.keys?.[0]), query: typeof row.keys?.[1] === 'string' ? row.keys[1].slice(0, 1000) : '', ...searchMetrics(row)})).filter(row => row.path && row.query);
  return {pages, queries, summary: {...blankMetrics(), ...searchMetrics(totals.rows[0])}, timeZone: 'America/Los_Angeles', quality: {truncated: pageReport.truncated || queryReport.truncated, thresholded: false, sampled: false, notes: [
    'Search Consoleが返す上位行です。匿名化された検索語句など、全検索語句を取得できるわけではありません。',
    '検索語句はページ単位の集計です。個々の問い合わせの検索語句を特定するものではありません。',
    'GA4とSearch Consoleは集計方法・タイムゾーンが異なります。',
  ]}};
}

async function recordStatus(store, source, status, now, error = null) {
  const previous = await store.get('integrations', source);
  const value = {source, status, lastAttemptAt: new Date(now).toISOString(), lastSuccessAt: status === 'ok' ? new Date(now).toISOString() : previous?.lastSuccessAt ?? null, ...(error || {})};
  await store.upsert('integrations', source, value);
  return value;
}

/** store: {get(namespace,key), upsert(namespace,key,value), list(namespace)}.
 * Snapshots are last-successful values; status separately reports failed attempts.
 */
export async function runAnalyticsSync(env, {store, publishedPaths = [], now = new Date(), fetchImpl = fetch} = {}) {
  if (!store?.upsert || !store?.get) throw new Error('ANALYTICS_STORE_REQUIRED');
  const configuration = getAnalyticsConfiguration(env), statuses = [];
  const sources = ['ga4', 'gsc'];
  const configured = sources.filter(source => configuration[`${source}Configured`]);
  for (const source of sources.filter(source => !configured.includes(source))) statuses.push(await recordStatus(store, source, 'not_configured', now, {code: 'NOT_CONFIGURED', message: 'Googleサービスアカウントと対象プロパティの設定が必要です。'}));
  if (!configured.length) return {statuses, configuration};
  let token;
  try { token = await accessToken(env, fetchImpl, now); }
  catch (error) {
    for (const source of configured) statuses.push(await recordStatus(store, source, 'error', now, safeError(error)));
    return {statuses, configuration};
  }
  const results = await Promise.all(configured.map(async source => {
    try {
      // Compute both windows before replacing either to avoid a mixed comparison.
      const snapshots = await Promise.all(analyticsPeriods(now).map(async period => ({source, ...period, propertyId: configuration.propertyId, siteUrl: configuration.siteUrl, fetchedAt: new Date(now).toISOString(), ...(await (source === 'ga4' ? fetchGa4 : fetchGsc)({fetchImpl, token, ...configuration, period}))})));
      for (const snapshot of snapshots) await store.upsert('analytics', `${source}:${snapshot.period}`, snapshot);
      return await recordStatus(store, source, 'ok', now);
    } catch (error) { return await recordStatus(store, source, 'error', now, safeError(error)); }
  }));
  statuses.push(...results);
  return {statuses, configuration};
}

/** Inspect a rotating batch, at most ten URLs in a UTC day. No indexing request.
 * Root serializes this job using a D1 job lock; reservation is persisted before
 * calling Google so failures/retries cannot spend the same daily budget twice.
 */
export async function runInspections(env, {store, publishedPaths = [], now = new Date(), fetchImpl = fetch} = {}) {
  const config = getAnalyticsConfiguration(env);
  if (!config.gscConfigured) return {status: 'not_configured', inspected: 0};
  const today = new Date(now).toISOString().slice(0, 10);
  const budget = await store.get('integrations', 'inspection-budget');
  const used = budget?.date === today ? Number(budget.used) || 0 : 0;
  const remaining = Math.max(0, INSPECTION_LIMIT - used);
  if (!remaining) return {status: 'quota_reached', inspected: 0};
  const history = await store.list('inspections');
  const recent = new Map(history.map(row => [row.key, row.value]));
  const paths = [...new Set(publishedPaths.map(item => managedPath(typeof item === 'string' ? item : item.path)).filter(Boolean))]
    .filter(path => !recent.get(path)?.inspectedAt?.startsWith(today) && !recent.get(path)?.lastAttemptAt?.startsWith(today))
    .sort((a, b) => String(recent.get(a)?.inspectedAt || '').localeCompare(String(recent.get(b)?.inspectedAt || '')) || a.localeCompare(b)).slice(0, remaining);
  if (!paths.length) return {status: 'ok', inspected: 0};
  let token;
  try { token = await accessToken(env, fetchImpl, now); }
  catch (error) { return {status: 'error', inspected: 0, ...(await recordStatus(store, 'inspection', 'error', now, safeError(error)))}; }
  await store.upsert('integrations', 'inspection-budget', {date: today, used: used + paths.length});
  let inspected = 0, failed = 0;
  for (const path of paths) {
    try {
      const data = await post(fetchImpl, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', token, {inspectionUrl: `${ORIGIN}${path}`, siteUrl: config.siteUrl, languageCode: 'ja-JP'});
      const result = data.inspectionResult?.indexStatusResult;
      if (!result) throw new GoogleRequestError('GOOGLE_RESPONSE');
      const safeString = name => typeof result[name] === 'string' ? result[name].slice(0, 2000) : null;
      await store.upsert('inspections', path, {path, inspectedAt: new Date(now).toISOString(), status: 'ok', verdict: safeString('verdict'), coverageState: safeString('coverageState'), indexingState: safeString('indexingState'), pageFetchState: safeString('pageFetchState'), robotsTxtState: safeString('robotsTxtState'), lastCrawlTime: safeString('lastCrawlTime'), googleCanonical: safeString('googleCanonical'), userCanonical: safeString('userCanonical')});
      inspected++;
    } catch (error) {
      failed++;
      // Preserve last successful index observation while surfacing this failure.
      await store.upsert('inspections', path, {...(recent.get(path) || {}), path, lastAttemptAt: new Date(now).toISOString(), status: 'error', ...safeError(error)});
    }
  }
  await recordStatus(store, 'inspection', failed ? 'error' : 'ok', now, failed ? {code: 'INSPECTION_FAILED', message: `${failed}件のURL検査を取得できませんでした。`} : null);
  return {status: failed ? 'partial' : 'ok', inspected, failed};
}
