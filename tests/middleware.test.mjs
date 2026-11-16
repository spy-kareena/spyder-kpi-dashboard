// Tests for functions/_middleware.js (Cloudflare Pages password gate). Run: node tests/middleware.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
// The Pages function is an ES module in a .js file; load its source as a module from a data: URL.
const source = readFileSync(join(here, '..', 'functions', '_middleware.js'), 'utf8');
const { onRequest, resetAccessKeys, nameFromEmail, teamOrigin } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const meSource = readFileSync(join(here, '..', 'functions', 'api', 'me.js'), 'utf8');
const me = await import('data:text/javascript;base64,' + Buffer.from(meSource).toString('base64'));

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
    const res = await call('/assets/spyder-logo.png', { method });
    assert.equal(res.status, 200, method);
    if (method === 'GET') assert.equal(await res.text(), STATIC_BODY, 'the file itself, not the sign-in page');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(setCookies(res).filter(Boolean).length, 0, 'no cookie is set for a public file');
  }
});

test('only the exact logo path skips the sign-in (no traversal, no other methods)', async () => {
  const paths = ['/assets/', '/assets', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/..%2Findex.html', '/assets/%2E%2E%2Findex.html',
    '/assets/sub/logo.jpg', '/assets/.hidden', '/assets/a..jpg', '/assets/logo.jpg/', '/assetsx/logo.jpg', '/ASSETS/spyder-logo.png', '/index.html?f=/assets/spyder-logo.png', '/api/report?x=/assets/a.jpg'];
  for (const path of paths) {
    const res = await call(path);
    if (path.startsWith('/api/')) { assert.equal(res.status, 401, path); continue; }
    assert.ok(await refused(res), `${path} must need a session`);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.ok(await refused(await call('/assets/spyder-logo.png', { method })), method);
  }
});

test('any other name under /assets/ needs a session: the static server is never asked (Pages would answer index.html)', async () => {
  for (const path of ['/assets/does-not-exist', '/assets/x.html', '/assets/index', '/assets/spyder-logo.jpg', '/assets/spyder-logo.png.html', '/assets/Spyder-logo.png']) {
    for (const method of ['GET', 'HEAD']) {
      let nextCalled = false;
      const res = await onRequest({ request: new Request(ORIGIN + path, { method }), env: ENV, next: async () => { nextCalled = true; return new Response(STATIC_BODY); } });
      assert.equal(nextCalled, false, `${method} ${path} must not reach the static files`);
      assert.equal(res.status, 200, `${method} ${path}`);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      if (method === 'GET') assert.match(await res.text(), /Sign in/);
    }
  }
});

test('login page: logo, title, footer, password autocomplete; no error before a try', async () => {
  const res = await call('/');
  const page = await res.text();
  assert.equal(res.status, 200);
  assert.match(page, /<img class="logo[^"]*"[^>]* src="\/assets\/spyder-logo\.png" alt="Spyder Controls"/);
  assert.match(page, /<h1[^>]*>Sign in to the KPI dashboard<\/h1>/);
  assert.ok(page.includes("Enter the team password to see this week's order health, purchase orders and build risk."));
  assert.ok(page.includes('Internal use · Spyder Controls'));
  assert.match(page, /<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>/);
  assert.match(page, /<button class="submit[^"]*"[^>]* type="submit"><span class="label">Sign in<svg[^>]*aria-hidden="true">/);
  assert.ok(!/role="alert"|autofocus aria-invalid|class="card failed"/.test(page), 'no error state');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('login form: posts the password field to /login, labelled, with an accessible show-password toggle and busy status', async () => {
  const page = await (await call('/')).text();
  const form = page.match(/<form method="post" action="\/login">([\s\S]*?)<\/form>/);
  assert.ok(form, 'one POST form to /login');
  assert.equal((form[1].match(/ name="/g) || []).length, 1, 'the password is the only named field');
  assert.match(form[1], /<label[^>]* for="password">Password<\/label>/);
  assert.match(form[1], /<button class="reveal" type="button" aria-label="Show password" aria-pressed="false" aria-controls="password">/);
  assert.match(form[1], /<p class="sr-only" id="signin-status" role="status"><\/p>/);
  assert.match(form[1], /<span class="busy" aria-hidden="true">/);
  assert.ok(!/<script[^>]+src=/i.test(page), 'no external scripts');
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/);
  assert.match(page, /@media \(prefers-color-scheme:dark\)/);
});

test('a wrong password shows an inline error tied to the field (401); an unreadable form says so (400)', async () => {
  const wrong = await call('/login', { method: 'POST', form: { password: 'nope' } });
  assert.equal(wrong.status, 401);
  const page = await wrong.text();
  assert.match(page, /autocomplete="current-password" required autofocus aria-invalid="true" aria-describedby="password-error">/);
  assert.match(page, /<p class="error" id="password-error" role="alert"><svg[^>]*aria-hidden="true">[\s\S]*?<\/svg>That password didn't work\. Try again\.<\/p>/);
  assert.match(page, /<main class="card failed">/, 'the card plays its shake once');
  assert.match(page, /<form method="post" action="\/login">/, 'the form is shown again');
  const bad = await call('/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  const badPage = await bad.text();
  assert.match(badPage, /role="alert"><svg[^>]*>[\s\S]*?<\/svg>The sign-in form could not be read\. Try again\.<\/p>/);
});

test('assets/spyder-logo.png holds exactly the logo embedded in index.html (LOGO_SRC)', () => {
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  const m = html.match(/const LOGO_SRC='data:image\/png;base64,([A-Za-z0-9+/=]+)'/);
  assert.ok(m, 'index.html keeps its inline logo for Share snapshot');
  const file = readFileSync(join(here, '..', 'assets', 'spyder-logo.png'));
  assert.ok(file.equals(Buffer.from(m[1], 'base64')), 'same bytes');
  assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG file, matching its .png name');
});

test('logout clears the session and the legacy cookie', async () => {
  const res = await call('/logout');
  assert.equal(res.status, 302);
  const cookies = setCookies(res);
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((c) => /Max-Age=0/.test(c)));
  assert.equal(res.headers.get('Location'), ORIGIN + '/', 'without Cloudflare Access, back to the sign-in page');
});

// ---- Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD) ----
// A real RSA key pair per "Cloudflare" key id, a fake JWKS served by a stubbed fetch for <team>/cdn-cgi/access/certs,
// and tokens signed here. Addresses are made up.
const subtle = globalThis.crypto.subtle;
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
async function rsaKey(kid) {
  const pair = await subtle.generateKey(RSA, true, ['sign', 'verify']);
  const { n, e } = await subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n, e } };
}
const [KEY_A, KEY_B, IMPOSTOR] = await Promise.all([rsaKey('kid-a'), rsaKey('kid-b'), rsaKey('kid-a')]); // IMPOSTOR: same kid, other key
const AUD = 'a'.repeat(64);
const TEAM = 'https://kpi-test.cloudflareaccess.com';
const ACCESS_ENV = { ACCESS_TEAM_DOMAIN: 'kpi-test', ACCESS_AUD: AUD };
const BOTH_ENV = { ...ENV, ...ACCESS_ENV };
const EMAIL = 'jamie.rivera@example.test';
const jwks = new Map([[TEAM, [KEY_A.jwk, KEY_B.jwk]]]); // team origin -> its published keys
const certFetches = [];
globalThis.fetch = async (input) => {
  const url = String(input && input.url ? input.url : input);
  const m = url.match(/^(https:\/\/[^/]+)\/cdn-cgi\/access\/certs$/);
  if (!m) throw new Error(`unexpected fetch ${url}`);
  certFetches.push(m[1]);
  if (!jwks.has(m[1])) return new Response('unavailable', { status: 503 });
  return new Response(JSON.stringify({ keys: jwks.get(m[1]), public_cert: { kid: 'x', cert: '-----BEGIN CERTIFICATE-----' } }), { headers: { 'content-type': 'application/json' } });
};
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
async function jwt(claims = {}, { key = KEY_A, header = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = b64({ aud: [AUD], iss: TEAM, email: EMAIL, sub: 'user-1', type: 'app', iat: now, nbf: now, exp: now + 3600, ...claims });
  const sig = Buffer.from(await subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, Buffer.from(`${head}.${body}`))).toString('base64url');
  return `${head}.${body}.${sig}`;
}
// One request through the middleware; `then` (optional) is the function behind it, given the same context.
async function visit(path, { method = 'GET', token, cookie, env = ACCESS_ENV, form, then } = {}) {
  const headers = {};
  if (token) headers['Cf-Access-Jwt-Assertion'] = token;
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (form) { init.body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  const context = { request: new Request(ORIGIN + path, init), env, data: {}, params: {}, nextCalls: 0 };
  context.next = async () => { context.nextCalls++; return then ? then(context) : new Response(STATIC_BODY, { status: 200 }); };
  const res = await onRequest(context);
  return { res, context };
}
async function accessRefusedPage(res, context) {
  assert.equal(res.status, 403);
  assert.equal(context.nextCalls, 0, 'nothing behind the gate runs');
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const page = await res.text();
  assert.ok(!page.includes(STATIC_BODY));
  assert.ok(page.includes('This board signs in through Cloudflare Access. Reload the page to sign in.'));
  assert.ok(!page.includes('action="/login"'), 'no password form');
  return page;
}
async function apiRefused(res, context) {
  assert.equal(res.status, 401);
  assert.equal(context.nextCalls, 0);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.equal((await res.json()).error.code, 401);
}

test('Access settings: the team domain in any of its three forms; names made from email addresses', () => {
  for (const v of ['kpi-test', 'kpi-test.cloudflareaccess.com', 'https://kpi-test.cloudflareaccess.com', 'https://kpi-test.cloudflareaccess.com/', ' KPI-Test ']) {
    assert.equal(teamOrigin(v), TEAM, v);
  }
  for (const v of ['', 'http://kpi-test.cloudflareaccess.com', 'https://kpi-test.cloudflareaccess.com/cdn-cgi', 'https://kpi-test.cloudflareaccess.com:8443', 'kpi test', 'https://user@kpi-test.cloudflareaccess.com']) {
    assert.equal(teamOrigin(v), '', JSON.stringify(v));
  }
  assert.equal(nameFromEmail('aaron.joseph@example.test'), 'Aaron Joseph');
  assert.equal(nameFromEmail('aaron@example.test'), 'Aaron');
  assert.equal(nameFromEmail('MARY_ANN-smith+kpi@example.test'), 'Mary Ann Smith');
  assert.equal(nameFromEmail('j.doe2@example.test'), 'J Doe');
  assert.equal(nameFromEmail('12345@example.test'), '', 'no letters, no name');
  assert.ok(nameFromEmail(`${'abcdefghij.'.repeat(8)}x@example.test`).length <= 40);
});

test('Access only: a valid token opens the site and names the person for the functions behind', async () => {
  const { res, context } = await visit('/', { token: await jwt() });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), STATIC_BODY);
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.deepEqual(context.data.user, { email: EMAIL, name: 'Jamie Rivera', via: 'access' });
  assert.deepEqual(context.data.auth, { access: true, password: false });
  // The aud claim may be a plain string, and ACCESS_AUD may list several tags.
  const other = 'b'.repeat(64);
  const { res: res2 } = await visit('/api/notes', { token: await jwt({ aud: other }), env: { ...ACCESS_ENV, ACCESS_AUD: `${AUD}, ${other}` } });
  assert.equal(res2.status, 200);
  // An email in capitals is kept in lower case.
  const { context: c3 } = await visit('/', { token: await jwt({ email: 'Aaron@Example.Test' }) });
  assert.deepEqual(c3.data.user, { email: 'aaron@example.test', name: 'Aaron', via: 'access' });
});

test('Access: the CF_Authorization cookie is used when the header is missing', async () => {
  const { res, context } = await visit('/api/report', { cookie: `theme=dark; CF_Authorization=${await jwt()}` });
  assert.equal(res.status, 200);
  assert.equal(context.data.user.email, EMAIL);
});

test('Access: missing, foreign, expired, forged or unsigned tokens are refused (403 page; 401 JSON under /api/)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const [h, p] = (await jwt()).split('.');
  const hs256 = (() => {
    const head = b64({ alg: 'HS256', kid: 'kid-a', typ: 'JWT' });
    const sig = createHmac('sha256', KEY_A.jwk.n).update(`${head}.${p}`).digest('base64url');
    return `${head}.${p}.${sig}`;
  })();
  const bad = {
    missing: undefined,
    'wrong aud': await jwt({ aud: ['c'.repeat(64)] }),
    'no aud': await jwt({ aud: undefined }),
    'wrong iss': await jwt({ iss: 'https://other-team.cloudflareaccess.com' }),
    'iss with a trailing slash': await jwt({ iss: TEAM + '/' }),
    expired: await jwt({ exp: now - 120 }),
    'no exp': await jwt({ exp: undefined }),
    'nbf in the future': await jwt({ nbf: now + 300 }),
    'iat in the future': await jwt({ iat: now + 300 }),
    'bad signature (other key, same kid)': await jwt({}, { key: IMPOSTOR }),
    'tampered claims': `${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'boss@example.test' })}.${(await jwt()).split('.')[2]}`,
    'alg none': `${b64({ alg: 'none', kid: 'kid-a' })}.${p}.`,
    'alg none with a signature': `${b64({ alg: 'none', kid: 'kid-a' })}.${p}.${(await jwt()).split('.')[2]}`,
    HS256: hs256,
    // Validly RSA-signed, but the header names another algorithm: only RS256 is taken.
    'header alg none (RSA-signed)': await jwt({}, { header: { alg: 'none' } }),
    'header alg HS256 (RSA-signed)': await jwt({}, { header: { alg: 'HS256' } }),
    'header alg RS512 (RSA-signed)': await jwt({}, { header: { alg: 'RS512' } }),
    'no kid': await jwt({}, { header: { kid: undefined } }),
    'no email or service name': await jwt({ email: undefined }),
    'not an email': await jwt({ email: 'nobody' }),
    garbage: 'not-a-token',
    'two parts': `${h}.${p}`,
    'bad base64': `${h}.${p}.***`,
  };
  for (const [name, token] of Object.entries(bad)) {
    const page = await visit('/', { token });
    try { await accessRefusedPage(page.res, page.context); } catch (err) { err.message = `${name}: ${err.message}`; throw err; }
    const api = await visit('/api/notes', { token });
    try { await apiRefused(api.res, api.context); } catch (err) { err.message = `${name} (api): ${err.message}`; throw err; }
  }
  // Inside the 60 s allowance for clock skew is still fine.
  assert.equal((await visit('/', { token: await jwt({ exp: now - 30, nbf: now + 30, iat: now + 30 }) })).res.status, 200);
  // A token in the header is the one checked: a valid cookie does not rescue a bad header.
  const both = new Request(ORIGIN + '/', { headers: { 'Cf-Access-Jwt-Assertion': bad.expired, Cookie: `CF_Authorization=${await jwt()}` } });
  assert.equal((await onRequest({ request: both, env: ACCESS_ENV, data: {}, next: async () => new Response(STATIC_BODY) })).status, 403);
});

test('Access refusal page: the sign-in look, a Reload link back to the same address (escaped), no logo', async () => {
  const { res, context } = await visit('/index.html?tab="x"&y=<b>');
  const page = await accessRefusedPage(res, context);
  assert.match(page, /<title>Sign in · Spyder KPI Dashboard<\/title>/);
  assert.match(page, /<main class="card">/);
  assert.match(page, /<a class="submit st" style="--i:3" href="\/index\.html\?tab=%22x%22&amp;y=%3Cb%3E"><span class="label">Reload<svg/);
  assert.ok(!page.includes('spyder-logo.png'), 'the logo needs the token too, so it is left out');
  assert.match(page, /@media \(prefers-color-scheme:dark\)/);
  assert.ok(page.includes('Internal use · Spyder Controls'));
});

test('Access: signing keys are cached; an unknown key id fetches once more (throttled); the cache expires after an hour', async () => {
  const team = 'https://rotate-test.cloudflareaccess.com';
  const env = { ACCESS_TEAM_DOMAIN: 'rotate-test.cloudflareaccess.com', ACCESS_AUD: AUD };
  const fetches = () => certFetches.filter((t) => t === team).length;
  jwks.set(team, [KEY_A.jwk]);
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    resetAccessKeys();
    assert.equal((await visit('/', { env, token: await jwt({ iss: team }) })).res.status, 200);
    assert.equal((await visit('/', { env, token: await jwt({ iss: team }) })).res.status, 200);
    assert.equal(fetches(), 1, 'one fetch, then the cached keys');
    // Cloudflare rotates: a token signed with the new key makes one more fetch and is taken.
    jwks.set(team, [KEY_A.jwk, KEY_B.jwk]);
    assert.equal((await visit('/', { env, token: await jwt({ iss: team }, { key: KEY_B }) })).res.status, 200);
    assert.equal(fetches(), 2);
    // A made-up key id right after: refused without another fetch.
    const ghost = await jwt({ iss: team }, { header: { kid: 'kid-ghost' } });
    assert.equal((await visit('/', { env, token: ghost })).res.status, 403);
    assert.equal(fetches(), 2, 'throttled');
    clock += 11 * 1000;
    assert.equal((await visit('/', { env, token: ghost })).res.status, 403);
    assert.equal(fetches(), 3, 'after the pause, one more try');
    // An hour later the keys are fetched again; if that fetch fails the keys held stay in use.
    clock += 61 * 60 * 1000;
    jwks.delete(team);
    assert.equal((await visit('/', { env, token: await jwt({ iss: team }, { key: KEY_B }) })).res.status, 200);
    assert.equal(fetches(), 4);
    assert.equal((await visit('/', { env, token: await jwt({ iss: team }, { key: KEY_B }) })).res.status, 200);
    assert.equal(fetches(), 4, 'a failed refresh is not retried on every request');
  } finally {
    Date.now = realNow;
  }
});

test('Access: with no keys (the certs address fails), every request is refused and fetches are throttled', async () => {
  const team = 'https://down-test.cloudflareaccess.com';
  const env = { ACCESS_TEAM_DOMAIN: 'down-test', ACCESS_AUD: AUD };
  const before = certFetches.filter((t) => t === team).length;
  resetAccessKeys();
  const token = await jwt({ iss: team });
  await accessRefusedPage(...Object.values(await visit('/', { env, token })));
  await accessRefusedPage(...Object.values(await visit('/', { env, token })));
  assert.equal(certFetches.filter((t) => t === team).length - before, 1);
  // Expired or foreign tokens are refused before any key is fetched.
  resetAccessKeys();
  const teamFetches = certFetches.filter((t) => t === TEAM).length;
  assert.equal((await visit('/', { token: await jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) })).res.status, 403);
  assert.equal((await visit('/', { token: await jwt({ aud: 'c'.repeat(64) }) })).res.status, 403);
  assert.equal(certFetches.filter((t) => t === TEAM).length, teamFetches);
});

test('Access: a service token (no email, a common_name) is let through as a service client', async () => {
  const { res, context } = await visit('/api/history', { token: await jwt({ email: undefined, sub: '', common_name: 'abc123.access' }) });
  assert.equal(res.status, 200);
  assert.deepEqual(context.data.user, { service: 'abc123.access', via: 'access-service' });
});

test('Access only: no password page anywhere; the logo also needs the token', async () => {
  const token = await jwt();
  for (const path of ['/', '/login', '/index.html']) {
    const { res } = await visit(path, { token });
    assert.equal(await res.text(), STATIC_BODY, path);
  }
  const { res: post, context } = await visit('/login', { method: 'POST', token, form: { password: 'anything' } });
  assert.equal(context.nextCalls, 1, 'POST /login is not handled here');
  assert.equal(setCookies(post).filter(Boolean).length, 0, 'no password session is ever issued');
  const logo = await visit('/assets/spyder-logo.png');
  await accessRefusedPage(logo.res, logo.context);
  assert.equal((await visit('/assets/spyder-logo.png', { token })).res.status, 200);
});

test('Access and password together: both an Access token and a password session are needed', async () => {
  const token = await jwt();
  // Token, no session: the password page (and 401 under /api/); the logo for that page is served.
  const page = await visit('/', { env: BOTH_ENV, token });
  assert.equal(page.res.status, 200);
  assert.match(await page.res.text(), /action="\/login"/);
  assert.equal(page.context.nextCalls, 0);
  await apiRefused(...Object.values(await visit('/api/notes', { env: BOTH_ENV, token })));
  assert.equal((await visit('/assets/spyder-logo.png', { env: BOTH_ENV, token })).res.status, 200);
  // Signing in with the password needs the token too.
  const noToken = await visit('/login', { method: 'POST', env: BOTH_ENV, form: { password: PASSWORD } });
  await accessRefusedPage(noToken.res, noToken.context);
  assert.equal(setCookies(noToken.res).filter(Boolean).length, 0);
  const login = await visit('/login', { method: 'POST', env: BOTH_ENV, token, form: { password: PASSWORD } });
  assert.equal(login.res.status, 302);
  const cookie = sessionCookie(login.res);
  // Session, no token: refused. Both: in, named by the token.
  await accessRefusedPage(...Object.values(await visit('/', { env: BOTH_ENV, cookie })));
  const inside = await visit('/', { env: BOTH_ENV, token, cookie });
  assert.equal(await inside.res.text(), STATIC_BODY);
  assert.deepEqual(inside.context.data.user, { email: EMAIL, name: 'Jamie Rivera', via: 'access' });
  assert.deepEqual(inside.context.data.auth, { access: true, password: true });
});

test('password only: the functions behind get {via:"password"} and no name', async () => {
  const login = await call('/login', { method: 'POST', form: { password: PASSWORD } });
  const { res, context } = await visit('/', { env: ENV, cookie: sessionCookie(login) });
  assert.equal(res.status, 200);
  assert.deepEqual(context.data.user, { via: 'password' });
  assert.deepEqual(context.data.auth, { access: false, password: true });
  // An Access token alone means nothing while Access is off.
  assert.ok(await refused((await visit('/', { env: ENV, token: await jwt() })).res));
});

test('half-configured or unknown settings fail closed with a 500 that names what is missing', async () => {
  const cases = [
    [{ ...ENV, ACCESS_TEAM_DOMAIN: 'kpi-test' }, /ACCESS_AUD/],
    [{ ...ENV, ACCESS_AUD: AUD }, /ACCESS_TEAM_DOMAIN/],
    [{ ACCESS_TEAM_DOMAIN: 'kpi-test' }, /ACCESS_AUD/],
    [{ ...ACCESS_ENV, ACCESS_TEAM_DOMAIN: 'http://kpi-test.cloudflareaccess.com' }, /ACCESS_TEAM_DOMAIN must look like/],
    [{ ...ACCESS_ENV, ACCESS_AUD: ' , ' }, /ACCESS_AUD/],
    [{ ...ACCESS_ENV, DASHBOARD_PASSWORD: PASSWORD }, /SESSION_SECRET/],
    [{ SESSION_SECRET }, /ACCESS_TEAM_DOMAIN and ACCESS_AUD .*DASHBOARD_PASSWORD and SESSION_SECRET/],
  ];
  for (const [env, message] of cases) {
    for (const path of ['/', '/logout', '/api/me']) {
      const { res, context } = await visit(path, { env, token: await jwt() });
      assert.equal(res.status, 500, `${JSON.stringify(env)} ${path}`);
      assert.match(await res.text(), message);
      assert.equal(context.nextCalls, 0);
    }
  }
});

test('/api/me: who is signed in and which sign-in is on, in each mode', async () => {
  const ask = async (opts) => {
    const { res } = await visit('/api/me', { ...opts, then: (ctx) => me.onRequest(ctx) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return res.json();
  };
  const person = { email: EMAIL, name: 'Jamie Rivera' };
  assert.deepEqual(await ask({ token: await jwt() }), { v: 1, auth: { access: true, password: false }, user: person, logoutUrl: '/logout' });
  const login = await visit('/login', { method: 'POST', env: BOTH_ENV, token: await jwt(), form: { password: PASSWORD } });
  assert.deepEqual(await ask({ env: BOTH_ENV, token: await jwt(), cookie: sessionCookie(login.res) }), { v: 1, auth: { access: true, password: true }, user: person, logoutUrl: '/logout' });
  const pw = await call('/login', { method: 'POST', form: { password: PASSWORD } });
  assert.deepEqual(await ask({ env: ENV, cookie: sessionCookie(pw) }), { v: 1, auth: { access: false, password: true }, user: null, logoutUrl: '/logout' });
  assert.deepEqual(await ask({ token: await jwt({ email: undefined, common_name: 'abc123.access' }) }), { v: 1, auth: { access: true, password: false }, user: null, logoutUrl: '/logout' });
  // Only GET; and never past the gate without a sign-in.
  const post = await visit('/api/me', { method: 'POST', token: await jwt(), then: (ctx) => me.onRequest(ctx) });
  assert.equal(post.res.status, 405);
  await apiRefused(...Object.values(await visit('/api/me', { then: (ctx) => me.onRequest(ctx) })));
});

test('/logout with Access on clears the password session and goes to Cloudflare Access sign-out', async () => {
  for (const env of [ACCESS_ENV, BOTH_ENV]) {
    const { res, context } = await visit('/logout', { env, token: await jwt() });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), ORIGIN + '/cdn-cgi/access/logout');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const cookies = setCookies(res);
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((c) => /Max-Age=0/.test(c)));
    assert.equal(context.nextCalls, 0);
  }
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 5).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
