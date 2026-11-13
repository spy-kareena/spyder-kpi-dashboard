// 2v9 monthly-move: Monthly is dissolved into Sales Order Health. Its backward-looking sections are on Lagging (a
// Shipments section under the Monthly and Quarterly cards), its forward-looking ones on Leading (Open orders by delivery
// month, Items not shipped yet, the ship target's Calendar & lines). Monthly starts hidden (once for browsers that chose
// their hidden pages); setTab('monthly') opens Lagging; Settings > Hidden Pages can show it again, and then it works.
// Run with `node tests/monthly-move-2v69.test.js`. Fixtures are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
const so = (doc, due, o = {}) => sapRow({ DocumentNumber: doc, 'Internal Number': doc, DueDate: due, LineDueDate: due, HeaderDueDate: due, ...o });
const delivery = (doc, due, closed, o = {}) => so(doc, due, { OrderType: 'Sales Delivery', Status: 'Closed', KPIStatus: 'Closed', ClosedDate: closed, CloseDateSource: 'Delivery', DeliveryDocNumber: `D${doc}`, OpenQuantity: '0', ...o });
const DSM = { Warehouse: 'CM - DSM' };
// Report date 2026-09-03 (ExportDate). Open lines due Aug to Nov in two warehouses; deliveries in Aug and Sep.
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
const dzRows = (h, label) => {
  const i = h.indexOf(`<div role="table" aria-label="${label}"`);
  if (i < 0) return null;
  const part = h.slice(i, h.indexOf('</div></div>', i));
  return [...part.matchAll(/<div role="row" class="dz-tr[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((r) => text(r[1]));
};
const section = (h, id) => { const i = h.indexOf(`<section class="pg-group" id="${id}"`); return i < 0 ? '' : h.slice(i, h.indexOf('<section class="pg-group" id="ohg-metrics"', i)); };

test('Monthly is hidden by default, setTab and a stored page open Lagging; Hidden Pages can show it again and it still works', async () => {
  const page = await loaded();
  assert.deepEqual(page.run("stgValue('hiddenPages')"), ['monthly', 'warehouses', 'supplyweekly', 'supplydemand', 'buildrisk', 'forecast']);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /data-focus-key="nav-monthly"/);
  page.run("setTab('monthly')");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  assert.match(html(page), /<section class="pg-group" id="ohg-shipments"/);
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

test('Lagging: a Shipments section between the Monthly / Quarterly cards and Metrics, with the same numbers as the Monthly page', async () => {
  const page = await loaded();
  page.run("setWeeklyView('lagging')");
  let h = html(page);
  const grid = h.indexOf('<div class="dz-grid ohg-grid">'), ship = h.indexOf('<section class="pg-group" id="ohg-shipments"'), met = h.indexOf('<section class="pg-group" id="ohg-metrics"');
  assert.ok(grid > 0 && met > grid && ship > met, 'cards, then Metrics, then Shipments (owner)');
  const s = section(h, 'ohg-shipments');
  assert.match(s, /<h2 class="pg-group-title" id="pg-ohg-shipments">Shipments<\/h2><div class="pg-group-tools"><div class="dz-seg sup-seg-sm" role="group" aria-label="Shipments view">/);
  assert.match(s, />Orders shipped by month<\/h2>[\s\S]*>Month by month<\/h2>[\s\S]*<div class="month-spot n\d">[\s\S]*<section class="mini-strip cols-3" aria-label="Shipped to date">[\s\S]*>Shipped by warehouse \/ CM · this month<\/h2>[\s\S]*>Original line delivery summary<\/h2>/);
  assert.doesNotMatch(h, /mwm-herocard|to date<\/h2>/, 'no "to date" card');
  assert.match(s, /<select id="ohg-original-month" class="select" data-focus-key="ohg-original-month"/);
  // The Monthly page's numbers (shown again for the comparison).
  const lag = { months: dzRows(s, 'Month by month'), wh: tbody(s, 'Shipped by warehouse / CM · this month'), orig: tbody(s, 'Original line delivery summary'),
    spot: s.match(/<div class="month-spot n\d">[\s\S]*?<section class="mini-strip/)[0], strip: s.match(/<section class="mini-strip cols-3"[\s\S]*?<\/section>/)[0] };
  page.run("mwmSetMode('booked')");
  const lagBooked = dzRows(section(html(page), 'ohg-shipments'), 'Month by month');
  assert.match(html(page), />Orders booked by month<\/h2>/);
  page.run("mwmSetMode('shipped');stgTogglePage('monthly');setTab('monthly')");
  const mo = html(page);
  assert.ok(lag.months.length === 12 && lag.wh.length && lag.orig.length);
  assert.deepEqual(lag.months, dzRows(mo, 'Month by month'));
  assert.deepEqual(lag.wh, tbody(mo, 'Shipped by warehouse / CM · this month'));
  assert.deepEqual(lag.orig, tbody(mo, 'Original line delivery summary'));
  assert.equal(text(lag.spot.replace(/<section class="mini-strip$/, '')), text(mo.match(/<div class="month-spot n\d">[\s\S]*?<\/section>\s*<section class="pg-group/)[0].replace(/<\/section>\s*<section class="pg-group$/, '')));
  assert.equal(text(lag.strip), text(mo.match(/<section class="mini-strip cols-3"[\s\S]*?<\/section>/)[0]));
  page.run("mwmSetMode('booked')");
  assert.deepEqual(lagBooked, dzRows(html(page), 'Month by month'));
  assert.deepEqual(page.errors, []);
});

test('Leading: Open orders by delivery month and Items not shipped yet before the Lines card; the ship target opens Calendar & lines', async () => {
  const page = await loaded();
  let h = html(page);
  const open = h.indexOf('>Open orders by delivery month</h2>'), items = h.indexOf('>Items not shipped yet</h2>');
  assert.ok(open > h.indexOf('>Date changes</h2>') && items > open, 'after Date changes, Open orders then Items not shipped yet');
  assert.match(h, /<section class="dz-card dz-span-6 ohl-card mom-card misc-flat dz-fade"><div class="dz-card-head"><h2 class="dz-title"[^>]*>Open orders by delivery month<\/h2>[\s\S]*?<div class="mom-pair" role="img"[^>]*><div class="pair-chart">/);
  assert.match(h, /<select id="ohl-original-month" class="select" data-focus-key="ohl-original-month"/);
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
  assert.deepEqual(page.errors, []);
});

test('The page filters apply to the moved sections (same grouping as the Monthly functions); the Month pick is shared', async () => {
  const page = await loaded();
  page.run("setWeeklyWarehouseFilter(['CM - DSM'])");
  const want = page.run(`(()=>{const m=currentMetrics();const rows=filterWeeklyRows(m.allRows);const g=groupByOriginalHeaderMonth(rows,indexShipmentsByLine(rows));
    return g.filter(x=>x.key&&x.key!=='No Original Delivery Date').flatMap(x=>x.rows.filter(r=>isOrderLineRow(r)&&hasOpenWork(r))).length})()`);
  const all = page.run('currentMetrics().allRows.filter(r=>isOrderLineRow(r)&&hasOpenWork(r)).length');
  assert.ok(want > 0 && want < all);
  // 2v6.9 (owner): the card shows no note; the filtered count is still what its spec carries.
  assert.match(page.run("(()=>{const m=currentMetrics();return moMonthlyParts(m,momSource(m),reportToday()).notShippedSpec().note})()"), new RegExp(`By original line delivery month · ${want} open lines`));
  assert.doesNotMatch(html(page).slice(html(page).indexOf('ohl-notshipped')), /By original line delivery month ·/);
  page.run("setOriginalDeliveryMonthFilter('2026-09')");
  assert.match(html(page), /<option value="2026-09" selected>Sep 2026<\/option>/);
  page.run("setWeeklyView('lagging')");
  const s = section(html(page), 'ohg-shipments');
  assert.match(s, /<select id="ohg-original-month"[\s\S]*?<option value="2026-09" selected>/);
  assert.equal(tbody(s, 'Original line delivery summary').length, 1);
  assert.deepEqual(page.errors, []);
});

test('Print draws both views with their sections, the ship target calendar open', async () => {
  const page = await loaded();
  page.run('printMode=true;renderResults()');
  const h = html(page);
  assert.match(h, /id="oh-panel-leading"[\s\S]*>Open orders by delivery month<\/h2>[\s\S]*>Items not shipped yet<\/h2>[\s\S]*id="oh-panel-lagging"[\s\S]*id="ohg-shipments"/);
  assert.match(h, /<div class="mom-cal misc-flat" id="ohl-ship-cal">/);
  page.run('printMode=false;renderResults()');
  assert.deepEqual(page.errors, []);
});

test('the new CSS sits in its own marker pair just before the pager block, on colour tokens', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v9:monthly-move */'), HTML.indexOf('/* 2v9:end monthly-move */'));
  assert.ok(css.length > 100);
  // Later 2v9 blocks (each in its own marker pair) may sit between it and the pager block.
  assert.match(HTML, /\/\* 2v9:end monthly-move \*\/\n(?:\/\* 2v9:([a-z0-9-]+) \*\/[\s\S]*?\/\* 2v9:end \1 \*\/\n)*\/\* 2v9:pager \*\//);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,6}\b|rgba?\(/i);
});

run();
