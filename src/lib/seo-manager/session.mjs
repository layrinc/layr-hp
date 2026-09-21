const endpoint = '/tools/ltori-seo/session.json';

function lockWorkspace() {
  const main = document.createElement('main'); main.className = 'kw-main kw-access-page';
  const title = document.createElement('h1'); title.textContent = 'メール認証を確認してください';
  const description = document.createElement('p'); description.className = 'kw-help';
  description.textContent = '認証の有効期限または接続状態を確認できませんでした。再読み込みしてログインしてください。保存済みの作業データは再ログイン後に確認できます。';
  const button = document.createElement('button'); button.className = 'kw-button'; button.textContent = '再読み込みしてログイン';
  button.addEventListener('click', () => location.reload());
  main.append(title, description, button); document.body.replaceChildren(main);
}

export async function startAccessSession() {
  let identity, timer, locked = false, checking = false;
  async function check() {
    if (locked || checking) return false;
    checking = true;
    try {
      const response = await fetch(endpoint, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Session unavailable');
      const next = await response.json();
      if (typeof next.email !== 'string' || !next.email.includes('@') || !Number.isFinite(next.expiresAt) || next.expiresAt <= Date.now()) throw new Error('Session expired');
      if (identity && identity.email !== next.email) { location.reload(); return false; }
      identity = next;
      const label = document.getElementById('kw-identity');
      if (label) label.textContent = next.email;
      return true;
    } catch {
      locked = true; clearInterval(timer); lockWorkspace(); return false;
    } finally { checking = false; }
  }
  if (!await check()) return false;
  timer = setInterval(() => {
    if (identity.expiresAt <= Date.now()) { locked = true; clearInterval(timer); lockWorkspace(); }
    else if (!document.hidden) void check();
  }, 60000);
  window.addEventListener('focus', () => void check());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.getElementById('kw-logout')?.addEventListener('click', () => { document.body.inert = true; });
  return true;
}
