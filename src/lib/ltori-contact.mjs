import { diagnosisFromCode, diagnosisSummary } from './ltori-diagnosis.mjs';

const sourceShape = /^(?:diagnosis|media|media\/[a-z0-9]+(?:-[a-z0-9]+)*|area|area\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)$/;

/** Only a published source returned by our origin can extend the build-time allowlist. */
export async function resolveContactSource(key, labels, { fetcher = fetch, sourceTimeoutMs = 2500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!key || typeof key !== 'string' || key.length > 120 || !sourceShape.test(key)) return null;
  if (Object.prototype.hasOwnProperty.call(labels, key)) return {key, label: labels[key]};
  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), sourceTimeoutMs);
  try {
    const response = await fetcher(`/api/ltori/source?key=${encodeURIComponent(key)}`, {headers: {Accept:'application/json'}, signal:controller.signal});
    if (!response.ok) return null;
    const source = await response.json();
    if (source?.key !== key || typeof source.label !== 'string' || !source.label.trim() || source.label.length > 300 || typeof source.path !== 'string' || !source.path.startsWith('/service/ltori/') || source.path.includes('..')) return null;
    return {key, label:source.label};
  } catch { return null; }
  finally { clearTimer(timer); }
}

/** Bind the real form. Contact details remain in the email request, never analytics payloads. */
export function bindLtoriContact(form, config, {
  document: doc = document,
  search = location.search,
  fetcher = fetch,
  makeData = () => new FormData(form),
  makeSubmissionId = () => crypto.randomUUID(),
  track = (...args) => { if (typeof globalThis.gtag === 'function') globalThis.gtag(...args); },
  timeoutMs = 8000,
  sourceTimeoutMs = 2500,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  const query = new URLSearchParams(search);
  const isLtori = query.get('service') === 'ltori';
  const decodedDiagnosis = isLtori ? diagnosisFromCode(query.get('diagnosis')) : null;
  const summary = diagnosisSummary(decodedDiagnosis);
  const requestedSource = isLtori ? query.get('source') || '' : '';
  let pageSource = '', sourceLabel = '';
  const setSource = source => {
    if (!source) return;
    pageSource = source.key;
    sourceLabel = source.label;
    const input = doc.createElement('input');
    input.type = 'hidden'; input.name = 'ご覧になったページ'; input.value = sourceLabel;
    form.append(input);
  };
  let sourceReady;
  if (requestedSource && sourceShape.test(requestedSource) && Object.prototype.hasOwnProperty.call(config.sourceLabels, requestedSource)) {
    setSource({key:requestedSource, label:config.sourceLabels[requestedSource]});
    sourceReady = null;
  } else if (requestedSource) {
    sourceReady = resolveContactSource(requestedSource, config.sourceLabels, {fetcher, sourceTimeoutMs, setTimer, clearTimer}).then(setSource);
  }
  if (isLtori) {
    form.querySelector('[name="ご相談内容"]').value = `${config.ltoriName}（採用LINE）について`;
    form.querySelector('[name="_subject"]').value = `【${config.ltoriName}】採用LINEのご相談`;
    const requestedPlan = query.get('plan');
    const planMessage = ['ライト', 'スタンダード', '戦略'].includes(requestedPlan) ? `${requestedPlan}プランについて相談したいです。\n\n` : '';
    const message = form.querySelector('textarea');
    if (!message.value) message.value = planMessage + (summary ? summary + '\n\n' : '');
  }
  const button = doc.getElementById('ctSubmit');
  const ok = doc.getElementById('ctOk');
  const fallback = doc.getElementById('ctFb');
  const mailto = doc.getElementById('ctMailto');
  let submitting = false, submitted = false, submissionId = '';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || submitted || form.querySelector('[name="_honey"]').value || (form.reportValidity && !form.reportValidity())) return;
    submitting = true;
    button.disabled = true;
    const previousLabel = button.firstChild.textContent;
    button.firstChild.textContent = '送信中… ';
    if (sourceReady) await sourceReady;
    const data = makeData();
    const controller = new AbortController();
    const timer = setTimer(() => controller.abort(), timeoutMs);
    try {
      if (isLtori) {
        submissionId ||= makeSubmissionId();
        data.set('_ltori_submission_id', submissionId);
        data.set('_ltori_source', pageSource);
        if (decodedDiagnosis) data.set('_ltori_diagnosis', query.get('diagnosis'));
      }
      const endpoint = isLtori ? '/api/ltori/contact' : form.action.replace('formsubmit.co/', 'formsubmit.co/ajax/');
      const response = await fetcher(endpoint, {method:'POST', body:data, headers:{Accept:'application/json'}, signal:controller.signal});
      if (!response.ok) throw new Error('Submission failed');
      const result = await response.json();
      if (result.success !== true && result.success !== 'true') throw new Error('Submission not accepted');
      submitted = true;
      form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(input => { input.value = ''; });
      ok.hidden = false; fallback.hidden = true;
      ok.scrollIntoView({block:'nearest', behavior:'smooth'});
      // An analytics error must never offer a retry for an accepted email.
      try {
        const attribution = pageSource ? {page_source:pageSource} : {};
        const lead = isLtori && typeof result.leadId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(result.leadId) ? {lead_id:result.leadId} : {};
        track('event', 'generate_lead', {method:'contact_form', service:isLtori ? 'ltori' : 'general', ...attribution, ...lead});
        if (pageSource.startsWith('area/')) track('event', 'ltori_inquiry_complete', {page_source:pageSource, method:'contact_form', ...lead});
        if (pageSource === 'media' || pageSource.startsWith('media/')) track('event', 'ltori_media_inquiry_complete', {page_source:pageSource, method:'contact_form', ...lead});
        if (decodedDiagnosis) track('event', 'ltori_diagnosis_inquiry_complete', {method:'contact_form', ...attribution, ...lead});
      } catch { /* Accepted submission remains accepted. */ }
    } catch {
      const value = name => String(data.get(name) || '');
      const body = `お名前: ${value('お名前')}\n会社名: ${value('会社名')}\nメール: ${value('メールアドレス')}\nご相談内容: ${value('ご相談内容')}${pageSource ? '\nご覧になったページ: ' + sourceLabel : ''}\n\n${value('お問い合わせ内容')}`;
      mailto.href = `mailto:${config.email}?subject=${encodeURIComponent('【お問い合わせ】LAYRサイトより')}&body=${encodeURIComponent(body)}`;
      fallback.hidden = false;
      fallback.scrollIntoView({block:'nearest', behavior:'smooth'});
    } finally {
      clearTimer(timer);
      submitting = false;
      button.disabled = submitted;
      button.firstChild.textContent = previousLabel;
    }
  });
  return {sourceReady};
}
