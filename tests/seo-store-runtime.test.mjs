import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// The quota uses SQLite subqueries inside transactional batches. Exercise the
// actual D1 binding as well as the faster in-process SQLite regression suite.
test('D1 batches enforce separate publication quotas under overlapping Worker requests', {timeout:60000}, async () => {
  const bundle=await build({stdin:{contents:`
    import {ensureDatabase,saveDocument,approveDocument,publishDue,publicationStats} from './worker/seo-store.mjs';
    export default {async fetch(request,env) {
      await ensureDatabase(env.DB);
      const url=new URL(request.url),now=new Date(url.searchParams.get('now')||'2026-09-21T00:17:00Z');
      if(url.pathname==='/seed')for(const type of ['city','article'])for(let index=0;index<(type==='city'?23:4);index++) {
        const id=type+':'+index;
        const draft=await saveDocument(env.DB,{id,type,path:'/'+type+'/'+index+'/',title:id,scheduledAt:'2026-09-01T00:00:00Z'},0,now);
        await approveDocument(env.DB,draft,draft.version,'test@example.test',now);
      }
      const result=url.pathname==='/publish'?await publishDue(env.DB,now):await publicationStats(env.DB,now);
      return Response.json(result);
    }};`,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'qa-publication-d1.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:['DB']}));
  const request=async path=>{const response=await mf.dispatchFetch(`http://localhost${path}`);assert.equal(response.status,200,await response.clone().text());return response.json();};
  try {
    await request('/seed');
    const runs=await Promise.all([request('/publish'),request('/publish'),request('/publish')]);
    assert.equal(runs.flatMap(run=>run.byScope.regional.published).length,20);
    assert.equal(runs.flatMap(run=>run.byScope.media.published).length,1);
    const stats=await request('/stats');
    assert.deepEqual(stats.byScope.regional,{todayPublished:20,queued:3,dueReady:3,dailyLimit:20});
    assert.equal(stats.byScope.media.monthPublished,1);
    assert.equal(stats.byScope.media.queued,3);
    const nextDay=await request('/publish?now=2026-09-21T15:00:00Z');
    assert.equal(nextDay.byScope.regional.published.length,3);
    assert.equal(nextDay.byScope.media.published.length,0);
    const nextNote=await request('/publish?now=2026-09-23T15:00:00Z');
    assert.equal(nextNote.byScope.media.published.length,1);
  } finally {await mf.dispose();}
});
