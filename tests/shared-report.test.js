// The page side of the shared report: an upload is kept on the server (functions/api/report.js) for everyone
// who signs in, and any other browser opens on it; hosts without server storage keep it in the browser only.
// Run with `node tests/shared-report.test.js`. Fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const ORIGIN = 'https://kpi.example.test';
const kpi = (n) => new File([sapExport(Array.from({ length: n }, (_, i) => sapRow({ DocumentNumber: String(900 + i), 'Internal Number': String(900 + i) })))], `kpi_${n}.xls`);
const tick = () => new Promise((r) => setTimeout(r, 20));
let onRequest;
async function api() {
  if (!onRequest) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'report.js'), 'utf8');
    ({ onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
  }
  return onRequest;
}
// The hosted site: the real Pages function over a Workers KV stand-in. status forces a reply (404 = static host).
function fakeSite({ status } = {}) {
  const map = new Map();
  const env = { REPORT_STORE: { get: async (k) => (map.has(k) ? map.get(k).slice().buffer : null), put: async (k, v) => { map.set(k, new Uint8Array(v)); } } };
  const site = { map, calls: [] };
  site.fetch = async (url, init = {}) => {
    site.calls.push(`${init.method || 'GET'} ${url}`);
    if (status) return new Response('<!doctype html>', { status, headers: { 'content-type': 'text/html' } });
    const handler = await api();
    // A browser sends Origin with every PUT; the page's own origin here.
    return handler({ request: new Request(ORIGIN + url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env, params: {} });
  };
  return site;
}
// A browser on its own computer (its own IndexedDB stand-in), with real Blob/File/stream classes.
async function openBrowser(site) {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  const db = {};
  Object.assign(page.ctx, {
    fetch: site.fetch, Blob, File, Response, CompressionStream, DecompressionStream,
    location: { href: ORIGIN + '/', protocol: 'https:' },
    reportStore: (mode, use) => Promise.resolve(use({ put: (v, k) => { db[k] = v; return { result: k }; }, get: (k) => ({ result: db[k] }) }).result),
    FileReader: class { readAsArrayBuffer(f) { f.arrayBuffer().then((b) => this.onload({ target: { result: b } })); } readAsText(f) { f.text().then((t) => this.onload({ target: { result: t } })); } },
  });
  page.run('isSnapshotView=false');
  page.db = db;
  return page;
}
const summary = (page) => page.run('({rows:allLoadedRows.length,value:allLoadedRows.reduce((s,r)=>s+r.amount,0),files:loadedFiles.map(f=>f.name),state:sharedReport.state})');
const sidebar = (page) => page.els['app-sidebar'].innerHTML;

test('an upload is saved on the server and opens in another browser with the same numbers', async () => {
  const site = fakeSite();
  const mine = await openBrowser(site);
  await mine.ctx.handleFiles([kpi(3)]);
  await mine.run("shareQueue");
  await tick();
  assert.ok(site.calls.includes('PUT /api/report'));
  assert.equal(summary(mine).state, 'shared');
  assert.match(sidebar(mine), /Saved for everyone who signs in/);

  const theirs = await openBrowser(site);
  await theirs.ctx.restoreSavedReport();
  await tick();
  assert.deepEqual(summary(theirs), summary(mine));
  assert.match(sidebar(theirs), /Saved for everyone who signs in/);
  // The copy from the server is also kept in that browser, for when the server cannot be reached.
  assert.deepEqual(Array.from(theirs.db.last, (f) => f.name), ['kpi_3.xls']);
});

test('a new upload in any browser replaces the shared report', async () => {
  const site = fakeSite();
  const a = await openBrowser(site);
  await a.ctx.handleFiles([kpi(3)]);
  await a.run("shareQueue");
  const b = await openBrowser(site);
  await b.ctx.handleFiles([kpi(5)]);
  await b.run("shareQueue");
  const c = await openBrowser(site);
  await c.ctx.restoreSavedReport();
  await tick();
  assert.equal(summary(c).rows, 5);
  assert.deepEqual(summary(c).files, ['kpi_5.xls']);
});

test('the shared report wins over an older copy in this browser', async () => {
  const site = fakeSite();
  const other = await openBrowser(site);
  await other.ctx.handleFiles([kpi(4)]);
  await other.run("shareQueue");
  const mine = await openBrowser(site);
  mine.db.last = [kpi(2)];
  await mine.ctx.restoreSavedReport();
  await tick();
  assert.equal(summary(mine).rows, 4);
});

test('a host without server storage keeps the report in this browser only', async () => {
  const site = fakeSite({ status: 404 });
  const page = await openBrowser(site);
  await page.ctx.handleFiles([kpi(2)]);
  await page.run("shareQueue");
  await tick();
  assert.equal(summary(page).state, 'local');
  assert.match(sidebar(page), /Saved in this browser only/);

  const next = await openBrowser(site);
  next.db.last = page.db.last;
  await next.ctx.restoreSavedReport();
  await tick();
  assert.equal(summary(next).rows, 2);
});

test('a refused save says so in the sidebar', async () => {
  const site = fakeSite({ status: 413 });
  const page = await openBrowser(site);
  await page.ctx.handleFiles([kpi(2)]);
  await page.run("shareQueue");
  await tick();
  assert.equal(summary(page).state, 'failed');
  assert.match(sidebar(page), /Not saved for others/);
});

run();
