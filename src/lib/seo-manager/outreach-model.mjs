// Shared model for the backlink outreach tracker (被リンク営業管理): asking site
// operators to link to LAYR pages. Used by the Worker API and the browser app.
// The seed list came from a partner's outreach log with every personal detail
// removed; its send status is the partner's history, not LAYR's.
import {safeUrl, domainOf, monthKey} from './backlink-model.mjs';

export const OUTREACH_STATUS = Object.freeze({
  todo: '未着手',
  sent: '送信済み',
  replied: '返信あり・調整中',
  live: '掲載確認済み',
  declined: '断り・掲載不可',
  unsendable: '送信できない',
  hold: '保留',
});
export const ACTIVE_OUTREACH = Object.freeze(['sent', 'replied']);
export const CHANNELS = Object.freeze({form: '問い合わせフォーム', email: 'メール', sns: 'SNS', other: 'その他'});
export const OUTREACH_LIMITS = Object.freeze({notes: 2000, reason: 500, nextAction: 300, name: 120, genre: 60, customSites: 500, subject: 200, body: 4000});
export const TEMPLATE_VALUES = Object.freeze({'{自社名}': '株式会社LAYR', '{自社サイトURL}': 'https://layr.co.jp/', '{自社メディアURL}': 'https://layr.co.jp/media/'});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECRET = /(パスワード|ﾊﾟｽﾜｰﾄﾞ|password|passwd|\bpw\s*[:：=])/i;
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
const noSecret = (values) => { for (const value of values) if (SECRET.test(value)) fail('パスワードは保存できません。パスワード管理ツールに保管してください。'); };

/** The seed template with LAYR's public values filled in; personal fields stay as placeholders. */
export function defaultTemplate(templates) {
  const seed = templates[0] || {subject: '', body: ''};
  const fill = value => Object.entries(TEMPLATE_VALUES).reduce((result, [key, replacement]) => result.replaceAll(key, replacement), value);
  return {subject: fill(seed.subject), body: fill(seed.body)};
}
export function emptyOutreachState(templates) {
  return {revision: 0, goal: {monthlySends: 20}, template: defaultTemplate(templates), entries: {}, custom: []};
}
export function defaultOutreachEntry() {
  return {status: 'todo', sentAt: '', liveAt: '', liveUrl: '', targetUrl: '', nextAction: '', reason: '', notes: '', updatedAt: ''};
}

function validateEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('営業状況の形式を確認してください。');
  if (!Object.hasOwn(OUTREACH_STATUS, input.status)) fail('ステータスを選択してください。');
  const entry = {
    status: input.status,
    sentAt: date(input.sentAt, '送信日'),
    liveAt: date(input.liveAt, '掲載確認日'),
    liveUrl: safeUrl(input.liveUrl, '掲載URL'),
    targetUrl: safeUrl(input.targetUrl, 'リンクしてほしいページ'),
    nextAction: text(input.nextAction, OUTREACH_LIMITS.nextAction, '次のアクション'),
    reason: text(input.reason, OUTREACH_LIMITS.reason, '断り・保留の理由'),
    notes: text(input.notes, OUTREACH_LIMITS.notes, 'メモ'),
    updatedAt: typeof input.updatedAt === 'string' && Number.isFinite(Date.parse(input.updatedAt)) ? new Date(input.updatedAt).toISOString() : '',
  };
  noSecret([entry.notes, entry.nextAction, entry.reason]);
  if (['sent', 'replied', 'live'].includes(entry.status) && !entry.sentAt) fail('送信済みにするときは、送信日を入力してください。');
  if (entry.status === 'live' && !entry.liveAt) fail('掲載確認済みにするときは、掲載確認日を入力してください。');
  if (entry.status === 'declined' && !entry.reason) fail('断り・掲載不可の理由を入力してください（例：先方NG、返信なし）。');
  return entry;
}

function validateCustom(list, builtInIds) {
  if (!Array.isArray(list) || list.length > OUTREACH_LIMITS.customSites) fail('追加した営業先の件数を確認してください。');
  const ids = new Set();
  return list.map(site => {
    if (!site || typeof site !== 'object' || typeof site.id !== 'string' || !/^c[a-z0-9]{4,24}$/.test(site.id) || ids.has(site.id) || builtInIds.has(site.id)) fail('追加した営業先のIDを確認してください。');
    ids.add(site.id);
    const name = text(site.name, OUTREACH_LIMITS.name, 'サイト名'); if (!name) fail('サイト名を入力してください。');
    const url = safeUrl(site.url, 'サイトURL'); if (!url) fail('サイトURLを入力してください。');
    const channel = Object.hasOwn(CHANNELS, site.channel) ? site.channel : 'form';
    return {id: site.id, name, url, genre: text(site.genre, OUTREACH_LIMITS.genre, 'ジャンル・検索ワード'), channel, contactUrl: safeUrl(site.contactUrl, '問い合わせ先URL'), sourceStatus: '', custom: true};
  });
}

export function validateOutreachState(input, sites, {requireRevision = true} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('被リンク営業の保存データを確認できません。');
  if (requireRevision && (!Number.isSafeInteger(input.revision) || input.revision < 0)) fail('被リンク営業の保存版を確認できません。');
  const builtInIds = new Set(sites.map(site => site.id));
  const custom = validateCustom(input.custom ?? [], builtInIds);
  const known = new Set([...builtInIds, ...custom.map(site => site.id)]);
  const target = Number(input.goal?.monthlySends ?? 20);
  if (!Number.isInteger(target) || target < 1 || target > 500) fail('月間の送信目標は1〜500件で入力してください。');
  const template = {subject: text(input.template?.subject, OUTREACH_LIMITS.subject, '件名'), body: text(input.template?.body, OUTREACH_LIMITS.body, '本文')};
  if (!template.body) fail('送信文の本文を入力してください。');
  noSecret([template.subject, template.body]);
  if (!input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) fail('営業状況の一覧を確認してください。');
  const entries = {};
  for (const [id, entry] of Object.entries(input.entries)) {
    if (!known.has(id)) fail('営業先一覧にない営業状況が含まれています。');
    entries[id] = validateEntry(entry);
  }
  return {revision: requireRevision ? input.revision : 0, goal: {monthlySends: target}, template, entries, custom};
}

export const allOutreachSites = (sites, state) => [...sites, ...(state?.custom || [])];
export const outreachEntryFor = (state, id) => state?.entries?.[id] ?? defaultOutreachEntry();

export function summarizeOutreach(sites, state, now = new Date()) {
  const list = allOutreachSites(sites, state), thisMonth = monthKey(now.toISOString());
  const counts = Object.fromEntries(Object.keys(OUTREACH_STATUS).map(key => [key, 0]));
  let sentThisMonth = 0, liveThisMonth = 0;
  for (const site of list) {
    const entry = outreachEntryFor(state, site.id);
    counts[entry.status]++;
    if (entry.sentAt && monthKey(entry.sentAt) === thisMonth) sentThisMonth++;
    if (entry.status === 'live' && monthKey(entry.liveAt) === thisMonth) liveThisMonth++;
  }
  const answered = counts.replied + counts.live + counts.declined, sent = answered + counts.sent;
  return {total: list.length, counts, active: counts.sent + counts.replied, sentThisMonth, liveThisMonth, target: state?.goal?.monthlySends ?? 20, month: thisMonth,
    replyRate: sent ? answered / sent : null, genres: [...new Set(list.map(site => site.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))};
}

const statusOrder = ['replied', 'sent', 'todo', 'hold', 'live', 'declined', 'unsendable'];
export function filterOutreach(sites, state, {search = '', status = '', genre = '', channel = '', sort = 'number'} = {}) {
  const query = search.normalize('NFKC').toLowerCase().trim();
  const number = site => Number(site.id.replace(/\D/g, '')) || 0;
  return allOutreachSites(sites, state).map(site => ({site, entry: outreachEntryFor(state, site.id)})).filter(({site, entry}) => {
    const haystack = `${site.name} ${site.url} ${site.genre} ${entry.notes} ${entry.nextAction}`.normalize('NFKC').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (status === 'active' ? !ACTIVE_OUTREACH.includes(entry.status) : status && entry.status !== status) return false;
    if (genre && site.genre !== genre) return false;
    if (channel && site.channel !== channel) return false;
    return true;
  }).sort((a, b) => {
    if (sort === 'status') return statusOrder.indexOf(a.entry.status) - statusOrder.indexOf(b.entry.status) || number(a.site) - number(b.site);
    if (sort === 'updated') return (b.entry.updatedAt || '').localeCompare(a.entry.updatedAt || '') || number(a.site) - number(b.site);
    return a.site.custom === b.site.custom ? number(a.site) - number(b.site) : a.site.custom ? 1 : -1;
  });
}

export function duplicateOutreach(sites, state, url) {
  const domain = domainOf(url);
  return domain ? allOutreachSites(sites, state).find(site => domainOf(site.url) === domain) || null : null;
}
