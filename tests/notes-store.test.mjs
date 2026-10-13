// Tests for functions/api/notes.js (shared notes, overrides, Us / Them causes and manual tracking numbers).
// Run: node tests/notes-store.test.mjs. No network: the Pages function runs against a Map-backed Workers KV stand-in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'functions', 'api', 'notes.js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const ORIGIN = 'https://kpi.example.test';
// Workers KV stand-in: get(key, {type:'json'|'text'|'arrayBuffer'}), put(key, string|bytes), delete(key). Counts writes.
function kv() {
  const map = new Map();
  const store = {
    map, puts: 0,
    async get(k, opts = {}) {
      if (!map.has(k)) return null;
      const bytes = map.get(k);
      const type = typeof opts === 'string' ? opts : opts.type || 'text';
      if (type === 'arrayBuffer') return bytes.slice().buffer;
      const text = new TextDecoder().decode(bytes);
      return type === 'json' ? JSON.parse(text) : text;
    },
    async put(k, v) { store.puts++; map.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)); },
    async delete(k) { map.delete(k); },
  };
  return store;
}
function call({ method = 'GET', body, env, origin = ORIGIN, headers = {} }) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin) h.Origin = origin;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return onRequest({ request: new Request(ORIGIN + '/api/notes', init), env, params: {} });
}
const stored = async (env) => JSON.parse(await env.REPORT_STORE.get('overrides', { type: 'text' }) || 'null');
const T = (s) => new Date(Date.UTC(2026, 9, 8, 15, 0, s)).toISOString();
const KEY_A = 'Sales Order|1|500|0|SPY-100|Spyder - Lacombe';
const KEY_B = 'Sales Order|2|501|0|SPY-200|CM - Alpha';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('nothing saved yet gives an empty document; no KV binding gives 503; other methods 405', async () => {
  const res = await call({ env: { REPORT_STORE: kv() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { v: 1, rows: {}, shipments: {}, savedAt: '' });
  const off = await call({ env: {} });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).configured, false);
  const offPatch = await call({ method: 'PATCH', env: {}, body: { rows: { [KEY_A]: { notes: 'x', at: T(1) } } } });
  assert.equal(offPatch.status, 503);
  for (const method of ['PUT', 'POST', 'DELETE']) {
    const res2 = await call({ method, env: { REPORT_STORE: kv() }, body: method === 'DELETE' ? undefined : {} });
    assert.equal(res2.status, 405, method);
    assert.equal(res2.headers.get('allow'), 'GET, PATCH');
  }
});

test('each line merges on its own: the newer edit wins, an older one is ignored, a tie keeps the stored one', async () => {
  const env = { REPORT_STORE: kv() };
  let res = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { status: 'Hold', notes: 'Waiting on board', cause: 'us', by: 'KK', at: T(10) }, [KEY_B]: { notes: 'Customer moved it', cause: 'them', by: 'AJ', at: T(10) } } } });
  assert.equal(res.status, 200);
  let out = await res.json();
  assert.equal(out.applied, 2);
  assert.deepEqual(out.rows[KEY_A], { status: 'Hold', notes: 'Waiting on board', cause: 'us', by: 'KK', at: T(10) });
  // Older edit for A (another browser that was offline), newer edit for B.
  res = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { status: 'Urgent', by: 'ZZ', at: T(5) }, [KEY_B]: { notes: 'Ships Friday', by: 'KK', at: T(20) } } } });
  out = await res.json();
  assert.equal(out.applied, 1);
  // The reply holds what is stored for every key sent, so the older browser adopts the newer note.
  assert.equal(out.rows[KEY_A].status, 'Hold');
  assert.equal(out.rows[KEY_B].notes, 'Ships Friday');
  assert.equal(out.rows[KEY_B].cause, undefined, 'a newer entry replaces the whole line, fields it leaves out are gone');
  // Same time: the stored one stays, and nothing is written to KV.
  const writes = env.REPORT_STORE.puts;
  res = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { status: 'Close Short', by: 'QQ', at: T(10) } } } });
  out = await res.json();
  assert.equal(out.applied, 0);
  assert.equal(out.rows[KEY_A].status, 'Hold');
  assert.equal(env.REPORT_STORE.puts, writes);
  const doc = await (await call({ env })).json();
  assert.deepEqual(Object.keys(doc.rows).sort(), [KEY_A, KEY_B].sort());
  assert.ok(doc.savedAt);
});

test('a cleared line is kept as a {by, at} marker so other browsers drop their copy; deleted lines keep their flag', async () => {
  const env = { REPORT_STORE: kv() };
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'old', at: T(1) }, [KEY_B]: { deleted: true, by: 'KK', at: T(1) } } } });
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { by: 'KK', at: T(2) } } } });
  const doc = await stored(env);
  assert.deepEqual(doc.rows[KEY_A], { by: 'KK', at: T(2) });
  assert.deepEqual(doc.rows[KEY_B], { deleted: true, by: 'KK', at: T(1) });
  // deleted:false is the same as no flag.
  await call({ method: 'PATCH', env, body: { rows: { [KEY_B]: { deleted: false, by: 'KK', at: T(3) } } } });
  assert.deepEqual((await stored(env)).rows[KEY_B], { by: 'KK', at: T(3) });
});

test('manual tracking numbers (shipments) merge the same way', async () => {
  const env = { REPORT_STORE: kv() };
  let res = await call({ method: 'PATCH', env, body: { shipments: { 'm-1': { order: '500', number: '7712 3456 7890', carrier: 'FedEx', by: 'KK', at: T(1) } } } });
  assert.equal(res.status, 200);
  res = await call({ method: 'PATCH', env, body: { shipments: { 'm-1': { order: '500', number: 'old', at: T(0) }, 'm-2': { order: '501', number: '123', deleted: true, at: T(2) } } } });
  const out = await res.json();
  assert.equal(out.applied, 1);
  assert.equal(out.shipments['m-1'].number, '7712 3456 7890');
  const doc = await (await call({ env })).json();
  assert.deepEqual(doc.shipments['m-2'], { order: '501', number: '123', deleted: true, by: '', at: T(2) });
  assert.equal((await call({ method: 'PATCH', env, body: { shipments: { 'bad id/1': { order: '1', number: '2', at: T(3) } } } })).status, 400);
});

test('only the dashboard page itself can change the notes', async () => {
  const env = { REPORT_STORE: kv() };
  const body = { rows: { [KEY_A]: { notes: 'x', at: T(1) } } };
  assert.equal((await call({ method: 'PATCH', env, body, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call({ method: 'PATCH', env, body, origin: '' })).status, 403);
  assert.equal(env.REPORT_STORE.map.size, 0);
});

test('bad changes are refused with a reason and nothing is stored', async () => {
  const env = { REPORT_STORE: kv() };
  const bad = [
    'not json',
    [],
    {},
    { rows: [] },
    { rows: {} },
    { rows: { [KEY_A]: { notes: 'x' } } }, // no time
    { rows: { [KEY_A]: { notes: 'x', at: 'yesterday' } } },
    { rows: { [KEY_A]: { notes: 'x', at: '1999-12-31T00:00:00Z' } } },
    { rows: { [KEY_A]: { cause: 'maybe', at: T(1) } } },
    { rows: { [KEY_A]: { deleted: 'yes', at: T(1) } } },
    { rows: { [KEY_A]: { notes: 'x'.repeat(4001), at: T(1) } } },
    { rows: { [KEY_A]: { status: 'x'.repeat(81), at: T(1) } } },
    { rows: { [KEY_A]: { status: 5, at: T(1) } } },
    { rows: { [KEY_A]: { notes: 'bell\u0007', at: T(1) } } },
    { rows: { [KEY_A]: { by: 'x'.repeat(41), at: T(1) } } },
    { rows: { [KEY_A]: { by: 'Bob!', at: T(1) } } },
    { rows: { [KEY_A]: { by: '<b>KK</b>', at: T(1) } } },
    { rows: { [KEY_A]: { by: 5, at: T(1) } } },
    { shipments: { 'm-1': { order: '500', number: '1', by: 'Ann; Lee', at: T(1) } } },
    { rows: { [KEY_A]: 'Hold' } },
    { rows: { 'tab\tkey': { notes: 'x', at: T(1) } } },
    { rows: { ['k'.repeat(301)]: { notes: 'x', at: T(1) } } },
    '{"rows":{"__proto__":{"notes":"x","at":"2026-10-08T15:00:00.000Z"}}}',
    { rows: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`k${i}`, { notes: 'x', at: T(1) }])) },
  ];
  for (const body of bad) {
    const res = await call({ method: 'PATCH', env, body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.ok((await res.json()).error);
  }
  assert.equal(env.REPORT_STORE.map.size, 0);
  // Line breaks and tabs inside a note are fine; so is a note of exactly 4,000 characters.
  const ok = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'line 1\nline 2\tend' + 'x'.repeat(3983), at: T(1) } } } });
  assert.equal(ok.status, 200);
});

test("the editor (by) is a name of up to 40 letters, spaces and . ' - (stored tidied); initials saved before 2v2 are still taken", async () => {
  const env = { REPORT_STORE: kv() };
  const cases = [
    ['Kareena', 'Kareena'],
    ['  Zoë   O’Brien-Smith ', "Zoë O'Brien-Smith"],
    ['करीना', 'करीना'],
    ['a'.repeat(40), 'a'.repeat(40)],
    ['KK', 'KK'],
    ['K2', 'K2'], // initials with a digit, as the dialog before 2v2 saved them
    ['ABCD1234EFGH5678', 'ABCD1234EFGH5678'],
    ['', ''],
    ['   ', ''],
  ];
  for (const [i, [by, want]] of cases.entries()) {
    const key = `${KEY_A}|${i}`;
    const res = await call({ method: 'PATCH', env, body: { rows: { [key]: { notes: 'x', by, at: T(1) } }, shipments: { [`m-${i}`]: { order: '500', number: '1', by, at: T(1) } } } });
    assert.equal(res.status, 200, by);
    const out = await res.json();
    assert.equal(out.rows[key].by, want, by);
    assert.equal(out.shipments[`m-${i}`].by, want, by);
  }
  assert.equal((await stored(env)).rows[`${KEY_A}|1`].by, "Zoë O'Brien-Smith");
});

test('size limits: 1 MB per change, 2 MB stored (old cleared-line markers are pruned first)', async () => {
  const env = { REPORT_STORE: kv() };
  const big = await call({ method: 'PATCH', env, body: { rows: {} }, headers: { 'content-length': String(1024 * 1024 + 1) } });
  assert.equal(big.status, 413);
  const huge = await call({ method: 'PATCH', env, body: { rows: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, { notes: 'n'.repeat(4000), at: T(1) }])) } });
  assert.equal(huge.status, 413);
  assert.equal(env.REPORT_STORE.map.size, 0);

  // A stored document of long notes 30 KB short of 2 MB, plus 600 cleared-line markers from a year ago (about 80 KB).
  const MAX = 2 * 1024 * 1024;
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
  const rows = {};
  for (let i = 0; JSON.stringify({ v: 1, rows, shipments: {}, savedAt: '' }).length < MAX - 30000; i++) rows[`note-${i}`] = { notes: 'n'.repeat(4000), by: 'KK', at: T(1) };
  for (let i = 0; i < 600; i++) rows[`gone-${String(i).padStart(80, '0')}`] = { by: 'KK', at: yearAgo };
  rows['gone-recent'] = { by: 'KK', at: T(1) };
  await env.REPORT_STORE.put('overrides', JSON.stringify({ v: 1, rows, shipments: {}, savedAt: '' }));
  assert.ok(env.REPORT_STORE.map.get('overrides').length > MAX);
  const fits = await call({ method: 'PATCH', env, body: { rows: { 'note-new': { notes: 'n'.repeat(4000), at: T(2) } } } });
  assert.equal(fits.status, 200);
  const doc = await stored(env);
  assert.equal(Object.keys(doc.rows).filter((k) => k.startsWith('gone-0')).length, 0, 'old markers pruned');
  assert.ok(doc.rows['gone-recent'], 'recent markers kept');
  assert.ok(doc.rows['note-new']);
  // Nothing old left to prune: new notes still save, and the entries edited longest ago make room.
  const oldest = Object.keys(doc.rows).filter((k) => k.startsWith('note-') && k !== 'note-new');
  for (let i = 0; i < 40; i++) {
    const res = await call({ method: 'PATCH', env, body: { rows: { [`more-${i}`]: { notes: 'n'.repeat(4000), at: T(3) } } } });
    assert.equal(res.status, 200, `more-${i}`);
  }
  const after = await stored(env);
  assert.ok(env.REPORT_STORE.map.get('overrides').length <= MAX, 'the stored document stays within 2 MB');
  for (let i = 0; i < 40; i++) assert.ok(after.rows[`more-${i}`], `more-${i} kept`);
  assert.ok(after.rows['note-new'], 'newer entries kept');
  const dropped = oldest.filter((k) => !after.rows[k]);
  assert.ok(dropped.length >= 30 && dropped.length < 60, `only what was needed was dropped (${dropped.length})`);
});

test('storage filled with made-up lines: real edits still save; at most 500 new lines per request', async () => {
  const env = { REPORT_STORE: kv() };
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'real note', by: 'KK', at: T(1) } } } });
  // Two 240-line batches of 4,000-character junk fill the 2 MB document; five more keep it full.
  let pruned = 0;
  for (let b = 0; b < 7; b++) {
    const rows = Object.fromEntries(Array.from({ length: 240 }, (_, i) => [`junk|${b}|${i}`, { notes: 'j'.repeat(4000), by: 'AB', at: new Date().toISOString() }]));
    const res = await call({ method: 'PATCH', env, body: { rows } });
    assert.equal(res.status, 200);
    pruned += (await res.json()).pruned || 0;
  }
  assert.ok(pruned > 0, 'the oldest entries made room');
  for (let i = 0; i < 3; i++) {
    const res = await call({ method: 'PATCH', env, body: { rows: { [`${KEY_B}|${i}`]: { notes: 'real edit '.repeat(400), by: 'KK', at: new Date().toISOString() } } } });
    assert.equal(res.status, 200, 'not 413 "storage is full"');
    assert.ok((await stored(env)).rows[`${KEY_B}|${i}`]);
  }
  assert.ok(env.REPORT_STORE.map.get('overrides').length <= 2 * 1024 * 1024);

  // New keys are capped per request; edits to stored keys are not.
  const env2 = { REPORT_STORE: kv() };
  const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`line-${i}`, { notes: 'x', at: T(1) }]));
  const first = await (await call({ method: 'PATCH', env: env2, body: { rows: many } })).json();
  assert.equal(first.applied, 500);
  assert.equal(first.skipped, 100);
  assert.equal(Object.keys(first.rows).length, 500, 'skipped lines are left out of the reply, for the page to send again');
  const again = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`line-${i}`, { notes: 'y', at: T(2) }]));
  const second = await (await call({ method: 'PATCH', env: env2, body: { rows: again } })).json();
  assert.equal(second.applied, 600, '500 edits to stored lines plus the 100 new ones');
  assert.equal(second.skipped, undefined);
});

test('a failed KV read never replaces the stored notes (500, nothing written); GET still answers', async () => {
  const env = { REPORT_STORE: kv() };
  const rows = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`line-${i}`, { notes: `note ${i}`, at: T(1) }]));
  await call({ method: 'PATCH', env, body: { rows } });
  const before = env.REPORT_STORE.map.get('overrides');
  const realGet = env.REPORT_STORE.get;
  env.REPORT_STORE.get = async () => { throw new Error('KV GET failed: 503'); };
  const writes = env.REPORT_STORE.puts;
  const res = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'one change', at: T(2) } } } });
  assert.equal(res.status, 500, 'not 503: the page reads 503 as "no shared storage"');
  assert.match((await res.json()).error, /could not be read; your changes are kept in this browser/);
  assert.equal(env.REPORT_STORE.puts, writes);
  assert.equal((await call({ env })).status, 200, 'reading for the page still gives a document');
  env.REPORT_STORE.get = realGet;
  assert.equal(env.REPORT_STORE.map.get('overrides'), before);
  assert.equal(Object.keys((await stored(env)).rows).length, 300);
  // An unreadable stored value is not taken for an empty one before a write either.
  env.REPORT_STORE.map.set('overrides', new TextEncoder().encode('{broken'));
  assert.equal((await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'x', at: T(3) } } } })).status, 500);
  assert.equal(new TextDecoder().decode(env.REPORT_STORE.map.get('overrides')), '{broken');
});

test('Workers KV busy (one write per second): one retry after 1.1 s, then 429 with Retry-After', async () => {
  const env = { REPORT_STORE: kv() };
  const realPut = env.REPORT_STORE.put;
  let fails = 1;
  env.REPORT_STORE.put = async (k, v) => { if (fails-- > 0) throw new Error('KV PUT failed: 429 Too Many Requests'); return realPut(k, v); };
  const started = Date.now();
  const ok = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'saved on the retry', at: T(1) } } } });
  assert.equal(ok.status, 200);
  assert.ok(Date.now() - started >= 1000, 'waited a second before trying again');
  assert.equal((await stored(env)).rows[KEY_A].notes, 'saved on the retry');
  fails = 2;
  const busy = await call({ method: 'PATCH', env, body: { rows: { [KEY_B]: { notes: 'not yet', at: T(2) } } } });
  assert.equal(busy.status, 429, 'not 500 or 503: the page sends the batch again');
  assert.equal(busy.headers.get('retry-after'), '2');
  assert.equal((await stored(env)).rows[KEY_B], undefined);
});

test('an edit stamped in the future (a computer clock set ahead) is stored with the server time', async () => {
  const env = { REPORT_STORE: kv() };
  const before = Date.now();
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'from the future', at: '2099-01-01T00:00:00.000Z' } } } });
  const at = Date.parse((await stored(env)).rows[KEY_A].at);
  assert.ok(at >= before && at <= Date.now() + 1000);
  // Even a minute ahead is not kept, so it cannot beat edits made in that minute.
  await new Promise((r) => setTimeout(r, 5));
  await call({ method: 'PATCH', env, body: { rows: { [KEY_B]: { notes: 'a minute ahead', at: new Date(Date.now() + 60000).toISOString() } } } });
  assert.ok(Date.parse((await stored(env)).rows[KEY_B].at) <= Date.now());
  // So a later real edit can still replace it.
  await new Promise((r) => setTimeout(r, 5));
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'now', at: new Date(Date.now() + 2000).toISOString() } } } });
  assert.equal((await stored(env)).rows[KEY_A].notes, 'now');
});

test('an unreadable stored value is treated as empty, not as an error', async () => {
  const env = { REPORT_STORE: kv() };
  env.REPORT_STORE.map.set('overrides', new TextEncoder().encode('{broken'));
  const res = await call({ env });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).rows, {});
  // Values that are not a notes document (edited by hand) read as empty too, without parsing them.
  for (const text of ['[1,2]', '"x"', '{"rows":{"a":{"notes":"x"}}}', '{"v":1,"rows":{"a":']) {
    env.REPORT_STORE.map.set('overrides', new TextEncoder().encode(text));
    assert.deepEqual(await (await call({ env })).json(), { v: 1, rows: {}, shipments: {}, savedAt: '' }, text);
  }
});

test('GET hands back the stored text as it is (no parsing, so a page open costs no CPU to speak of)', async () => {
  const env = { REPORT_STORE: kv() };
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'line 1\nline "2" é', cause: 'us', by: 'KK', at: T(1) } }, shipments: { 'm-1': { order: '500', number: '123', at: T(1) } } } });
  const realGet = env.REPORT_STORE.get;
  const asked = [];
  env.REPORT_STORE.get = async (k, opts) => { asked.push(opts && opts.type || 'text'); return realGet(k, opts); };
  const res = await call({ env });
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.equal(text, new TextDecoder().decode(env.REPORT_STORE.map.get('overrides')), 'the stored bytes, unchanged');
  assert.deepEqual(asked, ['text'], 'read as text, not as JSON');
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc), ['v', 'rows', 'shipments', 'savedAt']);
  assert.equal(doc.rows[KEY_A].notes, 'line 1\nline "2" é');
});

test('cleared-line markers older than 180 days are dropped on every save, not only when storage is full', async () => {
  const env = { REPORT_STORE: kv() };
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  const recent = new Date(Date.now() - 100 * 864e5).toISOString();
  await env.REPORT_STORE.put('overrides', JSON.stringify({ v: 1, rows: {
    'gone-old': { by: 'KK', at: old }, 'gone-recent': { by: 'KK', at: recent },
    'deleted-old': { deleted: true, by: 'KK', at: old }, 'note-old': { notes: 'still open', by: 'KK', at: old },
  }, shipments: {}, savedAt: '' }));
  const res = await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'x', at: T(1) } } } });
  assert.equal((await res.json()).pruned, 1);
  const doc = await stored(env);
  assert.deepEqual(Object.keys(doc.rows).sort(), ['deleted-old', 'gone-recent', 'note-old', KEY_A].sort(), 'only the old cleared marker went; deleted lines and notes stay');
  // A request that changes nothing writes nothing (and drops nothing).
  const writes = env.REPORT_STORE.puts;
  await call({ method: 'PATCH', env, body: { rows: { [KEY_A]: { notes: 'x', at: T(1) } } } });
  assert.equal(env.REPORT_STORE.puts, writes);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
