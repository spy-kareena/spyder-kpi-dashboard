// 2v2 layout (Order Health), as the page is today (2v6 / 2v6.9): the Leading / Lagging switch at the left of the filter
// row, the cards in their order, the owner filter gone, and the six override tiles in the At risk card.
// Run with `node tests/layout-2v2.test.js`. Fixtures are synthetic (harness.js); no SAP data, no network.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, utf16Tsv, SAP_HEADERS, createSuite } = require('./harness');
const { test, run } = createSuite();

// Export date 09/03/2026 (a Thursday).
const open = (doc, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, ...o });
const due = (d) => ({ DueDate: d, LineDueDate: d, HeaderDueDate: d });
const resched = (d, flag = 'Rescheduled Later Than Original Delivery') => ({ LineRescheduleDate: d, RescheduleDate: d, RescheduleFlag: flag });
const closedLine = (doc, o = {}) => open(doc, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', AmountLocal: '0', ...o });
const delivery = (doc, closed, o = {}) => open(doc, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', OrderType: 'Sales Delivery', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, FillStatus: 'Complete', ...o });
const ROWS = [
  open('300', { ...due('08/01/2026'), AmountLocal: '10,000.00', Warehouse: 'CM - DSM', DocumentOwner: 'Ana Diaz' }), // past due
  open('301', { ...due('08/02/2026'), AmountLocal: '2,000.00' }), // past due
  open('302', { ...due('08/15/2026'), ...resched('11/11/1111', 'No Commit Date'), DueDateRiskFlag: 'No Commit Date', AmountLocal: '8,000.00' }), // no commit
  open('303', { ...due('08/20/2026'), ...resched('09/20/2026'), AmountLocal: '6,000.00' }), // rescheduled
  open('304', { ...due('08/05/2026'), AmountLocal: '4,000.00', Warehouse: 'CM - DSM' }), // past due
  open('305', { ...due('08/10/2026'), AmountLocal: '5,000.00' }), // past due
  open('306', { ...due('10/20/2026'), AmountLocal: '1,500.00' }), // not at risk (due later)
  open('307', { ...due('08/12/2026'), AmountLocal: '700.00' }), // past due, no override
  // Deliveries in the last 3 months: late, on time, early, 2 days late -> OTD 50%.
  closedLine('400', due('08/10/2026')), delivery('400', '08/15/2026', { ...due('08/10/2026'), AmountLocal: '900.00' }),
  closedLine('401', due('08/12/2026')), delivery('401', '08/12/2026', { ...due('08/12/2026'), AmountLocal: '800.00' }),
  closedLine('402', due('08/10/2026')), delivery('402', '08/09/2026', { ...due('08/10/2026'), AmountLocal: '700.00' }),
  closedLine('403', due('08/18/2026')), delivery('403', '08/20/2026', { ...due('08/18/2026'), AmountLocal: '600.00' }),
];
// Override statuses (OVERRIDE_OPTIONS) set on the lines, as a user picks them in the linked lines.
const STATUSES = { 300: 'Shipping Delay', 301: 'Shipping Delay', 302: 'QC Delay', 303: 'Supplier Late', 304: 'Supply Chain', 305: 'Waiting on Production', 306: 'Shipping Delay' };
const TILES = [['Shipping Delay', 'Shipping Delay'], ['QC Delay', 'QC Delay'], ['R&D Hold', 'R&D Hold'], ['Supplier Delay', 'Supplier Late'], ['Supply Chain Delay', 'Supply Chain'], ['Wait on Prod', 'Waiting on Production']];

async function loaded(rows = ROWS, opts = {}, files) {
  const page = loadPage(opts);
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides()');
  await upload(page, files || [{ name: 'kpi.xls', bytes: sapExport(rows) }]);
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const row = (doc) => `allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}&&!r.deliveryDocNumber)`;
const key = (page, doc) => page.run(`rowKey(${row(doc)})`);
const setStatus = (page, doc, status) => page.run(`updateRowOverride(${JSON.stringify(key(page, doc))},'status',${JSON.stringify(status)})`);
const docs = (page, expr) => page.run(`(${expr}).map(r=>r.documentNumber).sort()`);
const risk = (page) => docs(page, 'orderHealthData(currentMetrics()).lateTileRows');
const linkedDocs = (page) => [...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]).sort();
// The six override tiles of the At risk card (2v6): its next-month at-risk lines (ohAtRiskData) with each override,
// counted as ohReasonTileData does for the page, in the owner's tile order.
const tiles = (page) => page.run('(()=>{const r=ohReasonTileData(currentMetrics());return OH_OVERRIDE_TILES.map(o=>r.find(t=>t.reason===o.status)).map(t=>[t.label,t.lines,Math.round(t.value)])})()');
const tileButtons = (page) => [...html(page).matchAll(/<button type="button" class="ohl-tile[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
async function withStatuses() {
  const page = await loaded();
  for (const [doc, status] of Object.entries(STATUSES)) setStatus(page, doc, status);
  return page;
}

// --- The switch ----------------------------------------------------------------------------------------
// 2v6: the switch is a segmented pill at the left of the filter row (dzSeg), with plain tab names; the headline
// numbers moved off it onto the At risk card (orders, value and lines) and its most affected warehouse (OTD 3 mo).
test('Leading / Lagging is the switch right under the page head, left of the filters; the At risk card carries the headline numbers', async () => {
  const page = await withStatuses();
  const m = html(page);
  // First thing in the page content: nothing but the page head before the filter row, the switch at its left.
  const before = m.slice(0, m.indexOf('<div class="dz-filterrow">'));
  assert.match(before, /^<div class="dz-pagehead rise"><h1 class="dz-h1" tabindex="-1">Sales Order Health<\/h1><\/div>\s*$/);
  const row = m.match(/<div class="dz-filterrow">[\s\S]*?<div class="print-only">/)[0];
  assert.ok(row.indexOf('role="tablist"') > 0 && row.indexOf('role="tablist"') < row.indexOf('<div class="dz-filters">'));
  const oh = page.run('(()=>{const o=orderHealthData(currentMetrics());return {amt:o.lateAmt,otd:o.otd3Mo.rate,scored:o.otd3Mo.scored.length}})()');
  assert.deepEqual(oh, { amt: 35700, otd: 50, scored: 4 });
  assert.deepEqual([...m.matchAll(/<button type="button" role="tab" id="oh-tab-(\w+)"[^>]*>([^<]*)<\/button>/g)].map((x) => [x[1], x[2]]),
    [['leading', 'Leading'], ['lagging', 'Lagging'], ['supply', 'Supply / Demand']]);
  // At risk: the orders big, the open value and lines under them, everything in full in the tip.
  const hero = () => html(page).match(/<button type="button" class="ohl-hero"[\s\S]*?<\/button>/)[0];
  assert.match(hero(), /data-tip="At risk, due by Oct 3\n• 7 orders, 7 lines\n• \$35,700 open\nClick to list them\."><span class="dz-big sm ohl-crit">7 orders<\/span><span class="dz-sub">\$35,700 · 7 lines<\/span>/);
  // OTD over the last 3 months: the most affected warehouse's figure (every delivery ships from Lacombe: 2 of 4).
  assert.match(m, /<div class="ohl-fig-l">OTD 3 mo<\/div><div class="ohl-fig-v sm">50%<\/div>/);
  // The numbers follow the page filters, like the cards.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.equal(page.run('orderHealthData(currentMetrics()).lateAmt'), 14000);
  assert.match(hero(), /<span class="dz-big sm ohl-crit">2 orders<\/span><span class="dz-sub">\$14,000 · 2 lines<\/span>/);
  assert.match(html(page), /<div class="ohl-fig-l">OTD 3 mo<\/div><div class="ohl-fig-v sm">—<\/div>/, 'no deliveries to score: a dash, not a red 0%');
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
  // Nothing at risk reads green.
  const calm = await loaded([ROWS[6], ...ROWS.slice(8)]);
  assert.match(html(calm), /<button type="button" class="ohl-hero"[^>]*><span class="dz-big sm ohl-good">0 orders<\/span><span class="dz-sub">\$0 · 0 lines<\/span>/);
});

// WCAG contrast of two #rrggbb colours.
function contrast(a, b) {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const token = (name) => HTML.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))[1];

test('the tabs not picked are marked by colour, never by opacity; the picked one is the dark pill; both keep 4.5:1', () => {
  assert.doesNotMatch(HTML, /\.dz-seg[^{]*\{[^}]*[{;\s]opacity\s*:/, 'no opacity on the switch (a transition list may name it)');
  assert.match(HTML, /:root\{--dz-seg-on-bg:#0f172a;--dz-seg-on-fg:#fff;--dz-seg-off-fg:#475569\}/);
  assert.match(HTML, /\.dz-seg button\.on\{background:var\(--dz-seg-on-bg\);color:var\(--dz-seg-on-fg\)\}/, 'the picked tab is the dark pill');
  assert.match(HTML, /\.dz-seg button\{[^}]*background:transparent;color:var\(--dz-seg-off-fg\)/);
  assert.match(HTML, /\.dz-seg\{display:inline-flex;background:var\(--dz-glass-60\);/);
  assert.ok(contrast('#ffffff', '#0f172a') >= 4.5);
  // The other tabs sit on the glass track: 60% white over the soft blue page (--dz-page #d7ebfc).
  const page = '#d7ebfc';
  const glass = '#' + [1, 3, 5].map((i) => Math.round(0.6 * 255 + 0.4 * parseInt(page.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');
  assert.ok(HTML.includes(`--dz-page:${page}}`));
  assert.ok(contrast('#475569', glass) >= 4.5, `off tab on ${glass}`);
  // Dark mode: the picked tab turns light, the others light grey on the dark surface.
  assert.match(HTML, /--dz-seg-on-bg:#eff4f9;--dz-seg-on-fg:#0c1a29;--dz-seg-off-fg:#bfcad6/);
  assert.ok(contrast('#0c1a29', '#eff4f9') >= 4.5);
  assert.ok(contrast('#bfcad6', '#182c3e') >= 4.5);
});

test('the Big picture switch is visible when off: its track is --gray-500 (3:1 or better on the button)', () => {
  assert.match(HTML, /\.bp-track\{[^}]*background:var\(--gray-500\)/);
  assert.match(HTML, /\.bp-switch:hover \.bp-track\{background:var\(--gray-600\)\}/);
  assert.ok(contrast(token('gray-500'), '#ffffff') >= 3);
  assert.ok(contrast(token('gray-500'), token('gray-100')) >= 3, 'also on a hovered button');
});

// 2v6.9 (owner): Status and Top reasons share one card (no card title, its two section titles lead); Top reasons is a
// heatmap of the at-risk orders by reason and warehouse, each reason a button that filters the lines.
test('Top reasons follow Status in one card: a reason by warehouse heatmap, the open order count only in the Status head', async () => {
  const page = await withStatuses();
  const m = html(page);
  const card = m.match(/<section class="dz-card ohl-card ohl-status-card[^"]*"[^>]* aria-label="Status and top reasons">[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...card.matchAll(/<div class="ohl-sec-title" data-tip="[^"]{20,}">([^<]+)<\/div>/g)].map((x) => x[1]), ['Status', 'Top reasons']);
  assert.match(card, /<div class="ohl-sec-title"[^>]*>Status<\/div><span class="ohs2-meta"><b>8<\/b> open orders<\/span>/);
  const top = card.slice(card.indexOf('>Top reasons</div>'));
  assert.doesNotMatch(top, /open orders/, 'the open order count is in the Status head only');
  assert.match(top, /<span class="ohs2-meta"><b>7<\/b> at-risk lines<\/span>/);
  assert.match(top, /<div class="ohu" style="--rows:8;--cols:6" role="group" aria-label="Which reasons come together">/);
  // Owner's pick (option S): the reasons in the sets shown, most lines first, each a filter button with its numbers in
  // the tip; a column per exact set of reasons, biggest first.
  const rows = [...top.matchAll(/<button type="button" class="ohu-name[^"]*" data-focus-key="oh-reason-([^"]+)" aria-pressed="false" onclick="[^"]+" data-tip="([^"]+)">/g)];
  assert.deepEqual(rows.map((x) => x[1]).slice(0, 2), ['Past due · No reschedule', 'Shipping Delay']);
  assert.equal(rows[1][2], 'Shipping Delay\n• 2 lines, 2 orders with this reason\n• $12,000 at risk\nClick to list every line with this reason.');
  const sets = [...top.matchAll(/data-focus-key="oh-rset-([^"]+)"[^>]*data-tip="([^"]+)"[\s\S]*?ohu-n">(\d+)</g)];
  assert.equal(sets.length, 6);
  assert.equal(sets[0][2], 'Past due · No reschedule + Shipping Delay\n• 2 lines, 2 orders\n• $12,000 at risk\nClick to list them.');
  assert.equal(sets[0][3], '2');
  page.run("setWeeklyReasonFilter('Shipping Delay')");
  assert.match(html(page), /class="ohu-name sel" data-focus-key="oh-reason-Shipping Delay" aria-pressed="true"/);
  assert.deepEqual(risk(page), ['300', '301']);
});

test('the switch keeps the tablist: arrow keys, Home / End, the view in snapshots and reset with a new report', async () => {
  const page = await withStatuses();
  assert.match(html(page), /<div class="dz-seg" role="tablist" aria-label="Sales Order Health view">/);
  assert.match(html(page), /role="tab" id="oh-tab-leading" class="on" aria-selected="true" tabindex="0" onclick="setWeeklyView\(&#39;leading&#39;\)" aria-controls="oh-panel-leading" onkeydown="ohTabKey\(event\)"/);
  // 2v6.9: three tabs; the left arrow from the first wraps to the last (Supply / Demand), the right arrow comes back.
  page.run("ohTabKey({key:'ArrowLeft',preventDefault(){}})");
  assert.equal(page.run('weeklyView'), 'supply', 'left arrow wraps to the last tab');
  page.run("ohTabKey({key:'ArrowLeft',preventDefault(){}})");
  assert.equal(page.run('weeklyView'), 'lagging');
  assert.match(html(page), /id="oh-tab-lagging" class="on" aria-selected="true" tabindex="0"/);
  assert.match(html(page), /id="oh-tab-leading" aria-selected="false" tabindex="-1"/);
  assert.equal(page.run('ohSnapshotView().weeklyView'), 'lagging');
  page.run("ohTabKey({key:'Home'})");
  assert.equal(page.run('weeklyView'), 'leading');
  page.run("ohTabKey({key:'End'})");
  assert.equal(page.run('weeklyView'), 'supply');
  page.run("ohTabKey({key:'ArrowRight'})");
  assert.equal(page.run('weeklyView'), 'leading', 'right arrow wraps to the first tab');
  page.run("ohRestoreView({weeklyView:'leading'})");
  assert.equal(page.run('weeklyView'), 'leading');
  page.run("setWeeklyView('lagging')");
  await page.ctx.handleFiles([{ name: 'new.xls', bytes: sapExport(ROWS) }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.run('weeklyView'), 'leading');
});

// 2v2.2 (owner): "Big picture is off the board for now (switch and chart hidden) until it gets a new home"
// (BIG_PICTURE_HIDDEN). Its one call keeps its place after the filters and their chips, ready for when it returns.
test('the Big picture is off the board (no switch, no chart, even when saved on); its one call still sits after the filter chips', async () => {
  // Source: the one weekly call follows the chart-filter chips (ohRenderDrillBar), which follow the filter row.
  assert.match(HTML, /html\+=ohRenderDrillBar\(\);[^\n]*\n\s*html\+=renderBigPicture\('weekly',m\);/);
  assert.equal(HTML.split("renderBigPicture('weekly'").length - 1, 1);
  assert.match(HTML, /\nconst BIG_PICTURE_HIDDEN=true;/);
  const page = await withStatuses();
  page.run("sankeyOpen={weekly:true};setWeeklyReasonFilter('Shipping Delay')");
  const m = html(page);
  assert.doesNotMatch(m, /id="sankey-weekly"|class="btn bp-switch"/);
  assert.equal(page.run("bigPictureSwitchHtml('weekly')"), '');
  // The filters, then the Filtered by chips, then the first card.
  const chips = m.indexOf('class="oh-drillbar"');
  assert.ok(chips > m.indexOf('<div class="print-only">Filters: ') && chips < m.indexOf('class="dz-card'), 'the chips sit between the filters and the cards');
});

// --- Owner filter --------------------------------------------------------------------------------------
test('the owner filter is gone from the filter bar and the notes; weeklyOwnerFilter stays All', async () => {
  const page = await withStatuses();
  const m = html(page);
  assert.doesNotMatch(m, /weekly-owner-select|All Owners|setWeeklyOwnerFilter/);
  // 2v6: the filter row (its pills) and its printed Filters: line.
  const filters = m.match(/<div class="dz-filterrow">[\s\S]*?<div class="print-only">Filters: [^<]*<\/div>/)[0];
  assert.doesNotMatch(filters.replace(/Document Owner/g, ''), /owner/i);
  assert.deepEqual([...filters.matchAll(/id="dzf-(oh-[a-z-]+)"/g)].map((x) => x[1]), ['oh-warehouse', 'oh-segment', 'oh-customer']);
  assert.equal(page.run('typeof setWeeklyOwnerFilter'), 'undefined');
  assert.equal(page.run('typeof setWeeklyOwnerPreset'), 'undefined');
  assert.deepEqual(page.run('weeklyOwnerFilter'), ['ALL']);
  // Owners only sort the Lines card (Top offenders, where they ranked, left the page in 2v6.9); no filter behind it.
  assert.match(m, /<select id="weekly-line-sort"[^>]*>[\s\S]*?<option value="owner">Sort: Document Owner<\/option>/);
  page.run("setWeeklyLineSort('owner')");
  assert.deepEqual(page.run('weeklyOwnerFilter'), ['ALL']);
  assert.equal(linkedDocs(page).length, 7);
  page.run("setWeeklyOffenderFilter('owners','Ana Diaz')");
  assert.deepEqual(page.run('weeklyOwnerFilter'), ['ALL']);
  assert.equal(risk(page).length, 7);
  // The Ask AI / MCP tools still answer by owner for one call, and leave the page on All.
  assert.equal(page.run("aiRunTool('get_overview',{owner:'Ana Diaz'}).order_health.at_risk.lines"), 1);
  assert.deepEqual(page.run('weeklyOwnerFilter'), ['ALL']);
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
});

test('an older shared snapshot saved with an owner filter opens on All owners without errors', async () => {
  const saver = await withStatuses();
  let payload = '';
  Object.assign(saver.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await saver.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.deepEqual(data.weeklyOwnerFilter, ['ALL']);
  for (const pick of [['Ana Diaz'], ['Jamie Cole', 'Ana Diaz'], 'Ana Diaz', null]) {
    const viewer = loadPage();
    viewer.els['embedded-snapshot-data'].dataset.encoding = 'json';
    viewer.els['embedded-snapshot-data'].textContent = JSON.stringify({ ...data, weeklyOwnerFilter: pick });
    await viewer.run('loadEmbeddedSnapshot()');
    assert.deepEqual(viewer.run('weeklyOwnerFilter'), ['ALL'], JSON.stringify(pick));
    assert.equal(viewer.run('orderHealthData(currentMetrics()).lateTileRows.length'), 7);
    assert.doesNotMatch(html(viewer), /All Owners|weekly-owner-select/);
    assert.equal(viewer.errors.length, 0, viewer.errors.join('\n'));
  }
});

// --- At risk by override -------------------------------------------------------------------------------
test('six tiles in the At risk card count its at-risk orders with each override; lines and open value in full in the tip; zero muted', async () => {
  const page = await withStatuses();
  assert.deepEqual(page.run('OH_OVERRIDE_TILES.map(t=>[t.label,t.status])'), TILES);
  assert.ok(TILES.every(([, s]) => page.run(`OVERRIDE_OPTIONS.includes(${JSON.stringify(s)})`)), 'statuses are dropdown options');
  // 306 has Shipping Delay but is not at risk; 307 is at risk with no override.
  assert.deepEqual(tiles(page), [['Shipping Delay', 2, 12000], ['QC Delay', 1, 8000], ['R&D Hold', 0, 0], ['Supplier Delay', 1, 6000], ['Supply Chain Delay', 1, 4000], ['Wait on Prod', 1, 5000]]);
  // Each tile is a subset of the At risk card's lines.
  assert.equal(page.run('(()=>{const r=new Set(ohAtRiskData(currentMetrics()).risk);return ohReasonTileData(currentMetrics()).every(t=>t.rows.every(x=>r.has(x)))})()'), true);
  const m = html(page);
  // 2v6: in the At risk card, after its hero, its states and the most affected warehouse: "By override · All warehouses".
  const card = m.match(/<section class="dz-card dz-span-3 ohl-card[^"]*"[^>]*><div class="dz-card-head"><h2 class="dz-title sm"[^>]*>At risk<\/h2>[\s\S]*?<\/section>/)[0];
  const hero = card.indexOf('data-focus-key="tile-late"');
  const grid = card.indexOf('<div class="ohl-tiles"');
  assert.ok(hero > 0 && card.indexOf('data-focus-key="oh-top-wh"') > hero && grid > card.indexOf('data-focus-key="oh-top-wh"'));
  assert.match(card, /<span class="ohl-sec-title">By override · All warehouses<\/span><\/div>\s*<div class="ohl-tiles" role="group" aria-label="At-risk orders by override">/);
  const b = tileButtons(page);
  assert.equal(b.length, 6);
  // Each tile: its name and its at-risk orders; the tip has the orders, the lines and the value in full.
  assert.equal(b[0], '<button type="button" class="ohl-tile" data-focus-key="ovr-tile-shipping-delay" onclick="setWeeklyOverrideTile(&quot;Shipping Delay&quot;)" aria-pressed="false" data-tip="Shipping Delay\n• 2 orders, 2 lines\n• $12,000 at risk\nClick to list them."><span class="ohl-tile-l">Shipping Delay</span><span class="ohl-tile-n">2</span></button>');
  assert.match(b[2], /class="ohl-tile zero"[^>]*data-tip="R&amp;D Hold\n• 0 orders, 0 lines\n• \$0 at risk\n[^"]*"><span class="ohl-tile-l">R&amp;D Hold<\/span><span class="ohl-tile-n">0<\/span>/);
  assert.match(b[1], /data-tip="QC Delay\n• 1 order, 1 line\n• \$8,000 at risk\n[^"]*"><span class="ohl-tile-l">QC Delay<\/span><span class="ohl-tile-n">1<\/span>/);
  // The owner's names everywhere on screen; the stored status stays the filter value.
  assert.match(b[3], /onclick="setWeeklyOverrideTile\(&quot;Supplier Late&quot;\)"[^>]*data-tip="Supplier Delay\n• 1 order, 1 line\n• \$6,000 at risk[^"]*"><span class="ohl-tile-l">Supplier Delay</);
  assert.match(b[5], /onclick="setWeeklyOverrideTile\(&quot;Waiting on Production&quot;\)"[^>]*data-tip="Wait on Prod\n• 1 order, 1 line\n• \$5,000 at risk/);
  assert.doesNotMatch(b.join(''), /Supplier Late<|Supply Chain<|Waiting on Production<|override “/);
  assert.ok(b.every((x) => /aria-pressed="false"/.test(x) && /data-tip="[^"]{20,}"/.test(x)));
  // The most affected warehouse lists the same overrides on its own lines (Lacombe; Supply Chain is a DSM line).
  const bars = [...card.matchAll(/<button type="button" class="dz-barrow ohl-bar130"[^>]*data-focus-key="ovr-([a-z-]+)"[^>]*>[\s\S]*?<span class="dz-barrow-name">([^<]+)<\/span>/g)].map((x) => [x[1], x[2]]);
  assert.deepEqual(bars, [['shipping-delay', 'Shipping Delay'], ['qc-delay', 'QC Delay'], ['supplier-late', 'Supplier Delay'], ['waiting-on-production', 'Wait on Prod']]);
});

test('the tiles follow the At Risk card: page filters, chart filters, overrides that end the risk, an export\'s own status', async () => {
  const page = await withStatuses();
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.deepEqual(tiles(page).map((t) => t[1]), [1, 0, 0, 0, 1, 0]);
  page.run("setWeeklyWarehouseFilter(['ALL']);setWeeklyCauseFilter('us')");
  // Shipping Delay is a Them status, so with the Us filter on its lines leave the At Risk card and the tile.
  assert.deepEqual(tiles(page).map((t) => t[1]), [0, 1, 0, 1, 1, 1]);
  page.run("clearWeeklyDrill('')");
  // Not At Risk ends the risk; Urgent puts a line in At Risk, but its status is then Urgent.
  setStatus(page, '305', 'Not At Risk');
  setStatus(page, '306', 'Urgent');
  assert.deepEqual(tiles(page).map((t) => t[1]), [2, 1, 0, 1, 1, 0]);
  // A status in the export's own OverrideStatus column counts too, whatever its case.
  const headers = [...SAP_HEADERS, 'OverrideStatus'];
  const rows = ROWS.slice(0, 8).map((r, i) => ({ ...r, '#': String(i + 1), OverrideStatus: { 0: 'shipping delay', 1: 'R&D HOLD', 6: 'QC Delay' }[i] || '' }));
  const fromFile = await loaded(ROWS, {}, [{ name: 'kpi.xls', bytes: utf16Tsv(headers, rows) }]);
  assert.deepEqual(tiles(fromFile), [['Shipping Delay', 1, 10000], ['QC Delay', 0, 0], ['R&D Hold', 1, 2000], ['Supplier Delay', 0, 0], ['Supply Chain Delay', 0, 0], ['Wait on Prod', 0, 0]]);
  assert.equal(fromFile.errors.length, 0, fromFile.errors.join('\n'));
});

test('a tile click filters the page and the linked lines to that override; a chip, a second click or Reset clears it', async () => {
  const page = await withStatuses();
  page.run("setWeeklyTileFilter('nocommit')");
  page.run("setWeeklyOverrideTile('Shipping Delay')");
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyReasonMain')], ['Shipping Delay', false]);
  assert.deepEqual(risk(page), ['300', '301']);
  // A Leading card stays picked; with No commit date picked the list is empty, At Risk lists the two lines.
  assert.equal(page.run('weeklyTileFilter'), 'nocommit');
  assert.deepEqual(linkedDocs(page), []);
  page.run("setWeeklyTileFilter('late')");
  assert.deepEqual(linkedDocs(page), ['300', '301']);
  // The Lines card's chip: the lines and their value.
  assert.match(html(page), /<h2 class="dz-title"[^>]*>Lines<\/h2><span class="dz-chip red">2 lines · \$12,000<\/span>/);
  // The picked tile is pressed (its tip drops "Click to list them."); the others keep their counts (the tiles ignore
  // their own filter).
  const b = tileButtons(page);
  assert.match(b[0], /class="ohl-tile sel"[^>]*aria-pressed="true" data-tip="Shipping Delay\n• 2 orders, 2 lines\n• \$12,000 at risk">/);
  assert.deepEqual(tiles(page).map((t) => t[1]), [2, 1, 0, 1, 1, 1]);
  // The At risk card shows the filtered numbers.
  assert.match(html(page), /<span class="dz-big sm ohl-crit">2 orders<\/span><span class="dz-sub">\$12,000 · 2 lines<\/span>/);
  // A chip names the filter under the filter row (2v4: a reason that has a tile shows as Reason, with the tile's name).
  const chip = html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</);
  assert.equal(chip[1].trim(), 'Reason: Shipping Delay');
  assert.match(chip[0], /data-tip="[^"]{20,}"/);
  assert.ok(html(page).indexOf('class="oh-drillbar"') > html(page).indexOf('<div class="dz-filterrow">'));
  assert.ok(html(page).indexOf('class="oh-drillbar"') < html(page).indexOf('id="oh-panel-leading"'));
  // A different tile replaces it; the same tile again clears it.
  page.run("setWeeklyOverrideTile('Supplier Late')");
  assert.deepEqual(risk(page), ['303']);
  page.run("setWeeklyOverrideTile('Supplier Late')");
  assert.equal(page.run('weeklyReasonFilter'), '');
  assert.equal(risk(page).length, 7);
  // The chip clears it, so does Reset; anything that is not a tile is ignored.
  page.run("setWeeklyOverrideTile('QC Delay');clearWeeklyDrill('reason')");
  assert.equal(page.run('weeklyReasonFilter'), '');
  page.run("setWeeklyOverrideTile('Waiting on Production');resetWeeklyFilters()");
  assert.equal(page.run('weeklyReasonFilter'), '');
  page.run("setWeeklyOverrideTile('Hold')");
  assert.equal(page.run('weeklyReasonFilter'), '');
  // The Top reasons bar of the same status is the same filter (one chip, one state).
  page.run("setWeeklyReasonFilter('QC Delay')");
  assert.match(tileButtons(page)[1], /aria-pressed="true"/);
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
});

test('a tile filter travels in a shared snapshot, and Search finds the lines by override', async () => {
  const saver = await withStatuses();
  saver.run("setWeeklyOverrideTile('Shipping Delay')");
  let payload = '';
  Object.assign(saver.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await saver.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.deepEqual([data.weeklyReasonFilter, data.weeklyReasonMain], ['Shipping Delay', false]);
  const viewer = loadPage();
  viewer.els['embedded-snapshot-data'].dataset.encoding = 'json';
  viewer.els['embedded-snapshot-data'].textContent = payload;
  await viewer.run('loadEmbeddedSnapshot()');
  assert.deepEqual(risk(viewer), ['300', '301']);
  assert.match(tileButtons(viewer)[0], /aria-pressed="true"/);
  assert.match(html(viewer), />Reason: Shipping Delay </);
  // Search: the override is one of a line's reasons, at risk or not.
  const found = (q) => saver.run(`(searchQuery=${JSON.stringify(q)},globalSearchResults(currentMetrics()).rows.map(x=>x.r.documentNumber).sort())`);
  assert.deepEqual(found('shipping delay'), ['300', '301', '306']);
  assert.deepEqual(found('waiting on production'), ['305']);
  // The owner's name for a status finds the same lines as the stored one.
  assert.deepEqual(found('wait on prod'), ['305']);
  assert.deepEqual(found('supplier delay'), ['303']);
});

test('override names show in the owner\'s words everywhere; stored values, saved notes, filters and the cause rules keep the old ones', async () => {
  const page = await withStatuses();
  assert.deepEqual(page.run("['Supplier Late','supply chain',' Waiting on Production ','R&D Hold','QC Delay','Shipping Delay','Waiting on PO','','Hold'].map(overrideLabel)"),
    ['Supplier Delay', 'Supply Chain Delay', 'Wait on Prod', 'R&D Hold', 'QC Delay', 'Shipping Delay', 'Waiting on PO', '', 'Hold']);
  assert.equal(page.run("overrideLabel('constructor')"), 'constructor', 'no inherited object keys');
  // Stored values and the dropdown values are unchanged; only the option text is the owner's.
  assert.ok(['Supplier Late', 'Supply Chain', 'Waiting on Production'].every((v) => page.run(`OVERRIDE_OPTIONS.includes(${JSON.stringify(v)})`)));
  const editor = page.run(`renderOverrideSelect(${row('303')})`);
  assert.match(editor, /<option value="Supplier Late" selected>Supplier Delay<\/option>/);
  assert.match(editor, /<option value="Supply Chain">Supply Chain Delay<\/option>/);
  assert.match(editor, /<option value="Waiting on Production">Wait on Prod<\/option>/);
  assert.match(editor, /<option value="R&amp;D Hold">R&amp;D Hold<\/option>/);
  assert.equal(page.run(`rowOverrides[${JSON.stringify(key(page, '303'))}].status`), 'Supplier Late');
  assert.equal(page.run(`${row('303')}.overrideStatus`), 'Supplier Late');
  assert.equal(page.run("causeOfLabel('Supplier Late')"), 'us');
  page.run('selectAllLinked(true)');
  const bulk = html(page).match(/<select id="linked-bulk-status"[\s\S]*?<\/select>/)[0];
  assert.match(bulk, /<option value="Waiting on Production">Wait on Prod<\/option>/);
  assert.match(bulk, /<option value="Supply Chain">Supply Chain Delay<\/option>/);
  page.run('selectAllLinked(false)');
  // Top reasons rows (option S; on CM - DSM, where Supply Chain is in a set shown): the name shown is the owner's, in
  // the row and its tip; the filter value is the stored one.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  const bar = html(page).match(/<button type="button" class="ohu-name[^"]*" data-focus-key="oh-reason-Supply Chain"[\s\S]*?<\/button>/)[0];
  assert.match(bar, /onclick="setWeeklyReasonFilter\(&quot;Supply Chain&quot;\)" data-tip="Supply Chain Delay\n• 1 line, 1 order with this reason\n• \$4,000 at risk\nClick to list every line with this reason\.\"><span class="ohu-nm">Supply Chain Delay<\/span>/);
  assert.doesNotMatch(bar, />Supply Chain</);
  page.run("setWeeklyWarehouseFilter(['ALL'])");
  // The chip, the line's status cell (first reason, other reasons) and the note button tip.
  page.run("setWeeklyReasonFilter('Waiting on Production')");
  assert.equal(page.run('weeklyReasonFilter'), 'Waiting on Production');
  const chip = html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</)[1].trim();
  assert.equal(chip, 'Reason: Wait on Prod');
  page.run("clearWeeklyDrill('');setWeeklyMainReasonFilter('Supply Chain')");
  assert.equal(html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</)[1].trim(), 'Main reason: Supply Chain Delay');
  page.run("clearWeeklyDrill('')");
  // 2v4: the line shows its reasons only (no Us / Them words; the cause stays in the data and the colour class).
  assert.match(page.run(`ohLineWhy(${row('305')})`), /^<span class="oh-why cause-text-us" data-tip="Reasons: Past due · No reschedule, Wait on Prod\.">Past due · No reschedule<\/span><span class="timing oh-why-more">Wait on Prod<\/span>$/);
  assert.match(page.run(`ohLineWhy(${row('303')})`), /Supplier Delay/);
  assert.doesNotMatch(page.run(`ohLineWhy(${row('303')})`), />[^<]*Supplier Late/);
  assert.match(page.run(`renderNoteButton(${row('304')})`), /data-tip="Override: Supply Chain Delay\./);
  // On paper the override prints inside the Status cell (renderPrintOverride), in the owner's words.
  assert.match(page.run(`renderPrintOverride(${row('304')})`), /<span class="print-ovr">Supply Chain Delay/);
  // The Big picture's reason boxes (a line's first reason, usually a SAP signal): an override box is labelled in the
  // owner's words while its key, and so its filter, stays the stored value.
  assert.match(HTML, /\{key:sankeyLineReason,label:overrideLabel,top:6,other:'Other reasons',/);
  const box = page.run("sankeyBuild([{k:'Waiting on Production'}],{value:()=>1,cols:[{key:x=>x.k,label:overrideLabel,action:ms=>({type:'reason',value:ms[0]})},{key:()=>'us'}]}).nodes.find(n=>n.level===0)");
  assert.deepEqual([box.key, box.label, box.action.value], ['Waiting on Production', 'Wait on Prod', 'Waiting on Production']);
  // Ask AI / MCP: a line's override and reasons, and the top reasons, in the owner's words.
  const lines = page.run("aiRunTool('search_lines',{scope:'at_risk',query:'wait on prod'}).rows");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].override, 'Wait on Prod');
  assert.ok(lines[0].reasons.includes('Wait on Prod') && !lines[0].reasons.includes('Waiting on Production'));
  const top = page.run("aiRunTool('get_overview',{}).order_health.leading.top_reasons.map(r=>r.reason)");
  assert.ok(top.includes('Supplier Delay') && !top.includes('Supplier Late'), top.join(', '));
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
});

// --- Page layout ---------------------------------------------------------------------------------------
// 2v6: the views are bento grids of cards (dzCard): each card is named by its title, or by its aria-label when the
// card has no title (Status and top reasons, 2v6.9; Lagging's Trend). Lagging has no named groups any more: its
// Metrics and Shipments groups became four cards (Version 1, the owner's pick).
const cardNames = (m) => [...m.matchAll(/<section class="dz-card[^"]*"([^>]*)>(?:<div class="dz-card-head[^"]*">\s*(?:<div class="ohl-lines-title">)?<h2 class="dz-title[^"]*"[^>]*>([^<]+)<\/h2>)?/g)]
  .map((x) => x[2] || (/aria-label="([^"]+)"/.exec(x[1]) || [])[1] || '(no name)');
const groups = (m) => [...m.matchAll(/<section class="pg-group[^"]*"(?: id="[^"]*")? aria-labelledby="([^"]+)"[^>]*><div class="pg-group-head"><h2 class="pg-group-title" id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)]
  .map((x) => { assert.equal(x[1], x[2], 'each group is labelled by its own title'); return x[3]; });
const panel = (m, view) => m.match(new RegExp(`<div class="oh-panel" role="tabpanel" id="oh-panel-${view}"[^>]*>[\\s\\S]*?(?=<div class="oh-panel" role="tabpanel"|$)`))[0];

test('Sales Order Health reads as cards in a set order: Leading ends with its Lines card; Lagging is Monthly, Quarterly, then Trend, Month by month, By warehouse and Booked vs shipped', async () => {
  const page = await withStatuses();
  const lead = panel(html(page), 'leading');
  // 2v6.9: At risk beside the ship target over Status & top reasons; then due weeks and customers; Monthly's forward
  // sections; the Lines card last (the supply source card shows with a supply / demand snapshot, none here).
  assert.deepEqual(cardNames(lead), ['At risk', 'September ship target', 'Status and top reasons', 'Open lines by due week', 'Customers at risk',
    'Customers at risk by supply source', 'Date changes', 'Open orders by delivery month', 'Items not shipped yet', 'Lines']);
  assert.match(lead, /<div class="ohl-col dz-span-3">\s*<section class="dz-card dz-fade ohl-ship"[\s\S]*?<\/section>\s*<section class="dz-card ohl-card ohl-status-card/);
  assert.deepEqual(groups(lead), []);
  // No Hide link: the tabs do that job.
  assert.doesNotMatch(html(page), /toggle-leading|toggle-lagging|toggleLaggingIndicators|>Hide</);
  // Lines: its title, a chip with the picked card's lines and value, the search box and the sort.
  assert.match(lead, /<section class="dz-card dz-span-6 ohl-card ohl-lines-card" id="linked-lines" aria-label="Lines">/);
  assert.match(lead, /<h2 class="dz-title" data-tip="The lines behind your pick\. Tick lines to set an override\.">Lines<\/h2><span class="dz-chip red">7 lines · \$35,700<\/span>/);
  // Lagging.
  page.run("setWeeklyView('lagging')");
  const lag = panel(html(page), 'lagging');
  // Version 1 (owner's pick): the period cards, then one grid of four cards; no page groups (Metrics and Shipments,
  // with their tiles, charts, month cards and shipped-to-date strip, are gone).
  assert.deepEqual(cardNames(lag), ['Monthly', 'Quarterly', 'Trend', 'Month by month', 'By warehouse', 'Booked vs shipped']);
  assert.deepEqual(groups(lag), []);
  assert.doesNotMatch(lag, /class="pg-group|id="ohg-shipments"|class="mwm-kpi[ "]|month-card|month-spot|mini-strip/);
  // Trend (the card setTab('metrics') scrolls to) and Month by month run the full width; the last two share a row.
  assert.deepEqual([...lag.matchAll(/<section class="dz-card (dz-span-\d)/g)].map((x) => x[1]), ['dz-span-3', 'dz-span-3', 'dz-span-6', 'dz-span-6', 'dz-span-3', 'dz-span-3']);
  assert.match(lag, /<\/section><\/div><div class="dz-grid ohg-detail"><section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend"><div class="ohgt-head"><h2 class="dz-title"[^>]*>Trend<\/h2><div class="ohgt-chips" role="group" aria-label="Metric">/);
  // The cards carry this export's numbers. Its four deliveries all shipped in August (one early, one on time, one 2
  // and one 5 days late: 50% on time, 3.5 days late on average, 2 late orders, $3,000); nothing has shipped in
  // September, so August is the newest month with orders and By warehouse (this month) is empty.
  assert.deepEqual(page.run('mwmMetricsData(currentMetrics()).months.slice(10).map(r=>[r.orders,r.otd,r.perfect,r.days,r.lateOrders])'), [[4, 50, 0, 3.5, 2], [0, null, null, null, 0]]);
  assert.match(lag, /<h3 data-tip="Shipped by the original date\.">On-time delivery · August<\/h3>\s*<div class="ohgt-now"><span>50%<\/span><\/div>/);
  assert.match(lag, /Why orders were late · August<\/h3><ul class="mwm-causes"><li data-tip="Past due · No reschedule: 2 orders of 2 late in August\."><span class="mwm-cause-l">Past due · No reschedule<\/span><b class="mwm-cause-v">2<\/b><\/li><\/ul>/);
  assert.match(lag, /<b>September so far:<\/b> 0 orders · \$0 shipped · year to date \$3K<\/p>/);
  assert.match(lag, /<td class="k">Sep 2026 <span class="mwm-todate">to date<\/span><\/td><td class="num">0<\/td><td class="num">\$0<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">0<\/td><\/tr><tr data-tip="August 2026\n• 4 orders shipped, \$3,000 on 4 delivery lines\n• 50% on time of 4 delivery lines scored\n• 2 orders late"><td class="k">Aug 2026<\/td><td class="num">4<\/td><td class="num">\$3K<\/td><td class="num"><span class="dz-chip red">50%<\/span><\/td><td class="num">0%<\/td><td class="num">3\.5<\/td><td class="num late">2<\/td><\/tr>/);
  assert.match(lag, /By warehouse<\/h2><span class="dz-meta">September · 0 orders<\/span><\/div><p class="empty-note">No deliveries in this range\.<\/p>/);
  // Booked vs shipped: August's seven open lines are the $35,700 of the Lines chip above; $3,000 of $38,700 shipped.
  assert.deepEqual([...lag.slice(lag.indexOf('>Booked vs shipped</h2>')).matchAll(/<td class="k">([^<]+)<\/td><td class="num">([^<]+)<\/td><td class="num">([^<]+)<\/td><td class="num(?: late)?">([^<]+)<\/td>/g)].map((x) => x.slice(1)),
    [['Aug 2026', '8%', '$35,700', '2'], ['Oct 2026', '0%', '$1,500', '0']]);
  assert.doesNotMatch(lag, /id="linked-lines"/);
  // The old Hide calls no longer hide anything.
  page.run("setWeeklyView('leading');toggleLeadingIndicators();toggleLaggingIndicators()");
  assert.deepEqual(page.run('[weeklyLeadingCollapsed,weeklyLaggingCollapsed]'), [false, false]);
  assert.equal(cardNames(panel(html(page), 'leading')).length, 10);
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
});

test('open order states always show in the Status card (no Show more); the Metrics detail sits behind Show more (kept across redraws, open in print); the group CSS is the contract', async () => {
  const page = await withStatuses();
  // Status: every open order in one of the five states, as rows that list their lines; on screen and on paper.
  const states = () => [...html(page).matchAll(/<button type="button" class="ohs2-row[^"]*" data-focus-key="status-st-([a-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(states(), ['ontrack', 'duethisweek', 'rescheduled', 'pastdue', 'nocommit']);
  assert.doesNotMatch(html(page), /<details class="oh-more"/);
  page.run('printMode=true;renderResults()');
  assert.deepEqual(states(), ['ontrack', 'duethisweek', 'rescheduled', 'pastdue', 'nocommit']);
  page.run('printMode=false;renderResults()');
  // Lagging's Metrics: no Show more (owner: order quality, open value by due month and lines to act on are gone).
  page.run("setWeeklyView('lagging')");
  assert.doesNotMatch(html(page), /data-more="mwm-metrics"|>Order quality<|>Lines to act on</);
  page.run('printMode=false');
  assert.match(HTML, /@media print\{\.mwm-more>summary\{display:none\}\}/);
  // The shared page-group CSS, byte for byte.
  for (const rule of [
    ':root{--space-group:40px;--space-in:20px}',
    '.pg-group+.pg-group{margin-top:var(--space-group)}',
    '.pg-group>*+*{margin-top:var(--space-in)}',
    '.pg-group-head{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}',
    '.pg-group-title{margin:0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--gray-500)}',
    '@media (max-width:640px){:root{--space-group:28px;--space-in:14px}}',
    '@media print{:root{--space-group:.15in;--space-in:.08in}}',
  ]) assert.ok(HTML.includes(rule), rule);
  // The six override tiles fill the At risk card's width, 140px or more each (2v9: they fit mid widths).
  assert.match(HTML, /\.ohl-tiles\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(140px,1fr\)\);/);
});

run();
