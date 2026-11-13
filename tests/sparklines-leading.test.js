// Sparklines on Sales Order Health, Leading (owner's pick, Style A through dzSpark): At Risk draws its at-risk orders
// for the last 8 weeks (past weeks from the counts saved with the at-risk history, this week the card's own number) and
// the month's Ship Target the past-due orders it started each of the last 6 months with (rebuilt from the export's
// dates; this month the card's own number). Both follow the page filters, draw nothing with one period, and list every
// period in their tip. Run with `node tests/sparklines-leading.test.js`. Fixtures are synthetic; the report date is
// Thursday 2026-09-03 (week of Monday Aug 31, month of September).
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const closed = (on) => ({ Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0.000', ClosedDate: on, FillStatus: 'Shipped' });
// SO 100: due in March, open: past due at every month start. SO 101: due May 10, closed Jul 20: past due on Jun 1 and
// Jul 1 only. SO 102: due Jun 15 but booked Jul 10: past due from Aug 1. SO 103 (Barletta): due Aug 20, open: this month.
const ROWS = [
  so('100', '03/15/2026', { DocumentDate: '01/05/2026' }),
  so('101', '05/10/2026', { DocumentDate: '04/01/2026', ...closed('07/20/2026') }),
  so('102', '06/15/2026', { DocumentDate: '07/10/2026' }),
  so('103', '08/20/2026', { CustomerVendorCode: 'BARLETTA', CustomerVendorName: 'Barletta Boats' }),
];
async function loaded(rows = ROWS) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}
const html = (page) => page.els['results-screen'].innerHTML;
const card = (h, cls) => {
  const m = new RegExp(`<section class="dz-card(?: [^"]*)? ${cls}(?: [^"]*)?"[^>]*>`).exec(h);
  return m ? h.slice(m.index, h.indexOf('</section>', m.index) + '</section>'.length) : '';
};
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The sparkline in a card: its tip lines (title first) and the number of points on its line, or null with none.
const spark = (c) => {
  const m = /<span class="dz-spark" role="img" tabindex="0" aria-label="[^"]*" data-tip="([^"]*)"><svg[^>]*>([\s\S]*?)<\/svg><\/span>/.exec(c);
  if (!m) return null;
  const line = /<path d="([^"]*)" fill="none"/.exec(m[2]);
  return { tip: unesc(m[1]).split('\n').map((t) => t.replace(/^• /, '')), points: (line[1].match(/[ML]/g) || []).length };
};
const atRiskCard = (page) => card(html(page), 'ohl-card');
const shipCard = (page) => card(html(page), 'ohl-ship');
const heroOrders = (c) => +(/<span class="dz-big sm[^"]*">(\d+) orders?<\/span>/.exec(c) || [])[1];
const week = (asOf, counts) => ({ asOf, savedAt: 's', keys: [], ...(counts ? { counts: { asOf, ...counts } } : {}) });
const setWeeks = (page, weeks) => page.run(`atRiskWeeks=cleanAtRiskWeeks(${JSON.stringify(weeks)});renderResults()`);

test('Ship target: past-due orders at the start of the last 6 months, the last point the card number, red, beside it', async () => {
  const page = await loaded();
  const c = shipCard(page);
  assert.match(c, /<h2[^>]*>September ship target<\/h2>/);
  const s = spark(c);
  assert.ok(s, 'the ship target draws a line');
  assert.equal(s.points, 6);
  assert.equal(heroOrders(c), 3, 'SO 100, 102 and 103 are past due and open');
  assert.deepEqual(s.tip, ['Past-due orders at the start of each month', 'Apr 1: 1 order', 'May 1: 1 order', 'Jun 1: 2 orders', 'Jul 1: 2 orders', 'Aug 1: 2 orders',
    'Sep 1 (still open today): 3 orders', 'Tick: Aug 1']);
  // Beside the big number, in the risk tone.
  assert.match(c, /<div class="mwm-hero"[^>]*><span class="dz-big sm mwm-red">3 orders<\/span><span class="dz-sub">[^<]*<\/span><span class="dz-spark"/);
  assert.match(c, /stroke="var\(--dz-risk\)"/);
  // It follows the page filters as the card's number does: Firefly only.
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  const f = spark(shipCard(page));
  assert.equal(heroOrders(shipCard(page)), 2);
  assert.deepEqual(f.tip.slice(1, 7).map((t) => t.split(': ')[1]), ['1 order', '1 order', '2 orders', '2 orders', '2 orders', '2 orders']);
  // Original dates only (the Dates basis) is the same rule on the other date.
  page.run(`weeklyCustomerFilter=['ALL'];shipScenarioDateBasis='original';renderResults()`);
  assert.equal(spark(shipCard(page)).tip[6], 'Sep 1 (still open today): 3 orders');
  assert.deepEqual(page.errors, []);
});

test('Ship target: the last point is the card number, and no errors with a PO-only export, an empty view, a snapshot or print', async () => {
  // A PO-only export: whatever the card counts, the line ends on it, and At Risk has no line.
  const po = sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: '9', 'Internal Number': '9', CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor' });
  const page = await loaded([po]);
  const sc = shipCard(page);
  if (spark(sc)) assert.match(spark(sc).tip[6], new RegExp(`: ${heroOrders(sc)} orders?$`), 'the last point is the card number');
  assert.doesNotMatch(atRiskCard(page), /class="dz-spark"/);
  const p2 = await loaded();
  p2.run(`weeklyCustomerFilter=['BARLETTA'];renderResults()`);
  assert.equal(heroOrders(shipCard(p2)), 1);
  assert.deepEqual(spark(shipCard(p2)).tip.slice(1, 7).map((t) => t.split(': ')[1]), ['0 orders', '0 orders', '0 orders', '0 orders', '0 orders', '1 order']);
  p2.run(`weeklyCustomerFilter=['ALL'];isSnapshotView=true;renderResults()`);
  assert.ok(spark(shipCard(p2)), 'a snapshot draws the ship target line from its own rows');
  p2.run(`isSnapshotView=false;printMode=true;renderResults();printMode=false`);
  assert.deepEqual([...page.errors, ...p2.errors], []);
});

test('At Risk: last 8 weeks from the saved counts, the last point the card number, a tick at last week', async () => {
  const page = await loaded();
  const n = heroOrders(atRiskCard(page));
  assert.ok(n >= 3);
  assert.equal(spark(atRiskCard(page)), null, 'no saved weeks: only this week, so no line');
  // Weeks saved before counts existed have no point; one week with counts is enough for two points.
  setWeeks(page, [week('2026-08-12'), week('2026-08-19')]);
  assert.equal(spark(atRiskCard(page)), null, 'old weeks without counts draw nothing');
  setWeeks(page, [
    week('2026-06-01', { lines: 40, orders: 30 }), // older than 8 weeks: left out
    week('2026-08-12'),
    week('2026-08-18', { lines: 9, orders: 7, by: { cust: { FIREFLY: [4, 2], BARLETTA: [5, 5] }, wh: { 'Spyder - Lacombe': [9, 7] } } }),
    week('2026-08-26', { lines: 6, orders: 5 }),
    week('2026-09-01', { lines: 99, orders: 99 }), // this week: the card's own number wins
  ]);
  const c = atRiskCard(page), s = spark(c);
  assert.ok(s);
  assert.equal(s.points, 3);
  assert.deepEqual(s.tip, ['At-risk orders, last 8 weeks', 'Week of Jul 6: no data', 'Week of Jul 13: no data', 'Week of Jul 20: no data', 'Week of Jul 27: no data',
    'Week of Aug 3: no data', 'Week of Aug 10: no data', 'Week of Aug 17: 7 orders', 'Last week: 5 orders', `This week: ${n} orders`, 'Tick: Last week'].filter((t) => !/Jul 6/.test(t)));
  // Beside the big number, red.
  assert.match(c, /<div class="ohl-hero-row"><button type="button" class="ohl-hero"[\s\S]*?<\/button><span class="dz-spark"/);
  assert.match(c, /stroke="var\(--dz-risk\)"/);
  assert.deepEqual(page.errors, []);
});

test('At Risk: the saved weeks follow the warehouse, segment and customer filters; other filters leave no line', async () => {
  const page = await loaded();
  setWeeks(page, [
    week('2026-08-18', { lines: 9, orders: 7, by: { cust: { FIREFLY: [4, 2], BARLETTA: [5, 5] }, wh: { 'Spyder - Lacombe': [9, 7] } } }),
    week('2026-08-26', { lines: 6, orders: 5 }),
  ]);
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  let c = atRiskCard(page), s = spark(c);
  assert.equal(s.points, 2, 'last week has no split, so only Aug 17 and this week');
  assert.equal(s.tip[6], 'Week of Aug 17: 2 orders');
  assert.equal(s.tip[7], 'Last week: no data');
  assert.equal(s.tip[8], `This week: ${heroOrders(c)} order${heroOrders(c) === 1 ? '' : 's'}`);
  page.run(`weeklyCustomerFilter=['FIREFLY','BARLETTA'];renderResults()`);
  assert.equal(spark(atRiskCard(page)).tip[6], 'Week of Aug 17: 7 orders', 'an order has one customer, so customers add up');
  page.run(`weeklyCustomerFilter=['ALL'];weeklyWarehouseFilter=['Spyder - Lacombe'];renderResults()`);
  assert.equal(spark(atRiskCard(page)).tip[6], 'Week of Aug 17: 7 orders');
  // Two filters at once, or a filter the saved figures cannot split by: only this week, no line.
  page.run(`weeklyCustomerFilter=['FIREFLY'];renderResults()`);
  assert.equal(spark(atRiskCard(page)), null);
  page.run(`weeklyCustomerFilter=['ALL'];weeklyWarehouseFilter=['ALL'];weeklyReasonFilter=${JSON.stringify('Past due')};renderResults()`);
  assert.equal(spark(atRiskCard(page)), null);
  assert.deepEqual(page.errors, []);
});

test('At Risk: the page sends the card figures with the week, and keeps them through cleaning and merging', async () => {
  const page = await loaded();
  const w = page.run('reportAtRiskWeek()');
  const n = heroOrders(atRiskCard(page));
  assert.equal(w.counts.orders, n);
  assert.equal(w.counts.asOf, '2026-09-03');
  assert.deepEqual(w.counts.by.cust, { FIREFLY: [2, 2], BARLETTA: [1, 1] });
  assert.deepEqual(Object.keys(w.counts.by).sort(), ['cust', 'seg', 'wh']);
  // Merged in the same week: the later export date's figures win; a week without figures keeps the other's.
  const merged = page.run(`mergeAtRiskWeeks(cleanAtRiskWeeks([{asOf:'2026-09-01',savedAt:'a',keys:['x'],counts:{asOf:'2026-09-01',lines:1,orders:1}}]),cleanAtRiskWeeks([{asOf:'2026-09-02',savedAt:'b',keys:['y'],counts:{asOf:'2026-09-02',lines:2,orders:2}},{asOf:'2026-09-03',savedAt:'c',keys:['z']}]))`);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].counts, { asOf: '2026-09-02', lines: 2, orders: 2 });
  assert.deepEqual(merged[0].keys.sort(), ['x', 'y', 'z']);
  // Malformed figures are dropped, the week kept.
  assert.deepEqual(page.run(`cleanAtRiskWeeks([{asOf:'2026-09-01',keys:[],counts:{lines:-1,orders:2}}])`), [{ asOf: '2026-09-01', savedAt: '', keys: [] }]);
  assert.deepEqual(page.errors, []);
});

run();
