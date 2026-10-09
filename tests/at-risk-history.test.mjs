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

test('a report with the same export date goes into that week; an older export date is filed in date order', async () => {
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

test('one entry per week: daily uploads keep the earliest export date and every line, so 52 entries are a year', async () => {
  const env = { REPORT_STORE: kv() };
  // Wednesday 2026-09-09 then Friday 2026-09-11 (same week); Monday 2026-09-14 starts the next one.
  await put(env, { asOf: '2026-09-11', keys: [key(2), key(3)] });
  await put(env, { asOf: '2026-09-09', keys: [key(1), key(2)] });
  await put(env, { asOf: '2026-09-14', keys: [key(1)] });
  const list = await weeks(env);
  assert.deepEqual(list.map((w) => w.asOf), ['2026-09-09', '2026-09-14']);
  assert.deepEqual([...list[0].keys].sort(), [key(1), key(2), key(3)].sort(), 'every line at risk that week');
  // 129 weekday uploads from Monday 2026-04-13: a line at risk the whole time keeps April as its first week.
  const env2 = { REPORT_STORE: kv() };
  let n = 0;
  for (let t = Date.UTC(2026, 3, 13); n < 129; t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    await put(env2, { asOf: d.toISOString().slice(0, 10), keys: [key(7)] });
    n++;
  }
  const year = await weeks(env2);
  assert.equal(year.length, 26, '129 weekdays are 26 weeks (25 full weeks and 4 days)');
  assert.equal(year[0].asOf, '2026-04-13');
  assert.ok(year.every((w, i) => i === 0 || Date.parse(w.asOf) - Date.parse(year[i - 1].asOf) === 7 * 864e5), 'one Monday a week');
  // Entries saved before this rule (several in one week) are merged on the next save.
  const env3 = { REPORT_STORE: kv() };
  await env3.REPORT_STORE.put('history', JSON.stringify({ v: 1, weeks: [{ asOf: '2026-09-01', savedAt: 'a', keys: [key(1)] }, { asOf: '2026-09-02', savedAt: 'b', keys: [key(2)] }] }));
  await put(env3, { asOf: '2026-09-21', keys: [] });
  assert.deepEqual((await weeks(env3)).map((w) => [w.asOf, w.keys.length]), [['2026-09-01', 2], ['2026-09-21', 0]]);
});

test('a failed history read never replaces the stored history; the report is still saved', async () => {
  const env = { REPORT_STORE: kv() };
  for (let i = 0; i < 10; i++) await put(env, { asOf: day(40 + i), keys: [key(i)] });
  const before = env.REPORT_STORE.map.get('history');
  const realGet = env.REPORT_STORE.get;
  env.REPORT_STORE.get = async (k, o) => { if (k === 'history') throw new Error('KV GET failed: 503'); return realGet(k, o); };
  const res = await put(env, { asOf: day(50), keys: [key(50)] }, [{ name: 'today.xls', data: 'T' }]);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.files, ['today.xls']);
  assert.match(out.history.error, /could not be updated/);
  env.REPORT_STORE.get = realGet;
  assert.equal(env.REPORT_STORE.map.get('history'), before);
  assert.equal((await weeks(env)).length, 10);
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

test('GET serves the compact copy as stored: each line only under its first week, the same "first flagged" answer', async () => {
  const env = { REPORT_STORE: kv() };
  await put(env, { asOf: day(0), keys: [key(1), key(2)] });
  await put(env, { asOf: day(1), keys: [key(1), key(3)] });
  await put(env, { asOf: day(2), keys: [key(2), key(3), key(4)] });
  const text = (k) => new TextDecoder().decode(env.REPORT_STORE.map.get(k));
  // The full history (what new uploads merge into) keeps every line of every week.
  assert.deepEqual(JSON.parse(text('history')).weeks.map((w) => w.keys), [[key(1), key(2)], [key(1), key(3)], [key(2), key(3), key(4)]]);
  const res = await getHistory(env);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await res.text();
  assert.equal(body, text('history:first'), 'the stored text, not parsed and written out again');
  const served = JSON.parse(body).weeks;
  assert.deepEqual(served.map((w) => [w.asOf, w.keys]), [[day(0), [key(1), key(2)]], [day(1), [key(3)]], [day(2), [key(4)]]]);
  assert.ok(served.every((w) => w.savedAt), 'savedAt kept for the page\'s merge');
  // First flagged (the page's refreshFirstFlagged: the first week a key appears) is the same from either copy.
  const firstFlagged = (weeks) => { const out = {}; for (const w of weeks) for (const k of w.keys) if (!(k in out)) out[k] = w.asOf; return out; };
  assert.deepEqual(firstFlagged(served), firstFlagged(JSON.parse(text('history')).weeks));
  // A line at risk every week of more than a year: once the oldest week drops off, it moves to the new oldest week.
  // 20 lines at risk all year (plus one new line a week) are sent once, not 52 times.
  const env2 = { REPORT_STORE: kv() };
  const always = Array.from({ length: 20 }, (_, i) => key(500 + i));
  for (let i = 0; i < 53; i++) await put(env2, { asOf: day(i), keys: [...always, key(100 + i)] });
  const year = await weeks(env2);
  assert.equal(year.length, 52);
  assert.deepEqual(year[0].keys, [...always, key(101)]);
  assert.deepEqual(year[1].keys, [key(102)]);
  const size = (k) => env2.REPORT_STORE.map.get(k).length;
  assert.ok(size('history:first') < size('history') / 5, `${size('history:first')} bytes served instead of ${size('history')}`);
});

test('GET falls back to the full history until the compact copy exists, or when it could not be written', async () => {
  const env = { REPORT_STORE: kv() };
  // Saved by an earlier version: only the full history.
  await env.REPORT_STORE.put('history', JSON.stringify({ v: 1, weeks: [{ asOf: '2026-09-01', savedAt: 'a', keys: [key(1)] }, { asOf: '2026-09-08', savedAt: 'b', keys: [key(1), key(2)] }] }));
  assert.deepEqual((await weeks(env)).map((w) => w.keys), [[key(1)], [key(1), key(2)]]);
  // The next upload writes both.
  await put(env, { asOf: '2026-09-15', keys: [key(2), key(3)] });
  assert.deepEqual((await weeks(env)).map((w) => w.keys), [[key(1)], [key(2)], [key(3)]]);
  // The compact write fails: it is removed rather than left behind (older), and the full history is served.
  const realPut = env.REPORT_STORE.put;
  env.REPORT_STORE.put = async (k, v) => { if (k === 'history:first') throw new Error('KV PUT failed: 500'); return realPut(k, v); };
  const res = await put(env, { asOf: '2026-09-22', keys: [key(4)] });
  assert.deepEqual((await res.json()).history, { weeks: 4 });
  env.REPORT_STORE.put = realPut;
  assert.equal(env.REPORT_STORE.map.has('history:first'), false);
  const list = await weeks(env);
  assert.deepEqual(list.map((w) => w.asOf), ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22']);
  assert.deepEqual(list[3].keys, [key(4)]);
  // Neither value readable: the empty history.
  env.REPORT_STORE.get = async () => { throw new Error('KV GET failed: 503'); };
  assert.deepEqual(await (await getHistory(env)).json(), { v: 1, weeks: [] });
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
