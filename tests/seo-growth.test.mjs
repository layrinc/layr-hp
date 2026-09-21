import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateLeadStages, buildGrowthReport, classifySearchIntent, metricChange} from '../src/lib/seo-manager/growth-model.mjs';

const path = '/service/ltori/area/mie/nabari/';
const now = new Date('2026-09-21T01:00:00Z');
const stamp = '2026-09-21T00:00:00Z';
const snapshot = (source, period, pages = [], summary = {}) => ({source, period, startDate: '2026-08-22', endDate: '2026-09-18', fetchedAt: stamp, pages, summary});

test('unconfigured reports retain unknowns and ask for connection rather than claiming no traffic', () => {
  const report = buildGrowthReport({pages: [{path, title: '名張市'}], now});
  assert.equal(report.summary.views, null);
  assert.equal(report.pages[0].inquiries, null);
  assert.equal(report.actions.filter(row => row.type.startsWith('setup_')).length, 2);
  assert.equal(report.actions.some(row => row.type === 'conversion_review'), false);
});

test('API totals are retained without summing non-additive user counts', () => {
  const snapshots = [snapshot('ga4', 'current', [{path, users: 15, views: 20}, {path: '/service/ltori/media/test/', users: 10, views: 12}], {users: 18, views: 32}), snapshot('gsc', 'current', [{path, clicks: 4, impressions: 100, ctr: 0.04, position: 8}], {clicks: 4, impressions: 100, ctr: 0.04, position: 8})];
  const report = buildGrowthReport({snapshots, now});
  assert.equal(report.summary.users, 18);
  assert.equal(report.pages[0].clicks, 4);
  assert.equal(report.summary.inquiries, null);
});

test('priority recommendations require sufficient observed data and distinguish unknown from zero', () => {
  const report = buildGrowthReport({snapshots: [snapshot('ga4', 'current', [{path, sessions: 60, inquiries: 0}]), snapshot('gsc', 'current', [{path, clicks: 1, impressions: 500, ctr: 0.002, position: 8}])], now});
  assert.ok(report.actions.some(row => row.type === 'ctr_review'));
  assert.ok(report.actions.some(row => row.type === 'conversion_review'));
  const unknown = buildGrowthReport({snapshots: [snapshot('ga4', 'current', [{path, sessions: 60, inquiries: null}])], now});
  assert.equal(unknown.actions.some(row => row.type === 'conversion_review'), false);
});

test('a partial snapshot replacement is not compared to another sync generation', () => {
  const report = buildGrowthReport({snapshots: [snapshot('gsc', 'current', [{path, clicks: 5}]), {...snapshot('gsc', 'previous', [{path, clicks: 100}]), fetchedAt: '2026-09-20T00:00:00Z'}], now});
  assert.equal(report.pages[0].previous.clicks, null);
  assert.equal(report.actions.some(row => row.type === 'traffic_decline'), false);
});

test('leads deduplicate by ID and use current pipeline stages only', () => {
  const result = aggregateLeadStages([
    {id: '1', stage: 'inquiry', updatedAt: '2026-09-19'},
    {id: '1', stage: 'won', updatedAt: '2026-09-20', revenueYen: 300000, grossProfitYen: 100000},
    {id: '2', stage: 'meeting'},
    {id: '3', stage: 'lost', revenueYen: 400000},
  ]);
  assert.deepEqual(result.stages, {inquiry: 0, qualified: 0, meeting: 1, won: 1, lost: 1});
  assert.equal(result.total, 3);
  assert.equal(result.revenueYen, 300000);
  assert.equal(result.grossProfitYen, 100000);
});

test('missing won amounts are unknown rather than fabricated zero revenue', () => {
  const result = aggregateLeadStages([{id: '1', stage: 'won'}, {id: '2', stage: 'won', revenueYen: 50000, grossProfitYen: 0}]);
  assert.equal(result.revenueYen, null);
  assert.equal(result.recordedRevenueYen, 50000);
  assert.equal(result.grossProfitComplete, false);
});

test('store values and by-source lead revenue join by canonical production path', () => {
  const report = buildGrowthReport({pages: [{path, title: '名張市'}], leads: [{key: '1', value: {id: '1', sourcePath: `https://layr.co.jp${path}?utm_source=test`, stage: 'won', revenueYen: 100, grossProfitYen: 50}}], inspections: [{key: path, value: {path, status: 'ok', verdict: 'FAIL', coverageState: 'noindex'}}], now});
  assert.equal(report.pages[0].leadStages.won, 1);
  assert.equal(report.pages[0].revenueYen, 100);
  assert.ok(report.actions.some(row => row.type === 'index_review' && row.priority === 1));
  assert.ok(report.actions.some(row => row.type === 'expand_evidence'));
});

test('query overlap is a review suggestion, not automatic deletion; intent remains a suggestion', () => {
  const report = buildGrowthReport({snapshots: [{...snapshot('gsc', 'current'), queries: [{path, query: '採用 LINE 支援', impressions: 40}, {path: '/service/ltori/media/test/', query: '採用 LINE 支援', impressions: 30}]}], now});
  assert.equal(report.actions.filter(row => row.type === 'query_overlap').length, 1);
  assert.match(report.actions.find(row => row.type === 'query_overlap').nextStep, /共存/);
  assert.equal(classifySearchIntent('採用LINE構築 費用'), 'employer');
  assert.equal(classifySearchIntent('仕事を探す'), 'job_seeker');
  assert.equal(classifySearchIntent('名張市 LINE'), 'review');
});

test('rate differences do not divide by zero or invent missing measurements', () => {
  assert.deepEqual(metricChange(1, 0), {difference: 1, percent: null});
  assert.deepEqual(metricChange(null, 1), {difference: null, percent: null});
  assert.deepEqual(metricChange(120, 100), {difference: 20, percent: 20});
});

test('upstream failures have distinct action IDs and last-success source dates', () => {
  const report = buildGrowthReport({integrations: [{source: 'ga4', status: 'error', lastSuccessAt: stamp}, {source: 'gsc', status: 'error', lastSuccessAt: stamp}], now});
  assert.equal(new Set(report.actions.map(row => row.id)).size, report.actions.length);
  assert.equal(report.sources[0].lastSuccessAt, stamp);
});
