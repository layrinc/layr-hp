import seed from '../src/data/ltori-growth-seed.json' with {type:'json'};
import {normalizeDocument,qualityIssues,publicPath} from '../src/lib/seo-manager/editorial-model.mjs';
import {ensureDatabase,createStore} from './seo-store.mjs';

// Initial content has been checked by Codex against the cited municipal sources.
// The user authorized development and publication; this is not a human review record.
const REVIEW={reviewedBy:'Codex（初回の出典・原稿確認）',reviewedAt:'2026-09-21T15:00:00.000Z'};
const initialized=new WeakMap();
export async function initializeGrowth(env) {
  await ensureDatabase(env.SEO_DB);const db=env.SEO_DB;
  if(initialized.has(db))return initialized.get(db);
  const promise=(async()=>{
    const store=createStore(db);if(await store.get('setup','initial-city-queue-v1'))return;
    const statements=[];
    for(const input of seed.documents) {
      const doc=normalizeDocument(input,{status:'scheduled',review:REVIEW,scheduledAt:input.scheduledAt,now:REVIEW.reviewedAt});
      if(qualityIssues(doc,{requireReview:true}).some(issue=>issue.severity==='error'))throw new Error('Initial editorial validation failed');
      doc.version=1;doc.path=publicPath(doc);
      statements.push(db.prepare("INSERT INTO seo_documents(id,path,type,status,version,value,scheduled_at,reviewed_version,updated_at) VALUES(?,?,?,'scheduled',1,?,?,1,?) ON CONFLICT DO NOTHING").bind(doc.id,doc.path,doc.type,JSON.stringify(doc),doc.scheduledAt,doc.updatedAt));
    }
    statements.push(db.prepare("INSERT INTO seo_kv(namespace,key,value,updated_at) VALUES('setup','initial-city-queue-v1',?,?) ON CONFLICT DO NOTHING").bind(JSON.stringify({count:seed.documents.length,reviewedBy:REVIEW.reviewedBy}),new Date().toISOString()));
    await db.batch(statements);
  })();
  initialized.set(db,promise);try{await promise;}catch(error){initialized.delete(db);throw error;}
}
