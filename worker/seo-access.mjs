import {createRemoteJWKSet, jwtVerify} from 'jose';

export const MANAGER_ORIGIN = 'https://seo.layr.co.jp';
export const MANAGER_PATH = '/tools/ltori-seo/';
export const MEDIA_MANAGER_PATH = `${MANAGER_PATH}media/`;
const WORKSPACE_ASSETS = Object.freeze({'/': `${MANAGER_PATH}overview/`, '/regional/': MANAGER_PATH, '/media/': MEDIA_MANAGER_PATH, '/growth/': `${MANAGER_PATH}growth/`, '/articles/': `${MANAGER_PATH}articles/`, '/strategy/': `${MANAGER_PATH}strategy/`, '/backlinks/': `${MANAGER_PATH}backlinks/`});
function managementDestination(path) {
  const base = path.replace(/(?:\/index)?\.html$/, '').replace(/\/+$/, '');
  if ([MANAGER_PATH.slice(0, -1), `${MANAGER_PATH}regional`].includes(base)) return '/regional/';
  if (base === `${MANAGER_PATH}overview`) return '/';
  for (const route of Object.keys(WORKSPACE_ASSETS).filter(value => value !== '/')) if (base === `${MANAGER_PATH}${route.slice(1, -1)}`) return route;
  return null;
}
const PUBLIC_HOSTS = new Set(['layr.co.jp', 'www.layr.co.jp']);
const keySets = new Map();

export function accessConfiguration(env) {
  const team = env.SEO_ACCESS_TEAM_DOMAIN;
  const audience = env.SEO_ACCESS_AUD;
  if (typeof team !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)
      || typeof audience !== 'string' || !/^[a-f0-9]{64}$/.test(audience)) return null;
  return {issuer: team, audience};
}

export async function verifyAccessToken(token, config, keys) {
  if (!token || token.length > 16384) throw new Error('Missing or invalid Access token');
  if (!keys) {
    if (!keySets.has(config.issuer)) keySets.set(config.issuer, createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), {timeoutDuration: 5000}));
    keys = keySets.get(config.issuer);
  }
  const {payload} = await jwtVerify(token, keys, {
    issuer: config.issuer, audience: config.audience, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5,
  });
  if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
      || typeof payload.sub !== 'string' || !payload.sub || payload.iat > Date.now() / 1000 + 5) throw new Error('Not an email identity');
  return {email: payload.email, expiresAt: payload.exp * 1000};
}

// Classify before the asset binding performs URL normalization. Never let an
// encoded path, duplicate slash, HTML alias or preview bypass the auth gate.
export function normalizedPath(pathname) {
  let value = pathname;
  for (let i = 0; i < 5; i++) {
    const decoded = decodeURIComponent(value);
    if (decoded === value) return new URL(value.replaceAll('\\', '/').replace(/\/{2,}/g, '/'), 'https://path.invalid').pathname;
    value = decoded;
  }
  throw new Error('Over-encoded URL');
}

export function protectedResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {status, headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...extraHeaders,
  }});
}

function secureAsset(response) {
  const result = protectedResponse(response.body, response.status, Object.fromEntries(response.headers));
  result.headers.set('Cache-Control', 'private, no-store, max-age=0');
  result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  result.headers.delete('ETag');
  result.headers.delete('Last-Modified');
  return result;
}

export async function handleRequest(request, env, verify = verifyAccessToken, handlers = {}) {
  const url = new URL(request.url);
  let path;
  try { path = normalizedPath(url.pathname); }
  catch { return protectedResponse('URLを確認してください。', 400); }
  const dedicated = url.hostname === new URL(MANAGER_ORIGIN).hostname;
  const management = path.toLowerCase().startsWith(MANAGER_PATH.slice(0, -1));

  // Public LPs use the original asset binding and require no authentication.
  if (!dedicated && !management) return handlers.publicFetch ? handlers.publicFetch(request, env) : env.ASSETS.fetch(request);
  if (!dedicated && !PUBLIC_HOSTS.has(url.hostname)) return protectedResponse('管理画面は専用ドメインから開いてください。', 403);
  if (url.protocol !== 'https:') return protectedResponse('HTTPSでアクセスしてください。', 400);

  const config = accessConfiguration(env);
  if (!config) return protectedResponse('管理画面の認証設定を準備中です。時間をおいて開き直してください。', 503);
  let identity;
  try { identity = await verify(request.headers.get('Cf-Access-Jwt-Assertion'), config); }
  catch { return protectedResponse('ログインを確認できませんでした。専用ドメインでメール認証をやり直してください。', 401); }
  if (dedicated && path.startsWith('/api/seo/') && handlers.authenticated) return handlers.authenticated(request, env, identity, path);
  if (!['GET', 'HEAD'].includes(request.method)) return protectedResponse('この操作には対応していません。', 405, {Allow: 'GET, HEAD'});

  if (path === `${MANAGER_PATH}session.json`) {
    return protectedResponse(request.method === 'HEAD' ? null : JSON.stringify({...identity, managerOrigin: MANAGER_ORIGIN, legacy: !dedicated}), 200, {'Content-Type': 'application/json; charset=utf-8'});
  }
  const legacyDestination = managementDestination(path);
  // Keep the public-origin migration page reachable so existing IndexedDB
  // data can be exported before switching origins. Only dedicated aliases redirect.
  if (dedicated && legacyDestination) return protectedResponse(null, 302, {Location: `${MANAGER_ORIGIN}${legacyDestination}`});
  if (dedicated) {
    const base = path.replace(/(?:\/index)?\.html$/, '').replace(/\/+$/, '');
    const canonical = base === '' || base === '/overview' ? '/' : `${base}/`;
    if (Object.hasOwn(WORKSPACE_ASSETS, canonical) && path !== canonical) return protectedResponse(null, 302, {Location: `${MANAGER_ORIGIN}${canonical}`});
  }
  // Only allowlisted manager assets are served on the dedicated host. Public
  // articles, forms and sitemap never acquire duplicate management URLs.
  if (dedicated && !Object.hasOwn(WORKSPACE_ASSETS, path) && !path.startsWith('/_astro/') && path !== '/favicon.svg') {
    return protectedResponse('ページが見つかりません。', 404);
  }
  const assetUrl = new URL(request.url);
  if (dedicated && Object.hasOwn(WORKSPACE_ASSETS, path)) assetUrl.pathname = WORKSPACE_ASSETS[path];
  if (!dedicated) assetUrl.pathname = `${MANAGER_PATH}migrate/`;
  assetUrl.search = '';
  // Avoid a 304 replay of an HTML page from a previously authenticated session.
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match'); headers.delete('If-Modified-Since');
  return secureAsset(await env.ASSETS.fetch(new Request(assetUrl, {method: request.method, headers})));
}
