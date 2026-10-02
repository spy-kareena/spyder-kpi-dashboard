// Global search tests. Run: node tests/search.test.js (fixtures are synthetic).
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const closed = (o) => sapRow({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ...o });
const po = (o) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co', ...o });
const ROWS = [
  sapRow({ DocumentNumber: '500', LineNumber: '1', CustomerPONumber: 'CPO-778', 'Project Code': 'PRJ-9' }),
  closed({ DocumentNumber: '500', LineNumber: '1', ClosedDate: '08/05/2026', DeliveryDocNumber: '4411' }),
  sapRow({ DocumentNumber: '501', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Marine', 'Item No.': 'SPY-200', ItemDescription: 'Wiring harness', Warehouse: 'CM - Delta', DueDate: '09/20/2026', LineDueDate: '09/20/2026', HeaderDueDate: '09/20/2026' }),
  po({ DocumentNumber: '40', DueDate: '08/15/2026', LineDueDate: '08/15/2026', HeaderDueDate: '08/15/2026' }),
];
async function loaded(rows = ROWS, extra = []) {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(rows) }, ...extra]);
  return page;
}
// Runs a search right away (skips the debounce) and returns [type, doc #] per order-line match.
function search(page, q) {
  page.run(`onGlobalSearchInput(${JSON.stringify(q)});applyGlobalSearch()`);
  return page.run('globalSearchResults(currentMetrics()).rows.map(x=>[searchRowType(x.r),x.r.documentNumber])');
}
const html = (page) => page.els['results-screen'].innerHTML;

test('every term must match (AND) across document, PO, customer, item, warehouse, owner and project fields', async () => {
  const page = await loaded();
  assert.deepEqual(search(page, 'firefly controller'), [['Sales order', '500'], ['Delivery', '500']]);
  assert.deepEqual(search(page, 'SPY-100 vendor'), [['Purchase order', '40']]);
  assert.deepEqual(search(page, 'cpo-778 lacombe'), [['Sales order', '500']]);
  assert.deepEqual(search(page, 'jamie prj-9'), [['Sales order', '500']]);
  assert.deepEqual(search(page, '4411'), [['Delivery', '500']]);
  assert.deepEqual(search(page, 'acme delta harness'), [['Sales order', '501']]);
  assert.deepEqual(search(page, 'firefly delta'), []);
  // Sales and purchase orders come back together, open lines first by due date.
  assert.deepEqual(search(page, 'spy-100'), [['Sales order', '500'], ['Purchase order', '40'], ['Delivery', '500']]);
  search(page, 'SPY-100 vendor');
  assert.equal(page.run('activeTab'), 'search');
  assert.match(html(page), /<h1 class="page-title"[^>]*>Search<\/h1>/);
  assert.match(html(page), /<span class="page-meta"[^>]*>1 match for “SPY-100 vendor”<\/span>/);
  assert.match(html(page), /<mark>Vendor<\/mark> Co/);
  assert.match(html(page), /<td class="c-type">Purchase order<\/td>/);
  assert.doesNotMatch(html(page), /undefined|NaN/);
  assert.deepEqual(page.errors, []);
});

test('highlighting escapes first: search text and SAP text cannot inject markup', async () => {
  const page = await loaded([
    sapRow({ DocumentNumber: '700', CustomerVendorName: '<script>alert(1)</script> Co' }),
    sapRow({ DocumentNumber: '701', CustomerVendorName: 'Amp & Co' }),
  ]);
  assert.deepEqual(search(page, '<script>'), [['Sales order', '700']]);
  assert.doesNotMatch(html(page), /<script/i);
  assert.match(html(page), /<mark>&lt;script&gt;<\/mark>alert\(1\)&lt;\/script&gt; Co/);
  assert.match(html(page), /match(es)? for “&lt;script&gt;”/);
  assert.match(page.els['app-sidebar'].innerHTML, /id="global-search"[^>]*value="&lt;script&gt;"/);
  search(page, 'amp');
  assert.match(html(page), /<mark>Amp<\/mark> &amp; Co/);
  assert.doesNotMatch(html(page), /&<mark>/);
  // Regex characters are matched literally.
  assert.deepEqual(search(page, '(1)'), [['Sales order', '700']]);
  assert.deepEqual(page.errors, []);
});

test('order: open lines by due date (undated last), then shipped / closed newest first', async () => {
  const x = { 'Item No.': 'ORD-X' };
  const due = (d) => ({ DueDate: d, LineDueDate: d, HeaderDueDate: d });
  const page = await loaded([
    closed({ ...x, DocumentNumber: '602', ClosedDate: '08/05/2026', DeliveryDocNumber: '1' }),
    sapRow({ ...x, DocumentNumber: '600', ...due('09/20/2026') }),
    sapRow({ ...x, DocumentNumber: '604', ...due('') }),
    closed({ ...x, DocumentNumber: '603', ClosedDate: '08/25/2026', DeliveryDocNumber: '2' }),
    sapRow({ ...x, DocumentNumber: '601', ...due('08/10/2026') }),
  ]);
  assert.deepEqual(search(page, 'ord-x').map((r) => r[1]), ['601', '600', '604', '603', '602']);
  assert.match(html(page), /Shipped<\/span>/);
});

test('typing opens Search after the debounce; Esc, clearing and nav return to the previous page', async () => {
  const page = await loaded();
  page.run('setTab("purchaseorders")');
  page.run('onGlobalSearchInput("s")');
  await wait();
  assert.equal(page.run('activeTab'), 'purchaseorders', 'one character does not search');
  page.run('onGlobalSearchInput("spy")');
  assert.equal(page.run('activeTab'), 'purchaseorders', 'debounced');
  await wait();
  assert.equal(page.run('activeTab'), 'search');
  assert.match(html(page), /Back to Purchase Orders/);
  assert.doesNotMatch(page.els['app-sidebar'].innerHTML, /nav-item active/);
  page.run('onGlobalSearchInput("spy-100")');
  await wait();
  assert.equal(page.run('searchPrevTab'), 'purchaseorders', 'refining keeps the page to go back to');
  let prevented = false;
  page.ctx.globalSearchKey({ key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(page.run('activeTab'), 'purchaseorders');
  assert.equal(page.run('searchQuery'), '');
  assert.match(page.els['app-sidebar'].innerHTML, /id="global-search"[^>]*value=""/);
  // Clearing the box goes back too.
  page.run('onGlobalSearchInput("spy")');
  await wait();
  page.run('onGlobalSearchInput("")');
  await wait();
  assert.equal(page.run('activeTab'), 'purchaseorders');
  // Picking a page in the sidebar ends the search.
  page.run('onGlobalSearchInput("spy")');
  await wait();
  page.run('setTab("monthly")');
  assert.equal(page.run('searchQuery'), '');
  page.run('onGlobalSearchInput("spy")');
  await wait();
  page.run('clearGlobalSearch()');
  assert.equal(page.run('activeTab'), 'monthly');
});

test('the match count is announced from one persistent status node, only when it changes', async () => {
  // Static markup, outside the sidebar and results that redraws replace.
  assert.match(HTML, /<div id="results-screen" style="display:none"><\/div>\s*<p class="ai-sr" id="search-announce" role="status"><\/p>/);
  const page = await loaded();
  const said = [];
  page.els['search-announce'] = { get textContent() { return said.length ? said[said.length - 1] : ''; }, set textContent(v) { said.push(v); } };
  search(page, 'spy-100');
  page.run('renderResults()');
  search(page, 'zzqq');
  page.run('clearGlobalSearch()');
  page.run('renderResults()');
  assert.deepEqual(said, ['3 matches for “spy-100”', '0 matches for “zzqq”', '']);
});

test('no data: the box is disabled, typing and shortcuts do nothing', async () => {
  const page = loadPage();
  page.run('renderSidebar()');
  assert.match(page.els['app-sidebar'].innerHTML, /<input type="search" id="global-search"[^>]*placeholder="Search orders, items, customers…"[^>]*aria-label="[^"]+"[^>]* disabled>/);
  page.run('onGlobalSearchInput("spy")');
  await wait();
  assert.equal(page.run('activeTab'), 'weekly');
  assert.doesNotMatch(html(page), /page-title"[^>]*>Search/);
  let focused = 0;
  page.els['global-search'] = { disabled: true, focus: () => { focused++; } };
  page.ctx.globalSearchShortcut({ key: 'k', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault() {} });
  assert.equal(focused, 0);
});

test('Ctrl/Cmd+K focuses the box unless the user is typing in a field; a bare "/" does nothing (WCAG 2.1.4)', async () => {
  const page = await loaded();
  let focused = 0;
  page.els['global-search'] = { disabled: false, focus: () => { focused++; }, select() {} };
  const key = (key, tagName, mods = {}) => {
    let prevented = false;
    page.ctx.globalSearchShortcut({ key, target: { tagName }, preventDefault: () => { prevented = true; }, ...mods });
    return prevented;
  };
  assert.equal(key('/', 'BODY'), false);
  assert.equal(key('/', 'BUTTON'), false);
  assert.equal(key('k', 'BUTTON', { ctrlKey: true }), true);
  assert.equal(key('K', 'BODY', { metaKey: true }), true);
  assert.equal(focused, 2);
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(key('k', tag, { ctrlKey: true }), false, tag);
  assert.equal(key('k', 'BODY'), false);
  assert.equal(focused, 2);
  assert.ok(page.els['app-sidebar'].innerHTML.includes('title="Search (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K"'));
});

test('redraws keep focus, typed text and caret in the search box', async () => {
  const page = await loaded();
  const sidebar = page.els['app-sidebar'];
  const old = { id: 'global-search', dataset: {}, value: 'spy-1', selectionStart: 3, selectionEnd: 3, selectionDirection: 'none' };
  const fresh = { value: 'spy-', focus() { this.focused = true; }, setSelectionRange(a, b, d) { this.range = [a, b, d]; } };
  page.ctx.document.activeElement = old;
  sidebar.contains = (n) => n === old;
  sidebar.querySelector = (sel) => (sel === '[id="global-search"]' ? fresh : null);
  page.run('renderSidebar()');
  assert.equal(fresh.focused, true);
  assert.equal(fresh.value, 'spy-1');
  assert.deepEqual(fresh.range, [3, 3, 'none']);
  // Same for a note textarea in the results when the page redraws.
  const results = page.els['results-screen'];
  const note = { dataset: { key: 'K1' }, classList: ['row-note'], value: 'late part', selectionStart: 2, selectionEnd: 4, selectionDirection: 'forward' };
  const freshNote = { value: 'late', focus() { this.focused = true; }, setSelectionRange(a, b, d) { this.range = [a, b, d]; } };
  page.ctx.document.activeElement = note;
  results.contains = (n) => n === note;
  results.querySelector = (sel) => (sel === '.row-note[data-key="K1"]' ? freshNote : null);
  page.run('renderResults()');
  assert.equal(freshNote.focused, true);
  assert.equal(freshNote.value, 'late part');
  assert.deepEqual(freshNote.range, [2, 4, 'forward']);
});

test('"Back to <page>" moves focus to the new page heading instead of dropping it', async () => {
  const page = await loaded();
  search(page, 'spy');
  assert.match(html(page), /data-focus-key="search-back" onclick="clearGlobalSearch\(\)">Back to Order Health</);
  const results = page.els['results-screen'];
  const back = { dataset: { focusKey: 'search-back' } };
  const h1 = { focus() { this.focused = true; } };
  page.ctx.document.activeElement = back;
  results.contains = (n) => n === back;
  // Mimics the DOM: a selector only finds what the redrawn markup contains.
  results.querySelector = (sel) => (sel === 'h1[tabindex="-1"]' && /<h1 class="page-title" tabindex="-1">Order Health</.test(results.innerHTML) ? h1
    : sel === '[data-focus-key="search-back"]' && results.innerHTML.includes('data-focus-key="search-back"') ? back : null);
  page.run('clearGlobalSearch()');
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(h1.focused, true);
});

test('notes and overrides can be edited from search results', async () => {
  const page = await loaded();
  search(page, 'cpo-778');
  const key = page.run('parsedRows.find(r=>r.customerPONumber==="CPO-778").rowKey');
  assert.match(html(page), /Add note/);
  // Wide enough for the 74px "Add note" button plus the last cell's 12px + 20px padding, as on Order Health.
  assert.match(html(page), /<col class="col-notes" style="width:110px"><\/colgroup>/);
  page.run(`toggleRowNote(${JSON.stringify(key)})`);
  assert.match(html(page), /<textarea class="row-note"/);
  page.run(`updateRowOverride(${JSON.stringify(key)},'status','Urgent')`);
  assert.equal(page.run('activeTab'), 'search');
  assert.match(html(page), /note-btn has-note/);
  // A status override recomputes the results: "Not At Risk" turns the Past Due line into a plain open line.
  assert.match(html(page), /status-chip bad">Past Due</);
  page.run(`updateRowOverride(${JSON.stringify(key)},'status','Not At Risk')`);
  assert.match(html(page), /status-chip ">Open</);
  // A new export replaces the cached results for the same query.
  await upload(page, [{ name: 'kpi2.xls', bytes: sapExport([sapRow({ DocumentNumber: '800', CustomerPONumber: 'CPO-778' })]) }]);
  assert.deepEqual(search(page, 'cpo-778'), [['Sales order', '800']]);
});

test('first 100 matches, "Show up to 500" shows the rest', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => sapRow({ DocumentNumber: String(1000 + i), 'Item No.': 'BULK-1' }));
  const page = await loaded(rows);
  search(page, 'bulk-1');
  assert.equal((html(page).match(/<tr class="line-row/g) || []).length, 100);
  assert.match(html(page), /Showing 100 of 120 · add another word/);
  assert.match(html(page), /Show up to 500/);
  page.run('toggleTableMore("search")');
  assert.equal((html(page).match(/<tr class="line-row/g) || []).length, 120);
  assert.match(html(page), /Show fewer/);
});

test('supply / demand and Clear To Build matches are listed when those files are loaded', async () => {
  const sdHeaders = ['ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'SupplyRiskFlag'];
  const sd = [
    { ExportDate: '09/03/2026', 'Item No.': 'SPY-200', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '8', UsableSupplyQty: '0', MonthlyNetQty: '-8', CumulativeNetQty: '-8', SupplyRiskFlag: 'OK' },
    { ExportDate: '09/03/2026', 'Item No.': 'SPY-300', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '1', UsableSupplyQty: '1', MonthlyNetQty: '0', CumulativeNetQty: '0', SupplyRiskFlag: 'OK' },
  ];
  const ctb = 'CM,Month,Total,Clear To Build,At Risk,Late,Notes\r\nDSM,Sep 2026,5,4,1,0,SPY-200 short\r\nIMS,Sep 2026,3,3,0,0,\r\n';
  const page = await loaded(ROWS, [{ name: 'supply.xls', bytes: utf16Tsv(sdHeaders, sd) }, { name: 'ctb.csv', bytes: new Uint8Array(Buffer.from(ctb)) }]);
  assert.deepEqual(search(page, 'spy-200'), [['Sales order', '501']]);
  assert.deepEqual(page.run('(s=>[s.supply.map(r=>r.itemCode),s.ctb.map(r=>r.cm)])(globalSearchResults(currentMetrics()))'), [['SPY-200'], ['DSM']]);
  assert.match(html(page), /3 matches for “spy-200”/);
  assert.match(html(page), /<h2>Supply \/ demand<\/h2><span class="section-sub">1 matching row</);
  assert.match(html(page), /<h2>Clear To Build<\/h2><span class="section-sub">1 matching row</);
  assert.doesNotMatch(html(page), /undefined|NaN/);
  // Order lines only: no secondary tables.
  const plain = await loaded();
  search(plain, 'spy-200');
  assert.doesNotMatch(html(plain), /Clear To Build|Supply \/ demand/);
});

test('Clear To Build matches come from one report week: the newest, or the one picked on Build Risk', async () => {
  const page = loadPage();
  const head = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders'];
  const sheet = (name, ctb) => ({ name, aoa: [head, ['IMS', 'September', 10, ctb, 10 - ctb, 0, 0, '', ''], [null, 'TOTAL', 10, ctb, 10 - ctb, 0, 0, '', '']] });
  const wb = page.run(`(()=>{const wb=XLSX.utils.book_new();for(const s of ${JSON.stringify([sheet('0924 - Orders at Risk', 5), sheet('0930 - Orders at Risk', 8)])})XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.aoa),s.name);return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));})()`);
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }, { name: 'ctb.xlsx', bytes: new Uint8Array(wb) }]);
  const ctb = () => page.run('globalSearchResults(currentMetrics()).ctb.map(r=>[r.snapshot,r.clearToBuild])');
  search(page, 'ims');
  assert.deepEqual(ctb(), [['2026-09-30', 8]]);
  assert.match(html(page), /<h2>Clear To Build<\/h2><span class="section-sub">1 matching row · Sep 30 report/);
  // The same query after picking another week on Build Risk is not served from the cache.
  page.run('setTab("buildrisk");setBuildRiskSnapshot("2026-09-24")');
  search(page, 'ims');
  assert.deepEqual(ctb(), [['2026-09-24', 5]]);
  assert.match(html(page), /1 matching row · Sep 24 report/);
  assert.deepEqual(page.errors, []);
});

run();
