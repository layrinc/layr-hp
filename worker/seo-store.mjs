const initialized = new WeakMap();
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS seo_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,key))`,
  `CREATE TABLE IF NOT EXISTS seo_documents (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL, scheduled_at TEXT, reviewed_version INTEGER, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seo_published (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, value TEXT NOT NULL, version INTEGER NOT NULL, published_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seo_release_events (id TEXT PRIMARY KEY, day TEXT NOT NULL, document_id TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(document_id,version))`,
  `CREATE INDEX IF NOT EXISTS seo_release_day ON seo_release_events(day)`,
  `CREATE INDEX IF NOT EXISTS seo_due_documents ON seo_documents(status,scheduled_at)`,
  `CREATE TABLE IF NOT EXISTS seo_activity (id TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)`,
];
export const japanDay = now => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(now);
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function ensureDatabase(db) {
  if (!db?.prepare) throw new HttpError(503, '共通データベースが未接続です。CloudflareのSEO_DBバインディングを確認してください。');
  if (!initialized.has(db)) initialized.set(db, db.batch(SCHEMA.map(sql=>db.prepare(sql))).catch(error=>{initialized.delete(db);throw error;}));
  await initialized.get(db);
}
const valueOf = row => row ? {...JSON.parse(row.value), version:row.version, updatedAt:row.updated_at} : null;
export function createStore(db) {
  return {
    async get(namespace, key) { const row = await db.prepare('SELECT value FROM seo_kv WHERE namespace=? AND key=?').bind(namespace,key).first(); return row ? JSON.parse(row.value) : null; },
    async list(namespace) { const {results} = await db.prepare('SELECT key,value,updated_at,version FROM seo_kv WHERE namespace=? ORDER BY key').bind(namespace).all(); return results.map(row=>({key:row.key,value:JSON.parse(row.value),updatedAt:row.updated_at,version:row.version})); },
    async upsert(namespace,key,value) { const now=new Date().toISOString(); await db.prepare('INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,version=seo_kv.version+1,updated_at=excluded.updated_at').bind(namespace,key,JSON.stringify(value),now).run(); return value; },
  };
}
export async function activity(db,kind,message,now=new Date()) {
  await db.batch([
    db.prepare('INSERT INTO seo_activity(id,kind,message,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),kind,String(message).slice(0,600),now.toISOString()),
    db.prepare('DELETE FROM seo_activity WHERE id NOT IN (SELECT id FROM seo_activity ORDER BY created_at DESC LIMIT 1000)'),
  ]);
}
export async function getDocuments(db) { const {results}=await db.prepare('SELECT * FROM seo_documents ORDER BY updated_at DESC').all(); return results.map(valueOf); }
export async function getDocument(db,id) { return valueOf(await db.prepare('SELECT * FROM seo_documents WHERE id=?').bind(id).first()); }
export async function getPublished(db) { const {results}=await db.prepare('SELECT * FROM seo_published ORDER BY published_at DESC,id').all(); return results.map(row=>({...JSON.parse(row.value),version:row.version,publishedAt:row.published_at,status:'published'})); }
export async function getWorkspace(db) {
  // One read statement gives metadata and its parts the same SQLite snapshot.
  // A separate metadata read followed by a parts read could race with cleanup.
  const {results}=await db.prepare(`SELECT w.value AS state_value,w.version,w.updated_at,p.key AS part_key,p.value AS part_value
    FROM seo_kv w LEFT JOIN seo_kv p ON p.namespace='workspace_parts'
      AND p.key LIKE (json_extract(w.value,'$.__seoWorkspaceStorage.token') || ':%')
    WHERE w.namespace='workspace' AND w.key='state' ORDER BY p.key`).all();
  if(!results.length)return null;
  const row=results[0];
  try {
    let value=JSON.parse(row.state_value);
    const storage=value?.__seoWorkspaceStorage;
    if(storage?.format==='chunks-v1') {
      if(!/^[a-f0-9-]{36}$/.test(storage.token)||!Number.isInteger(storage.parts)||storage.parts<1||storage.parts>50||!Number.isInteger(storage.bytes)||storage.bytes<2||storage.bytes>20*1024*1024||results.length!==storage.parts)throw new Error('Invalid workspace storage');
      const parts=results.map((part,index)=>{
        if(part.part_key!==`${storage.token}:${String(index).padStart(5,'0')}`)throw new Error('Missing workspace part');
        const text=JSON.parse(part.part_value);if(typeof text!=='string')throw new Error('Invalid workspace part');return text;
      });
      const json=parts.join('');if(new TextEncoder().encode(json).length!==storage.bytes)throw new Error('Incomplete workspace');
      value=JSON.parse(json);
    }
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid workspace');
    return {...value,revision:row.version,updatedAt:row.updated_at};
  } catch {throw new HttpError(503,'保存データを読み出せませんでした。再読み込みしても解消しない場合はバックアップを確認してください。');}
}
export async function saveWorkspace(db,value,expectedRevision,now=new Date()) {
  if (!Number.isInteger(expectedRevision)||expectedRevision<0) throw new HttpError(400,'保存版を確認してください。');
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'保存データの形式を確認してください。');
  let json;try{json=JSON.stringify(value);}catch{throw new HttpError(400,'保存データの形式を確認してください。');}
  const bytes=new TextEncoder().encode(json).length;
  if(bytes>20*1024*1024)throw new HttpError(413,'保存データは20MiB以内にしてください。古い実績をバックアップしてください。');
  const token=crypto.randomUUID(),parts=[],updatedAt=now.toISOString(),revision=expectedRevision+1;
  // At most 500k UTF-16 code units: even Japanese text stays under D1's 2MB
  // cell limit. Keep surrogate pairs intact before SQLite encodes the binding.
  for(let start=0;start<json.length;) {
    let end=Math.min(start+500000,json.length);
    if(end<json.length&&json.charCodeAt(end-1)>=0xD800&&json.charCodeAt(end-1)<=0xDBFF)end--;
    parts.push(JSON.stringify(json.slice(start,end)));start=end;
  }
  const metadata=JSON.stringify({__seoWorkspaceStorage:{format:'chunks-v1',token,parts:parts.length,bytes}});
  const statement=expectedRevision===0
    ?db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES('workspace','state',?,1,?) ON CONFLICT DO NOTHING").bind(metadata,updatedAt)
    :db.prepare("UPDATE seo_kv SET value=?,version=version+1,updated_at=? WHERE namespace='workspace' AND key='state' AND version=?").bind(metadata,updatedAt,expectedRevision);
  const guard="EXISTS(SELECT 1 FROM seo_kv WHERE namespace='workspace' AND key='state' AND value=? AND version=?)";
  // A losing CAS writer must neither insert its parts nor delete the winner's.
  // All statements are in one D1 transaction; failed writes retain the old state.
  const results=await db.batch([
    statement,
    ...parts.map((part,index)=>db.prepare(`INSERT INTO seo_kv(namespace,key,value,updated_at) SELECT 'workspace_parts',?,?,? WHERE ${guard}`).bind(`${token}:${String(index).padStart(5,'0')}`,part,updatedAt,metadata,revision)),
    db.prepare(`DELETE FROM seo_kv WHERE namespace='workspace_parts' AND key NOT LIKE ? AND ${guard}`).bind(`${token}:%`,metadata,revision),
  ]);
  if(!results[0].meta.changes)throw new HttpError(409,'別の端末で更新されました。再読み込みしてから保存してください。');
  return {...value,revision,updatedAt};
}
export async function saveDocument(db,doc,expectedVersion=0,now=new Date()) {
  const version=expectedVersion+1;
  const saved={...doc,status:'draft',version,updatedAt:now.toISOString(),review:null,publishedAt:null};
  const sql=expectedVersion===0
    ?db.prepare('INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(saved.id,saved.path,saved.type,'draft',version,JSON.stringify(saved),saved.scheduledAt||null,saved.updatedAt)
    :db.prepare("UPDATE seo_documents SET value=?,version=?,status='draft',scheduled_at=?,reviewed_version=NULL,updated_at=? WHERE id=? AND version=?").bind(JSON.stringify(saved),version,saved.scheduledAt||null,saved.updatedAt,saved.id,expectedVersion);
  const result=await sql.run();if(!result.meta.changes)throw new HttpError(409,'原稿が別の端末で変更されています。読み直してください。');
  return saved;
}
export async function approveDocument(db,doc,version,reviewer,now=new Date()) {
  const approved={...doc,version:version+1,status:'scheduled',review:{reviewedBy:reviewer,reviewedAt:now.toISOString()},scheduledAt:doc.scheduledAt||now.toISOString(),updatedAt:now.toISOString()};
  const result=await db.prepare("UPDATE seo_documents SET value=?,version=?,status='scheduled',scheduled_at=?,reviewed_version=?,updated_at=? WHERE id=? AND version=? AND status!='scheduled'").bind(JSON.stringify(approved),approved.version,approved.scheduledAt,approved.version,approved.updatedAt,doc.id,version).run();
  if(!result.meta.changes)throw new HttpError(409,'原稿が更新されたか、すでに予約済みです。再読み込みしてください。');
  return approved;
}
export async function pauseDocument(db,id,version,now=new Date()) {
  // Pausing a live document also removes its public snapshot. The draft remains restorable.
  const result=await db.batch([
    db.prepare("UPDATE seo_documents SET status='paused',version=version+1,reviewed_version=NULL,value=json_set(value,'$.status','paused','$.version',version+1),updated_at=? WHERE id=? AND version=?").bind(now.toISOString(),id,version),
    db.prepare("DELETE FROM seo_published WHERE id=? AND EXISTS(SELECT 1 FROM seo_documents WHERE id=? AND version=? AND status='paused')").bind(id,id,version+1),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'原稿の版が変わりました。再読み込みしてください。');
}
export async function publishDue(db,now=new Date()) {
  const day=japanDay(now),iso=now.toISOString(),run=crypto.randomUUID();
  // D1 batch is transactional. Selection and the remaining daily quota are evaluated
  // in the same transaction; retries/overlapping cron deliveries cannot exceed ten.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO seo_release_events(id,day,document_id,version,run_id,created_at)
      SELECT lower(hex(randomblob(16))),?,id,version,?,? FROM seo_documents
      WHERE status='scheduled' AND reviewed_version=version AND scheduled_at<=?
      AND COALESCE((SELECT json_extract(value,'$.paused') FROM seo_kv WHERE namespace='settings' AND key='publication'),0)=0
      AND NOT EXISTS(SELECT 1 FROM seo_release_events r WHERE r.document_id=seo_documents.id AND r.version=seo_documents.version)
      ORDER BY scheduled_at,id LIMIT MAX(0,10-(SELECT COUNT(*) FROM seo_release_events WHERE day=?))`).bind(day,run,iso,iso,day),
    db.prepare(`INSERT INTO seo_published(id,path,value,version,published_at)
      SELECT d.id,d.path,json_set(d.value,'$.status','published','$.publishedAt',?),d.version,? FROM seo_documents d JOIN seo_release_events r ON r.document_id=d.id AND r.version=d.version WHERE r.run_id=?
      ON CONFLICT(id) DO UPDATE SET path=excluded.path,value=excluded.value,version=excluded.version,published_at=excluded.published_at`).bind(iso,iso,run),
    db.prepare("UPDATE seo_documents SET status='published',value=json_set(value,'$.status','published','$.publishedAt',?),updated_at=? WHERE id IN (SELECT document_id FROM seo_release_events WHERE run_id=?)").bind(iso,iso,run),
  ]);
  const {results}=await db.prepare('SELECT document_id FROM seo_release_events WHERE run_id=?').bind(run).all();
  if(results.length)await activity(db,'publish',`${day}に${results.length}件を公開しました。`,now);
  return {day,published:results.map(row=>row.document_id),dailyLimit:10};
}
export async function publicationStats(db,now=new Date()) {
  const row=await db.prepare('SELECT COUNT(*) AS count FROM seo_release_events WHERE day=?').bind(japanDay(now)).first();
  const queue=await db.prepare("SELECT COUNT(*) AS count FROM seo_documents WHERE status='scheduled' AND reviewed_version=version").first();
  return {todayPublished:row.count,queued:queue.count,dailyLimit:10,day:japanDay(now)};
}
export async function backup(db) {
  const tables=['seo_kv','seo_documents','seo_published','seo_release_events','seo_activity'];const result={schemaVersion:1,exportedAt:new Date().toISOString(),tables:{}};
  for(const name of tables){const {results}=await db.prepare(`SELECT * FROM ${name}`).all();result.tables[name]=results;}
  return result;
}
