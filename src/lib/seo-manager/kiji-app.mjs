import {startAccessSession} from './session.mjs';
import {API_BASE,ARTICLE_STATUS,KEYWORD_STATUS,number,safeJson,safeUrl,articleUrl,publicationUrl,demandInfo,createKijiApi,createOperationLock,createLatestRead,metricTotal,metricRate,decodeCsv,importCsv,markdownHtml} from './kiji-client.mjs';

export async function mountKijiWorkbench({api = createKijiApi(), mountImprovement = async () => { const module = await import('./corporate-app.mjs'); await module.mountCorporate(); }} = {}) {
  const root = document.getElementById('kiji-workbench'); if (!root || root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const $ = id => document.getElementById(`kiji-${id}`), all = selector => [...root.querySelectorAll(selector)];
  const node = (tag,text,className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text ?? ''); if (className) el.className = className; return el; };
  const help = text => node('p',text,'kw-help');
  const button = (text,action,primary = false,mutation = false) => { const el = node('button',text,`kw-button${primary ? ' kw-primary' : ''}`); el.type = 'button'; if (mutation) { el.dataset.kijiMutation = ''; el.disabled = lock.busy; } el.addEventListener('click',action); return el; };
  const error = (id,message = '') => { $(id).textContent = message; $(id).hidden = !message; };
  const notify = message => error('message',message);
  const reads = new Map(); const read = key => { if (!reads.has(key)) reads.set(key,createLatestRead()); return reads.get(key); };
  const dirtyDialogs = new Set(); let settingsDirty = false, selectedKeyword = null, articleData = null, articleDraft = null, articleEditing = false, actionPending = null, mode = null, settingsLoaded = false, metricsConnected = false;
  const disabledBefore = new Map();
  const lock = createOperationLock(busy => {
    $('operation').hidden = !busy; $('operation').textContent = busy ? '処理中です。完了までこの画面を開いたままお待ちください。' : '';
    all('button[data-kiji-mutation], form input, form textarea, form select').forEach(el => { if (busy) { disabledBefore.set(el,el.disabled); el.disabled = true; } else { el.disabled = el.dataset.kijiUnavailable === 'true' || (!el.hasAttribute('data-kiji-mutation') && (disabledBefore.get(el) ?? false)); } });
    if (!busy) disabledBefore.clear();
    all('[data-kiji-close]').forEach(el => { el.disabled = busy; });
    $('article-toggle').disabled = busy;
  });
  const available = (id,enabled) => { $(id).dataset.kijiUnavailable = String(!enabled); $(id).disabled = !enabled || lock.busy; };
  const mutate = async (errorId,work) => lock.run(async () => { error(errorId); try { await work(); } catch (err) { error(errorId,err.message); } });
  const stats = (id,values) => { $(id).replaceChildren(...values.map(([label,value,note]) => { const div = node('div'); div.append(node('dt',label),node('dd',value)); if (note) div.append(node('small',note)); return div; })); };
  const cells = values => { const tr = node('tr'); values.forEach(value => { const cell = node('td'); cell.append(value?.nodeType ? value : document.createTextNode(String(value ?? '—'))); tr.append(cell); }); return tr; };
  const summary = (primary,secondary) => { const div = node('div'); div.append(node('strong',primary || '—')); if (secondary) div.append(help(secondary)); return div; };
  const actions = (...children) => { const el = node('div',undefined,'kiji-actions'); el.append(...children); return el; };
  const items = (data,key = 'items') => { if (!Array.isArray(data?.[key])) throw new Error('一覧の形式を確認できません。再読み込みしてください。'); return data[key]; };
  const plainArray = value => { const parsed = safeJson(value,[]); return Array.isArray(parsed) ? parsed : []; };
  const date = value => typeof value === 'string' && value ? value.replace('T',' ').slice(0,16) : '—';
  const gateLabel = article => `${article.gate_score ?? '—'} / 9`;
  const keywordStatusLocked = keyword => keyword?.article_id != null || ['writing','published'].includes(keyword?.status);
  function showDialog(id) { error(id.replace('-dialog','-error')); dirtyDialogs.delete(id); $(id).showModal(); }
  function canClose(dialog) { return !lock.busy && (!dirtyDialogs.has(dialog.id.replace('kiji-','')) || confirm('保存していない変更があります。変更を破棄して閉じますか？')); }
  function closeDialog(dialog,force = false) { if (!force && !canClose(dialog)) return; const id = dialog.id.replace('kiji-',''); dirtyDialogs.delete(id); if (id === 'csv-dialog') read('csv-file').invalidate(); if (id === 'article-dialog') read('article-detail').invalidate(); dialog.close(); }
  all('dialog').forEach(dialog => { dialog.addEventListener('cancel',event => { event.preventDefault(); closeDialog(dialog); }); dialog.addEventListener('input',() => dirtyDialogs.add(dialog.id.replace('kiji-',''))); dialog.querySelectorAll('[data-kiji-close]').forEach(el => el.addEventListener('click',() => closeDialog(dialog))); });
  window.addEventListener('beforeunload',event => { if (settingsDirty || dirtyDialogs.size || lock.busy) { event.preventDefault(); event.returnValue = ''; } });

  async function loadPanel(key,work) {
    const channel = read(key), token = channel.begin(); error(`${key}-error`);
    try { const result = await work(); if (channel.current(token)) return result; }
    catch (err) { if (channel.current(token)) error(`${key}-error`,`${err.message} 表示済みの内容がある場合は、前回取得分です。`); }
    return null;
  }
  async function loadDash() {
    const data = await loadPanel('dash',() => api('/overview')); if (!data) return;
    try {
      const byStatus = items(data.articles,'byStatus'), byLayer = items(data.keywords,'byLayer');
      const count = status => Number(byStatus.find(item => item.status === status)?.n || 0);
      const pending = count('pending_approval'), needsHuman = count('needs_human'), inflight = ['gen_outline','gen_body','gen_svg','gating'].reduce((sum,status) => sum + count(status),0);
      const unclassified = Number(byLayer.find(item => item.layer === '未分類')?.n || 0);
      $('queue-count').textContent = String(pending + needsHuman); $('queue-count').hidden = pending + needsHuman === 0;
      stats('stats',[['承認待ち',number(pending),`要確認 ${number(needsHuman)}本`],['今週の公開',number(data.articles.publishedThisWeek),`週の目標 ${number(data.articles.weeklyTarget)}本`],['登録キーワード',number(data.keywords.total),`未分類 ${number(unclassified)}件`],['キーワード消化率',data.keywords.consumed == null ? '—' : `${data.keywords.consumed}%`,`生成中 ${number(inflight)}本`]]);
      $('generation-status').textContent = data.apiKeys?.anthropic ? '設定あり（接続は未確認）' : '設定が必要'; $('publish-status').textContent = data.apiKeys?.github ? '設定あり（接続は未確認）' : '設定が必要';
      mode = ['full','approval'].includes(data.autopilot) ? data.autopilot : null;
      $('mode').textContent = mode === 'full' ? '運転モード：自動制作。品質判定9/9の原稿は公開用の変更が作成されます。確認・マージ後に公開状態を確認してください。' : mode === 'approval' ? '運転モード：確認後に公開（朝承認）。生成された原稿は「確認・公開」で承認して公開用の変更を作成し、確認・マージ後に公開します。' : '運転モードを確認できません。設定を確認してください。';
      available('tick',!!mode && !data.operation?.busy); if (data.operation?.busy) $('tick-result').textContent = `別の制作処理が進行中です（開始：${date(data.operation.startedAt)}）。完了後に最新の状態へ更新してください。`;
      const logs = items(data,'recentLog'); $('log').replaceChildren(...(logs.length ? logs.map(item => { const div = node('div',undefined,'kiji-list-row'); div.append(node('span',{approve:'承認',reject:'差戻し',discard:'破棄',retry:'再試行'}[item.action] || item.action,'kw-tag'),summary(item.title || `原稿 #${item.article_id}`,date(item.created_at))); return div; }) : [help('履歴はまだありません。')]));
    } catch (err) { error('dash-error',err.message); }
  }
  async function loadKeywords() {
    const params = new URLSearchParams(); const map = {status:'kw-status',layer:'kw-layer',q:'kw-search'};
    Object.entries(map).forEach(([key,id]) => { const value = $(id).value.trim(); if (value) params.set(key,value); }); if ($('kw-unconfirmed').checked) params.set('unconfirmed','1'); if ($('kw-split').checked) params.set('needs_split','1');
    const data = await loadPanel('keywords',() => api(`/keywords?${params}`)); if (!data) return;
    try { const rows = items(data); $('kw-count').textContent = `取得したキーワード ${number(rows.length)}件（条件に合う優先度上位500件まで。検索・絞り込みで対象を探せます）`; $('kw-empty').hidden = !!rows.length;
      $('kw-rows').replaceChildren(...rows.map(row => { const demand = demandInfo(row); const tr = cells([summary(row.keyword,[row.is_pillar ? 'ピラー' : '',row.needs_split ? '意図の分離が必要' : '',row.seed_keyword ? `軸：${row.seed_keyword}` : ''].filter(Boolean).join(' / ')),summary(row.layer || '未分類',row.layer_confirmed ? '確認済み' : '未承認'),summary(demand.value,demand.label),typeof row.priority === 'number' ? row.priority.toFixed(2) : '—',row.intent_explicit && row.intent_latent ? row.intent_confirmed ? '確認済み' : '下書きあり' : '未記入',KEYWORD_STATUS[row.status] || row.status,button('確認・編集',() => openKeyword(row))]); if (demand.zero) { tr.children[2].classList.add('kiji-zero'); tr.children[2].setAttribute('aria-label','月間推計0。取得元の表示値であり、需要が存在しないことを保証しません。'); } return tr; }));
    } catch (err) { error('keywords-error',err.message); }
  }
  function openKeyword(row) {
    selectedKeyword = row; const statusLocked = keywordStatusLocked(row); $('keyword-title').textContent = row.keyword; $('keyword-reason').textContent = `分類の理由：${row.layer_reason || '未記録'}${statusLocked ? '。原稿が紐づいているか、生成中・公開済みのため、記事化状態の変更と制作キューへの追加はできません。分類・検索意図のメモは保存できます。' : ''}`;
    available('keyword-ready',!statusLocked); available('keyword-queue',!statusLocked);
    $('edit-layer').value = row.layer || ''; $('edit-fit').value = String(row.experience_fit ?? 1); $('edit-layer-ok').checked = !!row.layer_confirmed; $('edit-split').checked = !!row.needs_split; $('edit-explicit').value = row.intent_explicit || ''; $('edit-latent').value = row.intent_latent || ''; $('edit-intent-ok').checked = !!row.intent_confirmed; showDialog('keyword-dialog');
  }
  async function saveKeyword(status) {
    if (!selectedKeyword) return;
    if (status && keywordStatusLocked(selectedKeyword)) return error('keyword-error','原稿が紐づいているか、生成中・公開済みのため、記事化状態は変更できません。確認内容の保存は利用できます。');
    const body = {layer:$('edit-layer').value || null,layer_confirmed:Number($('edit-layer-ok').checked),experience_fit:Number($('edit-fit').value),needs_split:Number($('edit-split').checked),intent_explicit:$('edit-explicit').value.trim(),intent_latent:$('edit-latent').value.trim(),intent_confirmed:Number($('edit-intent-ok').checked),...(status ? {status} : {})};
    if (status === 'queued' && !confirm(`「${selectedKeyword.keyword}」を制作キューに追加します。次の定期処理で記事化され、自動制作モードでは公開用の変更が作成される場合があります。追加しますか？`)) return;
    await mutate('keyword-error',async () => { await api(`/keywords/${selectedKeyword.id}`,{method:'PATCH',body}); closeDialog($('keyword-dialog'),true); notify(status === 'queued' ? '制作キューへ追加しました。' : 'キーワードの確認内容を保存しました。'); await loadKeywords(); });
  }
  async function addKeyword(expand = false) {
    const seed = $('seed').value.trim(); if (!seed) return $('seed-form').reportValidity();
    await mutate('keywords-error',async () => { const result = await api('/keywords',{method:'POST',body:{keywords:[seed]}}); if (expand) { const expanded = await api('/keywords/expand',{method:'POST',body:{seed}}); notify(`サジェスト ${number(expanded.found)}件を確認し、${number(expanded.added)}件を追加しました${expanded.cached ? '（保存済み候補を利用）' : ''}。`); } else { notify(result.added ? 'キーワードを追加しました。' : '登録済みのキーワードです。'); $('seed').value = ''; } await loadKeywords(); });
  }

  async function loadQueue() {
    const data = await loadPanel('queue',async () => { const [pending,human] = await Promise.all([api('/articles?status=pending_approval'),api('/articles?status=needs_human')]); return [...items(pending),...items(human)]; }); if (!data) return;
    $('queue-count').textContent = String(data.length); $('queue-count').hidden = data.length === 0;
    $('queue-list').replaceChildren(...(data.length ? data.map(article => {
      const card = node('section',undefined,'kw-panel'); card.append(node('h3',article.title || '無題の原稿'),help(`${ARTICLE_STATUS[article.status] || article.status} / KW：${article.keyword || '—'} / ${article.layer || '未分類'} / 品質判定 ${gateLabel(article)}`));
      const gates = plainArray(article.gate_json); const failed = gates.filter(gate => !gate.pass); if (failed.length) card.append(help(`要確認：${failed.map(gate => `${gate.label || gate.id} ${gate.reason || ''}`).join(' / ')}`));
      if (article.last_error) card.append(help(`直近のエラー：${article.last_error}`));
      if (article.publication) { card.append(help('公開処理の結果を照合してください。照合が終わるまで編集・再承認を停止しています。'),actions(button('原稿を確認',() => openArticle(article.id)),button('公開状態を照合',() => checkPublication(article,'queue-error'),false,true))); }
      else card.append(actions(button('原稿を確認',() => openArticle(article.id)),button('公開用の変更を作成',() => confirmArticleAction('approve',article),true,true),button('差戻し',() => confirmArticleAction('reject',article),false,true),button('破棄',() => confirmArticleAction('discard',article),false,true))); return card;
    }) : [help('確認待ちの原稿はありません。生成された原稿がここに並びます。')]));
  }
  function confirmArticleAction(action,article) {
    if (article.publication) return notify('公開処理の結果を照合してから操作してください。');
    const title = article.title || `原稿 #${article.id}`; const options = {
      approve:{title:'公開用の変更を作成',description:`「${title}」を承認し、公式メディアへ反映するための変更を作成します。品質判定は ${gateLabel(article)} です。未合格項目を含めて内容を確認してください。ここではまだ公開されません。変更の確認・マージ後に、原稿一覧で公開状態を確認してください。`,label:'この原稿の公開用の変更を作成'},
      reject:{title:'修正指示を付けて差戻し',description:`「${title}」を差し戻します。入力した指示をもとに、次の制作処理で本文が再生成されます。`,label:'修正指示を送って差戻す'},
      discard:{title:'原稿を破棄',description:`「${title}」を破棄状態にし、キーワードをプールへ戻します。この原稿は公開されません。破棄しますか？`,label:'この原稿を破棄する'}
    };
    const option = options[action]; $('action-title').textContent = option.title; $('action-description').textContent = option.description; $('action-submit').textContent = option.label; $('reject-label').hidden = action !== 'reject'; $('reject-note').required = action === 'reject'; $('reject-note').value = '';
    actionPending = async () => { const result = await api(`/articles/${article.id}/${action}`,{method:'POST',body:action === 'reject' ? {note:$('reject-note').value.trim()} : {}}); notify(action === 'approve' ? `公開用の変更を作成しました。確認・マージ後に、原稿一覧で公開状態を確認してください。${result.url ? ` ${safeUrl(result.url) || ''}` : ''}` : action === 'reject' ? '修正指示を保存し、差し戻しました。' : '原稿を破棄状態にしました。'); await Promise.all([loadQueue(),loadDash(),loadDrafts()]); }; showDialog('action-dialog');
  }
  async function loadDrafts() {
    const params = new URLSearchParams(); if ($('draft-status').value) params.set('status',$('draft-status').value);
    const data = await loadPanel('drafts',() => api(`/articles?${params}`)); if (!data) return;
    try { const rows = items(data); $('draft-count').textContent = `${number(rows.length)}件（新しい原稿から最大200件）`; $('draft-empty').hidden = !!rows.length;
      $('draft-rows').replaceChildren(...rows.map(article => cells([
        summary(article.title || '生成中の原稿',article.slug),summary(article.keyword,article.layer),
        summary(ARTICLE_STATUS[article.status] || article.status,article.error_count ? `エラー ${article.error_count}回` : ''),
        gateLabel(article),date(article.published_at).slice(0,10),publicationControls(article,'drafts-error'),button('原稿を開く',() => openArticle(article.id))
      ])));
    } catch (err) { error('drafts-error',err.message); }
  }
  async function checkPublication(article,errorId) {
    await mutate(errorId,async () => {
      const result = await api(`/articles/${article.id}/check-deploy`,{method:'POST',body:{}});
      notify(result.live ? '公開URLの正常応答を確認しました。' : result.message || `公開状態の確認が必要です（${result.status || result.error || '反映待ち'}）。変更の確認・マージ後にもう一度照合してください。`);
      if ($('article-dialog').open && articleData?.article.id === article.id) { articleData = await api(`/articles/${article.id}`); renderArticle(); }
      await Promise.all([loadDrafts(),loadQueue(),loadDash()]);
    });
  }
  function publicationControls(article,errorId) {
    const container = node('div',undefined,'kiji-publication');
    const pr = publicationUrl(article.publication?.pullRequestUrl);
    if (pr) { const link = node('a','公開用の変更を確認 ↗','kw-button'); link.href = pr; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link); }
    const hasPublication = !!article.publication || ['published','publishing'].includes(article.status);
    const url = hasPublication ? articleUrl(article.slug) : null;
    if (url) { const link = node('a',article.status === 'published' ? '公開記事を開く ↗' : '公開予定URLを開く ↗','kw-button'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link); }
    if (article.status === 'published' && article.deploy_verified) container.append(help('公開URLの正常応答を確認済み'));
    else if (hasPublication) container.append(button('公開状態を照合',() => checkPublication(article,errorId),false,true));
    if (!container.children.length) container.append(document.createTextNode('—'));
    return container;
  }
  function articleValues() { return {title:$('article-edit-title').value,description:$('article-edit-description').value,slug:$('article-edit-slug').value,category:$('article-edit-category').value,body_md:$('article-edit-body').value}; }
  function fillArticleForm(article) { for (const [field,key] of [['title','title'],['description','description'],['slug','slug'],['category','category'],['body','body_md']]) $('article-edit-' + field).value = article[key] || ''; }
  function renderArticle() {
    const article = articleData.article, draft = articleDraft || article; const editable = ['pending_approval','needs_human'].includes(article.status) && !article.publication;
    $('article-publication').replaceChildren();
    if (article.publication || ['publishing','published'].includes(article.status)) $('article-publication').append(publicationControls(article,'article-error'));
    if (article.status === 'publishing') $('article-publication').append(help('公開用の変更を作成済みです。確認・マージ後に公開状態を照合してください。'));
    else if (article.publication?.status === 'unconfirmed') $('article-publication').append(help('公開処理の結果を確認できていません。原稿の編集・再承認を行う前に、公開状態を照合してください。'));
    $('article-title').textContent = draft.title || '無題の原稿'; $('article-meta').textContent = `${ARTICLE_STATUS[article.status] || article.status} / KW：${articleData.keyword?.keyword || '—'} / ${draft.category || '未分類'} / ${String(draft.body_md || '').length.toLocaleString()}文字`;
    $('article-toggle').hidden = !editable; $('article-toggle').textContent = articleEditing ? '入力内容をプレビュー' : '原稿を編集'; $('article-form').hidden = !articleEditing; $('article-preview').hidden = articleEditing; $('article-gates').hidden = articleEditing; $('article-regate').hidden = !editable || articleEditing; available('article-regate',editable && !dirtyDialogs.has('article-dialog'));
    if (articleEditing) return;
    const gates = plainArray(article.gate_json); $('article-gates').replaceChildren(); if (gates.length) { const list = node('ul',undefined,'kiji-gates'); gates.forEach(gate => list.append(node('li',`${gate.pass ? '合格' : '要確認'}：${gate.id ? gate.id + '. ' : ''}${gate.label || ''}${gate.reason ? ' — ' + gate.reason : ''}`))); $('article-gates').append(node('h3',dirtyDialogs.has('article-dialog') ? '保存済み原稿の品質判定（編集中の内容は未判定）' : '品質判定'),list); }
    // markdownHtml escapes every text/attribute and confines SVGs to inert image sources.
    $('article-preview').innerHTML = markdownHtml(draft.body_md,plainArray(article.svg_json));
    const faq = plainArray(articleData.outline?.faq_json); if (faq.length) { $('article-preview').append(node('h2','よくある質問（公開時に末尾へ追加）')); faq.forEach(item => { const detail = node('details'); detail.append(node('summary',item.q),node('p',item.a)); $('article-preview').append(detail); }); }
  }
  async function openArticle(id) {
    if (lock.busy) return;
    const channel = read('article-detail'), token = channel.begin();
    $('article-title').textContent = '原稿を読み込み中'; $('article-preview').replaceChildren(); $('article-publication').replaceChildren(); $('article-gates').replaceChildren(); $('article-meta').textContent = ''; $('article-toggle').hidden = true; $('article-regate').hidden = true; $('article-form').hidden = true; $('article-preview').hidden = false; articleData = null; articleDraft = null; articleEditing = false; showDialog('article-dialog');
    try { const data = await api(`/articles/${id}`); if (!channel.current(token) || !$('article-dialog').open) return; if (!data?.article || data.article.id !== id) throw new Error('原稿を確認できません。'); articleData = data; fillArticleForm(data.article); renderArticle(); } catch (err) { if (channel.current(token)) error('article-error',err.message); }
  }
  async function saveArticle() {
    if (!articleData || articleData.article.publication || !$('article-form').reportValidity()) return;
    const id = articleData.article.id, body = articleValues(); articleDraft = body;
    await mutate('article-error',async () => { await api(`/articles/${id}`,{method:'PATCH',body}); articleData.article = {...articleData.article,...body}; dirtyDialogs.delete('article-dialog');
      try { const result = await api(`/articles/${id}/regate`,{method:'POST',body:{}}); const refreshed = await api(`/articles/${id}`); articleData = refreshed; articleDraft = null; articleEditing = false; fillArticleForm(refreshed.article); renderArticle(); notify(`原稿を保存し、品質を再判定しました（${result.score ?? '—'} / 9）。`); await Promise.all([loadQueue(),loadDrafts()]); }
      catch (err) { error('article-error',`原稿は保存済みですが、品質の再判定または最新状態の取得を確認できません。入力内容は保持しています。${err.message}`); }
    });
  }

  async function loadMetrics() {
    const data = await loadPanel('metrics',() => api('/metrics/summary')); if (!data) return;
    try { const rows = items(data,'articles'), queries = items(data,'bestQueries'), rewrites = items(data,'rewrites'); metricsConnected = !!data.saKey; available('metrics-pull',metricsConnected);
      const ga4Available = data.sourceAvailability?.ga4 === true, gscAvailable = data.sourceAvailability?.gsc === true, hasData = ga4Available || gscAvailable; $('metrics-status').textContent = `${metricsConnected ? '計測の接続設定あり' : '計測の接続設定が必要です'}。GA4 最終取込：${data.sourceDates?.ga4 || '未取得'} / Search Console 最終取込：${data.sourceDates?.gsc || '未取得'}。未取得の指標は「—」です。Googleの反映遅延や取得期間により、現在のアクセスと差が出ます。`;
      const total = key => metricTotal(rows,key,ga4Available);
      const sessions = total('sess28'), cta = total('cta28'); stats('metrics-stats',[['セッション',number(sessions),`検索経由 ${number(total('organic28'))}`],['CTA反応率',metricRate(sessions,cta),`${number(cta)}クリック`],['AI経由流入',number(total('ai28')),'セッション'],['検索表示 / クリック',gscAvailable ? `${number(data.gsc28?.imp)} / ${number(data.gsc28?.clk)}` : '—','Search Console']]);
      const byArticle = new Map(queries.map(row => [row.article_id,row])); $('metrics-rows').replaceChildren(...rows.map(article => { const query = gscAvailable ? byArticle.get(article.id) : null; return cells([summary(article.title,`${article.keyword || ''} / ${article.layer || '未分類'}`),query?.query || '—',typeof query?.avgpos === 'number' ? `${query.avgpos.toFixed(1)}位` : '—',query ? `${number(query.imp)} / ${number(query.clk)}` : '—',ga4Available ? number(article.sess28) : '—',ga4Available ? metricRate(article.sess28,article.cta28) : '—',ga4Available ? number(article.ai28) : '—']); })); $('metrics-empty').hidden = !!rows.length; $('metrics-empty').textContent = hasData ? '計測対象の公開記事がありません。' : '計測データは未取得です。';
      $('rewrites-panel').hidden = !rewrites.length; $('rewrites').replaceChildren(...rewrites.map(row => { const div = node('div',undefined,'kiji-list-row'); div.append(summary(row.title || `原稿 #${row.article_id}`,`${{rank_11_20:'検索順位11〜20位',low_ctr:'検索結果のクリック率',low_cta:'CTA導線',no_traffic_90d:'キーワード選定'}[row.trigger] || row.trigger}：${row.diagnosis || ''}`),help(row.suggestion || ''),button('対応済みにする',() => mutate('metrics-error',async () => { await api(`/rewrites/${row.id}/dismiss`,{method:'POST',body:{}}); notify('改善候補を対応済みにしました。'); await loadMetrics(); }),false,true)); return div; }));
    } catch (err) { error('metrics-error',err.message); }
  }
  const settingFields = () => all('[data-kiji-setting]');
  async function loadSettings(force = false) {
    if (settingsDirty && (!force || !confirm('保存していない運転設定があります。変更を破棄して保存済みの設定を読み込みますか？'))) return;
    const data = await loadPanel('settings',() => api('/settings')); if (!data) return;
    if (!data.settings || typeof data.settings !== 'object') { error('settings-error','設定の形式を確認できません。'); return; }
    settingFields().forEach(field => { const key = field.dataset.kijiSetting; const value = data.settings[key] ?? ''; field.value = key === 'categories' ? plainArray(value).join(',') : String(value); }); settingsDirty = false; settingsLoaded = true; $('settings-fields').disabled = false; await loadEvidence();
  }
  async function loadEvidence() {
    const data = await loadPanel('evidence',() => api('/evidence')); if (!data) return;
    try { const rows = items(data); $('evidence-empty').hidden = !!rows.length; $('evidence-rows').replaceChildren(...rows.map(row => cells([row.label,row.value,row.source,button(row.usable ? '使用中：停止する' : '停止中：使用する',() => mutate('evidence-error',async () => { await api(`/evidence/${row.id}`,{method:'PATCH',body:{usable:row.usable ? 0 : 1}}); await loadEvidence(); }),false,true)]))); } catch (err) { error('evidence-error',err.message); }
  }
  const loaders = {dash:loadDash,keywords:loadKeywords,queue:loadQueue,drafts:loadDrafts,metrics:loadMetrics,settings:loadSettings,improve:mountImprovement};
  const visited = new Set();
  async function selectTab(key,{focus = false} = {}) {
    if (!loaders[key]) key = 'dash';
    all('[data-kiji-tab]').forEach(tab => { const active = tab.dataset.kijiTab === key; tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1; if (active && focus) tab.focus(); });
    document.querySelectorAll('[data-kiji-panel]').forEach(panel => { panel.hidden = panel.dataset.kijiPanel !== key; });
    history.replaceState(null,'',`${location.pathname}${location.search}#${key}`);
    if (!visited.has(key)) { visited.add(key); try { await loaders[key](); } catch (err) { visited.delete(key); notify(err.message); } }
  }
  all('[data-kiji-tab]').forEach(tab => { tab.addEventListener('click',() => selectTab(tab.dataset.kijiTab)); tab.addEventListener('keydown',event => { const tabs = all('[data-kiji-tab]'), index = tabs.indexOf(tab); let next = null; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next !== null) { event.preventDefault(); void selectTab(tabs[next].dataset.kijiTab,{focus:true}); } }); });
  all('[data-kiji-refresh]').forEach(el => el.addEventListener('click',() => loaders[el.dataset.kijiRefresh](true)));
  $('seed-form').addEventListener('submit',event => { event.preventDefault(); void addKeyword(); }); $('expand').addEventListener('click',() => addKeyword(true));
  $('classify').addEventListener('click',() => mutate('keywords-error',async () => { const result = await api('/keywords/classify',{method:'POST',body:{}}); notify(result.classified ? `${number(result.classified)}件を分類しました。層と検索意図を確認してください。` : result.message || '分類対象がありません。'); await loadKeywords(); }));
  ['kw-status','kw-layer','kw-unconfirmed','kw-split'].forEach(id => $(id).addEventListener('change',loadKeywords)); let searchTimer; $('kw-search').addEventListener('input',() => { read('keywords').invalidate(); clearTimeout(searchTimer); searchTimer = setTimeout(loadKeywords,300); }); $('draft-status').addEventListener('change',loadDrafts);
  $('keyword-form').addEventListener('submit',event => { event.preventDefault(); void saveKeyword(); }); $('keyword-ready').addEventListener('click',() => saveKeyword('ready')); $('keyword-queue').addEventListener('click',() => saveKeyword('queued'));
  $('csv-open').addEventListener('click',() => { $('csv-file').value = ''; $('csv-text').value = ''; $('csv-status').textContent = ''; available('csv-run',true); read('csv-file').invalidate(); showDialog('csv-dialog'); });
  $('csv-file').addEventListener('change',async () => { const file = $('csv-file').files?.[0], channel = read('csv-file'), token = channel.begin(); if (!file) return; error('csv-error'); $('csv-text').value = ''; available('csv-run',false); $('csv-status').textContent = `${file.name} を読み込み中です。`; try { if (file.size > 5000000) throw new Error('ファイルは5MB以内に分割してください。'); const bytes = await file.arrayBuffer(); if (!channel.current(token) || !$('csv-dialog').open) return; $('csv-text').value = decodeCsv(bytes); dirtyDialogs.add('csv-dialog'); $('csv-status').textContent = `${file.name} を読み込みました。内容を確認してから取り込んでください。`; } catch (err) { if (channel.current(token)) error('csv-error',err.message); } finally { if (channel.current(token)) available('csv-run',true); } });
  $('csv-text').addEventListener('input',() => { read('csv-file').invalidate(); available('csv-run',true); $('csv-status').textContent = '入力した内容を取り込みます。'; });
  $('csv-form').addEventListener('submit',event => { event.preventDefault(); const csv = $('csv-text').value; if (!csv.trim()) return; void mutate('csv-error',async () => { const result = await importCsv(api,csv,progress => { $('csv-status').textContent = `取込中：${Math.min(progress.nextOffset || progress.totalRows,progress.totalRows)} / ${progress.totalRows}行`; }); notify(`${number(result.totalRows)}行を処理し、新規${number(result.added)}件・需要値あり${number(result.withVolume)}件を取り込みました。${result.headerless ? 'ヘッダーなしのため1列目をキーワード、2列目を参考需要値として解釈しました。' : ''}`); closeDialog($('csv-dialog'),true); await loadKeywords(); }); });
  $('action-form').addEventListener('submit',event => { event.preventDefault(); if (!actionPending) return; void mutate('action-error',async () => { await actionPending(); closeDialog($('action-dialog'),true); actionPending = null; }); });
  $('article-toggle').addEventListener('click',() => { if (!articleData || articleData.article.publication) return; if (articleEditing) articleDraft = articleValues(); articleEditing = !articleEditing; renderArticle(); if (articleEditing) $('article-edit-title').focus(); }); $('article-form').addEventListener('submit',event => { event.preventDefault(); void saveArticle(); });
  $('article-form').addEventListener('input',() => { dirtyDialogs.add('article-dialog'); available('article-regate',false); }); $('article-regate').addEventListener('click',() => { if (!articleData || articleData.article.publication || dirtyDialogs.has('article-dialog')) return; void mutate('article-error',async () => { const id = articleData.article.id; await api(`/articles/${id}/regate`,{method:'POST',body:{}}); articleData = await api(`/articles/${id}`); renderArticle(); notify('保存済み原稿の品質を再判定しました。'); await loadQueue(); }); });
  $('tick').addEventListener('click',() => { if (!mode) return; $('action-title').textContent = '制作を1工程進める'; $('action-description').textContent = mode === 'full' ? '現在は自動制作モードです。次の工程が実行され、条件を満たした原稿の公開用の変更が作成される場合があります。1工程進めますか？' : '現在は確認後に公開するモードです。キーワード分類・構成・本文・図解・品質判定の次の工程を1つ実行します。進めますか？'; $('action-submit').textContent = '1工程を実行する'; $('reject-label').hidden = true; $('reject-note').required = false; actionPending = async () => { const result = await api('/tick',{method:'POST',body:{}}); $('tick-result').textContent = result.detail || result.did || '工程を実行しました。'; notify('工程の実行結果を制作状況に反映しました。'); await loadDash(); }; showDialog('action-dialog'); });
  $('metrics-pull').addEventListener('click',() => { if (metricsConnected) void mutate('metrics-error',async () => { const result = await api('/metrics/pull',{method:'POST',body:{days:3}}); notify(result.detail || '取込処理を実行しました。'); await loadMetrics(); }); });
  $('settings-form').addEventListener('input',() => { settingsDirty = true; read('settings').invalidate(); }); $('settings-form').addEventListener('submit',event => { event.preventDefault(); if (!settingsLoaded || !$('settings-form').reportValidity()) return; const body = Object.fromEntries(settingFields().map(field => [field.dataset.kijiSetting,field.dataset.kijiSetting === 'categories' ? field.value.split(',').map(value => value.trim()).filter(Boolean) : field.value])); if (Number(body.article_min_chars) > Number(body.article_max_chars)) return error('settings-error','本文の最大文字数は最小文字数以上にしてください。'); if (!confirm(`運転設定を保存します。モード：${body.autopilot === 'full' ? '自動制作（条件を満たす原稿の公開用の変更を作成）' : '確認後に公開'}、1日の公開上限：${body.daily_cap}本、週の目標：${body.weekly_target}本。この設定で保存しますか？`)) return; void mutate('settings-error',async () => { await api('/settings',{method:'PUT',body}); settingsDirty = false; notify('運転設定を保存しました。'); await loadDash(); }); });
  $('evidence-form').addEventListener('submit',event => { event.preventDefault(); if (!$('evidence-form').reportValidity()) return; const body = {label:$('evidence-label').value.trim(),value:$('evidence-value').value.trim(),source:$('evidence-source').value.trim()}; void mutate('evidence-error',async () => { await api('/evidence',{method:'POST',body}); $('evidence-form').reset(); notify('一次データを登録しました。'); await loadEvidence(); }); });
  $('publication-check').addEventListener('click',async () => { const button = $('publication-check'); if (button.disabled) return; button.disabled = true; $('publication-status').textContent = '公開先への接続を確認しています。'; try { const result = await api('/publication/status'); $('publish-status').textContent = result.connected || result.readable ? '読み取り確認済み（書込未確認）' : '読み取り接続を確認できません'; $('publication-status').textContent = `${result.connected || result.readable ? '公開先の読み取り接続を確認しました。' : '公開先への接続を確認できません。'} ${result.message || ''} この確認では書き込み権限を検証していません。`; } catch (err) { $('publication-status').textContent = err.message; } finally { button.disabled = false; } });
  const initial = location.hash.slice(1); await selectTab(loaders[initial] ? initial : 'dash');
  return {apiBase:API_BASE,selectTab};
}

if (typeof document !== 'undefined' && document.getElementById('kiji-workbench') && await startAccessSession()) await mountKijiWorkbench();
