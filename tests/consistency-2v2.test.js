// 2v2 design fixes, Order Health and consistency: Us vs Them once, the At risk now grid, one group vocabulary on every
// page ("By …" breakdowns, "Lines to act on" with an ⓘ and a count pill), Leading · / Lagging · on Purchase Orders and
// no Hide links, one-line lagging labels with one target and a neutral "→ 0 pts", and "lines" (not rows) in the text.
// Run with `node tests/consistency-2v2.test.js`. Fixtures are synthetic (harness.js); no SAP data.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const CSS = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
const results = (page) => page.els['results-screen'].innerHTML;
const text = (h) => h.replace(/<details class="data-check[\s\S]*?<\/details>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const due = (d) => ({ DueDate: d, HeaderDueDate: d, LineDueDate: d });
const PO = (o) => sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...o });
const shipped = (o) => sapRow({ OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', CloseDateSource: 'Delivery', OpenQuantity: '0', FillStatus: 'Complete', ...o });

// Export date 09/03/2026 (a Thursday): past due, no commit, rescheduled and future sales lines; one delivery this week
// and one last week (Aug 23-29); purchase orders (one receipt last week), a supply / demand snapshot and a Clear To
// Build report.
const ROWS = [
  sapRow({ DocumentNumber: '1', Warehouse: 'Spyder - Lacombe', AmountLocal: '21,500.00', ...due('08/10/2026') }),
  sapRow({ DocumentNumber: '2', Warehouse: 'CM - Alta', ...due('08/20/2026'), LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' }),
  sapRow({ DocumentNumber: '3', Warehouse: 'CM SFG - Gamma', ...due('08/25/2026'), LineRescheduleDate: '09/20/2026', RescheduleDate: '09/20/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
  sapRow({ DocumentNumber: '4', Warehouse: 'CM SFG - Delta', AmountLocal: '3,250.00', ...due('09/08/2026') }),
  sapRow({ DocumentNumber: '5', Warehouse: 'CM - Beta', ...due('10/15/2026') }),
  shipped({ DocumentNumber: '6', Warehouse: 'CM SFG - Gamma', ...due('08/20/2026'), ClosedDate: '08/26/2026', DeliveryDocNumber: '901' }),
  shipped({ DocumentNumber: '7', Warehouse: 'CM - Alta', ...due('08/01/2026'), ClosedDate: '09/01/2026', DeliveryDocNumber: '902' }),
  PO({ DocumentNumber: '700', Warehouse: 'CM - Alta', AmountLocal: '4,400.00', ...due('08/10/2026') }),
  PO({ DocumentNumber: '701', Warehouse: 'Spyder - Lacombe', ...due('09/30/2026'), Confirmed: 'N' }),
  PO({ DocumentNumber: '702', Warehouse: 'Spyder - Lacombe', OrderType: 'PO Receipt', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: '08/26/2026', CloseDateSource: 'Receipt', DeliveryDocNumber: '88', OpenQuantity: '0', ...due('08/15/2026') }),
];
const SD_HEADERS = ['#', 'ExportDate', 'Item No.', 'ItemDescription', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'UnconfirmedSupplyQty', 'LateSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'RiskSupplyQty', 'SupplyRiskFlag'];
const SD_ROWS = [
  { '#': '1', ExportDate: '09/03/2026', 'Item No.': 'SPY-100', WarehouseCode: '11', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '10', DemandOpenValue: '1000', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0', SupplyRiskFlag: 'OK' },
  { '#': '2', ExportDate: '09/03/2026', 'Item No.': 'SPY-200', WarehouseCode: '12', WarehouseName: 'CM - Alta', YearMonth: '2026-09', DemandOpenQty: '12', DemandOpenValue: '600', UsableSupplyQty: '20', UnconfirmedSupplyQty: '5', LateSupplyQty: '2', MonthlyNetQty: '8', CumulativeNetQty: '8', RiskSupplyQty: '7', SupplyRiskFlag: 'PO Not Confirmed' },
];
function ctbWorkbook(page) {
  const head = ['CM ', 'Month', 'Total', 'Clear To Build', 'At Risk', 'Late', 'Closed', '% CTB', '% Late Orders', 'NOTES'];
  const sheets = [{ name: '0930 - Orders at Risk', aoa: [head, ['Alta', 'September', 10, 7, 2, 1, 0, '70%', '10%'], [null, 'TOTAL', 10, 7, 2, 1, 0, '70%', '10%']] }];
  return new Uint8Array(page.run(`(()=>{const wb=XLSX.utils.book_new();for(const s of ${JSON.stringify(sheets)})XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.aoa),s.name);return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));})()`));
}
async function loadedAll() {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }, { name: 'supply.xls', bytes: utf16Tsv(SD_HEADERS, SD_ROWS) }, { name: 'ctb.xlsx', bytes: ctbWorkbook(page) }]);
  return page;
}
const open = (page, tab, view) => { page.run(`setTab(${JSON.stringify(tab)})${view ? `;setWeeklyView(${JSON.stringify(view)})` : ''}`); return results(page); };
// Order Health draws both tab panels; only the shown one counts.
const shown = (h) => h.replace(/<div class="oh-panel" role="tabpanel" id="oh-panel-\w+"[^>]*hidden>[\s\S]*?(?=<div class="oh-panel"|<section class="pg-group[^"]*" aria-labelledby="oh-g-where")/, '');
const titles = (h) => [...h.matchAll(/<h2 class="pg-group-title" id="[^"]+"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
const PAGES = [['weekly', 'leading'], ['weekly', 'lagging'], ['purchaseorders'], ['buildrisk'], ['supplyweekly'], ['supplydemand'], ['monthly'], ['warehouses'], ['metrics']];

test('Us vs Them shows once: not inside the At Risk card; its card is one column with the numbers right-aligned', async () => {
  const page = await loadedAll();
  const h = open(page, 'weekly', 'leading');
  const hero = h.match(/<button type="button" class="card kpi hero[^"]*"[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(hero, /oh-cause|Us \$|Them \$|Not set \$/);
  const lead = h.slice(h.indexOf('id="oh-panel-leading"'), h.indexOf('id="oh-panel-lagging"'));
  assert.equal((lead.match(/class="split-bar oh-cause-bar/g) || []).length, 1, 'one Us / Them bar on the Leading tab');
  const card = lead.match(/<section class="card list-card oh-card" aria-labelledby="oh-cause-title">[\s\S]*?<\/section>/)[0];
  for (const b of card.match(/<button type="button" class="oh-cause-btn[\s\S]*?<\/button>/g)) {
    assert.match(b, /<span class="oh-cause-name"><i class="sw lg cause-\w+"><\/i>[^<]+<\/span><strong>\$[\d,]+<\/strong><span class="muted">\d+ lines? · \d+ orders?<\/span><\/button>$/);
  }
  assert.match(CSS, /\.oh-cause-grid\{display:grid;grid-template-columns:minmax\(0,1fr\);/);
  assert.match(CSS, /\.oh-cause-btn\{font:inherit;display:grid;grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(CSS, /\.oh-cause-name\{grid-row:1\/span 2;/);
  assert.match(CSS, /\.oh-cause-btn strong\{grid-column:2;text-align:right;/);
  assert.match(CSS, /\.oh-cause-btn \.muted\{grid-column:2;text-align:right;white-space:nowrap;/);
  assert.doesNotMatch(HTML, /function ohHeroCause|oh-cause-line/);
  assert.deepEqual(page.errors, []);
});

test('the At Risk legend names only the parts with a card beside it; the tip keeps the past-due count', async () => {
  const page = await loadedAll();
  const h = open(page, 'weekly', 'leading');
  const hero = h.match(/<button type="button" class="card kpi hero[^"]*"[\s\S]*?<\/button>/)[0];
  const oh = page.run('(()=>{const o=orderHealthData(currentMetrics());return [o.pastDueNoReschedule.length,o.noCommitRows.length,o.activeRescheduleRows.length];})()');
  assert.deepEqual(oh, [1, 1, 1]);
  const legend = hero.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(legend, /past due/);
  assert.match(legend, /1 no commit<\/span>/);
  assert.match(legend, /1 rescheduled<\/span>/);
  // The bar still splits the whole card (three parts).
  assert.equal((hero.match(/<div class="split-bar"[^>]*>([\s\S]*?)<\/div>/)[1].match(/<i /g) || []).length, 3);
  assert.match(hero, /data-tip="At risk: \$[\d,]+ open on 3 orders \(3 lines\), 1 past due with no reschedule; click to list them below\."/);
});

test('At risk now is one grid: the At Risk card beside No commit date, the tiles beside Rescheduled; even gaps', async () => {
  assert.match(CSS, /\.oh-risk\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);grid-template-areas:"hero nc" "tiles resch";gap:var\(--space-in\)\}/);
  assert.match(CSS, /\.oh-risk-main,\.oh-risk-side\{display:contents\}/);
  assert.match(CSS, /\.oh-risk-main>\.hero\{grid-area:hero;/);
  assert.match(CSS, /\.oh-risk-main>\.ovr\{grid-area:tiles;/);
  assert.match(CSS, /\.oh-risk-side>:first-child\{grid-area:nc\}/);
  assert.match(CSS, /\.oh-risk-side>:last-child\{grid-area:resch\}/);
  assert.match(CSS, /@media \(max-width:1180px\)\{\n  \.oh-risk\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-areas:"hero hero" "tiles tiles" "nc resch"\}/);
  assert.match(CSS, /@media print\{[\s\S]*?\.oh-risk\{grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);grid-template-areas:"hero nc" "tiles resch";gap:\.1in\}/);
  // The By reason and cause cards: the page's 20px gap, each card as tall as its own content.
  assert.match(CSS, /\.oh-grid\{display:grid;grid-template-columns:minmax\(0,1\.25fr\) minmax\(0,1fr\) minmax\(0,1fr\);gap:var\(--space-in\);/);
  assert.match(CSS, /\.pg-group \.oh-grid\{align-items:start\}/);
  assert.doesNotMatch(CSS, /\.pg-group \.oh-grid\{align-items:stretch\}/);
  // The grid areas follow the markup: the hero then the tiles; No commit date first, Rescheduled last.
  const page = await loadedAll();
  const h = open(page, 'weekly', 'leading');
  assert.match(h, /<div class="oh-risk-main">\s*<button type="button" class="card kpi hero[\s\S]*?<\/button>\s*<div class="ovr">/);
  assert.match(h, /<div class="oh-risk-side">\s*<button type="button" class="card kpi[^"]*" data-focus-key="tile-nocommit"[\s\S]*?<\/button>\s*<button type="button" class="card kpi[^"]*" data-focus-key="tile-active"[\s\S]*?<\/button>\s*<\/div>/);
});

test('one group vocabulary: a summary first, breakdowns "By …", the list group "Lines to act on" with an ⓘ and a count pill', async () => {
  const page = await loadedAll();
  assert.equal(page.run('weeklyTileFilter'), 'late', 'At risk is the card picked by default');
  const allowed = /^(By |Lines to act on( · |$)|Lagging · |All open lines$|Ship target scenario$)/;
  const heads = {};
  for (const [tab, view] of PAGES) {
    const h = shown(open(page, tab, view));
    const t = titles(h);
    assert.ok(t.length >= 2, `${tab}: ${t}`);
    t.slice(1).forEach((x) => assert.match(x, allowed, `${tab}${view ? ` ${view}` : ''}: "${x}"`));
    for (const old of ['Linked PO lines', 'Orders to act on', 'Rows to check', 'Where the gaps are', 'Where the risk is', 'Why lines are at risk', 'Coming due', 'Performance by warehouse', 'Shortages by warehouse', 'Order lines', 'Supply at risk', 'All open demand']) {
      assert.ok(!t.includes(old), `${tab}: old name "${old}"`);
    }
    // The list group's head: the title (its help as the tooltip, no ⓘ button), then the pill with a line count.
    const head = h.match(/<div class="pg-group-head"><h2 class="pg-group-title" id="[^"]+" data-tip="([^"]+)">Lines to act on<\/h2><span class="count-badge[^"]*">([^<]+)<\/span>/);
    // (Supply Mix leaves its shortage and risk lines to Supply / Demand, so its groups are all "By …".)
    if (['weekly', 'purchaseorders', 'buildrisk', 'supplyweekly', 'metrics'].includes(tab)) {
      assert.ok(head, `${tab}: Lines to act on with its help tip and a pill`);
      assert.match(head[2], /\b\d+ (?:[\w-]+ )?lines?\b/, `${tab}: ${head[2]}`);
      const key = page.run(`Object.keys(SECTION_INFO).find(k=>esc(sectionTipText(k))===${JSON.stringify(head[1])})`);
      assert.equal(page.run(`SECTION_INFO[${JSON.stringify(key)}].title`), 'Lines to act on', `${tab}: the help is the group's own`);
      heads[tab + (view || '')] = head[2];
    }
  }
  // Order Health and Purchase Orders: the picked card's name, then lines and value, in the same pill.
  assert.match(heads.weeklyleading, /^At risk · 3 lines · \$[\d,]+$/);
  assert.match(heads.weeklylagging, /^OTD · 3 mo · \d+ delivered lines? · \$[\d,]+$/);
  assert.match(heads.purchaseorders, /^Late \/ missed commit · 1 line · 10 open qty · \$[\d,]+$/);
  // Supply / Demand: one list to act on (short or at-risk lines, warehouse sub-headings), All open lines folded in it.
  const sd = open(page, 'supplyweekly');
  assert.deepEqual(titles(sd), ['Coverage', 'Lines to act on']);
  assert.equal(heads.supplyweekly, '2 lines');
  assert.ok(sd.includes(`${page.run("sectionTip('sd-shortages')")}>Lines to act on</h2><span class="count-badge bad">2 lines</span>`));
  assert.equal(page.run("SECTION_INFO['sd-shortages'].title"), 'Lines to act on');
  assert.deepEqual(titles(open(page, 'supplydemand')), ['By month and warehouse', 'By item group']);
  assert.deepEqual(page.errors, []);
});

test('Leading · / Lagging · on Purchase Orders; no Hide links on Order Health; an older snapshot with hidden cards opens them', async () => {
  const page = await loadedAll();
  const po = open(page, 'purchaseorders');
  assert.deepEqual(titles(po).slice(0, 2), ['Leading · Supply commitments', 'Lagging · Receiving performance']);
  assert.equal(page.run("SECTION_INFO['po-commitments'].title"), 'Leading · Supply commitments');
  assert.equal(page.run("SECTION_INFO['po-receiving'].title"), 'Lagging · Receiving performance');
  assert.doesNotMatch(po, /role="tab"/, 'no tabs on Purchase Orders');
  for (const view of ['leading', 'lagging']) {
    const h = open(page, 'weekly', view);
    assert.doesNotMatch(h, /toggle-leading|toggle-lagging|toggleLeadingIndicators|toggleLaggingIndicators/, view);
    assert.doesNotMatch(h.match(/<div class="pg-group-head">[\s\S]*?<\/div>/)[0], />(Hide|Show)</, view);
  }
  // The flags still travel in a snapshot (always off); an older file that saved them on opens with the cards shown.
  let payload = '';
  Object.assign(page.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  page.run("setTab('weekly');setWeeklyView('leading')");
  await page.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.deepEqual([data.weeklyLeadingCollapsed, data.weeklyLaggingCollapsed], [false, false]);
  const viewer = loadPage();
  viewer.els['embedded-snapshot-data'].dataset.encoding = 'json';
  viewer.els['embedded-snapshot-data'].textContent = JSON.stringify({ ...data, weeklyLeadingCollapsed: true, weeklyLaggingCollapsed: true });
  await viewer.run('loadEmbeddedSnapshot()');
  assert.deepEqual(viewer.run('[weeklyLeadingCollapsed,weeklyLaggingCollapsed]'), [false, false]);
  const v = results(viewer);
  assert.match(v, /data-focus-key="tile-late"/);
  assert.match(v, /aria-labelledby="oh-g-due"/);
  assert.match(v, /data-focus-key="tile-otd3mo"/);
  assert.deepEqual(viewer.errors, []);
});

test('lagging cards: one-line labels, "target 90%" once, an even month is a grey "→ 0 pts", "1 line" not "1 lines"', async () => {
  assert.match(CSS, /\.kpi-top \.kpi-label\{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/);
  assert.match(CSS, /\.kpi-top>:not\(\.kpi-label\)\{flex-shrink:0\}/);
  const page = loadPage();
  const pill = (a, b) => page.run(`renderDeltaPill([{label:'Jul',otd:${a}},{label:'Aug',otd:${b}},{label:'Sep',otd:null}],'otd')`);
  assert.match(pill(70, 80), /^<span class="delta up"[^>]*>↑ 10 pts vs Jul<\/span>$/);
  assert.match(pill(80, 70), /^<span class="delta down"[^>]*>↓ 10 pts vs Jul<\/span>$/);
  assert.match(pill(70, 70), /^<span class="delta flat"[^>]*>→ 0 pts vs Jul<\/span>$/);
  assert.match(pill(70, 70), /data-tip="Aug 70% vs Jul 70%; target 90%\."/);
  assert.match(CSS, /\.delta\.flat\{background:transparent;padding:2px 0;color:var\(--gray-500\)\}/);

  const loaded = await loadedAll();
  const h = open(loaded, 'weekly', 'lagging');
  const lag = h.slice(h.indexOf('id="oh-panel-lagging"'));
  const cards = lag.match(/<button type="button" class="card kpi lag[\s\S]*?<\/button>/g);
  assert.equal(cards.length, 6);
  for (const c of cards) assert.ok((c.match(/target 90%/g) || []).length <= 1, c.slice(0, 160));
  // No rescheduled deliveries: a dash, the target once (top right), and the full name in the card's tip.
  const hit = cards.find((c) => /tile-reschedhit/.test(c));
  assert.match(hit, /<span class="kpi-label">Reschedule hit · 12 mo<\/span><span class="delta flat"[^>]*>target 90%<\/span><\/div>\s*<div class="kpi-row"><span class="kpi-value neutral"[^>]*>—<\/span><\/div>/);
  assert.match(hit, /data-tip="Reschedule hit rate/);
  // One delivery this week, one last week.
  const ship = cards.find((c) => /tile-shippedweek/.test(c));
  assert.match(ship, /<span class="kpi-value" data-count="1">1<\/span><span class="kpi-unit">line · \$1K<\/span>/);
  assert.match(ship, /Last week 1 line · \$1,000 \(this week is partial\)/);
  assert.doesNotMatch(h, /\b1 lines\b/);
  const po = open(loaded, 'purchaseorders');
  assert.match(po, /<span class="kpi-label">Reschedule hit · 12 mo<\/span>/);
  assert.match(po, /Last week 1 line · \$1,000/);
  assert.deepEqual(loaded.errors, []);
});

test('lines, not rows: page text and pills say lines; the page header counts what the page is about', async () => {
  const page = await loadedAll();
  const meta = (h) => h.match(/<span class="page-meta"[^>]*>([^<]*)<\/span>/)[1];
  const counts = page.run('(()=>{const m=currentMetrics();return {so:m.rows.filter(r=>r.isOpen).length,po:poData(m).poAllOpenRows.length,sd:supplyDemandRows.length};})()');
  for (const [tab, view] of PAGES) {
    const h = open(page, tab, view);
    const m = meta(h);
    if (tab === 'purchaseorders') assert.equal(m, `as of 2026-09-03 · ${counts.po} open PO lines`);
    else if (tab === 'supplyweekly' || tab === 'supplydemand') assert.equal(m, `as of 2026-09-03 · ${counts.sd} supply / demand lines`, tab);
    else if (tab === 'buildrisk') assert.equal(m, 'as of 2026-09-03', tab);
    else assert.equal(m, `as of 2026-09-03 · ${counts.so} open SO lines`, tab);
    const t = text(h);
    assert.doesNotMatch(t, /\b\d[\d,]* (?:[\w/-]+ ){0,2}rows?\b|% of rows|Sort rows|Open rows|Closed rows|rows shipped|Rows needing|SO rows|report rows/, `${tab}${view ? ` ${view}` : ''}: ${(t.match(/.{40}\brows?\b.{20}/) || [''])[0]}`);
  }
  // A few of the counts, by name.
  assert.match(text(open(page, 'metrics')), /\d+% of lines/);
  assert.match(text(open(page, 'monthly')), /\d+ delivery lines?/);
  assert.match(open(page, 'supplyweekly'), /<span class="kpi-label"><span class="dot crit"><\/span>Shortage lines<\/span>/);
  assert.match(open(page, 'weekly', 'leading'), /<label>Sort lines <select id="weekly-line-sort"/);
  assert.match(open(page, 'purchaseorders'), /<label>Sort lines <select id="po-line-sort"/);
  assert.deepEqual(page.errors, []);
});

run();
