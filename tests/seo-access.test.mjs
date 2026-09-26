import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from 'jose';
import worker from '../worker/index.mjs';
import {accessConfiguration, handleRequest, verifyAccessToken} from '../worker/seo-access.mjs';

const issuer = 'https://seo-test.cloudflareaccess.com', audience = 'a'.repeat(64);
const config = {issuer, audience};
const {publicKey, privateKey} = await generateKeyPair('RS256');
const jwk = {...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256'};
const keys = createLocalJWKSet({keys: [jwk]});
async function token(overrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({iss: issuer, aud: [audience], sub: 'test-user', email: 'operator@example.test', iat: now, exp: now + 300, ...overrides})
    .setProtectedHeader({alg: 'RS256', kid: 'test-key'}).sign(signingKey);
}
const env = {SEO_ACCESS_TEAM_DOMAIN: issuer, SEO_ACCESS_AUD: audience};
function assetEnvironment() {
  const requests = [];
  return {...env, requests, ASSETS: {fetch: async request => {
    requests.push(request);
    return new Response(`asset:${new URL(request.url).pathname}`, {headers: {'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=31536000', ETag: 'test'}});
  }}};
}
const verify = (jwt, value) => verifyAccessToken(jwt, value, keys);
function request(url, jwt, options = {}) { return new Request(url, {...options, headers: {...options.headers, ...(jwt ? {'Cf-Access-Jwt-Assertion': jwt} : {})}}); }

test('JWT requires the correct signature, audience, issuer, time and email identity', async () => {
  assert.equal((await verifyAccessToken(await token(), config, keys)).email, 'operator@example.test');
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyAccessToken(await token({}, other.privateKey), config, keys));
  for (const changes of [{aud: ['b'.repeat(64)]}, {iss: 'https://other.cloudflareaccess.com'}, {exp: 1}, {exp: undefined}, {iat: undefined}, {iat: Date.now()/1000+3600}, {email: undefined}, {email: 'invalid'}, {sub: ''}, {nbf: Date.now()/1000+3600}]) {
    await assert.rejects(verifyAccessToken(await token(changes), config, keys));
  }
  await assert.rejects(verifyAccessToken('eyJhbGciOiJub25lIn0.e30.', config, keys));
});

test('missing or malformed Access configuration fails closed only for manager URLs', async () => {
  for (const settings of [{}, {SEO_ACCESS_TEAM_DOMAIN: 'https://evil.example', SEO_ACCESS_AUD: audience}, {SEO_ACCESS_TEAM_DOMAIN: issuer, SEO_ACCESS_AUD: 'placeholder'}]) {
    assert.equal(accessConfiguration(settings), null);
    const e = {...assetEnvironment(), SEO_ACCESS_TEAM_DOMAIN: undefined, SEO_ACCESS_AUD: undefined, ...settings};
    const res = await worker.fetch(request('https://seo.layr.co.jp/'), e, {});
    assert.equal(res.status, 503); assert.equal(e.requests.length, 0);
  }
  const e = assetEnvironment(); delete e.SEO_ACCESS_AUD;
  assert.equal((await worker.fetch(request('https://layr.co.jp/service/ltori/area/mie/nabari/'), e, {})).status, 200);
});

test('unsigned headers and auth-looking query parameters do not grant access', async () => {
  const e = assetEnvironment();
  const res = await worker.fetch(request('https://seo.layr.co.jp/?preview=1&authenticated=true', null, {headers: {'Cf-Access-Authenticated-User-Email': 'operator@example.test', Cookie: 'CF_Authorization=fake'}}), e, {});
  assert.equal(res.status, 401); assert.equal(e.requests.length, 0);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});

test('anonymous users cannot fetch root, scripts, legacy URLs or HTML/path aliases', async () => {
  const urls = [
    'https://seo.layr.co.jp/', 'https://seo.layr.co.jp/_astro/app.js', 'https://seo.layr.co.jp/index.html',
    'https://layr.co.jp/tools/ltori-seo', 'https://layr.co.jp/tools/ltori-seo/', 'https://layr.co.jp/tools/ltori-seo/index.html',
    'https://layr.co.jp/tools/ltori-seo.html', 'https://layr.co.jp/tools/ltori-seo/migrate/',
    'https://layr.co.jp/tools//ltori-seo/', 'https://layr.co.jp/%74ools/ltori-seo/',
    'https://layr.co.jp/tools%2fltori-seo/', 'https://layr.co.jp/%2574ools/ltori-seo/',
    'https://www.layr.co.jp/tools/ltori-seo/session.json',
  ];
  for (const url of urls) {
    const e = assetEnvironment(), res = await handleRequest(request(url), e, verify);
    assert.equal(res.status, 401, url); assert.equal(e.requests.length, 0, url);
    assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  }
});

test('manager stays closed on alternate hosts even with a signed token', async () => {
  for (const host of ['preview.example.test', 'layr-hp.example.workers.dev', 'layer.co.jp']) {
    const e = assetEnvironment();
    assert.equal((await handleRequest(request(`https://${host}/tools/ltori-seo/`, await token()), e, verify)).status, 403);
    assert.equal(e.requests.length, 0);
  }
});

test('authenticated dedicated root serves only manager HTML and removes cache validators', async () => {
  const e = assetEnvironment();
  const res = await handleRequest(request('https://seo.layr.co.jp/?utm_source=test', await token(), {headers: {'If-None-Match': 'old', 'If-Modified-Since': 'yesterday'}}), e, verify);
  assert.equal(res.status, 200); assert.equal(await res.text(), 'asset:/tools/ltori-seo/overview/');
  assert.equal(e.requests[0].headers.has('If-None-Match'), false);
  assert.equal(new URL(e.requests[0].url).search, '');
  assert.match(res.headers.get('Cache-Control'), /no-store/); assert.equal(res.headers.has('ETag'), false);
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});

test('signed session endpoint returns verified identity and rejects writes', async () => {
  const e = assetEnvironment();
  const res = await handleRequest(request('https://seo.layr.co.jp/tools/ltori-seo/session.json', await token(), {headers: {'Cf-Access-Authenticated-User-Email': 'forged@example.test'}}), e, verify);
  assert.deepEqual(Object.keys(await res.clone().json()).sort(), ['email', 'expiresAt', 'legacy', 'managerOrigin']);
  assert.equal((await res.json()).email, 'operator@example.test'); assert.equal(e.requests.length, 0);
  assert.equal((await handleRequest(request('https://seo.layr.co.jp/', await token(), {method: 'POST'}), e, verify)).status, 405);
});

test('legacy public URLs preserve same-origin migration while dedicated aliases redirect', async () => {
  const e = assetEnvironment();
  const migration = await handleRequest(request('https://layr.co.jp/tools/ltori-seo/', await token()), e, verify);
  assert.equal(migration.status, 200); assert.equal(migration.headers.get('Location'), null);
  assert.equal(await migration.text(), 'asset:/tools/ltori-seo/migrate/');
  assert.equal(new URL(e.requests[0].url).origin, 'https://layr.co.jp');
  const r = await handleRequest(request('https://seo.layr.co.jp/tools/ltori-seo/', await token()), e, verify);
  assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), 'https://seo.layr.co.jp/regional/');
});

test('public LPs stay public and are not duplicated under seo host', async () => {
  for (const path of ['/service/ltori/area/mie/nabari/', '/service/ltori/area/mie/toba/', '/service/ltori/area/wakayama/hashimoto/', '/sitemap-index.xml', '/contact/']) {
    const e = assetEnvironment();
    assert.equal((await handleRequest(request(`https://layr.co.jp${path}`), e, verify)).status, 200);
    assert.equal((await handleRequest(request(`https://seo.layr.co.jp${path}`, await token()), e, verify)).status, 404);
    assert.equal(e.requests.length, 1);
  }
});

test('asset auth runs first and both manager pages stay outside sitemap', () => {
  const configFile = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(configFile, /"run_worker_first": true/);
  assert.match(configFile, /"main": "worker\/index.mjs"/);
  const map = readFileSync(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(map, /tools\/ltori-seo|seo\.layr/);
});

test('media manager and its encoded or HTML aliases require authentication', async () => {
  for (const path of ['/media/', '/media', '/media/index.html', '/media.html', '/%6dedia/', '/%256dedia/', '/tools/ltori-seo/media/', '/tools%2fltori-seo%2fmedia%2f']) {
    const e = assetEnvironment();
    const res = await handleRequest(request(`https://seo.layr.co.jp${path}`), e, verify);
    assert.equal(res.status, 401, path);
    assert.equal(e.requests.length, 0);
  }
  for (const host of ['preview.example.test', 'layr-hp.example.workers.dev']) {
    const e = assetEnvironment();
    assert.equal((await handleRequest(request(`https://${host}/tools/ltori-seo/media/`, await token()), e, verify)).status, 403);
    assert.equal(e.requests.length, 0);
  }
});

test('signed media route rewrites only to protected HTML and preserves secure headers', async () => {
  const e = assetEnvironment();
  const res = await handleRequest(request('https://seo.layr.co.jp/media/?period=test', await token()), e, verify);
  assert.equal(await res.text(), 'asset:/tools/ltori-seo/media/');
  assert.equal(new URL(e.requests[0].url).search, '');
  assert.match(res.headers.get('Cache-Control'), /no-store/);
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(res.headers.has('ETag'), false);
  const head = assetEnvironment();
  await handleRequest(request('https://seo.layr.co.jp/media/', await token(), {method: 'HEAD'}), head, verify);
  assert.equal(head.requests[0].method, 'HEAD');
  const write = assetEnvironment();
  assert.equal((await handleRequest(request('https://seo.layr.co.jp/media/', await token(), {method: 'POST'}), write, verify)).status, 405);
  assert.equal(write.requests.length, 0);
});

test('media aliases redirect after authentication and public media remains public', async () => {
  for (const path of ['/media', '/media/index.html', '/media.html', '/tools/ltori-seo/media/', '/tools/ltori-seo/media', '/tools/ltori-seo/media/index.html', '/tools/ltori-seo/media.html']) {
    const e = assetEnvironment();
    const res = await handleRequest(request(`https://seo.layr.co.jp${path}`, await token()), e, verify);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('Location'), 'https://seo.layr.co.jp/media/');
    assert.equal(e.requests.length, 0);
  }
  const e = assetEnvironment();
  assert.equal(await (await handleRequest(request('https://layr.co.jp/tools/ltori-seo/media/', await token()), e, verify)).text(), 'asset:/tools/ltori-seo/migrate/');
  assert.equal(await (await handleRequest(request('https://layr.co.jp/service/ltori/media/'), e, verify)).text(), 'asset:/service/ltori/media/');
  assert.equal((await handleRequest(request('https://seo.layr.co.jp/service/ltori/media/', await token()), e, verify)).status, 404);
});


test('workspace routes and HTML aliases preserve authentication and exact project mapping', async () => {
  for (const [route, asset] of [['regional', '/tools/ltori-seo/'], ['articles', '/tools/ltori-seo/articles/'], ['strategy', '/tools/ltori-seo/strategy/'], ['growth', '/tools/ltori-seo/growth/'], ['backlinks', '/tools/ltori-seo/backlinks/'], ['regulation', '/tools/ltori-seo/regulation/']]) {
    for (const alias of [`/${route}/`, `/${route}`, `/${route}.html`, `/${route}/index.html`, `/tools/ltori-seo/${route}/`]) {
      const anonymous = assetEnvironment();
      assert.equal((await handleRequest(request(`https://seo.layr.co.jp${alias}`), anonymous, verify)).status, 401);
      assert.equal(anonymous.requests.length, 0);
      const signed = assetEnvironment(), res = await handleRequest(request(`https://seo.layr.co.jp${alias}`, await token()), signed, verify);
      if (alias === `/${route}/`) assert.equal(await res.text(), `asset:${asset}`);
      else {assert.equal(res.status, 302); assert.equal(res.headers.get('Location'), `https://seo.layr.co.jp/${route}/`);}
    }
    const publicLegacy = assetEnvironment();
    const res = await handleRequest(request(`https://layr.co.jp/tools/ltori-seo/${route}/`, await token()), publicLegacy, verify);
    assert.equal(res.status, 200); assert.equal(res.headers.get('Location'), null);
    assert.equal(await res.text(), 'asset:/tools/ltori-seo/migrate/');
    assert.equal(new URL(publicLegacy.requests[0].url).origin, 'https://layr.co.jp');
  }
  for (const alias of ['/overview/', '/overview', '/overview.html', '/overview/index.html', '/index.html', '/tools/ltori-seo/overview/']) {
    const e = assetEnvironment(), res = await handleRequest(request(`https://seo.layr.co.jp${alias}`, await token()), e, verify);
    assert.equal(res.headers.get('Location'), 'https://seo.layr.co.jp/');
  }
});
