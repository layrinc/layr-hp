import {canonicalWorkspacePath} from './workspace-projects.mjs';

const METRICS = {ga4: ['views', 'users', 'sessions', 'inquiries'], gsc: ['clicks', 'impressions', 'position']};
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const timeText = value => validTime(value) ? new Date(value).toLocaleString('ja-JP') : '未確認';
export const isServerReport = report => report?.origin === 'server';
export const formatSearchCtr = row => Number.isFinite(row?.clicks) && Number.isFinite(row?.impressions) && row.impressions > 0 ? `${(row.clicks / row.impressions * 100).toFixed(1)}%` : '—';
export const serverReportLabel = report => `自動取得・${report.source === 'ga4' ? 'GA4' : 'Search Console'} / ${report.start}〜${report.end} / ${timeText(report.importedAt)}`;

// Produce transient, source-specific reports only. Never persist these into
// reports/analyticsReports: manual imports retain their history and provenance.
export function projectRegionalServerAnalytics(payload, catalog) {
  if (!payload || !Array.isArray(payload.projects) || !Array.isArray(payload.sources) || !payload.periods || !validTime(payload.generatedAt)) throw new Error('自動取得実績の形式を確認できませんでした。');
  const regional = payload.projects.find(project => project?.id === 'regional');
  if (!regional || !Array.isArray(regional.pages)) throw new Error('全国SEOの自動取得実績を確認できませんでした。');
  const byPath = new Map(catalog.map(page => [canonicalWorkspacePath(page.path), page]));
  const notes = ['自動取得はサーバーの定期更新で保存された実績を読み取っています。この画面のGoogle手動接続は不要です。', '行がない指標は未取得・未計測・反映待ちと0を区別できないため「—」です。個別ページのユーザー数は地域間で合計しません。'];
  const reports = [];
  for (const source of ['ga4', 'gsc']) {
    const period = payload.periods[source], status = payload.sources.find(row => row?.source === source);
    if (!period || !validDate(period.startDate) || !validDate(period.endDate) || period.startDate > period.endDate || !validTime(period.fetchedAt)) continue;
    const sourceNotes = [...notes, `${source === 'ga4' ? 'GA4はプロパティのタイムゾーン' : 'Search Consoleは米国太平洋時間'}で集計しています。この選択では他方の指標は表示しません。`];
    if (status?.status === 'error') sourceNotes.push(`最新の自動取得に失敗しています。最後に保存された成功実績（取得：${timeText(period.fetchedAt)}）を表示しています。最終試行：${timeText(status.lastAttemptAt)}。`);
    if (status?.status === 'not_configured') sourceNotes.push('自動連携の現在の設定は確認が必要です。保存済みの実績を表示しています。');
    if (status?.quality?.truncated) sourceNotes.push('取得上限に達しています。取得できたページの実績だけを表示しています。');
    if (status?.quality?.thresholded || status?.quality?.sampled) sourceNotes.push('しきい値・サンプリングなどの影響があります。');
    const seen = new Set(), rows = [];
    for (const item of regional.pages) {
      const page = byPath.get(canonicalWorkspacePath(item?.path));
      if (!page || page.publication === 'excluded' || seen.has(page.id)) continue;
      seen.add(page.id);
      rows.push({pageId: page.id, ...Object.fromEntries(METRICS[source].map(key => [key, finite(item.metrics?.[key])]))});
    }
    reports.push({id: `server:${source}`, origin: 'server', source, kind: 'pages', scopePageId: '', searchType: 'web', filter: '全デバイス・全ての国', start: period.startDate, end: period.endDate, importedAt: period.fetchedAt, gaTimezone: source === 'ga4' ? 'GA4プロパティのタイムゾーン' : 'America/Los_Angeles', notes: sourceNotes, rows});
  }
  return {reports, searchReport: reports.find(report => report.source === 'gsc') || null, generatedAt: payload.generatedAt};
}

export function createRegionalServerReader({catalog, fetchImpl = fetch} = {}) {
  let pending;
  return () => {
    if (!pending) pending = (async () => {
      const response = await fetchImpl('/api/seo/overview', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('自動取得実績を読み込めませんでした。保存済みCSVは引き続き選択できます。再読み込みして確認してください。');
      return projectRegionalServerAnalytics(await response.json(), catalog);
    })();
    return pending;
  };
}

export function regionalServerStatus(server) {
  if (server.loading) return 'サーバーの定期取得実績を読み込み中です。CSV実績は引き続き選択できます。';
  if (server.error) return server.error;
  if (!server.data?.reports.length) return '表示できる定期取得実績はまだありません。共通の接続・サイト点検で同期結果を確認してください。CSV実績も選択できます。';
  return 'サーバーの定期取得実績を読み込みました。自動実績は読み取り専用です。Googleの手動接続やCSV履歴とは別に管理しています。';
}
