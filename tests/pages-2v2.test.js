// Version 2v2 page layout (every page but Order Health), as the pages are today (2v6 / 2v6.9): named cards on the
// bento grid, the page head and top header, the load screen, long lists on request, and the same numbers as before.
// Run with `node tests/pages-2v2.test.js`. Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const results = (page) => page.els['results-screen'].innerHTML;
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
// 2v6: every page is a bento grid of titled cards (dzCard: .dz-card on a 6-column .dz-grid); named page groups
// (.pg-group) remain where a page has sections: Monthly and Warehouses.
// Per page: its cards in order (each named by its title, else its aria-label) and its top-level groups.
// (2v6.9: setTab('metrics') opens Sales Order Health on Lagging. Lagging, Version 1 (owner's pick): under Monthly and
// Quarterly it is four cards, Trend, Month by month, By warehouse and Booked vs shipped, with no page groups; its
// Metrics and Shipments groups are gone.)
const PAGE_LAYOUT = {
  // Purchase Order Health, Version 1 (owner's pick): the strip and PO At Risk, then Received on time (the vendors list
  // inside it) and Kits (Kit Status, Build Risk and Kits by CM and month inside it), then PO lines.
  purchaseorders: { cards: ['Where the open POs stand', 'PO At Risk', 'Received on time', 'Kits', 'PO lines'], groups: [] },
  buildrisk: { cards: ['Builds by month', 'Blocking builds', 'Orders at risk or late'], groups: [] },
  supplyweekly: { cards: ['Coverage', 'Short items by warehouse and month'], groups: [] },
  supplydemand: { cards: ['Demand by item group and month', 'Least covered', 'Demand by warehouse', 'Item groups'], groups: [] },
  monthly: { cards: ['September to date', 'Orders shipped by month', 'Month by month'], groups: ['Open and shipped, month by month', 'By delivery month', 'By original delivery date', 'Ship target scenario'] },
  warehouses: { cards: ['Late orders by week', 'Getting worse', 'Getting better', 'Warehouses to watch'], groups: ['By late shipments', 'By due month', 'By warehouse'] },
  metrics: { cards: ['Monthly', 'Quarterly', 'Trend', 'Month by month', 'By warehouse', 'Booked vs shipped'], groups: [] }, // owner: one Trend card, then three tables
  shipping: { cards: ['No shipments to show'], groups: [] },
  search: { cards: ['Order lines'], groups: [] },
};
const open = (page, tab) => { page.run(tab === 'search' ? "searchQuery='SPY';applyGlobalSearch()" : `setTab(${JSON.stringify(tab)})`); return results(page); };
// 2v6.9: Monthly, Warehouses and the Supply menu's pages start hidden (Settings > Hidden Pages); show them all.
const showAll = (page) => page.run("stgSet('hiddenPages',[])");
// Each card's name: the first heading inside it before any nested card, else its aria-label.
const cardNames = (h) => [...h.matchAll(/<section class="dz-card[^"]*"([^>]*)>/g)].map((m) => {
  const rest = h.slice(m.index + m[0].length);
  const end = rest.search(/<section\b|<\/section>/);
  const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(end < 0 ? rest : rest.slice(0, end));
  const label = /aria-label="([^"]+)"/.exec(m[1]);
  return (h2 ? h2[1].replace(/<[^>]+>/g, '').trim() : '') || (label ? label[1] : '') || '(no name)';
});
const groupNames = (h) => [...h.matchAll(/<section class="pg-group[^"]*"(?: id="[^"]+")? aria-labelledby="(pg-[\w-]+)" data-group="[\w-]+"><div class="pg-group-head"><h2 class="pg-group-title" id="(pg-[\w-]+)"(?: data-tip="[^"]+")?>([^<]+)<\/h2>/g)]
  .map((m) => { assert.equal(m[1], m[2], `${m[3]}: labelled by its own title`); return m[3]; });

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

test('every page is a set of named cards (and named groups where it has sections); each group is labelled by its own title', async () => {
  const page = await loadedAll();
  showAll(page);
  for (const [tab, want] of Object.entries(PAGE_LAYOUT)) {
    const h = open(page, tab);
    assert.equal(page.run('activeTab'), tab === 'metrics' ? 'weekly' : tab);
    assert.deepEqual(cardNames(h), want.cards, `${tab} cards`);
    assert.deepEqual(groupNames(h), want.groups, `${tab} groups`);
    // The page title is the one h1; nothing uses the old section headings any more.
    assert.equal((h.match(/<h1 class="dz-h1" tabindex="-1">/g) || []).length, 1, tab);
    assert.doesNotMatch(h, /class="section-title"/, `${tab}: an old section heading is left`);
    assert.doesNotMatch(h, /NaN|undefined|\[object Object\]/, tab);
  }
  // Purchase Order Health: the vendors list and Kits by CM and month are no longer cards of their own; they are
  // sections of the Received on time and Kits cards. The page reads as four questions.
  const po = open(page, 'purchaseorders');
  assert.deepEqual([...po.matchAll(/<div class="po-sec[^"]*"[^>]*><div class="ohs2-head"><div class="ohl-sec-title"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Vendors with the most late POs', 'Kits by CM and month']);
  assert.deepEqual([...po.matchAll(/<h2 class="ohl-q-t" data-tc-skip>([^<]+)<\/h2>/g)].map((m) => m[1]), ['What Is Open, and What Needs Attention?', 'Are Vendors Delivering on Time?', 'Are the Kits Ready?', 'Which Lines?']);
  // Lagging (the page setTab('metrics') opens): Trend is the card other pages link to (id="ohg-metrics"), full width
  // like Month by month; By warehouse and Booked vs shipped share the last row. What left Lagging is still on the
  // Monthly page (its cards above): Orders shipped by month and Monthly's own Month by month.
  const lag = open(page, 'metrics');
  assert.deepEqual([...lag.matchAll(/<section class="dz-card (dz-span-\d)[^"]*"( id="[\w-]+")?/g)].map((m) => [m[1], m[2] || '']),
    [['dz-span-3', ''], ['dz-span-3', ''], ['dz-span-6', ' id="ohg-metrics"'], ['dz-span-6', ''], ['dz-span-3', ''], ['dz-span-3', '']]);
  assert.doesNotMatch(lag, /class="pg-group|id="ohg-shipments"|Orders shipped by month|Original line delivery summary|Shipped by warehouse \/ CM/);
  // Sales Order Health (Leading) has no old section heading either.
  page.run("setTab('weekly');setWeeklyView('leading')");
  assert.doesNotMatch(results(page), /class="section-title"/);
  assert.deepEqual(page.errors, []);
});

// 2v6: the "at most four cards a row" rule is now the bento grid's: 6 columns, cards spanning 2, 3, 4 or 6, so no row
// holds more than three cards. (Shipping's four counts as one strip: tests/shipping-page.test.js.)
test('at most three cards in a row: the pages are 6-column grids whose cards span 2, 3, 4 or 6 columns', async () => {
  const page = await loadedAll();
  showAll(page);
  assert.match(CSS, /\n\.dz-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:16px\}/);
  for (const n of [2, 3, 4, 6]) assert.match(CSS, new RegExp(`\\n\\.dz-span-${n}\\{grid-column:span ${n}\\}`));
  assert.doesNotMatch(CSS, /\.dz-span-1\{/);
  for (const tab of Object.keys(PAGE_LAYOUT).filter((t) => t !== 'search' && t !== 'shipping')) {
    const h = open(page, tab);
    assert.doesNotMatch(h, /class="grid-5\b/, tab);
    // Purchase Order Health's two middle cards sit each in a question column (div.po-qcol.dz-span-3) that holds the
    // question heading over the card; the column carries the span.
    const cards = [...h.matchAll(/(<div class="po-qcol dz-span-3"><div class="ohl-q">[\s\S]*?<\/div>)?<section class="dz-card([^"]*)"/g)].map((m) => (m[1] ? ' dz-span-3 (column)' : '') + m[2]);
    assert.ok(cards.length && cards.every((c) => /\bdz-span-[2346]\b/.test(c)), `${tab}: ${cards.join(' | ')}`);
    if (tab === 'purchaseorders') assert.deepEqual(cards.map((c) => c.match(/dz-span-\d/)[0]), ['dz-span-4', 'dz-span-2', 'dz-span-3', 'dz-span-3', 'dz-span-6']);
  }
  // Paper keeps the 6 columns (print rule).
  assert.match(CSS, /@media print\{[\s\S]*?\n  \.dz-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:\.1in\}/);
});

test('the numbers on the cards are the same numbers the pages computed before', async () => {
  const page = await loadedAll();
  showAll(page);
  // Purchase Orders (2v6 strip): the tiles and the linked lines all come from poData; counts are POs (orders), the
  // value and lines under them, in full in the tips.
  let h = open(page, 'purchaseorders');
  const po = page.run('(()=>{const d=poData(currentMetrics());return {late:money(rowOpenAmount(d.poLateRows)),lateLines:d.poLateRows.length,latePos:rowDocCount(d.poLateRows),unconf:d.poUnconfirmedRows.length,open:d.poAllOpenRows.length,openPos:rowDocCount(d.poAllOpenRows),openValue:money(rowOpenAmount(d.poAllOpenRows))};})()');
  assert.deepEqual([po.late, po.lateLines, po.latePos, po.unconf, po.open, po.openPos, po.openValue], ['$4,400', 1, 1, 1, 3, 3, '$6,400']);
  // Version 1 (Joined Strip): each tile is now a step of "Where the open POs stand": its count, its share of the open
  // POs, and its lines (no money; the value is in the tip).
  const tile = (key) => h.match(new RegExp(`data-focus-key="potile-${key}"[^>]*data-tip="([^"]*)">[\\s\\S]*?<span class="po-step-v[^"]*">(\\d+)</span>[\\s\\S]*?<span class="po-step-of">([^<]*)</span><span class="po-step-s">([^<]*)</span>`)).slice(1);
  assert.deepEqual(tile('late'), [`Late / missed commit: ${po.latePos} PO past their date\n• ${po.lateLines} line · 10 qty\n• ${po.late} open\nClick to list them.`, String(po.latePos), '33% of open POs', `${po.lateLines} line`]);
  assert.deepEqual(tile('allopen'), [`Open POs: ${po.openPos} POs open in view\n• ${po.open} lines · 30 qty\n• ${po.openValue} open\nClick to list them.`, String(po.openPos), 'every open PO', `${po.open} lines`]);
  assert.match(h, new RegExp(`each bar is a share of the <b>${po.openPos}</b> open POs`));
  assert.match(h, new RegExp(`data-focus-key="potile-unconfirmed"[^>]*data-tip="Unconfirmed: ${po.unconf} PO not confirmed by the vendor`));
  // The PO lines card lists the late card's lines (the default pick), its chip the PO count.
  assert.match(h, new RegExp(`<h2 class="dz-title"[^>]*>PO lines</h2><span class="dz-chip red">${po.latePos} PO</span>`));
  assert.equal((h.slice(h.indexOf('<table class="sup-tbl sup-po">')).match(/<tr class="sup-row/g) || []).length, po.lateLines);
  // Build Risk: the newest week's totals per CM add up to the report's totals; the row count beside the week.
  h = open(page, 'buildrisk');
  const br = page.run('(()=>{const b=currentMetrics().buildRisk.snapshots[0];return {ctb:b.totalClearToBuild,risk:b.totalAtRisk,late:b.totalLate,rows:b.rows.length};})()');
  assert.deepEqual([br.ctb, br.risk, br.late, br.rows], [11, 2, 1, 2]);
  const cm = [...h.matchAll(/<span class="sup-cmnums"><span><b class="teal">(\d+)<\/b><i>clear<\/i><\/span><span><b class="amber">(\d+)<\/b><i>at risk<\/i><\/span><span><b class="red">(\d+)<\/b><i>late<\/i><\/span>/g)].map((m) => m.slice(1).map(Number));
  assert.deepEqual(cm, [[7, 2, 1], [4, 0, 0]]);
  assert.deepEqual([0, 1, 2].map((i) => cm.reduce((t, r) => t + r[i], 0)), [br.ctb, br.risk, br.late]);
  assert.match(h, new RegExp(`<strong class="ctb-rows">${br.rows}</strong> CTB report lines · 2 weeks loaded`));
  // Supply Mix shows demand by item group and month (no totals strip, no lines: those are on Supply / Demand and
  // Sales Order Health's Supply / Demand view).
  const sd = page.run('(()=>{const s=currentMetrics().supplyDemand;return {d:s.demandQty,u:s.usableQty,sh:s.shortageQty,r:s.riskQty,shRows:s.shortageRows.length,rRows:s.riskRows.length};})()');
  assert.deepEqual([sd.d, sd.u, sd.sh, sd.r, sd.shRows, sd.rRows], [25, 27, 6, 7, 1, 1]);
  h = open(page, 'supplydemand');
  assert.doesNotMatch(h, /class="grid-4 pg-stats"|Worst shortage (?:rows|lines)|Supply risk (?:rows|lines)<|class="sup-tbl sup-sd"/);
  assert.match(h, new RegExp(`<span class="sup-heat-t">${sd.d}</span>`));
  assert.match(h, new RegExp(`data-tip="No Item Group: about ${sd.sh} qty short\\."`));
  // Supply / Demand: the Coverage card for all warehouses.
  h = open(page, 'supplyweekly');
  assert.match(h, new RegExp(`<div data-tip="Open demand: ${sd.d} qty · \\$1,690"><div class="sup-meter-h"><span>Open demand</span><b>${sd.d} qty</b>`));
  assert.match(h, new RegExp(`<div class="sup-meter-h"><span>Open PO supply</span><b>${sd.u} qty</b>`));
  assert.match(h, new RegExp(`data-focus-key="sd-stat-short"[^>]*\\(${sd.sh} qty\\)[^>]*><div class="dz-stat-l">Short</div><div class="dz-stat-v"[^>]*>${sd.shRows} item</div>`));
  assert.match(h, new RegExp(`data-focus-key="sd-stat-risk"[^>]*\\(${sd.r} qty\\)[^>]*><div class="dz-stat-l">Supply at risk</div><div class="dz-stat-v"[^>]*>${sd.rRows} item</div>`));
  assert.match(h, new RegExp(`<span class="dz-big"[^>]*>${Math.round((sd.d - sd.sh) / sd.d * 100)}%</span><span class="dz-sub">of demand has open PO supply</span>`));
  // Monthly: this month so far against its ship target (booked for the month: open plus shipped, by original date).
  h = open(page, 'monthly');
  // (by original date, so line 3 rescheduled into September from August is not booked for September).
  const thisMonth = page.run("money((groupByOriginalHeaderMonth(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).find(g=>g.key===monthKey(reportToday()))||{openAmount:0}).openAmount)");
  assert.equal(thisMonth, '$3,250');
  assert.match(h, new RegExp(`<div class="mwm-bar" role="img" aria-label="\\$1K shipped of \\$3K booked for September" data-tip="Target: \\${thisMonth} booked for September\\n• \\$1,000 shipped`));
  h = open(page, 'metrics');
  assert.doesNotMatch(h, /On-track rate/); // owner: Order quality left with Metrics' Show more
  // Sales Order Health > Lagging (Version 1): the Trend card and the three tables show the numbers the page computes.
  // Delivery 901 shipped 07/30 for 08/01 (on time); 902 shipped 09/01 for 08/01 (31 days late), from CM - Alta.
  assert.deepEqual(page.run('mwmMetricsData(currentMetrics()).months.slice(9).map(r=>[shortMonth(r.date),r.orders,r.otd,r.perfect,r.days,r.lateOrders])'), [['Jul', 1, 100, null, 0, 0], ['Aug', 0, null, null, null, 0], ['Sep', 1, 0, null, 31, 1]]);
  assert.deepEqual(page.run('mwmMonthlyData(currentMetrics()).entries.slice(9).map(e=>e.shipped.value)'), [1000, 0, 1000]);
  assert.match(h, /<h3 data-tip="Shipped by the original date\.">On-time delivery · September to date<\/h3>\s*<div class="ohgt-now"><span>0%<\/span><\/div>/);
  assert.match(h, /Why orders were late · September<\/h3><ul class="mwm-causes"><li data-tip="Past due · No reschedule: 1 order of 1 late in September\."><span class="mwm-cause-l">Past due · No reschedule<\/span><b class="mwm-cause-v">1<\/b><\/li><\/ul>/);
  assert.match(h, /<td class="k">Sep 2026 <span class="mwm-todate">to date<\/span><\/td><td class="num">1<\/td><td class="num">\$1K<\/td><td class="num"><span class="dz-chip red">0%<\/span><\/td><td class="num">—<\/td><td class="num">31\.0<\/td><td class="num late">1<\/td>/);
  assert.match(h, /<td class="k">Aug 2026<\/td><td class="num">0<\/td><td class="num">\$0<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">0<\/td>/);
  assert.match(h, /<td class="k">Jul 2026<\/td><td class="num">1<\/td><td class="num">\$1K<\/td><td class="num"><span class="dz-chip teal">100%<\/span><\/td><td class="num">—<\/td><td class="num">0\.0<\/td><td class="num">0<\/td>/);
  // By warehouse: September's one delivery. Booked vs shipped: August has $2,000 shipped of $25,500 booked (8%) and
  // one line shipped late; September is the $3,250 booked for this month (thisMonth above), nothing shipped yet.
  assert.match(h, /By warehouse<\/h2><span class="dz-meta">September · 1 order<\/span>/);
  assert.match(h, /<td class="k">CM · Alta<\/td><td class="num">1<\/td><td class="num">\$1,000<\/td><td class="num"><span class="dz-chip red">0%<\/span><\/td>/);
  assert.match(h, /<td class="k">Aug 2026<\/td><td class="num">8%<\/td><td class="num">\$23,500<\/td><td class="num late">1<\/td>/);
  assert.match(h, new RegExp(`<td class="k">Sep 2026</td><td class="num">0%</td><td class="num">\\${thisMonth}</td><td class="num">0</td>`));
  assert.deepEqual(page.errors, []);
});

test('long lists open on request and always print: All demand, the scenario lines', async () => {
  const page = await loadedAll();
  showAll(page);
  // 2v6.9: the supply lines moved to Sales Order Health's Supply / Demand view; the short or at-risk lines show first,
  // every open demand line on request (All demand), 10 a page on screen and all of them on paper.
  page.run("setTab('weekly');setWeeklyView('supply')");
  const rows = () => (results(page).match(/<tr class="sup-row">/g) || []).length;
  const card = () => results(page).match(/<section class="dz-card sup-tcard[^"]*ohl-sd[^"]*">[\s\S]*?<\/section>/)[0];
  assert.match(card(), /<h2 class="dz-title"[^>]*>Short or at-risk items<\/h2>/);
  assert.match(card(), /data-focus-key="sd-view-all" aria-pressed="false" onclick="supSet\(&#39;sd-view&#39;,&#39;all&#39;\)" data-tip="Every open demand line in view\.">All demand<\/button>/);
  assert.equal(rows(), 2);
  page.run("supSet('sd-view','all')");
  assert.match(card(), /<h2 class="dz-title"[^>]*>All open demand<\/h2>/);
  assert.match(card(), /data-focus-key="sd-view-all" class="on" aria-pressed="true"/);
  assert.equal(rows(), 3);
  page.run('printMode=true;renderResults()');
  assert.equal(rows(), 3, 'print lists every line');
  page.run("printMode=false;supSet('sd-view','risk')");
  assert.equal(rows(), 2);
  // Monthly: the strip and the calendar sum the scenario up; its lines open with Show lines.
  let h = open(page, 'monthly');
  assert.match(h, /<section class="table pg-collapsed"><div class="card-head lg"><h2>Scenario lines<\/h2><div class="inline-controls"><span class="section-sub">\d+ open lines booked by [\d-]+<\/span><button [^>]*data-focus-key="more-monthly-scenario-lines"[^>]*>Show lines<\/button>/);
  assert.doesNotMatch(h, /aria-label="Scenario lines"/);
  page.run("toggleTableMore('monthly-scenario-lines')");
  assert.match(results(page), /aria-label="Scenario lines"><table class="data-table"/);
  page.run("toggleTableMore('monthly-scenario-lines');printMode=true;renderResults()");
  assert.match(results(page), /aria-label="Scenario lines"><table class="data-table"/);
  page.run('printMode=false');
  assert.deepEqual(page.errors, []);
});

// 2v6 (header redesign): the page head is the title (supply pages add their as-of line); the page actions moved into
// the top header, where the export date opens Add file / Share snapshot as round icon buttons named by aria-label (so
// phones keep the full names); no PDF button (print from the browser; print styles still apply); Data check is the
// Settings gear's dot.
test('page header: the title (and the as-of line where a page has one); the actions in the top header, named for screen readers; filters with Clear', async () => {
  const page = await loadedAll();
  showAll(page);
  let h = open(page, 'purchaseorders');
  assert.match(h, /^<div class="dz-pagehead rise"><h1 class="dz-h1" tabindex="-1">Purchase Order Health<\/h1><\/div>/);
  h = open(page, 'supplyweekly');
  assert.match(h, /^<div class="dz-pagehead rise"><h1 class="dz-h1" tabindex="-1">Supply \/ Demand<\/h1><span class="page-meta" data-tip="As of export date 2026-09-03">As of 2026-09-03 · 3 supply \/ demand lines<\/span><\/div>/);
  assert.doesNotMatch(h, /class="actions"|data-focus-key="export-pdf"|btn-long/);
  const head = page.els['app-header'].innerHTML;
  assert.match(head, /<button type="button" class="hdr-date[^"]*" id="hdr-date-btn" data-focus-key="sidebar-file" aria-haspopup="dialog" aria-expanded="false" aria-controls="hdr-file-pop" aria-label="[^"]{20,}"/);
  for (const [key, label] of [['sidebar-add', 'Add file'], ['hdr-share', 'Share snapshot']]) {
    assert.match(head, new RegExp(`<button type="button" class="hdr-icon live-act" data-focus-key="${key}" aria-label="${label}"[^>]*data-tip="${label}: [^"]+"`));
  }
  for (const label of ['Search orders, items and customers', 'Ask AI', 'Dark mode', 'Settings']) assert.match(head, new RegExp(`aria-label="${label}"`));
  assert.doesNotMatch(head + h, /export-pdf/);
  // Phones: the round icons and the logo share one row (32px icons, no gaps).
  assert.match(CSS, /@media \(max-width:420px\)\{\n  \.app-header\{column-gap:8px\}\n  \.hdr-right\{gap:0\}\n  \.hdr-right \.hdr-icon,\.hdr-right \.hdr-date\{width:32px;height:32px\}/);
  // Filter rows: the picked values print (Filters: line); Clear shows only while a filter is set, at the right.
  h = open(page, 'purchaseorders');
  assert.match(h, /<div class="print-only">Filters: All warehouses · All vendors<\/div>/);
  assert.doesNotMatch(h, /data-focus-key="filters-reset"/);
  page.run("setPoVendorFilter(['ACME'])");
  assert.match(results(page), /<button type="button" class="dz-clear" data-focus-key="filters-reset" onclick="resetPoFilters\(\)" data-tip="[^"]+">Clear<\/button><\/div><\/div><div class="print-only">Filters: All warehouses · Acme Parts<\/div>/);
  page.run('resetPoFilters()');
  assert.deepEqual(page.run('poVendorFilter'), ['ALL']);
  assert.deepEqual(page.errors, []);
});

// 2v6: the side bar became the top header: Sales Order Health, Purchase Order Health (2v6.9) and the other shown
// pages as links; the Supply pages in one Supply menu whose button names the current one; Settings is the gear.
test('page links: the current page marked once, the Supply pages in one menu, page descriptions in the tooltips', async () => {
  const page = await loadedAll();
  page.run("stgSet('hiddenPages',[]);setTab('supplyweekly')");
  const s = page.els['app-header'].innerHTML;
  const nav = s.match(/<nav class="hdr-nav" aria-label="Pages">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/data-focus-key="nav-(\w+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]),
    [['weekly', 'Sales Order Health'], ['purchaseorders', 'Purchase Order Health'], ['monthly', 'Monthly'], ['warehouses', 'Warehouses'], ['shipping', 'Shipping']]);
  assert.equal((s.match(/aria-current="page"/g) || []).length, 1);
  assert.match(s, /<button type="button" class="hdr-link active" id="hdr-supply-btn" aria-haspopup="menu" aria-expanded="false" onclick="dzMenuToggle\('hdr-supply',event\)">Supply · Supply \/ Demand/);
  assert.match(s, /<div class="dz-menu dz-menu-l" role="menu" aria-label="Supply pages" hidden><button type="button" role="menuitem" class="dz-menu-item sel" data-focus-key="nav-supplyweekly" onclick="dzMenuClose\(true\);setTab\('supplyweekly'\)" aria-current="page" data-tip="[^"]+"/);
  // Each link's tip is the page's one-line description.
  for (const id of ['weekly', 'purchaseorders', 'shipping', 'supplyweekly', 'supplydemand', 'buildrisk']) {
    assert.match(s, new RegExp(`data-focus-key="nav-${id}"[^>]*data-tip="${page.run(`esc(PAGE_TIPS.${id})`).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`), id);
  }
  assert.match(s, /<button type="button" class="hdr-icon hdr-gear" id="hdr-gear" data-focus-key="hdr-gear" aria-label="Settings[^"]*"/);
  assert.doesNotMatch(s, /nav-label|nav-item|loaded-meta/);
  // The export date (what was loaded is in its popover).
  assert.match(s, /<span class="hdr-date-txt">3 Sep<\/span>/);
});

test('load screen: one drop area until a report is loaded, then the loaded report beside it; every page listed with what it shows', async () => {
  const page = loadPage();
  page.run('renderUploadState()');
  assert.equal(page.els['upload-side'].hidden, true);
  const pages = page.els['upload-pages'].innerHTML;
  assert.deepEqual([...pages.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Sales', 'Help']); // 2v6.9: the Supply group's pages start hidden
  // Every page in the menus is listed with its description; 2v6.9: Monthly, Warehouses and the Supply pages start
  // hidden (so are left out until shown again), Metrics is part of Sales Order Health, Connect is in Settings.
  assert.deepEqual([...pages.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]), ['Sales Order Health', 'Purchase Order Health', 'Shipping', 'Settings']);
  for (const id of ['weekly', 'purchaseorders', 'shipping', 'settings']) {
    const tip = page.run(`PAGE_TIPS.${id}||NAV_GROUPS.flatMap(g=>g[1]).find(p=>p[0]===${JSON.stringify(id)})[2]`);
    assert.ok(pages.includes(`<span class="page-desc">${page.run(`esc(${JSON.stringify(tip)})`)}</span>`), id);
  }
  for (const id of ['monthly', 'warehouses', 'metrics', 'supplyweekly', 'supplydemand', 'buildrisk']) {
    assert.ok(!pages.includes(`<span class="page-desc">${page.run(`esc(PAGE_TIPS.${id})`)}</span>`), id);
  }
  assert.match(HTML, /<section class="dz-card misc-pages rise rise-3" aria-labelledby="pg-upload-pages" data-group="upload-pages"><div class="dz-card-head"><h2 class="dz-title sm" id="pg-upload-pages">What each page shows<\/h2><\/div><div class="upload-pages" id="upload-pages"><\/div><\/section>/);
  assert.match(HTML, /<h1 class="dz-h1 page-title">Load KPI export<\/h1><p class="dz-sub page-lead">Load SAP exports into one offline summary\.<\/p>/);
  assert.doesNotMatch(HTML, /class="flow-step"/);
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }]);
  page.run('showUpload()');
  assert.equal(page.els['upload-side'].hidden, false);
  assert.match(page.els['upload-current'].innerHTML, /Currently loaded<\/span><strong>kpi\.xls · Export date 2026-09-03<\/strong>/);
  // Before a report is loaded the side card is not drawn at all (no blank box on a phone).
  assert.match(CSS, /\n\.upload-side\[hidden\]\{display:none\}/);
  assert.deepEqual(page.errors, []);
});

test('Purchase Orders lines: the reschedule date sits under the status; the table fits a 1366px screen', async () => {
  const page = await loadedAll();
  page.run("setTab('purchaseorders');setPoTileFilter('allopen')");
  // 2v6 (2v6.5): the PO lines card's table (sup-tbl sup-po): 11 columns with Owner and Kit Clean?; no Reschedule column.
  const table = results(page).match(/<table class="sup-tbl sup-po">[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>|↕/g, '').trim()),
    ['PO #', 'Vendor', 'Item', 'Owner', 'Warehouse', 'Promised', 'Open qty', 'Value', 'Status', 'Kit Clean?', 'Note']); // Title Case is a DOM pass in the browser
  assert.doesNotMatch(table, />Reschedule<|class="badge /);
  // The reschedule date sits under the status word, after its timing line.
  assert.match(table, /<span class="dz-chip amber">Rescheduled<\/span><span class="sup-sub">\d+d pushed out<\/span><span class="sup-sub">↻ Sep 25<\/span>/);
  // It fits the 1366px screen's card (1248px for the table, see tests/linked-lines.test.js): every column but Item has a
  // set width; below 1240px it scrolls sideways in its card.
  assert.equal((table.match(/<colgroup>([\s\S]*?)<\/colgroup>/)[1].match(/<col\b/g) || []).length, 11);
  assert.match(CSS, /\n\.sup-po\{--min:1240px\}/);
  assert.match(results(page), /<div class="sup-scroll" tabindex="0" role="region" aria-label="Linked purchase-order lines"><table class="sup-tbl sup-po">/);
});

test('supply rows: Supply / Demand and Search give a row the same status (shortage, then risky supply), the SAP flag in the tip', async () => {
  const page = await loadedAll();
  showAll(page);
  // SPY-200 (CM - Alta) is covered but its PO supply is unconfirmed and late: risky supply, the quantities under it,
  // the SAP flag in the tip. Search says "Supply risk" (supplyRowStatus); since 2v6 the Supply / Demand view's status
  // (supSdStatus, now on Sales Order Health) names the riskiest PO problem ("Late PO") from the same row status, so
  // the two never disagree on short versus covered, and show the same quantities and flag.
  page.run("setTab('weekly');setWeeklyView('supply')");
  assert.match(results(page), /<td class="sup-status" data-tip="SAP flag: PO Not Confirmed\." data-label="Supply"><span class="ohs-st red"><i aria-hidden="true"><\/i>Late PO<\/span><span class="ohs-st-sub">Unconfirmed 5 · Late 2<\/span><\/td>/);
  assert.match(results(page), /<td class="sup-status" data-label="Supply"><span class="ohs-st red"><i aria-hidden="true"><\/i>Short<\/span><\/td>/, 'SPY-100 is short');
  page.run("searchQuery='SPY-200';applyGlobalSearch()");
  const search = results(page).match(/<h2>Supply \/ demand<\/h2>[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...search.matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), ['Month', 'Warehouse', 'Item', 'Demand qty', 'Usable supply', 'Monthly net', 'Cumulative net', 'Risk']);
  // The Search table stacks as cards on a phone, so the cell also names its column and its card place.
  assert.match(search, /<td data-tip="SAP flag: PO Not Confirmed\." data-label="Risk" data-card="st"><span class="pill warn">Supply risk<\/span><span class="sub">Unconfirmed 5 · Late 2<\/span><\/td>/);
  const base = { isCumulativeShortage: false, isMonthlyShortage: false, hasSupplyRisk: false, hasDemandRisk: false, unconfirmedSupplyQty: 0, noCommitSupplyQty: 0, rescheduledSupplyQty: 0, lateSupplyQty: 0, demandNoCommitQty: 0, supplyRiskFlag: '' };
  for (const r of [{ isCumulativeShortage: true, hasSupplyRisk: true, unconfirmedSupplyQty: 3 }, { isMonthlyShortage: true }, { hasSupplyRisk: true, lateSupplyQty: 2, supplyRiskFlag: 'Late' },
    { hasSupplyRisk: true, noCommitSupplyQty: 4 }, { hasSupplyRisk: true, unconfirmedSupplyQty: 1 }, { hasSupplyRisk: true, rescheduledSupplyQty: 1 }, { hasDemandRisk: true, demandNoCommitQty: 2 }, {}]) {
    const x = { ...base, ...r };
    const [a, b] = [page.run(`supplyRowStatus(${JSON.stringify(x)})`), page.run(`supSdStatus(${JSON.stringify(x)})`)];
    assert.equal(a.tone === 'bad', b.label === 'Short', JSON.stringify(r));
    assert.equal(a.label === 'Covered', b.label === 'Covered', JSON.stringify(r));
    assert.deepEqual([b.detail, b.flag], [a.detail, a.flag], JSON.stringify(r));
  }
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

// 2v6.9 (owner, cf78fce / c0baac5 / 155bfec): the short or at-risk lines left the Supply / Demand page for Sales Order
// Health's Supply / Demand view; the warehouse is a column (no sub-heading rows); no Supply at risk only chip (the
// page's Short / Supply at risk numbers open the view). The view's sorting, status words and filters:
// tests/leading-2v69.test.js ("Views: Leading | Lagging | Supply / Demand ..."); 10 a page is dzPageOf (tests/pager-2v69.test.js).
test('Supply / Demand: the short or at-risk lines are one table with a Warehouse column; the page\'s numbers open it', async () => {
  const page = await loadedAll();
  showAll(page);
  let h = open(page, 'supplyweekly');
  assert.doesNotMatch(h, /<table|grp-row|data-focus-key="sd-risk-only"|Supply at risk only/, 'the page keeps Coverage and the heat map');
  page.run("supSdFocus('risk')");
  assert.deepEqual(page.run('[activeTab,weeklyView]'), ['weekly', 'supply']);
  h = results(page);
  const card = h.match(/<section class="dz-card sup-tcard[^"]*ohl-sd[^"]*">[\s\S]*?<\/section>/)[0];
  assert.equal((card.match(/<table class="sup-tbl sup-sd"/g) || []).length, 1);
  assert.equal((card.match(/<thead>/g) || []).length, 1);
  assert.doesNotMatch(card, /grp-row|role="heading"|Supply at risk only/);
  // One row per item and month: its warehouse, demand, supply, the quantity short and the status.
  const rows = [...card.matchAll(/<tr class="sup-row"><td[^>]*>([^<]*)<\/td><td[^>]*>[^<]*<\/td><td class="ohs-wh sup-soft" data-label="Warehouse">([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td class="sup-status"[^>]*><span class="ohs-st (\w+)"><i aria-hidden="true"><\/i>([^<]+)<\/span>/g)].map((m) => m.slice(1));
  assert.deepEqual(rows, [['SPY-200', 'CM · Alta', 'Sep', '12 qty', '20', '0', 'red', 'Late PO'], ['SPY-100', 'Spyder · Lacombe', 'Oct', '10 qty', '4', '6', 'red', 'Short']]);
  assert.match(card, /<span class="ohs-sum"><span class="ohs-sum-i red"><b>1<\/b> short<\/span><span class="ohs-sum-i amber"><b>1<\/b> supply at risk<\/span><span class="ohs-sum-i"><b>2<\/b> lines in view<\/span><\/span>/);
  // Phone cards: every cell names its column.
  assert.ok([...card.matchAll(/<td\b[^>]*>/g)].every((m) => /data-label="[^"]+"/.test(m[0])));
  // A warehouse pick narrows the table.
  page.run("setSupplyWarehouseFilter(['Spyder - Lacombe'])");
  assert.deepEqual([...results(page).matchAll(/data-label="Warehouse">([^<]+)</g)].map((m) => m[1]), ['Spyder · Lacombe']);
  page.run("setSupplyWarehouseFilter(['ALL'])");
  assert.deepEqual(page.errors, []);
});

test('load screen: What each page shows is filled on the first visit, before any report or showUpload()', () => {
  const page = loadPage();
  const pages = page.els['upload-pages'].innerHTML;
  // 2v6.9: the Supply menu's pages start hidden, so the Supply group is left out until one is shown again.
  assert.deepEqual([...pages.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Sales', 'Help']);
  page.run("isSnapshotView=false;stgSet('hiddenPages',[]);renderUploadPages()");
  const shown = page.els['upload-pages'].innerHTML;
  assert.deepEqual([...shown.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Sales', 'Supply', 'Help']);
  assert.ok(shown.includes(`<span class="page-desc">${page.run('esc(PAGE_TIPS.supplyweekly)')}</span>`));
  assert.deepEqual(page.errors, []);
});

// 2v6: no Share / PDF buttons and no side bar file card any more (they were the phone-header problems this test
// guarded); the loaded files sit behind the header's export date, one small button on every width.
test('phone header: no page buttons; the export date folds the loaded files, Add file, New file and Share snapshot into one popover', async () => {
  const page = await loadedAll();
  page.run("stgSet('dataSource','import')"); // the import screen's popover (live mode shows the SAP status instead)
  const h = open(page, 'purchaseorders');
  assert.doesNotMatch(h, /data-focus-key="export-pdf"|class="actions"|class="page-sub"/);
  const head = () => page.els['app-header'].innerHTML;
  assert.doesNotMatch(head(), /loaded-fold|loaded-card|class="sidebar/);
  assert.match(head(), /<button type="button" class="hdr-date" id="hdr-date-btn" data-focus-key="sidebar-file" aria-haspopup="dialog" aria-expanded="false" aria-controls="hdr-file-pop" aria-label="Export date 3 Sep: loaded files, Add file, New file and Share snapshot" onclick="dzMenuToggle\('hdr-file',event\)"/);
  const pop = head().match(/<div class="dz-menu dz-menu-r hdr-pop[^"]*" id="hdr-file-pop" role="dialog"[^>]*hidden>[\s\S]*?(?=<div class="hdr-search)/)[0];
  // The first two file names, then "+ 1 more"; the actions as round icon buttons, each named.
  assert.match(pop, /<div class="hdr-pop-name">kpi\.xls<br>supply\.xls <span class="hdr-pop-more">\+ 1 more<\/span><\/div>/);
  assert.deepEqual([...pop.matchAll(/data-focus-key="([\w-]+)" aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]]), [['sidebar-add', 'Add file'], ['sidebar-new', 'New file'], ['hdr-share', 'Share snapshot']]);
  // Mid widths show the date as its file icon (the text label stays in the button's name).
  assert.match(CSS, /@media \(min-width:761px\) and \(max-width:1180px\)\{[^}]*\}[^@]*\.hdr-date \.hdr-date-txt\{display:none\}\n  \.hdr-date \.hdr-date-ico\{display:block\}/);
  assert.deepEqual(page.errors, []);
});

test('Monthly: month cards line up (short labels on one row, values under them), coming months with nothing are left out; one number-strip layout; Lagging has neither any more', async () => {
  const page = await loadedAll();
  const months = (x) => [...x.matchAll(/<div class="card month-card[^"]*"[^>]*>\s*<div class="kpi-top"><span class="kpi-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  // Lagging, Version 1 (owner's pick): while Monthly is hidden its link opens Sales Order Health on Lagging, which no
  // longer draws the month cards or the shipped-to-date strip. Month to date and year to date are its one "so far"
  // line (year over year is gone).
  let h = open(page, 'monthly');
  assert.deepEqual(page.run('[activeTab,weeklyView]'), ['weekly', 'lagging']);
  assert.deepEqual(months(h), []);
  assert.doesNotMatch(h, /month-card|month-spot|month-stats|mini-strip|Year over year/);
  assert.match(h, /<p class="ohgt-sofar" data-tip="September so far\n• 1 order shipped, \$1,000 on 1 delivery line\n• Year to date: \$2,000 on 2 delivery lines"><b>September so far:<\/b> 1 order · \$1K shipped · year to date \$2K<\/p>/);
  // The month cards and the strip are still on the Monthly page (Settings > Hidden Pages shows it again).
  showAll(page);
  h = open(page, 'monthly');
  assert.equal(page.run('activeTab'), 'monthly');
  // Export date 2026-09-03: Aug, Sep (this month), Oct, Nov. Oct and Nov have open lines; a month with no value goes.
  assert.deepEqual(months(h), ['Aug 2026', 'Sep 2026', 'Oct 2026']);
  // The strip's month to date and year to date are the two figures of Lagging's "so far" line.
  assert.deepEqual([...h.matchAll(/<span class="ms-label">([^<]+)<\/span>[\s\S]*?<span class="ms-big lg ?">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]),
    [['Month to date shipped', '$1,000'], ['Year to date shipped', '$2,000'], ['Year over year · Sep 1–3', '—']]);
  assert.match(h, /<div class="month-spot n3">/);
  const stats = h.match(/<div class="month-stats">([\s\S]*?)<\/div>\s*<\/div>/)[1];
  assert.deepEqual([...stats.matchAll(/<span class="stat-label">([^<]+)<\/span>/g)].map((m) => m[1]), ['Closed', 'At risk', 'Rescheduled']);
  assert.match(CSS, /\.month-stats\{grid-template-columns:repeat\(3,auto\);grid-template-rows:auto auto;grid-auto-flow:column;/);
  assert.match(CSS, /\.month-stats>div\{display:contents\}/);
  assert.match(CSS, /\.month-stats \.stat-label\{white-space:nowrap\}/);
  // The last month and this month always show, even at $0.
  const quiet = loadPage();
  await upload(quiet, [{ name: 'kpi.xls', bytes: sapExport([sapRow({ DocumentNumber: '9', ...due('12/15/2026') })]) }]);
  showAll(quiet);
  quiet.run("setTab('monthly')");
  assert.equal(quiet.run('activeTab'), 'monthly');
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
