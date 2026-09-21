/** Bind once. Submission details go only to the form provider, never analytics. */
export function bindMediaContact(form, { fetcher = fetch, makeData = () => new FormData(form), timeoutMs = 12000 } = {}) {
  if (form.dataset.bound) return;
  form.dataset.bound = 'true';
  const button = form.querySelector('[type=submit]');
  const status = form.querySelector('[data-contact-status]');
  let pending = false, accepted = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || accepted || !form.reportValidity()) return;
    pending = true;
    button.disabled = true;
    button.textContent = '送信中…';
    status.hidden = false;
    status.textContent = 'お問い合わせを送信しています。';
    const controller = new AbortController();
    let timer;
    try {
      const submission = (async () => {
        const response = await fetcher(form.action.replace('formsubmit.co/', 'formsubmit.co/ajax/'), {
          method: 'POST', body: makeData(), headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('HTTP failure');
        const result = await response.json();
        if (result.success !== true && result.success !== 'true') throw new Error('Not accepted');
      })();
      await Promise.race([submission, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout')); }, timeoutMs);
      })]);
      accepted = true;
      status.dataset.state = 'success';
      status.textContent = 'お問い合わせを受け付けました。内容を確認のうえ、ご入力のメールアドレスへ返信します。';
      button.textContent = '送信を受け付けました';
      form.querySelectorAll('input:not([type=hidden]), textarea, select').forEach(field => { field.disabled = true; });
    } catch {
      status.dataset.state = 'error';
      status.textContent = '送信の完了を確認できませんでした。入力内容は残っています。時間をおいて再度お試しいただくか、下のメールアドレスへご連絡ください。';
      button.disabled = false;
      button.textContent = 'お問い合わせを送る';
    } finally {
      clearTimeout(timer);
      pending = false;
    }
  });
}
