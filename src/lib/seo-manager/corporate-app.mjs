import {formatNumber, node, workspaceApi, validateOverview, sourceDescription} from './workspace-client.mjs';
import {CORPORATE_STATUS, CORPORATE_PRIORITY, corporateEdit, filterCorporateArticles, validateCorporateState} from './corporate-model.mjs';
import {csvString} from './model.mjs';

const $ = id => document.getElementById(id);
const catalog = JSON.parse($('cp-catalog').textContent);
let state = null, report = null, page = 1, selected = null, busy = false, dirty = false, savedReady = false;
const pageSize = 30;
const project = () => report?.projects.find(item => item.id === 'corporate');
function message(text, target = 'cp-message') { $(target).textContent = text; $(target).hidden = false; }
function rows() { return filterCorporateArticles(catalog, state, project()?.pages || [], {search: $('cp-search').value, status: $('cp-status').value, category: $('cp-category').value, sort: $('cp-sort').value}); }
function render() {
  const list = rows(), maxPage = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.max(1, Math.min(page, maxPage));
  $('cp-rows').replaceChildren(...list.slice((page - 1) * pageSize, page * pageSize).map(article => {
    const row = node('tr'), title = node('td', undefined, 'workspace-article-title');
    const link = node('a', article.title); link.href = `https://layr.co.jp${article.path}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    title.append(link, node('small', `${article.category} / ${article.publishedAt.slice(0, 10)}`), node('small', `キーワード：${article.edit.keyword || '未設定'}`)); row.append(title, node('td', savedReady ? CORPORATE_PRIORITY[article.edit.priority] : '未取得'), node('td', savedReady ? CORPORATE_STATUS[article.edit.status] : '未取得'));
    for (const key of ['views', 'clicks', 'impressions', 'position']) row.append(node('td', formatNumber(article.metrics[key])));
    const action = node('td'), button = node('button', '改善メモを編集', 'kw-button'); button.type = 'button'; button.disabled = busy || !savedReady; button.addEventListener('click', () => openEditor(article)); action.append(button); row.append(action); return row;
  }));
  $('cp-empty').hidden = list.length > 0; $('cp-page').textContent = `${page} / ${maxPage}`; $('cp-prev').disabled = page === 1; $('cp-next').disabled = page === maxPage;
  $('cp-count').textContent = `${list.length}件 / 公開 ${catalog.length}記事`;
  $('cp-views').textContent = formatNumber(project()?.metrics.views); $('cp-clicks').textContent = formatNumber(project()?.metrics.clicks);
  $('cp-active').textContent = savedReady ? formatNumber(catalog.filter(article => ['research', 'rewrite', 'review'].includes(corporateEdit(state, article).status)).length) : '—';
  $('cp-export').disabled = busy || !savedReady;
  if (report) $('cp-period').textContent = `GA4：${sourceDescription(report, 'ga4')}。Search Console：${sourceDescription(report, 'gsc')}。${report.sources.some(source => source.status === 'error') ? '直近の同期でエラーがあります。表示値は保存済みの実績です。' : ''}`;
}
function setBusy(value) { busy = value; $('cp-refresh').disabled = value; $('cp-save').disabled = value; $('cp-close').disabled = value; $('cp-form').inert = value; render(); }
async function refresh() {
  if (busy || $('cp-editor').open) return; setBusy(true); $('cp-message').hidden = true;
  const results = await Promise.allSettled([workspaceApi('/overview').then(validateOverview), workspaceApi('/corporate/state').then(data => validateCorporateState(data.state, catalog))]);
  if (results[0].status === 'fulfilled') report = results[0].value;
  if (results[1].status === 'fulfilled') { state = results[1].value; savedReady = true; $('cp-saved').textContent = `改善メモをサーバーから読み込みました（更新番号 ${state.revision}）。別端末でも共有できます。`; }
  else { savedReady = false; $('cp-saved').textContent = '改善メモを確認できないため、編集を停止しています。最新情報を再取得してください。'; }
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (errors.length) message(`${errors.join(' ')}${report ? ' 実績は前回取得できた内容を保持しています。' : ''}`);
  setBusy(false);
}
function openEditor(article) {
  if (!savedReady || busy) return; selected = article; dirty = false;
  const edit = corporateEdit(state, article); $('cp-editor-article').textContent = article.title; $('cp-editor-message').hidden = true;
  for (const key of ['priority', 'status', 'keyword', 'evidence', 'notes']) $(`cp-edit-${key}`).value = edit[key];
  $('cp-editor').showModal(); $('cp-edit-priority').focus();
}
function closeEditor() { if (busy) return; if (dirty && !window.confirm('未保存の改善メモがあります。保存せずに閉じますか？')) return; $('cp-editor').close(); selected = null; dirty = false; }
async function save(event) {
  event.preventDefault(); if (busy || !savedReady || !selected) return; setBusy(true); $('cp-editor-message').hidden = true;
  try {
    const edit = Object.fromEntries(['priority', 'status', 'keyword', 'evidence', 'notes'].map(key => [key, $(`cp-edit-${key}`).value]));
    const next = {revision: state.revision, edits: {...state.edits, [selected.path]: edit}}; validateCorporateState(next, catalog);
    const result = await workspaceApi('/corporate/state', {method: 'PUT', body: {expectedRevision: state.revision, state: {edits: next.edits}}});
    state = validateCorporateState(result.state, catalog); dirty = false; selected = null; $('cp-editor').close();
    $('cp-saved').textContent = `改善メモをサーバーに保存しました（更新番号 ${state.revision}）。`; message('改善メモを共有保存しました。公開記事の本文は変更していません。');
  } catch (error) { message(error.message, 'cp-editor-message'); }
  finally { setBusy(false); }
}
function exportRows() {
  const matrix = [['記事URL', 'タイトル', '管理キーワード', '優先度', '改善状況', 'PV', '検索クリック', '検索表示', '平均順位', '追加する根拠', '次の作業', 'GA4対象期間', 'GSC対象期間'], ...rows().map(article => [`https://layr.co.jp${article.path}`, article.title, article.edit.keyword, CORPORATE_PRIORITY[article.edit.priority], CORPORATE_STATUS[article.edit.status], ...['views', 'clicks', 'impressions', 'position'].map(key => article.metrics[key] ?? ''), article.edit.evidence, article.edit.notes, report ? sourceDescription(report, 'ga4') : '', report ? sourceDescription(report, 'gsc') : ''])];
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvString(matrix)], {type: 'text/csv;charset=utf-8'})); const link = node('a'); link.href = url; link.download = 'layr-media-seo.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let mounted = false;
export async function mountCorporate() {
  if (mounted) return;
  mounted = true;
  for (const id of ['cp-search', 'cp-status', 'cp-category', 'cp-sort']) $(id).addEventListener(id === 'cp-search' ? 'input' : 'change', () => { page = 1; render(); });
  $('cp-refresh').addEventListener('click', () => void refresh()); $('cp-prev').addEventListener('click', () => { page--; render(); }); $('cp-next').addEventListener('click', () => { page++; render(); });
  $('cp-close').addEventListener('click', closeEditor); $('cp-editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  $('cp-form').addEventListener('input', () => { dirty = true; }); $('cp-form').addEventListener('submit', event => void save(event)); $('cp-export').addEventListener('click', exportRows);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  await refresh();
}
