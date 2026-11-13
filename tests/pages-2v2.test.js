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
  purchaseorders: [['po-commitments', 'Leading · Supply commitments'], ['po-receiving', 'Lagging · Receiving performance'], ['po-where', 'By warehouse and vendor'], ['po-linked', 'Lines to act on']],
  buildrisk: [['br-week', 'This report week'], ['br-buckets', 'By CM and month'], ['br-orders', 'Lines to act on']],
  // 2v2 design fixes: Supply / Demand's shortage and risk lines are one table (All open lines a collapsed card in
  // the same group); Supply Mix leaves the totals and those lines to Supply / Demand.
  supplyweekly: [['sd-coverage', 'Coverage'], ['sd-shortages', 'Lines to act on']],
  supplydemand: [['mix-gaps', 'By month and warehouse'], ['mix-items', 'By item group']],
  monthly: [['mo-months', 'Month by month'], ['mo-shipped', 'By delivery month'], ['mo-open', 'By original delivery date'], ['mo-scenario', 'Ship target scenario']],
  warehouses: [['wh-open', 'Open work'], ['wh-kpis', 'By warehouse']],
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
  // !important: the older print rule keeps every <section> whole (a group is a <section>), which pushed whole groups
  // to a new page; a group must run on over pages while its cards stay whole.
  assert.match(CSS, /@media print\{\.pg-group\{break-inside:auto!important;page-break-inside:auto!important\}\.pg-group-head\{break-after:avoid;/);
  assert.match(CSS, /@media print\{\n[^]*?section,\.section,[^{]*\.card\{break-inside:avoid;page-break-inside:avoid\}/, 'cards stay whole');
});

test('every page but Order Health is a few named groups; each group is labelled by its own title', async () => {
  const page = await loadedAll();
  for (const [tab, groups] of Object.entries(PAGE_GROUPS)) {
    const h = open(page, tab);
    const found = [...h.matchAll(/<section class="pg-group[^"]*"(?: id="[^"]+")? aria-labelledby="pg-([\w-]+)" data-group="\1"><div class="pg-group-head"><h2 class="pg-group-title" id="pg-\1"(?: data-tip="[^"]+")?>([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(found, groups, tab);
    // Nothing else on the page uses the old section headings: the group titles replaced them.
    assert.doesNotMatch(h, /class="section-title"/, `${tab}: an old section heading is left`);
    assert.doesNotMatch(h, /NaN|undefined|\[object Object\]/, tab);
  }
  // Order Health uses the same group titles (no old section heading left either).
  // (The Big picture card, on by default on Order Health, keeps its own in-card heading.)
  assert.doesNotMatch(open(page, 'weekly').replace(/<div class="sk-head">[\s\S]*?<\/h2>/, ''), /class="section-title"/);
  assert.deepEqual(page.errors, []);
});

test('at most four cards in a row: stat rows are four-column grids, Shipping\'s four counts are one strip', async () => {
  const page = await loadedAll();
  for (const tab of Object.keys(PAGE_GROUPS)) assert.doesNotMatch(open(page, tab), /class="grid-5\b/, tab);
  assert.match(CSS, /\.grid-4\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(CSS, /\.grid-lead\{display:grid;grid-template-columns:1\.5fr 1fr 1fr 1fr/);
  for (const tab of ['buildrisk', 'supplyweekly']) {
    const grid = open(page, tab).match(/<div class="grid-4 pg-stats">([\s\S]*?)<\/div>\s*(?:<div class="mini-strip|`|<\/section>)/)[1];
    assert.equal(grid.split('class="card kpi static"').length - 1, 4, tab);
  }
  const ship = open(page, 'shipping');
  assert.match(ship, /<div class="ship-kpis" role="group" aria-label="Shipment status">/);
  assert.equal((ship.match(/class="card kpi ship-kpi/g) || []).length, 4);
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
  assert.match(h, new RegExp(`<span class="count-badge bad">Late / missed commit · ${po.lateLines} lines? · `));
  // Build Risk: the newest week's four totals and its row count.
  h = open(page, 'buildrisk');
  const br = page.run('(()=>{const b=currentMetrics().buildRisk.snapshots[0];return {ctb:b.totalClearToBuild,risk:b.totalAtRisk,late:b.totalLate,value:money(b.matchedOpenValue),rows:b.rows.length};})()');
  assert.deepEqual([card(h, 'Clear to build'), card(h, 'At risk'), card(h, 'Late'), card(h, 'Matched SO value')], [String(br.ctb), String(br.risk), String(br.late), br.value]);
  assert.deepEqual([br.ctb, br.risk, br.late, br.rows], [11, 2, 1, 2]);
  assert.match(h, new RegExp(`<strong class="ctb-rows">${br.rows}</strong> CTB report lines · 2 weeks loaded`));
  // Supply Mix no longer repeats the four totals (or the lines): Supply / Demand's Coverage cards carry the same
  // numbers for all warehouses, and Supply Mix links there.
  h = open(page, 'supplydemand');
  assert.doesNotMatch(h, /class="grid-4 pg-stats"|Worst shortage (?:rows|lines)|Supply risk (?:rows|lines)<|Demand qty<\/span>/);
  assert.match(h, /<div class="pg-group-tools"><button type="button" class="link-btn" data-focus-key="mix-open-sd" onclick="setTab\('supplyweekly'\)" data-tip="The 1 shortage and 1 supply-risk lines, with the totals, are on Supply \/ Demand\.">Lines on Supply \/ Demand<\/button><\/div>/);
  const sd = page.run('(()=>{const s=currentMetrics().supplyDemand;return {d:s.demandQty,u:s.usableQty,sh:s.shortageQty,r:s.riskQty,shRows:s.shortageRows.length,rRows:s.riskRows.length};})()');
  assert.deepEqual([sd.d, sd.u, sd.sh, sd.r, sd.shRows, sd.rRows], [25, 27, 6, 7, 1, 1]);
  // Supply / Demand: coverage cards for all warehouses.
  h = open(page, 'supplyweekly');
  assert.deepEqual([card(h, 'Shortage lines'), card(h, 'Open demand'), card(h, 'Usable supply'), card(h, 'Supply risk lines')].map(Number), [sd.shRows, sd.d, sd.u, sd.rRows]);
  assert.match(h, new RegExp(`>${sd.sh} qty short</span>`));
  assert.match(h, new RegExp(`>${sd.r} risk qty</span>`));
  // Monthly: this month's open value; Metrics Timeline: the on-track rate.
  h = open(page, 'monthly');
  const thisMonth = page.run("money((currentMetrics().byMonth.find(g=>g.key===monthKey(reportToday()))||{openAmount:0}).openAmount)");
  assert.match(h, new RegExp(`<span class="month-tag">This month</span></div>\\s*<div class="kpi-row"><span class="kpi-value"[^>]*>\\${thisMonth}</span>`));
  h = open(page, 'metrics');
  assert.match(h, new RegExp(`On-track rate</span><span class="kpi-tag">target 90%</span></div>\\s*<span class="kpi-value [a-z]+" data-count="${page.run('pct(currentMetrics().onTrackRows.length,currentMetrics().rows.length)')}"`));
  assert.deepEqual(page.errors, []);
});

test('long lists open on request and always print: All open lines, the scenario lines', async () => {
  const page = await loadedAll();
  let h = open(page, 'supplyweekly');
  // All open lines is a collapsed card (title, line count, Show all) under the shortages table, not a group heading
  // with only a link.
  assert.doesNotMatch(h, /aria-labelledby="pg-sd-all"/);
  const collapsed = h.match(/<section class="table pg-collapsed"><div class="card-head lg"><h2>All open lines<\/h2>[\s\S]*?<\/section>/)[0];
  assert.match(collapsed, /<div class="inline-controls"><span class="section-sub">3 lines<\/span><button type="button" class="link-btn" data-focus-key="more-sd-all-group" data-table-key="sd-all-group" aria-expanded="false" data-tip="Show the 3 open demand lines\." onclick="toggleTableMore\(this\.dataset\.tableKey\)">Show all<\/button><\/div><\/div><\/section>/);
  assert.ok(h.indexOf('<h2>All open lines</h2>') > h.indexOf('aria-labelledby="pg-sd-shortages"'), 'in the shortages group');
  page.run("toggleTableMore('sd-all-group')");
  h = results(page);
  const all = () => results(page).slice(results(page).indexOf('<h2>All open lines</h2>'));
  assert.match(all(), /aria-expanded="true" data-tip="Hide the open demand lines\." onclick="toggleTableMore\(this\.dataset\.tableKey\)">Hide<\/button>/);
  assert.match(all(), /<table class="data-table cards"/);
  assert.equal((all().split('</table>')[0].match(/<tr>\s*<td class="date soft"[ >]/g) || []).length, 3);
  page.run("toggleTableMore('sd-all-group');printMode=true;renderResults()");
  assert.match(all(), /<table class="data-table cards"/);
  assert.doesNotMatch(results(page), /data-focus-key="more-sd-all-group"/);
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
  assert.match(h, /<div class="page-head-main"><h1 class="page-title" tabindex="-1">Purchase Orders<\/h1><div class="page-sub"><span class="page-meta"[^>]*>As of 2026-09-03 · \d+ open PO lines<\/span><\/div><\/div>\s*<div class="actions">/);
  assert.match(h, />Share<span class="btn-long"> snapshot<\/span><\/button>/);
  // The long part of a label is clipped, not display:none, so it stays in the button's accessible name.
  const phone = CSS.slice(CSS.indexOf('/* --- 2v2 (pages)'));
  assert.match(phone, /\.btn \.btn-long\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/);
  assert.doesNotMatch(phone, /btn-long\{[^}]*display:none/);
  assert.match(CSS, /\.page-head \.actions\{flex-wrap:wrap;justify-content:flex-end;align-items:center\}/);
  // Filter bars: no line that repeats the picked values on screen (print keeps it), Reset at the far right.
  assert.match(h, /<button type="button" class="link-btn filter-reset" data-focus-key="po-filters-reset"/);
  assert.match(h, /<div class="print-only">Filters: All warehouses · All vendors<\/div>/);
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
  assert.match(s, /<div class="loaded-meta"><span data-tip="\d+ lines loaded: SO \+ PO \+ supply \/ demand \+ CTB\.">Export date 2026-09-03<\/span>/);
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
  assert.match(page.els['upload-current'].innerHTML, /Currently loaded<\/span><strong>kpi\.xls · Export date 2026-09-03<\/strong>/);
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

test('supply rows: Supply / Demand and Search give a row the same status (shortage, then risky supply), the SAP flag in the tip', async () => {
  const page = await loadedAll();
  // SPY-200 (CM - Alta) is covered but its PO supply is unconfirmed and late: "Supply risk", the quantities under it.
  // Both tables stack as cards on a phone, so the cell also names its column (Supply risk / Risk) and its card place.
  const cell = /<td data-tip="SAP flag: PO Not Confirmed\." data-label="(?:Supply risk|Risk)" data-card="st"><span class="pill warn">Supply risk<\/span><span class="sub">Unconfirmed 5 · Late 2<\/span><\/td>/;
  let h = open(page, 'supplyweekly');
  assert.match(h, cell);
  page.run("searchQuery='SPY-200';applyGlobalSearch()");
  const search = results(page).match(/<h2>Supply \/ demand<\/h2>[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...search.matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), ['Month', 'Warehouse', 'Item', 'Demand qty', 'Usable supply', 'Monthly net', 'Cumulative net', 'Risk']);
  assert.match(search, cell);
  // The case the design review found: a short row whose SupplyRiskFlag column is blank read "OK · 3 qty" (green) on
  // Supply Mix but "Shortage · Unconfirmed 3" on Supply / Demand. Every supply table now uses supplyRowStatus.
  const row = { isCumulativeShortage: true, isMonthlyShortage: true, hasSupplyRisk: true, hasDemandRisk: false, unconfirmedSupplyQty: 3, noCommitSupplyQty: 0, rescheduledSupplyQty: 0, lateSupplyQty: 0, demandNoCommitQty: 0, supplyRiskFlag: '' };
  assert.deepEqual(page.run(`supplyRowStatus(${JSON.stringify(row)})`), { label: 'Shortage', tone: 'bad', detail: 'Unconfirmed 3', flag: '' });
  assert.equal(page.run(`supplyStatusCell(${JSON.stringify(row)})`), '<td><span class="pill bad">Shortage</span><span class="sub">Unconfirmed 3</span></td>');
  for (const [r, label, tone] of [[{}, 'Covered', 'good'], [{ hasDemandRisk: true, demandNoCommitQty: 2 }, 'SO no commit', 'warn'], [{ isMonthlyShortage: true }, 'Monthly short', 'bad']]) {
    const st = page.run(`supplyRowStatus(${JSON.stringify({ ...row, isCumulativeShortage: false, isMonthlyShortage: false, hasSupplyRisk: false, unconfirmedSupplyQty: 0, ...r })})`);
    assert.deepEqual([st.label, st.tone], [label, tone]);
  }
  for (const tab of ['supplyweekly', 'search']) {
    const x = tab === 'search' ? (page.run("searchQuery='SPY';applyGlobalSearch()"), results(page)) : open(page, tab);
    assert.doesNotMatch(x, /<span class="pill good">OK<\/span>/, tab);
  }
  assert.doesNotMatch(HTML, /r\.supplyRiskFlag==='OK'\?'good'/, 'no table colours a row from the SAP flag alone');
  assert.deepEqual(page.errors, []);
});

test('Supply / Demand: the short or at-risk lines are one table with warehouse sub-heading rows; Supply at risk only narrows it', async () => {
  const page = await loadedAll();
  let h = open(page, 'supplyweekly');
  const group = () => { const x = results(page); return x.slice(x.indexOf('aria-labelledby="pg-sd-shortages"'), x.indexOf('<h2>All open lines</h2>')); };
  // One table (no card per warehouse with its own header row), the lines short or with risky supply; the group is
  // "Lines to act on" with its help as the title's tip and the line count in the pill (the card head keeps only the chip).
  assert.match(group(), /^aria-labelledby="pg-sd-shortages" data-group="sd-shortages"><div class="pg-group-head"><h2 class="pg-group-title" id="pg-sd-shortages" data-tip="Lines short of usable PO supply, or with supply at risk\.">Lines to act on<\/h2><span class="count-badge bad">2 lines<\/span><\/div>/);
  assert.equal((group().match(/<table class="data-table cards"/g) || []).length, 1);
  assert.equal((group().match(/<thead>/g) || []).length, 1);
  assert.match(group(), /<section class="table sd-rows">\s*<div class="card-head lg"><h2>Short or at risk<\/h2><div class="inline-controls"><button type="button" class="chip" data-focus-key="sd-risk-only" data-table-key="sd-risk-only" aria-pressed="false" data-tip="[^"]+" onclick="toggleTableMore\(this\.dataset\.tableKey\)">Supply at risk only · 1<\/button><\/div><\/div>/);
  const subHeads = (x) => [...x.matchAll(/<tr class="grp-row"><td colspan="9"><span class="grp-name" role="heading" aria-level="3">([^<]+)<\/span><span class="grp-sub">([^<]+)<\/span><\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(subHeads(group()), [['CM - Alta', '1 line · 12 demand qty · $600'], ['Spyder - Lacombe', '1 line · 10 demand qty · $1,000']]);
  // Phone cards: the sub-heading row is left as it is; every data line names its columns (month and value on top).
  assert.match(group(), /<tr>\s*<td class="date soft" data-label="Month" data-card="key">Oct 2026<\/td>\s*<td data-label="Item" data-card="item"><span class="m">SPY-100<\/span>[\s\S]*?<td class="num strong" data-label="Demand value" data-card="amt">\$1,000<\/td>/);
  assert.doesNotMatch(group(), /<td colspan="9" data-label/);
  assert.match(group(), /<span class="pill bad">Shortage<\/span>/);
  assert.match(group(), /<span class="pill warn">Supply risk<\/span>/);
  // The chip lists the risky-supply rows only; it is kept with the view, printed, and cleared by a new report.
  page.run("toggleTableMore('sd-risk-only')");
  assert.match(group(), /<span class="count-badge warn">1 line<\/span>/);
  assert.match(group(), /<h2>Supply at risk<\/h2><div class="inline-controls"><button type="button" class="chip active" data-focus-key="sd-risk-only" data-table-key="sd-risk-only" aria-pressed="true"/);
  assert.deepEqual(subHeads(group()).map((x) => x[0]), ['CM - Alta']);
  assert.doesNotMatch(group(), /pill bad/);
  assert.match(results(page), /<div class="print-only">Filters: All warehouses · Supply at risk only<\/div>/);
  // The Coverage numbers do not move with the chip.
  assert.match(results(page), />Shortage lines<\/span><span class="kpi-value crit">1</);
  page.run('resetViewState()');
  assert.equal(page.run("!!tableMore['sd-risk-only']"), false);
  // A warehouse pick narrows the table and its sub-headings; more than 20 lines end in Show all.
  page.run("setTab('supplyweekly');setSupplyWarehouseFilter(['Spyder - Lacombe'])");
  assert.deepEqual(subHeads(group()).map((x) => x[0]), ['Spyder - Lacombe']);
  const many = page.run(`renderSupplyRowsTable({key:'t-many',title:'T',rows:Array.from({length:25},(_,i)=>({...supplyDemandRows[0],itemCode:'X'+i,warehouseName:i<15?'A':'B'})),limit:20})`);
  assert.equal((many.match(/<tr>\s*<td class="date soft"[ >]/g) || []).length, 20);
  assert.deepEqual(subHeads(many), [['A', '15 lines · 150 demand qty · $15,000'], ['B', '10 lines · 100 demand qty · $10,000']], 'a sub-heading counts all its lines');
  assert.match(many, /<div class="tfoot"><span>Showing 20 of 25<\/span><button type="button" class="link-btn" data-focus-key="more-t-many"[^>]*>Show all<\/button>/);
  assert.match(CSS, /\.data-table tr\.grp-row>td\{/);
  assert.deepEqual(page.errors, []);
});

test('load screen: What each page shows is filled on the first visit, before any report or showUpload()', () => {
  const page = loadPage();
  const pages = page.els['upload-pages'].innerHTML;
  assert.deepEqual([...pages.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Sales', 'Supply', 'Help']);
  assert.ok(pages.includes(`<span class="page-desc">${page.run('esc(PAGE_TIPS.supplyweekly)')}</span>`));
  assert.deepEqual(page.errors, []);
});

test('phone header: no icons, Share and PDF, actions on one row, Data check on the as-of line; the sidebar file card folds to one line', async () => {
  const page = await loadedAll();
  const h = open(page, 'purchaseorders');
  // "Export PDF" on wider screens, "PDF" on a phone (the long part stays in the accessible name).
  assert.match(h, /data-focus-key="export-pdf"[^>]*><svg class="ico"[^]*?<\/svg><span class="btn-long">Export&nbsp;<\/span>PDF<\/button>/);
  const phone = CSS.slice(CSS.indexOf('/* --- 2v2 design fixes (D3'));
  for (const rule of ['.page-head .actions{flex-wrap:nowrap;gap:6px;max-width:100%}', '.page-head .actions .btn .ico{display:none}', '.page-sub{flex-wrap:nowrap;max-width:100%;min-width:0}', '.page-sub .page-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}']) {
    assert.ok(phone.match(/@media \(max-width:640px\)\{\n  \.page-head\{[\s\S]*?\n\}/)[0].includes(rule), rule);
  }
  // Sidebar: the file card is a <details> whose one-line summary shows only on a phone; it is open on wider screens
  // (no matchMedia here = not a phone), closed on a phone until opened, and the choice is kept across redraws.
  const fold = () => page.els['app-sidebar'].innerHTML.match(/<details class="loaded-fold"[^>]*>[\s\S]*?<\/details>/)[0];
  assert.match(fold(), /^<details class="loaded-fold" open ontoggle="if\(isPhoneWidth\(\)\)loadedFoldOpen=this\.open"><summary class="loaded-sum" data-focus-key="sidebar-file" data-tip="[^"]+"><span class="live-dot"><\/span><span class="loaded-sum-text">kpi\.xls, supply\.xls, Orders At Risk - Clear to Build\.xlsx<\/span><\/summary><div class="loaded-card">/);
  assert.match(fold(), /data-focus-key="notes-editor"|data-focus-key="sidebar-add"/);
  page.ctx.matchMedia = (q) => ({ matches: q === '(max-width:640px)', addEventListener() {} });
  page.run('renderSidebar()');
  assert.match(fold(), /^<details class="loaded-fold" ontoggle=/);
  page.run('loadedFoldOpen=true;renderSidebar()');
  assert.match(fold(), /^<details class="loaded-fold" open /);
  delete page.ctx.matchMedia;
  assert.match(phone, /\.loaded-fold>summary\{display:none\}/);
  assert.match(phone, /@media \(max-width:640px\)\{\n  \.loaded-fold\{[^}]+\}\n  \.loaded-fold>summary\{display:flex;/);
  // The compact top bar keeps its tight gaps (the roomy side-column gaps are for wide screens).
  assert.match(phone, /@media \(max-width:980px\)\{\.sidebar\{gap:10px\}\.nav\{gap:4px\}/);
  assert.deepEqual(page.errors, []);
});

test('Monthly: month cards line up (short labels on one row, values under them), coming months with nothing are left out; one number-strip layout', async () => {
  const page = await loadedAll();
  // Export date 2026-09-03: Aug, Sep (this month), Oct, Nov. Oct and Nov have open lines; a month with no value goes.
  let h = open(page, 'monthly');
  const months = (x) => [...x.matchAll(/<div class="card month-card[^"]*"[^>]*>\s*<div class="kpi-top"><span class="kpi-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(months(h), ['Aug 2026', 'Sep 2026', 'Oct 2026']);
  assert.match(h, /<div class="month-spot n3">/);
  const stats = h.match(/<div class="month-stats">([\s\S]*?)<\/div>\s*<\/div>/)[1];
  assert.deepEqual([...stats.matchAll(/<span class="stat-label">([^<]+)<\/span>/g)].map((m) => m[1]), ['Closed', 'At risk', 'Rescheduled']);
  assert.match(CSS, /\.month-stats\{grid-template-columns:repeat\(3,auto\);grid-template-rows:auto auto;grid-auto-flow:column;/);
  assert.match(CSS, /\.month-stats>div\{display:contents\}/);
  assert.match(CSS, /\.month-stats \.stat-label\{white-space:nowrap\}/);
  // The last month and this month always show, even at $0.
  const quiet = loadPage();
  await upload(quiet, [{ name: 'kpi.xls', bytes: sapExport([sapRow({ DocumentNumber: '9', ...due('12/15/2026') })]) }]);
  quiet.run("setTab('monthly')");
  assert.deepEqual(months(results(quiet)), ['Aug 2026', 'Sep 2026']);
  assert.match(results(quiet), /<div class="month-spot n2">/);
  assert.deepEqual(quiet.errors, []);
  // Every number strip: the label, then the number, then the small lines (one layout, numbers level).
  for (const rule of ['.mini-strip .ms-text,.mini-strip .ms-num{display:contents}', '.mini-strip .ms-label{order:1}', '.mini-strip .ms-big{order:2;', '.mini-strip .ms-amt{order:3}', '.mini-strip .ms-sub{order:4}']) assert.ok(CSS.includes(rule), rule);
  // Open ship calendar: the first day's label starts at its column (it was cut off on the left).
  assert.match(CSS, /\.day-col:first-child>span\{align-self:flex-start\}/);
  assert.deepEqual(page.errors, []);
});

test('final gate: the filter divider runs edge to edge, first headings stay on one line, phone cards band the warehouse sub-headings and keep Edit beside the override', () => {
  const gate = CSS.slice(CSS.indexOf('/* --- 2v2 final gate --- */'), CSS.indexOf('/* --- end 2v2 final gate --- */'));
  // The divider is pulled 18px past each side of the bar's 18px padding, so it needs those 36px back.
  assert.match(CSS, /\.filter-bar\{display:flex;[^}]*padding:14px 18px;/);
  assert.match(CSS, /\.filter-bar \.break\{flex-basis:100%;height:1px;background:var\(--gray-100\);margin:0 -18px\}/);
  assert.match(gate, /\.filter-bar \.break\{flex-basis:calc\(100% \+ 36px\)\}/);
  assert.match(gate, /\.data-table>thead th:first-child\{white-space:nowrap\}/);
  const phone = gate.match(/@media \(max-width:640px\)\{[\s\S]*?\n\}/)[0];
  assert.match(phone, /\.data-table\.cards>tbody>tr\.grp-row,\.data-table\.cards>tbody>tr\.grp-row:hover\{display:block;padding:10px 18px;background:var\(--gray-50\)\}/);
  assert.match(phone, /\.data-table\.cards tr\.grp-row>td\{background:transparent\}/);
  assert.match(phone, /\.data-table\.cards td\.ovr-cell\{grid-column:1\/2\}/);
  // (width:auto: the desktop 1% width would leave the button hanging off the card's right edge)
  assert.match(phone, /\.data-table\.cards td\.c-edit\{grid-column:2\/3;justify-self:end;align-self:end;width:auto\}/);
  assert.match(CSS, /\.editable-rows \.c-edit\{width:1%;white-space:nowrap\}/);
  // After D1's card rules, so they win over the full-width edit place.
  assert.ok(CSS.indexOf('/* --- 2v2 final gate --- */') > CSS.indexOf('.data-table.cards td[data-card=item],.data-table.cards td[data-card=edit]{grid-column:1/-1}'));
});

run();
