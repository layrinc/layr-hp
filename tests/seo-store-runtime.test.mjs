import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// The quota uses SQLite subqueries inside transactional batches. Exercise the
// actual D1 binding as well as the faster in-process SQLite regression suite.
test('D1 batches publish one assigned prefecture and retain the independent note quota under overlap', {timeout:60000}, async () => {
  const bundle=await build({stdin:{contents:`
    import {ensureDatabase,saveDocument,approveDocument,publishDue,publicationStats} from './worker/seo-store.mjs';
    import {REGIONAL_PREFECTURES,saveRegionalCampaignConfig} from './worker/seo-regional-campaign.mjs';
    export default {async fetch(request,env) {
      await ensureDatabase(env.DB);
      const url=new URL(request.url),now=new Date(url.searchParams.get('now')||'2026-09-21T00:17:00Z');
      if(url.pathname==='/seed') {
        await saveRegionalCampaignConfig(env.DB,{enabled:true,startDate:'2026-09-21'},{expectedRevision:0,now});
        const docs=[...REGIONAL_PREFECTURES[0].cities,...REGIONAL_PREFECTURES[1].cities.slice(0,2)].map(city=>({...city,type:'city'}));
        for(let index=0;index<4;index++)docs.push({id:'article:'+index,type:'article',path:'/article/'+index+'/'});
        for(const doc of docs) {
          const draft=await saveDocument(env.DB,{...doc,title:doc.id,scheduledAt:'2026-09-01T00:00:00Z'},0,now);
          await approveDocument(env.DB,draft,draft.version,'test@example.test',now);
        }
      }
      const result=url.pathname==='/publish'?await publishDue(env.DB,now):await publicationStats(env.DB,now);
      return Response.json(result);
    }};`,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'qa-publication-d1.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:['DB']}));
  const request=async path=>{const response=await mf.dispatchFetch(`http://localhost${path}`);assert.equal(response.status,200,await response.clone().text());return response.json();};
  try {
    await request('/seed');
    const runs=await Promise.all([request('/publish'),request('/publish'),request('/publish')]);
    assert.equal(runs.flatMap(run=>run.byScope.regional.published).length,35);
    assert.equal(runs.flatMap(run=>run.byScope.media.published).length,1);
    const stats=await request('/stats');
    assert.equal(stats.byScope.regional.todayPublished,35);
    assert.equal(stats.byScope.regional.queued,2);
    assert.equal(stats.byScope.regional.dueReady,0);
    assert.equal(stats.byScope.regional.campaign.currentDay.live,35);
    assert.equal(stats.byScope.media.monthPublished,1);
    assert.equal(stats.byScope.media.queued,3);
    const nextDay=await request('/publish?now=2026-09-21T15:00:00Z');
    assert.equal(nextDay.byScope.regional.published.length,0);
    assert.equal(nextDay.byScope.media.published.length,0);
    assert.equal((await request('/publish?now=2026-09-22T00:17:00Z')).byScope.regional.published.length,2);
    const nextNote=await request('/publish?now=2026-09-23T15:00:00Z');
    assert.equal(nextNote.byScope.media.published.length,1);
  } finally {await mf.dispose();}
});
