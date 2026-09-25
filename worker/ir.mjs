// IR（経営状況）ページ用：freee会計の売上高・営業利益を月次で集計し、万円単位で公開する。
// - 公開API  GET /api/ir/summary        … 保存済みの集計を返す。3時間より古ければ裏でfreeeから取り直す
// - 管理API  /api/seo/ir/*（seo.layr.co.jp・Access＋河出さんのメールのみ）… freee連携の承認・手動更新・状態確認
// 公開するのは月ごとの売上高・営業利益（万円単位）だけ。取引明細・取引先・円単位の金額・トークンは出さない。

export const IR_SUMMARY_PATH = '/api/ir/summary';
export const IR_MANAGER_PREFIX = '/api/seo/ir/';
const FREEE_ACCOUNTS = 'https://accounts.secure.freee.co.jp/public_api';
const FREEE_API = 'https://api.freee.co.jp/api/1';
export const IR_REDIRECT_URI = 'https://seo.layr.co.jp/api/seo/ir/freee/callback';
export const STALE_MS = 3 * 60 * 60 * 1000;
const LOCK_MS = 90 * 1000;
const MAX_PERIODS = 3;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ir_state (id INTEGER PRIMARY KEY CHECK (id = 1), company_id INTEGER, token_cipher TEXT, token_iv TEXT, access_expires_at INTEGER, lock_until INTEGER, last_sync_at INTEGER, last_error TEXT, oauth_state TEXT, oauth_state_expires INTEGER)`,
  `CREATE TABLE IF NOT EXISTS ir_monthly (month TEXT PRIMARY KEY, period_start TEXT NOT NULL, period_end TEXT NOT NULL, revenue INTEGER NOT NULL, operating_income INTEGER NOT NULL, synced_at INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO ir_state (id) VALUES (1)`,
];
const ready = new WeakMap();
export async function ensureIr(db) {
  if (!db?.prepare) throw new Error('SEO_DB が未接続です');
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
}

// ---------- 集計（純粋関数） ----------
export function toMan(yen) {
  const n = Number(yen) || 0;
  return Math.sign(n) * Math.round(Math.abs(n) / 10000);
}

// freee 試算表（損益計算書）から、指定期間の売上高と営業損益を取り出す。
// closing_balance は期首からの累計のことがあるため、期間の金額は closing − opening で求める。
export function pickPl(json) {
  const balances = json?.trial_pl?.balances;
  if (!Array.isArray(balances)) throw new Error('試算表の形式を読み取れませんでした');
  const amount = name => {
    const row = balances.find(b => b.account_category_name === name && b.total_line) || balances.find(b => b.account_category_name === name && !b.account_item_name);
    return row ? (Number(row.closing_balance) || 0) - (Number(row.opening_balance) || 0) : 0;
  };
  return {revenue: amount('売上高'), operatingIncome: amount('営業損益金額')};
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// 会計期間を暦月に分ける（期首・期末の端数月はその日付で切る）。untilMonth より先の月は含めない
export function monthsOf(startDate, endDate, untilMonth) {
  const out = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  let cur = new Date(`${startDate}T00:00:00Z`);
  while (cur <= end) {
    const month = `${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}`;
    if (untilMonth && month > untilMonth) break;
    const last = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    out.push({month, start: ymd(cur), end: ymd(last < end ? last : end)});
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

export function jstMonth(now) {
  const d = new Date(now + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// 保存行 → 公開用の形（万円単位）。期ごとに月次と累計。当月は速報
export function buildSummary(rows, {now, lastSyncAt, connected}) {
  if (!connected) return {status: 'not_connected'};
  const current = jstMonth(now);
  const periods = new Map();
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    const key = `${r.period_start}|${r.period_end}`;
    if (!periods.has(key)) periods.set(key, {start: r.period_start, end: r.period_end, months: [], yen: {revenue: 0, operatingIncome: 0}});
    const p = periods.get(key);
    p.months.push({month: r.month, revenue: toMan(r.revenue), operatingIncome: toMan(r.operating_income), provisional: r.month >= current});
    p.yen.revenue += Number(r.revenue) || 0; p.yen.operatingIncome += Number(r.operating_income) || 0;
  }
  const list = [...periods.values()].sort((a, b) => a.start.localeCompare(b.start));
  return {
    status: list.length ? 'ok' : 'empty',
    unit: '万円',
    currentMonth: current,
    lastSyncAt: lastSyncAt || null,
    periods: list.map((p, i) => ({
      label: `第${i + 1}期`,
      start: p.start, end: p.end,
      months: p.months,
      total: {revenue: toMan(p.yen.revenue), operatingIncome: toMan(p.yen.operatingIncome)},
      inProgress: p.end >= ymd(new Date(now + 9 * 3600 * 1000)),
    })),
  };
}

// ---------- トークンの暗号化（AES-GCM・鍵は Worker の secret IR_TOKEN_KEY） ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function tokenKey(env) {
  const raw = env.IR_TOKEN_KEY ? unb64(env.IR_TOKEN_KEY) : null;
  if (!raw || raw.length !== 32) throw new Error('IR_TOKEN_KEY（32バイトのbase64）が未設定です');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealTokens(env, tokens) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({access: tokens.access_token, refresh: tokens.refresh_token}));
  return {cipher: b64(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await tokenKey(env), data)), iv: b64(iv)};
}
export async function openTokens(env, cipher, iv) {
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, await tokenKey(env), unb64(cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- freee との通信 ----------
function credentials(env) {
  if (!env.FREEE_CLIENT_ID || !env.FREEE_CLIENT_SECRET) throw new Error('FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が未設定です');
  return {client_id: env.FREEE_CLIENT_ID, client_secret: env.FREEE_CLIENT_SECRET};
}
async function tokenRequest(env, params, fetcher) {
  const r = await fetcher(`${FREEE_ACCOUNTS}/token`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...credentials(env), ...params})});
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token || !body.refresh_token) throw new Error(`freeeのトークン取得に失敗しました（${r.status}）`);
  return body;
}
async function saveTokens(env, tokens, now, companyId) {
  const {cipher, iv} = await sealTokens(env, tokens);
  const expires = now + Math.max(60, Number(tokens.expires_in) || 21600) * 1000 - 5 * 60 * 1000;
  await env.SEO_DB.prepare(`UPDATE ir_state SET token_cipher=?, token_iv=?, access_expires_at=?${companyId ? ', company_id=?' : ''} WHERE id=1`)
    .bind(...[cipher, iv, expires, ...(companyId ? [companyId] : [])]).run();
}
async function accessToken(env, state, now, fetcher) {
  if (!state?.token_cipher) throw new Error('freeeと未連携です');
  const tokens = await openTokens(env, state.token_cipher, state.token_iv);
  if (state.access_expires_at && state.access_expires_at > now) return tokens.access;
  // freee のリフレッシュトークンは1回限り。新しいトークンを保存してから使う
  const fresh = await tokenRequest(env, {grant_type: 'refresh_token', refresh_token: tokens.refresh}, fetcher);
  await saveTokens(env, fresh, now);
  return fresh.access_token;
}
async function api(path, token, fetcher) {
  const r = await fetcher(`${FREEE_API}${path}`, {headers: {Authorization: `Bearer ${token}`, 'X-Api-Version': '2020-06-15', Accept: 'application/json'}});
  if (!r.ok) throw new Error(`freee APIの呼び出しに失敗しました（${r.status} ${path.split('?')[0]}）`);
  return r.json();
}

// ---------- 同期 ----------
export async function syncIr(env, {now = Date.now(), fetcher = fetch, force = false} = {}) {
  const db = env.SEO_DB;
  await ensureIr(db);
  const got = await db.prepare('UPDATE ir_state SET lock_until=? WHERE id=1 AND COALESCE(lock_until,0) < ?').bind(now + LOCK_MS, now).run();
  if (!got?.meta?.changes) return {status: 'busy'};
  try {
    const state = await db.prepare('SELECT * FROM ir_state WHERE id=1').first();
    if (!force && state?.last_sync_at && now - state.last_sync_at < STALE_MS) return {status: 'fresh'};
    if (!state?.company_id) throw new Error('freeeの事業所が未設定です。連携し直してください');
    const token = await accessToken(env, state, now, fetcher);
    const company = await api(`/companies/${state.company_id}`, token, fetcher);
    const years = (company?.company?.fiscal_years || []).filter(y => y.start_date && y.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(-MAX_PERIODS);
    if (!years.length) throw new Error('freeeに会計期間が登録されていません');
    const until = jstMonth(now);
    const statements = [];
    for (const y of years) {
      for (const m of monthsOf(y.start_date, y.end_date, until)) {
        const pl = pickPl(await api(`/reports/trial_pl?company_id=${state.company_id}&start_date=${m.start}&end_date=${m.end}`, token, fetcher));
        statements.push(db.prepare('INSERT INTO ir_monthly (month, period_start, period_end, revenue, operating_income, synced_at) VALUES (?,?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET period_start=excluded.period_start, period_end=excluded.period_end, revenue=excluded.revenue, operating_income=excluded.operating_income, synced_at=excluded.synced_at')
          .bind(m.month, y.start_date, y.end_date, Math.round(pl.revenue), Math.round(pl.operatingIncome), now));
      }
    }
    statements.push(db.prepare('UPDATE ir_state SET last_sync_at=?, last_error=NULL WHERE id=1').bind(now));
    await db.batch(statements);
    return {status: 'synced', months: statements.length - 1};
  } catch (error) {
    await db.prepare('UPDATE ir_state SET last_error=? WHERE id=1').bind(String(error?.message || error).slice(0, 300)).run().catch(() => {});
    return {status: 'error', message: String(error?.message || error)};
  } finally {
    await db.prepare('UPDATE ir_state SET lock_until=0 WHERE id=1').run().catch(() => {});
  }
}

// ---------- 公開API ----------
function json(value, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff'}});
}
export async function handleIrPublic(request, env, ctx, {now = Date.now(), fetcher = fetch} = {}) {
  const url = new URL(request.url);
  if (url.pathname !== IR_SUMMARY_PATH) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  try {
    await ensureIr(env.SEO_DB);
    const state = await env.SEO_DB.prepare('SELECT company_id, token_cipher, last_sync_at FROM ir_state WHERE id=1').first();
    const connected = Boolean(state?.company_id && state?.token_cipher);
    if (connected && (!state.last_sync_at || now - state.last_sync_at >= STALE_MS)) {
      const job = syncIr(env, {now, fetcher});
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    }
    const {results} = await env.SEO_DB.prepare('SELECT month, period_start, period_end, revenue, operating_income FROM ir_monthly ORDER BY month').all();
    return json(buildSummary(results || [], {now, lastSyncAt: state?.last_sync_at, connected}), 200, 'public, max-age=300');
  } catch {
    return json({status: 'unavailable'}, 503);
  }
}

// ---------- 管理API（Access＋メール確認済みの要求だけがここに来る） ----------
const html = (title, body, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title><body style="font-family:sans-serif;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.8"><h1 style="font-size:20px">${title}</h1>${body}<p><a href="https://layr.co.jp/ir/">IRページを開く</a></p></body>`, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY'}});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export async function handleIrManager(request, env, path, {now = Date.now(), fetcher = fetch} = {}) {
  await ensureIr(env.SEO_DB);
  const db = env.SEO_DB;
  const route = path.slice(IR_MANAGER_PREFIX.length);
  if (request.method !== 'GET') return json({error: 'Method not allowed'}, 405);
  if (route === 'status') {
    const s = await db.prepare('SELECT company_id, token_cipher, last_sync_at, last_error FROM ir_state WHERE id=1').first();
    return json({connected: Boolean(s?.company_id && s?.token_cipher), companyId: s?.company_id || null, lastSyncAt: s?.last_sync_at || null, lastError: s?.last_error || null,
      secrets: {FREEE_CLIENT_ID: Boolean(env.FREEE_CLIENT_ID), FREEE_CLIENT_SECRET: Boolean(env.FREEE_CLIENT_SECRET), IR_TOKEN_KEY: Boolean(env.IR_TOKEN_KEY)}});
  }
  if (route === 'freee/connect') {
    let id;
    try { id = credentials(env).client_id; await tokenKey(env); } catch (e) { return html('freee連携の準備ができていません', `<p>${esc(e.message)}</p>`, 503); }
    const nonce = b64(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9]/g, '');
    await db.prepare('UPDATE ir_state SET oauth_state=?, oauth_state_expires=? WHERE id=1').bind(nonce, now + 10 * 60 * 1000).run();
    const q = new URLSearchParams({client_id: id, redirect_uri: IR_REDIRECT_URI, response_type: 'code', state: nonce, prompt: 'select_company'});
    return new Response(null, {status: 302, headers: {Location: `${FREEE_ACCOUNTS}/authorize?${q}`, 'Cache-Control': 'no-store'}});
  }
  if (route === 'freee/callback') {
    const url = new URL(request.url);
    const s = await db.prepare('SELECT oauth_state, oauth_state_expires FROM ir_state WHERE id=1').first();
    const state = url.searchParams.get('state');
    if (!state || !s?.oauth_state || state !== s.oauth_state || (s.oauth_state_expires || 0) < now) return html('連携を確認できませんでした', '<p>有効期限が切れたか、別の画面から開かれました。管理画面から連携をやり直してください。</p>', 400);
    await db.prepare('UPDATE ir_state SET oauth_state=NULL, oauth_state_expires=NULL WHERE id=1').run();
    const code = url.searchParams.get('code');
    if (!code) return html('連携がキャンセルされました', '<p>freee側で許可されませんでした。</p>', 400);
    try {
      const tokens = await tokenRequest(env, {grant_type: 'authorization_code', code, redirect_uri: IR_REDIRECT_URI}, fetcher);
      let companyId = Number(tokens.company_id) || null;
      if (!companyId) {
        const list = await api('/companies', tokens.access_token, fetcher);
        if (list?.companies?.length === 1) companyId = list.companies[0].id;
      }
      if (!companyId) return html('事業所を特定できませんでした', '<p>freeeの連携画面で株式会社LAYRの事業所を選んで、もう一度連携してください。</p>', 400);
      await saveTokens(env, tokens, now, companyId);
      const result = await syncIr(env, {now, fetcher, force: true});
      const ok = result.status === 'synced';
      return html(ok ? 'freeeと連携しました' : 'freeeとは連携しましたが、集計に失敗しました', ok ? `<p>${result.months}か月分の売上高・営業利益を取り込みました。</p>` : `<p>${esc(result.message || result.status)}</p>`, ok ? 200 : 502);
    } catch (e) { return html('freee連携に失敗しました', `<p>${esc(e.message)}</p>`, 502); }
  }
  if (route === 'sync') return json(await syncIr(env, {now, fetcher, force: true}));
  return json({error: 'Not found'}, 404);
}
