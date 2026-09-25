import test from 'node:test';
import assert from 'node:assert/strict';
import {rangedAsset, parseRange, MEDIA_PATH} from '../worker/media-range.mjs';

const bytes = Uint8Array.from({length: 1000}, (_, i) => i % 256);
// 実際の配信と同じく、小さな塊に分けて流す
const env = {ASSETS: {fetch: async (req) => {
  assert.equal(req.headers.get('Range'), null, 'Range はアセットに渡さない');
  if (!new URL(req.url).pathname.endsWith('.mp4')) return new Response('nf', {status: 404});
  let i = 0;
  const body = new ReadableStream({pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i + 64)); i += 64; }});
  return new Response(body, {status: 200, headers: {'Content-Type': 'video/mp4', ETag: '"x"'}});
}}};
const get = (range, method = 'GET') => rangedAsset(new Request('https://layr.co.jp/service/ltori/ltori-intro.mp4', {method, headers: range ? {Range: range} : {}}), env);

test('動画の拡張子だけを対象にする', () => {
  assert.ok(MEDIA_PATH.test('/service/ltori/ltori-intro.mp4'));
  assert.ok(!MEDIA_PATH.test('/service/ltori/'));
  assert.ok(!MEDIA_PATH.test('/service/ltori/ltori-intro-poster.webp'));
});

test('Range なしは 200 で全体を返し、Accept-Ranges を付ける', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(new Uint8Array(await r.arrayBuffer()).length, 1000);
});

test('Safari の最初の問い合わせ（bytes=0-1）に 206 で2バイトだけ返す', async () => {
  const r = await get('bytes=0-1');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-1/1000');
  assert.equal(r.headers.get('Content-Length'), '2');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0, 1]);
});

test('Content-Length の無いアセットでも、塊の境界をまたぐ区間・末尾まで・末尾から n バイトを正しく切り出す', async () => {
  for (const [range, start, end] of [['bytes=60-200', 60, 200], ['bytes=900-', 900, 999], ['bytes=-10', 990, 999], ['bytes=950-5000', 950, 999]]) {
    const r = await get(range);
    assert.equal(r.status, 206, range);
    assert.equal(r.headers.get('Content-Range'), `bytes ${start}-${end}/1000`, range);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...bytes.slice(start, end + 1)], range);
  }
});

test('範囲外・不正な指定は 416、HEAD は本文なし', async () => {
  assert.equal((await get('bytes=1000-')).status, 416);
  assert.equal((await get('bytes=5-2')).status, 416);
  assert.equal((await get('bytes=0-1,5-6')).status, 416);
  assert.equal(parseRange('items=0-1', 10), null);
  const h = await get('bytes=0-99', 'HEAD');
  assert.equal(h.status, 206);
  assert.equal(h.headers.get('Content-Length'), '100');
  assert.equal(await h.text(), '');
});
