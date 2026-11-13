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
  assert.deepEqual(page.run(`ohCauseRule(${row('100')})`), { cause: 'us', rule: 'SAP: Past due · No reschedule' });
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
  assert.deepEqual(page.run(`[${row('100')},${row('102')}].map(lineReasons)`), [['Past due · No reschedule', 'Supply shortage'], ['Rescheduled later']]);
  // 2v6.5 (C): the "No Commit" override is its own reason, "No Commit (override)"; "No commit date" is only SAP's
  // 1111-11-11 date (OH_OVERRIDE_REASON).
  assert.deepEqual(page.run(`lineReasons(${row('101')})`), ['No commit date', 'No Commit (override)']);
  assert.deepEqual(d.reasons, [
    ['Past due · No reschedule', 3, 15700, 'us'], // 108 counts too: no Not At Risk override in this test
    ['Rescheduled later', 3, 12500, 'unknown'],
    ['Supply shortage', 1, 10000, 'us'],
    ['No Commit (override)', 1, 8000, 'us'],
    ['No commit date', 1, 8000, 'us'],
    ['Hold', 1, 5000, 'them'],
    ['Missed commit', 1, 4000, 'us'],
    ['Unconfirmed', 1, 4000, 'us'],
  ]);
  assert.equal(d.top, 6);
  // Top reasons (owner, option S): the reasons in the sets drawn (up to 8 sets), most lines first.
  const bars = [...html(page).matchAll(/class="ohu-name[^"]*" data-focus-key="oh-reason-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bars, page.run('(()=>{const m=currentMetrics(),r=ohlReasons(m),by=new Map(r.map(x=>[x.label,x.lines])),sh=ohlReasonSets(m).slice(0,8);return r.map(x=>x.label).filter(l=>sh.some(s=>s.labels.includes(l))).sort((a,b)=>by.get(b)-by.get(a));})()'));
  assert.equal(bars[0], 'Past due · No reschedule');
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
  // The Lines card (2v6): its chip has the lines and their value, the picked state's name beside it.
  assert.match(html(page), /<h2 class="dz-title"[^>]*>Lines<\/h2><span class="dz-chip red">3 lines · \$19,000<\/span><span class="dz-meta">Past due<\/span>/);
  assert.deepEqual([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]).sort(), ['100', '103', '106']);
  assert.match(html(page).slice(html(page).indexOf('id="linked-lines"')), /<span class="dz-chip red">Past due<\/span>/);
});

// --- When flagged ---------------------------------------------------------------------------------------
test('when flagged: weeks since first at risk from firstFlagged; missing history counts as new this week', async () => {
  const page = await withOverrides();
  assert.deepEqual(lead(page).ages, [['new', 7], ['1-2', 0], ['3-4', 0], ['5-8', 0], ['9+', 0]]);
  // 2v6.9: the When flagged card and the "+N new this week" chip are gone from Leading (the owner's asks); the history stays.
  assert.doesNotMatch(html(page), />When flagged<\/h2>|data-focus-key="oh-age-|data-focus-key="ohl-new"|new this week</);
  assert.ok(!page.run('ohFirstFlagged()'), 'no upload history yet: every line counts as new');
  // The shared notes store fills the global firstFlagged map (rowKey -> export date of the first at-risk upload).
  page.ctx.firstFlagged = {
    [key(page, '100')]: '2026-09-03', [key(page, '101')]: '2026-08-27', [key(page, '102')]: '2026-08-13',
    [key(page, '103')]: '2026-08-06', [key(page, '106')]: '2026-07-02', [key(page, '107')]: '2026-09-10',
  };
  page.run('renderResults()');
  assert.deepEqual(lead(page).ages, [['new', 3], ['1-2', 1], ['3-4', 2], ['5-8', 0], ['9+', 1]]); // 7, 21 and 28 days, 63 days
  assert.ok(page.run('!!ohFirstFlagged()'));
  assert.equal(page.run(`ohFlaggedSince(${row('106')})`), '2026-07-02');
});

// --- Chart filters ---------------------------------------------------------------------------------------
test('reason, cause and when-flagged filters compose with each other and the page filters; chips clear them', async () => {
  const page = await withOverrides();
  page.ctx.firstFlagged = { [key(page, '103')]: '2026-08-06', [key(page, '100')]: '2026-08-06' };
  const risk = () => docs(page, 'orderHealthData(currentMetrics()).lateTileRows');
  const keyBefore = page.run('weeklyFilterKey()');
  // 2v6.9: no Fill rate card on Lagging and no Warehouse scorecard any more; the fill-rate lines and the scorecard data
  // (warehouseScorecardData, still read by the AI tools) must still ignore the chart filters.
  const scorecard = () => JSON.stringify(page.run('warehouseScorecardData(currentMetrics())'));
  const undrilled = { fill: page.run('orderHealthData(currentMetrics()).fillOpenRows.length'), scorecard: scorecard() };
  assert.doesNotMatch(html(page), /data-focus-key="tile-fillrate"|aria-label="Warehouse scorecard"/);
  page.run("setWeeklyCauseFilter('us')");
  assert.deepEqual(risk(), ['100', '101', '103']);
  assert.notEqual(page.run('weeklyFilterKey()'), keyBefore);
  page.run("setWeeklyReasonFilter('Past due · No reschedule')");
  assert.deepEqual(risk(), ['100']);
  page.run("setWeeklyReasonFilter('Past due · No reschedule');setWeeklyAgeFilter('3-4')");
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
  assert.equal(scorecard(), undrilled.scorecard);
  // The AI tools report the page with every filter at All and leave the page's filters alone.
  assert.equal(page.run("aiRunTool('get_overview',{}).order_health.at_risk.lines"), 6); // the At risk card: due by its date
  assert.equal(page.run("aiRunTool('get_overview',{}).order_health.at_risk_any_date.lines"), 7);
  assert.equal(page.run('weeklyCauseFilter'), 'us');
  // Reset clears them with the other filters. (2v6: the header's page links carry no count badge.)
  page.run('resetWeeklyFilters()');
  assert.deepEqual([page.run('weeklyReasonFilter'), page.run('weeklyCauseFilter'), page.run('weeklyAgeFilter')], ['', '', '']);
  assert.match(page.els['app-header'].innerHTML, /data-focus-key="nav-weekly"[^>]*>Sales Order Health<\/button>/);
  assert.equal(page.run('orderHealthData(currentMetrics()).lateTileRows.length'), 7);
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
  assert.match(html(page), /<button type="button" class="ohu-name" data-focus-key="oh-reason-Rescheduled later" aria-pressed="false"/);
  assert.doesNotMatch(html(page), /class="ohu-name sel"/, 'the Top reasons name is a different filter');
  assert.equal(page.run("sankeyNodeSelected(sankeyFlows('weekly')[1].nodes.find(n=>n.id==='0:Rescheduled later'))"), true);
  assert.deepEqual(page.run('ohSnapshotView()').weeklyReasonMain, true);
  // The Top 6 bar of the same reason: every at-risk line that has it.
  page.run("setWeeklyReasonFilter('Rescheduled later')");
  assert.deepEqual(risk(), ['102', '103', '109']);
  assert.equal(page.run('weeklyReasonMain'), false);
  assert.match(html(page), /class="chip active oh-chip" data-kind="reason"[^>]*>Reason: Rescheduled later </);
  assert.match(html(page), /<button type="button" class="ohu-name sel" data-focus-key="oh-reason-Rescheduled later" aria-pressed="true"/);
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
test('tabs: an ARIA tablist (Leading, Lagging, Supply / Demand) with one visible panel, arrow keys, and the Lines card in Leading', async () => {
  const page = await withOverrides();
  const m = html(page);
  // 2v6: the switch is a segmented pill (dzSeg) with three tabs: Leading | Lagging | Supply / Demand (2v6.9).
  assert.match(m, /<div class="dz-seg" role="tablist" aria-label="Sales Order Health view">/);
  assert.match(m, /role="tab" id="oh-tab-leading" class="on" aria-selected="true" tabindex="0" onclick="setWeeklyView\(&#39;leading&#39;\)" aria-controls="oh-panel-leading" onkeydown="ohTabKey\(event\)"/);
  assert.match(m, /role="tab" id="oh-tab-lagging" aria-selected="false" tabindex="-1" onclick="setWeeklyView\(&#39;lagging&#39;\)" aria-controls="oh-panel-lagging" onkeydown="ohTabKey\(event\)"/);
  assert.match(m, /role="tab" id="oh-tab-supply" aria-selected="false" tabindex="-1"[^>]*aria-controls="oh-panel-supply"/);
  assert.match(m, /<div class="oh-panel" role="tabpanel" id="oh-panel-leading" aria-labelledby="oh-tab-leading">/);
  assert.match(m, /<div class="oh-panel" role="tabpanel" id="oh-panel-lagging" aria-labelledby="oh-tab-lagging" hidden>/);
  assert.match(m, /<div class="oh-panel" role="tabpanel" id="oh-panel-supply" aria-labelledby="oh-tab-supply" hidden>/);
  // The tabs are the page's main switch: right under the page head, at the left of the filter row (before the
  // filter pills). The cards live in their tab; the Lines card is the last card of the Leading grid.
  assert.ok(m.indexOf('class="dz-pagehead') < m.indexOf('role="tablist"') && m.indexOf('role="tablist"') < m.indexOf('class="dz-filters"'));
  const atRisk = m.indexOf('data-focus-key="tile-late"');
  assert.ok(m.indexOf('id="oh-panel-leading"') < atRisk && atRisk < m.indexOf('id="linked-lines"') && m.indexOf('id="linked-lines"') < m.indexOf('id="oh-panel-lagging"'));
  // Right arrow shows Lagging and focuses its tab; a Leading card gives way to OTD.
  const focused = [];
  page.ctx.document.getElementById('oh-tab-lagging').focus = () => focused.push('lagging');
  let prevented = false;
  page.run('ohTabKey')({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.deepEqual([page.run('weeklyView'), page.run('weeklyTileFilter'), focused, prevented], ['lagging', 'otd3mo', ['lagging'], true]);
  assert.match(html(page), /id="oh-panel-leading" aria-labelledby="oh-tab-leading" hidden>/);
  assert.match(html(page), /id="oh-panel-lagging" aria-labelledby="oh-tab-lagging">[\s\S]*?>Monthly<\/h2>/);
  // Lagging shows figures only (2v6.9): the Lines card stays with Leading.
  assert.doesNotMatch(html(page), /id="linked-lines"/);
  page.run("ohTabKey({key:'End'})");
  assert.equal(page.run('weeklyView'), 'supply', 'End: the last tab');
  page.run("ohTabKey({key:'Home'})");
  assert.equal(page.run('weeklyView'), 'leading');
  assert.equal(page.run('weeklyTileFilter'), 'late');
  assert.match(html(page), /id="linked-lines"/);
  page.run("ohTabKey({key:'Tab'})");
  assert.equal(page.run('weeklyView'), 'leading', 'other keys are left alone');
  // 2v6: Leading always lists a card: clicking the picked card again falls back to At Risk; Lagging then picks OTD.
  page.run("setWeeklyTileFilter('st-ontrack');setWeeklyTileFilter('st-ontrack')");
  assert.equal(page.run('weeklyTileFilter'), 'late');
  page.run("setWeeklyView('lagging')");
  assert.equal(page.run('weeklyTileFilter'), 'otd3mo');
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
test('Lagging: perfect order and average days late on the Monthly card, late orders by reason, built only when the tab is open', async () => {
  const page = await withOverrides();
  page.run('var built=0;var realPerfect=perfectOrderStats;perfectOrderStats=function(){built++;return realPerfect.apply(this,arguments)}');
  page.run('renderResults()');
  assert.equal(page.run('built'), 0, 'the default tab does not score perfect orders');
  assert.doesNotMatch(html(page), /data-focus-key="tile-perfect"/);
  page.run("setWeeklyView('lagging')");
  // 2v6.9: the Monthly / Quarterly cards and the Trend card each score their own lines, once per metrics.
  assert.ok(page.run('built') >= 1);
  page.run('built=0;renderResults()');
  assert.equal(page.run('built'), 0, 'a Lagging redraw reuses the scores');
  const x = page.run('(()=>{const x=ohLaggingExtras(currentMetrics());return {rate:x.perfect.rate,perfect:x.perfect.perfect.map(r=>r.documentNumber),scored:x.perfect.scored.length,avg:x.daysLate.avg,late:x.daysLate.late.map(r=>r.documentNumber),scoredDeliveries:x.daysLate.scored.length,notPerfectCause:x.perfect.totals.us.lines}})()');
  assert.deepEqual(x, { rate: 25, perfect: ['201'], scored: 4, avg: 7.3, late: ['202', '200', '203'], scoredDeliveries: 4, notPerfectCause: 3 });
  // Same rule as the Metrics page.
  assert.equal(x.rate, page.run('realPerfect(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).rate'));
  // The Monthly card (August 2026, every delivery of the fixture) shows the same numbers, the counts in the tips.
  const lag = html(page).slice(html(page).indexOf('id="oh-panel-lagging"'));
  const monthly = lag.match(/<section class="dz-card[^"]*ohg-card[^"]*"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>Monthly<\/h2><span class="dz-meta">August 2026<\/span>[\s\S]*?<\/section>/)[0];
  const tile = (label) => monthly.match(new RegExp(`<div class="dz-stat ohg-tile" data-tip="([^"]*)"><div class="dz-stat-l">${label}</div><div class="dz-stat-v"[^>]*>([^<]*)</div>`)).slice(1);
  assert.deepEqual(tile('Perfect order'), ['Perfect order, August 2026: 25%\n• 1 of 4 completed lines on time, never rescheduled\n• July 2026: none', '25%']);
  assert.deepEqual(tile('Avg days late'), ['Avg days late, August 2026: 7.3\n• 3 late delivery lines of 4 scored\n• July 2026: none scored', '7.3']);
  // 2v6.9 (owner): the Lagging tiles are figures, not buttons, so there is no Lines card and no Us / Them line on them;
  // why orders were late is the Trend card's list (each late order under the first reason of its late delivery).
  assert.doesNotMatch(lag, /id="linked-lines"|cause-text-|<button[^>]*data-focus-key="tile-(perfect|dayslate|otd3mo|fillrate)"/);
  // Lagging, Version 1 (owner): the Metrics tiles are gone, "Late orders by cause" with them; the reasons are a list in
  // the side panel of the Trend card, under the newest month with a shipment (August: nothing shipped in September yet).
  assert.doesNotMatch(lag, /class="mwm-kpi[ "]|mwm-kpi-(l|v|cause)|Late orders by cause/);
  const trend = lag.match(/<section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend">[\s\S]*?<\/section>/)[0];
  const side = trend.slice(trend.indexOf('<div class="ohgt-side">'));
  // The side panel leads with the picked metric (On Time) for that month: 1 of 4 deliveries on time, and no change
  // beside it because nothing was scored in July.
  assert.match(side, /^<div class="ohgt-side">\s*<h3 data-tip="Shipped by the original date\.">On-time delivery · August<\/h3>\s*<div class="ohgt-now"><span>25%<\/span><\/div>/);
  const why = side.match(/<div class="ohgt-why">([\s\S]*?)<\/div>/)[1];
  assert.match(why, /^<h3 data-tip="Each late order under the first reason on its late delivery\.">Why orders were late · August<\/h3><ul class="mwm-causes">/);
  assert.equal(lag.split('<ul class="mwm-causes">').length - 1, 1, 'one list of reasons on Lagging');
  // Each reason and its number, most orders first: 200 and 203 shipped late with no reschedule, 202 after its commit.
  assert.deepEqual([...why.matchAll(/<li data-tip="([^"]+)"><span class="mwm-cause-l">([^<]+)<\/span><b class="mwm-cause-v">(\d+)<\/b><\/li>/g)].map((x) => [x[1], x[2], x[3]]),
    [['Past due · No reschedule: 2 orders of 3 late in August.', 'Past due · No reschedule', '2'], ['Missed commit: 1 order of 3 late in August.', 'Missed commit', '1']]);
  assert.equal((why.match(/<li\b/g) || []).length, 2, 'nothing in the list but the two reasons');
  // The list is the page's own count: the late orders of the month, each once, the same number the chart's dot gives.
  assert.deepEqual(page.run('(()=>{const d=mwmMetricsData(currentMetrics());return {month:d.months[d.L].date.getMonth()+1,causes:d.causes,late:d.lateOrders,monthLate:d.months[d.L].lateOrders}})()'),
    { month: 8, causes: [['Past due · No reschedule', 2], ['Missed commit', 1]], late: 3, monthLate: 3 });
  assert.match(trend, /<span class="mwm-pt"[^>]*data-tip="August 2026: On-time delivery 25%\n• 4 orders shipped\n• 3 orders late"><\/span>/);
  // Owner: no total line under the reasons, no chart in the list.
  assert.doesNotMatch(why, /late orders in August|\b3 late orders\b|\bTotal\b/i);
  assert.doesNotMatch(why, /dz-barrow|<svg/);
  // The line under the list is the report month so far and the year to date (the four August deliveries: $3,000).
  assert.match(side, /<p class="ohgt-sofar" data-tip="September so far\n• 0 orders shipped, \$0 on 0 delivery lines\n• Year to date: \$3,000 on 4 delivery lines"><b>September so far:<\/b> 0 orders · \$0 shipped · year to date \$3K<\/p>/);
  // The page's Warehouse filter narrows the list with the rest of Lagging: CM - DSM has one open line and no delivery,
  // so the card says so in words instead of drawing an empty list.
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  const dsm = html(page).slice(html(page).indexOf('id="oh-panel-lagging"'));
  assert.match(dsm, /<h3[^>]*>Why orders were late · August<\/h3><p class="ohgt-none">No late orders\.<\/p>/);
  assert.doesNotMatch(dsm, /<ul class="mwm-causes">/);
  assert.match(dsm, /<div class="ohgt-now"><span>—<\/span><\/div>/);
  assert.deepEqual(page.errors, []);
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

// 2v6.9 (owner, 96c6ae9 / 6401b31): Top offenders and its $20k waffle left the page. Version 1 (owner's pick, "Who?"):
// Customers at risk is one table: each customer's open orders (past due, at risk otherwise, all open) and, when
// purchase-order lines or a supply / demand snapshot are loaded, their at-risk orders under the first supply source in
// trouble. The separate "Customers at risk by supply source" card and its source pills are gone: the last row, All
// Customers, carries the totals and the source numbers the pills were.
test('Customers at risk is one ranked table: each customer\'s open orders and their at-risk orders by supply source; a row filters the page to it, a number lists its lines; a vendor pick opens Purchase Orders', async () => {
  const rows = [...ROWS,
    open('110', { ...due('08/02/2026'), AmountLocal: '45,000.00', CustomerVendorCode: 'PATRICK', CustomerVendorName: 'Patrick' }),
    sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...due('08/10/2026'), AmountLocal: '30,000.00' })];
  const page = await loaded(rows);
  setStatus(page, '106', 'Hold');
  const m = html(page);
  assert.doesNotMatch(m, /aria-label="Top offenders"|class="waffle-row/);
  // The card: question 3, the full width, "Most at-risk orders first".
  const who = () => html(page).match(/<section class="dz-card dz-span-6 ohl-card ohl-who[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.match(who(), /^<section[^>]*><div class="dz-card-head"><h2 class="dz-title" data-tip="[^"]{20,}">Customers at risk<\/h2><span class="dz-meta">Most at-risk orders first<\/span><\/div><div class="sup-scroll" tabindex="0" role="region" aria-label="Customers at risk"><table class="ohc2-tbl ohc3-tbl src">/);
  assert.ok(m.indexOf('<h2 class="ohl-q-t" data-tc-skip>Who?</h2>') > 0 && m.indexOf('<h2 class="ohl-q-t" data-tc-skip>Who?</h2>') < m.indexOf(who()));
  // The old supply source card is gone (its numbers are columns here); one table on the card, no money in it.
  assert.doesNotMatch(m, /Customers at risk by supply source|class="(?:[^"]* )?(?:ohl-sup|ohl-sup-sum|ohl-sup-pill|ohl-sup-row|ohl-sup-name|ohl-sup-n)[ "]|ohlToggleSupplyAll|data-dzpager="ohl-supply"/);
  assert.equal(who().split('<table').length - 1, 1);
  const tbl = () => who().match(/<table class="ohc2-tbl ohc3-tbl src">[\s\S]*?<\/table>/)[0];
  const card = tbl();
  assert.doesNotMatch(card, /\$/);
  // Headings: a group row over the columns (this export has purchase-order lines), then the nine columns; every one
  // has a tip, the four sources a coloured dot.
  const heads = (tr) => [...tr.matchAll(/<th scope="(col|colgroup)"(?: colspan="(\d)")?(?: class="num")? data-tip="[^"]{20,}">(<i class="ohl-dot" style="background:[^"]+" aria-hidden="true"><\/i>)?([^<]+)<\/th>/g)];
  const [grp, cols] = card.match(/<thead>([\s\S]*?)<\/thead>/)[1].split('</tr>');
  assert.match(grp, /^<tr class="ohc3-grp"><td><\/td><th scope="colgroup"/);
  assert.deepEqual(heads(grp).map((x) => [x[4], +x[2]]), [['Open orders', 3], ['At-risk orders by supply source', 5]]);
  assert.deepEqual(heads(cols).map((x) => [x[4], !!x[3]]), [['Customer', false], ['Past due', false], ['At risk', false], ['Open', false],
    ['Pull in', true], ['Late / no commit', true], ['Stock short', true], ['Not supply', true], ['Split', false]]);
  assert.equal((card.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th\b/g) || []).length, 11, 'every heading is one of the eleven tipped ones');
  // Every heading cell of the table, the row headings too, has a tip of its own or holds a tipped button.
  assert.deepEqual([...card.matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th>/g)].filter((x) => !/\sdata-tip="[^"]{20,}"/.test(x[1]) && !/^<button [^>]*\sdata-tip="[^"]{20,}"/.test(x[2])).map((x) => x[0]), []);
  const row = (code) => tbl().match(new RegExp(`<tr class="ohc2-tr[^"]*"><th scope="row"><button type="button" class="ohc2-name" data-focus-key="offrow-${code}"[\\s\\S]*?</tr>`))[0];
  const nums = (tr) => [...tr.matchAll(/<td class="num[^"]*">(\d+)<\/td>/g)].map((x) => +x[1]);
  // The four source cells of a row: a dash where the customer has none, else a button with its orders.
  const sources = (tr) => [...tr.matchAll(/<td class="num ohc3-zero" data-tip="[^"]+: none">—<\/td>|<td class="num"><button type="button" class="ohc3-n[^"]*" data-focus-key="ohl-sup-(?:\w+)-(\w+)"[^>]*>(\d+)<\/button><\/td>/g)].map((x) => (x[1] ? `${x[1]} ${x[2]}` : '—'));
  // Most at-risk orders first, then value. Firefly: 8 open orders, 5 at risk (100, 106, 108 past due; 102, 109 rescheduled).
  assert.deepEqual([...card.matchAll(/class="ohc2-name" data-focus-key="offrow-(\w+)" data-off="\1"/g)].map((x) => x[1]), ['FIREFLY', 'PATRICK', 'AQUHOT', 'BARLETTA']);
  assert.deepEqual(nums(row('FIREFLY')), [3, 2, 8]);
  assert.deepEqual(nums(row('PATRICK')), [1, 0, 1]);
  assert.deepEqual(nums(row('AQUHOT')), [0, 1, 1]); // no commit date, not past due
  assert.deepEqual(nums(row('BARLETTA')), [1, 0, 1]);
  assert.match(row('FIREFLY'), /data-tip="FIREFLY - Firefly RV\n• 5 of 8 open orders at risk \(63%\)\n• 3 orders past due · 2 orders at risk otherwise\n• 5 at-risk lines\nClick to filter to it\."/);
  assert.match(row('FIREFLY'), /<span class="ohc2-split" aria-hidden="true"><i class="pd" style="width:37\.5%"><\/i><i class="ar" style="width:25\.0%"><\/i><\/span><\/button><\/th><td class="num ohc2-pd">3<\/td><td class="num ohc2-ar">2<\/td><td class="num">8<\/td>/);
  // By supply source: PO 700 (the one purchase-order line, due Aug 10, not received) covers this item's earliest order,
  // Patrick's 110 (due Aug 2), and is late; every other at-risk order has no supply in trouble.
  assert.deepEqual(['FIREFLY', 'PATRICK', 'AQUHOT', 'BARLETTA'].map((c) => sources(row(c))),
    [['—', '—', '—', 'none 5'], ['—', 'po 1', '—', '—'], ['—', '—', '—', 'none 1'], ['—', '—', '—', 'none 1']]);
  assert.ok(row('PATRICK').includes('<td class="num"><button type="button" class="ohc3-n" data-focus-key="ohl-sup-PATRICK-po" data-off="PATRICK" aria-pressed="false" aria-label="PATRICK - Patrick, Late / no commit: 1 order" onclick="ohlSupplyPick(this.dataset.off,\'po\')" data-tip="Late / no commit: 1 order, 1 line\n• SO 110 SPY-100: PO 700 ACME - Acme Parts: late since Aug 10\nClick to list them.">1</button></td>'));
  assert.match(row('FIREFLY'), /<button type="button" class="ohc3-n quiet" data-focus-key="ohl-sup-FIREFLY-none" data-off="FIREFLY" aria-pressed="false" aria-label="FIREFLY - Firefly RV, Not supply: 5 orders" onclick="ohlSupplyPick\(this\.dataset\.off,'none'\)" data-tip="Not supply: 5 orders, 5 lines\nClick to list them\.">5<\/button>/);
  assert.match(row('PATRICK'), /<td class="ohc3-split"><span class="ohl-sup-bar" aria-hidden="true"><i style="width:100\.0%;background:var\(--dz-amber\)"><\/i><\/span><\/td><\/tr>$/);
  // The last row is every customer: distinct orders (5 past due, 3 at risk otherwise, 11 open), then the source totals
  // as buttons (the old source pills) and their split: 1 of the 8 at-risk orders waits on a late PO.
  const foot = () => tbl().match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1];
  assert.match(foot(), /^<tr class="ohc3-all"><th scope="row" data-tip="Every customer together\. An order counts once, so these can be less than the rows added up\.">All Customers<\/th><td class="num ohc2-pd">5<\/td><td class="num ohc2-ar">3<\/td><td class="num">11<\/td>/);
  assert.deepEqual(sources(foot()), ['—', 'po 1', '—', 'none 7']);
  assert.deepEqual([...foot().matchAll(/data-focus-key="(ohl-sup-src-\w+)"/g)].map((x) => x[1]), ['ohl-sup-src-po', 'ohl-sup-src-none']);
  assert.ok(foot().includes('<button type="button" class="ohc3-n" data-focus-key="ohl-sup-src-po" aria-pressed="false" aria-label="All Customers, Late / no commit: 1 order" onclick="ohlSupplyPick(\'\',\'po\')" data-tip="Late / no commit: 1 order\n• The PO that covers it is late or has no commit date.\n• Click to list the lines.">1</button>'));
  assert.match(foot(), /data-focus-key="ohl-sup-src-none"[^>]*aria-label="All Customers, Not supply: 7 orders"[^>]*data-tip="Not supply: 7 orders\n• Supply looks fine: at risk for their own dates or overrides\.\n• Click to list the lines\.">7<\/button>/);
  assert.match(foot(), /<td class="ohc3-split"><span class="ohl-sup-bar" aria-hidden="true"><i style="width:12\.5%;background:var\(--dz-amber\)"><\/i><i style="width:87\.5%;background:var\(--dz-ink-6\)"><\/i><\/span><\/td><\/tr>$/);
  assert.deepEqual(page.run('(()=>{const d=ohlSupplyData(currentMetrics());return [d.hasSources,Object.fromEntries(Object.entries(d.tot).map(([k,v])=>[k,v.size]))]})()'), [true, { pull: 0, po: 1, stock: 0, none: 7 }]);
  // Five customers or fewer: no pager under the table, and no "load supply data" note.
  assert.doesNotMatch(who(), /data-dzpager="ohl-customers"|Load purchase-order lines/);
  // A number lists its lines in the Lines card and stays pressed; the same number again shows the at-risk lines again.
  const listed = () => [...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((x) => x[1]).sort();
  assert.deepEqual(listed(), ['100', '101', '102', '103', '106', '108', '109', '110']);
  page.run("ohlSupplyPick('PATRICK','po')");
  assert.deepEqual([page.run('weeklyTileFilter'), page.run('ohlSupPick'), listed()], ['ohlsup', { cust: 'PATRICK', src: 'po' }, ['110']]);
  assert.match(row('PATRICK'), /class="ohc3-n sel" data-focus-key="ohl-sup-PATRICK-po" data-off="PATRICK" aria-pressed="true"[^>]*data-tip="Late \/ no commit: 1 order, 1 line\n[^"]*\nClick to show the at-risk lines again\."/);
  assert.equal((tbl().match(/aria-pressed="true"/g) || []).length, 1, 'only the picked number is pressed');
  page.run("ohlSupplyPick('PATRICK','po')");
  assert.deepEqual([page.run('weeklyTileFilter'), page.run('ohlSupPick'), listed().length], ['late', null, 8]);
  // A number of the All Customers row lists that source for every customer; the Lines card's Clear goes back.
  page.run("ohlSupplyPick('','none')");
  assert.deepEqual(listed(), ['100', '101', '102', '103', '106', '108', '109']);
  assert.match(foot(), /class="ohc3-n quiet sel" data-focus-key="ohl-sup-src-none" aria-pressed="true"/);
  page.run('ohlSupplyClear()');
  assert.deepEqual([page.run('weeklyTileFilter'), page.run('ohlSupPick'), listed().length], ['late', null, 8]);
  page.run("ohlSupplyPick('','')");
  assert.equal(page.run('weeklyTileFilter'), 'late', 'no customer and no source: nothing to pick');
  // A customer name filters the page to it; the same name again clears it.
  page.run("setWeeklyOffenderFilter('customers','PATRICK')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['PATRICK']);
  assert.match(html(page), /<tr class="ohc2-tr sel"><th scope="row"><button type="button" class="ohc2-name" data-focus-key="offrow-PATRICK"[^>]*aria-pressed="true"/);
  // The table follows the page's filters, the All Customers row with it.
  assert.match(foot(), /^<tr class="ohc3-all"><th scope="row"[^>]*>All Customers<\/th><td class="num ohc2-pd">1<\/td><td class="num ohc2-ar">0<\/td><td class="num">1<\/td>/);
  page.run("setWeeklyOffenderFilter('customers','PATRICK')");
  assert.deepEqual(page.run('weeklyCustomerFilter'), ['ALL']);
  // Without purchase-order lines or a supply / demand snapshot: the first four columns only, and a note says what to load.
  const plain = await loaded(rows.slice(0, -1));
  const bare = html(plain).match(/<section class="dz-card dz-span-6 ohl-card ohl-who[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.match(bare, /<table class="ohc2-tbl ohc3-tbl"><thead><tr><th scope="col" data-tip="[^"]{20,}">Customer<\/th>/);
  assert.deepEqual([...bare.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((x) => x[1]), ['Customer', 'Past due', 'At risk', 'Open']);
  assert.doesNotMatch(bare, /ohc3-grp|ohc3-n|ohc3-zero|ohc3-split|ohl-sup-bar/);
  assert.match(bare, /<tfoot><tr class="ohc3-all"><th scope="row"[^>]*>All Customers<\/th><td class="num ohc2-pd">5<\/td><td class="num ohc2-ar">3<\/td><td class="num">11<\/td><\/tr><\/tfoot>/);
  assert.match(bare, /<p class="ohl-note ohl-foot-note">Load purchase-order lines or the supply \/ demand snapshot to see which supply source holds each customer's orders\.<\/p>/);
  assert.equal(plain.run('ohlSupplyData(currentMetrics()).hasSources'), false);
  assert.deepEqual(plain.errors, []);
  // The vendors branch of the same setter (no control on the page draws it now) still opens that vendor's late POs.
  page.run("setWeeklyOffenderFilter('vendors','ACME')");
  assert.deepEqual([page.run('activeTab'), page.run('poVendorFilter'), page.run('poTileFilter')], ['purchaseorders', ['ACME'], 'late']);
  assert.deepEqual(page.errors, []);
});

// --- Search, tables, tips, About ---------------------------------------------------------------------------
test('Search finds lines by reason or cause, and tables show each line\'s reasons (the cause as its colour)', async () => {
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
  // 2v4 (ohLineWhy): the words Us / Them are no longer shown; the line shows its reasons (the cause stays in the data
  // for Search and the AI tools, and in the text colour class).
  assert.match(html(page), /<span class="oh-why cause-text-them" data-tip="Reasons: Past due · No reschedule, Hold\.">Past due · No reschedule<\/span><span class="timing oh-why-more">Hold<\/span>/);
  page.ctx.firstFlagged = { [key(page, '106')]: '2026-07-02' };
  page.run('renderResults()');
  assert.match(html(page), /data-tip="Reasons: Past due · No reschedule, Hold\. First at risk: week of 2026-07-02\.">Past due · No reschedule<\/span><span class="timing oh-why-more">Hold · first at risk in the 2026-07-02 upload<\/span>/);
  page.run("setTab('weekly');weeklyTileFilter='late';renderResults()");
  assert.match(html(page), /<span class="oh-why cause-text-us"[^>]*>No commit date<\/span>(?!<span class="timing oh-why-more">)/);
});

test('every new control and chart carries a plain-English tip with full numbers; markup stays balanced', async () => {
  const page = await withOverrides();
  page.run("setWeeklyCauseFilter('us')");
  for (const view of ['leading', 'lagging']) {
    page.run(`setWeeklyView('${view}')`);
    const m = html(page);
    // 2v6 controls: the tabs and chips; Leading: the At risk hero, its states, warehouse, override bars and tiles, the
    // Status segments and its row of cells, the Top reasons names and columns, the past-due chip of Open lines by due
    // week, Customers at risk, the Date changes rows and the two month folds; Lagging: the Monthly / Quarterly figures.
    const controls = [...m.matchAll(/<button [^>]*(?:role="tab"|class="(?:chip active oh-chip|ohl-hero|dz-stat ohl-stat|ohl-wh|dz-barrow|ohl-tile|ohs2-seg|ohs3-cell|ohu-name|ohu-col|dz-chip red ohl-chipbtn|ohc2-name|ohc3-n|ohl-pull-po|dz-tr ohl-dc-row))[^>]*>/g)].map((x) => x[0])
      .concat([...m.matchAll(/<div class="dz-stat ohg-tile"[^>]*>|<summary data-focus-key="more-ohl-fold-[^>]*>/g)].map((x) => x[0]));
    // Leading with the Us filter on: 3 tabs, the Cause chip, the hero, 3 states, the warehouse, 6 tiles, 2 Status parts
    // and 5 cells, 5 reasons in 3 sets, the past-due chip, 3 customers, 1 date change and the 2 folds.
    if (view === 'leading') assert.equal(controls.length, 37);
    else assert.ok(controls.length >= 13, `${view}: ${controls.length}`);
    for (const c of controls) assert.match(c, /data-tip="[^"]{20,}"/, c.slice(0, 120));
    if (view === 'leading') {
      // Nothing left of the controls this layout replaced.
      assert.doesNotMatch(m, /class="ohs2-row|class="ohl-sup-(pill|name|n)[ "]|class="(?:[^"]* )?ohl-notshipped[ "]/);
      // Every heading of the customer table explains itself too (no supply data here: four columns).
      const who = m.match(/<table class="ohc2-tbl ohc3-tbl">[\s\S]*?<\/table>/)[0];
      assert.deepEqual([...who.matchAll(/<th scope="col"(?: class="num")? data-tip="[^"]{20,}">([^<]+)<\/th>/g)].map((x) => x[1]), ['Customer', 'Past due', 'At risk', 'Open']);
      assert.equal((who.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th\b/g) || []).length, 4);
    }
    // Full numbers in the tips: the At risk hero with the Us cause filter on (100, 101 and 103).
    if (view === 'leading') assert.match(m, /data-focus-key="tile-late"[^>]*data-tip="At risk, due by Oct 3\n• 3 orders, 3 lines\n• \$22,000 open\nClick to list them\."/);
    else assert.match(m, /data-tip="Avg days late, August 2026: 7\.3\n• 3 late delivery lines of 4 scored/);
    const count = (needle) => m.split(needle).length - 1;
    for (const tag of ['div', 'section', 'button', 'span', 'details', 'table', 'tr', 'td']) {
      assert.equal(count(`<${tag} `) + count(`<${tag}>`), count(`</${tag}>`), `${view}: unbalanced <${tag}>`);
    }
    assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|\[object Object\]/);
  }
  assert.deepEqual(page.errors, []);
  // With a purchase-order line due after the order it covers (PO 700, due Sep 30; 106 needs it by Aug 10), Leading draws
  // its other new controls: the customer table's supply source numbers, and "What can we do" as two lists behind a switch.
  const sup = await loaded([...ROWS, sapRow({ SourceType: 'Purchase Order', OrderType: 'Purchase Order', KPIArea: 'Purchase Orders', DocumentNumber: '700', CustomerVendorCode: 'ACME', CustomerVendorName: 'Acme Parts', ...due('09/30/2026'), AmountLocal: '30,000.00' })]);
  setStatus(sup, '106', 'Hold');
  setStatus(sup, '107', 'Urgent');
  setStatus(sup, '108', 'Not At Risk');
  const balanced = (m, what) => {
    const count = (needle) => m.split(needle).length - 1;
    for (const tag of ['div', 'section', 'button', 'span', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']) assert.equal(count(`<${tag} `) + count(`<${tag}>`), count(`</${tag}>`), `${what}: unbalanced <${tag}>`);
    assert.doesNotMatch(m.replace(/<[^>]+>/g, ' '), /\bundefined\b|\bNaN\b|\[object Object\]/);
  };
  const act = () => html(sup).match(/<section class="dz-card dz-span-6 ohl-card ohl-do[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  const m = html(sup);
  balanced(m, 'supply to pull in');
  // The supply source numbers: one for each customer and source with orders, and the same for All Customers. Each says
  // what it counts in full and names itself for a screen reader (the number alone would not).
  const srcButtons = [...m.matchAll(/<button type="button" class="ohc3-n[^"]*" data-focus-key="(ohl-sup-[^"]+)"(?: data-off="[^"]+")? aria-pressed="false" aria-label="([^"]+)" onclick="[^"]+" data-tip="([^"]{20,})">(\d+)<\/button>/g)].map((x) => x.slice(1));
  assert.deepEqual(srcButtons.map((x) => [x[0], x[1], +x[3]]), [
    ['ohl-sup-FIREFLY-pull', 'FIREFLY - Firefly RV, Pull in: 1 order', 1], ['ohl-sup-FIREFLY-none', 'FIREFLY - Firefly RV, Not supply: 3 orders', 3],
    ['ohl-sup-AQUHOT-none', 'AQUHOT - Aqua Hot, Not supply: 1 order', 1], ['ohl-sup-BARLETTA-none', 'BARLETTA - Barletta, Not supply: 1 order', 1],
    ['ohl-sup-src-pull', 'All Customers, Pull in: 1 order', 1], ['ohl-sup-src-none', 'All Customers, Not supply: 5 orders', 5]]);
  assert.equal((m.match(/<button type="button" class="ohc3-n/g) || []).length, 6);
  assert.equal(srcButtons[0][2], 'Pull in: 1 order, 1 line\n• SO 106 SPY-100: PO 700 ACME - Acme Parts: due Sep 30, needed by Aug 10 (51d)\nClick to list them.');
  assert.equal(srcButtons[4][2], 'Pull in: 1 order\n• The PO that covers it is due after the order: ask for an earlier date.\n• Click to list the lines.');
  // The eleven headings of the table with its supply columns, each with a tip; a dash cell says which source has none.
  const who = m.match(/<table class="ohc2-tbl ohc3-tbl src">[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...who.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th scope="col(?:group)?"(?: colspan="\d")?(?: class="num")? data-tip="[^"]{20,}">(?:<i[^>]*><\/i>)?([^<]+)<\/th>/g)].map((x) => x[1]),
    ['Open orders', 'At-risk orders by supply source', 'Customer', 'Past due', 'At risk', 'Open', 'Pull in', 'Late / no commit', 'Stock short', 'Not supply', 'Split']);
  assert.equal((who.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th\b/g) || []).length, 11);
  assert.deepEqual([...new Set([...who.matchAll(/<td class="num ohc3-zero" data-tip="([^"]+)">—<\/td>/g)].map((x) => x[1]))], ['Late / no commit: none', 'Stock short: none', 'Pull in: none']);
  // The switch: two named choices with their counts; the card takes the shown list's title, tip and name.
  assert.match(act(), /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-pull dz-fade" style="--i:5" aria-label="Supply to pull in"><div class="dz-card-head"><h2 class="dz-title" data-tip="PO lines due after the orders they cover\n• Matched to orders by date\n• Ask the vendor or CM for an earlier date\nClick a PO to list its lines\.">Supply to pull in<\/h2><span class="dz-meta"><div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do">/);
  const choices = () => [...act().matchAll(/<button type="button" data-focus-key="(ohl-do-\w+)"( class="on")? aria-pressed="(true|false)" onclick="ohlSetDoView\(&#39;(\w+)&#39;\)" data-tip="([^"]+)">([^<]+)<\/button>/g)].map((x) => [x[1], !!x[2], x[3], x[4], x[5], x[6]]);
  assert.deepEqual(choices(), [['ohl-do-pull', true, 'true', 'pull', 'PO lines to ask for earlier.', 'Supply to pull in · 1'], ['ohl-do-dates', false, 'false', 'dates', 'Customers whose dates moved later.', 'Date changes · 3 lines']]);
  assert.match(act(), /<button type="button" class="ohl-pull-po" data-focus-key="ohl-pull-[^"]+" data-off="[^"]+" aria-pressed="false" onclick="ohlPullPick\(this\.dataset\.off\)" data-tip="PO 700: pull in 51 days\n• 1 at-risk order · \$5,000\n• Due Sep 30, needed by Aug 10\nClick to list those lines\.">PO 700<\/button>/);
  assert.doesNotMatch(act(), /ohl-dc-row/);
  sup.run("ohlSetDoView('dates')");
  balanced(html(sup), 'date changes');
  assert.match(act(), /^<section class="dz-card dz-span-6 ohl-card ohl-do ohl-dcwrap dz-fade" style="--i:5" aria-label="Date changes"><div class="dz-card-head"><h2 class="dz-title" data-tip="Lines whose date moved over 2 days past due\n• Ready: clear to build\n• Blocked: short or on hold">Date changes<\/h2><span class="dz-meta"><div class="dz-seg sup-seg-sm" role="group" aria-label="What we can do">/);
  assert.deepEqual(choices().map((x) => [x[0], x[1], x[2]]), [['ohl-do-pull', false, 'false'], ['ohl-do-dates', true, 'true']]);
  assert.doesNotMatch(act(), /ohl-pull-tbl|ohl-pull-po/);
  // Firefly's 102 and 109 moved a month later, Barletta's 103 from Aug 5 to Aug 28.
  assert.deepEqual([...act().matchAll(/<button type="button" class="dz-tr ohl-dc-row" data-focus-key="dc-(\w+)" data-off="\1" onclick="setWeeklyOffenderFilter\('customers',this\.dataset\.off\)" aria-pressed="false" data-tip="([^"]{20,})">/g)].map((x) => [x[1], x[2].split('\n').slice(0, 2).join(' ')]),
    [['FIREFLY', 'FIREFLY - Firefly RV • 2 lines, $8,500 moved later'], ['BARLETTA', 'BARLETTA - Barletta • 1 line, $4,000 moved later']]);
  // A value that is not a list falls back to Supply to pull in.
  sup.run("ohlSetDoView('sideways')");
  assert.deepEqual([sup.run('ohlDoView'), choices().map((x) => x[1])], ['pull', [true, false]]);
  assert.deepEqual(sup.errors, []);
});

test('About these numbers defines every new number in plain English', async () => {
  const page = await loaded();
  // 2v6: an (i) summary named by aria-label; the bullets sit in .about-body.
  const about = html(page).match(/<details class="about rise"><summary aria-label="About these numbers" data-tip="[^"]{20,}">[\s\S]*?<span class="about-l">About these numbers<\/span><\/summary>[\s\S]*?<\/details>/)[0];
  // Short: 3 to 5 bullets with the definitions people need (the cards' own tips carry the rest).
  const bullets = about.match(/<li>/g) || [];
  assert.ok(bullets.length >= 3 && bullets.length <= 5, `${bullets.length} bullets`);
  // 2v4 / 2v6.9: Us / Them are no longer shown, and Reschedule hit is defined in its Lagging tile's own tip.
  for (const term of ['At risk', 'On track', 'OTD', 'Fill rate', 'When flagged', '90%']) {
    assert.ok(about.includes(term), term);
  }
  for (const li of about.match(/<li>[\s\S]*?<\/li>/g)) assert.ok(li.replace(/<[^>]+>/g, '').split(/\s+/).length <= 25, li);
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
  // at_risk is the At risk card (lines due by its date); at_risk_any_date counts every at-risk line, as leading does.
  assert.deepEqual(oh.at_risk.cause, { us: { lines: 3, orders: 3, value: 22000 }, them: { lines: 1, orders: 1, value: 5000 }, neutral: { lines: 0, orders: 0, value: 0 }, not_set: { lines: 2, orders: 2, value: 8500 } });
  assert.deepEqual(oh.at_risk_any_date.cause, { us: { lines: 3, orders: 3, value: 22000 }, them: { lines: 2, orders: 2, value: 6500 }, neutral: { lines: 0, orders: 0, value: 0 }, not_set: { lines: 2, orders: 2, value: 8500 } });
  assert.equal(Object.values(oh.at_risk_any_date.cause).reduce((s, c) => s + c.lines, 0), oh.at_risk_any_date.lines);
  assert.equal(Object.values(oh.at_risk.cause).reduce((s, c) => s + c.lines, 0), oh.at_risk.lines);
  assert.deepEqual(oh.leading.at_risk_by_cause, oh.at_risk_any_date.cause);
  assert.deepEqual(Object.keys(oh.leading.states), ['on_track', 'due_this_week', 'rescheduled', 'past_due', 'no_commit']);
  assert.equal(Object.values(oh.leading.states).reduce((s, x) => s + x.lines, 0), oh.all_open.lines);
  assert.deepEqual(oh.leading.top_reasons[0], { reason: 'Past due · No reschedule', usual_cause: 'us', orders: 2, lines: 2, open_value: 15000 });
  assert.deepEqual(oh.leading.when_flagged.buckets.map((b) => b.bucket), ['New this week', '1–2 wk', '3–4 wk', '5–8 wk', '9+ wk']);
  assert.equal(oh.leading.when_flagged.history_available, false);
  assert.deepEqual(oh.lagging.perfect_order_12mo, { rate_pct: 25, perfect_lines: 1, completed_lines: 4, not_perfect_by_cause: { us: 3, them: 0, neutral: 0, not_set: 0 }, target_pct: 90 });
  assert.deepEqual(oh.lagging.avg_days_late_3mo, { days: 7.3, late_deliveries: 3, deliveries_scored: 4, late_by_cause: { us: 3, them: 0, neutral: 0, not_set: 0 } });
  assert.deepEqual(oh.lagging.otd_3mo.late_by_cause, { us: 3, them: 0, neutral: 0, not_set: 0 });
  assert.equal(oh.lagging.fill_rate.by_original_due_month.length, 12);
  const them = page.run("aiRunTool('search_lines',{scope:'at_risk',cause:'them'})");
  assert.deepEqual(them.rows.map((r) => r.doc).sort(), ['106', '107']);
  assert.deepEqual(them.rows.find((r) => r.doc === '106').reasons, ['Past due · No reschedule', 'Hold']);
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
  // 2v4 added next_month: the page's next-month view (At risk against its target, On track, reason tiles, top warehouse).
  assert.deepEqual(Object.keys(oh.leading), ['cause_rule', 'at_risk_by_cause', 'open_orders', 'states', 'top_reasons', 'when_flagged', 'next_month']);
  assert.deepEqual(Object.keys(oh.leading.next_month), ['due_by', 'open_value', 'at_risk_pct', 'at_risk_target_pct', 'on_track_tolerance_days', 'at_risk', 'on_track', 'reasons', 'top_problem_warehouse']);
  assert.deepEqual(Object.keys(oh.lagging), ['otd_3mo', 'shipped_this_week', 'fill_rate', 'reschedule_hit_12mo', 'perfect_order_12mo', 'avg_days_late_3mo']);
  assert.equal(oh.at_risk.cause.not_set.lines, 2);
  assert.equal(oh.lagging.perfect_order_12mo.rate_pct, 25);
});

run();
