// Tests for functions/api/people.js (the names offered in the "Your name" dialog, saved for everyone who signs in).
// Run: node tests/people-store.test.mjs. No network: the Pages function runs against a Map-backed Workers KV stand-in.
// Names are made up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'functions', 'api', 'people.js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const ORIGIN = 'https://kpi.example.test';
const DAY = 24 * 60 * 60 * 1000;
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
function call({ method = 'GET', body, env, origin = ORIGIN, headers = {} }) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin) h.Origin = origin;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return onRequest({ request: new Request(ORIGIN + '/api/people', init), env, params: {} });
}
const post = (env, name, extra = {}) => call({ method: 'POST', env, body: { name }, ...extra });
const stored = (env) => JSON.parse(env.REPORT_STORE.map.get('people') || 'null');
const seed = (env, people) => env.REPORT_STORE.map.set('people', JSON.stringify({ v: 1, people }));
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('nothing saved yet lists no names; no KV binding gives 503; other methods 405', async () => {
  const res = await call({ env: { REPORT_STORE: kv() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { v: 1, people: [] });
  for (const method of ['GET', 'POST']) {
    const off = await call({ method, env: {}, body: method === 'POST' ? { name: 'Kareena' } : undefined });
    assert.equal(off.status, 503, method);
    assert.equal((await off.json()).configured, false);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const r = await call({ method, env: { REPORT_STORE: kv() }, body: method === 'DELETE' ? undefined : { name: 'Kareena' } });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'GET, POST');
  }
});

test('a new name is added for everyone with when it was first and last seen; GET lists the most recently seen first', async () => {
  const env = { REPORT_STORE: kv() };
  const before = Date.now();
  let res = await post(env, 'Jamie Cole');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  let out = await res.json();
  assert.equal(out.saved, true);
  assert.equal(out.name, 'Jamie Cole');
  assert.equal(out.people.length, 1);
  const p = out.people[0];
  assert.deepEqual(Object.keys(p), ['name', 'firstSeen', 'lastSeen']);
  assert.equal(p.firstSeen, p.lastSeen);
  assert.ok(Date.parse(p.lastSeen) >= before && Date.parse(p.lastSeen) <= Date.now(), 'stamped with the server clock');
  await new Promise((r) => setTimeout(r, 5));
  res = await post(env, 'Kareena');
  out = await res.json();
  assert.deepEqual(out.people.map((x) => x.name), ['Kareena', 'Jamie Cole']);
  assert.equal(env.REPORT_STORE.puts, 2);
  const doc = stored(env);
  assert.equal(doc.v, 1);
  assert.deepEqual(doc.people.map((x) => x.name), ['Kareena', 'Jamie Cole']);
  const list = await (await call({ env })).json();
  assert.deepEqual(list, { v: 1, people: doc.people });
});

test('names are trimmed, spaces collapsed, curly apostrophes straightened; letters of any language are taken', async () => {
  const env = { REPORT_STORE: kv() };
  const cases = [
    ['  Zoë   O’Brien-Smith ', "Zoë O'Brien-Smith"],
    ['José Álvarez', 'José Álvarez'], // decomposed accent: stored composed (NFC)
    ['करीना कपूर', 'करीना कपूर'], // Devanagari letters and vowel signs (marks)
    ['李小龙', '李小龙'],
    ['J. R. R. Tolkien', 'J. R. R. Tolkien'],
    ['K', 'K'],
    ['a'.repeat(40), 'a'.repeat(40)],
    ['Ann\tMarie', 'Ann Marie'],
  ];
  for (const [sent, want] of cases) {
    const res = await post(env, sent);
    assert.equal(res.status, 200, sent);
    assert.equal((await res.json()).name, want, sent);
  }
  assert.equal(stored(env).people.length, cases.length);
});

test('a bad name or body is refused with a reason and nothing is stored', async () => {
  const env = { REPORT_STORE: kv() };
  const bad = [
    'not json',
    '[]',
    '{}',
    '"Kareena"',
    'null',
    { name: 5 },
    { name: ['Kareena'] },
    { name: '' },
    { name: '   ' },
    { name: 'a'.repeat(41) },
    { name: 'KK2' },
    { name: 'Bob!' },
    { name: '<script>' },
    { name: 'Robert"); DROP' },
    { name: '...' },
    { name: "- ' -" },
    { name: 'bell\u0007' },
    { name: 'a_b' },
    { name: 'Smile 😀' },
    { name: 'x'.repeat(161) },
    { names: 'Kareena' },
  ];
  for (const body of bad) {
    const res = await call({ method: 'POST', env, body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.ok((await res.json()).error);
  }
  assert.equal(env.REPORT_STORE.map.size, 0);
  assert.equal(env.REPORT_STORE.puts, 0);
});

test('the same name in other capitals is one person (the first spelling stays); a name seen today costs no write', async () => {
  const env = { REPORT_STORE: kv() };
  await post(env, 'Kareena');
  assert.equal(env.REPORT_STORE.puts, 1);
  const first = stored(env).people[0];
  for (const again of ['Kareena', 'kareena', ' KAREENA ']) {
    const res = await post(env, again);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.saved, false, again);
    assert.equal(out.name, 'Kareena', 'the stored spelling comes back');
    assert.deepEqual(out.people, [first]);
  }
  assert.equal(env.REPORT_STORE.puts, 1, 'no write for a name seen less than a day ago');
});

test('a name last seen more than a day ago is marked as seen again (one write) and moves to the top', async () => {
  const env = { REPORT_STORE: kv() };
  const jamieFirst = ago(60 * DAY);
  seed(env, [
    { name: 'Aaron', firstSeen: ago(30 * DAY), lastSeen: ago(2 * 3600000) },
    { name: 'Jamie Cole', firstSeen: jamieFirst, lastSeen: ago(3 * DAY) },
  ]);
  const res = await post(env, 'jamie cole');
  const out = await res.json();
  assert.equal(out.saved, true);
  assert.equal(out.name, 'Jamie Cole');
  assert.deepEqual(out.people.map((p) => p.name), ['Jamie Cole', 'Aaron']);
  const jamie = stored(env).people[0];
  assert.equal(jamie.firstSeen, jamieFirst, 'first seen is kept');
  assert.ok(Date.now() - Date.parse(jamie.lastSeen) < 5000);
  assert.equal(env.REPORT_STORE.puts, 1);
  await post(env, 'Jamie Cole');
  assert.equal(env.REPORT_STORE.puts, 1);
});

test('at most 300 names: a new one replaces the name seen longest ago', async () => {
  const env = { REPORT_STORE: kv() };
  const letters = (i) => [...String(i).padStart(3, '0')].map((d) => 'abcdefghij'[d]).join('');
  seed(env, Array.from({ length: 300 }, (_, i) => ({ name: `Person ${letters(i)}`, firstSeen: ago((400 - i) * DAY), lastSeen: ago((300 - i) * 3600000) })));
  const res = await post(env, 'Newcomer');
  const out = await res.json();
  assert.equal(out.saved, true);
  assert.equal(out.people.length, 300);
  assert.equal(out.people[0].name, 'Newcomer');
  const names = new Set(stored(env).people.map((p) => p.name));
  assert.equal(names.size, 300);
  assert.equal(names.has('Person aaa'), false, 'the name seen longest ago went');
  assert.equal(names.has('Person aab'), true);
  // A list edited by hand to more than 300 names is cut to the 300 seen most recently when read.
  seed(env, Array.from({ length: 320 }, (_, i) => ({ name: `Person ${letters(i)}`, firstSeen: ago(DAY), lastSeen: ago((320 - i) * 60000) })));
  const list = await (await call({ env })).json();
  assert.equal(list.people.length, 300);
  assert.equal(list.people[0].name, `Person ${letters(319)}`);
});

test('only the dashboard page itself may add a name (same origin); the body is capped', async () => {
  const env = { REPORT_STORE: kv() };
  for (const origin of [null, 'https://evil.example', 'http://kpi.example.test', 'null']) {
    const res = await post(env, 'Kareena', { origin });
    assert.equal(res.status, 403, String(origin));
  }
  assert.equal(env.REPORT_STORE.map.size, 0);
  const big = await call({ method: 'POST', env, body: { name: 'Kareena' }, headers: { 'content-length': '2049' } });
  assert.equal(big.status, 413);
  const padded = await call({ method: 'POST', env, body: JSON.stringify({ name: 'Kareena', pad: 'x'.repeat(2100) }) });
  assert.equal(padded.status, 413);
  assert.equal(env.REPORT_STORE.map.size, 0);
  // GET needs no Origin (a plain page read).
  assert.equal((await call({ env, origin: null })).status, 200);
});

test('a list that cannot be read is never replaced: POST gives 500 and writes nothing; GET shows no names', async () => {
  const env = { REPORT_STORE: kv() };
  seed(env, [{ name: 'Aaron', firstSeen: ago(DAY), lastSeen: ago(DAY) }]);
  env.REPORT_STORE.failGets = 1;
  const res = await post(env, 'Kareena');
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /kept in this browser/);
  assert.equal(env.REPORT_STORE.puts, 0);
  assert.deepEqual(stored(env).people.map((p) => p.name), ['Aaron']);
  env.REPORT_STORE.failGets = 1;
  assert.deepEqual(await (await call({ env })).json(), { v: 1, people: [] });
  // A value that is not a people document (edited by hand): the same.
  for (const junk of ['"some text"', '[1,2,3]', '{not json']) {
    env.REPORT_STORE.map.set('people', junk);
    const r = await post(env, 'Kareena');
    assert.equal(r.status, 500, junk);
    assert.equal(env.REPORT_STORE.map.get('people'), junk);
    assert.deepEqual(await (await call({ env })).json(), { v: 1, people: [] });
  }
  // Bad entries in a people document are left out, repeats (any capitals) too; dates that do not parse read as ''.
  env.REPORT_STORE.map.set('people', JSON.stringify({ v: 1, people: [
    { name: 'Aaron', firstSeen: ago(DAY), lastSeen: ago(DAY) }, { name: 'aaron', firstSeen: ago(DAY), lastSeen: ago(0) },
    { name: 'Bad!' }, null, 'Kareena', { name: 5 }, { name: 'Jamie', firstSeen: 'soon', lastSeen: 12 },
  ] }));
  const list = await (await call({ env })).json();
  assert.deepEqual(list.people.map((p) => [p.name, p.firstSeen === '' ? '' : 'date']), [['Aaron', 'date'], ['Jamie', '']]);
});

test('Workers KV busy: one more try after a second, then 429 with Retry-After (the page keeps the name and sends it again later)', async () => {
  const env = { REPORT_STORE: kv() };
  env.REPORT_STORE.failPuts = 1;
  const ok = await post(env, 'Kareena');
  assert.equal(ok.status, 200);
  assert.equal(stored(env).people[0].name, 'Kareena');
  env.REPORT_STORE.failPuts = 2;
  const busy = await post(env, 'Aaron');
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '2');
  assert.deepEqual(stored(env).people.map((p) => p.name), ['Kareena']);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
