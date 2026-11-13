// Order Health and consistency across pages, first written for the 2v2 design fixes and brought up to date with the
// 2v6 redesign (one bento grid of cards on Sales Order Health Leading, Monthly and Quarterly cards on Lagging, card
// titles instead of the 2v2 group names): Us vs Them stays off the board, the At risk card's numbers, the Leading grid,
// the line lists say lines and carry a count pill, Purchase Order Health has no tabs and Order Health no Hide links,
// the change line on the Lagging cards ("no change vs Jul" in grey, "1 line" not "1 lines"), and "lines" (not rows) in
// the text. Run with `node tests/consistency-2v2.test.js`. Fixtures are synthetic (harness.js); no SAP data.
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
// Every page is checked, so the pages hidden by default (Monthly, Warehouses, the Supply menu; 2v6.9) are shown again
// first (Settings > Hidden Pages); setTab('metrics') opens Sales Order Health > Lagging at its Trend card (2v6.9).
async function loadedAll() {
  const page = loadPage();
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(ROWS) }, { name: 'supply.xls', bytes: utf16Tsv(SD_HEADERS, SD_ROWS) }, { name: 'ctb.xlsx', bytes: ctbWorkbook(page) }]);
  page.run("stgSet('hiddenPages',[])");
  return page;
}
const open = (page, tab, view) => { page.run(`setTab(${JSON.stringify(tab)})${view ? `;setWeeklyView(${JSON.stringify(view)})` : ''}`); return results(page); };
// Order Health draws its tab panels; only the shown one counts.
const panel = (h, id) => { const i = h.indexOf(`id="oh-panel-${id}"`); const j = h.indexOf('<div class="oh-panel"', i + 1); return h.slice(i, j < 0 ? undefined : j); };
const headings = (h) => [...h.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const PAGES = [['weekly', 'leading'], ['weekly', 'lagging'], ['purchaseorders'], ['buildrisk'], ['supplyweekly'], ['supplydemand'], ['monthly'], ['warehouses'], ['metrics']];

test('Us vs Them is off the board (owner, 2v6): no cause bar, card or tag on Leading or Lagging; the at-risk counts stay', async () => {
  const page = await loadedAll();
  for (const view of ['leading', 'lagging']) {
    const h = open(page, 'weekly', view);
    assert.doesNotMatch(h, /oh-cause|cause-tag|cause-(?:us|them)\b|Us \$|Them \$|Us vs Them|Us \/ Them/, view);
  }
  assert.doesNotMatch(HTML, /function ohHeroCause|oh-cause-line/);
  // The lines the old card split still feed At risk: one past due, one with no commit date, one rescheduled.
  const oh = page.run('(()=>{const o=orderHealthData(currentMetrics());return [o.pastDueNoReschedule.length,o.noCommitRows.length,o.activeRescheduleRows.length];})()');
  assert.deepEqual(oh, [1, 1, 1]);
  assert.deepEqual(page.errors, []);
});

test('the At risk card: orders, value and lines in the head and its tip; Rescheduled and No commit beside it; the status bar keeps the past-due count', async () => {
  const page = await loadedAll();
  const lead = panel(open(page, 'weekly', 'leading'), 'leading');
  const late = page.run('(()=>{const o=orderHealthData(currentMetrics());return {amt:o.lateAmt,lines:o.lateTileRows.length};})()');
  assert.deepEqual(late, { amt: 23500, lines: 3 });
  const hero = lead.match(/<button type="button" class="ohl-hero"[\s\S]*?<\/button>/)[0];
  assert.match(hero, /data-focus-key="tile-late" onclick="setWeeklyTileFilter\('late'\)" aria-pressed="true"/, 'At risk is the card picked by default');
  assert.match(hero, /<span class="dz-big sm ohl-crit">3 orders<\/span><span class="dz-sub">\$23,500 · 3 lines<\/span>/);
  assert.match(hero, /data-tip="At risk, due by Oct 3\n• 3 orders, 3 lines\n• \$23,500 open\nClick to list them\."/);
  const stat = (key) => lead.match(new RegExp(`<button type="button" class="dz-stat ohl-stat" data-focus-key="tile-${key}"[\\s\\S]*?<\\/button>`))[0];
  assert.match(stat('st-rescheduled'), /Rescheduled<\/span><span class="ohl-stat-v">1 order<\/span><span class="ohl-stat-s">\$1,000 · 1 line<\/span>/);
  assert.match(stat('st-nocommit'), /No commit<\/span><span class="ohl-stat-v">1 order<\/span><span class="ohl-stat-s">\$1,000 · 1 line<\/span>/);
  // The past-due count (no card of its own beside At risk) is the status bar's red part, a button with its own name.
  assert.match(lead, /data-focus-key="status-seg-st-pastdue" aria-label="Past due: 1 order, 20%" aria-pressed="false" onclick="setWeeklyTileFilter\('st-pastdue'\)" data-tip="Past due\n• 1 order · 20% of open\n• \$21,500 open\nClick to list them\."/);
  assert.deepEqual(page.errors, []);
});

test('Leading is one bento grid of four questions: At risk first, the ship target over Status beside it, even gaps; At risk lists Rescheduled, No commit, All open', async () => {
  assert.match(CSS, /\.dz-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:16px\}/);
  const page = await loadedAll();
  const lead = panel(open(page, 'weekly', 'leading'), 'leading');
  // Version 1 (four questions): the grid opens with question 1, then the At risk card (half the row).
  assert.match(lead, /^id="oh-panel-leading" aria-labelledby="oh-tab-leading"><div class="dz-grid ohl-grid">\s*<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">1<\/span><h2 class="ohl-q-t" data-tc-skip>What Is at Risk\?<\/h2><\/div>\s*<section class="dz-card dz-span-3 ohl-card dz-fade" style="--i:0"><div class="dz-card-head"><h2 class="dz-title sm"[^>]*>At risk<\/h2>/);
  // Beside it, one column of the other half: the ship target over Status, with the grid's own gap between them.
  assert.match(lead, /<\/section>\s*<div class="ohl-col dz-span-3"><section class="dz-card dz-fade ohl-ship" style="--i:1"><div class="dz-card-head"><h2 class="dz-title sm"[^>]*>September ship target<\/h2>[\s\S]*?<\/section><section class="dz-card ohl-card ohl-status-card dz-fade" style="--i:1" aria-label="Status">/);
  assert.match(CSS, /\n\.ohl-col\{display:flex;flex-direction:column;gap:16px;min-width:0\}/);
  // The four questions, numbered, each a full row above its card; then the Lists card and Lines.
  assert.deepEqual([...lead.matchAll(/<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">(\d)<\/span><h2 class="ohl-q-t" data-tc-skip>([^<]+)<\/h2><\/div>/g)].map((m) => `${m[1]} ${m[2]}`),
    ['1 What Is at Risk?', '2 Why, and When?', '3 Who?', '4 What Can We Do?']);
  const marks = ['>What Is at Risk?</h2>', '>At risk</h2>', 'ship target</h2>', 'aria-label="Status"', '>Why, and When?</h2>', 'aria-label="Top reasons and open lines by due week"', '>Who?</h2>', '>Customers at risk</h2>',
    '>What Can We Do?</h2>', 'aria-label="Supply to pull in"', 'aria-label="Lists"', 'aria-label="Lines"'];
  const at = marks.map((s) => lead.indexOf(s));
  at.forEach((pos, i) => assert.ok(pos > (i ? at[i - 1] : 0), `${marks[i]} comes after ${marks[i - 1] || 'the grid opens'}`));
  // Every card under the first row takes the whole row.
  assert.deepEqual([...lead.matchAll(/<section class="dz-card dz-span-(\d)/g)].map((m) => Number(m[1])), [3, 6, 6, 6, 6, 6]);
  // Status is a card of its own now ("Status and top reasons" is gone): five open orders, one row of five numbers.
  assert.doesNotMatch(lead, /Status and top reasons|Status &amp; top reasons|ohs2-cols|ohs2-list|ohs2-row/);
  const status = lead.slice(lead.indexOf('aria-label="Status"'), lead.indexOf('>Why, and When?</h2>'));
  assert.match(status, /^aria-label="Status"><div class="ohs2-head"><div class="ohl-sec-title" data-tip="[^"]+">Status<\/div><span class="ohs2-meta"><b>5<\/b> open orders<\/span><\/div>/);
  assert.deepEqual([...status.matchAll(/<button type="button" class="ohs3-cell[^"]*" data-focus-key="status-(st-\w+)" aria-pressed="false" onclick="setWeeklyTileFilter\('\1'\)" data-tip="[^"]+"><span class="ohs3-l"><i class="ohl-dot"[^>]*><\/i>([^<]+)<\/span><span class="ohs3-n">(\d+)<\/span><span class="ohs3-s">([^<]+)<\/span><\/button>/g)].map((m) => [m[2], Number(m[3]), m[4]]),
    [['On track', 2, 'orders · 2 lines'], ['Due this week', 0, 'orders · 0 lines'], ['Rescheduled', 1, 'order · 1 line'], ['Past due', 1, 'order · 1 line'], ['No commit', 1, 'order · 1 line']]);
  // Top reasons left Status: it heads the left half of question 2's card, beside Open lines by due week.
  assert.doesNotMatch(status, /Top reasons/);
  const why = lead.slice(lead.indexOf('aria-label="Top reasons and open lines by due week"'), lead.indexOf('>Who?</h2>'));
  assert.deepEqual([...why.matchAll(/<div class="ohl-sec-title"[^>]*>([^<]+)<\/div>/g)].map((m) => m[1]), ['Top reasons', 'Open lines by due week']);
  assert.equal((why.match(/<div class="ohl-why-half/g) || []).length, 2);
  const keys = [...lead.matchAll(/class="dz-stat ohl-stat" data-focus-key="tile-([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['st-rescheduled', 'st-nocommit', 'allopen']);
  assert.deepEqual(page.errors, []);
});

test('the line lists say lines and carry a count pill; the 2v2 group names are gone from every page', async () => {
  const page = await loadedAll();
  const OLD = ['Linked PO lines', 'Orders to act on', 'Rows to check', 'Where the gaps are', 'Where the risk is', 'Why lines are at risk', 'Coming due', 'Performance by warehouse', 'Shortages by warehouse', 'Order lines', 'Supply at risk', 'All open demand', 'At risk now'];
  for (const [tab, view] of PAGES) {
    const h = open(page, tab, view);
    const t = headings(tab === 'weekly' || tab === 'metrics' ? panel(h, view || 'lagging') : h);
    assert.ok(t.length >= 2, `${tab}: ${t}`);
    for (const old of OLD) assert.ok(!t.includes(old), `${tab}${view ? ` ${view}` : ''}: old name "${old}"`);
    assert.ok(!t.some((x) => /\brows\b/i.test(x)), `${tab}: a heading says rows`);
  }
  // Leading: the Lines card with its help as the title's tip and the picked card's lines and value in the pill.
  const lead = panel(open(page, 'weekly', 'leading'), 'leading');
  assert.match(lead, /<h2 class="dz-title" data-tip="[^"]+">Lines<\/h2><span class="dz-chip red">3 lines · \$23,500<\/span>/);
  // Lagging: no Lines to act on (owner removed Metrics' Show more).
  const lag = panel(open(page, 'weekly', 'lagging'), 'lagging');
  assert.doesNotMatch(lag, />Lines to act on<\/h2>/);
  // Purchase Order Health and Build Risk: the list card's pill counts what it lists.
  assert.match(open(page, 'purchaseorders'), /<h2 class="dz-title" data-tip="[^"]+">PO lines<\/h2><span class="dz-chip[^"]*">1 PO<\/span>/);
  assert.match(open(page, 'buildrisk'), /<h2 class="dz-title" data-tip="[^"]+">Orders at risk or late<\/h2><span class="dz-chip[^"]*">\d+ orders?<\/span>/);
  assert.equal(page.run("SECTION_INFO['sd-shortages'].title"), 'Lines to act on');
  assert.deepEqual(page.errors, []);
});

test('no tabs or Leading / Lagging groups on Purchase Order Health; no Hide links on Order Health; an older snapshot with hidden cards opens them', async () => {
  const page = await loadedAll();
  const po = open(page, 'purchaseorders');
  assert.doesNotMatch(po, /role="tab"/, 'no tabs on Purchase Order Health');
  assert.ok(!headings(po).some((t) => /^(Leading|Lagging) · /.test(t)), 'no Leading · / Lagging · groups (2v6 redesign)');
  for (const view of ['leading', 'lagging']) {
    const h = open(page, 'weekly', view);
    assert.doesNotMatch(h, /toggle-leading|toggle-lagging|toggleLeadingIndicators|toggleLaggingIndicators/, view);
    assert.doesNotMatch(h, /<button[^>]*>(Hide|Show)<\/button>/, view);
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
  assert.match(v, /ship target<\/h2>/);
  assert.match(open(viewer, 'weekly', 'lagging'), />Monthly<\/h2>[\s\S]*>Quarterly<\/h2>/);
  assert.deepEqual(viewer.errors, []);
});

test('Lagging cards: the change line says "no change vs Jul" in grey when even, teal or red otherwise; "1 line" not "1 lines"', async () => {
  const page = loadPage();
  const delta = (cur, prev, o = {}) => page.run(`ohgDelta(${cur},${prev},${JSON.stringify({ vs: 'Jul', suffix: ' pts', ...o })})`);
  assert.deepEqual(delta(80, 70), { t: '+10 pts vs Jul', c: 'good' });
  assert.deepEqual(delta(70, 80), { t: '−10 pts vs Jul', c: 'bad' });
  assert.deepEqual(delta(70, 70), { t: 'no change vs Jul', c: 'flat' });
  assert.deepEqual(delta(70, null), { t: 'no Jul data', c: 'flat' });
  assert.deepEqual(delta(3.5, 2, { dp: 1, suffix: ' days', lowerBetter: true }), { t: '+1.5 days vs Jul', c: 'bad' }, 'fewer days late is better');
  assert.match(CSS, /\.ohg-flat\{color:var\(--dz-ink-4\)\}/);
  assert.match(CSS, /\.ohg-good\{color:var\(--dz-teal\)\}/);
  assert.match(CSS, /\.ohg-bad\{color:var\(--dz-risk-text\)\}/);

  const loaded = await loadedAll();
  const lag = panel(open(loaded, 'weekly', 'lagging'), 'lagging');
  const cards = lag.match(/<section class="dz-card dz-span-3 ohg-card[\s\S]*?<\/section>/g);
  assert.equal(cards.length, 2, 'Monthly and Quarterly');
  // August: one delivery (6 days late); July has none to compare with.
  assert.match(cards[0], />Monthly<\/h2><span class="dz-meta">August 2026<\/span>/);
  assert.match(cards[0], /<span class="dz-big sm ohg-orders">1 order shipped<\/span><span class="dz-sub">\$1K · 1 line<\/span><span class="ohg-delta ohg-flat">no Jul data<\/span>/);
  assert.match(cards[0], /<div class="dz-stat-l">Avg days late<\/div><div class="dz-stat-v">6\.0<\/div>/);
  assert.match(cards[0], /data-tip="Avg days late, August 2026: 6\.0\n• 1 late delivery line of 1 scored\n• July 2026: none scored"/);
  // No rescheduled deliveries: a grey dash and the reason in the tip.
  assert.match(cards[0], /data-tip="Reschedule hit: no rescheduled deliveries in August 2026\."><div class="dz-stat-l">Reschedule hit<\/div><div class="dz-stat-v" style="color:var\(--dz-ink-5\)">—<\/div>/);
  for (const c of cards) assert.ok((c.match(/target 90%/gi) || []).length <= 1, c.slice(0, 160));
  for (const c of cards) assert.doesNotMatch(c, /\b1 lines\b/);
  assert.doesNotMatch(open(loaded, 'purchaseorders'), /\b1 lines\b/);
  assert.deepEqual(loaded.errors, []);
});

// The month cards ("Open and shipped, month by month", moMonthlyParts) once built their tip with fmtNum(totalRows) +
// ' lines', so a month with one line read "$0 shipped (0% of 1 lines)"; ohN(totalRows,'line') gives "1 line". The cards
// left Lagging with its Version 1 layout (one Trend card and three compact tables), so they are checked where they are
// drawn now: the Monthly page (Settings > Hidden Pages shows it again; loadedAll does).
test('BUG: the Open and shipped month cards say "1 line", not "1 lines", in their tips (moMonthlyParts)', async () => {
  const loaded = await loadedAll();
  const cardTips = (h) => [...h.matchAll(/<div class="card month-card[^"]*" data-tip="([^"]+)"/g)].map((m) => m[1]);
  // Lagging draws no month cards any more, and says "1 line" / "1 order" in its own tips and text.
  const lag = panel(open(loaded, 'weekly', 'lagging'), 'lagging');
  assert.match(lag, /<section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend">/);
  assert.deepEqual(cardTips(lag), [], 'no month cards on Lagging');
  assert.doesNotMatch(lag, /month-spot|month-card/);
  const lagTips = [...lag.matchAll(/data-tip="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(lagTips.length > 30, `${lagTips.length} tips on Lagging`);
  for (const t of [...lagTips, text(lag)]) assert.doesNotMatch(t, /\b1 (lines|orders|delivery lines|open lines|closed lines)\b/, t);
  // One delivery this month (order 7, from CM - Alta), one line first due in October: singular in the new cards too.
  assert.match(lag, /<p class="ohgt-sofar" data-tip="September so far\n• 1 order shipped, \$1,000 on 1 delivery line\n• Year to date: \$2,000 on 2 delivery lines"><b>September so far:<\/b> 1 order · \$1K shipped · year to date \$2K<\/p>/);
  assert.match(lag, />By warehouse<\/h2><span class="dz-meta">September · 1 order<\/span>/);
  assert.match(lag, /<tr data-tip="CM · Alta\n• 1 delivery line, 10 qty\n• 0 early · 0 on time · 1 late">/);
  assert.match(lag, /<tr data-tip="Oct 2026\n• \$0 shipped of \$1,000 booked\n• 1 open line · 0 closed lines\n• 10 qty open">/);
  // The Monthly page: last month, this month and October (November has nothing, so it is left out).
  const mo = open(loaded, 'monthly');
  assert.equal(loaded.run('activeTab'), 'monthly');
  const tips = cardTips(mo);
  assert.deepEqual(tips.map((t) => t.split('\n')[0]), ['Aug 2026', 'Sep 2026', 'Oct 2026'], 'the month cards are drawn');
  for (const t of tips) assert.doesNotMatch(t, /\b1 lines\b/, t);
  // October holds one line (order 5, $1,000 open, nothing shipped): the count that used to read "1 lines".
  assert.equal(tips[2], 'Oct 2026\n• $1,000 open\n• $0 shipped (0% of 1 line)\n• 0 at risk or late, 0 rescheduled');
  for (const t of tips.slice(0, 2)) assert.match(t, /shipped \(\d+% of [2-9] lines\)/, t);
  assert.deepEqual(loaded.errors, []);
});

test('lines, not rows: page text and pills say lines; the page head counts what the page is about (none on the two Health pages)', async () => {
  const page = await loadedAll();
  const meta = (h) => (h.match(/<span class="page-meta"[^>]*>([^<]*)<\/span>/) || [])[1];
  const sd = page.run('supplyDemandRows.length');
  for (const [tab, view] of PAGES) {
    const h = open(page, tab, view);
    const m = meta(h);
    // 2v6.9 (owner): no As of line beside the Sales Order Health or Purchase Order Health title (the date is in the header).
    if (tab === 'weekly' || tab === 'metrics' || tab === 'purchaseorders') assert.equal(m, undefined, tab);
    else if (tab === 'supplyweekly' || tab === 'supplydemand') assert.equal(m, `As of 2026-09-03 · ${sd} supply / demand lines`, tab);
    else assert.equal(m, 'As of 2026-09-03', tab);
    const t = text(tab === 'weekly' || tab === 'metrics' ? panel(h, view || 'lagging') : h);
    assert.doesNotMatch(t, /\b\d[\d,]* (?:[\w/-]+ ){0,2}rows?\b|% of rows|Sort rows|Open rows|Closed rows|rows shipped|Rows needing|SO rows|report rows/, `${tab}${view ? ` ${view}` : ''}: ${(t.match(/.{40}\brows?\b.{20}/) || [''])[0]}`);
  }
  // A few of the counts, by name.
  assert.match(text(panel(open(page, 'metrics'), 'lagging')), /\b\d+ lines?\b/);
  assert.match(text(open(page, 'monthly')), /\d+ delivery lines?/);
  assert.match(text(open(page, 'supplyweekly')), /Open demand 22 qty \$2K · 2 lines/);
  assert.match(open(page, 'weekly', 'leading'), /<select id="weekly-line-sort"[^>]*aria-label="Sort lines"/);
  assert.match(open(page, 'purchaseorders'), /<select id="po-line-sort"[^>]*aria-label="Sort lines"/);
  assert.deepEqual(page.errors, []);
});

run();
