// 2v2 layout (Order Health): the Leading / Lagging switch with its headline numbers, the page groups, the owner filter
// gone, and the six At risk by override tiles under the At Risk card.
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
const tiles = (page) => page.run('ohOverrideTileData(currentMetrics()).map(t=>[t.label,t.lines,Math.round(t.value)])');
const tileButtons = (page) => [...html(page).matchAll(/<button type="button" class="ovr-tile[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
async function withStatuses() {
  const page = await loaded();
  for (const [doc, status] of Object.entries(STATUSES)) setStatus(page, doc, status);
  return page;
}

// --- The switch ----------------------------------------------------------------------------------------
test('Leading / Lagging is a full-width switch right under the page head, each half with its headline number', async () => {
  const page = await withStatuses();
  const m = html(page);
  // First thing in the page content: nothing but the page head before it.
  const before = m.slice(0, m.indexOf('<div class="oh-tabbar'));
  assert.ok(before.includes('class="page-head'));
  assert.doesNotMatch(before, /filter-bar|pg-group|hint-card|class="card/);
  assert.ok(m.indexOf('<div class="oh-tabbar') < m.indexOf('class="filter-bar'));
  const oh = page.run('(()=>{const o=orderHealthData(currentMetrics());return {amt:o.lateAmt,otd:o.otd3Mo.rate,scored:o.otd3Mo.scored.length}})()');
  assert.deepEqual(oh, { amt: 35700, otd: 50, scored: 4 });
  const tab = (id) => m.match(new RegExp(`<button type="button" role="tab" class="oh-tab" id="oh-tab-${id}"[^>]*>[\\s\\S]*?</button>`))[0];
  // Leading: the at-risk open value (short on the switch, in full in the tip); Lagging: OTD over the last 3 months.
  assert.match(tab('leading'), /<span class="oh-tab-title">Leading<\/span>/);
  assert.match(tab('leading'), new RegExp(`<span class="oh-tab-num crit">${page.run('moneyShort(35700)').replace('$', '\\$')}<small>at risk</small></span>`));
  assert.match(tab('leading'), /data-tip="\$35,700 at risk on 7 orders \(7 lines\); arrow keys switch tabs\."/);
  assert.match(tab('lagging'), /<span class="oh-tab-title">Lagging<\/span>/);
  assert.match(tab('lagging'), /<span class="oh-tab-num crit">50%<small>OTD · 3 mo<\/small><\/span>/);
  assert.match(tab('lagging'), /data-tip="On-time delivery, last 3 months: 50% \(2 of 4 deliveries\); arrow keys switch tabs\."/);
  // The numbers follow the page filters, like the cards.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.equal(page.run('orderHealthData(currentMetrics()).lateAmt'), 14000);
  assert.match(html(page), new RegExp(`<span class="oh-tab-num crit">${page.run('moneyShort(14000)').replace('$', '\\$')}<small>at risk</small>`));
  assert.match(html(page), /<span class="oh-tab-num neutral">—<small>OTD · 3 mo<\/small>/, 'no deliveries to score: a dash, not a red 0%');
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
  // Nothing at risk reads green.
  const calm = await loaded([ROWS[6], ...ROWS.slice(8)]);
  assert.match(html(calm), /<span class="oh-tab-num good">\$0<small>at risk<\/small><\/span>/);
});

// WCAG contrast of two #rrggbb colours.
function contrast(a, b) {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const token = (name) => HTML.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))[1];

test('the other Leading / Lagging half is marked by background and weight, never by opacity; its number keeps 4.5:1', () => {
  assert.doesNotMatch(HTML, /\.oh-tab[^{]*\{[^}]*opacity/, 'no opacity on the switch');
  assert.match(HTML, /\.oh-tab\[aria-selected="true"\]\{background:#fff;/, 'the active half is the white raised card');
  assert.match(HTML, /\.oh-tab\[aria-selected="false"\] \.oh-tab-num\{color:var\(--gray-600\);font-weight:500\}/);
  // On the zinc track (--gray-100): the number, its unit and the sub-line.
  assert.ok(contrast(token('gray-600'), token('gray-100')) >= 4.5);
  assert.ok(contrast(token('gray-500'), token('gray-100')) >= 4.5, 'unit and sub-line (small text)');
});

test('the Big picture switch is visible when off: its track is --gray-500 (3:1 or better on the button)', () => {
  assert.match(HTML, /\.bp-track\{[^}]*background:var\(--gray-500\)/);
  assert.match(HTML, /\.bp-switch:hover \.bp-track\{background:var\(--gray-600\)\}/);
  assert.ok(contrast(token('gray-500'), '#ffffff') >= 3);
  assert.ok(contrast(token('gray-500'), token('gray-100')) >= 3, 'also on a hovered button');
});

test('Why lines are at risk opens with Top reasons (the bars), not a second count of open orders', async () => {
  const page = await withStatuses();
  const m = html(page);
  const why = m.slice(m.indexOf('>Why lines are at risk</h2>'), m.indexOf('<details class="oh-more"'));
  const first = why.match(/<section class="card list-card oh-card" aria-labelledby="([^"]+)">[\s\S]*?<\/section>/);
  assert.equal(first[1], 'oh-reasons-title');
  assert.match(first[0], /<h2 id="oh-reasons-title" data-tip="[^"]{20,}">Top reasons<\/h2><span class="section-sub">by at-risk value<\/span>/);
  assert.doesNotMatch(first[0], /kpi-value|Open orders|\d+ orders ·/, 'the open order count is in Coming due only');
  assert.match(first[0], /<div class="oh-bars" role="group" aria-label="Top at-risk reasons by open value"><button type="button" class="oh-bar-row/);
  assert.doesNotMatch(m, />Open orders</);
});

test('the switch keeps the tablist: arrow keys, Home / End, the view in snapshots and reset with a new report', async () => {
  const page = await withStatuses();
  assert.match(html(page), /<div class="oh-tabs" role="tablist" aria-label="Order Health indicators">/);
  assert.match(html(page), /role="tab" class="oh-tab" id="oh-tab-leading" aria-selected="true" aria-controls="oh-panel-leading" tabindex="0" onclick="setWeeklyView\('leading'\)" onkeydown="ohTabKey\(event\)"/);
  page.run("ohTabKey({key:'ArrowLeft',preventDefault(){}})");
  assert.equal(page.run('weeklyView'), 'lagging', 'left arrow wraps to the last tab');
  assert.match(html(page), /id="oh-tab-lagging" aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html(page), /id="oh-tab-leading" aria-selected="false"[^>]*tabindex="-1"/);
  assert.equal(page.run('ohSnapshotView().weeklyView'), 'lagging');
  page.run("ohTabKey({key:'Home'})");
  assert.equal(page.run('weeklyView'), 'leading');
  page.run("ohTabKey({key:'End'})");
  assert.equal(page.run('weeklyView'), 'lagging');
  page.run("ohRestoreView({weeklyView:'leading'})");
  assert.equal(page.run('weeklyView'), 'leading');
  page.run("setWeeklyView('lagging')");
  await page.ctx.handleFiles([{ name: 'new.xls', bytes: sapExport(ROWS) }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.run('weeklyView'), 'leading');
});

test('the Big picture call sits after the filters and their chips, once (filters above the chart, the chart above every card)', async () => {
  // Source: the one weekly call follows the chart-filter chips (ohRenderDrillBar), which follow the filter bar.
  assert.match(HTML, /html\+=ohRenderDrillBar\(\);[^\n]*\n\s*html\+=renderBigPicture\('weekly',m\);/);
  assert.equal(HTML.split("renderBigPicture('weekly'").length - 1, 1);
  const page = await withStatuses();
  page.run("sankeyOpen={weekly:true};setWeeklyReasonFilter('Shipping Delay')");
  const m = html(page);
  const card = m.indexOf('id="sankey-weekly"');
  assert.ok(card > m.indexOf('<div class="oh-tabbar'), 'after the switch');
  assert.ok(card > m.indexOf('class="filter-bar') && card > m.indexOf('<div class="print-only">Filters: '), 'after the filter bar and its printed Filters: line');
  assert.ok(m.indexOf('class="oh-drillbar"') > 0 && card > m.indexOf('class="oh-drillbar"'), 'after the Filtered by chips');
  assert.ok(card < m.indexOf('class="pg-group') && card < m.indexOf('class="card kpi'), 'above every group and card');
});

// --- Owner filter --------------------------------------------------------------------------------------
test('the owner filter is gone from the filter bar and the notes; weeklyOwnerFilter stays All', async () => {
  const page = await withStatuses();
  const m = html(page);
  assert.doesNotMatch(m, /weekly-owner-select|All Owners|setWeeklyOwnerFilter/);
  assert.doesNotMatch(m.match(/<div class="filter-bar[\s\S]*?<div class="print-only">Filters: [^<]*<\/div>/)[0], /owner/i);
  assert.equal(page.run('typeof setWeeklyOwnerFilter'), 'undefined');
  assert.equal(page.run('typeof setWeeklyOwnerPreset'), 'undefined');
  assert.deepEqual(page.run('weeklyOwnerFilter'), ['ALL']);
  // Owners still rank in Top offenders, as plain rows (no filter behind them).
  page.run("setWeeklyOffenderView('owners')");
  // A tab stop of its own (no click), so keyboard users reach its tip.
  assert.match(html(page), /<div class="waffle-row static" tabindex="0" data-focus-key="offrow-Ana Diaz" data-tip="Ana Diaz: \$10,000 at-risk value on 1 line( \([^)"]+\))?\."/);
  assert.match(HTML, /\.waffle-row\.static:focus-visible\{outline-offset:-2px\}/);
  assert.doesNotMatch(html(page), /data-view="owners"/);
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
test('six tiles under the At Risk card count its open lines with each override; open value in full in the tip; zero muted', async () => {
  const page = await withStatuses();
  assert.deepEqual(page.run('OH_OVERRIDE_TILES.map(t=>[t.label,t.status])'), TILES);
  assert.ok(TILES.every(([, s]) => page.run(`OVERRIDE_OPTIONS.includes(${JSON.stringify(s)})`)), 'statuses are dropdown options');
  // 306 has Shipping Delay but is not at risk; 307 is at risk with no override.
  assert.deepEqual(tiles(page), [['Shipping Delay', 2, 12000], ['QC Delay', 1, 8000], ['R&D Hold', 0, 0], ['Supplier Delay', 1, 6000], ['Supply Chain Delay', 1, 4000], ['Wait on Prod', 1, 5000]]);
  // Each tile is a subset of the At Risk card's lines.
  assert.equal(page.run('(()=>{const r=new Set(orderHealthData(currentMetrics()).lateTileRows);return ohOverrideTileData(currentMetrics()).every(t=>t.rows.every(x=>r.has(x)))})()'), true);
  const m = html(page);
  // Under the At Risk card, inside the At risk now group.
  const hero = m.indexOf('data-focus-key="tile-late"');
  const grid = m.indexOf('class="ovr-grid"');
  assert.ok(hero > 0 && grid > hero && grid < m.indexOf('data-focus-key="tile-nocommit"'));
  assert.ok(m.indexOf('>At risk now</h2>') < hero);
  const b = tileButtons(page);
  assert.equal(b.length, 6);
  // Each tile: its name, then lines with their unit and the open value short (as the Coming due cells); the tip has
  // the value in full.
  assert.match(b[0], /^<button type="button" class="ovr-tile" data-focus-key="ovr-shipping-delay" data-status="Shipping Delay" onclick="setWeeklyOverrideTile\(this\.dataset\.status\)" aria-pressed="false" data-tip="Shipping Delay: 2 at-risk lines, \$12,000 open; click to list them\."><span class="ovr-name">Shipping Delay<\/span><span class="ovr-num"><span class="ovr-count">2 lines<\/span><span class="ovr-amt">\$12K<\/span><\/span><\/button>$/);
  assert.match(b[2], /class="ovr-tile zero"[^>]*data-tip="R&amp;D Hold: 0 at-risk lines, \$0 open;[^"]*"><span class="ovr-name">R&amp;D Hold<\/span><span class="ovr-num"><span class="ovr-count">0 lines<\/span><span class="ovr-amt">\$0<\/span>/);
  assert.match(b[1], /<span class="ovr-count">1 line<\/span><span class="ovr-amt">\$8K<\/span>/);
  // The owner's names everywhere on screen; the stored status stays in data-status (the filter value).
  assert.match(b[3], /data-status="Supplier Late"[^>]*data-tip="Supplier Delay: 1 at-risk line, \$6,000 open;[^"]*"><span class="ovr-name">Supplier Delay</);
  assert.match(b[5], /data-status="Waiting on Production"[^>]*data-tip="Wait on Prod: 1 at-risk line, \$5,000 open;/);
  assert.doesNotMatch(b.join(''), /Supplier Late<|Supply Chain<|Waiting on Production<|override “/);
  assert.ok(b.every((x) => /aria-pressed="false"/.test(x) && /data-tip="[^"]{20,}"/.test(x)));
  assert.match(m, /<span class="ovr-head" id="ovr-head">At risk by override<\/span><div class="ovr-grid" role="group" aria-labelledby="ovr-head">/);
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
  page.run("setWeeklyTileFilter('late')");
  assert.deepEqual(linkedDocs(page), ['300', '301']);
  assert.match(html(page), /Lines to act on<\/h2>[\s\S]*?<span class="count-badge bad">At risk · 2 lines · \$12,000<\/span>/);
  // The picked tile is pressed; the others keep their counts (the tiles ignore their own filter).
  const b = tileButtons(page);
  assert.match(b[0], /class="ovr-tile selected"[^>]*aria-pressed="true"[^>]*data-tip="[^"]*; click to show all\."/);
  assert.deepEqual(tiles(page).map((t) => t[1]), [2, 1, 0, 1, 1, 1]);
  // The card and the switch show the filtered numbers.
  assert.match(html(page), /data-count="12000" data-fmt="money">\$12,000</);
  // A chip names the filter under the filter bar.
  const chip = html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</);
  assert.equal(chip[1].trim(), 'Override: Shipping Delay');
  assert.match(chip[0], /data-tip="[^"]{20,}"/);
  assert.ok(html(page).indexOf('class="oh-drillbar"') > html(page).indexOf('class="filter-bar'));
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
  assert.match(html(viewer), />Override: Shipping Delay </);
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
  // Top reasons bars: the name shown is the owner's; the filter value is the stored one.
  const bar = html(page).match(/<button type="button" class="oh-bar-row[^"]*" data-focus-key="oh-reason-Supplier Late" data-reason="Supplier Late"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(bar, /data-tip="Supplier Delay: \$6,000 on 1 at-risk line/);
  assert.match(bar, /<span class="oh-bar-name">Supplier Delay<\/span>/);
  // The chip, the line's status cell (cause · first reason, other reasons) and the note button tip.
  page.run("setWeeklyReasonFilter('Waiting on Production')");
  assert.equal(page.run('weeklyReasonFilter'), 'Waiting on Production');
  const chip = html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</)[1].trim();
  assert.equal(chip, 'Override: Wait on Prod');
  page.run("clearWeeklyDrill('');setWeeklyMainReasonFilter('Supply Chain')");
  assert.equal(html(page).match(/<button type="button" class="chip active oh-chip" data-kind="reason"[^>]*>([^<]*)</)[1].trim(), 'Main reason: Supply Chain Delay');
  page.run("clearWeeklyDrill('')");
  assert.match(page.run(`ohLineWhy(${row('305')})`), /data-tip="Cause: Us \(override Waiting on Production\)\. Reasons: [^"]*Wait on Prod\.[^"]*"/);
  assert.match(page.run(`ohLineWhy(${row('303')})`), /Supplier Delay/);
  assert.doesNotMatch(page.run(`ohLineWhy(${row('303')})`), />[^<]*Supplier Late/);
  assert.match(page.run(`renderNoteButton(${row('304')})`), /data-tip="Override: Supply Chain Delay\./);
  assert.match(page.run(`renderPrintNoteRow(${row('304')},5)`), /<span class="print-note-status">Supply Chain Delay<\/span>/);
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

// --- Page groups ---------------------------------------------------------------------------------------
const groups = (m) => [...m.matchAll(/<section class="pg-group[^"]*"(?: id="[^"]*")? aria-labelledby="([^"]+)"><div class="pg-group-head"><h2 class="pg-group-title" id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)]
  .map((x) => { assert.equal(x[1], x[2], 'each group is labelled by its own title'); return x[3]; });
const visible = (m, view) => m.replace(new RegExp(`<div class="oh-panel" role="tabpanel" id="oh-panel-${view === 'leading' ? 'lagging' : 'leading'}"[^>]*hidden>[\\s\\S]*?(?=<div class="oh-panel"|<section class="pg-group[^"]*" aria-labelledby="oh-g-where")`), '');

test('Order Health reads as a few named groups: Leading, Lagging, then the breakdowns and the lines to act on', async () => {
  const page = await withStatuses();
  assert.deepEqual(groups(visible(html(page), 'leading')), ['At risk now', 'By due date', 'By reason and cause', 'By warehouse and customer', 'Lines to act on']);
  const m = html(page);
  const lead = m.slice(m.indexOf('id="oh-panel-leading"'), m.indexOf('id="oh-panel-lagging"'));
  // By due date: this week, next week, this month and all open in one strip, then the due-week chart.
  const dueGroup = lead.slice(lead.indexOf('>By due date</h2>'), lead.indexOf('>By reason and cause</h2>'));
  assert.deepEqual([...dueGroup.matchAll(/data-focus-key="tile-([a-z]+)"/g)].map((x) => x[1]), ['duethisweek', 'duenextweek', 'duemonth', 'allorders']);
  assert.match(dueGroup, /<div class="mini-strip cols-4">/);
  assert.match(dueGroup, /<h2>What's due next<\/h2>/);
  // At risk now: the At Risk card with its tiles, and No commit date / Rescheduled beside them.
  const riskGroup = lead.slice(lead.indexOf('>At risk now</h2>'), lead.indexOf('>By due date</h2>'));
  assert.deepEqual([...riskGroup.matchAll(/data-focus-key="tile-([a-z]+)"/g)].map((x) => x[1]), ['late', 'nocommit', 'active']);
  // No Hide link: the Leading / Lagging tabs do that job.
  assert.doesNotMatch(riskGroup, /toggle-leading|>Hide</);
  // Lagging.
  page.run("setWeeklyView('lagging')");
  assert.deepEqual(groups(visible(html(page), 'lagging')), ['Delivery performance', 'By warehouse and customer', 'Lines to act on']);
  assert.doesNotMatch(html(page), /toggle-lagging|toggleLaggingIndicators/);
  const lag = html(page).slice(html(page).indexOf('id="oh-panel-lagging"'), html(page).indexOf('aria-labelledby="oh-g-where"'));
  assert.deepEqual([...lag.matchAll(/data-focus-key="tile-([a-z0-9]+)"/g)].map((x) => x[1]), ['otd3mo', 'shippedweek', 'fillrate', 'reschedhit', 'perfect', 'dayslate']);
  // Lines to act on: the group title, its ⓘ and a pill with the picked card, its line count and value (as on Purchase Orders).
  const lines = html(page).slice(html(page).indexOf('aria-labelledby="oh-g-lines"'));
  assert.match(lines, /^aria-labelledby="oh-g-lines"[^>]*><div class="pg-group-head"><h2 class="pg-group-title" id="oh-g-lines">Lines to act on<\/h2><button type="button" class="info-btn print-hide" data-info="oh-linked"[^>]*>[\s\S]*?<\/button><span class="count-badge ">OTD · 3 mo · 4 delivered lines · \$[\d,]+<\/span><\/div>/);
  assert.doesNotMatch(lines, /class="section-title"|Linked lines/);
  assert.match(html(page).match(/<section class="pg-group[^"]*" id="linked-lines"[^>]*>/)[0], /aria-labelledby="oh-g-lines"/);
  // The old Hide calls no longer hide anything.
  page.run("setWeeklyView('leading');toggleLeadingIndicators();toggleLaggingIndicators()");
  assert.deepEqual(page.run('[weeklyLeadingCollapsed,weeklyLaggingCollapsed]'), [false, false]);
  assert.deepEqual(groups(visible(html(page), 'leading')), ['At risk now', 'By due date', 'By reason and cause', 'By warehouse and customer', 'Lines to act on']);
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
});

test('open order states sit behind Show more (kept across redraws and snapshots, open in print); the group CSS is the contract', async () => {
  const page = await withStatuses();
  const more = () => html(page).match(/<details class="oh-more"[^>]*>[\s\S]*?<\/details>/)[0];
  assert.match(more(), /^<details class="oh-more" data-more="oh-states" ontoggle="ohSetMoreOpen\(this\.dataset\.more,this\.open\)"><summary data-focus-key="more-oh-states" data-tip="[^"]{20,}"><span class="oh-more-show">Show more · open order states<\/span><span class="oh-more-less">Show less<\/span><\/summary>/);
  assert.match(more(), /class="mini-strip cols-5 oh-states"/);
  assert.ok(html(page).indexOf('<details class="oh-more"') > html(page).indexOf('>By reason and cause</h2>'));
  page.run("ohSetMoreOpen('oh-states',true);renderResults()");
  assert.match(more(), /^<details class="oh-more" open /);
  assert.equal(page.run("tableMore['more-oh-states']"), true);
  page.run("ohSetMoreOpen('oh-states',false);printMode=true;renderResults()");
  assert.match(more(), /^<details class="oh-more" open /, 'print shows it');
  page.run('printMode=false');
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
  // At most four cards a row on desktop; the six tiles are three a row (two on a phone), the By due date strip four.
  assert.match(HTML, /\.oh-risk\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);/);
  assert.match(HTML, /\.ovr-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/);
  assert.match(HTML, /@media \(max-width:640px\)\{[^}]*\{[^}]*\}[\s\S]*?\.ovr-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(HTML, /@media print\{[\s\S]*?\.ovr-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:\.06in\}\n  \.pg-group \.mini-strip\.cols-4\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
});

run();
