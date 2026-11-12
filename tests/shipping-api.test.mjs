// Tests for functions/api/shipping.js (Shipping page API: the last AfterShip results, the tracking list, Refresh now).
// Run: node tests/shipping-api.test.mjs. Workers KV and AfterShip are stand-ins; nothing leaves the machine.
import assert from 'node:assert/strict';
import { memoryKv, fakeAfterShip, NUMBERS } from './aftership-fixtures.mjs';
import { onRequest } from '../functions/api/shipping.js';
import { WANTED_KEY, INDEX_KEY, REFRESH_KEY, MAX_EXPORT } from '../shared/aftership.mjs';

const ORIGIN = 'https://kpi.example.test';
const SECRET = 'very-secret-aftership-key';
const env = (extra = {}) => ({ REPORT_STORE: memoryKv(), ...extra });
const asEnv = (extra = {}) => env({ AFTERSHIP_API_KEY: SECRET, ...extra });
function call(e, { method = 'GET', body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  return onRequest({ request: new Request(ORIGIN + '/api/shipping', { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: h }), env: e, params: {} });
}
// Every AfterShip request in these tests goes to the stand-in.
async function withAs(fx, fn) {
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
  const offBody = await off.json();
  assert.deepEqual([offBody.configured, offBody.store], [false, false]);
  const del = await call(env(), { method: 'DELETE' });
  assert.equal(del.status, 405);
  assert.equal(del.headers.get('allow'), 'GET, PUT, POST');
});

test('GET before any check: empty results, configured = the AfterShip key is set, the 2-hour schedule', async () => {
  const res = await call(env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const data = await res.json();
  assert.deepEqual(data, { configured: false, store: true, active: false, polledAt: '', source: '', statuses: {}, errors: [], lastError: null, wanted: { exportAsOf: '', export: [], manual: [], updatedAt: '' }, refreshAfter: '', schedule: '0 */2 * * *', everyHours: 2 });
  assert.equal((await (await call(asEnv())).json()).configured, true);
});

test('GET shows only AfterShip results (an old FedEx index is ignored); active when a check ran in the last 6 hours', async () => {
  const e = env();
  await e.REPORT_STORE.put(INDEX_KEY, JSON.stringify({ v: 1, polledAt: new Date().toISOString(), statuses: { X: { stage: 'inTransit' } } }));
  const old = await (await call(e)).json();
  assert.deepEqual([old.polledAt, old.statuses, old.active], ['', {}, false]);
  const recent = new Date(Date.now() - 3600e3).toISOString();
  await e.REPORT_STORE.put(INDEX_KEY, JSON.stringify({ v: 2, provider: 'aftership', polledAt: recent, source: 'cron', statuses: { [NUMBERS.transit]: { state: 'transit' } }, errors: [] }));
  const got = await (await call(e)).json();
  assert.deepEqual([got.polledAt, got.active, got.configured, got.statuses[NUMBERS.transit].state], [recent, true, false, 'transit']);
});

test('only the dashboard page itself can change the list or ask for a check', async () => {
  const e = asEnv();
  const body = { asOf: '2026-10-08', export: [NUMBERS.transit], manual: [] };
  for (const origin of ['https://evil.example', '']) {
    assert.equal((await put(e, body, { origin })).status, 403);
    assert.equal((await call(e, { method: 'POST', origin })).status, 403);
  }
  assert.equal(e.REPORT_STORE.map.size, 0);
});

test('the tracking list: numbers cleaned and de-duplicated, carriers kept when obvious, unchanged lists cost no KV write', async () => {
  const e = env();
  const res = await put(e, { asOf: '2026-10-08', export: ['7700 1234 5678', '770012345678', 'not a number!', NUMBERS.delivered], manual: ['1234-567-890'], carriers: { '770012345678': 'FedEx', [NUMBERS.delivered]: 'Day & Ross', '1234567890': 'UPS', '999999999999': 'UPS' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { saved: true, keptNewerExport: false, exportAsOf: '2026-10-08', export: 2, manual: 1 });
  const saved = e.REPORT_STORE.json(WANTED_KEY);
  assert.deepEqual([saved.export, saved.manual], [['770012345678', NUMBERS.delivered], ['1234567890']]);
  assert.deepEqual(saved.carriers, { '770012345678': 'FedEx', '1234567890': 'UPS' }, 'unknown carriers and unlisted numbers are dropped');
  assert.ok(saved.updatedAt);
  const writes = e.REPORT_STORE.puts.length;
  const same = await put(e, { asOf: '2026-10-08', export: [NUMBERS.delivered, '770012345678'], manual: ['1234567890'], carriers: { '1234567890': 'UPS', '770012345678': 'FedEx' } });
  assert.equal((await same.json()).saved, false);
  assert.equal(e.REPORT_STORE.puts.length, writes, 'the same list in another order is not written again');
  assert.equal((await (await put(e, { asOf: '2026-10-08', export: [NUMBERS.delivered, '770012345678'], manual: ['1234567890'] })).json()).saved, true, 'a carrier change is saved');
});

test('an older export never replaces a newer export\'s numbers, but hand-added numbers still update', async () => {
  const e = env();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit], manual: [], carriers: { [NUMBERS.transit]: 'FedEx' } });
  const old = await (await put(e, { asOf: '2026-09-30', export: [NUMBERS.failed], manual: [NUMBERS.exception] })).json();
  assert.equal(old.keptNewerExport, true);
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).export, [NUMBERS.transit]);
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).carriers, { [NUMBERS.transit]: 'FedEx' });
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).manual, [NUMBERS.exception]);
  await put(e, { asOf: '2026-10-09', export: [NUMBERS.failed], manual: [] });
  assert.deepEqual([e.REPORT_STORE.json(WANTED_KEY).exportAsOf, e.REPORT_STORE.json(WANTED_KEY).export, e.REPORT_STORE.json(WANTED_KEY).manual], ['2026-10-09', [NUMBERS.failed], []]);
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

test('Refresh now without the AfterShip key is a 503 and asks AfterShip nothing', async () => {
  const e = env();
  const fx = fakeAfterShip();
  const res = await withAs(fx, () => call(e, { method: 'POST' }));
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.configured, false);
  assert.match(data.error, /AFTERSHIP_API_KEY/);
  assert.equal(fx.calls.length, 0);
  assert.ok(!e.REPORT_STORE.map.has(REFRESH_KEY));
});

test('Refresh now checks AfterShip, GET then shows the results; a second refresh within 10 minutes is refused', async () => {
  const e = asEnv();
  const fx = fakeAfterShip({ known: [NUMBERS.transit, NUMBERS.exception, NUMBERS.failed] });
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit, NUMBERS.exception], manual: [NUMBERS.failed] });
  const res = await withAs(fx, () => call(e, { method: 'POST' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(Object.keys(data.statuses).sort(), [NUMBERS.transit, NUMBERS.exception, NUMBERS.failed].sort());
  assert.equal(data.statuses[NUMBERS.failed].state, 'delayed');
  assert.ok(Date.parse(data.refreshAfter) > Date.now());
  assert.equal(e.REPORT_STORE.ttl[REFRESH_KEY], 600);
  assert.equal(e.REPORT_STORE.json(INDEX_KEY).source, 'refresh');

  const got = await (await call(e)).json();
  assert.equal(got.polledAt, data.polledAt);
  assert.equal(got.active, true);
  assert.equal(got.statuses[NUMBERS.exception].detail, 'Customs clearance delay');
  assert.equal(got.refreshAfter, data.refreshAfter);

  const before = fx.calls.length;
  const again = await withAs(fx, () => call(e, { method: 'POST' }));
  assert.equal(again.status, 429);
  assert.ok(Number(again.headers.get('retry-after')) > 0 && Number(again.headers.get('retry-after')) <= 600);
  assert.match((await again.json()).error, /less than 10 minutes ago/);
  assert.equal(fx.calls.length, before, 'the refused refresh asked AfterShip nothing');

  // 11 minutes later it is allowed again.
  await e.REPORT_STORE.put(REFRESH_KEY, new Date(Date.now() - 11 * 60 * 1000).toISOString());
  assert.equal((await withAs(fx, () => call(e, { method: 'POST' }))).status, 200);
  for (const text of [JSON.stringify(data), JSON.stringify(got), JSON.stringify([...e.REPORT_STORE.map.values()])]) {
    assert.ok(!text.includes(SECRET), 'the key is never returned or stored');
  }
  assert.ok(fx.calls.every((c) => c.key === SECRET));
});

test('a refused AfterShip key: 502 with the reason, and the last results stay', async () => {
  const e = asEnv();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit], manual: [] });
  await withAs(fakeAfterShip({ known: [NUMBERS.transit] }), () => call(e, { method: 'POST' }));
  await e.REPORT_STORE.delete(REFRESH_KEY);
  const res = await withAs(fakeAfterShip({ known: [NUMBERS.transit], status: () => 401 }), () => call(e, { method: 'POST' }));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /refused the API key/);
  assert.ok(!JSON.stringify(body).includes(SECRET));
  const got = await (await call(e)).json();
  assert.equal(got.statuses[NUMBERS.transit].state, 'transit');
  assert.match(got.lastError.message, /refused the API key/);
});

test('a failed Refresh now holds the slot for 1 minute only and says when it works again', async () => {
  const e = asEnv();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit], manual: [] });
  const before = Date.now();
  const res = await withAs(fakeAfterShip({ status: () => 401 }), () => call(e, { method: 'POST' }));
  assert.equal(res.status, 502);
  const body = await res.json();
  const after = Date.parse(body.refreshAfter);
  assert.ok(after >= before + 59000 && after <= Date.now() + 61000, 'refreshAfter is about a minute away');
  assert.equal(e.REPORT_STORE.ttl[REFRESH_KEY], 60, 'the hold expires on its own after a minute');
  const soon = await withAs(fakeAfterShip(), () => call(e, { method: 'POST' }));
  assert.equal(soon.status, 429);
  assert.match((await soon.json()).error, /Refresh now was used less than 10 minutes ago\. Try again in 1 min\./);
  assert.ok(Number(soon.headers.get('retry-after')) <= 60);
  assert.equal((await (await call(e)).json()).refreshAfter, body.refreshAfter);
  // A minute later (the key has expired) it checks AfterShip and takes the full 10 minutes.
  await e.REPORT_STORE.delete(REFRESH_KEY);
  const ok = await withAs(fakeAfterShip(), () => call(e, { method: 'POST' }));
  assert.equal(ok.status, 200);
  assert.equal(e.REPORT_STORE.ttl[REFRESH_KEY], 600);
  assert.ok(Date.parse((await ok.json()).refreshAfter) > Date.now() + 9 * 60000);
});

test('Refresh now keeps to the per-check budget and says how many are left for the next checks', async () => {
  const e = asEnv();
  const many = Array.from({ length: 75 }, (_, i) => String(880000000000 + i));
  await put(e, { asOf: '2026-10-08', export: many, manual: [] });
  const fx = fakeAfterShip();
  const data = await (await withAs(fx, () => call(e, { method: 'POST' }))).json();
  assert.deepEqual([data.count, data.polled, data.created, data.waiting], [75, 40, 40, 35]);
  assert.equal(fx.calls.length, 40);
});

test('the export date must be a real date at most two days ahead; a future date already stored cannot freeze the list', async () => {
  const e = env();
  for (const asOf of ['9999-12-31', '2026-02-30', '1999-12-31', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)]) {
    const res = await put(e, { asOf, export: [NUMBERS.transit], manual: [] });
    assert.equal(res.status, 400, asOf);
  }
  assert.equal(e.REPORT_STORE.map.size, 0);
  await e.REPORT_STORE.put(WANTED_KEY, JSON.stringify({ v: 1, exportAsOf: '9999-12-31', export: [], manual: [] }));
  const res = await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit, NUMBERS.failed], manual: [] });
  assert.deepEqual(await res.json(), { saved: true, keptNewerExport: false, exportAsOf: '2026-10-08', export: 2, manual: 0 });
  assert.deepEqual(e.REPORT_STORE.json(WANTED_KEY).export, [NUMBERS.transit, NUMBERS.failed]);
});

test('KV read failures: GET still answers (no Refresh limit), a list change is refused without writing', async () => {
  const e = asEnv();
  await put(e, { asOf: '2026-10-08', export: [NUMBERS.transit], manual: [] });
  const stored = e.REPORT_STORE.map.get(WANTED_KEY);
  const realGet = e.REPORT_STORE.get;
  e.REPORT_STORE.get = async () => { throw new Error('KV GET failed: 503'); };
  const got = await call(e);
  assert.equal(got.status, 200);
  const data = await got.json();
  assert.deepEqual([data.configured, data.refreshAfter, data.statuses], [true, '', {}]);
  const writes = e.REPORT_STORE.puts.length;
  const res = await put(e, { asOf: '2026-10-09', export: [], manual: [] });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /could not be read/);
  assert.equal(e.REPORT_STORE.puts.length, writes);
  assert.equal(e.REPORT_STORE.map.get(WANTED_KEY), stored);
  e.REPORT_STORE.get = realGet;
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
