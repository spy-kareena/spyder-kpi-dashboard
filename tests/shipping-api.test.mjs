// Tests for functions/api/shipping.js (Shipping page API: last FedEx results, the tracking list, Refresh now).
// Run: node tests/shipping-api.test.mjs. Workers KV and FedEx are stand-ins; nothing leaves the machine.
import assert from 'node:assert/strict';
import { memoryKv, fakeFedex, NUMBERS } from './fedex-fixtures.mjs';
import { onRequest } from '../functions/api/shipping.js';
import { WANTED_KEY, INDEX_KEY, REFRESH_KEY, MAX_EXPORT } from '../shared/fedex.mjs';

const ORIGIN = 'https://kpi.example.test';
const SECRET = 'very-secret-fedex-value';
const env = (extra = {}) => ({ REPORT_STORE: memoryKv(), ...extra });
const fedexEnv = (extra = {}) => env({ FEDEX_CLIENT_ID: 'client-id-123', FEDEX_CLIENT_SECRET: SECRET, ...extra });
function call(e, { method = 'GET', body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  return onRequest({ request: new Request(ORIGIN + '/api/shipping', { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: h }), env: e, params: {} });
}
// Every FedEx request in these tests goes to the stand-in.
async function withFedex(fx, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fx.fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const put = (e, body, opts) => call(e, { method: 'PUT', body, ...opts });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('without KV the API says it is not set up; other methods are refused', async () => {
  const off = await call({});
  assert.equal(off.status, 503);
  assert.equal((await off.json()).configured, false);
  const del = await call(env(), { method: 'DELETE' });
  assert.equal(del.status, 405);
  assert.equal(del.headers.get('allow'), 'GET, PUT, POST');
});

test('GET before any check: empty results, whether FedEx keys are set, and the schedule', async () => {
  const res = await call(env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const data = await res.json();
  assert.deepEqual(data, { configured: true, fedex: false, polledAt: '', source: '', statuses: {}, errors: [], lastError: null, wanted: { exportAsOf: '', export: [], manual: [], updatedAt: '' }, refreshAfter: '', schedule: '0 */4 * * *' });
  assert.equal((await (await call(fedexEnv())).json()).fedex, true);
});

test('only the dashboard page itself can change the list or ask for a check', async () => {
  const e = fedexEnv();
  const body = { asOf: '2026-10-08', export: [NUMBERS.parcel], manual: [] };
  for (const origin of ['https://evil.example', '']) {
    assert.equal((await put(e, body, { origin })).status, 403);
    assert.equal((await call(e, { method: 'POST', origin })).status, 403);
  }
  assert.equal(e.REPORT_STORE.map.size, 0);
});

test('the tracking list: numbers cleaned and de-duplicated, saved once, unchanged lists cost no KV write', async () => {
  const e = env();
  const res = await put(e, { asOf: '2026-10-08', export: ['7700 1234 5678', '770012345678', 'not a number!', NUMBERS.delivered], manual: ['1234-567-890'] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { saved: true, keptNewerExport: false, exportAsOf: '2026-10-08', export: 2, manual: 1 });
  const saved = e.REPORT_STORE.json(WANTED_KEY);
  assert.deepEqual([saved.export, saved.manual], [['770012345678', NUMBERS.delivered], ['1234567890']]);
  assert.ok(saved.updatedAt);
  const writes = e.REPORT_STORE.puts.length;
  const same = await put(e, { asOf: '2026-10-08', export: [NUMBERS.delivered, '770012345678'], manual: ['1234567890'] });
  assert.equal((await same.json()).saved, false);
  assert.equal(e.REPORT_STORE.puts.length, writes, 'the same list in another order is not written again');
});

test('an older export never replaces a newer export\'s numbers, but hand-added numbers still update', async () => {
  const e = env();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.parcel], manual: [] });
  const old = await (await put(e, { asOf: '2026-09-30', export: [NUMBERS.freight], manual: [NUMBERS.exception] })).json();
  assert.equal(old.keptNewerExport, true);
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).export, [NUMBERS.parcel]);
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).manual, [NUMBERS.exception]);
  await put(e, { asOf: '2026-10-09', export: [NUMBERS.freight], manual: [] });
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY), { ...e.REPORT_STORE.json(WANTED_KEY), exportAsOf: '2026-10-09', export: [NUMBERS.freight], manual: [] });
});

test('bad lists are refused and nothing is stored; long lists are capped', async () => {
  const e = env();
  for (const body of ['{oops', { export: [], manual: [] }, { asOf: '10/08/2026', export: [], manual: [] }, { asOf: '2026-10-08', export: 'x', manual: [] }]) {
    assert.equal((await put(e, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await put(e, { asOf: '2026-10-08', export: Array(2001).fill('770012345678'), manual: [] })).status, 413);
  assert.equal((await put(e, 'x', { headers: { 'content-length': String(70 * 1024) } })).status, 413);
  assert.equal(e.REPORT_STORE.map.size, 0);
  const many = Array.from({ length: 700 }, (_, i) => String(880000000000 + i));
  await put(e, { asOf: '2026-10-08', export: many, manual: [] });
  assert.equal(e.REPORT_STORE.json(WANTED_KEY).export.length, MAX_EXPORT);
  assert.equal(e.REPORT_STORE.json(WANTED_KEY).export[0], many[0], 'the newest (first) numbers are kept');
});

test('Refresh now without FedEx keys is a 503 and asks FedEx nothing', async () => {
  const e = env();
  const fx = fakeFedex();
  const res = await withFedex(fx, () => call(e, { method: 'POST' }));
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.fedex, false);
  assert.match(data.error, /FEDEX_CLIENT_ID/);
  assert.equal(fx.calls.length, 0);
  assert.ok(!e.REPORT_STORE.map.has(REFRESH_KEY));
});

test('Refresh now checks FedEx, GET then shows the results; a second refresh within 10 minutes is refused', async () => {
  const e = fedexEnv();
  const fx = fakeFedex();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.parcel, NUMBERS.customsDelay], manual: [NUMBERS.freight] });
  const res = await withFedex(fx, () => call(e, { method: 'POST' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(Object.keys(data.statuses).sort(), [NUMBERS.parcel, NUMBERS.customsDelay, NUMBERS.freight].sort());
  assert.equal(data.statuses[NUMBERS.freight].carrier, 'FedEx Freight');
  assert.ok(Date.parse(data.refreshAfter) > Date.now());
  assert.equal(e.REPORT_STORE.ttl[REFRESH_KEY], 600);
  assert.equal(e.REPORT_STORE.json(INDEX_KEY).source, 'refresh');

  const got = await (await call(e)).json();
  assert.equal(got.polledAt, data.polledAt);
  assert.equal(got.statuses[NUMBERS.customsDelay].customsState, 'delay');
  assert.equal(got.refreshAfter, data.refreshAfter);

  const again = await withFedex(fx, () => call(e, { method: 'POST' }));
  assert.equal(again.status, 429);
  assert.ok(Number(again.headers.get('retry-after')) > 0 && Number(again.headers.get('retry-after')) <= 600);
  assert.match((await again.json()).error, /less than 10 minutes ago/);
  assert.equal(fx.calls.filter((c) => c.kind === 'track').length, 1, 'the refused refresh asked FedEx nothing');

  // 11 minutes later it is allowed again.
  await e.REPORT_STORE.put(REFRESH_KEY, new Date(Date.now() - 11 * 60 * 1000).toISOString());
  assert.equal((await withFedex(fx, () => call(e, { method: 'POST' }))).status, 200);
  for (const text of [JSON.stringify(data), JSON.stringify(got)]) {
    assert.ok(!text.includes(SECRET) && !text.includes('tok-'), 'no key or token is ever returned');
  }
});

test('a refused FedEx key: 502 with the reason, and the last results stay', async () => {
  const e = fedexEnv();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.parcel], manual: [] });
  await withFedex(fakeFedex(), () => call(e, { method: 'POST' }));
  await e.REPORT_STORE.delete(REFRESH_KEY);
  const res = await withFedex(fakeFedex({ tokenStatus: 401 }), () => call(e, { method: 'POST' }));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /refused the API key/);
  assert.ok(!JSON.stringify(body).includes(SECRET));
  const got = await (await call(e)).json();
  assert.equal(got.statuses[NUMBERS.parcel].stage, 'inTransit');
  assert.match(got.lastError.message, /refused the API key/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
