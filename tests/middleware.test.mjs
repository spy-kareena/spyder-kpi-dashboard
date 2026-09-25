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
