// 2v6.9 leading: Sales Order Health has a third view, Supply / Demand (Leading | Lagging | Supply / Demand), with the
// Short or at-risk items card that was on the Supply / Demand page; At risk has no quiet share / target line and the
// ship target no note.
// Leading, Version 1 (owner's pick): the view reads as four questions. 1 What Is at Risk? (At risk beside the ship
// target over Status, one row of five numbers). 2 Why, and When? (Top reasons beside Open lines by due week, one card).
// 3 Who? (Customers at risk, one table with each customer's supply source: no CM sheet source; a number or a source
// total lists exactly those at-risk lines in the Lines card). 4 What Can We Do? (Supply to pull in | Date changes behind
// one switch; gone when neither has rows). Then the two month lists as folds, and the Lines card.
// Run with `node tests/leading-2v69.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const po = (doc, due, o = {}) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: doc, 'Internal Number': doc, CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co', DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
// Firefly: SO 100 (item A, a late open PO behind it) and SO 101 (item B, short in the snapshot); Barletta: SO 102 (item Z,
// nothing wrong with its supply). All three are past due, so at risk.
const ROWS = [
  so('100', '08/01/2026', { 'Item No.': 'A' }),
  so('101', '08/02/2026', { 'Item No.': 'B' }),
  so('102', '08/03/2026', { 'Item No.': 'Z', CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta Boats' }),
  po('500', '07/15/2026', { 'Item No.': 'A' }),
];
const SD_HEAD = ['ExportDate', 'ItemCode', 'ItemGroupName', 'WarehouseCode', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'DemandOpenValue', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty', 'UnconfirmedSupplyQty', 'RiskSupplyQty'];
const SD = [
  { ExportDate: '09/03/2026', ItemCode: 'B', ItemGroupName: 'Cables', WarehouseCode: '01', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-08', DemandOpenQty: '10', DemandOpenValue: '1000', UsableSupplyQty: '4', MonthlyNetQty: '-6', CumulativeNetQty: '-6', RiskSupplyQty: '0' },
  { ExportDate: '09/03/2026', ItemCode: 'C', ItemGroupName: 'Cables', WarehouseCode: '01', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-10', DemandOpenQty: '5', DemandOpenValue: '500', UsableSupplyQty: '5', MonthlyNetQty: '0', CumulativeNetQty: '0', UnconfirmedSupplyQty: '3', RiskSupplyQty: '3' },
  { ExportDate: '09/03/2026', ItemCode: 'D', ItemGroupName: 'Electronics', WarehouseCode: '01', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '2', DemandOpenValue: '250', UsableSupplyQty: '9', MonthlyNetQty: '7', CumulativeNetQty: '7', RiskSupplyQty: '0' },
];
async function loaded({ sd = true, storage = {} } = {}) {
  const page = loadPage({ storage: { ...IMPORT, ...storage } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(ROWS) }, ...(sd ? [{ name: 'sd.xls', bytes: utf16Tsv(SD_HEAD, SD) }] : [])]);
  return page;
}
const linesState = (page) => page.run(`(()=>{const rows=weeklyTileFilter==='ohlsup'?ohlSupplyRows(currentMetrics(),ohlSupPick):null;return {tile:weeklyTileFilter,docs:rows?rows.map(r=>r.documentNumber).sort():null};})()`);
const linesMeta = (h) => ((h.match(/<div class="ohl-lines-title">[\s\S]*?<\/h2><span class="dz-chip[^"]*">([^<]*)<\/span>(?:<span class="dz-meta">([^<]*)<\/span>)?/) || []).slice(1));

// --- Leading, Version 1: readers for the four-question layout -----------------------------------------------------------
// The Leading grid from its start to the About panel; one card of it by a class on its <section> (none of these cards
// holds another section); a tag stripped to its words; the order numbers the Lines card lists.
const loadRows = async (rows) => {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
};
const grid = (page) => {
  const h = html(page), from = h.indexOf('<div class="dz-grid ohl-grid">');
  if (from < 0) return '';
  // Print draws Lagging after Leading; its questions open with the solo "How Did We Do?", so the grid ends there too.
  const ends = ['<details class="about', '<div class="ohl-q solo">'].map((s) => h.indexOf(s, from)).filter((i) => i >= 0);
  return h.slice(from, ends.length ? Math.min(...ends) : undefined);
};
const card = (h, cls) => {
  const m = new RegExp(`<section class="dz-card(?: [^"]*)? ${cls}(?: [^"]*)?"[^>]*>`).exec(h);
  return m ? h.slice(m.index, h.indexOf('</section>', m.index) + '</section>'.length) : '';
};
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const lineDocs = (page) => [...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]);
// The question headings as [number, words]; every heading has to be the numbered h2 (the count checks none is missed).
const questions = (g) => {
  const q = [...g.matchAll(/<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">(\d+)<\/span><h2 class="ohl-q-t" data-tc-skip>([^<]+)<\/h2><\/div>/g)].map((m) => [+m[1], m[2]]);
  assert.equal((g.match(/class="ohl-q[ "]/g) || []).length, q.length, 'every question heading is a numbered h2');
  return q;
};
// What the grid holds, in order: a question (its words), the ship target and Status column, or a card (by its class).
const layout = (g) => [...g.matchAll(/<div class="ohl-q dz-span-6">[\s\S]*?<h2[^>]*>([^<]+)<\/h2>|<div class="(ohl-col) dz-span-3">|<section class="dz-card([^"]*)"/g)]
  .map((m) => m[1] || m[2] || (/ ohl-(ship|status-card|why|who|do|months|lines-card)(?= |$)/.exec(m[3]) || [' at-risk'])[0].trim());
// Status: the five cells under the bar, each a button.
const statusCells = (s) => [...s.matchAll(/<button type="button" class="ohs3-cell([^"]*)" data-focus-key="status-st-(\w+)" aria-pressed="(true|false)" onclick="setWeeklyTileFilter\('st-\2'\)" data-tip="([^"]+)"><span class="ohs3-l"><i class="ohl-dot" style="background:[^"]+" aria-hidden="true"><\/i>([^<]+)<\/span><span class="ohs3-n">(\d+)<\/span><span class="ohs3-s">([^<]+)<\/span><\/button>/g)]
  .map((m) => ({ id: m[2], cls: m[1].trim(), pressed: m[3] === 'true', tip: m[4], label: m[5], orders: +m[6], sub: m[7] }));
// Customers at risk: a table row as its cells' words, and the buttons in it as [focus key, pressed, aria-label, click].
const whoRows = (t, part) => [...((new RegExp(`<${part}>([\\s\\S]*?)</${part}>`).exec(t) || ['', ''])[1]).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((x) => plain(x[1])));
const whoButtons = (t) => [...t.matchAll(/<button type="button" class="ohc3-n([^"]*)" data-focus-key="(ohl-sup-[^"]+)"(?: data-off="[^"]*")? aria-pressed="(true|false)" aria-label="([^"]+)" onclick="([^"]+)" data-tip="[^"]+">(\d+)<\/button>/g)]
  .map((m) => ({ key: m[2], cls: m[1].trim(), pressed: m[3] === 'true', name: m[4], click: m[5], n: +m[6] }));
// A second fixture, for the states and the weeks. The export is dated Thursday 3 September 2026, so "this week" is
// Aug 30 to Sep 5. Past due: 100, 101 (Firefly) and 102 (Barletta). Due this week: 110. On track: 111 (two lines,
// Sep 15) and 112 (Oct 20). Rescheduled: 113 (due Aug 20, now Sep 25). No commit: 114 (SAP's 11/11/1111).
const BAR = { CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta Boats' };
const later = (d) => ({ LineRescheduleDate: d, RescheduleDate: d, RescheduleFlag: 'Rescheduled Later Than Original Delivery' });
const MIX = [
  ...ROWS.slice(0, 3),
  so('110', '09/04/2026', { 'Item No.': 'C' }),
  so('111', '09/15/2026', { 'Item No.': 'D', LineNumber: '0', ...BAR }), so('111', '09/15/2026', { 'Item No.': 'E', LineNumber: '1', ...BAR }),
  so('112', '10/20/2026', { 'Item No.': 'F' }),
  so('113', '08/20/2026', { 'Item No.': 'G', ...later('09/25/2026') }),
  so('114', '08/25/2026', { 'Item No.': 'H', ...BAR, LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111' }),
  ROWS[3],
];
// A third, for "What Can We Do?": customers 1 to n. With pull, each has an order for its own item due in August whose
// covering PO is due a month later (a PO line to pull in). With dates, each has an order due in September that SAP
// moved a month later (a date change), worth $1,000 times its number; customer 1 has two such lines.
const two = (i) => String(i).padStart(2, '0');
const cust = (i) => ({ CustomerVendorCode: `CUST${two(i)}`, CustomerVendorName: `Customer ${two(i)}` });
const doRows = (n, { pull = true, dates = true } = {}) => Array.from({ length: n }, (_, k) => k + 1).flatMap((i) => [
  ...(pull ? [so(String(200 + i), `08/${two(10 + i)}/2026`, { 'Item No.': `P${i}`, ...cust(i) }), po(String(600 + i), `09/${two(10 + i)}/2026`, { 'Item No.': `P${i}` })] : []),
  ...(dates ? [so(String(300 + i), `09/${two(10 + i)}/2026`, { 'Item No.': `R${i}`, LineNumber: '0', ...cust(i), ...later(`10/${two(10 + i)}/2026`), AmountLocal: `${i},000.00` })] : []),
  ...(dates && i === 1 ? [so('301', '09/11/2026', { 'Item No.': 'R1B', LineNumber: '1', ...cust(1), ...later('10/11/2026'), AmountLocal: '500.00' })] : []),
]);

test('Leading: no quiet share / target line under At risk, no note in the ship target (its list stays)', async () => {
  const page = await loaded();
  const h = html(page);
  // The At Risk card's visible text only: its tooltip and the About panel may still name the at-risk target.
  const atRiskCard = h.slice(h.indexOf('ohl-hero-row'), h.indexOf('</section>', h.indexOf('ohl-hero-row'))).replace(/data-tip="[^"]*"/g, '');
  assert.ok(atRiskCard.length > 50);
  assert.doesNotMatch(h, /ohl-hero-quiet|ohl-hero-target/);
  assert.doesNotMatch(atRiskCard, /of orders due in the|Target under/);
  assert.doesNotMatch(h, /mwm-note|booked to ship by|These past-due orders are the largest still open/);
  const ship = h.slice(h.indexOf('ohl-ship'), h.indexOf('ohl-status-card'));
  assert.match(ship, /<span class="dz-sub">past due/);
  assert.match(ship, /<div class="mwm-closers">[\s\S]*<div class="mwm-closer dz-fade"/);
  // The target still colours the at-risk tone (Settings).
  assert.equal(page.run('typeof ohRiskTone(10)'), 'string');
  assert.deepEqual(page.errors, []);
});

test('Supply source: no CM sheet; every at-risk line counted once under pull in, open PO, stock or none; the source totals are the All Customers row (no separate card, no pills)', async () => {
  const page = await loaded();
  const h = html(page);
  const who = card(grid(page), 'ohl-who');
  assert.ok(who.length > 500, 'Customers at risk is drawn');
  assert.doesNotMatch(who, /CM sheet|Logican/);
  assert.deepEqual(page.run('OHL_SUPPLY_SOURCES.map(x=>x[0])'), ['pull', 'po', 'stock', 'none']);
  // Gone on purpose (Version 1): the Customers at risk by supply source card, its pills, its rows and its Show all toggle.
  assert.doesNotMatch(h, /Customers at risk by supply source|class="ohl-sup-(sum|pill|table|row|th|name|n|foot)[ "]|ohlToggleSupplyAll\(|Show all \d+ customers|data-dzpager="ohl-supply"/);
  // The sources are columns of the one table now: a group row over them, each column with its dot and a tip.
  assert.match(who, /<table class="ohc2-tbl ohc3-tbl src"><thead><tr class="ohc3-grp"><td><\/td><th scope="colgroup" colspan="3" data-tip="[^"]+">Open orders<\/th><th scope="colgroup" colspan="5" data-tip="[^"]+">At-risk orders by supply source<\/th><\/tr>/);
  const cols = [...who.matchAll(/<th scope="col"(?: class="num")? data-tip="([^"]+)">(?:<i class="ohl-dot" style="background:([^"]+)" aria-hidden="true"><\/i>)?([^<]+)<\/th>/g)].map((m) => [m[3], m[2] || '']);
  assert.deepEqual(cols, [['Customer', ''], ['Past due', ''], ['At risk', ''], ['Open', ''], ['Pull in', 'var(--dz-indigo)'], ['Late / no commit', 'var(--dz-amber)'], ['Stock short', 'var(--dz-risk)'], ['Not supply', 'var(--dz-ink-6)'], ['Split', '']]);
  assert.equal((who.match(/<th scope="col/g) || []).length, 11, 'every column heading (two group headings, nine columns) has a tip');
  // The totals row replaces the pills: distinct orders, then one button per source with orders (none to pull in here).
  assert.deepEqual(whoRows(who, 'tfoot'), [['All Customers', '3', '0', '3', '—', '1', '1', '1', '']]);
  const foot = who.slice(who.indexOf('<tfoot>'));
  assert.match(foot, /^<tfoot><tr class="ohc3-all"><th scope="row" data-tip="Every customer together\. An order counts once, so these can be less than the rows added up\.">All Customers<\/th><td class="num ohc2-pd">3<\/td><td class="num ohc2-ar">0<\/td><td class="num">3<\/td>/);
  assert.deepEqual(whoButtons(foot).map((b) => [b.key, b.pressed, b.name, b.click, b.n]), [
    ['ohl-sup-src-po', false, 'All Customers, Late / no commit: 1 order', "ohlSupplyPick('','po')", 1],
    ['ohl-sup-src-stock', false, 'All Customers, Stock short: 1 order', "ohlSupplyPick('','stock')", 1],
    ['ohl-sup-src-none', false, 'All Customers, Not supply: 1 order', "ohlSupplyPick('','none')", 1],
  ]);
  assert.match(foot, /<td class="num ohc3-zero" data-tip="Pull in: none">—<\/td>/);
  assert.match(foot, /<td class="ohc3-split"><span class="ohl-sup-bar" aria-hidden="true"><i style="width:33\.3%;background:var\(--dz-amber\)"><\/i><i style="width:33\.3%;background:var\(--dz-risk\)"><\/i><i style="width:33\.3%;background:var\(--dz-ink-6\)"><\/i><\/span><\/td>/);
  // Each at-risk line sits under exactly one source: 100 a late PO, 101 short stock, 102 not supply.
  const all = page.run('ohAtRiskData(currentMetrics()).risk.filter(ohIsSalesRow).length');
  assert.equal(page.run('Object.values(ohlSupplyData(currentMetrics()).totRows).reduce((s,r)=>s+r.length,0)'), all);
  assert.equal(all, 3);
  assert.deepEqual(page.run('(()=>{const d=ohlSupplyData(currentMetrics());return Object.fromEntries(Object.entries(d.totRows).map(([k,v])=>[k,v.map(r=>r.documentNumber)]))})()'), { pull: [], po: ['100'], stock: ['101'], none: ['102'] });
  assert.deepEqual(page.errors, []);
});

test('Supply source: a number or a source total lists exactly those lines; again (or Clear) goes back, Clear with focus on the table; a customer name filters the page', async () => {
  const page = await loaded();
  const who = () => card(grid(page), 'ohl-who');
  // Each customer: its name (a page filter, as before), then a button per source with orders, a dash for the others.
  assert.deepEqual(whoRows(who(), 'tbody'), [['FIREFLY - Firefly RV', '2', '0', '2', '—', '1', '1', '—', ''], ['BARLETTA - Barletta Boats', '1', '0', '1', '—', '—', '—', '1', '']]);
  const body = who().slice(who().indexOf('<tbody>'), who().indexOf('<tfoot>'));
  assert.deepEqual(whoButtons(body).map((b) => [b.key, b.cls, b.pressed, b.name, b.click]), [
    ['ohl-sup-FIREFLY-po', '', false, 'FIREFLY - Firefly RV, Late / no commit: 1 order', "ohlSupplyPick(this.dataset.off,'po')"],
    ['ohl-sup-FIREFLY-stock', '', false, 'FIREFLY - Firefly RV, Stock short: 1 order', "ohlSupplyPick(this.dataset.off,'stock')"],
    ['ohl-sup-BARLETTA-none', 'quiet', false, 'BARLETTA - Barletta Boats, Not supply: 1 order', "ohlSupplyPick(this.dataset.off,'none')"],
  ]);
  assert.match(body, /data-focus-key="ohl-sup-FIREFLY-po" data-off="FIREFLY" aria-pressed="false"[^>]*data-tip="Late \/ no commit: 1 order, 1 line\n• SO 100 A: PO 500 VEND - Vendor Co: late since Jul 15\nClick to list them\."/);
  assert.match(body, /data-focus-key="ohl-sup-FIREFLY-stock" data-off="FIREFLY" aria-pressed="false"[^>]*data-tip="Stock short: 1 order, 1 line\n• SO 101 B: short at Spyder - Lacombe \(supply \/ demand snapshot\)\nClick to list them\."/);
  // A number: that customer and source (1 order = 1 line here); the title names both, the chip counts the lines.
  page.run("ohlSupplyPick('FIREFLY','stock')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['101'] });
  assert.deepEqual(lineDocs(page), ['101']);
  assert.deepEqual(linesMeta(html(page)), ['1 line · $1,000', 'FIREFLY - Firefly RV · Stock short']);
  assert.deepEqual(whoButtons(who()).filter((b) => b.pressed).map((b) => [b.key, b.cls]), [['ohl-sup-FIREFLY-stock', 'sel']]);
  assert.match(html(page), /data-focus-key="ohl-sup-clear" onclick="ohlSupplyClear\(\)"/);
  // The same click again: the at-risk lines.
  page.run("ohlSupplyPick('FIREFLY','stock')");
  assert.equal(linesState(page).tile, 'late');
  assert.deepEqual(lineDocs(page), ['100', '101', '102']);
  assert.doesNotMatch(html(page), /data-focus-key="ohl-sup-clear"/);
  assert.deepEqual(whoButtons(who()).filter((b) => b.pressed), []);
  // A source total (All Customers): every customer, that source.
  page.run("ohlSupplyPick('','none')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['102'] });
  assert.deepEqual(linesMeta(html(page)), ['1 line · $1,000', 'Not supply · All customers']);
  assert.deepEqual(whoButtons(who()).filter((b) => b.pressed).map((b) => [b.key, b.cls]), [['ohl-sup-src-none', 'quiet sel']]);
  // Clear: the at-risk lines again, and focus goes back to the Customers at risk table.
  const focused = [];
  page.ctx.document.querySelector = (sel) => (/^\.ohl-who /.test(sel) ? { focus: (o) => focused.push([sel, JSON.stringify(o)]) } : null);
  page.run('ohlSupplyClear()');
  page.ctx.document.querySelector = () => null;
  assert.equal(linesState(page).tile, 'late');
  assert.deepEqual(focused, [['.ohl-who .ohc3-n,.ohl-who .ohc2-name', '{"preventScroll":true}']]);
  // A customer with every source (no button asks for it now; the function still lists the customer's at-risk lines).
  page.run("ohlSupplyPick('FIREFLY','')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['100', '101'] });
  assert.deepEqual(linesMeta(html(page)), ['2 lines · $2,000', 'FIREFLY - Firefly RV']);
  page.run('ohlSupplyClear()');
  // Another card's click gives way to it; a stale pick never lists anything.
  page.run("ohlSupplyPick('BARLETTA','none');setWeeklyTileFilter('allopen')");
  assert.equal(page.run('weeklyTileFilter'), 'allopen');
  page.run("weeklyTileFilter='ohlsup';ohlSupPick=null;renderResults()");
  assert.equal(page.run('weeklyTileFilter'), 'late');
  // The name is the page's customer filter (again shows every customer); the row is marked, the others drop out.
  assert.match(who(), /<tr class="ohc2-tr"><th scope="row"><button type="button" class="ohc2-name" data-focus-key="offrow-FIREFLY" data-off="FIREFLY" aria-pressed="false" onclick="setWeeklyOffenderFilter\('customers',this\.dataset\.off\)" data-tip="FIREFLY - Firefly RV\n• 2 of 2 open orders at risk \(100%\)\n• 2 orders past due · 0 orders at risk otherwise\n• 2 at-risk lines\nClick to filter to it\.">/);
  page.run("setWeeklyOffenderFilter('customers','FIREFLY')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['FIREFLY']);
  assert.deepEqual(whoRows(who(), 'tbody').map((r) => r[0]), ['FIREFLY - Firefly RV']);
  assert.match(who(), /<tr class="ohc2-tr sel"><th scope="row"><button type="button" class="ohc2-name" data-focus-key="offrow-FIREFLY" data-off="FIREFLY" aria-pressed="true"/);
  assert.deepEqual(whoRows(who(), 'tfoot'), [['All Customers', '2', '0', '2', '—', '1', '1', '—', '']]);
  page.run("setWeeklyOffenderFilter('customers','FIREFLY')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['ALL']);
  assert.deepEqual(page.errors, []);
});

test('Views: Leading | Lagging | Supply / Demand tabs; the Supply / Demand view lists the short or at-risk items', async () => {
  const page = await loaded();
  let h = html(page);
  const tabs = [...h.matchAll(/<button type="button" role="tab" id="oh-tab-(\w+)"[^>]*aria-selected="(true|false)"[^>]*aria-controls="oh-panel-\1" onkeydown="ohTabKey\(event\)"[^>]*>([^<]+)<\/button>/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  assert.deepEqual(tabs, ['leading:true:Leading', 'lagging:false:Lagging', 'supply:false:Supply / Demand']);
  assert.doesNotMatch(h, /ohl-sd/, 'not on Leading');
  page.run("ohTabKey({key:'End',preventDefault(){}})");
  assert.equal(page.run('weeklyView'), 'supply');
  h = html(page);
  assert.match(h, /<div class="oh-panel" role="tabpanel" id="oh-panel-supply" aria-labelledby="oh-tab-supply">/);
  assert.match(h, /<section class="dz-card sup-tcard dz-span-6 ohl-sd dz-fade dz-nofold"><div class="sup-thead"><div class="sup-ttitle"><h2 class="dz-title"[^>]*>Short or at-risk items<\/h2><\/div><div class="sup-tools"><div class="dz-seg sup-seg-sm"[\s\S]*?data-focus-key="sd-view-risk"/);
  // 2v6.9 (owner): no count pill, no search, no Supply at risk only filter; the view switch sits in the title row; the
  // numbers under the title; no fold chevron; each status a dot and a word with its detail small beside it.
  assert.doesNotMatch(h, /data-focus-key="sd-risk-only"|data-focus-key="sup-q-sd"|ohs-tools|class="dz-chip red">2 items/);
  assert.match(h, /<div class="dz-meta sup-tsub"><span class="ohs-sum"><span class="ohs-sum-i red"><b>\d+<\/b> short<\/span>/);
  // Every column title sorts; Supply Qty and Short Qty with a capital Q; the warehouse is a column (no heading rows);
  // a status detail sits on its own small line under the word.
  const ths = [...h.matchAll(/data-focus-key="sd-sort-(\w+)" onclick="supSdSort\('\1'\)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(ths.slice(0, 8).map((t) => t.split(':')[0]), ['item', 'desc', 'wh', 'month', 'dem', 'sup', 'short', 'status']);
  assert.ok(ths.includes('sup:Supply Qty') && ths.includes('short:Short Qty'), ths.join(', '));
  assert.doesNotMatch(h.slice(h.indexOf('ohl-sd')), /class="sup-grp"/);
  assert.match(h, /<td class="ohs-wh sup-soft" data-label="Warehouse">[^<]+<\/td>/);
  page.run("supSdSort('short')");
  assert.match(html(page), /<th class="num" aria-sort="descending"><button type="button" class="th-sort ohs-th" data-focus-key="sd-sort-short"/);
  page.run("supSdSort('short')");
  assert.match(html(page), /<th class="num" aria-sort="ascending"><button type="button" class="th-sort ohs-th" data-focus-key="sd-sort-short"/);
  page.run("supSet('sd-sort','')");
  assert.match(h, /<span class="ohs-st red"><i aria-hidden="true"><\/i>Short<\/span>/);
  // The filters that apply to items: the supply warehouse and the item group (no Segment / Customer pills).
  const row = h.slice(h.indexOf('dz-filterrow'), h.indexOf('<div class="oh-panel"'));
  assert.match(row, /Warehouse/);
  assert.match(row, /Item group/);
  assert.doesNotMatch(row, /Segment|Customer/);
  // No Lines card in this view.
  assert.doesNotMatch(h, /ohl-lines-card/);
  // Item group narrows it; Supply at risk (from the Supply / Demand page) opens the Short or at risk view.
  page.run("supSet('sd-group','Electronics')");
  assert.match(html(page), /No shortages or supply risk found for this selection\./);
  page.run("supSet('sd-group','');supSdFocus('risk')");
  assert.equal(page.run("supGet('sd-view','risk')"), 'risk');
  assert.doesNotMatch(html(page), /Supply at risk only/);
  assert.equal(page.run('activeTab'), 'weekly');
  // ArrowRight wraps to Leading.
  page.run("ohTabKey({key:'ArrowRight',preventDefault(){}})");
  assert.equal(page.run('weeklyView'), 'leading');
  assert.deepEqual(page.errors, []);
});

test('Supply / Demand page: coverage and the heat map only; Short opens Sales Order Health on Supply / Demand', async () => {
  const page = await loaded();
  page.run("stgSet('hiddenPages',[]);setTab('supplyweekly')");
  const h = html(page);
  assert.match(h, /sup-cover/);
  assert.match(h, /sup-heatcard/);
  assert.doesNotMatch(h, /sup-tcard|Short or at-risk items|data-focus-key="sd-view-risk"/);
  assert.match(h, /data-focus-key="sd-stat-short"[^>]*data-tip="[^"]*click to list them on Sales Order Health\."/);
  page.run("supSdFocus('short')");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'supply');
  assert.match(html(page), /ohl-sd/);
  assert.deepEqual(page.errors, []);
});

test('Without a snapshot the view says how to load it; Settings offers Supply / Demand as the opening view', async () => {
  const page = await loaded({ sd: false });
  page.run("setWeeklyView('supply')");
  const h = html(page);
  assert.match(h, /id="oh-tab-supply"/);
  assert.match(h, /<p class="ohs-need-t">Needs the supply \/ demand snapshot\. Add it with Add file\.<\/p><button type="button" class="dz-btn primary" data-focus-key="ohs-add"/);
  assert.doesNotMatch(h, /ohl-sd/);
  assert.equal(page.run("stgValue('openingView')"), 'leading');
  page.run("setTab('settings')");
  assert.match(html(page), /Supply \/ Demand/);
  // A stored Supply / Demand opening view is kept.
  const stored = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import', openingView: 'supply' }) } });
  assert.equal(stored.run("stgValue('openingView')"), 'supply');
  assert.equal(stored.run('weeklyView'), 'supply');
  assert.deepEqual(page.errors, []);
});

test('the CSS sits in its marker pairs, on colour tokens: Supply / Demand in 2v9:pages, the four-question layout in 2v9:leading-v1', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v9:pages */'), HTML.indexOf('/* 2v9:end pages */'));
  assert.match(css, /\.ohl-sd \.dz-chip\.red\{color:var\(--dz-risk-text\)\}/);
  assert.doesNotMatch(HTML, /\.ohl-hero-quiet|\.mwm-note/);
  // Version 1 (the rules for the removed supply source card's rows and pills are no longer asserted here).
  const from = HTML.indexOf('/* 2v9:leading-v1 */'), to = HTML.indexOf('/* 2v9:end leading-v1 */');
  assert.ok(from > 0 && to > from, 'the leading-v1 marker pair');
  const v1 = HTML.slice(from, to);
  assert.match(v1, /\.ohl-q\{display:flex;align-items:center;gap:10px/);
  assert.match(v1, /\.ohs3-row\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(v1, /button\.ohs3-cell\.sel\{background:var\(--dz-indigo-bg\)\}/);
  assert.match(v1, /button\.ohs3-cell\.crit \.ohs3-n\{color:var\(--dz-risk-text\)\}/);
  assert.match(v1, /\.ohl-why-grid\{display:grid;grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)/);
  assert.match(v1, /@media \(max-width:900px\)\{\.ohl-why-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(v1, /button\.ohc3-n\.sel\{background:var\(--dz-indigo-bg\);color:var\(--dz-indigo\)\}/);
  // Keyboard: the new buttons and the fold headings show the board's focus ring.
  for (const sel of ['button.ohs3-cell', 'button.ohc3-n', '.ohl-fold>summary']) assert.ok(v1.includes(`${sel}:focus-visible{outline:2px solid var(--dz-indigo);outline-offset:`), sel);
  assert.match(v1, /\.ohl-fold\[open\]>summary \.dz-chev\{transform:none\}/);
  assert.match(v1, /@media \(prefers-reduced-motion:reduce\)\{\.ohl-fold>summary \.dz-chev\{transition:none\}\}/);
  assert.match(v1, /@media print\{\.ohl-fold>summary \.dz-chev\{display:none\}\.ohl-q\{break-after:avoid\}\}/);
  assert.doesNotMatch(v1, /#[0-9a-f]{3,8}\b/i, 'colour tokens only');
});

// Left failing on purpose (an app gap, index.html, the "Touch: controls at least 40px tall" rule in the 2v9:revise2
// block, @media (pointer:coarse)). That rule gave the supply source numbers a 40px hit area by naming the old buttons
// (button.ohl-sup-pill, button.ohl-sup-name, button.ohl-sup-n, button.ohs2-row). Version 1 replaced those with
// button.ohc3-n (padding 3px 8px, about 24px tall) in the Customers at risk table and its All Customers row, and no
// touch rule names the new class, so on a touch screen the numbers are small targets again.
test('BUG: touch: the supply source numbers in Customers at risk (button.ohc3-n) get the 40px hit area the buttons they replaced had', () => {
  const coarse = [...HTML.matchAll(/@media \(pointer:coarse\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.ok(coarse.length > 500, 'the touch rules are found');
  assert.match(coarse, /button\.ohl-sup-n\b/, 'the old numbers were named');
  assert.match(coarse, /button\.ohc3-n\b/, 'the new numbers are named in a touch rule');
});

test('Pull in: POs are handed to orders by date; a covering PO due after the order is Pull in, listed per PO line', async () => {
  // Item P: SO 200 (due Aug 10) and SO 201 (due Aug 20) need 10 each; SO 202 (due Aug 25) needs 10 more. PO 601 (Sep 20)
  // and PO 600 (Sep 10) bring 10 each: by date, 600 covers 200 and 601 covers 201; nothing is left for 202.
  const rows = [
    so('200', '08/10/2026', { 'Item No.': 'P' }),
    so('201', '08/20/2026', { 'Item No.': 'P', CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta Boats' }),
    so('202', '08/25/2026', { 'Item No.': 'P' }),
    po('601', '09/20/2026', { 'Item No.': 'P' }),
    po('600', '09/10/2026', { 'Item No.': 'P' }),
  ];
  const page = loadPage({ storage: IMPORT });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  const src = page.run(`(()=>{const d=ohlSupplyData(currentMetrics());return Object.fromEntries(Object.entries(d.totRows).map(([k,v])=>[k,v.map(r=>r.documentNumber).sort()]));})()`);
  assert.deepEqual(src, { pull: ['200', '201'], po: [], stock: [], none: ['202'] });
  const pulls = page.run(`ohlSupplyData(currentMetrics()).pulls.map(x=>[x.p.documentNumber,cmShort(x.exp),cmShort(x.need),x.gap,[...x.customers].join('/')])`);
  assert.deepEqual(pulls, [['600', 'Sep 10', 'Aug 10', 31, 'FIREFLY - Firefly RV'], ['601', 'Sep 20', 'Aug 20', 31, 'BARLETTA - Barletta Boats']]);
  let h = html(page);
  // The customer card: Pull in first; the Supply to pull in card: one row per PO line, its number a button.
  assert.match(h, /data-focus-key="ohl-sup-src-pull" aria-pressed="false"/);
  assert.match(h, /<section[^>]*class="[^"]*ohl-pull[^"]*"[\s\S]*?Supply to pull in[\s\S]*?<th[^>]*>PO \/ WO<\/th><th>Vendor \/ CM<\/th><th>Item<\/th><th[^>]*>Supply due<\/th><th[^>]*>Needed by<\/th><th class="num"[^>]*>Gap<\/th><th>Customers<\/th><th class="num"[^>]*>At risk<\/th>/);
  assert.match(h, /<button type="button" class="ohl-pull-po" data-focus-key="ohl-pull-[^"]+" data-off="[^"]+" aria-pressed="false" onclick="ohlPullPick\(this\.dataset\.off\)"[^>]*>PO 600<\/button>/);
  // A PO: its lines in the Lines card, each with the action under its status; again: back to the at-risk lines.
  const key = page.run('ohlSupplyData(currentMetrics()).pulls[0].key');
  page.run(`ohlPullPick(${JSON.stringify(key)})`);
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['200'] });
  h = html(page);
  assert.deepEqual(linesMeta(h), ['1 line · $1,000', 'PO 600 · Pull in']);
  assert.match(h, /<span class="ohl-pull-note">Pull in PO 600 · [^<]+ · due Sep 10 → needed by Aug 10 \(31d\)<\/span>/);
  page.run(`ohlPullPick(${JSON.stringify(key)})`);
  assert.equal(linesState(page).tile, 'late');
  assert.doesNotMatch(html(page), /ohl-pull-note/);
  assert.deepEqual(page.errors, []);
});

test('Customers at risk is one ranked table against each customer\'s own open orders, 5 customers a page; Top reasons show which reasons come together', async () => {
  const page = await loaded();
  const who = card(grid(page), 'ohl-who');
  // Customers at risk (owner, option F, then Version 1): one ranked table, the full width of the grid: past due, at
  // risk otherwise, open; a thin split under each name; then the supply sources; no money.
  // Firefly: SO 100 and 101, both open and past due.
  assert.match(who, /^<section class="dz-card dz-span-6 ohl-card ohl-who dz-fade" style="--i:3"><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]+">Customers at risk<\/h2><span class="dz-meta">Most at-risk orders first<\/span><\/div><div class="sup-scroll" tabindex="0" role="region" aria-label="Customers at risk"><table class="ohc2-tbl ohc3-tbl src"><thead>/);
  assert.match(who, /<tr><th scope="col"[^>]*>Customer<\/th><th scope="col" class="num"[^>]*>Past due<\/th><th scope="col" class="num"[^>]*>At risk<\/th><th scope="col" class="num"[^>]*>Open<\/th><th scope="col" class="num"[^>]*><i class="ohl-dot"/);
  assert.match(who, /data-focus-key="offrow-FIREFLY"[^>]*onclick="setWeeklyOffenderFilter\('customers',this\.dataset\.off\)"[^>]*><span class="ohc2-label">FIREFLY - Firefly RV<\/span><span class="ohc2-split" aria-hidden="true"><i class="pd" style="width:100\.0%"><\/i><i class="ar" style="width:0\.0%"><\/i><\/span><\/button><\/th><td class="num ohc2-pd">2<\/td><td class="num ohc2-ar">0<\/td><td class="num">2<\/td>/);
  assert.doesNotMatch(who, /\$/);
  assert.doesNotMatch(who, /dz-pagefoot/, 'two customers, one page');
  // Without purchase-order lines or a supply / demand snapshot: the first four columns only, and a note saying why.
  const bare = await loadRows(ROWS.slice(0, 3));
  const plainWho = card(grid(bare), 'ohl-who');
  assert.match(plainWho, /<table class="ohc2-tbl ohc3-tbl"><thead><tr><th scope="col" data-tip="[^"]+">Customer<\/th><th scope="col" class="num" data-tip="[^"]+">Past due<\/th><th scope="col" class="num" data-tip="[^"]+">At risk<\/th><th scope="col" class="num" data-tip="[^"]+">Open<\/th><\/tr><\/thead>/);
  assert.deepEqual(whoRows(plainWho, 'tbody'), [['FIREFLY - Firefly RV', '2', '0', '2'], ['BARLETTA - Barletta Boats', '1', '0', '1']]);
  assert.deepEqual(whoRows(plainWho, 'tfoot'), [['All Customers', '3', '0', '3']]);
  assert.doesNotMatch(plainWho, /ohc3-grp|ohc3-n|ohc3-split|ohl-sup-bar|by supply source<\/th>/);
  assert.match(plainWho, /<\/table><\/div><p class="ohl-note ohl-foot-note">Load purchase-order lines or the supply \/ demand snapshot to see which supply source holds each customer's orders\.<\/p><\/section>$/);
  assert.deepEqual(bare.errors, []);
  // Most at-risk orders first, each against its own open orders; All Customers counts each order once. Firefly: 100
  // and 101 past due, 113 rescheduled, 110 and 112 fine. Barletta: 102 past due, 114 no commit, 111 fine.
  const mix = await loadRows(MIX);
  const mixWho = card(grid(mix), 'ohl-who');
  assert.deepEqual(whoRows(mixWho, 'tbody'), [['FIREFLY - Firefly RV', '2', '1', '5', '—', '1', '—', '2', ''], ['BARLETTA - Barletta Boats', '1', '1', '3', '—', '—', '—', '2', '']]);
  assert.deepEqual(whoRows(mixWho, 'tfoot'), [['All Customers', '3', '2', '8', '—', '1', '—', '4', '']]);
  assert.match(mixWho, /<span class="ohc2-label">FIREFLY - Firefly RV<\/span><span class="ohc2-split" aria-hidden="true"><i class="pd" style="width:40\.0%"><\/i><i class="ar" style="width:20\.0%"><\/i><\/span>/);
  assert.deepEqual(mix.run("(()=>{const m=currentMetrics(),oh=orderHealthData(m);return [rowDocCount(ohAtRiskData(m).risk),rowDocCount(oh.allOrderRows.filter(r=>r.isOpen))]})()"), [5, 8]);
  assert.deepEqual(mix.errors, []);
  // Seven customers with two at-risk orders each (one past due, one rescheduled): 5 a page, the bigger value first;
  // the totals row is the same on every page.
  const many = await loadRows(doRows(7));
  const names = () => whoRows(card(grid(many), 'ohl-who'), 'tbody').map((r) => r.slice(0, 4).join(' | '));
  assert.deepEqual(names(), [7, 6, 5, 4, 3].map((i) => `CUST0${i} - Customer 0${i} | 1 | 1 | 2`));
  assert.match(card(grid(many), 'ohl-who'), /<span class="dz-pagecount">1–5 of 7 customers<\/span><nav class="shp-pager dz-pager print-hide" data-dzpager="ohl-customers" aria-label="Customers at risk pages"/);
  const totals = [['All Customers', '7', '7', '14', '7', '—', '—', '7', '']];
  assert.deepEqual(whoRows(card(grid(many), 'ohl-who'), 'tfoot'), totals);
  many.run("dzGoPage('ohl-customers',2)");
  assert.deepEqual(names(), [2, 1].map((i) => `CUST0${i} - Customer 0${i} | 1 | 1 | 2`));
  assert.match(card(grid(many), 'ohl-who'), /<span class="dz-pagecount">6–7 of 7 customers<\/span>/);
  assert.deepEqual(whoRows(card(grid(many), 'ohl-who'), 'tfoot'), totals);
  // A page filter starts the list at page 1 again.
  many.run("setWeeklyCustomerFilter(['CUST03'])");
  assert.deepEqual(names(), ['CUST03 - Customer 03 | 1 | 1 | 2']);
  many.run("setWeeklyCustomerFilter(['ALL'])");
  assert.equal(names().length, 5);
  assert.deepEqual(many.errors, []);

  // Top reasons (owner, option S): which reasons come together. A column per exact set of reasons (its line count as a
  // bar), a dot per reason under it; the reason names keep their own line counts and filter as before. Version 1: it
  // is the first half of the "Why, and When?" card (tests below), not part of Status.
  const h = html(page);
  const ups = h.slice(h.indexOf('<div class="ohu"'), h.indexOf('<div class="ohl-why-half">', h.indexOf('<div class="ohu"')));
  assert.ok(ups.length > 100, 'the reason sets are drawn');
  assert.match(ups, /aria-label="Which reasons come together"/);
  assert.match(ups, /<button type="button" class="ohu-name" data-focus-key="oh-reason-[^"]+" aria-pressed="false" onclick="setWeeklyReasonFilter\(/);
  // 100 and 102 are past due only; 101 is past due and short in the snapshot.
  assert.deepEqual([...ups.matchAll(/<span class="ohu-nm">([^<]+)<\/span><span class="ohu-tot">(\d+)<\/span>/g)].map((m) => [m[1], +m[2]]), [['Past due · No reschedule', 3], ['Supply shortage', 1]]);
  const cols = [...ups.matchAll(/<button type="button" class="ohu-col" style="--h:[\d.]+;--a:\d+;--b:\d+" data-focus-key="oh-rset-([^"]+)"[\s\S]*?<span class="ohu-n">(\d+)<\/span>/g)];
  assert.ok(cols.length >= 1 && cols.length <= 8, `1 to 8 sets: ${cols.length}`);
  const n = cols.map((c) => +c[2]);
  assert.deepEqual(n, [2, 1], 'biggest set first');
  assert.ok(ups.includes('<i class="ohu-dot on"></i>'), 'dots mark the reasons in each set');
  // A column lists exactly its lines, and the filter chip names the set.
  const key = cols[0][1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  page.run(`setWeeklyReasonFilter(${JSON.stringify(key)})`);
  const after = html(page);
  assert.match(after, new RegExp(`data-focus-key="oh-rset-[^"]+" aria-pressed="true"`));
  assert.match(after, /Reasons<\/span>|Reasons:/);
  assert.deepEqual(lineDocs(page), ['100', '102']);
  page.run(`setWeeklyReasonFilter(${JSON.stringify(key)})`);
  assert.doesNotMatch(html(page), /data-focus-key="oh-rset-[^"]+" aria-pressed="true"/);
  assert.deepEqual(page.errors, []);
});

// --- Leading, Version 1 (owner's pick): four questions -------------------------------------------------------------------
test('Leading reads as four questions, in order; question 4 and its card are left out (the questions number 1 to 3) when there is neither supply to pull in nor a date change', async () => {
  // Two customers with a PO to pull in and a date change each, and Barletta with one past-due order and neither.
  const page = await loadRows([...doRows(2), so('900', '08/05/2026', { 'Item No.': 'Z', ...BAR })]);
  const FOUR = [[1, 'What Is at Risk?'], [2, 'Why, and When?'], [3, 'Who?'], [4, 'What Can We Do?']];
  let g = grid(page);
  assert.deepEqual(questions(g), FOUR);
  // Each question, then its card (question 1: At risk beside the ship target over Status); the month lists and Lines close.
  assert.deepEqual(layout(g), ['What Is at Risk?', 'at-risk', 'ohl-col', 'ohl-ship', 'ohl-status-card', 'Why, and When?', 'ohl-why', 'Who?', 'ohl-who', 'What Can We Do?', 'ohl-do', 'ohl-months', 'ohl-lines-card']);
  // The grid is six columns: At risk and the column share a row (3 + 3); every other card and question takes the row.
  assert.match(g, /^<div class="dz-grid ohl-grid">\s*<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">1<\/span><h2 class="ohl-q-t" data-tc-skip>What Is at Risk\?<\/h2><\/div>\s*<section class="dz-card dz-span-3 ohl-card dz-fade" style="--i:0"><div class="dz-card-head"><h2 class="dz-title sm"[^>]*>At risk<\/h2>/);
  assert.match(g, /<\/section>\s*<div class="ohl-col dz-span-3"><section class="dz-card dz-fade ohl-ship" style="--i:1">[\s\S]*?<\/section><section class="dz-card ohl-card ohl-status-card dz-fade" style="--i:1" aria-label="Status">[\s\S]*?<\/section><\/div>\s*<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">2<\/span>/);
  for (const cls of ['ohl-why', 'ohl-who', 'ohl-do', 'ohl-months', 'ohl-lines-card']) assert.match(card(g, cls), /^<section class="dz-card dz-span-6 /, cls);
  assert.match(g, /<h2 class="ohl-q-t" data-tc-skip>What Can We Do\?<\/h2><\/div><section class="dz-card dz-span-6 ohl-card ohl-do /);
  // Barletta only: nothing to pull in and no date moved, so there is no question 4 and no card under it.
  page.run("setWeeklyCustomerFilter(['BARLETTA'])");
  g = grid(page);
  assert.deepEqual(questions(g), FOUR.slice(0, 3));
  assert.deepEqual(layout(g), ['What Is at Risk?', 'at-risk', 'ohl-col', 'ohl-ship', 'ohl-status-card', 'Why, and When?', 'ohl-why', 'Who?', 'ohl-who', 'ohl-months', 'ohl-lines-card']);
  assert.doesNotMatch(g, /What Can We Do\?|ohl-do[ "]|ohl-pull-tbl|ohl-dc-row|data-focus-key="ohl-do-/);
  assert.deepEqual(page.run('(()=>{const m=currentMetrics();return [ohlSupplyData(m).pulls.length,soDateChangeImpact(m).totals.lines]})()'), [0, 0]);
  // Every customer again: the fourth question is back.
  page.run("setWeeklyCustomerFilter(['ALL'])");
  assert.deepEqual(questions(grid(page)), FOUR);
  assert.deepEqual(page.run('(()=>{const m=currentMetrics();return [ohlSupplyData(m).pulls.length,soDateChangeImpact(m).totals.lines]})()'), [2, 3]);
  // The file's first fixture (a late PO, short stock, nothing to pull in, no date moved): three questions.
  const three = await loaded();
  assert.deepEqual(questions(grid(three)), FOUR.slice(0, 3));
  assert.doesNotMatch(grid(three), /ohl-do[ "]/);
  // Every page reads as questions now, but these four are Leading's: Lagging and Supply / Demand ask their own.
  const asked = (h) => [...h.matchAll(/<div class="ohl-q([^"]*)"><span class="ohl-q-n" aria-hidden="true">(\d+)<\/span><h2 class="ohl-q-t" data-tc-skip>([^<]+)<\/h2><\/div>/g)].map((m) => [+m[2], m[3], m[1].trim()]);
  page.run("setWeeklyView('lagging')");
  assert.deepEqual(asked(html(page)), [[1, 'How Did We Do?', 'solo'], [2, 'Which Way Is It Heading, and Why?', 'dz-span-6'], [3, 'How Did Each Month Go?', 'dz-span-6'], [4, 'Who Shipped It, and What Is Still Open?', 'dz-span-6']], 'lagging');
  // Supply / Demand asks its one question only over the shortage card: none without a Supply / Demand sheet.
  page.run("setWeeklyView('supply')");
  assert.deepEqual(asked(html(page)), [], 'supply, no sheet');
  three.run("setWeeklyView('supply')");
  assert.deepEqual(asked(html(three)), [[1, 'What Are We Short Of?', 'dz-span-6']], 'supply, with the sheet');
  for (const [p, view] of [[page, 'lagging'], [page, 'supply'], [three, 'supply']]) {
    p.run(`setWeeklyView('${view}')`);
    for (const [, words] of FOUR) assert.ok(!html(p).includes(`>${words}</h2>`), `${view}: ${words}`);
  }
  assert.deepEqual(page.errors, []);
  assert.deepEqual(three.errors, []);
});

test('Status: one row of five cells under the bar, each state\'s open orders and lines; a cell lists its lines in the Lines card; the list and Top reasons left the card', async () => {
  const page = await loadRows(MIX);
  const status = () => card(grid(page), 'ohl-status-card');
  let s = status();
  assert.match(s, /^<section class="dz-card ohl-card ohl-status-card dz-fade" style="--i:1" aria-label="Status"><div class="ohs2-head"><div class="ohl-sec-title" data-tip="[^"]+">Status<\/div><span class="ohs2-meta"><b>8<\/b> open orders<\/span><\/div>/);
  // The bar: one part per state with orders, as wide as its share of the eight open orders.
  assert.deepEqual([...s.matchAll(/<button type="button" class="ohs2-seg" style="flex-grow:(\d+);background:[^"]+" data-focus-key="status-seg-st-(\w+)" aria-label="([^"]+)" aria-pressed="false" onclick="setWeeklyTileFilter\('st-\2'\)" data-tip="[^"]+"><\/button>/g)].map((m) => [m[2], +m[1], m[3]]),
    [['ontrack', 2, 'On track: 2 orders, 25%'], ['duethisweek', 1, 'Due this week: 1 order, 13%'], ['rescheduled', 1, 'Rescheduled: 1 order, 13%'], ['pastdue', 3, 'Past due: 3 orders, 38%'], ['nocommit', 1, 'No commit: 1 order, 13%']]);
  // One row of five cells: the orders large, "orders · N lines" under it. Order 111 has two lines.
  assert.match(s, /<\/div>\s*<div class="ohs3-row" role="group" aria-label="Open orders by state, with figures">(?:<button type="button" class="ohs3-cell[^"]*"[\s\S]*?<\/button>){5}<\/div><\/section>$/);
  const WANT = [['ontrack', 'On track', 2, 'orders · 3 lines', ''], ['duethisweek', 'Due this week', 1, 'order · 1 line', ''], ['rescheduled', 'Rescheduled', 1, 'order · 1 line', ''], ['pastdue', 'Past due', 3, 'orders · 3 lines', 'crit'], ['nocommit', 'No commit', 1, 'order · 1 line', '']];
  assert.deepEqual(statusCells(s).map((c) => [c.id, c.label, c.orders, c.sub, c.cls]), WANT);
  assert.ok(statusCells(s).every((c) => !c.pressed));
  assert.equal(statusCells(s)[0].tip, 'On track\n• 2 orders, 3 lines\n• $3,000 open\n• No risk signal, not due this week\nClick to list them.');
  // The cells are the data's: every open order in exactly one state.
  assert.deepEqual(page.run("ohLeadingData(currentMetrics()).states.map(s=>[s.id,s.orders,s.rows.length,s.rows.map(r=>r.documentNumber).join()])"),
    [['ontrack', 2, 3, '111,111,112'], ['duethisweek', 1, 1, '110'], ['rescheduled', 1, 1, '113'], ['pastdue', 3, 3, '100,101,102'], ['nocommit', 1, 1, '114']]);
  assert.equal(statusCells(s).reduce((t, c) => t + c.orders, 0), 8);
  // Gone on purpose: the list with its Lines / Orders columns, and Top reasons (now in "Why, and When?").
  assert.doesNotMatch(s, /ohs2-cols|ohs2-list|ohs2-row|ohs2-name|ohs2-lines|class="ohs2-n"|ohl-kv|Top reasons|class="ohu"/);
  assert.doesNotMatch(html(page), /class="ohs2-(cols|list|row[ "]|name|lines|n")/);
  // A cell lists its lines in the Lines card (the cell and its part of the bar show as picked); again goes back to At risk.
  assert.deepEqual(lineDocs(page), ['100', '101', '102', '113', '114']);
  page.run("setWeeklyTileFilter('st-ontrack')");
  s = status();
  assert.deepEqual(statusCells(s).filter((c) => c.pressed).map((c) => [c.id, c.cls]), [['ontrack', 'sel']]);
  assert.match(s, /<button type="button" class="ohs2-seg sel" style="flex-grow:2;[^"]*" data-focus-key="status-seg-st-ontrack" aria-label="On track: 2 orders, 25%" aria-pressed="true"/);
  assert.deepEqual(lineDocs(page).sort(), ['111', '111', '112']);
  assert.deepEqual(linesMeta(html(page))[0], '3 lines · $3,000');
  assert.doesNotMatch(statusCells(s)[0].tip, /Click to list them/);
  page.run("setWeeklyTileFilter('st-nocommit')");
  assert.deepEqual(statusCells(status()).filter((c) => c.pressed).map((c) => c.id), ['nocommit']);
  assert.deepEqual(lineDocs(page), ['114']);
  page.run("setWeeklyTileFilter('st-nocommit')");
  assert.ok(statusCells(status()).every((c) => !c.pressed));
  assert.deepEqual(lineDocs(page), ['100', '101', '102', '113', '114']);
  assert.deepEqual(page.errors, []);
  // A state with no orders is greyed (zero) and has no part in the bar; past due is red only while it has orders.
  const three = await loaded();
  const t = card(grid(three), 'ohl-status-card');
  assert.match(t, /<span class="ohs2-meta"><b>3<\/b> open orders<\/span>/);
  assert.deepEqual(statusCells(t).map((c) => [c.id, c.orders, c.sub, c.cls]), [['ontrack', 0, 'orders · 0 lines', 'zero'], ['duethisweek', 0, 'orders · 0 lines', 'zero'], ['rescheduled', 0, 'orders · 0 lines', 'zero'], ['pastdue', 3, 'orders · 3 lines', 'crit'], ['nocommit', 0, 'orders · 0 lines', 'zero']]);
  assert.equal((t.match(/class="ohs2-seg/g) || []).length, 1);
  assert.deepEqual(three.errors, []);
  // No sales orders at all (purchase orders only): no bar, five greyed cells.
  const pos = await loadRows([po('500', '08/01/2026')]);
  const none = card(grid(pos), 'ohl-status-card');
  assert.deepEqual(pos.errors, []);
  assert.match(none, /<span class="ohs2-meta"><b>0<\/b> open orders<\/span>/);
  assert.doesNotMatch(none, /ohs2-bar/);
  assert.deepEqual(statusCells(none).map((c) => [c.orders, c.cls]), Array(5).fill([0, 'zero']));
  assert.deepEqual(three.errors, []);
});

test('Why, and When?: one card, Top reasons beside Open lines by due week (no card of its own for either)', async () => {
  const page = await loadRows(MIX);
  const g = grid(page);
  const why = card(g, 'ohl-why');
  assert.match(why, /^<section class="dz-card dz-span-6 ohl-card ohl-why dz-fade" style="--i:2" aria-label="Top reasons and open lines by due week"><div class="ohl-why-grid"><div class="ohl-why-half"><div class="ohs2-head"><div class="ohl-sec-title" data-tip="[^"]+">Top reasons<\/div><span class="ohs2-meta"><b>5<\/b> at-risk lines<\/span><\/div>/);
  assert.equal((why.match(/<div class="ohl-why-half">/g) || []).length, 2, 'two halves');
  assert.equal((g.match(/ohl-why-grid/g) || []).length, 1);
  const [reasons, due] = why.split('<div class="ohl-why-half">').slice(1);
  // Left: the reason sets of the five at-risk lines (100, 101, 102 past due; 113 rescheduled; 114 no commit).
  assert.match(reasons, /<div class="ohu" style="--rows:3;--cols:3" role="group" aria-label="Which reasons come together">/);
  assert.deepEqual([...reasons.matchAll(/<span class="ohu-nm">([^<]+)<\/span><span class="ohu-tot">(\d+)<\/span>/g)].map((m) => [m[1], +m[2]]), [['Past due · No reschedule', 3], ['No commit date', 1], ['Rescheduled later', 1]]);
  assert.deepEqual([...reasons.matchAll(/<span class="ohu-n">(\d+)<\/span>/g)].map((m) => +m[1]), [3, 1, 1]);
  assert.doesNotMatch(reasons, /Open lines by due week|ohl-chart|tile-st-pastdue-chip/);
  // Right: the red chip counts the lines already past due; the chart counts the open lines of the next eight weeks
  // (110 this week, 111's two lines on Sep 15, 113 on its new date Sep 25, 112 on Oct 20).
  assert.match(due, /^<div class="ohs2-head"><div class="ohl-sec-title" data-tip="Open lines due per week, next 8 weeks\. Past due is the red chip\.">Open lines by due week<\/div><button type="button" class="dz-chip red ohl-chipbtn" data-focus-key="tile-st-pastdue-chip" onclick="setWeeklyTileFilter\('st-pastdue'\)" aria-pressed="false" data-tip="3 lines already past due\n• 3 orders\n• \$3,000 open\nClick to list them\.">3 lines already past due<\/button><\/div>/);
  assert.match(due, /<div class="ohl-chart" role="img" aria-label="Open lines due by week, this week: 1, Sep 6: 0, Sep 13: 2, Sep 20: 1, Sep 27: 0, Oct 4: 0, Oct 11: 0, Oct 18: 1">/);
  assert.deepEqual([...due.matchAll(/<span class="ohl-pt" style="[^"]+" data-tip="([^"]+)"><\/span>/g)].map((m) => m[1]), ['This week: 1 open line due, $1,000.', 'Week of Sep 6: 0 open lines due, $0.', 'Week of Sep 13: 2 open lines due, $2,000.', 'Week of Sep 20: 1 open line due, $1,000.',
    'Week of Sep 27: 0 open lines due, $0.', 'Week of Oct 4: 0 open lines due, $0.', 'Week of Oct 11: 0 open lines due, $0.', 'Week of Oct 18: 1 open line due, $1,000.']);
  assert.match(due, /<span class="ohl-peak" style="--x:31\.25%;top:[\d.]+%">2 lines peak · Sep 13<\/span>/);
  assert.deepEqual([...(/<div class="ohl-weeks" aria-hidden="true">([\s\S]*?)<\/div>/.exec(due) || ['', ''])[1].matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]), ['Now', '', '9/13', '', '9/27', '', '10/11', '']);
  assert.doesNotMatch(due, /class="ohu"|Top reasons/);
  // The five lines in the weeks and the three in the chip are every open line with a date (114 has no commit date).
  assert.equal(page.run("orderHealthData(currentMetrics()).allOrderRows.filter(r=>r.isOpen).length"), 9);
  // Neither has a card or an h2 of its own any more; the only h2 in the card's row is the question.
  assert.doesNotMatch(g, /<h2[^>]*>(Open lines by due week|Top reasons|Status &amp; top reasons)<\/h2>/);
  assert.doesNotMatch(why, /<h2|dz-card-head/);
  assert.match(g, /<h2 class="ohl-q-t" data-tc-skip>Why, and When\?<\/h2><\/div>\s*<section class="dz-card dz-span-6 ohl-card ohl-why /);
  // The chip lists the past-due lines (and shows as picked, with the Status cell); a reason name lists its lines.
  page.run("setWeeklyTileFilter('st-pastdue')");
  assert.match(card(grid(page), 'ohl-why'), /<button type="button" class="dz-chip red ohl-chipbtn sel" data-focus-key="tile-st-pastdue-chip" onclick="setWeeklyTileFilter\('st-pastdue'\)" aria-pressed="true"/);
  assert.deepEqual(statusCells(card(grid(page), 'ohl-status-card')).filter((c) => c.pressed).map((c) => c.id), ['pastdue']);
  assert.deepEqual(lineDocs(page), ['100', '101', '102']);
  page.run("setWeeklyTileFilter('st-pastdue');setWeeklyReasonFilter('Rescheduled later')");
  assert.match(card(grid(page), 'ohl-why'), /<button type="button" class="ohu-name sel" data-focus-key="oh-reason-Rescheduled later" aria-pressed="true"/);
  assert.deepEqual(lineDocs(page), ['113']);
  page.run("setWeeklyReasonFilter('Rescheduled later')");
  assert.deepEqual(lineDocs(page), ['100', '101', '102', '113', '114']);
  assert.deepEqual(page.errors, []);
  // Nothing due in the next eight weeks and nothing at risk: each half says so in words (the card still holds both).
  const quiet = await loadRows([so('700', '12/15/2026')]);
  const q = card(grid(quiet), 'ohl-why');
  assert.match(q, /<b>0<\/b> at-risk lines<\/span><\/div>\s*<div class="empty-note">No reasons set on the at-risk lines\.<\/div>/);
  assert.match(q, /Open lines by due week<\/div><\/div>\s*<div class="empty-note ohl-empty">No open lines are due in the next eight weeks\.<\/div>/);
  assert.doesNotMatch(q, /tile-st-pastdue-chip|ohl-chart/);
  assert.deepEqual(quiet.errors, []);
});

test('What Can We Do?: Supply to pull in | Date changes behind one switch (ohlSetDoView), 5 rows a page; one block alone when the other has no rows; print shows both', async () => {
  // Twelve customers: twelve PO lines to pull in, and thirteen lines (twelve customers) whose date moved a month later.
  const page = await loadRows(doRows(12));
  const doCard = () => card(grid(page), 'ohl-do');
  const seg = (c) => [...((/<div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do">([\s\S]*?)<\/div>/.exec(c) || ['', ''])[1]).matchAll(/<button type="button" data-focus-key="(ohl-do-\w+)"( class="on")? aria-pressed="(true|false)" onclick="ohlSetDoView\(&#39;(\w+)&#39;\)" data-tip="([^"]+)">([^<]+)<\/button>/g)]
    .map((m) => [m[1], !!m[2], m[3] === 'true', m[4], m[6]]);
  const pos = (c) => [...c.matchAll(/<button type="button" class="ohl-pull-po[^"]*" data-focus-key="ohl-pull-[^"]+" data-off="[^"]+" aria-pressed="(?:true|false)" onclick="ohlPullPick\(this\.dataset\.off\)" data-tip="[^"]+">PO (\d+)<\/button>/g)].map((m) => +m[1]);
  const moved = (c) => [...c.matchAll(/<button type="button" class="dz-tr ohl-dc-row[^"]*" data-focus-key="dc-(CUST\d+)" data-off="\1" onclick="setWeeklyOffenderFilter\('customers',this\.dataset\.off\)" aria-pressed="(?:true|false)" data-tip="[^"]+">/g)].map((m) => m[1]);
  const count = (c) => (/<span class="dz-pagecount">([^<]*)<\/span>/.exec(c) || [])[1] || '';
  assert.equal(page.run('ohlDoView'), 'pull');
  assert.deepEqual(page.run('(()=>{const m=currentMetrics(),t=soDateChangeImpact(m).totals;return [ohlSupplyData(m).pulls.length,t.lines,t.customers]})()'), [12, 13, 12]);
  // Supply to pull in first: the card is named for the block shown; the switch sits in the title row with the counts.
  let c = doCard();
  assert.match(c, /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-pull dz-fade" style="--i:5" aria-label="Supply to pull in"><div class="dz-card-head"><h2 class="dz-title" data-tip="PO lines due after the orders they cover\n[^"]+">Supply to pull in<\/h2><span class="dz-meta"><div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do">/);
  const SEG = [['ohl-do-pull', 'pull', 'Supply to pull in · 12'], ['ohl-do-dates', 'dates', 'Date changes · 13 lines']];
  assert.deepEqual(seg(c), SEG.map(([key, id, label]) => [key, id === 'pull', id === 'pull', id, label]));
  assert.equal((c.match(/<h2/g) || []).length, 1);
  assert.match(c, /<table class="sup-tbl ohl-pull-tbl">/);
  assert.doesNotMatch(c, /ohl-dc-row|data-card="date-change"/);
  // Five PO lines a page, the earliest need first.
  assert.deepEqual(pos(c), [601, 602, 603, 604, 605]);
  assert.equal(count(c), '1–5 of 12 PO lines');
  assert.match(c, /<nav class="shp-pager dz-pager print-hide" data-dzpager="ohl-pull" aria-label="Supply to pull in pages"/);
  page.run("dzGoPage('ohl-pull',3)");
  assert.deepEqual(pos(doCard()), [611, 612]);
  assert.equal(count(doCard()), '11–12 of 12 PO lines');
  page.run("dzPagerKey({key:'Home',preventDefault(){}},'ohl-pull')");
  assert.deepEqual(pos(doCard()), [601, 602, 603, 604, 605]);
  // The other side of the switch: Date changes, five customers a page, the most value moved first.
  page.run("ohlSetDoView('dates')");
  assert.equal(page.run('ohlDoView'), 'dates');
  c = doCard();
  assert.match(c, /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-dcwrap dz-fade" style="--i:5" aria-label="Date changes"><div class="dz-card-head"><h2 class="dz-title" data-tip="Lines whose date moved over 2 days past due\n[^"]+">Date changes<\/h2><span class="dz-meta"><div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do">/);
  assert.deepEqual(seg(c), SEG.map(([key, id, label]) => [key, id === 'dates', id === 'dates', id, label]));
  assert.match(c, /<div class="ohl-dc" data-card="date-change"><div class="dz-table ohl-dc-table" role="group" aria-label="Customers with later dates">/);
  assert.doesNotMatch(c, /ohl-pull-tbl|ohl-pull-po/);
  assert.deepEqual(moved(c), ['CUST12', 'CUST11', 'CUST10', 'CUST09', 'CUST08']);
  assert.equal(count(c), '1–5 of 12 customers');
  assert.match(c, /<nav class="shp-pager dz-pager print-hide" data-dzpager="ohl-datechange" aria-label="Date changes pages"/);
  assert.match(c, /data-focus-key="dc-CUST12"[^>]*data-tip="CUST12 - Customer 12\n• 1 line, \$12,000 moved later\n• Worst: SO 312 R12 due Sep 22, now Oct 22 \(SAP\)\nClick to filter to it\.">\s*<span class="ohl-dc-cust">CUST12 - Customer 12<\/span>\s*<span class="ohl-dc-lines">1 line<span class="dz-cell-sub">\$12K<\/span><\/span>\s*<span class="dz-num ohl-dc-slip">\+30d<\/span>/);
  page.run("dzGoPage('ohl-datechange',3)");
  c = doCard();
  assert.deepEqual(moved(c), ['CUST02', 'CUST01']);
  assert.equal(count(c), '11–12 of 12 customers');
  assert.match(c, /data-focus-key="dc-CUST01"[^>]*data-tip="CUST01 - Customer 01\n• 2 lines, \$1,500 moved later\n[^"]+">\s*<span class="ohl-dc-cust">CUST01 - Customer 01<\/span>\s*<span class="ohl-dc-lines">2 lines<span class="dz-cell-sub">\$2K<\/span><\/span>/);
  // The switch keeps its side through a redraw; anything but 'dates' is Supply to pull in. Pull in kept its page 1.
  page.run('renderResults()');
  assert.match(doCard(), /aria-label="Date changes"/);
  for (const v of ["'pull'", "'nonsense'", 'undefined']) {
    page.run("ohlSetDoView('dates')");
    page.run(`ohlSetDoView(${v})`);
    assert.equal(page.run('ohlDoView'), 'pull', v);
    assert.match(doCard(), /aria-label="Supply to pull in"/, v);
  }
  assert.deepEqual(pos(doCard()), [601, 602, 603, 604, 605]);
  // Print: both blocks, each under its own title, every row, no switch and no pager.
  page.run("ohlSetDoView('dates')");
  page.run('printMode=true;renderResults()');
  c = doCard();
  assert.match(c, /^<section class="dz-card dz-span-6 ohl-card ohl-do" aria-label="What we can do"><div class=" ohl-pull"><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]+">Supply to pull in<\/h2><\/div>/);
  assert.match(c, /<\/table><\/div><\/div><div class="ohl-sec ohl-dcwrap"><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]+">Date changes<\/h2><\/div><div class="ohl-dc" data-card="date-change">/);
  assert.deepEqual(pos(c), Array.from({ length: 12 }, (_, i) => 601 + i));
  assert.deepEqual(moved(c), Array.from({ length: 12 }, (_, i) => `CUST${two(12 - i)}`));
  assert.doesNotMatch(c, /dz-seg|data-focus-key="ohl-do-|dz-pagefoot|shp-pager/);
  assert.deepEqual(questions(grid(page)).slice(0, 4).map((x) => x[1]), ['What Is at Risk?', 'Why, and When?', 'Who?', 'What Can We Do?']);
  page.run('printMode=false;renderResults()');
  c = doCard();
  assert.match(c, /aria-label="Date changes"/);
  assert.equal(seg(c).length, 2);
  // A date-change row is the page's customer filter, as before: that customer's line, and its PO in the other block.
  page.run("setWeeklyOffenderFilter('customers','CUST05')");
  c = doCard();
  assert.deepEqual(moved(c), ['CUST05']);
  assert.match(c, /class="dz-tr ohl-dc-row sel" data-focus-key="dc-CUST05" data-off="CUST05" onclick="[^"]+" aria-pressed="true"/);
  assert.deepEqual(seg(c).map((x) => x[4]), ['Supply to pull in · 1', 'Date changes · 1 line']);
  assert.doesNotMatch(c, /dz-pagefoot/);
  page.run("ohlSetDoView('pull')");
  assert.deepEqual(pos(doCard()), [605]);
  page.run("setWeeklyOffenderFilter('customers','CUST05')");
  assert.deepEqual(page.errors, []);

  // Only supply to pull in: that block alone, no switch, whichever side the switch was left on.
  const pullOnly = await loadRows(doRows(6, { dates: false }));
  for (const v of ['pull', 'dates']) {
    pullOnly.run(`ohlSetDoView('${v}')`);
    const p = card(grid(pullOnly), 'ohl-do');
    assert.match(p, /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-pull dz-fade" style="--i:5" aria-label="Supply to pull in"><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]+">Supply to pull in<\/h2><\/div><div class="sup-scroll"/, v);
    assert.doesNotMatch(p, /dz-seg|data-focus-key="ohl-do-|Date changes|ohl-dc/, v);
    assert.deepEqual(pos(p), [601, 602, 603, 604, 605], v);
    assert.equal(count(p), '1–5 of 6 PO lines', v);
  }
  assert.equal(questions(grid(pullOnly)).length, 4);
  assert.deepEqual(pullOnly.errors, []);
  // Only date changes: that block alone, no switch.
  const datesOnly = await loadRows(doRows(6, { pull: false }));
  for (const v of ['pull', 'dates']) {
    datesOnly.run(`ohlSetDoView('${v}')`);
    const d = card(grid(datesOnly), 'ohl-do');
    assert.match(d, /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-dcwrap dz-fade" style="--i:5" aria-label="Date changes"><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]+">Date changes<\/h2><\/div><div class="ohl-dc" data-card="date-change">/, v);
    assert.doesNotMatch(d, /dz-seg|data-focus-key="ohl-do-|Supply to pull in|ohl-pull/, v);
    assert.deepEqual(moved(d), ['CUST06', 'CUST05', 'CUST04', 'CUST03', 'CUST02'], v);
    assert.equal(count(d), '1–5 of 6 customers', v);
  }
  assert.equal(questions(grid(datesOnly)).length, 4);
  assert.deepEqual(datesOnly.errors, []);
});

test('The two month lists are folds in one card: shut on load; opening one sets tableMore and survives a redraw; print opens both; the bar chart is not on Leading', async () => {
  const page = await loadRows(MIX);
  const months = () => card(grid(page), 'ohl-months');
  const folds = () => [...months().matchAll(/<details class="ohl-fold"( open)? data-more="(ohl-fold-\w+)" ontoggle="ohlFoldToggle\(this\)"><summary data-focus-key="more-\2" data-tip="([^"]+)"><svg class="dz-chev"[^>]*>[\s\S]*?<\/svg><span class="dz-title sm ohl-fold-t">([^<]+)<\/span><span class="ohl-fold-m">([^<]*)<\/span><\/summary><div class="ohl-fold-body">/g)]
    .map((m) => ({ key: m[2], open: !!m[1], tip: m[3], title: m[4], meta: m[5] }));
  const open = () => folds().map((f) => f.open);
  const toggle = (key, to) => page.run(`ohlFoldToggle({dataset:{more:${JSON.stringify(key)}},open:${to}})`);
  // One card ("Lists"), after the questions (113's date change gives a fourth here): two folds, both shut, each with
  // a tip, then the Lines card as its last child (no longer a card of the grid).
  assert.match(months(), /^<section class="dz-card dz-span-6 ohl-card ohl-months mom-card misc-flat dz-fade" aria-label="Lists">\s*<details class="ohl-fold" data-more="ohl-fold-months"/);
  assert.equal((months().match(/<details class="ohl-fold"/g) || []).length, 2);
  assert.match(months(), /<\/details>\s*<section class="dz-card dz-span-6 ohl-card ohl-lines-card" id="linked-lines" aria-label="Lines">/);
  assert.match(grid(page), /<\/section>\s*<\/section>\s*<\/div>/, 'Lines closes the Lists card, which closes the grid');
  assert.equal((grid(page).match(/id="linked-lines"/g) || []).length, 1);
  assert.deepEqual(layout(grid(page)).slice(-4), ['What Can We Do?', 'ohl-do', 'ohl-months', 'ohl-lines-card']);
  assert.deepEqual(folds().map((f) => [f.key, f.open, f.title, f.meta]), [['ohl-fold-months', false, 'Open orders by delivery month', '2026'], ['ohl-fold-items', false, 'Items not shipped yet', '9 lines']]);
  assert.deepEqual(folds().map((f) => f.tip), ['Shipped and open value per month, against last year.', 'Open lines by original delivery month, oldest first.']);
  assert.deepEqual(page.run("Object.keys(tableMore).filter(k=>/ohl-fold/.test(k))"), []);
  // Fold 1: the monthly delivery summary (the Monthly page's table) and the undated-lines note in Leading's words.
  const [, first, second] = months().split('<details class="ohl-fold"');
  assert.match(first, /<div class="ohl-fold-body"><div class="ohl-sec-head"><div class="ohl-sec-title">Monthly delivery summary · 2026<\/div>/);
  assert.match(first, /<div class="table-scroll" tabindex="0" role="region" aria-label="Monthly delivery summary · 2026"><table class="data-table"/);
  // Open value by due month: August 100, 101, 102; September 110, 111's two lines and 113 on its new date; October 112.
  assert.deepEqual([...first.matchAll(/<td class="m">([\s\S]*?)<\/td>[\s\S]*?<td class="num">(\$[\d,]+)<\/td>/g)].map((m) => [plain(m[1]), m[2]]), [['Aug 2026', '$3,000'], ['Sep 2026 to date', '$4,000'], ['Oct 2026', '$1,000']]);
  assert.match(first, /<p class="ohl-note ohl-foot-note">1 open line \(\$1,000\) with no commit date is not in these months\.<\/p>/);
  assert.doesNotMatch(first, /monthly cards or chart|ohl-original-month/);
  // Fold 2: the Month pick and the open lines by original delivery month (10 a page).
  assert.match(second, /<div class="ohl-fold-body"><div class="ohl-fold-tools"><label class="inline-controls">Month <select id="ohl-original-month" class="select" data-focus-key="ohl-original-month" data-tip="[^"]+" onchange="setOriginalDeliveryMonthFilter\(this\.value\)">/);
  assert.match(second, /<div class="table-scroll" tabindex="0" role="region" aria-label="Items not shipped yet"><table class="data-table"/);
  assert.deepEqual([...second.matchAll(/<td class="strong">(\d+)<\/td>/g)].map((m) => m[1]), ['100', '101', '102', '113', '114', '110', '111', '111', '112']);
  // Gone on purpose: the two separate cards with their h2 titles and the collapse chevron on the Items card's head
  // (the Lines card keeps its own).
  assert.doesNotMatch(grid(page), /ohl-notshipped|<h2[^>]*>(Open orders by delivery month|Items not shipped yet)<\/h2>/);
  assert.doesNotMatch(months().slice(0, months().indexOf('id="linked-lines"')), /dz-collapse-btn/);
  // The delivery-month bar chart left Leading (the summary table has the same shipped and open values) ...
  assert.doesNotMatch(grid(page), /mom-pair|pair-chart|pair-labels|pair-col|class="legend chart"/);
  // Opening a fold is remembered without a redraw (the browser has already opened it), and the next redraw keeps it.
  const before = html(page);
  toggle('ohl-fold-items', true);
  assert.equal(html(page), before, 'no redraw');
  assert.deepEqual(page.run("Object.entries(tableMore).filter(([k])=>/ohl-fold/.test(k))"), [['more-ohl-fold-items', true]]);
  page.run('renderResults()');
  assert.deepEqual(open(), [false, true]);
  // It stays open through the page's own redraws: a Status pick, a page filter, the fold's Month pick.
  page.run("setWeeklyTileFilter('st-pastdue')");
  page.run("setWeeklyCustomerFilter(['BARLETTA'])");
  assert.deepEqual(open(), [false, true]);
  assert.deepEqual(folds().map((f) => f.meta), ['2026', '4 lines']);
  page.run("setWeeklyCustomerFilter(['ALL']);setWeeklyTileFilter('st-pastdue')");
  page.run("setOriginalDeliveryMonthFilter('2026-09')");
  assert.deepEqual(open(), [false, true]);
  assert.deepEqual(folds().map((f) => f.meta), ['2026', '3 lines']);
  assert.match(months(), /<select id="ohl-original-month"[\s\S]*?<option value="2026-09" selected>Sep 2026<\/option>/);
  page.run("setOriginalDeliveryMonthFilter('ALL')");
  // Both open; shutting one forgets it.
  toggle('ohl-fold-months', true);
  page.run('renderResults()');
  assert.deepEqual(open(), [true, true]);
  toggle('ohl-fold-items', false);
  assert.deepEqual(page.run("Object.entries(tableMore).filter(([k])=>/ohl-fold/.test(k))"), [['more-ohl-fold-months', true]]);
  page.run('renderResults()');
  assert.deepEqual(open(), [true, false]);
  toggle('ohl-fold-months', false);
  page.run('renderResults()');
  assert.deepEqual(open(), [false, false]);
  // Print opens both (and a toggle while printing is not remembered); after printing they are shut again.
  page.run('printMode=true;renderResults()');
  assert.deepEqual(open(), [true, true]);
  toggle('ohl-fold-months', true);
  assert.doesNotMatch(grid(page).slice(0, grid(page).indexOf('ohl-lines-card')), /mom-pair|pair-chart/);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(open(), [false, false]);
  assert.deepEqual(page.run("Object.keys(tableMore).filter(k=>/ohl-fold/.test(k))"), []);
  // A new report starts with both shut.
  toggle('ohl-fold-months', true);
  page.run('resetViewState();renderResults()');
  assert.deepEqual(open(), [false, false]);
  // ... and the bar chart is still on the Monthly page (hidden by default; shown from Settings).
  page.run("stgTogglePage('monthly');setTab('monthly')");
  assert.match(html(page), /<div class="pair-chart"><div class="pair-col/);
  assert.deepEqual(page.errors, []);
});

// Every button in Leading's cards (not the Lines card's own rows) is pressed twice, by the click the page gave it:
// nothing is logged as an error, nothing throws, and Leading still draws its questions after each one.
test('Leading, every control: each button\'s click runs clean (page.errors stays empty) and the questions stay; focus keys are unique', async () => {
  const page = await loadRows([...MIX, ...doRows(7)]);
  const decode = (s) => String(s || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attr = (tag, name) => decode((new RegExp(` ${name}="([^"]*)"`).exec(tag) || [])[1]);
  const buttons = () => {
    const g = grid(page);
    return [...g.slice(0, g.indexOf('<section class="dz-card dz-span-6 ohl-card ohl-lines-card"')).matchAll(/<button type="button"[^>]*>/g)]
      .map((m) => ({ key: attr(m[0], 'data-focus-key'), click: attr(m[0], 'onclick'), off: attr(m[0], 'data-off'), wh: attr(m[0], 'data-wh'), named: / (data-tip|aria-label)="[^"]+"/.test(m[0]) }));
  };
  const first = buttons();
  assert.ok(first.length > 60, `${first.length} buttons`);
  assert.deepEqual(first.filter((b) => !b.key || !b.click).map((b) => b.key || b.click), [], 'every button has a focus key and a click');
  assert.deepEqual(first.filter((b) => !b.named).map((b) => b.key), [], 'every button has a tip or a name');
  const keys = first.map((b) => b.key);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'no focus key is used twice');
  // The new cards' controls are all there.
  for (const want of ['status-st-ontrack', 'status-seg-st-pastdue', 'tile-st-pastdue-chip', 'offrow-FIREFLY', 'ohl-sup-FIREFLY-po', 'ohl-sup-src-pull', 'ohl-do-pull', 'ohl-do-dates', 'pg-ohl-customers-2', 'pg-ohl-pull-2']) assert.ok(keys.includes(want), want);
  const summaries = [...grid(page).matchAll(/<summary data-focus-key="([^"]+)" data-tip="[^"]+">/g)].map((m) => m[1]);
  assert.deepEqual(summaries, ['more-ohl-fold-months', 'more-ohl-fold-items']);
  let pressed = 0;
  for (const key of keys) {
    for (let i = 0; i < 2; i++) {
      const b = buttons().find((x) => x.key === key);
      if (!b) break; // a pick can take the button away (a page filter, the other side of the switch)
      page.ctx.__btn = { dataset: { off: b.off, wh: b.wh } };
      assert.doesNotThrow(() => page.run(`(function(){${b.click}}).call(__btn)`), `${key}: ${b.click}`);
      pressed++;
      assert.deepEqual(page.errors, [], `${key}: ${b.click}`);
      assert.equal(page.run('activeTab+"/"+weeklyView'), 'weekly/leading', key);
      const q = questions(grid(page)).map((x) => x[0]);
      assert.ok(q.length >= 3 && q.every((n, j) => n === j + 1), `${key}: questions ${q.join()}`);
    }
  }
  assert.ok(pressed > 120, `${pressed} clicks`);
  // Back where it started: no page filter, no pick, the switch on either side.
  page.run("resetWeeklyFilters();ohlSupplyClear();ohlSetDoView('pull')");
  assert.deepEqual(questions(grid(page)).map((x) => x[1]), ['What Is at Risk?', 'Why, and When?', 'Who?', 'What Can We Do?']);
  assert.deepEqual(page.errors, []);
});

test('Purchase Order Health: Build Risk counts CM kits not ticked clean (no money); Kits by CM and month; a tick updates both', async () => {
  // Today is Sep 3: PO 700 (DSM) late, PO 701 (DSM) due in 30 days, PO 702 (DSM) later, PO 703 (Spyder - Lacombe, not a CM).
  const rows = [
    po('700', '08/20/2026', { Warehouse: 'CM - DSM' }),
    po('701', '09/20/2026', { Warehouse: 'CM - DSM' }),
    po('702', '12/15/2026', { Warehouse: 'CM - DSM' }),
    po('703', '09/10/2026'),
  ];
  const page = loadPage({ storage: IMPORT });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run("setTab('purchaseorders')");
  let h = html(page);
  const card = (x) => (x.match(/<div class="dz-stat br-stat br-card[\s\S]*?<\/div><\/div>/) || [''])[0];
  assert.match(card(h), /Build Risk/);
  // "3 kits not clean", a split bar (late / due in 30 days / later, one kit each) under it, and no sub line.
  assert.match(card(h), /<span class="dz-stat-v"[^>]*>3<span class="po-unit">kits not clean<\/span><\/span><span class="po-split" aria-hidden="true"><i style="flex:1;[^"]*"><\/i><i style="flex:1;[^"]*"><\/i><i style="flex:1;[^"]*"><\/i><\/span><\/button>/);
  assert.doesNotMatch(card(h), /CM kits in all|dz-stat-s/);
  assert.deepEqual([...card(h).matchAll(/data-focus-key="potile-(br\w+)"[\s\S]*?(?:<span class="po-own-n">(\d+)<\/span>|<\/button>)/g)].map((m) => [m[1], m[2] ? +m[2] : null]), [['brrisk', null], ['brlate', 1], ['brsoon', 1], ['brlater', 1]]);
  assert.doesNotMatch(card(h).replace(/data-tip="[^"]*"/g, ''), /\$/, 'no money on the card');
  // The card sits in question 3's Kits card, beside Kit Status (0 clean, 4 not clean).
  assert.match(h, /<h2 class="ohl-q-t" data-tc-skip>Are the Kits Ready\?<\/h2><\/div><section class="dz-card po-kitscard[^"]*" aria-label="Kits"><div class="po-kgrid"><div class="dz-stat kit-stat[^"]*" role="group" aria-label="Kit Status">[\s\S]*?<span class="kit2-n">0<\/span><span class="kit2-l">Clean<\/span>[\s\S]*?<span class="kit2-n">4<\/span><span class="kit2-l">Not clean<\/span>[\s\S]*?<\/div><\/div><div class="dz-stat br-stat br-card/);
  assert.deepEqual(page.run("[poBuildRiskData(poData(currentMetrics()).filteredPoOpen,reportToday())].map(b=>[b.late,b.soon,b.later].map(x=>x.map(r=>r.documentNumber).join()))[0]"), ['700', '701', '702']);
  // Kits by CM and month: one CM row (DSM), past due / this month / December cells, 0 of 3 clean.
  // It is a block inside the Kits card now, not a card of its own.
  assert.match(h, /<div class="po-sec po-kitcm" role="group" aria-label="Kits by CM and month"><div class="ohs2-head"><div class="ohl-sec-title"[^>]*>Kits by CM and month<\/div><span class="kc-meta"><b>0<\/b> of 3 kits clean<\/span><\/div>/);
  assert.doesNotMatch(h, /<h2 class="dz-title sm"[^>]*>Kits by CM and month<\/h2>/);
  assert.match(h, /data-focus-key="kitcm-DSM"/);
  assert.deepEqual([...h.matchAll(/data-focus-key="kitcm-DSM-([\w-]+)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]]),
    [['past', 'DSM, Past due: 1 not clean, 0 clean'], ['2026-09', 'DSM, Sep: 1 not clean, 0 clean'], ['2026-12', 'DSM, Dec: 1 not clean, 0 clean']]);
  // Tick PO 700's kit clean: Build Risk drops to 2 and the past-due cell turns clean.
  page.run("(()=>{const r=allLoadedRows.find(x=>x.documentNumber==='700');writeRowOverride(rowKey(r),[r],'kitClean',true);renderResults();})()");
  h = html(page);
  assert.equal(page.run("poBuildRiskData(poData(currentMetrics()).filteredPoOpen,reportToday()).risk.length"), 2);
  assert.match(h, /<b>1<\/b> of 3 kits clean/);
  assert.match(card(h), />2<span class="po-unit">kits not clean<\/span><\/span><span class="po-split" aria-hidden="true"><i style="flex:1;[^"]*"><\/i><i style="flex:1;[^"]*"><\/i><\/span>/);
  // A cell lists its lines in PO lines.
  page.run("setPoKitPick('DSM','past')");
  assert.equal(page.run('poTileFilter'), 'kitcm');
  assert.deepEqual(page.run("poKitPickRows(poData(currentMetrics()).filteredPoOpen,reportToday()).map(r=>r.documentNumber)"), ['700']);
  assert.deepEqual(page.errors, []);
});

test('Pull in matches POs to orders in the same warehouse first; leftover supply elsewhere covers the rest as a transfer', async () => {
  // Item Q. Lacombe: SO 300 (Aug 10, 10) and SO 302 (Aug 15, 5); McBride: SO 301 (Aug 12, 10).
  // POs: 700 at McBride (Sep 1, 10), 701 at Lacombe (Sep 20, 10), 702 at McBride (Sep 25, 5).
  const L = { 'Item No.': 'Q', Warehouse: 'Spyder - Lacombe' }, M = { 'Item No.': 'Q', Warehouse: 'Spyder - McBride' };
  const rows = [
    so('300', '08/10/2026', { ...L }), so('301', '08/12/2026', { ...M }), so('302', '08/15/2026', { ...L, Quantity: '5.000', OpenQuantity: '5.000' }),
    po('700', '09/01/2026', { ...M }), po('701', '09/20/2026', { ...L }), po('702', '09/25/2026', { ...M, Quantity: '5.000', OpenQuantity: '5.000' }),
  ];
  const page = loadPage({ storage: IMPORT });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  const cover = page.run(`(()=>{const c=ohlAllocate(ohlPoByItem());const o={};c.forEach((v,r)=>{o[r.documentNumber]=[v.p.documentNumber,v.transfer||''];});return o;})()`);
  // Same warehouse first: SO 300 (Lacombe) takes PO 701 (Lacombe), not the earlier McBride PO 700; SO 301 takes PO 700.
  assert.deepEqual(cover['300'], ['701', '']);
  assert.deepEqual(cover['301'], ['700', '']);
  // SO 302 (Lacombe) has no Lacombe supply left: McBride's leftover PO 702 covers it, flagged as a transfer.
  assert.deepEqual(cover['302'], ['702', 'Spyder - McBride']);
  const pulls = page.run(`ohlSupplyData(currentMetrics()).pulls.map(x=>[x.p.documentNumber,[...x.transferTo].join()])`);
  assert.deepEqual(pulls.find((x) => x[0] === '702'), ['702', 'Spyder - Lacombe']);
  assert.match(html(page), /<span class="dz-cell-sub ohl-pull-xfer"[^>]*>Transfer to Spyder · Lacombe<\/span>/);
  assert.deepEqual(page.errors, []);
});

run();
