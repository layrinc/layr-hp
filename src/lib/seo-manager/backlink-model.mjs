// Shared model for the backlink application tracker (被リンク申請管理).
// Used by the Worker API (validation before saving to D1) and by the browser app.

export const BACKLINK_STATUS = Object.freeze({
  todo: '未着手',
  checking: '条件確認中',
  applied: '申請済み',
  contact: '先方とやりとり中',
  live: '掲載確認済み',
  hold: '保留',
  rejected: 'NG・掲載不可',
});
export const ACTIVE_STATUSES = Object.freeze(['checking', 'applied', 'contact']);

export const PROFILE_FIELDS = Object.freeze([
  {key: 'companyName', label: '会社・団体名', max: 100},
  {key: 'companyKana', label: '会社名（フリガナ）', max: 100},
  {key: 'corporateNumber', label: '法人番号', max: 13},
  {key: 'representative', label: '代表者名', max: 60},
  {key: 'representativeKana', label: '代表者名（フリガナ）', max: 60},
  {key: 'applicant', label: '担当・申請者名', max: 60},
  {key: 'applicantRole', label: '担当者の役職・部署', max: 60},
  {key: 'postalCode', label: '郵便番号', max: 10},
  {key: 'address', label: '住所', max: 200},
  {key: 'phone', label: '電話番号', max: 20},
  {key: 'email', label: '申請用メールアドレス', max: 200},
  {key: 'siteUrl', label: 'コーポレートサイトURL', max: 300},
  {key: 'targetUrl', label: 'リンクしてほしいURL', max: 300},
  {key: 'established', label: '設立', max: 40},
  {key: 'capital', label: '資本金', max: 40},
  {key: 'employees', label: '従業員数', max: 40},
  {key: 'business', label: '事業内容', max: 1000, multiline: true},
  {key: 'introduction', label: '紹介文（申請フォーム用）', max: 2000, multiline: true},
]);

export const LIMITS = Object.freeze({notes: 2000, reason: 500, nextAction: 300, account: 200, url: 600, name: 120, customSites: 300});
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Passwords must never be stored in the shared workspace.
const SECRET = /(パスワード|ﾊﾟｽﾜｰﾄﾞ|password|passwd|\bpw\s*[:：=])/i;

export function defaultProfile(company = {}, settings = {}) {
  const blank = Object.fromEntries(PROFILE_FIELDS.map(field => [field.key, '']));
  return {
    ...blank,
    companyName: company.name || '',
    corporateNumber: company.corporate_number || '',
    representative: company.representative || '',
    address: company.address || '',
    established: company.founded || '',
    business: Array.isArray(company.business) ? company.business.join('／') : '',
    email: settings.email || '',
    siteUrl: 'https://layr.co.jp/',
    targetUrl: 'https://layr.co.jp/',
  };
}

export function emptyState(profile) {
  return {revision: 0, goal: {monthlyTarget: 5}, profile: {...profile}, entries: {}, custom: []};
}

export function defaultEntry() {
  return {status: 'todo', appliedAt: '', liveAt: '', liveUrl: '', account: '', reason: '', nextAction: '', notes: '', updatedAt: ''};
}

const fail = message => { throw new Error(message); };
const text = (value, max, label) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`${label}の長さを確認してください（${max}文字以内）。`);
  return value.trim();
};
const date = (value, label) => {
  const result = text(value, 10, label);
  if (result && (!DATE.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)))) fail(`${label}はYYYY-MM-DD形式で入力してください。`);
  return result;
};
export function safeUrl(value, label = 'URL') {
  const result = text(value, LIMITS.url, label);
  if (!result) return '';
  let url;
  try { url = new URL(result); } catch { fail(`${label}はhttp(s)から始まるURLを入力してください。`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(`${label}はhttp(s)から始まるURLを入力してください。`);
  return url.href;
}
export function domainOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function validateEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('申請状況の形式を確認してください。');
  if (!Object.hasOwn(BACKLINK_STATUS, input.status)) fail('ステータスを選択してください。');
  const entry = {
    status: input.status,
    appliedAt: date(input.appliedAt, '申請日'),
    liveAt: date(input.liveAt, '掲載確認日'),
    liveUrl: safeUrl(input.liveUrl, '掲載URL'),
    account: text(input.account, LIMITS.account, '登録ID・ログイン用メール'),
    reason: text(input.reason, LIMITS.reason, 'NG・保留の理由'),
    nextAction: text(input.nextAction, LIMITS.nextAction, '次のアクション'),
    notes: text(input.notes, LIMITS.notes, 'メモ'),
    updatedAt: typeof input.updatedAt === 'string' && Number.isFinite(Date.parse(input.updatedAt)) ? new Date(input.updatedAt).toISOString() : '',
  };
  for (const key of ['account', 'notes', 'nextAction', 'reason']) if (SECRET.test(entry[key])) fail('パスワードは保存できません。パスワード管理ツールに保管し、ここには保管場所だけを書いてください。');
  if (entry.status === 'live' && !entry.liveAt) fail('掲載確認済みにするときは、掲載確認日を入力してください。');
  if (entry.status === 'rejected' && !entry.reason) fail('NG・掲載不可の理由を入力してください（例：先方NG、条件に合わない）。');
  return entry;
}

function validateCustom(list, builtInIds) {
  if (!Array.isArray(list) || list.length > LIMITS.customSites) fail('追加した申請先の件数を確認してください。');
  const ids = new Set();
  return list.map(site => {
    if (!site || typeof site !== 'object' || typeof site.id !== 'string' || !/^c[a-z0-9]{4,24}$/.test(site.id) || ids.has(site.id) || builtInIds.has(site.id)) fail('追加した申請先のIDを確認してください。');
    ids.add(site.id);
    const name = text(site.name, LIMITS.name, 'サイト名'); if (!name) fail('サイト名を入力してください。');
    const url = safeUrl(site.url, 'サイトURL'); if (!url) fail('サイトURLを入力してください。');
    return {id: site.id, name, url, formUrl: safeUrl(site.formUrl, '登録フォームURL'), follow: text(site.follow, 20, 'follow形態'), cost: text(site.cost, 20, '費用区分'), eligible: text(site.eligible, 60, '登録できる対象'), condition: text(site.condition, 200, '登録条件'), method: text(site.method, 60, '登録方法'), recommend: '', custom: true};
  });
}

export function validateBacklinkState(input, sites, {requireRevision = true} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('被リンク申請の保存データを確認できません。');
  if (requireRevision && (!Number.isSafeInteger(input.revision) || input.revision < 0)) fail('被リンク申請の保存版を確認できません。');
  const builtInIds = new Set(sites.map(site => site.id));
  const custom = validateCustom(input.custom ?? [], builtInIds);
  const known = new Set([...builtInIds, ...custom.map(site => site.id)]);
  const target = Number(input.goal?.monthlyTarget ?? 5);
  if (!Number.isInteger(target) || target < 1 || target > 50) fail('月間の獲得目標は1〜50件で入力してください。');
  if (!input.profile || typeof input.profile !== 'object' || Array.isArray(input.profile)) fail('申請者情報を確認してください。');
  const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field.key, text(input.profile[field.key], field.max, field.label)]));
  for (const key of ['siteUrl', 'targetUrl']) profile[key] = safeUrl(profile[key], PROFILE_FIELDS.find(field => field.key === key).label);
  if (!input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) fail('申請状況の一覧を確認してください。');
  const entries = {};
  for (const [id, entry] of Object.entries(input.entries)) {
    if (!known.has(id)) fail('申請先一覧にない申請状況が含まれています。');
    entries[id] = validateEntry(entry);
  }
  return {revision: requireRevision ? input.revision : 0, goal: {monthlyTarget: target}, profile, entries, custom};
}

export function allSites(sites, state) {
  return [...sites, ...(state?.custom || [])];
}
export function entryFor(state, id) {
  return state?.entries?.[id] ?? defaultEntry();
}
export const isRecommended = site => Boolean(site.recommend) && !site.recommend.startsWith('調査');

export function eligibilityGroup(site) {
  const value = site.eligible || '';
  if (!value) return 'unknown';
  if (/個人/.test(value)) return 'anyone';
  return 'company';
}

// Returns the month key (YYYY-MM) in Japan time.
export function monthKey(value) {
  if (!value) return '';
  if (DATE.test(value)) return value.slice(0, 7);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

export function summarize(sites, state, now = new Date()) {
  const list = allSites(sites, state);
  const counts = Object.fromEntries(Object.keys(BACKLINK_STATUS).map(key => [key, 0]));
  const thisMonth = monthKey(now.toISOString());
  let liveThisMonth = 0, appliedThisMonth = 0;
  const months = new Map();
  for (const site of list) {
    const entry = entryFor(state, site.id);
    counts[entry.status]++;
    if (entry.status === 'live' && entry.liveAt) {
      const key = monthKey(entry.liveAt);
      months.set(key, (months.get(key) || 0) + 1);
      if (key === thisMonth) liveThisMonth++;
    }
    if (entry.appliedAt && monthKey(entry.appliedAt) === thisMonth) appliedThisMonth++;
  }
  return {
    total: list.length,
    counts,
    active: ACTIVE_STATUSES.reduce((sum, key) => sum + counts[key], 0),
    liveThisMonth,
    appliedThisMonth,
    target: state?.goal?.monthlyTarget ?? 5,
    month: thisMonth,
    liveByMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({month, count})),
  };
}

const statusOrder = ['contact', 'applied', 'checking', 'todo', 'hold', 'live', 'rejected'];
export function filterSites(sites, state, {search = '', status = '', recommend = '', cost = '', eligible = '', sort = 'priority'} = {}) {
  const query = search.normalize('NFKC').toLowerCase().trim();
  const rows = allSites(sites, state).map(site => ({site, entry: entryFor(state, site.id)})).filter(({site, entry}) => {
    const haystack = `${site.name} ${site.url} ${site.condition} ${site.method} ${entry.notes} ${entry.nextAction}`.normalize('NFKC').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (status === 'active' ? !ACTIVE_STATUSES.includes(entry.status) : status && entry.status !== status) return false;
    if (recommend === 'yes' && !isRecommended(site)) return false;
    if (cost && (cost === 'unknown' ? site.cost && site.cost !== '調査中' : site.cost !== cost)) return false;
    if (eligible && eligibilityGroup(site) !== eligible) return false;
    return true;
  });
  const number = site => Number(site.id.replace(/\D/g, '')) || 0;
  return rows.sort((a, b) => {
    if (sort === 'status') return statusOrder.indexOf(a.entry.status) - statusOrder.indexOf(b.entry.status) || number(a.site) - number(b.site);
    if (sort === 'updated') return (b.entry.updatedAt || '').localeCompare(a.entry.updatedAt || '') || number(a.site) - number(b.site);
    if (sort === 'priority') {
      const rank = row => (isRecommended(row.site) ? 0 : 2) + (row.site.cost === '無料' ? 0 : 1);
      return rank(a) - rank(b) || (a.site.recommend || '').localeCompare(b.site.recommend || '') || number(a.site) - number(b.site);
    }
    return a.site.custom === b.site.custom ? number(a.site) - number(b.site) : a.site.custom ? 1 : -1;
  });
}

export function duplicateOf(sites, state, url) {
  const domain = domainOf(url);
  return domain ? allSites(sites, state).find(site => domainOf(site.url) === domain) || null : null;
}
