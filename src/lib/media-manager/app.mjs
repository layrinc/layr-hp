import {MAX_FILE,STATUS,PRIORITY,normalizeKeyword,emptyMediaState,plansFromRows,mergePlans,planEdit,validatePlanEdit,volumeFromCsv,applyVolumeReport,rankPlans,joinMediaMetrics,validateMediaBackup,applyAnalyticsReport,applySearchReport,csvString,checkStateSize} from './model.mjs';
import {openDatabase,loadState,saveState} from './storage.mjs';
import {createPreviewChannel} from './preview-import.mjs';
import {GOOGLE_SCOPES,SHEETS_SCOPE,validateConnection,fetchMediaReport,fetchMediaSearchQueries,fetchMediaPlans} from './google.mjs';

const $=id=>document.getElementById(id);
const element=(tag,value='',className='')=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
const option=(value,label)=>{const node=element('option',label);node.value=value;return node;};
const number=value=>value==null?'—':new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(value);
const percentage=value=>value==null?'—':`${number(value*100)}%`;
const dateLabel=value=>value?new Date(value).toLocaleString('ja-JP'):'未取得';
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const catalog=JSON.parse($('mm-catalog').textContent);
const seed=JSON.parse($('mm-seed').textContent);
const metricsKeys=['views','users','sessions','cta','inquiries','documents','clicks','impressions','ctr','position'];
const metricsLabels=['PV','ユーザー','流入セッション','CTAクリック','相談完了','資料請求完了','検索クリック','検索表示','CTR','平均順位'];
let state=emptyMediaState(),db,saveBusy=false,fetchBusy=false,ready=false;
let activeVolume='',activeAnalytics='',activeQuery='',page=1,queryPage=1;
let pendingVolume=null,pendingPlans=null,pendingBackup=null,editingId='',editorDirty=false;
let token='',expires=0,sheetToken='',sheetExpires=0,identityLoading=null,oauthPending=false;
const pageSize=30;
const volumePreviewChannel=createPreviewChannel(),planPreviewChannel=createPreviewChannel(),backupPreviewChannel=createPreviewChannel();

function message(text,error=false){const box=$('mm-message');box.textContent=text;box.hidden=false;box.setAttribute('role',error?'alert':'status');}
function download(name,value,type='text/csv;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([value],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function commit(next){
  if(!ready||!db)throw new Error('保存の準備ができていません。再読み込みしてください。');
  if(saveBusy)throw new Error('別の変更を保存中です。完了後に操作してください。');
  checkStateSize(next);saveBusy=true;$('mm-save-state').textContent='保存中';
  try{state=await saveState(db,next,state.revision);render();}
  finally{saveBusy=false;$('mm-save-state').textContent=state.updatedAt?`このブラウザに保存：${dateLabel(state.updatedAt)}`:'このブラウザに保存';}
}
function showTab(name){
  if(!['plans','volume','analytics','settings'].includes(name))return;
  for(const panel of document.querySelectorAll('[data-mm-panel]'))panel.hidden=panel.dataset.mmPanel!==name;
  for(const button of document.querySelectorAll('[data-mm-tab]')){if(button.dataset.mmTab===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  history.replaceState(null,'',`#${name}`);
}
const volumeReport=()=>state.volumeReports.find(report=>report.id===activeVolume)||null;
const analyticsReport=()=>state.analyticsReports.find(report=>report.id===activeAnalytics)||null;
const queryReport=()=>state.searchReports.find(report=>report.id===activeQuery&&report.kind==='queries')||null;
const reportLabel=report=>`${report.start}〜${report.end} / ${dateLabel(report.importedAt)}`;
const volumeLabel=report=>`${report.source} / ${report.periodStart}〜${report.periodEnd} / ${report.country}・${report.language} / ${report.network}・${report.matchType} / 取得 ${dateLabel(report.fetchedAt)}`;
function replaceOptions(id,rows,empty,selected){
  const target=$(id);target.replaceChildren(...(rows.length?rows.map(row=>option(row.id,row.label)):[option('',empty)]));
  target.value=rows.some(row=>row.id===selected)?selected:(rows[0]?.id||'');return target.value;
}
function volumeText(row){if(!row)return '未取得';if(row.status==='measured')return number(row.volume);if(row.status==='range')return `${number(row.lower)}〜${number(row.upper)}`;return '未取得';}
function volumeCell(row){const td=element('td','',`kw-number${row?.status==='measured'&&row.volume===0?' mm-zero':!row||row.status==='unknown'?' mm-unknown':''}`);td.append(element('span',volumeText(row)));td.append(element('small',row?.status==='measured'?(row.volume===0?'確認済み0':'月間検索数'):row?.status==='range'?'範囲値':'数値未取得'));return td;}
function externalLink(title,path){const link=element('a',title);link.href=path.startsWith('https://')?path:`https://layr.co.jp${path}`;link.target='_blank';link.rel='noopener noreferrer';return link;}
function visiblePlans(){
  const search=$('mm-search').value.trim().normalize('NFKC').toLowerCase(),need=$('mm-need').value,status=$('mm-status').value,filter=$('mm-volume-filter').value;
  return rankPlans(state.plans,volumeReport(),state.edits,$('mm-sort').value).filter(row=>{
    if(search&&!`${row.id} ${row.keyword} ${row.title}`.normalize('NFKC').toLowerCase().includes(search))return false;
    if(need&&row.need!==need)return false;if(status&&row.edit.status!==status)return false;
    const measured=row.volume?.status==='measured';
    if(filter==='positive'&&!(measured&&row.volume.volume>0))return false;
    if(filter==='zero'&&!(measured&&row.volume.volume===0))return false;
    if(filter==='unknown'&&measured)return false;
    return true;
  });
}
function planMetrics(){return new Map(joinMediaMetrics(state.plans,analyticsReport(),catalog,state.edits).map(row=>[row.id,row]));}
function renderPlanTable(){
  const rows=visiblePlans(),mode=$('mm-column-mode').value,joined=planMetrics(),pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(Math.max(1,page),pages);
  const head=element('tr');for(const title of ['ID','主キーワード','記事タイトル','月間検索数',...(mode==='plan'?['需要・カテゴリー','制作状況','優先度','公開記事','編集']:metricsLabels)])head.append(element('th',title));$('mm-plan-head').replaceChildren(head);
  $('mm-plan-rows').replaceChildren(...rows.slice((page-1)*pageSize,page*pageSize).map(row=>{
    const tr=element('tr');tr.append(element('td',row.id));const keyword=element('td',row.keyword,'mm-keyword');if(row.segment==='追加調査候補')keyword.append(element('small','追加調査候補'));tr.append(keyword);
    const title=element('td',row.title,'mm-title');title.append(element('small',row.month?`公開予定：${row.month}`:'公開月は未選定'));tr.append(title,volumeCell(row.volume));
    if(mode==='plan'){
      const need=element('td',row.need||'未分類');need.append(element('small',row.category));tr.append(need,element('td',STATUS[row.edit.status]||row.edit.status,'kw-status'),element('td',PRIORITY[row.edit.priority]||row.edit.priority,'kw-status'));
      const linked=joined.get(row.id)?.page,url=element('td');if(linked)url.append(externalLink('記事を開く ↗',linked.path));else url.textContent='未紐づけ';tr.append(url);
      const action=element('td'),button=element('button','編集','kw-button');button.type='button';button.dataset.editId=row.id;button.setAttribute('aria-label',`${row.id} ${row.keyword}を編集`);action.append(button);tr.append(action);
    }else{const metrics=joined.get(row.id)?.metrics||{};for(const key of metricsKeys)tr.append(element('td',key==='ctr'?percentage(metrics[key]):number(metrics[key]),'kw-number'));}
    return tr;
  }));
  if(!rows.length){const tr=element('tr'),td=element('td','条件に一致する企画がありません。絞り込みを変更してください。','kw-empty');td.colSpan=mode==='plan'?9:14;tr.append(td);$('mm-plan-rows').append(tr);}
  $('mm-plan-count').textContent=`${rows.length}件 / 全${state.plans.length}件${mode==='metrics'?(analyticsReport()?` ・実績 ${analyticsReport().start}〜${analyticsReport().end}`:' ・アクセス実績は未取得'):''}`;
  $('mm-page').textContent=`${page} / ${pages}`;$('mm-prev').disabled=page===1;$('mm-next').disabled=page===pages;
}
function renderAnalytics(){
  activeAnalytics=replaceOptions('mm-analytics-report',state.analyticsReports.map(r=>({id:r.id,label:reportLabel(r)})),'実績は未取得',activeAnalytics);
  const report=analyticsReport();$('mm-analytics-scope').textContent=report?`${report.start}〜${report.end} / GA4 ${report.gaTimezone||'タイムゾーン未取得'} / GSC America/Los_Angeles / 取得：${dateLabel(report.importedAt)}`:'実績は未取得です。Googleに接続して取得してください。行が返らない記事を0と表示しません。';
  $('mm-analytics-notes').replaceChildren(...(report?.notes||[]).map(note=>element('li',note)));
  const byId=new Map((report?.rows||[]).map(row=>[row.pageId,row]));
  $('mm-analytics-rows').replaceChildren(...catalog.map(article=>{const tr=element('tr'),td=element('td');td.append(externalLink(article.title,article.path));tr.append(td);const values=byId.get(article.id)||{};for(const key of metricsKeys)tr.append(element('td',key==='ctr'?percentage(values[key]):number(values[key]),'kw-number'));return tr;}));
  $('mm-export-metrics').disabled=!report;
  activeQuery=replaceOptions('mm-query-report',state.searchReports.filter(r=>r.kind==='queries').map(r=>({id:r.id,label:reportLabel(r)})),'クエリは未取得',activeQuery);
  renderQueries();
}
function renderQueries(){
  const report=queryReport(),search=$('mm-query-search').value.trim().normalize('NFKC').toLowerCase(),articles=new Map(catalog.map(item=>[item.id,item]));
  const rows=(report?.rows||[]).filter(row=>!search||row.query.normalize('NFKC').toLowerCase().includes(search)).slice().sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions||a.query.localeCompare(b.query,'ja'));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));queryPage=Math.min(Math.max(1,queryPage),pages);
  $('mm-query-scope').textContent=report?`${report.start}〜${report.end} / 取得：${dateLabel(report.importedAt)}。${report.notes.join(' ')}`:'検索クエリは未取得です。上部のボタンから取得できます。';
  $('mm-query-rows').replaceChildren(...rows.slice((queryPage-1)*pageSize,queryPage*pageSize).map(row=>{const tr=element('tr');tr.append(element('td',row.query,'kw-name'));const article=articles.get(row.pageId),td=element('td',article?.title||row.pageId,'kw-name');tr.append(td);for(const key of ['clicks','impressions','ctr','position'])tr.append(element('td',key==='ctr'?percentage(row[key]):number(row[key]),'kw-number'));return tr;}));
  if(!rows.length){const tr=element('tr'),td=element('td',report?'この条件のクエリ行はありません。':'検索クエリは未取得です。','kw-empty');td.colSpan=6;tr.append(td);$('mm-query-rows').append(tr);}
  $('mm-query-count').textContent=`${rows.length}件`;$('mm-query-page').textContent=`${queryPage} / ${pages}`;$('mm-query-prev').disabled=queryPage===1;$('mm-query-next').disabled=queryPage===pages;$('mm-export-queries').disabled=!report;
}
function renderConnection(){
  const connected=Boolean(token&&Date.now()<expires);$('mm-stat-google').textContent=connected?'接続済み':'未接続';
  $('mm-fetch-metrics').disabled=!connected||fetchBusy||!ready;$('mm-fetch-queries').disabled=!connected||fetchBusy||!ready;
  $('mm-google-disconnect').disabled=!token&&!sheetToken;
  $('mm-google-connect').disabled=oauthPending;$('mm-sheet-read').disabled=oauthPending||fetchBusy||!ready;
  $('mm-analytics-connection').textContent=connected?'Google接続済み。期間を指定して取得してください。':'Google未接続。接続・入出力画面で設定してください。';
}
function render(){
  activeVolume=replaceOptions('mm-volume-report',state.volumeReports.map(r=>({id:r.id,label:volumeLabel(r)})),'調査データは未取得',activeVolume);
  const report=volumeReport();$('mm-volume-scope').textContent=report?`${report.source} / ${report.periodStart}〜${report.periodEnd} / ${report.country} / ${report.language} / ${report.network} / ${report.matchType} / 取得：${dateLabel(report.fetchedAt)}`:'検索ボリュームは未取得です。数値を推測していません。';
  const need=$('mm-need').value;$('mm-need').replaceChildren(option('','すべて'),...[...new Set(state.plans.map(p=>p.need).filter(Boolean))].sort().map(value=>option(value,value)));$('mm-need').value=need;
  const ranked=rankPlans(state.plans,report,state.edits);$('mm-stat-plans').textContent=number(state.plans.length);$('mm-stat-measured').textContent=number(ranked.filter(row=>row.volume?.status==='measured').length);$('mm-stat-volume-note').textContent=report?`${report.source}・実数のみ集計`:'調査CSVは未取込';
  $('mm-stat-linked').textContent=number(joinMediaMetrics(state.plans,null,catalog,state.edits).filter(row=>row.page).length);
  $('mm-keywords-export').textContent=`調査用キーワード${state.plans.length}件を出力`;
  const latest=state.analyticsReports.slice().sort((a,b)=>b.importedAt.localeCompare(a.importedAt))[0];$('mm-last-fetch').textContent=latest?`最終取得：${dateLabel(latest.importedAt)}`:'実績は未取得';
  renderAnalytics();renderPlanTable();renderConnection();
}
function config(){return validateConnection({clientId:$('mm-client-id').value.trim(),property:$('mm-property').value.trim(),site:$('mm-site').value});}
function dates(){const start=$('mm-analytics-start').value,end=$('mm-analytics-end').value;if(!start||!end||start>end)throw new Error('開始日と終了日を確認してください。');return {start,end};}
function disconnect(){clearPlanPreview();token='';expires=0;sheetToken='';sheetExpires=0;$('mm-google-status').textContent='Google未接続。保存済みの実績は閲覧できます。';$('mm-sheet-status').textContent='シートへの読み取り権限は未接続。';renderConnection();}
function loadIdentity(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();if(identityLoading)return identityLoading;
  identityLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
    const timer=setTimeout(()=>{identityLoading=null;script.remove();reject(new Error('Google接続画面を読み込めません。通信設定を確認してください。'));},15000);
    script.onload=()=>{clearTimeout(timer);if(window.google?.accounts?.oauth2)resolve();else{identityLoading=null;reject(new Error('Google接続機能を利用できません。'));}};
    script.onerror=()=>{clearTimeout(timer);identityLoading=null;script.remove();reject(new Error('Googleへの通信を確認してください。'));};document.head.append(script);
  });return identityLoading;
}
async function authorize(scope,clientId){
  if(oauthPending)throw new Error('Google接続画面を操作中です。');oauthPending=true;renderConnection();
  try{await loadIdentity();return await new Promise((resolve,reject)=>{
    const client=window.google.accounts.oauth2.initTokenClient({client_id:clientId,scope,include_granted_scopes:false,
      callback:response=>{if(response.error||!response.access_token){reject(new Error('Googleとの接続が完了しませんでした。権限とOAuth設定を確認してください。'));return;}
        if(!window.google.accounts.oauth2.hasGrantedAllScopes(response,...scope.split(' '))){reject(new Error('必要な読み取り権限が許可されていません。再接続してください。'));return;}
        resolve({token:response.access_token,expires:Date.now()+Number(response.expires_in||3600)*1000});},
      error_callback:()=>reject(new Error('接続画面が閉じられたか開けませんでした。ポップアップを許可して再操作してください。'))});client.requestAccessToken({prompt:'consent',include_granted_scopes:false});
  });}finally{oauthPending=false;renderConnection();}
}
function selectedFile(id){const file=$(id).files[0];if(!file||file.size>MAX_FILE)throw new Error('20MB以内のファイルを指定してください。');return file;}
function previewPlans(plans,origin){
  pendingPlans=plans;const current=new Map(state.plans.map(plan=>[plan.id,plan]));let existing=0,changed=0,edited=0;
  for(const plan of plans){if(current.has(plan.id)){existing++;if(JSON.stringify(current.get(plan.id))!==JSON.stringify(plan))changed++;if(state.edits[plan.id])edited++;}}
  $('mm-plan-import-summary').textContent=`${origin}：${plans.length}件。新規${plans.length-existing}件、同じID ${existing}件（企画項目の差分${changed}件）。ローカル編集${edited}件は保持します。`;
  $('mm-plan-import-sample').replaceChildren(...plans.slice(0,8).map(plan=>element('li',`${plan.id}｜${plan.keyword}｜${plan.title}`)));$('mm-plan-preview').hidden=false;
}
function showVolumePreview(incoming){
  pendingVolume=incoming;const {summary,report,unmatched,conflicts}=incoming;
  $('mm-volume-summary').textContent=`${volumeLabel(report)}。調査 ${summary.total}件 / 企画に一致${summary.matched}件 / 未一致${summary.unmatched}件 / 実数${summary.measured}件（0は${summary.zero}件）/ 範囲${summary.range}件 / 未取得${summary.unknown}件 / 競合${summary.conflicts}件。`;
  $('mm-volume-issues').replaceChildren(...conflicts.slice(0,15).map(row=>element('li',`${row.line}行：${row.keyword} — ${row.reason}`)),...unmatched.slice(0,10).map(row=>element('li',`未一致：${row.keyword}`)));
  $('mm-volume-preview-rows').replaceChildren(...report.rows.slice(0,20).map(row=>{const tr=element('tr');tr.append(element('td',row.keyword),volumeCell(row),element('td',row.status==='measured'?'実数':row.status==='range'?'範囲':'未取得'));return tr;}));
  $('mm-volume-apply').disabled=conflicts.length>0;$('mm-volume-preview').hidden=false;
}
function clearVolumePreview(){volumePreviewChannel.invalidate();pendingVolume=null;$('mm-volume-preview').hidden=true;}
function clearPlanPreview(){planPreviewChannel.invalidate();pendingPlans=null;$('mm-plan-preview').hidden=true;}
function clearBackupPreview(){backupPreviewChannel.invalidate();pendingBackup=null;$('mm-backup-preview').hidden=true;}

for(const button of document.querySelectorAll('[data-mm-tab]'))button.addEventListener('click',()=>showTab(button.dataset.mmTab));
for(const button of document.querySelectorAll('[data-mm-open]'))button.addEventListener('click',()=>showTab(button.dataset.mmOpen));
for(const id of ['mm-search','mm-need','mm-status','mm-volume-filter','mm-sort','mm-column-mode'])$(id).addEventListener(id==='mm-search'?'input':'change',()=>{page=1;renderPlanTable();});
$('mm-volume-report').addEventListener('change',()=>{activeVolume=$('mm-volume-report').value;page=1;render();});
$('mm-analytics-report').addEventListener('change',()=>{activeAnalytics=$('mm-analytics-report').value;render();});
$('mm-query-report').addEventListener('change',()=>{activeQuery=$('mm-query-report').value;queryPage=1;renderQueries();});
$('mm-query-search').addEventListener('input',()=>{queryPage=1;renderQueries();});
$('mm-prev').addEventListener('click',()=>{page--;renderPlanTable();});$('mm-next').addEventListener('click',()=>{page++;renderPlanTable();});
$('mm-query-prev').addEventListener('click',()=>{queryPage--;renderQueries();});$('mm-query-next').addEventListener('click',()=>{queryPage++;renderQueries();});
for(const [key,label] of Object.entries(STATUS)){$('mm-status').append(option(key,label));$('mm-edit-status').append(option(key,label));}
for(const [key,label] of Object.entries(PRIORITY))$('mm-edit-priority').append(option(key,label));
$('mm-plan-rows').addEventListener('click',event=>{
  const button=event.target.closest('[data-edit-id]');if(!button)return;const plan=state.plans.find(row=>row.id===button.dataset.editId);if(!plan)return;
  editingId=plan.id;editorDirty=false;const edit=planEdit(state,plan.id);$('mm-editor-id').textContent=plan.id;$('mm-editor-title').textContent=plan.title;$('mm-editor-keyword').textContent=`主キーワード：${plan.keyword}`;
  $('mm-editor-detail').replaceChildren(...[['需要段階',plan.need],['企画カテゴリー',plan.category],['解決する問い',plan.intent],['素材・構成',plan.material],['関連語',plan.relatedKeywords],['公開前の条件',plan.gate]].flatMap(([label,value])=>[element('dt',label),element('dd',value||'未記入')]));
  $('mm-edit-status').value=edit.status;$('mm-edit-priority').value=edit.priority;
  const select=$('mm-edit-url');for(const item of select.querySelectorAll('[data-mm-retired]'))item.remove();
  const url=edit.url?new URL(edit.url,'https://layr.co.jp').href:'',retired=Boolean(url&&!catalog.some(article=>`https://layr.co.jp${article.path}`===url));
  if(retired){const item=option(url,`以前の公開URL（現在の公開一覧外）：${url}`);item.disabled=true;item.dataset.mmRetired='true';select.append(item);}
  select.value=url;$('mm-edit-notes').value=edit.notes;$('mm-editor-message').hidden=!retired;
  if(retired)$('mm-editor-message').textContent='以前の公開URLが保存されています。保存する場合は、現在の公開記事または「未紐づけ」を明示的に選択してください。';
  $('mm-editor').showModal();
});
function closeEditor(){if(editorDirty&&!confirm('未保存の変更があります。保存せず閉じますか？'))return;$('mm-editor').close();editorDirty=false;}
$('mm-editor-close').addEventListener('click',closeEditor);$('mm-editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('mm-editor-form').addEventListener('input',()=>{editorDirty=true;});
$('mm-editor-form').addEventListener('submit',async event=>{event.preventDefault();try{
  if($('mm-edit-url').selectedOptions[0]?.disabled)throw new Error('以前の公開URLは自動で変更しません。現在の公開記事または「未紐づけ」を選択してください。');
  const edit=validatePlanEdit({status:$('mm-edit-status').value,priority:$('mm-edit-priority').value,url:$('mm-edit-url').value,notes:$('mm-edit-notes').value},catalog);
  await commit({...state,edits:{...state.edits,[editingId]:edit}});editorDirty=false;$('mm-editor').close();message(`${editingId}の制作状況を保存しました。`);
}catch(error){$('mm-editor-message').textContent=error.message;$('mm-editor-message').hidden=false;}});

$('mm-volume-form').addEventListener('input',clearVolumePreview);$('mm-volume-form').addEventListener('change',clearVolumePreview);
$('mm-volume-form').addEventListener('submit',async event=>{
  event.preventDefault();clearVolumePreview();
  await volumePreviewChannel.run({
    capture:()=>{
      const file=selectedFile('mm-volume-file'),keywordColumn=$('mm-keyword-column').value.trim(),volumeColumn=$('mm-volume-column').value.trim();
      if(Boolean(keywordColumn)!==Boolean(volumeColumn))throw new Error('列名を指定する場合は、キーワード列と検索数列の両方を入力してください。');
      const meta={source:$('mm-volume-source').value.trim(),periodStart:$('mm-volume-start').value,periodEnd:$('mm-volume-end').value,country:$('mm-volume-country').value.trim(),language:$('mm-volume-language').value.trim(),network:$('mm-volume-network').value.trim(),matchType:$('mm-volume-match').value.trim(),fetchedAt:`${$('mm-volume-fetched').value}T00:00:00+09:00`,...(keywordColumn?{columns:{keyword:keywordColumn,volume:volumeColumn}}:{})};
      return {file,meta,plans:state.plans};
    },
    load:async({file,meta,plans})=>volumeFromCsv(await file.text(),meta,plans),
    accept:(incoming,{file})=>{showVolumePreview(incoming);$('mm-volume-summary').prepend(document.createTextNode(`${file.name}：`));},
    reject:error=>message(error.message,true),
  });
});
$('mm-seed-volume-preview').addEventListener('click',()=>{clearVolumePreview();try{
  const report=seed.volumeReports?.[0];if(!report)return;const clean=applyVolumeReport(emptyMediaState(),report).volumeReports[0],known=new Set(state.plans.map(plan=>normalizeKeyword(plan.keyword)));
  const unmatched=clean.rows.filter(row=>!known.has(normalizeKeyword(row.keyword))).map(row=>({keyword:row.keyword}));
  const summary={total:clean.rows.length,matched:clean.rows.length-unmatched.length,unmatched:unmatched.length,measured:0,zero:0,range:0,unknown:0,conflicts:0};
  for(const row of clean.rows){summary[row.status]++;if(row.status==='measured'&&row.volume===0)summary.zero++;}
  showVolumePreview({report:clean,unmatched,conflicts:[],summary});
}catch(error){message(error.message,true);}});
$('mm-volume-apply').addEventListener('click',async()=>{if(!pendingVolume)return;try{const report=pendingVolume.report;await commit(applyVolumeReport(state,report));activeVolume=report.id;clearVolumePreview();page=1;render();message('検索需要を保存しました。記事企画で検索数の多い順に確認できます。');}catch(error){message(error.message,true);}});
$('mm-volume-template').addEventListener('click',()=>download('keyword-volume-columns.csv',csvString([['Keyword','Volume']])));
$('mm-keywords-export').addEventListener('click',()=>download(`ltori-keywords-${today()}.csv`,csvString([['Keyword'],...state.plans.map(plan=>[plan.keyword])])));
$('mm-export-plans').addEventListener('click',()=>{const report=volumeReport(),joined=planMetrics();download(`ltori-article-plans-${today()}.csv`,csvString([
 ['ID','公開月','優先度','分類','主キーワード案','記事タイトル案','需要段階','カテゴリー','解決する問い','独自素材・構成','関連記事ID','読後の導線','関連キーワード案','確認先ID','公開前の条件','進行状況','編集優先度','公開URL','メモ','月間検索数','検索数状態','下限','上限','取得元','調査開始','調査終了','対象地域','言語','検索ネットワーク','一致条件','データ取得日',...metricsLabels,'実績開始','実績終了'],
 ...visiblePlans().map(row=>[row.id,row.month,row.priority,row.segment,row.keyword,row.title,row.need,row.category,row.intent,row.material,row.next,row.cta,row.relatedKeywords,row.evidence,row.gate,STATUS[row.edit.status],PRIORITY[row.edit.priority],row.edit.url,row.edit.notes,row.volume?.status==='measured'?row.volume.volume:'',row.volume?.status||'unknown',row.volume?.lower??'',row.volume?.upper??'',report?.source||'',report?.periodStart||'',report?.periodEnd||'',report?.country||'',report?.language||'',report?.network||'',report?.matchType||'',report?.fetchedAt||'',...metricsKeys.map(key=>joined.get(row.id)?.metrics[key]??''),analyticsReport()?.start||'',analyticsReport()?.end||''])
 ]));});

$('mm-config-form').addEventListener('submit',event=>{event.preventDefault();try{localStorage.setItem('layr-ltori-google-config',JSON.stringify(config()));message('接続設定をこのブラウザに保存しました。');}catch(error){message(error.message,true);}});
for(const id of ['mm-client-id','mm-property','mm-site'])$(id).addEventListener('change',disconnect);
$('mm-google-connect').addEventListener('click',async()=>{try{const settings=config();localStorage.setItem('layr-ltori-google-config',JSON.stringify(settings));const response=await authorize(GOOGLE_SCOPES,settings.clientId);token=response.token;expires=response.expires;$('mm-google-status').textContent='Googleに接続済み。アクセス実績画面から手動で取得できます。';renderConnection();message('GA4とSearch Consoleへの読み取り接続が完了しました。');}catch(error){message(error.message,true);}});
$('mm-google-disconnect').addEventListener('click',()=>{disconnect();message('この画面のGoogle接続を解除しました。保存済みの実績は残っています。');});
async function fetchAnalytics(kind){
  if(fetchBusy)return;try{
    if(!token||Date.now()>=expires){disconnect();throw new Error('Google接続の期限が切れています。再接続してください。');}
    const settings=config(),period=dates();fetchBusy=true;renderConnection();message(kind==='queries'?'ページごとの検索クエリを取得しています。':'GA4とSearch Consoleから公開記事の実績を取得しています。');
    const request={config:settings,token,...period,catalog};
    if(kind==='queries'){const report=await fetchMediaSearchQueries(request);await commit(applySearchReport(state,report,catalog));activeQuery=report.id;queryPage=1;}
    else{const report=await fetchMediaReport(request);await commit(applyAnalyticsReport(state,report,catalog));activeAnalytics=report.id;}
    render();message('取得できた実績を保存しました。部分的な取得失敗や集計上の注記は、実績の下に表示します。');
  }catch(error){message(error.message,true);}finally{fetchBusy=false;renderConnection();}
}
$('mm-fetch-metrics').addEventListener('click',()=>void fetchAnalytics('metrics'));
$('mm-fetch-queries').addEventListener('click',()=>void fetchAnalytics('queries'));
$('mm-export-metrics').addEventListener('click',()=>{const report=analyticsReport();if(!report)return;const rows=new Map(report.rows.map(row=>[row.pageId,row]));download(`ltori-access-${report.start}-${report.end}.csv`,csvString([['記事ID','記事タイトル','公開URL','開始日','終了日',...metricsLabels],...catalog.map(article=>[article.id,article.title,`https://layr.co.jp${article.path}`,report.start,report.end,...metricsKeys.map(key=>rows.get(article.id)?.[key]??'')])]));});
$('mm-export-queries').addEventListener('click',()=>{const report=queryReport();if(!report)return;const articles=new Map(catalog.map(row=>[row.id,row]));download(`ltori-queries-${report.start}-${report.end}.csv`,csvString([['記事ID','公開URL','クエリ','開始日','終了日','クリック','表示','CTR','平均順位'],...report.rows.map(row=>[row.pageId,`https://layr.co.jp${articles.get(row.pageId)?.path||''}`,row.query,report.start,report.end,row.clicks,row.impressions,row.ctr??'',row.position??''])]));});
$('mm-sheet-read').addEventListener('click',async()=>{
  clearPlanPreview();
  await planPreviewChannel.run({
    capture:()=>{const clientId=$('mm-client-id').value.trim();if(!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new Error('Web OAuthクライアントIDを入力してください。シート読み込みだけの場合、GA4プロパティIDは不要です。');return {clientId};},
    load:async({clientId},isCurrent)=>{
      try{
        if(!sheetToken||Date.now()>=sheetExpires){const response=await authorize(SHEETS_SCOPE,clientId);if(!isCurrent())return null;sheetToken=response.token;sheetExpires=response.expires;}
        if(!isCurrent())return null;
        fetchBusy=true;renderConnection();$('mm-sheet-status').textContent='記事計画シートを読み込み中です。';
        return await fetchMediaPlans({token:sheetToken});
      }finally{fetchBusy=false;renderConnection();}
    },
    accept:plans=>{previewPlans(plans,'Googleシート');$('mm-sheet-status').textContent='読み取りが完了しました。プレビューを確認して「企画を取り込む」を押してください。';},
    reject:error=>{$('mm-sheet-status').textContent='読み込みを完了できませんでした。';message(error.message,true);},
  });
});
$('mm-plan-import-file').addEventListener('change',()=>{clearPlanPreview();$('mm-sheet-status').textContent='ローカルファイルを選択中です。取込内容を確認してください。';});
$('mm-plan-import-form').addEventListener('submit',async event=>{
  event.preventDefault();clearPlanPreview();
  await planPreviewChannel.run({
    capture:()=>({file:selectedFile('mm-plan-import-file')}),
    load:async({file})=>{const text=await file.text();return plansFromRows(file.name.toLowerCase().endsWith('.json')?JSON.parse(text):text);},
    accept:(plans,{file})=>previewPlans(plans,file.name),
    reject:error=>message(error.message,true),
  });
});
$('mm-plan-apply').addEventListener('click',async()=>{if(!pendingPlans)return;try{const count=pendingPlans.length;await commit(mergePlans(state,pendingPlans));clearPlanPreview();message(`記事計画${count}件を取り込みました。制作状況などのローカル編集は保持しました。`);}catch(error){message(error.message,true);}});
$('mm-backup-export').addEventListener('click',()=>download(`ltori-media-backup-${today()}.json`,JSON.stringify(state,null,2),'application/json'));
$('mm-backup-file').addEventListener('change',clearBackupPreview);
$('mm-backup-form').addEventListener('submit',async event=>{
  event.preventDefault();clearBackupPreview();
  await backupPreviewChannel.run({
    capture:()=>({file:selectedFile('mm-backup-file')}),
    load:async({file})=>validateMediaBackup(await file.text(),catalog),
    accept:(backup,{file})=>{pendingBackup=backup;$('mm-backup-summary').textContent=`${file.name}：企画${backup.plans.length}件 / ローカル編集${Object.keys(backup.edits).length}件 / 検索需要${backup.volumeReports.length}件 / アクセス実績${backup.analyticsReports.length}件 / 検索レポート${backup.searchReports.length}件。`;$('mm-backup-preview').hidden=false;},
    reject:error=>message(error.message,true),
  });
});
$('mm-backup-apply').addEventListener('click',async()=>{if(!pendingBackup)return;try{await commit(validateMediaBackup(pendingBackup,catalog));activeVolume='';activeAnalytics='';activeQuery='';page=1;queryPage=1;clearBackupPreview();render();message('確認したバックアップを復元しました。');}catch(error){message(error.message,true);}});

async function initialize(){
  const end=new Date(`${today()}T00:00:00Z`);end.setUTCDate(end.getUTCDate()-3);const start=new Date(end);start.setUTCDate(start.getUTCDate()-27);$('mm-analytics-start').value=start.toISOString().slice(0,10);$('mm-analytics-end').value=end.toISOString().slice(0,10);$('mm-volume-fetched').value=today();
  try{const saved=JSON.parse(localStorage.getItem('layr-ltori-google-config')||'null');if(saved){const values=validateConnection(saved);$('mm-client-id').value=values.clientId;$('mm-property').value=values.property;$('mm-site').value=values.site;}}catch{/* Invalid or absent saved settings retain the HTML defaults; valid saved settings take priority. */}
  try{
    db=await openDatabase();const saved=await loadState(db);
    if(saved){if(!Number.isSafeInteger(saved.revision)||saved.revision<0)throw new Error('保存データの更新番号が正しくありません。');state={...validateMediaBackup(saved,catalog),revision:saved.revision,updatedAt:saved.updatedAt};}
    else{state=mergePlans(emptyMediaState(),plansFromRows(seed));for(const report of seed.volumeReports||[])state=applyVolumeReport(state,report);state=await saveState(db,state,0);}
    if(seed.volumeReports?.length){$('mm-seed-volume-block').hidden=false;$('mm-seed-volume-summary').textContent=`${volumeLabel(seed.volumeReports[0])} / ${seed.volumeReports[0].rows.length}キーワード`;}
    ready=true;render();$('mm-save-state').textContent=`このブラウザに保存：${dateLabel(state.updatedAt)}`;
    const hash=location.hash.slice(1);showTab(['plans','volume','analytics','settings'].includes(hash)?hash:'plans');
  }catch(error){ready=false;message(`データを開けませんでした。${error.message}`,true);$('mm-save-state').textContent='保存を利用できません';for(const control of document.querySelectorAll('main button,main input,main select,main textarea'))control.disabled=true;}
}
window.addEventListener('pagehide',disconnect);
window.addEventListener('beforeunload',event=>{if(editorDirty||saveBusy||fetchBusy){event.preventDefault();event.returnValue='';}});
setInterval(renderConnection,30000);
void initialize();
