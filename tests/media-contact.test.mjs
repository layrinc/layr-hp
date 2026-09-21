import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMediaContact } from '../src/lib/media-contact.mjs';

function harness(fetcher, valid = true, timeoutMs = 100) {
  const button = { disabled: false, textContent: 'お問い合わせを送る' };
  const status = { hidden: true, dataset: {} };
  const fields = [{ value: '入力した内容', disabled: false }];
  const requests = [];
  const form = { dataset: {}, action: 'https://formsubmit.co/info@layr.co.jp',
    querySelector: selector => selector === '[type=submit]' ? button : status,
    querySelectorAll: () => fields, reportValidity: () => valid,
    addEventListener: (_, callback) => { form.submit = callback; },
  };
  bindMediaContact(form, { timeoutMs, makeData: () => 'PRIVATE_FORM', fetcher: (...args) => { requests.push(args); return fetcher(...args); } });
  return { button, status, fields, requests, submit: () => form.submit({ preventDefault() {} }) };
}
const response = success => ({ ok: true, json: async () => ({ success }) });
test('media form routes to company mailbox and accepts only explicit success', async () => {
  for (const success of [true, 'true']) {
    const h = harness(async () => response(success)); await h.submit();
    assert.equal(h.requests[0][0], 'https://formsubmit.co/ajax/info@layr.co.jp');
    assert.equal(h.status.dataset.state, 'success'); assert.equal(h.button.disabled, true);
    assert.equal(h.fields[0].disabled, true);
    await h.submit(); assert.equal(h.requests.length, 1);
  }
});
test('failed responses preserve input and permit retry', async () => {
  for (const fetcher of [async () => response(false), async () => response('false'), async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }), async () => { throw new Error('network'); }]) {
    const h = harness(fetcher); await h.submit();
    assert.equal(h.status.dataset.state, 'error'); assert.equal(h.button.disabled, false);
    assert.equal(h.fields[0].value, '入力した内容'); assert.equal(h.fields[0].disabled, false);
    await h.submit(); assert.equal(h.requests.length, 2);
  }
});
test('invalid input is not sent and pending submissions cannot duplicate', async () => {
  const invalid = harness(async () => response(true), false); await invalid.submit(); assert.equal(invalid.requests.length, 0);
  let release; const h = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = h.submit(); await h.submit(); assert.equal(h.requests.length, 1);
  release(response(true)); await pending; assert.equal(h.status.dataset.state, 'success');
});
test('timeout also covers a stalled JSON body and never reports late success', async () => {
  let finish; const h = harness(async () => ({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) }), true, 5);
  await h.submit(); assert.equal(h.status.dataset.state, 'error');
  assert.equal(h.requests[0][1].signal.aborted, true);
  finish({ success: true }); await Promise.resolve();
  assert.equal(h.status.dataset.state, 'error'); assert.equal(h.fields[0].disabled, false);
});
