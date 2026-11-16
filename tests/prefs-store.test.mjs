// Tests for functions/api/prefs.js (personal settings saved to each person's Cloudflare Access sign-in).
// Run: node tests/prefs-store.test.mjs. No network: the Pages function runs against a Map-backed Workers KV stand-in.
// Addresses are made up.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Imported by file URL: prefs.js imports ../../shared/admins.mjs.
const { onRequest, PERSONAL_KEYS, prefsKey } = await import(pathToFileURL(join(here, '..', 'functions', 'api', 'prefs.js')).href);

const ORIGIN = 'https://kpi.example.test';
const EMAIL = 'jamie.rivera@example.test';
const JAMIE = { user: { email: EMAIL, name: 'Jamie Rivera', via: 'access' }, auth: { access: true, password: false } };
const LEE = { user: { email: 'lee@example.test', name: 'Lee', via: 'access' }, auth: { access: true, password: false } };
const PASSWORD = { user: { via: 'password' }, auth: { access: false, password: true } };
const SERVICE = { user: { service: 'abc123.access', via: 'access-service' }, auth: { access: true, password: false } };
// Workers KV stand-in: get(key, {type:'json'|'text'}), put(key, string). Counts writes; failGets / failPuts make the
// next reads or writes throw, as a KV outage would.
function kv() {
  const map = new Map();
  const store = {
    map, puts: 0, failGets: 0, failPuts: 0,
    async get(k, opts = {}) {
      if (store.failGets > 0) { store.failGets--; throw new Error('KV read failed'); }
      if (!map.has(k)) return null;
      const text = map.get(k);
      const type = typeof opts === 'string' ? opts : opts.type || 'text';
      return type === 'json' ? JSON.parse(text) : text;
    },
    async put(k, v) {
      if (store.failPuts > 0) { store.failPuts--; throw new Error('KV write limit'); }
      store.puts++;
      map.set(k, String(v));
    },
    async delete(k) { map.delete(k); },
  };
  return store;
}
function call({ method = 'GET', body, env, origin = ORIGIN, data = JAMIE }) {
  const h = { 'content-type': 'application/json' };
  if (origin) h.Origin = origin;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return onRequest({ request: new Request(ORIGIN + '/api/prefs', init), env, params: {}, data });
}
const put = (env, prefs, extra = {}) => call({ method: 'PUT', env, body: { prefs }, ...extra });
const hex = (email) => createHash('sha256').update(email).digest('hex');
const FULL = {
  theme: 'dark', background: 'mint', christmas: 'off', linesShown: 20, openingView: 'lagging', poOpeningView: 'received',
  startPage: 'shipping', linesStart: 'open', importReport: 'always', dataSource: 'import', hiddenPages: ['monthly', 'warehouses'],
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('nothing saved yet: prefs null and savedAt blank; never cached', async () => {
  const res = await call({ env: { REPORT_STORE: kv() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { v: 1, prefs: null, savedAt: '' });
});

test('PUT then GET: the full personal set comes back, with when it was saved; the same set again writes nothing', async () => {
  const env = { REPORT_STORE: kv() };
  const before = Date.now();
  const res = await put(env, FULL);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const out = await res.json();
  assert.equal(out.v, 1);
  assert.equal(out.saved, true);
  assert.deepEqual(out.prefs, FULL);
  assert.ok(Date.parse(out.savedAt) >= before - 1000 && Date.parse(out.savedAt) <= Date.now());
  assert.equal(env.REPORT_STORE.puts, 1);
  assert.deepEqual(await (await call({ env })).json(), { v: 1, prefs: FULL, savedAt: out.savedAt });
  // POST is taken as PUT; the same set again is not written.
  const again = await call({ method: 'POST', env, body: { prefs: { ...FULL } } });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { v: 1, saved: true, prefs: FULL, savedAt: out.savedAt });
  assert.equal(env.REPORT_STORE.puts, 1);
  // A smaller set replaces the whole set (nothing is merged).
  const small = await (await put(env, { theme: 'system' })).json();
  assert.deepEqual(small.prefs, { theme: 'system' });
  assert.deepEqual((await (await call({ env })).json()).prefs, { theme: 'system' });
  assert.equal(env.REPORT_STORE.puts, 2);
});

test('KV key: prefs: + hex SHA-256 of the lower-case email; no address in the key; the value names the owner', async () => {
  const env = { REPORT_STORE: kv() };
  await put(env, { theme: 'dark' });
  const keys = [...env.REPORT_STORE.map.keys()];
  assert.deepEqual(keys, [`prefs:${hex(EMAIL)}`]);
  assert.match(keys[0], /^prefs:[0-9a-f]{64}$/);
  assert.ok(!keys[0].includes('jamie') && !keys[0].includes('@'));
  assert.equal(await prefsKey('  Jamie.Rivera@Example.TEST '), keys[0], 'capitals and spaces give the same key');
  const value = JSON.parse(env.REPORT_STORE.map.get(keys[0]));
  assert.deepEqual(Object.keys(value).sort(), ['email', 'prefs', 'savedAt', 'v']);
  assert.equal(value.email, EMAIL);
  assert.deepEqual(value.prefs, { theme: 'dark' });
  // Each person has their own settings.
  await put(env, { theme: 'light' }, { data: LEE });
  assert.equal(env.REPORT_STORE.map.size, 2);
  assert.deepEqual((await (await call({ env })).json()).prefs, { theme: 'dark' });
  assert.deepEqual((await (await call({ env, data: LEE })).json()).prefs, { theme: 'light' });
});

test('only personal keys are kept: team keys, unknown keys and nulls are dropped', async () => {
  const env = { REPORT_STORE: kv() };
  const sent = {
    ...FULL, atRiskTarget: 7, toleranceDays: 3, horizon: 'w6', otdGoalSales: 95, otdGoalVendors: 80,
    noteCommentsSo: ['Waiting on parts'], noteCommentsPo: ['Late vendor'], somethingElse: 'x', hiddenSupply2v69: true,
    christmas: null,
  };
  // Sent as text, so "__proto__" arrives as a key of its own.
  const body = JSON.stringify({ prefs: sent }).replace('{"theme"', '{"__proto__":{"polluted":true},"theme"');
  assert.ok(body.includes('"__proto__"'));
  const out = await (await call({ method: 'PUT', env, body })).json();
  const { christmas, ...expected } = FULL;
  assert.deepEqual(out.prefs, expected);
  assert.deepEqual(Object.keys(out.prefs), PERSONAL_KEYS.filter((k) => k !== 'christmas'), 'kept in a fixed order');
  const stored = JSON.parse([...env.REPORT_STORE.map.values()][0]).prefs;
  assert.deepEqual(stored, expected);
  assert.equal(({}).polluted, undefined);
  // Only team or unknown keys: an empty set is saved.
  assert.deepEqual((await (await put(env, { atRiskTarget: 9 })).json()).prefs, {});
  assert.deepEqual((await (await call({ env })).json()).prefs, {});
});

test('values: text, numbers, true / false or lists of texts; anything else is refused naming the key (400)', async () => {
  const env = { REPORT_STORE: kv() };
  assert.deepEqual((await (await put(env, { christmas: true, linesShown: 50, hiddenPages: [] })).json()).prefs, { christmas: true, linesShown: 50, hiddenPages: [] });
  const bad = [
    [{ theme: { dark: true } }, /theme/],
    [{ hiddenPages: ['monthly', 3] }, /hiddenPages/],
    [{ hiddenPages: Array(51).fill('x') }, /hiddenPages/],
    [{ background: 'x'.repeat(201) }, /background/],
    [{ startPage: [['nested']] }, /startPage/],
  ];
  for (const [prefs, message] of bad) {
    const res = await put(env, prefs);
    assert.equal(res.status, 400, JSON.stringify(prefs).slice(0, 60));
    const out = await res.json();
    assert.equal(out.error.code, 400);
    assert.match(out.error.message, message);
    assert.equal(out.saved, false);
  }
  // Infinity cannot be sent as JSON; a huge number is still a number.
  assert.equal((await put(env, { linesShown: 1e308 })).status, 200);
  assert.deepEqual((await (await call({ env })).json()).prefs, { linesShown: 1e308 });
});

test('bad JSON, not {prefs:{...}}, or too large: 400 and nothing is written', async () => {
  const env = { REPORT_STORE: kv() };
  for (const body of ['{nope', '[]', 'null', '"text"', JSON.stringify({ prefs: [] }), JSON.stringify({ prefs: 'dark' }), JSON.stringify({ theme: 'dark' }), JSON.stringify({ prefs: null })]) {
    const res = await call({ method: 'PUT', env, body });
    assert.equal(res.status, 400, body);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const out = await res.json();
    assert.equal(out.error.code, 400);
    assert.equal(typeof out.error.message, 'string');
  }
  // Over 16 KB of settings (each text is within its own limit), and a body over 64 KB.
  const many = await put(env, { theme: 't'.repeat(200), hiddenPages: Array(50).fill('é'.repeat(200)) });
  assert.equal(many.status, 400);
  assert.match((await many.json()).error.message, /16 KB/);
  const huge = await call({ method: 'PUT', env, body: JSON.stringify({ prefs: { theme: 'dark' }, pad: 'x'.repeat(70 * 1024) }) });
  assert.equal(huge.status, 400);
  assert.equal(env.REPORT_STORE.puts, 0);
});

test('no Access person: the shared password, a service token or no sign-in get 401 (GET and PUT); nothing is read or written', async () => {
  const env = { REPORT_STORE: kv() };
  await put(env, FULL);
  for (const data of [PASSWORD, SERVICE, null, {}, { user: { via: 'access', email: '' } }]) {
    for (const method of ['GET', 'PUT', 'POST']) {
      const res = await call({ method, env, data, body: method === 'GET' ? undefined : { prefs: { theme: 'light' } } });
      assert.equal(res.status, 401, `${JSON.stringify(data)} ${method}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await res.json()).error, { code: 401, message: 'Personal settings need the company sign-in.' });
    }
  }
  assert.equal(env.REPORT_STORE.puts, 1);
  // The same goes without storage: the sign-in is checked first.
  assert.equal((await call({ env: {}, data: PASSWORD })).status, 401);
});

test('no REPORT_STORE: 503 with prefs null (GET) or saved false (PUT); other methods 405; writes from another site 403', async () => {
  const get = await call({ env: {} });
  assert.equal(get.status, 503);
  assert.equal(get.headers.get('cache-control'), 'no-store');
  const g = await get.json();
  assert.equal(g.v, 1);
  assert.equal(g.prefs, null);
  assert.equal(g.error.code, 503);
  const p = await (await put({}, FULL)).json();
  assert.equal(p.saved, false);
  assert.equal(p.error.code, 503);
  for (const method of ['DELETE', 'PATCH']) {
    const r = await call({ method, env: { REPORT_STORE: kv() }, body: { prefs: FULL } });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'GET, PUT, POST');
  }
  const env = { REPORT_STORE: kv() };
  for (const origin of ['https://evil.example.test', null]) {
    const r = await put(env, FULL, { origin });
    assert.equal(r.status, 403, String(origin));
    assert.equal((await r.json()).error.code, 403);
  }
  assert.equal(env.REPORT_STORE.puts, 0);
});

test('Workers KV trouble: a failed read on GET is a 500; a busy write is tried again, then 429 with Retry-After', async () => {
  const env = { REPORT_STORE: kv() };
  env.REPORT_STORE.failGets = 1;
  const res = await call({ env });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).prefs, null);
  // A failed read before a PUT does not stop the save (the whole set is replaced).
  env.REPORT_STORE.failGets = 1;
  assert.equal((await put(env, { theme: 'dark' })).status, 200);
  env.REPORT_STORE.failPuts = 1;
  const retried = await put(env, { theme: 'light' });
  assert.equal(retried.status, 200);
  env.REPORT_STORE.failPuts = 2;
  const busy = await put(env, { theme: 'system' });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '2');
  assert.equal((await busy.json()).saved, false);
  assert.deepEqual((await (await call({ env })).json()).prefs, { theme: 'light' });
});

test('a stored value edited by hand: other keys and bad values are left out; another address\'s document counts as nothing', async () => {
  const env = { REPORT_STORE: kv() };
  const key = `prefs:${hex(EMAIL)}`;
  env.REPORT_STORE.map.set(key, JSON.stringify({ v: 1, email: EMAIL, prefs: { theme: 'dark', atRiskTarget: 9 }, savedAt: '2026-11-01T10:00:00.000Z' }));
  assert.deepEqual(await (await call({ env })).json(), { v: 1, prefs: { theme: 'dark' }, savedAt: '2026-11-01T10:00:00.000Z' });
  env.REPORT_STORE.map.set(key, JSON.stringify({ v: 1, email: 'someone.else@example.test', prefs: { theme: 'dark' }, savedAt: '2026-11-01T10:00:00.000Z' }));
  assert.deepEqual(await (await call({ env })).json(), { v: 1, prefs: null, savedAt: '' });
  env.REPORT_STORE.map.set(key, '"not a document"');
  assert.deepEqual(await (await call({ env })).json(), { v: 1, prefs: null, savedAt: '' });
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
