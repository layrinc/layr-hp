import settings from '../src/data/settings.json' with {type:'json'};
import {createStore,ensureDatabase,HttpError} from './seo-store.mjs';

export const LEAD_STAGES=['inquiry','qualified','meeting','won','lost'];
export function normalizeLead(input,now=new Date()) {
  const amount=value=>{if(value==null||value==='')return null;const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>1e12)throw new HttpError(400,'金額は0以上の整数で入力してください。');return n;};
  if(!LEAD_STAGES.includes(input.stage))throw new HttpError(400,'商談の段階を確認してください。');
  const sourcePath=String(input.sourcePath||'');
  if(sourcePath&&!/^\/service\/ltori\/(?:area\/(?:[a-z0-9-]+\/[a-z0-9-]+\/)?|media\/(?:[a-z0-9-]+\/)?|diagnosis\/)?$/.test(sourcePath))throw new HttpError(400,'エルトリの有効な流入ページを指定してください。');
  const id=input.id||crypto.randomUUID();if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw new HttpError(400,'受付IDを確認してください。');
  const reference=String(input.reference||'');if(reference.length>80||/[<>@\n\r]/.test(reference))throw new HttpError(400,'照合番号には社内管理IDを入力してください。氏名・メールは保存しません。');
  const createdAt=input.createdAt?new Date(input.createdAt):now;if(!Number.isFinite(createdAt.getTime()))throw new HttpError(400,'受付日を確認してください。');
  return {id,sourcePath,stage:input.stage,createdAt:createdAt.toISOString(),revenueYen:amount(input.revenueYen),grossProfitYen:amount(input.grossProfitYen),reference,updatedAt:now.toISOString()};
}
export async function saveLead(db,input,expectedVersion=0,now=new Date()) {
  const lead=normalizeLead(input,now),version=expectedVersion+1;lead.version=version;
  const query=expectedVersion===0
    ?db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('leads',?,?,?,?) ON CONFLICT DO NOTHING").bind(lead.id,JSON.stringify(lead),version,lead.updatedAt)
    :db.prepare("UPDATE seo_kv SET value=?,version=?,updated_at=? WHERE namespace='leads' AND key=? AND version=?").bind(JSON.stringify(lead),version,lead.updatedAt,lead.id,expectedVersion);
  const result=await query.run();if(!result.meta.changes)throw new HttpError(409,'商談情報が更新されています。再読み込みしてください。');return lead;
}
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function contactRelay(request,env,resolveSource,{fetchImpl=fetch,now=new Date()}={}) {
  if(request.method!=='POST')return response({error:'POSTで送信してください。'},405);
  const origin=request.headers.get('Origin');if(!['https://layr.co.jp','https://www.layr.co.jp'].includes(origin))return response({error:'公式サイトのフォームから送信してください。'},403);
  if(Number(request.headers.get('Content-Length')||0)>32768)return response({error:'お問い合わせ内容が長すぎます。'},413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>32768)return response({error:'お問い合わせ内容が長すぎます。'},413);
  let form;try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')||''},body:raw}).formData();}catch{return response({error:'入力形式を確認してください。'},400);}
  if(form.get('_honey'))return response({error:'送信できませんでした。'},400);
  const id=String(form.get('_ltori_submission_id')||'');if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:'フォームを開き直してください。'},400);
  const fields=['お名前','会社名','メールアドレス','お問い合わせ内容'];
  for(const key of fields){const value=form.get(key);if(typeof value!=='string'||!value.trim()||value.length>(key==='お問い合わせ内容'?10000:200))return response({error:'必須項目と文字数を確認してください。'},400);}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.get('メールアドレス')))return response({error:'メールアドレスを確認してください。'},400);
  await ensureDatabase(env.SEO_DB);const db=env.SEO_DB,store=createStore(db);
  const previous=await store.get('submissions',id);
  if(previous?.status==='accepted')return response({success:true,leadId:id});
  if(previous)return response({error:'この送信は処理済み、または確認中です。受付メールを確認してください。'},409);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';const hour=now.toISOString().slice(0,13);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${ip}:${hour}`));const bucket=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
  const rate=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('rate',?,json_object('count',1),?) ON CONFLICT(namespace,key) DO UPDATE SET value=json_set(value,'$.count',json_extract(value,'$.count')+1) RETURNING value").bind(bucket,now.toISOString()).first();
  if(JSON.parse(rate.value).count>10)return response({error:'送信が続いています。時間をおいてお試しください。'},429);
  const reserved=await db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('submissions',?,json_object('status','sending'),?) ON CONFLICT DO NOTHING").bind(id,now.toISOString()).run();
  if(!reserved.meta.changes)return response({error:'送信を処理しています。'},409);
  const source=await resolveSource(String(form.get('_ltori_source')||''));
  const payload=new FormData();for(const key of [...fields,'ご相談内容'])payload.set(key,String(form.get(key)||''));
  payload.set('_subject',`【エルトリ】採用LINEのご相談（受付ID: ${id}）`);payload.set('_captcha','false');payload.set('受付ID',id);
  if(source)payload.set('ご覧になったページ',source.label);
  // The diagnostic summary is already visible in the visitor's submitted message.
  let accepted=false;
  try{
    const upstream=await fetchImpl(`https://formsubmit.co/ajax/${encodeURIComponent(settings.email)}`,{method:'POST',body:payload,headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
    if(upstream.ok){const data=await upstream.json();accepted=data.success===true||data.success==='true';}
  }catch{}
  if(!accepted){await store.upsert('submissions',id,{status:'unconfirmed',updatedAt:now.toISOString()});return response({error:'送信完了を確認できませんでした。メールでのご連絡をご利用ください。'},502);}
  const lead=normalizeLead({id,sourcePath:source?.path||'',stage:'inquiry',reference:id},now);lead.version=1;
  try { await db.batch([
    db.prepare("UPDATE seo_kv SET value=json_object('status','accepted'),updated_at=? WHERE namespace='submissions' AND key=?").bind(now.toISOString(),id),
    db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('leads',?,?,1,?) ON CONFLICT DO NOTHING").bind(id,JSON.stringify(lead),now.toISOString()),
  ]); } catch { return response({success:true,leadId:id,recorded:false}); }
  return response({success:true,leadId:id});
}
