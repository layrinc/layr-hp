// IR（経営状況）ページ用：freee会計の売上高・営業利益を月次で集計し、万円単位で公開する。
// 事業全体＝株式会社LAYR と 代表の個人事業 の2事業所を、月ごとに合算して暦年で表示する（2026-09-26 河出さん決定）。
// - 公開API  GET /api/ir/summary        … 保存済みの集計を返す。3時間より古ければ裏でfreeeから取り直す
// - 管理API  /api/seo/ir/*（seo.layr.co.jp・Access＋河出さんのメールのみ）… freee連携の承認・手動更新・状態確認
// 公開するのは月ごとの売上高・営業利益（万円単位・事業所の合算）だけ。取引明細・取引先・事業所別・円単位の金額・トークンは出さない。

export const IR_SUMMARY_PATH = '/api/ir/summary';
export const IR_MANAGER_PREFIX = '/api/seo/ir/';
const FREEE_ACCOUNTS = 'https://accounts.secure.freee.co.jp/public_api';
const FREEE_API = 'https://api.freee.co.jp/api/1';
export const IR_REDIRECT_URI = 'https://seo.layr.co.jp/api/seo/ir/freee/callback';
export const STALE_MS = 3 * 60 * 60 * 1000;
const LOCK_MS = 90 * 1000;
const MAX_YEARS = 3;      // 公開する暦年の数
const REFRESH_MONTHS = 3;  // 毎回取り直す直近の月数（それより前は未取得の月だけ取る）
const FETCH_BUDGET = 30;   // 1回の同期で呼ぶ試算表の上限（Workers のサブリクエスト上限対策。残りは次の同期で取る）

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ir_state (id INTEGER PRIMARY KEY CHECK (id = 1), company_id INTEGER, token_cipher TEXT, token_iv TEXT, access_expires_at INTEGER, lock_until INTEGER, last_sync_at INTEGER, last_error TEXT, oauth_state TEXT, oauth_state_expires INTEGER)`,
  `INSERT OR IGNORE INTO ir_state (id) VALUES (1)`,
  // 連携している freee 事業所（個人事業・株式会社LAYR）。トークンは事業所ごとに持つ
  `CREATE TABLE IF NOT EXISTS ir_links (company_id INTEGER PRIMARY KEY, display_name TEXT, token_cipher TEXT NOT NULL, token_iv TEXT NOT NULL, access_expires_at INTEGER, linked_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ir_company_monthly (company_id INTEGER NOT NULL, month TEXT NOT NULL, revenue INTEGER NOT NULL, operating_income INTEGER NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY (company_id, month))`,
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
const REVENUE_NAMES = ['売上高', '売上（収入）金額', '売上(収入)金額'];
export function pickPl(json) {
  const balances = json?.trial_pl?.balances;
  if (!Array.isArray(balances)) throw new Error('試算表の形式を読み取れませんでした');
  if (!balances.length) return {revenue: 0, operatingIncome: 0};
  const find = name => balances.find(b => b.account_category_name === name && b.total_line) || balances.find(b => b.account_category_name === name && !b.account_item_name);
  const diff = row => (Number(row.closing_balance) || 0) - (Number(row.opening_balance) || 0);
  const revenueRow = REVENUE_NAMES.map(find).find(Boolean);
  // 法人は「営業損益金額」。個人事業の決算書様式には無いので、売上 − 売上原価 − 経費 で同じ意味の数字を作る
  const incomeRow = find('営業損益金額');
  const costRow = find('売上原価'), expenseRow = find('経費');
  if (!revenueRow || (!incomeRow && !expenseRow)) {
    const names = [...new Set(balances.filter(b => !b.account_item_name).map(b => b.account_category_name).filter(Boolean))].slice(0, 12);
    throw new Error(`試算表に売上・利益の区分が見つかりません（区分：${names.join('、') || 'なし'}）`);
  }
  const revenue = diff(revenueRow);
  return {revenue, operatingIncome: incomeRow ? diff(incomeRow) : revenue - (costRow ? diff(costRow) : 0) - diff(expenseRow)};
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

// 保存行（月×事業所を合算済み）→ 公開用の形（万円単位）。暦年ごとに月次と累計。当月は速報
export function buildSummary(rows, {now, lastSyncAt, connected}) {
  if (!connected) return {status: 'not_connected'};
  const current = jstMonth(now);
  const years = new Map();
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    const year = r.month.slice(0, 4);
    if (!years.has(year)) years.set(year, {months: [], yen: {revenue: 0, operatingIncome: 0}});
    const y = years.get(year);
    y.months.push({month: r.month, revenue: toMan(r.revenue), operatingIncome: toMan(r.operating_income), provisional: r.month >= current});
    y.yen.revenue += Number(r.revenue) || 0; y.yen.operatingIncome += Number(r.operating_income) || 0;
  }
  const list = [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-MAX_YEARS);
  return {
    status: list.length ? 'ok' : 'empty',
    unit: '万円',
    scope: 'combined',
    currentMonth: current,
    lastSyncAt: lastSyncAt || null,
    periods: list.map(([year, y]) => ({
      label: `${year}年`,
      start: `${year}-01-01`, end: `${year}-12-31`,
      months: y.months,
      total: {revenue: toMan(y.yen.revenue), operatingIncome: toMan(y.yen.operatingIncome)},
      inProgress: year === current.slice(0, 4),
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
async function saveLink(env, companyId, tokens, now, displayName) {
  const {cipher, iv} = await sealTokens(env, tokens);
  const expires = now + Math.max(60, Number(tokens.expires_in) || 21600) * 1000 - 5 * 60 * 1000;
  await env.SEO_DB.prepare('INSERT INTO ir_links (company_id, display_name, token_cipher, token_iv, access_expires_at, linked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET display_name=COALESCE(excluded.display_name, ir_links.display_name), token_cipher=excluded.token_cipher, token_iv=excluded.token_iv, access_expires_at=excluded.access_expires_at')
    .bind(companyId, displayName ?? null, cipher, iv, expires, now).run();
}
async function accessToken(env, link, now, fetcher) {
  const tokens = await openTokens(env, link.token_cipher, link.token_iv);
  if (link.access_expires_at && link.access_expires_at > now) return tokens.access;
  // freee のリフレッシュトークンは1回限り。新しいトークンを保存してから使う
  const fresh = await tokenRequest(env, {grant_type: 'refresh_token', refresh_token: tokens.refresh}, fetcher);
  await saveLink(env, link.company_id, fresh, now);
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
  const errors = [];
  let months = 0, remaining = 0;
  try {
    const state = await db.prepare('SELECT last_sync_at FROM ir_state WHERE id=1').first();
    if (!force && state?.last_sync_at && now - state.last_sync_at < STALE_MS) return {status: 'fresh'};
    const {results: links = []} = await db.prepare('SELECT * FROM ir_links ORDER BY company_id').all();
    if (!links.length) throw new Error('freeeの事業所が連携されていません');
    const until = jstMonth(now);
    const firstYear = String(Number(until.slice(0, 4)) - (MAX_YEARS - 1));
    const recent = monthsBack(until, REFRESH_MONTHS);
    const perCompany = Math.max(REFRESH_MONTHS, Math.floor(FETCH_BUDGET / links.length));
    for (const link of links) {
      try {
        const token = await accessToken(env, link, now, fetcher);
        const company = await api(`/companies/${link.company_id}`, token, fetcher);
        const name = company?.company?.display_name || company?.company?.name;
        if (name && name !== link.display_name) await db.prepare('UPDATE ir_links SET display_name=? WHERE company_id=?').bind(name, link.company_id).run();
        const {results: have = []} = await db.prepare('SELECT month FROM ir_company_monthly WHERE company_id=?').bind(link.company_id).all();
        const known = new Set(have.map(r => r.month));
        const years = (company?.company?.fiscal_years || []).filter(y => y.start_date && y.end_date && y.end_date >= `${firstYear}-01-01`);
        const todo = years.flatMap(y => monthsOf(y.start_date, y.end_date, until))
          .filter(m => m.month >= `${firstYear}-01` && (!known.has(m.month) || recent.has(m.month)))
          .sort((a, b) => b.month.localeCompare(a.month));
        const statements = [];
        for (const m of todo.slice(0, perCompany)) {
          const pl = pickPl(await api(`/reports/trial_pl?company_id=${link.company_id}&start_date=${m.start}&end_date=${m.end}`, token, fetcher));
          statements.push(db.prepare('INSERT INTO ir_company_monthly (company_id, month, revenue, operating_income, synced_at) VALUES (?,?,?,?,?) ON CONFLICT(company_id, month) DO UPDATE SET revenue=excluded.revenue, operating_income=excluded.operating_income, synced_at=excluded.synced_at')
            .bind(link.company_id, m.month, Math.round(pl.revenue), Math.round(pl.operatingIncome), now));
        }
        remaining += Math.max(0, todo.length - perCompany);
        if (statements.length) await db.batch(statements);
        months += statements.length;
      } catch (error) { errors.push(`${link.display_name || link.company_id}: ${String(error?.message || error)}`); }
    }
    if (errors.length === links.length) throw new Error(errors.join(' / '));
    await db.prepare('UPDATE ir_state SET last_sync_at=?, last_error=? WHERE id=1').bind(remaining ? null : now, errors.length ? errors.join(' / ').slice(0, 300) : null).run();
    return {status: errors.length ? 'partial' : 'synced', months, remaining, errors};
  } catch (error) {
    await db.prepare('UPDATE ir_state SET last_error=? WHERE id=1').bind(String(error?.message || error).slice(0, 300)).run().catch(() => {});
    return {status: 'error', message: String(error?.message || error)};
  } finally {
    await db.prepare('UPDATE ir_state SET lock_until=0 WHERE id=1').run().catch(() => {});
  }
}

// until（YYYY-MM）を含む直近 n か月
export function monthsBack(until, n) {
  const out = new Set();
  let y = Number(until.slice(0, 4)), m = Number(until.slice(5));
  for (let i = 0; i < n; i++) { out.add(`${y}-${pad(m)}`); m -= 1; if (!m) { m = 12; y -= 1; } }
  return out;
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
    const state = await env.SEO_DB.prepare('SELECT last_sync_at FROM ir_state WHERE id=1').first();
    const linked = await env.SEO_DB.prepare('SELECT COUNT(*) AS n FROM ir_links').first();
    const connected = Number(linked?.n) > 0;
    if (connected && (!state.last_sync_at || now - state.last_sync_at >= STALE_MS)) {
      const job = syncIr(env, {now, fetcher});
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    }
    const {results} = await env.SEO_DB.prepare('SELECT month, SUM(revenue) AS revenue, SUM(operating_income) AS operating_income FROM ir_company_monthly GROUP BY month ORDER BY month').all();
    // 最終更新は、実際に freee から数字を取った時刻（ir_state.last_sync_at は次の同期の目安で、取り残しがある間は空にする）
    const fetched = await env.SEO_DB.prepare('SELECT MAX(synced_at) AS t FROM ir_company_monthly').first();
    return json(buildSummary(results || [], {now, lastSyncAt: fetched?.t, connected}), 200, 'public, max-age=300');
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
    const s = await db.prepare('SELECT last_sync_at, last_error FROM ir_state WHERE id=1').first();
    const {results: links = []} = await db.prepare('SELECT company_id, display_name, linked_at FROM ir_links ORDER BY company_id').all();
    return json({connected: links.length > 0, companies: links.map(l => ({id: l.company_id, name: l.display_name, linkedAt: l.linked_at})), lastSyncAt: s?.last_sync_at || null, lastError: s?.last_error || null,
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
      if (!companyId) return html('事業所を特定できませんでした', '<p>freeeの連携画面で、個人事業または株式会社LAYRの事業所を1つ選んで、もう一度連携してください。</p>', 400);
      await saveLink(env, companyId, tokens, now);
      const result = await syncIr(env, {now, fetcher, force: true});
      const ok = result.status === 'synced';
      // 河出さんが freee の画面と見比べられるよう、事業所ごとの年合計を出す（この画面は Access の内側だけ）
      const {results: links = []} = await db.prepare('SELECT company_id, display_name FROM ir_links ORDER BY company_id').all();
      const {results: years = []} = await db.prepare('SELECT company_id, substr(month, 1, 4) AS y, SUM(revenue) AS r, SUM(operating_income) AS o FROM ir_company_monthly GROUP BY company_id, y ORDER BY y').all();
      const names = links.map(l => `<li>${esc(l.display_name || '（名称取得中）')}：${years.filter(y => y.company_id === l.company_id).map(y => `${esc(y.y)}年 売上高${toMan(y.r)}万円・営業利益${toMan(y.o)}万円`).join('／') || 'まだ数字がありません'}</li>`).join('');
      const next = '<p>個人事業と株式会社LAYRの両方をつなぐ場合は、<a href="/api/seo/ir/freee/connect">もう一方の事業所も連携</a>してください。</p>';
      return html(ok ? 'freeeと連携しました' : 'freeeとは連携しましたが、集計に失敗しました', `${ok ? `<p>${result.months}か月分の売上高・営業利益を取り込みました。${result.remaining ? `残りの${result.remaining}か月分は、IRページが開かれるたびに続けて取り込みます。` : ''}</p>` : `<p>${esc(result.message || (result.errors || []).join(' / ') || result.status)}</p>`}<p>連携中の事業所：</p><ul>${names}</ul>${next}`, ok ? 200 : 502);
    } catch (e) { return html('freee連携に失敗しました', `<p>${esc(e.message)}</p>`, 502); }
  }
  if (route === 'sync') return json(await syncIr(env, {now, fetcher, force: true}));
  if (route === 'freee/disconnect') {
    const id = Number(new URL(request.url).searchParams.get('company'));
    if (!Number.isSafeInteger(id) || id <= 0) return json({error: 'company を指定してください'}, 400);
    await db.batch([db.prepare('DELETE FROM ir_links WHERE company_id=?').bind(id), db.prepare('DELETE FROM ir_company_monthly WHERE company_id=?').bind(id)]);
    return json({status: 'disconnected', company: id});
  }
  return json({error: 'Not found'}, 404);
}
