import {STATUS, PRIORITY, INDEX, MAX_FILE, checkStateSize, emptyState, pageEdit, keywordsFor, validateEdit, addKeyword, createReport, putReport, reportSummary, metricLookup, queryMetric, normalizeQuery, csvString, validateBackup} from './model.mjs';
import {openDatabase, loadState, saveState} from './storage.mjs';
const $=id=>document.getElementById(id);
const catalog=JSON.parse($('kw-catalog').textContent), byId=new Map(catalog.map(page=>[page.id,page]));
let state=emptyState(), db, loaded=false, busy=false, view='pages', pageNumber=1, filtered=[], allKeywords=[], selected=new Set(), activeReport='', pendingImport, pendingRestore, editorPage='', editorCustom=[], editorPaused=new Set(), editorDirty=false, detailReport=null, detailPage=1;
const format=value=>value==null?'—':new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(value);
const rate=row=>row?.impressions?`${(row.clicks/row.impressions*100).toFixed(1)}%`:'—';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const text=(tag,content,className)=>{const node=document.createElement(tag);node.textContent=content;if(className)node.className=className;return node;};
const button=(label,action,className='kw-button')=>{const b=text('button',label,className);b.type='button';b.addEventListener('click',action);return b;};
const link=(label,href)=>{const a=text('a',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
const message=(value,error=false)=>{const node=$('kw-message');node.textContent=value;node.hidden=false;node.setAttribute('role',error?'alert':'status');};
const errorText=error=>error instanceof Error?error.message:String(error);
const reportLabel=r=>`${r.start}〜${r.end} / ${r.kind==='pages'?'ページ別':'クエリ別'} / ${r.scopePageId?byId.get(r.scopePageId).fullName:'サイト全体'} / ${r.searchType} / ${r.filter}`;
function rebuild(){allKeywords=keywordsFor(catalog,state);}
function saveLabel(){ $('kw-save-state').textContent=state.updatedAt?`このブラウザに保存済み · ${new Date(state.updatedAt).toLocaleString('ja-JP')}`:'このブラウザに保存 · 未編集'; }
async function commit(next) {
  if(!db||!loaded)throw new Error('保存機能が利用できません。表示されているエラーを確認してください。');
  if(busy)throw new Error('保存中です。少し待ってから操作してください。');
  checkStateSize(next);
  busy=true;$('kw-save-state').textContent='保存中…';
  try {state=await saveState(db,next,state.revision);rebuild();saveLabel();render();renderHistory();return true;}
  catch(error){$('kw-save-state').textContent='未保存 · 再操作が必要です';throw error;}
  finally{busy=false;}
}
function option(value,label){const o=text('option',label);o.value=value;return o;}
function reportsForView(){return state.reports.filter(r=>r.kind===(view==='keywords'?'queries':'pages')).sort((a,b)=>b.end.localeCompare(a.end)||b.importedAt.localeCompare(a.importedAt));}
function refreshReports(){const available=reportsForView();if(!available.some(r=>r.id===activeReport))activeReport=available[0]?.id||'';$('kw-report').replaceChildren(...(available.length?available.map(r=>option(r.id,reportLabel(r))):[option('','実績は未取り込み')]));$('kw-report').value=activeReport;}
function switchView(next){view=next;pageNumber=1;selected.clear();activeReport='';for(const node of document.querySelectorAll('[data-view]')){if(node.dataset.view===view)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');}$('kw-list-view').hidden=view==='data';$('kw-data-view').hidden=view!=='data';$('kw-enabled-wrap').hidden=view!=='keywords';$('kw-view-title').textContent={pages:'地域・ページ',keywords:'対策キーワード',tasks:'改善タスク',data:'実績・入出力'}[view];$('kw-view-hint').textContent={pages:'地域を選んで、対策キーワードと次の作業を管理します。',keywords:'候補の追加・保留は地域名から編集できます。優先度・対応状況は対象ページの設定です。',tasks:'次の作業・期限があるページと「改善中」のページを表示します。対応済みは除きます。',data:''}[view];if(view==='tasks')$('kw-sort').value='due';else $('kw-sort').value='area';render();renderHistory();}
function currentReport(){return state.reports.find(r=>r.id===activeReport);}
function filteredRows(){
  const search=normalizeQuery($('kw-search').value),pref=$('kw-pref').value,status=$('kw-status').value,priority=$('kw-priority').value,enabled=$('kw-enabled').value,report=currentReport(),lookup=metricLookup(report),paused=new Set(state.pausedKeywords);
  const rows=(view==='keywords'?allKeywords:catalog).map(row=>{
    const page=view==='keywords'?byId.get(row.pageId):row,edit=pageEdit(state,page.id),metric=view==='keywords'?queryMetric(row,report,lookup):lookup.get(page.id);
    return {page,edit,keyword:view==='keywords'?row:null,metric,paused:paused.has(row.id)};
  }).filter(row=>{
    const {page,edit,keyword}=row;
    if(pref&&page.prefecture!==pref||status&&edit.status!==status||priority&&edit.priority!==priority)return false;
    if(view==='keywords'&&(enabled==='active'&&row.paused||enabled==='paused'&&!row.paused))return false;
    if(view==='tasks'&&(edit.status==='done'||!edit.nextAction&&!edit.dueDate&&edit.status!=='improving'))return false;
    return !search||normalizeQuery([page.fullName,keyword?.query||'',edit.nextAction,edit.notes,edit.owner].join(' ')).includes(search);
  });
  const sort=$('kw-sort').value, priorityOrder={high:0,normal:1,low:2};
  if(sort==='priority')rows.sort((a,b)=>priorityOrder[a.edit.priority]-priorityOrder[b.edit.priority]);
  if(sort==='due')rows.sort((a,b)=>(a.edit.dueDate||'9999').localeCompare(b.edit.dueDate||'9999'));
  if(['clicks','impressions','position'].includes(sort))rows.sort((a,b)=>{const av=a.metric?.[sort],bv=b.metric?.[sort];if(av==null)return bv==null?0:1;if(bv==null)return -1;return sort==='position'?av-bv:bv-av;});
  return rows;
}
function render(){
  const focusedCheck=document.activeElement?.matches('#kw-thead input[type=checkbox], #kw-tbody input[type=checkbox]')?document.activeElement.getAttribute('aria-label'):null;
  $('kw-stat-keywords').textContent=format(allKeywords.length-state.pausedKeywords.length);
  $('kw-stat-indexed').textContent=format(Object.values(state.pages).filter(p=>p.indexStatus==='indexed').length);
  $('kw-stat-overdue').textContent=format(Object.values(state.pages).filter(p=>p.dueDate&&p.dueDate<today()&&p.status!=='done').length);
  if(view==='data')return;
  refreshReports();filtered=filteredRows();const size=Number($('kw-size').value),pages=Math.max(1,Math.ceil(filtered.length/size));pageNumber=Math.min(pageNumber,pages);const slice=filtered.slice((pageNumber-1)*size,pageNumber*size), report=currentReport();
  $('kw-scope').textContent=report?`${reportLabel(report)}。CSVにない値は「—」。${report.kind==='queries'&&!report.scopePageId?'サイト全体のクエリ実績です。対象LPの実績を示すものではありません。':'平均順位は対象期間の平均掲載順位です。'}`:'検索実績は未取り込みです。順位・クリックは「—」で表示します。';
  const tr=document.createElement('tr');
  if(view!=='keywords') {const th=document.createElement('th'),label=text('label','','kw-check'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','このページの地域をすべて選択');check.checked=!!slice.length&&slice.every(row=>selected.has(row.page.id));check.indeterminate=!check.checked&&slice.some(row=>selected.has(row.page.id));check.addEventListener('change',()=>{slice.forEach(row=>check.checked?selected.add(row.page.id):selected.delete(row.page.id));render();});label.append(check);th.append(label);tr.append(th);}
  const headings=view==='keywords'?['対策キーワード / 対象ページ','対象','優先度','クリック','表示回数','CTR','平均順位','LP']:['地域 / ページ','対応状況','優先度','クリック','表示回数','平均順位','次の作業 / 期限','LP'];
  for(const label of headings){const th=text('th',label);th.scope='col';tr.append(th);}$('kw-thead').replaceChildren(tr);
  const fragment=document.createDocumentFragment();
  for(const row of slice) {
    const tr=document.createElement('tr'),{page,edit,keyword,metric}=row;
    if(!keyword){const td=document.createElement('td'),label=text('label','','kw-check'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(page.id);check.setAttribute('aria-label',`${page.fullName}を選択`);check.addEventListener('change',()=>{check.checked?selected.add(page.id):selected.delete(page.id);render();});label.append(check);td.append(label);tr.append(td);}
    const name=text('td','','kw-name');name.append(button(keyword?keyword.query:page.fullName,()=>openEditor(page.id),''),text('small',keyword?page.fullName:page.kind==='prefecture'?'都道府県LP':`市区町村・行政区LP / ${page.id}`));tr.append(name);
    const status=text('td','','kw-status');status.append(text('span',keyword?(row.paused?'保留':'対象'):STATUS[edit.status],`kw-tag ${(keyword?!row.paused:edit.status==='improving')?'is-active':''}`));tr.append(status,text('td',PRIORITY[edit.priority]));
    tr.append(text('td',format(metric?.clicks),'kw-number'),text('td',format(metric?.impressions),'kw-number'));
    if(keyword)tr.append(text('td',rate(metric),'kw-number'));
    tr.append(text('td',format(metric?.position),'kw-number'));
    if(!keyword){const note=text('td',edit.nextAction||'未設定','kw-row-note');note.append(text('small',edit.dueDate?`${edit.dueDate}${edit.dueDate<today()&&edit.status!=='done'?' · 期限超過':''}`:'期限なし'));tr.append(note);}
    const anchor=text('td','');anchor.append(link('確認 ↗',page.path));tr.append(anchor);fragment.append(tr);
  }
  $('kw-tbody').replaceChildren(fragment);$('kw-empty').hidden=!!filtered.length;
  $('kw-results').textContent=`${format(filtered.length)}件中 ${filtered.length?format((pageNumber-1)*size+1):0}〜${format(Math.min(pageNumber*size,filtered.length))}件`;$('kw-page').textContent=`${pageNumber} / ${pages}`;$('kw-prev').disabled=pageNumber<=1;$('kw-next').disabled=pageNumber>=pages;
  $('kw-bulk').hidden=!selected.size||view==='keywords';$('kw-selected-count').textContent=`${selected.size}地域を選択中`;
  if(focusedCheck)[...document.querySelectorAll('#kw-thead input, #kw-tbody input')].find(node=>node.getAttribute('aria-label')===focusedCheck)?.focus({preventScroll:true});
}
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function backup(){if(!loaded){message('保存済みデータを読み込めていません。空のバックアップは出力しません。',true);return;}download(`eltori-seo-backup-${today()}.json`,JSON.stringify({...state,exportedAt:new Date().toISOString()}),'application/json');$('kw-backup-date').textContent=`最終出力: ${new Date().toLocaleString('ja-JP')}`;message('JSONバックアップをダウンロードしました。端末変更時に復元できます。');}
function exportCsv(){
  const report=currentReport(),headers=['地域ID','都道府県','地域名','本番URL','対策キーワード','対策対象','優先度','対応状況','インデックス状態（手動）','担当者','次にやること','期限','メモ','クリック数','表示回数','CTR','平均掲載順位','実績期間開始','実績期間終了','実績範囲'];
  const rows=filtered.map(({page,edit,keyword,metric,paused})=>[page.id,page.prefectureName,page.fullName,`https://layr.co.jp${page.path}`,keyword?.query||'',keyword?(paused?'保留':'対象'):'',PRIORITY[edit.priority],STATUS[edit.status],INDEX[edit.indexStatus],edit.owner,edit.nextAction,edit.dueDate,edit.notes,metric?.clicks??'',metric?.impressions??'',metric?.impressions?rate(metric):'',metric?.position??'',report?.start||'',report?.end||'',report?reportLabel(report):'未取得']);
  download(`eltori-seo-${view}-${today()}.csv`,csvString([headers,...rows]),'text/csv;charset=utf-8');message(`表示条件に一致する${format(rows.length)}件をCSVに出力しました。`);
}
function renderEditorKeywords(){
  const draft={...state,customKeywords:editorCustom},rows=keywordsFor(catalog,draft).filter(row=>row.pageId===editorPage),list=$('kw-editor-keywords');list.replaceChildren();
  for(const row of rows){const li=document.createElement('li'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!editorPaused.has(row.id);check.addEventListener('change',()=>{check.checked?editorPaused.delete(row.id):editorPaused.add(row.id);editorDirty=true;});label.append(check,text('span',row.query));li.append(label);if(row.custom)li.append(button('削除',()=>{editorCustom=editorCustom.filter(k=>k.id!==row.id);editorPaused.delete(row.id);editorDirty=true;renderEditorKeywords();}));list.append(li);}
}
function openEditor(id){
  editorPage=id;const page=byId.get(id),edit=pageEdit(state,id);editorCustom=structuredClone(state.customKeywords);editorPaused=new Set(state.pausedKeywords);editorDirty=false;
  $('kw-editor-title').textContent=page.fullName;$('kw-editor-path').textContent=`https://layr.co.jp${page.path}`;$('kw-editor-links').replaceChildren(link('この環境のLPを確認 ↗',page.path),link('本番URLを確認 ↗',`https://layr.co.jp${page.path}`));
  for(const [key,field] of Object.entries({status:'status',priority:'priority',index:'indexStatus',owner:'owner',due:'dueDate',action:'nextAction',notes:'notes'}))$(`kw-edit-${key}`).value=edit[field];
  $('kw-new-query').value='';$('kw-editor-error').hidden=true;renderEditorKeywords();$('kw-editor-save').disabled=!db||!loaded;$('kw-editor').showModal();
}
function closeEditor(){if(editorDirty&&!confirm('保存していない編集を破棄して閉じますか？'))return;$('kw-editor').close();editorPage='';editorDirty=false;}
function renderHistory(){
  const node=$('kw-report-history');node.replaceChildren();
  if(!state.reports.length){node.append(text('p','まだ検索実績がありません。公開後にSearch ConsoleのCSVを取り込んでください。'));return;}
  for(const report of [...state.reports].sort((a,b)=>b.end.localeCompare(a.end)||b.importedAt.localeCompare(a.importedAt))){const summary=reportSummary(report),article=document.createElement('article'),title=document.createElement('div');title.append(text('strong',reportLabel(report)),text('small',`${report.fileName} · ${format(summary.count)}行 · クリック ${format(summary.clicks)} / 表示 ${format(summary.impressions)}`));article.append(title,button('内容を見る',()=>{detailReport=report;detailPage=1;$('kw-report-search').value='';renderReportDetail();$('kw-report-dialog').showModal();}),button('削除',async()=>{if(!confirm('この検索実績を削除しますか？必要な場合は先にバックアップしてください。'))return;try{await commit({...state,reports:state.reports.filter(r=>r.id!==report.id)});message('選択した実績を削除しました。');}catch(error){message(errorText(error),true);}}));node.append(article);}
}
function renderReportDetail(){
  const r=detailReport,search=normalizeQuery($('kw-report-search').value),rows=r.rows.filter(row=>normalizeQuery(r.kind==='pages'?byId.get(row.pageId).fullName:row.query).includes(search)), pages=Math.max(1,Math.ceil(rows.length/50));detailPage=Math.min(detailPage,pages);$('kw-report-detail').textContent=reportLabel(r);const body=$('kw-report-rows');body.replaceChildren();
  for(const row of rows.slice((detailPage-1)*50,detailPage*50)){const tr=document.createElement('tr');tr.append(text('td',r.kind==='pages'?byId.get(row.pageId).fullName:row.query,'kw-name'),text('td',format(row.clicks),'kw-number'),text('td',format(row.impressions),'kw-number'),text('td',rate(row),'kw-number'),text('td',format(row.position),'kw-number'));body.append(tr);}
  $('kw-report-count').textContent=`${format(rows.length)}件 · ${detailPage} / ${pages}ページ`;$('kw-report-prev').disabled=detailPage===1;$('kw-report-next').disabled=detailPage===pages;
}
async function fileText(input){const file=input.files[0];if(!file)throw new Error('ファイルを選択してください。');if(file.size>MAX_FILE)throw new Error('ファイルは20MB以内で指定してください。');return {file,content:await file.text()};}
function clearImport(){pendingImport=null;$('kw-import-preview').hidden=true;}
async function initialize(){
  rebuild();render();
  try{db=await openDatabase();const saved=await loadState(db);if(saved)state=validateBackup(saved,catalog);loaded=true;rebuild();saveLabel();render();renderHistory();}
  catch(error){loaded=false;$('kw-save-state').textContent='保存を利用できません';$('kw-storage-error').hidden=false;$('kw-storage-error').textContent=`${errorText(error)} 現在は閲覧のみです。保存済みデータは上書きしていません。`;$('kw-import-save').disabled=true;$('kw-restore-save').disabled=true;$('kw-bulk-apply').disabled=true;}
}
for(const page of catalog)$('kw-import-scope').append(option(page.id,page.fullName));
for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>switchView(node.dataset.view));
$('kw-open-import').addEventListener('click',()=>{switchView('data');$('kw-import-file').focus();});
for(const id of ['kw-pref','kw-status','kw-priority','kw-sort','kw-size','kw-enabled'])$(id).addEventListener('change',()=>{pageNumber=1;selected.clear();render();});
$('kw-search').addEventListener('input',()=>{pageNumber=1;selected.clear();render();});
$('kw-report').addEventListener('change',()=>{activeReport=$('kw-report').value;pageNumber=1;render();});
$('kw-reset').addEventListener('click',()=>{for(const id of ['kw-search','kw-pref','kw-status','kw-priority','kw-enabled'])$(id).value='';$('kw-sort').value=view==='tasks'?'due':'area';pageNumber=1;selected.clear();render();});
$('kw-prev').addEventListener('click',()=>{pageNumber--;render();});$('kw-next').addEventListener('click',()=>{pageNumber++;render();});
$('kw-export').addEventListener('click',exportCsv);$('kw-backup').addEventListener('click',backup);$('kw-backup-data').addEventListener('click',backup);
$('kw-deselect').addEventListener('click',()=>{selected.clear();render();});
$('kw-bulk-apply').addEventListener('click',async()=>{const status=$('kw-bulk-status').value,priority=$('kw-bulk-priority').value;if(!status&&!priority){message('変更する対応状況または優先度を選択してください。',true);return;}const pages={...state.pages};for(const id of selected)pages[id]={...pageEdit(state,id),...(status?{status}:{}),...(priority?{priority}:{})};try{const count=selected.size;await commit({...state,pages});selected.clear();render();message(`${count}地域を更新しました。`);}catch(error){message(errorText(error),true);}});
$('kw-editor-close').addEventListener('click',closeEditor);$('kw-editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});$('kw-editor-form').addEventListener('input',()=>editorDirty=true);
$('kw-add-query').addEventListener('click',()=>{try{const next=addKeyword({...state,customKeywords:editorCustom},catalog,editorPage,$('kw-new-query').value,crypto.randomUUID());editorCustom=next.customKeywords;editorDirty=true;$('kw-new-query').value='';$('kw-editor-error').hidden=true;renderEditorKeywords();}catch(error){$('kw-editor-error').textContent=errorText(error);$('kw-editor-error').hidden=false;}});
$('kw-new-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('kw-add-query').click();}});
$('kw-editor-form').addEventListener('submit',async event=>{event.preventDefault();try{if($('kw-new-query').value.trim())throw new Error('入力中のキーワードを「キーワードを追加」で追加するか、入力を空にしてください。');const edit=validateEdit({status:$('kw-edit-status').value,priority:$('kw-edit-priority').value,indexStatus:$('kw-edit-index').value,owner:$('kw-edit-owner').value,dueDate:$('kw-edit-due').value,nextAction:$('kw-edit-action').value,notes:$('kw-edit-notes').value});$('kw-editor-save').disabled=true;await commit({...state,pages:{...state.pages,[editorPage]:edit},customKeywords:editorCustom,pausedKeywords:[...editorPaused]});editorDirty=false;$('kw-editor').close();message(`${byId.get(editorPage).fullName}の編集を保存しました。`);editorPage='';}catch(error){$('kw-editor-error').textContent=errorText(error);$('kw-editor-error').hidden=false;}finally{$('kw-editor-save').disabled=!db||!loaded;}});
$('kw-import-form').addEventListener('input',clearImport);$('kw-import-form').addEventListener('change',clearImport);
$('kw-import-form').addEventListener('submit',async event=>{event.preventDefault();clearImport();try{const {file,content}=await fileText($('kw-import-file'));pendingImport=createReport(content,{start:$('kw-import-start').value,end:$('kw-import-end').value,searchType:$('kw-import-type').value,scopePageId:$('kw-import-scope').value,filter:$('kw-import-filter').value,fileName:file.name},catalog);const {report,rejected,total}=pendingImport, summary=reportSummary(report);let recognized='';if(report.kind==='queries'){const queries=new Set(allKeywords.filter(k=>!report.scopePageId||k.pageId===report.scopePageId).map(k=>normalizeQuery(k.query)));recognized=` 管理キーワードに一致: ${report.rows.filter(row=>queries.has(normalizeQuery(row.query))).length}件。未登録のクエリも実績内で閲覧できます。`;}$('kw-import-summary').textContent=`${report.kind==='pages'?'ページ別':'クエリ別'}: ${total}行中${summary.count}行を取り込み、${rejected.length}行を対象外にします。${recognized}`;$('kw-import-replace').textContent=state.reports.some(r=>r.id===report.id)?'同じ期間・条件の実績があります。保存すると既存の実績を置き換えます。':reportLabel(report);$('kw-import-rejected').replaceChildren(...rejected.slice(0,5).map(row=>text('li',`${row.line}行目: ${row.reason}（${row.value}）`)));$('kw-rejected-export').hidden=!rejected.length;$('kw-import-rows').replaceChildren(...report.rows.slice(0,5).map(row=>{const tr=document.createElement('tr');tr.append(text('td',report.kind==='pages'?byId.get(row.pageId).fullName:row.query),text('td',format(row.clicks)),text('td',format(row.impressions)),text('td',format(row.position)));return tr;}));$('kw-import-preview').hidden=false;}catch(error){message(errorText(error),true);}});
$('kw-import-save').addEventListener('click',async()=>{if(!pendingImport)return;try{await commit(putReport(state,pendingImport.report));clearImport();message('検索実績を保存しました。一覧の「表示する検索実績」から選択できます。');}catch(error){message(errorText(error),true);}});
$('kw-rejected-export').addEventListener('click',()=>{if(pendingImport)download('seo-import-excluded.csv',csvString([['行','値','理由'],...pendingImport.rejected.map(row=>[row.line,row.value,row.reason])]),'text/csv;charset=utf-8');});
$('kw-sample').addEventListener('click',()=>download('search-console-columns.csv',csvString([['上位のページ','クリック数','表示回数','CTR','掲載順位']]),'text/csv;charset=utf-8'));
$('kw-restore-file').addEventListener('change',()=>{pendingRestore=null;$('kw-restore-preview').hidden=true;});
$('kw-restore-form').addEventListener('submit',async event=>{event.preventDefault();pendingRestore=null;$('kw-restore-preview').hidden=true;try{const {content}=await fileText($('kw-restore-file'));pendingRestore=validateBackup(JSON.parse(content),catalog);$('kw-restore-summary').textContent=`地域編集${Object.keys(pendingRestore.pages).length}件 / 追加キーワード${pendingRestore.customKeywords.length}件 / 検索実績${pendingRestore.reports.length}件を復元します。`;$('kw-restore-preview').hidden=false;}catch(error){message(errorText(error),true);}});
$('kw-restore-save').addEventListener('click',async()=>{if(!pendingRestore)return;try{await commit(pendingRestore);pendingRestore=null;pendingImport=null;$('kw-restore-preview').hidden=true;$('kw-import-preview').hidden=true;selected.clear();message('バックアップを復元しました。');}catch(error){message(errorText(error),true);}});
$('kw-report-close').addEventListener('click',()=>$('kw-report-dialog').close());$('kw-report-search').addEventListener('input',()=>{detailPage=1;renderReportDetail();});$('kw-report-prev').addEventListener('click',()=>{detailPage--;renderReportDetail();});$('kw-report-next').addEventListener('click',()=>{detailPage++;renderReportDetail();});
window.addEventListener('beforeunload',event=>{if(editorDirty||busy){event.preventDefault();event.returnValue='';}});
initialize();
