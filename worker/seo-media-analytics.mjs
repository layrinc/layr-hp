import {canonicalArticlePath, validateMediaAnalyticsReport, validateMediaSearchReport} from '../src/lib/media-manager/model.mjs';

const SOURCES = ['ga4', 'gsc'];
const SEARCH_METRICS = ['clicks', 'impressions', 'ctr', 'position'];
const values = rows => rows.map(row => row?.value ?? row);
const validTime = value => typeof value === 'string' && value.length < 50 && Number.isFinite(Date.parse(value));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && validTime(value) && new Date(value).toISOString().slice(0, 10) === value;
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row?.[key] ?? null]));
const noteText = value => typeof value === 'string' ? value.slice(0, 1000) : '';

/** Use only the published catalogue supplied by the server. Never infer a plan/article
 * link from a keyword, or include the regional and unpublished paths in Google. */
export function mediaAnalyticsCatalog(pages = []) {
  const seen = new Set();
  return pages.flatMap(page => {
    if (page.type && page.type !== 'article') return [];
    if (page.publication && page.publication !== 'published') return [];
    const match = typeof page.path === 'string' && page.path.match(/^\/service\/ltori\/media\/([a-z0-9][a-z0-9-]*)\/$/);
    if (!match || ['about', 'contact', 'category', 'constructor', 'prototype'].includes(match[1]) || seen.has(page.path)) return [];
    seen.add(page.path);
    return [{id: match[1], path: page.path, title: typeof page.title === 'string' ? page.title.slice(0, 500) : match[1], publication: 'published'}];
  });
}

function reportNotes(snapshot) {
  const label = snapshot.source === 'ga4' ? 'GA4' : 'Search Console';
  return [
    `${label}：${snapshot.startDate}〜${snapshot.endDate} / 取得 ${snapshot.fetchedAt}`,
    ...(Array.isArray(snapshot.quality?.notes) ? snapshot.quality.notes : []).filter(value => typeof value === 'string').slice(0, 12).map(noteText),
    ...(snapshot.quality?.truncated ? [`${label}は取得上限に達しています。一部のページ・検索語句は含まれません。`] : []),
    ...(snapshot.quality?.thresholded ? [`${label}はしきい値・集約の影響があります。`] : []),
    ...(snapshot.quality?.sampled ? [`${label}はサンプリングの影響があります。`] : []),
  ];
}

function articleRows(snapshot, catalog, kind) {
  const byPath = new Map(catalog.map(page => [page.path, page.id]));
  return (kind === 'queries' ? snapshot.queries : snapshot.pages).flatMap(row => {
    const pageId = byPath.get(canonicalArticlePath(row.path, catalog));
    if (!pageId) return [];
    if (snapshot.source === 'ga4') return [{pageId, ...pick(row, ['views', 'users', 'sessions', 'inquiries']), cta: row.ctaClicks ?? null, documents: row.documentRequests ?? null}];
    return [{pageId, ...(kind === 'queries' ? {query: row.query} : {}), ...pick(row, SEARCH_METRICS)}];
  });
}

function safeIntegration(row) {
  if (!SOURCES.includes(row?.source) || !['ok', 'error', 'not_configured'].includes(row.status)) return null;
  return {source: row.source, status: row.status, lastAttemptAt: validTime(row.lastAttemptAt) ? row.lastAttemptAt : null, lastSuccessAt: validTime(row.lastSuccessAt) ? row.lastSuccessAt : null,
    ...(typeof row.code === 'string' ? {code: row.code.slice(0, 100)} : {}), ...(typeof row.message === 'string' ? {message: noteText(row.message)} : {})};
}

function safeScheduler(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const timestamp = input => validTime(input) ? new Date(input).toISOString() : null;
  const identifier = input => typeof input === 'string' && /^[1-9][0-9]{0,29}$/.test(input) ? input : null;
  // This is the maintenance delivery's status, not proof that Google returned data.
  // A completed delivery may have found unconfigured integrations; an inspection
  // failure may fail maintenance while the analytics job itself succeeded.
  return {status: ['running', 'completed', 'error'].includes(value.status) ? value.status : null,
    lastAttemptAt: timestamp(value.lastAttemptAt), lastSuccessAt: timestamp(value.lastSuccessAt),
    runId: identifier(value.runId), runAttempt: identifier(value.runAttempt)};
}

/** Read-only projection of the shared last-successful server snapshots into the
 * existing media report contract. No leads, raw event URLs or credentials leave it. */
export function projectMediaAnalytics({snapshots = [], catalog = [], configuration = {}, integrations = [], job = null, scheduler = null, now = new Date()} = {}) {
  const pages = mediaAnalyticsCatalog(catalog), groups = new Map(), reports = [], queries = [], notes = [];
  const config = {
    serviceAccountConfigured: configuration.serviceAccountConfigured === true,
    propertyId: /^\d+$/.test(configuration.propertyId || '') ? String(configuration.propertyId) : null,
    siteUrl: ['sc-domain:layr.co.jp', 'https://layr.co.jp/'].includes(configuration.siteUrl) ? configuration.siteUrl : null,
    ga4Configured: configuration.ga4Configured === true, gscConfigured: configuration.gscConfigured === true,
  };
  for (const snapshot of values(snapshots)) {
    if (!SOURCES.includes(snapshot?.source)) continue;
    const label = snapshot.source === 'ga4' ? 'GA4' : 'Search Console';
    // Older snapshots predate source identifiers. Guessing from today's settings
    // could relabel a different property's historical data after a config change.
    if (!snapshot.siteUrl || snapshot.siteUrl !== config.siteUrl || (snapshot.source === 'ga4' && (!snapshot.propertyId || snapshot.propertyId !== config.propertyId))) {
      notes.push(`${label}の保存実績は取得元を現在の設定と確認できません。再同期すると反映されます。`); continue;
    }
    if (!validDate(snapshot.startDate) || !validDate(snapshot.endDate) || snapshot.startDate > snapshot.endDate || !validTime(snapshot.fetchedAt) || !Array.isArray(snapshot.pages) || (snapshot.source === 'gsc' && !Array.isArray(snapshot.queries))) {
      notes.push(`${label}の保存実績の形式を確認できません。再同期してください。`); continue;
    }
    const key = `${snapshot.startDate}:${snapshot.endDate}`;
    if (!groups.has(key)) groups.set(key, {});
    const group = groups.get(key), previous = group[snapshot.source];
    if (!previous || Date.parse(snapshot.fetchedAt) > Date.parse(previous.fetchedAt)) group[snapshot.source] = snapshot;
  }
  for (const group of groups.values()) {
    const ga = group.ga4, search = group.gsc, sample = ga || search;
    const meta = {start: sample.startDate, end: sample.endDate, site: config.siteUrl};
    let gaReport = null, searchReport = null;
    if (ga && config.propertyId) {
      try {
        gaReport = validateMediaAnalyticsReport({...meta, origin: 'google', property: config.propertyId, gaTimezone: noteText(ga.timeZone).slice(0, 100), importedAt: ga.fetchedAt, notes: reportNotes(ga), rows: articleRows(ga, pages)}, pages);
      } catch { notes.push(`GA4 ${meta.start}〜${meta.end}の保存実績を読み取れません。再同期してください。`); }
    }
    if (search) {
      const base = {...meta, importedAt: search.fetchedAt, notes: reportNotes(search)};
      try { searchReport = validateMediaSearchReport({...base, kind: 'pages', rows: articleRows(search, pages, 'pages')}, pages); }
      catch { notes.push(`Search Console ${meta.start}〜${meta.end}のページ実績を読み取れません。再同期してください。`); }
      try { queries.push(validateMediaSearchReport({...base, kind: 'queries', rows: articleRows(search, pages, 'queries')}, pages)); }
      catch { notes.push(`Search Console ${meta.start}〜${meta.end}の検索語句を読み取れません。再同期してください。`); }
    }
    if ((!gaReport && !searchReport) || !config.propertyId) continue;
    const byId = new Map((gaReport?.rows || []).map(row => [row.pageId, {...row}]));
    for (const row of searchReport?.rows || []) byId.set(row.pageId, {...byId.get(row.pageId), ...row});
    const reportSources = [gaReport, searchReport].filter(Boolean);
    const report = validateMediaAnalyticsReport({...meta, origin: 'google', property: config.propertyId, gaTimezone: gaReport?.gaTimezone || '',
      importedAt: reportSources.map(row => row.importedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
      notes: [...new Set([
        ...reportSources.flatMap(row => row.notes),
        ...(!gaReport ? ['同じ期間のGA4実績は未取得です。Search Consoleの実績のみを表示します。'] : []),
        ...(!searchReport ? ['同じ期間のSearch Console実績は未取得です。GA4の実績のみを表示します。'] : []),
        '行がない指標は未取得・未計測・反映待ちと0を区別できないため「—」です。総ユーザー数は記事間で合計しません。',
        'GA4はプロパティの時間帯、Search Consoleは米国太平洋時間の集計です。検索表示回数は市場全体の月間検索数ではありません。',
      ])], rows: [...byId.values()]}, pages);
    reports.push(report);
  }
  const recentFirst = (a, b) => b.end.localeCompare(a.end) || Date.parse(b.importedAt) - Date.parse(a.importedAt);
  reports.sort(recentFirst); queries.sort(recentFirst);
  const serverTime = new Date(now).toISOString(), next = new Date(now);
  next.setUTCHours(21, 17, 0, 0); if (next <= new Date(now)) next.setUTCDate(next.getUTCDate() + 1);
  const safeJob = job && ['running', 'completed', 'error'].includes(job.status) ? {status: job.status,
    ...(validTime(job.startedAt) ? {startedAt: job.startedAt} : {}), ...(validTime(job.finishedAt) ? {finishedAt: job.finishedAt} : {}), ...(typeof job.message === 'string' ? {message: noteText(job.message)} : {})} : null;
  return {configuration: config, catalog: pages, integrations: values(integrations).map(safeIntegration).filter(Boolean),
    schedule: {provider: 'github-actions', frequency: 'daily', timezone: 'Asia/Tokyo', time: '06:17', cron: '17 21 * * *', nextRunAt: next.toISOString()},
    scheduler: safeScheduler(scheduler), job: safeJob, reports, queries, notes: [...new Set(notes)], serverTime};
}

export async function readMediaAnalytics(store, options = {}) {
  const [snapshots, integrations, job, scheduler] = await Promise.all([store.list('analytics'), store.list('integrations'), store.get('jobs', 'analytics'), store.get('scheduler', 'maintenance')]);
  return projectMediaAnalytics({...options, snapshots, integrations, job, scheduler});
}
