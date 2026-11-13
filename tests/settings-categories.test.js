// 2v8 Settings: the page is five named categories under a category bar; stgShowCard marks the card's category.
// Run with `node tests/settings-categories.test.js`. Fixtures are synthetic (no SAP data).
'use strict';
const assert = require('node:assert/strict');
const { HTML, loadPage, upload, sapRow, sapExport, createSuite } = require('./harness');
const { test, run } = createSuite();

const IMPORT = { spyderKpiSettings: JSON.stringify({ dataSource: 'import' }) };
const html = (page) => page.els['results-screen'].innerHTML;
// The categories in page order, each with the ids of the cards inside it.
function categories(h) {
  return [...h.matchAll(/<section class="pg-group stg-cat" id="stg-cat-(\w+)" aria-labelledby="pg-stg-\1" data-group="stg-\1" data-cat="\1"><div class="pg-group-head"><h2 class="pg-group-title" id="pg-stg-\1" tabindex="-1">([^<]+)<\/h2><\/div><div class="stg-cgrid">([\s\S]*?)(?=<section class="pg-group stg-cat"|<\/div><div class="stg-end")/g)]
    .map((m) => [m[1], m[2], [...m[3].matchAll(/<section class="dz-card stg-card[^"]*" id="stg-card-(\w+)"/g)].map((c) => c[1])]);
}
const bar = (h) => (h.match(/<nav class="stg-nav print-hide" aria-label="Settings categories">([\s\S]*?)<\/nav>/) || [])[1] || '';
const marked = (h) => [...bar(h).matchAll(/data-cat="(\w+)"[^>]*aria-current="true"/g)].map((m) => m[1]);

async function loaded(rows) {
  const page = loadPage({ storage: { ...IMPORT } });
  await new Promise((r) => setTimeout(r, 0));
  page.run('isSnapshotView=false');
  await upload(page, [{ name: 'e.xls', bytes: sapExport(rows) }]);
  return page;
}

test('Settings is five categories in order, every card in its own one; the bar links to each, Data marked first', async () => {
  const page = await loaded([sapRow({ DocumentNumber: '777', DueDate: '07/16/0202', LineDueDate: '07/16/0202', HeaderDueDate: '07/16/0202' })]);
  page.run("setTab('settings')");
  const h = html(page);
  assert.deepEqual(categories(h), [
    ['data', 'Data', ['dc', 'source', 'data']],
    ['dash', 'Dashboard', ['oh', 'pages', 'hiddenpages']],
    ['notes', 'Notes &amp; People', ['profile', 'notes']],
    ['ai', 'AI', ['ai', 'connect']],
    ['about', 'About', ['about']],
  ]);
  // The bar: one link per category, in the same order, keyboard reachable, with a focus key; Data is current.
  const links = [...bar(h).matchAll(/<a class="stg-nav-a(?: on)?" href="#stg-cat-(\w+)" data-cat="\1" data-focus-key="stg-nav-\1"(?: aria-current="true")? onclick="return stgNavGo\('\1',event\)">([^<]+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [['data', 'Data'], ['dash', 'Dashboard'], ['notes', 'Notes &amp; People'], ['ai', 'AI'], ['about', 'About']]);
  assert.deepEqual(marked(h), ['data']);
  // The gear's red Data check dot is on the Data link too (with words for screen readers); Data Check opens Data.
  assert.equal(page.run('stgDataCheckLevel()'), 'red');
  assert.match(bar(h), /data-cat="data"[^>]*>Data<span class="hdr-dot red" aria-hidden="true"><\/span><span class="sr-only">, data check needs a look<\/span><\/a>/);
  // Reset to defaults sits in About, once; the old two columns and the foot link are gone.
  assert.equal(h.split('data-focus-key="stg-reset-all"').length - 1, 1);
  assert.match(h, /id="stg-card-about"[\s\S]*data-focus-key="stg-reset-all"/);
  assert.doesNotMatch(h, /stg-col|stg-grid|stg-top|stg-foot/);
  assert.deepEqual(page.errors, []);
});

test('stgShowCard opens Settings with the card\'s category marked: Connect in AI, your name in Notes & People, Data Check in Data', async () => {
  const page = await loaded([sapRow()]);
  assert.deepEqual([...['source', 'dc', 'data', 'oh', 'pages', 'hiddenpages', 'profile', 'notes', 'ai', 'connect', 'about']].map((c) => page.run(`stgCatOf('${c}')`)),
    ['data', 'data', 'data', 'dash', 'dash', 'dash', 'notes', 'notes', 'ai', 'ai', 'about']);
  page.run("setTab('weekly')");
  page.run("setTab('connect')");
  assert.equal(page.run('activeTab'), 'settings');
  assert.deepEqual(marked(html(page)), ['ai']);
  assert.match(html(page), /id="stg-cat-ai"[\s\S]*?id="stg-card-connect"[\s\S]*?<details class="stg-setup" open/);
  page.run("setTab('weekly')");
  page.run("stgShowCard('profile','stg-name')");
  assert.deepEqual(marked(html(page)), ['notes']);
  assert.match(html(page), /id="stg-cat-notes"[\s\S]*?id="stg-card-profile"[\s\S]*?id="stg-name"/);
  page.run("stgShowCard('dc')");
  assert.deepEqual(marked(html(page)), ['data']);
  // A click in the bar marks that category at once (no redraw needed).
  page.run("stgNavGo('about')");
  assert.equal(page.run('stgNavCat'), 'about');
  page.run('renderResults()');
  assert.deepEqual(marked(html(page)), ['about']);
  assert.deepEqual(page.errors, []);
});

test('the category bar keeps the design language: a sticky pill row on colour tokens, scrolls sideways on phones, off paper', () => {
  const css = HTML.slice(HTML.indexOf('/* 2v8:settings */'), HTML.indexOf('/* 2v8:end settings */'));
  assert.ok(css.length > 0 && HTML.indexOf('/* 2v8:end settings */') < HTML.indexOf('/* 2v7:motion */'));
  assert.match(css, /\.stg-nav\{position:sticky;top:12px;/);
  assert.match(css, /\.stg-nav-in\{[^}]*background:var\(--dz-surface\);[^}]*overflow-x:auto;scrollbar-width:none;/);
  assert.match(css, /\.stg-nav-a\.on\{background:var\(--dz-seg-on-bg\);color:var\(--dz-seg-on-fg\)\}/);
  assert.match(css, /\.stg-cgrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:900px\)\{\.stg-cgrid,#stg-card-notes \.stg-list\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.stg-nav-a\{transition:none\}\}/);
  assert.match(css, /@media \(forced-colors:active\)\{\.stg-nav-a/);
  // IntersectionObserver marks the category in view, with a scroll listener where there is none.
  assert.match(HTML, /function stgNavWatch\(\)\{[\s\S]*?typeof IntersectionObserver==='function'[\s\S]*?addEventListener\('scroll',stgNavScroll,\{passive:true\}\)/);
});

test('a shared snapshot: settings read only, the category bar still there', async () => {
  const page = await loaded([sapRow()]);
  page.run("isSnapshotView=true;setTab('settings')");
  const h = html(page);
  assert.match(h, /<p class="stg-ro rise">Shared snapshot: settings are read only\./);
  assert.equal(categories(h).length, 5);
  assert.match(h, /data-focus-key="stg-reset-all" onclick="stgResetAll\(\)" disabled/);
  assert.doesNotMatch(h, /data-focus-key="stg-export"/);
  assert.match(h, /id="stg-target"[^>]*disabled/);
});

// 2v6.9: Hidden Pages. A page in the hiddenPages setting leaves the top menu and the Supply menu; setTab to it, a
// snapshot or search that would open it go to Order Health. Warehouses is hidden by default; Order Health cannot be.
const header = (page) => page.els['app-header'].innerHTML;
const card = (h) => (h.match(/<section class="dz-card stg-card[^"]*" id="stg-card-hiddenpages"[\s\S]*?<\/section>/) || [''])[0];
test('Hidden Pages: Warehouses is hidden by default, one switch per page (hidden first), and a hidden page leaves the menus', async () => {
  const page = await loaded([sapRow()]);
  // 2v6.9 (owner): the Supply menu's pages start hidden too, so the Supply menu is gone; any can be shown again.
  // 2v9 (owner): Monthly starts hidden too (its sections are on Sales Order Health, Leading and Lagging).
  assert.deepEqual(page.run("stgValue('hiddenPages')"), ['monthly', 'warehouses', 'supplyweekly', 'supplydemand', 'buildrisk', 'forecast']);
  assert.doesNotMatch(header(page), /id="hdr-supply-btn"/);
  // A browser that had chosen its hidden pages before gets them hidden once, too (the flag keeps a later choice).
  const old = loadPage({ storage: { spyderKpiSettings: JSON.stringify({ dataSource: 'import', hiddenPages: ['monthly'] }) } });
  assert.deepEqual(old.run("stgValue('hiddenPages')"), ['monthly', 'supplyweekly', 'supplydemand', 'buildrisk', 'forecast']);
  // From here: only Warehouses hidden, as before.
  page.run("stgSet('hiddenPages',['warehouses'])");
  assert.match(header(page), /id="hdr-supply-btn"/);
  assert.equal(page.run("stgPageHidden('warehouses')"), true);
  assert.equal(page.run("stgPageHidden('weekly')"), false);
  // The menus: no Warehouses link; the other Sales links and the Supply menu stay.
  assert.doesNotMatch(header(page), /data-focus-key="nav-warehouses"/);
  assert.match(header(page), /data-focus-key="nav-weekly"[\s\S]*data-focus-key="nav-monthly"[\s\S]*data-focus-key="nav-shipping"/);
  // Metrics is a section of Lagging (2v6.9), so it is neither in the menu nor in Hidden Pages.
  assert.doesNotMatch(header(page), /data-focus-key="nav-metrics"/);
  assert.match(header(page), /data-focus-key="nav-purchaseorders"/);
  // setTab to a hidden page opens Order Health.
  page.run("setTab('monthly');setTab('warehouses')");
  assert.equal(page.run('activeTab'), 'weekly');
  // The card in Dashboard: the help line, Warehouses first and off, Order Health and Settings not offered.
  page.run("setTab('settings')");
  const c = card(html(page));
  assert.match(c, /<h2 class="dz-title sm stg-title" id="stg-h-hiddenpages" tabindex="-1">[\s\S]*Hidden Pages<\/h2>/);
  assert.match(c, /Hidden pages leave the top menu\. Turn one on to bring it back\./);
  const rows = [...c.matchAll(/<button type="button" role="switch" class="stg-switch" id="stg-page-(\w+)" data-focus-key="stg-page-\1" aria-checked="(true|false)" aria-label="Show ([^"]+)" onclick="stgTogglePage\(&#39;\1&#39;\)"/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows[0], ['warehouses', 'false', 'Warehouses']);
  assert.ok(rows.length >= 7 && rows.slice(1).every((r) => r[1] === 'true'), JSON.stringify(rows));
  assert.ok(!rows.some((r) => r[0] === 'weekly' || r[0] === 'settings' || r[0] === 'metrics'));
  assert.match(c, /In the Supply menu/);
  assert.equal(page.run("stgCatOf('hiddenpages')"), 'dash');
  // Turn Warehouses on: it is back in the menu and opens; hide Monthly and Purchase Orders: both leave their menus.
  page.run("stgTogglePage('warehouses')");
  assert.deepEqual(page.run("stgValue('hiddenPages')"), []);
  assert.match(header(page), /data-focus-key="nav-warehouses"/);
  page.run("setTab('warehouses')");
  assert.equal(page.run('activeTab'), 'warehouses');
  page.run("setTab('settings');stgTogglePage('purchaseorders');stgTogglePage('monthly')");
  assert.deepEqual(page.run("stgValue('hiddenPages')"), ['monthly', 'purchaseorders'], 'kept in menu order');
  assert.doesNotMatch(header(page), /data-focus-key="nav-monthly"|data-focus-key="nav-purchaseorders"/);
  // A remembered page that is now hidden (e.g. a snapshot's page, or the page a search started from) opens Order Health.
  page.run("activeTab='monthly';renderResults()");
  assert.equal(page.run('activeTab'), 'weekly');
  // Unknown ids are dropped; Order Health cannot be hidden.
  page.run("stgSet('hiddenPages',['weekly','nope','buildrisk'])");
  assert.deepEqual(page.run("stgValue('hiddenPages')"), ['buildrisk']);
  assert.deepEqual(page.errors, []);
});

run();
