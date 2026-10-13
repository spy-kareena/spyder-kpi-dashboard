// Version 2v2 page layout (every page but Order Health): page groups, at most four cards per row, the tidy page
// header, sidebar and load screen, long lists behind Show, and the same numbers as before.
// Run with `node tests/pages-2v2.test.js`. Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const results = (page) => page.els['results-screen'].innerHTML;
const sidebar = (page) => page.els['app-sidebar'].innerHTML;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const PO = (o) => sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...o });
const shipped = (o) => sapRow({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ...o });

// Export date 09/03/2026: past due, no commit, rescheduled and future sales lines, two deliveries, and purchase
// orders (late, unconfirmed, a future reschedule, a receipt), so every page has its cards and tables.
const ROWS = [
  sapRow({ DocumentNumber: '1', Warehouse: 'Spyder - Lacombe', AmountLocal: '21,500.00', ...due('08/10/2026') }),
  sapRow({ DocumentNumber: '2', Warehouse: 'CM - Alta', ...due('08/20/2026'), LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
  sapRow({ DocumentNumber: '3', Warehouse: 'CM SFG - Gamma', ...due('08/25/2026'), LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
  sapRow({ DocumentNumber: '4', Warehouse: 'CM SFG - Delta', AmountLocal: '3,250.00', ...due('09/08/2026') }),
  sapRow({ DocumentNumber: '5', Warehouse: 'CM - Beta', ...due('10/15/2026'), CustomerVendorCode: 'BASSPRO', CustomerVendorName: 'Bass Pro' }),
  shipped({ DocumentNumber: '6', Warehouse: 'CM SFG - Gamma', ...due('08/01/2026'), ClosedDate: '07/30/2026', DeliveryDocNumber: '901' }),
  shipped({ DocumentNumber: '7', Warehouse: 'CM - Alta', ...due('08/01/2026'), ClosedDate: '09/01/2026', DeliveryDocNumber: '902' }),
  PO({ DocumentNumber: '700', Warehouse: 'CM - Alta', AmountLocal: '4,400.00', ...due('08/10/2026') }),
  PO({ DocumentNumber: '701', Warehouse: 'Spyder - Lacombe', ...due('09/30/2026'), Confirmed: 'N' }),
  PO({ DocumentNumber: '702', Warehouse: 'Spyder - Lacombe', ...due('08/15/2026'), LineRescheduleDate: '09/25/2026', RescheduleDate: '09/25/2026' }),
  PO({ DocumentNumber: '701', Warehouse: 'Spyder - Lacombe', OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/14/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0', ...due('08/15/2026') }),
];
const SD_HEADERS = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'UnconfirmedSupplyQty', 'LateSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'RiskSupplyQty', 'SupplyRiskFlag'];
const SD_ROWS = [
  { '#': '1', ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '10', DemandOpenValue: '1000', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
  { '#': '2', ExportDate: '09/03/2026', 'Item No.': 'SPY-200', WarehouseCode: '12', WarehouseName: 'CM - Alta', YearMonth: '2026-09', DemandOpenQty: '12', DemandOpenValue: '600', UsableSupplyQty: '20', UnconfirmedSupplyQty: '5', LateSupplyQty: '2', MonthlyNetQty: '8', CumulativeNetQty: '8', RiskSupplyQty: '7', SupplyRiskFlag: 'PO Not Confirmed' },
  { '#': '3', ExportDate: '09/03/2026', 'Item No.': 'SPY-300', WarehouseCode: '12', WarehouseName: 'CM - Alta', YearMonth: '2026-10', DemandOpenQty: '3', DemandOpenValue: '90', UsableSupplyQty: '3', MonthlyNetQty: '0', CumulativeNetQty: '8', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
];
function ctbWorkbook(page) {
  const head = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders', 'NOTES'];
  const sheets = [
    { name: '0930 - Orders at Risk', aoa: [head, ['Alta', 'September', 10, 7, 2, 1, 0, '70%', '10%', 'Boards short'], ['Beta', 'October', 4, 4, 0, 0, 0, '100%', '0%'], [null, 'TOTAL', 14, 11, 2, 1, 0, '79%', '7%']] },
    { name: '0924 - Orders at Risk', aoa: [head, ['Alta', 'September', 10, 5, 5, 0, 0, '50%', '0%'], [null, 'TOTAL', 10, 5, 5, 0, 0, '50%', '0%']] },
  ];
  return new Uint8Array(page.run(`(()=>{const wb=XLSX.utils.book_new();for(const s of ${JSON.stringify(sheets)})XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.aoa),s.name);return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));})()`));
}
async function loadedAll() {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }, { name: 'supply.xls', bytes: utf16Tsv(SD_HEADERS, SD_ROWS) }, { name: 'Orders At Risk - Clear to Build.xlsx', bytes: ctbWorkbook(page) }]);
  return page;
}
// The groups each page is built from, in order: [id, title].
const PAGE_GROUPS = {
  purchaseorders: [['po-commitments', 'Supply commitments'], ['po-receiving', 'Receiving performance'], ['po-where', 'By warehouse and vendor'], ['po-linked', 'Linked PO lines']],
  buildrisk: [['br-week', 'This report week'], ['br-buckets', 'By CM and month'], ['br-orders', 'Orders to act on']],
  supplyweekly: [['sd-coverage', 'Coverage'], ['sd-shortages', 'Shortages by warehouse'], ['sd-risk', 'Supply at risk'], ['sd-all', 'All open demand']],
  supplydemand: [['mix-totals', 'Demand vs supply'], ['mix-gaps', 'Where the gaps are'], ['mix-rows', 'Rows to check']],
  monthly: [['mo-months', 'Month by month'], ['mo-shipped', 'Shipped'], ['mo-open', 'By original delivery date'], ['mo-scenario', 'Ship target scenario']],
  warehouses: [['wh-open', 'Open work'], ['wh-kpis', 'Performance by warehouse']],
  metrics: [['mt-quality', 'Order quality'], ['mt-month', 'By due month'], ['mt-lines', 'Lines to act on']],
  shipping: [['ship-status', 'Status'], ['ship-list', 'Shipments'], ['ship-cross', 'Cross-border']],
  search: [['search-lines', 'Order lines'], ['search-more', 'Other matches']],
};
const open = (page, tab) => { page.run(tab === 'search' ? "searchQuery='SPY';applyGlobalSearch()" : `setTab(${JSON.stringify(tab)})`); return results(page); };

test('the canonical page-group CSS is in the main stylesheet, as the 2v2 contract writes it', () => {
  for (const rule of [
    ':root{--space-group:40px;--space-in:20px}',
    '.pg-group+.pg-group{margin-top:var(--space-group)}',
    '.pg-group>*+*{margin-top:var(--space-in)}',
    '.pg-group-head{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}',
    '.pg-group-title{margin:0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--gray-500)}',
    '@media (max-width:640px){:root{--space-group:28px;--space-in:14px}}',
    '@media print{:root{--space-group:.15in;--space-in:.08in}}',
  ]) assert.ok(CSS.includes(`\n${rule}\n`), rule);
  // One copy only (the layout stream's interim copy was dropped at merge).
  assert.equal(CSS.split(':root{--space-group:40px;--space-in:20px}').length - 1, 1);
  // More space between groups than inside one, also where a group follows the page's own 32px rhythm.
  assert.match(CSS, /#results-screen>\*\+\.pg-group,#results-screen>\.pg-group\+\*,#upload-screen>\*\+\.pg-group\{margin-top:var\(--space-group\)\}/);
  assert.match(CSS, /\.pg-group>\.pg-group-head\+\*\{margin-top:0\}/);
  // On paper a long group may break across pages, but its title stays with its first card.
  assert.match(CSS, /@media print\{\.pg-group\{break-inside:auto;page-break-inside:auto\}\.pg-group-head\{break-after:avoid;/);
});

test('every page but Order Health is a few named groups; each group is labelled by its own title', async () => {
  const page = await loadedAll();
  for (const [tab, groups] of Object.entries(PAGE_GROUPS)) {
    const h = open(page, tab);
    const found = [...h.matchAll(/<section class="pg-group[^"]*"(?: id="[^"]+")? aria-labelledby="pg-([\w-]+)" data-group="\1"><div class="pg-group-head"><h2 class="pg-group-title" id="pg-\1">([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(found, groups, tab);
    // Nothing else on the page uses the old section headings: the group titles replaced them.
    assert.doesNotMatch(h, /class="section-title"/, `${tab}: an old section heading is left`);
    assert.doesNotMatch(h, /NaN|undefined|\[object Object\]/, tab);
  }
  // Order Health is the layout stream's page: this stream leaves its sections alone.
  assert.match(open(page, 'weekly'), /class="section-title"/);
  assert.deepEqual(page.errors, []);
});

test('at most four cards in a row: stat rows are four-column grids, Shipping\'s five steps are one strip', async () => {
  const page = await loadedAll();
  for (const tab of Object.keys(PAGE_GROUPS)) assert.doesNotMatch(open(page, tab), /class="grid-5\b/, tab);
  assert.match(CSS, /\.grid-4\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(CSS, /\.grid-lead\{display:grid;grid-template-columns:1\.5fr 1fr 1fr 1fr/);
  for (const tab of ['buildrisk', 'supplydemand', 'supplyweekly']) {
    const grid = open(page, tab).match(/<div class="grid-4 pg-stats">([\s\S]*?)<\/div>\s*(?:<div class="mini-strip|`|<\/section>)/)[1];
    assert.equal(grid.split('class="card kpi static"').length - 1, 4, tab);
  }
  const ship = open(page, 'shipping');
  assert.match(ship, /<div class="ship-kpis" role="group" aria-label="Shipment status">/);
  assert.equal((ship.match(/class="card kpi ship-kpi/g) || []).length, 5);
  assert.match(CSS, /\.ship-kpis>\.card\.kpi\{border:0;border-right:1px solid var\(--gray-100\);border-radius:0;box-shadow:none;/);
  // Paper (about 990px wide) keeps the desktop columns instead of the 1180px two-column rule.
  assert.match(CSS, /@media print\{\.grid-lead\{grid-template-columns:1\.5fr 1fr 1fr 1fr\}\.grid-4,\.month-spot\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
});

test('the numbers on the cards are the same numbers the pages computed before', async () => {
  const page = await loadedAll();
  const card = (h, label) => (h.match(new RegExp(`>${label}</span>(?:<div class="kpi-row[^"]*">)?\\s*<span class="kpi-value[^"]*"[^>]*>([^<]+)<`)) || [])[1];
  // Purchase Orders: the late card, the strip and the linked lines all come from poData.
  let h = open(page, 'purchaseorders');
  const po = page.run('(()=>{const d=poData(currentMetrics());return {late:money(rowOpenAmount(d.poLateRows)),lateLines:d.poLateRows.length,unconf:d.poUnconfirmedRows.length,open:d.poAllOpenRows.length,openValue:money(rowOpenAmount(d.poAllOpenRows))};})()');
  assert.match(h, new RegExp(`Late / missed commit</span>\\s*<div class="kpi-row"><span class="kpi-value hero crit"[^>]*>\\${po.late}</span><span class="kpi-unit">${po.lateLines} lines</span>`));
  assert.match(text(h), new RegExp(`Unconfirmed ${po.unconf} `));
  assert.match(text(h), new RegExp(`All open POs ${po.open} \\${po.openValue}`));
  assert.match(h, new RegExp(`<span class="count-badge bad">Late / missed commit · ${po.lateLines} lines · `));
  // Build Risk: the newest week's four totals and its row count.
  h = open(page, 'buildrisk');
  const br = page.run('(()=>{const b=currentMetrics().buildRisk.snapshots[0];return {ctb:b.totalClearToBuild,risk:b.totalAtRisk,late:b.totalLate,value:money(b.matchedOpenValue),rows:b.rows.length};})()');
  assert.deepEqual([card(h, 'Clear to build'), card(h, 'At risk'), card(h, 'Late'), card(h, 'Matched SO value')], [String(br.ctb), String(br.risk), String(br.late), br.value]);
  assert.deepEqual([br.ctb, br.risk, br.late, br.rows], [11, 2, 1, 2]);
  assert.match(h, new RegExp(`<strong class="ctb-rows">${br.rows}</strong> CTB report rows · 2 weeks loaded`));
  // Supply Mix: four cards; the shortage and risk row counts moved under their quantities.
  h = open(page, 'supplydemand');
  const sd = page.run('(()=>{const s=currentMetrics().supplyDemand;return {d:s.demandQty,u:s.usableQty,sh:s.shortageQty,r:s.riskQty,shRows:s.shortageRows.length,rRows:s.riskRows.length};})()');
  assert.deepEqual([card(h, 'Demand qty'), card(h, 'Usable supply qty'), card(h, 'Shortage qty'), card(h, 'Supply risk qty')].map(Number), [sd.d, sd.u, sd.sh, sd.r]);
  assert.deepEqual([sd.d, sd.u, sd.r], [25, 27, 7]);
  assert.match(h, new RegExp(`${sd.shRows} shortage rows?</span>`));
  assert.match(h, new RegExp(`${sd.rRows} risk rows?</span>`));
  // Supply / Demand: coverage cards for all warehouses.
  h = open(page, 'supplyweekly');
  assert.equal(card(h, 'Shortage rows'), '1');
  assert.equal(card(h, 'Open demand'), '25');
  assert.equal(card(h, 'Supply risk rows'), '1');
  // Monthly: this month's open value; Metrics Timeline: the on-track rate.
  h = open(page, 'monthly');
  const thisMonth = page.run("money((currentMetrics().byMonth.find(g=>g.key===monthKey(reportToday()))||{openAmount:0}).openAmount)");
  assert.match(h, new RegExp(`<span class="month-tag">This month</span></div>\\s*<div class="kpi-row"><span class="kpi-value"[^>]*>\\${thisMonth}</span>`));
  h = open(page, 'metrics');
  assert.match(h, new RegExp(`On-track rate</span><span class="kpi-tag">target 90%</span></div>\\s*<span class="kpi-value [a-z]+" data-count="${page.run('pct(currentMetrics().onTrackRows.length,currentMetrics().rows.length)')}"`));
  assert.deepEqual(page.errors, []);
});

test('long lists open on request and always print: All open demand, the scenario lines', async () => {
  const page = await loadedAll();
  let h = open(page, 'supplyweekly');
  const head = h.match(/<section class="pg-group[^"]*" aria-labelledby="pg-sd-all"[\s\S]*?<\/section>\s*<details/)[0];
  assert.match(head, /<span class="count-badge">3 rows<\/span><div class="pg-group-tools"><button type="button" class="link-btn" data-focus-key="more-sd-all-group" data-table-key="sd-all-group" aria-expanded="false" data-tip="Show the 3 open demand rows\." onclick="toggleTableMore\(this\.dataset\.tableKey\)">Show all<\/button>/);
  assert.doesNotMatch(h, /data-focus-key="info-sd-all"[\s\S]*?<table/);
  page.run("toggleTableMore('sd-all-group')");
  h = results(page);
  assert.match(h, /aria-expanded="true" data-tip="Hide the open demand rows\." onclick="toggleTableMore\(this\.dataset\.tableKey\)">Hide<\/button>/);
  assert.match(h.slice(h.indexOf('aria-labelledby="pg-sd-all"')), /<table class="data-table cards"/);
  page.run("toggleTableMore('sd-all-group');printMode=true;renderResults()");
  h = results(page);
  assert.match(h.slice(h.indexOf('aria-labelledby="pg-sd-all"')), /<table class="data-table cards"/);
  assert.doesNotMatch(h, /data-focus-key="more-sd-all-group"/);
  page.run('printMode=false');
  // Monthly: the strip and the calendar sum the scenario up; its lines open with Show lines.
  h = open(page, 'monthly');
  assert.match(h, /<section class="table pg-collapsed"><div class="card-head lg"><h2>Scenario lines<\/h2><div class="inline-controls"><span class="section-sub">\d+ open lines booked by [\d-]+<\/span><button [^>]*data-focus-key="more-monthly-scenario-lines"[^>]*>Show lines<\/button>/);
  assert.doesNotMatch(h, /aria-label="Scenario lines"/);
  page.run("toggleTableMore('monthly-scenario-lines')");
  assert.match(results(page), /aria-label="Scenario lines"><table class="data-table"/);
  page.run("toggleTableMore('monthly-scenario-lines');printMode=true;renderResults()");
  assert.match(results(page), /aria-label="Scenario lines"><table class="data-table"/);
  page.run('printMode=false');
  assert.deepEqual(page.errors, []);
});

test('page header: title, then the as-of line and Data check; the actions on the right; phones keep the full button names', async () => {
  const page = await loadedAll();
  const h = open(page, 'purchaseorders');
  assert.match(h, /<div class="page-head-main"><h1 class="page-title" tabindex="-1">Purchase Orders<\/h1><div class="page-sub"><span class="page-meta"[^>]*>as of 2026-09-03 · \d+ open purchase order lines<\/span><\/div><\/div>\s*<div class="actions">/);
  assert.match(h, />Share<span class="btn-long"> snapshot<\/span><\/button>/);
  // The long part of a label is clipped, not display:none, so it stays in the button's accessible name.
  const phone = CSS.slice(CSS.indexOf('/* --- 2v2 (pages)'));
  assert.match(phone, /\.btn \.btn-long\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/);
  assert.doesNotMatch(phone, /btn-long\{[^}]*display:none/);
  assert.match(CSS, /\.page-head \.actions\{flex-wrap:wrap;justify-content:flex-end;align-items:center\}/);
  // Filter bars: no line that repeats the picked values on screen (print keeps it), Reset at the far right.
  assert.match(h, /<button type="button" class="link-btn filter-reset" data-focus-key="po-filters-reset"/);
  assert.match(h, /<div class="print-only">Filters: All warehouses · all vendors<\/div>/);
  assert.match(CSS, /\.filter-reset\{margin-left:auto\}/);
});

test('sidebar: clear group labels, the current page marked, page descriptions in the tooltips', async () => {
  const page = await loadedAll();
  page.run("setTab('supplyweekly')");
  const s = sidebar(page);
  assert.deepEqual([...s.matchAll(/<div class="nav-label">([^<]+)<\/div>/g)].map((m) => m[1]), ['Sales', 'Supply', 'Help']);
  assert.equal((s.match(/aria-current="page"/g) || []).length, 1);
  assert.match(s, /<button type="button" class="nav-item active" data-focus-key="nav-supplyweekly" onclick="setTab\('supplyweekly'\)" aria-current="page" data-tip="[^"]+"><span class="nav-text">Supply \/ Demand<\/span><\/button>/);
  assert.doesNotMatch(s, /nav-desc|has-desc/);
  assert.match(CSS, /\.nav-label\{padding:0 10px 8px;font-size:11px;font-weight:600;letter-spacing:\.06em;text-transform:uppercase\}/);
  assert.match(CSS, /\.nav-item\.active::before\{background:var\(--accent\)\}/);
  // The loaded-report card: file names, export date (what was loaded is in its tip), where the report is kept.
  assert.match(s, /<div class="loaded-meta"><span data-tip="\d+ rows loaded: SO \+ PO \+ supply \/ demand \+ CTB\.">Export date 2026-09-03<\/span>/);
});

test('load screen: one drop area until a report is loaded, then the loaded report beside it; every page listed with what it shows', async () => {
  const page = loadPage();
  page.run('renderUploadState()');
  assert.equal(page.els['upload-side'].hidden, true);
  const pages = page.els['upload-pages'].innerHTML;
  assert.deepEqual([...pages.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Sales', 'Supply', 'Help']);
  for (const id of ['weekly', 'monthly', 'warehouses', 'metrics', 'shipping', 'purchaseorders', 'supplyweekly', 'supplydemand', 'buildrisk', 'connect']) {
    assert.ok(pages.includes(`<span class="page-desc">${page.run(`esc(PAGE_TIPS.${id})`)}</span>`), id);
  }
  assert.match(HTML, /<section class="pg-group rise rise-3" aria-labelledby="pg-upload-pages" data-group="upload-pages"><div class="pg-group-head"><h2 class="pg-group-title" id="pg-upload-pages">What each page shows<\/h2><\/div><div class="upload-pages" id="upload-pages"><\/div><\/section>/);
  assert.match(HTML, /<p class="page-lead">Load SAP exports into one offline summary\.<\/p>/);
  assert.doesNotMatch(HTML, /class="flow-step"/);
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  page.run('showUpload()');
  assert.equal(page.els['upload-side'].hidden, false);
  assert.match(page.els['upload-current'].innerHTML, /Currently loaded<\/span><strong>kpi\.xls · export date 2026-09-03<\/strong>/);
  // On a phone the empty "No export loaded" card is not drawn as a blank box.
  assert.match(CSS, /\.loaded-card\.empty\{display:none\}/);
  assert.deepEqual(page.errors, []);
});

test('Purchase Orders lines: the reschedule date sits under the status; the table fits a 1366px screen', async () => {
  const page = await loadedAll();
  page.run("setTab('purchaseorders');setPoTileFilter('allopen')");
  const table = results(page).match(/<table class="lines-table po">[\s\S]*?<\/table>/)[0];
  assert.doesNotMatch(table, />Reschedule<\/th>|class="badge /);
  assert.match(table, /<span class="status-chip warn">Future Reschedule<\/span><span class="timing">[^<]+<\/span><span class="timing">↻ 2026-09-25<\/span>/);
  assert.equal((table.match(/<th\b/g) || []).length, 9);
  const fixed = [...table.match(/<colgroup>([\s\S]*?)<\/colgroup>/)[1].matchAll(/width:(\d+)px/g)].reduce((t, m) => t + Number(m[1]), 0);
  assert.ok(fixed + 190 <= 1040 && 1040 <= 1055, `fixed ${fixed}px`);
  assert.match(CSS, /\.lines-table\.po\{min-width:1040px\}/);
});

test('supply rows (Supply Mix, Search): one Risk column with the flag, the risky quantity and its breakdown', async () => {
  const page = await loadedAll();
  page.run("setTab('supplydemand')");
  const h = results(page);
  const table = h.match(/<h2>Supply risk rows<\/h2>[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...table.matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), ['Month', 'Warehouse', 'Item', 'Demand qty', 'Usable supply', 'Monthly net', 'Cumulative net', 'Risk']);
  assert.match(table, /<td data-tip="Risky PO supply: 5 unconfirmed, 2 late\." data-label="Risk" data-card="st"><span class="pill bad">PO Not Confirmed<\/span><span class="sub">7 qty<\/span><\/td>/);
  page.run("searchQuery='SPY-200';applyGlobalSearch()");
  assert.match(results(page), /<h2>Supply \/ demand<\/h2>[\s\S]*?<span class="pill bad">PO Not Confirmed<\/span><span class="sub">7 qty<\/span>/);
  assert.deepEqual(page.errors, []);
});

run();
