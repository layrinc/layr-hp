import {MEDIA_PATH,rangedAsset} from './media-range.mjs';
import {normalizedPath} from './seo-access.mjs';
import {ensureDatabase,createStore,getPublished,getDocument,activity,publishDue,HttpError} from './seo-store.mjs';
import {renderDocument,renderPublishedCards,renderPublicationSitemap,ARTICLE_TEMPLATE_PATH,escapeHtml} from './seo-publication.mjs';
import {publicPath,resolveCity} from '../src/lib/seo-manager/editorial-model.mjs';
import {getPublishedAreas} from '../src/lib/ltori-publication.mjs';
import {runAnalyticsSync,runInspections} from './seo-analytics.mjs';
import {runHealthChecks,acquireJob,releaseJob} from './seo-health.mjs';
import {contactRelay} from './seo-leads.mjs';
import {prepareRegionalStep} from './seo-regional-preparation.mjs';
import {readCityPhotos,runCityPhotosStep} from './seo-city-photos.mjs';
import {renderCityPhotos} from '../src/lib/ltori-city-photos.mjs';
import {refreshDomainAuthority} from './seo-domain-authority.mjs';

export const getStaticPages=(now=new Date())=>[
  ...getPublishedAreas(now).map(area=>({path:`/service/ltori/area/${area.slug}/`,title:`${area.fullName}の採用LINE構築・運用支援`,type:'city'})),
  ...['interview-followup','recruitment-funnel','recruitment-line-agency'].map(slug=>({path:`/service/ltori/media/${slug}/`,title:slug,type:'article'})),
];
const response=(body,status=200,headers={})=>new Response(body,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const notFound=()=>response('ページが見つかりません。',404,{'X-Robots-Tag':'noindex'});
export async function resolveSource(env,key) {
  if(key==='diagnosis')return {key,label:'採用LINE活用診断',path:'/service/ltori/diagnosis/'};
  if(['area','media'].includes(key))return {key,label:key==='area'?'採用LINEの対応地域':'エルトリ採用ノート',path:key==='area'?'/service/ltori/':'/service/ltori/media/'};
  if(!/^(area\/[a-z0-9-]+\/[a-z0-9-]+|media\/[a-z0-9-]+)$/.test(key))return null;
  const path=`/service/ltori/${key}/`,known=getStaticPages().find(page=>page.path===path);if(known)return {key,label:known.title,path};
  if(!env.SEO_DB)return null;await ensureDatabase(env.SEO_DB);
  const row=await env.SEO_DB.prepare('SELECT value FROM seo_published WHERE path=?').bind(path).first();if(!row)return null;const doc=JSON.parse(row.value);return {key,label:doc.title,path};
}
export async function previewDocument(env,doc,options={}) {
  const template=doc.type==='city'?'/service/ltori/':ARTICLE_TEMPLATE_PATH;
  const base=await env.ASSETS.fetch(new Request(`https://layr.co.jp${template}`));
  return renderDocument(base,doc,options);
}
function rewrittenAsset(response,selector,html) {
  const headers=new Headers(response.headers);for(const name of ['content-length','content-encoding','etag','last-modified'])headers.delete(name);headers.set('Cache-Control','public, max-age=0, must-revalidate');
  return new HTMLRewriter().on(selector,{element(element){element.append(html,{html:true});}}).transform(new Response(response.body,{status:response.status,headers}));
}
export async function publicFetch(request,env) {
  const url=new URL(request.url);
  // Retire only the public directory. City URLs, data and publication schedules
  // keep their existing routes; this redirect also works without a database.
  if(['/service/ltori/area','/service/ltori/area/','/service/ltori/area/index.html'].includes(url.pathname))return response(null,301,{Location:`https://layr.co.jp/service/ltori/${url.search}`});
  let path;try{path=normalizedPath(url.pathname);}catch{return notFound();}
  // All management API aliases fail closed outside the Access-protected host.
  if(path.toLowerCase().startsWith('/api/seo'))return response('管理用ドメインを利用してください。',403,{'X-Robots-Tag':'noindex'});
  if(path.toLowerCase().startsWith(ARTICLE_TEMPLATE_PATH.slice(0,-1)))return notFound();
  if(path==='/api/ltori/contact')return contactRelay(request,env,key=>resolveSource(env,key));
  if(path==='/api/ltori/source') {
    if(request.method!=='GET')return response('Method not allowed',405);
    const source=await resolveSource(env,url.searchParams.get('key')||'');return response(JSON.stringify(source||{error:'公開ページが見つかりません。'}),source?200:404,{'Content-Type':'application/json; charset=utf-8'});
  }
  const interesting=path==='/sitemap-ltori-growth.xml'||path==='/service/ltori/media/'||/^\/service\/ltori\/(?:area\/|media\/)/.test(path);
  if(MEDIA_PATH.test(path))return rangedAsset(request,env);
  if(!interesting)return env.ASSETS.fetch(request);
  if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405);
  if(!env.SEO_DB){if(path==='/sitemap-ltori-growth.xml')return response('Database unavailable',503);return env.ASSETS.fetch(request);}
  await ensureDatabase(env.SEO_DB);
  const listing=path==='/sitemap-ltori-growth.xml'||path==='/service/ltori/media/';
  if(listing) {
    const published=await getPublished(env.SEO_DB);
    if(path==='/sitemap-ltori-growth.xml')return response(request.method==='HEAD'?null:renderPublicationSitemap(published),200,{'Content-Type':'application/xml; charset=utf-8'});
    const asset=await env.ASSETS.fetch(request);
    if(!asset.ok||request.method==='HEAD')return asset;
    return rewrittenAsset(asset,'#articles .lm-list',renderPublishedCards(published));
  }
  // Individual visits read one indexed public snapshot, never the nationwide
  // catalogue of full article bodies. Drafts remain in a separate table.
  const canonicalPath=path.replace(/\/(?:index\.html)?$/,'')+'/';
  const row=await env.SEO_DB.prepare('SELECT value,version,published_at FROM seo_published WHERE path=?').bind(canonicalPath).first();
  const doc=row?{...JSON.parse(row.value),version:row.version,publishedAt:row.published_at,status:'published'}:null;
  if(doc&&publicPath(doc)===canonicalPath) {
    if(url.pathname!==canonicalPath)return response(null,301,{Location:`https://layr.co.jp${canonicalPath}${url.search}`});
    let publishedCitySlugs=[];
    if(doc.type==='article') {
      const selected=[...new Set(Array.isArray(doc.relatedCitySlugs)?doc.relatedCitySlugs:[])].slice(0,3).filter(slug=>resolveCity(slug));
      const staticSlugs=new Set(getPublishedAreas().map(area=>area.slug));
      publishedCitySlugs=selected.filter(slug=>staticSlugs.has(slug));
      const dynamic=selected.filter(slug=>!staticSlugs.has(slug));
      if(dynamic.length) {
        // Only existence/path is needed for the at-most-three contextual links.
        const paths=dynamic.map(slug=>`/service/ltori/area/${slug}/`);
        const {results}=await env.SEO_DB.prepare(`SELECT path FROM seo_published WHERE path IN (${paths.map(()=>'?').join(',')})`).bind(...paths).all();
        const available=new Set(results.map(result=>result.path));
        publishedCitySlugs.push(...dynamic.filter((slug,index)=>available.has(paths[index])));
      }
    }
    const cityPhotos=doc.type==='city'&&request.method==='GET'?await readCityPhotos(env.SEO_DB,doc.slug):null;
    const result=await previewDocument(env,doc,{publishedCitySlugs,...(doc.type==='city'?{cityPhotos}:{})});
    return request.method==='HEAD'?new Response(null,{status:result.status,headers:result.headers}):result;
  }
  const asset=await env.ASSETS.fetch(request);
  const staticCity=asset.ok&&request.method==='GET'?getPublishedAreas().find(area=>`/service/ltori/area/${area.slug}/`===canonicalPath):null;
  if(!staticCity)return asset;
  const cityPhotos=await readCityPhotos(env.SEO_DB,staticCity.slug);
  const headers=new Headers(asset.headers);for(const name of ['content-length','content-encoding','etag','last-modified'])headers.delete(name);headers.set('Cache-Control','public, max-age=0, must-revalidate');
  return new HTMLRewriter().on('[data-city-photos-slot]',{element(element){element.setInnerContent(renderCityPhotos(staticCity,cityPhotos),{html:true});}}).transform(new Response(asset.body,{status:asset.status,headers}));
}
export async function runJob(env,kind,{now=new Date()}={}) {
  await ensureDatabase(env.SEO_DB);const db=env.SEO_DB,store=createStore(db),token=await acquireJob(db,kind,now);
  if(!token)return {status:'running',message:'同じ処理を実行中です。'};
  try {
    await store.upsert('jobs',kind,{status:'running',startedAt:now.toISOString()});
    const published=['prepare','photos'].includes(kind)?[]:await getPublished(db),paths=[...getStaticPages(now).map(row=>row.path),...published.map(publicPath)];
    let result;
    if(kind==='publish')result=await publishDue(db,now);
    else if(kind==='prepare')result=await prepareRegionalStep(env,{now});
    else if(kind==='photos')result=await runCityPhotosStep(env,{now});
    else if(kind==='analytics')result=await runAnalyticsSync(env,{store,publishedPaths:paths,now});
    else if(kind==='inspection'){result=await runInspections(env,{store,publishedPaths:paths,now});await runHealthChecks(env,{paths,now});
      // Domain authority is informational: its outage must not fail the inspection job.
      try{await refreshDomainAuthority(env,{now});}catch{/* recorded as a fixed code inside */}}
    else throw new HttpError(400,'処理の種類を確認してください。');
    await store.upsert('jobs',kind,{status:'completed',finishedAt:new Date().toISOString(),result});
    return {status:'completed',result};
  }catch(error){await store.upsert('jobs',kind,{status:'error',finishedAt:new Date().toISOString(),message:'処理を完了できませんでした。接続設定と実行履歴を確認してください。'});await activity(db,'error',`${kind}の処理が完了しませんでした。`,now);throw error;}
  finally{await releaseJob(db,kind,token);}
}
