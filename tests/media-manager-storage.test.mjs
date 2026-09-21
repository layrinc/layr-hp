import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMediaState} from '../src/lib/media-manager/model.mjs';
import {openDatabase,loadState,saveState,DATABASE_NAME} from '../src/lib/media-manager/storage.mjs';
// Minimal transactional IndexedDB adapter: transactions execute serially, get callbacks
// run before commit, and abort cannot publish the pending write.
function transactionalDb(initial) {
  let stored=initial,queue=Promise.resolve();
  return {transaction(name,mode){
    assert.equal(name,'workspace');let read,write,aborted=false;
    const tx={objectStore(store){assert.equal(store,'workspace');return {get(key){assert.equal(key,'state');read={};return read;},put(value,key){assert.equal(mode,'readwrite');assert.equal(key,'state');write=structuredClone(value);}};},abort(){aborted=true;}};
    queue=queue.then(()=>new Promise(resolve=>queueMicrotask(()=>{
      read.result=structuredClone(stored);read.onsuccess?.();
      if(aborted)tx.onabort?.();else{if(write)stored=write;tx.oncomplete?.();}resolve();
    })));
    return tx;
  },get stored(){return stored;}};
}
test('media storage opens a separate database and fails clearly without IndexedDB',async()=>{
  const db={objectStoreNames:{contains:()=>false},createObjectStore:name=>assert.equal(name,'workspace'),close(){}};
  const opened=await openDatabase({open(name,version){assert.equal(name,'layr-ltori-media-v1');assert.equal(version,1);const request={result:db};queueMicrotask(()=>{request.onupgradeneeded();request.onsuccess();});return request;}});
  assert.equal(DATABASE_NAME,'layr-ltori-media-v1');assert.equal(opened,db);assert.equal(typeof db.onversionchange,'function');
  await assert.rejects(openDatabase(null),/保存を利用できません/);
});
test('save commits revision atomically and load only resolves after transaction completion',async()=>{
  const db=transactionalDb();assert.equal(await loadState(db),undefined);
  const saved=await saveState(db,emptyMediaState(),0);assert.equal(saved.revision,1);assert.ok(saved.updatedAt);
  assert.equal((await loadState(db)).revision,1);assert.equal(db.stored.kind,'ltori-media');
});
test('two tabs starting at the same revision cannot silently overwrite each other',async()=>{
  const db=transactionalDb({...emptyMediaState(),revision:4});
  const result=await Promise.allSettled([saveState(db,{...emptyMediaState(),plans:[{id:'first'}]},4),saveState(db,{...emptyMediaState(),plans:[{id:'second'}]},4)]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.match(result[1].reason.message,/別のタブ/);
  assert.equal(db.stored.revision,5);assert.equal(db.stored.plans[0].id,'first');
});
test('wrong workspace kind and invalid expected revisions never start a write transaction',async()=>{
  const db={transaction(){assert.fail('must not start');}};
  await assert.rejects(saveState(db,{...emptyMediaState(),kind:'regional'},0),/種類/);
  await assert.rejects(saveState(db,emptyMediaState(),-1),/更新番号/);
});
