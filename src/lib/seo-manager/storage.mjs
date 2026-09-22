const ENDPOINT='/api/seo/state';
async function call(method='GET',payload) {
  const response=await fetch(ENDPOINT,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:payload?{'Content-Type':'application/json'}:{},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'共通データを読み込めませんでした。再ログインして確認してください。');return result.state;
}
async function legacyState() {
  if(!globalThis.indexedDB)return null;
  return new Promise(resolve=>{
    const request=indexedDB.open('layr-ltori-seo-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
    request.onerror=request.onblocked=()=>resolve(null);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspace','readonly'),read=tx.objectStore('workspace').get('state');tx.oncomplete=()=>{db.close();resolve(read.result||null);};tx.onerror=()=>{db.close();resolve(null);};};
  });
}
export async function openDatabase() {
  let state=await call();
  if(!state){const old=await legacyState();if(old){try{state=await call('PUT',{state:old,expectedRevision:0});}catch{state=await call();if(!state)throw new Error('旧データの移行が完了していません。元のブラウザデータは残っています。');}}}
  return {kind:'server',state};
}
export async function loadState(db){return db.state;}
export async function saveState(db,next,expectedRevision){const state=await call('PUT',{state:next,expectedRevision});db.state=state;return state;}
