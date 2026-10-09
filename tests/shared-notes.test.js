// The page side of shared notes (1v7): overrides, notes, Us / Them causes and deleted lines set in one browser show in
// every other browser on the hosted site (functions/api/notes.js); hosts without it keep them in the browser only.
// Also the editor-initials dialog, the cause controls, and the at-risk history ("first flagged").
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
    const name = { '/api/report': 'report', '/api/notes': 'notes', '/api/history': 'history' }[url];
    const fn = await handler(name);
    // A browser sends Origin with every PATCH / PUT; the page's own origin here.
    const headers = { ...(init.headers || {}), ...(method === 'GET' ? {} : { Origin: ORIGIN }) };
    return fn({ request: new Request(ORIGIN + url, { method, body: init.body, headers }), env, params: {} });
  };
  site.doc = async () => JSON.parse((await env.REPORT_STORE.get('overrides', { type: 'text' })) || '{"rows":{},"shipments":{}}');
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
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  assert.equal(a.run('sharedNotes.state'), 'shared');
  clock(a, '2026-10-08T15:00:00Z');
  const k = keyOf(a, '900');
  edit(a, '900', 'status', 'Not At Risk');
  edit(a, '900', 'notes', 'Customer agreed to Oct 20');
  edit(a, '900', 'cause', 'them');
  const entry = { status: 'Not At Risk', notes: 'Customer agreed to Oct 20', cause: 'them', by: 'KK', at: '2026-10-08T15:00:00.000Z' };
  assert.deepEqual(saved(a)[k], entry);
  await sendNow(a);
  assert.equal(site.patches(), 1);
  assert.deepEqual((await site.doc()).rows[k], entry);
  assert.equal(atRiskCount(a), 1);

  const b = await openHosted(site);
  assert.deepEqual(line(b, '900'), { status: 'Not At Risk', notes: 'Customer agreed to Oct 20', cause: 'them', deleted: false });
  assert.equal(atRiskCount(b), 1, 'Not At Risk from the other browser takes the line off At Risk');
  assert.match(sidebar(b), /Notes shared · last edit KK Oct 8/);
  assert.match(sidebar(b), /data-tip="Notes, overrides, Us \/ Them causes and deleted lines are saved on the server[^"]*Last edit by KK on Oct 8, 2026/);
  // The copy is also kept in that browser, for when the server cannot be reached.
  assert.deepEqual(saved(b)[k], entry);
  // Opening the page costs one read; nothing newer here, so nothing is sent back.
  assert.equal(site.patches(), 1);
});

test('changes go out 800 ms after the last change to a line, many lines in one request', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
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
  assert.match(sidebar(a), /Notes shared · last edit KK/);
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
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
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
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'AJ' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditor: 'KK' } });
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
  assert.equal(saved(a)[k].by, 'KK');
  clock(a, '2026-10-08T15:10:00Z');
  edit(a, '900', 'notes', 'A: newest');
  await sendNow(a);
  assert.equal((await site.doc()).rows[k].notes, 'A: newest');
});

test('a page left open reads other people\'s edits again when it comes back into view (at most once a minute)', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'AJ' } });
  await upload(a);
  clock(a, '2026-10-08T15:00:00Z');
  await a.ctx.syncSharedNotes();
  const b = await openHosted(site, { storage: { spyderKpiEditor: 'KK' } });
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
  assert.deepEqual((({ status, notes, by }) => ({ status, notes, by }))((await site.doc()).rows[k]), { status: 'Hold', notes: 'Board arrives Monday', by: 'AJ' });
});

test('clearing a line and restoring deleted lines reach the other browsers too', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  clock(a, '2026-10-08T15:00:00Z');
  edit(a, '900', 'notes', 'temporary');
  a.run(`setRowOverrides([${JSON.stringify(keyOf(a, '901'))}],'deleted',true)`);
  await sendNow(a);
  const bStorage = { spyderKpiEditor: 'QQ' };
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
  assert.deepEqual((await site.doc()).rows[k900], { by: 'KK', at: '2026-10-08T16:00:00.000Z' });
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
  assert.doesNotMatch(sidebar(page), /initials/);
  let asked = '';
  page.ctx.confirm = (m) => { asked = m; return true; };
  page.run(`toggleLinkedRow(${JSON.stringify(keyOf(page, '900'))},true);deleteLinkedSelection()`);
  assert.match(asked, /in this browser and in snapshots you share/);
});

test('when the server cannot be reached, changes stay here and are shared the next time the page opens', async () => {
  const site = fakeSite();
  const first = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
  await upload(first);
  await first.ctx.syncSharedNotes();
  clock(first, '2026-10-08T15:00:00Z');
  edit(first, '901', 'notes', 'to be cleared');
  await sendNow(first);

  site.mode = 'down';
  const storage = { spyderKpiEditor: 'KK' };
  const page = await openBrowser(site, { storage });
  await page.ctx.restoreSavedReport();
  await page.ctx.handleFiles([kpi()]);
  await page.ctx.syncSharedNotes();
  assert.equal(page.run('sharedNotes.state'), 'offline');
  assert.match(sidebar(page), /Notes saved in this browser only \(server not reachable\)/);
  clock(page, '2026-10-08T16:00:00Z');
  edit(page, '900', 'notes', 'typed offline');
  // 901's note came from the server earlier in this browser's life: pretend it is here, then clear it offline.
  page.run(`rowOverrides[${JSON.stringify(keyOf(page, '901'))}]={notes:'to be cleared',by:'KK',at:'2026-10-08T15:00:00.000Z'};allLoadedRows.forEach(applyRowOverride)`);
  edit(page, '901', 'notes', '');
  assert.equal(saved(page)[keyOf(page, '900')].notes, 'typed offline');
  await tick(0);
  assert.ok(JSON.parse(storage.spyderKpiNotesClearedV1)[keyOf(page, '901')]);

  site.mode = 'up';
  const again = await openHosted(site, { storage });
  const doc = await site.doc();
  assert.equal(doc.rows[keyOf(again, '900')].notes, 'typed offline');
  assert.deepEqual(doc.rows[keyOf(again, '901')], { by: 'KK', at: '2026-10-08T16:00:00.000Z' });
  assert.equal(line(again, '901').notes, '');
});

test('a shared snapshot never reads or writes shared notes, and carries the merged notes and first-flagged dates', async () => {
  const site = fakeSite();
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
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
  snap.run(`updateRowOverride(${JSON.stringify(k)},'notes','edited in the snapshot')`);
  await tick(900);
  assert.deepEqual(snapCalls, [], 'no requests from a snapshot');
  assert.ok(site.calls.slice(before).every((c) => !/\/api\/(notes|history)/.test(c)), 'no shared-notes or history requests while the snapshot is open');
  assert.deepEqual(snap.storage, {});
  assert.equal(snap.run('firstFlagged')[k], '2026-09-03');
  assert.equal(snap.run(`allLoadedRows.find(r=>r.documentNumber==='900').overrideCause`), 'us');
  assert.equal(sidebar(snap).includes('Notes shared'), false);
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
  assert.match(select[0], /data-tip="Who the delay is on\./);
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

// A stand-in for <dialog>: records listeners; close(value) fires 'close' like the browser.
function fakeDialog() {
  const listeners = {};
  const field = (id) => ({ id, value: '', textContent: '', focus() {} });
  const input = field('editor-initials');
  const error = field('editor-error');
  const form = { addEventListener: (t, fn) => { listeners[`form:${t}`] = fn; } };
  const skip = { addEventListener: (t, fn) => { listeners[`skip:${t}`] = fn; } };
  const d = {
    opened: 0, removed: false, returnValue: '', innerHTML: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector: (s) => ({ form, '#editor-initials': input, '#editor-error': error, '[data-editor-skip]': skip }[s]),
    addEventListener: (t, fn) => { listeners[t] = fn; },
    showModal() { this.opened++; input.value = /value="([^"]*)"/.exec(this.innerHTML.match(/<input[^>]*>/)[0])[1]; },
    close(v) { if (v !== undefined) this.returnValue = v; listeners.close(); },
    remove() { this.removed = true; },
    // Save: the form submits with the Save button; a submit that is not prevented closes with its value.
    submit(value) { let prevented = false; listeners['form:submit']({ submitter: { value }, preventDefault() { prevented = true; } }); if (!prevented) this.close(value); return prevented; },
    skip() { listeners['skip:click'](); },
    input, error,
  };
  return d;
}

test('editor initials are asked once, in a dialog, and stamped on the edits', async () => {
  const site = fakeSite();
  const page = await openBrowser(site);
  const dialogs = [];
  const create = page.ctx.document.createElement;
  page.ctx.document.createElement = (tag) => (tag === 'dialog' ? (dialogs.push(fakeDialog()), dialogs[dialogs.length - 1]) : create(tag));
  await upload(page);
  await page.ctx.syncSharedNotes();
  edit(page, '900', 'notes', 'first note');
  await tick(5);
  assert.equal(dialogs.length, 1);
  const d = dialogs[0];
  assert.equal(d.opened, 1);
  assert.equal(d.attrs['aria-labelledby'], 'editor-dialog-title');
  assert.match(d.innerHTML, /<h2 id="editor-dialog-title">Your initials<\/h2>/);
  assert.match(d.innerHTML, /<label for="editor-initials">/);
  assert.match(d.innerHTML, /aria-describedby="editor-error"/);
  assert.equal((d.innerHTML.match(/<button type="(submit|button)"[^>]*data-tip="[^"]+"/g) || []).length, 2, 'Save and Not now carry tips');
  // Nothing is sent while the question is open, so the edit goes out with the initials.
  await page.run('flushSharedNotes({all:true})');
  assert.equal(site.patches(), 0);
  d.input.value = '!!';
  assert.equal(d.submit('save'), true, 'bad initials are refused');
  assert.match(d.error.textContent, /1 to 4 letters/);
  d.input.value = 'k.k';
  assert.equal(d.submit('save'), false);
  assert.equal(d.removed, true);
  assert.equal(page.storage.spyderKpiEditor, 'KK');
  await sendNow(page);
  const k = keyOf(page, '900');
  assert.equal((await site.doc()).rows[k].by, 'KK');
  assert.equal(saved(page)[k].by, 'KK');
  // Asked once: later edits do not ask again; the sidebar button changes the initials.
  edit(page, '901', 'notes', 'second');
  await tick(5);
  assert.equal(dialogs.length, 1);
  assert.match(sidebar(page), /<button type="button" class="link-btn notes-editor-btn" data-focus-key="notes-editor" onclick="askEditorInitials\(true\)" data-tip="[^"]+">Your initials: KK<\/button>/);
  page.run('askEditorInitials(true)');
  await tick(5);
  assert.equal(dialogs.length, 2);
  assert.equal(dialogs[1].input.value, 'KK');
  dialogs[1].close(''); // Esc keeps the initials
  assert.equal(page.storage.spyderKpiEditor, 'KK');

  // Not now: never asked again in this browser, edits go out without initials.
  const other = await openBrowser(site);
  const more = [];
  other.ctx.document.createElement = (tag) => (tag === 'dialog' ? (more.push(fakeDialog()), more[more.length - 1]) : create(tag));
  await other.ctx.restoreSavedReport();
  await other.ctx.syncSharedNotes();
  other.run(`toggleRowNote(${JSON.stringify(k)})`);
  await tick(5);
  assert.equal(more.length, 1, 'opening a note editor asks before the first edit');
  more[0].skip();
  assert.equal(other.storage.spyderKpiEditor, '');
  edit(other, '902', 'notes', 'no initials');
  await tick(5);
  assert.equal(more.length, 1);
  await sendNow(other);
  assert.equal((await site.doc()).rows[keyOf(other, '902')].by, '');
  assert.match(sidebar(other), />Add your initials<\/button>/);
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
  const a = await openBrowser(site, { storage: { spyderKpiEditor: 'KK' } });
  await upload(a);
  await a.ctx.syncSharedNotes();
  clock(a, '2026-10-08T15:00:00Z');
  assert.equal(a.run("sharedNotesPatchShipments({'m-900':{order:'900',number:'7712 3456 7890',carrier:'FedEx'},'bad/id':{order:'1',number:'2'}})"), 1);
  assert.deepEqual(a.run('getSharedShipments()'), { 'm-900': { order: '900', number: '7712 3456 7890', carrier: 'FedEx', by: 'KK', at: '2026-10-08T15:00:00.000Z' } });
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

run();
