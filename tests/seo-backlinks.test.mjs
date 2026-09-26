import test from 'node:test';
import assert from 'node:assert/strict';
import sites from '../src/data/seo-backlink-sites.json' with {type: 'json'};
import {emptyState, defaultProfile, filterSites, summarize, validateBacklinkState, duplicateOf, isRecommended} from '../src/lib/seo-manager/backlink-model.mjs';

test('backlink site list is complete and uses safe URLs', () => {
  assert.equal(sites.length, 271);
  assert.equal(new Set(sites.map(site => site.id)).size, sites.length);
  for (const site of sites) {
    assert.ok(site.name);
    for (const key of ['url', 'formUrl']) if (site[key]) assert.match(site[key], /^https?:\/\//);
  }
  assert.ok(sites.filter(isRecommended).length >= 15);
});

test('backlink summary counts this month and filters active work', () => {
  const state = {...emptyState(defaultProfile({name: '株式会社LAYR'})), entries: {
    s001: {status: 'live', appliedAt: '2026-09-02', liveAt: '2026-09-20', liveUrl: 'https://example.com/', account: '', reason: '', nextAction: '', notes: '', updatedAt: ''},
    s002: {status: 'contact', appliedAt: '2026-09-10', liveAt: '', liveUrl: '', account: '', reason: '', nextAction: '書類を送る', notes: '', updatedAt: ''},
    s003: {status: 'rejected', appliedAt: '2026-08-10', liveAt: '', liveUrl: '', account: '', reason: '対象地域外', nextAction: '', notes: '', updatedAt: ''},
  }};
  const checked = validateBacklinkState(state, sites);
  const summary = summarize(sites, checked, new Date('2026-09-26T03:00:00Z'));
  assert.equal(summary.liveThisMonth, 1);
  assert.equal(summary.appliedThisMonth, 2);
  assert.equal(summary.active, 1);
  assert.equal(summary.counts.rejected, 1);
  assert.deepEqual(filterSites(sites, checked, {status: 'active'}).map(row => row.site.id), ['s002']);
  assert.equal(filterSites(sites, checked, {search: 'CANPAN'})[0].site.id, 's001');
  assert.equal(duplicateOf(sites, checked, 'https://www.fields.canpan.info/other')?.id, 's001');
  assert.equal(duplicateOf(sites, checked, 'https://unique-example.jp/'), null);
});
