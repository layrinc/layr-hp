// Pure reporting model shared by the authenticated API and manager UI.
const ORIGIN = 'https://layr.co.jp';
const DAY = 86400000;
const METRICS = ['views', 'users', 'sessions', 'organicSessions', 'inquiries', 'documentRequests', 'ctaClicks', 'clicks', 'impressions', 'ctr', 'position'];
export const LEAD_STAGES = ['inquiry', 'qualified', 'meeting', 'won', 'lost'];
const blank = () => Object.fromEntries(METRICS.map(key => [key, null]));
const values = input => Array.isArray(input) ? input.map(entry => entry && typeof entry === 'object' && Object.hasOwn(entry, 'value') ? entry.value : entry).filter(Boolean) : [];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const pathOf = value => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value, ORIGIN); return url.origin === ORIGIN && /^\/service\/ltori(?:\/|$)/.test(url.pathname) ? `${url.pathname.replace(/\/+$/, '')}/` : null; } catch { return null; }
};
const cleanMetrics = row => Object.fromEntries(METRICS.map(key => [key, finite(row?.[key])]));

/** Current pipeline stages, not a cumulative funnel: a won lead is not added to
 * every preceding stage. Money is explicitly entered, never an assumed LTV.
 */
export function aggregateLeadStages(input = []) {
  const records = new Map();
  for (const lead of values(input)) {
    if (typeof lead.id !== 'string' || !LEAD_STAGES.includes(lead.stage)) continue;
    const previous = records.get(lead.id);
    if (!previous || String(lead.updatedAt || lead.createdAt || '') >= String(previous.updatedAt || previous.createdAt || '')) records.set(lead.id, lead);
  }
  const stages = Object.fromEntries(LEAD_STAGES.map(stage => [stage, 0]));
  let revenueYen = 0, grossProfitYen = 0, revenueComplete = true, grossProfitComplete = true;
  for (const lead of records.values()) {
    stages[lead.stage]++;
    if (lead.stage !== 'won') continue;
    const revenue = finite(lead.revenueYen), profit = finite(lead.grossProfitYen);
    if (revenue === null) revenueComplete = false; else revenueYen += revenue;
    if (profit === null) grossProfitComplete = false; else grossProfitYen += profit;
  }
  return {total: records.size, stages, revenueYen: revenueComplete ? revenueYen : null, grossProfitYen: grossProfitComplete ? grossProfitYen : null, recordedRevenueYen: revenueYen, recordedGrossProfitYen: grossProfitYen, revenueComplete, grossProfitComplete};
}

export function metricChange(current, previous) {
  if (finite(current) === null || finite(previous) === null) return {difference: null, percent: null};
  return {difference: current - previous, percent: previous > 0 ? (current - previous) / previous * 100 : null};
}

export function classifySearchIntent(query) {
  const value = String(query || '').normalize('NFKC');
  // This is an editorial triage suggestion; ambiguous phrases need a human.
  if (/(採用担当|応募者|内定辞退|採用.*(?:代行|支援|運用|構築|費用|外注)|面接.*(?:辞退|無断欠席).*対策)/.test(value)) return 'employer';
  if (/(求人.*(?:探|応募)|仕事.*探|転職先|バイト.*募集|履歴書.*書き方|志望動機.*例文|面接.*服装)/.test(value)) return 'job_seeker';
  return 'review';
}

function mergeMetrics(ga, search) {
  return {...cleanMetrics(ga), ...Object.fromEntries(['clicks', 'impressions', 'ctr', 'position'].map(key => [key, finite(search?.[key])]))};
}

function safeSnapshot(input, source, period) {
  return input.filter(snapshot => snapshot?.source === source && snapshot.period === period).sort((a, b) => String(b.fetchedAt || '').localeCompare(String(a.fetchedAt || '')))[0] || null;
}

export function buildGrowthReport({snapshots = [], integrations = [], inspections = [], leads = [], pages = [], now = new Date()} = {}) {
  const time = new Date(now);
  if (!Number.isFinite(time.getTime())) throw new Error('INVALID_DATE');
  const snapshotValues = values(snapshots), leadValues = values(leads);
  const current = {ga4: safeSnapshot(snapshotValues, 'ga4', 'current'), gsc: safeSnapshot(snapshotValues, 'gsc', 'current')};
  const previous = {ga4: safeSnapshot(snapshotValues, 'ga4', 'previous'), gsc: safeSnapshot(snapshotValues, 'gsc', 'previous')};
  // A failure between two DB writes must not silently compare different runs.
  for (const source of ['ga4', 'gsc']) if (previous[source]?.fetchedAt !== current[source]?.fetchedAt) previous[source] = null;
  const integrationValues = values(integrations);
  const sources = ['ga4', 'gsc', 'inspection'].map(source => {
    const record = integrationValues.find(item => item.source === source);
    return record ? {source, status: record.status, lastAttemptAt: record.lastAttemptAt ?? null, lastSuccessAt: record.lastSuccessAt ?? null, message: record.message ?? null} : {source, status: 'not_configured', lastAttemptAt: null, lastSuccessAt: null, message: 'まだ取得していません。'};
  });
  const inspectionMap = new Map(values(inspections).filter(item => pathOf(item.path)).map(item => [pathOf(item.path), item]));
  const catalog = new Map(values(pages).filter(page => pathOf(page.path)).map(page => [pathOf(page.path), page]));
  for (const snapshot of snapshotValues) for (const page of snapshot.pages || []) {
    const path = pathOf(page.path);
    if (path && !catalog.has(path)) catalog.set(path, {path, title: path});
  }
  for (const lead of leadValues) {const path = pathOf(lead.sourcePath); if (path && !catalog.has(path)) catalog.set(path, {path, title: path});}
  const maps = {};
  for (const [windowName, window] of Object.entries({current, previous})) {
    maps[windowName] = {};
    for (const source of ['ga4', 'gsc']) maps[windowName][source] = new Map((window[source]?.pages || []).map(page => [pathOf(page.path), page]));
  }
  const rows = [...catalog].map(([path, page]) => {
    const funnel = aggregateLeadStages(leadValues.filter(lead => pathOf(lead.sourcePath) === path));
    return {path, title: page.title || page.name || path, publication: page.publication || page.status || 'unknown', publishedAt: page.publishedAt ?? null,
      ...mergeMetrics(maps.current.ga4.get(path), maps.current.gsc.get(path)), previous: mergeMetrics(maps.previous.ga4.get(path), maps.previous.gsc.get(path)),
      leadStages: funnel.stages, registeredLeads: funnel.total, revenueYen: funnel.revenueYen, grossProfitYen: funnel.grossProfitYen, inspection: inspectionMap.get(path) || null};
  });
  const actions = [];
  const add = (type, priority, path, title, reason, nextStep) => actions.push({id: `${type}:${path || 'workspace'}`, type, priority, path: path || null, title, reason, nextStep});
  for (const source of sources) {
    if (source.status === 'error') add(`sync_error_${source.source}`, 1, null, `${source.source.toUpperCase()}の同期を確認`, source.message || '前回の同期に失敗しています。', '連携設定・閲覧権限を確認し、同期を再実行してください。');
    else if (source.status === 'not_configured' && source.source !== 'inspection') add(`setup_${source.source}`, 1, null, `${source.source.toUpperCase()}を接続`, '実測データがまだありません。', 'Googleサービスアカウントと対象プロパティを設定してください。');
    else if (source.lastSuccessAt && time - new Date(source.lastSuccessAt) > 3 * DAY) add(`stale_${source.source}`, 1, null, `${source.source.toUpperCase()}の取得が停止`, '最後の成功から3日以上経過しています。', '定期同期の実行履歴と権限を確認してください。');
  }
  for (const row of rows) {
    const inspection = row.inspection;
    if (inspection?.status === 'ok' && inspection.verdict && inspection.verdict !== 'PASS' && inspection.verdict !== 'VERDICT_UNSPECIFIED') add('index_review', 1, row.path, 'インデックス状況を確認', inspection.coverageState || 'URL検査で正常な登録を確認できていません。', 'noindex・canonical・HTTP応答・本文の有用性・内部リンクを確認してください。検査はインデックス登録を保証しません。');
    else if (inspection?.status === 'ok' && inspection.googleCanonical && pathOf(inspection.googleCanonical) !== row.path) add('canonical_review', 1, row.path, 'Googleが選んだ正規URLを確認', '指定したページとGoogleの正規URLが異なります。', '類似ページとの役割分担とcanonicalを確認してください。自動的には統合しません。');
    if (row.impressions !== null && row.impressions >= 100 && row.ctr !== null && row.ctr < 0.01 && row.position !== null && row.position <= 20) add('ctr_review', 2, row.path, '検索結果の見出しを見直す', `直近期間は${row.impressions}回表示、CTR ${(row.ctr * 100).toFixed(1)}％です。`, '表示された検索語句とタイトル・説明の約束が一致しているか確認してください。100回・1％は運用上の目安です。');
    if (row.sessions !== null && row.sessions >= 50 && row.inquiries === 0) add('conversion_review', 2, row.path, '相談導線を確認', `入口セッション${row.sessions}件に対し、計測された相談完了は0件です。`, '計測が正常か確認したうえで、対象企業・活用例・料金・相談CTAを見直してください。');
    if (row.clicks !== null && row.previous.clicks !== null && row.previous.clicks >= 20 && row.clicks <= row.previous.clicks * 0.6) add('traffic_decline', 2, row.path, '検索流入の変化を確認', `前期間${row.previous.clicks}クリックから${row.clicks}クリックに減少しています。`, '検索語句・順位・季節性・最近の更新を確認してください。下落だけを理由に削除しません。');
    if ((row.impressions === 0 || row.impressions === null) && ['published', 'live'].includes(row.publication) && Number.isFinite(Date.parse(row.publishedAt)) && time - new Date(row.publishedAt) >= 28 * DAY) add('discovery_review', 3, row.path, '公開後の検索状況を確認', row.impressions === null ? '検索データがまだ確認できません。ゼロ件とは断定できません。' : '直近期間の検索表示は0回です。', '連携状態、URL検査、参照する内部リンク、実際の検索需要を順に確認してください。');
    if (row.leadStages.won > 0) add('expand_evidence', 3, row.path, '受注につながった内容を充実', `このページを紹介元として受注${row.leadStages.won}件を登録しています。`, '許諾の取れた支援事例や実際の質問を追加し、同じ課題を持つ企業への説明を厚くしてください。');
  }
  const queryGroups = new Map();
  for (const query of current.gsc?.queries || []) {
    if (!query.query || !pathOf(query.path) || !(finite(query.impressions) >= 20)) continue;
    const key = String(query.query).normalize('NFKC').trim().toLowerCase();
    if (!queryGroups.has(key)) queryGroups.set(key, new Set());
    queryGroups.get(key).add(pathOf(query.path));
  }
  let overlapCount = 0;
  for (const [query, paths] of queryGroups) {
    if (paths.size < 2 || overlapCount++ >= 10) continue;
    add('query_overlap', 3, [...paths][0], '同じ検索語句に複数ページが表示', `「${query}」で${paths.size}ページに表示実績があります。`, '意図が異なるなら共存できます。内容が重複する場合だけ、担当キーワードと内部リンクを整理してください。');
  }
  actions.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'ja') || String(a.path).localeCompare(String(b.path)));
  const periodSnapshot = current.gsc || current.ga4;
  const mismatchedPeriods = current.ga4 && current.gsc && (current.ga4.startDate !== current.gsc.startDate || current.ga4.endDate !== current.gsc.endDate);
  return {
    generatedAt: time.toISOString(), period: periodSnapshot ? {startDate: periodSnapshot.startDate, endDate: periodSnapshot.endDate} : null,
    sourcePeriods: Object.fromEntries(['ga4', 'gsc'].map(source => [source, current[source] ? {startDate: current[source].startDate, endDate: current[source].endDate, fetchedAt: current[source].fetchedAt} : null])),
    summary: mergeMetrics(current.ga4?.summary, current.gsc?.summary), previousSummary: mergeMetrics(previous.ga4?.summary, previous.gsc?.summary),
    sources, pages: rows, actions, funnel: aggregateLeadStages(leadValues),
    queries: (current.gsc?.queries || []).map(row => ({...row, suggestedIntent: classifySearchIntent(row.query)})),
    notes: [...new Set([
      '—は未取得・未計測・反映待ちなどを含み、0件と同じ意味ではありません。',
      '改善候補の数値基準は運用上の目安で、Googleの評価基準や順位保証ではありません。',
      '商談・受注は登録済み案件の現在の段階です。すべての実際の問い合わせが自動登録されるものではありません。',
      '案件の金額は登録した受注額・粗利益です。月額売上やLTVに自動換算しません。',
      ...(mismatchedPeriods ? ['GA4とSearch Consoleの取得対象期間が異なります。同期状況を確認してください。'] : []),
      ...['ga4', 'gsc'].flatMap(source => current[source]?.quality?.notes || []),
      ...['ga4', 'gsc'].filter(source => current[source]?.quality?.truncated).map(source => `${source.toUpperCase()}は取得上限に達しています。ページ・検索語句の一部が含まれません。`),
      ...['ga4', 'gsc'].filter(source => current[source]?.quality?.thresholded || current[source]?.quality?.sampled).map(source => `${source.toUpperCase()}はしきい値・サンプリング・集約の影響があります。`),
    ])],
  };
}

// A photo outage finishes the request but is not a success; show it as needing
// attention instead of reusing the last completed time as if it had just run.
export function photoJobDescription(schedule, date) {
  if (!schedule?.status) return '地域写真の取得：実行記録はまだありません。';
  const times = `最終試行 ${date(schedule.lastAttemptAt)}、最終完了 ${schedule.lastSuccessAt ? date(schedule.lastSuccessAt) : 'なし'}`;
  if (schedule.status === 'attention') return `地域写真の取得：要確認。写真の取得元から応答がなく、この回は完了していません（${times}）。地域LPの公開は続けており、翌日以降に自動で再取得します。`;
  if (schedule.status === 'error') return `地域写真の取得：エラー（${times}）。GitHub Actionsの実行履歴を確認してください。`;
  if (schedule.status === 'running') return `地域写真の取得：実行中、または途中で止まっています（${times}）。`;
  return `地域写真の取得：完了（${times}）。`;
}
