// 動画ファイルの部分取得（HTTP Range）に対応する。
// Workers Static Assets は Range を無視して常に 200 で全体を返すため、iPhone の Safari が
// 動画を再生できない。動画の拡張子に限り、ここで 206 Partial Content を返す。
// Worker から見えるアセットの応答には Content-Length が付かないことがあるので、
// Range 付きの要求では本体を一度読み込んで長さを確定させ、同じ isolate の中では使い回す。
export const MEDIA_PATH = /\.(?:mp4|m4v|webm)$/i;

const buffers = new Map(); // "パス|ETag" → ArrayBuffer（直近2本まで）

export async function rangedAsset(request, env) {
  const method = request.method;
  if (!['GET', 'HEAD'].includes(method)) return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  const headers = new Headers(request.headers);
  headers.delete('Range');
  const asset = await env.ASSETS.fetch(new Request(request.url, {method: 'GET', headers}));
  if (asset.status !== 200 || !asset.body) return asset;
  const out = new Headers(asset.headers);
  out.set('Accept-Ranges', 'bytes');
  const range = request.headers.get('Range');
  if (!range) {
    if (method === 'HEAD') { await asset.body.cancel(); return new Response(null, {status: 200, headers: out}); }
    return new Response(asset.body, {status: 200, headers: out});
  }
  const key = `${new URL(request.url).pathname}|${asset.headers.get('ETag') || ''}`;
  let buf = buffers.get(key);
  if (buf) await asset.body.cancel();
  else {
    buf = await asset.arrayBuffer();
    buffers.set(key, buf);
    while (buffers.size > 2) buffers.delete(buffers.keys().next().value);
  }
  const size = buf.byteLength;
  const bounds = parseRange(range, size);
  if (!bounds) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes'}});
  const [start, end] = bounds;
  out.set('Content-Range', `bytes ${start}-${end}/${size}`);
  out.set('Content-Length', String(end - start + 1));
  return new Response(method === 'HEAD' ? null : buf.slice(start, end + 1), {status: 206, headers: out});
}

// "bytes=start-end" / "bytes=start-" / "bytes=-suffix" の1区間だけを受け付ける（複数区間は416）
export function parseRange(value, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); if (n <= 0) return null; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null;
  return [start, end];
}
