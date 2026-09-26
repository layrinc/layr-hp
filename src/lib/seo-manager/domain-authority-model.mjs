// Domain authority ("ドメインパワー") of layr.co.jp. Each source uses its own
// scale, so values are never mixed or converted between sources.
export const DOMAIN = 'layr.co.jp';
export const AUTHORITY_SOURCES = Object.freeze({
  ahrefs_dr: {label: 'Ahrefs DR', max: 100, how: 'Ahrefsの無料チェッカーで確認して入力', url: 'https://ahrefs.com/ja/website-authority-checker'},
  moz_da: {label: 'Moz DA', max: 100, how: 'MozのDomain Analysisで確認して入力', url: 'https://moz.com/domain-analysis'},
  open_pagerank: {label: 'Open PageRank', max: 10, how: 'APIキーを登録すると毎週自動で取得', url: 'https://openpagerank.keywordseverywhere.com/'},
});
export const AUTHORITY_LIMIT = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = message => { throw new Error(message); };

export function validateMeasurement(input, {automatic = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('記録の形式を確認してください。');
  const source = AUTHORITY_SOURCES[input.source];
  if (!source || (input.source === 'open_pagerank' && !automatic)) fail('指標を選択してください（Open PageRankは自動取得のみ）。');
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0 || value > source.max) fail(`${source.label}は0〜${source.max}の数値で入力してください。`);
  const measuredAt = typeof input.measuredAt === 'string' ? input.measuredAt.trim() : '';
  if (!DATE.test(measuredAt) || !Number.isFinite(Date.parse(`${measuredAt}T00:00:00Z`))) fail('測定日はYYYY-MM-DD形式で入力してください。');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  const measurement = {source: input.source, value: Math.round(value * 100) / 100, measuredAt, note, automatic: automatic === true};
  if (Number.isSafeInteger(input.referringDomains) && input.referringDomains >= 0) measurement.referringDomains = input.referringDomains;
  return measurement;
}

export function normalizeAuthority(input) {
  const history = Array.isArray(input?.history) ? input.history.flatMap(row => {
    try { return [validateMeasurement(row, {automatic: row?.automatic === true})]; } catch { return []; }
  }) : [];
  history.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const status = ['ok', 'error', 'not_configured'].includes(input?.automation?.status) ? input.automation.status : 'not_configured';
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const code = typeof input?.automation?.code === 'string' && /^[a-z_]{1,40}$/.test(input.automation.code) ? input.automation.code : null;
  return {history: history.slice(-AUTHORITY_LIMIT), automation: {status, lastAttemptAt: time(input?.automation?.lastAttemptAt), lastSuccessAt: time(input?.automation?.lastSuccessAt), code}};
}

/** Latest and previous value per source; change is only computed within one source. */
export function summarizeAuthority(state) {
  return Object.keys(AUTHORITY_SOURCES).map(source => {
    const rows = state.history.filter(row => row.source === source);
    const latest = rows.at(-1) || null, previous = rows.at(-2) || null;
    return {source, latest, previous, change: latest && previous ? Math.round((latest.value - previous.value) * 100) / 100 : null};
  });
}
