// 2v9 monthly-move: Monthly is dissolved into Sales Order Health. Its forward-looking sections are on Leading (Open
// orders by delivery month and Items not shipped yet, two folds of one Lists card (with Lines after them, in the same card), shut on load, without the
// shipped / open bar chart; the ship target's Calendar & lines). Lagging (Version 1, the owner's
// pick) is the Monthly and Quarterly cards over one grid of four cards: Trend (a metric switch, one chart, the newest
// month and why its orders were late), Month by month, By warehouse and Booked vs shipped. The Shipments section that
// stood there before (two charts, two month tables, the month cards, the shipped-to-date strip, the Shipped | Booked
// switch, the full warehouse and original-month tables) is only on the Monthly page now. Monthly starts hidden (once
// for browsers that chose their hidden pages); setTab('monthly') opens Lagging; Settings > Hidden Pages can show it
// again, and then it works. Run with `node tests/monthly-move-2v69.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const delivery = (doc, due, closed, o = {}) => so(doc, due, { OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, OpenQuantity: '0', ...o });
const DSM = { Warehouse: 'CM - DSM' };
// Report date 2026-09-03 (ExportDate). Open lines due Aug to Nov in two warehouses; deliveries in Aug and Sep:
// 300 a day early (Lacombe), 301 five days late (DSM), 302 a day late (Lacombe). Every line is 10 qty, $1,000.
const ROWS = [
  so('100', '08/01/2026'), so('101', '09/20/2026'), so('102', '10/20/2026', DSM), so('103', '11/05/2026', DSM), so('104', '08/20/2026', { ...DSM, CustomerVendorCode: 'AQUA', CustomerVendorName: 'AquaHot' }),
  ...Array.from({ length: 12 }, (_, i) => so(String(200 + i), `09/${String(5 + i).padStart(2, '0')}/2026`, i % 2 ? DSM : {})),
  delivery('300', '08/05/2026', '08/04/2026'), delivery('301', '08/10/2026', '08/15/2026', DSM), delivery('302', '09/01/2026', '09/02/2026'),
];
async function loaded(rows = ROWS, storage = IMPORT) {
  const page = loadPage({ storage: { ...storage } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}
// The body rows of a renderTableCard table (by its aria-label) and the rows of a dz role=table, as text.
const text = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tbody = (h, label) => {
  const m = h.match(new RegExp(`role="region" aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"><table[^>]*>[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`));
  return m ? [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => text(r[1])) : null;
};
const dzCells = (h, label) => {
  const i = h.indexOf(`<div role="table" aria-label="${label}"`);
  if (i < 0) return null;
  const part = h.slice(i, h.indexOf('</div></div>', i));
  return [...part.matchAll(/<div role="row" class="dz-tr[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((r) => [...r[1].matchAll(/<(span|b) role="cell"[^>]*>([\s\S]*?)<\/\1>(?=<(?:span|b) role="cell"|$)/g)].map((c) => text(c[2])));
};

// --- Lagging, Version 1: how these tests read it -----------------------------------------------------------------
// The Lagging panel (the shown one), and its cards in order, each named by its title or its aria-label.
const lagging = (h) => { const i = h.indexOf('id="oh-panel-lagging"'); const j = h.indexOf('<div class="oh-panel"', i); return i < 0 ? '' : h.slice(i, j < 0 ? undefined : j); };
const cardNames = (h) => [...h.matchAll(/<section class="dz-card[^"]*"([^>]*)>(?:<div class="dz-card-head[^"]*"><h2 class="dz-title[^"]*"[^>]*>([^<]+)<\/h2>)?/g)]
  .map((x) => x[2] || (/aria-label="([^"]+)"/.exec(x[1]) || [])[1] || '(no name)');
// One of the three compact tables (table.ohgt-tbl), by its card's name: the headings and their tips, each row's cells
// and tip, the card's meta line and its "1–6 of 12 months" count (none while the list fits one page).
const ohgTable = (h, label) => {
  const m = h.match(new RegExp(`<h2 class="dz-title" data-tip="([^"]+)">${label}</h2>(?:<span class="dz-meta">([^<]*)</span>)?</div><div class="sup-scroll" tabindex="0" role="region" aria-label="${label}"><table class="ohgt-tbl"><thead><tr>([\\s\\S]*?)</tr></thead><tbody>([\\s\\S]*?)</tbody></table></div>(?:<div class="dz-pagefoot"><span class="dz-pagecount">([^<]*)</span><nav class="shp-pager dz-pager print-hide" data-dzpager="([\\w-]+)")?`));
  if (!m) return null;
  const ths = [...m[3].matchAll(/<th scope="col"( class="num")?(?: data-tip="([^"]*)")?>([^<]*)<\/th>/g)];
  assert.equal(ths.length, (m[3].match(/<th\b/g) || []).length, `${label}: every heading is read`);
  const trs = [...m[4].matchAll(/<tr(?: data-tip="([^"]*)")?>([\s\S]*?)<\/tr>/g)];
  return { tip: m[1], meta: m[2] || '', head: ths.map((x) => x[3]), tips: ths.map((x) => x[2] || ''), rows: trs.map((r) => [...r[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]))),
    rowTips: trs.map((r) => r[1] || ''), count: m[5] || '', pager: m[6] || '' };
};
// The Trend card: the pressed chip, the chart (its name, y axis, month labels, dots with their tips, the target line)
// and the side panel (the heading with its tip, the figure, its change and tone, why orders were late, the so-far line).
const trend = (h) => {
  const i = h.indexOf('<section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend">');
  assert.ok(i > 0, 'the Trend card is drawn');
  const c = h.slice(i, h.indexOf('</section>', i));
  const one = (re) => (c.match(re) || []).slice(1);
  const now = one(/<div class="ohgt-now"><span>([^<]*)<\/span>(?:<span class="mwm-kpi-d (teal|red|)">([^<]*)<\/span>)?<\/div>/);
  const why = c.slice(c.indexOf('<div class="ohgt-why">'), c.indexOf('<p class="ohgt-sofar"'));
  return {
    card: c,
    chips: [...c.matchAll(/<button type="button" class="ohgt-chip( on)?" data-focus-key="ohg-trend-(\w+)" aria-pressed="(true|false)" onclick="ohgSetTrendMetric\('(\w+)'\)" data-tip="([^"]+)">([^<]+)<\/button>/g)]
      .map((x) => { assert.equal(x[2], x[4]); assert.equal(!!x[1], x[3] === 'true', 'the pressed chip is the highlighted one'); return [x[2], x[6], x[5], x[3] === 'true']; }),
    range: [...c.matchAll(/<button type="button" data-focus-key="mwm-range-(\d+)"( class="on")? aria-pressed="(true|false)" onclick="mwmSetRange\(\1\)" data-tip="Last \1 months\.">\1 months<\/button>/g)].map((x) => [Number(x[1]), x[3] === 'true']),
    plot: one(/<div class="mwm-plot" data-tip-notab role="img" aria-label="([^"]+)">/)[0],
    yaxis: [...(one(/<div class="mwm-yax">([\s\S]*?)<\/div>/)[0] || '').matchAll(/<span style="top:[^"]*">([^<]*)<\/span>/g)].map((x) => x[1]),
    n: Number(one(/<div class="mwm-xax" style="--n:(\d+)">/)[0]),
    xaxis: [...(one(/<div class="mwm-xax" style="--n:\d+">([\s\S]*?)<\/div>/)[0] || '').matchAll(/<span>([^<]*)<\/span>/g)].map((x) => x[1]),
    dots: [...c.matchAll(/<span class="mwm-pt" style="left:[\d.]+%;top:[\d.]+%;border-color:var\(--dz-[a-z]+\)" data-tip="([^"]+)"><\/span><span class="mwm-pt-l" style="[^"]*">([^<]*)<\/span>/g)].map((x) => [x[1], x[2]]),
    line: one(/<path d="([^"]*)" fill="none" stroke="(var\(--dz-[a-z]+\))"/),
    target: (c.match(/<i class="mwm-target" style="top:([\d.]+)%"><\/i>/) || [])[1] || null,
    heading: one(/<div class="ohgt-side">\s*<h3 data-tip="([^"]+)">([^<]+)<\/h3>/),
    now: now[0], tone: now[1], change: now[2],
    whyTitle: one(/<div class="ohgt-why"><h3 data-tip="Each late order under the first reason on its late delivery\.">([^<]+)<\/h3>/)[0],
    why: [...why.matchAll(/<li data-tip="([^"]+)"><span class="mwm-cause-l">([^<]+)<\/span><b class="mwm-cause-v">([^<]+)<\/b><\/li>/g)].map((x) => [x[2], x[3], x[1]]),
    none: /<p class="ohgt-none">No late orders\.<\/p>/.test(why),
    sofar: one(/<p class="ohgt-sofar" data-tip="([^"]+)">([\s\S]*?)<\/p>/).map((x, k) => (k ? text(x) : x)),
  };
};
// What is no longer drawn on Lagging: the page groups (Metrics, Shipments), the Metrics tiles and their sparklines, the
// two charts, the Monthly metrics table, the month cards, the shipped-to-date strip, the Shipped | Booked switch and the
// Month pick.
const GONE = /class="pg-group|id="ohg-shipments"|<div class="mwm-kpi[ "]|mwm-spark|mwm-kpi-cause|>Late orders by cause<|>Monthly metrics<|>On-time delivery<\/h2>|>Orders (shipped|booked) by month<\/h2>|role="table" aria-label="Month by month"|month-spot|month-card|mini-strip|Year over year|aria-label="Shipments view"|ohg-ship-mode|<select|ohg-original-month|Shipped by warehouse \/ CM|Original line delivery summary|Fill rate|Resched(ule)? hit<\/span>|mwm-herocard|to date<\/h2>/;
const lag = (page) => { page.run("setWeeklyView('lagging')"); return lagging(html(page)); };
// The same compact money the page writes ($1K, $28K, $950).
const short = (v) => (v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const dollars = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

test('Monthly is hidden by default, setTab and a stored page open Lagging; Hidden Pages can show it again and it still works', async () => {
  const page = await loaded();
  assert.deepEqual(page.run("stgValue('hiddenPages')"), ['monthly', 'warehouses', 'supplyweekly', 'supplydemand', 'buildrisk', 'forecast']);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /data-focus-key="nav-monthly"/);
  page.run("setTab('monthly')");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  // Lagging's detail grid, the Trend card first (it keeps the id the Metrics link scrolls to).
  assert.match(html(page), /<div class="dz-grid ohg-detail"><div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">2<\/span><h2 class="ohl-q-t" data-tc-skip>Which Way Is It Heading, and Why\?<\/h2><\/div><section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics" aria-label="Trend">/);
  page.run("setWeeklyView('leading');activeTab='monthly';renderResults()");
  assert.deepEqual(page.run('[activeTab,weeklyView]'), ['weekly', 'lagging'], 'a stored Monthly page opens Lagging');
  // Settings > Hidden Pages still lists Monthly (off); turning it on brings the page back as it was.
  page.run("setTab('settings')");
  assert.match(html(page), /id="stg-page-monthly" data-focus-key="stg-page-monthly" aria-checked="false" aria-label="Show Monthly"/);
  page.run("stgTogglePage('monthly')");
  assert.match(page.els['app-header'].innerHTML, /data-focus-key="nav-monthly"/);
  page.run("setTab('monthly')");
  assert.equal(page.run('activeTab'), 'monthly');
  const h = html(page);
  assert.match(h, /class="dz-card dz-span-6 dz-fade mwm-herocard"/);
  assert.match(h, /aria-labelledby="pg-mo-months"[\s\S]*aria-labelledby="pg-mo-shipped"[\s\S]*aria-labelledby="pg-mo-open"[\s\S]*aria-labelledby="pg-mo-scenario"/);
  // Everything that left Lagging is still here: the chart and table of orders by month with the Shipped | Booked
  // switch, the month cards, the shipped-to-date strip, the full warehouse and original-month tables with the Month pick.
  assert.match(h, />Orders shipped by month<\/h2>[\s\S]*<div role="table" aria-label="Month by month"[\s\S]*<div class="month-spot n4">[\s\S]*<section class="mini-strip cols-3" aria-label="Shipped to date">[\s\S]*Year over year[\s\S]*aria-label="Shipped by warehouse \/ CM · this month"[\s\S]*aria-label="Original line delivery summary"/);
  assert.match(h, /<select id="original-month-select" class="select" data-focus-key="original-month-select"/);
  assert.match(h, /data-focus-key="mwm-mode-booked" aria-pressed="false" onclick="mwmSetMode\(&#39;booked&#39;\)"/);
  // The choice is kept: it carries the flag, so the next visit does not hide Monthly again.
  const stored = JSON.parse(page.run("localStorage.getItem(stgKey())"));
  assert.equal(stored.hiddenMonthly2v69, true);
  assert.deepEqual(page.errors, []);
});

test('Monthly hidden once for a browser that chose its hidden pages before (hiddenMonthly2v69); a later choice is kept', async () => {
  const old = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import', hiddenPages: ['warehouses'], hiddenSupply2v69: true }) } });
  assert.deepEqual(old.run("stgValue('hiddenPages')"), ['monthly', 'warehouses']);
  const saved = JSON.parse(old.run('localStorage.getItem(stgKey())'));
  assert.equal(saved.hiddenMonthly2v69, true);
  assert.deepEqual(saved.hiddenPages, ['warehouses', 'monthly']);
  const shown = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import', hiddenPages: [], hiddenSupply2v69: true, hiddenMonthly2v69: true }) } });
  assert.deepEqual(shown.run("stgValue('hiddenPages')"), []);
});

test('Lagging: the Monthly and Quarterly cards, then one grid of Trend, Month by month, By warehouse and Booked vs shipped; the Shipments section and its parts are gone', async () => {
  const page = await loaded();
  const h = html(page);
  assert.doesNotMatch(h, /id="ohg-metrics"|ohg-detail/, 'Leading does not build it');
  const l = lag(page);
  const grid = l.indexOf('<div class="dz-grid ohg-grid">'), detail = l.indexOf('<div class="dz-grid ohg-detail">');
  assert.ok(grid > 0 && detail > grid, 'the Monthly and Quarterly cards, then the detail grid');
  assert.deepEqual(cardNames(l.slice(grid, detail)), ['Monthly', 'Quarterly']);
  assert.deepEqual(cardNames(l.slice(detail)), ['Trend', 'Month by month', 'By warehouse', 'Booked vs shipped']);
  // Trend and Month by month are full rows; By warehouse and Booked vs shipped share the last one.
  assert.deepEqual([...l.slice(detail).matchAll(/<section class="dz-card dz-span-(\d)/g)].map((x) => Number(x[1])), [6, 6, 3, 3]);
  assert.doesNotMatch(l, GONE);
  // The foot note of the old section stays under the grid.
  assert.match(l, /<\/section><\/div><p class="mom-foot">Delivery history starts 2026-08-04; earlier comparisons show n\/a\.<\/p>/);
  // Each card says what it shows: a title tip, and a meta line on the two small tables.
  assert.match(l, /<h2 class="dz-title" data-tip="One metric over the months shown\. Pick a metric to redraw the chart\.">Trend<\/h2>/);
  assert.equal(ohgTable(l, 'Month by month').tip, 'Orders shipped each month, by delivery date.');
  assert.deepEqual([ohgTable(l, 'By warehouse').tip, ohgTable(l, 'By warehouse').meta], ['Deliveries by the warehouse or CM that shipped them.', 'September · 1 order']);
  assert.deepEqual([ohgTable(l, 'Booked vs shipped').tip, ohgTable(l, 'Booked vs shipped').meta], ['Lines by the month they were first due: how much of the booked value has shipped.', 'By original delivery month']);
  // Every column heading of the three tables has a tip.
  const heads = { 'Month by month': ['Month', 'Orders', 'Value', 'On time', 'Perfect order', 'Avg days late', 'Late orders'], 'By warehouse': ['Warehouse / CM', 'Orders', 'Shipped', 'On time'], 'Booked vs shipped': ['Original month', 'Booked $ shipped', 'Open', 'Late lines'] };
  assert.equal((l.match(/<table class="ohgt-tbl">/g) || []).length, 3);
  for (const [label, want] of Object.entries(heads)) {
    const t = ohgTable(l, label);
    assert.deepEqual(t.head, want, label);
    t.tips.forEach((tip, i) => assert.ok(tip.length > 8 && /\.$/.test(tip), `${label} > ${t.head[i]}: a tip`));
  }
  assert.equal((l.match(/<th\b/g) || []).length, 15);
  assert.equal((l.match(/<th scope="col"(?: class="num")? data-tip="[^"]+">/g) || []).length, 15, 'every th has a tip');
  // The on-time and perfect-order headings explain themselves in the chips' words.
  assert.deepEqual(ohgTable(l, 'Month by month').tips.slice(3), ['Shipped by the original date.', 'Shipped complete, on time, never rescheduled.', 'Average days late, late deliveries only.', 'Orders shipped 1+ days late.']);
  assert.doesNotMatch(l, /NaN|undefined|\[object Object\]/);
  assert.deepEqual(page.errors, []);
});

test('Trend: five chips switch the chart and the side heading and figure; an unknown metric is On Time; the 90% target shows only for On Time', async () => {
  const page = await loaded();
  let t = trend(lag(page));
  assert.deepEqual(t.chips, [['otd', 'On Time', 'Shipped by the original date.', true], ['perfect', 'Perfect Order', 'Shipped complete, on time, never rescheduled.', false],
    ['days', 'Avg Days Late', 'Average days late, late deliveries only.', false], ['lateOrders', 'Late Orders', 'Orders shipped 1+ days late.', false], ['orders', 'Orders Shipped', 'Orders shipped in the month.', false]]);
  assert.match(t.card, /<div class="ohgt-chips" role="group" aria-label="Metric">/);
  // August: 300 early, 301 five days late. September (to date): 302 a day late.
  const want = {
    otd: { plot: 'On-time delivery, last 12 months', yaxis: ['100%', '50%', '0%'], dots: [['August 2026: On-time delivery 50%\n• 2 orders shipped\n• 1 order late', '50%'], ['September 2026: On-time delivery 0%\n• 1 order shipped\n• 1 order late', '0%']],
      stroke: 'var(--dz-indigo)', heading: ['Shipped by the original date.', 'On-time delivery · September to date'], now: '0%', tone: 'red', change: '−50 pts vs Aug' },
    // Nothing scores a perfect order here (the deliveries have no closed order line): no dots, a dash, no change.
    perfect: { plot: 'Perfect order, last 12 months', yaxis: ['100%', '75%', '50%'], dots: [], stroke: 'var(--dz-indigo)', heading: ['Shipped complete, on time, never rescheduled.', 'Perfect order · September to date'], now: '—', tone: undefined, change: undefined },
    // Fewer days late is the good move (teal).
    days: { plot: 'Avg days late, last 12 months', yaxis: ['6', '3', '0'], dots: [['August 2026: Avg days late 5.0\n• 2 orders shipped\n• 1 order late', '5.0'], ['September 2026: Avg days late 1.0\n• 1 order shipped\n• 1 order late', '1.0']],
      stroke: 'var(--dz-risk)', heading: ['Average days late, late deliveries only.', 'Avg days late · September to date'], now: '1.0', tone: 'teal', change: '−4 days vs Aug' },
    // The two counts have a figure every month (0 where nothing shipped), so a dot every month.
    lateOrders: { plot: 'Late orders, last 12 months', top: '2', zeros: 10, dots: [['August 2026: Late orders 1\n• 2 orders shipped\n• 1 order late', '1'], ['September 2026: Late orders 1\n• 1 order shipped\n• 1 order late', '1']],
      stroke: 'var(--dz-risk)', heading: ['Orders shipped 1+ days late.', 'Late orders · September to date'], now: '1', tone: '', change: 'no change vs Aug' },
    orders: { plot: 'Orders shipped, last 12 months', yaxis: ['2', '1', '0'], zeros: 10, dots: [['August 2026: Orders shipped 2\n• 2 orders shipped\n• 1 order late', '2'], ['September 2026: Orders shipped 1\n• 1 order shipped\n• 1 order late', '1']],
      stroke: 'var(--dz-teal)', heading: ['Orders shipped in the month.', 'Orders shipped · September to date'], now: '1', tone: 'red', change: '−1 vs Aug' },
  };
  const MONTHS = ['October 2025', 'November 2025', 'December 2025', 'January 2026', 'February 2026', 'March 2026', 'April 2026', 'May 2026', 'June 2026', 'July 2026'];
  const seen = new Set();
  for (const [k, w] of Object.entries(want)) {
    page.run(`ohgSetTrendMetric(${JSON.stringify(k)})`);
    assert.equal(page.run('ohgTrendMetric'), k);
    t = trend(lagging(html(page)));
    assert.deepEqual(t.chips.filter((c) => c[3]).map((c) => c[0]), [k], `${k}: its chip is the pressed one`);
    assert.equal(t.plot, w.plot, k);
    if (w.yaxis) assert.deepEqual(t.yaxis, w.yaxis, `${k}: y axis`);
    else assert.deepEqual([t.yaxis[0], t.yaxis[2]], [w.top, '0'], `${k}: y axis from 0 to a round top`);
    const zeros = w.zeros ? MONTHS.map((mth) => [`${mth}: ${w.plot.split(',')[0]} 0\n• 0 orders shipped\n• 0 orders late`, '0']) : [];
    assert.deepEqual(t.dots, [...zeros, ...w.dots], `${k}: one dot a scored month, its value beside it`);
    assert.equal(t.line[1], w.stroke, `${k}: line colour`);
    assert.equal(t.line[0].split(/[ML]/).filter(Boolean).length, zeros.length + w.dots.length, `${k}: the line joins the dots`);
    assert.deepEqual(t.heading, w.heading, `${k}: side heading`);
    assert.deepEqual([t.now, t.tone, t.change], [w.now, w.tone, w.change], `${k}: side figure and its change`);
    // The dashed 90% target is On Time's alone.
    assert.equal(t.target, k === 'otd' ? '10.00' : null, `${k}: target line`);
    // Why orders were late and the so-far line do not follow the metric.
    assert.equal(t.whyTitle, 'Why orders were late · September', k);
    assert.deepEqual(t.why, [['Past due · No reschedule', '1', 'Past due · No reschedule: 1 order of 1 late in September.']], k);
    assert.deepEqual(t.sofar, ['September so far\n• 1 order shipped, $1,000 on 1 delivery line\n• Year to date: $3,000 on 3 delivery lines', 'September so far: 1 order · $1K shipped · year to date $3K'], k);
    seen.add(JSON.stringify([t.plot, t.yaxis, t.dots, t.heading, t.now]));
  }
  assert.equal(seen.size, 5, 'five different charts and figures');
  // The side figure is the newest month's own number.
  const m = page.run('(()=>{const x=mwmMetricsData(currentMetrics());return {L:x.L,cur:x.months[x.L],prev:x.months[x.L-1],causes:x.causes,late:x.lateOrders}})()');
  assert.deepEqual([m.L, m.cur.otd, m.prev.otd, m.cur.days, m.prev.days, m.cur.lateOrders, m.prev.lateOrders, m.cur.orders, m.prev.orders, m.cur.perfect], [11, 0, 50, 1, 5, 1, 1, 1, 2, null]);
  assert.deepEqual([m.causes, m.late], [[['Past due · No reschedule', 1]], 1]);
  // An unknown metric falls back to On Time: through the setter, and for a stored value at draw time.
  page.run("ohgSetTrendMetric('fill')");
  assert.equal(page.run('ohgTrendMetric'), 'otd');
  t = trend(lagging(html(page)));
  assert.deepEqual([t.plot, t.heading[1], t.now, t.target], ['On-time delivery, last 12 months', 'On-time delivery · September to date', '0%', '10.00']);
  page.run("ohgSetTrendMetric('orders');ohgTrendMetric='hit';renderResults()");
  t = trend(lagging(html(page)));
  assert.deepEqual(t.chips.filter((c) => c[3]).map((c) => c[0]), ['otd']);
  assert.deepEqual([t.plot, t.heading[1], t.now, t.target], ['On-time delivery, last 12 months', 'On-time delivery · September to date', '0%', '10.00']);
  page.run('ohgSetTrendMetric()');
  assert.equal(page.run('ohgTrendMetric'), 'otd');
  assert.deepEqual(page.errors, []);
});

test('Trend: the Months switch changes the number of months on the chart (12, 6, 3); the table under it keeps its twelve', async () => {
  const page = await loaded();
  let t = trend(lag(page));
  assert.deepEqual(t.range, [[12, true], [6, false], [3, false]]);
  assert.match(t.card, /<div class="ohgt-tools"><div class="dz-seg sup-seg-sm" role="group" aria-label="Months shown">/);
  assert.deepEqual([t.n, t.xaxis], [12, ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']]);
  for (const [n, labels] of [[6, ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']], [3, ['Jul', 'Aug', 'Sep']], [12, ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']]]) {
    page.run(`mwmSetRange(${n})`);
    const l = lagging(html(page));
    t = trend(l);
    assert.deepEqual(t.range.filter((r) => r[1]).map((r) => r[0]), [n]);
    assert.deepEqual([t.n, t.xaxis], [n, labels], `${n} months`);
    assert.equal(t.plot, `On-time delivery, last ${n} months`);
    // The two scored months stay on the chart, spread over the months shown.
    assert.deepEqual(t.dots.map((d) => d[1]), ['50%', '0%']);
    assert.match(t.card, new RegExp(`class="mwm-pt" style="left:${((n - 0.5) / n * 100).toFixed(2)}%;top:100\\.00%;`), `${n}: September is the last column`);
    // The side panel and the Month by month table do not follow the switch.
    assert.deepEqual([t.heading[1], t.now, t.change], ['On-time delivery · September to date', '0%', '−50 pts vs Aug']);
    assert.equal(ohgTable(l, 'Month by month').count, '1–6 of 12 months');
  }
  // Another number is 12 months; the other metrics follow the switch too.
  page.run('mwmSetRange(4)');
  assert.equal(trend(lagging(html(page))).n, 12);
  page.run("mwmSetRange(3);ohgSetTrendMetric('orders')");
  t = trend(lagging(html(page)));
  assert.deepEqual([t.n, t.xaxis, t.plot, t.dots.map((d) => d[1])], [3, ['Jul', 'Aug', 'Sep'], 'Orders shipped, last 3 months', ['0', '2', '1']]);
  assert.deepEqual(page.errors, []);
});

test('Month by month: twelve months newest first, six a page, with the numbers of mwmMetricsData and the shipped value of mwmMonthlyData (the Monthly page agrees)', async () => {
  const page = await loaded();
  const data = page.run(`(()=>{const m=currentMetrics(),x=mwmMetricsData(m),d=mwmMonthlyData(m);
    return x.months.map((r,i)=>({label:r.date.toLocaleDateString('en-US',{month:'short',year:'numeric'}),orders:r.orders,otd:r.otd,perfect:r.perfect,days:r.days,lateOrders:r.lateOrders,value:d.entries[i].shipped.value}))})()`);
  assert.equal(data.length, 12);
  assert.deepEqual(data.map((r) => r.label), ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']);
  // The fixture's two months with deliveries; the ten before them have none.
  assert.deepEqual(data.slice(10), [{ label: 'Aug 2026', orders: 2, otd: 50, perfect: null, days: 5, lateOrders: 1, value: 2000 }, { label: 'Sep 2026', orders: 1, otd: 0, perfect: null, days: 1, lateOrders: 1, value: 1000 }]);
  for (const r of data.slice(0, 10)) assert.deepEqual([r.orders, r.otd, r.perfect, r.days, r.lateOrders, r.value], [0, null, null, null, 0, 0], r.label);
  const pctOf = (v) => (v === null ? '—' : `${v}%`);
  const rowOf = (r, i) => [`${r.label}${i === 11 ? ' to date' : ''}`, String(r.orders), short(r.value), pctOf(r.otd), pctOf(r.perfect), r.days === null ? '—' : r.days.toFixed(1), String(r.lateOrders)];
  const all = data.map(rowOf).reverse();
  let l = lag(page);
  let t = ohgTable(l, 'Month by month');
  assert.deepEqual(t.rows, all.slice(0, 6), 'page 1: the six newest months');
  assert.deepEqual(t.rows.slice(0, 3), [['Sep 2026 to date', '1', '$1K', '0%', '—', '1.0', '1'], ['Aug 2026', '2', '$2K', '50%', '—', '5.0', '1'], ['Jul 2026', '0', '$0', '—', '—', '—', '0']]);
  assert.deepEqual([t.count, t.pager], ['1–6 of 12 months', 'ohg-months']);
  // A late month's count is marked; the on-time rate is a chip in its tone (under 70% red).
  assert.match(l, /<td class="k">Sep 2026 <span class="mwm-todate">to date<\/span><\/td><td class="num">1<\/td><td class="num">\$1K<\/td><td class="num"><span class="dz-chip red">0%<\/span><\/td><td class="num">—<\/td><td class="num">1\.0<\/td><td class="num late">1<\/td>/);
  assert.match(l, /<td class="k">Jul 2026<\/td><td class="num">0<\/td><td class="num">\$0<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">0<\/td>/);
  // The pager: ‹ 1 2 ›, each button named for a screen reader; page 2 is the six older months.
  const nav = l.slice(l.indexOf('data-dzpager="ohg-months"'), l.indexOf('</nav>', l.indexOf('data-dzpager="ohg-months"')));
  assert.match(nav, /^data-dzpager="ohg-months" aria-label="Month by month pages" onkeydown="dzPagerKey\(event,&quot;ohg-months&quot;\)">/);
  assert.deepEqual([...nav.matchAll(/<button type="button" class="shp-pg[^"]*" data-focus-key="pg-ohg-months-(\w+)" aria-label="([^"]+)"/g)].map((x) => [x[1], x[2]]),
    [['prev', 'Previous page'], ['1', 'Page 1 of 2'], ['2', 'Page 2 of 2'], ['next', 'Next page']]);
  page.run('dzGoPage("ohg-months",2)');
  l = lagging(html(page));
  t = ohgTable(l, 'Month by month');
  assert.deepEqual(t.rows, all.slice(6), 'page 2: the six older months');
  assert.deepEqual(t.rows.map((r) => r[0]), ['Mar 2026', 'Feb 2026', 'Jan 2026', 'Dec 2025', 'Nov 2025', 'Oct 2025']);
  assert.equal(t.count, '7–12 of 12 months');
  assert.match(l, /data-focus-key="pg-ohg-months-2" aria-label="Page 2 of 2" aria-current="page"/);
  // A metric or months change keeps the page; the table's numbers do not depend on either.
  page.run("ohgSetTrendMetric('days');mwmSetRange(3)");
  assert.deepEqual(ohgTable(lagging(html(page)), 'Month by month').rows, all.slice(6));
  page.run('dzGoPage("ohg-months",1)');
  assert.deepEqual(ohgTable(lagging(html(page)), 'Month by month').rows, all.slice(0, 6));
  // The Monthly page (shown again) lists the same orders, value, on-time rate and late orders for the same months.
  page.run("stgTogglePage('monthly');setTab('monthly')");
  const mo = dzCells(html(page), 'Month by month');
  assert.equal(mo.length, 12);
  assert.deepEqual(mo.map((r) => [r[1], r[2], r[4], r[6]]), all.map((r) => [r[1], r[2], r[3], r[6]]));
  assert.deepEqual(page.errors, []);
});

test('By warehouse is the ship target range\'s deliveries (moMonthlyParts scenario.shippedWeekGroups); Booked vs shipped is the original-month groups; the full columns are in the row tips', async () => {
  const page = await loaded();
  const groups = () => page.run(`(()=>{const m=currentMetrics(),sd=moMonthlyParts(m,momSource(m),reportToday()).scenario;
    return {orders:sd.shippedWeekOrders,rows:sd.shippedWeekGroups.map(g=>({warehouse:g.warehouse,orders:g.orders.size,value:g.value,lines:g.rows.length,qty:g.qty,early:g.early,onTime:g.onTime,late:g.late}))}})()`);
  const whRow = (g) => [g.warehouse.replace(/ - /g, ' · '), String(g.orders), dollars(g.value), `${Math.round((g.early + g.onTime) / g.lines * 100)}%`];
  const whTip = (g) => `${g.warehouse.replace(/ - /g, ' · ')}\n• ${g.lines} delivery line${g.lines === 1 ? '' : 's'}, ${g.qty} qty\n• ${g.early} early · ${g.onTime} on time · ${g.late} late`;
  // September (the default range): only 302, a day late, from Lacombe.
  let g = groups();
  assert.deepEqual(g, { orders: 1, rows: [{ warehouse: 'Spyder - Lacombe', orders: 1, value: 1000, lines: 1, qty: 10, early: 0, onTime: 0, late: 1 }] });
  let l = lag(page);
  let t = ohgTable(l, 'By warehouse');
  assert.deepEqual(t.rows, [['Spyder · Lacombe', '1', '$1,000', '0%']]);
  assert.deepEqual(t.rows, g.rows.map(whRow));
  assert.deepEqual(t.rowTips, ['Spyder · Lacombe\n• 1 delivery line, 10 qty\n• 0 early · 0 on time · 1 late']);
  assert.deepEqual([t.meta, t.count], ['September · 1 order', '']);
  // The ship target's dates (Leading) widen it: from Aug 1, Lacombe has 300 (early) and 302 (late), DSM has 301 (late).
  page.run("setShipScenarioStartDate('2026-08-01')");
  g = groups();
  assert.deepEqual(g, { orders: 3, rows: [{ warehouse: 'Spyder - Lacombe', orders: 2, value: 2000, lines: 2, qty: 20, early: 1, onTime: 0, late: 1 }, { warehouse: 'CM - DSM', orders: 1, value: 1000, lines: 1, qty: 10, early: 0, onTime: 0, late: 1 }] });
  l = lagging(html(page));
  t = ohgTable(l, 'By warehouse');
  assert.deepEqual(t.rows, [['Spyder · Lacombe', '2', '$2,000', '50%'], ['CM · DSM', '1', '$1,000', '0%']]);
  assert.deepEqual(t.rows, g.rows.map(whRow));
  assert.deepEqual(t.rowTips, g.rows.map(whTip));
  assert.equal(t.meta, '2026-08-01 to 2026-09-30 · 3 orders');
  // The Monthly page's full table (shown again) has the same warehouses, orders, value and on-time rate.
  page.run("stgTogglePage('monthly');setTab('monthly')");
  const full = [...html(page).match(/role="region" aria-label="Shipped by warehouse \/ CM · 2026-08-01 to 2026-09-30"><table[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])));
  assert.deepEqual(full.map((r) => [r[0].replace(/ - /g, ' · '), r[1], r[4], r[5]]), t.rows);
  page.run("setShipScenarioStartDate('');setTab('weekly')");
  l = lag(page);
  assert.equal(ohgTable(l, 'By warehouse').meta, 'September · 1 order');

  // Booked vs shipped: lines by the month they were first due. Aug: 100 and 104 open, 300 and 301 shipped (301 late).
  // Sep: 13 open, 302 shipped late. Oct and Nov: one open line each.
  const og = page.run(`(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).originalGroups.filter(g=>g.key&&g.key!=='No Original Delivery Date')
    .map(g=>({key:g.key,label:g.label,open:g.openAmount,shipped:g.closedAmount,openRows:g.openRows,closedRows:g.closedRows,late:g.shippedLateRows,openQty:g.openQty}))})()`);
  assert.deepEqual(og, [{ key: '2026-08', label: 'Aug 2026', open: 2000, shipped: 2000, openRows: 2, closedRows: 0, late: 1, openQty: 20 }, { key: '2026-09', label: 'Sep 2026', open: 13000, shipped: 1000, openRows: 13, closedRows: 0, late: 1, openQty: 130 },
    { key: '2026-10', label: 'Oct 2026', open: 1000, shipped: 0, openRows: 1, closedRows: 0, late: 0, openQty: 10 }, { key: '2026-11', label: 'Nov 2026', open: 1000, shipped: 0, openRows: 1, closedRows: 0, late: 0, openQty: 10 }]);
  // The same groups as the report's own grouping by original month.
  assert.deepEqual(og.map((x) => [x.key, x.open, x.shipped, x.late]), page.run("currentMetrics().byOriginalHeaderMonth.filter(g=>g.key&&g.key!=='No Original Delivery Date').map(g=>[g.key,g.openAmount,g.closedAmount,g.shippedLateRows])"));
  t = ohgTable(l, 'Booked vs shipped');
  assert.deepEqual(t.rows, [['Aug 2026', '50%', '$2,000', '1'], ['Sep 2026', '7%', '$13,000', '1'], ['Oct 2026', '0%', '$1,000', '0'], ['Nov 2026', '0%', '$1,000', '0']]);
  assert.deepEqual(t.rows, og.map((x) => [x.label, `${Math.round(x.shipped / (x.open + x.shipped) * 100)}%`, dollars(x.open), String(x.late)]));
  const n = (c, word) => `${c} ${word}${c === 1 ? '' : 's'}`;
  assert.deepEqual(t.rowTips, og.map((x) => `${x.label}\n• ${dollars(x.shipped)} shipped of ${dollars(x.open + x.shipped)} booked\n• ${n(x.openRows, 'open line')} · ${n(x.closedRows, 'closed line')}\n• ${x.openQty} qty open`));
  assert.equal(t.rowTips[2], 'Oct 2026\n• $0 shipped of $1,000 booked\n• 1 open line · 0 closed lines\n• 10 qty open');
  assert.deepEqual([t.meta, t.count], ['By original delivery month', '']);
  // Months with late lines mark the count.
  assert.match(l, /<td class="k">Aug 2026<\/td><td class="num">50%<\/td><td class="num">\$2,000<\/td><td class="num late">1<\/td>/);
  assert.match(l, /<td class="k">Oct 2026<\/td><td class="num">0%<\/td><td class="num">\$1,000<\/td><td class="num">0<\/td>/);
  // Tips write money in full; no "1 lines".
  for (const [, tip] of l.matchAll(/data-tip="([^"]+)"/g)) { assert.doesNotMatch(tip, /\$\d+(\.\d+)?[KM]\b/, tip); assert.doesNotMatch(tip, /\b1 (lines|orders|delivery lines)\b/, tip); }
  assert.deepEqual(page.errors, []);
});

const WAREHOUSES = ['CM - Alta', 'CM - Beta', 'CM - DSM', 'CM SFG - Delta', 'CM SFG - Gamma', 'Spyder - Lacombe', 'Spyder - Red Deer'];
// Seven warehouses each ship one order on Sep 3 (two days late; $7,000 down to $1,000); open lines first due in eight
// months, Aug 2026 to Mar 2027.
const BIG = [
  ...WAREHOUSES.map((w, i) => delivery(String(400 + i), '09/01/2026', '09/03/2026', { Warehouse: w, AmountLocal: `${7 - i},000.00` })),
  ...['08/15/2026', '09/15/2026', '10/15/2026', '11/15/2026', '12/15/2026', '01/15/2027', '02/15/2027', '03/15/2027'].map((d, i) => so(String(500 + i), d)),
];
test('By warehouse and Booked vs shipped go six a page, each with its own pager (ohg-wh, ohg-orig); a page filter starts every list at page 1', async () => {
  const page = await loaded(BIG);
  let l = lag(page);
  const wh = WAREHOUSES.map((w, i) => [w.replace(/ - /g, ' · '), '1', dollars((7 - i) * 1000), '0%']);
  let t = ohgTable(l, 'By warehouse');
  assert.deepEqual(t.rows, wh.slice(0, 6), 'most shipped value first');
  assert.deepEqual([t.meta, t.count, t.pager], ['September · 7 orders', '1–6 of 7 warehouses', 'ohg-wh']);
  const months = ['Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027'];
  // Sep: one open line ($1,000) and the seven deliveries ($28,000 shipped, all late): 28 of 29 is 97%.
  const orig = months.map((mth) => (mth === 'Sep 2026' ? [mth, '97%', '$1,000', '7'] : [mth, '0%', '$1,000', '0']));
  t = ohgTable(l, 'Booked vs shipped');
  assert.deepEqual(t.rows, orig.slice(0, 6));
  assert.deepEqual([t.count, t.pager], ['1–6 of 8 months', 'ohg-orig']);
  assert.match(l, /data-dzpager="ohg-wh" aria-label="By warehouse pages"/);
  assert.match(l, /data-dzpager="ohg-orig" aria-label="Booked vs shipped pages"/);
  // Each list turns its own page.
  page.run('dzGoPage("ohg-wh",2)');
  l = lagging(html(page));
  assert.deepEqual(ohgTable(l, 'By warehouse').rows, wh.slice(6));
  assert.equal(ohgTable(l, 'By warehouse').count, '7–7 of 7 warehouses');
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows, orig.slice(0, 6));
  assert.equal(ohgTable(l, 'Month by month').count, '1–6 of 12 months');
  page.run('dzGoPage("ohg-orig",2);dzGoPage("ohg-months",2)');
  l = lagging(html(page));
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows, orig.slice(6));
  assert.equal(ohgTable(l, 'Booked vs shipped').count, '7–8 of 8 months');
  assert.equal(ohgTable(l, 'Month by month').count, '7–12 of 12 months');
  // The lists hold what their data holds, in its order.
  assert.deepEqual(page.run("(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).scenario.shippedWeekGroups.map(g=>[g.warehouse,g.value])})()"), WAREHOUSES.map((w, i) => [w, (7 - i) * 1000]));
  assert.deepEqual(page.run("(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).originalGroups.map(g=>g.label)})()"), months);
  // A page filter makes new lists: all three start at page 1 again.
  page.run("setWeeklyWarehouseFilter(['CM - Alta','CM - Beta','CM - DSM','CM SFG - Delta','CM SFG - Gamma','Spyder - Lacombe'])");
  l = lagging(html(page));
  assert.deepEqual(ohgTable(l, 'By warehouse').rows, wh.slice(0, 6));
  assert.deepEqual([ohgTable(l, 'By warehouse').count, ohgTable(l, 'By warehouse').meta], ['', 'September · 6 orders']);
  assert.equal(ohgTable(l, 'Month by month').count, '1–6 of 12 months');
  assert.equal(ohgTable(l, 'Booked vs shipped').count, '1–6 of 8 months');
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows[1], ['Sep 2026', '96%', '$1,000', '6'], '27 of 28');
  // Paper: every row, no pager.
  page.run("setWeeklyWarehouseFilter(['ALL']);dzGoPage('ohg-wh',2);printMode=true;renderResults()");
  l = lagging(html(page));
  assert.deepEqual(ohgTable(l, 'By warehouse').rows, wh);
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows, orig);
  assert.equal(ohgTable(l, 'Month by month').rows.length, 12);
  assert.doesNotMatch(l, /dz-pagefoot|shp-pager/);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(page.errors, []);
});

test('Why orders were late: each first reason and its late orders, most first; past six rows the rest are one Other row; none says so', async () => {
  const page = await loaded(BIG);
  let t = trend(lag(page));
  assert.equal(t.whyTitle, 'Why orders were late · September');
  assert.deepEqual(t.why, [['Past due · No reschedule', '7', 'Past due · No reschedule: 7 orders of 7 late in September.']]);
  assert.deepEqual([t.heading[1], t.now, t.change], ['On-time delivery · September to date', '0%', undefined], 'no August deliveries to compare with');
  assert.deepEqual(t.sofar, ['September so far\n• 7 orders shipped, $28,000 on 7 delivery lines\n• Year to date: $28,000 on 7 delivery lines', 'September so far: 7 orders · $28K shipped · year to date $28K']);
  // The list is drawn from mwmMetricsData's causes: six reasons show as they are.
  const withCauses = (list) => page.run(`mwmMetricsData=(m)=>({...realMetrics(m),causes:${JSON.stringify(list)},lateOrders:${list.reduce((s, c) => s + c[1], 0)}});renderResults()`);
  page.run('var realMetrics=mwmMetricsData');
  const six = [['A', 6], ['B', 5], ['C', 4], ['D', 3], ['E', 2], ['F', 1]];
  withCauses(six);
  t = trend(lagging(html(page)));
  assert.deepEqual(t.why.map((x) => [x[0], Number(x[1])]), six);
  assert.equal(t.why[5][2], 'F: 1 order of 21 late in September.');
  // Eight reasons: the first five, then Other with the rest added up (its tip names them).
  withCauses([...six, ['G', 1], ['H', 1]]);
  t = trend(lagging(html(page)));
  assert.deepEqual(t.why.map((x) => [x[0], Number(x[1])]), [['A', 6], ['B', 5], ['C', 4], ['D', 3], ['E', 2], ['Other', 3]]);
  assert.equal(t.why[5][2], 'Other: 3 orders\n• F: 1\n• G: 1\n• H: 1');
  page.run('mwmMetricsData=realMetrics;renderResults()');
  // No deliveries at all: a dash for the newest month, "No late orders.", an empty By warehouse; the open lines still
  // show under Booked vs shipped.
  const quiet = await loaded([so('100', '08/01/2026'), so('101', '09/20/2026')]);
  const l = lag(quiet);
  assert.match(l, /<p class="dz-sub ohg-empty">Needs delivery close-date data: this export has no deliveries to score\.<\/p>/);
  t = trend(l);
  assert.deepEqual([t.heading[1], t.now, t.change, t.none, t.why, t.dots], ['On-time delivery · August', '—', undefined, true, [], []]);
  assert.deepEqual(t.sofar, ['September so far\n• 0 orders shipped, $0 on 0 delivery lines\n• Year to date: $0 on 0 delivery lines', 'September so far: 0 orders · $0 shipped · year to date $0']);
  assert.deepEqual(ohgTable(l, 'Month by month').rows[0], ['Sep 2026 to date', '0', '$0', '—', '—', '—', '0']);
  assert.match(l, />By warehouse<\/h2><span class="dz-meta">September · 0 orders<\/span><\/div><p class="empty-note">No deliveries in this range\.<\/p>/);
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows, [['Aug 2026', '0%', '$1,000', '0'], ['Sep 2026', '0%', '$1,000', '0']]);
  assert.deepEqual(quiet.errors, []);
  assert.deepEqual(page.errors, []);
});

// --- Leading (Version 1, four questions): how these tests read it ----------------------------------------------------
// The Leading panel, its question heads ("1 What Is at Risk?"), and the Lists card with its two folds (each:
// its key, whether it is open, the summary's tip, title and meta, and what is inside).
const leading = (h) => { const i = h.indexOf('id="oh-panel-leading"'); const j = h.indexOf('<div class="oh-panel"', i); return i < 0 ? '' : h.slice(i, j < 0 ? undefined : j); };
const questions = (h) => [...h.matchAll(/<div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">(\d)<\/span><h2 class="ohl-q-t" data-tc-skip>([^<]+)<\/h2><\/div>/g)].map((x) => `${x[1]} ${x[2]}`);
const monthsCard = (h) => { const i = h.indexOf('<section class="dz-card dz-span-6 ohl-card ohl-months mom-card misc-flat dz-fade" aria-label="Lists">'); return i < 0 ? '' : h.slice(i, h.indexOf('</section>', i)); };
const folds = (h) => [...monthsCard(h).matchAll(/<details class="ohl-fold"( open)? data-more="([\w-]+)" ontoggle="ohlFoldToggle\(this\)"><summary data-focus-key="more-\2" data-tip="([^"]+)"><svg class="dz-chev"[^>]*>[\s\S]*?<\/svg><span class="dz-title sm ohl-fold-t">([^<]+)<\/span><span class="ohl-fold-m">([^<]*)<\/span><\/summary><div class="ohl-fold-body">([\s\S]*?)<\/div><\/details>/g)]
  .map((x) => ({ open: !!x[1], key: x[2], tip: x[3], title: x[4], meta: x[5], body: x[6] }));

test('Leading: Open orders by delivery month and Items not shipped yet are two folds of one card before the Lines card, shut on load, with no bar chart; the ship target opens Calendar & lines', async () => {
  const page = await loaded();
  let h = html(page);
  // Nothing to pull in and no date changes in this export: three questions, then the Lists card, then Lines.
  assert.deepEqual(questions(h), ['1 What Is at Risk?', '2 Why, and When?', '3 Who?']);
  assert.deepEqual(cardNames(leading(h)), ['At risk', 'September ship target', 'Status', 'Top reasons and open lines by due week', 'Customers at risk', 'Lists', 'Lines']);
  // One card, two folds, both shut on load; each summary has its tip, its title and a short meta (the year, the lines).
  let f = folds(h);
  assert.equal((monthsCard(h).match(/<details\b/g) || []).length, 2);
  assert.deepEqual(f.map((x) => [x.key, x.open, x.title, x.meta, x.tip]), [
    ['ohl-fold-months', false, 'Open orders by delivery month', '2026', 'Shipped and open value per month, against last year.'],
    ['ohl-fold-items', false, 'Items not shipped yet', '17 lines', 'Open lines by original delivery month, oldest first.']]);
  assert.deepEqual(page.run('tableMore'), {});
  // The two separate cards are gone (no card title of either name, no collapse chevron on a card head), and the
  // shipped / open bar chart left Leading with its legend.
  assert.doesNotMatch(h, /<h2 class="dz-title[^"]*"[^>]*>(Open orders by delivery month|Items not shipped yet)<\/h2>|ohl-notshipped/);
  assert.doesNotMatch(leading(h), /mom-pair|pair-chart|pair-col|pair-labels/);
  // Open orders by delivery month: the Monthly delivery summary. Aug: 300 and 301 shipped ($2,000), 100 and 104 still
  // open and past due. Sep: 302 shipped, 13 open lines. Oct and Nov: one open line each.
  assert.match(f[0].body, /^<div class="ohl-sec-head"><div class="ohl-sec-title">Monthly delivery summary · 2026<\/div><span class="mom-note">No 2025 months in the export for year over year<\/span><\/div>/);
  assert.deepEqual(tbody(f[0].body, 'Monthly delivery summary · 2026'), ['Aug 2026 $2,000 $2,000 50% 2 2 2', 'Sep 2026 to date $1,000 $13,000 7% 13 1 0', 'Oct 2026 $0 $1,000 — 1 0 0', 'Nov 2026 $0 $1,000 — 1 0 0']);
  assert.doesNotMatch(f[0].body, /ohl-foot-note/, 'every open line has a month here');
  // Items not shipped yet: the Month pick (its tip speaks of this list alone), then the table.
  assert.match(f[1].body, /^<div class="ohl-fold-tools"><label class="inline-controls">Month <select id="ohl-original-month" class="select" data-focus-key="ohl-original-month" data-tip="Show one original month\." onchange="setOriginalDeliveryMonthFilter\(this\.value\)">/);
  assert.deepEqual([...f[1].body.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)].map((x) => [x[1], x[3], !!x[2]]),
    [['ALL', 'All months', true], ['2026-08', 'Aug 2026', false], ['2026-09', 'Sep 2026', false], ['2026-10', 'Oct 2026', false], ['2026-11', 'Nov 2026', false]]);
  assert.equal(tbody(f[1].body, 'Items not shipped yet')[0], 'Aug 2026 100 Firefly RV Spyder - Lacombe SPY-100 Controller board 2026-08-01 10 $1,000 Past Due');
  // Opening a fold is kept over a redraw, one fold at a time; shutting it forgets it.
  page.run("ohlFoldToggle({dataset:{more:'ohl-fold-items'},open:true})");
  assert.deepEqual(page.run('tableMore'), { 'more-ohl-fold-items': true });
  page.run("setWeeklyTileFilter('allopen')");
  assert.deepEqual(folds(html(page)).map((x) => [x.key, x.open]), [['ohl-fold-months', false], ['ohl-fold-items', true]]);
  page.run("ohlFoldToggle({dataset:{more:'ohl-fold-months'},open:true});renderResults()");
  assert.deepEqual(folds(html(page)).map((x) => x.open), [true, true]);
  page.run("ohlFoldToggle({dataset:{more:'ohl-fold-items'},open:false});ohlFoldToggle({dataset:{more:'ohl-fold-months'},open:false});setWeeklyTileFilter('late')");
  assert.deepEqual(page.run('tableMore'), {});
  h = html(page);
  assert.deepEqual(folds(h).map((x) => x.open), [false, false]);
  // The ship target card: compact by default, a Calendar & lines button beside Dates.
  const ship = (x) => x.slice(x.indexOf('ohl-ship'), x.indexOf('ohl-status-card'));
  assert.match(ship(h), /data-focus-key="mwm-dates"[^>]*>Dates<\/button><button type="button" class="dz-pillinput mwm-datebtn mom-calbtn print-hide" data-focus-key="ohl-ship-cal" aria-expanded="false" onclick="toggleTableMore\('ohl-ship-cal'\)"[^>]*>Calendar &amp; lines<\/button>/);
  assert.doesNotMatch(ship(h), /Open ship calendar|Scenario lines/);
  page.run("toggleTableMore('ohl-ship-cal')");
  h = html(page);
  assert.match(ship(h), /aria-expanded="true" aria-controls="ohl-ship-cal"/);
  assert.match(ship(h), /<div class="mom-cal misc-flat" id="ohl-ship-cal">[\s\S]*Booked by target[\s\S]*Open ship calendar[\s\S]*<div class="day-chart"[\s\S]*Scenario lines/);
  // Same numbers as the Monthly page: the summary, the items not shipped, the scenario lines (12+ rows: the shared pager).
  const lead = { sum: tbody(h, 'Monthly delivery summary · 2026'), items: tbody(h, 'Items not shipped yet'), lines: tbody(h, 'Scenario lines') };
  assert.ok(lead.items.length === 10 && /data-dzpager="monthly-notshipped"/.test(h), 'Items not shipped yet: 10 a page');
  assert.ok(lead.lines.length === 10 && /data-dzpager="monthly-scenario"/.test(h), 'Scenario lines: 10 a page');
  page.run("stgTogglePage('monthly');toggleTableMore('monthly-scenario-lines');setTab('monthly')");
  const mo = html(page);
  assert.ok(lead.sum.length >= 4);
  assert.deepEqual(lead.sum, tbody(mo, 'Monthly delivery summary · 2026'));
  assert.deepEqual(lead.items, tbody(mo, 'Items not shipped yet'));
  assert.deepEqual(lead.lines, tbody(mo, 'Scenario lines'));
  // The bar chart that left Leading is still on the Monthly page: twelve months, the same shipped and open values as
  // the summary's rows.
  assert.match(mo, />Shipped and open value by month · 2026<\/h2>[\s\S]*?<div class="pair-chart"><div class="pair-col">/);
  assert.equal((mo.match(/<div class="pair-col[ "]/g) || []).length, 12);
  for (const tip of ['Aug 2026: $2,000 shipped', 'Aug 2026: $2,000 open (late: this month has passed)', 'Sep 2026: $1,000 shipped', 'Sep 2026: $13,000 open', 'Oct 2026: $0 shipped', 'Oct 2026: $1,000 open']) assert.ok(mo.includes(`data-tip="${tip}"`), tip);
  assert.deepEqual(page.errors, []);

  // With a date change (900, moved from Sep 10 to Sep 25) there is a fourth question: the Lists card comes
  // after its card. Two lines with no commit date (901, 902) are in no month: the first fold says so under its table,
  // and they are still items not shipped yet (17 + 3 lines).
  const noCommit = { LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' };
  const more = await loaded([...ROWS, so('900', '09/10/2026', { LineRescheduleDate: '09/25/2026', RescheduleDate: '09/25/2026', RescheduleFlag: 'Rescheduled Later Than Original Delivery' }),
    so('901', '08/25/2026', noCommit), so('902', '08/26/2026', noCommit)]);
  h = html(more);
  assert.deepEqual(questions(h), ['1 What Is at Risk?', '2 Why, and When?', '3 Who?', '4 What Can We Do?']);
  assert.deepEqual(cardNames(leading(h)), ['At risk', 'September ship target', 'Status', 'Top reasons and open lines by due week', 'Customers at risk', 'Date changes', 'Lists', 'Lines']);
  f = folds(h);
  assert.deepEqual(f.map((x) => [x.title, x.open, x.meta]), [['Open orders by delivery month', false, '2026'], ['Items not shipped yet', false, '20 lines']]);
  assert.match(f[0].body, /<\/table><\/div>\s*<p class="ohl-note ohl-foot-note">2 open lines \(\$2,000\) with no commit date are not in these months\.<\/p>$/);
  assert.doesNotMatch(leading(h), /monthly cards or chart/);
  assert.deepEqual(more.errors, []);
});

// KNOWN BUG (left failing on purpose): index.html, moMonthlyParts, the undated note
// (`${fmtNum(g.openRows)} open lines (...) with no commit date ... are not in the monthly cards or chart.`), which
// ohlMonthsCard shows under Leading's Open orders by delivery month table (ending "are not in these months."). With one
// such line it reads "1 open lines ($1,000) with no commit date are not in these months." It should say "1 open line".
test('BUG: the note under Open orders by delivery month says "1 open line", not "1 open lines", when one line has no commit date', async () => {
  const page = await loaded([...ROWS, so('901', '08/25/2026', { LineRescheduleDate: '11/11/1111', RescheduleDate: '11/11/1111', RescheduleFlag: 'No Commit Date' })]);
  const note = (folds(html(page))[0].body.match(/<p class="ohl-note ohl-foot-note">([^<]*)<\/p>$/) || [])[1];
  assert.match(note, /\(\$1,000\) with no commit date/);
  assert.doesNotMatch(note, /\b1 open lines\b/);
});

test('The page filters apply to Leading\'s moved sections and to all four Lagging cards; the Month pick is Leading\'s alone (no select on Lagging)', async () => {
  const page = await loaded();
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  const want = page.run(`(()=>{const m=currentMetrics();const rows=filterWeeklyRows(m.allRows);const g=groupByOriginalHeaderMonth(rows,indexShipmentsByLine(rows));
    return g.filter(x=>x.key&&x.key!=='No Original Delivery Date').flatMap(x=>x.rows.filter(r=>isOrderLineRow(r)&&hasOpenWork(r))).length})()`);
  const all = page.run('currentMetrics().allRows.filter(r=>isOrderLineRow(r)&&hasOpenWork(r)).length');
  assert.ok(want > 0 && want < all);
  // 2v6.9 (owner): the card shows no note; the filtered count is still what its spec carries.
  assert.match(page.run("(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).notShippedSpec().note})()"), new RegExp(`By original line delivery month · ${want} open lines`));
  assert.ok(monthsCard(html(page)).length > 1000, 'the Lists card is drawn');
  assert.doesNotMatch(monthsCard(html(page)), /By original line delivery month ·/);
  // The Items not shipped yet fold counts the filtered lines in its summary: nine DSM lines, six of them in September.
  assert.equal(want, 9);
  assert.deepEqual(folds(html(page)).map((x) => x.meta), ['2026', '9 lines']);
  page.run("setOriginalDeliveryMonthFilter('2026-09')");
  assert.match(html(page), /<select id="ohl-original-month"[\s\S]*?<option value="2026-09" selected>Sep 2026<\/option>/);
  assert.equal(tbody(html(page), 'Items not shipped yet').length, 6, 'the six DSM lines first due in September');
  assert.deepEqual(folds(html(page)).map((x) => x.meta), ['2026', '6 lines']);
  // The Month pick is the Items list's alone: the summary above it keeps every DSM month.
  assert.deepEqual(tbody(folds(html(page))[0].body, 'Monthly delivery summary · 2026').map((r) => r.split(' ').slice(0, 2).join(' ')), ['Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026']);
  // Lagging under the DSM filter: its one delivery is 301 (August, five days late), so August is the newest month
  // with orders (no "to date"), with no July to compare with.
  const l = lag(page);
  assert.doesNotMatch(l, /<select|original-month/, 'no Month pick on Lagging');
  const t = trend(l);
  assert.deepEqual([t.heading[1], t.now, t.change], ['On-time delivery · August', '0%', undefined]);
  assert.deepEqual(t.dots, [['August 2026: On-time delivery 0%\n• 1 order shipped\n• 1 order late', '0%']]);
  assert.equal(t.whyTitle, 'Why orders were late · August');
  assert.deepEqual(t.why, [['Past due · No reschedule', '1', 'Past due · No reschedule: 1 order of 1 late in August.']]);
  assert.deepEqual(t.sofar, ['September so far\n• 0 orders shipped, $0 on 0 delivery lines\n• Year to date: $1,000 on 1 delivery line', 'September so far: 0 orders · $0 shipped · year to date $1K']);
  assert.deepEqual(ohgTable(l, 'Month by month').rows.slice(0, 2), [['Sep 2026 to date', '0', '$0', '—', '—', '—', '0'], ['Aug 2026', '1', '$1K', '0%', '—', '5.0', '1']]);
  assert.match(l, />By warehouse<\/h2><span class="dz-meta">September · 0 orders<\/span><\/div><p class="empty-note">No deliveries in this range\.<\/p>/);
  // Booked vs shipped is the filtered lines grouped by original month (the grouping the Monthly functions use), every
  // month of it: the Month pick (September, above) does not narrow it.
  const og = page.run(`(()=>{const rows=filterWeeklyRows(currentMetrics().allRows);return groupByOriginalHeaderMonth(rows,indexShipmentsByLine(rows)).filter(g=>g.key&&g.key!=='No Original Delivery Date')
    .map(g=>[g.label,g.openAmount,g.closedAmount,g.shippedLateRows])})()`);
  assert.deepEqual(og, [['Aug 2026', 1000, 1000, 1], ['Sep 2026', 6000, 0, 0], ['Oct 2026', 1000, 0, 0], ['Nov 2026', 1000, 0, 0]]);
  assert.deepEqual(ohgTable(l, 'Booked vs shipped').rows, [['Aug 2026', '50%', '$1,000', '1'], ['Sep 2026', '0%', '$6,000', '0'], ['Oct 2026', '0%', '$1,000', '0'], ['Nov 2026', '0%', '$1,000', '0']]);
  assert.equal(page.run('originalDeliveryMonthFilter'), '2026-09');
  // With the range back to August the filtered By warehouse table is DSM alone.
  page.run("setShipScenarioStartDate('2026-08-01')");
  assert.deepEqual(ohgTable(lagging(html(page)), 'By warehouse').rows, [['CM · DSM', '1', '$1,000', '0%']]);
  // Clearing the filter brings the whole report back.
  page.run("setShipScenarioStartDate('');setWeeklyWarehouseFilter(['ALL'])");
  assert.deepEqual(trend(lagging(html(page))).heading[1], 'On-time delivery · September to date');
  assert.deepEqual(ohgTable(lagging(html(page)), 'Booked vs shipped').rows.map((r) => r[2]), ['$2,000', '$13,000', '$1,000', '$1,000']);
  assert.deepEqual(page.errors, []);
});

// Was a bug, fixed since (the test stays as a guard): the Month pick on Leading's Items not shipped yet (now a fold of
// the Lists card, index.html ohlMonthsCard, p.monthSelect('ohl-original-month', ...)) said "One original
// month, here and in Original line delivery summary on Lagging." Lagging has no Original line delivery summary since
// Version 1, and the pick changes nothing there (Booked vs shipped lists every month), so the tip named a table that is
// gone. It only speaks of Items not shipped yet.
test('BUG: the Month pick on Leading does not say it also narrows a Lagging table that is gone (Original line delivery summary)', async () => {
  const page = await loaded();
  const tip = html(page).match(/<select id="ohl-original-month" class="select" data-focus-key="ohl-original-month" data-tip="([^"]+)"/)[1];
  // The pick changes nothing on Lagging ...
  const before = lag(page);
  page.run("setOriginalDeliveryMonthFilter('2026-09')");
  assert.equal(lagging(html(page)), before);
  assert.doesNotMatch(before, /Original line delivery summary/);
  // ... so its tip must not say it does.
  assert.doesNotMatch(tip, /Lagging|Original line delivery summary/);
});

test('Print draws both views with their sections, the ship target calendar open; Lagging prints the picked metric\'s chart without its switches', async () => {
  const page = await loaded();
  page.run("ohgSetTrendMetric('days');printMode=true;renderResults()");
  const h = html(page);
  assert.match(h, /id="oh-panel-leading"[\s\S]*<section class="dz-card dz-span-6 ohl-card ohl-months [^>]*aria-label="Lists">[\s\S]*id="oh-panel-lagging"[\s\S]*<div class="dz-grid ohg-grid">[\s\S]*<div class="dz-grid ohg-detail"><div class="ohl-q dz-span-6"><span class="ohl-q-n" aria-hidden="true">2<\/span><h2 class="ohl-q-t" data-tc-skip>Which Way Is It Heading, and Why\?<\/h2><\/div><section class="dz-card dz-span-6 ohgt-trend" id="ohg-metrics"/);
  // Paper opens both folds of Leading's Delivery months card (nothing is stored for it), with every row and no pager;
  // the fold chevrons are hidden. The bar chart is not on Leading's paper either.
  const f = folds(leading(h));
  assert.deepEqual(f.map((x) => [x.key, x.title, x.open]), [['ohl-fold-months', 'Open orders by delivery month', true], ['ohl-fold-items', 'Items not shipped yet', true]]);
  assert.equal(tbody(f[0].body, 'Monthly delivery summary · 2026').length, 4);
  assert.equal(tbody(f[1].body, 'Items not shipped yet').length, 17, 'all 17 open lines, not 10 a page');
  assert.doesNotMatch(monthsCard(h), /dz-pagefoot|shp-pager/);
  assert.doesNotMatch(leading(h), /mom-pair|pair-chart/);
  assert.deepEqual(page.run("[!!tableMore['more-ohl-fold-months'],!!tableMore['more-ohl-fold-items']]"), [false, false]);
  assert.match(HTML, /@media print\{\.ohl-fold>summary \.dz-chev\{display:none\}\.ohl-q\{break-after:avoid\}\}/);
  assert.match(h, /<div class="mom-cal misc-flat" id="ohl-ship-cal">/);
  const l = lagging(h);
  assert.deepEqual(cardNames(l.slice(l.indexOf('ohg-detail'))), ['Trend', 'Month by month', 'By warehouse', 'Booked vs shipped']);
  assert.equal(trend(l).plot, 'Avg days late, last 12 months');
  // All twelve months on paper, no pager; the chips and the Months switch are hidden by the print CSS.
  assert.equal(ohgTable(l, 'Month by month').rows.length, 12);
  assert.doesNotMatch(l, /dz-pagefoot|shp-pager/);
  assert.match(HTML, /@media print\{\.ohgt-chips,\.ohgt-tools\{display:none\}\.ohgt-trend\{break-inside:avoid\}\}/);
  page.run("printMode=false;setWeeklyView('lagging')");
  assert.equal(ohgTable(lagging(html(page)), 'Month by month').rows.length, 6);
  // Back on screen the folds are shut again, ten lines a page.
  page.run("setWeeklyView('leading')");
  assert.deepEqual(folds(html(page)).map((x) => x.open), [false, false]);
  assert.equal(tbody(html(page), 'Items not shipped yet').length, 10);
  assert.deepEqual(page.errors, []);
});

test('the new CSS sits in its own marker pair just before the pager block, on colour tokens', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v9:monthly-move */'), HTML.indexOf('/* 2v9:end monthly-move */'));
  assert.ok(css.length > 100);
  // Later 2v9 blocks (each in its own marker pair) may sit between it and the pager block.
  assert.match(HTML, /\/\* 2v9:end monthly-move \*\/\n(?:\/\* 2v9:([a-z0-9-]+) \*\/[\s\S]*?\/\* 2v9:end \1 \*\/\n)*\/\* 2v9:pager \*\//);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,6}\b|rgba?\(/i);
});

test('the Lagging Version 1 CSS sits in its own marker pair, on colour tokens: chips, the chart beside the side panel (stacked on narrow screens), compact tables', () => {
  const start = HTML.indexOf('/* 2v9:lagging-v1 */'), end = HTML.indexOf('/* 2v9:end lagging-v1 */');
  assert.ok(start > 0 && end > start);
  const css = HTML.slice(start, end);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,6}\b|rgba?\(/i);
  assert.match(css, /\n\.ohg-detail\{margin-top:16px\}/);
  // The chips: pills; the picked one is indigo on its tint; a visible focus ring.
  assert.match(css, /\nbutton\.ohgt-chip\.on\{background:var\(--dz-indigo-bg\);border-color:var\(--dz-indigo\);color:var\(--dz-indigo\);font-weight:600\}/);
  assert.match(css, /\nbutton\.ohgt-chip:focus-visible\{outline:2px solid var\(--dz-indigo\);outline-offset:2px\}/);
  // The chart takes two thirds, the side panel one; under 900px they stack.
  assert.match(css, /\n\.ohgt-split\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);gap:20px 28px\}/);
  assert.match(css, /\n@media \(max-width:900px\)\{\.ohgt-split\{grid-template-columns:minmax\(0,1fr\)\}\.ohgt-side\{padding-top:0\}\.ohgt-tools\{margin-left:0\}\}/);
  // The tables: numbers right-aligned in tabular figures, late counts in the risk text colour.
  assert.match(css, /\ntable\.ohgt-tbl\{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums\}/);
  assert.match(css, /\n\.ohgt-tbl \.num\{text-align:right\}/);
  assert.match(css, /\n\.ohgt-tbl td\.late\{font-weight:600;color:var\(--dz-risk-text\)\}/);
});

run();
