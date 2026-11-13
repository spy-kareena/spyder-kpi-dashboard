// 2v6.9 page changes: the ship target moves from Monthly to Order Health Leading (above Status, which since Leading's
// Version 1 is a bar over one row of five numbers; Top reasons sits beside Open lines by due week under "Why, and
// When?"); When flagged, the Due this week tile and the Lagging Top offenders cards are gone; Purchase Orders loses
// This week focus and has one Kits card. Run with `node tests/pages-2v69.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const po = (doc, due, o = {}) => sapRow({ SourceType: 'Purchase Order', KPIArea: 'Purchase Orders', OrderType: 'Purchase Order', DocumentNumber: doc, 'Internal Number': doc, CustomerVendorCode: 'VEND', CustomerVendorName: 'Vendor Co', DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}
const ROWS = [so('100', '08/01/2026'), so('101', '09/20/2026'), so('102', '10/20/2026'), po('500', '08/01/2026'), po('501', '10/30/2026')];

test('Leading: the ship target sits over Status in one column beside At risk; Status is a bar over one row of five cells (no list, no Top reasons); no When flagged, no Due this week tile', async () => {
  const page = await loaded(ROWS);
  const h = html(page);
  // Version 1: the column closes question 1; question 2's heading follows it.
  const col = (h.match(/<div class="ohl-col dz-span-3">([\s\S]*?)<\/div>\s*<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">2<\/span><h2 class="ohl-q-t" data-tc-skip>Why, and When\?<\/h2><\/div>/) || [])[1] || '';
  assert.ok(col, 'the column follows At risk and closes question 1');
  assert.match(h, /<h2 class="dz-title sm"[^>]*>At risk<\/h2>[\s\S]*?<\/section>\s*<div class="ohl-col dz-span-3"><section class="dz-card dz-fade ohl-ship"/);
  const titles = [...col.matchAll(/<h2 class="dz-title sm"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  // 2v6.9 (owner): the Status card has no title (its Status heading leads).
  assert.equal(titles.length, 1);
  assert.match(titles[0], /^(\w+ ship target|Ship target)$/);
  assert.equal((col.match(/<section\b/g) || []).length, 2, 'the ship target and Status');
  assert.match(col, /<\/section><section class="dz-card ohl-card ohl-status-card dz-fade" style="--i:1" aria-label="Status"><div class="ohs2-head"><div class="ohl-sec-title"[^>]*>Status<\/div><span class="ohs2-meta"><b>3<\/b> open orders<\/span><\/div>/);
  // The ship target is the Monthly card: its month, its Dates control, the same scenario numbers.
  const month = page.run("reportToday().toLocaleDateString('en-US',{month:'long'})");
  assert.equal(titles[0], `${month} ship target`);
  assert.match(col, /data-focus-key="mwm-dates" aria-expanded="false" onclick="toggleTableMore\('mwm-dates'\)"/);
  const sd = page.run('(()=>{const s=shipScenarioFor(currentMetrics());return [rowDocCount(s.pastOriginalDue),rowDocCount(s.onTrackWindow)]})()');
  assert.match(col, new RegExp(`<span class="dz-big sm[^"]*">${sd[0]} orders?</span><span class="dz-sub">past due`));
  // Status (Version 1, owner's pick): a thin segmented bar (one part per state with orders) over one row of five
  // cells, a button per state with its open orders and lines. Cells and parts filter the Lines card as before.
  // This export: order 100 is past due; 101 (Sep 20) and 102 (Oct 20) are on track.
  const status = col.slice(col.indexOf('ohl-status-card'));
  assert.match(status, /<div class="ohs2-bar" role="group" aria-label="Open orders by state">/);
  assert.deepEqual([...status.matchAll(/class="ohs2-seg" style="flex-grow:(\d+);[^"]*" data-focus-key="status-seg-st-(\w+)"/g)].map((m) => [m[2], +m[1]]), [['ontrack', 2], ['pastdue', 1]]);
  assert.match(status, /<div class="ohs3-row" role="group" aria-label="Open orders by state, with figures">/);
  const cells = [...status.matchAll(/<button type="button" class="ohs3-cell([^"]*)" data-focus-key="status-st-(\w+)" aria-pressed="(true|false)" onclick="setWeeklyTileFilter\((?:&#39;|')st-\2(?:&#39;|')\)" data-tip="[^"]+"><span class="ohs3-l"><i class="ohl-dot" style="background:[^"]+" aria-hidden="true"><\/i>([^<]+)<\/span><span class="ohs3-n">(\d+)<\/span><span class="ohs3-s">([^<]+)<\/span><\/button>/g)]
    .map((m) => [m[2], m[4], +m[5], m[6], m[1].trim(), m[3]]);
  assert.deepEqual(cells, [['ontrack', 'On track', 2, 'orders · 2 lines', '', 'false'], ['duethisweek', 'Due this week', 0, 'orders · 0 lines', 'zero', 'false'], ['rescheduled', 'Rescheduled', 0, 'orders · 0 lines', 'zero', 'false'],
    ['pastdue', 'Past due', 1, 'order · 1 line', 'crit', 'false'], ['nocommit', 'No commit', 0, 'orders · 0 lines', 'zero', 'false']]);
  // Gone on purpose: the list (its Lines / Orders column heads and button rows), any share or value column, any bar
  // track; and Top reasons, which moved to the "Why, and When?" card beside Open lines by due week.
  assert.doesNotMatch(h, /class="ohs2-(cols|list|row[ "]|name|lines|n")/);
  assert.doesNotMatch(status, /ohs2-pct|ohs2-val|% past due|ohs2-track|ohl-track|dz-barrow|Top reasons|class="ohu"/);
  assert.equal((status.match(/class="ohl-sec-title"/g) || []).length, 1, 'Status only');
  const why = (h.match(/<section class="dz-card dz-span-6 ohl-card ohl-why dz-fade" style="--i:2" aria-label="Top reasons and open lines by due week">[\s\S]*?<\/section>/) || [''])[0];
  assert.match(why, /<div class="ohl-sec-title"[^>]*>Top reasons<\/div><span class="ohs2-meta"><b>1<\/b> at-risk lines<\/span>/);
  assert.match(why, /<div class="ohu" style="--rows:\d+;--cols:\d+" role="group" aria-label="Which reasons come together">[\s\S]*?class="ohu-col/); // option S: reason sets
  assert.match(why, /<div class="ohl-why-half"><div class="ohs2-head"><div class="ohl-sec-title"[^>]*>Open lines by due week<\/div><button type="button" class="dz-chip red ohl-chipbtn" data-focus-key="tile-st-pastdue-chip"[^>]*>1 line already past due<\/button>/);
  page.run("setWeeklyTileFilter('st-ontrack')");
  assert.match(html(page), /class="ohs3-cell sel" data-focus-key="status-st-ontrack" aria-pressed="true"/);
  assert.match(html(page), /class="ohs2-seg sel"[^>]*data-focus-key="status-seg-st-ontrack"[^>]*aria-pressed="true"/);
  assert.deepEqual([...html(page).matchAll(/<td class="c-doc">(\d+)<\/td>/g)].map((m) => m[1]).sort(), ['101', '102']);
  // Gone: the When flagged card and the Due this week tile under At risk (three tiles left).
  assert.doesNotMatch(h, />When flagged<\/h2>|data-focus-key="oh-age-/);
  const stats = [...h.matchAll(/class="dz-stat ohl-stat[^"]*" data-focus-key="tile-([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(stats, ['st-rescheduled', 'st-nocommit', 'allopen']);
  // Open lines by due week has no card of its own any more (it is the second half of "Why, and When?"); Customers
  // at risk takes the full row under question 3.
  assert.doesNotMatch(h, /<h2[^>]*>Open lines by due week<\/h2>/);
  assert.match(h, /<h2 class="ohl-q-t" data-tc-skip>Who\?<\/h2><\/div>\s*<section class="dz-card dz-span-6 ohl-card ohl-who dz-fade" style="--i:3"><div class="dz-card-head"><h2 class="dz-title"[^>]*>Customers at risk<\/h2>/);
  assert.deepEqual(page.errors, []);
});

const delivery = (doc, closed) => so(doc, '08/10/2026', { OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, OpenQuantity: '0' });
test('Lagging: Monthly and Quarterly only (no Top offenders), five tiles each (no Fill rate); Monthly has no ship target', async () => {
  const page = await loaded([...ROWS, delivery('801', '08/08/2026'), delivery('802', '08/15/2026')]);
  page.run("setWeeklyView('lagging')");
  const h = html(page);
  assert.doesNotMatch(h, /Top offenders · (warehouses|vendors)|ohg-wh-/);
  const cards = [...h.matchAll(/<section class="dz-card dz-span-3 ohg-card dz-fade"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>(\w+)<\/h2>[\s\S]*?<div class="dz-stats ohg-tiles">([\s\S]*?)<\/section>/g)]
    .map((m) => [m[1], [...m[2].matchAll(/<div class="dz-stat-l">([^<]+)<\/div>/g)].map((t) => t[1])]);
  const five = ['On time', 'Perfect order', 'Avg days late', 'Reschedule hit', 'Late orders'];
  assert.deepEqual(cards, [['Monthly', five], ['Quarterly', five]]);
  assert.doesNotMatch(h, /class="dz-stat ohg-tile" data-tip="Fill rate|data-tip="(Monthly|Quarterly): orders shipped[^"]*Fill rate/);
  assert.match(HTML, /\.ohg-tiles>\.ohg-tile:nth-child\(n\+4\)\{grid-column:span 3\}/);
  // 2v9: Monthly starts hidden (its sections are on Sales Order Health); shown again, it still has no ship target.
  page.run("stgTogglePage('monthly');setTab('monthly')");
  for (const mode of ['shipped', 'booked']) {
    page.run(`mwmSetMode('${mode}')`);
    const h = html(page);
    assert.doesNotMatch(h, /<h2 class="dz-title sm"[^>]*>(\w+ ship target|Ship target)<\/h2>|data-focus-key="mwm-dates"/, mode);
    assert.match(h, /class="dz-card dz-span-6 dz-fade mwm-herocard"/, mode);
  }
  assert.deepEqual(page.errors, []);
});

// --- Lagging, Version 1 (owner's pick) -------------------------------------------------------------------------------
// Under the Monthly and Quarterly cards Lagging is one grid (.ohg-detail) of four cards: Trend (id="ohg-metrics": a
// metric switch, the Months switch, one chart, the newest month's figure and why its orders were late), Month by
// month, By warehouse and Booked vs shipped. The Metrics and Shipments page groups it replaces are gone.
// These read that grid out of the page: its cards by title, a card's table as text, a tag stripped to its words.
const detail = (page) => {
  const h = html(page), from = h.indexOf('<div class="dz-grid ohg-detail">');
  if (from < 0) return '';
  const to = h.indexOf('<div class="oh-panel" role="tabpanel"', from);
  return h.slice(from, to < 0 ? undefined : to);
};
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const cards = (d) => [...d.matchAll(/<section class="dz-card ([^"]*)"[^>]*>[\s\S]*?<\/section>/g)]
  .map((m) => ({ cls: m[1], html: m[0], title: plain((/<h2 class="dz-title"[^>]*>([\s\S]*?)<\/h2>/.exec(m[0]) || [])[1]) }));
const card = (d, title) => (cards(d).find((c) => c.title === title) || { html: '' }).html;
const table = (c) => ({
  head: [...c.matchAll(/<th scope="col"(?: class="(?:num|ohgt-spk)")?(?: data-tip="([^"]*)")?>([^<]*)<\/th>/g)].map((m) => [m[2], m[1] || '']),
  rows: [...c.matchAll(/<tr(?: data-tip="[^"]*")?>(<td[\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => plain(x[1]))),
  tips: [...c.matchAll(/<tr data-tip="([^"]*)"><td/g)].map((m) => m[1]),
});
const count = (c) => plain((/<span class="dz-pagecount">([^<]*)<\/span>/.exec(c) || [])[1]);
const sofar = (c) => plain((/<p class="ohgt-sofar"[^>]*>([\s\S]*?)<\/p>/.exec(c) || [])[1]);

test('Trend (id ohg-metrics) leads Lagging\'s detail grid under Monthly and Quarterly: setTab and a stored page open it; not in the menu; the Metrics and Shipments groups are gone', async () => {
  const page = await loaded([...ROWS, delivery('801', '08/08/2026'), delivery('802', '08/15/2026')]);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /data-focus-key="nav-metrics"/);
  assert.doesNotMatch(html(page), /id="ohg-metrics"|class="dz-grid ohg-detail"/, 'Leading does not build it');
  // setTab('metrics') opens Sales Order Health on Lagging and asks for the Trend card to be scrolled to.
  const reveals = [], reveal = page.ctx.dzRevealList;
  page.ctx.dzRevealList = (target) => reveals.push(target);
  page.run("setTab('metrics')");
  page.ctx.dzRevealList = reveal;
  assert.deepEqual(reveals, ['#ohg-metrics']);
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  const h = html(page);
  const grid = h.indexOf('<div class="dz-grid ohg-grid">');
  // Every page reads as questions: question 1 "How Did We Do?" heads Monthly and Quarterly; inside the detail grid
  // question 2 comes before Trend, 3 before Month by month and 4 before By warehouse (each a full-width row).
  assert.match(h, /<div class="ohl-q solo"><span class="ohl-q-n" aria-hidden="true">1<\/span><h2 class="ohl-q-t" data-tc-skip>How Did We Do\?<\/h2><\/div><div class="dz-grid ohg-grid">/);
  const det = h.indexOf('<div class="dz-grid ohg-detail"><div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">2</span><h2 class="ohl-q-t" data-tc-skip>Which Way Is It Heading, and Why?</h2></div><section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend"><div class="ohgt-head"><h2 class="dz-title" data-tip="One metric over the months shown. Pick a metric to redraw the chart.">Trend</h2>');
  assert.ok(grid > 0 && det > grid, 'the detail grid follows the Monthly and Quarterly cards, Trend first');
  assert.equal(h.split('id="ohg-metrics"').length - 1, 1, 'one anchor');
  const d = detail(page);
  assert.deepEqual(cards(d).map((c) => [c.title, c.cls.match(/dz-span-\d/)[0]]), [['Trend', 'dz-span-6'], ['Month by month', 'dz-span-6'], ['By warehouse', 'dz-span-3'], ['Booked vs shipped', 'dz-span-3']]);
  assert.match(d, /<\/section><div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">3<\/span><h2 class="ohl-q-t" data-tc-skip>How Did Each Month Go\?<\/h2><\/div><section class="dz-card dz-span-6[^"]*"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>Month by month<\/h2>/);
  assert.match(d, /<\/section><div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">4<\/span><h2 class="ohl-q-t" data-tc-skip>Who Shipped It, and What Is Still Open\?<\/h2><\/div><section class="dz-card dz-span-3[^"]*"[^>]*><div class="dz-card-head"><h2 class="dz-title"[^>]*>By warehouse<\/h2>/);
  // Gone from Lagging on purpose (owner): the Metrics and Shipments page groups with their KPI tiles and sparklines,
  // the Late orders by cause tile, the On-time delivery chart, the Monthly metrics table, the Orders shipped by month
  // chart, the month cards, the shipped-to-date strip, the Shipped | Booked switch, the original month select, any
  // Fill rate column and Show more. (They are still on the hidden Monthly page: tests/pages-2v2.test.js.)
  const lag = h.slice(grid, h.indexOf('<div class="oh-panel" role="tabpanel"', grid));
  assert.doesNotMatch(lag, /class="pg-group|id="ohg-shipments"|class="mwm-kpi[ "]|Late orders by cause|>On-time delivery<\/h2>|>Monthly metrics<\/h2>|>Orders shipped by month<\/h2>/);
  assert.doesNotMatch(lag, /month-card|month-spot|mini-strip|mwmSetMode\(|id="ohg-original-month"|<select|Fill rate|data-more=|aria-labelledby="pg-mt-/);
  assert.equal((lag.match(/<table\b/g) || []).length, 2, 'one table a card (By warehouse has no September deliveries here)');
  // This export: two August deliveries for 08/10 (one 2 days early, one 5 days late), nothing shipped in September yet.
  // So the newest month with orders is August (no "to date"), with no month before it to compare against.
  const trend = card(d, 'Trend');
  assert.match(trend, /<div class="ohgt-side">\s*<h3 data-tip="Shipped by the original date\.">On-time delivery · August<\/h3>\s*<div class="ohgt-now"><span>50%<\/span><\/div>/);
  assert.match(trend, /<h3 data-tip="Each late order under the first reason on its late delivery\.">Why orders were late · August<\/h3><ul class="mwm-causes"><li data-tip="Past due · No reschedule: 1 order of 1 late in August\."><span class="mwm-cause-l">Past due · No reschedule<\/span><b class="mwm-cause-v">1<\/b><\/li><\/ul>/);
  assert.match(trend, /<span class="mwm-pt" style="left:87\.50%;top:100\.00%;border-color:var\(--dz-indigo\)" data-tip="August 2026: On-time delivery 50%\n• 2 orders shipped\n• 1 order late"><\/span><span class="mwm-pt-l" style="left:87\.50%;top:100\.00%">50%<\/span>/);
  assert.equal((trend.match(/class="mwm-pt"/g) || []).length, 1, 'one scored month, one dot');
  assert.equal(sofar(trend), 'September so far: 0 orders · $0 shipped · year to date $2K');
  assert.deepEqual(table(card(d, 'Month by month')).rows.slice(0, 3), [['Sep 2026 to date', '0', '$0', '—', '—', '—', '0'], ['Aug 2026', '2', '$2K', '50%', '—', '5.0', '1'], ['Jul 2026', '0', '$0', '—', '—', '—', '0']]);
  assert.match(card(d, 'By warehouse'), /<span class="dz-meta">September · 0 orders<\/span><\/div><p class="empty-note">No deliveries in this range\.<\/p><\/section>$/);
  // Booked vs shipped: August has $2,000 shipped of $3,000 booked (order 100 is still open), one line shipped late.
  assert.deepEqual(table(card(d, 'Booked vs shipped')).rows, [['Aug 2026', '67%', '$1,000', '1'], ['Sep 2026', '0%', '$1,000', '0'], ['Oct 2026', '0%', '$1,000', '0']]);
  assert.match(d, /<\/section><\/div><p class="mom-foot">Delivery history starts 2026-08-08; earlier comparisons show n\/a\.<\/p>/);
  // Its own Months switch still works.
  page.run('mwmSetRange(3)');
  assert.match(detail(page), /<button type="button" data-focus-key="mwm-range-3" class="on" aria-pressed="true" onclick="mwmSetRange\(3\)" data-tip="Last 3 months\.">3 months<\/button>/);
  // A stored page of 'metrics' (an older snapshot, the page a search started from) opens Lagging.
  page.run("setWeeklyView('leading');activeTab='metrics';renderResults()");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  assert.match(html(page), /id="ohg-metrics"/);
  assert.deepEqual(page.errors, []);
  // An export with no deliveries: the Lagging card says so, and the detail grid still draws (nothing scored, no dots).
  const none = await loaded(ROWS);
  none.run("setTab('metrics')");
  assert.match(html(none), /<p class="dz-sub ohg-empty">Needs delivery close-date data: this export has no deliveries to score\.<\/p><\/section><\/div><div class="dz-grid ohg-detail">/);
  const quiet = card(detail(none), 'Trend');
  assert.match(quiet, /On-time delivery · August<\/h3>\s*<div class="ohgt-now"><span>—<\/span><\/div>/);
  assert.match(quiet, /Why orders were late · August<\/h3><p class="ohgt-none">No late orders\.<\/p>/);
  assert.doesNotMatch(quiet, /class="mwm-pt"/);
  assert.equal(sofar(quiet), 'September so far: 0 orders · $0 shipped · year to date $0');
  assert.deepEqual(table(card(detail(none), 'Booked vs shipped')).rows, [['Aug 2026', '0%', '$1,000', '0'], ['Sep 2026', '0%', '$1,000', '0'], ['Oct 2026', '0%', '$1,000', '0']]);
  assert.deepEqual(none.errors, []);
  // An export with no sales lines at all (purchase orders only): the anchor is still there, with one plain note.
  const pos = await loaded([po('500', '08/01/2026'), po('501', '10/30/2026')]);
  pos.run("setTab('metrics')");
  assert.match(detail(pos), /^<div class="dz-grid ohg-detail"><section class="dz-card dz-span-6" id="ohg-metrics"><div class="dz-card-head"><h2 class="dz-title">Trend<\/h2><\/div><p class="empty-note">No order lines are loaded yet\.<\/p><\/section><\/div>/);
  assert.deepEqual(pos.errors, []);
});

// A year of deliveries for the Trend card and the three tables. Export date 09/03/2026, so the twelve months run
// October 2025 to September 2026 (to date). ship() is one order: its closed line and one delivery of it.
const resched = (d) => ({ LineRescheduleDate: d, RescheduleDate: d, RescheduleFlag: 'Rescheduled Later Than Original Delivery' });
const ship = (doc, due, closed, amount, o = {}, line = {}) => {
  const perfect = new Date(closed) > new Date(due) ? 'Not Perfect' : 'Perfect';
  return [
    so(doc, due, { Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', AmountLocal: '0', PerfectOrder: perfect, ...o, ...line }),
    so(doc, due, { OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', OpenQuantity: '0', FillStatus: 'Complete', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}-${closed.slice(0, 5)}`, AmountLocal: amount, PerfectOrder: perfect, ...o }),
  ];
};
const LAG = [
  ...ship('1001', '10/10/2025', '10/10/2025', '1,000.00'), // October: on time
  ...ship('1002', '11/05/2025', '11/12/2025', '2,000.00'), // November: 7 days late
  ...ship('1003', '11/20/2025', '11/18/2025', '500.00'), //   and one early
  ...ship('1004', '01/15/2026', '01/16/2026', '1,200.00'), // January: 1 day late
  ...ship('1005', '02/10/2026', '02/09/2026', '300.00'), // February: one order in two deliveries, the second 10 days late
  ship('1005', '02/10/2026', '02/20/2026', '700.00')[1],
  ...ship('1006', '04/06/2026', '04/06/2026', '1,500.00'), // April: three on time
  ...ship('1007', '04/13/2026', '04/10/2026', '1,500.00'),
  ...ship('1008', '04/20/2026', '04/20/2026', '1,500.00'),
  ...ship('1009', '05/01/2026', '05/04/2026', '800.00'), // May: 3 and 5 days late, one on time
  ...ship('1010', '05/10/2026', '05/15/2026', '900.00'),
  ...ship('1011', '05/20/2026', '05/20/2026', '1,300.00'),
  ...ship('1012', '07/06/2026', '07/06/2026', '2,500.00'), // July: on time, and 2 days late
  ...ship('1013', '07/10/2026', '07/12/2026', '1,500.00'),
  ...ship('1014', '08/05/2026', '08/04/2026', '1,000.00'), // August: three on time (1015's line is flagged Not Perfect), one 10 days late
  ...ship('1015', '08/07/2026', '08/07/2026', '2,000.00', {}, { PerfectOrder: 'Not Perfect' }),
  ...ship('1016', '08/14/2026', '08/14/2026', '3,000.00'),
  ...ship('1017', '08/10/2026', '08/20/2026', '4,000.00'),
  // September to date: eight orders from seven warehouses; four late (8, 4, 13 and 3 days), two of those rescheduled.
  ...ship('1018', '09/02/2026', '09/01/2026', '7,000.00', { Warehouse: 'Spyder - Lacombe' }),
  ...ship('1019', '09/01/2026', '09/01/2026', '6,000.00', { Warehouse: 'CM - Alta' }, { PerfectOrder: 'Not Perfect' }),
  ...ship('1020', '08/25/2026', '09/02/2026', '5,000.00', { Warehouse: 'CM - Beta' }),
  ...ship('1021', '08/28/2026', '09/01/2026', '4,000.00', { Warehouse: 'CM - DSM' }),
  ...ship('1022', '09/03/2026', '09/03/2026', '3,000.00', { Warehouse: 'CM SFG - Gamma' }),
  ...ship('1023', '08/20/2026', '09/02/2026', '2,000.00', { Warehouse: 'CM SFG - Delta', ...resched('08/27/2026') }), // shipped after its commit
  ...ship('1024', '08/31/2026', '09/03/2026', '1,000.00', { Warehouse: 'CM - Echo', ...resched('09/03/2026') }), // shipped on its commit
  ...ship('1025', '09/03/2026', '09/02/2026', '500.00', { Warehouse: 'CM - Alta' }),
  // Open lines: one past due in August, one each for September, October and November.
  so('2001', '09/20/2026', { AmountLocal: '9,000.00' }), so('2002', '10/15/2026', { AmountLocal: '4,000.00' }),
  so('2003', '11/10/2026', { AmountLocal: '2,500.00' }), so('2004', '08/05/2026', { AmountLocal: '1,100.00' }),
];
// Per month, oldest first: [month, orders shipped, shipped value, on time %, perfect order %, avg days late, late orders].
const LAG_MONTHS = [
  ['Oct 2025', 1, 1000, 100, 100, 0, 0], ['Nov 2025', 2, 2500, 50, 50, 7, 1], ['Dec 2025', 0, 0, null, null, null, 0],
  ['Jan 2026', 1, 1200, 0, 0, 1, 1], ['Feb 2026', 1, 1000, 50, 0, 10, 1], ['Mar 2026', 0, 0, null, null, null, 0],
  ['Apr 2026', 3, 4500, 100, 100, 0, 0], ['May 2026', 3, 3000, 33, 33, 4, 2], ['Jun 2026', 0, 0, null, null, null, 0],
  ['Jul 2026', 2, 4000, 50, 50, 2, 1], ['Aug 2026', 4, 10000, 75, 50, 10, 1], ['Sep 2026', 8, 28500, 50, 38, 7, 4],
];
const MONTH_NAMES = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const lagData = (page) => page.run("(()=>{const m=currentMetrics(),x=mwmMetricsData(m).months,e=mwmMonthlyData(m).entries;return x.map((r,i)=>[r.date.toLocaleDateString('en-US',{month:'short',year:'numeric'}),r.orders,e[i].shipped.value,r.otd,r.perfect,r.days,r.lateOrders])})()");

test('Trend: the five chips switch the chart and the newest month\'s figure; an unknown metric falls back to On Time; the 90% target shows only for On Time; the Months switch sets the months drawn', async () => {
  const page = await loaded(LAG);
  page.run("setTab('metrics')");
  // The data the card draws is the fixture's, month by month.
  assert.deepEqual(lagData(page), LAG_MONTHS);
  assert.equal(page.run('ohgTrendMetric'), 'otd');
  // Per metric: the chip, the side heading, September's figure and its change on August (good moves teal, bad red:
  // fewer days late is good, more late orders is bad), the axis, the line's colour and each scored month's label.
  const col = (i) => LAG_MONTHS.map((r) => r[i]);
  const WANT = {
    otd: { chip: 'On Time', tip: 'Shipped by the original date.', long: 'On-time delivery', now: '50%', delta: ['red', '−25 pts vs Aug'], axis: ['100%', '50%', '0%'], color: 'var(--dz-indigo)', vals: col(3), fmt: (v) => `${v}%` },
    perfect: { chip: 'Perfect Order', tip: 'Shipped complete, on time, never rescheduled.', long: 'Perfect order', now: '38%', delta: ['red', '−12 pts vs Aug'], axis: ['100%', '50%', '0%'], color: 'var(--dz-indigo)', vals: col(4), fmt: (v) => `${v}%` },
    days: { chip: 'Avg Days Late', tip: 'Average days late, late deliveries only.', long: 'Avg days late', now: '7.0', delta: ['teal', '−3 days vs Aug'], axis: ['10', '5', '0'], color: 'var(--dz-risk)', vals: col(5), fmt: (v) => v.toFixed(1) },
    lateOrders: { chip: 'Late Orders', tip: 'Orders shipped 1+ days late.', long: 'Late orders', now: '4', delta: ['red', '+3 vs Aug'], axis: ['6', '3', '0'], color: 'var(--dz-risk)', vals: col(6), fmt: String },
    orders: { chip: 'Orders Shipped', tip: 'Orders shipped in the month.', long: 'Orders shipped', now: '8', delta: ['teal', '+4 vs Aug'], axis: ['10', '5', '0'], color: 'var(--dz-teal)', vals: col(1), fmt: String },
  };
  const keys = Object.keys(WANT);
  const chipsOf = (t) => [...t.matchAll(/<button type="button" class="ohgt-chip( on)?" data-focus-key="ohg-trend-(\w+)" aria-pressed="(true|false)" onclick="ohgSetTrendMetric\('(\w+)'\)" data-tip="([^"]+)">([^<]+)<\/button>/g)]
    .map((m) => ({ key: m[2], on: !!m[1], pressed: m[3] === 'true', calls: m[4], tip: m[5], label: m[6] }));
  const axisOf = (t) => [...(/<div class="mwm-yax">([\s\S]*?)<\/div>/.exec(t) || ['', ''])[1].matchAll(/<span style="top:[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  const dotsOf = (t) => [...t.matchAll(/<span class="mwm-pt-l" style="[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  const monthsOf = (t) => [...(/<div class="mwm-xax" style="--n:\d+">([\s\S]*?)<\/div>/.exec(t) || ['', ''])[1].matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
  const whyOf = (t) => [...t.matchAll(/<li data-tip="([^"]*)"><span class="mwm-cause-l">([^<]*)<\/span><b class="mwm-cause-v">(\d+)<\/b><\/li>/g)].map((m) => [m[2], +m[3], m[1]]);
  const WHY = [['Past due · No reschedule', 2, 'Past due · No reschedule: 2 orders of 4 late in September.'], ['Missed commit', 1, 'Missed commit: 1 order of 4 late in September.'], ['Rescheduled later', 1, 'Rescheduled later: 1 order of 4 late in September.']];
  for (const k of [...keys.slice(1), keys[0]]) { // every other metric, then back to On Time
    page.run(`ohgSetTrendMetric('${k}')`);
    const w = WANT[k], t = card(detail(page), 'Trend');
    assert.equal(page.run('ohgTrendMetric'), k);
    // Five chips, each a button with a tip; only the picked one is pressed.
    const chips = chipsOf(t);
    assert.equal((t.match(/class="ohgt-chip[ "]/g) || []).length, 5, 'every chip is a button with a tip');
    assert.deepEqual(chips.map((c) => [c.key, c.calls, c.label, c.tip]), keys.map((id) => [id, id, WANT[id].chip, WANT[id].tip]));
    assert.deepEqual(chips.filter((c) => c.on || c.pressed).map((c) => [c.key, c.on, c.pressed]), [[k, true, true]], k);
    // The side: the metric and the month (September is not over, so "to date"), its figure, its change on August.
    assert.match(t, new RegExp(`<div class="ohgt-side">\\s*<h3 data-tip="${w.tip.replace(/[.+]/g, '\\$&')}">${w.long} · September to date</h3>\\s*<div class="ohgt-now"><span>${w.now.replace('.', '\\.')}</span><span class="mwm-kpi-d ${w.delta[0]}">${w.delta[1].replace('+', '\\+')}</span></div>`), k);
    // The chart: named for the metric, on a round axis, one labelled dot per scored month in the metric's colour.
    assert.match(t, new RegExp(`<div class="mwm-plot" data-tip-notab role="img" aria-label="${w.long}, last 12 months">`), k);
    assert.deepEqual(axisOf(t), w.axis, `${k} axis`);
    assert.deepEqual(dotsOf(t), w.vals.filter((v) => v !== null).map(w.fmt), `${k} dots`);
    assert.equal((t.match(new RegExp(`<span class="mwm-pt" style="left:[\\d.]+%;top:[\\d.]+%;border-color:${w.color.replace(/[()]/g, '\\$&')}" data-tip="[^"]+"></span>`, 'g')) || []).length, w.vals.filter((v) => v !== null).length, `${k}: every dot has its tip`);
    assert.match(t, new RegExp(`<path d="M[^"]+" fill="none" stroke="${w.color.replace(/[()]/g, '\\$&')}"`), k);
    assert.deepEqual(monthsOf(t), MONTH_NAMES, k);
    // The dashed 90 % target belongs to On Time only.
    assert.equal((t.match(/<i class="mwm-target"/g) || []).length, k === 'otd' ? 1 : 0, `${k} target`);
    // Why orders were late and the "so far" line are the month's, whichever metric is picked.
    assert.deepEqual(whyOf(t), WHY, k);
    assert.match(t, /<h3 data-tip="Each late order under the first reason on its late delivery\.">Why orders were late · September<\/h3><ul class="mwm-causes">/);
    assert.equal(sofar(t), 'September so far: 8 orders · $29K shipped · year to date $52K', k);
  }
  // On Time in full: the line breaks at the months with nothing shipped (December, March, June); the target sits at 90 %.
  let t = card(detail(page), 'Trend');
  assert.match(t, /<i class="mwm-target" style="top:10\.00%"><\/i>/);
  assert.match(t, /<path d="M50 0 L150 100 M350 200 L450 100 M650 0 L750 134 M950 100 L1050 50 L1150 100" fill="none" stroke="var\(--dz-indigo\)"/);
  assert.match(t, /<span class="mwm-pt" style="left:95\.83%;top:50\.00%;border-color:var\(--dz-indigo\)" data-tip="September 2026: On-time delivery 50%\n• 8 orders shipped\n• 4 orders late"><\/span><span class="mwm-pt-l" style="left:95\.83%;top:50\.00%">50%<\/span>/);
  assert.match(t, /<p class="ohgt-sofar" data-tip="September so far\n• 8 orders shipped, \$28,500 on 8 delivery lines\n• Year to date: \$52,200 on 23 delivery lines">/);
  // The late-order reasons are the data's (each late order once, under the first reason of its late delivery).
  assert.deepEqual(page.run('(()=>{const x=mwmMetricsData(currentMetrics());return [x.L,x.lateOrders,x.causes]})()'), [11, 4, WHY.map((r) => r.slice(0, 2))]);
  // An unknown metric (an older link, a typo) falls back to On Time.
  for (const bad of ["'fill'", "''", 'undefined', 'null', '7']) {
    page.run("ohgSetTrendMetric('days')");
    assert.match(card(detail(page), 'Trend'), /Avg days late · September to date<\/h3>/);
    page.run(`ohgSetTrendMetric(${bad})`);
    assert.equal(page.run('ohgTrendMetric'), 'otd', bad);
    t = card(detail(page), 'Trend');
    assert.match(t, /On-time delivery · September to date<\/h3>\s*<div class="ohgt-now"><span>50%<\/span>/, bad);
    assert.deepEqual(chipsOf(t).filter((c) => c.pressed).map((c) => c.key), ['otd'], bad);
    assert.equal((t.match(/<i class="mwm-target"/g) || []).length, 1, bad);
  }
  // The Months switch: 12, 6 or 3 months on the x-axis (anything else is 12); the axis starts at 50 %, or lower when
  // a month shown needs it, so the target moves with it. The side figure and the tables do not change.
  const segOf = (x) => [...x.matchAll(/<button type="button" data-focus-key="mwm-range-(\d+)"( class="on")? aria-pressed="(true|false)" onclick="mwmSetRange\((\d+)\)" data-tip="Last \4 months\.">\4 months<\/button>/g)].map((m) => [+m[1], !!m[2], m[3] === 'true']);
  for (const [n, axis, target, dots] of [[6, ['100%', '65%', '30%'], '14.29', 5], [3, ['100%', '75%', '50%'], '20.00', 3], [12, ['100%', '50%', '0%'], '10.00', 9]]) {
    page.run(`mwmSetRange(${n})`);
    const d = detail(page);
    t = card(d, 'Trend');
    assert.equal(page.run('mwmRange'), n);
    assert.deepEqual(segOf(t), [12, 6, 3].map((r) => [r, r === n, r === n]), `${n} months`);
    assert.match(t, new RegExp(`<div class="mwm-xax" style="--n:${n}">`));
    assert.deepEqual(monthsOf(t), MONTH_NAMES.slice(12 - n), `${n} months`);
    assert.deepEqual(dotsOf(t), LAG_MONTHS.slice(12 - n).map((r) => r[3]).filter((v) => v !== null).map((v) => `${v}%`), `${n} months`);
    assert.equal(dotsOf(t).length, dots);
    assert.deepEqual(axisOf(t), axis, `${n} months`);
    assert.match(t, new RegExp(`<i class="mwm-target" style="top:${target.replace('.', '\\.')}%"></i>`), `${n} months`);
    assert.match(t, new RegExp(`aria-label="On-time delivery, last ${n} months"`));
    assert.match(t, /On-time delivery · September to date<\/h3>\s*<div class="ohgt-now"><span>50%<\/span><span class="mwm-kpi-d red">−25 pts vs Aug<\/span>/);
    assert.equal(count(card(d, 'Month by month')), '1–6 of 12 months', `${n} months`);
  }
  page.run('mwmSetRange(5)');
  assert.equal(page.run('mwmRange'), 12);
  assert.equal(monthsOf(card(detail(page), 'Trend')).length, 12);
  // On paper the two switches are left out (the heading beside the chart names the metric).
  assert.match(HTML, /@media print\{\.ohgt-chips,\.ohgt-tools\{display:none\}/);
  assert.deepEqual(page.errors, []);
});

test('Lagging tables: Month by month pages 6 + 6 and is the months\' data; By warehouse is the ship target range\'s deliveries; Booked vs shipped is the original-month groups; every column has a tip', async () => {
  const page = await loaded(LAG);
  page.run("setTab('metrics')");
  let d = detail(page);
  // Every column heading of the three tables carries a tip; each table scrolls in a named, focusable region.
  assert.equal((d.match(/<table class="ohgt-tbl">/g) || []).length, 3);
  assert.equal((d.match(/<table\b/g) || []).length, 3);
  assert.equal((d.match(/<th\b/g) || []).length, 16);
  assert.equal((d.match(/<th scope="col"(?: class="(?:num|ohgt-spk)")? data-tip="[^"]+">[^<]+<\/th>/g) || []).length, 16, 'every th has a tip');
  assert.deepEqual([...d.matchAll(/<div class="sup-scroll" tabindex="0" role="region" aria-label="([^"]+)"><table class="ohgt-tbl">/g)].map((m) => m[1]), ['Month by month', 'By warehouse', 'Booked vs shipped']);
  // --- Month by month: the twelve months, newest first, six a page.
  let months = card(d, 'Month by month');
  assert.match(months, /<h2 class="dz-title" data-tip="Orders shipped each month, by delivery date\.">Month by month<\/h2>/);
  assert.deepEqual(table(months).head, [['Month', 'The month the orders shipped.'], ['Orders', 'Orders shipped in the month.'], ['Value', 'Shipped value of the month.'], ['On time', 'Shipped by the original date.'],
    ['Perfect order', 'Shipped complete, on time, never rescheduled.'], ['Avg days late', 'Average days late, late deliveries only.'], ['Late orders', 'Orders shipped 1+ days late.']]);
  const PAGE1 = [['Sep 2026 to date', '8', '$29K', '50%', '38%', '7.0', '4'], ['Aug 2026', '4', '$10K', '75%', '50%', '10.0', '1'], ['Jul 2026', '2', '$4K', '50%', '50%', '2.0', '1'],
    ['Jun 2026', '0', '$0', '—', '—', '—', '0'], ['May 2026', '3', '$3K', '33%', '33%', '4.0', '2'], ['Apr 2026', '3', '$5K', '100%', '100%', '0.0', '0']];
  const PAGE2 = [['Mar 2026', '0', '$0', '—', '—', '—', '0'], ['Feb 2026', '1', '$1K', '50%', '0%', '10.0', '1'], ['Jan 2026', '1', '$1K', '0%', '0%', '1.0', '1'],
    ['Dec 2025', '0', '$0', '—', '—', '—', '0'], ['Nov 2025', '2', '$3K', '50%', '50%', '7.0', '1'], ['Oct 2025', '1', '$1K', '100%', '100%', '0.0', '0']];
  assert.deepEqual(table(months).rows, PAGE1);
  assert.equal(count(months), '1–6 of 12 months');
  // On time is a chip (90 and up teal, 70 and up amber, else red); a month with late orders marks the count.
  assert.match(months, /<td class="k">Sep 2026 <span class="mwm-todate">to date<\/span><\/td><td class="num">8<\/td><td class="num">\$29K<\/td><td class="num"><span class="dz-chip red">50%<\/span><\/td><td class="num">38%<\/td><td class="num">7\.0<\/td><td class="num late">4<\/td>/);
  assert.match(months, /<td class="k">Aug 2026<\/td><td class="num">4<\/td><td class="num">\$10K<\/td><td class="num"><span class="dz-chip amber">75%<\/span>/);
  assert.match(months, /<td class="k">Apr 2026<\/td><td class="num">3<\/td><td class="num">\$5K<\/td><td class="num"><span class="dz-chip teal">100%<\/span><\/td><td class="num">100%<\/td><td class="num">0\.0<\/td><td class="num">0<\/td>/);
  // The pager: named buttons (aria-label, like every pager), Previous off on the first page.
  assert.deepEqual([...months.matchAll(/<button type="button" class="shp-pg[^"]*" data-focus-key="pg-ohg-months-(\w+)" aria-label="([^"]+)"( aria-disabled="true")?( aria-current="page")?/g)].map((m) => [m[1], m[2], !!m[3], !!m[4]]),
    [['prev', 'Previous page', true, false], ['1', 'Page 1 of 2', false, true], ['2', 'Page 2 of 2', false, false], ['next', 'Next page', false, false]]);
  assert.match(months, /<nav class="shp-pager dz-pager print-hide" data-dzpager="ohg-months" aria-label="Month by month pages" onkeydown="dzPagerKey\(event,&quot;ohg-months&quot;\)">/);
  page.run("dzGoPage('ohg-months',2)");
  months = card(detail(page), 'Month by month');
  assert.deepEqual(table(months).rows, PAGE2);
  assert.equal(count(months), '7–12 of 12 months');
  // Both pages together are the months' data: orders, on time, perfect order, days late and late orders from
  // mwmMetricsData, the value from mwmMonthlyData's shipped value of the same month.
  const data = lagData(page);
  assert.deepEqual(data, LAG_MONTHS);
  const pctOf = (v) => (v === null ? '—' : `${v}%`);
  const short = (v) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`);
  assert.deepEqual([...PAGE1, ...PAGE2], data.map(([label, orders, value, otd, perfect, days, late], i) => [i === 11 ? `${label} to date` : label, String(orders), short(value), pctOf(otd), pctOf(perfect), days === null ? '—' : days.toFixed(1), String(late)]).reverse());
  // Arrow keys, Home and End step through the pages.
  const press = (id, key) => page.run(`dzPagerKey({key:${JSON.stringify(key)},preventDefault(){}},${JSON.stringify(id)})`);
  press('ohg-months', 'ArrowLeft');
  assert.equal(count(card(detail(page), 'Month by month')), '1–6 of 12 months');
  press('ohg-months', 'End');
  assert.equal(count(card(detail(page), 'Month by month')), '7–12 of 12 months');
  press('ohg-months', 'Home');
  assert.deepEqual(table(card(detail(page), 'Month by month')).rows, PAGE1);

  // --- By warehouse: this month's deliveries by the warehouse that shipped them, most value first.
  d = detail(page);
  let wh = card(d, 'By warehouse');
  assert.match(wh, /<h2 class="dz-title" data-tip="Deliveries by the warehouse or CM that shipped them\.">By warehouse<\/h2><span class="dz-meta">September · 8 orders<\/span>/);
  assert.deepEqual(table(wh).head, [['Warehouse / CM', 'The warehouse or CM that shipped.'], ['Orders', 'Sales orders with a delivery in the range.'], ['Shipped', 'Shipped value.'], ['On time', 'Deliveries early or on time.'],
    ['Last 6 months', 'On time each month, Apr 2026 to Sep 2026, by delivery date. Dashed line: the 90% target.']]);
  const WH1 = [['Spyder · Lacombe', '1', '$7,000', '100%', ''], ['CM · Alta', '2', '$6,500', '100%', ''], ['CM · Beta', '1', '$5,000', '0%', ''], ['CM · DSM', '1', '$4,000', '0%', ''], ['CM SFG · Gamma', '1', '$3,000', '100%', ''], ['CM SFG · Delta', '1', '$2,000', '0%', '']];
  const WH2 = [['CM · Echo', '1', '$1,000', '0%', '']];
  assert.deepEqual(table(wh).rows, WH1);
  assert.equal(count(wh), '1–6 of 7 warehouses');
  // The columns left out (lines, quantity, early / on time / late) are in each row's tip.
  assert.deepEqual(table(wh).tips.slice(0, 3), ['Spyder · Lacombe\n• 1 delivery line, 10 qty\n• 1 early · 0 on time · 0 late', 'CM · Alta\n• 2 delivery lines, 20 qty\n• 1 early · 1 on time · 0 late', 'CM · Beta\n• 1 delivery line, 10 qty\n• 0 early · 0 on time · 1 late']);
  assert.match(wh, /<td class="k">CM · Alta<\/td><td class="num">2<\/td><td class="num">\$6,500<\/td><td class="num"><span class="dz-chip teal">100%<\/span><\/td>/);
  assert.match(wh, /<td class="k">CM · Beta<\/td><td class="num">1<\/td><td class="num">\$5,000<\/td><td class="num"><span class="dz-chip red">0%<\/span><\/td>/);
  assert.match(wh, /<nav class="shp-pager dz-pager print-hide" data-dzpager="ohg-wh" aria-label="By warehouse pages"/);
  page.run("dzGoPage('ohg-wh',2)");
  wh = card(detail(page), 'By warehouse');
  assert.deepEqual(table(wh).rows, WH2);
  assert.equal(count(wh), '7–7 of 7 warehouses');
  // The table is the ship target scenario's shippedWeekGroups (the same groups Monthly's warehouse table lists).
  const groups = page.run("(()=>{const m=currentMetrics(),s=moMonthlyParts(m,momSource(m),reportToday()).scenario;return {orders:s.shippedWeekOrders,isDefault:s.isDefaultRange,groups:s.shippedWeekGroups.map(g=>[g.warehouse,g.orders.size,g.value,g.early+g.onTime,g.rows.length])}})()");
  assert.deepEqual(groups, { orders: 8, isDefault: true, groups: [['Spyder - Lacombe', 1, 7000, 1, 1], ['CM - Alta', 2, 6500, 2, 2], ['CM - Beta', 1, 5000, 0, 1], ['CM - DSM', 1, 4000, 0, 1], ['CM SFG - Gamma', 1, 3000, 1, 1], ['CM SFG - Delta', 1, 2000, 0, 1], ['CM - Echo', 1, 1000, 0, 1]] });
  const usd = (v) => `$${v.toLocaleString('en-US')}`;
  assert.deepEqual([...WH1, ...WH2], groups.groups.map(([name, orders, value, ok, lines]) => [name.replace(/ - /g, ' · '), String(orders), usd(value), `${Math.round(ok / lines * 100)}%`, '']));
  assert.deepEqual(page.run('shipScenarioFor(currentMetrics()).shippedWeekGroups.map(g=>g.warehouse)'), groups.groups.map((g) => g[0]));

  // --- Booked vs shipped: lines by the month they were first due, oldest first (this year's months and any with open lines).
  let orig = card(d, 'Booked vs shipped');
  assert.match(orig, /<h2 class="dz-title" data-tip="Lines by the month they were first due: how much of the booked value has shipped\.">Booked vs shipped<\/h2><span class="dz-meta">By original delivery month<\/span>/);
  assert.deepEqual(table(orig).head, [['Original month', 'The month the lines were first due.'], ['Booked $ shipped', 'Shipped value as a share of the value booked for the month.'], ['Open', 'Open value still to ship.'], ['Late lines', 'Lines shipped after their original date.']]);
  const OG1 = [['Jan 2026', '100%', '$0', '1'], ['Feb 2026', '100%', '$0', '1'], ['Apr 2026', '100%', '$0', '0'], ['May 2026', '100%', '$0', '2'], ['Jul 2026', '100%', '$0', '1'], ['Aug 2026', '95%', '$1,100', '5']];
  const OG2 = [['Sep 2026', '65%', '$9,000', '0'], ['Oct 2026', '0%', '$4,000', '0'], ['Nov 2026', '0%', '$2,500', '0']];
  assert.deepEqual(table(orig).rows, OG1);
  assert.equal(count(orig), '1–6 of 9 months');
  // August: the four August deliveries and the four September ones first due in August ($22,000) of $23,100 booked.
  assert.equal(table(orig).tips[5], 'Aug 2026\n• $22,000 shipped of $23,100 booked\n• 1 open line · 8 closed lines\n• 10 qty open');
  assert.match(orig, /<td class="k">Aug 2026<\/td><td class="num">95%<\/td><td class="num">\$1,100<\/td><td class="num late">5<\/td>/);
  assert.match(orig, /<nav class="shp-pager dz-pager print-hide" data-dzpager="ohg-orig" aria-label="Booked vs shipped pages"/);
  page.run("dzGoPage('ohg-orig',2)");
  orig = card(detail(page), 'Booked vs shipped');
  assert.deepEqual(table(orig).rows, OG2);
  assert.equal(count(orig), '7–9 of 9 months');
  // The table is the original-month groups (moMonthlyParts' originalGroups, from groupByOriginalHeaderMonth).
  const og = page.run("(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).originalGroups.filter(g=>g.key&&g.key!=='No Original Delivery Date').map(g=>[g.label,g.openAmount,g.closedAmount,g.shippedLateRows])})()");
  assert.deepEqual(og, [['Jan 2026', 0, 1200, 1], ['Feb 2026', 0, 1000, 1], ['Apr 2026', 0, 4500, 0], ['May 2026', 0, 3000, 2], ['Jul 2026', 0, 4000, 1], ['Aug 2026', 1100, 22000, 5], ['Sep 2026', 9000, 16500, 0], ['Oct 2026', 4000, 0, 0], ['Nov 2026', 2500, 0, 0]]);
  assert.deepEqual([...OG1, ...OG2], og.map(([label, open, closed, late]) => [label, `${open + closed > 0 ? Math.round(closed / (open + closed) * 100) : 0}%`, usd(open), String(late)]));
  assert.deepEqual(page.run("groupByOriginalHeaderMonth(currentMetrics().allRows,indexShipmentsByLine(currentMetrics().allRows)).filter(g=>/^2026-/.test(g.key)).map(g=>[g.label,g.openAmount,g.closedAmount,g.shippedLateRows])"), og);
  // No month select on Lagging; the month picked on Leading's Items not shipped yet does not narrow this table.
  page.run("setOriginalDeliveryMonthFilter('2026-09')");
  d = detail(page);
  assert.doesNotMatch(d, /<select|id="ohg-original-month"/);
  assert.equal(count(card(d, 'Booked vs shipped')), '7–9 of 9 months');
  page.run("setOriginalDeliveryMonthFilter('ALL')");

  // --- A page filter narrows all three (and starts each list at page 1 again); a ship target range moves By warehouse.
  page.run("setWeeklyWarehouseFilter(['CM - Alta'])");
  d = detail(page);
  assert.deepEqual(table(card(d, 'Month by month')).rows[0], ['Sep 2026 to date', '2', '$7K', '100%', '50%', '0.0', '0']);
  assert.equal(count(card(d, 'Month by month')), '1–6 of 12 months');
  assert.deepEqual(table(card(d, 'By warehouse')).rows, [['CM · Alta', '2', '$6,500', '100%', '']]);
  assert.match(card(d, 'By warehouse'), /<span class="dz-meta">September · 2 orders<\/span>/);
  assert.doesNotMatch(card(d, 'By warehouse'), /dz-pagefoot/, 'one page, no pager');
  assert.deepEqual(table(card(d, 'Booked vs shipped')).rows, [['Sep 2026', '100%', '$0', '0']]);
  assert.equal(sofar(card(d, 'Trend')), 'September so far: 2 orders · $7K shipped · year to date $7K');
  page.run('resetWeeklyFilters()');
  page.run("setShipScenarioStartDate('2026-08-01');setShipScenarioTargetDate('2026-08-31')");
  wh = card(detail(page), 'By warehouse');
  assert.match(wh, /<span class="dz-meta">2026-08-01 to 2026-08-31 · 4 orders<\/span>/);
  assert.deepEqual(table(wh).rows, [['Spyder · Lacombe', '4', '$10,000', '75%', '']]);
  page.run("setShipScenarioStartDate('');setShipScenarioTargetDate('')");
  assert.match(card(detail(page), 'By warehouse'), /<span class="dz-meta">September · 8 orders<\/span>/);

  // --- On paper every row prints and the pagers are left out.
  page.run('printMode=true;renderResults()');
  d = detail(page);
  assert.deepEqual(table(card(d, 'Month by month')).rows, [...PAGE1, ...PAGE2]);
  assert.deepEqual(table(card(d, 'By warehouse')).rows, [...WH1, ...WH2]);
  assert.deepEqual(table(card(d, 'Booked vs shipped')).rows, [...OG1, ...OG2]);
  assert.doesNotMatch(d, /dz-pagefoot|shp-pager/);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(page.errors, []);
});

// Left failing on purpose (an app bug, index.html ohgSetTrendMetric). It looks the metric up with OHG_TREND[k], so a
// name every object has ('constructor', 'toString', 'hasOwnProperty') counts as a known metric; the card then has no
// label or format to draw with, the redraw throws, and Lagging stays broken until a chip sets a real metric.
test('BUG: ohgSetTrendMetric falls back to On Time for a name every object has (constructor, toString), not only for other unknown names', async () => {
  const page = await loaded([...ROWS, delivery('801', '08/08/2026'), delivery('802', '08/15/2026')]);
  page.run("setTab('metrics')");
  for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.doesNotThrow(() => page.run(`ohgSetTrendMetric('${name}')`), name);
    assert.equal(page.run('ohgTrendMetric'), 'otd', name);
    assert.match(card(detail(page), 'Trend'), /On-time delivery · August<\/h3>/, name);
  }
  assert.deepEqual(page.errors, []);
});

test('Purchase Orders: no This week focus tile; one Kit Status card (in the kits card) and one Unconfirmed · Missing price step (in the open POs strip)', async () => {
  // 500: unconfirmed; 501: missing price; 502: both (counts once on the card); 503: neither.
  const page = await loaded([...ROWS.slice(0, 3), po('500', '08/01/2026', { Confirmed: 'N' }), po('501', '10/30/2026', { PriceFlag: 'Missing Price' }),
    po('502', '10/30/2026', { Confirmed: 'N', PriceFlag: 'Missing Price' }), po('503', '10/30/2026')]);
  page.run("setTab('purchaseorders')");
  let h = html(page);
  assert.doesNotMatch(h, /data-focus-key="potile-duethisweek"|This week focus/);
  // Kits: the Not clean count, Clean / Not clean rows.
  assert.equal((h.match(/class="dz-stat kit-stat kit-card/g) || []).length, 1);
  // 2v6.9 (owner): "Kit Status" shows only two numbers, Clean and Not clean; each lists its lines.
  // Version 1 (owner): Kit Status lives in question 3's kits card, with a Clean / Not clean split bar under its label
  // (all four kits not clean here, so one amber part).
  assert.match(h, /<section class="dz-card po-kitscard[^"]*"[^>]*>[\s\S]*?<div class="po-kgrid"><div class="dz-stat kit-stat kit-card kit2 po-pair po-risk" role="group" aria-label="Kit Status">[\s\S]*?Kit Status<\/span><span class="po-split" aria-hidden="true"><i style="flex:4;background:var\(--dz-amber\)"><\/i><\/span><div class="kit2-row">/);
  assert.match(h, /data-focus-key="potile-kitclean" aria-pressed="false" onclick="setPoTileFilter\('kitclean'\)"[^>]*><span class="kit2-n">0<\/span><span class="kit2-l">Clean<\/span>/);
  assert.match(h, /data-focus-key="potile-kitnotclean" aria-pressed="false" onclick="setPoTileFilter\('kitnotclean'\)"[^>]*><span class="kit2-n">4<\/span><span class="kit2-l">Not clean<\/span>/);
  // Unconfirmed · Missing price: three POs (502 once), rows Unconfirmed 2 and Missing price 2; the old cards are gone.
  // Version 1 (owner): it is a step of "Where the open POs stand": 3 of the 4 open POs (75%), lines only, no money.
  assert.doesNotMatch(h, /<button type="button" class="dz-stat"[^>]*data-focus-key="potile-(unconfirmed|missingprice)"/);
  assert.doesNotMatch(h, /class="dz-stat po-follow|class="dz-stats sup-more-views po-fill"|class="sup-tiles po-strip"/);
  assert.match(h, /<div class="po-step[^"]*" style="--i:2" role="group" aria-label="Unconfirmed · Missing price"><button type="button" class="po-step-main" data-focus-key="potile-followup" onclick="setPoTileFilter\('followup'\)" aria-pressed="false" data-tip="Unconfirmed or missing price: 3 POs not confirmed or with no price \(each PO once\)\n• 3 lines · 30 qty\n• \$3,000 open\nClick to list them\."><span class="po-step-l"><i class="sup-dot" style="background:var\(--dz-amber\)"><\/i>Unconfirmed · Missing price<\/span><span class="po-step-v amber">3<\/span><span class="po-step-bar" aria-hidden="true"><i style="width:75%;background:var\(--dz-amber\)"><\/i><\/span><span class="po-step-of">75% of open POs<\/span><span class="po-step-s">3 lines<\/span><\/button><div class="po-step-rows">/);
  assert.match(h, /data-focus-key="potile-unconfirmed" aria-pressed="false" onclick="setPoTileFilter\('unconfirmed'\)"[^>]*><span class="po-own-name">Unconfirmed<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  assert.match(h, /data-focus-key="potile-missingprice" aria-pressed="false" onclick="setPoTileFilter\('missingprice'\)"[^>]*><span class="po-own-name">Missing price<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  assert.match(h, /<span class="dz-meta">each bar is a share of the <b>4<\/b> open POs<\/span>/);
  // The card lists both kinds, each row its own; the lines title says which.
  page.run("setPoTileFilter('followup')");
  h = html(page);
  assert.match(h, /<div class="po-step[^"]* sel" style="--i:2" role="group" aria-label="Unconfirmed · Missing price">/);
  assert.equal(page.run("poData(currentMetrics()).poTileRows.followup.map(r=>r.documentNumber).sort().join()"), '500,501,502');
  // 2v6.9 (owner): the PO lines card has no summary line under its title.
  assert.doesNotMatch(h, /Unconfirmed or missing price · 3 lines/);
  page.run("setPoTileFilter('missingprice')");
  h = html(page);
  assert.match(h, /class="po-own po-pair-row on amber" data-focus-key="potile-missingprice" aria-pressed="true"/);
  assert.equal(page.run("poData(currentMetrics()).poTileRows.missingprice.length"), 2);
  assert.doesNotMatch(h, /Missing price · 2 lines/);
  page.run("setPoTileFilter('kitclean')");
  h = html(page);
  assert.match(h, /class="dz-stat kit-stat kit-card kit2 po-pair po-risk sel"/);
  assert.match(h, /class="kit2-half ok on" data-focus-key="potile-kitclean" aria-pressed="true"/);
  assert.deepEqual(page.errors, []);
});

test('the menu calls Order Health "Sales Order Health": link, page title, logo, Settings', async () => {
  const page = await loaded(ROWS);
  const hdr = page.els['app-header'].innerHTML;
  assert.match(hdr, /aria-label="Spyder Controls Corp, Sales Order Health"/);
  assert.match(hdr, /data-focus-key="nav-weekly" onclick="setTab\('weekly'\)" aria-current="page"[^>]*>Sales Order Health</);
  // 2v6.9 (owner): the Sales Order Health title shows, like every other page.
  assert.match(html(page), /<div class="dz-pagehead rise"><h1 class="dz-h1" tabindex="-1">Sales Order Health<\/h1>/);
  page.run("setTab('settings')");
  assert.match(html(page), /id="stg-h-oh" tabindex="-1"[^>]*>[\s\S]*?Sales Order Health<\/h2>/);
  assert.equal(page.run('activeTab'), 'settings');
  assert.deepEqual(page.errors, []);
});

test('the new CSS sits in its own marker pair just before the Settings block, on colour tokens', () => {
  const start = HTML.indexOf('/* 2v9:pages */'), end = HTML.indexOf('/* 2v9:end pages */');
  assert.ok(start > 0 && end > start && HTML.indexOf('/* 2v8:settings */') === end + '/* 2v9:end pages */\n'.length);
  const css = HTML.slice(start, end);
  assert.match(css, /\.ohl-col\{display:flex;flex-direction:column;gap:16px/);
  assert.match(css, /\.ohl-kv-n\{[^}]*font-variant-numeric:tabular-nums/);
  assert.match(css, /\.sup-tiles\.po-strip\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/);
  // 2v9: Hidden Pages keeps its list here; its span is in the settings bento block (no fixed full row).
  assert.match(css, /\.stg-hp-list\{display:grid;/);
  assert.doesNotMatch(css, /#stg-card-hiddenpages\{grid-column/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{button\.ohl-kv\{transition:none\}\}/);
});

run();
