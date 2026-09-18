const DB = 'layr-ltori-seo-v1';
export function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
    request.onerror=()=>reject(new Error('このブラウザで保存を開始できません。通常モードのブラウザで開き直してください。'));
    request.onblocked=()=>reject(new Error('別のタブを閉じて開き直してください。'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
export function loadState(db) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readonly'), req=tx.objectStore('workspace').get('state');
    tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);
  });
}
export function saveState(db,next,expectedRevision) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readwrite'), store=tx.objectStore('workspace');let conflict=false,saved;
    const read=store.get('state');
    read.onsuccess=()=>{
      if((read.result?.revision||0)!==expectedRevision){conflict=true;tx.abort();return;}
      saved={...next,revision:expectedRevision+1,updatedAt:new Date().toISOString()};store.put(saved,'state');
    };
    tx.oncomplete=()=>resolve(saved);
    tx.onabort=tx.onerror=()=>reject(new Error(conflict?'別のタブで更新されました。再読み込みしてから操作してください。':'保存できませんでした。容量・ブラウザ設定を確認し、編集内容を控えてから再度お試しください。'));
  });
}
