// Live SAP (2v6.7): Load from SAP / Refresh from SAP on the page, through the real functions/api/sap function, with a
// stand-in SAP bridge serving what the real one serves (UTF-8, tab separated, ISO dates, plain numbers, SQL column
// names). Synthetic data only. Run: node tests/sap-live.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, sapExport, sapRow, createSuite } = require('./harness');

const { test, run } = createSuite();
const ORIGIN = 'https://kpi.example.test';
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
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
  const site = { calls: [], bridgeCalls: [] };
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    site.bridgeCalls.push({ path: u.pathname + u.search, key: init.headers['X-API-Key'] });
    const name = u.pathname.replace('/api/reports/', '');
    const r = bridge[name] || { status: 404, body: '{"error":"unknown"}' };
    const headers = r.status === 200
      ? { 'content-type': 'text/tab-separated-values; charset=utf-8', 'content-disposition': `attachment; filename="SAP_live_${name === 'kpi' ? 'KPI' : 'supply_demand'}_2026-09-24.txt"` }
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
async function openPage(site) {
  const page = loadPage();
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
  assert.ok(!header(page).includes('Refresh from SAP'));
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
  assert.ok(header(page).includes('Refresh from SAP'), 'the export-date popover offers Refresh from SAP');
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

test('markup: the new button and the popover action carry tips; the version is 2v6.7 everywhere', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="sap-live-btn"[^>]*data-tip="[^"]+"/);
  assert.match(html, /Refresh from SAP<\/button>/);
  assert.match(html, /data-focus-key="hdr-sap"[^`]*tipAttr\('Read the KPI data straight from SAP now/);
  assert.match(html, /<meta name="app-version" content="2v6\.7">/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'VERSION.txt'), 'utf8'), /^Version: 2v6\.7$/m);
});

run();
