import {formatTime, node, workspaceApi} from './workspace-client.mjs';
import {AUTHORITY_SOURCES, normalizeAuthority, summarizeAuthority} from './domain-authority-model.mjs';

const $ = id => document.getElementById(id);
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const AUTO_CODES = {unauthorized: 'APIキーを確認してください', rate_limited: '取得回数の上限に達しました', http_error: '取得先がエラーを返しました', not_found: 'データがまだありません', request_failed: '接続できませんでした'};
let state = null, busy = false, dirty = false;

function show(text, target = 'ws-authority-message') { $(target).textContent = text; $(target).hidden = false; }
function render(data) {
  state = {...normalizeAuthority(data.state), revision: data.state.revision};
  for (const row of summarizeAuthority(state)) {
    $(`ws-authority-${row.source}`).textContent = row.latest ? String(row.latest.value) : '未計測';
    const change = row.change === null ? '' : `・前回比 ${row.change > 0 ? '+' : ''}${row.change}`;
    $(`ws-authority-${row.source}-note`).textContent = row.latest ? `測定 ${row.latest.measuredAt}${change}${row.latest.referringDomains !== undefined ? `・参照ドメイン ${row.latest.referringDomains}` : ''}` : AUTHORITY_SOURCES[row.source].how;
  }
  const links = data.backlinks || {}, known = [links.applications, links.outreach].filter(value => Number.isSafeInteger(value));
  $('ws-authority-links').textContent = known.length ? `${known.reduce((sum, value) => sum + value, 0)}件` : '—';
  $('ws-authority-links-note').textContent = `被リンク申請 ${Number.isSafeInteger(links.applications) ? `${links.applications}件` : '—'}・被リンク営業 ${Number.isSafeInteger(links.outreach) ? `${links.outreach}件` : '—'}`;
  const auto = state.automation;
  $('ws-authority-auto').textContent = !data.configured ? 'Open PageRankの自動取得：未設定です（APIキーを登録すると毎週の点検時に自動で取得します）。Ahrefs DR・Moz DAは確認した値を記録してください。'
    : auto.status === 'ok' ? `Open PageRankの自動取得：毎週の点検時に取得しています（最終成功 ${formatTime(auto.lastSuccessAt)}）。`
      : `Open PageRankの自動取得：直近の取得に失敗しました（${AUTO_CODES[auto.code] || '理由を確認中'}・最終試行 ${formatTime(auto.lastAttemptAt)}）。`;
  const rows = [...state.history].reverse().slice(0, 24).map(row => {
    const tr = node('tr'); tr.append(node('td', row.measuredAt), node('td', AUTHORITY_SOURCES[row.source].label), node('td', String(row.value)), node('td', row.automatic ? '自動' : '手入力'), node('td', row.note || '—')); return tr;
  });
  if (!rows.length) { const tr = node('tr'), td = node('td', 'まだ記録がありません。「測定値を記録」から最初の値を入力してください。'); td.colSpan = 5; tr.append(td); rows.push(tr); }
  $('ws-authority-history').replaceChildren(...rows);
  $('ws-authority-add').disabled = busy;
}
async function load() {
  try { render(await workspaceApi('/domain-authority')); }
  catch (error) { show(`ドメインパワーを読み込めませんでした。${error.message}`); $('ws-authority-add').disabled = true; }
}
function open() {
  if (!state || busy) return; dirty = false; $('ws-authority-form-message').hidden = true; $('ws-authority-form').reset();
  $('ws-authority-date').value = today(); $('ws-authority-dialog').showModal(); $('ws-authority-value').focus();
}
function close() {
  if (busy) return;
  if (dirty && !window.confirm('保存していない入力があります。保存せずに閉じますか？')) return;
  $('ws-authority-dialog').close(); dirty = false;
}
async function save(event) {
  event.preventDefault(); if (busy || !state) return;
  busy = true; $('ws-authority-save').disabled = true; $('ws-authority-form-message').hidden = true;
  try {
    const measurement = {source: $('ws-authority-source').value, value: Number($('ws-authority-value').value), measuredAt: $('ws-authority-date').value, note: $('ws-authority-note').value};
    await workspaceApi('/domain-authority', {method: 'POST', body: {expectedRevision: state.revision, measurement}});
    dirty = false; $('ws-authority-dialog').close(); show('ドメインパワーを記録しました。'); busy = false; await load();
  } catch (error) { show(error.message, 'ws-authority-form-message'); }
  finally { busy = false; $('ws-authority-save').disabled = false; }
}
$('ws-authority-add').addEventListener('click', open);
$('ws-authority-close').addEventListener('click', close);
$('ws-authority-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
$('ws-authority-form').addEventListener('input', () => { dirty = true; });
$('ws-authority-form').addEventListener('submit', event => void save(event));
void load();
