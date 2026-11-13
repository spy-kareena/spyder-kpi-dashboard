// 2v6.9 leading: Sales Order Health has a third view, Supply / Demand (Leading | Lagging | Supply / Demand), with the
// Short or at-risk items card that was on the Supply / Demand page; At risk has no quiet share / target line and the
// ship target no note; Customers at risk by supply source has no CM sheet source, and a click on a customer, a number or
// a source lists exactly those at-risk lines in the Lines card. Run with `node tests/leading-2v69.test.js`. Fixtures are
// synthetic.
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

test('Supply source card: no CM sheet; every at-risk line counted once under open PO, stock or none', async () => {
  const page = await loaded();
  const h = html(page);
  const card = h.slice(h.indexOf('Customers at risk by supply source'), h.indexOf('ohl-sup-foot') > 0 ? h.indexOf('ohl-sup-foot') : h.indexOf('<!--') > 0 ? h.length : h.length);
  assert.doesNotMatch(card, /CM sheet|Logican/);
  assert.deepEqual(page.run('OHL_SUPPLY_SOURCES.map(x=>x[0])'), ['pull', 'po', 'stock', 'none']);
  const pills = [...h.matchAll(/<button type="button" class="ohl-sup-pill[^"]*" data-focus-key="ohl-sup-src-(\w+)" aria-pressed="false"[^>]*>[\s\S]*?<b>(\d+)<\/b>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(pills, ['pull:0', 'po:1', 'stock:1', 'none:1']);
  const all = page.run('ohAtRiskData(currentMetrics()).risk.filter(ohIsSalesRow).length');
  assert.equal(page.run('Object.values(ohlSupplyData(currentMetrics()).totRows).reduce((s,r)=>s+r.length,0)'), all);
  assert.equal(all, 3);
  assert.deepEqual(page.errors, []);
});

test('Supply source card: a customer, a number or a source lists exactly those lines; again (or Clear) goes back', async () => {
  const page = await loaded();
  let h = html(page);
  // Each row: the name and each non-zero number are buttons with aria-pressed and focus keys.
  assert.match(h, /<div class="ohl-sup-row dz-fade" style="--i:0" role="group" aria-label="FIREFLY - Firefly RV">\s*<button type="button" class="ohl-sup-name" data-focus-key="ohl-sup-FIREFLY" data-off="FIREFLY" aria-pressed="false" onclick="ohlSupplyPick\(this\.dataset\.off,''\)"/);
  assert.match(h, /data-focus-key="ohl-sup-FIREFLY-po" data-off="FIREFLY" aria-pressed="false" aria-label="FIREFLY - Firefly RV, Late \/ no commit: 1 order"/);
  // The customer: both of Firefly's lines; the title names it; the chip counts them.
  page.run("ohlSupplyPick('FIREFLY','')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['100', '101'] });
  h = html(page);
  assert.deepEqual(linesMeta(h), ['2 lines · $2,000', 'FIREFLY - Firefly RV']);
  assert.match(h, /data-focus-key="ohl-sup-FIREFLY" data-off="FIREFLY" aria-pressed="true"/);
  assert.match(h, /data-focus-key="ohl-sup-clear" onclick="ohlSupplyClear\(\)"/);
  // A number: that customer and source (1 order = 1 line here).
  page.run("ohlSupplyPick('FIREFLY','stock')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['101'] });
  assert.deepEqual(linesMeta(html(page)), ['1 line · $1,000', 'FIREFLY - Firefly RV · Stock short']);
  // The same click again: the at-risk lines.
  page.run("ohlSupplyPick('FIREFLY','stock')");
  assert.equal(linesState(page).tile, 'late');
  assert.doesNotMatch(html(page), /data-focus-key="ohl-sup-clear"/);
  // A source pill: every customer, that source.
  page.run("ohlSupplyPick('','none')");
  assert.deepEqual(linesState(page), { tile: 'ohlsup', docs: ['102'] });
  assert.deepEqual(linesMeta(html(page)), ['1 line · $1,000', 'Not supply · All customers']);
  assert.match(html(page), /data-focus-key="ohl-sup-src-none" aria-pressed="true"/);
  page.run('ohlSupplyClear()');
  assert.equal(linesState(page).tile, 'late');
  // Another card's click gives way to it; a stale pick never lists anything.
  page.run("ohlSupplyPick('BARLETTA','');setWeeklyTileFilter('allopen')");
  assert.equal(page.run('weeklyTileFilter'), 'allopen');
  page.run("weeklyTileFilter='ohlsup';ohlSupPick=null;renderResults()");
  assert.equal(page.run('weeklyTileFilter'), 'late');
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

test('the new CSS sits in the 2v9:pages marker pair, on colour tokens', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v9:pages */'), HTML.indexOf('/* 2v9:end pages */'));
  assert.match(css, /\.ohl-sup-row\{grid-template-columns:minmax\(0,2\.2fr\) repeat\(4,minmax\(64px,\.6fr\)\) minmax\(90px,1\.1fr\)/);
  assert.match(css, /button\.ohl-sup-name\.sel,button\.ohl-sup-n\.sel\{background:var\(--dz-indigo-bg\);color:var\(--dz-indigo-deep\)\}/);
  assert.match(css, /\.ohl-sd \.dz-chip\.red\{color:var\(--dz-risk-text\)\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{button\.ohl-sup-pill,button\.ohl-sup-name,button\.ohl-sup-n\{transition:none\}\}/);
  assert.doesNotMatch(HTML, /\.ohl-hero-quiet|\.mwm-note/);
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

test('Customers at risk is a ranked table against each customer\'s own open orders; Top reasons are tiles with a share ring', async () => {
  const page = await loaded();
  const h = html(page);
  // Customers at risk (owner, option F): a ranked table: past due, at risk otherwise, open; a thin split under each name; no money.
  // Firefly: SO 100 and 101, both open and past due.
  assert.match(h, /<table class="ohc2-tbl"><thead><tr><th scope="col">Customer<\/th><th scope="col" class="num">Past due<\/th><th scope="col" class="num">At risk<\/th><th scope="col" class="num">Open<\/th><\/tr><\/thead>/);
  assert.match(h, /data-focus-key="offrow-FIREFLY"[^>]*onclick="setWeeklyOffenderFilter\('customers',this\.dataset\.off\)"[\s\S]*?<\/th><td class="num ohc2-pd">2<\/td><td class="num ohc2-ar">0<\/td><td class="num">2<\/td><\/tr>/);
  assert.doesNotMatch(h.slice(h.indexOf('ohc2-tbl'), h.indexOf('</table>', h.indexOf('ohc2-tbl'))), /\$/);
  // Top reasons (2v6.9 redesign): a tile per reason with a ring for its share of the at-risk orders, its figures and
  // where it is worst; the tile filters to the reason.
  const tiles = h.slice(h.indexOf('<div class="ohr-grid"'), h.indexOf('ohl-foot-note', h.indexOf('<div class="ohr-grid"')));
  assert.ok(tiles.length > 100, 'the reason tiles are drawn');
  assert.match(tiles, /<button type="button" class="ohr-tile" data-focus-key="oh-reason-[^"]+" aria-pressed="false" onclick="setWeeklyReasonFilter\(/);
  assert.match(tiles, /<circle class="ohr-arc" cx="22" cy="22" r="17" stroke-dasharray="[\d.]+ [\d.]+"/);
  assert.match(tiles, /<span class="ohr-pct">\d+<small>%<\/small><\/span>/);
  assert.match(tiles, /<span class="ohr-wh">Most at [^<]+ · \d+<\/span>/);
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
  assert.match(card(h), />3<\/span>|>3<span/);
  assert.doesNotMatch(card(h).replace(/data-tip="[^"]*"/g, ''), /\$/, 'no money on the card');
  assert.deepEqual(page.run("[poBuildRiskData(poData(currentMetrics()).filteredPoOpen,reportToday())].map(b=>[b.late,b.soon,b.later].map(x=>x.map(r=>r.documentNumber).join()))[0]"), ['700', '701', '702']);
  // Kits by CM and month: one CM row (DSM), past due / this month / December cells, 0 of 3 clean.
  assert.match(h, /<h2 class="dz-title sm"[^>]*>Kits by CM and month<\/h2>[\s\S]*?<b>0<\/b> of 3 kits clean/);
  assert.match(h, /data-focus-key="kitcm-DSM"/);
  // Tick PO 700's kit clean: Build Risk drops to 2 and the past-due cell turns clean.
  page.run("(()=>{const r=allLoadedRows.find(x=>x.documentNumber==='700');writeRowOverride(rowKey(r),[r],'kitClean',true);renderResults();})()");
  h = html(page);
  assert.equal(page.run("poBuildRiskData(poData(currentMetrics()).filteredPoOpen,reportToday()).risk.length"), 2);
  assert.match(h, /<b>1<\/b> of 3 kits clean/);
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
