import test from 'node:test';
import assert from 'node:assert/strict';
import sites from '../src/data/seo-outreach-sites.json' with {type: 'json'};
import templates from '../src/data/seo-outreach-templates.json' with {type: 'json'};
import {validateOutreachState, emptyOutreachState, summarizeOutreach, filterOutreach, duplicateOutreach, OUTREACH_STATUS} from '../src/lib/seo-manager/outreach-model.mjs';

test('the imported outreach list keeps site-level fields only and no personal data', () => {
  assert.equal(sites.length, 140);
  const text = JSON.stringify([sites, templates]);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no email addresses');
  assert.doesNotMatch(text, /0\d{1,4}-\d{1,4}-\d{3,4}/, 'no phone numbers');
  assert.doesNotMatch(text, /addict|アディクト/i, 'no provider identity');
  assert.doesNotMatch(text, /__hs|utm_/, 'no tracking parameters');
  for (const site of sites) {
    assert.deepEqual(Object.keys(site).sort(), ['channel', 'contactUrl', 'genre', 'id', 'name', 'sourceStatus', 'url']);
    assert.match(site.id, /^o\d{3}$/); assert.match(site.url, /^https?:\/\//);
    if (site.contactUrl) assert.match(site.contactUrl, /^https?:\/\//);
  }
  assert.match(templates[0].body, /\{担当者名\}/);
});

test('LAYR outreach starts untouched; the provider status is reference only', () => {
  const state = {...emptyOutreachState(templates), revision: 0};
  const summary = summarizeOutreach(sites, state, new Date('2026-09-26T03:00:00Z'));
  assert.equal(summary.counts.todo, 140); assert.equal(summary.counts.sent, 0); assert.equal(summary.replyRate, null);
  assert.match(state.template.body, /株式会社LAYR/); assert.match(state.template.body, /https:\/\/layr\.co\.jp\/media\//);
  assert.match(state.template.body, /\{電話番号\}/, 'personal fields stay as placeholders');
});

test('outreach entries require dates and reasons, refuse passwords and unknown sites', () => {
  const base = emptyOutreachState(templates), entry = {status: 'sent', sentAt: '2026-09-26', liveAt: '', liveUrl: '', targetUrl: 'https://layr.co.jp/media/', nextAction: '', reason: '', notes: '', updatedAt: ''};
  const ok = validateOutreachState({...base, entries: {o001: entry}}, sites);
  assert.equal(ok.entries.o001.status, 'sent');
  for (const bad of [{...entry, sentAt: ''}, {...entry, status: 'live', liveAt: ''}, {...entry, status: 'declined'}, {...entry, notes: 'password: x'}, {...entry, liveUrl: 'javascript:alert(1)'}, {...entry, status: 'done'}]) {
    assert.throws(() => validateOutreachState({...base, entries: {o001: bad}}, sites));
  }
  assert.throws(() => validateOutreachState({...base, entries: {o999: entry}}, sites));
  assert.throws(() => validateOutreachState({...base, template: {subject: '', body: 'パスワード：abc'}}, sites));
  assert.throws(() => validateOutreachState({...base, goal: {monthlySends: 0}}, sites));
});

test('summary, filters and duplicate check follow LAYR status', () => {
  const state = {...emptyOutreachState(templates), entries: {
    o001: {status: 'replied', sentAt: '2026-09-20', liveAt: '', liveUrl: '', targetUrl: '', nextAction: '返信する', reason: '', notes: '', updatedAt: '2026-09-21T00:00:00Z'},
    o002: {status: 'live', sentAt: '2026-09-01', liveAt: '2026-09-25', liveUrl: 'https://example.com/a', targetUrl: '', nextAction: '', reason: '', notes: '', updatedAt: '2026-09-25T00:00:00Z'},
    o003: {status: 'declined', sentAt: '2026-08-01', liveAt: '', liveUrl: '', targetUrl: '', nextAction: '', reason: '返信なし', notes: '', updatedAt: ''}}};
  const summary = summarizeOutreach(sites, state, new Date('2026-09-26T03:00:00Z'));
  assert.equal(summary.sentThisMonth, 2); assert.equal(summary.liveThisMonth, 1); assert.equal(summary.active, 1);
  assert.equal(summary.replyRate, 1);
  assert.deepEqual(filterOutreach(sites, state, {status: 'active'}).map(row => row.site.id), ['o001']);
  assert.equal(filterOutreach(sites, state, {sort: 'status'})[0].site.id, 'o001');
  assert.equal(duplicateOutreach(sites, state, 'https://www.kigyolog.com/other')?.id, 'o001');
  assert.equal(Object.keys(OUTREACH_STATUS).length, 7);
});
