// Tests for functions/_middleware.js (Cloudflare Pages password gate). Run: node tests/middleware.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
// The Pages function is an ES module in a .js file; load its source as a module from a data: URL.
const source = readFileSync(join(here, '..', 'functions', '_middleware.js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const PASSWORD = 'correct horse battery';
const SESSION_SECRET = 's'.repeat(40);
const ENV = { DASHBOARD_PASSWORD: PASSWORD, SESSION_SECRET };
const ORIGIN = 'https://kpi.example.test';
const STATIC_BODY = 'STATIC ASSET';

async function call(path, { method = 'GET', cookie, form, body, headers = {}, env = ENV } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.Cookie = cookie;
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    init.body = body;
  }
  const request = new Request(ORIGIN + path, init);
  return onRequest({ request, env, next: async () => new Response(STATIC_BODY, { status: 200, headers: { 'content-type': 'text/plain' } }) });
}
// A refused session gets the login page, never the protected content.
const refused = async (res) => res.status !== 302 && !(await res.clone().text()).includes(STATIC_BODY) && /Sign in/.test(await res.text());
const setCookies = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie') || '']);
const sessionCookie = (res) => {
  const value = (setCookies(res)[0] || '').split(';')[0];
  return value.endsWith('=') ? '' : value;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('missing password or session secret fails closed on every path', async () => {
  for (const env of [{}, { DASHBOARD_PASSWORD: PASSWORD }, { SESSION_SECRET }]) {
    for (const path of ['/', '/logout', '/queries/x.sql']) {
      const res = await call(path, { env });
      assert.equal(res.status, 500);
    }
  }
});

test('login page is shown without a session', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /action="\/login"/);
});

test('correct password issues a signed session that opens the site', async () => {
  const login = await call('/login', { method: 'POST', form: { password: PASSWORD } });
  assert.equal(login.status, 302);
  const [setCookie, legacy] = setCookies(login);
  assert.match(setCookie, /^__Host-spyder_kpi_session=v1\.\d+\.[\w-]+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  assert.match(legacy, /^spyder_kpi_auth=; Path=\/;.*Max-Age=0$/, 'the 1v0 password-hash cookie is cleared');
  const page = await call('/', { cookie: sessionCookie(login) });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), STATIC_BODY);
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
});

test('only POST /login accepts the password', async () => {
  const res = await call('/', { method: 'POST', form: { password: PASSWORD } });
  assert.notEqual(res.status, 302);
  assert.ok(await refused(res));
});

test('a session forged with the password alone is refused', async () => {
  const body = `v1.${Math.floor(Date.now() / 1000)}.nonce`;
  const sig = createHmac('sha256', PASSWORD).update(body).digest('base64url');
  assert.ok(await refused(await call('/', { cookie: `__Host-spyder_kpi_session=${body}.${sig}` })));
});

test('changing DASHBOARD_PASSWORD signs everyone out', async () => {
  const login = await call('/login', { method: 'POST', form: { password: PASSWORD } });
  const cookie = sessionCookie(login);
  assert.equal((await call('/', { cookie })).status, 200);
  assert.ok(await refused(await call('/', { cookie, env: { ...ENV, DASHBOARD_PASSWORD: 'new password' } })));
});

test('wrong password is rejected after a delay', async () => {
  const started = Date.now();
  const res = await call('/login', { method: 'POST', form: { password: 'nope' } });
  assert.equal(res.status, 401);
  assert.ok(Date.now() - started >= 900, 'failed logins are slowed down');
});

test('the cookie is not the password hash, and a forged or tampered token is refused', async () => {
  const forged = createHash('sha256').update(PASSWORD).digest('hex');
  assert.ok(await refused(await call('/', { cookie: `__Host-spyder_kpi_session=${forged}` })));
  const login = await call('/login', { method: 'POST', form: { password: PASSWORD } });
  const good = sessionCookie(login);
  const tampered = good.replace(/\.(\d+)\./, (m, t) => `.${Number(t) + 1}.`);
  assert.ok(await refused(await call('/', { cookie: tampered })));
});

test('rotating SESSION_SECRET signs everyone out', async () => {
  const env = { DASHBOARD_PASSWORD: PASSWORD, SESSION_SECRET: 'a'.repeat(40) };
  const login = await call('/login', { method: 'POST', form: { password: PASSWORD }, env });
  const cookie = sessionCookie(login);
  assert.equal((await call('/', { cookie, env })).status, 200);
  assert.ok(await refused(await call('/', { cookie, env: { ...env, SESSION_SECRET: 'b'.repeat(40) } })));
});

test('expired sessions are refused', async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 15 * 24 * 60 * 60 * 1000;
    const login = await call('/login', { method: 'POST', form: { password: PASSWORD } });
    Date.now = realNow;
    assert.ok(await refused(await call('/', { cookie: sessionCookie(login) })));
  } finally {
    Date.now = realNow;
  }
});

test('non-form POSTs and malformed cookies do not throw', async () => {
  const json = await call('/login', { method: 'POST', body: '{"password":"x"}', headers: { 'content-type': 'application/json' } });
  assert.equal(json.status, 400);
  const empty = await call('/login', { method: 'POST' });
  assert.equal(empty.status, 400);
  assert.ok(await refused(await call('/', { cookie: '__Host-spyder_kpi_session=%E0' })));
});

test('the sign-in logo under /assets/ is served without a session (GET and HEAD)', async () => {
  for (const method of ['GET', 'HEAD']) {
    const res = await call('/assets/spyder-logo.jpg', { method });
    assert.equal(res.status, 200, method);
    if (method === 'GET') assert.equal(await res.text(), STATIC_BODY, 'the file itself, not the sign-in page');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(setCookies(res).filter(Boolean).length, 0, 'no cookie is set for a public file');
  }
});

test('only plain file names directly under /assets/ skip the sign-in (no traversal, no other methods)', async () => {
  const paths = ['/assets/', '/assets', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/..%2Findex.html', '/assets/%2E%2E%2Findex.html',
    '/assets/sub/logo.jpg', '/assets/.hidden', '/assets/a..jpg', '/assets/logo.jpg/', '/assetsx/logo.jpg', '/ASSETS/spyder-logo.jpg', '/index.html?f=/assets/spyder-logo.jpg', '/api/report?x=/assets/a.jpg'];
  for (const path of paths) {
    const res = await call(path);
    if (path.startsWith('/api/')) { assert.equal(res.status, 401, path); continue; }
    assert.ok(await refused(res), `${path} must need a session`);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.ok(await refused(await call('/assets/spyder-logo.jpg', { method })), method);
  }
});

test('login page: logo, welcome message, footer, password autocomplete; no error before a try', async () => {
  const res = await call('/');
  const page = await res.text();
  assert.equal(res.status, 200);
  assert.match(page, /<img class="logo" src="\/assets\/spyder-logo\.jpg" alt="Spyder Controls"/);
  assert.match(page, /<h1>Welcome back<\/h1>/);
  assert.ok(page.includes("Sign in to see this week's order health, purchase orders and build risk."));
  assert.ok(page.includes('Internal use · Spyder Controls'));
  assert.match(page, /<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>/);
  assert.match(page, /<button type="submit">Sign in<\/button>/);
  assert.ok(!/role="alert"|autofocus aria-invalid/.test(page), 'no error state');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a wrong password shows an inline error tied to the field (401); an unreadable form says so (400)', async () => {
  const wrong = await call('/login', { method: 'POST', form: { password: 'nope' } });
  assert.equal(wrong.status, 401);
  const page = await wrong.text();
  assert.match(page, /autocomplete="current-password" required autofocus aria-invalid="true" aria-describedby="password-error">/);
  assert.match(page, /<p class="error" id="password-error" role="alert"><svg[^>]*aria-hidden="true">[\s\S]*?<\/svg>That password is not correct\. Try again\.<\/p>/);
  const bad = await call('/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /The sign-in form could not be read\. Try again\./);
});

test('assets/spyder-logo.jpg holds exactly the logo embedded in index.html (LOGO_SRC)', () => {
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  const m = html.match(/const LOGO_SRC='data:image\/jpeg;base64,([A-Za-z0-9+/=]+)'/);
  assert.ok(m, 'index.html keeps its inline logo for Share snapshot');
  const file = readFileSync(join(here, '..', 'assets', 'spyder-logo.jpg'));
  assert.ok(file.equals(Buffer.from(m[1], 'base64')), 'same bytes');
  assert.equal(file.subarray(0, 3).toString('hex'), 'ffd8ff', 'a JPEG file, matching its .jpg name');
});

test('logout clears the session and the legacy cookie', async () => {
  const res = await call('/logout');
  assert.equal(res.status, 302);
  const cookies = setCookies(res);
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((c) => /Max-Age=0/.test(c)));
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 5).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
