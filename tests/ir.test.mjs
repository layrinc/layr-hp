import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {toMan, pickPl, monthsOf, monthsBack, buildSummary, syncIr, handleIrPublic, handleIrManager, sealTokens, openTokens, ensureIr, IR_REDIRECT_URI} from '../worker/ir.mjs';

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
// 法人（株式会社LAYR）の試算表
const corpPl = (rev, op) => ({trial_pl: {balances: [
  {account_item_name: '売上高', account_category_name: '売上高', opening_balance: 0, closing_balance: rev},
  {account_category_name: '売上高', total_line: true, opening_balance: 100000, closing_balance: 100000 + rev},
  {account_category_name: '営業損益金額', total_line: true, opening_balance: -50000, closing_balance: -50000 + op},
]}});
// 個人事業（青色申告決算書の様式）の試算表：営業損益の行が無い
const soloPl = (rev, cost, exp) => ({trial_pl: {balances: [
  {account_category_name: '売上（収入）金額', total_line: true, opening_balance: 0, closing_balance: rev},
  {account_category_name: '売上原価', total_line: true, opening_balance: 0, closing_balance: cost},
  {account_category_name: '経費', total_line: true, opening_balance: 0, closing_balance: exp},
]}});

const CORP = 42, SOLO = 7;
function freee({corp = {'2026-08': [123456, -20000], '2026-09': [555555, 150000]}, solo = {}, companyOrder = [CORP]} = {}) {
  const calls = []; const order = [...companyOrder];
  const fetcher = async (url, init = {}) => {
    calls.push({url: String(url), init});
    const u = new URL(url);
    if (u.pathname.endsWith('/public_api/token')) {
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('client_secret'), 'sec');
      const company = p.get('grant_type') === 'authorization_code' ? order.shift() : undefined;
      return Response.json({access_token: `acc-${p.get('grant_type')}`, refresh_token: `ref-${calls.length}`, expires_in: 21600, company_id: company});
    }
    assert.match(init.headers.Authorization, /^Bearer acc-/);
    if (u.pathname === `/api/1/companies/${CORP}`) return Response.json({company: {id: CORP, display_name: '株式会社LAYR', fiscal_years: [{start_date: '2026-08-28', end_date: '2026-12-31'}]}});
    if (u.pathname === `/api/1/companies/${SOLO}`) return Response.json({company: {id: SOLO, display_name: '河出壱貫', fiscal_years: [{start_date: '2025-01-01', end_date: '2025-12-31'}, {start_date: '2026-01-01', end_date: '2026-12-31'}, {start_date: '2027-01-01', end_date: '2027-12-31'}]}});
    if (u.pathname === '/api/1/reports/trial_pl') {
      const m = u.searchParams.get('start_date').slice(0, 7);
      if (u.searchParams.get('company_id') === String(SOLO)) { const [r, c, e] = solo[m] ?? [0, 0, 0]; return Response.json(soloPl(r, c, e)); }
      const [r, o] = corp[m] ?? [0, 0]; return Response.json(corpPl(r, o));
    }
    return new Response('nf', {status: 404});
  };
  return {fetcher, calls};
}
const envOf = t => ({SEO_DB: d1(t), IR_TOKEN_KEY: key, FREEE_CLIENT_ID: 'cid', FREEE_CLIENT_SECRET: 'sec'});
async function connect(env, fetcher, now = NOW) {
  const start = await handleIrManager(new Request('https://seo.layr.co.jp/api/seo/ir/freee/connect'), env, '/api/seo/ir/freee/connect', {now, fetcher});
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  return handleIrManager(new Request(`${IR_REDIRECT_URI}?code=abc&state=${state}`), env, '/api/seo/ir/freee/callback', {now, fetcher});
}
async function link(env, companyId, expiresAt) {
  await ensureIr(env.SEO_DB);
  const {cipher, iv} = await sealTokens(env, {access_token: `acc-${companyId}`, refresh_token: `ref-${companyId}`});
  await env.SEO_DB.prepare('INSERT INTO ir_links (company_id, token_cipher, token_iv, access_expires_at, linked_at) VALUES (?,?,?,?,?)').bind(companyId, cipher, iv, expiresAt, NOW).run();
}
const summary = async (env, now, fetcher) => (await handleIrPublic(new Request('https://layr.co.jp/api/ir/summary'), env, null, {now, fetcher})).json();

test('万円への丸めは四捨五入で、赤字も対称に丸める', () => {
  assert.equal(toMan(123456), 12); assert.equal(toMan(125000), 13); assert.equal(toMan(-125000), -13); assert.equal(toMan(4999), 0);
});

test('試算表から売上高・営業利益を「期末−期首」で取り出す（法人・個人事業の両様式）', () => {
  assert.deepEqual(pickPl(corpPl(300000, -12000)), {revenue: 300000, operatingIncome: -12000});
  assert.deepEqual(pickPl(soloPl(500000, 50000, 120000)), {revenue: 500000, operatingIncome: 330000});
  assert.deepEqual(pickPl({trial_pl: {balances: []}}), {revenue: 0, operatingIncome: 0});
  assert.throws(() => pickPl({}), /試算表/);
  // 区分が読めない時は 0 で黙らず、区分名を添えて失敗にする
  assert.throws(() => pickPl({trial_pl: {balances: [{account_category_name: '謎の区分', total_line: true, opening_balance: 0, closing_balance: 1}]}}), /謎の区分/);
});

test('会計期間を暦月に分け、当月より先は含めない。直近の月を数える', () => {
  assert.deepEqual(monthsOf('2026-08-28', '2026-12-31', '2026-09'), [
    {month: '2026-08', start: '2026-08-28', end: '2026-08-31'},
    {month: '2026-09', start: '2026-09-01', end: '2026-09-30'},
  ]);
  assert.equal(monthsOf('2027-01-01', '2027-12-31').length, 12);
  assert.deepEqual([...monthsBack('2027-02', 3)], ['2027-02', '2027-01', '2026-12']);
});

test('未連携なら数字を一切出さない', async t => {
  const env = envOf(t);
  assert.deepEqual(await summary(env, NOW, async () => assert.fail('freeeを呼ばない')), {status: 'not_connected'});
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
  const done = await connect(env, fetcher);
  assert.equal(done.status, 200, await done.clone().text());
  assert.match(await done.text(), /株式会社LAYR：2026年 売上高68万円・営業利益13万円/);
  const row = await env.SEO_DB.prepare('SELECT * FROM ir_links WHERE company_id=?').bind(CORP).first();
  assert.equal(row.display_name, '株式会社LAYR');
  assert.ok(!row.token_cipher.includes('acc-') && !row.token_cipher.includes('ref-'), 'トークンは平文で保存しない');
  assert.equal((await openTokens(env, row.token_cipher, row.token_iv)).access, 'acc-authorization_code');
  assert.equal(calls.filter(c => c.url.includes('/reports/trial_pl')).length, 2);

  const res = await handleIrPublic(new Request('https://layr.co.jp/api/ir/summary'), env, null, {now: NOW + 1000, fetcher: async () => assert.fail('新しいので取り直さない')});
  const text = await res.text(); const body = JSON.parse(text);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(body.status, 'ok'); assert.equal(body.unit, '万円'); assert.equal(body.scope, 'combined');
  assert.equal(body.lastSyncAt, NOW);
  assert.equal(body.periods[0].label, '2026年');
  assert.deepEqual(body.periods[0].months, [
    {month: '2026-08', revenue: 12, operatingIncome: -2, provisional: false},
    {month: '2026-09', revenue: 56, operatingIncome: 15, provisional: true},
  ]);
  assert.deepEqual(body.periods[0].total, {revenue: 68, operatingIncome: 13});
  for (const secret of ['acc-', 'ref-', '123456', '555555', 'company', '株式会社LAYR']) assert.ok(!text.includes(secret), `公開APIに ${secret} を含めない`);
});

test('個人事業と株式会社LAYRを両方つなぐと、月ごとに合算して暦年で出す', async t => {
  const env = envOf(t);
  const {fetcher} = freee({companyOrder: [SOLO, CORP], solo: {
    '2025-12': [300000, 0, 100000], '2026-07': [400000, 0, 50000], '2026-08': [200000, 0, 20000], '2026-09': [100000, 0, 10000],
  }});
  assert.equal((await connect(env, fetcher)).status, 200);
  assert.equal((await connect(env, fetcher)).status, 200);
  const body = await summary(env, NOW + 1000, async () => assert.fail('取り直さない'));
  assert.deepEqual(body.periods.map(p => [p.label, p.inProgress, p.total.revenue, p.total.operatingIncome]), [['2025年', false, 30, 20], ['2026年', true, 138, 75]]);
  const aug = body.periods[1].months.find(m => m.month === '2026-08');
  assert.deepEqual(aug, {month: '2026-08', revenue: 32, operatingIncome: 16, provisional: false}); // 個人20万＋法人12万
  // 片方を外すと、その事業所の数字も消える
  const off = await handleIrManager(new Request(`https://seo.layr.co.jp/api/seo/ir/freee/disconnect?company=${SOLO}`), env, '/api/seo/ir/freee/disconnect', {now: NOW, fetcher});
  assert.equal(off.status, 200);
  const after = await summary(env, NOW + 2000, async () => assert.fail('取り直さない'));
  assert.deepEqual(after.periods.map(p => [p.label, p.total.revenue]), [['2026年', 68]]);
});

test('初回の取り込みは1回の上限までで区切り、残りは次のアクセスで続きを取る。取得済みの古い月は取り直さない', async t => {
  const env = envOf(t); await link(env, SOLO, NOW + 3600e3);
  const {fetcher, calls} = freee();
  const first = await syncIr(env, {now: NOW, fetcher, force: true});
  assert.equal(first.status, 'synced'); assert.equal(first.months, 21); assert.equal(first.remaining, 0); // 2025-01〜2026-09
  const pls = () => calls.filter(c => c.url.includes('/reports/trial_pl')).length;
  assert.equal(pls(), 21);
  await syncIr(env, {now: NOW + 4 * 3600e3, fetcher, force: true});
  assert.equal(pls(), 24, '2回目は直近3か月だけ取り直す');

  const env2 = envOf(t); await link(env2, SOLO, NOW + 3600e3);
  const later = Date.parse('2027-12-15T03:00:00Z'); // 2025-01〜2027-12 の36か月
  const f2 = freee();
  const a = await syncIr(env2, {now: later, fetcher: f2.fetcher, force: true});
  assert.equal(a.months, 30); assert.equal(a.remaining, 6);
  assert.equal((await env2.SEO_DB.prepare('SELECT last_sync_at FROM ir_state WHERE id=1').first()).last_sync_at, null, '取り残しがある間は次のアクセスで続ける');
  await summary(env2, later + 1000, f2.fetcher);
  assert.equal((await env2.SEO_DB.prepare('SELECT COUNT(*) AS n FROM ir_company_monthly').first()).n, 36);
});

test('期限切れの時だけ1回リフレッシュし、新しいリフレッシュトークンを保存する。同時実行はロックで弾く', async t => {
  const env = envOf(t); await link(env, CORP, NOW - 1);
  const {fetcher, calls} = freee();
  const [a, b] = await Promise.all([syncIr(env, {now: NOW, fetcher, force: true}), syncIr(env, {now: NOW, fetcher, force: true})]);
  assert.deepEqual([a.status, b.status].sort(), ['busy', 'synced']);
  const refreshes = calls.filter(c => c.url.endsWith('/token'));
  assert.equal(refreshes.length, 1);
  assert.equal(new URLSearchParams(refreshes[0].init.body).get('refresh_token'), `ref-${CORP}`);
  const row = await env.SEO_DB.prepare('SELECT * FROM ir_links WHERE company_id=?').bind(CORP).first();
  assert.notEqual((await openTokens(env, row.token_cipher, row.token_iv)).refresh, `ref-${CORP}`);
  assert.equal((await env.SEO_DB.prepare('SELECT lock_until FROM ir_state WHERE id=1').first()).lock_until, 0);
});

test('freeeの失敗は記録し、公開APIは前回の数字を出し続ける。片方の事業所だけ失敗しても、もう片方は更新する', async t => {
  const env = envOf(t); await link(env, CORP, NOW + 3600e3);
  const {fetcher} = freee();
  assert.equal((await syncIr(env, {now: NOW, fetcher, force: true})).status, 'synced');
  const broken = async () => new Response('down', {status: 500});
  const later = NOW + 4 * 3600e3;
  const body = await summary(env, later, broken);
  assert.equal(body.status, 'ok'); assert.equal(body.periods[0].total.revenue, 68);
  assert.match((await env.SEO_DB.prepare('SELECT last_error FROM ir_state WHERE id=1').first()).last_error, /freee/);

  await link(env, SOLO, later + 3600e3);
  const halfBroken = async (url, init) => new URL(url).searchParams.get('company_id') === String(SOLO) || String(url).includes(`/companies/${SOLO}`) ? new Response('down', {status: 500}) : fetcher(url, init);
  const r = await syncIr(env, {now: later + 1, fetcher: halfBroken, force: true});
  assert.equal(r.status, 'partial'); assert.equal(r.errors.length, 1);
});

test('buildSummary は暦年ごとに分け、今年に inProgress を付け、新しい3年だけ出す', () => {
  const rows = ['2024-05', '2025-12', '2026-12', '2027-01'].map((month, i) => ({month, revenue: (i + 1) * 1e6, operating_income: 1e5}));
  const s = buildSummary(rows, {now: Date.parse('2027-01-15T00:00:00Z'), lastSyncAt: 1, connected: true});
  assert.deepEqual(s.periods.map(p => [p.label, p.inProgress, p.total.revenue]), [['2025年', false, 200], ['2026年', false, 300], ['2027年', true, 400]]);
  assert.equal(s.periods[2].months[0].provisional, true);
});
