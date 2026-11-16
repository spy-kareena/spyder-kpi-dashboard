// Tests for functions/api/team-settings.js (the rules behind the numbers, one copy for everyone, changed by admins
// named in ADMIN_EMAILS) and shared/admins.mjs. Run: node tests/team-settings.test.mjs. No network: the Pages function
// runs against a Map-backed Workers KV stand-in. Addresses are made up.
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Imported by file URL: team-settings.js imports ../../shared/admins.mjs.
const { onRequest } = await import(pathToFileURL(join(here, '..', 'functions', 'api', 'team-settings.js')).href);
const { adminEmails, isAdmin, teamSettingsOn } = await import(pathToFileURL(join(here, '..', 'shared', 'admins.mjs')).href);

const ORIGIN = 'https://kpi.example.test';
const ADMINS = 'jamie.rivera@example.test, lee@example.test';
const ACCESS = { access: true, password: false };
const person = (email, name) => ({ user: { email, name, via: 'access' }, auth: ACCESS });
const JAMIE = person('jamie.rivera@example.test', 'Jamie Rivera'); // admin
const LEE = person('lee@example.test', 'Lee'); // admin
const SAM = person('sam.cole@example.test', 'Sam Cole'); // not an admin
const SERVICE = { user: { service: 'abc123.access', via: 'access-service' }, auth: ACCESS };
const PASSWORD = { user: { via: 'password' }, auth: { access: false, password: true } };
const BOTH_PASSWORD = { user: { via: 'password' }, auth: { access: true, password: true } };
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
const site = (extra = {}) => ({ REPORT_STORE: kv(), ADMIN_EMAILS: ADMINS, ...extra });
function call({ method = 'GET', body, env, origin = ORIGIN, data = JAMIE }) {
  const h = { 'content-type': 'application/json' };
  if (origin) h.Origin = origin;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return onRequest({ request: new Request(ORIGIN + '/api/team-settings', init), env, params: {}, data });
}
const get = async (env, data = JAMIE) => (await call({ env, data })).json();
const put = (env, settings, extra = {}) => call({ method: 'PUT', env, body: { settings }, ...extra });
const stored = (env) => JSON.parse(env.REPORT_STORE.map.get('team-settings') || 'null');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('ADMIN_EMAILS: commas, semicolons, spaces or new lines; any capitalisation; junk ignored', () => {
  const list = (v) => [...adminEmails({ ADMIN_EMAILS: v })].sort();
  assert.deepEqual(list(' Jamie.Rivera@Example.TEST ;lee@example.test,\n\tSam@example.test  '), ['jamie.rivera@example.test', 'lee@example.test', 'sam@example.test']);
  assert.deepEqual(list('Jamie Rivera <jamie.rivera@example.test>, mailto:lee@example.test, "sam@example.test"'), ['jamie.rivera@example.test', 'lee@example.test', 'sam@example.test']);
  assert.deepEqual(list('jamie, @example.test, lee@, a@@b, ;;, ,'), []);
  assert.deepEqual(list('lee@example.test LEE@example.test'), ['lee@example.test'], 'repeats count once');
  assert.deepEqual(list(''), []);
  assert.deepEqual([...adminEmails({})], []);
  assert.deepEqual([...adminEmails(undefined)], []);
  assert.deepEqual(list(`${'x'.repeat(250)}@example.test`), [], 'longer than an address can be');
  // Admin: an Access person whose address is in the list, with Access on.
  const env = { ADMIN_EMAILS: 'JAMIE.RIVERA@example.test' };
  assert.equal(isAdmin({ env, data: JAMIE }), true);
  assert.equal(isAdmin({ env, data: person('Jamie.Rivera@Example.test', 'Jamie') }), true);
  assert.equal(isAdmin({ env, data: SAM }), false);
  assert.equal(isAdmin({ env, data: SERVICE }), false);
  assert.equal(isAdmin({ env, data: { ...JAMIE, auth: { access: false, password: true } } }), false, 'Access off');
  assert.equal(teamSettingsOn({ env, data: PASSWORD }), false);
  assert.equal(teamSettingsOn({ env, data: SERVICE }), true);
});

test('off without Access or without a valid ADMIN_EMAILS: {enabled:false, settings:null, canEdit:false}; writes 403', async () => {
  const cases = [
    [site(), PASSWORD, 'shared password, Access off'],
    [site({ ADMIN_EMAILS: undefined }), JAMIE, 'no ADMIN_EMAILS'],
    [site({ ADMIN_EMAILS: '' }), JAMIE, 'blank ADMIN_EMAILS'],
    [site({ ADMIN_EMAILS: 'jamie; nobody@' }), JAMIE, 'no valid address'],
    [{ ADMIN_EMAILS: ADMINS }, PASSWORD, 'no storage either'],
  ];
  for (const [env, data, what] of cases) {
    const res = await call({ env, data });
    assert.equal(res.status, 200, what);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { v: 1, enabled: false, settings: null, canEdit: false }, what);
    const w = await put(env, { atRiskTarget: 7 }, { data });
    assert.equal(w.status, 403, what);
    assert.deepEqual((await w.json()).error, { code: 403, message: 'Only admins can change team settings.' }, what);
    if (env.REPORT_STORE) assert.equal(env.REPORT_STORE.puts, 0, what);
  }
});

test('on: anyone signed in may read (admin, other person, service token, password session behind Access); canEdit only for admins', async () => {
  const env = site();
  assert.equal((await put(env, { atRiskTarget: 7 })).status, 200);
  for (const [data, canEdit] of [[JAMIE, true], [LEE, true], [SAM, false], [SERVICE, false], [BOTH_PASSWORD, false]]) {
    const out = await get(env, data);
    assert.equal(out.enabled, true);
    assert.equal(out.canEdit, canEdit, JSON.stringify(data.user));
    assert.deepEqual(out.settings, { atRiskTarget: 7 });
    assert.equal(out.savedBy, 'Jamie Rivera');
    assert.deepEqual(Object.keys(out).sort(), ['canEdit', 'enabled', 'history', 'savedAt', 'savedBy', 'settings', 'v']);
    assert.ok(!JSON.stringify(out).includes('@'), 'no addresses are sent to the page');
  }
  // Nothing saved yet: settings null, blank saved fields, no history.
  assert.deepEqual(await get(site(), SAM), { v: 1, enabled: true, settings: null, savedAt: '', savedBy: '', canEdit: false, history: [] });
  // Not signed in at all (never past the gate on the hosted site): 401.
  for (const data of [{ auth: ACCESS }, { auth: ACCESS, user: { email: 'x@example.test' } }]) {
    const res = await call({ env, data });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 401);
  }
});

test('writes: a non-admin, a service token or a password session gets 403; no sign-in 401; another site 403', async () => {
  const env = site();
  for (const data of [SAM, SERVICE, BOTH_PASSWORD]) {
    for (const method of ['PUT', 'POST']) {
      const res = await call({ method, env, data, body: { settings: { atRiskTarget: 9 } } });
      assert.equal(res.status, 403, `${data.user.via} ${method}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await res.json()).error, { code: 403, message: 'Only admins can change team settings.' });
    }
    assert.equal((await call({ method: 'PUT', env, data, body: { reset: true } })).status, 403);
  }
  const anon = await put(env, { atRiskTarget: 9 }, { data: null });
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error.code, 401);
  for (const origin of ['https://evil.example.test', null]) {
    const res = await put(env, { atRiskTarget: 9 }, { origin });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 403);
  }
  assert.equal(env.REPORT_STORE.puts, 0);
  for (const method of ['DELETE', 'PATCH']) {
    const r = await call({ method, env, body: { settings: {} } });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'GET, PUT, POST');
  }
});

test('admin PUT: every team key within its bounds is saved; savedAt, savedBy (name) and savedByEmail recorded', async () => {
  const env = site();
  const settings = {
    atRiskTarget: 50, toleranceDays: 0, horizon: 'w6', otdGoalSales: 100, otdGoalVendors: 50,
    noteCommentsSo: ['Waiting on parts'], noteCommentsPo: [],
  };
  const before = Date.now();
  const res = await put(env, settings);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const out = await res.json();
  assert.equal(out.saved, true);
  assert.equal(out.canEdit, true);
  assert.deepEqual(out.settings, settings);
  assert.deepEqual(out.changed, Object.keys(settings));
  assert.equal(out.savedBy, 'Jamie Rivera');
  assert.ok(Date.parse(out.savedAt) >= before - 1000);
  assert.deepEqual(out.history, [{ at: out.savedAt, by: 'Jamie Rivera', keys: Object.keys(settings) }]);
  const doc = stored(env);
  assert.equal(doc.savedByEmail, 'jamie.rivera@example.test');
  assert.equal(doc.savedBy, 'Jamie Rivera');
  assert.equal(doc.history[0].byEmail, 'jamie.rivera@example.test');
  assert.deepEqual(doc.settings, settings);
  assert.deepEqual([...env.REPORT_STORE.map.keys()], ['team-settings']);
  // The low ends, and each horizon.
  for (const h of ['w2', 'm1', 'w6', 'm2']) assert.equal((await put(env, { horizon: h })).status, 200, h);
  assert.equal((await put(env, { atRiskTarget: 1, toleranceDays: 14, otdGoalSales: 50, otdGoalVendors: 100 })).status, 200);
  assert.deepEqual((await get(env, SAM)).settings, { ...settings, atRiskTarget: 1, toleranceDays: 14, horizon: 'm2', otdGoalSales: 50, otdGoalVendors: 100 });
  // An admin whose address gives no name: savedBy is the address.
  const env2 = site({ ADMIN_EMAILS: '12345@example.test' });
  const out2 = await (await put(env2, { horizon: 'w2' }, { data: person('12345@example.test', '') })).json();
  assert.equal(out2.savedBy, '12345@example.test');
});

test('admin PUT: a value out of bounds or of the wrong kind refuses the whole save, naming the key (400)', async () => {
  const env = site();
  await put(env, { atRiskTarget: 7 });
  const bad = [
    ['atRiskTarget', 0], ['atRiskTarget', 51], ['atRiskTarget', 5.5], ['atRiskTarget', '5'], ['atRiskTarget', true],
    ['toleranceDays', -1], ['toleranceDays', 15], ['toleranceDays', 1.5],
    ['horizon', 'm3'], ['horizon', 'M1'], ['horizon', 1],
    ['otdGoalSales', 49], ['otdGoalSales', 101], ['otdGoalVendors', 49], ['otdGoalVendors', 101], ['otdGoalVendors', '90'],
    ['noteCommentsSo', 'Waiting on parts'], ['noteCommentsSo', ['ok', 3]], ['noteCommentsSo', ['x'.repeat(121)]],
    ['noteCommentsPo', Array.from({ length: 31 }, (_, i) => `Comment ${i}`)], ['noteCommentsPo', { a: 'b' }],
  ];
  for (const [key, value] of bad) {
    const res = await put(env, { toleranceDays: 3, [key]: value });
    assert.equal(res.status, 400, `${key} ${JSON.stringify(value).slice(0, 40)}`);
    const out = await res.json();
    assert.equal(out.error.code, 400);
    assert.match(out.error.message, new RegExp(key));
    assert.equal(out.saved, false);
  }
  assert.deepEqual((await get(env)).settings, { atRiskTarget: 7 }, 'nothing from a refused save went in');
  assert.equal(env.REPORT_STORE.puts, 1);
});

test('comment lists: trimmed, spaces collapsed, blanks and repeats (any capitalisation) dropped, the first spelling kept', async () => {
  const env = site();
  const sent = ['  Waiting   on\tparts ', 'waiting on parts', '', '   ', 'Late vendor', 'LATE VENDOR', 'x'.repeat(120), '  ' + 'y'.repeat(120) + '  '];
  const out = await (await put(env, { noteCommentsSo: sent })).json();
  assert.deepEqual(out.settings.noteCommentsSo, ['Waiting on parts', 'Late vendor', 'x'.repeat(120), 'y'.repeat(120)]);
  // 30 after repeats are dropped is fine; 31 different ones are not.
  const thirty = Array.from({ length: 30 }, (_, i) => `Comment ${i}`);
  assert.equal((await put(env, { noteCommentsPo: [...thirty, 'comment 0', ' Comment 1 '] })).status, 200);
  assert.deepEqual((await get(env)).settings.noteCommentsPo, thirty);
  assert.equal((await put(env, { noteCommentsPo: [...thirty, 'Comment 30'] })).status, 400);
});

test('partial updates merge into the saved settings; unknown and personal keys are ignored; null puts one key back to its default', async () => {
  const env = site();
  await put(env, { atRiskTarget: 7, horizon: 'w6' });
  let out = await (await put(env, { toleranceDays: 4, theme: 'dark', hiddenPages: ['monthly'], made_up: 1 }, { data: LEE })).json();
  assert.deepEqual(out.settings, { atRiskTarget: 7, toleranceDays: 4, horizon: 'w6' });
  assert.deepEqual(out.changed, ['toleranceDays']);
  assert.equal(out.savedBy, 'Lee');
  assert.deepEqual(Object.keys(stored(env).settings), ['atRiskTarget', 'toleranceDays', 'horizon']);
  // The same values again, or only keys that are not team keys: nothing changes and nothing is written.
  const puts = env.REPORT_STORE.puts;
  out = await (await put(env, { atRiskTarget: 7, theme: 'light' })).json();
  assert.equal(out.saved, true);
  assert.deepEqual(out.changed, []);
  assert.equal(out.savedBy, 'Lee', 'the last real change');
  assert.equal(env.REPORT_STORE.puts, puts);
  assert.equal(out.history.length, 2);
  // null: back to the default (left out of the settings).
  out = await (await put(env, { horizon: null, otdGoalSales: null })).json();
  assert.deepEqual(out.settings, { atRiskTarget: 7, toleranceDays: 4 });
  assert.deepEqual(out.changed, ['horizon']);
  out = await (await put(env, { atRiskTarget: null, toleranceDays: null })).json();
  assert.equal(out.settings, null, 'no team key set: every one at its default');
  assert.equal(stored(env).settings, null);
});

test('history: newest first, capped at 20, the keys each save changed; reset clears every setting and is recorded as reset', async () => {
  const env = site();
  for (let i = 1; i <= 23; i++) assert.equal((await put(env, { atRiskTarget: i }, { data: i % 2 ? JAMIE : LEE })).status, 200);
  let out = await get(env, SAM);
  assert.equal(out.history.length, 20);
  assert.deepEqual(out.history[0], { at: out.savedAt, by: 'Jamie Rivera', keys: ['atRiskTarget'] });
  assert.equal(out.history[1].by, 'Lee');
  const times = out.history.map((h) => Date.parse(h.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal(stored(env).history.length, 20);
  // Reset.
  out = await (await call({ method: 'POST', env, data: LEE, body: { reset: true } })).json();
  assert.equal(out.saved, true);
  assert.equal(out.settings, null);
  assert.deepEqual(out.changed, ['reset']);
  assert.equal(out.savedBy, 'Lee');
  assert.deepEqual(out.history[0], { at: out.savedAt, by: 'Lee', keys: ['reset'] });
  assert.equal(out.history.length, 20);
  assert.equal(stored(env).settings, null);
  assert.deepEqual(await get(env, SAM).then((o) => o.settings), null);
  // Reset with nothing set: nothing to record.
  const puts = env.REPORT_STORE.puts;
  assert.deepEqual((await (await call({ method: 'PUT', env, body: { reset: true } })).json()).changed, []);
  assert.equal(env.REPORT_STORE.puts, puts);
});

test('bad bodies: not JSON, not {settings} or {reset:true}, both at once, too large: 400, nothing written', async () => {
  const env = site();
  const bodies = ['{nope', '[]', 'null', '"x"', '{}', JSON.stringify({ settings: [] }), JSON.stringify({ settings: null }), JSON.stringify({ settings: 'x' }),
    JSON.stringify({ reset: 'yes' }), JSON.stringify({ reset: true, settings: { atRiskTarget: 5 } }), JSON.stringify({ atRiskTarget: 5 }),
    JSON.stringify({ settings: { noteCommentsSo: ['x'.repeat(40 * 1024)] } })];
  for (const body of bodies) {
    const res = await call({ method: 'PUT', env, body });
    assert.equal(res.status, 400, body.slice(0, 60));
    const out = await res.json();
    assert.equal(out.error.code, 400);
    assert.equal(typeof out.error.message, 'string');
  }
  assert.equal(env.REPORT_STORE.puts, 0);
  // {settings:{}} is a save that changes nothing.
  const empty = await (await put(env, {})).json();
  assert.deepEqual([empty.saved, empty.changed, empty.settings], [true, [], null]);
});

test('Workers KV trouble: no binding 503; a failed read is a 500 and nothing is written; a busy write retried, then 429', async () => {
  const off = await call({ env: { ADMIN_EMAILS: ADMINS } });
  assert.equal(off.status, 503);
  const o = await off.json();
  assert.equal(o.enabled, true);
  assert.equal(o.settings, null);
  assert.equal(o.error.code, 503);
  const offPut = await put({ ADMIN_EMAILS: ADMINS }, { atRiskTarget: 5 });
  assert.equal(offPut.status, 503);
  assert.equal((await offPut.json()).saved, false);
  const env = site();
  await put(env, { atRiskTarget: 7 });
  env.REPORT_STORE.failGets = 1;
  assert.equal((await call({ env })).status, 500);
  env.REPORT_STORE.failGets = 1;
  const r = await put(env, { toleranceDays: 3 });
  assert.equal(r.status, 500);
  assert.equal((await r.json()).saved, false);
  assert.deepEqual(stored(env).settings, { atRiskTarget: 7 });
  // A stored value that is not a settings document is never overwritten by a merge.
  env.REPORT_STORE.map.set('team-settings', '[1,2]');
  assert.equal((await put(env, { toleranceDays: 3 })).status, 500);
  assert.equal(env.REPORT_STORE.map.get('team-settings'), '[1,2]');
  env.REPORT_STORE.map.delete('team-settings');
  env.REPORT_STORE.failPuts = 1;
  assert.equal((await put(env, { toleranceDays: 3 })).status, 200);
  env.REPORT_STORE.failPuts = 2;
  const busy = await put(env, { toleranceDays: 5 });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '2');
  assert.deepEqual(stored(env).settings, { toleranceDays: 3 });
});

test('a stored value edited by hand: bad values and other keys left out when read', async () => {
  const env = site();
  env.REPORT_STORE.map.set('team-settings', JSON.stringify({
    v: 1, settings: { atRiskTarget: 99, toleranceDays: 3, theme: 'dark', noteCommentsSo: ['  A  ', 'a', 'B'] }, savedAt: '2026-11-01T10:00:00.000Z',
    savedBy: 'Lee', savedByEmail: 'lee@example.test', history: [{ at: '2026-11-01T10:00:00.000Z', by: 'Lee', byEmail: 'lee@example.test', keys: ['toleranceDays'] }, 'junk', { by: 'x' }],
  }));
  const out = await get(env, SAM);
  assert.deepEqual(out.settings, { toleranceDays: 3, noteCommentsSo: ['A', 'B'] });
  assert.deepEqual(out.history, [{ at: '2026-11-01T10:00:00.000Z', by: 'Lee', keys: ['toleranceDays'] }]);
  assert.equal(out.savedBy, 'Lee');
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
