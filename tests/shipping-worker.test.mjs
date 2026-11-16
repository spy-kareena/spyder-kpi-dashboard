// Tests for the scheduled Worker in workers/shipping-poller (AfterShip check every 2 hours) and its wrangler.toml.
// Run: node tests/shipping-worker.test.mjs. fetch and Workers KV are stand-ins; nothing leaves the machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryKv, fakeAfterShip, NUMBERS } from './aftership-fixtures.mjs';
import worker, { runCheck } from '../workers/shipping-poller/index.mjs';
import { WANTED_KEY, INDEX_KEY, SCHEDULE } from '../shared/aftership.mjs';
import { onRequest as shippingApi } from '../functions/api/shipping.js';

const here = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(here, '..', 'workers', 'shipping-poller', 'wrangler.toml'), 'utf8');
const readme = readFileSync(join(here, '..', 'workers', 'shipping-poller', 'README.md'), 'utf8');
const quiet = { log: console.log, warn: console.warn };
const logs = [];
console.log = (...a) => logs.push(a.join(' '));
console.warn = (...a) => logs.push(a.join(' '));
const say = (line) => quiet.log(line);

async function scheduled(env, fx) {
  const real = globalThis.fetch;
  globalThis.fetch = fx.fetch;
  const waits = [];
  try {
    await worker.scheduled({ cron: '0 */2 * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
  } finally { globalThis.fetch = real; }
  await Promise.all(waits);
  return waits;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('scheduled() checks the wanted numbers with a mocked AfterShip and saves the results for the page', async () => {
  const known = [NUMBERS.transit, NUMBERS.delivered, NUMBERS.exception];
  const env = { REPORT_STORE: memoryKv({ [WANTED_KEY]: { v: 1, exportAsOf: '2026-10-08', export: [NUMBERS.transit, NUMBERS.delivered], manual: [NUMBERS.exception] } }), AFTERSHIP_API_KEY: 'key' };
  const fx = fakeAfterShip({ known });
  const waits = await scheduled(env, fx);
  assert.equal(waits.length, 1, 'the check is kept alive with waitUntil');
  const index = env.REPORT_STORE.json(INDEX_KEY);
  assert.deepEqual([index.source, index.count, index.provider], ['cron', 3, 'aftership']);
  assert.equal(index.statuses[NUMBERS.exception].state, 'delayed');
  assert.equal(index.statuses[NUMBERS.delivered].state, 'delivered');
  assert.ok(fx.calls.every((c) => c.url.startsWith('https://api.aftership.com/tracking/2026-07/trackings')));
  assert.ok(logs.some((l) => /checked 3 tracking numbers \(3 read from AfterShip, 0 added\)/.test(l)), logs.join('\n'));
});

// 2v9 (owner): the page can tell whether the 2-hourly checks run (workerRunning), and says so when they do not.
test('each scheduled run is recorded as the Worker\'s last check (lastCronAt); the API then says the Worker runs', async () => {
  const kv = memoryKv({ [WANTED_KEY]: { v: 1, exportAsOf: '2026-10-08', export: [NUMBERS.transit], manual: [] } });
  const env = { REPORT_STORE: kv, AFTERSHIP_API_KEY: 'key' };
  const get = async () => (await shippingApi({ request: new Request('https://kpi.example.test/api/shipping'), env, params: {} })).json();
  const before = await get();
  assert.deepEqual([before.lastCronAt, before.workerRunning], ['', false], 'not run yet');
  await scheduled(env, fakeAfterShip({ known: [NUMBERS.transit] }));
  const index = kv.json(INDEX_KEY);
  assert.equal(index.lastCronAt, index.polledAt);
  const after = await get();
  assert.deepEqual([after.source, after.lastCronAt, after.workerRunning], ['cron', index.polledAt, true]);
  // Its last run more than 2 h 30 min ago (one run missed): not running.
  await kv.put(INDEX_KEY, JSON.stringify({ ...index, polledAt: new Date(Date.now() - 600e3).toISOString(), source: 'auto', lastCronAt: new Date(Date.now() - 151 * 60e3).toISOString() }));
  assert.equal((await get()).workerRunning, false);
});

test('without the AfterShip key or KV it skips quietly and writes nothing', async () => {
  const kv = memoryKv();
  const fx = fakeAfterShip();
  await scheduled({ REPORT_STORE: kv }, fx);
  assert.equal(kv.puts.length, 0);
  assert.equal(fx.calls.length, 0);
  assert.equal(await runCheck({}), 'skipped: no REPORT_STORE');
  assert.equal(await runCheck({ REPORT_STORE: kv }), 'skipped: no AfterShip key');
});

test('a refused key fails the run (shown in Cloudflare) and leaves the reason for the page', async () => {
  const env = { REPORT_STORE: memoryKv({ [WANTED_KEY]: { export: [NUMBERS.transit] } }), AFTERSHIP_API_KEY: 'key' };
  await assert.rejects(scheduled(env, fakeAfterShip({ status: () => 401 })), /refused the API key/);
  assert.match(env.REPORT_STORE.json(INDEX_KEY).lastError.message, /refused the API key/);
});

test('the Worker serves no page', async () => {
  const res = await worker.fetch(new Request('https://spyder-shipping-poller.example/'));
  assert.equal(res.status, 404);
});

test('wrangler.toml: name, entry, date, 2-hourly cron (same as the page and the API), REPORT_STORE, no URL, no secrets', () => {
  assert.match(toml, /^name = "spyder-shipping-poller"$/m);
  assert.match(toml, /^main = "index.mjs"$/m);
  assert.match(toml, /^compatibility_date = "2026-10-01"$/m);
  assert.match(toml, /^\[triggers\][\s\S]*?^crons = \["0 \*\/2 \* \* \*"\]$/m);
  assert.equal(SCHEDULE, '0 */2 * * *');
  assert.match(toml, /^\[\[kv_namespaces\]\]\nbinding = "REPORT_STORE"\nid = "[^"]+"$/m);
  assert.match(toml, /^workers_dev = false$/m);
  assert.doesNotMatch(toml, /^AFTERSHIP_API_KEY\s*=/m);
  assert.doesNotMatch(toml + readme, /FEDEX|FedEx/);
  assert.match(readme, /npx wrangler secret put AFTERSHIP_API_KEY/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); say(`ok   ${t.name}`); }
  catch (err) { failed++; say(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
say(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
