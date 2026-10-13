// The page side of shared notes (1v7): overrides, notes, Us / Them causes and deleted lines set in one browser show in
// every other browser on the hosted site (functions/api/notes.js); hosts without it keep them in the browser only.
// Also the Your name dialog (names saved for everyone, functions/api/people.js), the cause controls, and the at-risk
// history ("first flagged").
// Run with `node tests/shared-notes.test.js`. Fixtures are synthetic (no SAP data); no network (fetch is mocked).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HTML, loadPage, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const handlers = {};
async function handler(name) {
  if (!handlers[name]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', `${name}.js`), 'utf8');
    ({ onRequest: handlers[name] } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
  }
  return handlers[name];
}
// Workers KV stand-in: get(key, {type:'json'|'text'|'arrayBuffer'}), put, delete.
function kvStore() {
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
// The hosted site: the real Pages functions over one KV stand-in. mode 'static' answers 404 like IIS; 'down' fails
// like a lost network.
function fakeSite() {
  const env = { REPORT_STORE: kvStore() };
  // failPatches: how many of the next PATCHes fail, with failKind 'down' (no network) or a status (an error page).
  const site = { env, calls: [], bodies: [], patchTimes: [], mode: 'up', failPatches: 0, failKind: 500 };
  site.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    site.calls.push(`${method} ${url}`);
    if (method === 'PATCH') { site.bodies.push(JSON.parse(init.body)); site.patchTimes.push(Date.now()); }
    if (site.mode === 'down') throw new TypeError('Failed to fetch');
    if (method === 'PATCH' && site.failPatches > 0) {
      site.failPatches--;
      if (site.failKind === 'down') throw new TypeError('Failed to fetch');
      return new Response('<!doctype html><title>Error</title>', { status: site.failKind, headers: { 'content-type': 'text/html' } });
    }
    if (site.mode === 'static') return new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'content-type': 'text/html' } });
    if (url === '/api/people' && site.peopleDown) throw new TypeError('Failed to fetch');
    const name = { '/api/report': 'report', '/api/notes': 'notes', '/api/history': 'history', '/api/people': 'people' }[url];
    const fn = await handler(name);
    // A browser sends Origin with every PATCH / PUT; the page's own origin here.
    const headers = { ...(init.headers || {}), ...(method === 'GET' ? {} : { Origin: ORIGIN }) };
    return fn({ request: new Request(ORIGIN + url, { method, body: init.body, headers }), env, params: {} });
  };
  site.doc = async () => JSON.parse((await env.REPORT_STORE.get('overrides', { type: 'text' })) || '{"rows":{},"shipments":{}}');
  site.people = async () => JSON.parse((await env.REPORT_STORE.get('people', { type: 'text' })) || '{"people":[]}');
  site.history = async () => JSON.parse((await env.REPORT_STORE.get('history', { type: 'text' })) || '{"weeks":[]}');
  site.patches = () => site.calls.filter((c) => c === 'PATCH /api/notes').length;
  return site;
}
// A browser on its own computer: its own localStorage (storage) and IndexedDB stand-in.
async function openBrowser(site, { storage = {} } = {}) {
  const page = loadPage({ storage });
  await tick(0);
  const db = {};
  Object.assign(page.ctx, {
    fetch: site.fetch, Blob, File, Response, CompressionStream, DecompressionStream,
    location: { href: ORIGIN + '/', protocol: 'https:' },
    reportStore: (mode, use) => Promise.resolve(use({ put: (v, k) => { db[k] = v; return { result: k }; }, get: (k) => ({ result: db[k] }) }).result),
    FileReader: class { readAsArrayBuffer(f) { f.arrayBuffer().then((b) => this.onload({ target: { result: b } })); } readAsText(f) { f.text().then((t) => this.onload({ target: { result: t } })); } },
  });
  // The harness opens every page as an empty shared snapshot; a real page starts from this browser's saved notes.
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides();notesCleared=notesReadLocal(NOTES_CLEARED_KEY);sharedShipments=notesReadLocal(NOTES_SHIPMENTS_KEY)');
  return page;
}
// Opens the shared report and the shared notes, as startApp does.
async function openHosted(site, opts) {
  const page = await openBrowser(site, opts);
  await page.ctx.restoreSavedReport();
  await page.ctx.syncSharedNotes();
  await page.ctx.loadAtRiskHistory();
  await settle(page);
  return page;
}
// Waits until every queued change has been sent (PATCHes go out at least 1.1 s apart, so allow a few seconds).
async function settle(page) {
  for (let i = 0; i < 400; i++) {
    await tick(10);
    if (page.run('!notesInFlight&&!notesFlushTimer&&notesReady.size===0')) return;
  }
  throw new Error('shared notes never settled');
}
async function sendNow(page) {
  await page.run('flushSharedNotes({all:true})');
  await settle(page);
}
const clock = (page, iso) => page.run(`Date.now=()=>${Date.parse(iso)}`);
// Lines 900 and 901 are past due on 09/03/2026 (At Risk); 902 is due in October.
const ROWS = [
  sapRow({ DocumentNumber: '900', 'Internal Number': '900' }),
  sapRow({ DocumentNumber: '901', 'Internal Number': '901', Warehouse: 'CM - Alpha' }),
  sapRow({ DocumentNumber: '902', 'Internal Number': '902', DueDate: '10/15/2026', HeaderDueDate: '10/15/2026', LineDueDate: '10/15/2026' }),
];
const kpi = (rows = ROWS, name = 'kpi.xls') => new File([sapExport(rows)], name);
async function upload(page, file = kpi()) {
  await page.ctx.handleFiles([file]);
  await page.run('shareQueue');
}
const keyOf = (page, doc) => page.run(`rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}))`);
const edit = (page, doc, field, value) => page.run(`updateRowOverride(rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)})),${JSON.stringify(field)},${JSON.stringify(value)})`);
const line = (page, doc) => page.run(`(r=>({status:r.overrideStatus,notes:r.overrideNotes,cause:r.overrideCause,deleted:r.isDeleted}))(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}))`);
const saved = (page) => JSON.parse(page.storage.spyderKpiRowOverridesV1 || '{}');
const sidebar = (page) => page.els['app-sidebar'].innerHTML;
const html = (page) => page.els['results-screen'].innerHTML;
const atRiskCount = (page) => page.run('orderHealthData(currentMetrics()).lateTileRows.length');

test('an override, note and cause set in one browser show in another browser, with who and when', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  assert.equal(a.run('sharedNotes.state'), 'shared');
  clock(a, '2026-10-08T15:00:00Z');
  const k = keyOf(a, '900');
  edit(a, '900', 'status', 'Not At Risk');
  edit(a, '900', 'notes', 'Customer agreed to Oct 20');
  edit(a, '900', 'cause', 'them');
  const entry = { status: 'Not At Risk', notes: 'Customer agreed to Oct 20', cause: 'them', by: 'Kareena', at: '2026-10-08T15:00:00.000Z' };
  assert.deepEqual(saved(a)[k], entry);
  await sendNow(a);
  assert.equal(site.patches(), 1);
  assert.deepEqual((await site.doc()).rows[k], entry);
  assert.equal(atRiskCount(a), 1);

  const b = await openHosted(site);
  assert.deepEqual(line(b, '900'), { status: 'Not At Risk', notes: 'Customer agreed to Oct 20', cause: 'them', deleted: false });
  assert.equal(atRiskCount(b), 1, 'Not At Risk from the other browser takes the line off At Risk');
  assert.match(sidebar(b), /Notes shared · last edit Kareena · Oct 8/);
  assert.match(sidebar(b), /data-tip="Notes, overrides and causes are saved for everyone who signs in; last edit by Kareena: Oct 8, 2026/);
  // The copy is also kept in that browser, for when the server cannot be reached.
  assert.deepEqual(saved(b)[k], entry);
  // Opening the page costs one read; nothing newer here, so nothing is sent back.
  assert.equal(site.patches(), 1);
});

test('changes go out 800 ms after the last change to a line, many lines in one request', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  await settle(a);
  for (const text of ['W', 'Wa', 'Wai', 'Wait', 'Waiting']) edit(a, '900', 'notes', text);
  edit(a, '901', 'status', 'Hold');
  await tick(400);
  assert.equal(site.patches(), 0, 'nothing sent while typing');
  edit(a, '900', 'notes', 'Waiting on PO');
  await tick(500);
  assert.equal(site.patches(), 1, '901 went out on its own timer');
  assert.deepEqual(Object.keys(site.bodies[0].rows), [keyOf(a, '901')]);
  await tick(450);
  await settle(a);
  assert.equal(site.patches(), 2);
  assert.equal(site.bodies[1].rows[keyOf(a, '900')].notes, 'Waiting on PO');
  // A bulk change of many lines is one request.
  a.run('selectAllLinked(true)');
  a.run("linkedBulkStatus='Urgent';applyLinkedOverride()");
  await tick(850);
  await settle(a);
  assert.equal(site.patches(), 3);
  assert.equal(Object.keys(site.bodies[2].rows).length, a.run('linkedListKeys.length'));
  // While the request is out the sidebar says so; afterwards it names the last edit.
  assert.match(sidebar(a), /Notes shared · last edit Kareena · /);
});

test('PATCHes go out at least 1.1 s apart (Workers KV: one write a second); a busy or failed save is sent again', async () => {
  const site = fakeSite();
  // Workers KV refuses a second write to the same key within a second.
  const kvStore = site.env.REPORT_STORE;
  const realPut = kvStore.put.bind(kvStore);
  const lastPut = {};
  kvStore.put = async (k, v) => {
    if (lastPut[k] && Date.now() - lastPut[k] < 1000) throw new Error('KV PUT failed: 429 Too Many Requests');
    lastPut[k] = Date.now();
    return realPut(k, v);
  };
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  await settle(a);
  // Two lines set half a second apart (a normal triage pace): each has its own 800 ms timer.
  edit(a, '900', 'status', 'Hold');
  await tick(500);
  edit(a, '901', 'status', 'Urgent');
  await tick(900);
  assert.equal(site.patches(), 1, 'the second line waits for the gap');
  await settle(a);
  assert.equal(site.patches(), 2);
  assert.ok(site.patchTimes[1] - site.patchTimes[0] >= 1050, `PATCHes ${site.patchTimes[1] - site.patchTimes[0]} ms apart`);
  let doc = await site.doc();
  assert.equal(doc.rows[keyOf(a, '900')].status, 'Hold');
  assert.equal(doc.rows[keyOf(a, '901')].status, 'Urgent');

  // The server answers with an error page once: the batch goes back in the queue and is sent again 2 s later.
  await tick(1200); // past the gap after the last PATCH
  site.failPatches = 1; site.failKind = 500;
  edit(a, '902', 'notes', 'after a server error');
  await tick(900);
  assert.equal(site.patches(), 3);
  assert.ok(a.run('notesReady.size') === 1 && a.run('!!notesRetryTimer'), 'queued again with a retry timer');
  assert.match(sidebar(a), /trying again in a moment/);
  await settle(a);
  assert.equal(site.patches(), 4);
  assert.equal((await site.doc()).rows[keyOf(a, '902')].notes, 'after a server error');
  assert.doesNotMatch(sidebar(a), /Notes not shared/);
  // Same for a lost connection, and for the server's "busy" 429.
  for (const [i, kind] of ['down', 429].entries()) {
    await tick(1200);
    site.failPatches = 1; site.failKind = kind;
    clock(a, `2026-10-08T16:0${i}:00Z`); // a newer edit than the stored one
    edit(a, '900', 'notes', `retried after ${kind}`);
    await tick(900);
    await settle(a);
    assert.equal((await site.doc()).rows[keyOf(a, '900')].notes, `retried after ${kind}`, String(kind));
  }
  assert.equal(a.run('notesRetries'), 0);
  // A refusal that will not change (400) is not retried.
  await tick(1200);
  site.failPatches = 1; site.failKind = 400;
  edit(a, '901', 'notes', 'refused');
  await tick(900);
  await settle(a);
  assert.equal(a.run('!!notesRetryTimer'), false);
});

test('the newer edit wins when two people change the same line', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Aaron' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  const k = keyOf(a, '900');
  clock(a, '2026-10-08T15:00:00Z');
  edit(a, '900', 'notes', 'A: older note');
  clock(b, '2026-10-08T15:05:00Z');
  edit(b, '900', 'notes', 'B: newer note');
  await sendNow(b);
  await sendNow(a);
  assert.equal((await site.doc()).rows[k].notes, 'B: newer note');
  // The older browser takes the newer note from the server's reply, on screen and in its own storage.
  assert.equal(line(a, '900').notes, 'B: newer note');
  assert.equal(saved(a)[k].by, 'Kareena');
  clock(a, '2026-10-08T15:10:00Z');
  edit(a, '900', 'notes', 'A: newest');
  await sendNow(a);
  assert.equal((await site.doc()).rows[k].notes, 'A: newest');
});

test('a computer clock an hour fast does not keep overwriting newer notes; with a Date header edits use server time', async () => {
  // The server's clock (functions/api/notes.js reads Date.now); the pages' clocks are set with clock().
  const realNow = Date.now;
  let serverNow = Date.parse('2026-10-08T12:00:00Z');
  Date.now = () => serverNow;
  try {
    const site = fakeSite();
    const fast = await openBrowser(site, { storage: { spyderKpiEditorName: 'Fran' } });
    await upload(fast);
    await fast.ctx.syncSharedNotes();
    const ok = await openHosted(site, { storage: { spyderKpiEditorName: 'Olu' } });
    const k = keyOf(fast, '900');
    clock(fast, '2026-10-08T13:00:00Z');
    edit(fast, '900', 'notes', 'old note from the fast-clock PC');
    await sendNow(fast);
    // The server clamps the future time to its own; the fast browser takes that time instead of keeping its own.
    assert.equal((await site.doc()).rows[k].at, '2026-10-08T12:00:00.000Z');
    assert.equal(saved(fast)[k].at, '2026-10-08T12:00:00.000Z');
    serverNow = Date.parse('2026-10-08T12:05:00Z');
    clock(ok, '2026-10-08T12:05:00Z');
    edit(ok, '900', 'notes', 'NEWER note from OK');
    await sendNow(ok);
    // The fast browser reads the notes again (window focus): OK's newer note wins and is not pushed over.
    serverNow = Date.parse('2026-10-08T12:06:00Z');
    clock(fast, '2026-10-08T13:06:00Z');
    const before = site.patches();
    fast.run('sharedNotes.syncedAt=0');
    await fast.ctx.syncSharedNotes();
    await settle(fast);
    assert.equal(site.patches(), before, 'nothing pushed back');
    assert.equal((await site.doc()).rows[k].notes, 'NEWER note from OK');
    assert.equal(line(fast, '900').notes, 'NEWER note from OK');
    // A line edited again while its save was out keeps the newer local edit (sent next) rather than the reply.
    fast.run(`adoptSharedReply({rows:{${JSON.stringify(k)}:{notes:'server copy',by:'Fran',at:'2026-10-08T12:00:00.000Z'}}},{rows:{}})`);
    assert.equal(line(fast, '900').notes, 'NEWER note from OK', 'a key that was not in this send is left alone');

    // With the server's Date header, a browser an hour slow stamps its edits in server time, so they win as they should.
    const dated = { ...site, fetch: async (url, init) => { const res = await site.fetch(url, init); const h = new Headers(res.headers); h.set('date', new Date(serverNow).toUTCString()); return new Response(await res.arrayBuffer(), { status: res.status, headers: h }); } };
    const slow = await openHosted(dated, { storage: { spyderKpiEditorName: 'Sam' } });
    clock(slow, '2026-10-08T11:07:00Z');
    serverNow = Date.parse('2026-10-08T12:07:00Z');
    slow.run('sharedNotes.syncedAt=0');
    await slow.ctx.syncSharedNotes();
    assert.equal(slow.run('notesClockOffset'), 3600000);
    edit(slow, '900', 'notes', 'newest, from the slow-clock PC');
    assert.equal(saved(slow)[k].at, '2026-10-08T12:07:00.000Z');
    await sendNow(slow);
    assert.equal((await site.doc()).rows[k].notes, 'newest, from the slow-clock PC');
    // A clock within two minutes of the server's is left as it is.
    clock(slow, '2026-10-08T12:08:30Z');
    serverNow = Date.parse('2026-10-08T12:08:00Z');
    slow.run('sharedNotes.syncedAt=0');
    await slow.ctx.syncSharedNotes();
    assert.equal(slow.run('notesClockOffset'), 0);
  } finally {
    Date.now = realNow;
  }
});

test('a save at another Cloudflare location that read a stale copy (KV, up to 60 s) is caught by the re-read a minute later', async () => {
  const site = fakeSite();
  const kv = site.env.REPORT_STORE;
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Aaron' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  const k900 = keyOf(a, '900');
  const k901 = keyOf(a, '901');
  // What B's Cloudflare location still reads for up to a minute: the notes before A's save.
  const stale = kv.map.get('overrides');
  clock(a, '2026-10-08T15:00:00Z');
  edit(a, '900', 'notes', 'A: board ships Friday');
  await sendNow(a);
  assert.equal((await site.doc()).rows[k900].notes, 'A: board ships Friday');
  assert.equal(a.run('!!notesRecheckTimer'), true, 'a save that changed something sets the re-read');
  assert.ok(a.run('NOTES_RECHECK_MS') > 60000, 'after the KV cache window');
  // B saves 2.5 s later; its PATCH merges into the stale copy and A's line is dropped. A is told nothing.
  const realGet = kv.get;
  kv.get = async (k, o) => {
    if (k !== 'overrides') return realGet(k, o);
    const now = kv.map.get(k);
    if (stale) kv.map.set(k, stale); else kv.map.delete(k);
    try { return await realGet(k, o); } finally { kv.map.set(k, now); }
  };
  clock(b, '2026-10-08T15:00:02.500Z');
  edit(b, '901', 'status', 'Hold');
  await sendNow(b);
  kv.get = realGet;
  let doc = await site.doc();
  assert.equal(doc.rows[k900], undefined, 'the stale-copy write dropped A\'s line');
  assert.equal(doc.rows[k901].status, 'Hold');
  assert.equal(a.run('notesReady.size'), 0);
  assert.doesNotMatch(sidebar(a), /Notes not shared/);
  // A minute later A reads the notes again, finds its line missing and sends it back; it also takes B's line.
  const patches = site.patches();
  await a.ctx.recheckSharedNotes();
  await settle(a);
  assert.equal(site.patches(), patches + 1);
  doc = await site.doc();
  assert.equal(doc.rows[k900].notes, 'A: board ships Friday');
  assert.equal(doc.rows[k901].status, 'Hold');
  assert.equal(line(a, '901').status, 'Hold');
  // Nothing missing: the re-read sends nothing (and a reply that changed nothing sets no new re-read).
  a.run('clearTimeout(notesRecheckTimer);notesRecheckTimer=null');
  await a.ctx.recheckSharedNotes();
  await settle(a);
  assert.equal(site.patches(), patches + 1);
  assert.equal(a.run('notesRecheckTimer'), null);
});

test('a page left open reads other people\'s edits again when it comes back into view (at most once a minute)', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Aaron' } });
  await upload(a);
  clock(a, '2026-10-08T15:00:00Z');
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  clock(b, '2026-10-08T15:20:00Z');
  edit(b, '900', 'notes', 'Board arrives Monday');
  await sendNow(b);
  const reads = () => site.calls.filter((c) => c === 'GET /api/notes').length;
  const before = reads();
  a.ctx.refreshSharedNotes();
  await tick(30);
  assert.equal(reads(), before, 'not again within a minute');
  clock(a, '2026-10-08T15:30:00Z');
  a.ctx.refreshSharedNotes();
  await tick(30);
  await settle(a);
  assert.equal(reads(), before + 1);
  assert.equal(line(a, '900').notes, 'Board arrives Monday');
  // An edit here now builds on the newer note instead of sending an old copy back.
  edit(a, '900', 'status', 'Hold');
  await sendNow(a);
  const k = keyOf(a, '900');
  assert.deepEqual((({ status, notes, by }) => ({ status, notes, by }))((await site.doc()).rows[k]), { status: 'Hold', notes: 'Board arrives Monday', by: 'Aaron' });
});

test('clearing a line and restoring deleted lines reach the other browsers too', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  clock(a, '2026-10-08T15:00:00Z');
  edit(a, '900', 'notes', 'temporary');
  a.run(`setRowOverrides([${JSON.stringify(keyOf(a, '901'))}],'deleted',true)`);
  await sendNow(a);
  const bStorage = { spyderKpiEditorName: 'Quinn' };
  const b = await openHosted(site, { storage: bStorage });
  assert.equal(line(b, '900').notes, 'temporary');
  assert.equal(line(b, '901').deleted, true);
  assert.equal(b.run('parsedRows.length'), 2);
  assert.match(html(b), /1 line you deleted is hidden/);
  assert.match(html(b), /Deleted lines are left out of every page and KPI for everyone who signs in/);

  // a clears the note and restores the line: the entries go, and markers tell the server.
  clock(a, '2026-10-08T16:00:00Z');
  edit(a, '900', 'notes', '');
  a.run('restoreDeletedLines()');
  const k900 = keyOf(a, '900');
  assert.equal(saved(a)[k900], undefined);
  await tick(0); // markers are written once per batch of changes
  assert.ok(JSON.parse(a.storage.spyderKpiNotesClearedV1)[k900], 'marker kept until the server has it');
  await sendNow(a);
  assert.deepEqual((await site.doc()).rows[k900], { by: 'Kareena', at: '2026-10-08T16:00:00.000Z' });
  assert.deepEqual(JSON.parse(a.storage.spyderKpiNotesClearedV1), {}, 'marker dropped once the server has it');

  // b opens again later: its older copies are dropped.
  const b2 = await openHosted(site, { storage: bStorage });
  assert.deepEqual(line(b2, '900'), { status: '', notes: '', cause: '', deleted: false });
  assert.equal(b2.run('parsedRows.length'), 3);
  assert.deepEqual(saved(b2), {});
});

test('notes saved before shared notes existed are shared on the first open; a newer shared note wins over an old one', async () => {
  const site = fakeSite();
  const seed = await openBrowser(site);
  await upload(seed, kpi());
  const k = keyOf(seed, '900');
  const k2 = keyOf(seed, '901');
  // Browser 1 has a 1v6 note (no time) on 900; browser 2 has another old note on 900 and one on 901.
  const one = await openHosted(site, { storage: { spyderKpiEditor: 'KK', spyderKpiRowOverridesV1: JSON.stringify({ [k]: { notes: 'from 1v6', status: 'Hold' } }) } });
  assert.equal(site.patches(), 1);
  const shared = (await site.doc()).rows[k];
  assert.equal(shared.notes, 'from 1v6');
  assert.equal(shared.by, 'KK');
  assert.ok(Date.parse(shared.at) > 0);
  assert.ok(saved(one)[k].at, 'stamped in that browser too');
  const two = await openHosted(site, { storage: { spyderKpiRowOverridesV1: JSON.stringify({ [k]: { notes: 'other old note' }, [k2]: { notes: 'only here' } }) } });
  assert.equal(line(two, '900').notes, 'from 1v6');
  assert.equal(line(two, '901').notes, 'only here');
  assert.equal((await site.doc()).rows[k2].notes, 'only here');
});

test('a static host (no /api/notes) keeps notes in this browser only, as before', async () => {
  const site = fakeSite();
  site.mode = 'static';
  const page = await openBrowser(site);
  await upload(page);
  await page.ctx.syncSharedNotes();
  assert.equal(page.run('sharedNotes.state'), 'local');
  edit(page, '900', 'notes', 'local note');
  edit(page, '900', 'notes', '');
  edit(page, '901', 'status', 'Hold');
  await tick(900);
  assert.equal(site.patches(), 0);
  assert.equal(saved(page)[keyOf(page, '901')].status, 'Hold');
  assert.equal(page.storage.spyderKpiNotesClearedV1 || '{}', '{}', 'no cleared-line markers without a server');
  assert.match(sidebar(page), /Notes saved in this browser only/);
  assert.doesNotMatch(sidebar(page), /Change name|Add your name/);
  let asked = '';
  page.ctx.confirm = (m) => { asked = m; return true; };
  page.run(`toggleLinkedRow(${JSON.stringify(keyOf(page, '900'))},true);deleteLinkedSelection()`);
  assert.match(asked, /in this browser and in snapshots you share/);
});

test('when the server cannot be reached, changes stay here and are shared the next time the page opens', async () => {
  const site = fakeSite();
  const first = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(first);
  await first.ctx.syncSharedNotes();
  clock(first, '2026-10-08T15:00:00Z');
  edit(first, '901', 'notes', 'to be cleared');
  await sendNow(first);

  site.mode = 'down';
  const storage = { spyderKpiEditorName: 'Kareena' };
  const page = await openBrowser(site, { storage });
  await page.ctx.restoreSavedReport();
  await page.ctx.handleFiles([kpi()]);
  await page.ctx.syncSharedNotes();
  assert.equal(page.run('sharedNotes.state'), 'offline');
  assert.match(sidebar(page), /Notes saved in this browser only \(server not reachable\)/);
  clock(page, '2026-10-08T16:00:00Z');
  edit(page, '900', 'notes', 'typed offline');
  // 901's note came from the server earlier in this browser's life: pretend it is here, then clear it offline.
  page.run(`rowOverrides[${JSON.stringify(keyOf(page, '901'))}]={notes:'to be cleared',by:'Kareena',at:'2026-10-08T15:00:00.000Z'};allLoadedRows.forEach(applyRowOverride)`);
  edit(page, '901', 'notes', '');
  assert.equal(saved(page)[keyOf(page, '900')].notes, 'typed offline');
  await tick(0);
  assert.ok(JSON.parse(storage.spyderKpiNotesClearedV1)[keyOf(page, '901')]);

  site.mode = 'up';
  const again = await openHosted(site, { storage });
  const doc = await site.doc();
  assert.equal(doc.rows[keyOf(again, '900')].notes, 'typed offline');
  assert.deepEqual(doc.rows[keyOf(again, '901')], { by: 'Kareena', at: '2026-10-08T16:00:00.000Z' });
  assert.equal(line(again, '901').notes, '');
});

test('a shared snapshot never reads or writes shared notes, and carries the merged notes and first-flagged dates', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  edit(a, '900', 'notes', 'shared note');
  edit(a, '900', 'cause', 'us');
  await sendNow(a);
  let payload = '';
  Object.assign(a.ctx, { CompressionStream: undefined, buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await a.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  const k = keyOf(a, '900');
  assert.equal(data.rowOverrides[k].notes, 'shared note');
  assert.equal(data.rowOverrides[k].cause, 'us');
  assert.deepEqual(data.firstFlagged, { [k]: '2026-09-03', [keyOf(a, '901')]: '2026-09-03' });

  const before = site.calls.length;
  const snap = loadPage();
  // Count only this page's requests: the first browser may still send its own (e.g. the Shipping page's queued
  // tracking-list sync, Stream E) while the snapshot is open.
  const snapCalls = [];
  snap.ctx.fetch = (url, opts) => { snapCalls.push(`${(opts && opts.method) || 'GET'} ${url}`); return site.fetch(url, opts); };
  snap.ctx.location = { href: ORIGIN + '/', protocol: 'https:' };
  snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
  snap.els['embedded-snapshot-data'].textContent = payload;
  await snap.run('loadEmbeddedSnapshot()');
  await snap.ctx.syncSharedNotes();
  await snap.ctx.loadAtRiskHistory();
  // Nor for names: the name question and the shared list of names stay out of a snapshot.
  await snap.run('peopleOnOpen();askEditorName(true);loadPeople().then(()=>postEditorName("Kareena"))');
  snap.run(`updateRowOverride(${JSON.stringify(k)},'notes','edited in the snapshot')`);
  await tick(900);
  assert.deepEqual(snapCalls, [], 'no requests from a snapshot');
  assert.ok(site.calls.slice(before).every((c) => !/\/api\/(notes|history|people)/.test(c)), 'no shared-notes, history or names requests while the snapshot is open');
  assert.deepEqual(snap.storage, {});
  assert.equal(snap.run('firstFlagged')[k], '2026-09-03');
  assert.equal(snap.run(`allLoadedRows.find(r=>r.documentNumber==='900').overrideCause`), 'us');
  assert.equal(sidebar(snap).includes('Notes shared'), false);

  // New file inside a snapshot leaves it: the site's at-risk history replaces the snapshot's first-flagged dates
  // (here made different on purpose) and the shared notes are read, as on a normal start.
  const old = await (async () => {
    const p = await openBrowser(site);
    p.els['embedded-snapshot-data'].dataset.encoding = 'json';
    p.els['embedded-snapshot-data'].textContent = JSON.stringify({ ...data, firstFlagged: { [k]: '2026-01-01' } });
    await p.run('loadEmbeddedSnapshot()');
    return p;
  })();
  assert.equal(old.run(`ohFlaggedSince(allLoadedRows.find(r=>r.documentNumber==='900'))`), '2026-01-01');
  await old.ctx.handleFiles([kpi()]);
  for (let i = 0; i < 100 && (old.run('notesSyncing') || old.run('firstFlagged')[k] !== '2026-09-03'); i++) await tick(10);
  assert.equal(old.run('isSnapshotView'), false);
  assert.deepEqual(old.run('firstFlagged'), { [k]: '2026-09-03', [keyOf(a, '901')]: '2026-09-03' });
  assert.equal(old.run(`ohFlaggedSince(allLoadedRows.find(r=>r.documentNumber==='900'))`), '2026-09-03');
  assert.equal(old.run('sharedNotes.state'), 'shared');
  assert.equal(old.run(`allLoadedRows.find(r=>r.documentNumber==='900').overrideNotes`), 'shared note');
});

test('Us / Them cause: note editor, Build Risk rows, bulk bar, print', async () => {
  const site = fakeSite();
  site.mode = 'static';
  const page = await openBrowser(site);
  await upload(page);
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  const k = keyOf(page, '900');
  page.run(`toggleRowNote(${JSON.stringify(k)})`);
  const select = html(page).match(/<label>Cause<select class="row-cause"[\s\S]*?<\/select><\/label>/);
  assert.ok(select, 'the note editor has a labelled cause select next to the override');
  assert.match(html(page), /<div class="note-picks"><label>Override<select class="row-override"/);
  assert.match(select[0], /data-field="cause"/);
  assert.match(select[0], /aria-label="Cause, us or them, for 900"/);
  assert.match(select[0], /data-tip="Who the delay is on: Us \(Spyder\) or Them/);
  assert.deepEqual([...select[0].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]), [['', 'Auto'], ['us', 'Us'], ['them', 'Them']]);
  for (const ev of ['keydown', 'keyup', 'change', 'blur']) assert.match(select[0], new RegExp(`on${ev}="overrideSelectEvent\\(this,event\\)"`));

  // Same keyboard rule as the override select: stepping the closed select waits for Enter.
  page.run(`var sel={dataset:{key:${JSON.stringify(k)},field:'cause'},value:''};overrideSelectEvent(sel,{type:'keydown',key:'ArrowDown',preventDefault(){}});sel.value='us';overrideSelectEvent(sel,{type:'change'})`);
  assert.equal(line(page, '900').cause, '');
  page.run("overrideSelectEvent(sel,{type:'keydown',key:'Enter',preventDefault(){}})");
  assert.equal(line(page, '900').cause, 'us');
  assert.equal(saved(page)[k].cause, 'us');
  assert.match(html(page), /<option value="us" selected>Us<\/option>/);
  // A line with only a cause still counts as having a note, and prints its cause.
  assert.match(page.run(`renderNoteButton(allLoadedRows.find(r=>r.documentNumber==='900'))`), /has-note[\s\S]*Edit note/);
  assert.match(page.run(`renderPrintNoteRow(allLoadedRows.find(r=>r.documentNumber==='900'),5)`), /Cause: Us/);

  // Build Risk's editable rows: a cause select under the override select; print shows the text instead.
  const table = page.run("renderRowsTable(parsedRows,{key:'t',title:'T',editable:true})");
  assert.match(table, /class="row-override"[\s\S]*?<select class="row-cause"[\s\S]*?<span class="print-only">Cause: Us<\/span>/);
  assert.match(HTML, /@media print\{\.editable-rows \.row-cause,\.editor-dialog\{display:none!important\}\}/);

  // Bulk bar: Set cause on every selected line; statuses and notes stay; Auto clears the cause.
  edit(page, '901', 'status', 'Hold');
  page.run('selectAllLinked(true)');
  assert.match(html(page), /<label>Cause <select id="linked-bulk-cause" class="select"[^>]*data-tip="[^"]+"/);
  assert.match(html(page), /<button type="button" class="btn btn-sm" id="linked-bulk-cause-apply" onclick="applyLinkedCause\(\)" data-tip="[^"]+">Set cause<\/button>/);
  page.run("linkedBulkCause='them';applyLinkedCause()");
  assert.deepEqual([line(page, '900').cause, line(page, '901').cause], ['them', 'them']);
  assert.equal(line(page, '901').status, 'Hold');
  page.run("selectAllLinked(true);linkedBulkCause='';applyLinkedCause()");
  assert.deepEqual([line(page, '900').cause, line(page, '901').cause], ['', '']);
  assert.equal(saved(page)[k], undefined, 'a line with nothing left has no entry');
  assert.equal(saved(page)[keyOf(page, '901')].status, 'Hold');
});

// A stand-in for <dialog>: records listeners; close(value) fires 'close' like the browser. Setting innerHTML reads the
// New name box, the saved-name buttons and what is hidden, as a browser would.
function fakeDialog() {
  const listeners = {};
  const on = (name) => (t, fn) => { listeners[`${name}:${t}`] = fn; };
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const field = (id) => ({ id, value: '', textContent: '', hidden: false, focus() {}, addEventListener: on(id) });
  const input = field('editor-name');
  const error = field('editor-error');
  const people = field('editor-people');
  const filter = field('editor-filter');
  const label = field('editor-name-label');
  const chipList = () => [...chips.innerHTML.matchAll(/<button type="button" class="editor-chip" data-name="([^"]*)"[^>]*>/g)].map((m) => ({ dataset: { name: unesc(m[1]) }, focus() {} }));
  const chips = { id: 'editor-chips', innerHTML: '', addEventListener: on('chips'), querySelector: () => chipList()[0] || null, querySelectorAll: () => chipList(), contains: () => false };
  const form = { addEventListener: on('form') };
  const skip = { addEventListener: on('skip') };
  let html = '';
  const d = {
    opened: 0, removed: false, returnValue: '', attrs: {},
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      const box = v.match(/<input id="editor-name"[^>]*>/)[0];
      input.value = unesc(/ value="([^"]*)"/.exec(box)[1]);
      input.placeholder = unesc((/ placeholder="([^"]*)"/.exec(box) || ['', ''])[1]);
      label.textContent = (v.match(/<label for="editor-name" id="editor-name-label">([^<]*)<\/label>/) || ['', ''])[1];
      people.hidden = /id="editor-people" hidden>/.test(v);
      filter.hidden = /<input type="search" id="editor-filter"[^>]* hidden>/.test(v);
      chips.innerHTML = v.match(/id="editor-chips"[^>]*>([\s\S]*?)<\/div>/)[1];
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector: (s) => ({ form, '#editor-name': input, '#editor-error': error, '[data-editor-skip]': skip, '#editor-people': people, '#editor-filter': filter, '#editor-chips': chips, '#editor-name-label': label }[s]),
    addEventListener: (t, fn) => { listeners[t] = fn; },
    showModal() { this.opened++; },
    close(v) { if (v !== undefined) this.returnValue = v; listeners.close(); },
    remove() { this.removed = true; },
    // Save: the form submits with the Save button; a submit that is not prevented closes with its value.
    submit(value) { let prevented = false; listeners['form:submit']({ submitter: { value }, preventDefault() { prevented = true; } }); if (!prevented) this.close(value); return prevented; },
    skip() { listeners['skip:click'](); },
    // The saved names shown (as buttons), and the one marked as this browser's name.
    names: () => chipList().map((c) => c.dataset.name),
    current: () => unesc((chips.innerHTML.match(/data-name="([^"]*)" aria-current="true"/) || ['', ''])[1]),
    pick(name) { listeners['chips:click']({ target: { closest: (s) => (s === '[data-name]' ? { dataset: { name } } : null) } }); },
    // A click on the × beside a saved name.
    unlist(name) { listeners['chips:click']({ target: { closest: (s) => (s === '[data-remove]' ? { dataset: { remove: name } } : s === '[data-name]' ? { dataset: { name } } : null) } }); },
    find(text) { filter.value = text; listeners['editor-filter:input'](); },
    findEnter() { const e = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; listeners['editor-filter:keydown'](e); return e.defaultPrevented; },
    input, error, people, filter, chips, label,
  };
  return d;
}
// Names already in the shared list (Workers KV key 'people'), the first seen most recently.
// Seen in the last week (the server leaves out names not seen for 180 days, by its own clock).
async function seedPeople(site, names, newest = Date.now() - 6 * 86400000) {
  const people = names.map((name, i) => ({ name, firstSeen: new Date(newest - 90 * 86400000).toISOString(), lastSeen: new Date(newest - i * 3600000).toISOString() }));
  await site.env.REPORT_STORE.put('people', JSON.stringify({ v: 1, people }));
}
function catchDialogs(page) {
  const dialogs = [];
  const create = page.ctx.document.createElement;
  page.ctx.document.createElement = (tag) => (tag === 'dialog' ? (dialogs.push(fakeDialog()), dialogs[dialogs.length - 1]) : create(tag));
  return dialogs;
}
const peopleCalls = (site, method = '') => site.calls.filter((c) => c.endsWith(' /api/people') && (!method || c.startsWith(`${method} `))).length;

test('Your name is asked once, in a dialog: names saved for everyone are one click, a new name is added for everyone, edits carry it', async () => {
  const site = fakeSite();
  await seedPeople(site, ['Jamie Cole', 'Kareena']);
  const page = await openBrowser(site);
  const dialogs = catchDialogs(page);
  await upload(page);
  await page.ctx.syncSharedNotes();
  await tick(10);
  // No name in this browser yet: the saved names are read when the page opens, so they are ready for the question.
  assert.equal(peopleCalls(site, 'GET'), 1);
  assert.deepEqual(page.run('sharedPeople.map(p=>p.name)'), ['Jamie Cole', 'Kareena']);
  edit(page, '900', 'notes', 'first note');
  await tick(5);
  assert.equal(dialogs.length, 1);
  const d = dialogs[0];
  assert.equal(d.opened, 1);
  assert.equal(d.attrs['aria-labelledby'], 'editor-dialog-title');
  // With saved names it opens on its title (a stray Enter picks no one; no phone keyboard over the list).
  assert.match(d.innerHTML, /<h2 id="editor-dialog-title" tabindex="-1" autofocus>Your name<\/h2>\s*<p id="editor-dialog-desc">Shown with the notes you save\.<\/p>/);
  // Beside a list the box is for a new name; each saved name has a × (with a tip and a label naming it).
  assert.match(d.innerHTML, /<label for="editor-name" id="editor-name-label">New name<\/label>/);
  assert.match(d.chips.innerHTML, /<span class="editor-pick"><button type="button" class="editor-chip" data-name="Kareena" data-tip="Use this name\.">Kareena<\/button><button type="button" class="editor-chip-x" data-remove="Kareena" aria-label="Remove Kareena" data-tip="Remove this name from the list for everyone\.">×<\/button><\/span>/);
  assert.equal(d.input.placeholder, '', 'no hint without initials saved before 2v2');
  assert.match(d.innerHTML, /<input id="editor-name" name="name" maxlength="40" autocomplete="name"[^>]*aria-describedby="editor-error"/);
  assert.doesNotMatch(d.innerHTML.match(/<input id="editor-name"[^>]*>/)[0], /autofocus/);
  assert.match(d.innerHTML, /<input type="search" id="editor-filter"[^>]* data-tip="Type part of your name\."/);
  assert.equal((d.chips.innerHTML.match(/class="editor-chip"[^>]* data-tip="Use this name\."/g) || []).length, 2, 'each saved name carries a tip');
  assert.doesNotMatch(d.innerHTML, /initials|company/i);
  assert.equal((d.innerHTML.match(/<button type="(submit|button)" (value="save" )?class="btn[^"]*"[^>]*data-tip="[^"]+"/g) || []).length, 2, 'Save and Not now carry tips');
  // The saved names, the most recently seen first; no Find box for a short list.
  assert.deepEqual(d.names(), ['Jamie Cole', 'Kareena']);
  assert.match(d.innerHTML, /<div class="editor-chips" id="editor-chips" role="group" aria-labelledby="editor-people-label">/);
  assert.deepEqual([d.people.hidden, d.filter.hidden], [false, true]);
  assert.equal(d.input.value, '');
  // Nothing is sent while the question is open, so the edit goes out with the name.
  await page.run('flushSharedNotes({all:true})');
  assert.equal(site.patches(), 0);
  d.input.value = 'K2!';
  assert.equal(d.submit('save'), true, 'a name with digits or symbols is refused');
  assert.match(d.error.textContent, /1 to 40 letters/);
  d.pick('Kareena');
  assert.equal(d.removed, true);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena');
  await sendNow(page);
  const k = keyOf(page, '900');
  assert.equal((await site.doc()).rows[k].by, 'Kareena');
  assert.equal(saved(page)[k].by, 'Kareena');
  // Picking a saved name marks it as seen for everyone (it moves to the top of the list).
  assert.equal(peopleCalls(site, 'POST'), 1);
  assert.deepEqual((await site.people()).people.map((p) => p.name), ['Kareena', 'Jamie Cole']);
  assert.equal(JSON.parse(page.storage.spyderKpiNameSeenV1).name, 'Kareena');
  // Asked once: later edits do not ask again; the sidebar names the last editor and the button changes the name.
  edit(page, '901', 'notes', 'second');
  await tick(5);
  assert.equal(dialogs.length, 1);
  assert.match(sidebar(page), /Notes shared · last edit Kareena · Sep \d+/);
  assert.match(sidebar(page), /<button type="button" class="link-btn notes-editor-btn" data-focus-key="notes-editor" onclick="askEditorName\(true\)" data-tip="Your notes show “Kareena”; click to change it\.">Change name<\/button>/);
  // The status and the button have their own row, outside .loaded-meta (hidden at 980px and below), which stays
  // visible under the file name and buttons in the compact card.
  assert.match(sidebar(page), /<div class="loaded-meta">(?:(?!<\/div>)[\s\S])*<\/div><div class="loaded-notes"><span class="notes-sync" data-tip="[^"]+">Notes shared[^<]*<\/span><br><button type="button" class="link-btn notes-editor-btn"/);
  assert.doesNotMatch(sidebar(page).match(/<div class="loaded-meta">[\s\S]*?<\/div>/)[0], /notes-sync|notes-editor/);
  const compact = HTML.match(/@media \(max-width:980px\)\{\n[\s\S]*?\n\}/)[0];
  assert.match(compact, /\.loaded-card \.loaded-label,\.loaded-card \.loaded-meta\{display:none\}/);
  assert.match(compact, /\.loaded-card \.loaded-notes\{grid-row:2;grid-column:1\/-1\}/);
  assert.doesNotMatch(compact, /loaded-notes\{[^}]*display:none/);

  // Change name: the box holds the name and its button is marked; Esc keeps it.
  page.run('askEditorName(true)');
  await tick(5);
  assert.equal(dialogs.length, 2);
  assert.equal(dialogs[1].input.value, 'Kareena');
  assert.equal(dialogs[1].current(), 'Kareena');
  dialogs[1].close('');
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena');
  // A new name (spaces collapsed, a curly apostrophe made straight) is saved here and added for everyone.
  page.run('askEditorName(true)');
  await tick(5);
  dialogs[2].input.value = '  Zoë   O’Brien-Smith ';
  assert.equal(dialogs[2].submit('save'), false);
  await tick(10);
  assert.equal(page.storage.spyderKpiEditorName, "Zoë O'Brien-Smith");
  assert.deepEqual((await site.people()).people.map((p) => p.name), ["Zoë O'Brien-Smith", 'Kareena', 'Jamie Cole']);
  assert.match(sidebar(page), /Change name/);
  // A saved name typed in other capitals keeps the saved spelling (one person in the list).
  page.run('askEditorName(true)');
  await tick(5);
  dialogs[3].input.value = 'jamie cole';
  dialogs[3].submit('save');
  await tick(10);
  assert.equal(page.storage.spyderKpiEditorName, 'Jamie Cole');
  assert.equal((await site.people()).people.length, 3);
  clock(page, '2026-09-24T11:00:00Z');
  edit(page, '901', 'notes', 'by Jamie');
  await sendNow(page);
  assert.equal((await site.doc()).rows[keyOf(page, '901')].by, 'Jamie Cole');
  assert.deepEqual(page.errors, []);

  // Not now: never asked again in this browser, edits go out without a name.
  const other = await openBrowser(site);
  const more = catchDialogs(other);
  await other.ctx.restoreSavedReport();
  await other.ctx.syncSharedNotes();
  other.run(`toggleRowNote(${JSON.stringify(k)})`);
  await tick(5);
  assert.equal(more.length, 1, 'opening a note editor asks before the first edit');
  more[0].skip();
  assert.equal(other.storage.spyderKpiEditorName, '');
  edit(other, '902', 'notes', 'no name');
  await tick(5);
  assert.equal(more.length, 1);
  await sendNow(other);
  assert.equal((await site.doc()).rows[keyOf(other, '902')].by, '');
  assert.match(sidebar(other), /data-tip="Add your name to the notes you save\.">Add your name<\/button>/);
});

test('Your name: a long list shows the 12 names seen most recently, Find your name narrows it and Enter picks the first match', async () => {
  const site = fakeSite();
  const names = Array.from({ length: 20 }, (_, i) => `Person ${String.fromCharCode(65 + i)}`);
  names[15] = 'Kareena Kapoor';
  await seedPeople(site, names);
  const page = await openBrowser(site, { storage: { spyderKpiEditorName: 'Person B' } });
  const dialogs = catchDialogs(page);
  await upload(page);
  await page.ctx.syncSharedNotes();
  page.run('askEditorName(true)');
  await tick(20);
  const d = dialogs[0];
  // The list is read again when the dialog opens (this browser has a name, so it was not read on page open).
  assert.equal(peopleCalls(site, 'GET'), 1);
  assert.equal(d.filter.hidden, false, 'Find your name shows for more than 12 names');
  // This browser's name was sent when the page opened (first time today), so it is the most recently seen.
  assert.deepEqual(d.names(), ['Person B', ...names.filter((n) => n !== 'Person B')].slice(0, 12));
  assert.equal(d.current(), 'Person B');
  d.find('kapoor');
  assert.deepEqual(d.names(), ['Kareena Kapoor']);
  d.find('nobody');
  assert.deepEqual(d.names(), []);
  assert.match(d.chips.innerHTML, /No match\. Type it below as a new name\./);
  // Enter with nothing typed picks no one (the first name is someone else's) and does not submit the form.
  d.find('  ');
  assert.equal(d.findEnter(), true);
  assert.equal(d.removed, false, 'a stray Enter in an empty Find box picks no name');
  assert.equal(page.storage.spyderKpiEditorName, 'Person B');
  d.find('kareena');
  assert.equal(d.findEnter(), true, 'Enter in the Find box does not submit the form');
  assert.equal(d.removed, true);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena Kapoor');
});

test('Your name: initials saved before 2v2 are stamped until the name is given, show only as a hint in the Your name box, and the name is asked once', async () => {
  const site = fakeSite();
  const page = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
  const dialogs = catchDialogs(page);
  await upload(page);
  await page.ctx.syncSharedNotes();
  edit(page, '900', 'notes', 'before the name');
  await tick(5);
  const k = keyOf(page, '900');
  assert.equal(page.run(`rowOverrides[${JSON.stringify(k)}].by`), 'KK', 'the old initials until the name is given');
  assert.equal(dialogs.length, 1, 'asked although initials were saved');
  assert.equal(dialogs[0].input.value, '', 'the initials are not put in the box as a value');
  assert.equal(dialogs[0].input.placeholder, 'Before: KK', 'they show as a hint');
  assert.equal(dialogs[0].people.hidden, true, 'no saved names yet');
  assert.equal(dialogs[0].label.textContent, 'Your name', 'no list: the box is labelled Your name, not New name');
  assert.match(dialogs[0].innerHTML, /<input id="editor-name"[^>]* data-tip="Type your name\."/);
  // Save with the box left empty (only the hint showing) asks for a name; it never saves the initials.
  assert.equal(dialogs[0].submit('save'), true);
  assert.match(dialogs[0].error.textContent, /1 to 40 letters/);
  assert.match(dialogs[0].innerHTML, /<input id="editor-name"[^>]* autofocus/);
  assert.match(dialogs[0].innerHTML, /<h2 id="editor-dialog-title">/, 'no saved names: the New name box has the focus, not the title');
  dialogs[0].input.value = 'Kareena Kapoor';
  dialogs[0].submit('save');
  await tick(10);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena Kapoor');
  assert.equal(page.storage.spyderKpiEditor, undefined, 'the initials are no longer kept');
  await sendNow(page);
  assert.equal((await site.doc()).rows[k].by, 'Kareena Kapoor', 'the edit made while asked carries the name');
  assert.deepEqual((await site.people()).people.map((p) => p.name), ['Kareena Kapoor']);
  edit(page, '901', 'notes', 'after');
  await tick(5);
  assert.equal(dialogs.length, 1);
  // Not now to the initials question before 2v2 is kept: not asked again by itself; the sidebar offers it.
  const reads = peopleCalls(site, 'GET');
  const skipped = await openBrowser(site, { storage: { spyderKpiEditor: '' } });
  const none = catchDialogs(skipped);
  await skipped.ctx.restoreSavedReport();
  await skipped.ctx.syncSharedNotes();
  edit(skipped, '902', 'notes', 'x');
  await tick(5);
  assert.equal(none.length, 0);
  assert.match(sidebar(skipped), />Add your name<\/button>/);
  assert.equal(peopleCalls(site, 'GET'), reads, 'the browser that answered before reads no names on open');
});

test('Your name: × removes a saved name for everyone after a confirm; the list and the box label follow; a failure says so', async () => {
  const site = fakeSite();
  await seedPeople(site, ['Jamie Cole', 'Jamie Cloe', 'Kareena']);
  const page = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  const dialogs = catchDialogs(page);
  await upload(page);
  await page.ctx.syncSharedNotes();
  page.run('askEditorName(true)');
  await tick(20);
  const d = dialogs[0];
  assert.deepEqual(d.names(), ['Kareena', 'Jamie Cole', 'Jamie Cloe']);
  assert.equal(d.label.textContent, 'New name');
  // Cancel at the confirm: nothing is sent.
  const asked = [];
  page.ctx.confirm = (q) => { asked.push(q); return false; };
  d.unlist('Jamie Cloe');
  await tick(10);
  assert.deepEqual(asked, ['Remove “Jamie Cloe” from the names list for everyone?']);
  assert.equal(peopleCalls(site, 'DELETE'), 0);
  assert.deepEqual(d.names(), ['Kareena', 'Jamie Cole', 'Jamie Cloe']);
  // OK: removed for everyone; the dialog stays open on the shorter list; no name is picked.
  page.ctx.confirm = () => true;
  d.unlist('Jamie Cloe');
  await tick(10);
  assert.equal(peopleCalls(site, 'DELETE'), 1);
  assert.deepEqual((await site.people()).people.map((p) => p.name), ['Kareena', 'Jamie Cole']);
  assert.deepEqual(d.names(), ['Kareena', 'Jamie Cole']);
  assert.deepEqual([d.removed, d.error.textContent, d.label.textContent], [false, '', 'New name']);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena');
  // The last names gone: the list hides and the box is labelled Your name. This browser keeps its own name.
  d.unlist('Jamie Cole');
  await tick(10);
  d.unlist('Kareena');
  await tick(10);
  assert.deepEqual(d.names(), []);
  assert.equal(d.people.hidden, true);
  assert.equal(d.label.textContent, 'Your name');
  assert.deepEqual((await site.people()).people, []);
  assert.equal(page.storage.spyderKpiEditorName, 'Kareena');
  d.close('');
  // The server cannot be reached: the dialog says so and the list stays as it was.
  await seedPeople(site, ['Jamie Cole']);
  page.run('askEditorName(true)');
  await tick(20);
  const d2 = dialogs[1];
  assert.deepEqual(d2.names(), ['Jamie Cole']);
  site.peopleDown = true;
  d2.unlist('Jamie Cole');
  await tick(10);
  assert.equal(d2.error.textContent, 'The name could not be removed. Try again later.');
  assert.deepEqual(d2.names(), ['Jamie Cole']);
  assert.deepEqual((await site.people()).people.map((p) => p.name), ['Jamie Cole']);
  assert.deepEqual(page.errors, []);
});

test('the name is sent to the shared list at most once a day when the page opens; offline, a static host and a failed save stay quiet', async () => {
  const site = fakeSite();
  await seedPeople(site, ['Kareena']);
  // Typed in other capitals in an earlier version of this page: the saved spelling is taken.
  const storage = { spyderKpiEditorName: 'kareena' };
  await openHosted(site, { storage });
  await tick(10);
  assert.equal(peopleCalls(site, 'POST'), 1);
  assert.equal(peopleCalls(site, 'GET'), 0, 'a browser with a name reads no names on open');
  assert.equal(storage.spyderKpiEditorName, 'Kareena');
  const seen = JSON.parse(storage.spyderKpiNameSeenV1);
  assert.equal(seen.name, 'Kareena');
  assert.equal((await site.people()).people.length, 1);
  // The same browser again the same day: nothing sent.
  await openHosted(site, { storage });
  await tick(10);
  assert.equal(peopleCalls(site, 'POST'), 1);
  // A day later: sent again.
  storage.spyderKpiNameSeenV1 = JSON.stringify({ ...seen, at: seen.at - 25 * 3600000 });
  await openHosted(site, { storage });
  await tick(10);
  assert.equal(peopleCalls(site, 'POST'), 2);
  // The server cannot be reached for names: no error, and it is tried again on the next open.
  const flaky = fakeSite();
  flaky.peopleDown = true;
  const fs2 = { spyderKpiEditorName: 'Aaron' };
  const p = await openHosted(flaky, { storage: fs2 });
  await tick(10);
  assert.equal(peopleCalls(flaky, 'POST'), 1);
  assert.equal(fs2.spyderKpiNameSeenV1, undefined);
  assert.equal(fs2.spyderKpiEditorName, 'Aaron');
  assert.deepEqual(p.errors, []);
  flaky.peopleDown = false;
  await openHosted(flaky, { storage: fs2 });
  await tick(10);
  assert.equal(peopleCalls(flaky, 'POST'), 2);
  assert.deepEqual((await flaky.people()).people.map((x) => x.name), ['Aaron']);
  // A static host and a server that is down: no requests for names, the name stays in this browser, no errors.
  for (const mode of ['static', 'down']) {
    const s = fakeSite();
    s.mode = mode;
    const st = { spyderKpiEditorName: 'Kareena' };
    const page = await openBrowser(s, { storage: st });
    await upload(page);
    await page.ctx.syncSharedNotes();
    page.run('askEditorName()');
    await tick(10);
    assert.equal(peopleCalls(s), 0, mode);
    assert.equal(st.spyderKpiEditorName, 'Kareena');
    edit(page, '900', 'notes', 'kept here');
    assert.equal(saved(page)[keyOf(page, '900')].by, 'Kareena', 'edits here still carry the name');
    assert.deepEqual(page.errors, [], mode);
  }
});

test('every name shown is escaped (saved names, the last editor, this browser); a stored value that is not a name is asked again', async () => {
  const site = fakeSite();
  await seedPeople(site, ["Zoë O'Brien-Smith", 'Kareena']);
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  // A note saved by a page before 2v2, when the server took any text of up to 16 characters as initials.
  const k = keyOf(a, '900');
  await site.env.REPORT_STORE.put('overrides', JSON.stringify({ v: 1, rows: { [k]: { notes: 'old', by: '"><svg/onload=1>', at: '2026-09-01T10:00:00.000Z' } }, shipments: {}, savedAt: '' }));
  // This browser's name was edited by hand into something that is not a name: it counts as never asked.
  const b = await openHosted(site, { storage: { spyderKpiEditorName: '<img src=x onerror=alert(1)>' } });
  const full = sidebar(b);
  const bar = full.slice(full.indexOf('<div class="loaded-notes">'));
  assert.match(bar, /last edit &quot;&gt;&lt;svg\/onload=1&gt; · Sep 1/);
  assert.match(bar, /data-tip="[^"]*last edit by &quot;&gt;&lt;svg\/onload=1&gt;:/);
  assert.ok(!/<svg|<img/.test(bar), 'no markup from a stored name');
  assert.match(bar, />Add your name<\/button>/);
  assert.equal(b.run('readEditor()'), null);
  const dialogs = catchDialogs(b);
  edit(b, '901', 'notes', 'new');
  await tick(10);
  assert.equal(dialogs.length, 1, 'asked, as the stored value is not a name');
  const d = dialogs[0];
  assert.match(d.chips.innerHTML, /data-name="Zoë O&#39;Brien-Smith"[^>]*>Zoë O&#39;Brien-Smith<\/button>/);
  assert.doesNotMatch(d.innerHTML, /<img|onerror=alert/, 'the bad stored value is not put in the New name box');
  assert.equal(b.run(`rowOverrides[${JSON.stringify(keyOf(b, '901'))}].by`), '', 'nor stamped on the edit');
  d.pick("Zoë O'Brien-Smith");
  await tick(10);
  assert.equal(b.storage.spyderKpiEditorName, "Zoë O'Brien-Smith");
  assert.match(sidebar(b), /data-tip="Your notes show “Zoë O&#39;Brien-Smith”; click to change it\.">Change name<\/button>/);
  assert.deepEqual(b.errors, []);
});

test('at-risk history: each upload records its At Risk lines (all filters off) and firstFlagged gives the first week', async () => {
  const site = fakeSite();
  const a = await openBrowser(site);
  await upload(a);
  const k900 = keyOf(a, '900');
  const k901 = keyOf(a, '901');
  let hist = await site.history();
  assert.deepEqual(hist.weeks.map((w) => [w.asOf, w.keys.sort()]), [['2026-09-03', [k900, k901].sort()]]);
  assert.deepEqual(a.run('firstFlagged'), { [k900]: '2026-09-03', [k901]: '2026-09-03' });
  // A filter on screen does not change what is recorded, and is still on afterwards.
  a.run("weeklyWarehouseFilter=['CM - Alpha'];renderResults()");
  assert.equal(atRiskCount(a), 1);
  assert.deepEqual(a.run('reportAtRiskWeek().keys').sort(), [k900, k901].sort());
  assert.deepEqual(a.run('weeklyWarehouseFilter'), ['CM - Alpha']);

  // A week later: 900 still at risk, 901 shipped (now due in October), 903 new.
  const week2 = [
    sapRow({ DocumentNumber: '900', 'Internal Number': '900', ExportDate: '09/10/2026' }),
    sapRow({ DocumentNumber: '901', 'Internal Number': '901', Warehouse: 'CM - Alpha', ExportDate: '09/10/2026', DueDate: '10/15/2026', HeaderDueDate: '10/15/2026', LineDueDate: '10/15/2026' }),
    sapRow({ DocumentNumber: '903', 'Internal Number': '903', ExportDate: '09/10/2026', DueDate: '09/05/2026', HeaderDueDate: '09/05/2026', LineDueDate: '09/05/2026' }),
  ];
  await upload(a, kpi(week2, 'kpi_0910.xls'));
  const k903 = keyOf(a, '903');
  hist = await site.history();
  assert.deepEqual(hist.weeks.map((w) => w.asOf), ['2026-09-03', '2026-09-10']);
  assert.deepEqual(a.run('firstFlagged'), { [k900]: '2026-09-03', [k901]: '2026-09-03', [k903]: '2026-09-10' });
  // The same export again (or Add file) replaces that week instead of adding one.
  await upload(a, kpi(week2, 'kpi_0910_again.xls'));
  assert.equal((await site.history()).weeks.length, 2);

  // Another browser reads the history when it opens.
  const b = await openHosted(site);
  assert.deepEqual(b.run('firstFlagged'), { [k900]: '2026-09-03', [k901]: '2026-09-03', [k903]: '2026-09-10' });
  assert.ok(site.calls.includes('GET /api/history'));
});

test('at-risk history in the page follows the server: one entry per week, uploads in a week merged', async () => {
  const page = loadPage();
  const merged = page.run(`mergeAtRiskWeeks([{asOf:'2026-09-09',savedAt:'a',keys:['x','y']}],[{asOf:'2026-09-11',savedAt:'b',keys:['y','z']},{asOf:'2026-09-14',savedAt:'c',keys:['w']}])`);
  assert.deepEqual(merged, [{ asOf: '2026-09-09', savedAt: 'b', keys: ['x', 'y', 'z'] }, { asOf: '2026-09-14', savedAt: 'c', keys: ['w'] }]);
  // A week just saved here and the server's merged entry for that week stay one entry; 52 weeks kept.
  const weeks = Array.from({ length: 60 }, (_, i) => ({ asOf: new Date(Date.UTC(2025, 0, 6) + i * 7 * 864e5).toISOString().slice(0, 10), savedAt: '', keys: [] }));
  const kept = page.run(`mergeAtRiskWeeks(${JSON.stringify(weeks)},[{asOf:${JSON.stringify(weeks[59].asOf)},savedAt:'z',keys:['n']}])`);
  assert.equal(kept.length, 52);
  assert.deepEqual(kept[51], { asOf: weeks[59].asOf, savedAt: 'z', keys: ['n'] });
  page.run(`atRiskWeeks=mergeAtRiskWeeks([{asOf:'2026-09-09',savedAt:'a',keys:['x']},{asOf:'2026-09-11',savedAt:'b',keys:['z']}]);refreshFirstFlagged()`);
  assert.deepEqual(page.run('firstFlagged'), { x: '2026-09-09', z: '2026-09-09' });
});

test('without shared storage there is no history: firstFlagged stays empty (every line counts as new this week)', async () => {
  const site = fakeSite();
  site.mode = 'static';
  const page = await openBrowser(site);
  await upload(page);
  await page.ctx.loadAtRiskHistory();
  assert.deepEqual(page.run('firstFlagged'), {});
  // The harness page (no fetch at all, like the MCP server) never asks.
  const bare = loadPage();
  await tick(0);
  assert.deepEqual(bare.run('firstFlagged'), {});
  assert.equal(bare.run('sharedNotes.state'), '');
});

test('Shipping page helpers: manual tracking numbers are saved here and shared like notes', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  clock(a, '2026-10-08T15:00:00Z');
  assert.equal(a.run("sharedNotesPatchShipments({'m-900':{order:'900',number:'7712 3456 7890',carrier:'FedEx'},'bad/id':{order:'1',number:'2'}})"), 1);
  assert.deepEqual(a.run('getSharedShipments()'), { 'm-900': { order: '900', number: '7712 3456 7890', carrier: 'FedEx', by: 'Kareena', at: '2026-10-08T15:00:00.000Z' } });
  await sendNow(a);
  assert.equal((await site.doc()).shipments['m-900'].number, '7712 3456 7890');
  const b = await openHosted(site);
  assert.deepEqual(Object.keys(b.run('getSharedShipments()')), ['m-900']);
  clock(b, '2026-10-08T16:00:00Z');
  b.run("sharedNotesPatchShipments({'m-900':{order:'900',number:'7712 3456 7890',deleted:true}})");
  await sendNow(b);
  assert.deepEqual(b.run('getSharedShipments()'), {});
  assert.equal(b.run('getSharedShipments({includeDeleted:true})')['m-900'].deleted, true);
  assert.equal(JSON.parse(b.storage.spyderKpiShipmentsV1)['m-900'].deleted, true);
});

test('search finds a line by a tracking number someone else added by hand as soon as it arrives with the shared notes', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditorName: 'Quinn' } });
  b.run("onGlobalSearchInput('770012345678');applyGlobalSearch()");
  const found = () => b.run('globalSearchResults(currentMetrics()).rows.map(x=>x.r.documentNumber)');
  assert.deepEqual(found(), []);
  const metrics = b.run('(globalThis.__m=currentMetrics(),1)');
  assert.equal(metrics, 1);
  clock(a, '2026-10-08T15:00:00Z');
  a.run("sharedNotesPatchShipments({'770012345678':{order:'900',number:'770012345678',carrier:'FedEx'}})");
  await sendNow(a);
  // B reads the notes again (the page comes back into view): the number comes in, the metrics stay as they were.
  b.run('sharedNotes.syncedAt=0');
  await b.ctx.syncSharedNotes();
  assert.equal(b.run('currentMetrics()===globalThis.__m'), true, 'no metrics rebuild for a tracking number');
  assert.deepEqual(found(), ['900']);
  assert.match(html(b), /Tracking <mark>770012345678<\/mark>/);
});

test('only a reply that clearly says "no notes API" stops sharing; a platform 503 / 500 error page is retried and keeps cleared-line markers', async () => {
  // noNotesApi: the function's own 503 {configured:false}, or a 404 / 405 that is not JSON (IIS, a static copy).
  const page = loadPage();
  page.ctx.Response = Response;
  const check = (status, type, body) => page.run(`(()=>{const r=new Response(${JSON.stringify(body)},{status:${status},headers:{'content-type':${JSON.stringify(type)}}});let d=null;try{d=JSON.parse(${JSON.stringify(body)});}catch(e){}return noNotesApi(r,d);})()`);
  assert.equal(check(503, 'application/json', '{"configured":false,"error":"not set up"}'), true);
  assert.equal(check(503, 'text/html', '<html>Service unavailable</html>'), false, 'a platform 503 page');
  assert.equal(check(503, 'application/json', '{"error":"busy"}'), false);
  assert.equal(check(404, 'text/html', '<title>Not found</title>'), true);
  assert.equal(check(405, '', ''), true);
  assert.equal(check(404, 'application/json', '{"error":"no route"}'), false, 'a JSON 404 from a proxy');
  assert.equal(check(500, 'text/html', '<html>error</html>'), false);

  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  clock(a, '2026-10-08T15:00:00Z');
  edit(a, '900', 'notes', 'Ship short, customer OK');
  await sendNow(a);
  const k = keyOf(a, '900');
  // The note is cleared; the one PATCH carrying the marker gets the platform's 503 error page (HTML).
  await tick(1200);
  site.failPatches = 1; site.failKind = 503;
  clock(a, '2026-10-08T16:00:00Z');
  edit(a, '900', 'notes', '');
  await tick(900);
  assert.equal(a.run('sharedNotes.state'), 'shared', 'still shared');
  assert.ok(JSON.parse(a.storage.spyderKpiNotesClearedV1)[k], 'the cleared-line marker is kept');
  assert.equal(a.run(`notesReady.has(${JSON.stringify('rows|' + k)})`), true, 'queued again');
  assert.match(sidebar(a), /trying again in a moment/);
  assert.doesNotMatch(sidebar(a), /in this browser only/);
  // The page is reloaded before the retry: the marker goes out with the merge and the note stays cleared.
  a.run('clearTimeout(notesRetryTimer);notesRetryTimer=null;clearTimeout(notesPatchGate);notesPatchGate=null;notesReady.clear()');
  const again = await openHosted(site, { storage: a.storage });
  assert.deepEqual((await site.doc()).rows[k], { by: 'Kareena', at: '2026-10-08T16:00:00.000Z' });
  assert.equal(line(again, '900').notes, '');

  // Reading the notes: a 503 error page is "not reachable now" (tried again when the page comes back into view).
  let failGets = 1;
  const flaky = { ...site, fetch: (url, init = {}) => (url === '/api/notes' && !init.method && failGets-- > 0
    ? Promise.resolve(new Response('<html>Service unavailable</html>', { status: 503, headers: { 'content-type': 'text/html' } }))
    : site.fetch(url, init)) };
  const b = await openBrowser(flaky, { storage: { spyderKpiEditorName: 'Quinn' } });
  await upload(b);
  await b.ctx.syncSharedNotes();
  assert.equal(b.run('sharedNotes.state'), 'offline');
  assert.match(sidebar(b), /server not reachable/);
  b.run('sharedNotes.syncedAt=0');
  b.ctx.refreshSharedNotes();
  await tick(30);
  await settle(b);
  assert.equal(b.run('sharedNotes.state'), 'shared');
  // A 500 while re-reading leaves a shared page shared (it used to stop sharing for the rest of the visit).
  failGets = 1;
  const flaky500 = flaky.fetch;
  flaky.fetch = (url, init = {}) => (url === '/api/notes' && !init.method && failGets-- > 0 ? Promise.resolve(new Response('oops', { status: 500 })) : flaky500(url, init));
  b.ctx.fetch = flaky.fetch;
  b.run('sharedNotes.syncedAt=0');
  await b.ctx.syncSharedNotes();
  assert.equal(b.run('sharedNotes.state'), 'shared');

  // The function's own "not set up" answer, and a 405 page for the PATCH, do mean "this browser only".
  const bare = fakeSite();
  delete bare.env.REPORT_STORE;
  const c = await openBrowser(bare);
  await upload(c);
  await c.ctx.syncSharedNotes();
  assert.equal(c.run('sharedNotes.state'), 'local');
  const site2 = fakeSite();
  const d = await openBrowser(site2, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(d);
  await d.ctx.syncSharedNotes();
  site2.failPatches = 1; site2.failKind = 405;
  edit(d, '901', 'status', 'Hold');
  await tick(900);
  await tick(20);
  assert.equal(d.run('sharedNotes.state'), 'local');
  assert.match(sidebar(d), /Notes saved in this browser only/);
});

test('a save the server refuses (sign-in expired) stays listed after a later save works, and the next read sends it', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  await settle(a);
  const k900 = keyOf(a, '900'), k901 = keyOf(a, '901');
  clock(a, '2026-10-08T15:00:00Z');
  site.failPatches = 1; site.failKind = 401;
  edit(a, '900', 'status', 'Hold');
  await tick(900);
  await settle(a);
  assert.equal(a.run('notesUnsent.size'), 1);
  assert.equal(a.run('!!notesRetryTimer'), false, 'a refusal is not retried by itself');
  assert.match(sidebar(a), /Notes not shared: 1 change was not saved \(sign-in expired, reload and sign in again\)/);
  // Another line saves fine: the warning stays, since 900 is still not on the server.
  await tick(1200);
  edit(a, '901', 'status', 'QC Delay');
  await tick(900);
  await settle(a);
  let doc = await site.doc();
  assert.equal(doc.rows[k901].status, 'QC Delay');
  assert.equal(doc.rows[k900], undefined);
  assert.match(sidebar(a), /Notes not shared: 1 change was not saved/);
  // The next read of the notes (the page comes back into view, or the re-read after a save) sends it.
  a.run('sharedNotes.syncedAt=0');
  await a.ctx.syncSharedNotes();
  await settle(a);
  doc = await site.doc();
  assert.equal(doc.rows[k900].status, 'Hold');
  assert.equal(a.run('notesUnsent.size'), 0);
  assert.doesNotMatch(sidebar(a), /Notes not shared/);
  // Editing the refused line again also clears it from the list once that save works.
  await tick(1200);
  site.failPatches = 1; site.failKind = 413;
  clock(a, '2026-10-08T15:05:00Z');
  edit(a, '902', 'notes', 'refused once');
  await tick(900);
  await settle(a);
  assert.match(sidebar(a), /1 change was not saved \(server error 413\)/);
  await tick(1200);
  clock(a, '2026-10-08T15:06:00Z');
  edit(a, '902', 'notes', 'saved the second time');
  await tick(900);
  await settle(a);
  assert.equal((await site.doc()).rows[keyOf(a, '902')].notes, 'saved the second time');
  assert.doesNotMatch(sidebar(a), /Notes not shared/);
});

test('two different edits with the same time end up the same everywhere: the server keeps the first, every browser takes it', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditorName: 'Aaron' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditorName: 'Kareena' } });
  const k = keyOf(a, '900');
  const T = '2026-10-08T15:00:00Z';
  clock(a, T); clock(b, T);
  edit(a, '900', 'status', 'Hold');
  edit(b, '900', 'status', 'QC Delay');
  await sendNow(a);
  await sendNow(b);
  assert.equal((await site.doc()).rows[k].status, 'Hold', 'the server keeps the entry it stored first');
  assert.equal(line(b, '900').status, 'Hold', 'B takes the server copy from the reply');
  assert.equal(saved(b)[k].status, 'Hold');
  assert.equal(saved(b)[k].by, 'Aaron');
  // Through a read: C holds its own copy with the same time (and a hand-added tracking number), the server's wins.
  a.run("sharedNotesPatchShipments({'m-900':{order:'900',number:'770012345678',carrier:'FedEx'}})");
  await sendNow(a);
  const storage = {
    spyderKpiEditorName: 'Casey',
    spyderKpiRowOverridesV1: JSON.stringify({ [k]: { status: 'Customer hold', by: 'Casey', at: '2026-10-08T15:00:00.000Z' } }),
    spyderKpiShipmentsV1: JSON.stringify({ 'm-900': { order: '900', number: '770099999999', carrier: 'FedEx', by: 'Casey', at: '2026-10-08T15:00:00.000Z' } }),
  };
  const before = site.patches();
  const c = await openHosted(site, { storage });
  assert.equal(line(c, '900').status, 'Hold');
  assert.equal(c.run("getSharedShipments()['m-900'].number"), '770012345678');
  assert.equal(site.patches(), before, 'nothing pushed back');
  // The same content with the same time is the same edit: nothing changes, nothing is sent.
  const d = await openHosted(site, { storage: { spyderKpiRowOverridesV1: JSON.stringify({ [k]: (await site.doc()).rows[k] }) } });
  assert.equal(line(d, '900').status, 'Hold');
  assert.equal(site.patches(), before);
});

test('a save sent while the page is hidden or closed (keepalive) stays under the browsers\' 64 KiB limit; the rest goes after', async () => {
  const site = fakeSite();
  const sends = [];
  const browser = { ...site, fetch: async (url, init = {}) => {
    const bytes = init.body ? Buffer.byteLength(init.body) : 0;
    if (init.method === 'PATCH') sends.push({ keepalive: !!init.keepalive, bytes, lines: Object.keys(JSON.parse(init.body).rows).length });
    // Chromium refuses keepalive bodies over 64 KiB ("Failed to fetch"); the server never sees them.
    if (init.keepalive && bytes > 65536) throw new TypeError('Failed to fetch');
    return site.fetch(url, init);
  } };
  const a = await openBrowser(browser, { storage: { spyderKpiEditorName: 'Kareena' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  await settle(a);
  // A bulk action on 450 lines (non-ASCII notes count 2 to 3 bytes a character), then the tab is hidden within the
  // 800 ms wait.
  a.run(`for(let i=0;i<450;i++){const k='T|'+(10000+i)+'|1';rowOverrides[k]={status:'Hold',notes:'Délai fournisseur – 供应商延迟 – en attente de pièces '+i,by:'Kareena',at:'2026-10-08T15:00:00.000Z'};queueSharedNote('rows',k);}`);
  await a.run('flushSharedNotes({all:true,keepalive:true})');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].keepalive, true);
  assert.ok(sends[0].bytes <= 60 * 1024, `keepalive body ${sends[0].bytes} bytes`);
  assert.ok(sends[0].lines > 100 && sends[0].lines < 450, `${sends[0].lines} lines in the first batch`);
  assert.equal(a.run('notesReady.size'), 450 - sends[0].lines, 'the rest waits for the next save');
  assert.doesNotMatch(sidebar(a), /not reachable/);
  await settle(a);
  assert.equal(sends[1].keepalive, false, 'the rest goes in a normal save while the page is still open');
  const doc = await site.doc();
  assert.equal(Object.keys(doc.rows).filter((k) => k.startsWith('T|')).length, 450);
  // A batch the browser refuses anyway (or no network) goes back in the queue instead of being lost.
  a.run(`for(let i=0;i<3;i++){const k='T|'+(10000+i)+'|1';rowOverrides[k]={...rowOverrides[k],notes:'x'.repeat(4000),at:'2026-10-08T16:00:00.000Z'};}`);
  site.failPatches = 1; site.failKind = 'down';
  await tick(1200);
  a.run(`for(let i=0;i<3;i++)queueSharedNote('rows','T|'+(10000+i)+'|1')`);
  await a.run('flushSharedNotes({all:true,keepalive:true})');
  assert.equal(a.run('notesReady.size'), 3);
  await settle(a);
  assert.equal((await site.doc()).rows['T|10000|1'].notes.length, 4000);
});

run();
