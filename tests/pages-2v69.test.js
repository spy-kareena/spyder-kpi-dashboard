// 2v6.9 page changes: the ship target moves from Monthly to Order Health Leading (above Status & top reasons, now a list
// without bars); When flagged, the Due this week tile and the Lagging Top offenders cards are gone; Purchase Orders loses
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

test('Leading: the ship target sits over Status & top reasons in one column; Status is a list (no bars); no When flagged, no Due this week tile', async () => {
  const page = await loaded(ROWS);
  const h = html(page);
  const col = (h.match(/<div class="ohl-col dz-span-3">([\s\S]*?)<\/div>\s*<section class="dz-card dz-span-3 ohl-card dz-fade" style="--i:2">/) || [])[1] || '';
  assert.ok(col, 'the column follows At risk');
  const titles = [...col.matchAll(/<h2 class="dz-title sm"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  // 2v6.9 (owner): the Status & top reasons card has no title (its Status and Top reasons headings lead).
  assert.equal(titles.length, 1);
  assert.match(titles[0], /^(\w+ ship target|Ship target)$/);
  assert.match(col, /<section class="dz-card ohl-card ohl-status-card dz-fade" style="--i:1" aria-label="Status and top reasons"><div class="ohl-sec ohl-sec-first">/);
  // The ship target is the Monthly card: its month, its Dates control, the same scenario numbers.
  const month = page.run("reportToday().toLocaleDateString('en-US',{month:'long'})");
  assert.equal(titles[0], `${month} ship target`);
  assert.match(col, /data-focus-key="mwm-dates" aria-expanded="false" onclick="toggleTableMore\('mwm-dates'\)"/);
  const sd = page.run('(()=>{const s=shipScenarioFor(currentMetrics());return [rowDocCount(s.pastOriginalDue),rowDocCount(s.onTrackWindow)]})()');
  assert.match(col, new RegExp(`<span class="dz-big sm[^"]*">${sd[0]} orders?</span><span class="dz-sub">past due`));
  // Status & top reasons (2v6.9 redesign): Status is a thin segmented bar (one part per state with orders) over button
  // rows with the share, open value, lines and orders; Top reasons is a heatmap of reasons by warehouse with the at
  // risk value, lines and orders closing each row. Rows, parts and reason names filter as before.
  const status = col.slice(col.indexOf('ohl-status-card'));
  assert.match(status, /<div class="ohs2-bar" role="group" aria-label="Open orders by state">/);
  const rows = [...status.matchAll(/<button type="button" class="ohs2-row[^"]*" data-focus-key="status-st-(\w+)" aria-pressed="(true|false)" onclick="setWeeklyTileFilter\((?:&#39;|')st-\1(?:&#39;|')\)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['ontrack', 'duethisweek', 'rescheduled', 'pastdue', 'nocommit']);
  // 2v6.9 (owner): Lines and Orders only (no Share or Open columns); the head says only the open order count.
  assert.match(status, /<div class="ohs2-cols" aria-hidden="true"><span><\/span><span>Lines<\/span><span>Orders<\/span><\/div>/);
  assert.match(status, /<span class="ohs2-name">On track<\/span>\s*<span class="ohs2-lines">\d+<\/span><span class="ohs2-n">\d+<\/span>/);
  assert.match(status, /<span class="ohs2-meta"><b>\d+<\/b> open orders<\/span>/);
  assert.doesNotMatch(status, /ohs2-pct|ohs2-val|% past due/);
  assert.match(status, /<div class="ohl-sec-title"[^>]*>Status<\/div>[\s\S]*<div class="ohl-sec-title"[^>]*>Top reasons<\/div>/);
  assert.match(status, /<div class="ohu" style="--rows:\d+;--cols:\d+" role="group" aria-label="Which reasons come together">[\s\S]*?class="ohu-col/); // option S: reason sets
  assert.doesNotMatch(status, /ohs2-track|ohl-track|dz-barrow/);
  page.run("setWeeklyTileFilter('st-ontrack')");
  assert.match(html(page), /data-focus-key="status-st-ontrack" aria-pressed="true"/);
  // Gone: the When flagged card and the Due this week tile under At risk (three tiles left).
  assert.doesNotMatch(h, />When flagged<\/h2>|data-focus-key="oh-age-/);
  const stats = [...h.matchAll(/class="dz-stat ohl-stat[^"]*" data-focus-key="tile-([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(stats, ['st-rescheduled', 'st-nocommit', 'allopen']);
  // Open lines by due week and Customers at risk share the next row (3 + 3).
  assert.match(h, /class="dz-card dz-span-3 ohl-card dz-fade" style="--i:2"><div class="dz-card-head"><h2 class="dz-title"[^>]*>Open lines by due week/);
  assert.match(h, /class="dz-card dz-span-3 ohl-card dz-fade" style="--i:3"><div class="dz-card-head"><h2 class="dz-title sm"[^>]*>Customers at risk/);
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

test('Metrics is a section of Lagging under Monthly and Quarterly: setTab and a stored page open it; not in the menu', async () => {
  const page = await loaded([...ROWS, delivery('801', '08/08/2026'), delivery('802', '08/15/2026')]);
  assert.doesNotMatch(page.els['app-header'].innerHTML, /data-focus-key="nav-metrics"/);
  assert.doesNotMatch(html(page), /id="ohg-metrics"/, 'Leading does not build it');
  page.run("setTab('metrics')");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  let h = html(page);
  const grid = h.indexOf('<div class="dz-grid ohg-grid">'), sec = h.indexOf('<section class="pg-group" id="ohg-metrics" aria-labelledby="pg-ohg-metrics" data-group="ohg-metrics">');
  assert.ok(grid > 0 && sec > grid, 'the section follows the Monthly and Quarterly cards');
  const metrics = h.slice(sec);
  assert.match(metrics, /<h2 class="pg-group-title" id="pg-ohg-metrics">Metrics<\/h2><div class="pg-group-tools"><div class="dz-seg sup-seg-sm" role="group" aria-label="Months shown">/);
  // The page's content (owner): four KPIs with sparklines (no Fill rate) and the Late orders by cause tile, then the
  // on-time line, the monthly table, Show more.
  assert.equal((metrics.match(/<div class="mwm-kpi dz-fade"/g) || []).length, 4);
  assert.doesNotMatch(metrics, /<div class="mwm-kpi-l">Fill rate<\/div>/);
  assert.match(metrics, /<div class="mwm-kpi mwm-kpi-cause dz-fade"[\s\S]*?<div class="mwm-kpi-l">Late orders by cause<\/div>[\s\S]*>On-time delivery<\/h2>[\s\S]*>Monthly metrics<\/h2>/);
  assert.match(metrics, /<details class="mwm-more"[^>]*data-more="mwm-metrics"/);
  assert.match(metrics, /aria-labelledby="pg-mt-quality"[\s\S]*aria-labelledby="pg-mt-month"/);
  // Its own Months switch still works; the Order Health filters narrow it.
  page.run('mwmSetRange(3)');
  assert.match(html(page), /data-focus-key="mwm-range-3"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-focus-key="mwm-range-3"|class="on"[^>]*data-focus-key="mwm-range-3"/);
  // A stored page of 'metrics' (an older snapshot, the page a search started from) opens Lagging.
  page.run("setWeeklyView('leading');activeTab='metrics';renderResults()");
  assert.equal(page.run('activeTab'), 'weekly');
  assert.equal(page.run('weeklyView'), 'lagging');
  assert.deepEqual(page.errors, []);
});

test('Purchase Orders: no This week focus tile; one Kits card and one Unconfirmed · Missing price card, each two columns wide', async () => {
  // 500: unconfirmed; 501: missing price; 502: both (counts once on the card); 503: neither.
  const page = await loaded([...ROWS.slice(0, 3), po('500', '08/01/2026', { Confirmed: 'N' }), po('501', '10/30/2026', { PriceFlag: 'Missing Price' }),
    po('502', '10/30/2026', { Confirmed: 'N', PriceFlag: 'Missing Price' }), po('503', '10/30/2026')]);
  page.run("setTab('purchaseorders')");
  let h = html(page);
  assert.doesNotMatch(h, /data-focus-key="potile-duethisweek"|This week focus/);
  // Kits: the Not clean count, Clean / Not clean rows.
  assert.equal((h.match(/class="dz-stat kit-stat kit-card/g) || []).length, 1);
  // 2v6.9 (owner): "Kit Status" shows only two numbers, Clean and Not clean; each lists its lines.
  assert.match(h, /<div class="dz-stat kit-stat kit-card kit2 po-pair po-risk" role="group" aria-label="Kit Status">[\s\S]*?Kit Status<\/span><div class="kit2-row">/);
  assert.match(h, /data-focus-key="potile-kitclean" aria-pressed="false" onclick="setPoTileFilter\('kitclean'\)"[^>]*><span class="kit2-n">0<\/span><span class="kit2-l">Clean<\/span>/);
  assert.match(h, /data-focus-key="potile-kitnotclean" aria-pressed="false" onclick="setPoTileFilter\('kitnotclean'\)"[^>]*><span class="kit2-n">4<\/span><span class="kit2-l">Not clean<\/span>/);
  // Unconfirmed · Missing price: three POs (502 once), rows Unconfirmed 2 and Missing price 2; the old cards are gone.
  assert.doesNotMatch(h, /<button type="button" class="dz-stat"[^>]*data-focus-key="potile-(unconfirmed|missingprice)"/);
  assert.match(h, /<div class="dz-stat po-follow po-pair po-risk" role="group" aria-label="Unconfirmed · Missing price"><button type="button" class="po-risk-main" data-focus-key="potile-followup" onclick="setPoTileFilter\('followup'\)" aria-pressed="false"[^>]*><span class="dz-stat-l dz-ico-l">[\s\S]*?Unconfirmed · Missing price<\/span><span class="dz-stat-v" style="color:var\(--dz-amber-text\)">3<\/span><span class="dz-stat-s">\$3K · 3 lines<\/span>/);
  assert.match(h, /data-focus-key="potile-unconfirmed" aria-pressed="false" onclick="setPoTileFilter\('unconfirmed'\)"[^>]*><span class="po-own-name">Unconfirmed<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  assert.match(h, /data-focus-key="potile-missingprice" aria-pressed="false" onclick="setPoTileFilter\('missingprice'\)"[^>]*><span class="po-own-name">Missing price<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  // The row's columns: Due this month (1) + the two cards (2 each).
  assert.match(h, /class="dz-stats sup-more-views po-fill" style="--po-cols:7"/); // 2v6.9 (owner): Due this month, Unconfirmed · Missing price, Kits and Build Risk on one line (1 + 2 + 2 + 2 columns)
  // The card lists both kinds, each row its own; the lines title says which.
  page.run("setPoTileFilter('followup')");
  h = html(page);
  assert.match(h, /class="dz-stat po-follow po-pair po-risk sel"/);
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
