export const API_BASE = '/api/seo/kiji';
export const ARTICLE_STATUS = {gen_outline:'構成生成中',gen_body:'本文生成中',gen_svg:'図解生成中',gating:'品質判定中',pending_approval:'承認待ち',needs_human:'要確認',publishing:'公開確認待ち',published:'公開済み',discarded:'破棄'};
export const KEYWORD_STATUS = {new:'未整備',ready:'記事化OK',queued:'キュー待ち',writing:'生成中',published:'公開済み',rejected:'保留'};
export const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ja-JP') : '—';
export function safeJson(value, fallback = []) { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed ?? fallback; } catch { return fallback; } }
export function safeUrl(value, base = 'https://layr.co.jp/media/') {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try { const url = new URL(value, base); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function articleUrl(slug) { return typeof slug === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug) ? `https://layr.co.jp/media/${slug}/` : null; }
export function publicationUrl(value) { return typeof value === 'string' && /^https:\/\/github\.com\/layrinc\/layr-hp\/pull\/[1-9]\d*$/.test(value) ? value : null; }
export function demandInfo(row) {
  const meta = row.demand_meta;
  if (meta?.kind === 'monthly_estimate' && Number.isSafeInteger(meta.value) && meta.value >= 0) return {value:number(meta.value),label:`${meta.source === 'planner' ? 'プランナー' : 'CSV'} / 取込月間推計（地域・期間は未確認）`,zero:meta.value === 0};
  if (meta?.kind === 'monthly_range' && Number.isSafeInteger(meta.lower) && Number.isSafeInteger(meta.upper) && meta.lower >= 0 && meta.upper >= meta.lower) return {value:`${number(meta.lower)}〜${number(meta.upper)}`,label:`${meta.source === 'planner' ? 'プランナー' : 'CSV'} / 月間検索数の範囲（地域・期間は未確認）`,zero:false};
  const label = row.demand_source === 'suggest' ? 'サジェスト指標（検索数ではありません）'
    : row.demand_source === 'gsc' ? '自サイトの検索表示回数（期間要確認）'
      : ['csv','planner'].includes(row.demand_source) ? `${row.demand_source === 'planner' ? 'プランナー' : 'CSV'} / 旧データ・算出条件未確認`
        : row.demand_source === 'manual' ? '手動の参考値（算出条件未確認）' : '取得元・算出条件未確認';
  return {value:number(row.demand_proxy),label,zero:false};
}
export function createKijiApi(fetcher = fetch) {
  return async (path, {method = 'GET', body, signal} = {}) => {
    if (!/^\/[a-z][a-z0-9/?=&_%+.-]*$/i.test(path) || path.includes('..')) throw new Error('操作先を確認できません。');
    let response;
    try { response = await fetcher(`${API_BASE}${path}`, {method,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{Accept:'application/json',...(body === undefined ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:signal || AbortSignal.timeout(method === 'GET' ? 30000 : 180000)}); }
    catch (error) { throw new Error(error.name === 'TimeoutError' ? '処理の完了を確認できませんでした。最新の状態を確認してから再操作してください。' : '接続を確認できませんでした。入力は保持しています。再読み込みまたはログイン状態を確認してください。'); }
    if (response.status === 401 || response.status === 403) throw new Error('ログイン状態または操作権限を確認できません。再ログインしてからお試しください。');
    let data; try { data = await response.json(); } catch { throw new Error('応答を確認できません。保存や公開の結果を一覧で確認してください。'); }
    if (!response.ok || data?.ok === false) throw new Error(typeof data?.error === 'string' ? data.error : '処理できませんでした。入力を保持しています。');
    return data;
  };
}
export function createOperationLock(onChange = () => {}) {
  let busy = false;
  return {get busy() { return busy; }, async run(work) { if (busy) return false; busy = true; onChange(true); try { await work(); return true; } finally { busy = false; onChange(false); } }};
}
export function createLatestRead() { let revision = 0; return {begin:() => ++revision, current:token => token === revision, invalidate:() => ++revision}; }
export function metricTotal(rows,key,available) { return available && rows.every(row => typeof row[key] === 'number' && Number.isFinite(row[key])) ? rows.reduce((sum,row) => sum + row[key],0) : null; }
export function metricRate(sessions,clicks) { return typeof sessions === 'number' && Number.isFinite(sessions) && sessions > 0 && typeof clicks === 'number' && Number.isFinite(clicks) ? `${(clicks / sessions * 100).toFixed(1)}%` : '—'; }
export function decodeCsv(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
  const utf8 = new TextDecoder('utf-8').decode(data);
  return utf8.includes('\ufffd') ? new TextDecoder('shift_jis').decode(data) : utf8;
}
export async function importCsv(api, csv, onProgress = () => {}) {
  let offset = 0, added = 0, withVolume = 0, reprioritized = 0;
  for (let page = 0; page < 1000; page++) {
    const result = await api('/keywords/import', {method:'POST',body:{csv,offset}});
    added += Number(result.added) || 0; withVolume += Number(result.withVolume) || 0; reprioritized += Number(result.reprioritized) || 0;
    onProgress(result);
    if (result.done === true) return {...result,added,withVolume,reprioritized};
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) throw new Error('取込の続き位置を確認できません。処理済み分は保存されています。再実行前に一覧を確認してください。');
    offset = result.nextOffset;
  }
  throw new Error('取込件数の上限です。処理済み分は保存されています。ファイルを分割してください。');
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function inline(text) {
  const pattern = /(\*\*([^*]+)\*\*|==([^=]+)==|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let html = '', start = 0;
  for (const match of String(text).matchAll(pattern)) {
    html += escape(text.slice(start,match.index));
    if (match[2]) html += `<strong>${escape(match[2])}</strong>`;
    else if (match[3]) html += `<mark>${escape(match[3])}</mark>`;
    else if (match[4]) html += `<code>${escape(match[4])}</code>`;
    else { const url = safeUrl(match[6]); html += url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(match[5])}</a>` : escape(match[0]); }
    start = match.index + match[0].length;
  }
  return html + escape(text.slice(start));
}
// Every HTML fragment is constructed here from escaped text and allowlisted syntax.
// SVGs stay in the browser's inert image context; never insert their markup into this document.
export function markdownHtml(markdown, diagrams = []) {
  const svgs = new Map((Array.isArray(diagrams) ? diagrams : []).filter(item => typeof item?.filename === 'string' && typeof item.svg === 'string' && item.svg.length < 2000000).map(item => [item.filename,item.svg]));
  const lines = String(markdown ?? '').split('\n'); let i = 0; const output = []; let paragraph = [];
  const flush = () => { if (paragraph.length) output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; };
  while (i < lines.length) {
    const line = lines[i], image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/), heading = line.match(/^(#{1,6})\s+(.+)$/), block = line.match(/^:::(point|warn|memo|check|box|cap)(?:\{[^}]*\})?\s*$/);
    if (image) { flush(); const svg = svgs.get(image[2].split('/').pop()); output.push(svg ? `<figure><img alt="${escape(image[1] || '記事の図解')}" src="data:image/svg+xml;charset=utf-8,${escape(encodeURIComponent(svg))}" /></figure>` : `<p class="kw-help">図解：${escape(image[1] || image[2])}（公開時の素材）</p>`); i++; continue; }
    if (/^```/.test(line)) { flush(); const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); continue; }
    if (block) { flush(); const title = line.match(/title="([^"]*)"/)?.[1] || {point:'ポイント',warn:'注意',memo:'メモ',check:'確認',box:'補足',cap:'補足'}[block[1]]; const body = []; i++; while (i < lines.length && !/^:::\s*$/.test(lines[i])) body.push(lines[i++]); i++; output.push(`<aside class="kiji-preview-note"><strong>${escape(title)}</strong><p>${body.map(inline).join('<br>')}</p></aside>`); continue; }
    if (/^\|/.test(line)) { flush(); const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = row => row.replace(/^\||\|$/g,'').split('|').map(cell => cell.trim()); const tableHead = cells(rows[0]).map(cell => `<th scope="col">${inline(cell)}</th>`).join(''); const hasSeparator = rows[1] && cells(rows[1]).every(cell => /^:?-{3,}:?$/.test(cell)); const tableBody = rows.slice(hasSeparator ? 2 : 1).map(row => `<tr>${cells(row).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join(''); output.push(`<div class="kw-table-wrap" tabindex="0" role="region" aria-label="原稿内の表"><table class="kw-table"><thead><tr>${tableHead}</tr></thead><tbody>${tableBody}</tbody></table></div>`); continue; }
    if (heading) { flush(); const level = Math.max(2,heading[1].length); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) { flush(); const ordered = /^\s*\d+\./.test(line), items = []; while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s+/,'')); const tag = ordered ? 'ol' : 'ul'; output.push(`<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`); continue; }
    if (line.startsWith('> ')) { flush(); output.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); i++; continue; }
    if (!line.trim()) flush(); else paragraph.push(line);
    i++;
  }
  flush(); return output.join('\n');
}
