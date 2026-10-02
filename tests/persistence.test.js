// The last loaded report stays in the browser and reopens on the next visit, until a new report replaces it.
// Run with `node tests/persistence.test.js`. Fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const kpi = (n, amount = '1,000.00') => sapExport(Array.from({ length: n }, (_, i) => sapRow({ DocumentNumber: String(700 + i), 'Internal Number': String(700 + i), AmountLocal: amount })));
const supply = utf16Tsv(['ExportDate', 'Item No.', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty'], [{ ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Main', YearMonth: '2026-10', DemandOpenQty: '10', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6' }]);

// IndexedDB stand-in shared by every page of one test (one browser profile).
function fakeBrowserStore() {
  const db = {};
  const reportStore = (mode, use) => Promise.resolve(use({ put: (v, k) => { db[k] = v; return { result: k }; }, get: (k) => ({ result: db[k] }) }).result);
  return { db, reportStore };
}
// A fresh tab: the harness DOM stub opens every page as an empty snapshot, so start from a normal page.
async function openTab(browser) {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.ctx.reportStore = browser.reportStore;
  page.run('isSnapshotView=false');
  return page;
}
const tick = () => new Promise((r) => setTimeout(r, 10));
const summary = (page) => page.run('({rows:allLoadedRows.length,value:allLoadedRows.reduce((s,r)=>s+r.amount,0),files:loadedFiles.map(f=>f.name),results:document.getElementById("results-screen").style.display})');

test('an uploaded report reopens on the next visit with the same numbers', async () => {
  const browser = fakeBrowserStore();
  const first = await openTab(browser);
  await upload(first, [{ name: 'kpi_0903.xls', bytes: kpi(3) }]);
  await tick();
  assert.deepEqual(Array.from(browser.db.last, (f) => f.name), ['kpi_0903.xls']);
  const before = summary(first);

  const next = await openTab(browser);
  await next.ctx.restoreSavedReport();
  await tick();
  assert.deepEqual(summary(next), before);
  assert.equal(summary(next).results, 'block');
});

test('a new upload replaces the saved report; Add file saves every loaded file', async () => {
  const browser = fakeBrowserStore();
  const page = await openTab(browser);
  await upload(page, [{ name: 'old.xls', bytes: kpi(3) }]);
  await upload(page, [{ name: 'new.xls', bytes: kpi(5) }]);
  await tick();
  assert.deepEqual(Array.from(browser.db.last, (f) => f.name), ['new.xls']);
  await page.ctx.addFiles([{ name: 'supply.xls', bytes: supply }]);
  await tick();
  assert.deepEqual(Array.from(browser.db.last, (f) => f.name), ['new.xls', 'supply.xls']);

  const next = await openTab(browser);
  await next.ctx.restoreSavedReport();
  await tick();
  assert.equal(summary(next).rows, 5);
  assert.equal(next.run('supplyDemandRows.length'), 1);
});

test('a file that fails to load keeps the saved report', async () => {
  const browser = fakeBrowserStore();
  const page = await openTab(browser);
  await upload(page, [{ name: 'good.xls', bytes: kpi(2) }]);
  await tick();
  await upload(page, [{ name: 'notes.txt', bytes: new Uint8Array(Buffer.from('hello\tworld\r\n1\t2\r\n')) }]);
  await tick();
  assert.deepEqual(Array.from(browser.db.last, (f) => f.name), ['good.xls']);
});

test('a shared snapshot never opens the saved report, and nothing is saved before a load', async () => {
  const browser = fakeBrowserStore();
  const empty = await openTab(browser);
  await empty.ctx.restoreSavedReport();
  assert.equal(summary(empty).rows, 0);
  assert.equal(browser.db.last, undefined);

  const page = await openTab(browser);
  await upload(page, [{ name: 'kpi.xls', bytes: kpi(2) }]);
  await tick();
  const snapshot = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  snapshot.ctx.reportStore = browser.reportStore;
  snapshot.run('isSnapshotView=true');
  await snapshot.ctx.restoreSavedReport();
  assert.equal(summary(snapshot).rows, 0);
});

run();
