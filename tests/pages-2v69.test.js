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
  assert.equal(titles.length, 2);
  assert.match(titles[0], /^(\w+ ship target|Ship target)$/);
  assert.equal(titles[1], 'Status &amp; top reasons');
  // The ship target is the Monthly card: its month, its Dates control, the same scenario numbers.
  const month = page.run("reportToday().toLocaleDateString('en-US',{month:'long'})");
  assert.equal(titles[0], `${month} ship target`);
  assert.match(col, /data-focus-key="mwm-dates" aria-expanded="false" onclick="toggleTableMore\('mwm-dates'\)"/);
  const sd = page.run('(()=>{const s=shipScenarioFor(currentMetrics());return [rowDocCount(s.pastOriginalDue),rowDocCount(s.onTrackWindow)]})()');
  assert.match(col, new RegExp(`<span class="dz-big sm[^"]*">${sd[0]} orders?</span><span class="dz-sub">past due`));
  // Status & top reasons: no bar rows or tracks; each state is a button row, label left, orders right, filtering as before.
  const status = col.slice(col.indexOf('Status &amp; top reasons'));
  assert.doesNotMatch(status, /dz-barrow|ohl-track|<svg/);
  const rows = [...status.matchAll(/<button type="button" class="ohl-kv[^"]*" data-focus-key="status-st-(\w+)" onclick="setWeeklyTileFilter\(&#39;st-\1&#39;\)" aria-pressed="(true|false)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['ontrack', 'duethisweek', 'rescheduled', 'pastdue', 'nocommit']);
  assert.match(status, /<span class="ohl-kv-name">On track<\/span><span class="ohl-kv-sub"><span class="ohl-kv-sep"> · <\/span>\$[\d,]+ · \d+ lines?<\/span><\/span><span class="ohl-kv-lead" aria-hidden="true"><\/span><span class="ohl-kv-n">\d+ orders?<\/span>/);
  assert.match(status, /<div class="ohl-sec-title">Status<\/div>[\s\S]*<div class="ohl-sec-title">Top reasons<\/div>/);
  page.run("setWeeklyTileFilter('st-ontrack')");
  assert.match(html(page), /data-focus-key="status-st-ontrack" onclick="[^"]*" aria-pressed="true"/);
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
  page.run("setTab('monthly')");
  for (const mode of ['shipped', 'booked']) {
    page.run(`mwmSetMode('${mode}')`);
    const h = html(page);
    assert.doesNotMatch(h, /<h2 class="dz-title sm"[^>]*>(\w+ ship target|Ship target)<\/h2>|data-focus-key="mwm-dates"/, mode);
    assert.match(h, /class="dz-card dz-span-6 dz-fade mwm-herocard"/, mode);
  }
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
  assert.match(h, /<div class="dz-stat kit-stat kit-card po-pair po-risk" role="group" aria-label="Kits"><button type="button" class="po-risk-main" data-focus-key="potile-kits" onclick="setPoTileFilter\('kitnotclean'\)" aria-pressed="false"/);
  assert.match(h, /Kits<\/span><span class="dz-stat-v" style="color:var\(--dz-amber-text\)">4<span class="po-unit">lines<\/span>/);
  assert.match(h, /data-focus-key="potile-kitclean" aria-pressed="false" onclick="setPoTileFilter\('kitclean'\)"[^>]*><span class="po-own-name">Clean<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">0<\/span>/);
  assert.match(h, /data-focus-key="potile-kitnotclean" aria-pressed="false" onclick="setPoTileFilter\('kitnotclean'\)"[^>]*><span class="po-own-name">Not clean<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">4<\/span>/);
  // Unconfirmed · Missing price: three POs (502 once), rows Unconfirmed 2 and Missing price 2; the old cards are gone.
  assert.doesNotMatch(h, /<button type="button" class="dz-stat"[^>]*data-focus-key="potile-(unconfirmed|missingprice)"/);
  assert.match(h, /<div class="dz-stat po-follow po-pair po-risk" role="group" aria-label="Unconfirmed · Missing price"><button type="button" class="po-risk-main" data-focus-key="potile-followup" onclick="setPoTileFilter\('followup'\)" aria-pressed="false"[^>]*><span class="dz-stat-l dz-ico-l">[\s\S]*?Unconfirmed · Missing price<\/span><span class="dz-stat-v" style="color:var\(--dz-amber-text\)">3<\/span><span class="dz-stat-s">\$3K · 3 lines<\/span>/);
  assert.match(h, /data-focus-key="potile-unconfirmed" aria-pressed="false" onclick="setPoTileFilter\('unconfirmed'\)"[^>]*><span class="po-own-name">Unconfirmed<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  assert.match(h, /data-focus-key="potile-missingprice" aria-pressed="false" onclick="setPoTileFilter\('missingprice'\)"[^>]*><span class="po-own-name">Missing price<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  // The row's columns: Due this month (1) + the two cards (2 each).
  assert.match(h, /class="dz-stats sup-more-views po-fill" style="--po-cols:5"/);
  // The card lists both kinds, each row its own; the lines title says which.
  page.run("setPoTileFilter('followup')");
  h = html(page);
  assert.match(h, /class="dz-stat po-follow po-pair po-risk sel"/);
  assert.equal(page.run("poData(currentMetrics()).poTileRows.followup.map(r=>r.documentNumber).sort().join()"), '500,501,502');
  assert.match(h, /Unconfirmed or missing price · 3 lines/);
  page.run("setPoTileFilter('missingprice')");
  h = html(page);
  assert.match(h, /class="po-own po-pair-row on amber" data-focus-key="potile-missingprice" aria-pressed="true"/);
  assert.match(h, /Missing price · 2 lines/);
  page.run("setPoTileFilter('kitclean')");
  h = html(page);
  assert.match(h, /class="dz-stat kit-stat kit-card po-pair po-risk sel"/);
  assert.match(h, /class="po-own po-pair-row on" data-focus-key="potile-kitclean" aria-pressed="true"/);
  assert.deepEqual(page.errors, []);
});

test('the menu calls Order Health "Sales Order Health": link, page title, logo, Settings', async () => {
  const page = await loaded(ROWS);
  const hdr = page.els['app-header'].innerHTML;
  assert.match(hdr, /aria-label="Spyder Controls Corp, Sales Order Health"/);
  assert.match(hdr, /data-focus-key="nav-weekly" onclick="setTab\('weekly'\)" aria-current="page"[^>]*>Sales Order Health</);
  assert.match(html(page), /<h1 class="dz-h1 dz-h1-hidden" tabindex="-1">Sales Order Health<\/h1>/);
  page.run("setTab('settings')");
  assert.match(html(page), /id="stg-h-oh" tabindex="-1">[\s\S]*?Sales Order Health<\/h2>/);
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
  assert.match(css, /#stg-card-hiddenpages\{grid-column:1\/-1\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{button\.ohl-kv\{transition:none\}\}/);
});

run();
