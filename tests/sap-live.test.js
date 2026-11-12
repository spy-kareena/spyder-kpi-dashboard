// Live SAP on the page, through the real functions/api/sap function, with a stand-in SAP bridge serving what the real
// one serves (UTF-8, tab separated, ISO dates, plain numbers, SQL column names). Synthetic data only.
// 2v6.7: Load from SAP (import mode). 2v6.8: live by default (start-up, the 5-minute read, the dot, disconnected and
// back, the kept live data, Settings > Data Source). Run: node tests/sap-live.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, sapExport, sapRow, createSuite } = require('./harness');

const { test, run } = createSuite();
const ORIGIN = 'https://kpi.example.test';
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const until = async (fn, what) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setImmediate(r)); } assert.fail(`timed out: ${what}`); };
const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
// The synthetic sample export in the bridge's layout: the CSV's columns, tab separated (it has no quoted fields).
const BRIDGE_KPI = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-so-po.csv'), 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').join('\t')).join('\r\n') + '\r\n';
const ENV = { SAP_BRIDGE_URL: 'https://sap-bridge.example.test', SAP_BRIDGE_KEY: 'bridge-key' };

let sapApi;
const api = async () => {
  if (!sapApi) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'sap', '[[path]].js'), 'utf8');
    sapApi = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).onRequest;
  }
  return sapApi;
};

// A site: /api/sap/* goes to the real function; the function's fetch reaches the stand-in bridge. Other /api calls
// (notes, report, history) answer 404 so the page keeps everything in this browser.
function fakeSite({ env = ENV, bridge = { kpi: { status: 200, body: BRIDGE_KPI }, 'supply-demand': { status: 502, body: '{"error":"not today"}' } } } = {}) {
  const site = { calls: [], bridgeCalls: [], bridge, down: false };
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    site.bridgeCalls.push({ path: u.pathname + u.search, key: init.headers['X-API-Key'] });
    const name = u.pathname.replace('/api/reports/', '');
    if (site.down) throw new TypeError('fetch failed');
    const r = site.bridge[name] || { status: 404, body: '{"error":"unknown"}' };
    const headers = r.status === 200
      ? { 'content-type': 'text/tab-separated-values; charset=utf-8', 'content-disposition': `attachment; filename="SAP_live_${name === 'kpi' ? 'KPI' : 'supply_demand'}_2026-09-24.txt"`, ...(r.headers || {}) }
      : { 'content-type': 'application/json' };
    return new Response(r.body, { status: r.status, headers });
  };
  site.fetch = async (url, init = {}) => {
    const u = String(url);
    site.calls.push(`${init.method || 'GET'} ${u}`);
    if (!u.startsWith('/api/sap/')) return new Response('', { status: 404 });
    const handler = await api();
    const p = u.replace('/api/sap/', '').split('?')[0];
    return handler({ request: new Request(ORIGIN + u, init), env, params: { path: p.split('/') } });
  };
  return site;
}
async function openPage(site, { storage = IMPORT } = {}) {
  const page = loadPage({ storage });
  await tick();
  Object.assign(page.ctx, {
    fetch: site.fetch, Blob, File, Response,
    location: { href: ORIGIN + '/', protocol: 'https:' },
    // Real File objects (from Load from SAP) and the harness's {name, bytes} test files.
    FileReader: class {
      readAsArrayBuffer(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength)) : f.arrayBuffer()).then((b) => this.onload({ target: { result: b } })); }
      readAsText(f) { (ArrayBuffer.isView(f.bytes) ? Promise.resolve(Buffer.from(f.bytes).toString('utf8')) : f.text()).then((t) => this.onload({ target: { result: t } })); }
    },
  });
  page.run('isSnapshotView=false');
  return page;
}
const header = (page) => page.els['app-header'].innerHTML;
const summary = (page) => page.run('({rows:allLoadedRows.length,files:loadedFiles.map(f=>f.name),asOf:reportAsOfDate?[reportAsOfDate.getFullYear(),reportAsOfDate.getMonth()+1,reportAsOfDate.getDate()].join("-"):""})');

test('without a bridge nothing changes: no Load from SAP, no Refresh from SAP', async () => {
  const site = fakeSite({ env: {} });
  const page = await openPage(site);
  await page.ctx.sapLiveCheck();
  assert.ok(site.calls.includes('GET /api/sap/status'));
  assert.equal(page.run('canLoadFromSap()'), false);
  page.ctx.showUpload();
  assert.equal(page.els['sap-live-row'].hidden, true);
  await page.ctx.handleFiles([{ name: 'export.xls', bytes: sapExport([sapRow()]) }]);
  assert.ok(!header(page).includes('Refresh'));
  await page.ctx.loadFromSap();
  assert.ok(!site.calls.some((c) => c.includes('/api/sap/kpi')), 'a call while not set up does nothing');
});

test('a static host, a file:// copy or a shared snapshot never asks for /api/sap', async () => {
  const site = fakeSite();
  const page = await openPage(site);
  page.ctx.location = { href: 'file:///C:/kpi/index.html', protocol: 'file:' };
  await page.ctx.sapLiveCheck();
  page.ctx.location = { href: ORIGIN + '/', protocol: 'https:' };
  page.run('isSnapshotView=true');
  await page.ctx.sapLiveCheck();
  assert.deepEqual(site.calls, []);
  page.run('sapLive.configured=true');
  assert.equal(page.run('canLoadFromSap()'), false, 'a snapshot never offers it');
});

test('Load from SAP reads the live KPI report and shows the same lines as the export', async () => {
  const site = fakeSite();
  const page = await openPage(site);
  await page.ctx.sapLiveCheck();
  page.ctx.showUpload();
  assert.equal(page.els['sap-live-row'].hidden, false, 'the upload screen offers Load from SAP');
  await page.ctx.loadFromSap();
  await settle();
  const s = summary(page);
  assert.equal(s.rows, 5);
  assert.deepEqual(s.files, ['SAP_live_KPI_2026-09-24.txt']);
  assert.equal(s.asOf, '2026-9-10', 'the export date comes from the query (ExportDate)');
  assert.deepEqual(site.bridgeCalls.map((c) => c.path).sort(), ['/api/reports/kpi?refresh=1', '/api/reports/supply-demand?refresh=1']);
  assert.ok(site.bridgeCalls.every((c) => c.key === 'bridge-key'));
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.match(page.els['toast'].innerHTML, /supply \/ demand snapshot could not be read, so the supply pages have no data for now/);
  assert.ok(!header(page).includes('data-focus-key="hdr-sap"'), 'import mode: the popover has Add file, New file and Share snapshot only');
  assert.match(header(page), /data-focus-key="sidebar-new"/);
  assert.deepEqual(page.alerts, []);

  // Same lines, dates and amounts as uploading the sample export by hand.
  const byHand = await openPage(fakeSite());
  await byHand.ctx.handleFiles([new File([fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-so-po.csv'))], 'sample-so-po.csv')]);
  await settle();
  const pick = 'JSON.stringify(allLoadedRows.map(r=>[r.documentNumber,r.sourceType,r.itemCode,+r.dueDate,r.quantity,r.openQuantity,r.amountLocal,r.status]).sort())';
  assert.equal(page.run(pick), byHand.run(pick));
});

test('Refresh from SAP replaces an uploaded export; Clear To Build, the Logican sheet and (if the live one fails) supply / demand stay', async () => {
  const site = fakeSite();
  const page = await openPage(site);
  await page.ctx.sapLiveCheck();
  await page.ctx.handleFiles([{ name: 'old-export.xls', bytes: sapExport([sapRow()]) }]);
  // Files already loaded, as handleFiles keeps them: the rows read are in fileReadCache. handleFiles is wrapped to
  // record what Load from SAP hands it (then loads only the live files, the stand-ins have no real content).
  page.run(`
    globalThis.__addOthers=()=>{
      const mk=(name,rows)=>{const f=new File(['x'],name);fileReadCache.set(f,{rows});return f;};
      const cm=[];cm.cmSheet=[{kind:'open',records:[]}];
      loadedFiles=[...loadedFiles,
        mk('ctb.xlsx',[{CM:'DSM',Month:'Nov',ClearToBuild:1,AtRisk:0}]),
        mk('logican.xlsx',cm),
        mk('supply.xls',[{DemandOpenQty:1,UsableSupplyQty:1,MonthlyNetQty:0,CumulativeNetQty:0}])];
    };
    __addOthers();
    globalThis.__sent=null;
    const realHandle=handleFiles;
    handleFiles=async(files,opts)=>{globalThis.__sent=files.map(f=>f.name);return realHandle(files.filter(f=>/SAP_live/.test(f.name)),opts);};
  `);
  await page.ctx.loadFromSap();
  await settle();
  assert.deepEqual(page.run('globalThis.__sent'), ['SAP_live_KPI_2026-09-24.txt', 'ctb.xlsx', 'logican.xlsx', 'supply.xls']);

  // With the live supply / demand snapshot, the old one is replaced too.
  const site2 = fakeSite({ bridge: { kpi: { status: 200, body: BRIDGE_KPI }, 'supply-demand': { status: 200, body: 'ItemCode\tDemandOpenQty\tUsableSupplyQty\tMonthlyNetQty\r\nSPY-100\t1\t1\t0\r\n' } } });
  page.ctx.fetch = site2.fetch;
  page.run('__addOthers()');
  await page.ctx.loadFromSap();
  await settle();
  assert.deepEqual(page.run('globalThis.__sent'), ['SAP_live_KPI_2026-09-24.txt', 'SAP_live_supply_demand_2026-09-24.txt', 'ctb.xlsx', 'logican.xlsx']);
});

test('when SAP cannot be read: on the load screen the error shows there; on a report the report stays and a toast says why', async () => {
  const down = fakeSite({ bridge: { kpi: { status: 502, body: JSON.stringify({ error: "SAP report 'kpi' failed: (10, 'authentication failed')" }) } } });
  const page = await openPage(down);
  await page.ctx.sapLiveCheck();
  page.ctx.showUpload();
  await page.ctx.loadFromSap();
  assert.equal(page.run('allLoadedRows.length'), 0);
  assert.equal(page.els['upload-screen'].style.display, 'block');
  assert.match(page.els['upload-error'].textContent, /Load from SAP did not work: SAP report 'kpi' failed: \(10, 'authentication failed'\)\./);

  await page.ctx.handleFiles([{ name: 'export.xls', bytes: sapExport([sapRow(), sapRow({ DocumentNumber: '501' })]) }]);
  await settle();
  const unreachable = fakeSite();
  page.ctx.fetch = async (url, init) => (String(url).startsWith('/api/sap/kpi') ? Promise.reject(new TypeError('offline')) : unreachable.fetch(url, init));
  await page.ctx.loadFromSap();
  assert.equal(page.run('allLoadedRows.length'), 2, 'the loaded report stays');
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['export.xls']);
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.match(page.els['toast'].innerHTML, /Load from SAP did not work: the site could not be reached\./);
  assert.equal(page.run('sapLive.busy'), false);
});

test('a second click while SAP is being read does nothing', async () => {
  const site = fakeSite();
  const page = await openPage(site);
  await page.ctx.sapLiveCheck();
  const first = page.ctx.loadFromSap();
  await page.ctx.loadFromSap();
  await first;
  await settle();
  assert.equal(site.calls.filter((c) => c.startsWith('GET /api/sap/kpi')).length, 1);
});

test('markup: the buttons carry tips; the version is the same in the page and VERSION.txt', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="sap-live-btn"[^>]*data-tip="[^"]+"/);
  assert.match(html, /data-focus-key="hdr-sap"[^`]*tipAttr\('Read SAP now, skipping the 5-minute cache\.'\)\}>Refresh now<\/button>/);
  assert.match(html, /data-focus-key="stg-ds-refresh"[^`]*tipAttr\('[^']+'\)/);
  const version = html.match(/<meta name="app-version" content="([^"]+)">/)[1];
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'VERSION.txt'), 'utf8'), new RegExp(`^Version: ${version.replace(/\./g, '\\.')}$`, 'm'));
});


// --- 2v6.8: live by default ---
// Timers of 30 s and more (the 5-minute read, retries, the minute label) are held, not run: fire(fn) runs the live one.
function holdTimers(page) {
  const held = [];
  page.ctx.setTimeout = (fn, ms, ...a) => { if (ms >= 30000) { const t = { fn, ms, a }; held.push(t); return t; } return setTimeout(fn, ms, ...a); };
  page.ctx.clearTimeout = (t) => { const i = held.indexOf(t); if (i >= 0) held.splice(i, 1); else clearTimeout(t); };
  return {
    live: () => held.filter((t) => t.fn === page.ctx.liveTick).map((t) => t.ms),
    fire: () => { const t = held.find((x) => x.fn === page.ctx.liveTick); assert.ok(t, 'a live read is scheduled'); held.splice(held.indexOf(t), 1); t.fn(); },
  };
}
// A page opened as the browser does (startApp) in live mode (the default), with in-memory stand-ins for both browser
// copies: the live one (liveStore) and the import one (reportStore).
async function openLive(site, { storage = {}, liveRec = null, importFiles = null, start = true } = {}) {
  const page = await openPage(site, { storage });
  page.timers = holdTimers(page);
  const mem = (db) => (mode, use) => Promise.resolve(use({ put: (v, k) => { db[k] = v; return { result: k }; }, get: (k) => ({ result: db[k] }) }).result);
  page.liveDb = liveRec ? { last: liveRec } : {};
  page.importDb = importFiles ? { last: importFiles } : {};
  page.ctx.liveStore = mem(page.liveDb);
  page.ctx.reportStore = mem(page.importDb);
  page.run('loadEmbeddedSnapshot=()=>{}');
  if (start) { page.ctx.startApp(); await until(() => !page.run('liveState.busy') && ['ok', 'down', 'off'].includes(page.run('liveState.status')), 'live start'); await settle(); }
  return page;
}
// The supply / demand snapshot with the bridge's columns (so the import report has nothing to say).
const SD_HEAD = ['ExportDate', 'ItemCode', 'ItemDescription', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'MonthStart', 'YearMonth', 'DemandOpenQty', 'DemandNoCommitQty', 'DemandOpenValue', 'UsableSupplyQty', 'RescheduledSupplyQty', 'UnconfirmedSupplyQty', 'NoCommitSupplyQty', 'LateSupplyQty', 'RiskSupplyQty', 'DemandOrderCount', 'MonthlyNetQty', 'CumulativeNetQty', 'MonthlyCoverageStatus', 'CumulativeCoverageStatus', 'SupplyRiskFlag'];
const SD_FULL = [SD_HEAD.join('\t'), ['2026-09-10', 'SPY-100', 'Controller board', 'Electronics', '01', 'Spyder - Lacombe', '2026-09-01', '2026-09', '10', '0', '12500', '4', '0', '0', '0', '0', '0', '2', '-6', '-6', 'Short', 'Short', 'OK'].join('\t')].join('\r\n') + '\r\n';
const liveSite = (opts) => fakeSite({ bridge: { kpi: { status: 200, body: BRIDGE_KPI, headers: { 'x-refreshed-at': '2026-09-24T09:58:00-06:00', 'x-row-count': '5' } }, 'supply-demand': { status: 200, body: SD_FULL } }, ...opts });
const sapCalls = (site) => site.calls.filter((c) => c.includes('/api/sap/'));

test('live is the default: start-up reads SAP (status, then both reports through the 5-minute cache), not the saved report', async () => {
  const site = liveSite();
  const page = await openLive(site, { importFiles: [{ name: 'old-import.xls', bytes: sapExport([sapRow()]) }] });
  assert.equal(page.run("stgValue('dataSource')"), 'live');
  assert.deepEqual(sapCalls(site), ['GET /api/sap/status', 'GET /api/sap/kpi', 'GET /api/sap/supply-demand']);
  assert.ok(!site.calls.some((c) => c.includes('/api/report')), 'the shared report is not read');
  assert.deepEqual(site.bridgeCalls.map((c) => c.path).sort(), ['/api/reports/kpi', '/api/reports/supply-demand']);
  assert.deepEqual(summary(page).files, ['SAP_live_KPI_2026-09-24.txt', 'SAP_live_supply_demand_2026-09-24.txt']);
  assert.equal(summary(page).rows, 5);
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.equal(page.run('liveState.status'), 'ok');
  // The dot: green and pulsing, left of the date; its words in the tooltip and the date button's name.
  const h = header(page);
  assert.match(h, /id="hdr-date-btn"[^>]*aria-label="Live · Updated [^"]+"[^>]*data-tip="Live · Updated [^"]+"><span class="live-pulse ok" aria-hidden="true"><\/span><span class="hdr-date-txt">10 Sep<\/span>/);
  // Live reads are kept in this browser's live copy, never in the import copy or the shared report.
  assert.deepEqual([...page.liveDb.last.files].map((f) => f.name), summary(page).files);
  assert.equal(page.liveDb.last.dataAt, Date.parse('2026-09-24T09:58:00-06:00'));
  assert.deepEqual([...page.importDb.last].map((f) => f.name), ['old-import.xls'], 'the import copy is left as it was');
  assert.ok(!site.calls.some((c) => c.startsWith('PUT')));
  assert.deepEqual(page.alerts, []);
});

test('the header has no Upload or Export PDF icon; the live popover is short: status, one quiet line, three actions', async () => {
  const site = liveSite();
  const page = await openLive(site);
  page.run("dzOpenMenu='hdr-file';renderSidebar()");
  const h = header(page);
  assert.ok(!/id="hdr-upload"|id="hdr-pdf"|data-focus-key="export-pdf"|data-focus-key="hdr-upload"/.test(h));
  assert.equal(typeof page.ctx.exportPdf, 'undefined');
  const pop = h.slice(h.indexOf('id="hdr-file-pop"'));
  assert.match(pop, /aria-label="Live SAP"/);
  assert.match(pop, /<div class="hdr-pop-label"><span class="live-pulse ok" aria-hidden="true"><\/span>Live SAP<\/div><div class="hdr-pop-name">Connected · Updated [^<]+<\/div><div class="hdr-pop-meta">\d+ lines · Export date 2026-09-10<\/div>/);
  assert.deepEqual([...pop.matchAll(/class="dz-btn"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ['Refresh now', 'Add file', 'Share snapshot']);
  const words = pop.replace(/<[^>]+>/g, ' ');
  assert.ok(!/Saved for everyone|Saved in this browser|View import report|Logican|notes/i.test(words), `no where-it-is-kept, notes, Logican or import report lines: ${words}`);
  // Import mode: the file name, the quiet line, Add file / New file / Share snapshot, no dot.
  const imp = await openPage(liveSite());
  await imp.ctx.handleFiles([{ name: 'export.xls', bytes: sapExport([sapRow()]) }]);
  imp.run("dzOpenMenu='hdr-file';renderSidebar()");
  const ih = header(imp);
  assert.ok(!ih.includes('live-pulse'));
  assert.match(ih, /<div class="hdr-pop-label">Loaded export<\/div><div class="hdr-pop-name">export\.xls<\/div><div class="hdr-pop-meta">1 line · Export date 2026-09-03<\/div>/);
  assert.deepEqual([...ih.matchAll(/class="dz-btn"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ['Add file', 'New file', 'Share snapshot']);
});

test('every 5 minutes: read again without refresh=1; the same text changes nothing, new text reloads in place', async () => {
  const site = liveSite();
  const page = await openLive(site);
  assert.deepEqual(page.timers.live(), [300000]);
  page.run("setTab('purchaseorders');poVendorFilter=['TTI'];globalThis.__rows=allLoadedRows;globalThis.__loads=0;const h=handleFiles;handleFiles=(...a)=>{__loads++;return h(...a);}");
  page.timers.fire();
  await until(() => !page.run('liveState.busy'), 'poll');
  assert.deepEqual(sapCalls(site).slice(3), ['GET /api/sap/kpi', 'GET /api/sap/supply-demand'], 'no refresh=1, no status');
  assert.equal(page.run('__loads'), 0, 'identical data is not loaded again');
  assert.equal(page.run('allLoadedRows===__rows'), true);
  assert.deepEqual(page.timers.live(), [300000]);
  // New text from SAP: loaded in place, on the same page with the same filter.
  site.bridge.kpi = { ...site.bridge.kpi, body: BRIDGE_KPI.replace(/\r\n$/, '') + '\r\n' + BRIDGE_KPI.split('\r\n')[1].replace(/\t\d+\t/, '\t9999\t') + '\r\n' };
  page.timers.fire();
  await until(() => page.run('__loads') === 1 && !page.run('liveState.busy'), 'reload');
  await settle();
  assert.equal(page.run('allLoadedRows===__rows'), false);
  assert.equal(page.run('activeTab'), 'purchaseorders');
  assert.deepEqual(page.run('poVendorFilter'), ['TTI']);
  assert.equal(page.run('liveState.status'), 'ok');
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.ok(!site.calls.some((c) => c.startsWith('PUT')), 'polls never write the shared report');
});

test('a read that falls due while the page is hidden waits until it is visible again', async () => {
  const site = liveSite();
  const page = await openLive(site);
  const before = sapCalls(site).length;
  page.ctx.document.visibilityState = 'hidden';
  page.timers.fire();
  await settle();
  assert.equal(sapCalls(site).length, before, 'nothing read while hidden');
  page.ctx.document.visibilityState = 'visible';
  page.dispatch('visibilitychange', {});
  await until(() => sapCalls(site).length === before + 2 && !page.run('liveState.busy'), 'read on visible');
  page.dispatch('visibilitychange', {});
  await settle();
  assert.equal(sapCalls(site).length, before + 2, 'only once');
});

test('SAP cannot be read: the data stays, the dot turns red, retries at 30 s, 1, 2, then 5 min; one toast; green again on recovery', async () => {
  const site = liveSite();
  const page = await openLive(site);
  site.down = true;
  page.timers.fire();
  await until(() => page.run('liveState.status') === 'down', 'down');
  assert.equal(summary(page).rows, 5, 'the data on screen stays');
  assert.equal(page.els['results-screen'].style.display, 'block');
  assert.match(page.els['toast'].innerHTML, /Live SAP disconnected: The SAP bridge could not be reached\. Is the bridge PC on and its tunnel running\?\. The data on screen stays\.|Live SAP disconnected: The SAP bridge could not be reached/);
  assert.match(header(page), /aria-label="Disconnected · Showing data from [^"]+"[^>]*><span class="live-pulse down" aria-hidden="true">/);
  const waits = [page.timers.live()[0]];
  page.els['toast'].innerHTML = '';
  for (let i = 0; i < 4; i++) { page.timers.fire(); await until(() => !page.run('liveState.busy') && page.timers.live().length, 'retry'); waits.push(page.timers.live()[0]); }
  assert.deepEqual(waits, [30000, 60000, 120000, 300000, 300000]);
  assert.equal(page.els['toast'].innerHTML, '', 'no toast for each retry');
  assert.equal(summary(page).rows, 5);
  page.run("dzOpenMenu='hdr-file';renderSidebar()");
  assert.match(header(page), /<div class="hdr-pop-name">Disconnected since [^<]+ · Showing data from [^<]+<\/div><div class="hdr-pop-meta live-why">The SAP bridge could not be reached/);
  site.down = false;
  page.timers.fire();
  await until(() => page.run('liveState.status') === 'ok', 'back');
  assert.match(page.els['toast'].innerHTML, /Live SAP is back\./);
  assert.match(header(page), /<span class="live-pulse ok"/);
  assert.deepEqual(page.timers.live(), [300000]);
});

test('a stale answer (the bridge sends its last good result because SAP is down) is disconnected: red, data kept, nothing reloaded', async () => {
  const site = liveSite();
  const page = await openLive(site);
  page.run('globalThis.__rows=allLoadedRows');
  site.bridge.kpi = { ...site.bridge.kpi, headers: { 'x-refreshed-at': '2026-09-24T09:40:00-06:00', 'x-stale': '1' } };
  page.timers.fire();
  await until(() => page.run('liveState.status') === 'down', 'stale');
  assert.equal(page.run('liveState.stale'), true);
  assert.equal(page.run('allLoadedRows===__rows'), true, 'the same text is not loaded again');
  assert.match(header(page), /aria-label="SAP not reachable · Showing data from [^"]+"/);
  assert.equal(page.run('liveState.dataAt'), Date.parse('2026-09-24T09:40:00-06:00'));
  assert.deepEqual(page.timers.live(), [30000]);
});

test('the last live data shows at once on the next visit, red until the first read works', async () => {
  const site = liveSite();
  const first = await openLive(site);
  const rec = first.liveDb.last;
  const next = liveSite();
  let release;
  const gate = new Promise((r) => { release = r; });
  const page = await openLive(next, { liveRec: rec, start: false });
  const real = page.ctx.fetch;
  page.ctx.fetch = async (u, i) => { if (String(u) === '/api/sap/status') await gate; return real(u, i); };
  page.ctx.startApp();
  await until(() => page.run('allLoadedRows.length') === 5, 'kept data shown');
  assert.equal(page.run('liveState.status'), 'connecting');
  assert.match(header(page), /<span class="live-pulse down" aria-hidden="true"><\/span>/);
  assert.match(header(page), /aria-label="Connecting · Showing data from [^"]+"/);
  assert.equal(page.els['results-screen'].style.display, 'block');
  release();
  await until(() => page.run('liveState.status') === 'ok', 'read');
  assert.match(header(page), /<span class="live-pulse ok"/);
  // Without a kept copy and with SAP down, the load screen says so and offers Try again and Use import files.
  const down = liveSite();
  down.down = true;
  const empty = await openLive(down);
  assert.equal(empty.els['upload-screen'].style.display, 'block');
  assert.match(empty.els['live-load'].innerHTML, /SAP could not be read<\/h2><p>The SAP bridge could not be reached/);
  assert.match(empty.els['live-load'].innerHTML, />Try again<\/button>.*>Use import files<\/button>/);
  assert.equal(empty.els['upload-shell'].hidden, true, 'no drop area in live mode');
});

test('a site without a bridge, in live mode: "Live SAP isn\'t set up on this site." and Use import files switches to import', async () => {
  const site = fakeSite({ env: {} });
  const page = await openLive(site, { importFiles: [{ name: 'export.xls', bytes: sapExport([sapRow()]) }] });
  assert.equal(page.run('liveState.status'), 'off');
  assert.deepEqual(sapCalls(site), ['GET /api/sap/status']);
  assert.match(page.els['live-load'].innerHTML, /Live SAP isn't set up on this site\.<\/h2>/);
  assert.match(page.els['live-load'].innerHTML, /data-focus-key="live-use-import"[^>]*>Use import files<\/button>/);
  assert.equal(page.run('allLoadedRows.length'), 0, 'the import does not reopen in live mode');
  page.run("stgSet('dataSource','import')");
  await until(() => page.run('allLoadedRows.length') === 1, 'import restored');
  assert.deepEqual(summary(page).files, ['export.xls']);
  assert.equal(page.els['live-load'].hidden, true);
  // A file:// copy is never live.
  const file = await openLive(liveSite(), { start: false });
  file.ctx.location = { href: 'file:///C:/kpi/index.html', protocol: 'file:' };
  file.ctx.startApp();
  await settle();
  assert.equal(file.run('liveState.status'), 'off');
  assert.equal(file.run('liveState.on'), false);
});

test('import mode keeps the old start-up: the saved import reopens, SAP is not read, no dot', async () => {
  const site = liveSite();
  const page = await openLive(site, { storage: IMPORT, importFiles: [{ name: 'export.xls', bytes: sapExport([sapRow(), sapRow({ DocumentNumber: '501' })]) }], start: false });
  Object.assign(page.ctx, { CompressionStream, DecompressionStream });
  page.ctx.startApp();
  await until(() => page.run('allLoadedRows.length') === 2, 'restore');
  await settle();
  assert.ok(site.calls.includes('GET /api/report'), 'the shared report is asked for first');
  assert.ok(!site.calls.some((c) => /\/api\/sap\/(kpi|supply)/.test(c)), 'SAP is not read');
  assert.ok(site.calls.includes('GET /api/sap/status'), 'Load from SAP can still show on the load screen');
  assert.ok(!header(page).includes('live-pulse'));
  assert.equal(page.run('liveState.on'), false);
  assert.deepEqual(page.timers.live(), []);
});

test('Settings > Data Source: Live SAP / Import files, the status, Refresh now (refresh=1), and switching both ways', async () => {
  const site = liveSite();
  const page = await openLive(site, { importFiles: [{ name: 'export.xls', bytes: sapExport([sapRow()]) }] });
  page.run("setTab('settings')");
  let html = page.els['results-screen'].innerHTML;
  const card = () => { const h = page.els['results-screen'].innerHTML; const at = h.indexOf('id="stg-card-source"'); return h.slice(at, h.indexOf('id="stg-card-', at + 1)); };
  // 2v8: the first card of the Data category (no Data Check card here), the first category.
  assert.match(html, /<section class="pg-group stg-cat" id="stg-cat-data"[^>]*>[\s\S]*?<div class="stg-cgrid"><section class="dz-card stg-card dz-fade" id="stg-card-source"/);
  assert.match(card(), /aria-label="Data source"><button type="button" data-focus-key="stg-ds-live" class="on" aria-pressed="true"[^>]*>Live SAP<\/button><button type="button" data-focus-key="stg-ds-import" aria-pressed="false"[^>]*>Import files<\/button>/);
  assert.match(card(), /<span class="live-pulse ok" aria-hidden="true"><\/span><span>Connected · Updated [^<]+<\/span>/);
  assert.match(card(), />Refresh now<\/button>/);
  page.ctx.loadFromSap();
  await until(() => site.bridgeCalls.some((c) => c.path === '/api/reports/kpi?refresh=1') && !page.run('liveState.busy'), 'refresh now');
  assert.match(page.els['toast'].innerHTML, /Up to date: no changes in SAP\./);
  // To import: live reading stops, the last import reopens, Settings stays open.
  page.run("stgSet('dataSource','import')");
  await until(() => summary(page).files[0] === 'export.xls', 'import');
  assert.equal(page.run('liveState.on'), false);
  assert.deepEqual(page.timers.live(), []);
  assert.equal(page.run('activeTab'), 'settings');
  assert.ok(!header(page).includes('live-pulse'));
  assert.match(card(), />Upload files<\/button><button[^>]*>Add file<\/button><button[^>]*>New file<\/button>/);
  assert.match(card(), /Loaded: export\.xls/);
  // And back: the kept live data shows and SAP is read again.
  page.run("stgSet('dataSource','live')");
  await until(() => page.run('liveState.status') === 'ok' && summary(page).files[0].startsWith('SAP_live'), 'live again');
  assert.equal(page.run('activeTab'), 'settings');
  assert.match(header(page), /live-pulse ok/);
});

test('in live mode Add file keeps a Clear To Build / Logican file with the live data (in the live copy), and the next read keeps it', async () => {
  const site = liveSite();
  const page = await openLive(site);
  page.run(`(()=>{const f=new File(['x'],'ctb.xlsx');fileReadCache.set(f,{rows:[{CM:'DSM',Month:'Nov',ClearToBuild:1,AtRisk:0}]});globalThis.__ctb=f;})()`);
  await page.ctx.addFiles([page.ctx.__ctb]);
  await settle();
  assert.ok(summary(page).files.includes('ctb.xlsx'));
  assert.ok(page.liveDb.last.files.some((f) => f.name === 'ctb.xlsx'), 'kept in the live copy');
  assert.equal(page.importDb.last, undefined, 'not in the import copy');
  assert.ok(!site.calls.some((c) => c.startsWith('PUT')));
  site.bridge.kpi = { ...site.bridge.kpi, body: BRIDGE_KPI + BRIDGE_KPI.split('\r\n')[1].replace(/\t\d+\t/, '\t9998\t') + '\r\n' };
  page.timers.fire();
  await until(() => page.run('allLoadedRows.length') === 6 && !page.run('liveState.busy'), 'reload');
  assert.ok(summary(page).files.includes('ctb.xlsx'));
});

test('X-Refreshed-At with a UTC offset or without one (older bridges: local time); relative words', () => {
  const page = loadPage();
  assert.equal(page.run("liveTime('2026-11-12T10:42:05-06:00')"), Date.parse('2026-11-12T16:42:05Z'));
  assert.equal(page.run("liveTime('2026-11-12T16:42:05Z')"), Date.parse('2026-11-12T16:42:05Z'));
  assert.equal(page.run("liveTime('2026-11-12T10:42:05-0600')"), Date.parse('2026-11-12T16:42:05Z'));
  assert.equal(page.run("liveTime('2026-11-12 10:42:05')"), new Date(2026, 10, 12, 10, 42, 5).getTime());
  assert.equal(page.run("liveTime('')"), 0);
  assert.equal(page.run("liveTime('soon')"), 0);
  assert.equal(page.run('liveAgo(Date.now()-30000)'), 'just now');
  assert.equal(page.run('liveAgo(Date.now()-2*60000)'), '2 min ago');
  assert.equal(page.run("liveSig('a\\tb')"), page.run("liveSig('a\\tb')"));
  assert.notEqual(page.run("liveSig('a\\tb')"), page.run("liveSig('a\\tc')"));
});

run();
