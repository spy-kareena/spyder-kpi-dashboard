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

run();
