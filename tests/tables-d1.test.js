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
  // The status cell: chip, timing, reason line; the extra reason ("Hold") stays in the markup for screen readers only.
  // (2v4: Us vs Them is no longer shown on the line; the cause stays in the data and in the class.)
  assert.match(row, /<td class="c-st"><div class="c-status"><span class="dz-chip red">Late<\/span><span class="dz-cell-sub timing">\d+d overdue<\/span><span class="oh-why cause-text-them" data-tip="Reasons: Past due · No reschedule, Hold\.">Past due · No reschedule<\/span><span class="timing oh-why-more">Hold<\/span><span class="print-ovr">Hold<\/span><\/div><\/td>/);
  assert.doesNotMatch(row, /Them · |Us · /);
  assert.match(CSS, /\.lines-table \.oh-why-more\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/);
  assert.doesNotMatch(CSS, /\.search-results \.oh-why-more\{display:none\}/);
  // Chip and timing share a line when they fit; the cause line is one line (its tip has the rest).
  assert.match(CSS, /\.lines-table \.c-status\{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px\}/);
  assert.match(CSS, /\.lines-table \.c-status \.oh-why\{flex-basis:100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  // Ten columns plus the checkbox: no Lead (its weeks are in the delivery date's tip).
  const heads = [...html(page).match(/<table class="lines-table so[^"]*">[\s\S]*?<\/thead>/)[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  assert.deepEqual(heads, ['', 'SO #', 'Customer', 'Warehouse', 'Item / Description', 'Original due', 'Open', 'Value', 'Status', 'Reschedule', 'Notes']);
  assert.match(row, /<td class="c-date" data-label="Original due"><span data-tip="Lead time 5\.7 wks \(order to original delivery\)\.">2026-08-10<\/span><\/td>/);
  assert.match(row, /<td class="c-name" title="Firefly RV"><span class="clip">Firefly RV<\/span><\/td>/);
  // Row checkboxes, sort headers, notes and the bulk bar are all still there.
  assert.match(row, /<input type="checkbox" class="row-check"/);
  assert.match(html(page), /data-focus-key="linked-sort-status"/);
  assert.match(row, /class="note-btn has-note"/);
  page.run('selectAllLinked(true)');
  assert.match(html(page), /<div class="bulk-actions[^"]*" role="group" aria-label="Selected lines">/);
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
  assert.match(noCommit, /<span class="status-chip bad">No Commit<\/span><span class="oh-why cause-text-us"[^>]*>No commit date<\/span>/);
  assert.doesNotMatch(noCommit, /<span class="timing">No commit date<\/span>/);
  // Past due: "Late by …" says how late, which neither the chip nor the cause line says.
  assert.match(lineRow(h, '100'), /<span class="status-chip bad">Past Due<\/span><span class="timing">Late by [^<]+<\/span><span class="oh-why/);
  assert.equal(page.run("searchTimingRepeats('No commit date',['No Commit',''])"), true);
  assert.equal(page.run("searchTimingRepeats('Late by 3 weeks',['Past Due','Past due · No reschedule'])"), false);
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
  // Purchase Order Health's PO lines are a supply table now (sup-tbl sup-po): each cell carries its column name, and
  // under 640px the rows become two-column label / value cards with the item, status and actions full width.
  const po = html(page).match(/<table class="sup-tbl sup-po">[\s\S]*?<\/table>/)[0];
  assert.match(po, /<td class="sup-strong" data-label="PO #">700<\/td>/);
  assert.match(po, /<td data-label="Promised">/);
  assert.match(po, /<td class="num sup-strong" data-label="Open qty">10<\/td>/);
  assert.match(po, /<td class="sup-status" data-label="Status"><span class="dz-chip red">Late<\/span>/);
  const supPhone = CSS.slice(CSS.indexOf('@media (max-width:640px)', CSS.indexOf('.sup-tbl.sup-po,.sup-tbl.sup-sd') - 2000));
  assert.match(supPhone, /\.sup-tbl\.sup-po tr\.sup-row,[^{]*\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);/);
  assert.match(supPhone, /\.sup-tbl td\[data-label\]::before\{content:attr\(data-label\);display:block;/);
  assert.match(supPhone, /\.sup-tbl td\.sup-item,\.sup-tbl td\.sup-status,[^{]*\{grid-column:1\/-1\}/);
  // Build Risk / Metrics rows: each cell carries its column name and its card place.
  const rows = page.run("renderRowsTable(parsedRows.filter(r=>r.documentNumber==='100'),{key:'t',title:'T',editable:true})");
  assert.match(rows, /<table class="data-table cards"/);
  assert.match(rows, /<td class="strong" data-label="Doc #" data-card="key">100<\/td>/);
  assert.match(rows, /<td class="num strong" data-label="Amount" data-card="amt">\$1,000<\/td>/);
  // (Build Risk's override reads as text with one Edit button; both take the full card width at the end.)
  assert.match(rows, /<td class="ovr-cell" data-label="Override" data-card="edit">/);
  assert.match(rows, /<td class="c-edit print-hide" data-card="edit"><button type="button" class="note-btn"/);
  assert.equal(page.run("labelTableCells('<tr><td colspan=\"3\">None</td><td class=\"x\">7</td></tr>',[['A'],['B','num','','amt']])"), '<tr><td colspan="3">None</td><td class="x" data-label="B" data-card="amt">7</td></tr>');
  // A column with no name (Build Risk's Edit button) gets its card place but no empty label.
  assert.equal(page.run("labelTableCells('<tr><td>1</td><td class=\"c-edit\">E</td></tr>',[['A'],['','print-hide','','edit']])"), '<tr><td data-label="A">1</td><td class="c-edit" data-card="edit">E</td></tr>');
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
  // 2v4: Us vs Them is no longer shown, so a picked cause alone prints nothing in the Status cell (no empty span).
  const row101 = h.split('<tr ').find((t) => t.includes('<td class="c-doc">101<'));
  assert.match(row101, /class="oh-why cause-text-them"/);
  assert.doesNotMatch(row101, /print-ovr/);
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
  // 2v6: the scorecard grid left Order Health (2v4) and then became Warehouses to watch on the Warehouse Timeline
  // page; the print rules above stay for it, but the lagging view no longer draws an sc-cols grid.
  page.run("setWeeklyView('lagging');renderResults()");
  assert.doesNotMatch(html(page), /class="thead sc-cols"/);
  assert.deepEqual(page.errors, []);
});

// 2v9 (owner): every column of every table sorts. Supply Mix's Item groups: a title click sorts the column (text A to Z,
// numbers high to low first), again reverses it; aria-sort on that column only; blanks ("—") last either way; ties keep
// the table's own order (most demand first).
const SD_HEAD = ['ExportDate', 'ItemCode', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'UnconfirmedSupplyQty', 'RiskSupplyQty'];
const sd = (item, group, ym, dem, val, sup) => ({ ExportDate: '09/03/2026', ItemCode: item, ItemGroupName: group, WarehouseCode: '01', WarehouseName: 'Spyder - Lacombe', YearMonth: ym, DemandOpenQty: String(dem), DemandOpenValue: String(val),
  UsableSupplyQty: String(sup), MonthlyNetQty: String(sup - dem), CumulativeNetQty: String(sup - dem), UnconfirmedSupplyQty: '0', RiskSupplyQty: '0' });
const SD_ROWS = [sd('B', 'Cables', '2026-09', 10, 1000, 4), sd('D', 'Electronics', '2026-09', 2, 250, 9), sd('M', 'Motors', '2026-10', 30, 5000, 30), sd('A10', 'Adapters', '2026-09', 5, 100, 0)];
async function withSupply() {
  const { utf16Tsv } = require('./harness');
  const page = loadPage();
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }, { name: 'sd.xls', bytes: utf16Tsv(SD_HEAD, SD_ROWS) }]);
  return page;
}
const groupsTable = (h) => (h.match(/<table class="sup-tbl sup-groups">[\s\S]*?<\/table>/) || [''])[0];
const groupNames = (h) => [...groupsTable(h).matchAll(/<td class="sup-strong" data-label="Item group">([^<]+)<\/td>/g)].map((m) => m[1]);
test('Supply Mix: every Item groups column sorts (again reverses), aria-sort on that column only, blanks last', async () => {
  const page = await withSupply();
  page.run("stgSet('hiddenPages',[]);setTab('supplydemand')");
  let t = groupsTable(html(page));
  assert.deepEqual(groupNames(html(page)), ['Motors', 'Cables', 'Adapters', 'Electronics'], 'most demand first by default');
  const ids = [...t.matchAll(/onclick="srtSort\('mix-groups','(\w+)','(asc|desc)',this\)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(ids, ['k:asc', 'orders:desc', 'value:desc', 'pct:desc', 'short:desc', 'big:desc'], 'the board\'s one rule: text A to Z, numbers and rates high to low');
  assert.equal((t.match(/aria-sort=/g) || []).length, 0);
  assert.equal((t.match(/<span class="sort-arrow" aria-hidden="true">↕<\/span>/g) || []).length, 6);
  page.run("srtSort('mix-groups','k','asc')");
  t = groupsTable(html(page));
  assert.deepEqual(groupNames(html(page)), ['Adapters', 'Cables', 'Electronics', 'Motors']);
  assert.match(t, /<th scope="col" aria-sort="ascending"><button type="button" class="th-sort srt-th" data-focus-key="srt-mix-groups-k"[^>]*>Item group<span class="sort-arrow" aria-hidden="true">↑<\/span>/);
  assert.equal((t.match(/aria-sort=/g) || []).length, 1);
  page.run("srtSort('mix-groups','k','asc')");
  assert.deepEqual(groupNames(html(page)), ['Motors', 'Electronics', 'Cables', 'Adapters']);
  assert.match(groupsTable(html(page)), /aria-sort="descending"><button[^>]*srt-mix-groups-k/);
  page.run("srtSort('mix-groups','value','desc')");
  assert.deepEqual(groupNames(html(page)), ['Motors', 'Cables', 'Electronics', 'Adapters']);
  assert.match(groupsTable(html(page)), /<th class="num" scope="col" aria-sort="descending"><button[^>]*srt-mix-groups-value/);
  // Biggest shortage: Cables 6 short, Adapters 5; Motors and Electronics show "—" and stay last, in the table's order.
  page.run("srtSort('mix-groups','big','desc')");
  assert.deepEqual(groupNames(html(page)), ['Cables', 'Adapters', 'Motors', 'Electronics']);
  page.run("srtSort('mix-groups','big','desc')");
  assert.deepEqual(groupNames(html(page)), ['Adapters', 'Cables', 'Motors', 'Electronics']);
  // Coverage: highest first on the first click (2v9 one rule), lowest first on the next.
  page.run("srtSort('mix-groups','pct','desc')");
  page.run("srtSort('mix-groups','pct','desc')");
  assert.deepEqual(groupNames(html(page)).slice(0, 2), ['Adapters', 'Cables']);
  // A new report clears the sort.
  page.run('resetViewState()');
  assert.equal(page.run("srtState('mix-groups')"), null);
  assert.deepEqual(page.errors, []);
});

test('Short or at-risk items: unsorted titles show ↕ like the other tables; a sorted one ↑ / ↓; empty text sorts last', async () => {
  const page = await withSupply();
  page.run("setTab('weekly');setWeeklyView('supply')");
  let h = html(page);
  const sdHead = (x) => (x.match(/<table class="sup-tbl sup-sd">[\s\S]*?<\/thead>/) || [''])[0];
  assert.equal((sdHead(h).match(/<span class="sort-arrow" aria-hidden="true">↕<\/span>/g) || []).length, 8);
  page.run("supSdSort('item')");
  h = html(page);
  assert.match(sdHead(h), /aria-sort="ascending"><button[^>]*sd-sort-item[^>]*>Item<span class="sort-arrow" aria-hidden="true">↑<\/span>/);
  assert.equal((sdHead(h).match(/↕/g) || []).length, 7);
  // Natural number order and blanks last, either way.
  const sorted = (dir) => page.run(`supSdSortRows([{itemCode:'A10'},{itemCode:''},{itemCode:'A9'},{itemCode:'—'}],'item',${dir},()=>0).map(r=>r.itemCode)`);
  assert.deepEqual(sorted(1), ['A9', 'A10', '', '—']);
  assert.deepEqual(sorted(-1), ['A10', 'A9', '', '—']);
  assert.deepEqual(page.errors, []);
});

test('2v9 (owner): renderTableCard sorts every titled column by what its cells show: money and dates by value, text naturally, dashes and words in a number column last; ties keep the order', async () => {
  const page = await loaded();
  const rows = [['B9', '$1,200', '2026-03-01', '12%'], ['b10', '$95', '—', '7%'], ['A2', '$1.2M', '2026-01-15', 'not in export'], ['a2', '$45K', '2025-12-31', '40%']]
    .map((c) => `<tr><td class="m">${c[0]}</td><td class="num">${c[1]}</td><td class="date">${c[2]}</td><td class="num">${c[3]}</td></tr>`);
  const spec = `{key:'t-sort',title:'T',head:[['Name'],['Value','num'],['Date'],['Rate','num'],['','print-hide']],rows:${JSON.stringify(rows)},minWidth:600}`;
  const draw = () => page.run(`renderTableCard(${spec})`);
  const names = () => [...draw().matchAll(/<td class="m">([^<]+)/g)].map((m) => m[1]);
  // Titled columns are sort buttons with their tip; an untitled one stays a plain th.
  assert.equal((draw().match(/<th scope="col"[^>]*><button type="button" class="th-sort oh-th" data-focus-key="ohsort-t-sort-\d"/g) || []).length, 4);
  assert.match(draw(), /<th class="print-hide"><\/th>/);
  assert.doesNotMatch(draw(), /aria-sort/);
  page.run("ohSortBy('t-sort','0','Name')");
  assert.deepEqual(names(), ['A2', 'a2', 'B9', 'b10']);
  assert.match(draw(), /<th scope="col" aria-sort="ascending"><button type="button" class="th-sort oh-th on" data-focus-key="ohsort-t-sort-0"/);
  page.run("ohSortBy('t-sort','0','Name')");
  assert.deepEqual(names(), ['b10', 'B9', 'A2', 'a2']);
  // The board's one rule (2v9): money and rates high to low on the first click, dates earliest first.
  page.run("ohSortBy('t-sort','1','Value')");
  assert.deepEqual(names(), ['A2', 'a2', 'B9', 'b10']);
  page.run("ohSortBy('t-sort','2','Date')");
  assert.deepEqual(names(), ['a2', 'A2', 'B9', 'b10']);
  page.run("ohSortBy('t-sort','2','Date')");
  assert.deepEqual(names(), ['B9', 'A2', 'a2', 'b10']);
  page.run("ohSortBy('t-sort','3','Rate')");
  assert.deepEqual(names(), ['a2', 'B9', 'b10', 'A2']);
  assert.equal((draw().match(/aria-sort=/g) || []).length, 1);
  // Items with renderRow sort the same way, before the pages; a new sort starts at page 1.
  const many = Array.from({ length: 25 }, (_, i) => ({ n: `Item ${25 - i}`, v: i % 5 }));
  const card = `renderTableCard({key:'t-many',title:'M',head:[['Item'],['Qty','num']],items:${JSON.stringify(many)},renderRow:r=>'<tr><td class="m">'+r.n+'</td><td class="num">'+r.v+'</td></tr>'})`;
  page.run(`${card};dzPg['t-many'].page=3;ohSortBy('t-many','0','Item')`);
  const first = [...page.run(card).matchAll(/<td class="m">([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(first, Array.from({ length: 10 }, (_, i) => `Item ${i + 1}`));
  assert.equal(page.run("dzPg['t-many'].page"), 1);
  assert.deepEqual(page.errors, []);
});

run();
