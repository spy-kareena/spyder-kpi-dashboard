// Tests for the scheduled Worker in workers/shipping-poller (FedEx check every 4 hours) and its wrangler.toml.
// Run: node tests/shipping-worker.test.mjs. fetch and Workers KV are stand-ins; nothing leaves the machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryKv, fakeFedex, NUMBERS } from './fedex-fixtures.mjs';
import worker, { runCheck } from '../workers/shipping-poller/index.mjs';
import { WANTED_KEY, INDEX_KEY } from '../shared/fedex.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(here, '..', 'workers', 'shipping-poller', 'wrangler.toml'), 'utf8');
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
    await worker.scheduled({ cron: '0 */4 * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
  } finally { globalThis.fetch = real; }
  await Promise.all(waits);
  return waits;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('scheduled() checks the wanted numbers with mocked FedEx and saves the results for the page', async () => {
  const env = { REPORT_STORE: memoryKv({ [WANTED_KEY]: { v: 1, exportAsOf: '2026-10-08', export: [NUMBERS.parcel, NUMBERS.delivered], manual: [NUMBERS.exception] } }), FEDEX_CLIENT_ID: 'id', FEDEX_CLIENT_SECRET: 'secret' };
  const fx = fakeFedex();
  const waits = await scheduled(env, fx);
  assert.equal(waits.length, 1, 'the check is kept alive with waitUntil');
  const index = env.REPORT_STORE.json(INDEX_KEY);
  assert.equal(index.source, 'cron');
  assert.equal(index.count, 3);
  assert.equal(index.statuses[NUMBERS.exception].stage, 'exception');
  assert.equal(index.statuses[NUMBERS.delivered].stage, 'delivered');
  assert.ok(fx.calls.every((c) => c.url.startsWith('https://apis.fedex.com/')), 'production FedEx by default');
  assert.ok(logs.some((l) => /checked 3 tracking numbers \(3 asked FedEx\)/.test(l)));
});

test('without FedEx keys or KV it skips quietly and writes nothing', async () => {
  const kv = memoryKv();
  const fx = fakeFedex();
  await scheduled({ REPORT_STORE: kv }, fx);
  assert.equal(kv.puts.length, 0);
  assert.equal(fx.calls.length, 0);
  assert.equal(await runCheck({}), 'skipped: no REPORT_STORE');
  assert.equal(await runCheck({ REPORT_STORE: kv }), 'skipped: no FedEx keys');
});

test('a FedEx failure fails the run (shown in Cloudflare) and leaves the reason for the page', async () => {
  const env = { REPORT_STORE: memoryKv({ [WANTED_KEY]: { export: [NUMBERS.parcel] } }), FEDEX_CLIENT_ID: 'id', FEDEX_CLIENT_SECRET: 'secret' };
  await assert.rejects(scheduled(env, fakeFedex({ tokenStatus: 403 })), /refused the API key/);
  assert.match(env.REPORT_STORE.json(INDEX_KEY).lastError.message, /refused the API key/);
});

test('the Worker serves no page', async () => {
  const res = await worker.fetch(new Request('https://spyder-shipping-poller.example/'));
  assert.equal(res.status, 404);
});

test('wrangler.toml: name, entry, date, 4-hourly cron, REPORT_STORE binding, no public URL, no secrets', () => {
  assert.match(toml, /^name = "spyder-shipping-poller"$/m);
  assert.match(toml, /^main = "index.mjs"$/m);
  assert.match(toml, /^compatibility_date = "2026-10-01"$/m);
  assert.match(toml, /^\[triggers\][\s\S]*?^crons = \["0 \*\/4 \* \* \*"\]$/m);
  assert.match(toml, /^\[\[kv_namespaces\]\]\nbinding = "REPORT_STORE"\nid = "[^"]+"$/m);
  assert.match(toml, /^workers_dev = false$/m);
  assert.doesNotMatch(toml, /^FEDEX_CLIENT_(ID|SECRET)\s*=/m);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); say(`ok   ${t.name}`); }
  catch (err) { failed++; say(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
say(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
