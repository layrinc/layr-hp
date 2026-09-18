import {MAX_FILE,csvString} from './model.mjs';
import {analyticsFromCsv,joinedMetrics,putAnalyticsReport,validatePeriod} from './analytics-model.mjs';
import {GOOGLE_SCOPES,fetchGoogleReport,validateConnection} from './google-analytics.mjs';

export function mountAnalytics({catalog,getState,save,download}) {
  const $ = id=>document.getElementById(id), node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
  const number = n=>n==null?'—':new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(n);
  const option = (value,label)=>{const n=node('option',label);n.value=value;return n;};
  let active='', token='', expires=0, busy=false, pending=null, identityLoading;
  const message = (value,error=false)=>{const n=$('analytics-message');n.textContent=value;n.hidden=false;n.setAttribute('role',error?'alert':'status');};
  const config = ()=>validateConnection({clientId:$('analytics-client-id').value.trim(),property:$('analytics-property').value.trim(),site:$('analytics-site').value});
  const period = ()=>validatePeriod($('analytics-start').value,$('analytics-end').value);
  const label = r=>`${r.start}〜${r.end} / ${r.origin==='google'?'Google API':'CSV'} / GA4 ${r.property} / ${new Date(r.importedAt).toLocaleString('ja-JP')}`;
  const report = ()=>getState().analyticsReports?.find(r=>r.id===active);
  const comparison = ()=>getState().reports.find(r=>r.id===$('analytics-gsc').value);
  function render() {
    const reports=getState().analyticsReports||[];
    if(!reports.some(r=>r.id===active)) active=reports[0]?.id||'';
    $('analytics-report').replaceChildren(...(reports.length?reports.map(r=>option(r.id,label(r))):[option('','実績は未取得')]));
    $('analytics-report').value=active;
    const r=report(), previous=$('analytics-gsc').value;
    const matches=getState().reports.filter(s=>s.kind==='pages'&&s.start===r?.start&&s.end===r?.end);
    $('analytics-gsc').replaceChildren(option('',r?.origin==='google'?'一括取得した検索実績を使用':'検索実績は未選択'),...matches.map(s=>option(s.id,`${s.searchType} / ${s.filter}`)));
    if(matches.some(s=>s.id===previous))$('analytics-gsc').value=previous;
    $('analytics-scope').textContent=r?`${r.start}〜${r.end} / GA4：${r.gaTimezone} / GSC：America/Los_Angeles。取得：${new Date(r.importedAt).toLocaleString('ja-JP')}。${comparison()?`検索条件：${comparison().searchType} / ${comparison().filter}`:'検索条件：ウェブ・全デバイス・全ての国（API取得時）'}`:'実績は未取得です。公開直後や行が返らない地域を0件と表示しません。';
    const rows=joinedMetrics(r,comparison(),catalog);
    $('analytics-rows').replaceChildren(...rows.map(row=>{
      const tr=document.createElement('tr'),name=node('td',''),a=node('a',row.page.fullName);a.href=row.page.path;a.target='_blank';a.rel='noopener noreferrer';name.append(a);tr.append(name);
      for(const key of ['clicks','impressions','position','views','users','sessions','inquiries']){const td=node('td',number(row[key]));td.className='kw-number';tr.append(td);}return tr;
    }));
    $('analytics-notes').replaceChildren(...(r?.notes||[]).map(n=>node('li',n)));
    $('analytics-export').disabled=!r;$('analytics-delete').disabled=!r||busy;
  }
  function disconnect() {token='';expires=0;$('analytics-sync').disabled=true;$('analytics-disconnect').disabled=true;$('analytics-connection-status').textContent='Google未接続。保存済みの実績は引き続き閲覧できます。';}
  function loadIdentity() {
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    if(identityLoading)return identityLoading;
    identityLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
      const timer=setTimeout(()=>{identityLoading=null;script.remove();reject(new Error('Googleの接続画面を読み込めません。通信設定を確認してください。'));},15000);
      script.onload=()=>{clearTimeout(timer);if(window.google?.accounts?.oauth2)resolve();else{identityLoading=null;reject(new Error('Googleの接続機能を利用できません。'));}};
      script.onerror=()=>{clearTimeout(timer);identityLoading=null;script.remove();reject(new Error('Googleへの通信を確認してください。'));};document.head.append(script);
    });return identityLoading;
  }
  $('analytics-connect').addEventListener('click',async()=>{
    try {
      const c=config();localStorage.setItem('layr-ltori-google-config',JSON.stringify(c));
      $('analytics-connect').disabled=true;await loadIdentity();
      const client=window.google.accounts.oauth2.initTokenClient({client_id:c.clientId,scope:GOOGLE_SCOPES,
        callback:response=>{
          $('analytics-connect').disabled=false;
          if(response.error || !response.access_token){disconnect();message('Googleとの接続が完了しませんでした。アカウントの権限とOAuth設定を確認してください。',true);return;}
          if(!window.google.accounts.oauth2.hasGrantedAllScopes(response,...GOOGLE_SCOPES.split(' '))){disconnect();message('GA4とSearch Console両方の読み取り権限が必要です。再接続してください。',true);return;}
          token=response.access_token;expires=Date.now()+Number(response.expires_in||3600)*1000;
          $('analytics-sync').disabled=false;$('analytics-disconnect').disabled=false;
          $('analytics-connection-status').textContent='Googleに接続済み。期間を指定して「Googleから一括取得」を押してください。';
        },error_callback:()=>{$('analytics-connect').disabled=false;message('接続画面が閉じられたか開けませんでした。ポップアップを許可して再操作してください。',true);}});
      client.requestAccessToken({prompt:'consent'});
    } catch(error) {$('analytics-connect').disabled=false;message(error.message,true);}
  });
  $('analytics-disconnect').addEventListener('click',disconnect);
  for(const id of ['analytics-client-id','analytics-property','analytics-site'])$(id).addEventListener('change',disconnect);
  $('analytics-sync').addEventListener('click',async()=>{
    if(busy)return;
    try {
      if(!token||Date.now()>=expires){disconnect();throw new Error('接続期限が切れました。Googleに再接続してください。');}
      const c=config(), dates=period();busy=true;$('analytics-sync').disabled=true;
      message('Googleから検索・閲覧・流入・問い合わせ実績を取得しています。');
      const incoming=await fetchGoogleReport({config:c,token,...dates,catalog});
      active=incoming.id;await save(putAnalyticsReport(getState(),incoming));render();
      message('取得できた実績を保存しました。一部の取得に失敗した場合は、一覧の下に理由を表示します。');
    } catch(error){message(error.message,true);}
    finally{busy=false;$('analytics-sync').disabled=!token||Date.now()>=expires;render();}
  });
  $('analytics-report').addEventListener('change',()=>{active=$('analytics-report').value;render();});
  $('analytics-gsc').addEventListener('change',render);
  $('analytics-export').addEventListener('click',()=>{
    const r=report();if(!r)return;
    const rows=joinedMetrics(r,comparison(),catalog);
    download(`eltori-access-${r.start}-${r.end}.csv`,csvString([['地域','本番URL','開始日','終了日','検索クリック','検索表示回数','平均掲載順位','PV','総ユーザー数','流入セッション','問い合わせ完了数'],...rows.map(row=>[row.page.fullName,`https://layr.co.jp${row.page.path}`,r.start,r.end,...['clicks','impressions','position','views','users','sessions','inquiries'].map(k=>row[k]??'')])]),'text/csv;charset=utf-8');
  });
  $('analytics-delete').addEventListener('click',async()=>{
    if(!active||!confirm('このアクセス実績を削除しますか？必要なら先にJSONバックアップを保存してください。'))return;
    try {await save({...getState(),analyticsReports:getState().analyticsReports.filter(r=>r.id!==active)});render();message('選択したアクセス実績を削除しました。');}catch(error){message(error.message,true);}
  });
  const clearPreview=()=>{pending=null;$('analytics-csv-preview').hidden=true;};
  for(const id of ['analytics-csv-file','analytics-start','analytics-end','analytics-property'])$(id).addEventListener('change',clearPreview);
  $('analytics-csv-form').addEventListener('submit',async event=>{
    event.preventDefault();clearPreview();
    try {
      const file=$('analytics-csv-file').files[0];if(!file||file.size>MAX_FILE)throw new Error('20MB以内のCSVを指定してください。');
      pending=analyticsFromCsv(await file.text(),{...period(),property:$('analytics-property').value.trim()||'CSV'},catalog);
      $('analytics-csv-summary').textContent=`${pending.start}〜${pending.end}：${pending.rows.length}地域。${pending.notes.join(' ')} 同じ期間のCSVがあれば置き換えます。`;$('analytics-csv-preview').hidden=false;
    }catch(error){message(error.message,true);}
  });
  $('analytics-csv-save').addEventListener('click',async()=>{if(!pending)return;try{active=pending.id;await save(putAnalyticsReport(getState(),pending));clearPreview();render();message('アクセス実績を保存しました。同じ期間の検索実績を上の選択欄で組み合わせられます。');}catch(error){message(error.message,true);}});
  $('analytics-csv-template').addEventListener('click',()=>download('ga4-regional-columns.csv',csvString([['Path','Views','TotalUsers','Sessions','Inquiries']]),'text/csv;charset=utf-8'));
  try{const saved=JSON.parse(localStorage.getItem('layr-ltori-google-config')||'null');if(saved){const c=validateConnection(saved);$('analytics-client-id').value=c.clientId;$('analytics-property').value=c.property;$('analytics-site').value=c.site;}}catch{/* Leave invalid/missing connection settings empty. */}
  const end=new Date();end.setUTCDate(end.getUTCDate()-3);const start=new Date(end);start.setUTCDate(start.getUTCDate()-27);$('analytics-end').value=end.toISOString().slice(0,10);$('analytics-start').value=start.toISOString().slice(0,10);
  window.addEventListener('pagehide',disconnect);
  render();return render;
}
