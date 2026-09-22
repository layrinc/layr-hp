import {createStore,activity} from './seo-store.mjs';

export async function acquireJob(db,name,now=new Date()) {
  const expires=new Date(now.getTime()+10*60000).toISOString(),token=crypto.randomUUID();
  const result=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('locks',?,json_object('token',?,'expiresAt',?),?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(seo_kv.value,'$.expiresAt')<?").bind(name,token,expires,now.toISOString(),now.toISOString()).run();
  return result.meta.changes?token:null;
}
export async function releaseJob(db,name,token) {await db.prepare("DELETE FROM seo_kv WHERE namespace='locks' AND key=? AND json_extract(value,'$.token')=?").bind(name,token).run();}
export async function runHealthChecks(env,{paths,fetchImpl=fetch,now=new Date()}) {
  const store=createStore(env.SEO_DB),previous=await store.list('health');const checked=new Map(previous.map(row=>[row.key,row.value.checkedAt]));
  const eligible=[...new Set(paths)].filter(path=>/^\/service\/ltori\/(?:area\/[a-z0-9-]+\/[a-z0-9-]+\/|media\/[a-z0-9-]+\/)$/.test(path));
  eligible.sort((a,b)=>(checked.get(a)||'').localeCompare(checked.get(b)||''));
  const results=[];
  for(const path of eligible.slice(0,10)) {
    const warnings=[];let status=null;
    try{
      const response=await fetchImpl(`https://layr.co.jp${path}`,{redirect:'manual',signal:AbortSignal.timeout(10000)});status=response.status;
      if(status!==200)warnings.push(`HTTP ${status}：公開ページを確認してください。`);
      else {
        const html=await response.text();const canonical=html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)/i)?.[1];
        if(canonical!==`https://layr.co.jp${path}`)warnings.push('canonicalが公開URLと一致していません。');
        if(/noindex/i.test(response.headers.get('X-Robots-Tag')||'')||/<meta\b(?=[^>]*name=["']robots["'])(?=[^>]*content=["'][^"']*noindex)/i.test(html))warnings.push('検索対象外（noindex）が指定されています。');
        if((html.match(/<h1(?:\s|>)/gi)||[]).length!==1)warnings.push('主見出しの数を確認してください。');
        if(!/<title>[^<]+<\/title>/i.test(html))warnings.push('ページタイトルが見つかりません。');
        if(!html.includes('/contact/'))warnings.push('相談へのリンクが見つかりません。');
      }
    }catch{warnings.push('ページへの接続を確認できませんでした。');}
    const result={path,status,checkedAt:now.toISOString(),warnings,ok:warnings.length===0};await store.upsert('health',path,result);results.push(result);
  }
  if(results.some(row=>!row.ok))await activity(env.SEO_DB,'health','公開ページの確認項目があります。接続・異常画面を確認してください。',now);
  return results;
}
