import {WORKSPACE_PROJECTS, canonicalWorkspacePath, workspaceProjectForPath} from '../src/lib/seo-manager/workspace-projects.mjs';

const SOURCES = ['ga4', 'gsc'];
const METRICS = ['views', 'clicks', 'impressions', 'inquiries', 'documentRequests', 'ctaClicks'];
const GA_METRICS = ['views', 'inquiries', 'documentRequests', 'ctaClicks'];
const GSC_METRICS = ['clicks', 'impressions', 'ctr', 'position'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const values = input => Array.isArray(input) ? input.map(row => row && typeof row === 'object' && Object.hasOwn(row, 'value') ? row.value : row).filter(Boolean) : [];
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && timestamp(value)?.slice(0, 10) === value;
const blank = () => Object.fromEntries(METRICS.map(key => [key, null]));
const sum = input => {const valid = input.map(finite).filter(value => value !== null); return valid.length ? valid.reduce((total, value) => total + value, 0) : null;};
const cleanText = (value, limit = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';
const safeQuality = snapshot => ({truncated: snapshot?.quality?.truncated === true, thresholded: snapshot?.quality?.thresholded === true, sampled: snapshot?.quality?.sampled === true});
const coverage = snapshot => snapshot?.coverage?.version === 2 ? {version: 2, prefixes: ['/service/ltori/', '/media/'], eventPrefixes: ['/service/ltori/area/', '/service/ltori/media/']} : {version: 1, prefixes: ['/service/ltori/'], eventPrefixes: ['/service/ltori/area/', '/service/ltori/media/']};

export function safeScheduler(value) {
  if (!value || typeof value !== 'object') return null;
  const identifier = input => /^\d{1,30}$/.test(String(input ?? '')) ? String(input) : null;
  return {status: ['completed', 'running', 'error'].includes(value.status) ? value.status : null, lastAttemptAt: timestamp(value.lastAttemptAt), lastSuccessAt: timestamp(value.lastSuccessAt), runId: identifier(value.runId), runAttempt: identifier(value.runAttempt)};
}

function matchesSource(snapshot, configuration) {
  return ['sc-domain:layr.co.jp', 'https://layr.co.jp/'].includes(configuration.siteUrl) && snapshot.siteUrl === configuration.siteUrl
    && (snapshot.source !== 'ga4' || /^\d+$/.test(String(configuration.propertyId || '')) && snapshot.propertyId === String(configuration.propertyId));
}
function validSnapshot(snapshot) { return date(snapshot.startDate) && date(snapshot.endDate) && snapshot.startDate <= snapshot.endDate && timestamp(snapshot.fetchedAt) && Array.isArray(snapshot.pages); }

// The collector normally stores one canonical row. For older/imported values,
// never double-count duplicate canonical paths or invent a winner on conflict.
function metricRows(snapshot, notes) {
  const rows = new Map(), fields = snapshot.source === 'ga4' ? GA_METRICS : GSC_METRICS;
  for (const item of snapshot.pages) {
    const path = canonicalWorkspacePath(item?.path), project = workspaceProjectForPath(path);
    if (!project || project === 'corporate' && coverage(snapshot).version < 2) continue;
    const previous = rows.get(path), metrics = Object.fromEntries(fields.map(field => [field, finite(item[field])]));
    if (snapshot.source === 'gsc') {
      if (metrics.ctr !== null && metrics.ctr > 1) metrics.ctr = null;
      if (metrics.position === 0 || metrics.impressions === 0) metrics.position = null;
    }
    if (!previous) {rows.set(path, {metrics, ambiguous: new Set()}); continue;}
    for (const field of fields) {
      if (previous.ambiguous.has(field)) continue;
      if (previous.metrics[field] !== metrics[field]) {previous.metrics[field] = null; previous.ambiguous.add(field); notes.push('同じURLの実績に異なる値があるため、重複行を合算せず該当指標を空欄にしました。');}
    }
  }
  return rows;
}

/** Compact read-only projection. No documents, credentials, lead records or
 * arbitrary stored fields cross this boundary. Metrics are observed page sums,
 * not all-site totals; distinct users are deliberately absent. */
export function projectWorkspace({catalog = [], pending = [], snapshots = [], integrations = [], configuration = {}, scheduler = {}, now = new Date()} = {}) {
  const generatedAt = new Date(now).toISOString(), notes = [], actions = [], selected = {};
  for (const source of SOURCES) {
    const candidates = values(snapshots).filter(row => row?.source === source && row.period === 'current');
    for (const row of candidates) if (!matchesSource(row, configuration) || !validSnapshot(row)) notes.push(`${source === 'ga4' ? 'GA4' : 'Search Console'}の保存実績は取得元または形式を確認できないため除外しました。再同期してください。`);
    selected[source] = candidates.filter(row => matchesSource(row, configuration) && validSnapshot(row)).sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0] || null;
  }
  const periods = Object.fromEntries(SOURCES.map(source => [source, selected[source] ? {startDate: selected[source].startDate, endDate: selected[source].endDate, fetchedAt: timestamp(selected[source].fetchedAt)} : null]));
  if (periods.ga4 && periods.gsc && (periods.ga4.startDate !== periods.gsc.startDate || periods.ga4.endDate !== periods.gsc.endDate)) notes.push('GA4とSearch Consoleの取得対象期間が異なります。各指標はそれぞれの期間で表示し、期間をまたいだ率は計算しません。');
  const integrationValues = values(integrations);
  const sources = SOURCES.map(source => {
    const record = integrationValues.find(row => row.source === source), snapshot = selected[source];
    const status = ['ok', 'error', 'not_configured'].includes(record?.status) ? record.status : 'not_configured';
    const message = status === 'error' ? '最新の取得に失敗しています。最後に成功した実績を保持しています。' : status === 'not_configured' ? '連携設定または取得状況を確認してください。' : null;
    if (status !== 'ok' || !snapshot) actions.push({id: `sync-${source}`, type: 'sync', priority: 1, title: `${source === 'ga4' ? 'GA4' : 'Search Console'}の同期を確認`, reason: message || '表示できる実績がまだありません。', nextStep: '接続設定・閲覧権限と定期更新の結果を確認してください。', href: '/growth/#health'});
    const quality = safeQuality(snapshot);
    if (quality.truncated) notes.push(`${source.toUpperCase()}は取得上限に達したため、集計値は空欄です。取得できたページの実績は表示しています。`);
    if (quality.thresholded || quality.sampled) notes.push(`${source.toUpperCase()}はしきい値・サンプリングなどの影響があります。`);
    if (snapshot && coverage(snapshot).version < 2) notes.push(`${source.toUpperCase()}の保存実績は旧範囲です。公式メディア /media/ は次回の取得成功後に反映されます。`);
    return {source, status, lastAttemptAt: timestamp(record?.lastAttemptAt), lastSuccessAt: timestamp(record?.lastSuccessAt), message, coverage: snapshot ? coverage(snapshot) : null, quality};
  });
  const maps = Object.fromEntries(SOURCES.map(source => [source, selected[source] ? metricRows(selected[source], notes) : new Map()]));
  const allPages = new Map();
  for (const item of values(catalog)) {
    const path = canonicalWorkspacePath(item.path), project = workspaceProjectForPath(path);
    if (!project) continue;
    const old = allPages.get(path);
    allPages.set(path, {path, title: cleanText(item.title) || old?.title || path, type: ['article', 'city', 'prefecture', 'hub', 'index'].includes(item.type) ? item.type : old?.type || 'page', publishedAt: timestamp(item.publishedAt) || old?.publishedAt || null, published: true});
  }
  for (const map of Object.values(maps)) for (const path of map.keys()) if (!allPages.has(path)) allPages.set(path, {path, title: path, type: 'observed', publishedAt: null, published: false});
  const projects = WORKSPACE_PROJECTS.map(project => {
    const pages = [...allPages.values()].filter(page => workspaceProjectForPath(page.path) === project.id).map(page => {
      const metrics = {...blank(), ctr: null, position: null, ...maps.ga4.get(page.path)?.metrics, ...maps.gsc.get(page.path)?.metrics};
      if (project.id === 'corporate') for (const name of ['inquiries', 'documentRequests', 'ctaClicks']) metrics[name] = null;
      return {path: page.path, title: page.title, type: page.type, publishedAt: page.publishedAt, publication: page.published ? 'published' : 'unconfirmed', metrics};
    }).sort((a, b) => a.path.localeCompare(b.path));
    const metrics = Object.fromEntries(METRICS.map(name => [name, safeQuality(selected[GA_METRICS.includes(name) ? 'ga4' : 'gsc']).truncated ? null : sum(pages.map(page => page.metrics[name]))]));
    const pendingPaths = new Set(values(pending).filter(item => ['approved', 'scheduled'].includes(item.status) && workspaceProjectForPath(item.path) === project.id).map(item => canonicalWorkspacePath(item.path)));
    return {id: project.id, name: project.name, pathPrefix: project.prefix, href: project.href, publicUrl: project.publicUrl, publishedCount: pages.filter(page => page.publication === 'published').length, pendingCount: pendingPaths.size, metrics, pages};
  });
  for (const project of projects) if (project.pendingCount > 0) actions.push({
    id: `publication-${project.id}`, type: 'publication', priority: 2, title: `${project.name}の公開待ちを確認`,
    reason: `承認済み・公開予約済みの原稿が${project.pendingCount}件あります。下書き・停止中の原稿は含みません。`,
    nextStep: '原稿・公開予約で対象原稿と公開予定を確認し、自動公開の停止状態や実行結果を確認してください。', href: '/growth/#documents',
  });
  const ctrCandidates = projects.flatMap(project => project.pages.filter(page => {
    const {impressions, position, ctr} = page.metrics;
    return impressions !== null && impressions >= 100 && position !== null && position >= 1 && position <= 20 && ctr !== null && ctr < 0.01;
  }).map(page => ({project, page}))).sort((a, b) => b.page.metrics.impressions - a.page.metrics.impressions || a.page.metrics.ctr - b.page.metrics.ctr || a.page.path.localeCompare(b.page.path));
  for (const {project, page} of ctrCandidates.slice(0, 10)) actions.push({
    id: `ctr-${page.path}`, type: 'ctr_review', priority: 2, title: `${page.title}の検索結果の見出しを確認`,
    reason: `${periods.gsc.startDate}〜${periods.gsc.endDate}の取得実績は${page.metrics.impressions}回表示、平均順位${page.metrics.position.toFixed(1)}位、CTR ${(page.metrics.ctr * 100).toFixed(1)}％です。100回・20位以内・1％未満は運用上の目安で、Googleの評価基準ではありません。`,
    nextStep: '表示された検索語句と読者の意図を確認し、タイトル・説明文と記事内容が一致しているか見直してください。変更後も同じ条件の実績で確認します。', href: project.href,
  });
  const totals = {...Object.fromEntries(METRICS.map(name => [name, sum(projects.map(project => project.metrics[name]))])), publishedCount: projects.reduce((count, project) => count + project.publishedCount, 0)};
  notes.push('集計は3施策に属する取得済みURLの観測値合計です。行がない指標は未取得・未計測・反映待ちと0を区別できないため「—」です。', 'ユーザー数は施策・記事をまたいで合算しません。GA4とSearch Consoleはタイムゾーンと集計方法が異なります。', '公式メディア /media/ の問い合わせ・資料請求・CTA帰属は未対応です。全体のこれらの数値は全国SEOと採用ノートで観測されたものだけです。共通generate_leadは加算しません。', '公開数は公開記事一覧とサーバーの公開記録で確認できたURL数です。実績だけに存在するURLは公開数に含めません。', '公開待ち数はサーバー保存された承認済み・公開予約済みの原稿です。下書き・停止中の原稿とブラウザ内の記事計画は含みません。');
  return {generatedAt, projects, totals, periods, sources, scheduler: {publish: safeScheduler(scheduler.publish), maintenance: safeScheduler(scheduler.maintenance)}, notes: [...new Set(notes)], actions};
}

// Growth remains an ltori report even after snapshots begin covering /media/.
// API totalUsers cannot be split by adding per-page users, so it stays unknown.
export function ltoriGrowthSnapshots(input = []) {
  return values(input).map(snapshot => {
    if (snapshot.coverage?.version !== 2) return snapshot;
    const isLtori = path => canonicalWorkspacePath(path)?.startsWith('/service/ltori/');
    const pages = (snapshot.pages || []).filter(row => isLtori(row.path));
    const summary = {...snapshot.summary};
    for (const name of ['views', 'sessions', 'organicSessions', 'inquiries', 'documentRequests', 'ctaClicks', 'clicks', 'impressions']) summary[name] = snapshot.quality?.truncated ? null : sum(pages.map(row => row[name]));
    summary.users = null; summary.position = null;
    summary.ctr = summary.impressions > 0 && summary.clicks !== null ? summary.clicks / summary.impressions : null;
    return {...snapshot, pages, queries: (snapshot.queries || []).filter(row => isLtori(row.path)), summary, coverage: {version: 2, prefixes: ['/service/ltori/'], eventPrefixes: ['/service/ltori/area/', '/service/ltori/media/']}, quality: {...snapshot.quality, notes: [...(snapshot.quality?.notes || []), 'この成果画面は /service/ltori/ の取得済みURLのみを再集計しています。公式メディア /media/ は含みません。総ユーザー数と平均順位は再集計できないため空欄です。']}};
  });
}
