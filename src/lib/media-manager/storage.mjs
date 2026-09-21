import {checkStateSize} from './model.mjs';
export const DATABASE_NAME='layr-ltori-media-v1';
export function openDatabase(indexedDBOverride=globalThis.indexedDB) {
  return new Promise((resolve,reject)=>{
    if(!indexedDBOverride){reject(new Error('このブラウザでは保存を利用できません。通常モードで開き直してください。'));return;}
    const request=indexedDBOverride.open(DATABASE_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspace'))request.result.createObjectStore('workspace');};
    request.onerror=()=>reject(new Error('このブラウザで保存を開始できません。通常モードで開き直してください。'));
    request.onblocked=()=>reject(new Error('別のタブを閉じて開き直してください。'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
export function loadState(db) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readonly'),request=tx.objectStore('workspace').get('state');
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=tx.onerror=()=>reject(new Error('保存データを読み込めませんでした。ブラウザの設定を確認してください。'));
  });
}
export function saveState(db,next,expectedRevision) {
  if(next?.kind!=='ltori-media' || next.version!==1 || !Number.isSafeInteger(expectedRevision) || expectedRevision<0) return Promise.reject(new Error('保存データの種類・版・更新番号が正しくありません。'));
  checkStateSize(next);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');let conflict=false,saved;
    const read=store.get('state');
    read.onsuccess=()=>{
      if((read.result?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}
      saved={...next,revision:expectedRevision+1,updatedAt:new Date().toISOString()};store.put(saved,'state');
    };
    tx.oncomplete=()=>resolve(saved);
    tx.onabort=tx.onerror=()=>reject(new Error(conflict?'別のタブで更新されました。再読み込みしてから操作してください。':'保存できませんでした。容量・ブラウザ設定を確認し、編集内容を控えてから再度お試しください。'));
  });
}
