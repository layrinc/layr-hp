import {protectedResponse} from './seo-access.mjs';

export const WORKSPACE_ORIGIN = 'https://seo.layr.co.jp';
export const INTERNAL_ORIGIN = 'https://kiji-workspace.internal';
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const SETTINGS_FIELDS = ['autopilot','stock_target','daily_cap','weekly_target','auto_pick','supervisor','categories','article_min_chars','article_max_chars','model_body','model_outline'];
export class WorkspaceError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new WorkspaceError(status, message); };
const positiveId = '[1-9][0-9]{0,9}';
const routes = [
  [/^\/api\/overview$/, ['GET']],
  [/^\/api\/publication\/status$/, ['GET']],
  [/^\/api\/keywords$/, ['GET','POST'], ['status','layer','q','needs_split','unconfirmed']],
  [/^\/api\/keywords\/(import|expand|classify)$/, ['POST']],
  [new RegExp(`^/api/keywords/${positiveId}$`), ['PATCH']],
  [/^\/api\/articles$/, ['GET'], ['status']],
  [new RegExp(`^/api/articles/${positiveId}$`), ['GET','PATCH']],
  [new RegExp(`^/api/articles/${positiveId}/(approve|reject|discard|regate|check-deploy)$`), ['POST']],
  [/^\/api\/tick$/, ['POST']],
  [/^\/api\/metrics\/summary$/, ['GET']],
  [/^\/api\/metrics\/pull$/, ['POST']],
  [new RegExp(`^/api/rewrites/${positiveId}/dismiss$`), ['POST']],
  [/^\/api\/evidence$/, ['GET','POST']],
  [new RegExp(`^/api/evidence/${positiveId}$`), ['PATCH']],
  [/^\/api\/settings$/, ['GET','PUT']],
];
export function validateWorkspaceRoute(url, method) {
  const route = routes.find(([pattern]) => pattern.test(url.pathname));
  if (!route) fail(404, 'この操作は記事制作ワークスペースでは利用できません。');
  if (!route[1].includes(method)) fail(405, 'この操作方法には対応していません。');
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (method !== 'GET' || !(route[2] || []).includes(key) || seen.has(key) || value.length > 200 || /[\u0000-\u001f]/.test(value)) fail(400, '検索条件を確認してください。');
    seen.add(key);
  }
  if (url.search.length > 1200) fail(400, '検索条件が長すぎます。');
}
export async function limitedText(message, maxBytes) {
  const declared = message.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) fail(413, 'データのサイズ上限を超えています。');
  if (!message.body) return '';
  const reader = message.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); fail(413, 'データのサイズ上限を超えています。'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export async function readWorkspaceBody(request, path) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON形式で送信してください。');
  const raw = await limitedText(request, MAX_REQUEST_BYTES); let body;
  try { body = JSON.parse(raw); } catch { fail(400, 'JSON形式を確認してください。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '入力内容を確認してください。');
  let fields = [];
  if (path === '/api/keywords') fields = ['keywords','seed'];
  else if (path === '/api/keywords/import') fields = ['csv','seed','offset'];
  else if (path === '/api/keywords/expand') fields = ['seed'];
  else if (/^\/api\/keywords\/\d+$/.test(path)) fields = ['layer','layer_confirmed','intent_explicit','intent_latent','intent_confirmed','needs_split','experience_fit','competition','is_pillar','pillar_id','status'];
  else if (/^\/api\/articles\/\d+$/.test(path)) fields = ['title','description','body_md','category','slug'];
  else if (/\/(approve|reject)$/.test(path)) fields = ['note'];
  else if (path === '/api/metrics/pull') fields = ['days'];
  else if (/^\/api\/evidence(?:\/\d+)?$/.test(path)) fields = ['label','value','source','usable'];
  else if (path === '/api/settings') fields = SETTINGS_FIELDS;
  if (Object.keys(body).some(key => !fields.includes(key))) fail(400, '変更できない項目が含まれています。');
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && typeof value === 'object' && !['categories','keywords'].includes(key)) fail(400, '入力値を確認してください。');
    if (typeof value === 'string' && value.length > (key === 'csv' ? 1500000 : key === 'body_md' ? 200000 : 10000)) fail(400, '入力文字数が上限を超えています。');
  }
  if ('keywords' in body && (!Array.isArray(body.keywords) || !body.keywords.length || body.keywords.length > 300 || body.keywords.some(v => typeof v !== 'string' || !v.trim() || v.length > 100))) fail(400, 'キーワードは1件100文字以内、300件までです。');
  if ('offset' in body && (!Number.isSafeInteger(body.offset) || body.offset < 0)) fail(400, '読み込み位置を確認してください。');
  if ('days' in body && (!Number.isInteger(body.days) || body.days < 1 || body.days > 3)) fail(400, '計測取得は1〜3日で指定してください。');
  if (path === '/api/settings') {
    if ('autopilot' in body && !['full','approval'].includes(body.autopilot)) fail(400, '運転モードを確認してください。');
    if ('auto_pick' in body && !['0','1',0,1].includes(body.auto_pick)) fail(400, '自動選定の設定を確認してください。');
    for (const [key, min, max] of [['stock_target',1,10],['daily_cap',1,5],['weekly_target',1,10],['article_min_chars',500,30000],['article_max_chars',500,30000]]) {
      if (key in body && (!/^\d+$/.test(String(body[key])) || Number(body[key]) < min || Number(body[key]) > max)) fail(400, '本数・文字数の設定範囲を確認してください。');
    }
    if ('categories' in body && (!Array.isArray(body.categories) || !body.categories.length || body.categories.length > 20 || body.categories.some(v => typeof v !== 'string' || !v.trim() || v.length > 60))) fail(400, 'カテゴリは20件以内で指定してください。');
    for (const key of ['model_body','model_outline','supervisor']) if (key in body && (typeof body[key] !== 'string' || body[key].length > 200)) fail(400, 'モデル・監修者表記を確認してください。');
    if ('article_min_chars' in body && 'article_max_chars' in body && Number(body.article_min_chars) > Number(body.article_max_chars)) fail(400, '最小文字数は最大文字数以下にしてください。');
  }
  return body;
}
export function visibleSettings(settings) { return Object.fromEntries(SETTINGS_FIELDS.filter(key => key in settings).map(key => [key, settings[key]])); }

const reply = (value, status = 200) => protectedResponse(JSON.stringify(value), status, {'Content-Type':'application/json; charset=utf-8'});
export async function handleKijiWorkspace(request, env, {timeoutMs = 180000} = {}) {
  let timer; const controller = new AbortController();
  try {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/seo/kiji/')) throw new WorkspaceError(404, '操作先を確認してください。');
    const url = new URL('/api/' + incoming.pathname.slice('/api/seo/kiji/'.length) + incoming.search, INTERNAL_ORIGIN);
    validateWorkspaceRoute(url, request.method);
    if (request.method !== 'GET' && request.headers.get('Origin') !== WORKSPACE_ORIGIN) throw new WorkspaceError(403, 'SEOワークスペースを開き直してください。');
    const payload = request.method === 'GET' ? undefined : await readWorkspaceBody(request, url.pathname);
    if (!env.KIJI_WORKSPACE?.fetch) throw new WorkspaceError(503, '記事制作ツールへの接続を準備中です。');
    // A new Request intentionally drops browser cookies, Access JWTs and arbitrary headers.
    const internal = new Request(url, {method:request.method, redirect:'manual', signal:controller.signal,
      headers:{'Accept':'application/json', ...(payload ? {'Content-Type':'application/json','Origin':WORKSPACE_ORIGIN} : {})},
      ...(payload ? {body:JSON.stringify(payload)} : {})});
    const work = async () => {
      const response = await env.KIJI_WORKSPACE.fetch(internal);
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new WorkspaceError(502, '記事制作ツールの応答を確認できませんでした。'); }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new WorkspaceError(502, '記事制作ツールの応答を確認できませんでした。'); }
      let data; try { data = JSON.parse(await limitedText(response, MAX_RESPONSE_BYTES)); } catch { throw new WorkspaceError(502, '記事制作ツールの応答を読み込めませんでした。'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WorkspaceError(502, '記事制作ツールの応答を確認できませんでした。');
      if (url.pathname === '/api/settings' && request.method === 'GET') data = {ok:data.ok === true, settings:visibleSettings(data.settings || {})};
      if (response.status >= 500) data = {ok:false, error:'記事制作ツールで処理に失敗しました。実行状況を確認してから操作してください。'};
      return reply(data, response.status);
    };
    return await Promise.race([work(), new Promise((_, reject) => {timer = setTimeout(() => { controller.abort(); reject(new WorkspaceError(504, '処理結果を確認できませんでした。自動再試行はしません。記事一覧で状況を確認してください。')); }, timeoutMs);})]);
  } catch (error) {
    return reply({ok:false, error:error instanceof WorkspaceError ? error.message : '記事制作ツールに接続できませんでした。実行状況を確認してください。'}, error instanceof WorkspaceError ? error.status : 502);
  } finally { clearTimeout(timer); }
}
