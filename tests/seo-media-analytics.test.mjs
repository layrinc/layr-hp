import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectMediaAnalytics} from '../worker/seo-media-analytics.mjs';
import {validateMediaAnalyticsReport, validateMediaSearchReport, joinMediaMetrics} from '../src/lib/media-manager/model.mjs';

const now = new Date('2026-09-22T02:00:00Z');
const path = '/service/ltori/media/interview-followup/';
const secondPath = '/service/ltori/media/recruitment-funnel/';
const catalog = [
  {id: 'interview-followup', path, publication: 'published'},
  {id: 'recruitment-funnel', path: secondPath, publication: 'published'},
  {id: 'draft-article', path: '/service/ltori/media/draft-article/', publication: 'draft'},
];
const configuration = {serviceAccountConfigured: true, propertyId: '123456', siteUrl: 'sc-domain:layr.co.jp', ga4Configured: true, gscConfigured: true};
const period = {period: 'current', startDate: '2026-08-23', endDate: '2026-09-19'};
const previous = {period: 'previous', startDate: '2026-07-26', endDate: '2026-08-22'};
const fetchedAt = '2026-09-22T01:00:00Z';
const gaPage = {path, views: 12, users: 8, sessions: 6, ctaClicks: 3, inquiries: 1, documentRequests: 2};
const searchPage = {path, clicks: 2, impressions: 20, ctr: 0.1, position: 3};

function snapshot(source, overrides = {}) {
  return {
    source, ...period, fetchedAt, propertyId: configuration.propertyId, siteUrl: configuration.siteUrl,
    pages: [source === 'ga4' ? {...gaPage} : {...searchPage}],
    queries: source === 'gsc' ? [{...searchPage, query: '応募後 連絡取れない'}] : [],
    quality: {truncated: false, thresholded: false, sampled: false, notes: []},
    timeZone: source === 'ga4' ? 'Asia/Tokyo' : 'America/Los_Angeles',
    ...overrides,
  };
}
const project = (snapshots, extra = {}) => projectMediaAnalytics({snapshots, catalog, configuration, now, ...extra});
function compatible(result) {
  for (const report of result.reports) assert.deepEqual(validateMediaAnalyticsReport(report, catalog), report);
  for (const report of result.queries) assert.deepEqual(validateMediaSearchReport(report, catalog), report);
}

test('server projection combines same-period providers into existing media report contracts', () => {
  const result = project([snapshot('ga4'), snapshot('gsc')]);
  assert.equal(result.reports.length, 1);
  assert.equal(result.queries.length, 1);
  compatible(result);
  const report = result.reports[0];
  assert.equal(report.origin, 'google');
  assert.equal(report.property, configuration.propertyId);
  assert.equal(report.site, configuration.siteUrl);
  assert.equal(report.gaTimezone, 'Asia/Tokyo');
  assert.deepEqual(report.rows[0], {pageId: 'interview-followup', views: 12, users: 8, sessions: 6, cta: 3, inquiries: 1, documents: 2, clicks: 2, impressions: 20, position: 3, ctr: 0.1});
  assert.equal(result.queries[0].kind, 'queries');
  assert.equal(result.queries[0].rows[0].query, '応募後 連絡取れない');
  assert.equal(result.serverTime, now.toISOString());
});

test('only exact published media articles survive and credentials, summaries and extra personal fields do not', () => {
  const excluded = [
    '/service/ltori/area/mie/nabari/', '/service/ltori/media/',
    '/service/ltori/media/about/', '/service/ltori/media/category/guide/',
    '/service/ltori/media/unknown/', '/service/ltori/media/draft-article/',
    `${path}?email=private@example.com`, `${path}#private`,
    'https://evil.example/service/ltori/media/interview-followup/',
    '/service/ltori/media/%69nterview-followup/',
  ];
  const result = project([
    snapshot('ga4', {
      token: 'SECRET-TOKEN', summary: {views: 999999, users: 999999},
      pages: [{...gaPage, email: 'private@example.com', rawUrl: '/contact/?email=private@example.com', token: 'SECRET-TOKEN'}, ...excluded.map(path => ({...gaPage, path}))],
    }),
    snapshot('gsc', {
      pages: [{...searchPage, email: 'private@example.com'}, ...excluded.map(path => ({...searchPage, path}))],
      queries: [{...searchPage, query: '採用 LINE', token: 'SECRET-TOKEN'}, ...excluded.map(path => ({...searchPage, path, query: 'excluded'}))],
    }),
  ]);
  compatible(result);
  assert.deepEqual(result.reports[0].rows.map(row => row.pageId), ['interview-followup']);
  assert.deepEqual(result.queries[0].rows.map(row => row.query), ['採用 LINE']);
  assert.doesNotMatch(JSON.stringify(result), /SECRET-TOKEN|private@example|rawUrl|999999|evil\.example|excluded/);
});

test('observed zero remains zero while absent articles and absent metrics remain unknown', () => {
  const result = project([snapshot('ga4', {pages: [{path, views: 0, users: 0, ctaClicks: 0}]})]);
  compatible(result);
  const report = result.reports[0];
  assert.equal(report.rows[0].views, 0);
  assert.equal(report.rows[0].cta, 0);
  assert.equal(report.rows[0].sessions, null);
  assert.equal(report.rows[0].clicks, null);
  const joined = joinMediaMetrics([{id: 'A001'}, {id: 'A002'}], report, catalog, {A001: {url: path}, A002: {url: secondPath}});
  assert.equal(joined[0].metrics.views, 0);
  assert.equal(joined[1].metrics.views, null);
  assert.equal(report.rows.some(row => row.pageId === 'recruitment-funnel'), false);
});

test('different date windows remain separate even when snapshot period labels match', () => {
  const result = project([
    snapshot('ga4'),
    snapshot('gsc', {...previous, period: 'current'}),
  ]);
  compatible(result);
  assert.equal(result.reports.length, 2);
  const currentReport = result.reports.find(report => report.start === period.startDate);
  const previousReport = result.reports.find(report => report.start === previous.startDate);
  assert.equal(currentReport.rows[0].views, 12);
  assert.equal(currentReport.rows[0].clicks, null);
  assert.equal(previousReport.rows[0].views, null);
  assert.equal(previousReport.rows[0].clicks, 2);
  assert.equal(result.queries[0].start, previous.startDate);
});

test('mismatched or missing provider identifiers never reuse another configuration snapshot', () => {
  for (const [source, field, wrong] of [['ga4', 'propertyId', '999999'], ['gsc', 'siteUrl', 'https://other.example/']]) {
    for (const value of [wrong, undefined]) {
      const stale = snapshot(source, {[field]: value});
      const result = project([stale]);
      assert.deepEqual(result.reports, [], `${source} ${String(value)}`);
      assert.deepEqual(result.queries, []);
      assert.ok(result.notes.length > 0, 'excluded snapshots must be explained');
    }
  }
});

test('a failed latest sync keeps both the last successful measurements and integration error visible', () => {
  const lastSuccessAt = '2026-09-15T01:00:00Z';
  const integration = {source: 'ga4', status: 'error', code: 'GOOGLE_FORBIDDEN', message: 'Google APIの閲覧権限を確認してください。', lastAttemptAt: now.toISOString(), lastSuccessAt};
  const result = project([snapshot('ga4', {fetchedAt: lastSuccessAt})], {integrations: [integration]});
  compatible(result);
  assert.equal(result.reports[0].rows[0].views, 12);
  assert.equal(result.reports[0].importedAt, lastSuccessAt);
  const status = result.integrations.find(item => item.source === 'ga4');
  assert.equal(status.status, 'error');
  assert.equal(status.lastSuccessAt, lastSuccessAt);
  assert.equal(status.code, integration.code);
});

test('invalid report metadata or metrics discard the failing provider group without destroying valid data', () => {
  const malformedGa = [
    snapshot('ga4', {fetchedAt: 'not-a-date'}),
    snapshot('ga4', {startDate: '2026-02-30'}),
    snapshot('ga4', {pages: [{...gaPage, users: -1}]}),
    snapshot('ga4', {pages: [{...gaPage}, {...gaPage}]}),
  ];
  for (const bad of malformedGa) {
    const result = project([bad, snapshot('gsc')]);
    compatible(result);
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].rows[0].clicks, 2);
    assert.equal(result.reports[0].rows[0].views, null);
    assert.equal(result.queries[0].rows[0].query, '応募後 連絡取れない');
    assert.ok(result.notes.length > 0);
  }
  const result = project([snapshot('ga4'), snapshot('gsc', {pages: [{...searchPage, clicks: 21}]})]);
  compatible(result);
  assert.equal(result.reports[0].rows[0].views, 12);
  assert.equal(result.reports[0].rows[0].clicks, null);
  assert.ok(result.notes.length > 0);
});

test('data-quality caveats and non-additive query counts are retained without manufacturing page totals', () => {
  const quality = {truncated: true, thresholded: true, sampled: true, notes: ['APIの取得上限に達したため一部のみ。']};
  const result = project([
    snapshot('ga4', {quality}),
    snapshot('gsc', {pages: [], queries: [{...searchPage, query: '採用 ツール 費用', ctr: 0.9}]}),
  ]);
  compatible(result);
  assert.equal(result.reports[0].rows[0].clicks, null, 'page clicks must not be summed from query rows');
  assert.equal(result.queries[0].rows[0].ctr, 0.1, 'CTR is derived from observed counts');
  const notes = [...result.notes, ...result.reports.flatMap(report => report.notes)].join(' ');
  assert.match(notes, /APIの取得上限に達したため一部のみ/);
});

test('the advertised GitHub maintenance schedule matches the workflow and rolls over at 06:17 JST', () => {
  const workflow = readFileSync(new URL('../.github/workflows/seo-growth-schedule.yml', import.meta.url), 'utf8');
  const cases = [
    ['2026-09-22T21:16:59.999Z', '2026-09-22T21:17:00.000Z'],
    ['2026-09-22T21:17:00.000Z', '2026-09-23T21:17:00.000Z'],
    ['2026-12-31T21:18:00.000Z', '2027-01-01T21:17:00.000Z'],
  ];
  for (const [reference, expected] of cases) {
    const {schedule} = project([], {now: new Date(reference)});
    assert.deepEqual(schedule, {provider: 'github-actions', frequency: 'daily', timezone: 'Asia/Tokyo', time: '06:17', cron: '17 21 * * *', nextRunAt: expected});
    assert.ok(workflow.includes(`cron: '${schedule.cron}' # 06:17 JST: analytics`));
  }
});

test('maintenance success never upgrades missing Google data to a successful integration', () => {
  const scheduler = {status: 'completed', lastAttemptAt: '2026-09-22T06:17:00+09:00', lastSuccessAt: '2026-09-22T06:18:00+09:00', runId: '12345', runAttempt: '1'};
  const result = project([], {scheduler, integrations: [{source: 'ga4', status: 'not_configured'}, {source: 'gsc', status: 'not_configured'}]});
  assert.deepEqual(result.scheduler, {...scheduler, lastAttemptAt: '2026-09-21T21:17:00.000Z', lastSuccessAt: '2026-09-21T21:18:00.000Z'});
  assert.ok(result.integrations.every(row => row.status === 'not_configured' && row.lastSuccessAt === null));
  assert.deepEqual(result.reports, []);
  assert.deepEqual(result.queries, []);
  assert.equal(result.job, null);
});

test('scheduler failure and manual analytics completion remain independent and preserve valid reports', () => {
  const scheduler = {status: 'error', lastAttemptAt: now.toISOString(), lastSuccessAt: '2026-09-20T21:18:00Z', runId: '54321', runAttempt: '2'};
  const job = {status: 'completed', finishedAt: now.toISOString()};
  const result = project([snapshot('ga4')], {scheduler, job, integrations: [{source: 'ga4', status: 'ok', lastSuccessAt: fetchedAt}]});
  assert.equal(result.scheduler.status, 'error');
  assert.equal(result.scheduler.lastSuccessAt, '2026-09-20T21:18:00.000Z');
  assert.equal(result.job.status, 'completed');
  assert.equal(result.integrations[0].status, 'ok');
  assert.equal(result.reports[0].rows[0].views, 12);
});

test('scheduler output contains only validated run identity and timestamps', () => {
  const scheduler = {status: 'unexpected-state', lastAttemptAt: 'not-a-date', lastSuccessAt: 'SECRET-IN-DATE', runId: 'SECRET-IN-ID', runAttempt: '-1', token: 'SECRET-TOKEN', response: {sensitive: 'SECRET-BODY'}};
  const result = project([], {scheduler});
  assert.deepEqual(result.scheduler, {status: null, lastAttemptAt: null, lastSuccessAt: null, runId: null, runAttempt: null});
  assert.doesNotMatch(JSON.stringify(result), /SECRET|unexpected-state/);
  for (const absent of [null, undefined, []]) assert.equal(project([], {scheduler: absent}).scheduler, null);
});
