// Tests for the at-risk history: PUT /api/report with atRisk in the bundle header (functions/api/report.js) and
// GET /api/history (functions/api/history.js). Run: node tests/at-risk-history.test.mjs. No network: a Map-backed
// Workers KV stand-in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const load = async (file) => (await import('data:text/javascript;base64,' + Buffer.from(readFileSync(join(here, '..', 'functions', 'api', file), 'utf8')).toString('base64'))).onRequest;
const report = await load('report.js');
const history = await load('history.js');

const ORIGIN = 'https://kpi.example.test';
function kv() {
  const map = new Map();
  return {
    map,
    async get(k, opts = {}) {
      if (!map.has(k)) return null;
      const bytes = map.get(k);
      const type = typeof opts === 'string' ? opts : opts.type || 'text';
      if (type === 'arrayBuffer') return bytes.slice().buffer;
      const text = new TextDecoder().decode(bytes);
      return type === 'json' ? JSON.parse(text) : text;
    },
    async put(k, v) { map.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)); },
    async delete(k) { map.delete(k); },
  };
}
function bundle(atRisk, files = [{ name: 'kpi.xls', data: 'AAA' }]) {
  const parts = files.map((f) => Buffer.from(f.data));
  const head = Buffer.from(JSON.stringify({ v: 1, files: files.map((f, i) => ({ name: f.name, type: 'x', lastModified: 5, length: parts[i].length })), ...(atRisk === undefined ? {} : { atRisk }) }));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(head.length);
  return new Uint8Array(Buffer.concat([size, head, ...parts]));
}
const put = (env, atRisk, files) => report({ request: new Request(ORIGIN + '/api/report', { method: 'PUT', body: bundle(atRisk, files), headers: { Origin: ORIGIN } }), env, params: {} });
const getHistory = async (env, method = 'GET') => history({ request: new Request(ORIGIN + '/api/history', { method, headers: { Origin: ORIGIN } }), env, params: {} });
const weeks = async (env) => (await (await getHistory(env)).json()).weeks;
const key = (doc) => `Sales Order|${doc}|${doc}|0|SPY-100|Spyder - Lacombe`;
// Export dates from Monday 2025-10-06 onwards, one week apart.
const day = (i) => new Date(Date.UTC(2025, 9, 6) + i * 7 * 864e5).toISOString().slice(0, 10);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a saved report adds its at-risk lines to the history; the stored report does not carry them', async () => {
  const env = { REPORT_STORE: kv() };
  assert.deepEqual(await weeks(env), []);
  const res = await put(env, { asOf: '2026-09-03', keys: [key(1), key(2), key(2)] });
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.deepEqual(saved.history, { weeks: 1 });
  const list = await weeks(env);
  assert.equal(list.length, 1);
  assert.equal(list[0].asOf, '2026-09-03');
  assert.equal(list[0].savedAt, saved.savedAt);
  assert.deepEqual(list[0].keys, [key(1), key(2)], 'repeated keys are stored once');
  // GET /api/report hands back the bundle with only v, savedAt and files in its header.
  const back = new Uint8Array(await (await report({ request: new Request(ORIGIN + '/api/report'), env, params: {} })).arrayBuffer());
  const size = new DataView(back.buffer).getUint32(0);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(back.subarray(4, 4 + size)).toString())).sort(), ['files', 'savedAt', 'v']);
});

test('a report with the same export date replaces that week; an older export date is filed in date order', async () => {
  const env = { REPORT_STORE: kv() };
  await put(env, { asOf: '2026-09-10', keys: [key(1)] });
  await put(env, { asOf: '2026-09-10', keys: [key(1), key(3)] });
  assert.deepEqual((await weeks(env)).map((w) => [w.asOf, w.keys.length]), [['2026-09-10', 2]]);
  await put(env, { asOf: '2026-09-03', keys: [key(9)] });
  await put(env, { asOf: '2026-09-17', keys: [] });
  assert.deepEqual((await weeks(env)).map((w) => w.asOf), ['2026-09-03', '2026-09-10', '2026-09-17']);
});

test('the newest 52 export dates are kept', async () => {
  const env = { REPORT_STORE: kv() };
  for (let i = 0; i < 53; i++) {
    const res = await put(env, { asOf: day(i), keys: [key(i)] });
    assert.equal((await res.json()).history.weeks, Math.min(i + 1, 52));
  }
  const list = await weeks(env);
  assert.equal(list.length, 52);
  assert.equal(list[0].asOf, day(1));
  assert.equal(list[51].asOf, day(52));
  // An upload older than all 52 does not push a newer week out.
  await put(env, { asOf: day(0), keys: [key(0)] });
  assert.equal((await weeks(env))[0].asOf, day(1));
});

test('5,000 at-risk lines fit in the bundle header (over the old 64 KB header limit)', async () => {
  const env = { REPORT_STORE: kv() };
  const keys = Array.from({ length: 5000 }, (_, i) => `Sales Order|${100000 + i}|${200000 + i}|${i % 40}|ITEM-${String(i).padStart(8, '0')}|CM SFG - Somewhere Long Warehouse Name`);
  const res = await put(env, { asOf: '2026-09-03', keys });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).history, { weeks: 1 });
  assert.equal((await weeks(env))[0].keys.length, 5000);
});

test('a bad atRisk never stops the report from saving; the history is left as it was', async () => {
  const env = { REPORT_STORE: kv() };
  await put(env, { asOf: '2026-09-03', keys: [key(1)] });
  const bad = [
    null, 'x', { keys: [key(1)] }, { asOf: '2026-02-30', keys: [] }, { asOf: '03/09/2026', keys: [] }, { asOf: '2099-01-01', keys: [] },
    { asOf: '2026-09-10', keys: 'k' }, { asOf: '2026-09-10', keys: [5] }, { asOf: '2026-09-10', keys: ['tab\tkey'] },
    { asOf: '2026-09-10', keys: ['k'.repeat(301)] }, { asOf: '2026-09-10', keys: Array.from({ length: 5001 }, (_, i) => `k${i}`) },
  ];
  for (const atRisk of bad) {
    const res = await put(env, atRisk, [{ name: 'new.xls', data: 'B' }]);
    assert.equal(res.status, 200, JSON.stringify(atRisk).slice(0, 60));
    const out = await res.json();
    assert.deepEqual(out.files, ['new.xls']);
    assert.ok(out.history && out.history.error, JSON.stringify(atRisk).slice(0, 60));
  }
  assert.deepEqual((await weeks(env)).map((w) => w.asOf), ['2026-09-03']);
  // Older pages send no atRisk: the report is saved and the history is not touched.
  const plain = await (await put(env, undefined)).json();
  assert.equal(plain.history, undefined);
  assert.equal((await weeks(env)).length, 1);
});

test('GET /api/history: 503 without the KV binding, 405 for other methods, empty when the value is unreadable', async () => {
  assert.equal((await getHistory({})).status, 503);
  const env = { REPORT_STORE: kv() };
  const post = await getHistory(env, 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  env.REPORT_STORE.map.set('history', new TextEncoder().encode('{nope'));
  const res = await getHistory(env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { v: 1, weeks: [] });
  // A broken history value is replaced by the next save instead of failing it.
  const saved = await put(env, { asOf: '2026-09-03', keys: [key(1)] });
  assert.deepEqual((await saved.json()).history, { weeks: 1 });
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
