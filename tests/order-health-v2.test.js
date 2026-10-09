// Order Health v2 (1v8): Leading / Lagging tabs, Us / Them cause engine, at-risk reasons, open order states, when
// flagged, chart filters, Lagging perfect order and days late, the $20k waffle, snapshots, Search and the AI tools.
// Run with `node tests/order-health-v2.test.js`. Fixtures are synthetic (harness.js); no SAP data, no network.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPage, upload, sapRow, sapExport, utf16Tsv, createSuite } = require('./harness');
const { test, run } = createSuite();

// Export date 09/03/2026 (a Thursday): this week is Sun Aug 30 - Sat Sep 5.
const open = (doc, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, ...o });
const due = (d) => ({ DueDate: d, LineDueDate: d, HeaderDueDate: d });
const resched = (d, flag = 'Rescheduled Later Than Original Delivery') => ({ LineRescheduleDate: d, RescheduleDate: d, RescheduleFlag: flag });
const closedLine = (doc, o = {}) => open(doc, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', AmountLocal: '0', ...o });
const delivery = (doc, closed, o = {}) => open(doc, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', OrderType: 'Sales Delivery', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, FillStatus: 'Complete', ...o });
const ROWS = [
  open('100', { ...due('08/01/2026'), AmountLocal: '10,000.00', Warehouse: 'CM - DSM' }), // past due, no reschedule
  open('101', { ...due('08/15/2026'), ...resched('11/11/1111', 'No Commit Date'), DueDateRiskFlag: 'No Commit Date', AmountLocal: '8,000.00', CustomerVendorCode: 'AQUHOT', CustomerVendorName: 'Aqua Hot' }),
  open('102', { ...due('08/20/2026'), ...resched('09/20/2026'), AmountLocal: '6,000.00' }), // rescheduled later, commit ahead
  open('103', { ...due('08/05/2026'), ...resched('08/28/2026'), Confirmed: 'N', AmountLocal: '4,000.00', CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta' }), // missed commit
  open('104', { ...due('09/04/2026'), AmountLocal: '3,000.00' }), // due this week
  open('105', { ...due('10/15/2026'), AmountLocal: '2,000.00' }), // on track
  open('106', { ...due('08/10/2026'), AmountLocal: '5,000.00' }), // past due, override Hold
  open('107', { ...due('10/20/2026'), AmountLocal: '1,500.00' }), // override Urgent
  open('108', { ...due('08/12/2026'), AmountLocal: '700.00' }), // override Not At Risk
  // Rescheduled later, as the shipped KPI query flags it: SAP does not say who asked, so its cause is Not set.
  open('109', { ...due('08/25/2026'), ...resched('09/25/2026'), AmountLocal: '2,500.00' }),
  // Closed lines and their deliveries (Lagging): 5 days late, on time, after its commit date, 2 days late.
  closedLine('200', { ...due('08/10/2026'), PerfectOrder: 'Perfect' }), delivery('200', '08/15/2026', { ...due('08/10/2026'), AmountLocal: '900.00', PerfectOrder: 'Not Perfect' }),
  closedLine('201', { ...due('08/12/2026'), PerfectOrder: 'Perfect' }), delivery('201', '08/12/2026', { ...due('08/12/2026'), AmountLocal: '800.00', PerfectOrder: 'Perfect' }),
  closedLine('202', { ...due('08/10/2026'), ...resched('08/20/2026'), PerfectOrder: 'Not Perfect' }), delivery('202', '08/25/2026', { ...due('08/10/2026'), ...resched('08/20/2026'), AmountLocal: '700.00', PerfectOrder: 'Not Perfect' }),
  closedLine('203', { ...due('08/18/2026'), PerfectOrder: 'Perfect' }), delivery('203', '08/20/2026', { ...due('08/18/2026'), AmountLocal: '600.00', PerfectOrder: 'Not Perfect' }),
];

async function loaded(rows = ROWS, opts = {}, files = []) {
  const page = loadPage(opts);
  // The DOM stub opens every harness page as an empty shared snapshot; start from this browser's saved notes instead.
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false;rowOverrides=loadRowOverrides()');
  await upload(page, [{ name: 'kpi.xls', bytes: sapExport(rows) }, ...files]);
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const key = (page, doc, delivered = false) => page.run(`rowKey(allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}&&!!r.deliveryDocNumber===${delivered}))`);
const row = (doc, delivered = false) => `allLoadedRows.find(r=>r.documentNumber===${JSON.stringify(doc)}&&!!r.deliveryDocNumber===${delivered})`;
const cause = (page, doc, delivered) => page.run(`lineCause(${row(doc, delivered)})`);
const setStatus = (page, doc, status) => page.run(`updateRowOverride(${JSON.stringify(key(page, doc))},'status',${JSON.stringify(status)})`);
// The shared notes store writes a picked cause as rowOverrides[key].cause; set it the same way.
const pickCause = (page, k, c) => page.run(`rowOverrides[${JSON.stringify(k)}]={...(rowOverrides[${JSON.stringify(k)}]||{}),cause:${JSON.stringify(c)}}`);
const docs = (page, expr) => page.run(`(${expr}).map(r=>r.documentNumber).sort()`);
const lead = (page) => page.run('(()=>{const d=ohLeadingData(currentMetrics());return {reasons:d.reasons.map(x=>[x.label,x.rows.length,Math.round(x.value),x.cause]),top:d.topReasons.length,cause:Object.fromEntries(Object.entries(d.cause).map(([c,t])=>[c,[t.lines,Math.round(t.value)]])),ages:d.ages.map(a=>[a.id,a.rows.length]),states:d.states.map(s=>[s.id,s.rows.map(r=>r.documentNumber).sort()])}})()');
async function withOverrides() {
  const page = await loaded();
  setStatus(page, '106', 'Hold');
  setStatus(page, '107', 'Urgent');
  setStatus(page, '108', 'Not At Risk');
  return page;
}

// --- Cause engine ---------------------------------------------------------------------------------------
test('cause precedence: picked cause, then override status, then the first SAP signal, else not set', async () => {
  const page = await withOverrides();
  const causes = Object.fromEntries(['100', '101', '102', '103', '104', '106', '107', '108', '109'].map((d) => [d, cause(page, d, false)]));
  assert.deepEqual(causes, { 100: 'us', 101: 'us', 102: 'unknown', 103: 'us', 104: 'unknown', 106: 'them', 107: 'them', 108: 'neutral', 109: 'unknown' });
  // Only a custom export whose RescheduleFlag names the customer makes a reschedule Them.
  page.run(`${row('109')}.rescheduleFlag='Customer Requested Reschedule'`);
  assert.deepEqual([page.run(`lineReasons(${row('109')})`), cause(page, '109', false)], [['Customer reschedule', 'Rescheduled later'], 'them']);
  page.run(`${row('109')}.rescheduleFlag='Rescheduled Later Than Original Delivery'`);
  // The shipped KPI query never sends such a flag.
  const sql = fs.readFileSync(path.join(__dirname, '..', 'queries', 'sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql'), 'utf8');
  assert.doesNotMatch(sql, /'[^']*Customer[^']*Reschedul[^']*'/i);
  assert.deepEqual(page.run(`ohCauseRule(${row('100')})`), { cause: 'us', rule: 'SAP: Past due · no reschedule' });
  assert.deepEqual(page.run(`ohCauseRule(${row('106')})`), { cause: 'them', rule: 'override Hold' });
  // A cause picked on the line beats the override and the SAP signal; blank means "use the rules".
  pickCause(page, key(page, '106'), 'us');
  pickCause(page, key(page, '102'), 'them');
  pickCause(page, key(page, '100'), '');
  assert.deepEqual(['106', '102', '100'].map((d) => cause(page, d, false)), ['us', 'them', 'us']);
  assert.deepEqual(page.run(`ohCauseRule(${row('102')})`), { cause: 'them', rule: 'picked on the line' });
  // Every override status is mapped (Us, Them or Neutral), so a status never falls back to the SAP signal by accident.
  assert.deepEqual(page.run("OVERRIDE_OPTIONS.filter(o=>o&&!causeOfLabel(o))"), []);
  assert.deepEqual(page.run("['Hold','urgent','SHORT SHIP','Covered','Supplier Late','No Commit'].map(causeOfLabel)"), ['them', 'them', 'them', 'neutral', 'us', 'us']);
});

test('a late delivery takes the cause picked on its order line, else its own SAP signal', async () => {
  const page = await loaded();
  assert.deepEqual(['200', '201', '202', '203'].map((d) => cause(page, d, true)), ['us', 'unknown', 'us', 'us']);
  assert.deepEqual(page.run(`lineReasons(${row('202', true)})`), ['Missed commit', 'Rescheduled later']);
  pickCause(page, key(page, '200'), 'them');
  assert.equal(cause(page, '200', true), 'them');
  assert.equal(page.run(`ohCauseRule(${row('200', true)}).rule`), 'picked on the line');
});

// --- Reasons -------------------------------------------------------------------------------------------
test('reasons: every signal on an at-risk line counts, ranked by open value; top 6 at most; override reasons included', async () => {
  const sdHeaders = ['ItemCode', 'ItemDescription', 'WarehouseName', 'YearMonth', 'DemandOpenQty', 'UsableSupplyQty', 'MonthlyNetQty', 'CumulativeNetQty'];
  const sd = utf16Tsv(sdHeaders, [
    { ItemCode: 'SPY-100', WarehouseName: 'CM - DSM', YearMonth: '2026-09', DemandOpenQty: '10', UsableSupplyQty: '0', MonthlyNetQty: '-10', CumulativeNetQty: '-10' },
    { ItemCode: 'SPY-100', WarehouseName: 'Spyder - Lacombe', YearMonth: '2026-09', DemandOpenQty: '10', UsableSupplyQty: '20', MonthlyNetQty: '10', CumulativeNetQty: '10' },
  ]);
  const page = await loaded(ROWS, {}, [{ name: 'sd.xls', bytes: sd }]);
  setStatus(page, '106', 'Hold');
  setStatus(page, '101', 'No Commit');
  const d = lead(page);
  // Only the CM - DSM line has a shortage (that warehouse's snapshot row is short; the Lacombe row is not).
  assert.deepEqual(page.run(`[${row('100')},${row('102')}].map(lineReasons)`), [['Past due · no reschedule', 'Supply shortage'], ['Rescheduled later']]);
  // "No Commit" override and the SAP no-commit signal are one reason.
  assert.deepEqual(page.run(`lineReasons(${row('101')})`), ['No commit date']);
  assert.deepEqual(d.reasons, [
    ['Past due · no reschedule', 3, 15700, 'us'], // 108 counts too: no Not At Risk override in this test
    ['Rescheduled later', 3, 12500, 'unknown'],
    ['Supply shortage', 1, 10000, 'us'],
    ['No commit date', 1, 8000, 'us'],
    ['Hold', 1, 5000, 'them'],
    ['Missed commit', 1, 4000, 'us'],
    ['Unconfirmed', 1, 4000, 'us'],
  ]);
  assert.equal(d.top, 6);
  const bars = [...html(page).matchAll(/class="oh-bar-row[^"]*" data-focus-key="oh-reason-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bars, ['Past due · no reschedule', 'Rescheduled later', 'Supply shortage', 'No commit date', 'Hold', 'Missed commit']);
  // Lines not at risk have no reasons, even when unconfirmed.
  setStatus(page, '103', 'Not At Risk');
  assert.deepEqual(page.run(`lineReasons(${row('103')})`), []);
});

// --- Open order states ---------------------------------------------------------------------------------
test('open order states partition the open lines (count and value) and match the At Risk rules', async () => {
  const page = await withOverrides();
  const d = lead(page);
  assert.deepEqual(Object.fromEntries(d.states), {
    ontrack: ['105', '107', '108'], duethisweek: ['104'], rescheduled: ['102', '109'], pastdue: ['100', '103', '106'], nocommit: ['101'],
  });
  const sums = page.run('(()=>{const oh=orderHealthData(currentMetrics()),d=ohLeadingData(currentMetrics());return {lines:d.states.reduce((s,x)=>s+x.rows.length,0),open:oh.allOrderRows.length,value:Math.round(d.states.reduce((s,x)=>s+x.value,0)),openValue:Math.round(rowOpenAmount(oh.allOrderRows))}})()');
  assert.equal(sums.lines, sums.open);
  assert.equal(sums.value, sums.openValue);
  // Every line in No commit, Past due and Rescheduled is At Risk; At Risk also has the Urgent-only line.
  assert.deepEqual(docs(page, 'orderHealthData(currentMetrics()).lateTileRows'), ['100', '101', '102', '103', '106', '107', '109']);
  assert.deepEqual(page.run('allLoadedRows.filter(r=>r.statusBucket!=="Closed").filter(ohIsAtRisk).map(r=>r.documentNumber).sort()'), ['100', '101', '102', '103', '106', '107', '109']);
  // Still a partition with a warehouse filter.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.deepEqual(lead(page).states.map(([, r]) => r.length), [0, 0, 0, 1, 0]);
  // Each state is a card: clicking lists its lines.
  page.run("setWeeklyWarehouseFilter(['ALL']);setWeeklyTileFilter('st-pastdue')");
  assert.match(html(page), /Linked lines — Past Due/);
  assert.deepEqual([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]).sort(), ['100', '103', '106']);
  assert.match(html(page), /<span class="status-chip bad">Past due<\/span>/);
});

// --- When flagged ---------------------------------------------------------------------------------------
test('when flagged: weeks since first at risk from firstFlagged; missing history counts as new this week', async () => {
  const page = await withOverrides();
  assert.deepEqual(lead(page).ages, [['new', 7], ['1-2', 0], ['3-4', 0], ['5-8', 0], ['9+', 0]]);
  assert.match(html(page), /No upload history yet, so every line counts as new this week/);
  // The shared notes store fills the global firstFlagged map (rowKey -> export date of the first at-risk upload).
  page.ctx.firstFlagged = {
    [key(page, '100')]: '2026-09-03', [key(page, '101')]: '2026-08-27', [key(page, '102')]: '2026-08-13',
    [key(page, '103')]: '2026-08-06', [key(page, '106')]: '2026-07-02', [key(page, '107')]: '2026-09-10',
  };
  page.run('renderResults()');
  assert.deepEqual(lead(page).ages, [['new', 3], ['1-2', 1], ['3-4', 2], ['5-8', 0], ['9+', 1]]); // 7, 21 and 28 days, 63 days
  assert.match(html(page), /From the at-risk history of earlier uploads\./);
  assert.equal(page.run(`ohFlaggedSince(${row('106')})`), '2026-07-02');
});

// --- Chart filters ---------------------------------------------------------------------------------------
test('reason, cause and when-flagged filters compose with each other and the page filters; chips clear them', async () => {
  const page = await withOverrides();
  page.ctx.firstFlagged = { [key(page, '103')]: '2026-08-06', [key(page, '100')]: '2026-08-06' };
  const risk = () => docs(page, 'orderHealthData(currentMetrics()).lateTileRows');
  const keyBefore = page.run('weeklyFilterKey()');
  const scorecard = () => html(page).match(/<section class="table" aria-label="Warehouse scorecard">[\s\S]*?<\/section>/)[0];
  const fillCard = () => html(page).match(/data-focus-key="tile-fillrate"[\s\S]*?<\/button>/)[0];
  const undrilled = { fill: page.run('orderHealthData(currentMetrics()).fillOpenRows.length'), scorecard: scorecard(), fillCard: fillCard() };
  page.run("setWeeklyCauseFilter('us')");
  assert.deepEqual(risk(), ['100', '101', '103']);
  assert.notEqual(page.run('weeklyFilterKey()'), keyBefore);
  page.run("setWeeklyReasonFilter('Past due · no reschedule')");
  assert.deepEqual(risk(), ['100']);
  page.run("setWeeklyReasonFilter('Past due · no reschedule');setWeeklyAgeFilter('3-4')");
  assert.deepEqual(risk(), ['100', '103']);
  // Open lines follow too (All open orders, states, linked lines); the at-risk list shows below.
  assert.deepEqual(docs(page, 'orderHealthData(currentMetrics()).allOrderRows'), ['100', '103']);
  assert.equal(page.run('weeklyTileFilter'), 'late');
  assert.deepEqual([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]).sort(), ['100', '103']);
  // With a warehouse filter on top.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  assert.deepEqual(risk(), ['100']);
  page.run("setWeeklyWarehouseFilter(['ALL'])");
  // Chips name each filter and remove just that one.
  const chips = [...html(page).matchAll(/class="chip active oh-chip" data-kind="(\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(chips, [['cause', 'Cause: Us'], ['age', 'When flagged: 3–4 wk']]);
  page.run("clearWeeklyDrill('age')");
  assert.deepEqual(risk(), ['100', '101', '103']);
  // Lagging rates are not filtered by them, nor the Fill rate card's open lines and the warehouse scorecard.
  assert.equal(page.run('orderHealthData(currentMetrics()).otd3Mo.scored.length'), 4);
  assert.equal(page.run('orderHealthData(currentMetrics()).fillOpenRows.length'), undrilled.fill);
  assert.ok(undrilled.fill > 3);
  assert.equal(fillCard(), undrilled.fillCard);
  assert.equal(scorecard(), undrilled.scorecard);
  page.run("setWeeklyTileFilter('fillrate')");
  assert.equal([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].length, undrilled.fill);
  page.run("setWeeklyTileFilter('late')");
  // The AI tools report the page with every filter at All and leave the page's filters alone.
  assert.equal(page.run("aiRunTool('get_overview',{}).order_health.at_risk.lines"), 7);
  assert.equal(page.run('weeklyCauseFilter'), 'us');
  // Reset clears them with the other filters; the sidebar badge always follows the At Risk card.
  page.run('resetWeeklyFilters()');
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyCauseFilter'), page.run('weeklyAgeFilter')], ['', '', '']);
  assert.match(page.els['app-sidebar'].innerHTML, /class="nav-badge"[^>]*>7</);
  assert.doesNotMatch(html(page), /oh-chip/);
});

test('a Big picture reason box filters to its own lines (first reason only); the Top 6 bar keeps every line with the reason', async () => {
  const page = await withOverrides();
  const risk = () => docs(page, 'orderHealthData(currentMetrics()).lateTileRows');
  const box = page.run("(()=>{const n=sankeyFlows('weekly')[1].nodes.find(n=>n.id==='0:Rescheduled later');return {value:n.value,count:n.count,action:n.action}})()");
  assert.deepEqual(box, { value: 8500, count: 2, action: { type: 'reason', value: 'Rescheduled later', main: true } });
  page.run("sankeyNodeClick('weekly','risk','0:Rescheduled later')");
  // 103 also has "Rescheduled later", but its first reason is "Missed commit", so it sits in another box.
  assert.deepEqual(risk(), ['102', '109']);
  assert.equal(page.run('orderHealthData(currentMetrics()).lateAmt'), box.value);
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyReasonMain')], ['Rescheduled later', true]);
  assert.match(html(page), /class="chip active oh-chip" data-kind="reason"[^>]*>Main reason: Rescheduled later </);
  assert.doesNotMatch(html(page), /class="oh-bar-row selected"/, 'the Top 6 bar is a different filter');
  assert.equal(page.run("sankeyNodeSelected(sankeyFlows('weekly')[1].nodes.find(n=>n.id==='0:Rescheduled later'))"), true);
  assert.deepEqual(page.run('ohSnapshotView()').weeklyReasonMain, true);
  // The Top 6 bar of the same reason: every at-risk line that has it.
  page.run("setWeeklyReasonFilter('Rescheduled later')");
  assert.deepEqual(risk(), ['102', '103', '109']);
  assert.equal(page.run('weeklyReasonMain'), false);
  assert.match(html(page), /class="chip active oh-chip" data-kind="reason"[^>]*>Reason: Rescheduled later </);
  // A second click on the box (main filter on) removes it; chips and Reset clear the mode too.
  page.run("sankeyNodeClick('weekly','risk','0:Rescheduled later');sankeyNodeClick('weekly','risk','0:Rescheduled later')");
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyReasonMain')], ['', false]);
  page.run("sankeyNodeClick('weekly','risk','0:Rescheduled later');clearWeeklyDrill('reason')");
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyReasonMain')], ['', false]);
  page.run("ohRestoreView({weeklyReasonFilter:'Rescheduled later',weeklyReasonMain:true})");
  assert.deepEqual(risk(), ['102', '109']);
  page.run('resetWeeklyFilters()');
  assert.equal(page.run('weeklyReasonMain'), false);
});

test('a cause picked later (no metrics change) refreshes the cached Us / Them numbers and an active cause filter', async () => {
  const page = await withOverrides();
  const usLines = () => page.run('ohLeadingData(currentMetrics()).cause.us.lines');
  assert.equal(usLines(), 3);
  page.run("setWeeklyCauseFilter('them')");
  assert.deepEqual(docs(page, 'orderHealthData(currentMetrics()).lateTileRows'), ['106', '107']);
  pickCause(page, key(page, '102'), 'them');
  page.run('renderResults()');
  assert.deepEqual(docs(page, 'orderHealthData(currentMetrics()).lateTileRows'), ['102', '106', '107']);
  page.run("clearWeeklyDrill('')");
  pickCause(page, key(page, '102'), 'us');
  assert.equal(usLines(), 4);
});

test('a cause pick, a bulk cause or a teammate\'s note redraws from the cached metrics; a status still rebuilds them', async () => {
  const page = await withOverrides();
  const snap = () => page.run('(()=>{const m=currentMetrics(),d=ohLeadingData(m),s=ohLagSplits(m);return JSON.stringify([Object.fromEntries(Object.entries(d.cause).map(([c,t])=>[c,[t.lines,Math.round(t.value)]])),Object.fromEntries(Object.entries(s).filter(([,v])=>v&&v.totals).map(([k,v])=>[k,Object.fromEntries(Object.entries(v.totals).map(([c,x])=>[c,x.lines]))]))])})()');
  page.run('window.__m=currentMetrics()');
  const kept = () => page.run('currentMetrics()===window.__m');
  for (const view of ['leading', 'lagging']) {
    page.run(`setWeeklyView('${view}')`);
    page.run(`updateRowOverride(${JSON.stringify(key(page, '102'))},'cause','${view === 'leading' ? 'them' : 'us'}')`);
    assert.equal(kept(), true, `${view}: a cause pick keeps the metrics`);
    const after = snap();
    page.run('invalidateMetrics()');
    assert.equal(snap(), after, `${view}: the Us / Them totals and Lagging splits match a full rebuild`);
    page.run('window.__m=currentMetrics()');
  }
  page.run(`setRowOverrides([${JSON.stringify(key(page, '104'))},${JSON.stringify(key(page, '105'))}],'cause','them')`);
  assert.equal(kept(), true, 'a bulk cause keeps the metrics');
  assert.equal(cause(page, '105'), 'them');
  // A teammate's note (no status, no deletion) arrives with a sync: only redrawn.
  const k = key(page, '100');
  page.run(`adoptSharedReply({rows:{${JSON.stringify(k)}:{notes:'from a teammate',by:'OK',at:'2027-01-01T00:00:00.000Z'}}})`);
  assert.equal(kept(), true, 'a note from someone else keeps the metrics');
  assert.equal(page.run(`${row('100')}.overrideNotes`), 'from a teammate');
  // A teammate's status change does rebuild them (it moves lines between cards).
  page.run(`adoptSharedReply({rows:{${JSON.stringify(k)}:{notes:'from a teammate',status:'Not At Risk',by:'OK',at:'2027-01-02T00:00:00.000Z'}}})`);
  assert.equal(kept(), false);
  assert.ok(!docs(page, 'orderHealthData(currentMetrics()).lateTileRows').includes('100'));
  // A status picked here still rebuilds them.
  page.run('window.__m=currentMetrics()');
  setStatus(page, '105', 'Urgent');
  assert.equal(kept(), false);
});

// --- Tabs -------------------------------------------------------------------------------------------------
test('tabs: an ARIA tablist with one visible panel, arrow keys, and the linked lines follow the tab', async () => {
  const page = await withOverrides();
  const m = html(page);
  assert.match(m, /<div class="oh-tabs" role="tablist" aria-label="Order Health indicators">/);
  assert.match(m, /role="tab" class="oh-tab" id="oh-tab-leading" aria-selected="true" aria-controls="oh-panel-leading" tabindex="0"/);
  assert.match(m, /role="tab" class="oh-tab" id="oh-tab-lagging" aria-selected="false" aria-controls="oh-panel-lagging" tabindex="-1"/);
  assert.match(m, /<div class="oh-panel" role="tabpanel" id="oh-panel-leading" aria-labelledby="oh-tab-leading">/);
  assert.match(m, /<div class="oh-panel" role="tabpanel" id="oh-panel-lagging" aria-labelledby="oh-tab-lagging" hidden>/);
  // The existing sections live in their tab; the filter bar is above the tabs and the linked lines below both.
  assert.ok(m.indexOf('class="filter-bar') < m.indexOf('role="tablist"'));
  assert.ok(m.indexOf('id="oh-panel-leading"') < m.indexOf('Needs attention') && m.indexOf('Needs attention') < m.indexOf('id="oh-panel-lagging"'));
  assert.ok(m.indexOf('id="oh-panel-lagging"') < m.indexOf('How we performed') && m.indexOf('How we performed') < m.indexOf('Warehouse scorecard'));
  assert.ok(m.indexOf('id="linked-lines"') > m.indexOf('Warehouse scorecard'));
  // Right arrow shows Lagging and focuses its tab; a Leading card gives way to OTD.
  const focused = [];
  page.ctx.document.getElementById('oh-tab-lagging').focus = () => focused.push('lagging');
  let prevented = false;
  page.run('ohTabKey')({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.deepEqual([page.run('weeklyView'), page.run('weeklyTileFilter'), focused, prevented], ['lagging', 'otd3mo', ['lagging'], true]);
  assert.match(html(page), /id="oh-panel-leading" aria-labelledby="oh-tab-leading" hidden>/);
  assert.match(html(page), /Linked lines — OTD 3 Mo/);
  page.run("ohTabKey({key:'End'});ohTabKey({key:'Home'})");
  assert.equal(page.run('weeklyView'), 'leading');
  assert.equal(page.run('weeklyTileFilter'), 'late');
  page.run("ohTabKey({key:'Tab'})");
  assert.equal(page.run('weeklyView'), 'leading', 'other keys are left alone');
  // No card picked: switching keeps it that way.
  page.run("setWeeklyTileFilter('late');setWeeklyView('lagging')");
  assert.equal(page.run('weeklyTileFilter'), '');
});

test('tab and chart filters are saved in a shared snapshot (with the flag history), and reset with a new report', async () => {
  const saver = await withOverrides();
  saver.ctx.firstFlagged = { [key(saver, '106')]: '2026-07-02', 'not|in|this|export': '2026-01-01' };
  saver.run("setWeeklyView('lagging');weeklyReasonFilter='Hold';weeklyCauseFilter='them';weeklyAgeFilter='9+'");
  let payload = '';
  Object.assign(saver.ctx, { buildSnapshotHtml: (p) => { payload = p.text; return ''; }, downloadPreparedSnapshot() {}, showSnapshotDownloadLink() {} });
  await saver.ctx.exportShareSnapshot();
  const data = JSON.parse(payload);
  assert.deepEqual([data.weeklyView, data.weeklyReasonFilter, data.weeklyCauseFilter, data.weeklyAgeFilter], ['lagging', 'Hold', 'them', '9+']);
  assert.deepEqual(data.firstFlagged, { [key(saver, '106')]: '2026-07-02' }, 'only lines in this export travel');
  const open = async (text) => {
    const snap = loadPage();
    snap.els['embedded-snapshot-data'].dataset.encoding = 'json';
    snap.els['embedded-snapshot-data'].textContent = text;
    await snap.run('loadEmbeddedSnapshot()');
    return snap;
  };
  const VIEW = '[weeklyView,weeklyReasonFilter,weeklyCauseFilter,weeklyAgeFilter]';
  const viewer = await open(payload);
  assert.deepEqual(viewer.run(VIEW), ['lagging', 'Hold', 'them', '9+']);
  assert.deepEqual(docs(viewer, 'orderHealthData(currentMetrics()).lateTileRows'), ['106']);
  assert.equal(viewer.run(`ohFlaggedSince(allLoadedRows.find(r=>r.documentNumber==='106'))`), '2026-07-02');
  // Older snapshots, and values that are not allowed, open on the defaults.
  const old = await open(JSON.stringify({ parsedRows: data.parsedRows, weeklyView: 'sideways', weeklyCauseFilter: 'aliens', weeklyAgeFilter: 7 }));
  assert.deepEqual(old.run(VIEW), ['leading', '', '', '']);
  // A new report resets the view.
  await viewer.ctx.handleFiles([{ name: 'new.xls', bytes: sapExport(ROWS) }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(viewer.run(VIEW), ['leading', '', '', '']);
  assert.equal(viewer.run('ohSnapshotFlags'), null);
  // ...and drops the snapshot's first-flagged dates (the site's own history is read instead when there is one).
  assert.deepEqual(viewer.run('firstFlagged'), {});
  assert.equal(viewer.run(`ohFlaggedSince(allLoadedRows.find(r=>r.documentNumber==='106'))`), '');
});

// --- Lagging ----------------------------------------------------------------------------------------------
test('Lagging: perfect order and average days late, Us / Them on every rate, built only when the tab is open', async () => {
  const page = await withOverrides();
  page.run('var built=0;var realPerfect=perfectOrderStats;perfectOrderStats=function(){built++;return realPerfect.apply(this,arguments)}');
  page.run('renderResults()');
  assert.equal(page.run('built'), 0, 'the default tab does not score perfect orders');
  assert.doesNotMatch(html(page), /data-focus-key="tile-perfect"/);
  page.run("setWeeklyView('lagging')");
  assert.equal(page.run('built'), 1);
  const x = page.run('(()=>{const x=ohLaggingExtras(currentMetrics());return {rate:x.perfect.rate,perfect:x.perfect.perfect.map(r=>r.documentNumber),scored:x.perfect.scored.length,avg:x.daysLate.avg,late:x.daysLate.late.map(r=>r.documentNumber),scoredDeliveries:x.daysLate.scored.length,notPerfectCause:x.perfect.totals.us.lines}})()');
  assert.deepEqual(x, { rate: 25, perfect: ['201'], scored: 4, avg: 7.3, late: ['202', '200', '203'], scoredDeliveries: 4, notPerfectCause: 3 });
  // Same rule as the Metrics page.
  assert.equal(x.rate, page.run('realPerfect(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).rate'));
  const m = html(page);
  assert.match(m, /Perfect order · 12 mo<\/span>[\s\S]*?<span class="kpi-value crit">25%<\/span>/);
  assert.match(m, /Avg days late · 3 mo<\/span>[\s\S]*?<span class="kpi-value crit">7\.3 d<\/span>/);
  assert.match(m, /3 of 4 deliveries shipped after the original date/);
  // Each lagging card says who caused its misses.
  assert.match(m, /OTD · 3 mo<\/span>[\s\S]*?1\+ days late: <b class="cause-text-us">Us 3<\/b><\/span>/);
  assert.match(m, /Fill rate<\/span>[\s\S]*?Past due, open: <b class="cause-text-us">Us 3<\/b> · <b class="cause-text-them">Them 1<\/b> · <b class="cause-text-neutral">Neutral 1<\/b> · <b class="cause-text-unknown">Not set 2<\/b><\/span>/);
  assert.match(m, /Shipped this week<\/span>[\s\S]*?Shipped late: none/);
  // The new cards list their lines like OTD does.
  page.run("setWeeklyTileFilter('dayslate')");
  assert.match(html(page), /Linked lines — Late Deliveries · last 3 months/);
  assert.match(html(page), /Delivery date/);
  page.run("setWeeklyTileFilter('perfect')");
  assert.deepEqual([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((r) => r[1]).sort(), ['200', '202', '203']);
  assert.match(html(page), /status-chip bad">Missed commit<\/span>/);
});

// --- Waffle -------------------------------------------------------------------------------------------------
test('waffle blocks: one per $20,000, a half block under $10,000, capped at 50, coloured by the Us / Them share', async () => {
  const page = loadPage();
  const b = (args) => page.run(`ohWaffleBlocks(${args.join(',')})`);
  assert.deepEqual(b([50000, 30000, 20000]), { full: 3, half: false, capped: false, blocks: 3, us: 2, them: 1, rest: 0 });
  assert.deepEqual(b([9000, 0, 9000]), { full: 0, half: true, capped: false, blocks: 1, us: 0, them: 1, rest: 0 });
  assert.deepEqual(b([10000]), { full: 1, half: false, capped: false, blocks: 1, us: 0, them: 0, rest: 1 });
  assert.deepEqual(b([0]), { full: 0, half: false, capped: false, blocks: 0, us: 0, them: 0, rest: 0 });
  assert.deepEqual(b([5000000, 5000000]), { full: 50, half: false, capped: true, blocks: 50, us: 50, them: 0, rest: 0 });
  assert.equal(page.run('BLOCK_VALUE'), 20000);
});

test('Top offenders draws the waffle; clicking a row filters the page to it, a vendor opens Purchase Orders', async () => {
  const rows = [...ROWS,
    open('110', { ...due('08/02/2026'), AmountLocal: '45,000.00', CustomerVendorCode: 'PATRICK', CustomerVendorName: 'Patrick' }),
    sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...due('08/10/2026'), AmountLocal: '30,000.00' })];
  const page = await loaded(rows);
  setStatus(page, '106', 'Hold');
  const m = html(page);
  const offenders = m.match(/<div class="waffle-list" role="group" aria-label="Top offenders">[\s\S]*?<\/div><div class="legend oh-waffle-legend">[\s\S]*?<\/div>/)[0];
  const blocks = (code) => offenders.match(new RegExp(`data-off="${code}"[\\s\\S]*?<span class="waffle" aria-hidden="true">([\\s\\S]*?)</span>\\s*</button>`))[1].match(/class="pop wb-(\w+)( half)?"/g).map((x) => x.replace(/class="pop wb-|"/g, ''));
  assert.deepEqual(blocks('PATRICK'), ['us', 'us']); // $45,000 -> 2 blocks, all Us
  assert.deepEqual(blocks('FIREFLY'), ['us']); // $23,500 -> 1 block; Us has the biggest share ($10,000)
  assert.deepEqual(blocks('AQUHOT'), ['us half']); // $8,000 -> half block
  assert.match(offenders, /data-tip="Patrick: \$45,000 at-risk open value on 1 line\. Us \$45,000\. +Click to show only this customer on Order Health\."/);
  assert.match(offenders, /■ = \$20k/);
  page.run("setWeeklyOffenderFilter('customers','PATRICK')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['PATRICK']);
  assert.match(html(page), /class="waffle-row selected"[^>]*data-off="PATRICK"[^>]*aria-pressed="true"/);
  page.run("setWeeklyOffenderFilter('customers','PATRICK')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['ALL']);
  page.run("setWeeklyOffenderView('vendors')");
  assert.match(html(page), /data-view="vendors" data-off="ACME"[\s\S]*?class="pop wb-po"/);
  page.run("setWeeklyOffenderFilter('vendors','ACME')");
  assert.deepEqual([page.run('activeTab'), page.run('poVendorFilter'), page.run('poTileFilter')], ['purchaseorders', ['ACME'], 'late']);
});

// --- Search, tables, tips, About ---------------------------------------------------------------------------
test('Search finds lines by reason or cause, and tables show each line\'s cause and first reason', async () => {
  const page = await withOverrides();
  const found = (q) => page.run(`(searchQuery=${JSON.stringify(q)},globalSearchResults(currentMetrics()).rows.map(x=>x.r.documentNumber).sort())`);
  assert.deepEqual(found('no commit date'), ['101']);
  assert.deepEqual(found('caused by them'), ['106', '107']);
  assert.deepEqual(found('supplier late'), []);
  setStatus(page, '105', 'Supplier Late');
  assert.deepEqual(found('supplier late'), ['105']);
  // A picked cause changes the next search without a new export.
  pickCause(page, key(page, '102'), 'them');
  assert.deepEqual(found('caused by them'), ['102', '106', '107']);
  page.run("searchQuery='106';setTab('search')");
  // The other reasons and the first-flagged upload are visible text (a muted second line), not only in the tip.
  assert.match(html(page), /<span class="oh-why cause-text-them" data-tip="Cause: Them \(override Hold\)\. Reasons: Past due · no reschedule, Hold\.">Them · Past due · no reschedule<\/span><span class="timing oh-why-more">Hold<\/span>/);
  page.ctx.firstFlagged = { [key(page, '106')]: '2026-07-02' };
  page.run('renderResults()');
  assert.match(html(page), /Them · Past due · no reschedule<\/span><span class="timing oh-why-more">Hold · first at risk in the 2026-07-02 upload<\/span>/);
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  assert.match(html(page), /<span class="oh-why cause-text-us"[^>]*>Us · No commit date<\/span>(?!<span class="timing oh-why-more">)/);
});

test('every new control and chart carries a plain-English tip with full numbers; markup stays balanced', async () => {
  const page = await withOverrides();
  page.run("setWeeklyCauseFilter('us')");
  for (const view of ['leading', 'lagging']) {
    page.run(`setWeeklyView('${view}')`);
    const m = html(page);
    const controls = [...m.matchAll(/<button [^>]*class="(?:oh-tab|oh-bar-row|oh-cause-btn|waffle-row|chip active oh-chip|card kpi lag)[^"]*"[^>]*>/g)].map((x) => x[0])
      .concat([...m.matchAll(/<button [^>]*data-focus-key="tile-st-[^"]*"[^>]*>/g)].map((x) => x[0]));
    assert.ok(controls.length >= (view === 'leading' ? 15 : 4), `${view}: ${controls.length}`);
    for (const c of controls.filter((x) => !/tile-(otd3mo|shippedweek|fillrate|reschedhit)"/.test(x))) assert.match(c, /data-tip="[^"]{20,}"/, c.slice(0, 120));
    assert.match(m, /data-tip="Us: \$22,000 at-risk open value on 3 lines/);
    const count = (needle) => m.split(needle).length - 1;
    for (const tag of ['div', 'section', 'button', 'span', 'details']) {
      assert.equal(count(`<${tag} `) + count(`<${tag}>`), count(`</${tag}>`), `${view}: unbalanced <${tag}>`);
    }
    assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|\[object Object\]/);
  }
  assert.deepEqual(page.errors, []);
});

test('About these numbers defines every new number in plain English', async () => {
  const page = await loaded();
  const about = html(page).match(/<details class="about rise"><summary>About these numbers<\/summary>[\s\S]*?<\/details>/)[0];
  for (const term of ['Leading and Lagging', 'Us vs Them', 'Reasons', 'Open order states', 'When flagged', 'OTD · 3 mo', 'Shipped this week', 'Fill rate', 'Reschedule hit · 12 mo', 'Perfect order · 12 mo', 'Avg days late · 3 mo', 'Top offenders', '$20,000']) {
    assert.ok(about.includes(term), term);
  }
});

test('an export with no sales order lines still draws Order Health without errors', async () => {
  const page = await loaded([sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700' })]);
  page.run("setWeeklyCauseFilter('us');setWeeklyView('lagging');setWeeklyView('leading')");
  assert.match(html(page), /Nothing at risk in this view\./);
  assert.deepEqual(page.errors, []);
});

// --- Ask AI / MCP ---------------------------------------------------------------------------------------------
test('get_overview gains leading / lagging and cause fields that match the page; search_lines filters by cause', async () => {
  const page = await withOverrides();
  const oh = page.run("aiRunTool('get_overview',{}).order_health");
  assert.deepEqual(oh.at_risk.cause, { us: { lines: 3, orders: 3, value: 22000 }, them: { lines: 2, orders: 2, value: 6500 }, neutral: { lines: 0, orders: 0, value: 0 }, not_set: { lines: 2, orders: 2, value: 8500 } });
  assert.equal(Object.values(oh.at_risk.cause).reduce((s, c) => s + c.lines, 0), oh.at_risk.lines);
  assert.deepEqual(oh.leading.at_risk_by_cause, oh.at_risk.cause);
  assert.deepEqual(Object.keys(oh.leading.states), ['on_track', 'due_this_week', 'rescheduled', 'past_due', 'no_commit']);
  assert.equal(Object.values(oh.leading.states).reduce((s, x) => s + x.lines, 0), oh.all_open.lines);
  assert.deepEqual(oh.leading.top_reasons[0], { reason: 'Past due · no reschedule', usual_cause: 'us', orders: 2, lines: 2, open_value: 15000 });
  assert.deepEqual(oh.leading.when_flagged.buckets.map((b) => b.bucket), ['New this week', '1–2 wk', '3–4 wk', '5–8 wk', '9+ wk']);
  assert.equal(oh.leading.when_flagged.history_available, false);
  assert.deepEqual(oh.lagging.perfect_order_12mo, { rate_pct: 25, perfect_lines: 1, completed_lines: 4, not_perfect_by_cause: { us: 3, them: 0, neutral: 0, not_set: 0 }, target_pct: 90 });
  assert.deepEqual(oh.lagging.avg_days_late_3mo, { days: 7.3, late_deliveries: 3, deliveries_scored: 4, late_by_cause: { us: 3, them: 0, neutral: 0, not_set: 0 } });
  assert.deepEqual(oh.lagging.otd_3mo.late_by_cause, { us: 3, them: 0, neutral: 0, not_set: 0 });
  assert.equal(oh.lagging.fill_rate.by_original_due_month.length, 12);
  const them = page.run("aiRunTool('search_lines',{scope:'at_risk',cause:'them'})");
  assert.deepEqual(them.rows.map((r) => r.doc).sort(), ['106', '107']);
  assert.deepEqual(them.rows.find((r) => r.doc === '106').reasons, ['Past due · no reschedule', 'Hold']);
  assert.equal(page.run("aiRunTool('search_lines',{scope:'at_risk',cause:'not_set'})").rows[0].doc, '102');
  assert.match(page.run("aiRunTool('search_lines',{scope:'open',cause:'maybe'})").error, /cause must be one of/);
  // Lines with nothing to explain carry no cause.
  assert.equal(page.run("aiRunTool('search_lines',{scope:'open',query:'105'})").rows[0].cause, undefined);
  assert.match(page.run("KPI_TOOLS.find(t=>t.name==='get_overview').description"), /order_health\.leading[\s\S]*order_health\.lagging/);
});

test('the MCP server (index.html in a Node vm) returns the new fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyder kpi oh2 '));
  const file = path.join(dir, 'kpi export.xls');
  fs.writeFileSync(file, sapExport(ROWS));
  const out = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'spyder-kpi-mcp.mjs'), '--check', file], { encoding: 'utf8', env: { ...process.env, SPYDER_KPI_FILES: '' }, timeout: 60000 });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(out.status, 0, out.stderr);
  const oh = JSON.parse(out.stdout).order_health;
  assert.deepEqual(Object.keys(oh.leading), ['cause_rule', 'at_risk_by_cause', 'open_orders', 'states', 'top_reasons', 'when_flagged']);
  assert.deepEqual(Object.keys(oh.lagging), ['otd_3mo', 'shipped_this_week', 'fill_rate', 'reschedule_hit_12mo', 'perfect_order_12mo', 'avg_days_late_3mo']);
  assert.equal(oh.at_risk.cause.not_set.lines, 2);
  assert.equal(oh.lagging.perfect_order_12mo.rate_pct, 25);
});

run();
