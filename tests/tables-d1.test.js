// 2v2 design fix D1: order-line tables (Order Health linked lines, Purchase Orders, Search) that fit a 1366px screen
// with a short Status cell, phone cards under 640px, and print rules (override in the Status cell, scorecard fits).
// Run with `node tests/tables-d1.test.js`. Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const html = (page) => page.els['results-screen'].innerHTML;
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
// Export date 09/03/2026: a past-due line, a no-commit line, a rescheduled line and a purchase order.
const ROWS = [
  sapRow({ DocumentNumber: '100', 'Internal Number': '100', LineNumber: '0', CustomerVendorCode: 'FIREFLY', ...due('08/10/2026') }),
  sapRow({ DocumentNumber: '101', 'Internal Number': '101', LineNumber: '0', CustomerVendorCode: 'AQUHOT', CustomerVendorName: 'Aqua Hot', ...due('08/20/2026'), LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
  sapRow({ DocumentNumber: '102', 'Internal Number': '102', LineNumber: '0', ...due('08/25/2026'), LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
  sapRow({ DocumentNumber: '700', 'Internal Number': '700', SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...due('08/15/2026') }),
];
async function loaded(rows = ROWS) {
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides()');
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(rows) }]);
  return page;
}
const key = (page, doc) => page.run(`rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}))`);
const edit = (page, doc, field, value) => page.run(`updateRowOverride(${JSON.stringify(key(page, doc))},${JSON.stringify(field)},${JSON.stringify(value)})`);
const lineRow = (h, doc) => h.match(new RegExp(`<tr class="line-row[^"]*"[^>]*>\\s*(?:<td class="c-(?:check|type)[\\s\\S]*?</td>\\s*)?<td class="c-doc">${doc}(?:<|\\b)[\\s\\S]*?</tr>`))[0];

test('Order Health lines: one status, its timing and one cause line; the other reasons are in the tip, not a third line', async () => {
  const page = await loaded();
  edit(page, '100', 'status', 'Hold');
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  const row = lineRow(html(page), '100');
  // The status cell: chip, timing, cause line; the extra reason ("Hold") stays in the markup for screen readers only.
  assert.match(row, /<td class="c-st"><div class="c-status"><span class="status-chip bad">Late<\/span><span class="timing">\d+d overdue<\/span><span class="oh-why cause-text-them" data-tip="Cause: Them \(override Hold\)\. Reasons: Past due · no reschedule, Hold\.">Them · Past due · no reschedule<\/span><span class="timing oh-why-more">Hold<\/span><span class="print-ovr">Hold<\/span><\/div><\/td>/);
  assert.match(CSS, /\.lines-table \.oh-why-more\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/);
  assert.doesNotMatch(CSS, /\.search-results \.oh-why-more\{display:none\}/);
  // Chip and timing share a line when they fit; the cause line is one line (its tip has the rest).
  assert.match(CSS, /\.lines-table \.c-status\{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px\}/);
  assert.match(CSS, /\.lines-table \.c-status \.oh-why\{flex-basis:100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  // Ten columns plus the checkbox: no Lead (its weeks are in the delivery date's tip).
  const heads = [...html(page).match(/<table class="lines-table so">[\s\S]*?<\/thead>/)[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  assert.deepEqual(heads, ['', 'SO #', 'Customer', 'Warehouse', 'Item / Description', 'Original delivery', 'Open', 'Value', 'Status', 'Reschedule', 'Notes']);
  assert.match(row, /<td class="c-date" data-label="Original delivery"><span data-tip="Lead time 5\.7 wks \(order date to original delivery\)\.">2026-08-10<\/span><\/td>/);
  assert.match(row, /<td class="c-name" title="Firefly RV"><span class="clip">Firefly RV<\/span><\/td>/);
  // Row checkboxes, sort headers, notes and the bulk bar are all still there.
  assert.match(row, /<input type="checkbox" class="row-check"/);
  assert.match(html(page), /data-focus-key="linked-sort-status"/);
  assert.match(row, /class="note-btn has-note"/);
  page.run('selectAllLinked(true)');
  assert.match(html(page), /<div class="bulk-actions" role="group" aria-label="Selected lines">/);
  assert.deepEqual(page.errors, []);
});

test('Search: no "Line 0" or customer / warehouse code under every row; the timing line only when it adds something', async () => {
  const page = await loaded();
  page.run("onGlobalSearchInput('SPY-100');applyGlobalSearch()");
  const h = html(page);
  assert.doesNotMatch(h, />Line 0</);
  assert.doesNotMatch(h, /<span class="sub">(FIREFLY|AQUHOT|ACME)<\/span>/);
  // No Commit: "No commit date" repeated the chip and the cause line, so it is left out.
  const noCommit = lineRow(h, '101');
  assert.match(noCommit, /<span class="status-chip bad">No Commit<\/span><span class="oh-why cause-text-us"[^>]*>Us · No commit date<\/span>/);
  assert.doesNotMatch(noCommit, /<span class="timing">No commit date<\/span>/);
  // Past due: "Late by …" says how late, which neither the chip nor the cause line says.
  assert.match(lineRow(h, '100'), /<span class="status-chip bad">Past Due<\/span><span class="timing">Late by [^<]+<\/span><span class="oh-why/);
  assert.equal(page.run("searchTimingRepeats('No commit date',['No Commit',''])"), true);
  assert.equal(page.run("searchTimingRepeats('Late by 3 weeks',['Past Due','Past due · no reschedule'])"), false);
  // A code still shows when it is why the row matched.
  page.run("onGlobalSearchInput('aquhot');applyGlobalSearch()");
  assert.match(html(page), /<td class="c-name" title="Aqua Hot"><span class="clip">Aqua Hot<\/span><span class="sub"><mark>AQUHOT<\/mark><\/span><\/td>/);
  assert.deepEqual(page.errors, []);
});

test('phones: order lines, PO lines, Search rows, Build Risk rows and supply rows become cards (CSS only, the markup stays a table)', async () => {
  const phone = CSS.slice(CSS.indexOf('/* --- 2v2 design fix D1'), CSS.indexOf('/* --- end 2v2 design fix D1 --- */'));
  assert.match(phone, /@media \(max-width:640px\)\{/);
  // Order lines: number and value, then the status, customer and warehouse, item, date and quantity, actions.
  assert.match(phone, /\.lines-table>tbody>tr\.line-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas:"doc val" "st st" "name wh" "item item" "date qty" "notes notes";/);
  assert.match(phone, /\.lines-table\.so>tbody>tr\.line-row\{grid-template-columns:auto minmax\(0,1fr\) auto;grid-template-areas:"check doc val" "check st st" "check name wh" "check item item" "check date qty" "check resched notes"\}/);
  assert.match(phone, /\.lines-table\.search>tbody>tr\.line-row\{grid-template-areas:"doc val" "st st" "name wh" "item item" "date qty" "type notes"\}/);
  assert.match(phone, /\.table-scroll>\.lines-table\{min-width:0!important;display:block\}/);
  assert.match(phone, /\.lines-table \.c-date\[data-label\]::before,\.lines-table \.c-qty\[data-label\]::before\{content:attr\(data-label\) " "/);
  // Select all stays reachable on a phone.
  assert.match(phone, /\.lines-table\.so>thead th\.c-check::after\{content:"Select all"/);
  // Label / value cards for the data tables, with the key, the amount and the status first.
  assert.match(phone, /\.data-table\.cards>tbody>tr\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(phone, /\.data-table\.cards td\[data-card=key\]\{order:1;/);
  assert.match(phone, /\.data-table\.cards td\[data-card=amt\]\{order:2;/);
  assert.match(phone, /\.data-table\.cards td\[data-card=st\]\{order:3;grid-column:1\/-1\}/);

  const page = await loaded();
  page.run("setTab('purchaseorders');setPoTileFilter('allopen')");
  const po = html(page).match(/<table class="lines-table po">[\s\S]*?<\/table>/)[0];
  assert.match(po, /<td class="c-date" data-label="Due">/);
  assert.match(po, /<td class="num c-qty" data-label="Qty open">/);
  assert.match(po, /<td class="c-st"><div class="c-status">/);
  // Build Risk / Metrics rows: each cell carries its column name and its card place.
  const rows = page.run("renderRowsTable(parsedRows.filter(r=>r.documentNumber==='100'),{key:'t',title:'T',editable:true})");
  assert.match(rows, /<table class="data-table cards"/);
  assert.match(rows, /<td class="strong" data-label="Doc #" data-card="key">100<\/td>/);
  assert.match(rows, /<td class="num strong" data-label="Amount" data-card="amt">\$1,000<\/td>/);
  assert.match(rows, /<td class="override-cell" data-label="Override" data-card="edit">/);
  assert.equal(page.run("labelTableCells('<tr><td colspan=\"3\">None</td><td class=\"x\">7</td></tr>',[['A'],['B','num','','amt']])"), '<tr><td colspan="3">None</td><td class="x" data-label="B" data-card="amt">7</td></tr>');
  assert.deepEqual(page.errors, []);
});

test('print: the override sits in the Status cell (no extra row per line); the Warehouse scorecard fits its half of the page', async () => {
  const page = await loaded();
  edit(page, '100', 'status', 'Hold');
  edit(page, '101', 'cause', 'them');
  edit(page, '102', 'notes', 'Waiting on boards');
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  const h = html(page);
  assert.match(lineRow(h, '100'), /<span class="print-ovr">Hold<\/span><\/div><\/td>/);
  assert.match(lineRow(h, '101'), /<span class="print-ovr">Cause: Them<\/span>/);
  // Only a written note gets a row under its line, and that row shows just the note.
  assert.equal((h.match(/class="print-note-row/g) || []).length, 1);
  assert.match(h, /<tr class="print-note-row has-print-note"><td colspan="11">\s*<div class="print-note-card"><strong>Note:<\/strong> Waiting on boards<\/div>/);
  assert.match(CSS, /\.print-note-row,\.print-ovr\{display:none\}/);
  const printCss = [...CSS.matchAll(/@media print\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(printCss, /\.print-ovr\{display:block!important;flex-basis:100%;font-size:7pt;/);
  // Scorecard: no 680px minimum on paper, five rate-free columns plus Warehouse; Resched left out.
  assert.match(printCss, /\.table>\.thead,\.table>\.trow,\.table>button\.trow,\.table>\.sc-group-head\{min-width:0!important\}/);
  assert.match(printCss, /\.sc-cols\{grid-template-columns:minmax\(0,1\.7fr\) repeat\(5,minmax\(0,1fr\)\)\}/);
  assert.match(printCss, /\.sc-cols>div:nth-child\(7\)\{display:none\}/);
  page.run("setWeeklyView('lagging');renderResults()");
  const sc = html(page).match(/<div class="thead sc-cols"[\s\S]*?<\/div><\/div>/)[0];
  assert.equal([...sc.matchAll(/<div\b/g)].length - 1, 7, 'the screen scorecard keeps all seven columns');
  assert.match(sc, />Resched<\/div><\/div>$/);
  assert.deepEqual(page.errors, []);
});

run();
