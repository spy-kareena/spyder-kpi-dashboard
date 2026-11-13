// Lagging sparklines (owner's pick, Style A, the shared dzSpark): under each Monthly tile the 6 months ending at the
// card's month (from mwmMetricsData, scored as the card scores), and a Last 6 months column in By warehouse (each
// warehouse's on-time rate by close month, otdStats). Run with `node tests/sparklines-lagging.test.js`. Fixtures are
// synthetic.
'use strict';
const assert = require('node:assert/strict');
const { loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
// The Lagging panel alone (Leading has lines of its own, and print draws both views).
const lag = (page) => { const h = html(page), i = h.indexOf('id="oh-panel-lagging"'), j = h.indexOf('<div class="oh-panel"', i); return i < 0 ? '' : h.slice(i, j < 0 ? undefined : j); };
async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  page.run("setWeeklyView('lagging')");
  return page;
}
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
// One order: its closed line and one delivery of it.
const ship = (doc, due, closed, o = {}) => [
  so(doc, due, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', AmountLocal: '0', ...o }),
  so(doc, due, { OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, AmountLocal: '1,000.00', ...o }),
];
const resched = (d) => ({ LineRescheduleDate: d, RescheduleDate: d, RescheduleFlag: 'Rescheduled Later Than Original Delivery' });
// Export date 09/03/2026: the Monthly card is August 2026, so its lines run March to August; By warehouse's run April to
// September (this month last).
//   Jun: A on time (Lacombe).  Jul: B 5 days late (Lacombe), C 10 days late but on its reschedule date (Alta).
//   Aug: D a day early (Lacombe), E 3 days late and a day past its reschedule date (Alta).
//   Sep: F on time (Lacombe), G 5 days late (Alta), H on time (DSM, its only month).
const ROWS = [
  ...ship('101', '06/10/2026', '06/10/2026'),
  ...ship('102', '07/10/2026', '07/15/2026'),
  ...ship('103', '07/10/2026', '07/20/2026', { Warehouse: 'CM - Alta', ...resched('07/20/2026') }),
  ...ship('104', '08/05/2026', '08/04/2026'),
  ...ship('105', '08/10/2026', '08/13/2026', { Warehouse: 'CM - Alta', ...resched('08/12/2026') }),
  ...ship('106', '09/01/2026', '09/01/2026'),
  ...ship('107', '08/28/2026', '09/02/2026', { Warehouse: 'CM - Alta' }),
  ...ship('108', '09/02/2026', '09/02/2026', { Warehouse: 'CM - DSM' }),
  so('201', '10/15/2026'),
];
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// A sparkline read back from its markup: the tip's title and its per-month points, whether it draws the dashed target or
// the tick, and its colour.
const spark = (s) => {
  const m = /<span class="dz-spark" role="img" tabindex="0" aria-label="[^"]*" data-tip="([^"]*)" data-spark="[^"]*"><svg[\s\S]*?<\/svg><\/span>/.exec(s || '');
  if (!m) return null;
  // The keyboard hint every sparkline tip ends with (2v9 spark hover) is left out.
  const lines = unesc(m[1]).split('\n').filter((t) => !/arrow keys: one period at a time$/.test(t));
  return {
    title: lines[0],
    points: lines.slice(1).filter((l) => /^• \w{3} \d{4}: /.test(l)).map((l) => l.replace(/^• /, '')),
    ref: lines[lines.length - 1].replace(/^• /, ''),
    target: /stroke-dasharray="3 3"/.test(m[0]),
    color: (/<path d="[^"]*" fill="none" stroke="([^"]+)"/.exec(m[0]) || [])[1],
  };
};
const monthly = (h) => (h.match(/<section class="dz-card dz-span-3 ohg-card dz-fade"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>Monthly<\/h2>[\s\S]*?<\/section>/) || [''])[0];
const quarterly = (h) => (h.match(/<section class="dz-card dz-span-3 ohg-card dz-fade"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>Quarterly<\/h2>[\s\S]*?<\/section>/) || [''])[0];
// Each tile: [label, value shown, its sparkline (or null)].
const tiles = (card) => [...card.matchAll(/<div class="dz-stat ohg-tile"[^>]*><div class="dz-stat-l">([^<]+)<\/div><div class="dz-stat-v"[^>]*>([^<]*)<\/div><div class="dz-stat-s[^"]*">[^<]*<\/div>(<div class="ohg-spk">[\s\S]*?<\/span><\/div>)?<\/div>/g)]
  .map((m) => [m[1], m[2], spark(m[3])]);
const whCard = (h) => (h.match(/<section class="dz-card dz-span-3"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>By warehouse<\/h2>[\s\S]*?<\/section>/) || [''])[0];
// Each By warehouse row: [warehouse, on-time chip text, its sparkline (or null)].
const whRows = (card) => [...card.matchAll(/<tr data-tip="[^"]*"><td class="k">([^<]+)<\/td>(?:<td class="num">[\s\S]*?<\/td>){2}<td class="num">([\s\S]*?)<\/td><td class="ohgt-spk">([\s\S]*?)<\/td><\/tr>/g)]
  .map((m) => [m[1], m[2].replace(/<[^>]+>/g, ''), spark(m[3])]);
const MAR_AUG = ['Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026'];
const APR_SEP = ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'];
const pts = (labels, vals) => labels.map((l, i) => `${l}: ${vals[i] === null ? 'no data' : vals[i]}`);

test('Monthly tiles: each draws the 6 months ending at the card\'s month, the last point the tile\'s number; rates carry the dashed 90% target, days and late orders a red tick', async () => {
  const page = await loaded(ROWS);
  const h = html(page);
  const card = monthly(h);
  assert.match(card, /<span class="dz-meta">August 2026<\/span>/);
  const t = tiles(card);
  assert.deepEqual(t.map((x) => x[0]), ['On time', 'Perfect order', 'Avg days late', 'Reschedule hit', 'Late orders']);
  const [otd, perfect, days, hit, late] = t;
  // On time: Jun 100 (A), Jul 0 (B, C), Aug 50 (D early, E late).
  assert.equal(otd[1], '50%');
  assert.deepEqual(otd[2].points, pts(MAR_AUG, [null, null, null, '100%', '0%', '50%']));
  assert.equal(otd[2].title, 'On time, March to August 2026');
  assert.equal(otd[2].ref, 'Dashed line: target 90%');
  assert.ok(otd[2].target);
  assert.equal(otd[2].color, 'var(--dz-risk)', 'below the target: red');
  // Perfect order: dashed target, the last point is the tile.
  assert.ok(perfect[2].target);
  assert.equal(perfect[2].points[5], `Aug 2026: ${perfect[1]}`);
  // Avg days late: Jul (5 + 10) / 2, Aug 3; no target, a tick at July; red.
  assert.equal(days[1], '3.0');
  assert.deepEqual(days[2].points, pts(MAR_AUG, [null, null, null, '0.0 days', '7.5 days', '3.0 days']));
  assert.equal(days[2].ref, 'Tick: Jul 2026');
  assert.ok(!days[2].target);
  assert.equal(days[2].color, 'var(--dz-risk)');
  // Reschedule hit: Jul met (C), Aug missed (E): two scored months, so a line with the target.
  assert.equal(hit[1], '0%');
  assert.deepEqual(hit[2].points, pts(MAR_AUG, [null, null, null, null, '100%', '0%']));
  assert.ok(hit[2].target);
  // Late orders (shipped 1+ days late): Jun 0, Jul 2, Aug 1; a month with nothing scored is a gap, not a zero.
  assert.equal(late[1], '1');
  assert.deepEqual(late[2].points, pts(MAR_AUG, [null, null, null, '0 orders', '2 orders', '1 order']));
  assert.equal(late[2].ref, 'Tick: Jul 2026');
  assert.equal(late[2].color, 'var(--dz-risk)');
  // Every last point is the tile's number, and the figures are the Trend card's (mwmMetricsData) for the same months.
  const x = page.run("mwmMetricsData(currentMetrics()).months.slice(5,11).map(r=>[r.otd,r.perfect,r.days,r.hit,r.otdScored?r.lateOrders:null])");
  const d = page.run('(()=>{const c=ohgData(currentMetrics()).month.cur;return [c.otd,c.perfect,c.avgDays,c.hit,c.late]})()');
  assert.deepEqual(x[5], d, 'the card and the Trend figures agree for August');
  // The lines are focusable figures; the Quarterly card has none.
  assert.equal((card.match(/class="dz-spark" role="img" tabindex="0"/g) || []).length, 5);
  assert.doesNotMatch(quarterly(h), /dz-spark/);
  assert.deepEqual(page.errors, []);
});

test('Late orders: the tile counts orders shipped 1+ days late, as the Trend card and Month by month do', async () => {
  // August: one order 1 day late, one 2 days late, one 3 days late. Before 2v9 the tile counted only the last (more than 2).
  const page = await loaded([...ship('301', '08/10/2026', '08/11/2026'), ...ship('302', '08/10/2026', '08/12/2026'), ...ship('303', '08/10/2026', '08/13/2026'), ...ship('304', '07/10/2026', '07/10/2026')]);
  const late = tiles(monthly(html(page)))[4];
  assert.equal(late[1], '3');
  assert.match(monthly(html(page)), /data-tip="Late orders, August 2026: 3\n• 3 delivery lines 1 or more days late\n• July 2026: 0"/);
  assert.equal(page.run('mwmMetricsData(currentMetrics()).months[10].lateOrders'), 3);
  assert.deepEqual(late[2].points.slice(4), ['Jul 2026: 0 orders', 'Aug 2026: 3 orders']);
  assert.deepEqual(page.errors, []);
});

test('One month of figures draws no line; a tile with a dash draws none either', async () => {
  const page = await loaded([...ship('401', '08/10/2026', '08/10/2026'), ...ship('402', '08/12/2026', '08/14/2026', { Warehouse: 'CM - Alta' })]);
  const h = html(page);
  const t = tiles(monthly(h));
  assert.deepEqual(t.map((x) => [x[0], x[1], x[2]]), [['On time', '50%', null], ['Perfect order', t[1][1], null], ['Avg days late', '2.0', null], ['Reschedule hit', '—', null], ['Late orders', '1', null]]);
  assert.doesNotMatch(h, /class="dz-spark"/);
  assert.deepEqual(page.errors, []);
});

test('By warehouse: a Last 6 months column (with a tip) after On time; each warehouse\'s on-time rate by month, this month\'s point the chip; the dashed 90% target; one month draws nothing', async () => {
  const page = await loaded(ROWS);
  const card = whCard(html(page));
  assert.match(card, /<th scope="col" class="num" data-tip="Deliveries early or on time\.">On time<\/th><th scope="col" class="ohgt-spk" data-tip="On time each month, Apr 2026 to Sep 2026, by delivery date\. Dashed line: the 90% target\.">Last 6 months<\/th><\/tr>/);
  const rows = whRows(card);
  // September: one order each (same value), so by name.
  assert.deepEqual(rows.map((r) => [r[0], r[1]]), [['CM · Alta', '0%'], ['CM · DSM', '100%'], ['Spyder · Lacombe', '100%']]);
  const [alta, dsm, lacombe] = rows;
  // Lacombe: Jun A, Jul B (late), Aug D, Sep F; Alta: Jul C, Aug E, Sep G, all late.
  assert.deepEqual(lacombe[2].points, pts(APR_SEP, [null, null, '100%', '0%', '100%', '100%']));
  assert.equal(lacombe[2].title, 'Spyder · Lacombe on time, Apr 2026 to Sep 2026');
  assert.ok(lacombe[2].target);
  assert.equal(lacombe[2].color, 'var(--dz-teal)', 'at or above the target: teal');
  assert.deepEqual(alta[2].points, pts(APR_SEP, [null, null, null, '0%', '0%', '0%']));
  assert.equal(alta[2].color, 'var(--dz-risk)');
  for (const r of [alta, lacombe]) assert.equal(r[2].points[5], `Sep 2026: ${r[1]}`, `${r[0]}: the last point is the chip`);
  assert.equal(dsm[2], null, 'DSM shipped in September only');
  // The page filters apply: Alta alone.
  page.run("setWeeklyWarehouseFilter(['CM - Alta'])");
  const f = whRows(whCard(html(page)));
  assert.deepEqual(f.map((r) => [r[0], r[1], r[2] && r[2].points]), [['CM · Alta', '0%', pts(APR_SEP, [null, null, null, '0%', '0%', '0%'])]]);
  // ...and the Monthly tiles follow: Alta's on time is 0% in July and August.
  assert.deepEqual(tiles(monthly(html(page)))[0][2].points.slice(3), ['Jun 2026: no data', 'Jul 2026: 0%', 'Aug 2026: 0%']);
  page.run("setWeeklyWarehouseFilter(['ALL'])");
  // Phones: the column is left out where the table would scroll sideways.
  assert.match(page.run('document.documentElement.outerHTML'), /@media \(max-width:480px\)\{\.ohgt-tbl \.ohgt-spk\{display:none\}\}/);
  assert.deepEqual(page.errors, []);
});

test('No errors and no lines with an empty export, a PO-only export or no deliveries; snapshot view and print still draw them', async () => {
  const po = sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: '900', CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co' });
  for (const rows of [[], [po], [so('1', '08/01/2026'), so('2', '09/20/2026')]]) {
    const page = await loaded(rows);
    page.run('renderResults()');
    assert.doesNotMatch(lag(page), /class="dz-spark"|class="ohgt-spk"/);
    assert.deepEqual(page.errors, [], JSON.stringify(rows.map((r) => r.DocumentNumber)));
  }
  const page = await loaded(ROWS);
  const n = (lag(page).match(/class="dz-spark"/g) || []).length;
  assert.equal(n, 7, 'five tiles and two warehouses');
  page.run('isSnapshotView=true;renderResults()');
  assert.equal((lag(page).match(/class="dz-spark"/g) || []).length, n);
  page.run('isSnapshotView=false;printMode=true;renderResults()');
  assert.equal((lag(page).match(/class="dz-spark"/g) || []).length, n);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(page.errors, []);
});

run();
