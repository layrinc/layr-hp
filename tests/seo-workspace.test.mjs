import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWorkspace, ltoriGrowthSnapshots} from '../worker/seo-workspace.mjs';
const now = new Date('2026-09-22T08:00:00Z');
const regional = '/service/ltori/area/mie/nabari/', media = '/service/ltori/media/interview-followup/', corporate = '/media/line-recruit/';
const configuration = {propertyId: '123', siteUrl: 'sc-domain:layr.co.jp'};
const catalog = [{path: regional, title: '名張', type: 'city'}, {path: media, title: '面接', type: 'article'}, {path: corporate, title: '公式', type: 'article'}];
const snapshot = (source, pages, overrides = {}) => ({source, period: 'current', ...configuration, startDate: '2026-08-23', endDate: '2026-09-19', fetchedAt: '2026-09-22T07:00:00Z', coverage: {version: 2, prefixes: ['/service/ltori/', '/media/']}, pages, queries: [], ...overrides});
function report(options = {}) {return projectWorkspace({now, configuration, catalog, ...options});}

test('unmeasured metrics stay null; actual zero remains zero, and only published catalog URLs are counted', () => {
  const result = report({catalog: [...catalog, {...catalog[1], path: `https://layr.co.jp${media}?source=x`}, {path: 'https://external.example/media/x/', title: 'external'}], snapshots: [snapshot('ga4', [{path: media, views: 0, users: 9}, {path: corporate, views: 10, inquiries: 99}, {path: '/media/measured-only/', views: 5}, {path: '/admin/', views: 999}])], pending: [{path: regional, status: 'draft'}, {path: regional, status: 'draft'}, {path: media, status: 'published'}]});
  assert.equal(result.projects[0].metrics.views, null);
  assert.equal(result.projects[0].pendingCount, 0);
  assert.equal(result.projects[1].metrics.views, 0);
  assert.equal(result.projects[1].publishedCount, 1);
  assert.equal(result.projects[2].metrics.views, 15);
  assert.equal(result.projects[2].publishedCount, 1);
  assert.equal(result.projects[2].metrics.inquiries, null);
  assert.equal(result.totals.publishedCount, 3);
  assert.equal(result.totals.views, 15);
  assert.equal(result.totals.clicks, null);
  assert.equal(result.projects[1].pages[0].metrics.users, 9);
  assert.equal(Object.hasOwn(result.totals, 'users'), false);
  assert.equal(Object.hasOwn(result.projects[1].metrics, 'users'), false);
  assert.doesNotMatch(JSON.stringify(result), /external|admin/);
});

test('canonical duplicate rows never double count and conflicting values stay unknown', () => {
  const result = report({snapshots: [snapshot('ga4', [{path: media, views: 7}, {path: media.slice(0, -1), views: 7}, {path: corporate, views: 5}, {path: `${corporate}?x=1`, views: 9}, {path: corporate, views: 5}])]});
  assert.equal(result.projects[1].metrics.views, 7);
  assert.equal(result.projects[2].metrics.views, null);
  assert.equal(result.totals.views, 7);
  assert.ok(result.notes.some(note => note.includes('重複行')));
});

test('GA4 property and GSC site mismatches and malformed dates are excluded', () => {
  for (const overrides of [{propertyId: '456'}, {siteUrl: 'sc-domain:other.test'}, {startDate: '2026-99-10'}, {endDate: '2025-01-01'}, {fetchedAt: 'invalid'}]) {
    const result = report({snapshots: [snapshot('ga4', [{path: media, views: 7}], overrides)]});
    assert.equal(result.totals.views, null);
    assert.equal(result.periods.ga4, null);
    assert.ok(result.notes.some(note => note.includes('取得元または形式')));
  }
  const search = report({snapshots: [snapshot('gsc', [{path: media, clicks: 8}], {siteUrl: 'sc-domain:other.test'})]});
  assert.equal(search.totals.clicks, null);
});

test('latest failed attempts preserve prior successes and source-specific periods with safe status data', () => {
  const result = report({snapshots: [snapshot('ga4', [{path: media, views: 0}]), snapshot('gsc', [{path: regional, clicks: 2, impressions: 15}], {startDate: '2026-08-22', endDate: '2026-09-18'})], integrations: [{source: 'ga4', status: 'error', lastSuccessAt: '2026-09-21T07:00:00Z', lastAttemptAt: '2026-09-22T07:00:00Z', message: 'SECRET ERROR', access_token: 'SECRET'}], scheduler: {maintenance: {status: 'error', runId: '123', runAttempt: '2', secret: 'SECRET', lastSuccessAt: '2026-09-20T00:00:00Z'}}});
  assert.equal(result.totals.views, 0);
  assert.equal(result.totals.clicks, 2);
  assert.equal(result.sources[0].status, 'error');
  assert.equal(result.sources[0].lastSuccessAt, '2026-09-21T07:00:00.000Z');
  assert.equal(result.scheduler.maintenance.runId, '123');
  assert.ok(result.notes.some(note => note.includes('取得対象期間が異なります')));
  assert.doesNotMatch(JSON.stringify(result), /SECRET|access_token/);
});

test('old coverage cannot be misrepresented as corporate traffic and truncation preserves only page observations', () => {
  const legacy = report({snapshots: [snapshot('ga4', [{path: media, views: 12}, {path: corporate, views: 8}], {coverage: undefined})]});
  assert.equal(legacy.projects[1].metrics.views, 12);
  assert.equal(legacy.projects[2].metrics.views, null);
  assert.equal(legacy.sources[0].coverage.version, 1);
  assert.ok(legacy.notes.some(note => note.includes('旧範囲')));
  const limited = report({snapshots: [snapshot('gsc', [{path: media, clicks: 3, impressions: 12}], {quality: {truncated: true, sampled: true}})]});
  assert.equal(limited.totals.clicks, null);
  assert.equal(limited.projects[1].metrics.clicks, null);
  assert.equal(limited.projects[1].pages[0].metrics.clicks, 3);
  assert.ok(limited.notes.some(note => note.includes('取得上限')));
});

test('overview projection never returns drafts, raw bodies, arbitrary fields or personal lead details', () => {
  const result = report({catalog: [...catalog, {path: media, body: 'PRIVATE-BODY', email: 'private@example.test'}], snapshots: [snapshot('ga4', [{path: media, views: 1, secret: 'PRIVATE-ROW'}], {secret: 'PRIVATE-SNAPSHOT', queries: [{query: 'PRIVATE-QUERY'}]})], pending: [{path: regional, status: 'draft', body: 'PRIVATE-DRAFT'}], leads: [{email: 'PRIVATE-LEAD'}]});
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private@/);
});

test('legacy growth receives only ltori observations, never corporate totals or summed users', () => {
  const input = snapshot('ga4', [{path: media, views: 9, users: 4, sessions: 2}, {path: corporate, views: 99, users: 88}], {summary: {views: 108, users: 89}, queries: [{path: corporate, query: '企業'}, {path: media, query: '採用'}]});
  const [result] = ltoriGrowthSnapshots([{value: input}]);
  assert.deepEqual(result.pages.map(row => row.path), [media]);
  assert.equal(result.summary.views, 9);
  assert.equal(result.summary.users, null);
  assert.equal(result.summary.sessions, 2);
  assert.deepEqual(result.queries.map(row => row.query), ['採用']);
  assert.equal(input.summary.views, 108, 'input snapshot is unchanged');
  assert.match(result.quality.notes.at(-1), /公式メディア.*含みません/);
});


test('publication waiting counts approved and scheduled URLs only, excluding draft and paused entries', () => {
  const result = report({pending: [
    {path: regional, status: 'approved'}, {path: regional.slice(0, -1), status: 'scheduled'},
    {path: '/service/ltori/area/mie/toba/', status: 'scheduled'},
    {path: '/service/ltori/area/mie/draft/', status: 'draft'}, {path: '/service/ltori/area/mie/paused/', status: 'paused'},
    {path: media, status: 'approved'}, {path: corporate, status: 'published'},
  ]});
  assert.deepEqual(result.projects.map(row => row.pendingCount), [2, 1, 0]);
  const actions = result.actions.filter(row => row.type === 'publication');
  assert.equal(actions.length, 2);
  assert.ok(actions.every(row => row.href === '/growth/#documents' && row.reason.includes('承認済み・公開予約済み') && row.nextStep));
  assert.ok(result.notes.some(note => note.includes('下書き・停止中の原稿とブラウザ内の記事計画は含みません')));
  assert.ok(result.actions.filter(row => row.type === 'sync').every(row => row.href === '/growth/#health'));
});

test('CTR suggestions use observed GSC evidence and never interpret missing values as zero', () => {
  const result = report({snapshots: [snapshot('gsc', [
    {path: media, impressions: 100, position: 1, ctr: 0},
    {path: corporate, impressions: 200, position: 20, ctr: 0.005},
    {path: regional, impressions: 1000, position: 3, ctr: null},
    {path: '/media/no-position/', impressions: 1000, position: null, ctr: 0},
    {path: '/media/no-impressions/', impressions: null, position: 4, ctr: 0},
    {path: '/media/too-few/', impressions: 99, position: 5, ctr: 0},
    {path: '/media/outside-rank/', impressions: 1000, position: 21, ctr: 0},
    {path: '/media/below-first/', impressions: 1000, position: 0.5, ctr: 0},
    {path: '/media/at-threshold/', impressions: 1000, position: 5, ctr: 0.01},
  ])]});
  const actions = result.actions.filter(row => row.type === 'ctr_review');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map(row => row.href), ['/articles/', '/media/']);
  assert.ok(actions.every(row => row.reason.includes('2026-08-23〜2026-09-19') && row.reason.includes('運用上の目安') && row.reason.includes('Googleの評価基準ではありません') && row.nextStep));
  assert.ok(actions[1].reason.includes('CTR 0.0％'));
  assert.equal(report().actions.filter(row => row.type === 'ctr_review').length, 0);
});
