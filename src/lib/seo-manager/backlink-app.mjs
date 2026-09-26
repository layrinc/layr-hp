import {formatNumber, node, workspaceApi} from './workspace-client.mjs';
import {BACKLINK_STATUS, PROFILE_FIELDS, ACTIVE_STATUSES, entryFor, filterSites, summarize, validateBacklinkState, duplicateOf, isRecommended, allSites} from './backlink-model.mjs';
import {csvString} from './model.mjs';

const $ = id => document.getElementById(id);
const sites = JSON.parse($('bl-sites').textContent);
const ENTRY_KEYS = ['status', 'appliedAt', 'liveAt', 'liveUrl', 'account', 'nextAction', 'reason', 'notes'];
const pageSize = 30;
let state = null, ready = false, busy = false, page = 1, selected = null, dirty = false;

function message(text, target = 'bl-message') { $(target).textContent = text; $(target).hidden = false; }
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const filters = () => ({search: $('bl-search').value, status: $('bl-status').value, recommend: $('bl-recommend').value, cost: $('bl-cost').value, eligible: $('bl-eligible').value, sort: $('bl-sort').value});
function outLink(label, href) { const link = node('a', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }

function renderStats() {
  const summary = summarize(sites, state);
  $('bl-live-month').textContent = ready ? `${summary.liveThisMonth}` : '—';
  $('bl-target').textContent = `目標 月${summary.target}件${ready ? `（残り${Math.max(0, summary.target - summary.liveThisMonth)}件）` : ''}`;
  $('bl-active').textContent = ready ? formatNumber(summary.active) : '—';
  $('bl-applied-month').textContent = ready ? `今月の申請 ${summary.appliedThisMonth}件` : '今月の申請 —件';
  $('bl-live').textContent = ready ? formatNumber(summary.counts.live) : '—';
  $('bl-rejected').textContent = ready ? `NG ${summary.counts.rejected}件・保留 ${summary.counts.hold}件` : 'NG・保留 —件';
  $('bl-total').textContent = formatNumber(summary.total);
}

function renderProfile() {
  const body = $('bl-profile');
  if (!ready) { const row = node('tr'), cell = node('td', '会社情報を読み込めていません。'); cell.colSpan = 2; row.append(cell); body.replaceChildren(row); return; }
  body.replaceChildren(...PROFILE_FIELDS.map(field => {
    const value = state.profile[field.key] || '', row = node('tr'), action = node('td');
    action.append(node('span', value || '未入力'), ' ');
    row.append(node('th', field.label));
    row.firstChild.scope = 'row';
    if (value) {
      const copy = node('button', 'コピー', 'kw-button'); copy.type = 'button';
      copy.setAttribute('aria-label', `${field.label}をコピー`);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(value); copy.textContent = '済'; setTimeout(() => { copy.textContent = 'コピー'; }, 1500); }
        catch { message('コピーできませんでした。文字を選択してコピーしてください。'); }
      });
      action.append(copy);
    }
    row.append(action);
    return row;
  }));
}

function render() {
  const list = filterSites(sites, state, filters()), maxPage = Math.max(1, Math.ceil(list.length / pageSize));
  page = Math.max(1, Math.min(page, maxPage));
  $('bl-rows').replaceChildren(...list.slice((page - 1) * pageSize, page * pageSize).map(({site, entry}) => {
    const row = node('tr'), name = node('td', undefined, 'workspace-article-title');
    name.append(outLink(site.name, site.url), node('small', `${site.custom ? '追加' : `No.${Number(site.id.slice(1))}`}${isRecommended(site) ? `｜${site.recommend.replace(/^\d\.?/, '')}` : ''}`));
    if (site.formUrl) name.append(node('small'), outLink('登録フォーム ↗', site.formUrl));
    const status = node('td'); status.append(node('span', ready ? BACKLINK_STATUS[entry.status] : '未取得', `kw-tag${ACTIVE_STATUSES.includes(entry.status) || entry.status === 'live' ? ' is-active' : ''}`));
    if (entry.appliedAt) status.append(node('br'), node('small', `申請 ${entry.appliedAt}`));
    if (entry.liveAt) status.append(node('br'), node('small', `掲載 ${entry.liveAt}`));
    const conditions = node('td'); conditions.append(node('span', site.eligible || '未記載'));
    if (site.condition && site.condition !== 'なし') conditions.append(node('br'), node('small', site.condition));
    const next = node('td', entry.nextAction || (entry.status === 'rejected' ? entry.reason : '') || '—');
    const action = node('td'), button = node('button', '記録', 'kw-button'); button.type = 'button'; button.disabled = busy || !ready;
    button.addEventListener('click', () => openEditor(site)); action.append(button);
    row.append(name, status, node('td', `${site.cost || '未確認'} / ${site.follow || '—'}`), conditions, node('td', site.method || '—'), next, action);
    return row;
  }));
  $('bl-empty').hidden = list.length > 0; $('bl-page').textContent = `${page} / ${maxPage}`;
  $('bl-prev').disabled = page === 1; $('bl-next').disabled = page === maxPage;
  $('bl-count').textContent = `${list.length}件 / 全${allSites(sites, state).length}件`;
  for (const id of ['bl-export', 'bl-add', 'bl-profile-edit']) $(id).disabled = busy || !ready;
  renderStats(); renderProfile();
}

function setBusy(value) {
  busy = value;
  for (const id of ['bl-refresh', 'bl-save', 'bl-close', 'bl-profile-save', 'bl-add-save']) $(id).disabled = value;
  for (const id of ['bl-form', 'bl-profile-form', 'bl-add-form']) $(id).inert = value;
  render();
}

async function refresh() {
  if (busy || document.querySelector('dialog[open]')) return;
  setBusy(true); $('bl-message').hidden = true;
  try {
    const data = await workspaceApi('/backlinks/state');
    state = validateBacklinkState(data.state, sites); ready = true;
    $('bl-saved').textContent = state.revision ? `申請状況をサーバーから読み込みました（更新番号 ${state.revision}）。別の端末でも共有できます。` : 'まだ保存された申請状況はありません。最初の記録から共有保存されます。';
  } catch (error) {
    ready = false; $('bl-saved').textContent = '申請状況を確認できないため、編集を停止しています。最新の情報に更新してください。'; message(error.message);
  } finally { setBusy(false); }
}

async function persist(next, target) {
  const checked = validateBacklinkState({...next, revision: state.revision}, sites);
  const result = await workspaceApi('/backlinks/state', {method: 'PUT', body: {expectedRevision: state.revision, state: {goal: checked.goal, profile: checked.profile, entries: checked.entries, custom: checked.custom}}});
  state = validateBacklinkState(result.state, sites);
  $('bl-saved').textContent = `申請状況をサーバーに保存しました（更新番号 ${state.revision}）。`;
  if (target) message(target);
}

function openEditor(site) {
  if (!ready || busy) return;
  selected = site; dirty = false; $('bl-editor-message').hidden = true;
  const entry = entryFor(state, site.id);
  $('bl-editor-site').textContent = `${site.name}｜${site.cost || '費用未確認'}・${site.eligible || '対象未記載'}${site.condition && site.condition !== 'なし' ? `・${site.condition}` : ''}`;
  $('bl-editor-links').replaceChildren(outLink('サイトを開く ↗', site.url), ...(site.formUrl ? [' ', outLink('登録フォームを開く ↗', site.formUrl)] : []));
  for (const key of ENTRY_KEYS) $(`bl-edit-${key}`).value = entry[key];
  $('bl-editor').showModal(); $('bl-edit-status').focus();
}
function closeDialog(id) {
  if (busy) return;
  if (dirty && !window.confirm('保存していない入力があります。保存せずに閉じますか？')) return;
  $(id).close(); selected = null; dirty = false;
}

async function saveEntry(event) {
  event.preventDefault(); if (busy || !ready || !selected) return;
  const entry = Object.fromEntries(ENTRY_KEYS.map(key => [key, $(`bl-edit-${key}`).value]));
  if (['applied', 'contact'].includes(entry.status) && !entry.appliedAt) entry.appliedAt = today();
  if (entry.status === 'live' && !entry.liveAt) entry.liveAt = today();
  entry.updatedAt = new Date().toISOString();
  setBusy(true); $('bl-editor-message').hidden = true;
  try {
    const name = selected.name;
    await persist({...state, entries: {...state.entries, [selected.id]: entry}}, `${name}の申請状況を保存しました。`);
    dirty = false; selected = null; $('bl-editor').close();
  } catch (error) { message(error.message, 'bl-editor-message'); }
  finally { setBusy(false); }
}

function openProfile() {
  if (!ready || busy) return; dirty = false; $('bl-profile-message').hidden = true;
  $('bl-goal').value = state.goal.monthlyTarget;
  for (const field of PROFILE_FIELDS) $(`bl-profile-${field.key}`).value = state.profile[field.key] || '';
  $('bl-profile-dialog').showModal(); $('bl-goal').focus();
}
async function saveProfile(event) {
  event.preventDefault(); if (busy || !ready) return;
  const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field.key, $(`bl-profile-${field.key}`).value]));
  setBusy(true); $('bl-profile-message').hidden = true;
  try {
    await persist({...state, profile, goal: {monthlyTarget: Number($('bl-goal').value)}}, '会社情報を保存しました。');
    dirty = false; $('bl-profile-dialog').close();
  } catch (error) { message(error.message, 'bl-profile-message'); }
  finally { setBusy(false); }
}

function openAdd() {
  if (!ready || busy) return; dirty = false; $('bl-add-message').hidden = true; $('bl-add-form').reset();
  $('bl-add-dialog').showModal(); $('bl-add-name').focus();
}
async function saveAdd(event) {
  event.preventDefault(); if (busy || !ready) return;
  const site = Object.fromEntries(['name', 'url', 'formUrl', 'cost', 'eligible', 'method', 'follow', 'condition'].map(key => [key, $(`bl-add-${key}`).value]));
  const duplicate = duplicateOf(sites, state, site.url);
  if (duplicate) { message(`同じドメインの申請先「${duplicate.name}」がすでにあります。重複申請を避けるため、そちらに記録してください。`, 'bl-add-message'); return; }
  site.id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  setBusy(true); $('bl-add-message').hidden = true;
  try {
    await persist({...state, custom: [...state.custom, site]}, `${site.name}を申請先に追加しました。`);
    dirty = false; $('bl-add-dialog').close();
  } catch (error) { message(error.message, 'bl-add-message'); }
  finally { setBusy(false); }
}

function exportRows() {
  const matrix = [['No', 'サイト名', 'URL', '登録フォーム', '登録推奨', '費用', 'follow', '登録できる対象', '登録条件', '登録方法', 'ステータス', '申請日', '掲載確認日', '掲載URL', '登録ID・メール', '次のアクション', 'NG・保留の理由', 'メモ', '最終更新'],
    ...filterSites(sites, state, filters()).map(({site, entry}) => [site.custom ? '追加' : Number(site.id.slice(1)), site.name, site.url, site.formUrl, site.recommend, site.cost, site.follow, site.eligible, site.condition, site.method, BACKLINK_STATUS[entry.status], entry.appliedAt, entry.liveAt, entry.liveUrl, entry.account, entry.nextAction, entry.reason, entry.notes, entry.updatedAt])];
  const url = URL.createObjectURL(new Blob(['﻿', csvString(matrix)], {type: 'text/csv;charset=utf-8'}));
  const link = node('a'); link.href = url; link.download = `layr-backlink-applications-${today()}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const id of ['bl-search', 'bl-status', 'bl-recommend', 'bl-cost', 'bl-eligible', 'bl-sort']) $(id).addEventListener(id === 'bl-search' ? 'input' : 'change', () => { page = 1; render(); });
$('bl-refresh').addEventListener('click', () => void refresh());
$('bl-prev').addEventListener('click', () => { page--; render(); });
$('bl-next').addEventListener('click', () => { page++; render(); });
$('bl-export').addEventListener('click', exportRows);
$('bl-profile-edit').addEventListener('click', openProfile);
$('bl-add').addEventListener('click', openAdd);
for (const [dialog, close, form, submit] of [['bl-editor', 'bl-close', 'bl-form', saveEntry], ['bl-profile-dialog', 'bl-profile-close', 'bl-profile-form', saveProfile], ['bl-add-dialog', 'bl-add-close', 'bl-add-form', saveAdd]]) {
  $(close).addEventListener('click', () => closeDialog(dialog));
  $(dialog).addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
  $(form).addEventListener('input', () => { dirty = true; });
  $(form).addEventListener('submit', event => void submit(event));
}
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
render();
void refresh();
