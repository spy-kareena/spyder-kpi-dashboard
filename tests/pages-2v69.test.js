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

test('Lagging has no Top offenders cards; Monthly has no ship target in either view', async () => {
  const page = await loaded(ROWS);
  page.run("setWeeklyView('lagging')");
  assert.doesNotMatch(html(page), /Top offenders · (warehouses|vendors)|ohg-wh-/);
  page.run("setTab('monthly')");
  for (const mode of ['shipped', 'booked']) {
    page.run(`mwmSetMode('${mode}')`);
    const h = html(page);
    assert.doesNotMatch(h, /<h2 class="dz-title sm"[^>]*>(\w+ ship target|Ship target)<\/h2>|data-focus-key="mwm-dates"/, mode);
    assert.match(h, /class="dz-card dz-span-6 dz-fade mwm-herocard"/, mode);
  }
  assert.deepEqual(page.errors, []);
});

test('Purchase Orders: no This week focus tile; one Kits card (Not clean count, Clean / Not clean rows) that fills two columns', async () => {
  const page = await loaded(ROWS);
  page.run("setTab('purchaseorders')");
  let h = html(page);
  assert.doesNotMatch(h, /data-focus-key="potile-duethisweek"|This week focus/);
  assert.equal((h.match(/class="dz-stat kit-stat kit-card/g) || []).length, 1);
  assert.match(h, /<div class="dz-stat kit-stat kit-card po-risk" role="group" aria-label="Kits"><button type="button" class="po-risk-main" data-focus-key="potile-kits" onclick="setPoTileFilter\('kitnotclean'\)" aria-pressed="false"/);
  assert.match(h, /Kits<\/span><span class="dz-stat-v" style="color:var\(--dz-amber-text\)">2<span class="po-unit">lines<\/span>/);
  assert.match(h, /data-focus-key="potile-kitclean" aria-pressed="false" onclick="setPoTileFilter\('kitclean'\)"[^>]*><span class="po-own-name">Clean<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">0<\/span>/);
  assert.match(h, /data-focus-key="potile-kitnotclean" aria-pressed="false" onclick="setPoTileFilter\('kitnotclean'\)"[^>]*><span class="po-own-name">Not clean<\/span><span class="po-own-lead" aria-hidden="true"><\/span><span class="po-own-n">2<\/span>/);
  // The row's column count still counts the Kits card as two (Due this month, Unconfirmed, Missing price + Kits).
  assert.match(h, /class="dz-stats sup-more-views po-fill" style="--po-cols:5"/);
  page.run("setPoTileFilter('kitclean')");
  h = html(page);
  assert.match(h, /class="dz-stat kit-stat kit-card po-risk sel"/);
  assert.match(h, /class="po-own kit-row on" data-focus-key="potile-kitclean" aria-pressed="true"/);
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
