import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {createKijiApi,createOperationLock,createLatestRead,decodeCsv,importCsv,demandInfo,metricTotal,metricRate,markdownHtml,safeUrl,publicationUrl,articleUrl} from '../src/lib/seo-manager/kiji-client.mjs';

const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {resolve,reject,promise}; };
const walk = node => [node,...(node.childNodes || []).flatMap(walk)];
const attrs = node => Object.fromEntries((node.attrs || []).map(attr => [attr.name,attr.value]));

test('API stays on the common Access origin with no redirects and preserves action payloads',async () => {
  const calls = [], api = createKijiApi(async (...args) => { calls.push(args); return new Response(JSON.stringify({ok:true,added:1}),{status:200}); });
  await api('/keywords?q=%E6%8E%A1%E7%94%A8+LINE'); await api('/articles/7/reject',{method:'POST',body:{note:'料金の根拠を追記'}});
  assert.equal(calls[0][0],'/api/seo/kiji/keywords?q=%E6%8E%A1%E7%94%A8+LINE');
  assert.equal(calls[1][1].credentials,'same-origin'); assert.equal(calls[1][1].redirect,'error'); assert.equal(calls[1][1].method,'POST');
  assert.deepEqual(JSON.parse(calls[1][1].body),{note:'料金の根拠を追記'});
  for (const path of ['https://evil.test/api','//evil.test/api','/../secret']) await assert.rejects(api(path));
  assert.equal(calls.length,2);
});
test('authentication and service errors cannot be read as empty successful data',async () => {
  await assert.rejects(createKijiApi(async () => new Response('{}',{status:403}))('/overview'),/ログイン状態/);
  await assert.rejects(createKijiApi(async () => new Response(JSON.stringify({ok:false,error:'一部を処理できませんでした'}),{status:400}))('/overview'),/一部を処理/);
  await assert.rejects(createKijiApi(async () => new Response('<html>Login</html>',{status:200}))('/overview'),/応答を確認できません/);
});
test('a second generation or publish mutation cannot start until the first finishes',async () => {
  const pending = deferred(), states = [], lock = createOperationLock(value => states.push(value)); let count = 0;
  const first = lock.run(async () => { count++; await pending.promise; });
  assert.equal(await lock.run(async () => count++),false); assert.equal(count,1); pending.resolve(); await first;
  await assert.rejects(lock.run(async () => { throw new Error('failed'); }));
  assert.equal(lock.busy,false); assert.deepEqual(states,[true,false,true,false]);
});
test('stale file and search responses are invalidated before a new result can be applied',() => {
  const channel = createLatestRead(), old = channel.begin(); channel.invalidate(); assert.equal(channel.current(old),false);
  const next = channel.begin(); assert.equal(channel.current(next),true); assert.equal(channel.current(old),false);
});
test('only explicit monthly estimates distinguish confirmed zero; old proxies never become actual volumes',() => {
  for (const source of ['suggest','csv','planner','gsc','manual',null]) { const info = demandInfo({demand_proxy:0,demand_source:source}); assert.equal(info.zero,false); assert.equal(info.value,'0'); }
  assert.match(demandInfo({demand_source:'suggest',demand_proxy:12}).label,/検索数ではありません/);
  assert.match(demandInfo({demand_source:'csv',demand_proxy:316}).label,/算出条件未確認/);
  assert.equal(demandInfo({demand_proxy:null}).value,'—');
  assert.equal(demandInfo({demand_meta:{kind:'monthly_estimate',value:0,source:'csv'}}).zero,true);
  assert.equal(demandInfo({demand_meta:{kind:'monthly_estimate',value:10,source:'csv'}}).value,'10');
  assert.deepEqual(demandInfo({demand_meta:{kind:'monthly_range',lower:0,upper:10,source:'planner'}}),{value:'0〜10',label:'プランナー / 月間検索数の範囲（地域・期間は未確認）',zero:false});
});
test('metrics require source-specific availability and missing values never sum to zero',() => {
  assert.equal(metricTotal([{sessions:0}],'sessions',true),0);
  assert.equal(metricTotal([{sessions:0}],'sessions',false),null);
  assert.equal(metricTotal([{sessions:0},{sessions:null}],'sessions',true),null);
  assert.equal(metricRate(100,null),'—'); assert.equal(metricRate(null,0),'—'); assert.equal(metricRate(0,0),'—'); assert.equal(metricRate(100,0),'0.0%'); assert.equal(metricRate(100,3),'3.0%');
});
test('CSV batches preserve source data and cannot loop over a failed progress cursor',async () => {
  const csv='キーワード,検索数\n採用,100〜1000', calls=[];
  const result = await importCsv(async (path,options) => { calls.push([path,options.body]); return calls.length === 1 ? {added:1,withVolume:1,totalRows:300,nextOffset:250,done:false} : {added:2,withVolume:2,totalRows:300,nextOffset:300,done:true}; },csv);
  assert.deepEqual(calls.map(call => call[1].offset),[0,250]); assert.ok(calls.every(call => call[1].csv === csv)); assert.equal(result.added,3);
  await assert.rejects(importCsv(async () => ({done:false,nextOffset:0}),'a,b'),/処理済み分は保存/);
});
test('CSV text decoding accepts UTF-8, UTF-16LE and UTF-16BE without losing Japanese headers',() => {
  const text='キーワード\t検索数\n採用\t10'; assert.equal(decodeCsv(new TextEncoder().encode(text)),text);
  const le=[255,254],be=[254,255]; for (const char of text) { const code=char.charCodeAt(0); le.push(code&255,code>>8); be.push(code>>8,code&255); }
  assert.equal(decodeCsv(new Uint8Array(le)),text); assert.equal(decodeCsv(new Uint8Array(be)),text);
});
test('stored markdown and SVG payloads never become active HTML, handlers, or script links',() => {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>';
  const html=markdownHtml('# title\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[bad](javascript:alert)\n[quote](https://example.test/"onmouseover="alert)\n\n![図解](diagram.svg)',[{filename:'diagram.svg',svg}]);
  const nodes=walk(parseFragment(html)); assert.ok(!nodes.some(n => ['script','svg','iframe','foreignObject'].includes(n.tagName)));
  assert.ok(!nodes.some(n => Object.keys(attrs(n)).some(name => name.startsWith('on'))));
  assert.ok(!nodes.filter(n => n.tagName==='a').some(n => !/^https?:/.test(attrs(n).href)));
  const image=nodes.find(n=>n.tagName==='img'); assert.match(attrs(image).src,/^data:image\/svg\+xml;charset=utf-8,/);
  assert.equal(decodeURIComponent(attrs(image).src.split(',')[1]),svg); assert.match(html,/&lt;script&gt;/); assert.ok(!nodes.some(n=>n.tagName==='h1'));
});
test('preview retains supported editorial structures and limits publication links to the exact repository',() => {
  const html=markdownHtml('## 見出し\n\n:::point{title="要点"}\n**重要**\n:::\n\n|列|値|\n|---|---|\n|A|10|\n\n- 箇条書き\n\n```\n<safe>\n```'); const nodes=walk(parseFragment(html));
  for (const tag of ['h2','aside','strong','table','th','li','pre']) assert.ok(nodes.some(node=>node.tagName===tag),tag);
  assert.equal(publicationUrl('https://github.com/layrinc/layr-hp/pull/12'),'https://github.com/layrinc/layr-hp/pull/12');
  for (const url of ['javascript:alert(1)','https://github.com.evil.test/layrinc/layr-hp/pull/12','https://github.com/other/repo/pull/12','https://github.com/layrinc/layr-hp/pull/12?x=1']) assert.equal(publicationUrl(url),null);
  assert.equal(safeUrl('data:text/html,x'),null); assert.equal(safeUrl('java\nscript:alert(1)'),null); assert.equal(articleUrl('../secret'),null);
});
