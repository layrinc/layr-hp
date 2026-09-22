import {startAccessSession} from './session.mjs';

const $ = id => document.getElementById(id);
const array = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value : '';
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('ja-JP', {maximumFractionDigits: 1}).format(Number(value));
const money = value => value == null ? '—' : `${number(value)}円`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short'}).format(new Date(value)) : '未設定';
const day = value => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo'}).format(value ? new Date(value) : new Date());
const docStatuses = {draft: '下書き', approved: '承認済み', scheduled: '公開予約', published: '公開中', paused: '公開停止'};
const leadStages = {inquiry: '新規相談', qualified: '有効な相談', meeting: '商談中', won: '受注', lost: '見送り'};
const sourceNames = {gsc: 'Search Console', searchConsole: 'Search Console', ga4: 'Google アナリティクス', analytics: 'Google アナリティクス'};
let data = null, pending = false, editDoc = null, editLead = null, dirty = false, leadDirty = false, documentPage = 1;

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = String(content);
  if (className) element.className = className;
  return element;
}
function button(label, action, className = 'kw-button') {
  const element = node('button', label, className);
  element.type = 'button'; element.addEventListener('click', action);
  return element;
}
function link(label, value) {
  let url;
  try { url = new URL(value, 'https://layr.co.jp'); } catch { return node('span', label); }
  if (url.protocol !== 'https:' || url.hostname !== 'layr.co.jp' || url.username || url.password) return node('span', label);
  const element = node('a', label); element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; return element;
}
function option(value, label) { const element = node('option', label); element.value = value; return element; }
function message(text, isError = false, target = 'growth-message') {
  const element = $(target); element.textContent = text; element.hidden = false; element.setAttribute('role', isError ? 'alert' : 'status');
}
function errorMessage(error) { return error instanceof Error ? error.message : '処理に失敗しました。再度お試しください。'; }
async function api(path, body) {
  const response = await fetch(`/api/seo${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: body === undefined ? {'Accept': 'application/json'} : {'Accept': 'application/json', 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  let result;
  try { result = await response.json(); if (!result || typeof result !== 'object') throw new Error('Invalid response'); } catch { throw new Error('接続先から正しい応答がありません。ログイン状態とサーバー設定を確認してください。'); }
  if (!response.ok) {
    if (response.status === 409) throw new Error('別の操作で更新されています。入力内容を控えてから閉じ、最新情報を読み直して編集してください。');
    if (response.status === 401 || response.status === 403) throw new Error('認証を確認できません。ページを再読み込みしてログインしてください。');
    const details = array(result.issues).map(item => string(item.message)).filter(Boolean).join(' / ');
    throw new Error(details || string(result.message) || string(result.error) || `処理できませんでした（${response.status}）。設定・接続状況をご確認ください。`);
  }
  return result;
}
function setPending(value) {
  pending = value;
  for (const element of document.querySelectorAll('[data-requires-data]')) element.disabled = value || !data;
  for (const id of ['growth-refresh', 'growth-editor-save', 'growth-lead-save']) $(id).disabled = value;
  for (const id of ['growth-editor-form', 'growth-lead-form']) { $(id).inert = value; $(id).setAttribute('aria-busy', String(value)); }
  $('growth-editor-close').disabled = value; $('growth-lead-close').disabled = value;
  updateEditorActions();
}
async function operation(action, success, target) {
  if (pending) return;
  setPending(true);
  try { await action(); if (success) message(success); }
  catch (error) {
    message(errorMessage(error), true, target);
    if (!data) { $('growth-saved').textContent = '運用データを取得できませんでした'; $('growth-publication-state').textContent = '自動公開の状態を未確認'; $('growth-publication-detail').textContent = '接続・設定を確認し、最新の情報に更新してください。'; }
  }
  finally { setPending(false); }
}
async function refresh() {
  const next = await api('/dashboard');
  if (!next || !Array.isArray(next.documents) || !next.settings) throw new Error('運用データの形式を確認できません。サーバーの設定を確認してください。');
  data = next;
  $('growth-saved').textContent = `サーバーから取得 · ${date(new Date().toISOString())}`;
  render();
}
function switchTab(tab) {
  for (const element of document.querySelectorAll('[data-growth-view]')) element.hidden = element.dataset.growthView !== tab;
  for (const element of document.querySelectorAll('[data-growth-tab]')) {
    if (element.dataset.growthTab === tab) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
  }
}
function pathFor(doc) { return doc.path || (doc.type === 'city' ? `/service/ltori/area/${doc.slug}/` : `/service/ltori/media/${doc.slug}/`); }
function publicationDetail(state) {
  if (state.settings.paused) return '公開待ちの原稿は保持しています。再開するまで自動公開しません。';
  const schedule = state.scheduler?.publish;
  const successAt = Date.parse(schedule?.lastSuccessAt), serverNow = Date.parse(state.serverTime);
  const parts = [`毎日${state.settings.publishTime || '09:17'}（日本時間）に公開を確認し、10:17にも再確認します。合計で1日最大10本。実行時刻は遅れる場合があります。承認済み原稿がない日は追加しません。`];
  parts.push(Number.isFinite(successAt) ? `公開処理の最終成功：${date(schedule.lastSuccessAt)}。` : '自動公開の実行成功はまだ確認できていません。');
  if (schedule?.status === 'error') parts.push('直近の処理でエラーがありました。GitHub Actionsの実行履歴を確認してください。');
  else if (schedule?.status === 'running') parts.push('公開処理を実行中です。しばらくして最新の情報に更新してください。');
  if (Number.isFinite(successAt) && Number.isFinite(serverNow) && serverNow - successAt > 36 * 60 * 60 * 1000) parts.push('前回の成功から36時間以上経過しています。自動処理が停止していないかGitHub Actionsで確認してください。');
  return parts.join(' ');
}
function render() {
  const stats = data.publicationStats || {}, queued = array(data.documents).filter(doc => ['approved', 'scheduled'].includes(doc.status)).length;
  $('growth-publication-state').textContent = data.settings.paused ? '自動公開を一時停止中' : '承認済みの原稿を順次公開';
  $('growth-publication-detail').textContent = publicationDetail(data);
  $('growth-daily-count').textContent = `${number(stats.todayPublished)} / ${number(data.settings.dailyLimit ?? 10)}`;
  $('growth-queue-count').textContent = `${number(stats.queued ?? queued)}本`;
  $('growth-pause').textContent = data.settings.paused ? '自動公開を再開' : '自動公開を一時停止';
  renderOverview(); renderDocuments(); renderLeads(); renderHealth();
}
function renderOverview() {
  const report = data.report || {}, summary = report.summary || {};
  $('growth-clicks').textContent = number(summary.clicks);
  $('growth-views').textContent = number(summary.views);
  $('growth-conversions').textContent = number(summary.inquiries);
  $('growth-won').textContent = number(report.funnel?.stages?.won);
  $('growth-report-period').textContent = report.period ? `${report.period.startDate}〜${report.period.endDate}の集計。商談記録は全期間です。` : 'Googleデータはまだ取得していません。接続状況をご確認ください。';
  const metrics = $('growth-metric-details'); metrics.replaceChildren();
  const breakdown = [['ユーザー数', number(summary.users)], ['セッション数', number(summary.sessions)], ['自然検索セッション', number(summary.organicSessions)], ['資料請求完了', number(summary.documentRequests)], ['相談ボタンのクリック', number(summary.ctaClicks)], ['検索の表示回数', number(summary.impressions)], ['有効な相談（全期間）', number(report.funnel?.stages?.qualified)], ['商談中（全期間）', number(report.funnel?.stages?.meeting)], ['受注額（登録済み）', money(report.funnel?.revenueYen)], ['粗利益（登録済み）', money(report.funnel?.grossProfitYen)]];
  for (const [label, value] of breakdown) { const item = node('div'); item.append(node('dt', label), node('dd', value)); metrics.append(item); }
  const notes = $('growth-report-notes'); notes.replaceChildren(...array(report.notes).map(note => node('li', note)));
  if (report.funnel && (!report.funnel.revenueComplete || !report.funnel.grossProfitComplete)) notes.append(node('li', '金額が未入力の受注記録があります。表示金額は入力済みの分です。'));
  const recommendations = $('growth-recommendations'); recommendations.replaceChildren();
  for (const action of array(report.actions).slice(0, 12)) {
    const article = node('article'); article.append(node('strong', action.title), node('p', action.reason), node('p', action.nextStep));
    if (action.path) article.append(link('対象ページを確認 ↗', action.path));
    const doc = array(data.documents).find(item => pathFor(item) === action.path);
    if (doc) article.append(button('原稿を編集', () => openEditor(doc)));
    recommendations.append(article);
  }
  if (!recommendations.children.length) recommendations.append(node('p', '改善候補はまだありません。データ取得後に、検索での見られ方や問い合わせへのつながりを確認できます。', 'growth-empty'));
  const activity = $('growth-activity'); activity.replaceChildren();
  const labels = {publish: '原稿を公開', published: '原稿を公開', approve: '原稿を承認', approved: '原稿を承認', save: '原稿を保存', document_saved: '原稿を保存', sync: 'Googleデータを取得', inspect: '公開ページを点検', settings: '公開設定を変更', lead: '商談記録を更新', pause: '公開を停止'};
  for (const item of array(data.activity).slice(0, 10)) {
    const article = node('article'); article.append(node('strong', item.message || labels[item.action] || item.action || '運用情報を更新'), node('small', date(item.at || item.createdAt || item.updatedAt)));
    if (item.documentId || item.reference) article.append(node('p', item.documentId || item.reference)); activity.append(article);
  }
  if (!activity.children.length) activity.append(node('p', '保存・承認・公開などの操作履歴をここに表示します。', 'growth-empty'));
  const rows = $('growth-page-metrics'); rows.replaceChildren();
  const pages = array(report.pages);
  for (const page of pages.slice(0, 100)) {
    const row = node('tr'), title = node('td', null, 'growth-title-cell'); title.append(link(page.title || page.path, page.path), node('small', page.path));
    row.append(title, node('td', number(page.clicks), 'kw-number'), node('td', number(page.impressions), 'kw-number'), node('td', number(page.views), 'kw-number'), node('td', number(page.inquiries), 'kw-number'), node('td', `有効 ${number(page.leadStages?.qualified)} / 商談 ${number(page.leadStages?.meeting)} / 受注 ${number(page.leadStages?.won)}`)); rows.append(row);
  }
  $('growth-page-empty').hidden = !!pages.length;
}
function renderDocuments() {
  if (!data) return;
  const search = $('growth-document-search').value.trim().toLowerCase(), status = $('growth-document-status').value, type = $('growth-document-type').value;
  const rows = array(data.documents).filter(doc => (!status || doc.status === status) && (!type || doc.type === type) && (!search || `${doc.title} ${doc.slug} ${doc.region?.fullName || ''}`.toLowerCase().includes(search)));
  const pages = Math.max(1, Math.ceil(rows.length / 50)); documentPage = Math.min(documentPage, pages);
  const target = $('growth-document-rows'); target.replaceChildren();
  for (const doc of rows.slice((documentPage - 1) * 50, documentPage * 50)) {
    const row = node('tr'), title = node('td', null, 'growth-title-cell'); title.append(button(doc.title || doc.region?.fullName || doc.slug, () => openEditor(doc)), node('small', `${doc.type === 'city' ? '市のLP' : '採用コラム'} · ${pathFor(doc)}`));
    const statusCell = node('td'); statusCell.append(node('span', docStatuses[doc.status] || doc.status, `kw-tag ${doc.status === 'published' ? 'is-active' : ''}`));
    const issues = array(doc.qualityIssues || doc.issues).filter(issue => issue.severity === 'error');
    const quality = node('td', issues.length ? `${issues.length}件を確認` : doc.review?.reviewedAt ? '承認済み' : '内容を確認');
    if (issues.length) quality.append(node('small', issues[0].message));
    const schedule = node('td', doc.scheduledAt ? date(doc.scheduledAt) : ['approved', 'scheduled'].includes(doc.status) ? '次回の公開対象' : '予定なし'); schedule.append(node('small', `更新 ${date(doc.updatedAt)}`));
    const actions = node('td'), group = node('div', null, 'growth-actions'); group.append(button('編集', () => openEditor(doc)));
    if (doc.status === 'published') group.append(link('公開ページ ↗', pathFor(doc)));
    if (['approved', 'scheduled', 'published'].includes(doc.status)) group.append(button(doc.status === 'published' ? '公開を停止' : '予約を停止', () => pauseDocument(doc)));
    actions.append(group); row.append(title, statusCell, quality, schedule, actions); target.append(row);
  }
  $('growth-document-empty').hidden = !!rows.length;
  $('growth-document-count').textContent = `${number(rows.length)}件中 ${rows.length ? number((documentPage - 1) * 50 + 1) : '0'}〜${number(Math.min(documentPage * 50, rows.length))}件`;
  $('growth-documents-page').textContent = `${documentPage} / ${pages}`; $('growth-documents-prev').disabled = documentPage <= 1; $('growth-documents-next').disabled = documentPage >= pages;
}
function renderLeads() {
  if (!data) return;
  const search = $('growth-lead-search').value.trim().toLowerCase(), stage = $('growth-lead-stage').value;
  const leads = array(data.leads).filter(lead => (!stage || lead.stage === stage) && (!search || `${lead.reference || ''} ${lead.id} ${lead.sourcePath || ''}`.toLowerCase().includes(search)));
  const target = $('growth-lead-rows'); target.replaceChildren();
  for (const lead of leads) {
    const row = node('tr'), reference = node('td', lead.reference || lead.id); reference.append(node('small', date(lead.createdAt)));
    const stageCell = node('td'); stageCell.append(node('span', leadStages[lead.stage] || lead.stage, 'kw-tag'));
    const path = node('td'); path.append(lead.sourcePath ? link(lead.sourcePath, lead.sourcePath) : node('span', '不明'));
    const action = node('td'); action.append(button('更新', () => openLead(lead)));
    row.append(reference, stageCell, path, node('td', money(lead.revenueYen), 'kw-number'), node('td', money(lead.grossProfitYen), 'kw-number'), action); target.append(row);
  }
  $('growth-lead-empty').hidden = !!leads.length;
}
function renderHealth() {
  const target = $('growth-integrations'); target.replaceChildren();
  const sources = array(data.report?.sources);
  for (const key of ['gsc', 'ga4']) {
    const source = sources.find(item => item.source === key) || array(data.integrations).find(item => item.source === key) || {source: key, status: 'not_configured'};
    const panel = node('article', null, 'kw-panel'); panel.append(node('h3', sourceNames[key]));
    panel.append(node('p', {ok: '取得済み', error: '取得に失敗', not_configured: '接続設定が必要'}[source.status] || '取得状況を確認してください', 'kw-tag'));
    panel.append(node('p', source.message || (source.status === 'not_configured' ? 'サーバー側のGoogle連携設定を完了すると、定期取得が始まります。' : '接続情報を確認できます。')));
    panel.append(node('small', `最終成功 ${date(source.lastSuccessAt)} / 最終試行 ${date(source.lastAttemptAt)}`)); target.append(panel);
  }
  const inspections = $('growth-inspections'); inspections.replaceChildren();
  for (const item of array(data.inspections).slice(0, 100)) {
    const article = node('article'); article.append(link(item.path || '点検対象ページ', item.path), node('p', item.message || item.coverageState || (item.status === 'error' ? '点検できませんでした。接続設定を確認してください。' : '点検結果を取得しました。')));
    article.append(node('small', `確認 ${date(item.inspectedAt || item.lastAttemptAt)}${item.verdict ? ` · ${item.verdict}` : ''}`));
    if (item.googleCanonical && item.userCanonical && item.googleCanonical !== item.userCanonical) article.append(node('p', 'Googleが選択した正規URLと指定した正規URLが異なります。内容の重複やリンクを確認してください。'));
    inspections.append(article);
  }
  if (!inspections.children.length) inspections.append(node('p', 'まだ点検していません。Search Consoleの接続後に「公開ページを点検」を実行してください。', 'growth-empty'));
  const technical = $('growth-technical-checks'); technical.replaceChildren();
  for (const item of array(data.health).sort((a, b) => Number(a.ok) - Number(b.ok)).slice(0, 100)) {
    const article = node('article'); article.append(link(item.path, item.path), node('p', item.ok ? '確認項目に問題は見つかりませんでした。' : array(item.warnings).join(' / ')), node('small', `確認 ${date(item.checkedAt)} · HTTP ${item.status ?? '未取得'}`)); technical.append(article);
  }
  if (!technical.children.length) technical.append(node('p', '公開ページのHTTP応答・主見出し・正規URL・相談導線などを点検すると、結果が表示されます。', 'growth-empty'));
  const configuration = $('growth-configuration'); configuration.replaceChildren();
  const config = data.configuration || {};
  configuration.append(node('p', `Google閲覧用アカウント：${config.serviceAccountConfigured ? '設定済み' : '未設定'} / GA4の対象：${config.propertyId ? '設定済み' : '未設定'} / Search Consoleの対象：${config.siteUrl ? '設定済み' : '未設定'}`));
  for (const warning of array(config.warnings)) configuration.append(node('p', typeof warning === 'string' ? warning : warning.message));
  for (const source of sources.filter(item => item.status !== 'ok')) configuration.append(node('p', `${sourceNames[source.source] || source.source}: ${source.message || 'サーバー設定と権限を確認してください。'}`));
  configuration.append(node('p', '原稿を保存 → プレビューで内容を確認 → 公開待ちに追加、の順で進めます。承認後に本文を編集した場合は、改めて承認してください。'));
  configuration.append(node('p', '地域のメモ・CSVデータもサーバーで共有します。旧ブラウザのデータはサーバーに未登録の場合、地域管理の初回利用時に移行します。地域管理のバックアップはメモとCSV、この画面のバックアップは運用データ全体が対象です。'));
}
function field(label, tag, value = '', attributes = {}) {
  const wrapper = node('label', label), input = node(tag);
  for (const [key, val] of Object.entries(attributes)) input.setAttribute(key, String(val));
  input.value = value; wrapper.append(input); return {wrapper, input};
}
function markDirty() { dirty = true; updateEditorActions(); }
function addSection(value = {}) {
  const section = node('fieldset'); section.dataset.section = 'true'; section.append(node('legend', '本文の節'));
  const heading = field('見出し', 'input', value.heading, {'data-field': 'heading', maxlength: 200});
  const paragraphs = field('本文（空行で段落を分ける）', 'textarea', array(value.paragraphs).join('\n\n'), {'data-field': 'paragraphs', rows: 5});
  const steps = field('実施手順（1行に1項目・任意）', 'textarea', array(value.steps).join('\n'), {'data-field': 'steps', rows: 3});
  section.append(heading.wrapper, paragraphs.wrapper, steps.wrapper, button('この節を削除', () => { section.remove(); markDirty(); }));
  $('growth-edit-sections').append(section);
}
function addSource(value = {}) {
  const section = node('fieldset'); section.dataset.source = 'true'; section.append(node('legend', '根拠資料'));
  const title = field('資料・ページ名', 'input', value.title, {'data-field': 'title', maxlength: 300});
  const url = field('公開されている出典URL', 'input', value.url, {'data-field': 'url', type: 'url', maxlength: 2000, placeholder: 'https://'});
  const dateInput = field('内容を確認した日', 'input', value.checkedAt, {'data-field': 'checkedAt', type: 'date'});
  const scope = field('資料の対象範囲', 'input', value.geographicScope, {'data-field': 'geographicScope', maxlength: 200, placeholder: '例：三重県全体、名張市、全国'});
  const columns = node('div', null, 'kw-form-grid'); columns.append(dateInput.wrapper, scope.wrapper);
  section.append(title.wrapper, url.wrapper, columns, button('この出典を削除', () => { section.remove(); markDirty(); }));
  $('growth-edit-sources').append(section);
}
function editorType() {
  const city = $('growth-edit-type').value === 'city';
  $('growth-edit-city-wrap').hidden = !city; $('growth-edit-slug-wrap').hidden = city; $('growth-related-cities').hidden = city;
  $('growth-edit-city').required = city; $('growth-edit-slug').required = !city;
  const slug = city ? $('growth-edit-city').value : $('growth-edit-slug').value;
  $('growth-edit-url').textContent = slug ? `https://layr.co.jp/service/ltori/${city ? 'area' : 'media'}/${slug}/` : 'URLは保存すると確定します。';
}
function localDateTime(iso) { if (!iso || !Number.isFinite(Date.parse(iso))) return ''; return new Date(Date.parse(iso) + 9 * 60 * 60000).toISOString().slice(0, 16); }
function openEditor(doc = null) {
  editDoc = doc; dirty = false; $('growth-editor-form').reset(); $('growth-editor-error').hidden = true;
  $('growth-editor-title').textContent = doc ? '原稿を編集' : '原稿を作成';
  $('growth-edit-type').value = doc?.type || 'city'; $('growth-edit-type').disabled = !!doc;
  const catalog = array(data.catalog);
  $('growth-edit-city').replaceChildren(option('', '市を選んでください'), ...catalog.map(city => option(city.slug, city.fullName || city.name)));
  $('growth-edit-city').value = doc?.type === 'city' ? doc.slug : ''; $('growth-edit-city').disabled = !!doc;
  $('growth-edit-slug').value = doc?.type === 'article' ? doc.slug : ''; $('growth-edit-slug').readOnly = !!doc;
  for (const key of ['title', 'description', 'heading', 'lead', 'intent']) $(`growth-edit-${key}`).value = doc?.[key] || (key === 'intent' ? 'unknown' : '');
  $('growth-edit-scheduled').value = localDateTime(doc?.scheduledAt);
  $('growth-edit-example-title').value = doc?.example?.title || ''; $('growth-edit-example-body').value = doc?.example?.body || '';
  $('growth-edit-sections').replaceChildren(); for (const section of doc?.sections?.length ? doc.sections : [{}, {}, {}]) addSection(section);
  $('growth-edit-sources').replaceChildren(); for (const source of doc?.sources?.length ? doc.sources : [{}]) addSource(source);
  $('growth-edit-related').replaceChildren();
  for (let i = 0; i < 3; i++) {
    const wrapper = node('label', `関連する市 ${i + 1}`), select = node('select'); select.append(option('', '紹介しない'), ...catalog.map(city => option(city.slug, city.fullName || city.name))); select.value = doc?.relatedCitySlugs?.[i] || ''; wrapper.append(select); $('growth-edit-related').append(wrapper);
  }
  const issues = array(doc?.qualityIssues || doc?.issues); $('growth-edit-issues').replaceChildren();
  for (const issue of issues) $('growth-edit-issues').append(node('li', `${issue.severity === 'warning' ? '確認：' : ''}${issue.message}`));
  if (!issues.length) $('growth-edit-issues').append(node('li', doc ? '保存済みの原稿です。プレビューで地域情報・出典・具体策を確認してください。' : '下書きを保存すると、公開に必要な項目を確認できます。'));
  editorType(); updateEditorActions(); if (!$('growth-editor').open) $('growth-editor').showModal();
}
function collectDocument() {
  const type = $('growth-edit-type').value, scheduled = $('growth-edit-scheduled').value;
  const result = {type, slug: type === 'city' ? $('growth-edit-city').value : $('growth-edit-slug').value.trim()};
  for (const key of ['title', 'description', 'heading', 'lead', 'intent']) result[key] = $(`growth-edit-${key}`).value.trim();
  result.sections = [...$('growth-edit-sections').children].map(element => ({
    heading: element.querySelector('[data-field="heading"]').value.trim(),
    paragraphs: element.querySelector('[data-field="paragraphs"]').value.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean),
    steps: element.querySelector('[data-field="steps"]').value.split('\n').map(value => value.trim()).filter(Boolean),
  }));
  result.sources = [...$('growth-edit-sources').children].map(element => Object.fromEntries(['title', 'url', 'checkedAt', 'geographicScope'].map(key => [key, element.querySelector(`[data-field="${key}"]`).value.trim()])));
  result.example = {label: '作例', title: $('growth-edit-example-title').value.trim(), body: $('growth-edit-example-body').value.trim()};
  result.relatedCitySlugs = type === 'article' ? [...new Set([...$('growth-edit-related').querySelectorAll('select')].map(element => element.value).filter(Boolean))] : [];
  result.scheduledAt = scheduled ? new Date(`${scheduled}:00+09:00`).toISOString() : '';
  if (editDoc) result.id = editDoc.id;
  return result;
}
function updateEditorActions() {
  const saved = !!editDoc && !dirty;
  $('growth-editor-preview').hidden = !saved;
  if (editDoc) $('growth-editor-preview').href = `/api/seo/preview?id=${encodeURIComponent(editDoc.id)}`;
  $('growth-editor-approve').disabled = !saved || pending || ['approved', 'scheduled', 'published'].includes(editDoc?.status);
  $('growth-editor-save-hint').textContent = dirty ? '変更はまだ保存されていません。保存後にプレビュー・承認へ進めます。' : editDoc?.status === 'published' ? '公開中の原稿です。編集を保存すると再承認が必要になります。公開済みの版は次の公開まで維持されます。' : saved ? 'プレビューで本文と出典を確認し、問題がなければ公開待ちに追加してください。' : '編集内容を保存してから、プレビュー・承認に進みます。';
}
function closeEditor() {
  if (pending) return;
  if (dirty && !confirm('保存していない原稿の変更を破棄して閉じますか？')) return;
  $('growth-editor').close(); editDoc = null; dirty = false;
}
async function pauseDocument(doc) {
  if (!confirm(doc.status === 'published' ? 'このページの公開を停止しますか？再公開には承認が必要です。' : 'この原稿を公開待ちから外しますか？')) return;
  await operation(async () => { await api(`/documents/${encodeURIComponent(doc.id)}/pause`, {version: doc.version}); await refresh(); }, '公開待ち・公開状態を更新しました。');
}
function openLead(lead = null) {
  editLead = lead; leadDirty = false; $('growth-lead-form').reset(); $('growth-lead-error').hidden = true;
  $('growth-lead-editor-title').textContent = lead ? '商談記録を更新' : '商談記録を追加';
  $('growth-lead-reference').value = lead?.reference || ''; $('growth-lead-status').value = lead?.stage || 'inquiry';
  $('growth-lead-date').value = day(lead?.createdAt); $('growth-lead-path').value = lead?.sourcePath || '';
  $('growth-lead-date').readOnly = !!lead;
  $('growth-lead-value').value = lead?.revenueYen ?? ''; $('growth-lead-profit').value = lead?.grossProfitYen ?? '';
  $('growth-lead-editor').showModal();
}
function closeLead() { if (pending) return; if (leadDirty && !confirm('保存していない商談記録の変更を破棄して閉じますか？')) return; $('growth-lead-editor').close(); editLead = null; leadDirty = false; }

async function initialize() {
  if (!await startAccessSession()) return;
  for (const element of document.querySelectorAll('[data-growth-tab]')) element.addEventListener('click', () => switchTab(element.dataset.growthTab));
  $('growth-refresh').addEventListener('click', () => operation(refresh, '最新の運用情報を取得しました。'));
  $('growth-pause').addEventListener('click', () => operation(async () => { await api('/settings', {paused: !data.settings.paused}); await refresh(); }, '自動公開の設定を保存しました。'));
  $('growth-sync').addEventListener('click', () => operation(async () => { await api('/sync', {}); await refresh(); switchTab('health'); }, '取得処理が完了しました。接続ごとの結果をご確認ください。'));
  $('growth-inspect').addEventListener('click', () => operation(async () => { await api('/inspect', {}); await refresh(); }, '点検処理が完了しました。各ページの結果をご確認ください。'));
  $('growth-backup').addEventListener('click', () => operation(async () => {
    const backup = await api('/backup'), url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'}));
    const anchor = node('a'); anchor.href = url; anchor.download = `eltori-growth-backup-${day()}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, '原稿・商談記録のバックアップを保存しました。'));
  for (const id of ['growth-document-search', 'growth-document-status', 'growth-document-type']) $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', () => { documentPage = 1; renderDocuments(); });
  $('growth-documents-prev').addEventListener('click', () => { documentPage--; renderDocuments(); }); $('growth-documents-next').addEventListener('click', () => { documentPage++; renderDocuments(); });
  $('growth-lead-search').addEventListener('input', renderLeads); $('growth-lead-stage').addEventListener('change', renderLeads);
  $('growth-new-document').addEventListener('click', () => openEditor()); $('growth-editor-close').addEventListener('click', closeEditor);
  $('growth-editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  $('growth-editor-form').addEventListener('input', markDirty); $('growth-editor-form').addEventListener('change', markDirty);
  for (const id of ['growth-edit-type', 'growth-edit-city', 'growth-edit-slug']) $(id).addEventListener('change', editorType);
  $('growth-add-section').addEventListener('click', () => { addSection(); markDirty(); }); $('growth-add-source').addEventListener('click', () => { addSource(); markDirty(); });
  $('growth-editor-form').addEventListener('submit', event => {
    event.preventDefault(); $('growth-editor-error').hidden = true;
    void operation(async () => {
      const document = collectDocument(), id = `${document.type}:${document.slug}`;
      await api('/documents', {document, ...(editDoc ? {expectedVersion: editDoc.version} : {})});
      await refresh(); const saved = data.documents.find(item => item.id === id); if (!saved) throw new Error('保存後の原稿を確認できません。最新情報を再取得してください。');
      dirty = false; openEditor(saved);
    }, '下書きをサーバーに保存しました。', 'growth-editor-error');
  });
  $('growth-editor-approve').addEventListener('click', () => {
    if (!editDoc || dirty) return;
    if (!confirm('プレビューと出典を確認しましたか？承認すると、公開希望日時以降に1日10本の上限内で自動公開されます。')) return;
    void operation(async () => { await api(`/documents/${encodeURIComponent(editDoc.id)}/approve`, {version: editDoc.version}); await refresh(); openEditor(data.documents.find(item => item.id === editDoc.id)); }, '原稿を承認しました。公開待ちに追加しています。', 'growth-editor-error');
  });
  $('growth-new-lead').addEventListener('click', () => openLead()); $('growth-lead-close').addEventListener('click', closeLead);
  $('growth-lead-editor').addEventListener('cancel', event => { event.preventDefault(); closeLead(); }); $('growth-lead-form').addEventListener('input', () => { leadDirty = true; });
  $('growth-lead-form').addEventListener('submit', event => {
    event.preventDefault(); $('growth-lead-error').hidden = true;
    void operation(async () => {
      const lead = {reference: $('growth-lead-reference').value.trim(), stage: $('growth-lead-status').value, sourcePath: $('growth-lead-path').value.trim(), createdAt: editLead?.createdAt || new Date(`${$('growth-lead-date').value}T00:00:00+09:00`).toISOString(), revenueYen: $('growth-lead-value').value === '' ? null : Number($('growth-lead-value').value), grossProfitYen: $('growth-lead-profit').value === '' ? null : Number($('growth-lead-profit').value)};
      if (editLead) lead.id = editLead.id;
      await api('/leads', {lead, ...(editLead ? {expectedVersion: editLead.version} : {})}); await refresh(); leadDirty = false; $('growth-lead-editor').close(); editLead = null;
    }, '商談記録をサーバーに保存しました。', 'growth-lead-error');
  });
  window.addEventListener('beforeunload', event => { if (dirty || leadDirty) { event.preventDefault(); event.returnValue = ''; } });
  await operation(refresh);
}

void initialize();
