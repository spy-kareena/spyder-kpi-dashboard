// Review fixes for file import (handleFiles / Add file) and share snapshots. Synthetic fixtures only.
// Run: node tests/review-data-import-snapshot.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const SERVER = path.join(__dirname, '..', 'mcp', 'spyder-kpi-mcp.mjs');

test('a failed first load lists no files, and MCP --check reports the real reason', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'empty-result.xls', bytes: sapExport([]) }]);
  assert.match(page.els['upload-error'].textContent, /No rows found/);
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyder kpi review '));
  try {
    const file = path.join(dir, 'empty-result.xls');
    fs.writeFileSync(file, sapExport([]));
    const r = spawnSync(process.execPath, [SERVER, '--check', file], { encoding: 'utf8', env: { ...process.env, SPYDER_KPI_FILES: '' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No rows found in these exports/);
    assert.doesNotMatch(r.stderr, /TypeError/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Add file the way the sidebar does it (addFiles does not return its promise).
async function addFile(page, f) {
  page.ctx.__added = f;
  await page.run('handleFiles([...loadedFiles,__added],{adding:true})');
  await new Promise((r) => setTimeout(r, 10));
}
const textFile = (name, text) => ({ name, bytes: new Uint8Array(Buffer.from(text)) });
const fileIssues = (page) => page.run('dataQualityIssues.filter(i=>i.kind==="file").map(i=>i.message)');

test('Add file with an empty, header-only or unrecognized file reports it and does not list it as loaded', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport([sapRow({})]) }]);
  let reads = 0;
  const read = page.ctx.readExportFile;
  page.ctx.readExportFile = (f) => { reads++; return read(f); };

  await addFile(page, textFile('supply_demand.csv', ''));
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['kpi.xls']);
  assert.deepEqual(fileIssues(page), ['Skipped supply_demand.csv: no rows in the file.']);

  await addFile(page, textFile('sd_header_only.csv', 'Item No.,YearMonth,DemandOpenQty,UsableSupplyQty,MonthlyNetQty,CumulativeNetQty\r\n'));
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['kpi.xls']);
  assert.deepEqual(fileIssues(page), ['Skipped sd_header_only.csv: no rows in the file.']);

  await addFile(page, textFile('notes.csv', 'Account,Budget\nTravel,100\n'));
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['kpi.xls']);
  assert.match(fileIssues(page).join(' '), /Skipped notes\.csv: not a recognized/);
  assert.equal(page.run('parsedRows.length'), 1);

  // A later Add file does not read the skipped files again.
  reads = 0;
  await addFile(page, { name: 'kpi copy.xls', bytes: sapExport([sapRow({})]) });
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['kpi.xls', 'kpi copy.xls']);
  assert.ok(reads <= 2, `read ${reads} files`);
});

const kpiDay = (date, open) => sapExport(['1', '2', '3'].map((doc) => sapRow({ DocumentNumber: doc, ExportDate: date, OpenQuantity: open, DueDate: '10/20/2026', LineDueDate: '10/20/2026', HeaderDueDate: '10/20/2026' })));
const kpiTotals = (page) => page.run('({rows:allLoadedRows.length,openQty:allLoadedRows.reduce((t,r)=>t+r.openQuantity,0),asOf:displayDate(reportAsOfDate),files:loadedFiles.map(f=>f.name)})');

test('a newer KPI export of the same lines replaces the older one, whether added later or loaded together', async () => {
  const added = loadPage();
  await upload(added, [{ name: 'kpi_0903.xls', bytes: kpiDay('09/03/2026', '10.000') }]);
  assert.deepEqual(kpiTotals(added), { rows: 3, openQty: 30, asOf: '2026-09-03', files: ['kpi_0903.xls'] });
  await addFile(added, { name: 'kpi_0910.xls', bytes: kpiDay('09/10/2026', '4.000') });
  assert.deepEqual(kpiTotals(added), { rows: 3, openQty: 12, asOf: '2026-09-10', files: ['kpi_0910.xls'] });
  assert.deepEqual(fileIssues(added), ['Left out kpi_0903.xls (exported 2026-09-03): kpi_0910.xls (exported 2026-09-10) is a newer export of the same lines, so they are not counted twice.']);

  // Both at once, newer first: same result. An older file added to a newer report is left out too.
  const together = loadPage();
  await upload(together, [{ name: 'kpi_0910.xls', bytes: kpiDay('09/10/2026', '4.000') }, { name: 'kpi_0903.xls', bytes: kpiDay('09/03/2026', '10.000') }]);
  assert.deepEqual(kpiTotals(together), { rows: 3, openQty: 12, asOf: '2026-09-10', files: ['kpi_0910.xls'] });
  assert.equal(together.run('new Set(allLoadedRows.map(rowKey)).size'), 3);
});

test('separate SO and PO exports from different days are both kept', async () => {
  const page = loadPage();
  const po = sapExport([sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '40', ExportDate: '09/10/2026' })]);
  await upload(page, [{ name: 'so.xls', bytes: sapExport([sapRow({ ExportDate: '09/09/2026' })]) }, { name: 'po.xls', bytes: po }]);
  assert.deepEqual(kpiTotals(page), { rows: 2, openQty: 20, asOf: '2026-09-10', files: ['so.xls', 'po.xls'] });
  assert.deepEqual(fileIssues(page), []);
});

const SD_HEADERS = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'RiskSupplyQty', 'SupplyRiskFlag'];
const sdDay = (date, demand) => utf16Tsv(SD_HEADERS, [{ ExportDate: date, 'Item No.': 'SPY-100', WarehouseCode: '01', WarehouseName: 'Lacombe', YearMonth: '2026-10', DemandOpenQty: demand, DemandOpenValue: '100', UsableSupplyQty: '0', MonthlyNetQty: `-${demand}`, CumulativeNetQty: `-${demand}`, RiskSupplyQty: '0' }]);

test('a newer supply / demand snapshot replaces the older one', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport([sapRow({})]) }, { name: 'sd_0903.xls', bytes: sdDay('09/03/2026', '20') }]);
  assert.equal(page.run('supplyDemandRows.reduce((t,r)=>t+r.demandOpenQty,0)'), 20);
  await addFile(page, { name: 'sd_0910.xls', bytes: sdDay('09/10/2026', '12') });
  assert.deepEqual(page.run('supplyDemandRows.map(r=>r.demandOpenQty)'), [12]);
  assert.deepEqual(page.run('loadedFiles.map(f=>f.name)'), ['kpi.xls', 'sd_0910.xls']);
  assert.match(fileIssues(page).join(' '), /Left out sd_0903\.xls \(exported 2026-09-03\): sd_0910\.xls/);
  assert.equal(page.run('parsedRows.length'), 1);
});

test('Add file reads and normalizes only the new file; notes, deletions and date checks stay', async () => {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport([sapRow({ DocumentNumber: '1' }), sapRow({ DocumentNumber: '2' }), sapRow({ DocumentNumber: '3', DueDate: '07/16/0202' })]) }]);
  const [k1, k2] = page.run('allLoadedRows.slice(0,2).map(rowKey)');
  page.run(`updateRowOverride(${JSON.stringify(k1)},'notes','call buyer')`);
  page.run(`setRowOverrides([${JSON.stringify(k2)}],"deleted",true)`);
  const before = page.run('({rows:parsedRows.length,issues:dataQualityIssues.map(i=>i.message)})');
  assert.equal(before.rows, 2);
  assert.equal(before.issues.length, 1);

  const calls = { read: 0, normalize: 0 };
  const read = page.ctx.readExportFile;
  const normalize = page.ctx.normalizeRows;
  page.ctx.readExportFile = (f) => { calls.read++; return read(f); };
  page.ctx.normalizeRows = (raw) => { calls.normalize++; return normalize(raw); };
  await addFile(page, { name: 'sd.xls', bytes: sdDay('09/03/2026', '20') });
  await addFile(page, { name: 'notes.csv', bytes: Buffer.from('a,b\n1,2\n') });
  assert.deepEqual(calls, { read: 2, normalize: 0 });
  assert.deepEqual(page.run('({rows:parsedRows.length,issues:dataQualityIssues.filter(i=>i.kind!=="file").map(i=>i.message)})'), before);
  assert.equal(page.run('allLoadedRows[0].overrideNotes'), 'call buyer');
  assert.equal(page.run('supplyDemandRows.length'), 1);

  // A new KPI file is normalized with the rest.
  await addFile(page, { name: 'po.xls', bytes: sapExport([sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '40' })]) });
  assert.equal(calls.normalize, 1);
  assert.equal(page.run('parsedRows.length'), 3);
});

run();
