import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {toMan, pickPl, monthsOf, buildSummary, syncIr, handleIrPublic, handleIrManager, sealTokens, openTokens, ensureIr, IR_REDIRECT_URI} from '../worker/ir.mjs';

function d1(t) {
  const connection = new DatabaseSync(':memory:'); t.after(() => connection.close());
  const prepared = (sql, bindings = []) => ({
    bind(...args) { return prepared(sql, args); },
    execute() { const r = connection.prepare(sql).run(...bindings); return {success: true, meta: {changes: Number(r.changes)}}; },
    async run() { return this.execute(); },
    async first() { const row = connection.prepare(sql).get(...bindings); return row ? {...row} : null; },
    async all() { return {results: connection.prepare(sql).all(...bindings).map(r => ({...r}))}; },
  });
  return {prepare: sql => prepared(sql), async batch(list) { connection.exec('BEGIN IMMEDIATE'); try { const r = list.map(s => s.execute()); connection.exec('COMMIT'); return r; } catch (e) { connection.exec('ROLLBACK'); throw e; } }};
}
const key = Buffer.from(Array.from({length: 32}, (_, i) => i)).toString('base64');
const NOW = Date.parse('2026-09-26T03:00:00Z'); // JST 2026-09-26 12:00
const pl = (rev, op) => ({trial_pl: {balances: [
  {account_item_name: '売上高', account_category_name: '売上高', opening_balance: 0, closing_balance: rev},
  {account_category_name: '売上高', total_line: true, opening_balance: 100000, closing_balance: 100000 + rev},
  {account_category_name: '営業損益金額', total_line: true, opening_balance: -50000, closing_balance: -50000 + op},
]}});

function freee({revenue = {'2026-08': 123456, '2026-09': 555555}, income = {'2026-08': -20000, '2026-09': 150000}} = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({url: String(url), init});
    const u = new URL(url);
    if (u.pathname.endsWith('/public_api/token')) {
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('client_secret'), 'sec');
      return Response.json({access_token: `acc-${p.get('grant_type')}`, refresh_token: `ref-${calls.length}`, expires_in: 21600, company_id: p.get('grant_type') === 'authorization_code' ? 42 : undefined});
    }
    assert.match(init.headers.Authorization, /^Bearer acc-/);
    if (u.pathname === '/api/1/companies/42') return Response.json({company: {id: 42, fiscal_years: [{start_date: '2026-08-28', end_date: '2026-12-31'}]}});
    if (u.pathname === '/api/1/reports/trial_pl') { const m = u.searchParams.get('start_date').slice(0, 7); return Response.json(pl(revenue[m] ?? 0, income[m] ?? 0)); }
    return new Response('nf', {status: 404});
  };
  return {fetcher, calls};
}
const envOf = t => ({SEO_DB: d1(t), IR_TOKEN_KEY: key, FREEE_CLIENT_ID: 'cid', FREEE_CLIENT_SECRET: 'sec'});

test('万円への丸めは四捨五入で、赤字も対称に丸める', () => {
  assert.equal(toMan(123456), 12); assert.equal(toMan(125000), 13); assert.equal(toMan(-125000), -13); assert.equal(toMan(4999), 0);
});

test('試算表から期間の売上高・営業損益を「期末−期首」で取り出す', () => {
  assert.deepEqual(pickPl(pl(300000, -12000)), {revenue: 300000, operatingIncome: -12000});
  assert.deepEqual(pickPl({trial_pl: {balances: []}}), {revenue: 0, operatingIncome: 0});
  assert.throws(() => pickPl({}), /試算表/);
});

test('第1期（8/28〜12/31）を暦月に分け、当月より先は含めない', () => {
  assert.deepEqual(monthsOf('2026-08-28', '2026-12-31', '2026-09'), [
    {month: '2026-08', start: '2026-08-28', end: '2026-08-31'},
    {month: '2026-09', start: '2026-09-01', end: '2026-09-30'},
  ]);
  assert.equal(monthsOf('2027-01-01', '2027-12-31').length, 12);
});

test('未連携なら数字を一切出さない', async t => {
  const env = envOf(t);
  const res = await handleIrPublic(new Request('https://layr.co.jp/api/ir/summary'), env, null, {now: NOW, fetcher: async () => assert.fail('freeeを呼ばない')});
  assert.deepEqual(await res.json(), {status: 'not_connected'});
});

test('連携→同期→公開：トークンは暗号化して保存し、公開APIは万円単位だけを返す', async t => {
  const env = envOf(t); const {fetcher, calls} = freee();
  const start = await handleIrManager(new Request('https://seo.layr.co.jp/api/seo/ir/freee/connect'), env, '/api/seo/ir/freee/connect', {now: NOW, fetcher});
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('Location'));
  assert.equal(auth.searchParams.get('redirect_uri'), IR_REDIRECT_URI);
  assert.equal(auth.searchParams.get('prompt'), 'select_company');
  const bad = await handleIrManager(new Request(`${IR_REDIRECT_URI}?code=x&state=wrong`), env, '/api/seo/ir/freee/callback', {now: NOW, fetcher});
  assert.equal(bad.status, 400);
  const again = await handleIrManager(new Request('https://seo.layr.co.jp/api/seo/ir/freee/connect'), env, '/api/seo/ir/freee/connect', {now: NOW, fetcher});
  const state = new URL(again.headers.get('Location')).searchParams.get('state');
  const done = await handleIrManager(new Request(`${IR_REDIRECT_URI}?code=abc&state=${state}`), env, '/api/seo/ir/freee/callback', {now: NOW, fetcher});
  assert.equal(done.status, 200, await done.clone().text());
  const row = await env.SEO_DB.prepare('SELECT * FROM ir_state WHERE id=1').first();
  assert.equal(row.company_id, 42);
  assert.ok(!row.token_cipher.includes('acc-') && !row.token_cipher.includes('ref-'), 'トークンは平文で保存しない');
  assert.equal((await openTokens(env, row.token_cipher, row.token_iv)).access, 'acc-authorization_code');
  assert.equal(calls.filter(c => c.url.includes('/reports/trial_pl')).length, 2);

  const res = await handleIrPublic(new Request('https://layr.co.jp/api/ir/summary'), env, null, {now: NOW + 1000, fetcher: async () => assert.fail('新しいので取り直さない')});
  const text = await res.text(); const body = JSON.parse(text);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(body.status, 'ok'); assert.equal(body.unit, '万円');
  assert.equal(body.periods[0].label, '第1期');
  assert.deepEqual(body.periods[0].months, [
    {month: '2026-08', revenue: 12, operatingIncome: -2, provisional: false},
    {month: '2026-09', revenue: 56, operatingIncome: 15, provisional: true},
  ]);
  assert.deepEqual(body.periods[0].total, {revenue: 68, operatingIncome: 13});
  for (const secret of ['acc-', 'ref-', '123456', '555555', 'company']) assert.ok(!text.includes(secret), `公開APIに ${secret} を含めない`);
});

test('期限切れの時だけ1回リフレッシュし、新しいリフレッシュトークンを保存する。同時実行はロックで弾く', async t => {
  const env = envOf(t); await ensureIr(env.SEO_DB);
  const {cipher, iv} = await sealTokens(env, {access_token: 'acc-old', refresh_token: 'ref-old'});
  await env.SEO_DB.prepare('UPDATE ir_state SET company_id=42, token_cipher=?, token_iv=?, access_expires_at=? WHERE id=1').bind(cipher, iv, NOW - 1).run();
  const {fetcher, calls} = freee();
  const [a, b] = await Promise.all([syncIr(env, {now: NOW, fetcher, force: true}), syncIr(env, {now: NOW, fetcher, force: true})]);
  assert.deepEqual([a.status, b.status].sort(), ['busy', 'synced']);
  const refreshes = calls.filter(c => c.url.endsWith('/token'));
  assert.equal(refreshes.length, 1);
  assert.equal(new URLSearchParams(refreshes[0].init.body).get('refresh_token'), 'ref-old');
  const row = await env.SEO_DB.prepare('SELECT * FROM ir_state WHERE id=1').first();
  assert.notEqual((await openTokens(env, row.token_cipher, row.token_iv)).refresh, 'ref-old');
  assert.equal(row.lock_until, 0);
});

test('freeeの失敗は記録し、公開APIは前回の数字を出し続ける', async t => {
  const env = envOf(t); const {fetcher} = freee();
  await ensureIr(env.SEO_DB);
  const {cipher, iv} = await sealTokens(env, {access_token: 'acc-x', refresh_token: 'ref-x'});
  await env.SEO_DB.prepare('UPDATE ir_state SET company_id=42, token_cipher=?, token_iv=?, access_expires_at=? WHERE id=1').bind(cipher, iv, NOW + 3600e3).run();
  assert.equal((await syncIr(env, {now: NOW, fetcher, force: true})).status, 'synced');
  const broken = async () => new Response('down', {status: 500});
  const later = NOW + 4 * 3600e3;
  const res = await handleIrPublic(new Request('https://layr.co.jp/api/ir/summary'), env, null, {now: later, fetcher: broken});
  const body = await res.json();
  assert.equal(body.status, 'ok'); assert.equal(body.periods[0].total.revenue, 68);
  assert.match((await env.SEO_DB.prepare('SELECT last_error FROM ir_state WHERE id=1').first()).last_error, /freee/);
});

test('buildSummary は期ごとに分け、期中の期に inProgress を付ける', () => {
  const s = buildSummary([
    {month: '2026-12', period_start: '2026-08-28', period_end: '2026-12-31', revenue: 1e6, operating_income: 2e5},
    {month: '2027-01', period_start: '2027-01-01', period_end: '2027-12-31', revenue: 3e6, operating_income: -1e5},
  ], {now: Date.parse('2027-01-15T00:00:00Z'), lastSyncAt: 1, connected: true});
  assert.deepEqual(s.periods.map(p => [p.label, p.inProgress, p.total.revenue]), [['第1期', false, 100], ['第2期', true, 300]]);
});
