import {startAccessSession} from './session.mjs';
import {WORKSPACE_PROJECTS} from './workspace-projects.mjs';
import {formatNumber, formatTime, node, workspaceApi, validateOverview, sourceDescription} from './workspace-client.mjs';
import {openDatabase, loadState} from '../media-manager/storage.mjs';
import {validateMediaBackup, planEdit} from '../media-manager/model.mjs';

const $ = id => document.getElementById(id);
const oldHash = new Set(['#pages', '#keywords', '#tasks', '#analytics', '#data']);
let busy = false, lastReport = null;

async function readLocalPlans(report) {
  let db;
  try {
    db = await openDatabase(); const saved = await loadState(db);
    if (!saved) { $('ws-local-plans').textContent = `採用ノート：標準企画 ${$('ws-local-plans').dataset.seedCount}件。この端末には編集済みの計画がありません。`; return; }
    const state = validateMediaBackup(saved, report.projects.find(project => project.id === 'media').pages);
    const active = state.plans.filter(plan => ['research', 'writing', 'review'].includes(planEdit(state, plan.id).status)).length;
    $('ws-local-plans').textContent = `採用ノート：この端末の企画 ${state.plans.length}件 / 調査・制作・確認中 ${active}件。計画の編集内容はブラウザ保存、アクセス実績はサーバー共有です。`;
  } catch { $('ws-local-plans').textContent = 'この端末の記事計画を読み込めませんでした。サーバーのアクセス実績とは別の保存領域です。採用ノート画面で保存状態をご確認ください。'; }
  finally { db?.close(); }
}
function render(report) {
  for (const key of ['views', 'clicks', 'inquiries']) $(`ws-${key}`).textContent = formatNumber(report.totals[key]);
  $('ws-published').textContent = formatNumber(report.totals.publishedCount);
  for (const definition of WORKSPACE_PROJECTS) {
    const project = report.projects.find(item => item.id === definition.id);
    for (const metric of ['views', 'clicks', 'impressions', 'inquiries']) $(`ws-${project.id}-${metric}`).textContent = formatNumber(project.metrics[metric]);
    $(`ws-${project.id}-published`).textContent = formatNumber(project.publishedCount);
    $(`ws-${project.id}-pending`).textContent = project.id === 'corporate' ? '別画面で確認' : formatNumber(project.pendingCount);
  }
  $('ws-updated').textContent = `サーバーの保存データを表示 / 確認 ${formatTime(report.generatedAt)}。このボタンはGoogleの再取得を行いません。`;
  $('ws-sources').replaceChildren(...['ga4', 'gsc'].map(source => {
    const entry = report.sources.find(item => item.source === source);
    const label = source === 'ga4' ? 'Google アナリティクス' : 'Search Console';
    const statuses = {ok: '取得成功', error: '直近の取得に失敗', running: '取得中', not_configured: '未接続'};
    const item = node('div'); item.append(node('dt', `${label} · ${statuses[entry?.status] || '未取得'}`), node('dd', sourceDescription(report, source)), node('dd', `最終成功 ${formatTime(entry?.lastSuccessAt)}`));
    if (entry?.message) item.append(node('dd', entry.message)); return item;
  }));
  const schedule = report.scheduler?.maintenance;
  $('ws-schedule').textContent = `自動取得は毎日6:17（日本時間、遅れる場合があります）。定期処理の最終成功 ${formatTime(schedule?.lastSuccessAt)}${schedule?.status === 'error' ? '。直近の処理でエラーがあります。' : '。'}`;
  const actions = $('ws-actions'); actions.replaceChildren();
  for (const action of report.actions.slice(0, 8)) {
    const item = node('article'); item.append(node('h3', action.title), node('p', action.reason), node('p', action.nextStep));
    if (typeof action.href === 'string' && /^\/(?:regional|media|articles|growth|strategy)\/(?:[?#][^\s]*)?$/.test(action.href)) { const link = node('a', '確認する →'); link.href = action.href; item.append(link); }
    actions.append(item);
  }
  if (!actions.children.length) actions.append(node('p', '実績からの改善候補はまだありません。共通戦略を確認し、読者の課題と必要な一次情報から企画を進めてください。', 'kw-help'));
  $('ws-notes').replaceChildren(...report.notes.map(text => node('li', text)));
}
async function refresh() {
  if (busy) return; busy = true; $('ws-refresh').disabled = true; $('ws-message').hidden = true;
  try { const report = validateOverview(await workspaceApi('/overview')); lastReport = report; render(report); await readLocalPlans(report); }
  catch (error) { $('ws-message').textContent = `${error.message}${lastReport ? ' 表示中の数値は前回読み込んだデータです。' : ''}`; $('ws-message').hidden = false; $('ws-message').setAttribute('role', 'alert'); $('ws-updated').textContent = lastReport ? `前回表示 ${formatTime(lastReport.generatedAt)}` : 'データを取得できませんでした。'; }
  finally { busy = false; $('ws-refresh').disabled = false; }
}
if (await startAccessSession()) {
  if (oldHash.has(location.hash) && ['/', '/index.html', '/overview/'].includes(location.pathname)) location.replace(`/regional/${location.hash}`);
  else { $('ws-refresh').addEventListener('click', () => void refresh()); await refresh(); }
}
