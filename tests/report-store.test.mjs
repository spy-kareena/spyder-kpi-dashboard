// Tests for functions/api/report.js (shared report storage). Run: node tests/report-store.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'functions', 'api', 'report.js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const ORIGIN = 'https://kpi.example.test';
// Workers KV stand-in: get(key, {type:'arrayBuffer'}) and put(key, bytes).
const kv = () => {
  const map = new Map();
  return { map, get: async (k) => (map.has(k) ? map.get(k).slice().buffer : null), put: async (k, v) => { map.set(k, new Uint8Array(v)); } };
};
function bundle(files, { lengthFix = 0 } = {}) {
  const parts = files.map((f) => Buffer.from(f.data));
  const head = Buffer.from(JSON.stringify({ v: 1, files: files.map((f, i) => ({ name: f.name, type: 'x', lastModified: 5, length: parts[i].length + lengthFix })) }));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(head.length);
  return new Uint8Array(Buffer.concat([size, head, ...parts]));
}
function call({ method = 'GET', body, env, origin = ORIGIN, headers = {} }) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  return onRequest({ request: new Request(ORIGIN + '/api/report', { method, body, headers: h }), env, params: {} });
}
function readBack(buf) {
  const bytes = new Uint8Array(buf);
  const size = new DataView(bytes.buffer).getUint32(0);
  return { head: JSON.parse(Buffer.from(bytes.subarray(4, 4 + size)).toString()), data: Buffer.from(bytes.subarray(4 + size)).toString() };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('nothing saved yet gives 204; no KV binding gives 503 configured:false', async () => {
  const empty = await call({ env: { REPORT_STORE: kv() } });
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  const off = await call({ env: {} });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).configured, false);
});

test('a saved report comes back byte for byte, with the server time stamped in its header', async () => {
  const env = { REPORT_STORE: kv() };
  const put = await call({ method: 'PUT', env, body: bundle([{ name: 'kpi.xls', data: 'AAA' }, { name: 'ctb.xlsx', data: 'BB' }]) });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.deepEqual(saved.files, ['kpi.xls', 'ctb.xlsx']);
  assert.ok(!isNaN(Date.parse(saved.savedAt)));
  const get = await call({ env });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'application/octet-stream');
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
  const { head, data } = readBack(await get.arrayBuffer());
  assert.equal(head.savedAt, saved.savedAt);
  assert.deepEqual(head.files.map((f) => [f.name, f.length]), [['kpi.xls', 3], ['ctb.xlsx', 2]]);
  assert.equal(data, 'AAABB');
});

test('a new report replaces the old one', async () => {
  const env = { REPORT_STORE: kv() };
  await call({ method: 'PUT', env, body: bundle([{ name: 'old.xls', data: 'old' }]) });
  await call({ method: 'PUT', env, body: bundle([{ name: 'new.xls', data: 'newer' }]) });
  const { head, data } = readBack(await (await call({ env })).arrayBuffer());
  assert.deepEqual(head.files.map((f) => f.name), ['new.xls']);
  assert.equal(data, 'newer');
});

test('only the dashboard page itself can replace the report', async () => {
  const env = { REPORT_STORE: kv() };
  const body = bundle([{ name: 'kpi.xls', data: 'A' }]);
  assert.equal((await call({ method: 'PUT', env, body, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call({ method: 'PUT', env, body, origin: '' })).status, 403);
  assert.equal(env.REPORT_STORE.map.size, 0);
});

test('bad bundles are refused and nothing is stored', async () => {
  const env = { REPORT_STORE: kv() };
  const bad = [
    bundle([{ name: 'run.exe', data: 'A' }]),
    bundle([{ name: '../kpi.xls', data: 'A' }]),
    bundle([{ name: 'kpi.xls', data: 'A' }], { lengthFix: 1 }),
    bundle(Array.from({ length: 13 }, (_, i) => ({ name: `f${i}.csv`, data: 'A' }))),
    new Uint8Array([0, 0, 0, 9, 1, 2]),
    new Uint8Array([]),
  ];
  for (const body of bad) assert.equal((await call({ method: 'PUT', env, body })).status, 400);
  assert.equal(env.REPORT_STORE.map.size, 0);
});

test('size limit and methods', async () => {
  const env = { REPORT_STORE: kv() };
  const big = await call({ method: 'PUT', env, body: new Uint8Array(10), headers: { 'content-length': String(25 * 1024 * 1024) } });
  assert.equal(big.status, 413);
  const del = await call({ method: 'DELETE', env });
  assert.equal(del.status, 405);
  assert.equal(del.headers.get('allow'), 'GET, PUT');
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
