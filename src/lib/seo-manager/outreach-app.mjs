import {formatNumber, node, workspaceApi} from './workspace-client.mjs';
import {OUTREACH_STATUS, ACTIVE_OUTREACH, CHANNELS, outreachEntryFor, filterOutreach, summarizeOutreach, validateOutreachState, duplicateOutreach, allOutreachSites} from './outreach-model.mjs';
import {csvString} from './model.mjs';

const $ = id => document.getElementById(id);
const sites = JSON.parse($('or-sites').textContent);
const ENTRY_KEYS = ['status', 'sentAt', 'liveAt', 'liveUrl', 'targetUrl', 'nextAction', 'reason', 'notes'];
const pageSize = 30;
let state = null, ready = false, busy = false, page = 1, selected = null, dirty = false;

function message(text, target = 'or-message') { $(target).textContent = text; $(target).hidden = false; }
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const filters = () => ({search: $('or-search').value, status: $('or-status').value, genre: $('or-genre').value, channel: $('or-channel').value, sort: $('or-sort').value});
function outLink(label, href) { const link = node('a', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }

function renderStats() {
  const summary = summarizeOutreach(sites, state);
  $('or-sent-month').textContent = ready ? `${summary.sentThisMonth}` : '—';
  $('or-target').textContent = `目標 月${summary.target}件${ready ? `（残り${Math.max(0, summary.target - summary.sentThisMonth)}件）` : ''}`;
  $('or-active').textContent = ready ? formatNumber(summary.active) : '—';
  $('or-reply-rate').textContent = ready && summary.replyRate !== null ? `返信率 ${Math.round(summary.replyRate * 100)}%` : '返信率 —（送信後に表示）';
  $('or-live').textContent = ready ? formatNumber(summary.counts.live) : '—';
  $('or-live-month').textContent = ready ? `今月 ${summary.liveThisMonth}件` : '今月 —件';
  $('or-total').textContent = formatNumber(summary.total);
}

function renderGenres() {
  const select = $('or-genre'), current = select.value;
  const genres = summarizeOutreach(sites, state).genres;
  select.replaceChildren(node('option', 'すべて'), ...genres.map(genre => node('option', genre)));
  select.firstChild.value = '';
  for (const option of [...select.options].slice(1)) option.value = option.textContent;
  select.value = genres.includes(current) ? current : '';
}

function renderTemplate() {
  $('or-template-subject').value = ready ? state.template.subject : '';
  $('or-template-body').value = ready ? state.template.body : '送信文を読み込み中です。';
}

function render() {
  const list = filterOutreach(sites, state, filters()), maxPage = Math.max(1, Math.ceil(list.length / pageSize));
  page = Math.max(1, Math.min(page, maxPage));
  $('or-rows').replaceChildren(...list.slice((page - 1) * pageSize, page * pageSize).map(({site, entry}) => {
    const row = node('tr'), name = node('td', undefined, 'workspace-article-title');
    name.append(outLink(site.name, site.url), node('small', `${site.custom ? '追加' : `No.${Number(site.id.slice(1))}`}${site.genre ? `｜${site.genre}` : ''}`));
    const channel = node('td'); channel.append(node('span', CHANNELS[site.channel] || '未確認'));
    if (site.contactUrl) channel.append(node('br'), outLink('問い合わせ先 ↗', site.contactUrl));
    const status = node('td'); status.append(node('span', ready ? OUTREACH_STATUS[entry.status] : '未取得', `kw-tag${ACTIVE_OUTREACH.includes(entry.status) || entry.status === 'live' ? ' is-active' : ''}`));
    if (entry.sentAt) status.append(node('br'), node('small', `送信 ${entry.sentAt}`));
    if (entry.liveAt) status.append(node('br'), node('small', `掲載 ${entry.liveAt}`));
    const next = node('td', entry.nextAction || (entry.status === 'declined' ? entry.reason : '') || '—');
    const action = node('td'), button = node('button', '記録', 'kw-button'); button.type = 'button'; button.disabled = busy || !ready;
    button.addEventListener('click', () => openEditor(site)); action.append(button);
    row.append(name, channel, status, node('td', site.custom ? '—' : site.sourceStatus || '—'), next, action);
    return row;
  }));
  $('or-empty').hidden = list.length > 0; $('or-page').textContent = `${page} / ${maxPage}`;
  $('or-prev').disabled = page === 1; $('or-next').disabled = page === maxPage;
  $('or-count').textContent = `${list.length}件 / 全${allOutreachSites(sites, state).length}件`;
  for (const id of ['or-export', 'or-add', 'or-template-edit', 'or-copy-subject', 'or-copy-body']) $(id).disabled = busy || !ready;
  renderStats();
}

function setBusy(value) {
  busy = value;
  for (const id of ['or-refresh', 'or-save', 'or-close', 'or-template-save', 'or-add-save']) $(id).disabled = value;
  for (const id of ['or-form', 'or-template-form', 'or-add-form']) $(id).inert = value;
  render();
}

async function refresh() {
  if (busy || document.querySelector('dialog[open]')) return;
  setBusy(true); $('or-message').hidden = true;
  try {
    const data = await workspaceApi('/outreach/state');
    state = validateOutreachState(data.state, sites); ready = true;
    $('or-saved').textContent = state.revision ? `営業状況をサーバーから読み込みました（更新番号 ${state.revision}）。別の端末でも共有できます。` : 'まだ保存された営業状況はありません。最初の記録から共有保存されます。';
  } catch (error) {
    ready = false; $('or-saved').textContent = '営業状況を確認できないため、編集を停止しています。最新の情報に更新してください。'; message(error.message);
  } finally { renderGenres(); renderTemplate(); setBusy(false); }
}

async function persist(next, done) {
  const checked = validateOutreachState({...next, revision: state.revision}, sites);
  const result = await workspaceApi('/outreach/state', {method: 'PUT', body: {expectedRevision: state.revision, state: {goal: checked.goal, template: checked.template, entries: checked.entries, custom: checked.custom}}});
  state = validateOutreachState(result.state, sites);
  $('or-saved').textContent = `営業状況をサーバーに保存しました（更新番号 ${state.revision}）。`;
  renderGenres(); renderTemplate();
  if (done) message(done);
}

function openEditor(site) {
  if (!ready || busy) return;
  selected = site; dirty = false; $('or-editor-message').hidden = true;
  const entry = outreachEntryFor(state, site.id);
  $('or-editor-site').textContent = `${site.name}｜${site.genre || 'ジャンル未設定'}・${CHANNELS[site.channel] || '連絡手段未確認'}${site.custom ? '' : `・提供元での状況：${site.sourceStatus || '—'}`}`;
  $('or-editor-links').replaceChildren(outLink('サイトを開く ↗', site.url), ...(site.contactUrl ? [' ', outLink('問い合わせ先を開く ↗', site.contactUrl)] : []));
  for (const key of ENTRY_KEYS) $(`or-edit-${key}`).value = entry[key];
  $('or-editor').showModal(); $('or-edit-status').focus();
}
function closeDialog(id) {
  if (busy) return;
  if (dirty && !window.confirm('保存していない入力があります。保存せずに閉じますか？')) return;
  $(id).close(); selected = null; dirty = false;
}

async function saveEntry(event) {
  event.preventDefault(); if (busy || !ready || !selected) return;
  const entry = Object.fromEntries(ENTRY_KEYS.map(key => [key, $(`or-edit-${key}`).value]));
  if (['sent', 'replied', 'live'].includes(entry.status) && !entry.sentAt) entry.sentAt = today();
  if (entry.status === 'live' && !entry.liveAt) entry.liveAt = today();
  entry.updatedAt = new Date().toISOString();
  setBusy(true); $('or-editor-message').hidden = true;
  try {
    await persist({...state, entries: {...state.entries, [selected.id]: entry}}, `${selected.name}の営業状況を保存しました。`);
    dirty = false; selected = null; $('or-editor').close();
  } catch (error) { message(error.message, 'or-editor-message'); }
  finally { setBusy(false); }
}

function openTemplate() {
  if (!ready || busy) return; dirty = false; $('or-template-message').hidden = true;
  $('or-goal').value = state.goal.monthlySends;
  $('or-template-edit-subject').value = state.template.subject; $('or-template-edit-body').value = state.template.body;
  $('or-template-dialog').showModal(); $('or-goal').focus();
}
async function saveTemplate(event) {
  event.preventDefault(); if (busy || !ready) return;
  setBusy(true); $('or-template-message').hidden = true;
  try {
    await persist({...state, goal: {monthlySends: Number($('or-goal').value)}, template: {subject: $('or-template-edit-subject').value, body: $('or-template-edit-body').value}}, 'テンプレートと目標を保存しました。');
    dirty = false; $('or-template-dialog').close();
  } catch (error) { message(error.message, 'or-template-message'); }
  finally { setBusy(false); }
}

function openAdd() {
  if (!ready || busy) return; dirty = false; $('or-add-message').hidden = true; $('or-add-form').reset();
  $('or-add-dialog').showModal(); $('or-add-name').focus();
}
async function saveAdd(event) {
  event.preventDefault(); if (busy || !ready) return;
  const site = Object.fromEntries(['name', 'url', 'genre', 'channel', 'contactUrl'].map(key => [key, $(`or-add-${key}`).value]));
  const duplicate = duplicateOutreach(sites, state, site.url);
  if (duplicate) { message(`同じドメインの営業先「${duplicate.name}」がすでにあります。重複して連絡しないよう、そちらに記録してください。`, 'or-add-message'); return; }
  site.id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  setBusy(true); $('or-add-message').hidden = true;
  try {
    await persist({...state, custom: [...state.custom, site]}, `${site.name}を営業先に追加しました。`);
    dirty = false; $('or-add-dialog').close();
  } catch (error) { message(error.message, 'or-add-message'); }
  finally { setBusy(false); }
}

async function copy(value, button, label) {
  try { await navigator.clipboard.writeText(value); button.textContent = 'コピーしました'; setTimeout(() => { button.textContent = label; }, 1500); }
  catch { message('コピーできませんでした。文字を選択してコピーしてください。'); }
}

function exportRows() {
  const matrix = [['No', 'サイト名', 'URL', 'ジャンル・検索ワード', '連絡手段', '問い合わせ先', '提供元での状況', 'LAYRの状況', '送信日', '掲載確認日', '掲載URL', 'リンクしてほしいページ', '次のアクション', '断り・保留の理由', 'メモ', '最終更新'],
    ...filterOutreach(sites, state, filters()).map(({site, entry}) => [site.custom ? '追加' : Number(site.id.slice(1)), site.name, site.url, site.genre, CHANNELS[site.channel] || '', site.contactUrl, site.sourceStatus, OUTREACH_STATUS[entry.status], entry.sentAt, entry.liveAt, entry.liveUrl, entry.targetUrl, entry.nextAction, entry.reason, entry.notes, entry.updatedAt])];
  const url = URL.createObjectURL(new Blob(['﻿', csvString(matrix)], {type: 'text/csv;charset=utf-8'}));
  const link = node('a'); link.href = url; link.download = `layr-backlink-outreach-${today()}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const id of ['or-search', 'or-status', 'or-genre', 'or-channel', 'or-sort']) $(id).addEventListener(id === 'or-search' ? 'input' : 'change', () => { page = 1; render(); });
$('or-refresh').addEventListener('click', () => void refresh());
$('or-prev').addEventListener('click', () => { page--; render(); });
$('or-next').addEventListener('click', () => { page++; render(); });
$('or-export').addEventListener('click', exportRows);
$('or-add').addEventListener('click', openAdd);
$('or-template-edit').addEventListener('click', openTemplate);
$('or-copy-subject').addEventListener('click', event => void copy(state.template.subject, event.currentTarget, '件名をコピー'));
$('or-copy-body').addEventListener('click', event => void copy(state.template.body, event.currentTarget, '本文をコピー'));
for (const [dialog, close, form, submit] of [['or-editor', 'or-close', 'or-form', saveEntry], ['or-template-dialog', 'or-template-close', 'or-template-form', saveTemplate], ['or-add-dialog', 'or-add-close', 'or-add-form', saveAdd]]) {
  $(close).addEventListener('click', () => closeDialog(dialog));
  $(dialog).addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
  $(form).addEventListener('input', () => { dirty = true; });
  $(form).addEventListener('submit', event => void submit(event));
}
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
renderGenres(); renderTemplate(); render();
void refresh();
