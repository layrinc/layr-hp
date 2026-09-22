export const formatNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat('ja-JP', {maximumFractionDigits: 1}).format(value) : '—';
export const formatTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short'}).format(new Date(value)) : '未取得';
export function node(tag, text, className) { const result = document.createElement(tag); if (text !== undefined) result.textContent = String(text); if (className) result.className = className; return result; }
export async function workspaceApi(path, {method = 'GET', body} = {}) {
  const response = await fetch(`/api/seo${path}`, {method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {'Accept': 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(25000)});
  let data; try { data = await response.json(); } catch { throw new Error('接続状態を確認できません。再読み込みしてログインを確認してください。'); }
  if (!response.ok) throw new Error(response.status === 409 ? '別のタブで更新されています。メモを控えてから閉じ、最新情報を読み直してください。' : response.status === 401 || response.status === 403 ? '認証を確認できません。再読み込みしてログインしてください。' : typeof data?.error === 'string' ? data.error : 'データを取得できませんでした。時間をおいて再度お試しください。');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('データの形式を確認できませんでした。');
  return data;
}
export function validateOverview(data) {
  if (!data || !Array.isArray(data.projects) || !data.totals || !data.periods || !Array.isArray(data.sources) || !Array.isArray(data.notes) || !Array.isArray(data.actions)) throw new Error('概要データの形式を確認できませんでした。');
  for (const id of ['regional', 'media', 'corporate']) if (!data.projects.some(project => project.id === id && project.metrics && Array.isArray(project.pages))) throw new Error('施策データが不足しています。');
  return data;
}
export function sourceDescription(report, source) {
  const period = report.periods?.[source];
  return period ? `${period.startDate}〜${period.endDate} / 取得 ${formatTime(period.fetchedAt)}` : '実績は未取得です。';
}
